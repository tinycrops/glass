import { auth as firebaseAuth } from './firebase';
import { 
  FirestoreUserService, 
  FirestoreSessionService, 
  FirestoreTranscriptService, 
  FirestoreAiMessageService, 
  FirestoreSummaryService, 
  FirestorePromptPresetService,
  FirestoreSession,
  FirestoreTranscript,
  FirestoreAiMessage,
  FirestoreSummary,
  FirestorePromptPreset
} from './firestore';
import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  display_name: string;
  email: string;
}

export interface Session {
  id: string;
  uid: string;
  title: string;
  started_at: number;
  ended_at?: number;
  sync_state: 'clean' | 'dirty';
  updated_at: number;
}

export interface Transcript {
  id: string;
  session_id: string;
  start_at: number;
  end_at?: number;
  speaker?: string;
  text: string;
  lang?: string;
  created_at: number;
  sync_state: 'clean' | 'dirty';
}

export interface AiMessage {
  id: string;
  session_id: string;
  sent_at: number;
  role: 'user' | 'assistant';
  content: string;
  tokens?: number;
  model?: string;
  created_at: number;
  sync_state: 'clean' | 'dirty';
}

export interface Summary {
  session_id: string;
  generated_at: number;
  model?: string;
  text: string;
  tldr: string;
  bullet_json: string;
  action_json: string;
  tokens_used?: number;
  updated_at: number;
  sync_state: 'clean' | 'dirty';
}

export interface PromptPreset {
  id: string;
  uid: string;
  title: string;
  prompt: string;
  is_default: 0 | 1;
  created_at: number;
  sync_state: 'clean' | 'dirty';
}

export interface SessionDetails {
    session: Session;
    transcripts: Transcript[];
    ai_messages: AiMessage[];
    summary: Summary | null;
}

/* ------------------------------------------------------------------ */
/* 듀얼 모드 감지                                                        */
/* ------------------------------------------------------------------ */

// 현재 사용자가 Firebase 모드인지 로컬 모드인지 판단
const isFirebaseMode = (): boolean => {
  return firebaseAuth.currentUser !== null;
};

// Firestore 타임스탬프를 Unix 타임스탬프로 변환
const timestampToUnix = (timestamp: Timestamp): number => {
  return timestamp.seconds * 1000 + Math.floor(timestamp.nanoseconds / 1000000);
};

// Unix 타임스탬프를 Firestore 타임스탬프로 변환
const unixToTimestamp = (unix: number): Timestamp => {
  return Timestamp.fromMillis(unix);
};

// Firestore 데이터를 API 형식으로 변환
const convertFirestoreSession = (session: { id: string } & FirestoreSession, uid: string): Session => {
  return {
    id: session.id,
    uid,
    title: session.title,
    started_at: timestampToUnix(session.startedAt),
    ended_at: session.endedAt ? timestampToUnix(session.endedAt) : undefined,
    sync_state: 'clean',
    updated_at: timestampToUnix(session.startedAt)
  };
};

const convertFirestoreTranscript = (transcript: { id: string } & FirestoreTranscript): Transcript => {
  return {
    id: transcript.id,
    session_id: '', // 세션 ID는 따로 설정
    start_at: timestampToUnix(transcript.startAt),
    end_at: transcript.endAt ? timestampToUnix(transcript.endAt) : undefined,
    speaker: transcript.speaker,
    text: transcript.text,
    lang: transcript.lang,
    created_at: timestampToUnix(transcript.createdAt),
    sync_state: 'clean'
  };
};

const convertFirestoreAiMessage = (message: { id: string } & FirestoreAiMessage): AiMessage => {
  return {
    id: message.id,
    session_id: '', // 세션 ID는 따로 설정
    sent_at: timestampToUnix(message.sentAt),
    role: message.role,
    content: message.content,
    tokens: message.tokens,
    model: message.model,
    created_at: timestampToUnix(message.createdAt),
    sync_state: 'clean'
  };
};

const convertFirestoreSummary = (summary: FirestoreSummary, sessionId: string): Summary => {
  return {
    session_id: sessionId,
    generated_at: timestampToUnix(summary.generatedAt),
    model: summary.model,
    text: summary.text,
    tldr: summary.tldr,
    bullet_json: JSON.stringify(summary.bulletPoints),
    action_json: JSON.stringify(summary.actionItems),
    tokens_used: summary.tokensUsed,
    updated_at: timestampToUnix(summary.generatedAt),
    sync_state: 'clean'
  };
};

const convertFirestorePreset = (preset: { id: string } & FirestorePromptPreset, uid: string): PromptPreset => {
  return {
    id: preset.id,
    uid,
    title: preset.title,
    prompt: preset.prompt,
    is_default: preset.isDefault ? 1 : 0,
    created_at: timestampToUnix(preset.createdAt),
    sync_state: 'clean'
  };
};

/* ------------------------------------------------------------------ */
/* ① API 기본 주소 (로컬 모드용)                                          */
/*    - 런타임 설정 파일에서 동적으로 가져오거나 fallback 사용            */

let API_ORIGIN = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9001'
  : '';

// 런타임 설정 로드 (정적 파일 환경에서 사용)
const loadRuntimeConfig = async (): Promise<string | null> => {
  try {
    const response = await fetch('/runtime-config.json');
    if (response.ok) {
      const config = await response.json();
      console.log('✅ Runtime config loaded:', config);
      return config.API_URL;
    }
  } catch (error) {
    console.log('⚠️ Failed to load runtime config:', error);
  }
  return null;
};

// Electron 환경에서 동적 API URL 가져오기 (IPC 방식)
const getApiUrlFromElectron = (): string | null => {
  if (typeof window !== 'undefined') {
    try {
      const { ipcRenderer } = window.require?.('electron') || {};
      if (ipcRenderer) {
        try {
          const apiUrl = ipcRenderer.sendSync('get-api-url-sync');
          if (apiUrl) {
            console.log('✅ API URL from Electron IPC:', apiUrl);
            return apiUrl;
          }
        } catch (error) {
          console.log('⚠️ Electron IPC failed:', error);
        }
      }
    } catch (error) {
      console.log('ℹ️ Not in Electron environment');
    }
  }
  return null;
};

// API URL 초기화 상태 추적
let apiUrlInitialized = false;
let initializationPromise: Promise<void> | null = null;

// API URL 초기화 (비동기)
const initializeApiUrl = async () => {
  if (apiUrlInitialized) return;
  
  // 1. Electron IPC 시도
  const electronUrl = getApiUrlFromElectron();
  if (electronUrl) {
    API_ORIGIN = electronUrl;
    apiUrlInitialized = true;
    return;
  }

  // 2. 런타임 설정 파일 시도
  const runtimeUrl = await loadRuntimeConfig();
  if (runtimeUrl) {
    API_ORIGIN = runtimeUrl;
    apiUrlInitialized = true;
    return;
  }

  // 3. Fallback 사용
  console.log('📍 Using fallback API URL:', API_ORIGIN);
  apiUrlInitialized = true;
};

// 페이지 로드 시 API URL 초기화
if (typeof window !== 'undefined') {
  initializationPromise = initializeApiUrl();
}

// 사용자 정보 변경 이벤트 리스너들
const userInfoListeners: Array<(userInfo: UserProfile | null) => void> = [];

export const getUserInfo = (): UserProfile | null => {
  if (typeof window === 'undefined') return null;
  
  const storedUserInfo = localStorage.getItem('pickleglass_user');
  if (storedUserInfo) {
    try {
      return JSON.parse(storedUserInfo);
    } catch (error) {
      console.error('사용자 정보 파싱 실패:', error);
      localStorage.removeItem('pickleglass_user');
    }
  }
  return null;
};

export const setUserInfo = (userInfo: UserProfile | null, skipEvents: boolean = false) => {
  if (typeof window === 'undefined') return;
  
  if (userInfo) {
    localStorage.setItem('pickleglass_user', JSON.stringify(userInfo));
  } else {
    localStorage.removeItem('pickleglass_user');
  }
  
  // skipEvents가 true이면 이벤트 발생하지 않음 (logout용)
  if (!skipEvents) {
    // 모든 리스너에게 변경 사항 알림
    userInfoListeners.forEach(listener => listener(userInfo));
    
    // 커스텀 이벤트 발생 (useAuthCheck에서 감지용)
    window.dispatchEvent(new Event('userInfoChanged'));
  }
};

export const onUserInfoChange = (listener: (userInfo: UserProfile | null) => void) => {
  userInfoListeners.push(listener);
  
  // cleanup 함수 반환
  return () => {
    const index = userInfoListeners.indexOf(listener);
    if (index > -1) {
      userInfoListeners.splice(index, 1);
    }
  };
};

export const getApiHeaders = (): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  const userInfo = getUserInfo();
  if (userInfo?.uid) {
    headers['X-User-ID'] = userInfo.uid;
  }
  
  return headers;
};

/* ------------------------------------------------------------------ */
/* ② fetch 래퍼 (로컬 모드용)                                           */
export const apiCall = async (path: string, options: RequestInit = {}) => {
  // API URL이 초기화될 때까지 대기
  if (!apiUrlInitialized && initializationPromise) {
    await initializationPromise;
  }
  
  // 여전히 초기화되지 않았다면 다시 시도
  if (!apiUrlInitialized) {
    await initializeApiUrl();
  }
  
  const url = `${API_ORIGIN}${path}`;
  console.log('🌐 apiCall (Local Mode):', {
    path,
    API_ORIGIN,
    fullUrl: url,
    initialized: apiUrlInitialized,
    timestamp: new Date().toISOString()
  });
  
  const defaultOpts: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...getApiHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  };
  return fetch(url, defaultOpts);
};

/* ------------------------------------------------------------------ */
/* ③ 듀얼 모드 통합 API                                                 */
/* ------------------------------------------------------------------ */

export const searchConversations = async (query: string): Promise<Session[]> => {
  if (!query.trim()) {
    return [];
  }

  if (isFirebaseMode()) {
    // Firebase 모드: Firestore에서 검색 (간단한 구현)
    // 실제로는 Firestore의 full-text 검색이 제한적이므로 클라이언트 측에서 필터링
    const sessions = await getSessions();
    return sessions.filter(session => 
      session.title.toLowerCase().includes(query.toLowerCase())
    );
  } else {
    // 로컬 모드: 백엔드 API 사용
    const response = await apiCall(`/api/conversations/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error('Failed to search conversations');
    }
    return response.json();
  }
};

// --- Session APIs ---
export const getSessions = async (): Promise<Session[]> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    const firestoreSessions = await FirestoreSessionService.getSessions(uid);
    return firestoreSessions.map(session => convertFirestoreSession(session, uid));
  } else {
    const response = await apiCall(`/api/conversations`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  }
};

export const getSessionDetails = async (sessionId: string): Promise<SessionDetails> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    
    // 병렬로 모든 데이터 가져오기
    const [session, transcripts, aiMessages, summary] = await Promise.all([
      FirestoreSessionService.getSession(uid, sessionId),
      FirestoreTranscriptService.getTranscripts(uid, sessionId),
      FirestoreAiMessageService.getAiMessages(uid, sessionId),
      FirestoreSummaryService.getSummary(uid, sessionId)
    ]);

    if (!session) {
      throw new Error('Session not found');
    }

    return {
      session: convertFirestoreSession({ id: sessionId, ...session }, uid),
      transcripts: transcripts.map(t => ({ ...convertFirestoreTranscript(t), session_id: sessionId })),
      ai_messages: aiMessages.map(m => ({ ...convertFirestoreAiMessage(m), session_id: sessionId })),
      summary: summary ? convertFirestoreSummary(summary, sessionId) : null
    };
  } else {
    const response = await apiCall(`/api/conversations/${sessionId}`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch session details');
    return response.json();
  }
};

export const createSession = async (title?: string): Promise<{ id: string }> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    const sessionId = await FirestoreSessionService.createSession(uid, {
      title: title || 'New Session',
      endedAt: undefined
    });
    return { id: sessionId };
  } else {
    const response = await apiCall(`/api/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    if (!response.ok) throw new Error('Failed to create session');
    return response.json();
  }
};

export const deleteSession = async (sessionId: string): Promise<void> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    await FirestoreSessionService.deleteSession(uid, sessionId);
  } else {
    const response = await apiCall(`/api/conversations/${sessionId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete session');
  }
};

// --- User APIs ---
export const getUserProfile = async (): Promise<UserProfile> => {
  if (isFirebaseMode()) {
    const user = firebaseAuth.currentUser!;
    const firestoreProfile = await FirestoreUserService.getUser(user.uid);
    
    return {
      uid: user.uid,
      display_name: firestoreProfile?.displayName || user.displayName || 'User',
      email: firestoreProfile?.email || user.email || 'no-email@example.com'
    };
  } else {
    const response = await apiCall(`/api/user/profile`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch user profile');
    return response.json();
  }
};

export const updateUserProfile = async (data: { displayName: string }): Promise<void> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    await FirestoreUserService.updateUser(uid, { displayName: data.displayName });
  } else {
    const response = await apiCall(`/api/user/profile`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update user profile');
  }
};

export const findOrCreateUser = async (user: UserProfile): Promise<UserProfile> => {
  if (isFirebaseMode()) {
    // Firebase 모드에서는 사용자가 이미 인증되었으므로 Firestore에 사용자 정보 생성/업데이트만 수행
    const uid = firebaseAuth.currentUser!.uid;
    const existingUser = await FirestoreUserService.getUser(uid);
    
    if (!existingUser) {
      await FirestoreUserService.createUser(uid, {
        displayName: user.display_name,
        email: user.email
      });
    }
    
    return user;
  } else {
    const response = await apiCall(`/api/user/find-or-create`, {
        method: 'POST',
        body: JSON.stringify(user),
    });
    if (!response.ok) throw new Error('Failed to find or create user');
    return response.json();
  }
};

export const saveApiKey = async (apiKey: string): Promise<void> => {
  if (isFirebaseMode()) {
    // Firebase 모드에서는 API 키가 필요하지 않음 (무시)
    console.log('Firebase 모드에서는 API 키가 필요하지 않습니다.');
    return;
  } else {
    const response = await apiCall(`/api/user/api-key`, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) throw new Error('Failed to save API key');
  }
};

export const checkApiKeyStatus = async (): Promise<{ hasApiKey: boolean }> => {
  if (isFirebaseMode()) {
    // Firebase 모드에서는 항상 API 키가 있는 것으로 간주
    return { hasApiKey: true };
  } else {
    const response = await apiCall(`/api/user/api-key-status`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to check API key status');
    return response.json();
  }
};

export const deleteAccount = async (): Promise<void> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    
    // Firestore 데이터 삭제
    await FirestoreUserService.deleteUser(uid);
    
    // Firebase Auth 계정 삭제
    await firebaseAuth.currentUser!.delete();
  } else {
    const response = await apiCall(`/api/user/profile`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete account');
  }
};

// --- Preset APIs ---
export const getPresets = async (): Promise<PromptPreset[]> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    const firestorePresets = await FirestorePromptPresetService.getPresets(uid);
    return firestorePresets.map(preset => convertFirestorePreset(preset, uid));
  } else {
    const response = await apiCall(`/api/presets`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch presets');
    return response.json();
  }
};

export const createPreset = async (data: { title: string, prompt: string }): Promise<{ id: string }> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    const presetId = await FirestorePromptPresetService.createPreset(uid, {
      title: data.title,
      prompt: data.prompt,
      isDefault: false
    });
    return { id: presetId };
  } else {
    const response = await apiCall(`/api/presets`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to create preset');
    return response.json();
  }
};

export const updatePreset = async (id: string, data: { title: string, prompt: string }): Promise<void> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    await FirestorePromptPresetService.updatePreset(uid, id, {
      title: data.title,
      prompt: data.prompt
    });
  } else {
    const response = await apiCall(`/api/presets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update preset');
  }
};

export const deletePreset = async (id: string): Promise<void> => {
  if (isFirebaseMode()) {
    const uid = firebaseAuth.currentUser!.uid;
    await FirestorePromptPresetService.deletePreset(uid, id);
  } else {
    const response = await apiCall(`/api/presets/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete preset');
  }
};

// --- Batch API ---
export interface BatchData {
    profile?: UserProfile;
    presets?: PromptPreset[];
    sessions?: Session[];
}

export const getBatchData = async (includes: ('profile' | 'presets' | 'sessions')[]): Promise<BatchData> => {
  if (isFirebaseMode()) {
    const result: BatchData = {};
    
    // 병렬로 요청된 데이터 가져오기
    const promises: Promise<any>[] = [];
    
    if (includes.includes('profile')) {
      promises.push(getUserProfile().then(profile => ({ type: 'profile', data: profile })));
    }
    if (includes.includes('presets')) {
      promises.push(getPresets().then(presets => ({ type: 'presets', data: presets })));
    }
    if (includes.includes('sessions')) {
      promises.push(getSessions().then(sessions => ({ type: 'sessions', data: sessions })));
    }
    
    const results = await Promise.all(promises);
    
    results.forEach(({ type, data }) => {
      result[type as keyof BatchData] = data;
    });
    
    return result;
  } else {
    const response = await apiCall(`/api/user/batch?include=${includes.join(',')}`, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch batch data');
    return response.json();
  }
};

export const logout = async () => {
  if (isFirebaseMode()) {
    const { signOut } = await import('firebase/auth');
    await signOut(firebaseAuth);
  }
  
  // 로컬 사용자 정보도 클리어
  setUserInfo(null);
  
  // localStorage에서 관련 데이터도 정리
  localStorage.removeItem('openai_api_key');
  localStorage.removeItem('user_info');
  
  window.location.href = '/login';
}; 