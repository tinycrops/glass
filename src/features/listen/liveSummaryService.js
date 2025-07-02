require('dotenv').config();
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('./audioUtils.js');
const { getSystemPrompt } = require('../../common/prompts/promptBuilder.js');
const { connectToOpenAiSession, createOpenAiGenerativeClient, getOpenAiGenerativeModel } = require('../../common/services/openAiClient.js');
const sqliteClient = require('../../common/services/sqliteClient');
const dataService = require('../../common/services/dataService');

const {isFirebaseLoggedIn,getCurrentFirebaseUser} = require('../../electron/windowManager.js');

function getApiKey() {
    const { getStoredApiKey } = require('../../electron/windowManager.js');
    const storedKey = getStoredApiKey();
    
    if (storedKey) {
        console.log('[LiveSummaryService] Using stored API key');
        return storedKey;
    }
    
    const envKey = process.env.OPENAI_API_KEY
    if (envKey) {
        console.log('[LiveSummaryService] Using environment API key');
        return envKey;
    }
    
    console.error('[LiveSummaryService] No API key found in storage or environment');
    return null;
}

let currentSessionId = null;
let conversationHistory = [];
let isInitializingSession = false;

let mySttSession = null;
let theirSttSession = null;
let myCurrentUtterance = '';
let theirCurrentUtterance = '';

let myLastPartialText = '';
let theirLastPartialText = '';
let myInactivityTimer = null;
let theirInactivityTimer = null;
const INACTIVITY_TIMEOUT = 3000;

// ---------------------------------------------------------------------------
// 🎛️  Turn-completion debouncing
// ---------------------------------------------------------------------------
// Very aggressive VAD (e.g. 50 ms) tends to split one spoken sentence into
// many "completed" events.  To avoid creating a separate chat bubble for each
// of those micro-turns we debounce the *completed* events per speaker.  Any
// completions that arrive within this window are concatenated and flushed as
// **one** final turn.

const COMPLETION_DEBOUNCE_MS = 2000;

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
    myCompletionBuffer += (myCompletionBuffer ? ' ' : '') + text;

    if (myCompletionTimer) clearTimeout(myCompletionTimer);
    myCompletionTimer = setTimeout(flushMyCompletion, COMPLETION_DEBOUNCE_MS);
}

function debounceTheirCompletion(text) {
    theirCompletionBuffer += (theirCompletionBuffer ? ' ' : '') + text;

    if (theirCompletionTimer) clearTimeout(theirCompletionTimer);
    theirCompletionTimer = setTimeout(flushTheirCompletion, COMPLETION_DEBOUNCE_MS);
}

let systemAudioProc = null;

let analysisIntervalId = null;

/**
 * Converts conversation history into text to include in the prompt.
 * @param {Array<string>} conversationTexts - Array of conversation texts ["me: ~~~", "them: ~~~", ...]
 * @param {number} maxTurns - Maximum number of recent turns to include
 * @returns {string} - Formatted conversation string for the prompt
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
    
    const basePrompt = getSystemPrompt('cluely_analysis_latest', '', false);
    const systemPrompt = basePrompt.replace('{{CONVERSATION_HISTORY}}', recentConversation);
    console.log(`📋 Generated system prompt with conversation history`);

    try {
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
            ? {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type' : 'application/json',
                }
            : {
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
        
        if (currentSessionId) {
            await sqliteClient.addAiMessage({
                sessionId: currentSessionId,
                role: 'user',
                content: 'Analyze the conversation and provide a summary...' // Abridged
            });

            await sqliteClient.addAiMessage({
                sessionId: currentSessionId,
                role: 'assistant',
                content: responseText
            });

            await sqliteClient.saveSummary({
                sessionId: currentSessionId,
                tldr: structuredData.topic.header || 'Summary not available.',
                text: responseText,
                bullet_json: JSON.stringify(structuredData.summary),
                action_json: JSON.stringify(structuredData.actions)
            });
            console.log(`[DB] Saved AI analysis and summary for session ${currentSessionId}`);
        }

        return structuredData;
        
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
 * Parses AI's analysis response to extract structured summaries, key topics and action items.
 * This version first finds all bold headers to divide text into sections, then parses the content of each section.
 * Header tags (**...**) are removed from summary items.
 *
 * @param {string} responseText - Raw text response from AI.
 * @returns {{summary: string[], topic: {header: string, bullets: string[]}, actions: string[]}} - Structured data.
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
        let currentSection = { header: 'Introduction', content: [] };

        for (const line of lines) {
            const headerMatch = line.trim().match(/^\*\*(.*)\*\*$/);
            
            if (headerMatch && !line.trim().startsWith('-')) {
                if (currentSection.header || currentSection.content.length > 0) {
                    sections.push(currentSection);
                }
                currentSection = { header: headerMatch[1].trim(), content: [] };
            } else {
                currentSection.content.push(line);
            }
        }
        sections.push(currentSection);

        for (const section of sections) {
            const headerText = section.header.toLowerCase().replace(/:$/, '').trim();
            const contentText = section.content.join('\n');

            const summaryKeywords = ['summary', 'key', 'topic', 'main', 'point', 'overview', 'headline'];
            if (summaryKeywords.some(k => headerText.includes(k)) || headerText === 'introduction') {
                const pointRegex = /^\s*[-\*]\s*\*\*(?<header>[^:]+):\*\*(?<description>(?:.|\n(?!\s*[-\*]))*)/gm;
                const allPoints = [...contentText.matchAll(pointRegex)];

                for (const match of allPoints) {
                    const { header, description } = match.groups;
                    
                    if (!structuredData.topic.header) {
                        structuredData.topic.header = `${header.trim()}:`;
                        console.log('📌 Found main topic header:', structuredData.topic.header);
                        if (description.trim()) {
                            const topicBullets = description.trim().split('\n').map(l => l.trim()).filter(Boolean);
                            structuredData.topic.bullets.push(...topicBullets);
                            topicBullets.forEach(b => console.log('📌 Found topic bullet:', b));
                        }
                    } else { 
                        const summaryDescription = description.trim().replace(/\s+/g, ' ');
                        structuredData.summary.push(summaryDescription);
                        console.log('📌 Found summary point:', summaryDescription);
                    }
                }
            }

            const explanationKeywords = ['extended', 'explanation'];
            if (explanationKeywords.some(k => headerText.includes(k))) {
                const sentences = contentText.trim().split(/\.\s+/)
                    .filter(s => s.trim().length > 0)
                    .map(s => s.trim() + (s.endsWith('.') ? '' : '.'));
                    
                structuredData.topic.bullets.push(...sentences.slice(0, 3));
                sentences.slice(0, 3).forEach(b => console.log('📌 Found explanation bullet:', b));
            }

           

            const questionKeywords = ['suggest', 'follow-up', 'question'];
            if (questionKeywords.some(k => headerText.includes(k))) {
                const questionLines = contentText.split('\n')
                    .map(line => line.replace(/^\s*(\d+\.|-|\*)\s*/, '').trim())
                    .filter(line => line.includes('?') && line.length > 10);
                
                structuredData.actions.push(...questionLines.slice(0, 3));
                questionLines.slice(0, 3).forEach(q => console.log('📌 Found question:', q));
            }
        }

        const fixedActions = ["What should i say next?", "Suggest follow-up questions"];
        structuredData.actions = [...new Set([...structuredData.actions, ...fixedActions])];

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
 * Triggers analysis when conversation history reaches 5 texts.
 */
async function triggerAnalysisIfNeeded() {
    if (conversationHistory.length >= 5 && conversationHistory.length % 5 === 0) {
        console.log(`🚀 Triggering analysis (non-blocking) - ${conversationHistory.length} conversation texts accumulated`);
        
        makeOutlineAndRequests(conversationHistory).then(data => {
            if (data) {
                console.log('📤 Sending structured data to renderer');
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
 * Schedules periodic updates of outline and analysis every 10 seconds. - DEPRECATED
 * Now analysis is triggered every 5 conversation texts.
 */
function startAnalysisInterval() {
    console.log('⏰ Analysis will be triggered every 5 conversation texts (not on timer)');
    
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

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        conversationHistory: conversationHistory,
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
            speaker: speaker,
            text: transcription.trim(),
        });
        console.log(`[DB] Saved transcript for session ${currentSessionId}: (${speaker})`);

        const conversationText = `${speaker.toLowerCase()}: ${transcription.trim()}`;
        conversationHistory.push(conversationText);
        console.log(`💬 Saved conversation text: ${conversationText}`);
        console.log(`📈 Total conversation history: ${conversationHistory.length} texts`);

        triggerAnalysisIfNeeded();

        const conversationTurn = {
            speaker: speaker,
            timestamp: Date.now(),
            transcription: transcription.trim(),
        };
        sendToRenderer('update-live-transcription', { turn: conversationTurn });
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
        const handleMyMessage = message => {
            const type = message.type;
            const text = message.transcript || message.delta ||(message.alternatives && message.alternatives[0]?.transcript) || '';

            if (type === 'conversation.item.input_audio_transcription.delta') {
                if (myCompletionTimer) {
                    clearTimeout(myCompletionTimer);
                    myCompletionTimer = null;
                }

                myCurrentUtterance += text;

                const continuousText = myCompletionBuffer + (myCompletionBuffer ? ' ' : '') + myCurrentUtterance;

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
                    const finalUtteranceText = text.trim();
                    myCurrentUtterance = '';

                    debounceMyCompletion(finalUtteranceText);
                }
            } else if (message.error) {
                console.error('[Me] STT Session Error:', message.error);
            }
        };

        const handleTheirMessage = message => {
            const type = message.type;
            const text = message.transcript || message.delta ||(message.alternatives && message.alternatives[0]?.transcript) || '';

            if (type === 'conversation.item.input_audio_transcription.delta') {
                if (theirCompletionTimer) {
                    clearTimeout(theirCompletionTimer);
                    theirCompletionTimer = null;
                }
                
                theirCurrentUtterance += text;

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
                    const finalUtteranceText = text.trim();
                    theirCurrentUtterance = '';

                    debounceTheirCompletion(finalUtteranceText);
                }
            } else if (message.error) {
                console.error('[Them] STT Session Error:', message.error);
            }
        };

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

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', async data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;
            const base64Data = monoChunk.toString('base64');

            sendToRenderer('system-audio-data', { data: base64Data });

            if (theirSttSession) {
                try {
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
        stopAnalysisInterval();

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
        
        currentSessionId = null;
        conversationHistory = [];

        sendToRenderer('session-state-changed', { isActive: false });
        sendToRenderer('session-did-close');

        return { success: true };
    } catch (error) {
        console.error('Error closing sessions:', error);
        return { success: false, error: error.message };
    }
}

function setupLiveSummaryIpcHandlers() {
    ipcMain.handle('is-session-active', async () => {
        const isActive = isSessionActive();
        console.log(`Checking session status. Active: ${isActive}`);
        return isActive;
    });

    ipcMain.handle('initialize-openai', async (event, profile = 'interview', language = 'en') => {
        console.log(`Received initialize-openai request with profile: ${profile}, language: ${language}`);
        const success = await initializeLiveSummarySession();
        return success;
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (!mySttSession) return { success: false, error: 'User STT session not active' };
        try {
            await mySttSession.sendRealtimeInput(data);
            return { success: true };
        } catch (error) {
            console.error('Error sending user audio:', error);
            return { success: false, error: error.message };
        }
    });

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

    ipcMain.handle('stop-macos-audio', async () => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });


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
