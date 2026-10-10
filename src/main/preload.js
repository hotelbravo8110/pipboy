'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pipHost', {
  isApp: true,
  window: (action) => ipcRenderer.send('win', action),
});
