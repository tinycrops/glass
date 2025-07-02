import { html, css, LitElement } from '../assets/lit-core-2.7.4.min.js';
import { CustomizeView } from '../features/customize/CustomizeView.js';
import { HelpView } from '../features/help/HelpView.js';
import { HistoryView } from '../features/history/HistoryView.js';
import { AssistantView } from '../features/listen/AssistantView.js';
import { OnboardingView } from '../features/onboarding/OnboardingView.js';
import { AskView } from '../features/ask/AskView.js';

// listen 기능에 필수적인 renderer.js를 import
import '../features/listen/renderer.js';

export class PickleGlassApp extends LitElement {
    static styles = css`
        :host {
            display: block; /* 단순한 블록 요소로 변경 */
            width: 100%;
            /* 높이는 내용에 맞게 자동 조절 */
            color: var(--text-color);
            background: transparent;
            border-radius: 7px;
        }

        /* AssistantView를 위한 최적화된 스타일 */
        assistant-view {
            display: block;
            width: 100%;
            /* 내용에 맞게 자연스럽게 높이 조절 */
        }

        /* 다른 뷰들도 내용에 맞게 자동 조절 */
        ask-view, customize-view, history-view, help-view, onboarding-view, setup-view {
            display: block;
            width: 100%;
        }

        /* Remove window-container and other outer styles as this is the root now */
    `;

    static properties = {
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        currentResponseIndex: { type: Number },
        isMainViewVisible: { type: Boolean },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        isClickThrough: { type: Boolean, state: true },
        layoutMode: { type: String },
        _viewInstances: { type: Object, state: true },
        _isClickThrough: { state: true },
        // outlines: { type: Array },
        // analysisRequests: { type: Array },
        structuredData: { type: Object }, 
    };

    constructor() {
        super();
        const urlParams = new URLSearchParams(window.location.search);
        this.currentView = urlParams.get('view') || 'listen'; // Default to listen view

        this.currentResponseIndex = -1;
        this.selectedProfile = localStorage.getItem('selectedProfile') || 'interview';
        this.selectedLanguage = localStorage.getItem('selectedLanguage') || 'en-US';
        this.selectedScreenshotInterval = localStorage.getItem('selectedScreenshotInterval') || '5';
        this.selectedImageQuality = localStorage.getItem('selectedImageQuality') || 'medium';
        this._isClickThrough = false;
        ////////// for index & subjects //////////
        this.outlines = [];
        this.analysisRequests = [];
        // window.pickleGlass.setOutline = lines => {
        //     this.outlines = [...lines];
        //     this.requestUpdate();
        // };
        // window.pickleGlass.setAnalysisRequests = lines => {
        //     this.analysisRequests = [...lines];
        //     this.requestUpdate();
        // };
        // window.pickleGlass.setOutline/setAnalysisRequests가 이 인스턴스의 메서드를 호출하도록 수정
        // window.pickleGlass.setOutline = lines => {
        //     this.updateOutline(lines);
        // };
        // window.pickleGlass.setAnalysisRequests = lines => {
        //     this.updateAnalysisRequests(lines);
        // };
        window.pickleGlass.setStructuredData = data => {
            this.updateStructuredData(data);
        };
        ////////// for index & subjects //////////
    }

    connectedCallback() {
        super.connectedCallback();
        
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            
            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));
            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            ipcRenderer.on('show-view', (_, view) => {
                this.currentView = view;
                this.isMainViewVisible = true;
            });
            // Listen for the command from the main process to start the session.
            ipcRenderer.on('start-listening-session', () => {
                console.log('Received start-listening-session command, calling handleListenClick.');
                this.handleListenClick();
            });
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.removeAllListeners('update-status');
            ipcRenderer.removeAllListeners('click-through-toggled');
            ipcRenderer.removeAllListeners('show-view');
            ipcRenderer.removeAllListeners('start-listening-session');
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('isMainViewVisible') || changedProperties.has('currentView')) {
            this.requestWindowResize();
        }

        // Only notify main process of view change if the view actually changed
        if (changedProperties.has('currentView') && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('view-changed', this.currentView);

            // Add a small delay to smooth out the transition
            const viewContainer = this.shadowRoot?.querySelector('.view-container');
            if (viewContainer) {
                viewContainer.classList.add('entering');
                requestAnimationFrame(() => {
                    viewContainer.classList.remove('entering');
                });
            }
        }

        // Only update localStorage when these specific properties change
        if (changedProperties.has('selectedProfile')) {
            localStorage.setItem('selectedProfile', this.selectedProfile);
        }
        if (changedProperties.has('selectedLanguage')) {
            localStorage.setItem('selectedLanguage', this.selectedLanguage);
        }
        if (changedProperties.has('selectedScreenshotInterval')) {
            localStorage.setItem('selectedScreenshotInterval', this.selectedScreenshotInterval);
        }
        if (changedProperties.has('selectedImageQuality')) {
            localStorage.setItem('selectedImageQuality', this.selectedImageQuality);
        }
        if (changedProperties.has('layoutMode')) {
            this.updateLayoutMode();
        }
    }

    requestWindowResize() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('resize-window', {
                isMainViewVisible: this.isMainViewVisible,
                view: this.currentView,
            });
        }
    }

    setStatus(text) {
        this.statusText = text;
    }

    // New Header event handlers
    async handleListenClick() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            const isActive = await ipcRenderer.invoke('is-session-active');
            if (isActive) {
                console.log('Session is already active. No action needed.');
                return;
            }
        }

        // For now, we assume API key is set.
        // A more robust solution would check for the key first.
        if (window.pickleGlass) {
            await window.pickleGlass.initializeopenai(this.selectedProfile, this.selectedLanguage);
            window.pickleGlass.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);
        }
        this.currentResponseIndex = -1;
        this.startTime = Date.now();
        this.currentView = 'listen';
        this.isMainViewVisible = true;
    }

    handleShowHideClick() {
        this.isMainViewVisible = !this.isMainViewVisible;
    }

    handleCustomizeClick() {
        this.currentView = 'customize';
        this.isMainViewVisible = true;
    }

    handleHelpClick() {
        this.currentView = 'help';
        this.isMainViewVisible = true;
    }

    handleHistoryClick() {
        this.currentView = 'history';
        this.isMainViewVisible = true;
    }

    async handleClose() {
        // This can now be simplified as the header is always present
        // Or tied to a new quit button in the '...' menu
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('quit-application');
        }
    }

    handleBackClick() {
        // This logic might need to be re-evaluated.
        // Maybe it always goes back to the initial 'setup' or 'listen' view.
        this.currentView = 'listen';
    }

    // Text input handler
    async handleSendText(message) {
        if (window.pickleGlass) {
            const result = await window.pickleGlass.sendTextMessage(message);

            if (!result.success) {
                console.error('Failed to send message:', result.error);
                this.setStatus('Error sending message: ' + result.error);
            } else {
                this.setStatus('Message sent...');
            }
        }
    }

    // updateOutline(outline) {
    //     console.log('📝 PickleGlassApp updateOutline:', outline);
    //     this.outlines = [...outline];
    //     this.requestUpdate();
    // }

    // updateAnalysisRequests(requests) {
    //     console.log('📝 PickleGlassApp updateAnalysisRequests:', requests);
    //     this.analysisRequests = [...requests];
    //     this.requestUpdate();
    // }

    updateStructuredData(data) {
        console.log('📝 PickleGlassApp updateStructuredData:', data);
        this.structuredData = data;
        this.requestUpdate();
        
        // AssistantView로 직접 전달
        const assistantView = this.shadowRoot?.querySelector('assistant-view');
        if (assistantView) {
            assistantView.structuredData = data;
            console.log('✅ Structured data passed to AssistantView');
        }
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
    }

    // Onboarding event handlers
    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    render() {
        switch (this.currentView) {
            case 'listen':
                return html`<assistant-view
                    .currentResponseIndex=${this.currentResponseIndex}
                    .selectedProfile=${this.selectedProfile}
                    .structuredData=${this.structuredData}
                    .onSendText=${message => this.handleSendText(message)}
                    @response-index-changed=${e => (this.currentResponseIndex = e.detail.index)}
                ></assistant-view>`;
            case 'ask':
                return html`<ask-view></ask-view>`;
            case 'customize':
                return html`<customize-view
                    .selectedProfile=${this.selectedProfile}
                    .selectedLanguage=${this.selectedLanguage}
                    .onProfileChange=${profile => (this.selectedProfile = profile)}
                    .onLanguageChange=${lang => (this.selectedLanguage = lang)}
                ></customize-view>`;
            case 'history':
                return html`<history-view></history-view>`;
            case 'help':
                return html`<help-view></help-view>`;
            case 'onboarding':
                return html`<onboarding-view></onboarding-view>`;
            case 'setup':
                return html`<setup-view></setup-view>`;
            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }
}

customElements.define('pickle-glass-app', PickleGlassApp);
