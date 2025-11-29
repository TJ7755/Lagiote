const { contextBridge, ipcRenderer } = require('electron');
const { fsrs, Rating, State } = require('ts-fsrs');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  fsrsAPI: {
    fsrs,
    Rating,
    State,
  },

  // 1. AI Generation - Use IPC handler from main.js
  generateDeck: (data) => ipcRenderer.invoke('gemini-generate-deck', data),


  // 2. Sync Data - Use IPC handler from main.js
  syncData: (data) => ipcRenderer.invoke('sync-data', data),

  // Keep existing exposure code
  generateDistractors: (args) => ipcRenderer.invoke('generate-distractors', args),
  geminiAutocomplete: (data) => ipcRenderer.invoke('gemini-autocomplete', data),
  openLoginWindow: () => ipcRenderer.invoke('open-login-window'),
  onAuthWindowClosed: (callback) => ipcRenderer.on('auth-window-closed', callback),
  sendAuthToMain: (data) => ipcRenderer.send('auth-success', data),
  handleAuthError: (error) => ipcRenderer.send('auth-error', error),
  onIdentityMessage: (callback) => {
    window.addEventListener('message', (event) => {
      if (event.data.type === 'identity') {
        callback(event.data);
      }
    });
  }
});