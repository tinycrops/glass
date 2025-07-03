import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithCredential, signInWithCustomToken, signOut } from 'firebase/auth';

import './AppHeader.js';
import './ApiKeyHeader.js';

const firebaseConfig = {
    apiKey: 'AIzaSyAgtJrmsFWG1C7m9S55HyT1laICEzuUS2g',
    authDomain: 'pickle-3651a.firebaseapp.com',
    projectId: 'pickle-3651a',
    storageBucket: 'pickle-3651a.firebasestorage.app',
    messagingSenderId: '904706892885',
    appId: '1:904706892885:web:0e42b3dda796674ead20dc',
    measurementId: 'G-SQ0WM6S28T',
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

class HeaderTransitionManager {
    constructor() {
        this.apiKeyHeader = document.getElementById('apikey-header');
        this.appHeader = document.getElementById('app-header');
        this.isInitialized = false;
        this.hasApiKey = false;
        this.notifyHeaderState();

        console.log('[HeaderController] Manager initialized');

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer
                .invoke('get-current-api-key')
                .then(storedKey => {
                    this.hasApiKey = !!storedKey;
                    if (this.hasApiKey && !auth.currentUser) {
                        console.log('[HeaderController] Stored API key detected. Skipping ApiKeyHeader.');
                        this.transitionToAppHeader(false);
                    }
                })
                .catch(() => {});
        }

        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            ipcRenderer.on('login-successful', async (event, payload) => {
                const { customToken, token, error } = payload || {};
                try {
                    if (customToken) {
                        console.log('[HeaderController] Received custom token, signing in with custom token...');
                        await signInWithCustomToken(auth, customToken);
                        return;
                    }

                    if (token) {
                        console.log('[HeaderController] Received ID token, attempting Google credential sign-in...');
                        const credential = GoogleAuthProvider.credential(token);
                        await signInWithCredential(auth, credential);
                        return;
                    }

                    if (error) {
                        console.warn('[HeaderController] Login payload indicates verification failure. Proceeding to AppHeader UI only.');
                        this.transitionToAppHeader();
                    }
                } catch (error) {
                    console.error('[HeaderController] Sign-in failed', error);
                    this.transitionToAppHeader();
                }
            });

            ipcRenderer.on('request-firebase-logout', async () => {
                console.log('[HeaderController] Received request to sign out.');
                try {
                    await signOut(auth);
                } catch (error) {
                    console.error('[HeaderController] Sign out failed', error);
                }
            });

            ipcRenderer.on('api-key-validated', () => {
                this.hasApiKey = true;
                this.transitionToAppHeader();
            });

            ipcRenderer.on('api-key-removed', () => {
                this.hasApiKey = false;
                this.transitionToApiKeyHeader();
            });

            ipcRenderer.on('api-key-updated', () => {
                this.hasApiKey = true;
                if (!auth.currentUser) {
                    this.transitionToAppHeader();
                }
            });

            ipcRenderer.on('firebase-auth-success', async (event, firebaseUser) => {
                console.log('[HeaderController] Received firebase-auth-success:', firebaseUser.uid);
                try {
                    if (firebaseUser.idToken) {
                        const credential = GoogleAuthProvider.credential(firebaseUser.idToken);
                        await signInWithCredential(auth, credential);
                        console.log('[HeaderController] Firebase sign-in successful via ID token');
                    } else {
                        console.warn('[HeaderController] No ID token received from deeplink, virtual key request may fail');
                        this.transitionToAppHeader();
                    }
                } catch (error) {
                    console.error('[HeaderController] Firebase auth failed:', error);
                    this.transitionToAppHeader();
                }
            });
        }

        onAuthStateChanged(auth, async user => {
            console.log('[HeaderController] Auth state changed. User:', user ? user.email : 'null');

            if (window.require) {
                const { ipcRenderer } = window.require('electron');

                let userDataWithToken = null;
                if (user) {
                    try {
                        const idToken = await user.getIdToken();
                        userDataWithToken = {
                            uid: user.uid,
                            email: user.email,
                            name: user.displayName,
                            photoURL: user.photoURL,
                            idToken: idToken,
                        };
                    } catch (error) {
                        console.error('[HeaderController] Failed to get ID token:', error);
                        userDataWithToken = {
                            uid: user.uid,
                            email: user.email,
                            name: user.displayName,
                            photoURL: user.photoURL,
                            idToken: null,
                        };
                    }
                }

                ipcRenderer.invoke('firebase-auth-state-changed', userDataWithToken).catch(console.error);
            }

            if (!this.isInitialized) {
                this.isInitialized = true;
            }

            if (user) {
                console.log('[HeaderController] User is logged in, transitioning to AppHeader');
                this.transitionToAppHeader(!this.hasApiKey);
            } else if (this.hasApiKey) {
                console.log('[HeaderController] No Firebase user but API key exists, showing AppHeader');
                this.transitionToAppHeader(false);
            } else {
                console.log('[HeaderController] No auth & no API key — showing ApiKeyHeader');
                this.transitionToApiKeyHeader();
            }
        });
    }

    notifyHeaderState() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            const isApiKeyVisible =
                this.apiKeyHeader && this.apiKeyHeader.style.display !== 'none' && !this.apiKeyHeader.classList.contains('hidden');
            const state = isApiKeyVisible ? 'apikey' : 'app';

            ipcRenderer.send('header-state-changed', state);
            console.log(`[HeaderController] Notified header state: ${state}`);
        }
    }

    async transitionToAppHeader(animate = true) {
        console.log(`[HeaderController] Transitioning to AppHeader (animate: ${animate})`);
        const isApiKeyVisible = this.apiKeyHeader.style.display !== 'none' && !this.apiKeyHeader.classList.contains('hidden');

        if (animate && isApiKeyVisible) {
            this.apiKeyHeader.startSlideOutAnimation();
            this.apiKeyHeader.addEventListener(
                'animationend',
                () => {
                    this.showAppHeader();
                },
                { once: true }
            );
        } else {
            this.showAppHeader();
        }
    }

    async showAppHeader() {
        try {
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                try {
                    await ipcRenderer.invoke('resize-header-window', { width: 353, height: 60 });
                } catch (resizeError) {
                    console.warn('[HeaderController] Window resize failed:', resizeError);
                }
            }

            this.apiKeyHeader.style.display = 'none';
            this.appHeader.style.display = 'block';

            if (this.appHeader.startSlideInAnimation) {
                this.appHeader.startSlideInAnimation();
            } else {
                this.appHeader.classList.remove('hidden');
            }

            this.notifyHeaderState();

            console.log('[HeaderController] AppHeader displayed successfully');
        } catch (error) {
            console.error('[HeaderController] Error in showAppHeader:', error);
            this.apiKeyHeader.style.display = 'none';
            this.appHeader.style.display = 'block';
        }
    }

    async transitionToApiKeyHeader() {
        console.log('[HeaderController] Transitioning to ApiKeyHeader');
        await window.require('electron').ipcRenderer.invoke('resize-header-window', { width: 285, height: 220 });
        this.appHeader.style.display = 'none';
        this.apiKeyHeader.style.display = 'block';
        this.apiKeyHeader.reset();
        this.notifyHeaderState();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new HeaderTransitionManager();
});
