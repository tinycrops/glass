import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AskView extends LitElement {
    static properties = {
        currentResponse: { type: String },
        currentQuestion: { type: String },
        showResponsePanel: { type: Boolean },
        isLoading: { type: Boolean },
        copyState: { type: String },
        isHovering: { type: Boolean },
        hoveredLineIndex: { type: Number },
        lineCopyState: { type: Object },
        showTextInput: { type: Boolean },
        headerText: { type: String },
        headerAnimating: { type: Boolean },
        isStreaming: { type: Boolean },
        streamedResponse: { type: String },
    };

    static styles = css`
        :host {
            display: block;
            width: 100%;
            height: 100%;
            color: white;
        }

        * {
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: default;
            user-select: none;
        }

        /* highlight.js 스타일 추가 */
        .response-container pre {
            background: rgba(0, 0, 0, 0.4) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }

        .response-container code {
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
            font-size: 11px !important;
            background: transparent !important;
        }

        .response-container p code {
            background: rgba(255, 255, 255, 0.1) !important;
            padding: 2px 4px !important;
            border-radius: 3px !important;
            color: #ffd700 !important;
        }

        /* 코드 블록 구문 강조 색상 */
        .hljs-keyword { color: #ff79c6 !important; }
        .hljs-string { color: #f1fa8c !important; }
        .hljs-comment { color: #6272a4 !important; }
        .hljs-number { color: #bd93f9 !important; }
        .hljs-function { color: #50fa7b !important; }
        .hljs-variable { color: #8be9fd !important; }
        .hljs-built_in { color: #ffb86c !important; }
        .hljs-title { color: #50fa7b !important; }
        .hljs-attr { color: #50fa7b !important; }
        .hljs-tag { color: #ff79c6 !important; }

        .ask-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            background: rgba(0, 0, 0, 0.6);
            border-radius: 12px;
            outline: 0.5px rgba(255, 255, 255, 0.3) solid;
            outline-offset: -1px;
            backdrop-filter: blur(1px);
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
        }

        .ask-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.15);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            border-radius: 12px;
            filter: blur(10px);
            z-index: -1;
        }

        /* Response Header Styles */
        .response-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: transparent;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
        }

        .response-header.hidden {
            display: none;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }

        .response-icon {
            width: 20px;
            height: 20px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .response-icon svg {
            width: 12px;
            height: 12px;
            stroke: rgba(255, 255, 255, 0.9);
        }

        .response-label {
            font-size: 13px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.9);
            white-space: nowrap;
            position: relative;
            overflow: hidden;
        }

        .response-label.animating {
            animation: fadeInOut 0.3s ease-in-out;
        }

        @keyframes fadeInOut {
            0% {
                opacity: 1;
                transform: translateY(0);
            }
            50% {
                opacity: 0;
                transform: translateY(-10px);
            }
            100% {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            justify-content: flex-end;
        }

        .question-text {
            font-size: 13px;
            color: rgba(255, 255, 255, 0.7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 300px;
            margin-right: 8px;
        }

        .header-controls {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
        }

        .copy-button {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.2);
            padding: 4px;
            border-radius: 3px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 24px;
            flex-shrink: 0;
            transition: background-color 0.15s ease;
            position: relative;
            overflow: hidden;
        }

        .copy-button:hover {
            background: rgba(255, 255, 255, 0.15);
        }

        .copy-button svg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
        }

        .copy-button .check-icon {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
        }

        .copy-button.copied .copy-icon {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
        }

        .copy-button.copied .check-icon {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }

        .close-button {
            background: rgba(255, 255, 255, 0.07);
            color: white;
            border: none;
            padding: 4px;
            border-radius: 20px;
            outline: 1px rgba(255, 255, 255, 0.3) solid;
            outline-offset: -1px;
            backdrop-filter: blur(0.50px);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        .close-button:hover {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 1);
        }

        /* Response Container Styles */
        .response-container {
            flex: 1;
            padding: 16px;
            padding-left: 48px;
            overflow-y: auto;
            font-size: 14px;
            line-height: 1.6;
            background: transparent;
            min-height: 0;
            max-height: 400px;
            position: relative;
        }

        .response-container.hidden {
            display: none;
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        /* Loading dots animation */
        .loading-dots {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 40px;
        }

        .loading-dot {
            width: 8px;
            height: 8px;
            background: rgba(255, 255, 255, 0.6);
            border-radius: 50%;
            animation: pulse 1.5s ease-in-out infinite;
        }

        .loading-dot:nth-child(1) {
            animation-delay: 0s;
        }

        .loading-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .loading-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes pulse {
            0%, 80%, 100% {
                opacity: 0.3;
                transform: scale(0.8);
            }
            40% {
                opacity: 1;
                transform: scale(1.2);
            }
        }

        /* Line-level copy button styles */
        .response-line {
            position: relative;
            padding: 2px 0;
            margin: 0;
            transition: background-color 0.15s ease;
        }

        .response-line:hover {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
        }

        .line-copy-button {
            position: absolute;
            left: -32px;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 3px;
            padding: 2px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s ease, background-color 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }

        .response-line:hover .line-copy-button {
            opacity: 1;
        }

        .line-copy-button:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .line-copy-button.copied {
            background: rgba(40, 167, 69, 0.3);
        }

        .line-copy-button svg {
            width: 12px;
            height: 12px;
            stroke: rgba(255, 255, 255, 0.9);
        }

        /* Text Input Container Styles */
        .text-input-container {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(0, 0, 0, 0.1);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
            transition: all 0.3s ease-in-out;
            transform-origin: bottom;
        }

        .text-input-container.hidden {
            opacity: 0;
            transform: scaleY(0);
            padding: 0;
            height: 0;
            overflow: hidden;
        }

        .text-input-container.no-response {
            border-top: none;
        }

        #textInput {
            flex: 1;
            padding: 10px 14px;
            background: rgba(0, 0, 0, 0.20);
            border-radius: 20px;
            outline: none;
            border: none;
            color: white;
            font-size: 14px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 400;
        }

        #textInput::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }

        #textInput:focus {
            outline: none;
        }

        /* Markdown content styling */
        .response-line h1,
        .response-line h2,
        .response-line h3,
        .response-line h4,
        .response-line h5,
        .response-line h6 {
            color: rgba(255, 255, 255, 0.95);
            margin: 16px 0 8px 0;
            font-weight: 600;
        }

        .response-line p {
            margin: 8px 0;
            color: rgba(255, 255, 255, 0.9);
        }

        .response-line ul,
        .response-line ol {
            margin: 8px 0;
            padding-left: 20px;
        }

        .response-line li {
            margin: 4px 0;
            color: rgba(255, 255, 255, 0.9);
        }

        .response-line code {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.95);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13px;
        }

        .response-line pre {
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.95);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 12px 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .response-line pre code {
            background: none;
            padding: 0;
        }

        .response-line blockquote {
            border-left: 3px solid rgba(255, 255, 255, 0.3);
            margin: 12px 0;
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.05);
            color: rgba(255, 255, 255, 0.8);
        }

        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: rgba(255, 255, 255, 0.5);
            font-size: 14px;
        }
    `;

    constructor() {
        super();
        this.currentResponse = '';
        this.currentQuestion = '';
        this.showResponsePanel = true;
        this.isLoading = false;
        this.copyState = 'idle';
        this.isHovering = false;
        this.copyTimeout = null;
        this.hoveredLineIndex = -1;
        this.lineCopyState = {};
        this.lineCopyTimeouts = {};
        this.showTextInput = true;
        this.headerText = 'AI Response';
        this.headerAnimating = false;
        this.isStreaming = false;
        this.streamedResponse = '';
        this.headerAnimationTimeout = null;
        this.streamingTimeout = null;

        // 마크다운 라이브러리 초기화
        this.marked = null;
        this.hljs = null;
        this.isLibrariesLoaded = false;
        this.DOMPurify = null;
        this.isDOMPurifyLoaded = false;
        
        // 스트리밍 개선을 위한 속성
        this.streamingContainer = null;
        this.accumulatedChunks = '';
        this.lastSafeContent = '';

        // Bind methods
        this.handleSendText = this.handleSendText.bind(this);
        this.handleTextKeydown = this.handleTextKeydown.bind(this);
        this.closeResponsePanel = this.closeResponsePanel.bind(this);
        this.handleNewResponse = this.handleNewResponse.bind(this);
        this.handleCopy = this.handleCopy.bind(this);
        this.handleLineCopy = this.handleLineCopy.bind(this);
        this.handleGlobalSendRequest = this.handleGlobalSendRequest.bind(this);
        this.handleToggleTextInput = this.handleToggleTextInput.bind(this);
        this.clearResponseContent = this.clearResponseContent.bind(this);
        
        // 라이브러리 로드
        this.loadLibraries();
    }

    // 라이브러리 로드 메서드
    async loadLibraries() {
        try {
            // Script 태그를 통해 라이브러리 로드
            if (!window.marked) {
                await this.loadScript('../../assets/marked-4.3.0.min.js');
            }
            
            if (!window.hljs) {
                await this.loadScript('../../assets/highlight-11.9.0.min.js');
            }

            if (!window.DOMPurify) {
                await this.loadScript('../../assets/dompurify-3.0.7.min.js');
            }

            // 로드된 라이브러리 참조
            this.marked = window.marked;
            this.hljs = window.hljs;
            this.DOMPurify = window.DOMPurify;

            // marked 설정
            if (this.marked && this.hljs) {
                this.marked.setOptions({
                    highlight: (code, lang) => {
                        if (lang && this.hljs.getLanguage(lang)) {
                            try {
                                return this.hljs.highlight(code, { language: lang }).value;
                            } catch (err) {
                                console.warn('Highlight error:', err);
                            }
                        }
                        try {
                            return this.hljs.highlightAuto(code).value;
                        } catch (err) {
                            console.warn('Auto highlight error:', err);
                        }
                        return code;
                    },
                    breaks: true,
                    gfm: true
                });

                this.isLibrariesLoaded = true;
                console.log('Markdown libraries loaded successfully in AskView');
            }

            if (this.DOMPurify) {
                this.isDOMPurifyLoaded = true;
                console.log('DOMPurify loaded successfully in AskView');
            }
        } catch (error) {
            console.error('Failed to load libraries in AskView:', error);
        }
    }

    // Script 로드 헬퍼 메서드
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // 마크다운 파싱 메서드
    parseMarkdown(text) {
        if (!text) return '';
        
        // 라이브러리가 로드되지 않았으면 원본 텍스트 반환
        if (!this.isLibrariesLoaded || !this.marked) {
            return text;
        }
        
        try {
            return this.marked(text);
        } catch (error) {
            console.error('Markdown parsing error in AskView:', error);
            return text; // 파싱 실패 시 원본 텍스트 반환
        }
    }

    // 스트리밍 중 미완성 코드 블록 자동 닫기
    fixIncompleteCodeBlocks(text) {
        if (!text) return text;
        
        // ``` 의 개수를 세기
        const codeBlockMarkers = text.match(/```/g) || [];
        const markerCount = codeBlockMarkers.length;
        
        // 홀수개면 코드 블록이 열려있는 상태 -> 임시로 닫기
        if (markerCount % 2 === 1) {
            return text + '\n```';
        }
        
        // 짝수개면 모든 코드 블록이 닫혀있는 상태
        return text;
    }

    connectedCallback() {
        super.connectedCallback();
        
        console.log('📱 AskView connectedCallback - IPC 이벤트 리스너 설정');

        // 창 높이 자동 조절
        this.resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const needed = entry.contentRect.height;
                const current = window.innerHeight;

                if (needed > current - 4) {
                    this.requestWindowResize(Math.ceil(needed));
                }
            }
        });

        const container = this.shadowRoot?.querySelector('.ask-container');
        if (container) this.resizeObserver.observe(container);

        this.handleQuestionFromAssistant = (event, question) => {
            console.log('📨 AskView: Received question from AssistantView:', question);
            // 기존 응답 내용 초기화
            this.currentResponse = '';
            this.streamedResponse = '';
            this.isStreaming = false;
            this.updateResponseContent();
            this.requestUpdate();
            
            // 즉시 질문 설정하고 로딩 상태로 전환
            this.currentQuestion = question;
            this.isLoading = true;
            this.showTextInput = false;  // text input 숨기기
            this.headerText = 'analyzing screen...';
            this.startHeaderAnimation();
            this.requestUpdate();
            
            // sendMessage 호출
            this.processAssistantQuestion(question);
        };
        
        
        // IPC 이벤트 리스너
        this.handleAddAskResponse = (event, data) => {
            console.log('📨 AskView: add-ask-response IPC 이벤트 수신!', data);
            
            const { question, response } = data;
            
            this.currentQuestion = question;
            // 즉시 헤더 애니메이션 시작
            this.startHeaderAnimation();
            // 스트리밍 시뮬레이션 시작
            this.simulateStreaming(response);
            
            console.log('✅ AskView: 응답 업데이트 완료');
        };
        
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('add-ask-response', this.handleAddAskResponse);
            ipcRenderer.on('ask-global-send', this.handleGlobalSendRequest);
            ipcRenderer.on('toggle-text-input', this.handleToggleTextInput);
            ipcRenderer.on('clear-ask-content', this.clearResponseContent);
            ipcRenderer.on('receive-question-from-assistant', this.handleQuestionFromAssistant);
            ipcRenderer.on('hide-text-input', () => {
                console.log('📤 Hide text input signal received');
                this.showTextInput = false;
                this.requestUpdate();
            });
            ipcRenderer.on('clear-ask-response', () => {
                console.log('📤 Clear response signal received');
                this.currentResponse = '';
                this.streamedResponse = '';
                this.isStreaming = false;
                this.isLoading = false;
                this.headerText = 'AI Response';
                this.updateResponseContent();
                this.requestUpdate();
            });
            // Ask 창이 닫힐 때 응답 내용 초기화
            ipcRenderer.on('window-hide-animation', () => {
                console.log('📤 Ask window hiding - clearing response content');
                setTimeout(() => {
                    this.clearResponseContent();
                }, 250); // 애니메이션 완료 후 초기화
            });
            console.log('✅ AskView: IPC 이벤트 리스너 등록 완료');
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.resizeObserver?.disconnect();
        
        console.log('📱 AskView disconnectedCallback - IPC 이벤트 리스너 제거');
        
        if (this.copyTimeout) {
            clearTimeout(this.copyTimeout);
        }

        if (this.headerAnimationTimeout) {
            clearTimeout(this.headerAnimationTimeout);
        }

        if (this.streamingTimeout) {
            clearTimeout(this.streamingTimeout);
        }

        Object.values(this.lineCopyTimeouts).forEach(timeout => clearTimeout(timeout));
        
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.removeListener('add-ask-response', this.handleAddAskResponse);
            ipcRenderer.removeListener('ask-global-send', this.handleGlobalSendRequest);
            ipcRenderer.removeListener('toggle-text-input', this.handleToggleTextInput);
            ipcRenderer.removeListener('clear-ask-content', this.clearResponseContent);
            ipcRenderer.removeListener('clear-ask-response', () => {});
            ipcRenderer.removeListener('hide-text-input', () => {});
            ipcRenderer.removeListener('window-hide-animation', () => {});
            console.log('✅ AskView: IPC 이벤트 리스너 제거 완료');
        }
    }

    clearResponseContent() {
        this.currentResponse = '';
        this.currentQuestion = '';
        this.streamedResponse = '';
        this.isLoading = false;
        this.isStreaming = false;
        this.headerText = 'AI Response';
        this.showTextInput = true; // 초기화 시 text input 보이기
        this.updateResponseContent();
        this.requestUpdate();
    }

    handleToggleTextInput() {
        this.showTextInput = !this.showTextInput;
        this.requestUpdate();
    }

    requestWindowResize(targetHeight) {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('adjust-window-height', targetHeight);
        }
    }

    animateHeaderText(text) {
        this.headerAnimating = true;
        this.requestUpdate();
        
        setTimeout(() => {
            this.headerText = text;
            this.headerAnimating = false;
            this.requestUpdate();
        }, 150);
    }

    startHeaderAnimation() {
        this.animateHeaderText('analyzing screen...');
        
        if (this.headerAnimationTimeout) {
            clearTimeout(this.headerAnimationTimeout);
        }
        
        this.headerAnimationTimeout = setTimeout(() => {
            this.animateHeaderText('thinking...');
        }, 1500);
    }

    simulateStreaming(text) {
        this.isStreaming = true;
        this.streamedResponse = '';
        this.isLoading = true;
        this.accumulatedChunks = '';
        this.lastSafeContent = '';
        let index = 0;
        this.requestUpdate();

        // 스트리밍 컨테이너 초기화
        this.initializeStreamingContainer();

        const streamNext = () => {
            if (index < text.length) {
                if (index === 0) this.isLoading = false;
                
                const chunk = text[index];
                this.streamedResponse += chunk;
                this.accumulatedChunks += chunk;
                
                // 성능과 보안을 고려한 스트리밍 업데이트
                this.updateStreamedContentSafe(chunk);
                
                index++;
                this.streamingTimeout = setTimeout(streamNext, 20);
            } else {
                this.isStreaming = false;
                this.isLoading = false;
                this.currentResponse = text;
                this.headerText = 'AI Response';
                this.updateResponseContent();
                this.requestUpdate();
            }
        };
        
        streamNext();
    }

    // 스트리밍 컨테이너 초기화
    initializeStreamingContainer() {
        const responseContainer = this.shadowRoot?.getElementById('responseContainer');
        if (responseContainer) {
            responseContainer.innerHTML = '';
            this.streamingContainer = responseContainer;
        }
    }

    // 안전한 스트리밍 업데이트 (권장사항 적용)
    updateStreamedContentSafe(chunk) {
        if (!this.streamingContainer) return;

        // 보안 검사: 누적된 청크 전체를 검사
        if (this.isDOMPurifyLoaded && this.DOMPurify) {
            const testContent = this.fixIncompleteCodeBlocks(this.accumulatedChunks);
            const sanitized = this.DOMPurify.sanitize(testContent);
            
            // 위험한 콘텐츠가 감지되면 스트리밍 중지
            if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                console.warn('Unsafe content detected, stopping stream');
                this.isStreaming = false;
                this.streamingContainer.innerHTML = '<div class="response-line">⚠️ Content blocked for security reasons</div>';
                return;
            }
        }

        // 성능 최적화: append() 사용으로 전체 재렌더링 방지
        // 단어가 완성될 때마다 렌더링 (공백, 줄바꿈 등을 기준)
        if (chunk.match(/[\s\n,.!?;:]/) || this.accumulatedChunks.length % 10 === 0) {
            this.renderStreamingChunk();
        }
    }

    // 스트리밍 청크 렌더링 (최적화된 버전)
    renderStreamingChunk() {
        if (!this.streamingContainer) return;

        const processedResponse = this.fixIncompleteCodeBlocks(this.accumulatedChunks);
        
        // 보안 검사된 콘텐츠만 렌더링
        if (this.isDOMPurifyLoaded && this.DOMPurify) {
            const sanitized = this.DOMPurify.sanitize(this.renderMarkdown(processedResponse));
            
            // 전체 콘텐츠를 렌더링하되, 스타일과 구조를 유지
            const tempContainer = document.createElement('div');
            tempContainer.innerHTML = sanitized;
            
            // 기존 내용을 효율적으로 업데이트
            if (this.streamingContainer.innerHTML !== tempContainer.innerHTML) {
                this.streamingContainer.innerHTML = tempContainer.innerHTML;
            }
        } else {
            // DOMPurify가 없을 때는 기본 마크다운 렌더링
            const rendered = this.renderMarkdown(processedResponse);
            if (this.streamingContainer.innerHTML !== rendered) {
                this.streamingContainer.innerHTML = rendered;
            }
        }
        
        this.lastSafeContent = processedResponse;
    }

    updateStreamedContent() {
        // 레거시 메서드 - 새로운 방식으로 리다이렉트
        if (this.isStreaming) {
            this.renderStreamingChunk();
        } else {
            // 스트리밍이 끝났을 때만 전체 렌더링
        const responseContainer = this.shadowRoot?.getElementById('responseContainer');
        if (responseContainer && this.streamedResponse) {
                const processedResponse = this.fixIncompleteCodeBlocks(this.streamedResponse);
                const lines = processedResponse.split('\n');
            responseContainer.innerHTML = lines.map((line, index) => {
                const renderedLine = this.renderMarkdown(line);
                return `
                    <div class="response-line" data-line-index="${index}">
                        ${renderedLine || '&nbsp;'}
                    </div>
                `;
            }).join('');
            }
        }
    }

    handleNewResponse(event, message) {
        this.currentResponse = message;
        this.updateResponseContent();
        this.requestUpdate();
    }

    updateResponseContent() {
        const responseContainer = this.shadowRoot?.getElementById('responseContainer');
        if (responseContainer) {
            if (this.currentResponse) {
                // 최종 응답에서도 코드 블록이 제대로 닫히지 않은 경우 자동 수정
                const processedResponse = this.fixIncompleteCodeBlocks(this.currentResponse);
                
                // 보안 검사 적용
                let safeContent = processedResponse;
                if (this.isDOMPurifyLoaded && this.DOMPurify) {
                    // 각 라인별로 렌더링하기 전에 전체 콘텐츠 보안 검사
                    const fullRendered = this.renderMarkdown(processedResponse);
                    const sanitized = this.DOMPurify.sanitize(fullRendered);
                    
                    // 위험한 콘텐츠가 감지되면 경고 메시지 표시
                    if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                        console.warn('Unsafe content detected in final response');
                        responseContainer.innerHTML = '<div class="response-line">⚠️ Content blocked for security reasons</div>';
                        return;
                    }
                }
                
                const lines = processedResponse.split('\n');
                responseContainer.innerHTML = lines.map((line, index) => {
                    let renderedLine = this.renderMarkdown(line);
                    
                    // 개별 라인도 보안 검사
                    if (this.isDOMPurifyLoaded && this.DOMPurify) {
                        renderedLine = this.DOMPurify.sanitize(renderedLine);
                    }
                    
                    return `
                        <div class="response-line" data-line-index="${index}">
                            <button class="line-copy-button ${this.lineCopyState[index] ? 'copied' : ''}" 
                                    data-line-index="${index}">
                                ${this.lineCopyState[index] 
                                    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>'
                                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
                                }
                            </button>
                            ${renderedLine || '&nbsp;'}
                        </div>
                    `;
                }).join('');

                const copyButtons = responseContainer.querySelectorAll('.line-copy-button');
                copyButtons.forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const lineIndex = parseInt(button.getAttribute('data-line-index'));
                        this.handleLineCopy(lineIndex);
                    });
                });
            } else if (this.isLoading && this.streamedResponse === '') {
                // 로딩 중이고 아직 스트리밍된 내용이 없을 때만 로딩 점 표시
                responseContainer.innerHTML = `
                    <div class="loading-dots">
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                        <div class="loading-dot"></div>
                    </div>
                `;
            } else if (!this.isLoading && !this.isStreaming && !this.currentResponse) {
                responseContainer.innerHTML = '<div class="empty-state">Ask a question to see the response here</div>';
            }
        }
    }

    renderMarkdown(content) {
        if (!content) return '';
        
        // 새로운 마크다운 파싱 사용
        if (this.isLibrariesLoaded && this.marked) {
            return this.parseMarkdown(content);
        }
        
        // 폴백: 기본 마크다운 파싱
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }

    closeResponsePanel() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('force-close-window', 'ask');
        }
    }

    async processAssistantQuestion(question) {
        if (window.pickleGlass && window.pickleGlass.sendMessage) {
            try {
                const result = await window.pickleGlass.sendMessage(question, { hideTextInput: false });
                if (result.success) {
                    // 스트리밍 시뮬레이션
                    this.simulateStreaming(result.response);
                } else {
                    this.isLoading = false;
                    this.currentResponse = result.response || `Error: ${result.error}`;
                    this.headerText = 'AI Response';
                    this.updateResponseContent();
                    this.requestUpdate();
                }
            } catch (error) {
                console.error('Error processing assistant question:', error);
                this.isLoading = false;
                this.currentResponse = `Error: ${error.message}`;
                this.headerText = 'AI Response';
                this.updateResponseContent();
                this.requestUpdate();
            }
        }
    }

    async handleCopy() {
        if (this.copyState === 'copied') return;

        // 원본 텍스트를 복사 (마크다운 형태가 아닌 순수 텍스트)
        let responseToCopy = this.currentResponse;
        
        // 보안 검사: 안전하지 않은 콘텐츠는 복사하지 않음
        if (this.isDOMPurifyLoaded && this.DOMPurify) {
            const testHtml = this.renderMarkdown(responseToCopy);
            const sanitized = this.DOMPurify.sanitize(testHtml);
            
            if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                console.warn('Unsafe content detected, copy blocked');
                return;
            }
        }

        const textToCopy = `Question: ${this.currentQuestion}\n\nAnswer: ${responseToCopy}`;

        try {
            await navigator.clipboard.writeText(textToCopy);
            console.log('Content copied to clipboard');

            this.copyState = 'copied';
            this.requestUpdate();

            if (this.copyTimeout) {
                clearTimeout(this.copyTimeout);
            }

            this.copyTimeout = setTimeout(() => {
                this.copyState = 'idle';
                this.requestUpdate();
            }, 1500);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    async handleLineCopy(lineIndex) {
        // 원본 응답에서 라인 가져오기 (자동 추가된 ``` 제외)
        const originalLines = this.currentResponse.split('\n');
        const lineToCopy = originalLines[lineIndex];

        if (!lineToCopy) return;

        try {
            await navigator.clipboard.writeText(lineToCopy);
            console.log('Line copied to clipboard');

            this.lineCopyState = { ...this.lineCopyState, [lineIndex]: true };
            this.updateResponseContent();

            if (this.lineCopyTimeouts[lineIndex]) {
                clearTimeout(this.lineCopyTimeouts[lineIndex]);
            }

            this.lineCopyTimeouts[lineIndex] = setTimeout(() => {
                const newState = { ...this.lineCopyState };
                delete newState[lineIndex];
                this.lineCopyState = newState;
                this.updateResponseContent();
            }, 1500);
        } catch (err) {
            console.error('Failed to copy line:', err);
        }
    }

    async handleSendText() {
        const textInput = this.shadowRoot?.getElementById('textInput');
        if (!textInput) return;
    
        const text = textInput.value.trim();
        if (!text) return;
    
        textInput.value = '';
        
        this.currentQuestion = text;
        this.lineCopyState = {};
        
        // 텍스트 입력창 숨기기
        this.showTextInput = false;
        this.requestUpdate();
        
        // 헤더 애니메이션 시작
        this.startHeaderAnimation();
        
        if (window.pickleGlass && window.pickleGlass.sendMessage) {
            this.isLoading = true;
            this.requestUpdate();
            
            try {
                const result = await window.pickleGlass.sendMessage(text);
                if (result.success) {
                    // 스트리밍 시뮬레이션
                    this.simulateStreaming(result.response);
                } else {
                    this.isLoading = false;
                    this.currentResponse = result.response || `Error: ${result.error}`;
                    this.headerText = 'AI Response';
                    this.updateResponseContent();
                    this.requestUpdate();
                }
            } catch (error) {
                console.error('Error sending text:', error);
                this.isLoading = false;
                this.currentResponse = `Error: ${error.message}`;
                this.headerText = 'AI Response';
                this.updateResponseContent();
                this.requestUpdate();
            }
        } else {
            console.error('sendMessage function not available');
            this.isLoading = false;
            this.requestUpdate();
        }
    }

    handleTextKeydown(e) {
        const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey;
        const isModifierEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey);

        if (isPlainEnter || isModifierEnter) {
            e.preventDefault();
            this.handleSendText();
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('currentResponse') || 
            changedProperties.has('streamedResponse') ||
            changedProperties.has('isLibrariesLoaded')) {
            this.updateResponseContent();
        }
    }

    handleGlobalSendRequest() {
        const textInput = this.shadowRoot?.getElementById('textInput');
        if (!textInput) return;

        textInput.focus();

        if (!textInput.value.trim()) return;

        this.handleSendText();
    }

    getTruncatedQuestion(question, maxLength = 30) {
        if (!question) return '';
        if (question.length <= maxLength) return question;
        return question.substring(0, maxLength) + '...';
    }

    render() {
        const hasResponse = this.isLoading || this.currentResponse || this.isStreaming;

        return html`
            <div class="ask-container">
                <!-- Response Header -->
                <div class="response-header ${!hasResponse ? 'hidden' : ''}">
                    <div class="header-left">
                        <div class="response-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                                <path d="M8 12l2 2 4-4"/>
                            </svg>
                        </div>
                        <span class="response-label ${this.headerAnimating ? 'animating' : ''}">${this.headerText}</span>
                    </div>
                    <div class="header-right">
                        <span class="question-text">${this.getTruncatedQuestion(this.currentQuestion)}</span>
                        <div class="header-controls">
                            <button
                                class="copy-button ${this.copyState === 'copied' ? 'copied' : ''}"
                                @click=${this.handleCopy}
                            >
                                <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                </svg>
                                <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                     <path d="M20 6L9 17l-5-5"/>
                                </svg>
                            </button>
                            <button class="close-button" @click=${this.closeResponsePanel}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Response Container -->
                <div class="response-container ${!hasResponse ? 'hidden' : ''}" id="responseContainer">
                    <!-- 내용은 updateResponseContent()에서 동적으로 생성 -->
                </div>

                <!-- Text Input Container -->
                <div class="text-input-container ${!hasResponse ? 'no-response' : ''} ${!this.showTextInput ? 'hidden' : ''}">
                    <input type="text" id="textInput" placeholder="Ask about your screen or audio" @keydown=${this.handleTextKeydown} />
                </div>
            </div>
        `;
    }
}

customElements.define('ask-view', AskView);