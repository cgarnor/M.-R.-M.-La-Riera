const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API exposed to the renderer (no Node access in the page).
contextBridge.exposeInMainWorld('mrmNative', {
  isDesktop: true,
  testMode: process.argv.includes('--mrm-test'),
  poissonAvailable: () => ipcRenderer.invoke('poisson:available'),
  poisson: (pointsPly, opts) => ipcRenderer.invoke('poisson:run', pointsPly, opts),
  poissonCancel: () => ipcRenderer.invoke('poisson:cancel'),
  saveFile: (defaultPath, filters, data) => ipcRenderer.invoke('file:save', { defaultPath, filters, data }),
  saveMany: (title, files, lang) => ipcRenderer.invoke('file:saveMany', { title, files, lang }),
  version: () => ipcRenderer.invoke('app:version'),
  setDirty: (dirty, lang) => ipcRenderer.invoke('app:setDirty', dirty, lang),
});
