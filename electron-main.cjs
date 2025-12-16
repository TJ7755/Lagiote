const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { updateElectronApp } = require('update-electron-app');
const path = require('path');
const fs = require('fs');

const isDevMode = !app.isPackaged;
process.env.NODE_ENV = process.env.NODE_ENV || (isDevMode ? 'development' : 'production');

const VITE_CONFIG_PATH = path.join(__dirname, 'vite.config.js');
const DEV_SERVER_DEFAULT_PORT = 5173;
const DEV_SERVER_DEFAULT_HOST = '127.0.0.1';
const SYNC_TIMEOUT_MS = 30000;
const OFFLINE_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EADDRNOTAVAIL',
  'EPIPE',
  'ERR_SOCKET_TIMEOUT'
]);

// Load environment variables from .env.local
function loadEnvFile() {
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env.local')
    : path.join(__dirname, '.env.local');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    let loadedCount = 0;
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
          loadedCount++;
        }
      }
    });
  } else {
    console.error('[Env] .env.local file not found!');
    console.error('[Env] Current directory:', __dirname);
    if (app.isPackaged) {
      console.error('[Env] Resources path:', process.resourcesPath);
      try {
        const files = fs.readdirSync(process.resourcesPath);
        console.error('[Env] Files in resources directory:', files.slice(0, 10));
      } catch (e) {
        console.error('[Env] Could not read resources directory:', e.message);
      }
    }
  }
}

function safeSend(window, channel, ...args) {
  try {
    if (!window) return console.warn(`[SafeSend] No target window for ${channel}`);
    if (window.isDestroyed && window.isDestroyed()) return console.warn(`[SafeSend] Window destroyed for ${channel}`);
    if (!window.webContents) return console.warn(`[SafeSend] No webContents for ${channel}`);
    if (window.webContents.isDestroyed && window.webContents.isDestroyed()) return console.warn(`[SafeSend] webContents destroyed for ${channel}`);
    window.webContents.send(channel, ...args);
  } catch (err) {
    console.error(`[SafeSend] Failed to send ${channel}:`, err && err.message ? err.message : err);
  }
}

let PROXY_URL = process.env.PROXY_URL || 'https://tj7755-lagiote-proxy.hf.space';
if (PROXY_URL.includes('huggingface.co/spaces/')) {
  try {
    const urlObj = new URL(PROXY_URL);
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    if (pathParts.length >= 3 && pathParts[0] === 'spaces') {
      const username = pathParts[1];
      const spacename = pathParts[2];
      PROXY_URL = `https://${username}-${spacename}.hf.space`;
      console.log(`[Config] Converted Web URL to API URL: ${PROXY_URL}`);
    }
  } catch (e) {
    console.error('[Config] Failed to parse/convert PROXY_URL:', e);
  }
}
const NETLIFY_FUNCTION_URL = `${PROXY_URL}/api/generate`;
const DISTRACTOR_FUNCTION_URL = `${PROXY_URL}/api/distractors`;
const AUTOCOMPLETE_FUNCTION_URL = `${PROXY_URL}/api/autocomplete`;

let viteDevServer = null;
let rendererTargetsCache = null;
let rendererDevUrl = null;

function normalizeHost(host) {
  if (!host) return DEV_SERVER_DEFAULT_HOST;
  if (host === '0.0.0.0' || host === '::') return DEV_SERVER_DEFAULT_HOST;
  return host;
}

async function getDevServerUrl() {
  if (rendererDevUrl) {
    return rendererDevUrl;
  }

  const overrideUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL;
  if (overrideUrl) {
    rendererDevUrl = overrideUrl;
    return rendererDevUrl;
  }

  if (!isDevMode) {
    return null;
  }

  try {
    const { createServer } = require('vite');
    const server = await createServer({
      configFile: VITE_CONFIG_PATH,
      logLevel: 'warn',
      clearScreen: false,
      server: {
        host: DEV_SERVER_DEFAULT_HOST,
        port: DEV_SERVER_DEFAULT_PORT,
        strictPort: false
      }
    });

    await server.listen();

    const address = server.httpServer?.address();
    const resolvedPort = (address && address.port) || server.config.server.port || DEV_SERVER_DEFAULT_PORT;
    const resolvedHost = normalizeHost(server.config.server.host);
    const protocol = server.config.server.https ? 'https' : 'http';

    rendererDevUrl = `${protocol}://${resolvedHost}:${resolvedPort}`;
    process.env.VITE_DEV_SERVER_URL = rendererDevUrl;
    viteDevServer = server;
    console.log(`[Dev Server] Vite dev server running at ${rendererDevUrl}`);
    return rendererDevUrl;
  } catch (error) {
    console.error('[Dev Server] Failed to start Vite dev server:', error);
    return null;
  }
}

async function resolveRendererTargets() {
  if (rendererTargetsCache) {
    return rendererTargetsCache;
  }

  const targets = [];
  const devUrl = await getDevServerUrl();
  if (devUrl) {
    targets.push({ type: 'url', value: devUrl });
  }

  const distIndex = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    targets.push({ type: 'file', value: distIndex });
  }

  targets.push({ type: 'file', value: path.join(__dirname, 'index.html') });
  rendererTargetsCache = targets;
  return targets;
}

function classifySyncError(error) {
  const fallbackMessage = 'Unable to sync data. Your changes are saved locally.';
  if (!error) {
    return { type: 'unknown', message: fallbackMessage, status: null, tag: 'unknown' };
  }

  const message = error.message || fallbackMessage;
  if (error.type === 'timeout' || /timeout/i.test(message)) {
    return {
      type: 'timeout',
      message: 'Sync request timed out. Your changes are saved locally and will retry when the network returns.',
      status: null,
      tag: 'timeout'
    };
  }

  if (error.name === 'AbortError') {
    return {
      type: 'timeout',
      message: 'Sync request timed out. Your changes are saved locally and will retry when the network returns.',
      status: null,
      tag: 'timeout'
    };
  }

  if (typeof error.code === 'string' && OFFLINE_ERROR_CODES.has(error.code)) {
    return {
      type: 'offline',
      message: 'Network appears to be offline. Your changes will sync automatically once connectivity is restored.',
      status: null,
      tag: 'offline'
    };
  }

  return {
    type: 'unknown',
    message,
    status: null,
    tag: 'unknown'
  };
}

function loadRendererFromTargets(win, targets, index = 0) {
  if (!win || !Array.isArray(targets) || !targets.length) return;
  const clampedIndex = Math.min(Math.max(index, 0), targets.length - 1);
  const target = targets[clampedIndex];
  win.__rendererTargetIndex = clampedIndex;
  if (target.type === 'url') {
    win.loadURL(target.value);
  } else {
    win.loadFile(target.value);
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets/logo/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      disableBlinkFeatures: 'AutoplayPolicy'
    },
  });

  const rendererTargets = await resolveRendererTargets();
  loadRendererFromTargets(win, rendererTargets, 0);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    const currentIndex = typeof win.__rendererTargetIndex === 'number' ? win.__rendererTargetIndex : 0;
    const nextIndex = currentIndex + 1;
    if (nextIndex < rendererTargets.length) {
      console.warn(`Renderer load failed (${errorCode}: ${errorDesc}) for ${validatedURL || 'unknown URL'}. Falling back to next target.`);
      loadRendererFromTargets(win, rendererTargets, nextIndex);
    }
  });

  win.webContents.on('did-finish-load', () => {
  });

  win.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
    win.reload();
  });

  return win;
}

async function createLoginWindow() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  const authService = require('./services/auth-service');
  const http = require('http');

  let authWindow = null;
  let server = null;
  let hasResolved = false;
  let serverOrigin = null;

  const log = (type, ...args) => {
    const msg = args.map(arg =>
      typeof arg === 'object' && arg !== null ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    console.log(`[Auth Main][${type}] ${msg}`);
  };

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      if (hasResolved) return;

      log('info', 'Received request:', req.url);

      if (req.url.startsWith('/callback')) {
        try {
          const callbackBase = serverOrigin || 'http://localhost';
          const callbackURL = `${callbackBase}${req.url}`;
          log('info', 'Processing callback:', callbackURL);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .container {
                  text-align: center;
                  background: white;
                  padding: 3rem;
                  border-radius: 1rem;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .checkmark {
                  font-size: 4rem;
                  color: #10b981;
                  margin-bottom: 1rem;
                }
                h1 { color: #1f2937; margin: 0 0 0.5rem 0; }
                p { color: #6b7280; margin: 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="checkmark">✓</div>
                <h1>Authentication Successful!</h1>
                <p>You can close this window now.</p>
              </div>
            </body>
            </html>
          `);

          const { accessToken, profile } = await authService.loadTokens(callbackURL);

          log('info', 'Token exchange successful');
          log('info', 'User profile:', profile.email || profile.sub);

          hasResolved = true;

          setTimeout(() => {
            if (authWindow && !authWindow.isDestroyed()) {
              authWindow.close();
            }
          }, 1500);

          resolve({
            type: 'authorization',
            user: {
              id: profile.sub,
              email: profile.email,
              name: profile.name,
              picture: profile.picture,
              nickname: profile.nickname
            },
            token: accessToken,
            accessToken: accessToken
          });

          setTimeout(() => {
            if (server) {
              server.close(() => {
                log('info', 'Server closed');
              });
            }
          }, 2000);

        } catch (error) {
          log('error', 'Token exchange error:', error.message);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Failed</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                }
                .container {
                  text-align: center;
                  background: white;
                  padding: 3rem;
                  border-radius: 1rem;
                  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                }
                .error-icon { font-size: 4rem; color: #ef4444; margin-bottom: 1rem; }
                h1 { color: #1f2937; margin: 0 0 0.5rem 0; }
                p { color: #6b7280; margin: 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error-icon">✕</div>
                <h1>Authentication Failed</h1>
                <p>${error.message || 'Please try again'}</p>
              </div>
            </body>
            </html>
          `);

          hasResolved = true;
          reject({
            message: error.message || 'Token exchange failed',
            name: 'AuthError'
          });

          if (server) {
            server.close();
          }
        }
      }
    });

    const tryPort = (port) => {
      return new Promise((resolvePort, rejectPort) => {
        server.once('error', (err) => {
          if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
            log('warn', `Port ${port} not available: ${err.message}`);
            rejectPort(err);
          } else {
            log('error', 'Server error:', err.message);
            rejectPort(err);
          }
        });

        server.listen(port, 'localhost', () => {
          log('info', `Local callback server listening on http://localhost:${port}`);
          resolvePort(port);
        });
      });
    };

    (async () => {
      let serverPort = null;
      const portsToTry = [80, 8080, 3000, 0];

      for (const port of portsToTry) {
        try {
          serverPort = await tryPort(port);
          if (serverPort === 0) {
            serverPort = server.address().port;
            log('info', `Server started on random port: ${serverPort}`);
          }
          const origin = serverPort === 80 ? 'http://localhost' : `http://localhost:${serverPort}`;
          serverOrigin = origin;
          const redirectUri = `${origin}/callback`;
          authService.setRedirectUri(redirectUri);
          log('info', 'Local callback server origin:', origin);
          log('info', 'Electron redirect URI set to:', redirectUri);
          break;
        } catch (err) {
          if (port === portsToTry[portsToTry.length - 1]) {
            log('error', 'Failed to start server on any port');
            reject({
              message: 'Failed to start local callback server. Please ensure no other application is using ports 80, 8080, or 3000.',
              name: 'ServerStartError'
            });
            return;
          }
          continue;
        }
      }

      if (serverPort !== 80) {
        log('warn', `Using non-standard port ${serverPort}. You may need to update Auth0 allowed callback URLs to http://localhost:${serverPort}/callback`);
      }

      authWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          devTools: true
        },
        parent: mainWindow,
        modal: true,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#f7fafc',
        minimizable: false,
        maximizable: false,
        closable: true,
        fullscreenable: false
      });

      authWindow.on('close', () => {
        log('info', 'Auth window closed');

        if (!hasResolved) {
          hasResolved = true;
          if (server) {
            server.close();
          }
          reject({
            message: 'Authentication window was closed before completion',
            name: 'AuthWindowClosedError'
          });
        }
      });

      try {
        const authURL = authService.getAuthenticationURL();
        log('info', 'Loading Auth0 login page:', authURL);

        authWindow.loadURL(authURL);
        authWindow.once('ready-to-show', () => {
          authWindow.show();
        });
      } catch (error) {
        log('error', 'Failed to get authentication URL:', error.message);
        if (server) {
          server.close();
        }
        reject({
          message: error.message || 'Failed to start authentication',
          name: 'AuthConfigError'
        });
      }
    })();
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[Auto-Update] Skipping updater setup - not in packaged build');
    return;
  }

  console.log('[Auto-Update] Setting up auto-updater for packaged build');

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'TJ7755',
    repo: 'Lagiote-revise'
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('[Auto-Update] Checking for update...');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', { event: 'checking-for-update' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Auto-Update] Update available:', info.version);
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', {
        event: 'update-available',
        info: { version: info.version, releaseDate: info.releaseDate }
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Auto-Update] Update not available');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', { event: 'update-not-available' });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    console.log('[Auto-Update] Download progress:', progressObj.percent + '%');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', {
        event: 'download-progress',
        progress: {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total,
          bytesPerSecond: progressObj.bytesPerSecond
        }
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Auto-Update] Update downloaded:', info.version);
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', {
        event: 'update-downloaded',
        info: { version: info.version, releaseDate: info.releaseDate }
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Auto-Update] Error:', err.message);
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      safeSend(mainWindow, 'update-status', {
        event: 'error',
        error: err.message
      });
    }
  });

  // Check for updates immediately and then every hour
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 60 * 60 * 1000); // 1 hour
}

app.whenReady().then(async () => {
  loadEnvFile();

  if (app.isPackaged && (!process.env.ELECTRON_AUTH0_DOMAIN || !process.env.ELECTRON_AUTH0_CLIENT_ID)) {
    console.warn('[Env] Auth0 credentials not found in .env.local for packaged app, using fallback');
    process.env.ELECTRON_AUTH0_DOMAIN = process.env.ELECTRON_AUTH0_DOMAIN || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
    process.env.ELECTRON_AUTH0_CLIENT_ID = process.env.ELECTRON_AUTH0_CLIENT_ID || 'olTWu5ifjiTKIoqfMGpF2FScFvuQI5ZW';
  }

  if (!process.env.ELECTRON_AUTH0_AUDIENCE) {
    console.warn('[Env] ELECTRON_AUTH0_AUDIENCE not found, using default fallback');
    process.env.ELECTRON_AUTH0_AUDIENCE = 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/';
  }

  // Initialise update-electron-app in main process only when packaged
  if (app.isPackaged) {
    try {
      updateElectronApp({
        repo: 'TJ7755/Lagiote-revise',
        updateInterval: '1 hour',
        logger: console
      });
      console.log('[Auto-Update] update-electron-app initialised');
    } catch (e) {
      console.error('[Auto-Update] Failed to initialise update-electron-app', e && e.message ? e.message : e);
    }
  }

  setupAutoUpdater();

  app.setAsDefaultProtocolClient("lagioterevise");
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  if (!viteDevServer) return;
  try {
    await viteDevServer.close();
  } catch (error) {
    console.error('[Dev Server] Failed to close Vite dev server:', error);
  }
});

ipcMain.handle('checkForUpdates', async () => {
  if (!app.isPackaged) {
    throw new Error('Auto-updating is only available in packaged builds');
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to check for updates: ${error.message}`);
  }
});

ipcMain.handle('quitAndInstallUpdate', async () => {
  if (!app.isPackaged) {
    throw new Error('Auto-updating is only available in packaged builds');
  }
  autoUpdater.quitAndInstall();
});

ipcMain.handle('open-login-window', async () => {
  try {
    return await createLoginWindow();
  } catch (error) {
    console.error('Login window error:', error);
    let errorMessage = error.message || 'Login window failed';
    if (typeof error === 'object' && error !== null) {
      try {
        errorMessage = JSON.stringify(error, Object.getOwnPropertyNames(error));
      } catch (e) {
        errorMessage = 'Unknown error object';
      }
    }
    throw new Error(errorMessage);
  }
});

ipcMain.handle('generate-distractors', async (event, { question, answer }) => {
  try {
    const response = await Promise.race([
      fetch(DISTRACTOR_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.distractors || [];
  } catch (fetchError) {
    console.error('Distractor generation error:', fetchError.message);
    return {
      error: 'offline',
      message: 'Cannot generate distractors offline. Saved decks will work without AI features.',
      offline: true
    };
  }
});

ipcMain.handle('gemini-generate-deck', async (event, { documents, cardType = 'flashcard' }) => {
  try {
    const response = await Promise.race([
      fetch(NETLIFY_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents, cardType })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 10000))
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('AI generation error:', error);
    console.error('Error details:', error.message, error.stack);
    return {
      error: 'offline',
      message: error.message || 'Cannot generate cards offline. Please check your internet connection or try again later.',
      offline: true,
      originalError: error.message
    };
  }
});

ipcMain.handle('gemini-autocomplete', async (event, { deckContent, currentCard, fieldType }) => {
  try {
    const response = await Promise.race([
      fetch(AUTOCOMPLETE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckContent, currentCard, fieldType })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 15000))
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('AI autocomplete error:', error);
    return {
      error: 'offline',
      message: 'Cannot generate autocomplete offline. Please check your internet connection.',
      offline: true,
      originalError: error.message
    };
  }
});

ipcMain.handle('sync-data', async (event, arg) => {
  const { token, guestId, ...syncPayload } = arg;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (guestId) {
    headers['X-Guest-ID'] = guestId;
  }

  let timeoutId;
  try {
    const response = await Promise.race([
      fetch(`${PROXY_URL}/api/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(syncPayload)
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error('Sync timeout');
          timeoutError.type = 'timeout';
          reject(timeoutError);
        }, SYNC_TIMEOUT_MS);
      })
    ]);

    if (response.status === 401) {
      return {
        ok: false,
        error: 'auth_error',
        type: 'http',
        status: 401,
        statusCode: 401,
        message: 'Session expired or invalid (401)',
        originalError: `HTTP ${response.status}`
      };
    }

    if (!response.ok) {
      const statusErrorMessage = `Sync failed with status ${response.status}`;
      return {
        ok: false,
        error: 'http_error',
        type: 'http',
        status: response.status,
        message: statusErrorMessage,
        originalError: `${statusErrorMessage}${response.statusText ? ` (${response.statusText})` : ''}`
      };
    }

    const data = await response.json();
    return { ...data, ok: true };
  } catch (error) {
    console.error('Sync error:', error);
    const classification = classifySyncError(error);
    return {
      ok: false,
      error: classification.tag,
      type: classification.type,
      status: classification.status,
      message: classification.message,
      originalError: error && error.message ? error.message : undefined
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }
});

// FSRS calculations handled in the main process to avoid sandbox issues
const { fsrs, State, Rating } = require('ts-fsrs');
const f = fsrs();

ipcMain.handle('get-fsrs-enums', () => {
  return { State, Rating };
});

ipcMain.handle('fsrs-repeat', (event, card, now) => {
  try {
    const cardForFsrs = {
        ...card,
        due: new Date(card.due),
        last_review: new Date(card.last_review),
    };
    return f.repeat(cardForFsrs, new Date(now));
  } catch (e) {
    console.error('FSRS repeat error:', e);
    return null;
  }
});
