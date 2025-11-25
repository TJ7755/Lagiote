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
  const authService = require('./services/auth-service');
  const http = require('http');

  let authWindow = null;
  let server = null;
  let hasResolved = false;

  const log = (type, ...args) => {
    const msg = args.map(arg =>
      typeof arg === 'object' && arg !== null ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    console.log(`[Auth Main][${type}] ${msg}`);
  };

  return new Promise((resolve, reject) => {
    // Create a local HTTP server to handle the callback
    server = http.createServer(async (req, res) => {
      if (hasResolved) return;

      log('info', 'Received request:', req.url);

      if (req.url.startsWith('/callback')) {
        try {
          // Get the full callback URL
          const callbackURL = `http://localhost${req.url}`;
          log('info', 'Processing callback:', callbackURL);

          // Send success response to browser
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

          // Exchange authorization code for tokens
          const { accessToken, profile } = await authService.loadTokens(callbackURL);

          log('info', 'Token exchange successful');
          log('info', 'User profile:', profile.email || profile.sub);

          // Mark as resolved
          hasResolved = true;

          // Close the auth window after a short delay
          setTimeout(() => {
            if (authWindow && !authWindow.isDestroyed()) {
              authWindow.close();
            }
          }, 1500);

          // Resolve with user data
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

          // Close the server
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

    // Try to start server on port 80 first, then fall back to higher ports
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

    // Try ports in order: 80, 8080, 3000, random
    (async () => {
      let serverPort = null;
      const portsToTry = [80, 8080, 3000, 0]; // 0 = random available port

      for (const port of portsToTry) {
        try {
          serverPort = await tryPort(port);
          if (serverPort === 0) {
            // Get the actual port if we used random
            serverPort = server.address().port;
            log('info', `Server started on random port: ${serverPort}`);
          }
          break;
        } catch (err) {
          if (port === portsToTry[portsToTry.length - 1]) {
            // Last port attempt failed
            log('error', 'Failed to start server on any port');
            reject({
              message: 'Failed to start local callback server. Please ensure no other application is using ports 80, 8080, or 3000.',
              name: 'ServerStartError'
            });
            return;
          }
          // Try next port
          continue;
        }
      }

      if (serverPort !== 80) {
        log('warn', `Using non-standard port ${serverPort}. You may need to update Auth0 allowed callback URLs to http://localhost:${serverPort}/callback`);
      }

      // Create authentication window
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

      // Optional: Uncomment to open DevTools for debugging
      // authWindow.webContents.openDevTools();

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

      // Get the authentication URL from the service
      try {
        const authURL = authService.getAuthenticationURL();
        log('info', 'Loading Auth0 login page:', authURL);

        // Load the Auth0 login page
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