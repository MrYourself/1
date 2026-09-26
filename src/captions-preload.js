'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = channel => callback => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('captions', {
  getState: () => ipcRenderer.invoke('captions:get-state'),
  sendAudio: chunk => ipcRenderer.send('captions:audio', chunk),
  speechEnded: () => ipcRenderer.send('captions:speech-end'),
  reportLevel: level => ipcRenderer.send('captions:level', level),
  reportDevices: devices => ipcRenderer.send('captions:devices', devices),
  reportAudioError: message => ipcRenderer.send('captions:audio-error', message),
  onState: listen('captions:state'),
  onInterim: listen('captions:interim'),
  onLine: listen('captions:line')
});
