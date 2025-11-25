const { app, BrowserWindow, ipcMain } = require('electron');
const { updateElectronApp } = require('update-electron-app');
updateElectronApp();
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
    console.log('Environment variables loaded from .env.local');
  }
}

// Load env on startup
loadEnvFile();

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

let PROXY_URL = process.env.PROXY_URL || 'https://tj7755-lagiote-proxy.hf.space'; // Default or env

// Fix: If user provides the Web UI URL (huggingface.co/spaces/...), convert it to the direct API URL (.hf.space)
if (PROXY_URL.includes('huggingface.co/spaces/')) {
  // Convert https://huggingface.co/spaces/USERNAME/SPACE_NAME -> https://USERNAME-SPACE_NAME.hf.space
  // Example: https://huggingface.co/spaces/TJ7755/lagiote-proxy -> https://tj7755-lagiote-proxy.hf.space
  try {
    const urlObj = new URL(PROXY_URL);
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    // pathParts should be ['spaces', 'USERNAME', 'SPACE_NAME']
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

function createWindow() {
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

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-fail-load', (_, errorCode, errorDesc) => {
    console.error(`Failed to load page: ${errorCode} - ${errorDesc}`);
    setTimeout(() => {
      console.log('Retrying page load...');
      win.loadFile(path.join(__dirname, 'index.html'));
    }, 2000);
  });

  win.webContents.on('did-finish-load', () => {
    console.log('Main window loaded successfully');
    // Inject the PROXY_URL into the renderer console for debugging verification
    win.webContents.executeJavaScript(`console.log('[Main Process] Using Proxy URL: ${PROXY_URL}')`).catch(() => { });
  });

  win.webContents.on('crashed', () => {
    console.error('Renderer process crashed');
    win.reload();
  });

  return win;
}

async function createLoginWindow() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  let authWindow = null;
  let hasResolved = false;
  let isInitialized = false;
  let closeAttempts = 0;
  const maxCloseAttempts = 3;

  const log = (type, ...args) => {
    const msg = args.map(arg =>
      typeof arg === 'object' && arg !== null ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    console.log(`[Auth Main][${type}] ${msg}`);
  };

  ipcMain.removeAllListeners('auth-log');
  ipcMain.removeAllListeners('auth-window-ready');
  ipcMain.removeAllListeners('auth-window-closing');
  ipcMain.removeAllListeners('auth-success');
  ipcMain.removeAllListeners('auth-error');

  return new Promise((resolve, reject) => {
    let cleanupDone = false;

    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;

      log('info', 'Cleaning up IPC listeners');
      ipcMain.removeAllListeners('auth-log');
      ipcMain.removeAllListeners('auth-window-ready');
      ipcMain.removeAllListeners('auth-window-closing');
      ipcMain.removeAllListeners('auth-success');
      ipcMain.removeAllListeners('auth-error');
    };

    // Create a small authentication window
    authWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload-auth.js'),
        webSecurity: true,
        devTools: true,
        additionalArguments: ['--auth-window']
      },
      parent: mainWindow,
      modal: true,
      show: false,
      autoHideMenuBar: false,
      backgroundColor: '#f7fafc',
      minimizable: false,
      maximizable: false,
      closable: true,
      fullscreenable: false
    });

    // Optional: Uncomment to open DevTools for debugging
    // authWindow.webContents.openDevTools();

    authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Auth window failed to load:', errorCode, errorDescription);
    });

    authWindow.webContents.on('console-message', (event, level, message) => {
      console.log('Auth Window Console:', message);
    });

    // Intercept navigation to custom protocol (Auth0 callback)
    authWindow.webContents.on('will-navigate', (event, url) => {
      log('info', 'Navigation attempt to:', url);

      // Allow navigation to Auth0 domains (needed for consent screen to work)
      if (url.includes('.auth0.com') || url.includes('auth0.com')) {
        log('info', 'Allowing Auth0 domain navigation:', url);
        return; // Let it proceed
      }

      if (url.startsWith('lagioterevise://')) {
        event.preventDefault();
        log('info', 'Intercepted callback URL:', url);

        // Extract the callback URL and send to the auth window to process
        authWindow.webContents.executeJavaScript(`
          window.location.href = ${JSON.stringify(url)};
        `).catch(err => log('error', 'Failed to set callback URL:', err.message));
      }
    });

    // Also handle navigation in new windows (popups)
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      log('info', 'Window open attempt to:', url);

      // Allow Auth0 popups/redirects
      if (url.includes('.auth0.com') || url.includes('auth0.com')) {
        log('info', 'Allowing Auth0 popup');
        return { action: 'allow' };
      }

      if (url.startsWith('lagioterevise://')) {
        log('info', 'Intercepted popup callback URL:', url);

        authWindow.webContents.executeJavaScript(`
          window.location.href = ${JSON.stringify(url)};
        `).catch(err => log('error', 'Failed to set callback URL:', err.message));

        return { action: 'deny' };
      }

      return { action: 'allow' };
    });

    // Load Auth0 authentication window
    authWindow.loadFile(path.join(__dirname, 'auth.html'));

    let windowReady = false;

    ipcMain.on('auth-log', (event, data) => {
      log(data.type, data.message);
    });

    ipcMain.on('auth-window-ready', () => {
      isInitialized = true;
      log('info', 'Auth window reported ready');
    });

    ipcMain.on('auth-window-closing', (event, data) => {
      log('warn', 'Auth window closing:', data);
    });

    authWindow.webContents.on('did-finish-load', () => {
      if (authWindow) {
        log('info', 'Auth window content loaded');
        windowReady = true;

        // Get Auth0 configuration from environment
        const auth0Domain = process.env.VITE_AUTH0_DOMAIN || process.env.AUTH0_DOMAIN;
        const auth0ClientId = process.env.VITE_AUTH0_CLIENT_ID || process.env.AUTH0_CLIENT_ID;

        log('info', 'Auth0 domain:', auth0Domain || 'NOT SET');
        log('info', 'Auth0 clientId:', auth0ClientId ? 'SET' : 'NOT SET');

        if (!auth0Domain || !auth0ClientId) {
          log('warn', 'Auth0 config missing!');
          log('warn', 'Available env keys:', Object.keys(process.env).filter(k => k.includes('AUTH')).join(', '));
          log('warn', 'Please create .env.local file with VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID');
        }

        const initializeWindow = async () => {
          try {
            // Set up error handlers
            try {
              await authWindow.webContents.executeJavaScript(`
                window.onerror = function(msg, url, line, col, error) {
                  console.error('Global error:', msg, 'at', url, ':', line);
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('Global error: ' + msg, 'error');
                  }
                  return false;
                };
                window.onunhandledrejection = function(event) {
                  console.error('Unhandled rejection:', event.reason);
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('Unhandled rejection: ' + (event.reason ? event.reason.toString() : 'Unknown'), 'error');
                  }
                  return false;
                };
                true;
              `);
            } catch (execError) {
              log('warn', 'Failed to set up error handlers:', execError.message || 'Unknown error');
            }

            if (!authWindow || authWindow.isDestroyed()) {
              throw new Error('Window was destroyed during initialization');
            }

            // Pass Auth0 configuration to the window
            log('info', 'Injecting Auth0 config...');
            const configScript = `
              try {
                console.log('[Auth Window] Receiving config injection...');
                // Set Auth0 config on window for the auth script to access
                window.auth0Config = {
                  domain: ${JSON.stringify(auth0Domain || '')},
                  clientId: ${JSON.stringify(auth0ClientId || '')}
                };
                console.log('[Auth Window] Config set:', window.auth0Config);
                
                // Also store in localStorage as fallback
                if (${JSON.stringify(auth0Domain)}) {
                  localStorage.setItem('AUTH0_DOMAIN', ${JSON.stringify(auth0Domain)});
                }
                if (${JSON.stringify(auth0ClientId)}) {
                  localStorage.setItem('AUTH0_CLIENT_ID', ${JSON.stringify(auth0ClientId)});
                }
                
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('Auth0 config injected successfully', 'info');
                }
                true; // Return a serializable value
              } catch (err) {
                console.error('Config injection error:', err);
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('Config injection error: ' + err.toString(), 'error');
                }
                false; // Return a serializable value
              }
            `;

            try {
              await authWindow.webContents.executeJavaScript(configScript);
            } catch (execError) {
              log('error', 'Failed to execute config script:', execError.message || execError.toString());
              throw new Error('Failed to inject Auth0 config: ' + (execError.message || 'Unknown error'));
            }

            authWindow.show();
            log('info', 'Auth window shown');

            log('info', 'Window initialization completed');
          } catch (err) {
            log('error', 'Failed to initialize window:', err.message || err.toString());
            reject({
              message: 'Failed to initialize auth window: ' + (err.message || err.toString()),
              name: 'AuthWindowError'
            });
          }
        };

        setTimeout(initializeWindow, 500);
      }
    });

    authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log('error', 'Failed to load auth window:', errorCode, errorDescription);
      if (!hasResolved) {
        reject({
          message: `Failed to load auth window: ${errorDescription}`,
          name: 'AuthWindowLoadError',
          code: errorCode
        });
      }
    });

    authWindow.on('close', (e) => {
      if (!hasResolved) {
        closeAttempts++;
        log('warn', `Close attempt ${closeAttempts} of ${maxCloseAttempts}`);

        if (closeAttempts < maxCloseAttempts) {
          e.preventDefault();
          const choice = require('electron').dialog.showMessageBoxSync(authWindow, {
            type: 'warning',
            buttons: ['Continue Authentication', 'Force Close'],
            defaultId: 0,
            title: 'Authentication in Progress',
            message: 'Authentication is still in progress. Are you sure you want to cancel?',
            detail: `Window state: ${isInitialized ? 'Initialized' : 'Not initialized'}, Authentication: ${hasResolved ? 'Complete' : 'Incomplete'}`
          });
          if (choice === 0) {
            closeAttempts = 0;
            e.preventDefault();
            return;
          }
        }
      }
    });

    let isClosing = false;

    authWindow.on('close', (e) => {
      log('info', 'Auth window closing event', {
        hasResolved,
        isInitialized,
        windowReady,
        isClosing
      });

      if (!hasResolved && !isClosing) {
        e.preventDefault();
        log('warn', 'Preventing unauthorized window close');
        return;
      }
    });

    authWindow.on('closed', () => {
      log('info', 'Auth window closed', {
        hasResolved,
        isInitialized,
        windowReady
      });

      if (!hasResolved) {
        log('error', 'Window closed without resolving');
        safeSend(mainWindow, 'auth-window-closed');
        reject({
          message: 'Authentication window was closed before completion',
          name: 'AuthWindowClosedError'
        });
      }

      cleanup();
      authWindow = null;
    });

    ipcMain.once('auth-success', (event, data) => {
      if (hasResolved) {
        log('warn', 'Ignoring duplicate auth success');
        return;
      }

      log('info', 'Authentication successful');
      hasResolved = true;

      setTimeout(() => {
        if (authWindow && !authWindow.isDestroyed()) {
          isClosing = true;
          authWindow.setClosable(true);
          resolve(data);
          authWindow.close();
        } else {
          resolve(data);
        }
      }, 1000);
    });

    ipcMain.once('auth-error', (event, error) => {
      if (hasResolved) {
        log('warn', 'Ignoring duplicate auth error');
        return;
      }

      log('error', 'Authentication error:', error);
      hasResolved = true;

      if (authWindow && !authWindow.isDestroyed()) {
        require('electron').dialog.showMessageBox(authWindow, {
          type: 'error',
          title: 'Authentication Error',
          message: 'Failed to authenticate',
          detail: error.message || JSON.stringify(error),
          buttons: ['OK']
        }).then(() => {
          isClosing = true;
          authWindow.setClosable(true);
          reject({
            message: error.message || JSON.stringify(error),
            name: 'AuthError'
          });
          authWindow.close();
        });
      } else {
        reject({
          message: error.message || JSON.stringify(error),
          name: 'AuthError'
        });
      }
    });
  });
}

app.whenReady().then(() => {
  app.setAsDefaultProtocolClient("lagioterevise");
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('open-login-window', async () => {
  try {
    return await createLoginWindow();
  } catch (error) {
    console.error('Login window error:', error);
    // Convert error to a plain object that can be serialized over IPC
    throw {
      message: error.message || 'Login window failed',
      name: error.name || 'Error',
      stack: error.stack
    };
  }
});

ipcMain.handle('generate-distractors', async (event, { question, answer }) => {
  try {
    if (!require('os').platform() || process.versions.electron) {
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
        return await response.json();
      } catch (fetchError) {
        console.error('Distractor generation error:', fetchError.message);
        return {
          error: 'offline',
          message: 'Cannot generate distractors offline. Saved decks will work without AI features.',
          offline: true
        };
      }
    }
  } catch (error) {
    console.error('Distractor generation error:', error);
    throw error;
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

ipcMain.handle('sync-data', async (event, { decks, token }) => {
  try {
    const response = await Promise.race([
      fetch(`${PROXY_URL}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(decks)
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 10000))
    ]);

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Sync error:', error);
    return {
      error: 'offline',
      message: 'Cannot sync offline. Your changes will be saved locally and synced when online.',
      offline: true,
      originalError: error.message
    };
  }
});