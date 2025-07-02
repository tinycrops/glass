import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithCredential, signInWithCustomToken, signOut } from 'firebase/auth';

// 이 두 컴포넌트를 import하여 customElements.define을 실행시킵니다.
import './AppHeader.js';
import './ApiKeyHeader.js';

// Firebase 웹 앱 설정 정보
const firebaseConfig = {
    apiKey: "AIzaSyAgtJrmsFWG1C7m9S55HyT1laICEzuUS2g",
    authDomain: "pickle-3651a.firebaseapp.com",
    projectId: "pickle-3651a",
    storageBucket: "pickle-3651a.firebasestorage.app",
    messagingSenderId: "904706892885",
    appId: "1:904706892885:web:0e42b3dda796674ead20dc",
    measurementId: "G-SQ0WM6S28T"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

/**
 * HeaderTransitionManager: 헤더 표시 상태를 관리
 */
class HeaderTransitionManager {
    constructor() {
        this.apiKeyHeader = document.getElementById('apikey-header');
        this.appHeader = document.getElementById('app-header');
        this.isInitialized = false;
        this.hasApiKey = false;

        console.log('[HeaderController] Manager initialized');

        // 1️⃣ 앱 부팅 시 저장된 API 키가 있는지 메인 프로세스에 확인
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('get-current-api-key').then(storedKey => {
                this.hasApiKey = !!storedKey;
                if (this.hasApiKey && !auth.currentUser) {
                    console.log('[HeaderController] Stored API key detected. Skipping ApiKeyHeader.');
                    this.transitionToAppHeader(false);
                }
            }).catch(() => {});
        }

        // IPC 리스너 등록
        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            ipcRenderer.on('login-successful', async (event, payload) => {
                const { customToken, token, error } = payload || {};
                try {
                    if (customToken) {
                        console.log('[HeaderController] Received custom token, signing in with custom token...');
                        await signInWithCustomToken(auth, customToken);
                        // onAuthStateChanged will transition UI
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
                    // Fallback: UI는 여전히 전환
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
                this.hasApiKey = true; // API 키 상태 업데이트
                this.transitionToAppHeader();
            });

            ipcRenderer.on('api-key-removed', () => {
                this.hasApiKey = false; // API 키 상태 업데이트
                this.transitionToApiKeyHeader();
            });

            ipcRenderer.on('api-key-updated', () => {
                this.hasApiKey = true; // API 키 상태 업데이트
                // Firebase 사용자가 없는 상태에서 API 키가 업데이트된 경우에만 헤더 전환
                if (!auth.currentUser) {
                    this.transitionToAppHeader();
                }
            });

            // Firebase 로그인 성공 처리 (딥링크에서 오는 사용자 정보)
            ipcRenderer.on('firebase-auth-success', async (event, firebaseUser) => {
                console.log('[HeaderController] Received firebase-auth-success:', firebaseUser.uid);
                try {
                    if (firebaseUser.idToken) {
                        // Authenticate with Firebase ID token
                        const credential = GoogleAuthProvider.credential(firebaseUser.idToken);
                        await signInWithCredential(auth, credential);
                        console.log('[HeaderController] Firebase sign-in successful via ID token');
                        // Token will be passed to windowManager via onAuthStateChanged
                    } else {
                        // Process user info without token
                        console.warn('[HeaderController] No ID token received from deeplink, virtual key request may fail');
                        this.transitionToAppHeader();
                    }
                } catch (error) {
                    console.error('[HeaderController] Firebase auth failed:', error);
                    // 실패해도 UI 전환은 진행
                    this.transitionToAppHeader();
                }
            });
        }

        // Firebase 인증 상태 변화 감지
        onAuthStateChanged(auth, async (user) => {
            console.log('[HeaderController] Auth state changed. User:', user ? user.email : 'null');

            // Notify main process of the state change
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                
                let userDataWithToken = null;
                if (user) {
                    try {
                        // Get Firebase ID token for virtual key authentication
                        const idToken = await user.getIdToken();
                        userDataWithToken = {
                            uid: user.uid,
                            email: user.email,
                            name: user.displayName,
                            photoURL: user.photoURL,
                            idToken: idToken
                        };
                    } catch (error) {
                        console.error('[HeaderController] Failed to get ID token:', error);
                        // Pass user info without token if token retrieval fails
                        userDataWithToken = {
                            uid: user.uid,
                            email: user.email,
                            name: user.displayName,
                            photoURL: user.photoURL,
                            idToken: null
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
                this.transitionToAppHeader(!this.hasApiKey); // if API key path already did, no anim
            } else if (this.hasApiKey) {
                console.log('[HeaderController] No Firebase user but API key exists, showing AppHeader');
                this.transitionToAppHeader(false);
            } else {
                console.log('[HeaderController] No auth & no API key — showing ApiKeyHeader');
                this.transitionToApiKeyHeader();
            }
        });
    }

    async transitionToAppHeader(animate = true) {
        console.log(`[HeaderController] Transitioning to AppHeader (animate: ${animate})`);
        const isApiKeyVisible = this.apiKeyHeader.style.display !== 'none' && !this.apiKeyHeader.classList.contains('hidden');

        if (animate && isApiKeyVisible) {
            this.apiKeyHeader.startSlideOutAnimation();
            this.apiKeyHeader.addEventListener('animationend', () => {
                this.showAppHeader();
            }, { once: true });
        } else {
            this.showAppHeader();
        }
    }
    
    async showAppHeader() {
        try {
            // 윈도우 리사이즈 시도 (실패해도 UI 전환은 계속)
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                try {
                    await ipcRenderer.invoke('resize-header-window', { width: 353, height: 60 });
                } catch (resizeError) {
                    console.warn('[HeaderController] Window resize failed:', resizeError);
                }
            }
            
            // UI 전환
            this.apiKeyHeader.style.display = 'none';
            this.appHeader.style.display = 'block';
            
            if (this.appHeader.startSlideInAnimation) {
                this.appHeader.startSlideInAnimation();
            } else {
                this.appHeader.classList.remove('hidden');
            }
            
            console.log('[HeaderController] AppHeader displayed successfully');
        } catch (error) {
            console.error('[HeaderController] Error in showAppHeader:', error);
            // 최소한 UI는 표시
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
    }
}

// DOM이 로드된 후 컨트롤러 시작
window.addEventListener('DOMContentLoaded', () => {
    new HeaderTransitionManager();
}); 