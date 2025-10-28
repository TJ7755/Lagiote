const { contextBridge, ipcRenderer } = require('electron');

// Check if running in Electron
const isElectron = process.versions.hasOwnProperty('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateDistractors: (args) => ipcRenderer.invoke('generate-distractors', args),
  generateDeck: (data) => ipcRenderer.invoke('gemini-generate-deck', data),
  openLoginWindow: () => ipcRenderer.invoke('open-login-window'),
  syncData: (data) => ipcRenderer.invoke('sync-data', data),
  isElectron: isElectron,
  onAuthWindowClosed: (callback) => ipcRenderer.on('auth-window-closed', callback),
  sendAuthToMain: (data) => ipcRenderer.send('auth-success', data),
  handleAuthError: (error) => ipcRenderer.send('auth-error', error),
  // Add Netlify Identity messaging bridge
  onIdentityMessage: (callback) => {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'identity') {
        callback(event.data);
      }
    });
  }
});