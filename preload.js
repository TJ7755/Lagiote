const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateDistractors: (args) => ipcRenderer.invoke('generate-distractors', args),
  generateDeck: (data) => ipcRenderer.invoke('gemini-generate-deck', data),
});