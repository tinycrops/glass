try {
    const reloader = require('electron-reloader');
    reloader(module, {
    });
} catch (err) {
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

function createMainWindows() {
    createWindows();

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
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return;
    } else {
        app.on('second-instance', (event, commandLine, workingDirectory) => {
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

    const dbInitSuccess = await databaseInitializer.initialize();
    if (!dbInitSuccess) {
        console.error('>>> [index.js] Database initialization failed - some features may not work');
    } else {
        console.log('>>> [index.js] Database initialized successfully');
    }

    WEB_PORT = await startWebStack();
    console.log('Web front-end listening on', WEB_PORT);
    
    setupLiveSummaryIpcHandlers(openaiSessionRef);
    setupGeneralIpcHandlers();

    createMainWindows();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
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

    ipcMain.handle('save-api-key', async (event, apiKey) => {
        try {
            await dataService.saveApiKey(apiKey);
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

    ipcMain.handle('get-user-presets', async () => {
        return await dataService.getUserPresets();
    });

    ipcMain.on('set-current-user', (event, uid) => {
        console.log(`[IPC] set-current-user: ${uid}`);
        dataService.setCurrentUser(uid);
    });

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

    ipcMain.on('firebase-auth-success', async (event, firebaseUser) => {
        console.log('[IPC] firebase-auth-success:', firebaseUser.uid);
        try {
            await dataService.findOrCreateUser(firebaseUser);
            dataService.setCurrentUser(firebaseUser.uid);
            
            BrowserWindow.getAllWindows().forEach(win => {
                if (win !== event.sender.getOwnerBrowserWindow()) {
                    win.webContents.send('user-changed', firebaseUser);
                }
            });
        } catch (error) {
            console.error('[IPC] Failed to handle firebase-auth-success:', error);
        }
    });

    ipcMain.handle('get-api-url', () => {
        return process.env.pickleglass_API_URL || 'http://localhost:9001';
    });

    ipcMain.handle('get-web-url', () => {
        return process.env.pickleglass_WEB_URL || 'http://localhost:3000';
    });

    ipcMain.on('get-api-url-sync', (event) => {
        event.returnValue = process.env.pickleglass_API_URL || 'http://localhost:9001';
    });

    ipcMain.handle('get-database-status', async () => {
        return await databaseInitializer.getStatus();
    });

    ipcMain.handle('reset-database', async () => {
        return await databaseInitializer.reset();
    });

    ipcMain.handle('get-current-user', async () => {
        try {
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
            return {
                id: 'default_user',
                name: 'Default User',
                isAuthenticated: false
            };
        }
    });

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
                const { windowPool } = require('./electron/windowManager');
                const header = windowPool.get('header');
                if (header) {
                    if (header.isMinimized()) header.restore();
                    header.focus();
                    
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
        const firebaseUser = {
            uid: uid,
            email: email || 'no-email@example.com',
            displayName: displayName || 'User',
            idToken: idToken
        };

        await dataService.findOrCreateUser(firebaseUser);
        dataService.setCurrentUser(uid);

        if (firebaseUser.email && firebaseUser.idToken) {
            try {
                const { getVirtualKeyByEmail, setApiKey } = require('./electron/windowManager');
                console.log('[Auth] Fetching virtual key for:', firebaseUser.email);
                const vKey = await getVirtualKeyByEmail(firebaseUser.email, firebaseUser.idToken);
                console.log('[Auth] Virtual key fetched successfully');
                
                await setApiKey(vKey);
                console.log('[Auth] Virtual key saved successfully');
                
                const { setCurrentFirebaseUser } = require('./electron/windowManager');
                setCurrentFirebaseUser(firebaseUser);
                
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

        const { windowPool } = require('./electron/windowManager');
        const header = windowPool.get('header');
        if (header) {
            if (header.isMinimized()) header.restore();
            header.focus();
            
            console.log('[Auth] Sending firebase-auth-success to header window');
            header.webContents.send('firebase-auth-success', firebaseUser);
            
            header.webContents.send('login-successful', { 
                customToken: null, 
                user: firebaseUser,
                success: true 
            });
        } else {
            console.error('[Auth] Header window not found');
        }

        BrowserWindow.getAllWindows().forEach(win => {
            if (win !== header) {
                win.webContents.send('user-changed', firebaseUser);
            }
        });

        console.log('[Auth] Firebase authentication completed successfully');
        
    } catch (error) {
        console.error('[Auth] Error during Firebase auth callback:', error);
        
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
    
    const { windowPool } = require('./electron/windowManager');
    const header = windowPool.get('header');
    
    if (header) {
        if (header.isMinimized()) header.restore();
        header.focus();
        
        const personalizeUrl = `http://localhost:${WEB_PORT}/settings`;
        console.log(`[Custom URL] Navigating to personalize page: ${personalizeUrl}`);
        header.webContents.loadURL(personalizeUrl);
        
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


async function startWebStack() {
  console.log('NODE_ENV =', process.env.NODE_ENV); 
  const isDev = !app.isPackaged;

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

  process.env.pickleglass_API_PORT = apiPort.toString();
  process.env.pickleglass_API_URL = `http://localhost:${apiPort}`;
  process.env.pickleglass_WEB_PORT = frontendPort.toString();
  process.env.pickleglass_WEB_URL = `http://localhost:${frontendPort}`;

  console.log(`🌍 Environment variables set:`, {
    pickleglass_API_URL: process.env.pickleglass_API_URL,
    pickleglass_WEB_URL: process.env.pickleglass_WEB_URL
  });

  const createBackendApp = require('../pickleglass_web/backend_node');
  const nodeApi = createBackendApp();

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

  const runtimeConfig = {
    API_URL: `http://localhost:${apiPort}`,
    WEB_URL: `http://localhost:${frontendPort}`,
    timestamp: Date.now()
  };
  
  const configPath = path.join(staticDir, 'runtime-config.json');
  fs.writeFileSync(configPath, JSON.stringify(runtimeConfig, null, 2));
  console.log(`📝 Runtime config created: ${configPath}`);
  console.log(`📝 Runtime config content:`, runtimeConfig);
  
  if (fs.existsSync(configPath)) {
    console.log(`✅ Runtime config file verified: ${configPath}`);
  } else {
    console.error(`❌ Runtime config file creation failed: ${configPath}`);
  }

  const frontSrv = express();
  
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

  const apiSrv = express();
  apiSrv.use(nodeApi);

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