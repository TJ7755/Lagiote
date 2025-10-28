const { contextBridge, ipcRenderer } = require('electron');

// Set up logging that will be visible in main process
function log(type, ...args) {
    const msg = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    console.log(`[Auth Window][${type}] ${msg}`);
    ipcRenderer.send('auth-log', { type, message: msg });
}

log('info', 'Auth preload script loading...');

// Track initialization state
let isInitialized = false;
let hasSentAuth = false;

// Handle window unload
window.addEventListener('unload', () => {
    if (!hasSentAuth) {
        log('warn', 'Window closing without completing authentication');
        ipcRenderer.send('auth-window-closing', { reason: 'unload', state: { initialized: isInitialized, authSent: hasSentAuth } });
    }
});

// Set up the API bridge
contextBridge.exposeInMainWorld('electronAPI', {
    sendAuthToMain: (data) => {
        if (hasSentAuth) {
            log('warn', 'Preventing duplicate auth data send');
            return;
        }
        
        try {
            log('info', 'Sending auth data to main process', { type: data.type });
            hasSentAuth = true;
            ipcRenderer.send('auth-success', data);
        } catch (error) {
            log('error', 'Failed to send auth data', error);
            ipcRenderer.send('auth-error', { 
                message: 'Failed to send auth data',
                originalError: error.message
            });
        }
    },

    handleAuthError: (error) => {
        log('error', 'Auth error occurred:', error);
        ipcRenderer.send('auth-error', {
            message: error.message || 'Unknown authentication error',
            code: error.code || 'UNKNOWN_ERROR',
            details: error
        });
    },

    log: (message, type = 'info') => {
        log(type, message);
    },

    markInitialized: () => {
        isInitialized = true;
        log('info', 'Auth window initialized');
        ipcRenderer.send('auth-window-ready');
    }
});

// Log successful load
log('info', 'Auth preload script loaded successfully');