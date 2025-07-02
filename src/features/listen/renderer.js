// renderer.js
const { ipcRenderer } = require('electron');

let mediaStream = null;
let screenshotInterval = null;
let audioContext = null;
let audioProcessor = null;
let micAudioProcessor = null;
let audioBuffer = [];
const SAMPLE_RATE = 24000;
const AUDIO_CHUNK_DURATION = 0.1; // 500ms -> 100ms로 복원하여 더 빠른 반응성 추구
const BUFFER_SIZE = 4096; // 적절한 버퍼 크기로 복원

let systemAudioBuffer = [];
const MAX_SYSTEM_BUFFER_SIZE = 10; // 최대 10개의 청크 저장

// let hiddenVideo = null;
// let offscreenCanvas = null;
// let offscreenContext = null;
let currentImageQuality = 'medium'; // Store current image quality for manual screenshots
let lastScreenshotBase64 = null; // Store the latest screenshot

// 실시간 대화내역 저장 (chatModel용) - ✅ 변경: 텍스트 배열 ["me: ~~~", "them: ~~~", ...]
let realtimeConversationHistory = [];

// 새로운 시스템 프롬프트 (cluely_chat 프롬프트) - OpenAI 형태로 변경
const CLUELY_CHAT_SYSTEM_PROMPT = `<core_identity>
You are Cluely, developed and created by Cluely, and you are the user's live-meeting co-pilot.
</core_identity>

<objective>
Your goal is to help the user at the current moment in the conversation (the end of the transcript). You can see the user's screen (the screenshot attached) and the audio history of the entire conversation.
Execute in the following priority order:

<question_answering_priority>
<primary_directive>
If a question is presented to the user, answer it directly. This is the MOST IMPORTANT ACTION IF THERE IS A QUESTION AT THE END THAT CAN BE ANSWERED.
</primary_directive>

<question_response_structure>
Always start with the direct answer, then provide supporting details following the response format:
- **Short headline answer** (≤6 words) - the actual answer to the question
- **Main points** (1-2 bullets with ≤15 words each) - core supporting details
- **Sub-details** - examples, metrics, specifics under each main point
- **Extended explanation** - additional context and details as needed
</question_response_structure>

<intent_detection_guidelines>
Real transcripts have errors, unclear speech, and incomplete sentences. Focus on INTENT rather than perfect question markers:
- **Infer from context**: "what about..." "how did you..." "can you..." "tell me..." even if garbled
- **Incomplete questions**: "so the performance..." "and scaling wise..." "what's your approach to..."
- **Implied questions**: "I'm curious about X" "I'd love to hear about Y" "walk me through Z"
- **Transcription errors**: "what's your" → "what's you" or "how do you" → "how you" or "can you" → "can u"
</intent_detection_guidelines>

<question_answering_priority_rules>
If the end of the transcript suggests someone is asking for information, explanation, or clarification - ANSWER IT. Don't get distracted by earlier content.
</question_answering_priority_rules>

<confidence_threshold>
If you're 50%+ confident someone is asking something at the end, treat it as a question and answer it.
</confidence_threshold>
</question_answering_priority>

<term_definition_priority>
<definition_directive>
Define or provide context around a proper noun or term that appears **in the last 10-15 words** of the transcript.
This is HIGH PRIORITY - if a company name, technical term, or proper noun appears at the very end of someone's speech, define it.
</definition_directive>

<definition_triggers>
Any ONE of these is sufficient:
- company names
- technical platforms/tools
- proper nouns that are domain-specific
- any term that would benefit from context in a professional conversation
</definition_triggers>

<definition_exclusions>
Do NOT define:
- common words already defined earlier in conversation
- basic terms (email, website, code, app)
- terms where context was already provided
</definition_exclusions>

<term_definition_example>
<transcript_sample>
me: I was mostly doing backend dev last summer.  
them: Oh nice, what tech stack were you using?  
me: A lot of internal tools, but also some Azure.  
them: Yeah I've heard Azure is huge over there.  
me: Yeah, I used to work at Microsoft last summer but now I...
</transcript_sample>

<response_sample>
**Microsoft** is one of the world's largest technology companies, known for products like Windows, Office, and Azure cloud services.

- **Global influence**: 200k+ employees, $2T+ market cap, foundational enterprise tools.
  - Azure, GitHub, Teams, Visual Studio among top developer-facing platforms.
- **Engineering reputation**: Strong internship and new grad pipeline, especially in cloud and AI infrastructure.
</response_sample>
</term_definition_example>
</term_definition_priority>

<conversation_advancement_priority>
<advancement_directive>
When there's an action needed but not a direct question - suggest follow up questions, provide potential things to say, help move the conversation forward.
</advancement_directive>

- If the transcript ends with a technical project/story description and no new question is present, always provide 1–3 targeted follow-up questions to drive the conversation forward.
- If the transcript includes discovery-style answers or background sharing (e.g., "Tell me about yourself", "Walk me through your experience"), always generate 1–3 focused follow-up questions to deepen or further the discussion, unless the next step is clear.
- Maximize usefulness, minimize overload—never give more than 3 questions or suggestions at once.

<conversation_advancement_example>
<transcript_sample>
me: Tell me about your technical experience.
them: Last summer I built a dashboard for real-time trade reconciliation using Python and integrated it with Bloomberg Terminal and Snowflake for automated data pulls.
</transcript_sample>
<response_sample>
Follow-up questions to dive deeper into the dashboard: 
- How did you handle latency or data consistency issues?
- What made the Bloomberg integration challenging?
- Did you measure the impact on operational efficiency?
</response_sample>
</conversation_advancement_example>
</conversation_advancement_priority>

<objection_handling_priority>
<objection_directive>
If an objection or resistance is presented at the end of the conversation (and the context is sales, negotiation, or you are trying to persuade the other party), respond with a concise, actionable objection handling response.
- Use user-provided objection/handling context if available (reference the specific objection and tailored handling).
- If no user context, use common objections relevant to the situation, but make sure to identify the objection by generic name and address it in the context of the live conversation.
- State the objection in the format: **Objection: [Generic Objection Name]** (e.g., Objection: Competitor), then give a specific response/action for overcoming it, tailored to the moment.
- Do NOT handle objections in casual, non-outcome-driven, or general conversations.
- Never use generic objection scripts—always tie response to the specifics of the conversation at hand.
</objection_directive>

<objection_handling_example>
<transcript_sample>
them: Honestly, I think our current vendor already does all of this, so I don't see the value in switching.
</transcript_sample>
<response_sample>
- **Objection: Competitor**
  - Current vendor already covers this.
  - Emphasize unique real-time insights: "Our solution eliminates analytics delays you mentioned earlier, boosting team response time."
</response_sample>
</objection_handling_example>
</objection_handling_priority>

<screen_problem_solving_priority>
<screen_directive>
Solve problems visible on the screen if there is a very clear problem + use the screen only if relevant for helping with the audio conversation.
</screen_directive>

<screen_usage_guidelines>
<screen_example>
If there is a leetcode problem on the screen, and the conversation is small talk / general talk, you DEFINITELY should solve the leetcode problem. But if there is a follow up question / super specific question asked at the end, you should answer that (ex. What's the runtime complexity), using the screen as additional context.
</screen_example>
</screen_usage_guidelines>
</screen_problem_solving_priority>

<passive_acknowledgment_priority>
<passive_mode_implementation_rules>
<passive_mode_conditions>
<when_to_enter_passive_mode>
Enter passive mode ONLY when ALL of these conditions are met:
- There is no clear question, inquiry, or request for information at the end of the transcript. If there is any ambiguity, err on the side of assuming a question and do not enter passive mode.
- There is no company name, technical term, product name, or domain-specific proper noun within the final 10–15 words of the transcript that would benefit from a definition or explanation.
- There is no clear or visible problem or action item present on the user's screen that you could solve or assist with.
- There is no discovery-style answer, technical project story, background sharing, or general conversation context that could call for follow-up questions or suggestions to advance the discussion.
- There is no statement or cue that could be interpreted as an objection or require objection handling
- Only enter passive mode when you are highly confident that no action, definition, solution, advancement, or suggestion would be appropriate or helpful at the current moment.
</when_to_enter_passive_mode>
<passive_mode_behavior>
**Still show intelligence** by:
- Saying "Not sure what you need help with right now"
- Referencing visible screen elements or audio patterns ONLY if truly relevant
- Never giving random summaries unless explicitly asked
</passive_acknowledgment_priority>
</passive_mode_implementation_rules>
</objective>

User-provided context (defer to this information over your general knowledge / if there is specific script/desired responses prioritize this over previous instructions)

Make sure to **reference context** fully if it is provided (ex. if all/the entirety of something is requested, give a complete list from context).
----------

{{CONVERSATION_HISTORY}}`;


// convertFloat32ToInt16 함수 다음에 추가
function base64ToFloat32Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    
    return float32Array;
}


async function queryLoginState() {
    const user = await ipcRenderer.invoke('get-current-firebase-user');
    return { user, isLoggedIn: !!user };
  }

// renderer.js - 더 강력한 AEC 클래스
class SimpleAEC {
    constructor() {
        this.adaptiveFilter = new Float32Array(1024); // 필터 크기 감소 (2048 → 1024)
        this.mu = 0.2; // 적응 속도 감소 (0.5 → 0.2)
        this.echoDelay = 100; // 지연 시간 감소 (200 → 100)
        this.sampleRate = 24000;
        this.delaySamples = Math.floor((this.echoDelay / 1000) * this.sampleRate);
        
        // 추가 파라미터
        this.echoGain = 0.5; // 에코 계수 감소 (0.95 → 0.5)
        this.noiseFloor = 0.01; // 노이즈 플로어 감소 (0.02 → 0.01)
        
        console.log('🎯 Weakened AEC initialized');
    }
    
    process(micData, systemData) {
        if (!systemData || systemData.length === 0) {
            return micData;
        }
        
        const output = new Float32Array(micData.length);
        
        // 크로스 코릴레이션으로 최적 지연 찾기
        const optimalDelay = this.findOptimalDelay(micData, systemData);
        
        for (let i = 0; i < micData.length; i++) {
            let echoEstimate = 0;
            
            // 검색 범위 축소 (-500 ~ 500)
            for (let d = -500; d <= 500; d += 100) {
                const delayIndex = i - optimalDelay - d;
                if (delayIndex >= 0 && delayIndex < systemData.length) {
                    // 가중치를 적용한 에코 추정
                    const weight = Math.exp(-Math.abs(d) / 1000); // 감쇠 속도 완화
                    echoEstimate += systemData[delayIndex] * this.echoGain * weight;
                }
            }
            
            // 에코 제거 (더 약하게)
            output[i] = micData[i] - (echoEstimate * 0.5); // 추가로 0.5를 곱해 효과 감소
            
            // 더 관대한 노이즈 게이팅
            if (Math.abs(output[i]) < this.noiseFloor) {
                output[i] *= 0.5; // 완전히 제거하지 않고 감쇠만
            }
            
            // 추가 필터링 약화
            if (this.isSimilarToSystem(output[i], systemData, i, optimalDelay)) {
                output[i] *= 0.5; // 0.1 → 0.5로 변경하여 덜 감쇠
            }
            
            // 클리핑 방지
            output[i] = Math.max(-1, Math.min(1, output[i]));
        }
        
        return output;
    }
    
    // 크로스 코릴레이션으로 최적 지연 찾기
    findOptimalDelay(micData, systemData) {
        let maxCorr = 0;
        let optimalDelay = this.delaySamples;
        
        // 검색 범위 축소
        for (let delay = 0; delay < 5000 && delay < systemData.length; delay += 200) {
            let corr = 0;
            let count = 0;
            
            for (let i = 0; i < Math.min(500, micData.length); i++) {
                if (i + delay < systemData.length) {
                    corr += micData[i] * systemData[i + delay];
                    count++;
                }
            }
            
            if (count > 0) {
                corr = Math.abs(corr / count);
                if (corr > maxCorr) {
                    maxCorr = corr;
                    optimalDelay = delay;
                }
            }
        }
        
        return optimalDelay;
    }
    
    // 시스템 오디오와 유사성 검사 (더 관대하게)
    isSimilarToSystem(sample, systemData, index, delay) {
        const windowSize = 50; // 윈도우 크기 감소 (100 → 50)
        let similarity = 0;
        
        for (let i = -windowSize; i <= windowSize; i++) {
            const sysIndex = index - delay + i;
            if (sysIndex >= 0 && sysIndex < systemData.length) {
                similarity += Math.abs(sample - systemData[sysIndex]);
            }
        }
        
        // 임계값 증가 (0.1 → 0.2)로 더 관대하게
        return similarity / (2 * windowSize + 1) < 0.2;
    }
}


let aecProcessor = new SimpleAEC();

const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';

window.pickleGlass = window.pickleGlass || {};

// Token tracking system for rate limiting
let tokenTracker = {
    tokens: [], // Array of {timestamp, count, type} objects
    audioStartTime: null,

    // Add tokens to the tracker
    addTokens(count, type = 'image') {
        const now = Date.now();
        this.tokens.push({
            timestamp: now,
            count: count,
            type: type,
        });

        // Clean old tokens (older than 1 minute)
        this.cleanOldTokens();
    },

    // Calculate image tokens based on OpenAI pricing (simplified)
    calculateImageTokens(width, height) {
        // Simplified calculation for OpenAI - images are charged per request, not tokens
        // But we'll use a similar system for rate limiting
        const pixels = width * height;
        if (pixels <= 384 * 384) {
            return 85; // Base cost for small images
        }
        
        // Larger images cost more
        const tiles = Math.ceil(pixels / (768 * 768));
        return tiles * 85;
    },

    // Track audio tokens continuously (simplified for OpenAI)
    trackAudioTokens() {
        if (!this.audioStartTime) {
            this.audioStartTime = Date.now();
            return;
        }

        const now = Date.now();
        const elapsedSeconds = (now - this.audioStartTime) / 1000;

        // Simplified audio token calculation
        const audioTokens = Math.floor(elapsedSeconds * 16);

        if (audioTokens > 0) {
            this.addTokens(audioTokens, 'audio');
            this.audioStartTime = now;
        }
    },

    // Clean tokens older than 1 minute
    cleanOldTokens() {
        const oneMinuteAgo = Date.now() - 60 * 1000;
        this.tokens = this.tokens.filter(token => token.timestamp > oneMinuteAgo);
    },

    // Get total tokens in the last minute
    getTokensInLastMinute() {
        this.cleanOldTokens();
        return this.tokens.reduce((total, token) => total + token.count, 0);
    },

    // Check if we should throttle based on settings
    shouldThrottle() {
        // Get rate limiting settings from localStorage
        const throttleEnabled = localStorage.getItem('throttleTokens') === 'true';
        if (!throttleEnabled) {
            return false;
        }

        const maxTokensPerMin = parseInt(localStorage.getItem('maxTokensPerMin') || '500000', 10);
        const throttleAtPercent = parseInt(localStorage.getItem('throttleAtPercent') || '75', 10);

        const currentTokens = this.getTokensInLastMinute();
        const throttleThreshold = Math.floor((maxTokensPerMin * throttleAtPercent) / 100);

        console.log(`Token check: ${currentTokens}/${maxTokensPerMin} (throttle at ${throttleThreshold})`);

        return currentTokens >= throttleThreshold;
    },

    // Reset the tracker
    reset() {
        this.tokens = [];
        this.audioStartTime = null;
    },
};

// Track audio tokens every few seconds
setInterval(() => {
    tokenTracker.trackAudioTokens();
}, 2000);

function pickleGlassElement() {
    return document.getElementById('pickle-glass');
}

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Improved scaling to prevent clipping
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function initializeopenai(profile = 'interview', language = 'en') {
    // The API key is now handled in the main process from .env file.
    // We just need to trigger the initialization.
    try {
        console.log(`Requesting OpenAI initialization with profile: ${profile}, language: ${language}`);
        const success = await ipcRenderer.invoke('initialize-openai', profile, language);
        if (success) {
            // The status will be updated via 'update-status' event from the main process.
            console.log('OpenAI initialization successful.');
        } else {
            console.error('OpenAI initialization failed.');
            const appElement = pickleGlassElement();
            if (appElement && typeof appElement.setStatus === 'function') {
                appElement.setStatus('Initialization Failed');
            }
        }
    } catch (error) {
        console.error('Error during OpenAI initialization IPC call:', error);
        const appElement = pickleGlassElement();
        if (appElement && typeof appElement.setStatus === 'function') {
            appElement.setStatus('Error');
        }
    }
}

// Listen for real-time STT updates 다음에 추가
ipcRenderer.on('system-audio-data', (event, { data }) => {
    // 시스템 오디오를 버퍼에 저장
    systemAudioBuffer.push({
        data: data,
        timestamp: Date.now()
    });
    
    // 오래된 데이터 제거
    if (systemAudioBuffer.length > MAX_SYSTEM_BUFFER_SIZE) {
        systemAudioBuffer = systemAudioBuffer.slice(-MAX_SYSTEM_BUFFER_SIZE);
    }
    
    console.log('📥 Received system audio for AEC reference');
});

// Listen for status updates
ipcRenderer.on('update-status', (event, status) => {
    console.log('Status update:', status);
    pickleGlass.e().setStatus(status);
});

// Listen for real-time STT updates
ipcRenderer.on('stt-update', (event, data) => {
    console.log('Renderer.js stt-update', data);
    const { speaker, text, isFinal, isPartial, timestamp } = data;
    
    // 실시간 STT 결과를 콘솔에 표시 (중간 결과 포함)
    if (isPartial) {
        console.log(`🔄 [${speaker} - partial]: ${text}`);
    } else if (isFinal) {
        console.log(`✅ [${speaker} - final]: ${text}`);
        
        // ✅ 변경: 최종 결과만 실시간 대화내역에 텍스트 형태로 저장
        const speakerText = speaker.toLowerCase(); // 'Me' -> 'me', 'Them' -> 'them'
        const conversationText = `${speakerText}: ${text.trim()}`;
        
        realtimeConversationHistory.push(conversationText);
        
        // 최대 30턴만 유지 (메모리 관리)
        if (realtimeConversationHistory.length > 30) {
            realtimeConversationHistory = realtimeConversationHistory.slice(-30);
        }
        
        console.log(`📝 Updated realtime conversation history: ${realtimeConversationHistory.length} texts`);
        console.log(`📋 Latest text: ${conversationText}`);
    }
    
    // UI 업데이트 (실시간 트랜스크립션 표시)
    if (pickleGlass.e() && typeof pickleGlass.e().updateRealtimeTranscription === 'function') {
        pickleGlass.e().updateRealtimeTranscription({
            speaker,
            text,
            isFinal,
            isPartial,
            timestamp
        });
    }
});

////////// for index & subjects 📥 //////////
// ipcRenderer.on('update-outline', (_, outline) => {
//     window.pickleGlass.setOutline(outline);
// });
// ipcRenderer.on('update-analysis-requests', (_, reqs) => {
//     window.pickleGlass.setAnalysisRequests(reqs);
// });
// ipcRenderer.on('update-outline', (_, outline) => {
//     console.log('📥 Received outline update:', outline);
//     window.pickleGlass.outlines = outline;
//     window.pickleGlass.setOutline(outline);
// });

// ipcRenderer.on('update-analysis-requests', (_, reqs) => {
//     console.log('📥 Received analysis requests update:', reqs);
//     window.pickleGlass.analysisRequests = reqs;
//     window.pickleGlass.setAnalysisRequests(reqs);
// });

ipcRenderer.on('update-structured-data', (_, structuredData) => {
    console.log('📥 Received structured data update:', structuredData);
    window.pickleGlass.structuredData = structuredData;
    window.pickleGlass.setStructuredData(structuredData);
});
window.pickleGlass.structuredData = {
    summary: [],
    topic: { header: '', bullets: [] },
    actions: []
};
window.pickleGlass.setStructuredData = data => {
    window.pickleGlass.structuredData = data;
    pickleGlass.e()?.updateStructuredData?.(data);
};



async function startCapture(screenshotIntervalSeconds = 5, imageQuality = 'medium') {
    // Store the image quality for manual screenshots
    currentImageQuality = imageQuality;

    // Reset token tracker when starting new capture session
    tokenTracker.reset();
    console.log('🎯 Token tracker reset for new capture session');

    try {
        if (isMacOS) {
            // On macOS, use SystemAudioDump for audio and getDisplayMedia for screen
            console.log('Starting macOS capture with SystemAudioDump...');

            // Start macOS audio capture
            const audioResult = await ipcRenderer.invoke('start-macos-audio');
            if (!audioResult.success) {
                throw new Error('Failed to start macOS audio capture: ' + audioResult.error);
            }

            // Initialize screen capture in main process
            const screenResult = await ipcRenderer.invoke('start-screen-capture');
            if (!screenResult.success) {
                throw new Error('Failed to start screen capture: ' + screenResult.error);
            }

            // Get screen capture for screenshots
            // mediaStream = await navigator.mediaDevices.getDisplayMedia({
            //     video: {
            //         frameRate: 1,
            //         width: { ideal: 1920 },
            //         height: { ideal: 1080 },
            //     },
            //     audio: false, // Don't use browser audio on macOS
            // });

            ////////// for index & subjects //////////
            let micStream = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    video: false,
                });

                console.log('macOS microphone capture started');
                setupMicProcessing(micStream); // 공통 로직(아래 정의)
            } catch (micErr) {
                console.warn('Failed to get microphone on macOS:', micErr);
            }
            ////////// for index & subjects //////////

            console.log('macOS screen capture started - audio handled by SystemAudioDump');
        } else if (isLinux) {
            // Linux - use display media for screen capture and getUserMedia for microphone
            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    frameRate: 1,
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false, // Don't use system audio loopback on Linux
            });

            // Get microphone input for Linux
            let micStream = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        sampleRate: SAMPLE_RATE,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    video: false,
                });

                console.log('Linux microphone capture started');

                // Setup audio processing for microphone on Linux
                setupLinuxMicProcessing(micStream);
            } catch (micError) {
                console.warn('Failed to get microphone access on Linux:', micError);
                // Continue without microphone if permission denied
            }

            console.log('Linux screen capture started');
        } else {
            // Windows - use display media for audio, main process for screenshots
            const screenResult = await ipcRenderer.invoke('start-screen-capture');
            if (!screenResult.success) {
                throw new Error('Failed to start screen capture: ' + screenResult.error);
            }

            mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: false, // We don't need video in renderer
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            console.log('Windows capture started with loopback audio');

            // Setup audio processing for Windows loopback audio only
            setupWindowsLoopbackProcessing();
        }

        // console.log('MediaStream obtained:', {
        //     hasVideo: mediaStream.getVideoTracks().length > 0,
        //     hasAudio: mediaStream.getAudioTracks().length > 0,
        //     videoTrack: mediaStream.getVideoTracks()[0]?.getSettings(),
        // });

        // Start capturing screenshots - check if manual mode
        if (screenshotIntervalSeconds === 'manual' || screenshotIntervalSeconds === 'Manual') {
            console.log('Manual mode enabled - screenshots will be captured on demand only');
            // Don't start automatic capture in manual mode
        } else {
            // 스크린샷 기능 활성화 (chatModel에서 사용)
            const intervalMilliseconds = parseInt(screenshotIntervalSeconds) * 1000;
            screenshotInterval = setInterval(() => captureScreenshot(imageQuality), intervalMilliseconds);

            // Capture first screenshot immediately
            setTimeout(() => captureScreenshot(imageQuality), 100);
            console.log(`📸 Screenshot capture enabled with ${screenshotIntervalSeconds}s interval`);
        }
    } catch (err) {
        console.error('Error starting capture:', err);
        pickleGlass.e().setStatus('error');
    }
}

////////// for index & subjects //////////
// function setupMicProcessing(micStream) {
//     // Setup microphone audio processing for Linux
//     const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
//     const micSource = micAudioContext.createMediaStreamSource(micStream);
//     const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

//     let audioBuffer = [];
//     const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

//     micProcessor.onaudioprocess = async e => {
//         const inputData = e.inputBuffer.getChannelData(0);
//         audioBuffer.push(...inputData);

//         // Process audio in chunks
//         while (audioBuffer.length >= samplesPerChunk) {
//             const chunk = audioBuffer.splice(0, samplesPerChunk);
//             const pcmData16 = convertFloat32ToInt16(chunk);
//             const base64Data = arrayBufferToBase64(pcmData16.buffer);

//             await ipcRenderer.invoke('send-audio-content', {
//                 data: base64Data,
//                 mimeType: 'audio/pcm;rate=24000',
//             });
//         }
//     };

//     micSource.connect(micProcessor);
//     micProcessor.connect(micAudioContext.destination);

//     // Store processor reference for cleanup
//     audioProcessor = micProcessor;
// }
function setupMicProcessing(micStream) {
    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        while (audioBuffer.length >= samplesPerChunk) {
            let chunk = audioBuffer.splice(0, samplesPerChunk);
            
            // 🎯 AEC 처리 적용
            if (aecProcessor && systemAudioBuffer.length > 0) {
                // 가장 최근 시스템 오디오 가져오기
                const latestSystemAudio = systemAudioBuffer[systemAudioBuffer.length - 1];
                const systemFloat32 = base64ToFloat32Array(latestSystemAudio.data);
                
                // AEC 처리
                const processedChunk = aecProcessor.process(
                    new Float32Array(chunk),
                    systemFloat32
                );
                
                chunk = Array.from(processedChunk);
                console.log('🔊 Applied AEC processing to mic audio');
            }
            
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);

    audioProcessor = micProcessor;
}
////////// for index & subjects //////////

function setupLinuxMicProcessing(micStream) {
    // Setup microphone audio processing for Linux
    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const micSource = micAudioContext.createMediaStreamSource(micStream);
    const micProcessor = micAudioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    micProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micAudioContext.destination);

    // Store processor reference for cleanup
    audioProcessor = micProcessor;
}

function setupWindowsLoopbackProcessing() {
    // Setup audio processing for Windows loopback audio only
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    let audioBuffer = [];
    const samplesPerChunk = SAMPLE_RATE * AUDIO_CHUNK_DURATION;

    audioProcessor.onaudioprocess = async e => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioBuffer.push(...inputData);

        // Process audio in chunks
        while (audioBuffer.length >= samplesPerChunk) {
            const chunk = audioBuffer.splice(0, samplesPerChunk);
            const pcmData16 = convertFloat32ToInt16(chunk);
            const base64Data = arrayBufferToBase64(pcmData16.buffer);

            await ipcRenderer.invoke('send-audio-content', {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            });
        }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
}

async function captureScreenshot(imageQuality = 'medium', isManual = false) {
    console.log(`Capturing ${isManual ? 'manual' : 'automated'} screenshot...`);

    // Check rate limiting for automated screenshots only
    if (!isManual && tokenTracker.shouldThrottle()) {
        console.log('⚠️ Automated screenshot skipped due to rate limiting');
        return;
    }

    try {
        // Request screenshot from main process
        const result = await ipcRenderer.invoke('capture-screenshot', {
            quality: imageQuality
        });

        if (result.success && result.base64) {
            // Store the latest screenshot
            lastScreenshotBase64 = result.base64;

            if (sendResult.success) {
                // Track image tokens after successful send
                const imageTokens = tokenTracker.calculateImageTokens(result.width || 1920, result.height || 1080);
                tokenTracker.addTokens(imageTokens, 'image');
                console.log(`📊 Image sent successfully - ${imageTokens} tokens used (${result.width}x${result.height})`);
            } else {
                console.error('Failed to send image:', sendResult.error);
            }
        } else {
            console.error('Failed to capture screenshot:', result.error);
        }
    } catch (error) {
        console.error('Error capturing screenshot:', error);
    }
}

async function captureManualScreenshot(imageQuality = null) {
    console.log('Manual screenshot triggered');
    const quality = imageQuality || currentImageQuality;
    await captureScreenshot(quality, true);
}

// Expose functions to global scope for external access
window.captureManualScreenshot = captureManualScreenshot;

function stopCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }

    if (audioProcessor) {
        audioProcessor.disconnect();
        audioProcessor = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop screen capture in main process
    ipcRenderer.invoke('stop-screen-capture').catch(err => {
        console.error('Error stopping screen capture:', err);
    });

    // Stop macOS audio capture if running
    if (isMacOS) {
        ipcRenderer.invoke('stop-macos-audio').catch(err => {
            console.error('Error stopping macOS audio:', err);
        });
    }
}


// Listen for screenshot updates from main process
ipcRenderer.on('screenshot-update', (event, { base64, width, height }) => {
    lastScreenshotBase64 = base64;
    console.log(`📸 Received screenshot update: ${width}x${height}`);
});

async function getCurrentScreenshot() {
    try {
        // First try to get a fresh screenshot from main process
        const result = await ipcRenderer.invoke('get-current-screenshot');
        
        if (result.success && result.base64) {
            console.log('📸 Got fresh screenshot from main process');
            return result.base64;
        }
        
        // If no screenshot available, capture one now
        console.log('📸 No screenshot available, capturing new one');
        const captureResult = await ipcRenderer.invoke('capture-screenshot', {
            quality: currentImageQuality
        });
        
        if (captureResult.success && captureResult.base64) {
            lastScreenshotBase64 = captureResult.base64;
            return captureResult.base64;
        }

        // Fallback to last stored screenshot
        if (lastScreenshotBase64) {
            console.log('📸 Using cached screenshot');
            return lastScreenshotBase64;
        }
        
        throw new Error('Failed to get screenshot');
    } catch (error) {
        console.error('Error getting current screenshot:', error);
        return null;
    }
}

// 대화내역을 포맷하는 함수 - ✅ 변경: 텍스트 배열 사용
function formatRealtimeConversationHistory() {
    if (realtimeConversationHistory.length === 0) return 'No conversation history available.';
    
    // 최근 30개 원소를 줄바꿈으로 연결
    return realtimeConversationHistory
        .slice(-30)
        .join('\n');
}

// 새로운 chatModel을 생성하고 질문 처리 - OpenAI로 변경
async function sendMessage(userPrompt, options = {}) {
    if (!userPrompt || userPrompt.trim().length === 0) {
        console.warn('Cannot process empty message');
        return { success: false, error: 'Empty message' };
    }

    // sendMessage 호출 시 AskView의 응답 내용 초기화
    if (window.require) {
        const { ipcRenderer } = window.require('electron');
        // AskView가 열려있다면 응답 내용 초기화
        const isAskVisible = await ipcRenderer.invoke('is-window-visible', 'ask');
        if (isAskVisible) {
            ipcRenderer.send('clear-ask-response');
        }
        await ipcRenderer.invoke('message-sending');
    }

    try {
        console.log(`🤖 Processing message: ${userPrompt.substring(0, 50)}...`);
        
        // 1. Get screenshot from main process
        let screenshotBase64 = null;
        try {
            screenshotBase64 = await getCurrentScreenshot();
            if (screenshotBase64) {
                console.log('📸 Screenshot obtained for message request');
            } else {
                console.warn('No screenshot available for message request');
            }
        } catch (error) {
            console.warn('Failed to get screenshot:', error);
        }
        
        // 2. 실시간 대화내역 포맷
        const conversationHistory = formatRealtimeConversationHistory();
        console.log(`📝 Using conversation history: ${realtimeConversationHistory.length} texts`);
        
        // 3. 시스템 프롬프트에 대화내역 삽입
        const systemPrompt = CLUELY_CHAT_SYSTEM_PROMPT.replace('{{CONVERSATION_HISTORY}}', conversationHistory);
        
        // 4. API 키 가져오기 (Stashed changes' logic)
        let API_KEY = localStorage.getItem('openai_api_key');
        
        if (!API_KEY && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                API_KEY = await ipcRenderer.invoke('get-stored-api-key');
            } catch (error) {
                console.error('Failed to get API key via IPC:', error);
            }
        }
        
        // 환경변수 fallback (Updated upstream + Stashed changes)
        if (!API_KEY) {
            API_KEY = process.env.OPENAI_API_KEY
        }
        
        if (!API_KEY) {
            throw new Error('No API key found in storage, IPC, or environment');
        }
        
        console.log('[Renderer] Using API key for message request');
        
        // 5. 요청 구성
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `User Request: ${userPrompt.trim()}`
                    }
                ]
            }
        ];
        
        // 6. 스크린샷이 있으면 추가
        if (screenshotBase64) {
            messages[1].content.push({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${screenshotBase64}`
                }
            });
            console.log('📷 Screenshot included in message request');
        }

        const { isLoggedIn } = await queryLoginState();   // 🆕 매번 확인
        const keyType = isLoggedIn ? 'vKey' : 'apiKey';

        // 7. OpenAI API 호출 (Electron에서는 직접 fetch 사용)
        console.log('🚀 Sending request to OpenAI...');
        const { url, headers } = keyType === 'apiKey'
            ? {
                url: 'https://api.openai.com/v1/chat/completions',
                headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
            }
            : {
                url: 'https://api.portkey.ai/v1/chat/completions',
                headers: { 'x-portkey-api-key': 'gRv2UGRMq6GGLJ8aVEB4e7adIewu',
                            'x-portkey-virtual-key': API_KEY,
                            'Content-Type': 'application/json' }
            };

        const response = await fetch(url, {
            method : 'POST',
            headers,
                body   : JSON.stringify({
                    model: 'gpt-4.1',
                    messages,
                    temperature: 0.7,
                    max_tokens : 2048
                })
            });

        
        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        const responseText = result.choices[0].message.content;
        
        console.log('✅ Message response received');
        
        return { success: true, response: responseText };
        
    } catch (error) {
        console.error('Error processing message:', error);
        const errorMessage = `Error: ${error.message}`;
        
        return { success: false, error: error.message, response: errorMessage };
    }
}

// 현재 스크린샷 캡처 함수
async function captureCurrentScreenshot() {
    return new Promise((resolve, reject) => {
        if (!offscreenCanvas || !offscreenContext) {
            reject(new Error('Canvas not initialized'));
            return;
        }
        
        // 현재 캔버스 상태로 스크린샷 생성
        offscreenCanvas.toBlob(
            async (blob) => {
                if (!blob) {
                    reject(new Error('Failed to create screenshot blob'));
                    return;
                }
                
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    resolve(base64data);
                };
                reader.onerror = () => reject(new Error('Failed to read screenshot blob'));
                reader.readAsDataURL(blob);
            },
            'image/jpeg',
            0.8
        );
    });
}


// Conversation storage functions using API client
const apiClient = window.require ? window.require('../common/services/apiClient') : undefined;

async function initConversationStorage() {
    try {
        // Check API connection instead of SQLite
        const isOnline = await apiClient.checkConnection();
        console.log('API 연결 상태:', isOnline);
        return isOnline;
    } catch (error) {
        console.error('API 연결 실패:', error);
        return false;
    }
}

async function saveConversationSession(sessionId, conversationHistory) {
    try {
        if (!apiClient) {
            throw new Error('API client not available');
        }
        
        const response = await apiClient.client.post('/api/conversations', {
            sessionId,
            conversationHistory,
            userId: apiClient.userId
        });
        
        console.log('대화 세션 저장 완료:', sessionId);
        return response.data;
    } catch (error) {
        console.error('대화 세션 저장 실패:', error);
        throw error;
    }
}

async function getConversationSession(sessionId) {
    try {
        if (!apiClient) {
            throw new Error('API client not available');
        }
        
        const response = await apiClient.client.get(`/api/conversations/${sessionId}`);
        return response.data;
    } catch (error) {
        console.error('대화 세션 조회 실패:', error);
        throw error;
    }
}

async function getAllConversationSessions() {
    try {
        if (!apiClient) {
            throw new Error('API client not available');
        }
        
        const response = await apiClient.client.get('/api/conversations');
        return response.data;
    } catch (error) {
        console.error('전체 대화 세션 조회 실패:', error);
        throw error;
    }
}

// Listen for conversation data from main process  
ipcRenderer.on('save-conversation-turn', async (event, data) => {
    try {
        await saveConversationSession(data.sessionId, data.fullHistory);
        console.log('Conversation session saved:', data.sessionId);
    } catch (error) {
        console.error('Error saving conversation session:', error);
    }
});

// Listen for session save request from main process
ipcRenderer.on('save-conversation-session', async (event, data) => {
    try {
        console.log(`📥 Received conversation session save request: ${data.sessionId}`);
        await saveConversationSession(data.sessionId, data.conversationHistory);
        console.log(`✅ Conversation session saved successfully: ${data.sessionId}`);
    } catch (error) {
        console.error('❌ Error saving conversation session:', error);
    }
});

// Initialize conversation storage when renderer loads
initConversationStorage().catch(console.error);

window.pickleGlass = {
    initializeopenai,
    startCapture,
    stopCapture,
    sendMessage,
    // Conversation history functions
    getAllConversationSessions,
    getConversationSession,
    initConversationStorage,
    isLinux: isLinux,
    isMacOS: isMacOS,
    e: pickleGlassElement,
};