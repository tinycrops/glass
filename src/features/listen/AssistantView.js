import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            display: block;
            width: 400px; /* 고정 가로 크기 */
            /* 높이는 내용에 맞게 자동 조절 */
        }

        * {
            font-family: 'Helvetica Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            cursor: default;
            user-select: none;
        }

        /* highlight.js 스타일 추가 */
        .insights-container pre {
            background: rgba(0, 0, 0, 0.4) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            margin: 8px 0 !important;
            overflow-x: auto !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }

        .insights-container code {
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace !important;
            font-size: 11px !important;
            background: transparent !important;
        }

        .insights-container p code {
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

        .assistant-container {
            display: flex;
            flex-direction: column;
            color: #ffffff;
            box-sizing: border-box;
            position: relative;
            background: rgba(0, 0, 0, 0.6);
            overflow: hidden;
            border-radius: 12px;
            /* outline: 0.5px rgba(255, 255, 255, 0.5) solid; */
            /* outline-offset: -1px; */
            width: 100%;
            min-height: 200px;
        }

        .assistant-container::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            border-radius: 12px; /* Match parent */
            padding: 1px;
            background: linear-gradient(169deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0) 50%, rgba(255, 255, 255, 0.5) 100%); 
            -webkit-mask:
                linear-gradient(#fff 0 0) content-box,
                linear-gradient(#fff 0 0);
            -webkit-mask-composite: destination-out;
            mask-composite: exclude;
            pointer-events: none;
        }

        .assistant-container::before {
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
            z-index: -1;
        }

        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 16px;
            min-height: 32px;
            position: relative;
            z-index: 1;
            width: 100%;
            box-sizing: border-box;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .bar-left-text {
            color: white;
            font-size: 13px;
            font-family: 'Helvetica Neue', sans-serif;
            font-weight: 500;
            position: relative;
            overflow: hidden;
            white-space: nowrap;
            flex: 1;
            min-width: 0;
            max-width: 200px;
        }

        .bar-left-text-content {
            display: inline-block;
            transition: transform 0.3s ease;
        }

        .bar-left-text-content.slide-in {
            animation: slideIn 0.3s ease forwards;
        }

        @keyframes slideIn {
            from {
                transform: translateX(10%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .bar-controls {
            display: flex;
            gap: 4px;
            align-items: center;
            flex-shrink: 0;
            width: 120px; /* 고정 너비로 버튼 위치 안정화 */
            justify-content: flex-end; /* 오른쪽 정렬 */
            box-sizing: border-box;
            padding: 4px;
        }

        .toggle-button {
            display: flex;
            align-items: center;
            gap: 5px;
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            box-shadow: none;
            padding: 4px 8px;
            border-radius: 5px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            height: 24px;
            white-space: nowrap;
            transition: background-color 0.15s ease;
            justify-content: center; /* 내부 콘텐츠 중앙 정렬 */
        }

        .toggle-button:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .toggle-button svg {
            flex-shrink: 0;
            width: 12px;
            height: 12px;
        }

        .copy-button {
            background: transparent;
            color: rgba(255, 255, 255, 0.9);
            border: none;
            outline: none;
            box-shadow: none;
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
            position: relative; /* For icon positioning */
            overflow: hidden; /* Hide overflowing parts of icons during animation */
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

        /* 전사(Transcription) 컨테이너 - 직접적인 구조 */
        .transcription-container {
            overflow-y: auto;
            padding: 12px 12px 16px 12px; /* 하단 패딩 조정 */
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 150px; /* 최소 높이 설정 */
            max-height: 600px; /* 최대 높이 여유 확보 */
            position: relative;
            z-index: 1;
            flex: 1; /* 남은 공간 모두 사용 */
        }

        .transcription-container.hidden {
            display: none;
        }

        .transcription-container::-webkit-scrollbar {
            width: 8px; /* 스크롤바 너비 증가 */
        }
        .transcription-container::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1); /* 트랙 배경 추가 */
            border-radius: 4px;
        }
        .transcription-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3); /* 더 뚜렷한 색상 */
            border-radius: 4px;
        }
        .transcription-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5); /* 호버 시 더 밝게 */
        }

        /* 채팅 말풍선 스타일 - 잘림 문제 해결 */
        .stt-message {
            padding: 8px 12px;
            border-radius: 12px;
            max-width: 80%; /* 여유 공간 확보 */
            word-wrap: break-word;
            word-break: break-word; /* 긴 단어도 강제 줄바꿈 */
            line-height: 1.5; /* 줄 간격을 조금 더 줍니다 */
            font-size: 13px; /* 11px에서 13px로 키웁니다 (원하는 크기로 조절) */
            margin-bottom: 4px;
            box-sizing: border-box;
        }
        
        .stt-message.them {
            background: rgba(255, 255, 255, 0.1);
            color: rgba(255, 255, 255, 0.9);
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            margin-right: auto; /* 왼쪽 정렬 확실히 */
        }
        
        .stt-message.me {
            background: rgba(0, 122, 255, 0.8);
            color: white;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            margin-left: auto; /* 오른쪽 정렬 확실히 */
        }

        /* Insights 컨테이너 스타일 - 직접적인 구조 */
        .insights-container {
            overflow-y: auto;
            padding: 12px 12px 16px 12px; /* 하단 패딩 조정 */
            position: relative;
            z-index: 1;
            min-height: 150px; /* 최소 높이 설정 */
            max-height: 600px; /* 최대 높이 여유 확보 */
            flex: 1; /* 남은 공간 모두 사용 */
        }

        .insights-container.hidden {
            display: none;
        }

        .insights-container::-webkit-scrollbar {
            width: 8px; /* 스크롤바 너비 증가 */
        }
        .insights-container::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1); /* 트랙 배경 추가 */
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.3); /* 더 뚜렷한 색상 */
            border-radius: 4px;
        }
        .insights-container::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.5); /* 호버 시 더 밝게 */
        }

        .insights-container h4 {
            color: #ffffff;
            font-size: 12px;
            font-weight: 600;
            margin: 12px 0 8px 0;
            padding: 4px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default; /* 클릭 불가로 변경 */
            /* transition 제거 */
        }

        .insights-container h4:hover {
            background: transparent; /* hover 효과 제거 */
        }

        .insights-container h4:first-child {
            margin-top: 0;
        }

        .outline-item {
            color: #ffffff;
            font-size: 11px;
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            transition: background-color 0.15s ease;
            cursor: pointer;
            word-wrap: break-word;
        }

        .outline-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .request-item {
            color: #ffffff;
            font-size: 11px;
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: default;
            word-wrap: break-word;
            transition: background-color 0.15s ease;
        }

        .request-item.clickable {
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .request-item.clickable:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        /* 마크다운 렌더링된 콘텐츠 스타일 */
        .markdown-content {
            color: #ffffff;
            font-size: 11px;
            line-height: 1.4;
            margin: 4px 0;
            padding: 6px 8px;
            border-radius: 4px;
            background: transparent;
            cursor: pointer;
            word-wrap: break-word;
            transition: all 0.15s ease;
        }

        .markdown-content:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: translateX(2px);
        }

        .markdown-content p {
            margin: 4px 0;
        }

        .markdown-content ul, .markdown-content ol {
            margin: 4px 0;
            padding-left: 16px;
        }

        .markdown-content li {
            margin: 2px 0;
        }

        .markdown-content a {
            color: #8be9fd;
            text-decoration: none;
        }

        .markdown-content a:hover {
            text-decoration: underline;
        }

        .markdown-content strong {
            font-weight: 600;
            color: #f8f8f2;
        }

        .markdown-content em {
            font-style: italic;
            color: #f1fa8c;
        }

        /* 타이머 스타일 */
        .timer {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 10px;
            color: rgba(255, 255, 255, 0.7);
        }
    `;

    static properties = {
        structuredData: { type: Object },
        // outlines: { type: Array },
        // analysisRequests: { type: Array },
        sttMessages: { type: Array },
        viewMode: { type: String },
        isHovering: { type: Boolean },
        isAnimating: { type: Boolean },
        copyState: { type: String },
        elapsedTime: { type: String },
        captureStartTime: { type: Number },
        isSessionActive: { type: Boolean },
        hasCompletedRecording: { type: Boolean },
    };

    constructor() {
        super();
        // this.outlines = [];
        // this.analysisRequests = [];
        this.structuredData = {
            summary: [],
            topic: { header: '', bullets: [] },
            actions: [],
            followUps: []
        };
        this.isSessionActive = false;
        this.hasCompletedRecording = false;
        this.sttMessages = [];
        this.viewMode = 'insights';
        this.isHovering = false;
        this.isAnimating = false;
        this.elapsedTime = '00:00';
        this.captureStartTime = null;
        this.timerInterval = null;
        this.resizeObserver = null;
        this.adjustHeightThrottle = null;
        this.isThrottled = false; 
        this._shouldScrollAfterUpdate = false;
        this.messageIdCounter = 0;
        this.copyState = 'idle';
        this.copyTimeout = null;

        // 마크다운 라이브러리 초기화
        this.marked = null;
        this.hljs = null;
        this.isLibrariesLoaded = false;
        this.DOMPurify = null;
        this.isDOMPurifyLoaded = false;

        // --- Debug Utilities ---
        this._debug = {
            enabled: false, // Set to false to disable debug messages
            interval: null,
            counter: 1,
        };
        // --- End Debug Utilities ---

        // 핸들러 바인딩
        this.handleSttUpdate = this.handleSttUpdate.bind(this);
        this.adjustWindowHeight = this.adjustWindowHeight.bind(this);
        
        // 라이브러리 로드
        this.loadLibraries();
    }

    // --- Debug Utilities ---
    _startDebugStream() {
        if (!this._debug.enabled) return;

        this._debug.interval = setInterval(() => {
            const speaker = this._debug.counter % 2 === 0 ? 'You' : 'Other Person';
            const text = `이것은 ${this._debug.counter}번째 자동 생성 메시지입니다. UI가 자동으로 조절되는지 확인합니다.`;

            this._debug.counter++;

            this.handleSttUpdate(null, { speaker, text, isFinal: true });
        }, 1000);
    }

    _stopDebugStream() {
        if (this._debug.interval) {
            clearInterval(this._debug.interval);
        }
    }
    // --- End Debug Utilities ---

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
                console.log('Markdown libraries loaded successfully');
            }

            if (this.DOMPurify) {
                this.isDOMPurifyLoaded = true;
                console.log('DOMPurify loaded successfully in AssistantView');
            }
        } catch (error) {
            console.error('Failed to load libraries:', error);
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
            console.error('Markdown parsing error:', error);
            return text; // 파싱 실패 시 원본 텍스트 반환
        }
    }

    // 마크다운 콘텐츠 클릭 핸들러
    handleMarkdownClick(originalText) {
        // 원본 텍스트를 전달하여 처리
        this.handleRequestClick(originalText);
    }

    // 마크다운 콘텐츠 렌더링 메서드 (보안 강화)
    renderMarkdownContent() {
        // 라이브러리가 로드되지 않았으면 렌더링하지 않음
        if (!this.isLibrariesLoaded || !this.marked) {
            return;
        }

        const markdownElements = this.shadowRoot.querySelectorAll('[data-markdown-id]');
        markdownElements.forEach(element => {
            const originalText = element.getAttribute('data-original-text');
            if (originalText) {
                try {
                    let parsedHTML = this.parseMarkdown(originalText);
                    
                    // 보안 검사 적용
                    if (this.isDOMPurifyLoaded && this.DOMPurify) {
                        parsedHTML = this.DOMPurify.sanitize(parsedHTML);
                        
                        // 위험한 콘텐츠가 감지되면 원본 텍스트로 표시
                        if (this.DOMPurify.removed && this.DOMPurify.removed.length > 0) {
                            console.warn('Unsafe content detected in insights, showing plain text');
                            element.textContent = '⚠️ ' + originalText;
                            return;
                        }
                    }
                    
                    element.innerHTML = parsedHTML;
                } catch (error) {
                    console.error('Error rendering markdown for element:', error);
                    element.textContent = originalText; // 에러 시 원본 텍스트로 폴백
                }
            }
        });
    }

    // 타이머 관련 메서드
    startTimer() {
        this.captureStartTime = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.captureStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60)
                .toString()
                .padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            this.elapsedTime = `${minutes}:${seconds}`;
            this.requestUpdate();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    // 창 높이 자동 조절
    adjustWindowHeight() {
        if (!window.require) return;
        
        // DOM 업데이트 완료를 보장하는 올바른 방법
        this.updateComplete.then(() => {
            const topBar = this.shadowRoot.querySelector('.top-bar');
            const activeContent = this.viewMode === 'transcript' 
                ? this.shadowRoot.querySelector('.transcription-container')
                : this.shadowRoot.querySelector('.insights-container');
            
            if (!topBar || !activeContent) return;
            
            const topBarHeight = topBar.offsetHeight;
            
            // ✨ [수정] 콘텐츠 영역의 실제 필요 높이를 scrollHeight로 더 정확하게 측정
            // scrollHeight는 패딩과 내부 요소 크기를 모두 포함한 값입니다.
            const contentHeight = activeContent.scrollHeight;
            
            // ✨ [수정] 총 필요 높이 계산식 변경
            // 상단 바 높이 + 콘텐츠 스크롤 높이 + 추가적인 여유 공간
            const idealHeight = topBarHeight + contentHeight + 20; // 여유 공간 20px 추가

            // 최대/최소 높이 제한은 유지
            const targetHeight = Math.min(700, Math.max(200, idealHeight)); 
            
            console.log(`[Height Adjusted] Mode: ${this.viewMode}, TopBar: ${topBarHeight}px, Content: ${contentHeight}px, Ideal: ${idealHeight}px, Target: ${targetHeight}px`);
            
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('adjust-window-height', targetHeight);
            
        }).catch(error => {
            console.error('Error in adjustWindowHeight:', error);
        });
    }

    // 뷰 모드 토글
    toggleViewMode() {
        this.viewMode = this.viewMode === 'insights' ? 'transcript' : 'insights';
        this.requestUpdate();
    }

    // 복사 버튼 호버 처리
    handleCopyHover(isHovering) {
        this.isHovering = isHovering;
        if (isHovering) {
            this.isAnimating = true;
        } else {
            this.isAnimating = false;
        }
        this.requestUpdate();
    }

    // 새로운 메서드 추가: outline 데이터 파싱
    parseOutlineData() {
        const result = {
            currentSummary: [],
            mainTopicHeading: '',
            mainTopicBullets: []
        };
        
        if (!this.outlines || this.outlines.length === 0) {
            return result;
        }
        
        // BULLET:: 타입 중 첫 번째를 Current Summary로 사용
        const allBullets = this.outlines.filter(item => item.startsWith('BULLET::'));
        if (allBullets.length > 0) {
            result.currentSummary.push(allBullets[0].replace('BULLET::', '').trim());
        }
        
        // HEADING:: 타입 찾기
        const heading = this.outlines.find(item => item.startsWith('HEADING::'));
        if (heading) {
            result.mainTopicHeading = heading.replace('HEADING::', '').trim();
        }
        
        // 나머지 BULLET:: 항목들을 Main Topic bullets로 사용
        if (allBullets.length > 1) {
            result.mainTopicBullets = allBullets
                .slice(1)
                .map(item => item.replace('BULLET::', '').trim());
        }
        
        return result;
    }

    // 복사 기능
    async handleCopy() {
        if (this.copyState === 'copied') return; // Prevent multiple clicks

        let textToCopy = '';

        if (this.viewMode === 'transcript') {
            textToCopy = this.sttMessages.map(msg => `${msg.speaker}: ${msg.text}`).join('\n');
        } else {
            // structuredData를 사용하여 복사할 텍스트 생성
            const data = this.structuredData || { summary: [], topic: { header: '', bullets: [] }, actions: [] };
            let sections = [];
            
            if (data.summary && data.summary.length > 0) {
                sections.push(`Current Summary:\n${data.summary.map(s => `• ${s}`).join('\n')}`);
            }
            
            if (data.topic && data.topic.header && data.topic.bullets.length > 0) {
                sections.push(`\n${data.topic.header}:\n${data.topic.bullets.map(b => `• ${b}`).join('\n')}`);
            }
            
            if (data.actions && data.actions.length > 0) {
                sections.push(`\nActions:\n${data.actions.map(a => `▸ ${a}`).join('\n')}`);
            }

            if (data.followUps && data.followUps.length > 0) {
                sections.push(`\nFollow-Ups:\n${data.followUps.map(f => `▸ ${f}`).join('\n')}`);
            }
            
            textToCopy = sections.join('\n\n').trim();
        }

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
            }, 1500); // 1.5초 후 원래 아이콘으로 복귀
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }

    // Throttled 높이 조절 (STT 업데이트용)
    adjustWindowHeightThrottled() {
        // 1. 쿨타임(isThrottled가 true) 중이면 아무것도 하지 않고 즉시 종료합니다.
        if (this.isThrottled) {
            return;
        }

        // 2. 쿨타임이 아니라면, 즉시 창 높이 조절을 실행합니다.
        this.adjustWindowHeight();

        // 3. 실행 직후, 쿨타임 상태로 만듭니다.
        this.isThrottled = true;

        // 4. 16ms의 쿨타임 타이머를 설정합니다.
        this.adjustHeightThrottle = setTimeout(() => {
            // 16ms가 지나면 쿨타임을 해제하여 다음 요청을 받을 준비를 합니다.
            this.isThrottled = false;
        }, 16);
    }

    // STT 업데이트를 처리하는 핸들러
    handleSttUpdate(event, { speaker, text, isFinal, isPartial }) {
        if (text === undefined) return;

        const container = this.shadowRoot.querySelector('.transcription-container');
        this._shouldScrollAfterUpdate = container ? (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) : false;

        const lastMessage = this.sttMessages.length > 0 ? this.sttMessages[this.sttMessages.length - 1] : null;

        // 마지막 메시지가 있고, 같은 화자이며, 아직 진행 중(partial)이라면 내용을 교체
        if (lastMessage && lastMessage.speaker === speaker && lastMessage.isPartial) {
            const updatedMessage = { ...lastMessage, text: text, isFinal: isFinal, isPartial: isPartial };
            this.sttMessages = [...this.sttMessages.slice(0, -1), updatedMessage];
        } else {
            // 그 외의 경우 (첫 메시지, 다른 화자, 이전 메시지 완료 등) 새 말풍선을 추가
            this.sttMessages = [...this.sttMessages, { 
                id: this.messageIdCounter++, 
                speaker, 
                text, 
                isFinal,
                isPartial
            }];
        }
    }

    // scrollToTranscriptionBottom 메서드는 수정할 필요 없습니다.
    scrollToTranscriptionBottom() {
        setTimeout(() => {
            const container = this.shadowRoot.querySelector('.transcription-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 0);
    }

    async handleRequestClick(requestText) {
        console.log('🔥 Analysis request clicked:', requestText);
        
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            
            try {
                // 1. AskView 열기
                const isAskViewVisible = await ipcRenderer.invoke('is-window-visible', 'ask');
                
                if (!isAskViewVisible) {
                    await ipcRenderer.invoke('toggle-feature', 'ask');
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                // 2. 질문을 AskView에 직접 전달 (AskView가 처리)
                const result = await ipcRenderer.invoke('send-question-to-ask', requestText);
                
                if (result.success) {
                    console.log('✅ Question sent to AskView successfully');
                } else {
                    console.error('❌ Failed to send question to AskView:', result.error);
                }
            } catch (error) {
                console.error('❌ Error in handleRequestClick:', error);
            }
        }
    }

    // IPC 리스너 설정
    connectedCallback() {
        super.connectedCallback();
        this.startTimer(); // 타이머 시작
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('stt-update', this.handleSttUpdate);
            ipcRenderer.on('session-state-changed', (event, { isActive }) => {
                const wasActive = this.isSessionActive;
                this.isSessionActive = isActive;
                
                // 녹음이 시작되면 완료 상태 초기화
                if (!wasActive && isActive) {
                    this.hasCompletedRecording = false;
                }
                
                // 녹음이 중지되면 완료 상태로 변경하고 follow-ups 추가
                if (wasActive && !isActive) {
                    this.hasCompletedRecording = true;
                    
                    this.requestUpdate();
                }
            });
        }
        this._startDebugStream();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.stopTimer(); // 타이머 정지
        
        // Throttle 정리
        if (this.adjustHeightThrottle) {
            clearTimeout(this.adjustHeightThrottle);
            this.adjustHeightThrottle = null;
        }
        if (this.copyTimeout) {
            clearTimeout(this.copyTimeout);
        }
        
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.removeListener('stt-update', this.handleSttUpdate);
        }

        this._stopDebugStream();
    }

    firstUpdated() {
        super.firstUpdated();
        
        // 초기 로드 시 한 번만 높이 조절
        setTimeout(() => this.adjustWindowHeight(), 200);
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // 마크다운 콘텐츠 렌더링
        this.renderMarkdownContent();

        // 1. sttMessages 속성이 변경되었을 때만 아래 로직을 실행합니다.
        if (changedProperties.has('sttMessages')) {
            // 2. handleSttUpdate에서 저장해 둔 플래그를 확인합니다.
            if (this._shouldScrollAfterUpdate) {
                this.scrollToTranscriptionBottom();
                // 플래그를 다시 false로 리셋하여 다음 업데이트에 영향이 없도록 합니다.
                this._shouldScrollAfterUpdate = false; 
            }
            // 3. 메시지 변경에 따른 높이 조절을 실행합니다.
            this.adjustWindowHeightThrottled();
        }
        
        // 뷰 모드 변경 시에만 즉시 높이 조절 (가장 중요한 변경사항)
        if (changedProperties.has('viewMode')) {
            this.adjustWindowHeight();
        }
        // 다른 속성 변경 시에는 throttled 방식으로 높이 조절
        else if (changedProperties.has('outlines') || 
                 changedProperties.has('analysisRequests') ||
                 changedProperties.has('structuredData')) {
            this.adjustWindowHeightThrottled();
        }
    }

    render() {
        const displayText = this.isHovering
            ? this.viewMode === 'transcript'
                ? 'Copy Transcript'
                : 'Copy Glass Analysis'
            : this.viewMode === 'insights'
            ? `Live insights`
            : `Glass is Listening ${this.elapsedTime}`;
    
        // structuredData가 없거나 비어있을 때 기본값 설정
        const data = this.structuredData || {
            summary: [],
            topic: { header: '', bullets: [] },
            actions: []
        };

        const getSpeakerClass = (speaker) => {
            // 'Me'를 사용자(me)로 간주하고, 나머지는 상대방(them)으로 처리
            return speaker.toLowerCase() === 'me' ? 'me' : 'them';
        };
    
        return html`
            <div class="assistant-container">
                <div class="top-bar">
                    <div class="bar-left-text">
                        <span class="bar-left-text-content ${this.isAnimating ? 'slide-in' : ''}">${displayText}</span>
                    </div>
                    <div class="bar-controls">
                        <button class="toggle-button" @click=${this.toggleViewMode}>
                            ${this.viewMode === 'insights'
                                ? html`
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                                          <circle cx="12" cy="12" r="3" />
                                      </svg>
                                      <span>Show Transcript</span>
                                  `
                                : html`
                                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                          <path d="M9 11l3 3L22 4" />
                                          <path d="M22 12v7a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                                      </svg>
                                      <span>Show Insights</span>
                                  `}
                        </button>
                        <button
                            class="copy-button ${this.copyState === 'copied' ? 'copied' : ''}"
                            @click=${this.handleCopy}
                            @mouseenter=${() => this.handleCopyHover(true)}
                            @mouseleave=${() => this.handleCopyHover(false)}
                        >
                            <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                            </svg>
                            <svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                 <path d="M20 6L9 17l-5-5"/>
                            </svg>
                        </button>
                    </div>
                </div>
    
                <div class="transcription-container ${this.viewMode !== 'transcript' ? 'hidden' : ''}">
                    ${this.sttMessages.map(msg => html` <div class="stt-message ${getSpeakerClass(msg.speaker)}">${msg.text}</div> `)}
                </div>
    
               <div class="insights-container ${this.viewMode !== 'insights' ? 'hidden' : ''}">
                <h4>Current Summary</h4>
                ${data.summary.length > 0 ? 
                    data.summary.slice(0, 5).map((bullet, index) => html`
                        <div
                            class="markdown-content"
                            data-markdown-id="summary-${index}"
                            data-original-text="${bullet}"
                            @click=${() => this.handleMarkdownClick(bullet)}
                        >
                            ${bullet}
                        </div>
                    `) : html`
                        <div class="request-item">
                            No content yet...
                        </div>
                    `
                }
                
                ${data.topic.header ? html`
                    <h4>${data.topic.header}</h4>
                    ${data.topic.bullets.slice(0, 3).map((bullet, index) => html`
                        <div
                            class="markdown-content"
                            data-markdown-id="topic-${index}"
                            data-original-text="${bullet}"
                            @click=${() => this.handleMarkdownClick(bullet)}
                        >
                            ${bullet}
                        </div>
                    `)}
                ` : ''}
                
                ${data.actions.length > 0 ? html`
                    <h4>Actions</h4>
                    ${data.actions.slice(0, 5).map((action, index) => html`
                        <div
                            class="markdown-content"
                            data-markdown-id="action-${index}"
                            data-original-text="${action}"
                            @click=${() => this.handleMarkdownClick(action)}
                        >
                            ${action}
                        </div>
                    `)}
                ` : ''}

                ${this.hasCompletedRecording && data.followUps && data.followUps.length > 0 ? html`
                    <h4>Follow-Ups</h4>
                    ${data.followUps.map((followUp, index) => html`
                        <div
                            class="markdown-content"
                            data-markdown-id="followup-${index}"
                            data-original-text="${followUp}"
                            @click=${() => this.handleMarkdownClick(followUp)}
                        >
                            ${followUp}
                        </div>
                    `)}
                ` : ''}
            </div>
        </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
