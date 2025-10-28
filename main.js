// main.js – full version for Lagiote Revise (mac-compatible)

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fetch = require('node-fetch');

// Safe send helper to avoid sending to destroyed windows
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

// --- Remote function endpoints ---
const NETLIFY_FUNCTION_URL = 'https://lagiote-revise.netlify.app/.netlify/functions/getAiCompletion';
const DISTRACTOR_FUNCTION_URL = 'https://lagiote-revise.netlify.app/.netlify/functions/generateDistractors';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets/logo/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'), 
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-fail-load', (_, errorCode, errorDesc) => {
    console.error(`Failed to load page: ${errorCode} - ${errorDesc}`);
  });
}

async function createLoginWindow() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  let authWindow = null;
  let hasResolved = false;
  let isInitialized = false;
  let closeAttempts = 0;
  const maxCloseAttempts = 3;

  // Log helper
  const log = (type, ...args) => {
    const msg = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    console.log(`[Auth Main][${type}] ${msg}`);
  };

  // Clean up any existing IPC listeners
  ipcMain.removeAllListeners('auth-log');
  ipcMain.removeAllListeners('auth-window-ready');
  ipcMain.removeAllListeners('auth-window-closing');
  ipcMain.removeAllListeners('auth-success');
  ipcMain.removeAllListeners('auth-error');

  return new Promise((resolve, reject) => {
    let cleanupDone = false;
    
    // Cleanup function to ensure we only cleanup once
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
        additionalArguments: ['--auth-window']  // Mark this as auth window
      },
      parent: mainWindow,
      modal: true,
      show: false,
      autoHideMenuBar: false,
      backgroundColor: '#f7fafc',
      minimizable: false,
      maximizable: false,
      closable: false,
      fullscreenable: false
    });

    // Enable DevTools
    authWindow.webContents.openDevTools();

    // Track load failures
    authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('Auth window failed to load:', errorCode, errorDescription);
    });

    // Listen for console messages
    authWindow.webContents.on('console-message', (event, level, message) => {
      console.log('Auth Window Console:', message);
    });

    // Load the auth page
    authWindow.loadFile(path.join(__dirname, 'auth.html'));

    // Track window state
    let windowReady = false;
    
    // Handle preload script logs
    ipcMain.on('auth-log', (event, data) => {
      log(data.type, data.message);
    });

    // Handle window ready state
    ipcMain.on('auth-window-ready', () => {
      isInitialized = true;
      log('info', 'Auth window reported ready');
    });

    // Track window closing
    ipcMain.on('auth-window-closing', (event, data) => {
      log('warn', 'Auth window closing:', data);
    });

    // Only show window once it's ready
    authWindow.webContents.on('did-finish-load', () => {
      if (authWindow) {
        log('info', 'Auth window content loaded');
        windowReady = true;
        
        // Immediately open DevTools
        authWindow.webContents.openDevTools();
        
        // Initialize window in stages
        const initializeWindow = async () => {
          try {
            // Stage 1: Add base error handlers
            await authWindow.webContents.executeJavaScript(`
              window.onerror = function(msg, url, line, col, error) {
                console.error('Global error:', msg, 'at', url, ':', line);
                window.electronAPI?.log('Global error: ' + msg, 'error');
                return false;
              };
              window.onunhandledrejection = function(event) {
                console.error('Unhandled rejection:', event.reason);
                window.electronAPI?.log('Unhandled rejection: ' + event.reason, 'error');
                return false;
              };
            `);
            
            // Stage 2: Check if window is still valid
            if (!authWindow || authWindow.isDestroyed()) {
              throw new Error('Window was destroyed during initialization');
            }
            
            // Stage 3: Show window
            authWindow.show();
            log('info', 'Auth window shown');
            
            // Stage 4: Initialize message handling
            await authWindow.webContents.executeJavaScript(`
              try {
                window.addEventListener('message', function(event) {
                  window.electronAPI?.log('Message received: ' + JSON.stringify(event.data));
                  if (event.data.type === 'authorization') {
                    window.electronAPI?.sendAuthToMain(event.data);
                  }
                });
                
                // Force widget to load if needed
                if (typeof netlifyIdentity === 'undefined') {
                  window.electronAPI?.log('Netlify Identity not found, reloading script');
                  const script = document.createElement('script');
                  script.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
                  script.onload = () => {
                    window.electronAPI?.log('Widget script reloaded');
                    window.electronAPI?.markInitialized();
                  };
                  script.onerror = (err) => {
                    window.electronAPI?.log('Widget script reload failed: ' + err, 'error');
                  };
                  document.head.appendChild(script);
                } else {
                  window.electronAPI?.log('Netlify Identity found, marking initialized');
                  window.electronAPI?.markInitialized();
                }
              } catch (err) {
                window.electronAPI?.log('Initialization error: ' + err.toString(), 'error');
                throw err;
              }
            `);
            
            log('info', 'Window initialization completed');
          } catch (err) {
            log('error', 'Failed to initialize window:', err);
            reject(new Error('Failed to initialize auth window: ' + err.message));
          }
        };

        // Start initialization with a small delay
        setTimeout(initializeWindow, 1000);
      }
    });

    // Track load failures
    authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log('error', 'Failed to load auth window:', errorCode, errorDescription);
      if (!hasResolved) {
        reject(new Error(`Failed to load auth window: ${errorDescription}`));
      }
    });

    // Prevent accidental closure
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

    // Handle the auth window being closed
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
        reject(new Error('Authentication window was closed before completion'));
      }
      
      cleanup();
      authWindow = null;
    });

    // Success handler
    ipcMain.once('auth-success', (event, data) => {
      if (hasResolved) {
        log('warn', 'Ignoring duplicate auth success');
        return;
      }

      log('info', 'Authentication successful');
      hasResolved = true;

      // Add a small delay before closing to ensure all logs are sent
      setTimeout(() => {
        if (authWindow && !authWindow.isDestroyed()) {
          isClosing = true;
          authWindow.setClosable(true);
          resolve(data);  // Resolve before closing
          authWindow.close();
        } else {
          resolve(data);
        }
      }, 1000);
    });

    // Error handler
    ipcMain.once('auth-error', (event, error) => {
      if (hasResolved) {
        log('warn', 'Ignoring duplicate auth error');
        return;
      }

      log('error', 'Authentication error:', error);
      hasResolved = true;

      // Show error dialog before closing
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
          reject(error);  // Reject before closing
          authWindow.close();
        });
      } else {
        reject(error);
      }
    });
  });
}

// --- Electron app lifecycle ---
app.whenReady().then(() => {
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

// --- IPC Handlers ---
ipcMain.handle('open-login-window', async () => {
  try {
    return await createLoginWindow();
  } catch (error) {
    console.error('Login window error:', error);
    throw error;
  }
});

ipcMain.handle('generate-distractors', async (event, { question, answer }) => {
  try {
    const response = await fetch(DISTRACTOR_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer })
    });
    return await response.json();
  } catch (error) {
    console.error('Distractor generation error:', error);
    throw error;
  }
});

ipcMain.handle('gemini-generate-deck', async (event, { documents }) => {
  try {
    const response = await fetch(NETLIFY_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents })
    });
    return await response.json();
  } catch (error) {
    console.error('AI generation error:', error);
    throw error;
  }
});

ipcMain.handle('sync-data', async (event, { decks, token }) => {
  try {
    const response = await fetch('https://lagiote-revise.netlify.app/.netlify/functions/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(decks)
    });
    return await response.json();
  } catch (error) {
    console.error('Sync error:', error);
    throw error;
  }
});