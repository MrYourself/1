'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = channel => callback => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('overlay', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  updateSettings: settings => ipcRenderer.invoke('settings:update', settings),
  setTikTokApiKey: apiKey => ipcRenderer.invoke('tiktok:set-api-key', apiKey),
  setDeepLApiKey: apiKey => ipcRenderer.invoke('translation:set-api-key', apiKey),
  translate: (platform, messageId) => ipcRenderer.invoke('translation:request', platform, messageId),
  translationUsage: () => ipcRenderer.invoke('translation:usage'),
  setDeepgramApiKey: apiKey => ipcRenderer.invoke('captions:set-api-key', apiKey),
  copyCaptionsUrl: () => ipcRenderer.invoke('captions:copy-url'),
  testCaptions: () => ipcRenderer.invoke('captions:test'),
  onCaptionDevices: listen('captions:devices'),
  onCaptionLevel: listen('captions:level'),
  startAuth: clientId => ipcRenderer.invoke('auth:start', clientId),
  logout: () => ipcRenderer.invoke('auth:logout'),
  reconnect: () => ipcRenderer.invoke('twitch:reconnect'),
  toggleVisible: () => ipcRenderer.invoke('overlay:toggle-visible'),
  clear: () => ipcRenderer.invoke('overlay:clear'),
  openExternal: url => ipcRenderer.invoke('external:open', url),
  openTikTokLog: () => ipcRenderer.invoke('tiktok:open-log'),
  quit: () => ipcRenderer.invoke('app:quit'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdateDownload: () => ipcRenderer.invoke('update:open-download'),
  onUpdateState: listen('update:state'),
  onState: listen('app:state'),
  onSettings: listen('settings:changed'),
  onStatus: listen('twitch:status'),
  onDiagnostics: listen('twitch:diagnostics'),
  onMetrics: listen('stream:metrics'),
  onAuthDevice: listen('auth:device'),
  onAuthSuccess: listen('auth:success'),
  onAuthError: listen('auth:error'),
  onAuthRequired: listen('auth:required'),
  onMessage: listen('chat:message'),
  onNotice: listen('chat:notice'),
  onGift: listen('chat:gift'),
  onSocial: listen('chat:social'),
  onHistory: listen('chat:history'),
  onDelete: listen('chat:delete'),
  onClearUser: listen('chat:clear-user'),
  onClear: listen('chat:clear'),
  onSystem: listen('chat:system')
});
