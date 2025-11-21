const { contextBridge, ipcRenderer } = require('electron');

const PROXY_URL = 'https://huggingface.co/spaces/TJ7755/lagiote-proxy';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // 1. AI Generation
  generateDeck: async (data) => {
    // Get the Auth Token from LocalStorage (to be replaced with Auth0)
    const token = localStorage.getItem('userToken'); 
    
    const response = await fetch(`${PROXY_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // Pass token for basic check
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'AI Generation Failed');
    }
    return await response.json();
  },

  // 2. Sync Data
  syncData: async (data) => {
    const token = localStorage.getItem('userToken');
    
    // TODO: Extract User ID from Auth0 token or session
    let userId = null;
    // Auth0 implementation will provide user ID differently
    const response = await fetch(`${PROXY_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ ...data, userId })
    });
    if (!response.ok) throw new Error('Sync Failed');
    return await response.json();
  },

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