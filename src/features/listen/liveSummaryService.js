require('dotenv').config();
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('./audioUtils.js');
const { getSystemPrompt } = require('../../common/prompts/promptBuilder.js');
const { connectToOpenAiSession, createOpenAiGenerativeClient, getOpenAiGenerativeModel } = require('../../common/services/openAiClient.js');
const sqliteClient = require('../../common/services/sqliteClient'); // Import sqliteClient
const dataService = require('../../common/services/dataService'); // To get current user ID

const {isFirebaseLoggedIn,getCurrentFirebaseUser} = require('../../electron/windowManager.js');

// API 키를 저장된 값에서 가져오는 함수 (Stashed changes)
function getApiKey() {
    const { getStoredApiKey } = require('../../electron/windowManager.js');
    const storedKey = getStoredApiKey();
    
    if (storedKey) {
        console.log('[LiveSummaryService] Using stored API key');
        return storedKey;
    }
    
    // 환경변수 fallback (Updated upstream + Stashed changes)
    const envKey = process.env.OPENAI_API_KEY
    if (envKey) {
        console.log('[LiveSummaryService] Using environment API key');
        return envKey;
    }
    
    console.error('[LiveSummaryService] No API key found in storage or environment');
    return null;
}

// Conversation tracking variables
let currentSessionId = null; // This will now be the DB session ID
let conversationHistory = []; // This can be removed or used for short-term prompt building
let isInitializingSession = false;

// STT (Speech-to-Text) WebSocket 세션
let mySttSession = null;
let theirSttSession = null;
let myCurrentUtterance = '';
let theirCurrentUtterance = '';

// 백업 메커니즘: turnComplete 이벤트가 오지 않을 때 대비
let myLastPartialText = '';
let theirLastPartialText = '';
let myInactivityTimer = null;
let theirInactivityTimer = null;
const INACTIVITY_TIMEOUT = 3000; // 3초 동안 새로운 음성이 없으면 완료로 간주

// ---------------------------------------------------------------------------
// 🎛️  Turn-completion debouncing
// ---------------------------------------------------------------------------
// Very aggressive VAD (e.g. 50 ms) tends to split one spoken sentence into
// many "completed" events.  To avoid creating a separate chat bubble for each
// of those micro-turns we debounce the *completed* events per speaker.  Any
// completions that arrive within this window are concatenated and flushed as
// **one** final turn.

const COMPLETION_DEBOUNCE_MS = 2000; // adjust as needed for UX

let myCompletionBuffer = '';
let theirCompletionBuffer = '';
let myCompletionTimer = null;
let theirCompletionTimer = null;

function flushMyCompletion() {
    if (!myCompletionBuffer.trim()) return;

    const finalText = myCompletionBuffer.trim();
    // Save to DB & send to renderer as final
    saveConversationTurn('Me', finalText);
    sendToRenderer('stt-update', {
        speaker: 'Me',
        text: finalText,
        isPartial: false,
        isFinal: true,
        timestamp: Date.now(),
    });

    myCompletionBuffer = '';
    myCompletionTimer = null;
    myCurrentUtterance = ''; // Reset utterance accumulator on flush
    sendToRenderer('update-status', 'Listening...');
}

function flushTheirCompletion() {
    if (!theirCompletionBuffer.trim()) return;

    const finalText = theirCompletionBuffer.trim();
    saveConversationTurn('Them', finalText);
    sendToRenderer('stt-update', {
        speaker: 'Them',
        text: finalText,
        isPartial: false,
        isFinal: true,
        timestamp: Date.now(),
    });

    theirCompletionBuffer = '';
    theirCompletionTimer = null;
    theirCurrentUtterance = ''; // Reset utterance accumulator on flush
    sendToRenderer('update-status', 'Listening...');
}

function debounceMyCompletion(text) {
    // Append with space if needed
    myCompletionBuffer += (myCompletionBuffer ? ' ' : '') + text;

    if (myCompletionTimer) clearTimeout(myCompletionTimer);
    myCompletionTimer = setTimeout(flushMyCompletion, COMPLETION_DEBOUNCE_MS);
}

function debounceTheirCompletion(text) {
    theirCompletionBuffer += (theirCompletionBuffer ? ' ' : '') + text;

    if (theirCompletionTimer) clearTimeout(theirCompletionTimer);
    theirCompletionTimer = setTimeout(flushTheirCompletion, COMPLETION_DEBOUNCE_MS);
}

// Audio capture
let systemAudioProc = null;

let analysisIntervalId = null;

/**
 * 대화 기록을 프롬프트에 포함시키기 위한 텍스트로 변환합니다.
 * @param {Array<string>} conversationTexts - 대화 텍스트 배열 ["me: ~~~", "them: ~~~", ...]
 * @param {number} maxTurns - 포함할 최근 턴의 최대 개수
 * @returns {string} - 프롬프트용으로 포맷된 대화 문자열
 */
function formatConversationForPrompt(conversationTexts, maxTurns = 30) {
    if (conversationTexts.length === 0) return '';
    return conversationTexts
        .slice(-maxTurns)
        .join('\n');
}

async function makeOutlineAndRequests(conversationTexts, maxTurns = 30) {
    console.log(`🔍 makeOutlineAndRequests called - conversationTexts: ${conversationTexts.length}`);
    

    if (conversationTexts.length === 0) {
        console.log('⚠️ No conversation texts available for analysis');
        return null;
    }

    const recentConversation = formatConversationForPrompt(conversationTexts, maxTurns);
    console.log(`📝 Recent conversation (${conversationTexts.length} texts):\n${recentConversation.substring(0, 200)}...`);
    
    // Build system prompt with conversation history directly embedded
    // const basePrompt = getSystemPrompt('cluely_analysis', '', false);
    const basePrompt = getSystemPrompt('cluely_analysis_latest', '', false);
    const systemPrompt = basePrompt.replace('{{CONVERSATION_HISTORY}}', recentConversation);
    console.log(`📋 Generated system prompt with conversation history`);

    try {
        // OpenAI API 형식으로 messages 배열 구성
        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: 'Analyze the conversation and provide a summary with key topics and suggested questions.'
            }
        ];
        
        console.log('🤖 Sending analysis request to OpenAI...');
        
        // OpenAI API 호출
        const API_KEY = getApiKey();
        if (!API_KEY) {
            throw new Error('No API key available');
        }
        const loggedIn = isFirebaseLoggedIn();          // true ➜ vKey, false ➜ apiKey
        const keyType  = loggedIn ? 'vKey' : 'apiKey';
        console.log(`[LiveSummary] keyType: ${keyType}`);
        
        const fetchUrl = keyType === 'apiKey'
            ? 'https://api.openai.com/v1/chat/completions'
            : 'https://api.portkey.ai/v1/chat/completions';
    
        const headers  = keyType === 'apiKey'
            ? {                                           // ① 일반 OpenAI Key
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type' : 'application/json',
                }
            : {                                           // ② Portkey vKey
                    'x-portkey-api-key'   : 'gRv2UGRMq6GGLJ8aVEB4e7adIewu',
                    'x-portkey-virtual-key': API_KEY,
                    'Content-Type'        : 'application/json',
                };

        const response = await fetch(fetchUrl, {
                method : 'POST',
                headers,
                body   : JSON.stringify({
                    model       : 'gpt-4.1',
                    messages,
                    temperature : 0.7,
                    max_tokens  : 1024
                })
            });
        
        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        const responseText = result.choices[0].message.content.trim();
        console.log(`✅ Analysis response received: ${responseText}`);

        // const parsedData = parseResponseText(responseText);
        const structuredData = parseResponseText(responseText);
        
        // --- NEW: Save AI message and Summary to DB ---
        if (currentSessionId) {
            // Save the user's implicit request
            await sqliteClient.addAiMessage({
                sessionId: currentSessionId,
                role: 'user',
                content: 'Analyze the conversation and provide a summary...' // Abridged
            });

            // Save the AI's response
            await sqliteClient.addAiMessage({
                sessionId: currentSessionId,
                role: 'assistant',
                content: responseText
            });

            // Save the parsed summary
            await sqliteClient.saveSummary({
                sessionId: currentSessionId,
                tldr: structuredData.topic.header || 'Summary not available.',
                text: responseText,
                bullet_json: JSON.stringify(structuredData.summary),
                action_json: JSON.stringify(structuredData.actions)
            });
            console.log(`[DB] Saved AI analysis and summary for session ${currentSessionId}`);
        }
        // --- END NEW ---

        // return parsedData;

        
        return structuredData;  // 직접 structuredData 반환
        
        
    } catch (error) {
        console.error('❌ Error during analysis generation:', error.message);
        console.error('Full error details:', error);
        if (error.response) {
            console.error('API response error:', error.response);
        }
        return null;
    }
}


/**
 * AI의 분석 응답을 파싱하여 구조화된 요약, 주요 토픽 및 실행 항목을 추출합니다.
 * 이 버전은 먼저 모든 굵은 헤더를 찾아 텍스트를 섹션으로 나눈 다음, 각 섹션의 내용을 파싱합니다.
 * summary 항목에서는 헤더 태그(**...:**)가 제거됩니다.
 *
 * @param {string} responseText - AI의 원시 텍스트 응답.
 * @returns {{summary: string[], topic: {header: string, bullets: string[]}, actions: string[]}} - 구조화된 데이터.
 */
function parseResponseText(responseText) {
    const structuredData = {
        summary: [],
        topic: { header: '', bullets: [] },
        actions: [],
        followUps: []
    };

    try {
        const lines = responseText.split('\n');
        const sections = [];
        // 첫 헤더가 나오기 전의 내용을 담을 초기 섹션
        let currentSection = { header: 'Introduction', content: [] };

        // 1. 모든 메인 헤더를 찾아 텍스트를 섹션으로 분할합니다.
        for (const line of lines) {
            // 줄의 시작이 "**...**" 패턴인 경우 메인 헤더로 간주
            const headerMatch = line.trim().match(/^\*\*(.*)\*\*$/);
            
            // 단, 불릿 포인트('-')로 시작하는 경우는 하위 항목이므로 제외
            if (headerMatch && !line.trim().startsWith('-')) {
                // 이전까지 수집된 섹션을 배열에 추가
                if (currentSection.header || currentSection.content.length > 0) {
                    sections.push(currentSection);
                }
                // 새 섹션 시작
                currentSection = { header: headerMatch[1].trim(), content: [] };
            } else {
                // 현재 섹션의 내용으로 추가
                currentSection.content.push(line);
            }
        }
        sections.push(currentSection); // 마지막 섹션 추가

        // 2. 식별된 각 섹션을 순회하며 파싱합니다.
        for (const section of sections) {
            const headerText = section.header.toLowerCase().replace(/:$/, '').trim();
            const contentText = section.content.join('\n');

            // 2a. '요약' 및 '토픽' 섹션 처리
            const summaryKeywords = ['summary', 'key', 'topic', 'main', 'point', 'overview', 'headline'];
            if (summaryKeywords.some(k => headerText.includes(k)) || headerText === 'introduction') {
                // 불릿 포인트 '**헤더:** 내용' 형식의 모든 항목을 찾음
                const pointRegex = /^\s*[-\*]\s*\*\*(?<header>[^:]+):\*\*(?<description>(?:.|\n(?!\s*[-\*]))*)/gm;
                const allPoints = [...contentText.matchAll(pointRegex)];

                for (const match of allPoints) {
                    const { header, description } = match.groups;
                    
                    // 첫 번째 주요 포인트를 'topic'으로 설정
                    if (!structuredData.topic.header) {
                        structuredData.topic.header = `${header.trim()}:`;
                        console.log('📌 Found main topic header:', structuredData.topic.header);
                        if (description.trim()) {
                            const topicBullets = description.trim().split('\n').map(l => l.trim()).filter(Boolean);
                            structuredData.topic.bullets.push(...topicBullets);
                            topicBullets.forEach(b => console.log('📌 Found topic bullet:', b));
                        }
                    } else { 
                        // ✅ 수정된 부분: 나머지는 'summary'로 추가하되, 헤더 텍스트는 제외
                        const summaryDescription = description.trim().replace(/\s+/g, ' ');
                        structuredData.summary.push(summaryDescription);
                        console.log('📌 Found summary point:', summaryDescription);
                    }
                }
            }

            // 2b. '설명' 섹션 처리
            const explanationKeywords = ['extended', 'explanation'];
            if (explanationKeywords.some(k => headerText.includes(k))) {
                const sentences = contentText.trim().split(/\.\s+/)
                    .filter(s => s.trim().length > 0)
                    .map(s => s.trim() + (s.endsWith('.') ? '' : '.'));
                    
                structuredData.topic.bullets.push(...sentences.slice(0, 3));
                sentences.slice(0, 3).forEach(b => console.log('📌 Found explanation bullet:', b));
            }

           

            // 2c. '질문' 섹션 처리
            const questionKeywords = ['suggest', 'follow-up', 'question'];
            if (questionKeywords.some(k => headerText.includes(k))) {
                const questionLines = contentText.split('\n')
                    .map(line => line.replace(/^\s*(\d+\.|-|\*)\s*/, '').trim())
                    .filter(line => line.includes('?') && line.length > 10);
                
                structuredData.actions.push(...questionLines.slice(0, 3));
                questionLines.slice(0, 3).forEach(q => console.log('📌 Found question:', q));
            }
        }

        // 3. 최종 정리 및 기본값 설정
        // 고정 액션 추가 및 중복 제거
        const fixedActions = ["What should i say next?", "Suggest follow-up questions"];
        structuredData.actions = [...new Set([...structuredData.actions, ...fixedActions])];

        // 배열 크기 제한
        structuredData.summary = structuredData.summary.slice(0, 5);
        structuredData.topic.bullets = [...new Set(structuredData.topic.bullets)].slice(0, 3);
        structuredData.actions = structuredData.actions.slice(0, 5);
        structuredData.followUps = [
            "Draft a follow-up email",
            "Generate action items", 
            "Show summary"
        ];

    } catch (error) {
        console.error('❌ Error parsing response text:', error);
        // 에러 발생 시 안전한 기본값 반환
        return {
            summary: [],
            topic: { header: '', bullets: [] },
            actions: ["What should i say next?", "Suggest follow-up questions"],
            followUps: [
                "Draft a follow-up email",
                "Generate action items",
                "Show summary"
            ]
        };
    }
    
    console.log('📊 Final structured data:', JSON.stringify(structuredData, null, 2));
    return structuredData;
}

/**
 * 대화 텍스트가 5개 이상 쌓일 때마다 분석을 실행합니다.
 */
async function triggerAnalysisIfNeeded() {
    if (conversationHistory.length >= 5 && conversationHistory.length % 5 === 0) {
        console.log(`🚀 Triggering analysis (non-blocking) - ${conversationHistory.length} conversation texts accumulated`);
        
        // await를 제거하여 non-blocking으로 만듭니다.
        makeOutlineAndRequests(conversationHistory).then(data => {
            if (data) {
                console.log('📤 Sending structured data to renderer');
                // 하나의 채널로 통합 전송
                sendToRenderer('update-structured-data', data);
            } else {
                console.log('❌ No analysis data returned from non-blocking call');
            }
        }).catch(error => {
            console.error('❌ Error in non-blocking analysis:', error);
        });
    }
}

/**
 * 10초마다 주기적으로 개요 및 분석 업데이트를 스케줄링합니다. - DEPRECATED
 * 이제 대화 텍스트가 5개씩 쌓일 때마다 분석이 트리거됩니다.
 */
function startAnalysisInterval() {
    // ✅ 변경: 이제 분석은 대화 텍스트가 5개씩 쌓일 때마다 triggerAnalysisIfNeeded()에서 트리거됩니다.
    console.log('⏰ Analysis will be triggered every 5 conversation texts (not on timer)');
    
    // 기존 인터벌 정리 (더 이상 사용하지 않음)
    if (analysisIntervalId) {
        clearInterval(analysisIntervalId);
        analysisIntervalId = null;
    }
}

function stopAnalysisInterval() {
    if (analysisIntervalId) {
        clearInterval(analysisIntervalId);
        analysisIntervalId = null;
    }
    
    // 백업 메커니즘 타이머들도 정리
    if (myInactivityTimer) {
        clearTimeout(myInactivityTimer);
        myInactivityTimer = null;
    }
    if (theirInactivityTimer) {
        clearTimeout(theirInactivityTimer);
        theirInactivityTimer = null;
    }
}

function sendToRenderer(channel, data) {
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
            win.webContents.send(channel, data);
        }
    });
}

// ✅ 추가: getCurrentSessionData 함수 정의
function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        conversationHistory: conversationHistory, // 이제 텍스트 배열
        totalTexts: conversationHistory.length
    };
}

// Conversation management functions
async function initializeNewSession() {
    try {
        const uid = dataService.currentUserId; // Get current user (local or firebase)
        currentSessionId = await sqliteClient.createSession(uid);
        console.log(`[DB] New session started in DB: ${currentSessionId}`);
        
        conversationHistory = [];
        myCurrentUtterance = '';
        theirCurrentUtterance = '';
        
        // sendToRenderer('update-outline', []);
        // sendToRenderer('update-analysis-requests', []);

            // 백업 메커니즘 상태 리셋
    myLastPartialText = '';
    theirLastPartialText = '';
    if (myInactivityTimer) {
        clearTimeout(myInactivityTimer);
        myInactivityTimer = null;
    }
    if (theirInactivityTimer) {
        clearTimeout(theirInactivityTimer);
        theirInactivityTimer = null;
    }
    
    console.log('New conversation session started:', currentSessionId);
        return true;
    } catch (error) {
        console.error("Failed to initialize new session in DB:", error);
        currentSessionId = null;
        return false;
    }
}



async function saveConversationTurn(speaker, transcription) {
    if (!currentSessionId) {
        console.log("No active session, initializing a new one first.");
        const success = await initializeNewSession();
        if (!success) {
            console.error("Could not save turn because session initialization failed.");
            return;
        }
    }
    if (transcription.trim() === '') return;

    try {
        await sqliteClient.addTranscript({
            sessionId: currentSessionId,
            speaker: speaker, // 'Me' or 'Them'
            text: transcription.trim(),
        });
        console.log(`[DB] Saved transcript for session ${currentSessionId}: (${speaker})`);

        // For prompt building, we might still want to use a temporary history
        const conversationText = `${speaker.toLowerCase()}: ${transcription.trim()}`;
        conversationHistory.push(conversationText);
        console.log(`💬 Saved conversation text: ${conversationText}`);
        console.log(`📈 Total conversation history: ${conversationHistory.length} texts`);

        // ✅ 변경: 5개씩 쌓일 때마다 분석 트리거
        triggerAnalysisIfNeeded();

        // Send to renderer for live view
        const conversationTurn = {
            speaker: speaker,
            timestamp: Date.now(),
            transcription: transcription.trim(),
        };
        sendToRenderer('update-live-transcription', { turn: conversationTurn });
        // 📝 5턴마다 또는 중요한 대화일 때 자동 저장
        if (conversationHistory.length % 5 === 0) {
            console.log(`🔄 Auto-saving conversation session ${currentSessionId} (${conversationHistory.length} turns)`);
            sendToRenderer('save-conversation-session', {
                sessionId: currentSessionId,
                conversationHistory: conversationHistory

            });
        }
    } catch (error) {
        console.error("Failed to save transcript to DB:", error);
    }
}


async function initializeLiveSummarySession(language = 'en') {
    if (isInitializingSession) {
        console.log('Session initialization already in progress.');
        return false;
    }

    const loggedIn = isFirebaseLoggedIn(); 
    const keyType  = loggedIn ? 'vKey' : 'apiKey';

    isInitializingSession = true;
    sendToRenderer('session-initializing', true);
    sendToRenderer('update-status', 'Initializing sessions...');

    // Merged block
    const API_KEY = getApiKey();
    if (!API_KEY) {
        console.error('FATAL ERROR: API Key is not defined.');
        sendToRenderer('update-status', 'API Key not configured.');
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        return false;
    }

    initializeNewSession();

    try {
        // 1. 사용자(마이크) STT 세션 콜백 정의 (수정 완료)
        const handleMyMessage = message => {
            const type = message.type;
            const text = message.transcript || message.delta ||(message.alternatives && message.alternatives[0]?.transcript) || '';
            // console.log('🎤 handleMyMessage', { type, message });

            if (type === 'conversation.item.input_audio_transcription.delta') {
                // New delta proves the speaker is still talking.
                // Cancel any pending completion flush to avoid premature cuts.
                if (myCompletionTimer) {
                    // console.log('🎤 Delta received, canceling pending completion flush for "Me"');
                    clearTimeout(myCompletionTimer);
                    myCompletionTimer = null;
                }

                // Accumulate deltas for the current utterance.
                myCurrentUtterance += text;

                // For the UI, show the buffered text plus the new delta sequence so it looks continuous.
                const continuousText = myCompletionBuffer + (myCompletionBuffer ? ' ' : '') + myCurrentUtterance;

                // Realtime partial update ➜ renderer (still streaming)
                if (text && !text.includes('vq_lbr_audio_')) {
                    sendToRenderer('stt-update', {
                        speaker: 'Me',
                        text: continuousText,
                        isPartial: true,
                        isFinal: false,
                        timestamp: Date.now(),
                    });
                }
            } else if (type === 'conversation.item.input_audio_transcription.completed') {
                if (text && text.trim()) {
                    // A 'completed' event provides the full, final text for an utterance.
                    // We discard any intermediate deltas for this segment and use this text.
                    const finalUtteranceText = text.trim();
                    myCurrentUtterance = ''; // Reset the delta accumulator.

                    // Debounce this whole utterance to merge quick successive utterances.
                    debounceMyCompletion(finalUtteranceText);
                }
            } else if (message.error) {
                console.error('[Me] STT Session Error:', message.error);
            }
        };

        // 2. 상대방(시스템 오디오) STT 세션 콜백 정의 (수정 완료)
        const handleTheirMessage = message => {
            const type = message.type;
            // console.log('🔥 handleTheirMessage', { type, message });
            const text = message.transcript || message.delta ||(message.alternatives && message.alternatives[0]?.transcript) || '';

            if (type === 'conversation.item.input_audio_transcription.delta') {
                // New delta proves the speaker is still talking.
                // Cancel any pending completion flush to avoid premature cuts.
                if (theirCompletionTimer) {
                    // console.log('🔥 Delta received, canceling pending completion flush for "Them"');
                    clearTimeout(theirCompletionTimer);
                    theirCompletionTimer = null;
                }
                
                // Accumulate deltas for the current utterance.
                theirCurrentUtterance += text;

                // For the UI, show the buffered text plus the new delta sequence so it looks continuous.
                const continuousText = theirCompletionBuffer + (theirCompletionBuffer ? ' ' : '') + theirCurrentUtterance;

                if (text && !text.includes('vq_lbr_audio_')) {
                    sendToRenderer('stt-update', {
                        speaker: 'Them',
                        text: continuousText,
                        isPartial: true,
                        isFinal: false,
                        timestamp: Date.now(),
                    });
                }
            } else if (type === 'conversation.item.input_audio_transcription.completed') {
                if (text && text.trim()) {
                    // A 'completed' event provides the full, final text for an utterance.
                    // We discard any intermediate deltas for this segment and use this text.
                    const finalUtteranceText = text.trim();
                    theirCurrentUtterance = ''; // Reset the delta accumulator.

                    // Debounce this whole utterance to merge quick successive utterances.
                    debounceTheirCompletion(finalUtteranceText);
                }
            } else if (message.error) {
                console.error('[Them] STT Session Error:', message.error);
            }
        };

        // STT 세션 설정 객체
        const mySttConfig = {
            language: language,
            callbacks: {
                onmessage: handleMyMessage,
                onerror: (error) => console.error('My STT session error:', error.message),
                onclose: (event) => console.log('My STT session closed:', event.reason)
            }
        };
        const theirSttConfig = {
            language: language,
            callbacks: {
                onmessage: handleTheirMessage,
                onerror: (error) => console.error('Their STT session error:', error.message),
                onclose: (event) => console.log('Their STT session closed:', event.reason)
            }
        };

        [mySttSession, theirSttSession] = await Promise.all([
            connectToOpenAiSession(API_KEY, mySttConfig, keyType),
            connectToOpenAiSession(API_KEY, theirSttConfig, keyType),
        ]);

        console.log("✅ Both STT sessions initialized successfully.");
        // startAnalysisInterval();
        triggerAnalysisIfNeeded();

        sendToRenderer('session-state-changed', { isActive: true });

        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Connected. Ready to listen.');
        return true;

    } catch (error) {
        console.error('❌ Failed to initialize OpenAI STT sessions:', error);
        isInitializingSession = false;
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Initialization failed.');
        mySttSession = null;
        theirSttSession = null;
        return false;
    }
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture() {
    if (process.platform !== 'darwin' || !theirSttSession) return false;

    await killExistingSystemAudioDump();
    console.log('Starting macOS audio capture for "Them"...');

    const { app } = require('electron');
    const path = require('path');
    let systemAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'SystemAudioDump')
        : path.join(__dirname, '../../assets', 'SystemAudioDump');

    console.log('SystemAudioDump path:', systemAudioPath);

    systemAudioProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1; // 500ms -> 100ms로 복원하여 더 빠른 반응성 추구
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    // ⭐️ [수정 1] 이벤트 핸들러를 async 함수로 변경
    systemAudioProc.stdout.on('data', async data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        // console.log(`System audio data received, buffer length: ${audioBuffer.length}`); // DEBUG

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = monoChunk.toString('base64');

            sendToRenderer('system-audio-data', { data: base64Data });

            if (theirSttSession) {
                // ⭐️ [수정 2] try...catch와 await 사용
                try {
                    // console.log('Sending system audio chunk to OpenAI...'); // DEBUG
                    // await theirSttSession.sendRealtimeInput({
                    //     audio: { data: base64Data, mimeType: 'audio/pcm;rate=24000' },
                    // });
                    await theirSttSession.sendRealtimeInput(base64Data);
                } catch (err) {
                    console.error('Error sending system audio:', err.message);
                }
            }

            if (process.env.DEBUG_AUDIO) {
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToOpenAI(base64Data, sttSessionRef) {
    if (!sttSessionRef.current) return;

    try {
        process.stdout.write('.');
        await sttSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to OpenAI:', error);
    }
}

function isSessionActive() {
    return !!mySttSession && !!theirSttSession;
}

async function closeSession() {
    try {
        stopMacOSAudioCapture();
        stopAnalysisInterval(); // 분석 인터벌 중지

        if (currentSessionId) {
            await sqliteClient.endSession(currentSessionId);
            console.log(`[DB] Session ${currentSessionId} ended.`);
        }

        const closePromises = [];
        if (mySttSession) {
            closePromises.push(mySttSession.close());
            mySttSession = null;
        }
        if (theirSttSession) {
            closePromises.push(theirSttSession.close());
            theirSttSession = null;
        }

        await Promise.all(closePromises);
        console.log('All sessions closed.');
        
        // 세션 상태 초기화
        currentSessionId = null;
        conversationHistory = [];

        sendToRenderer('session-state-changed', { isActive: false });
        sendToRenderer('session-did-close'); // Notify manager to hide window

        return { success: true };
    } catch (error) {
        console.error('Error closing sessions:', error);
        return { success: false, error: error.message };
    }
}

function setupLiveSummaryIpcHandlers() {
    // New handler to check session status
    ipcMain.handle('is-session-active', async () => {
        // A session is considered active if the STT session objects exist.
        const isActive = isSessionActive();
        console.log(`Checking session status. Active: ${isActive}`);
        return isActive;
    });

    ipcMain.handle('initialize-openai', async (event, profile = 'interview', language = 'en') => {
        // The API key from .env is used within initializeLiveSummarySession.
        console.log(`Received initialize-openai request with profile: ${profile}, language: ${language}`);
        const success = await initializeLiveSummarySession();
        return success;
    });

    // send-audio-content 핸들러: 사용자 마이크 오디오를 'mySttSession'으로 전송
    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (!mySttSession) return { success: false, error: 'User STT session not active' };
        try {
            // console.log('Received mic audio data from renderer.'); // DEBUG
            // process.stdout.write('M'); // 'M' for My audio
            // await mySttSession.sendRealtimeInput({
            //     audio: { data: data, mimeType: mimeType },
            // });
            await mySttSession.sendRealtimeInput(data);
            return { success: true };
        } catch (error) {
            console.error('Error sending user audio:', error);
            return { success: false, error: error.message };
        }
    });

    // start-macos-audio 핸들러: 시스템 오디오 캡처 시작 (내부적으로 'theirSttSession' 사용)
    ipcMain.handle('start-macos-audio', async () => {
        if (process.platform !== 'darwin') {
            return { success: false, error: 'macOS audio capture only available on macOS' };
        }
        try {
            const success = await startMacOSAudioCapture();
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    // ⭐️ [수정 2] 누락된 stop-macos-audio 핸들러 추가
    ipcMain.handle('stop-macos-audio', async () => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });


    // 텍스트 메시지 및 분석 요청은 이제 renderer.js에서 처리됨
    // renderer.js에서 새로운 chatModel을 생성하고 대화내역 + 스크린샷과 함께 전송

    // 대화 기록을 renderer로 제공하는 핸들러
    ipcMain.handle('get-conversation-history', async () => {
        try {
            const formattedHistory = formatConversationForPrompt(conversationHistory);
            console.log(`📤 Sending conversation history to renderer: ${conversationHistory.length} texts`);
            return { success: true, data: formattedHistory };
        } catch (error) {
            console.error('Error getting conversation history:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async () => {
        return await closeSession();
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeLiveSummarySession,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToOpenAI,
    setupLiveSummaryIpcHandlers,
    isSessionActive,
    closeSession,
};
