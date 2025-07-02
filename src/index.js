try {
    const reloader = require('electron-reloader');
    reloader(module, {
        // 추가 옵션: 특정 파일/폴더 감시 또는 무시
        // ignore: ['path/to/ignore', /regex/],
        // watch: ['path/to/watch']
    });
} catch (err) {
    // electron-reloader가 devDependency이므로, 프로덕션에서는 에러가 날 수 있습니다.
    // 여기서 에러를 무시합니다.
}

require('dotenv').config();

if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { createWindows } = require('./electron/windowManager.js');
const { setupLiveSummaryIpcHandlers, stopMacOSAudioCapture } = require('./features/listen/liveSummaryService.js');
const databaseInitializer = require('./common/services/databaseInitializer');
const dataService = require('./common/services/dataService');
const path = require('node:path');
const { Deeplink } = require('electron-deeplink');
const express = require('express');
const fetch = require('node-fetch');

let WEB_PORT = 3000;

const openaiSessionRef = { current: null };

console.log('>>> [index.js] 모듈 로딩 완료');

function createMainWindows() {
    console.log('>>> [index.js] createMainWindows 함수 호출됨');
    createWindows();
    console.log('>>> [index.js] createWindows 함수 실행 완료');

    const { windowPool } = require('./electron/windowManager');
    deeplink.mainWindow = windowPool.get('header');
}

const deeplink = new Deeplink({
    app,
    mainWindow: null,     
    protocol: 'pickleglass',
    isDev: !app.isPackaged,
    debugLogging: true
  });
  
  deeplink.on('received', (url) => {
    console.log('[deeplink] received:', url);
    handleCustomUrl(url);
  });

app.whenReady().then(async () => {
    console.log('>>> [index.js] app is ready');

    // 단일 인스턴스 잠금. 앱의 다른 인스턴스가 실행되는 것을 방지합니다.
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    } else {
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            // 다른 인스턴스가 실행되려고 할 때, 기존 창을 포커스합니다.
            // URL 처리는 deeplink.on('received')에서 처리됩니다.
            const { windowPool } = require('./electron/windowManager');
            if (windowPool) {
                const header = windowPool.get('header');
                if (header) {
                    if (header.isMinimized()) header.restore();
                    header.focus();
                    return;
                }
            }
            
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) {
                const mainWindow = windows[0];
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        });
    }

    // 1. 데이터베이스 초기화 (웹 스택 시작 전에)
    console.log('>>> [index.js] Initializing database...');
    const dbInitSuccess = await databaseInitializer.initialize();
    if (!dbInitSuccess) {
        console.error('>>> [index.js] Database initialization failed - some features may not work');
    } else {
        console.log('>>> [index.js] Database initialized successfully');
    }

    // 2. 웹 스택 시작
    WEB_PORT = await startWebStack();      // ← 핵심 한 줄
    console.log('Web front-end listening on', WEB_PORT);
    
    setupLiveSummaryIpcHandlers(openaiSessionRef);
    console.log('>>> [index.js] setupLiveSummaryIpcHandlers 설정 완료');
    setupGeneralIpcHandlers();

    createMainWindows();
    console.log('>>> [index.js] 모든 핸들러 설정 완료');
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
    // 데이터베이스 연결 정리
    databaseInitializer.close();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindows();
    }
});
function setupGeneralIpcHandlers() {
    ipcMain.handle('open-external', async (event, url) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            console.error('Error opening external URL:', error);
            return { success: false, error: error.message };
        }
    });

    // API Key IPC Handler
    ipcMain.handle('save-api-key', async (event, apiKey) => {
        try {
            await dataService.saveApiKey(apiKey);
            // Notify all windows of the change
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('api-key-updated');
            });
            return { success: true };
        } catch (error) {
            console.error('IPC: Failed to save API key:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('check-api-key', async () => {
        return await dataService.checkApiKey();
    });

    // Preset IPC Handler
    ipcMain.handle('get-user-presets', async () => {
        return await dataService.getUserPresets();
    });

    // 웹뷰에서 사용자 로그인/모드 변경 시 호출됨
    ipcMain.on('set-current-user', (event, uid) => {
        console.log(`[IPC] set-current-user: ${uid}`);
        dataService.setCurrentUser(uid);
    });

    // Firebase 인증 시작 핸들러 (브라우저에서 로그인)
    ipcMain.handle('start-firebase-auth', async () => {
        try {
            const authUrl = `http://localhost:${WEB_PORT}/login?mode=electron`;
            console.log(`[Auth] Opening Firebase auth URL in browser: ${authUrl}`);
            await shell.openExternal(authUrl);
            return { success: true };
        } catch (error) {
            console.error('[Auth] Failed to open Firebase auth URL:', error);
            return { success: false, error: error.message };
        }
    });

    // 웹뷰에서 Firebase 로그인 성공 시 호출됨
    ipcMain.on('firebase-auth-success', async (event, firebaseUser) => {
        console.log('[IPC] firebase-auth-success:', firebaseUser.uid);
        try {
            // dataService를 통해 Firestore 사용자 정보와 동기화
            await dataService.findOrCreateUser(firebaseUser);
            dataService.setCurrentUser(firebaseUser.uid);
            
            // 다른 창에도 사용자 변경 알림
            BrowserWindow.getAllWindows().forEach(win => {
                if (win !== event.sender.getOwnerBrowserWindow()) {
                    win.webContents.send('user-changed', firebaseUser);
                }
            });
        } catch (error) {
            console.error('[IPC] Failed to handle firebase-auth-success:', error);
        }
    });

    // 동적 API URL 제공
    ipcMain.handle('get-api-url', () => {
        return process.env.pickleglass_API_URL || 'http://localhost:9001';
    });

    // 동적 WEB URL 제공
    ipcMain.handle('get-web-url', () => {
        return process.env.pickleglass_WEB_URL || 'http://localhost:3000';
    });

    // 동기 방식으로도 API URL 제공
    ipcMain.on('get-api-url-sync', (event) => {
        event.returnValue = process.env.pickleglass_API_URL || 'http://localhost:9001';
    });

    // 데이터베이스 관련 IPC 핸들러
    ipcMain.handle('get-database-status', async () => {
        return await databaseInitializer.getStatus();
    });

    ipcMain.handle('reset-database', async () => {
        return await databaseInitializer.reset();
    });

    // This handler returns the current user based on the DataService's state
    ipcMain.handle('get-current-user', async () => {
        try {
            // DataService always knows the current user (local or Firebase)
            const user = await dataService.sqliteClient.getUser(dataService.currentUserId);
            if (user) {
            return {
                    id: user.uid,
                    name: user.display_name,
                    isAuthenticated: user.uid !== 'default_user'
            };
            }
            throw new Error('User not found in DataService');
        } catch (error) {
            console.error('Failed to get current user via DataService:', error);
            // Fallback to a default structure
            return {
                id: 'default_user',
                name: 'Default User',
                isAuthenticated: false
            };
        }
    });

    // Custom drag handlers are now in windowManager.js
}

async function handleCustomUrl(url) {
    try {
        console.log('[Custom URL] Processing URL:', url);
        
        const urlObj = new URL(url);
        const action = urlObj.hostname;
        const params = Object.fromEntries(urlObj.searchParams);
        
        console.log('[Custom URL] Action:', action, 'Params:', params);

        switch (action) {
            case 'login':
            case 'auth-success':
                await handleFirebaseAuthCallback(params);
                break;
            case 'personalize':
                handlePersonalizeFromUrl(params);
                break;
            default:
                // 기본 페이지 이동 처리
                const { windowPool } = require('./electron/windowManager');
                const header = windowPool.get('header');
                if (header) {
                    if (header.isMinimized()) header.restore();
                    header.focus();
                    
                    // 웹뷰 URL 변경 요청
                    const targetUrl = `http://localhost:${WEB_PORT}/${action}`;
                    console.log(`[Custom URL] Navigating webview to: ${targetUrl}`);
                    header.webContents.loadURL(targetUrl);
                }
        }

    } catch (error) {
        console.error('[Custom URL] Error parsing URL:', error);
    }
}

async function handleFirebaseAuthCallback(params) {
    const { token: idToken, uid, email, displayName } = params;
    
    if (!idToken && !uid) {
        console.error('[Auth] Firebase auth callback is missing required data.');
        return;
    }

    console.log('[Auth] Processing Firebase auth callback with data:', { uid, email, displayName });

    try {
        // 사용자 데이터 준비
        const firebaseUser = {
            uid: uid,
            email: email || 'no-email@example.com',
            displayName: displayName || 'User',
            idToken: idToken  // Token received from deeplink
        };

        // dataService를 통해 사용자 정보 동기화
        await dataService.findOrCreateUser(firebaseUser);
        dataService.setCurrentUser(uid);

        // 🔑 Firebase 인증 성공 시 바로 virtual key 발급
        if (firebaseUser.email && firebaseUser.idToken) {
            try {
                const { getVirtualKeyByEmail, setApiKey } = require('./electron/windowManager');
                console.log('[Auth] Fetching virtual key for:', firebaseUser.email);
                const vKey = await getVirtualKeyByEmail(firebaseUser.email, firebaseUser.idToken);
                console.log('[Auth] Virtual key fetched successfully');
                
                // Save API key
                await setApiKey(vKey);
                console.log('[Auth] Virtual key saved successfully');
                
                // Update Firebase user state
                const { setCurrentFirebaseUser } = require('./electron/windowManager');
                setCurrentFirebaseUser(firebaseUser);
                
                // Notify all windows
                const { windowPool } = require('./electron/windowManager');
                windowPool.forEach(win => {
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('api-key-updated');
                        win.webContents.send('firebase-user-updated', firebaseUser);
                    }
                });
            } catch (error) {
                console.error('[Auth] Virtual key fetch failed:', error);
            }
        }

        // 헤더 창에 로그인 성공 신호 전송
        const { windowPool } = require('./electron/windowManager');
        const header = windowPool.get('header');
        if (header) {
            if (header.isMinimized()) header.restore();
            header.focus();
            
            console.log('[Auth] Sending firebase-auth-success to header window');
            header.webContents.send('firebase-auth-success', firebaseUser);
            
            // AppHeader로 전환하기 위한 로그인 성공 신호
            header.webContents.send('login-successful', { 
                customToken: null, 
                user: firebaseUser,
                success: true 
            });
        } else {
            console.error('[Auth] Header window not found');
        }

        // 모든 창에 사용자 변경 알림
        BrowserWindow.getAllWindows().forEach(win => {
            if (win !== header) {
                win.webContents.send('user-changed', firebaseUser);
            }
        });

        console.log('[Auth] Firebase authentication completed successfully');
        
    } catch (error) {
        console.error('[Auth] Error during Firebase auth callback:', error);
        
        // 실패 시에도 헤더 UI 업데이트
        const { windowPool } = require('./electron/windowManager');
        const header = windowPool.get('header');
        if (header) {
            header.webContents.send('login-successful', { 
                error: 'authentication_failed',
                message: error.message 
            });
        }
    }
}

function handlePersonalizeFromUrl(params) {
    console.log('[Custom URL] Personalize params:', params);
    
    // 개인화/설정 페이지로 이동
    const { windowPool } = require('./electron/windowManager');
    const header = windowPool.get('header');
    
    if (header) {
        if (header.isMinimized()) header.restore();
        header.focus();
        
        // 설정 페이지로 이동
        const personalizeUrl = `http://localhost:${WEB_PORT}/settings`;
        console.log(`[Custom URL] Navigating to personalize page: ${personalizeUrl}`);
        header.webContents.loadURL(personalizeUrl);
        
        // 개인화 모드 활성화 신호 전송
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('enter-personalize-mode', {
                message: 'Personalization mode activated',
                params: params
            });
        });
    } else {
        console.error('[Custom URL] Header window not found for personalize');
    }
}


////////// WEB + API 서버 시작 //////////
async function startWebStack() {
  console.log('NODE_ENV =', process.env.NODE_ENV); 
  const isDev = !app.isPackaged;

  // 1. 먼저 포트를 할당받습니다 (서버 시작 없이)
  const getAvailablePort = () => {
    return new Promise((resolve, reject) => {
      const server = require('net').createServer();
      server.listen(0, (err) => {
        if (err) reject(err);
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  };

  const apiPort = await getAvailablePort();
  const frontendPort = await getAvailablePort();

  console.log(`🔧 Allocated ports: API=${apiPort}, Frontend=${frontendPort}`);

  // 2. 환경변수 설정 (백엔드 모듈 로딩 전에!)
  process.env.pickleglass_API_PORT = apiPort.toString();
  process.env.pickleglass_API_URL = `http://localhost:${apiPort}`;
  process.env.pickleglass_WEB_PORT = frontendPort.toString();
  process.env.pickleglass_WEB_URL = `http://localhost:${frontendPort}`;

  console.log(`🌍 Environment variables set:`, {
    pickleglass_API_URL: process.env.pickleglass_API_URL,
    pickleglass_WEB_URL: process.env.pickleglass_WEB_URL
  });

  // 3. 이제 백엔드 모듈을 로드합니다 (환경변수가 설정된 후!)
  const createBackendApp = require('../pickleglass_web/backend_node');
  const nodeApi = createBackendApp(); // 함수 호출로 앱 생성

  // 4. 프론트엔드 서버 시작
  const staticDir = path.join(__dirname, '..', 'pickleglass_web', 'out');
  const fs = require('fs');

  if (!fs.existsSync(staticDir)) {
    console.error(`============================================================`);
    console.error(`[ERROR] Frontend build directory not found!`);
    console.error(`Path: ${staticDir}`);
    console.error(`Please run 'npm run build' inside the 'pickleglass_web' directory first.`);
    console.error(`============================================================`);
    app.quit();
    return;
  }

  // 런타임 설정 파일 생성 (프론트엔드에서 로드할 수 있도록)
  const runtimeConfig = {
    API_URL: `http://localhost:${apiPort}`,
    WEB_URL: `http://localhost:${frontendPort}`,
    timestamp: Date.now()
  };
  
  const configPath = path.join(staticDir, 'runtime-config.json');
  fs.writeFileSync(configPath, JSON.stringify(runtimeConfig, null, 2));
  console.log(`📝 Runtime config created: ${configPath}`);
  console.log(`📝 Runtime config content:`, runtimeConfig);
  
  // 파일 생성 확인
  if (fs.existsSync(configPath)) {
    console.log(`✅ Runtime config file verified: ${configPath}`);
  } else {
    console.error(`❌ Runtime config file creation failed: ${configPath}`);
  }

  const frontSrv = express();
  
  // HTML 파일을 확장자 없이 접근할 수 있도록 미들웨어 추가
  frontSrv.use((req, res, next) => {
    if (req.path.indexOf('.') === -1 && req.path !== '/') {
      const htmlPath = path.join(staticDir, req.path + '.html');
      if (fs.existsSync(htmlPath)) {
        return res.sendFile(htmlPath);
      }
    }
    next();
  });
  
  frontSrv.use(express.static(staticDir));
  
  const frontendServer = await new Promise((resolve, reject) => {
    const server = frontSrv.listen(frontendPort, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
    app.once('before-quit', () => server.close());
  });

  console.log(`✅ Frontend server started on http://localhost:${frontendPort}`);

  // 5. API 서버 시작 (CORS는 이미 백엔드 모듈에서 설정됨)
  const apiSrv = express();
  apiSrv.use(nodeApi); // 백엔드 라우터 마운트

  const apiServer = await new Promise((resolve, reject) => {
    const server = apiSrv.listen(apiPort, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
    app.once('before-quit', () => server.close());
  });

  console.log(`✅ API server started on http://localhost:${apiPort}`);

  console.log(`🚀 All services ready:`);
  console.log(`   Frontend: http://localhost:${frontendPort}`);
  console.log(`   API:      http://localhost:${apiPort}`);

  return frontendPort;
}