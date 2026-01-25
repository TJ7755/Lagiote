const { Menu, shell } = require('electron');

const template = [
  ...process.platform === 'darwin' ? [{
    label: 'StudyStack',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }] : [],
  {
    label: 'File',
    submenu: [
      process.platform === 'darwin' ? { role: 'close' } :       { role: 'quit' }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  },
  {
    label: 'Study',
    submenu: [
      {
        label: 'Exam Hub',
        accelerator: 'CmdOrCtrl+Shift+E',
        click: async (menuItem, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.executeJavaScript(`
              if (typeof window.keyboardManager?.openExamHubWithDeckSelection === 'function') {
                window.keyboardManager.openExamHubWithDeckSelection();
              } else if (typeof window.showExamHubDeckSelector === 'function') {
                window.showExamHubDeckSelector();
              } else if (typeof window.showToast === 'function') {
                window.showToast('Please select a deck first to open Exam Hub.', 'info');
              }
            `);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Analytics',
        accelerator: 'CmdOrCtrl+Shift+A',
        click: async (menuItem, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.executeJavaScript(`
              if (typeof window.showView === 'function') window.showView('analytics');
            `);
          }
        }
      },
      {
        label: 'Memory Insights',
        accelerator: 'CmdOrCtrl+Shift+I',
        click: async (menuItem, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.executeJavaScript(`
              if (typeof window.showView === 'function') window.showView('insights');
            `);
          }
        }
      }
    ]
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...process.platform === 'darwin' ? [
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ] : [
        { role: 'close' }
      ]
    ]
  },
  {
    role: 'help',
    submenu: [
      {
        label: 'Keyboard Shortcuts',
        accelerator: 'CmdOrCtrl+Shift+?',
        click: async (menuItem, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.executeJavaScript(`
              if (typeof window.showKeyboardShortcutsHelp === 'function') {
                window.showKeyboardShortcutsHelp();
              }
            `);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://electronjs.org');
        }
      }
    ]
  }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);