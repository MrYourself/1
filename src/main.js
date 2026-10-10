'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut, Tray, Menu, nativeImage, safeStorage, screen, net, clipboard, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { parseIrcLine, toChatEvent } = require('./twitch-irc');
const {
  normalizeTikTokUsername,
  normalizeTikTokChat,
  normalizeTikTokGift,
  normalizeTikTokSocial
} = require('./tiktok-normalizer');
const { friendlyTikTokError, nestedErrorText, shouldRetryWithoutExtendedGiftInfo, tikTokRetryDelay } = require('./tiktok-errors');
const { resolveTikTokRoomId, resolveTikTokRoomIdWithBrowser } = require('./tiktok-room');
const { toTwitchFollowNotice } = require('./twitch-events');
const { configureTikTokSigner } = require('./tiktok-signing');
const { createPendingEventBuffer } = require('./pending-events');
const { isoTimestamp, normalizeViewerCount, tiktokViewerCount } = require('./stream-metrics');
const { createDeepLTranslator } = require('./deepl-translator');
const { createDeepgramStream } = require('./deepgram-client');
const { buildCaption, interimText, parseDeepgramMessage } = require('./caption-transcript');
const { createUpdater, releasesUrl } = require('./updater');
const { createPortableUpdate } = require('./portable-update');
const { createCaptionServer } = require('./caption-server');
const { captionSourceHtml } = require('./caption-source-file');
const {
  isAllowedExternalUrl,
  reconnectDelay,
  sanitizeBounds,
  sanitizeSettingsUpdate
} = require('./app-utils');

const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_API_URL = 'https://api.twitch.tv/helix';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const REQUIRED_SCOPES = ['user:read:chat', 'chat:read', 'moderator:read:followers'];
const HTTP_TIMEOUT_MS = 15000;
// Twitch only lets "Public" applications refresh a login without a client secret.
const CONFIDENTIAL_CLIENT_REASON = 'Die Twitch-Anwendung zu dieser Client-ID hat den Client-Typ „Vertraulich“ (Confidential). ' +
  'Damit läuft die Anmeldung nach wenigen Stunden ab. Bitte in der Twitch Developer Console eine neue Anwendung ' +
  'mit dem Client-Typ „Öffentlich“ (Public) anlegen und deren Client-ID hier eintragen.';

const DEFAULT_SETTINGS = Object.freeze({
  clientId: '',
  channel: '',
  tiktokUsername: '',
  showTikTokGifts: true,
  showTikTokSocials: false,
  streamSafe: true,
  showStreamStats: true,
  fontSize: 20,
  opacity: 78,
  fadeSeconds: 35,
  maxMessages: 45,
  showTimestamps: false,
  hideKnownBots: true,
  hideCommands: false,
  compactMode: false,
  hiddenUsers: [],
  blockedTerms: [],
  translationEnabled: false,
  translationTarget: 'DE',
  translationSkipLanguages: ['EN'],
  captionsEnabled: false,
  captionsTarget: 'EN-US',
  captionsShowOriginal: false,
  captionsOnlyTranslated: true,
  captionsBackground: 'dark',
  captionsFontSize: 30,
  captionsGate: 40,
  captionsDeviceId: '',
  captionsTextColor: '#ffffff',
  captionsBox: true,
  captionsWindowVisible: false,
  updateBeta: false,
  updateInstall: 'start',
  bounds: { width: 520, height: 760 }
});
const RECENT_MESSAGE_LIMIT = 500;
const HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const HISTORY_SAVE_INTERVAL_MS = 5000;
const TIKTOK_BACKLOG_AGE_MS = 60 * 1000;
// Value of the control message TikTok sends when moderation takes a stream down.
const TIKTOK_STREAM_SUSPENDED = 4;
const TIKTOK_BACKLOG_WINDOW_MS = 10 * 1000;
const CAPTIONS_DEFAULT_BOUNDS = Object.freeze({ width: 960, height: 170 });
const CAPTIONS_MIN_WIDTH = 320;
const CAPTIONS_MIN_HEIGHT = 90;
const CAPTION_SETTING_KEYS = ['captionsEnabled', 'captionsShowOriginal', 'captionsBackground', 'captionsFontSize', 'captionsGate',
  'captionsDeviceId', 'captionsTextColor', 'captionsBox', 'captionsWindowVisible'];

let mainWindow;
let tray;
let settings;
let overlayVisible = true;
let quitting = false;
let authPollGeneration = 0;
let accessSession = null;
let eventSocket = null;
let previousEventSocket = null;
let ircSocket = null;
let tiktokConnection = null;
let tiktokModulePromise = null;
let tiktokGeneration = 0;
let twitchGeneration = 0;
let tiktokApiKey = '';
let deeplApiKey = '';
let translator = null;
let deepgramApiKey = '';
let captionsWindow = null;
let captionStream = null;
let captionQueue = Promise.resolve();
let captionSequence = 0;
let captionDevices = [];
let captionServer = null;
let captionsLevelSeen = false;
let updater = null;
let updateReleasesUrl = null;
let announcedUpdate = null;
// Message texts by platform and ID, so the renderer can request a translation for
// exactly the messages it actually shows (filtered bots and spam cost no quota).
const recentMessages = new Map();
let keepaliveTimer = null;
let reconnectTimer = null;
let twitchReconnectTimer = null;
let ircReconnectTimer = null;
let tiktokReconnectTimer = null;
// Pending connect() calls, so an abandoned connection can be closed once it is up.
const tiktokConnecting = new WeakMap();
let streamPollTimer = null;
let tokenValidationTimer = null;
let badgeMap = {};
let refreshPromise = null;
let tokenValidationInProgress = false;
let activeBroadcaster = null;
let authRequirementReason = null;
let historyStore = { version: 1, twitch: null, tiktok: null };
let historySaveTimer = null;
// Platforms whose stored history was confirmed as the currently running stream.
const confirmedHistory = new Set();
const seenMessageIds = new Map();
const seenEventSubIds = new Map();
let twitchReconnectAttempt = 0;
let ircReconnectAttempt = 0;
let eventReconnectAttempt = 0;
let tiktokRetryAttempt = 0;
let tiktokWasLive = false;
let streamMetrics = {
  twitchLive: false,
  twitchViewers: null,
  twitchStartedAt: null,
  tiktokLive: false,
  tiktokViewers: null,
  tiktokStartedAt: null
};
const connectionDiagnostics = {
  eventSub: false,
  irc: false,
  follows: false,
  followError: null,
  tiktok: false,
  tiktokState: 'idle',
  tiktokError: null,
  tiktokRetryAt: null,
  translationError: null,
  captions: 'off',
  captionsError: null,
  captionsAudioError: null,
  captionsServerError: null,
  captionsClients: 0,
  messagesReceived: 0,
  lastSource: null,
  lastError: null
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function sessionPath() {
  return path.join(app.getPath('userData'), 'twitch-session.json');
}

function historyPath() {
  return path.join(app.getPath('userData'), 'current-stream-history.json');
}

function tiktokCredentialsPath() {
  return path.join(app.getPath('userData'), 'tiktok-credentials.json');
}

function deeplCredentialsPath() {
  return path.join(app.getPath('userData'), 'deepl-credentials.json');
}

function deepgramCredentialsPath() {
  return path.join(app.getPath('userData'), 'deepgram-credentials.json');
}

function updateAttemptPath() {
  return path.join(app.getPath('userData'), 'update-attempt.json');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, indent = 2) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, indent), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadHistoryStore() {
  const stored = readJson(historyPath(), null);
  if (!stored || stored.version !== 1) return { version: 1, twitch: null, tiktok: null };
  for (const platform of ['twitch', 'tiktok']) {
    const bucket = stored[platform];
    // A stream whose end the app never saw (closed before it ended) must not come back.
    if (!bucket || !Array.isArray(bucket.entries) || !(Date.now() - Number(bucket.lastUpdated || 0) < HISTORY_MAX_AGE_MS)) {
      stored[platform] = null;
      continue;
    }
    bucket.entries = bucket.entries
      .filter(entry => entry && typeof entry === 'object' && entry.payload && typeof entry.payload === 'object')
      .slice(-500);
  }
  return { version: 1, twitch: stored.twitch || null, tiktok: stored.tiktok || null };
}

function reportStorageError(label, error) {
  const detail = `${label}: ${error?.message || error}`;
  console.error(detail);
  connectionDiagnostics.lastError = detail;
  emitDiagnostics();
}

// A busy chat changes the history several times per second. The file is written at
// most once per interval; flushHistory() covers the rest when the app quits.
function saveHistorySoon() {
  if (historySaveTimer) return;
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    try {
      writeJson(historyPath(), historyStore, 0);
    } catch (error) {
      reportStorageError('Verlauf konnte nicht gespeichert werden', error);
    }
  }, HISTORY_SAVE_INTERVAL_MS);
}

function flushHistory() {
  clearTimeout(historySaveTimer);
  historySaveTimer = null;
  try {
    writeJson(historyPath(), historyStore);
  } catch (error) {
    reportStorageError('Verlauf konnte beim Beenden nicht gespeichert werden', error);
  }
}

function currentHistoryEntries() {
  return ['twitch', 'tiktok']
    .filter(platform => confirmedHistory.has(platform))
    .flatMap(platform => historyStore[platform]?.entries || [])
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .slice(-700);
}

function emitHistory() {
  send('chat:history', currentHistoryEntries());
}

function recordHistory(platform, kind, payload, replaceKey = null) {
  const bucket = historyStore[platform];
  if (!bucket) return;
  const rawTimestamp = Number(payload.timestamp);
  const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : Date.now();
  const entry = {
    id: String(payload.message_id || replaceKey || `${platform}:${kind}:${timestamp}`),
    platform,
    kind,
    timestamp,
    replaceKey,
    payload
  };
  if (replaceKey) {
    const index = bucket.entries.findIndex(item => item.replaceKey === replaceKey);
    if (index >= 0) bucket.entries[index] = entry;
    else bucket.entries.push(entry);
  } else if (!bucket.entries.some(item => item.id === entry.id)) {
    bucket.entries.push(entry);
  }
  bucket.entries = bucket.entries.slice(-500);
  bucket.lastUpdated = Date.now();
  saveHistorySoon();
}

function removeHistoryWhere(predicate) {
  let changed = false;
  for (const platform of ['twitch', 'tiktok']) {
    const bucket = historyStore[platform];
    if (!bucket) continue;
    const next = bucket.entries.filter(entry => !predicate(entry));
    if (next.length !== bucket.entries.length) {
      bucket.entries = next;
      changed = true;
    }
  }
  if (changed) saveHistorySoon();
}

function clearCurrentHistory() {
  for (const platform of ['twitch', 'tiktok']) {
    if (historyStore[platform]) historyStore[platform].entries = [];
  }
  saveHistorySoon();
  send('chat:clear');
}

function clearPlatformHistory(platform) {
  if (historyStore[platform]) historyStore[platform].entries = [];
  saveHistorySoon();
  send('chat:clear', { platform });
}

function loadSettings() {
  const stored = readJson(settingsPath(), {});
  const safe = sanitizeSettingsUpdate(stored, normalizeTikTokUsername);
  const clientId = typeof stored.clientId === 'string' && /^[a-z0-9]{10,64}$/i.test(stored.clientId.trim())
    ? stored.clientId.trim()
    : '';
  return {
    ...DEFAULT_SETTINGS,
    ...safe,
    clientId,
    bounds: sanitizeBounds(stored.bounds, DEFAULT_SETTINGS.bounds),
    captionsBounds: stored.captionsBounds
      ? sanitizeBounds(stored.captionsBounds, CAPTIONS_DEFAULT_BOUNDS, CAPTIONS_MIN_WIDTH, CAPTIONS_MIN_HEIGHT)
      : null
  };
}

function saveSettings() {
  writeJson(settingsPath(), settings);
}

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Die sichere Windows-Anmeldeinformationsspeicherung ist nicht verfügbar.');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decrypt(value) {
  return safeStorage.decryptString(Buffer.from(value, 'base64'));
}

function loadTikTokApiKey() {
  const stored = readJson(tiktokCredentialsPath(), null);
  if (!stored?.apiKey) return '';
  try {
    return decrypt(stored.apiKey).trim();
  } catch {
    return '';
  }
}

function saveTikTokApiKey(value) {
  const next = String(value || '').trim().slice(0, 1024);
  if (!next) {
    try { fs.unlinkSync(tiktokCredentialsPath()); } catch {}
    tiktokApiKey = '';
    return;
  }
  writeJson(tiktokCredentialsPath(), { apiKey: encrypt(next) });
  tiktokApiKey = next;
}

function loadDeepLApiKey() {
  const stored = readJson(deeplCredentialsPath(), null);
  if (!stored?.apiKey) return '';
  try {
    return decrypt(stored.apiKey).trim();
  } catch {
    return '';
  }
}

function saveDeepLApiKey(value) {
  const next = String(value || '').trim().slice(0, 256);
  if (!next) {
    try { fs.unlinkSync(deeplCredentialsPath()); } catch {}
    deeplApiKey = '';
  } else {
    writeJson(deeplCredentialsPath(), { apiKey: encrypt(next) });
    deeplApiKey = next;
  }
  translator?.reset();
}

function setTranslationStatus({ state, message }) {
  const next = state === 'error' || state === 'limited' ? message : null;
  if (connectionDiagnostics.translationError === next) return;
  connectionDiagnostics.translationError = next;
  emitDiagnostics();
}

function rememberMessage(event) {
  if (!event.message_id) return;
  const key = `${event.platform}:${event.message_id}`;
  recentMessages.delete(key);
  recentMessages.set(key, event.message || {});
  while (recentMessages.size > RECENT_MESSAGE_LIMIT) recentMessages.delete(recentMessages.keys().next().value);
}

async function translateMessage(platform, messageId) {
  if (!settings.translationEnabled || !deeplApiKey || !translator) return null;
  if (platform !== 'twitch' && platform !== 'tiktok') return null;
  const message = recentMessages.get(`${platform}:${String(messageId || '')}`);
  if (!message) return null;
  const translation = await translator.translate(message);
  if (!translation) return null;
  // Keep the translation in the stream history so a restart does not pay for it again.
  const entry = historyStore[platform]?.entries.find(item => item.kind === 'message' && item.payload?.message_id === messageId);
  if (entry) {
    entry.payload.translation = translation;
    saveHistorySoon();
  }
  return translation;
}

function loadDeepgramApiKey() {
  const stored = readJson(deepgramCredentialsPath(), null);
  if (!stored?.apiKey) return '';
  try {
    return decrypt(stored.apiKey).trim();
  } catch {
    return '';
  }
}

function saveDeepgramApiKey(value) {
  const next = String(value || '').trim().slice(0, 256);
  if (!next) {
    try { fs.unlinkSync(deepgramCredentialsPath()); } catch {}
    deepgramApiKey = '';
  } else {
    writeJson(deepgramCredentialsPath(), { apiKey: encrypt(next) });
    deepgramApiKey = next;
  }
  if (captionStream?.active) captionStream.restart();
  else applyCaptions();
}

function captionsPublicState() {
  return {
    fontSize: settings.captionsFontSize,
    background: settings.captionsBackground,
    showOriginal: settings.captionsShowOriginal,
    deviceId: settings.captionsDeviceId,
    gate: settings.captionsGate,
    textColor: settings.captionsTextColor,
    box: settings.captionsBox
  };
}

// Captions go to both displays: the capture window and the browser-source page.
// The browser-source page only needs the appearance, not microphone settings.
function captionsDisplayState() {
  return {
    fontSize: settings.captionsFontSize,
    textColor: settings.captionsTextColor,
    box: settings.captionsBox,
    showOriginal: settings.captionsShowOriginal
  };
}

function sendCaptions(channel, payload) {
  if (captionsWindow && !captionsWindow.isDestroyed()) captionsWindow.webContents.send(channel, payload);
  const event = channel.replace('captions:', '');
  captionServer?.broadcast(event, event === 'state' ? captionsDisplayState() : payload);
}

function setCaptionStatus({ state, message }) {
  if (connectionDiagnostics.captions !== state) {
    recordCaptionEvent(`Spracherkennung: ${state}${message ? ` (${String(message).slice(0, 200)})` : ''}`);
  }
  connectionDiagnostics.captions = state;
  connectionDiagnostics.captionsError = state === 'error' || state === 'reconnecting' ? message : null;
  emitDiagnostics();
  // A sentence cut off by a lost connection is never finished; take it off the stream.
  if (state !== 'live') sendCaptions('captions:interim', { sourceId: 'mic', text: '' });
}

function handleCaptionResult(message) {
  const result = parseDeepgramMessage(message);
  if (!result) return;
  const target = settings.captionsTarget;
  const onlyTranslated = Boolean(settings.captionsOnlyTranslated);
  if (!result.isFinal) {
    sendCaptions('captions:interim', { sourceId: 'mic', text: interimText(result.words, target, { onlyTranslated }) });
    return;
  }
  if (!result.words.length) {
    sendCaptions('captions:interim', { sourceId: 'mic', text: '' });
    return;
  }
  const sequence = ++captionSequence;
  // Lines are translated one after another so they always appear in spoken order.
  captionQueue = captionQueue
    .then(() => buildCaption(result.words, {
      target,
      onlyTranslated,
      // DeepL detects the language itself. The recognizer's tag is wrong too often,
      // and a forced wrong source makes DeepL reword English into other English.
      translate: text => translator ? translator.translateText(text, { target }) : null
    }))
    .then(caption => {
      // Nothing left to show (only-translations mode): just take the "…" away.
      if (caption.text) sendCaptions('captions:line', { sequence, sourceId: 'mic', ...caption });
      else sendCaptions('captions:interim', { sourceId: 'mic', text: '' });
    })
    .catch(() => {});
}

function isCaptionsSender(event) {
  return Boolean(captionsWindow && !captionsWindow.isDestroyed() && event.sender === captionsWindow.webContents);
}

function createCaptionsWindow() {
  if (captionsWindow && !captionsWindow.isDestroyed()) return;
  const saved = sanitizeBounds(settings.captionsBounds, CAPTIONS_DEFAULT_BOUNDS, CAPTIONS_MIN_WIDTH, CAPTIONS_MIN_HEIGHT);
  const bounds = validBounds(saved, CAPTIONS_MIN_WIDTH, CAPTIONS_MIN_HEIGHT) ? saved : { ...CAPTIONS_DEFAULT_BOUNDS };
  const captionWindow = new BrowserWindow({
    ...bounds,
    minWidth: CAPTIONS_MIN_WIDTH,
    minHeight: CAPTIONS_MIN_HEIGHT,
    // The title is what OBS and TikTok LIVE Studio list for window capture.
    title: 'Stream-Untertitel',
    frame: false,
    transparent: false,
    backgroundColor: '#0e0d13',
    resizable: true,
    fullscreenable: false,
    icon: createTrayImage(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'captions-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      backgroundThrottling: false,
      // A separate session, so microphone access never extends to the chat overlay.
      partition: 'captions'
    }
  });
  captionsWindow = captionWindow;
  const captionSession = captionWindow.webContents.session;
  captionSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(permission === 'media' && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio'));
  });
  captionSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
  // The session outlives the window; a listener per window would pile up.
  captionSession.removeAllListeners('will-download');
  captionSession.on('will-download', event => event.preventDefault());
  // Unlike the chat overlay, the captions must be visible to stream capture.
  captionWindow.setContentProtection(false);
  captionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  captionWindow.webContents.on('will-navigate', event => event.preventDefault());
  captionWindow.loadFile(path.join(__dirname, 'captions', 'index.html')).catch(error => {
    setCaptionStatus({ state: 'error', message: `Untertitel-Fenster konnte nicht geladen werden: ${error.message}` });
  });
  captionWindow.once('ready-to-show', () => {
    if (settings.captionsWindowVisible) captionWindow.showInactive();
  });

  let boundsTimer;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (captionWindow.isDestroyed()) return;
      settings.captionsBounds = captionWindow.getBounds();
      try {
        saveSettings();
      } catch (error) {
        reportStorageError('Position des Untertitel-Fensters konnte nicht gespeichert werden', error);
      }
    }, 300);
  };
  captionWindow.on('move', rememberBounds);
  captionWindow.on('resize', rememberBounds);
  captionWindow.on('closed', () => {
    // Only a window the user closed (Alt+F4) switches the captions off. A window the
    // app replaced must not: switching off and on again quickly would otherwise let
    // the old window's late "closed" turn the captions off a second time.
    if (captionsWindow !== captionWindow) return;
    captionsWindow = null;
    if (!quitting && settings.captionsEnabled) {
      recordCaptionEvent('Aufnahmefenster wurde geschlossen, Untertitel ausgeschaltet');
      setCaptionsEnabled(false);
    }
  });
  captionWindow.webContents.on('render-process-gone', (_event, details) => {
    if (captionsWindow !== captionWindow) return;
    recordCaptionEvent(`Aufnahmefenster abgestürzt (${details?.reason || 'unbekannt'}), wird neu gestartet`);
    captionsWindow = null;
    captionWindow.destroy();
    captionsLevelSeen = false;
    if (!quitting && settings.captionsEnabled) applyCaptions();
  });
}

function startCaptionServer() {
  if (!captionServer || captionServer.url) return;
  captionServer.start()
    .then(url => {
      if (url) recordCaptionEvent(`Browserquelle bereit: ${url}`);
      connectionDiagnostics.captionsServerError = null;
      emitDiagnostics();
      send('settings:changed', publicSettings());
    })
    .catch(error => {
      connectionDiagnostics.captionsServerError = `Die Browserquelle konnte nicht gestartet werden: ${error?.message || error}`;
      recordCaptionEvent(connectionDiagnostics.captionsServerError);
      emitDiagnostics();
    });
}

// Lets the user verify the path into OBS or TikTok LIVE Studio without speaking
// and without Deepgram being involved.
function sendTestCaption() {
  if (!settings.captionsEnabled) throw new Error('Bitte zuerst die Untertitel einschalten.');
  sendCaptions('captions:line', {
    sequence: ++captionSequence,
    sourceId: 'test',
    text: 'This is a test caption.',
    original: 'Das ist ein Test-Untertitel.',
    translated: true,
    languages: ['de']
  });
  return connectionDiagnostics.captionsClients;
}

function applyCaptions() {
  if (!settings?.captionsEnabled) {
    captionStream?.stop();
    captionServer?.stop().catch(() => {});
    connectionDiagnostics.captionsAudioError = null;
    connectionDiagnostics.captionsServerError = null;
    const closing = captionsWindow;
    captionsWindow = null;
    if (closing && !closing.isDestroyed()) closing.destroy();
    captionsLevelSeen = false;
    setCaptionStatus({ state: 'off', message: null });
    return;
  }
  startCaptionServer();
  // The window also records the microphone, so it keeps running while hidden.
  createCaptionsWindow();
  if (captionsWindow.isVisible() !== Boolean(settings.captionsWindowVisible)) {
    if (settings.captionsWindowVisible) captionsWindow.showInactive();
    else captionsWindow.hide();
  }
  sendCaptions('captions:state', captionsPublicState());
  if (!deepgramApiKey) {
    captionStream?.stop();
    setCaptionStatus({ state: 'error', message: 'Für die Untertitel wird ein Deepgram-API-Key benötigt.' });
    return;
  }
  captionStream?.start();
}

function setCaptionsEnabled(enabled) {
  settings.captionsEnabled = Boolean(enabled);
  recordCaptionEvent(`Untertitel ${settings.captionsEnabled ? 'eingeschaltet' : 'ausgeschaltet'} (Tray oder Fenster)`);
  try {
    saveSettings();
  } catch (error) {
    reportStorageError('Untertitel-Einstellung konnte nicht gespeichert werden', error);
  }
  applyCaptions();
  send('settings:changed', publicSettings());
  rebuildTray();
}

// electron-builder writes the publish target into resources/app-update.yml. Without it
// (development runs, builds without a GitHub target) the updater stays disabled.
function readUpdateConfig() {
  if (!app.isPackaged) return null;
  try {
    const text = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const value = key => new RegExp(`^${key}:\\s*['"]?([^'"\\r\\n]+)`, 'm').exec(text)?.[1]?.trim();
    return { provider: value('provider'), owner: value('owner'), repo: value('repo') };
  } catch {
    return null;
  }
}

function handleUpdateState(state) {
  send('update:state', state);
  rebuildTray();
  const announcement = `${state.status}:${state.version}`;
  if (announcedUpdate === announcement) return;
  if (state.status === 'ready') {
    announcedUpdate = announcement;
    const when = settings.updateInstall === 'manual' ? 'ist bereit' : 'ist bereit und wird beim Beenden installiert';
    send('chat:system', { text: `Update ${state.version} ${when}. Sofort installieren: Einstellungen → Updates.` });
  } else if (state.status === 'installing') {
    announcedUpdate = announcement;
    send('chat:system', { text: `Update ${state.version} wird installiert. Das Overlay startet gleich neu.` });
  } else if (state.status === 'available' && state.portable) {
    announcedUpdate = announcement;
    send('chat:system', { text: `Version ${state.version} ist verfügbar. Download: Einstellungen → Updates.` });
  }
}

// Starts the swapped portable file and ends this instance. The lock is released
// first, otherwise the new instance would only hand focus to the old one and exit.
function relaunchPortable() {
  const executable = process.env.PORTABLE_EXECUTABLE_FILE;
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PORTABLE_EXECUTABLE')));
  app.releaseSingleInstanceLock();
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', cwd: path.dirname(executable), env });
  // The file is already swapped; if it cannot be started, the next manual start uses it.
  child.once('error', error => reportStorageError('Neue Version konnte nicht gestartet werden', error));
  child.once('spawn', () => {
    child.unref();
    app.quit();
  });
}

function createAppPortableUpdate(config) {
  const executable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!config || !executable) return null;
  const portableUpdate = createPortableUpdate({
    fetchImpl: (url, options) => net.fetch(url, options),
    exePath: executable,
    owner: config.owner,
    repo: config.repo,
    relaunch: relaunchPortable
  });
  portableUpdate.cleanup();
  // The replaced version may still be closing right after an update.
  setTimeout(() => portableUpdate.cleanup({ download: false }), 30000).unref();
  return portableUpdate;
}

function createAppUpdater() {
  const config = readUpdateConfig();
  updateReleasesUrl = config ? releasesUrl(config) : null;
  const enabled = Boolean(updateReleasesUrl);
  const attempt = readJson(updateAttemptPath(), null);
  if (attempt?.version === app.getVersion()) fs.rmSync(updateAttemptPath(), { force: true });
  return createUpdater({
    // Loaded lazily: electron-updater needs a packaged Electron app.
    autoUpdater: enabled ? require('electron-updater').autoUpdater : null,
    currentVersion: app.getVersion(),
    enabled,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    prerelease: settings.updateBeta,
    installMode: settings.updateInstall,
    portableUpdate: enabled ? createAppPortableUpdate(config) : null,
    mayInstallAtStart: version => readJson(updateAttemptPath(), null)?.version !== version,
    // Without the note a failing installer would restart the app on every start,
    // so an attempt that cannot be recorded is not made.
    onInstallAtStart: version => {
      try {
        writeJson(updateAttemptPath(), { version, at: new Date().toISOString() });
        return true;
      } catch (error) {
        reportStorageError('Update-Versuch konnte nicht vermerkt werden', error);
        return false;
      }
    },
    onState: handleUpdateState
  });
}

function registerCaptionsIpc() {
  ipcMain.handle('captions:get-state', event => {
    if (!isCaptionsSender(event)) throw new Error('Nicht vertrauenswürdige IPC-Anfrage blockiert.');
    return captionsPublicState();
  });
  ipcMain.on('captions:audio', (event, chunk) => {
    if (!isCaptionsSender(event)) return;
    if (chunk instanceof ArrayBuffer) captionStream?.sendAudio(Buffer.from(chunk));
    else if (ArrayBuffer.isView(chunk)) captionStream?.sendAudio(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });
  ipcMain.on('captions:speech-end', event => {
    if (isCaptionsSender(event)) captionStream?.finalize();
  });
  ipcMain.on('captions:level', (event, payload) => {
    if (!isCaptionsSender(event)) return;
    if (!captionsLevelSeen) {
      captionsLevelSeen = true;
      recordCaptionEvent('Mikrofon liefert Ton');
    }
    send('captions:level', {
      level: Math.min(100, Math.max(0, Number(payload?.level) || 0)),
      speaking: payload?.speaking === true
    });
  });
  ipcMain.on('captions:devices', (event, devices) => {
    if (!isCaptionsSender(event) || !Array.isArray(devices)) return;
    captionDevices = devices.slice(0, 50).map(device => ({
      deviceId: String(device?.deviceId || '').slice(0, 256),
      label: String(device?.label || 'Mikrofon').slice(0, 120)
    })).filter(device => device.deviceId);
    send('captions:devices', captionDevices);
  });
  ipcMain.on('captions:audio-error', (event, message) => {
    if (!isCaptionsSender(event)) return;
    const next = message ? String(message).slice(0, 300) : null;
    if (connectionDiagnostics.captionsAudioError === next) return;
    recordCaptionEvent(next ? `Mikrofon: ${next}` : 'Mikrofon gestartet');
    if (next) captionsLevelSeen = false;
    connectionDiagnostics.captionsAudioError = next;
    emitDiagnostics();
  });
}

function saveSession(session) {
  writeJson(sessionPath(), {
    accessToken: encrypt(session.accessToken),
    refreshToken: encrypt(session.refreshToken),
    scopes: session.scopes || REQUIRED_SCOPES,
    expiresAt: session.expiresAt || 0,
    user: session.user || null
  });
}

function loadSession() {
  const stored = readJson(sessionPath(), null);
  if (!stored?.accessToken || !stored?.refreshToken) return null;
  try {
    return {
      accessToken: decrypt(stored.accessToken),
      refreshToken: decrypt(stored.refreshToken),
      scopes: stored.scopes || [],
      expiresAt: stored.expiresAt || 0,
      user: stored.user || null
    };
  } catch {
    return null;
  }
}

function deleteSession() {
  try { fs.unlinkSync(sessionPath()); } catch {}
  accessSession = null;
}

function authLogPath() {
  return path.join(app.getPath('userData'), 'auth-events.log');
}

// Twitch answers failed refreshes with {"status":400,"message":"Invalid refresh token"}.
function twitchErrorMessage(body) {
  try {
    return String(JSON.parse(body)?.message || 'keine Angabe').slice(0, 120);
  } catch {
    return String(body || 'keine Angabe').replace(/\s+/g, ' ').slice(0, 120);
  }
}

function captionSourceFilePath() {
  return path.join(app.getPath('userData'), 'Untertitel-Quelle.html');
}

function captionsLogPath() {
  return path.join(app.getPath('userData'), 'captions-events.log');
}

// What the captions did and when: switch, browser source, microphone, speech
// recognition. Spoken text is never written.
function recordCaptionEvent(message) {
  appendEventLog(captionsLogPath, message, 300);
}

function tiktokLogPath() {
  return path.join(app.getPath('userData'), 'tiktok-events.log');
}

// Keeps the reasons for lost logins (never tokens), so a forced re-login can be explained.
function recordAuthEvent(message) {
  appendEventLog(authLogPath, message);
}

// Connection attempts, failures and disconnects of the TikTok chat, so a stream
// without comments can be explained afterwards. The API key is never written.
function recordTikTokEvent(message) {
  let text = String(message);
  for (const key of new Set([tiktokApiKey, tiktokApiKey.toLowerCase()])) {
    if (key) text = text.split(key).join('[Key]');
  }
  appendEventLog(tiktokLogPath, text.replace(/(api[-_]?key=)[^&\s"']+/gi, '$1[Key]'), 300);
}

function tiktokErrorDetail(error, additionalError = null) {
  return nestedErrorText(error, additionalError).replace(/\s+/g, ' ').trim().slice(0, 400);
}

function appendEventLog(logPath, message, limit = 100) {
  try {
    const file = logPath();
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
    lines.push(`${new Date().toISOString()} v${app.getVersion()} ${message}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.slice(-limit).join('\n')}\n`, 'utf8');
  } catch {}
}

function requireNewTwitchLogin(reason) {
  recordAuthEvent(`Neue Anmeldung erforderlich: ${reason}`);
  ++twitchGeneration;
  clearTwitchReconnect();
  deleteSession();
  closeEventSocket();
  closeIrcSocket();
  clearInterval(streamPollTimer);
  streamPollTimer = null;
  activeBroadcaster = null;
  updateStreamMetrics({ twitchLive: false, twitchViewers: null, twitchStartedAt: null });
  authRequirementReason = reason;
  send('auth:required');
  send('app:state', publicState());
  updateOverallStatus();
}

function hasRequiredScopes(scopes) {
  const granted = new Set(Array.isArray(scopes) ? scopes : String(scopes || '').split(/\s+/));
  return REQUIRED_SCOPES.every(scope => granted.has(scope));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function publicState() {
  return {
    settings: publicSettings(),
    metrics: { ...streamMetrics },
    overlayVisible,
    authenticated: Boolean(accessSession?.user),
    user: accessSession?.user || null,
    tiktokConfigured: Boolean(settings?.tiktokUsername),
    authRequirementReason,
    captionDevices,
    update: updater?.state || null,
    diagnostics: { ...connectionDiagnostics }
  };
}

function publicSettings() {
  return {
    ...settings,
    tiktokApiKeyConfigured: Boolean(tiktokApiKey),
    deeplApiKeyConfigured: Boolean(deeplApiKey),
    deepgramApiKeyConfigured: Boolean(deepgramApiKey),
    captionsUrl: captionServer?.url || null
  };
}

function emitDiagnostics() {
  send('twitch:diagnostics', { ...connectionDiagnostics });
}

function updateStreamMetrics(patch) {
  let changed = false;
  const next = { ...streamMetrics };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in next) || Object.is(next[key], value)) continue;
    next[key] = value;
    changed = true;
  }
  if (!changed) return;
  streamMetrics = next;
  send('stream:metrics', { ...streamMetrics });
}

function updateTwitchStreamMetrics(stream) {
  const startedAt = isoTimestamp(stream?.started_at);
  updateStreamMetrics({
    twitchLive: Boolean(stream),
    twitchViewers: stream ? normalizeViewerCount(stream.viewer_count) : null,
    twitchStartedAt: stream ? startedAt : null
  });
}

function updateTikTokViewerMetrics(data) {
  const viewers = tiktokViewerCount(data);
  if (viewers !== null) updateStreamMetrics({ tiktokViewers: viewers });
}

function setConnectionPart(part, connected, error = null) {
  connectionDiagnostics[part] = connected;
  if (connected && (part === 'irc' || part === 'eventSub')) {
    twitchReconnectAttempt = 0;
  }
  if (error) connectionDiagnostics.lastError = error;
  emitDiagnostics();
  updateOverallStatus();
}

function updateOverallStatus() {
  if (!accessSession?.user) {
    if (!settings?.tiktokUsername) {
      setStatus('signed-out', 'Mit Twitch anmelden');
    } else if (connectionDiagnostics.tiktok) {
      setStatus('connected', `TikTok @${settings.tiktokUsername} ✓ · Twitch nicht angemeldet`);
    } else if (connectionDiagnostics.tiktokState === 'error') {
      setStatus('error', `TikTok Fehler · Twitch nicht angemeldet`);
    } else {
      setStatus('connecting', `TikTok @${settings.tiktokUsername} wartet · Twitch nicht angemeldet`);
    }
    return;
  }
  const twitchConnected = connectionDiagnostics.eventSub || connectionDiagnostics.irc;
  const tiktokWanted = Boolean(settings.tiktokUsername);
  const tiktokLabel = !tiktokWanted ? '' : connectionDiagnostics.tiktok
    ? ' · TikTok ✓'
    : connectionDiagnostics.tiktokState === 'error' ? ' · TikTok Fehler' : ' · TikTok wartet';
  if (twitchConnected) {
    const state = tiktokWanted && connectionDiagnostics.tiktokState === 'error' ? 'error' : 'connected';
    setStatus(state, `#${activeBroadcaster?.login || settings.channel} · Twitch ✓${tiktokLabel}`);
  } else {
    setStatus('connecting', `Twitch verbindet · EventSub ${connectionDiagnostics.eventSub ? '✓' : '…'} · IRC ${connectionDiagnostics.irc ? '✓' : '…'}${tiktokLabel}`);
  }
}

function setStatus(state, detail = '') {
  send('twitch:status', { state, detail });
  rebuildTray();
}

function validBounds(bounds, minWidth = 360, minHeight = 320) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
      bounds.width < minWidth || bounds.height < minHeight) return false;
  const displays = screen.getAllDisplays();
  return displays.some(({ workArea }) => {
    const horizontal = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x;
    const vertical = bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return horizontal && vertical;
  });
}

function createTrayImage() {
  const windowsIcon = path.join(__dirname, 'assets', 'tray-icon.ico');
  const pngIcon = path.join(__dirname, 'assets', 'tray-icon.png');
  let image = nativeImage.createFromPath(process.platform === 'win32' ? windowsIcon : pngIcon);
  if (image.isEmpty()) image = nativeImage.createFromPath(pngIcon);
  return image;
}

function createWindow() {
  const saved = sanitizeBounds(settings.bounds, DEFAULT_SETTINGS.bounds);
  const bounds = validBounds(saved) ? saved : DEFAULT_SETTINGS.bounds;
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 320,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    icon: createTrayImage(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.on('will-download', event => event.preventDefault());
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setContentProtection(Boolean(settings.streamSafe));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(error => {
    reportConnectionError(new Error(`Overlay-Oberfläche konnte nicht geladen werden: ${error.message}`));
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    send('app:state', publicState());
  });

  let boundsTimer;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
      settings.bounds = mainWindow.getBounds();
      try {
        saveSettings();
      } catch (error) {
        reportStorageError('Fensterposition konnte nicht gespeichert werden', error);
      }
    }, 300);
  };
  mainWindow.on('move', rememberBounds);
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      overlayVisible = false;
      mainWindow.hide();
      send('app:state', publicState());
      rebuildTray();
    }
  });
}

function rebuildTray() {
  if (!tray) return;
  const update = updater?.state;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(update?.status === 'ready' ? [
      { label: `Update ${update.version} installieren und neu starten`, click: () => updater.installNow() },
      { type: 'separator' }
    ] : []),
    { label: overlayVisible ? 'Overlay ausblenden' : 'Overlay anzeigen', click: toggleOverlay },
    {
      label: 'Stream-Safe (vor Aufnahmen verbergen)',
      type: 'checkbox',
      checked: Boolean(settings.streamSafe),
      click: item => updateStreamSafe(item.checked)
    },
    {
      label: 'Stream-Untertitel',
      type: 'checkbox',
      checked: Boolean(settings.captionsEnabled),
      click: item => setCaptionsEnabled(item.checked)
    },
    { label: 'Chat leeren', click: clearCurrentHistory },
    { type: 'separator' },
    { label: 'Alle Chats neu verbinden', enabled: Boolean(accessSession || settings.tiktokUsername), click: reconnectAll },
    { label: 'Von Twitch abmelden', enabled: Boolean(accessSession), click: logout },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } }
  ]));
}

function updateStreamSafe(enabled) {
  settings.streamSafe = Boolean(enabled);
  try {
    saveSettings();
  } catch (error) {
    reportStorageError('Stream-Safe-Einstellung konnte nicht gespeichert werden', error);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setContentProtection(settings.streamSafe);
  send('settings:changed', publicSettings());
  rebuildTray();
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip('Stream Chat Overlay');
  tray.on('click', () => {
    if (!overlayVisible) toggleOverlay();
  });
  rebuildTray();
}

function toggleOverlay() {
  overlayVisible = !overlayVisible;
  if (overlayVisible) mainWindow.showInactive(); else mainWindow.hide();
  send('app:state', publicState());
  rebuildTray();
}

function registerShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Shift+H', toggleOverlay],
    ['CommandOrControl+Shift+C', clearCurrentHistory]
  ];
  const failed = shortcuts.filter(([accelerator, handler]) => !globalShortcut.register(accelerator, handler));
  if (failed.length) {
    connectionDiagnostics.lastError = `Globale Tastenkürzel belegt: ${failed.map(([value]) => value).join(', ')}`;
    emitDiagnostics();
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Zeitüberschreitung')), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Keep the abort signal and deadline active until the entire body is read.
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: async () => body,
      json: async () => JSON.parse(body)
    };
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error(`Twitch antwortet seit ${Math.round(timeoutMs / 1000)} Sekunden nicht.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}

async function twitchRequest(url, options = {}, retry = true) {
  if (!accessSession) throw new Error('Nicht bei Twitch angemeldet.');
  const token = await ensureAccessToken();
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Client-Id': settings.clientId,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry) {
    await refreshAccessToken();
    return twitchRequest(url, options, false);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Twitch API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function validateAccessToken() {
  if (!accessSession?.accessToken) return null;
  const response = await fetchWithTimeout(TWITCH_VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessSession.accessToken}` }
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Twitch-Anmeldung konnte nicht geprüft werden (${response.status}).`);
  return response.json();
}

async function performRefreshAccessToken() {
  if (!accessSession?.refreshToken || !settings.clientId) throw new Error('Eine neue Twitch-Anmeldung ist erforderlich.');
  const sessionToRefresh = accessSession;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: sessionToRefresh.refreshToken,
    client_id: settings.clientId
  });
  const response = await fetchWithTimeout(TWITCH_TOKEN_URL, { method: 'POST', body: form });
  if (accessSession !== sessionToRefresh) throw new Error('Die Twitch-Anmeldung wurde zwischenzeitlich geändert.');
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if ([400, 401, 403].includes(response.status)) {
      // Refresh tokens are single-use. If another process using the same login file
      // (e.g. a second copy of the app) refreshed first, adopt its newer token.
      const stored = loadSession();
      if (stored?.refreshToken && stored.refreshToken !== sessionToRefresh.refreshToken) {
        recordAuthEvent(`Erneuerung abgelehnt (${response.status}), neuere gespeicherte Anmeldung übernommen`);
        accessSession = { ...stored, user: stored.user || sessionToRefresh.user };
        if (accessSession.expiresAt - Date.now() > 60 * 1000) return accessSession.accessToken;
        throw new Error('Die Twitch-Anmeldung wurde gerade von einer anderen App-Instanz erneuert.');
      }
      recordAuthEvent(`Erneuerung abgelehnt (${response.status}): ${twitchErrorMessage(detail)}`);
      if (/client secret/i.test(detail)) {
        requireNewTwitchLogin(CONFIDENTIAL_CLIENT_REASON);
        throw new Error(CONFIDENTIAL_CLIENT_REASON);
      }
      requireNewTwitchLogin('Die Twitch-Anmeldung ist abgelaufen. Bitte erneut anmelden.');
      throw new Error('Die Twitch-Anmeldung ist abgelaufen. Bitte erneut anmelden.');
    }
    recordAuthEvent(`Erneuerung vorübergehend fehlgeschlagen (${response.status})`);
    throw new Error(`Twitch konnte die Anmeldung vorübergehend nicht erneuern (${response.status}).`);
  }
  const token = await response.json();
  if (!token?.access_token) throw new Error('Twitch hat beim Erneuern kein Zugriffstoken geliefert.');
  accessSession = {
    ...accessSession,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || sessionToRefresh.refreshToken,
    scopes: token.scope || accessSession.scopes,
    expiresAt: expiryFromSeconds(token.expires_in)
  };
  saveSession(accessSession);
  return accessSession.accessToken;
}

function expiryFromSeconds(seconds) {
  // A missing or zero lifetime would otherwise force a token refresh on every request.
  const value = Number(seconds);
  return Date.now() + (Number.isFinite(value) && value > 0 ? value : 3600) * 1000;
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = performRefreshAccessToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function ensureAccessToken() {
  if (!accessSession) throw new Error('Nicht bei Twitch angemeldet.');
  if (!accessSession.expiresAt || accessSession.expiresAt - Date.now() < 10 * 60 * 1000) {
    await refreshAccessToken();
  }
  return accessSession.accessToken;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function beginDeviceAuth(clientId) {
  const normalized = String(clientId || '').trim();
  if (!/^[a-z0-9]{10,64}$/i.test(normalized)) {
    throw new Error('Die Twitch Client-ID sieht nicht gültig aus.');
  }
  settings.clientId = normalized;
  saveSettings();
  const generation = ++authPollGeneration;
  const scopes = REQUIRED_SCOPES.join(' ');
  const response = await fetchWithTimeout(TWITCH_DEVICE_URL, {
    method: 'POST',
    body: new URLSearchParams({ client_id: normalized, scopes })
  });
  if (!response.ok) throw new Error(`Twitch konnte die Anmeldung nicht starten (${response.status}).`);
  const device = await response.json();
  const info = {
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresIn: device.expires_in
  };
  send('auth:device', info);
  if (isAllowedExternalUrl(device.verification_uri, ['twitch.tv', 'www.twitch.tv'])) {
    shell.openExternal(device.verification_uri).catch(() => {});
  }
  pollDeviceToken(device, normalized, generation).catch(error => {
    if (generation === authPollGeneration) send('auth:error', { message: error.message });
  });
  return info;
}

async function pollDeviceToken(device, clientId, generation) {
  const startedAt = Date.now();
  const expiresAt = startedAt + device.expires_in * 1000;
  let interval = Math.max(3, device.interval || 5);
  while (Date.now() < expiresAt && generation === authPollGeneration) {
    await delay(interval * 1000);
    const form = new URLSearchParams({
      client_id: clientId,
      scopes: REQUIRED_SCOPES.join(' '),
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });
    let response;
    try {
      response = await fetchWithTimeout(TWITCH_TOKEN_URL, { method: 'POST', body: form });
    } catch (error) {
      if (generation === authPollGeneration && Date.now() < expiresAt) continue;
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (generation !== authPollGeneration) return;
    if (response.ok) {
      accessSession = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        scopes: body.scope || REQUIRED_SCOPES,
        expiresAt: expiryFromSeconds(body.expires_in),
        user: null
      };
      const validation = await validateAccessToken();
      if (!validation) throw new Error('Twitch konnte die neue Anmeldung nicht prüfen.');
      if (!hasRequiredScopes(validation.scopes)) {
        deleteSession();
        throw new Error('Twitch hat nicht alle benötigten Berechtigungen freigegeben. Bitte erneut versuchen.');
      }
      accessSession.user = {
        id: validation.user_id,
        login: validation.login,
        displayName: validation.login
      };
      authRequirementReason = null;
      if (!settings.channel) settings.channel = validation.login;
      saveSettings();
      saveSession(accessSession);
      // Refresh once right away. A wrongly configured Twitch application then fails
      // here with a clear message instead of logging the user out hours later mid-stream.
      try {
        await refreshAccessToken();
      } catch {
        if (!accessSession) return;
      }
      send('auth:success', publicState());
      send('app:state', publicState());
      // The login itself succeeded. Connection failures are reported and retried by
      // connectTwitchAndReport and must not surface as a login error.
      connectTwitchAndReport().catch(() => {});
      return;
    }
    const message = String(body.message || '').toLowerCase();
    if (message.includes('authorization_pending')) continue;
    if (message.includes('slow_down')) { interval += 5; continue; }
    if (response.status === 429 || response.status >= 500) continue;
    if (message.includes('access_denied')) throw new Error('Die Twitch-Anmeldung wurde abgebrochen.');
    if (message.includes('expired')) throw new Error('Der Twitch-Anmeldecode ist abgelaufen.');
    throw new Error(body.message || `Twitch-Anmeldung fehlgeschlagen (${response.status}).`);
  }
  if (generation === authPollGeneration) throw new Error('Der Twitch-Anmeldecode ist abgelaufen.');
}

async function hydrateSession() {
  accessSession = loadSession();
  if (!accessSession || !settings.clientId) {
    accessSession = null;
    return false;
  }
  try {
    let validation = await validateAccessToken();
    if (!validation) {
      await refreshAccessToken();
      validation = await validateAccessToken();
    }
    if (!validation) return false;
    if (!hasRequiredScopes(validation.scopes)) {
      deleteSession();
      authRequirementReason = 'Die gespeicherte Twitch-Anmeldung enthält nicht alle benötigten Berechtigungen. Bitte erneut anmelden.';
      return false;
    }
    accessSession.expiresAt = expiryFromSeconds(validation.expires_in);
    accessSession.scopes = validation.scopes || accessSession.scopes;
    accessSession.user = {
      id: validation.user_id,
      login: validation.login,
      displayName: accessSession.user?.displayName || validation.login
    };
    saveSession(accessSession);
    return true;
  } catch (error) {
    if (!accessSession) return false;
    connectionDiagnostics.lastError = `Twitch-Anmeldung konnte beim Start nicht geprüft werden: ${error.message}`;
    emitDiagnostics();
    return Boolean(accessSession.user);
  }
}

async function resolveBroadcaster() {
  const requested = String(settings.channel || accessSession.user.login).replace(/^#/, '').trim().toLowerCase();
  if (requested === accessSession.user.login.toLowerCase()) return accessSession.user;
  const result = await twitchRequest(`${TWITCH_API_URL}/users?login=${encodeURIComponent(requested)}`);
  const user = result?.data?.[0];
  if (!user) throw new Error(`Der Twitch-Kanal „${requested}“ wurde nicht gefunden.`);
  return { id: user.id, login: user.login, displayName: user.display_name };
}

async function syncTwitchStreamHistory(broadcaster, emitUnchanged = true, generation = twitchGeneration) {
  const result = await twitchRequest(`${TWITCH_API_URL}/streams?user_id=${encodeURIComponent(broadcaster.id)}`);
  if (generation !== twitchGeneration) return null;
  const stream = result?.data?.[0] || null;
  updateTwitchStreamMetrics(stream);
  const existing = historyStore.twitch;
  if (!stream) {
    if (existing) {
      historyStore.twitch = null;
      saveHistorySoon();
      send('chat:clear', { platform: 'twitch' });
    }
    return null;
  }
  if (!existing || existing.broadcasterId !== broadcaster.id || existing.streamId !== stream.id) {
    historyStore.twitch = {
      broadcasterId: broadcaster.id,
      broadcasterLogin: broadcaster.login,
      streamId: stream.id,
      startedAt: stream.started_at || null,
      entries: [],
      lastUpdated: Date.now()
    };
    confirmedHistory.add('twitch');
    saveHistorySoon();
    // Only drop messages that belong to a previous stream; chat from before the
    // first live detection stays visible and fades normally.
    if (existing) send('chat:clear', { platform: 'twitch' });
  } else if (!confirmedHistory.has('twitch')) {
    // The stored history belongs to the stream that is still running: show it now.
    confirmedHistory.add('twitch');
    emitHistory();
  } else if (emitUnchanged) {
    emitHistory();
  }
  return stream;
}

function startStreamHistoryPolling(broadcaster, generation) {
  clearInterval(streamPollTimer);
  if (!broadcaster || !accessSession || generation !== twitchGeneration) return;
  streamPollTimer = setInterval(() => {
    if (!accessSession || generation !== twitchGeneration) return;
    // Refresh viewer metrics without rebuilding identical message elements.
    // Stream start/end still emits the changed history inside the sync function.
    syncTwitchStreamHistory(broadcaster, false, generation).catch(error => {
      if (generation !== twitchGeneration) return;
      connectionDiagnostics.lastError = `Streamstatus: ${error.message}`;
      emitDiagnostics();
    });
  }, 60000);
  streamPollTimer.unref();
}

async function loadBadges(broadcasterId) {
  const results = await Promise.allSettled([
    twitchRequest(`${TWITCH_API_URL}/chat/badges/global`),
    twitchRequest(`${TWITCH_API_URL}/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`)
  ]);
  const [globalResult, channelResult] = results.map(result => result.status === 'fulfilled' ? result.value : null);
  const map = {};
  for (const set of [...(globalResult?.data || []), ...(channelResult?.data || [])]) {
    map[set.set_id] ||= {};
    for (const version of set.versions || []) {
      map[set.set_id][version.id] = version.image_url_2x || version.image_url_1x;
    }
  }
  return {
    map,
    errors: results.filter(result => result.status === 'rejected').map(result => result.reason)
  };
}

function decorateBadges(badges = []) {
  return badges.map(badge => ({ ...badge, url: badgeMap[badge.set_id]?.[badge.id] || null }));
}

function dispatchChatMessage(event, source, options = {}) {
  const now = Date.now();
  event.platform ||= source === 'TikTok' ? 'tiktok' : 'twitch';
  event.timestamp ||= now;
  // Map iteration follows insertion order, so the first fresh entry ends the sweep.
  for (const [key, timestamp] of seenMessageIds) {
    if (now - timestamp <= 120000) break;
    seenMessageIds.delete(key);
  }
  const fallback = `${event.chatter_user_id || event.chatter_user_login}:${event.message?.text || ''}:${Math.floor(now / 5000)}`;
  const key = event.message_id || fallback;
  if (seenMessageIds.has(key)) return;
  seenMessageIds.set(key, now);
  connectionDiagnostics.messagesReceived += 1;
  connectionDiagnostics.lastSource = source;
  emitDiagnostics();
  rememberMessage(event);
  recordHistory(event.platform, 'message', event);
  send('chat:message', { ...event, historyReplay: options.historyReplay === true });
}

function clearConnectionTimers() {
  clearTimeout(keepaliveTimer);
  clearTimeout(reconnectTimer);
  keepaliveTimer = null;
  reconnectTimer = null;
}

function resetKeepalive(seconds, generation, broadcaster, socket) {
  clearTimeout(keepaliveTimer);
  keepaliveTimer = setTimeout(() => {
    if (generation !== twitchGeneration || socket !== eventSocket || quitting) return;
    setStatus('reconnecting', 'Keine Antwort von Twitch – Verbindung wird erneuert');
    connectEventSub(EVENTSUB_URL, false, broadcaster, generation).catch(error => {
      if (generation === twitchGeneration) reportConnectionError(error);
    });
  }, (seconds + 10) * 1000);
}

function closeEventSocket() {
  clearConnectionTimers();
  closeWebSocket(eventSocket);
  closeWebSocket(previousEventSocket);
  eventSocket = null;
  previousEventSocket = null;
  connectionDiagnostics.eventSub = false;
  connectionDiagnostics.follows = false;
  emitDiagnostics();
}

function closeWebSocket(socket) {
  if (!socket) return;
  socket.removeAllListeners();
  // Closing a socket during its handshake may emit an asynchronous error.
  socket.on('error', () => {});
  try { socket.close(); } catch {}
}

function closeIrcSocket() {
  clearTimeout(ircReconnectTimer);
  ircReconnectTimer = null;
  if (ircSocket) {
    closeWebSocket(ircSocket);
    ircSocket = null;
  }
  connectionDiagnostics.irc = false;
  emitDiagnostics();
}

async function connectIrc(broadcaster, generation) {
  if (!broadcaster) throw new Error('Der Twitch-Kanal konnte für IRC nicht aufgelöst werden.');
  const token = await ensureAccessToken();
  if (generation !== twitchGeneration || quitting) return;
  closeIrcSocket();
  let buffer = '';
  let joined = false;
  const userLogin = accessSession?.user?.login?.toLowerCase();
  if (!userLogin) throw new Error('Die Twitch-Anmeldung enthält keinen Benutzernamen.');
  const socket = new WebSocket(IRC_URL, { handshakeTimeout: 15000 });
  ircSocket = socket;

  socket.on('open', () => {
    if (generation !== twitchGeneration || socket !== ircSocket) return;
    socket.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands');
    socket.send(`PASS oauth:${token}`);
    socket.send(`NICK ${userLogin}`);
    socket.send(`JOIN #${broadcaster.login.toLowerCase()}`);
  });
  socket.on('message', data => {
    if (generation !== twitchGeneration || socket !== ircSocket) return;
    buffer += data.toString();
    const lines = buffer.split('\r\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const parsed = parseIrcLine(line);
      if (!parsed) continue;
      if (parsed.command === 'PING') {
        socket.send(`PONG :${parsed.trailing || 'tmi.twitch.tv'}`);
      } else if (parsed.command === '366' || (parsed.command === 'JOIN' && parsed.prefix.toLowerCase().startsWith(`${userLogin}!`))) {
        if (!joined) {
          joined = true;
          ircReconnectAttempt = 0;
          setConnectionPart('irc', true);
          send('chat:system', { text: `Chat-Empfang für #${broadcaster.login} ist aktiv.` });
        }
      } else if (parsed.command === 'PRIVMSG') {
        const event = toChatEvent(parsed, badgeMap);
        if (event) dispatchChatMessage(event, 'IRC');
      } else if (parsed.command === 'NOTICE' && /authentication failed|improperly formatted auth/i.test(parsed.trailing)) {
        setConnectionPart('irc', false, parsed.trailing);
        reportConnectionError(new Error('Twitch-IRC-Anmeldung fehlgeschlagen. Bitte einmal ab- und wieder anmelden.'));
      } else if (parsed.command === 'RECONNECT') {
        socket.close();
      }
    }
  });
  socket.on('error', error => {
    if (generation === twitchGeneration && socket === ircSocket) setConnectionPart('irc', false, error.message);
  });
  socket.on('close', () => {
    if (quitting || generation !== twitchGeneration || socket !== ircSocket) return;
    setConnectionPart('irc', false, 'IRC-Verbindung unterbrochen');
    scheduleIrcReconnect(broadcaster, generation);
  });
}

function scheduleIrcReconnect(broadcaster, generation) {
  clearTimeout(ircReconnectTimer);
  ircReconnectTimer = null;
  if (generation !== twitchGeneration || quitting || !accessSession?.user) return;
  ircReconnectTimer = setTimeout(() => {
    ircReconnectTimer = null;
    if (generation !== twitchGeneration || quitting || !accessSession?.user) return;
    connectIrc(broadcaster, generation).catch(error => {
      if (generation !== twitchGeneration || quitting) return;
      reportConnectionError(error);
      scheduleIrcReconnect(broadcaster, generation);
    });
  }, reconnectDelay(ircReconnectAttempt++));
}

async function createChatSubscriptions(sessionId, broadcasterId) {
  const types = [
    'channel.chat.message',
    'channel.chat.notification',
    'channel.chat.message_delete',
    'channel.chat.clear_user_messages',
    'channel.chat.clear'
  ];
  for (const type of types) {
    await twitchRequest(`${TWITCH_API_URL}/eventsub/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        version: '1',
        condition: {
          broadcaster_user_id: broadcasterId,
          user_id: accessSession.user.id
        },
        transport: { method: 'websocket', session_id: sessionId }
      })
    });
  }
}

async function createFollowSubscription(sessionId, broadcasterId) {
  await twitchRequest(`${TWITCH_API_URL}/eventsub/subscriptions`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'channel.follow',
      version: '2',
      condition: {
        broadcaster_user_id: broadcasterId,
        moderator_user_id: accessSession.user.id
      },
      transport: { method: 'websocket', session_id: sessionId }
    })
  });
}

function followSubscriptionError(error, broadcaster) {
  const raw = String(error?.message || error || 'Unbekannter Fehler');
  if (/\b(401|403)\b|unauthorized|forbidden/i.test(raw)) {
    return `Twitch-Follows sind nicht freigegeben: Das angemeldete Konto muss ${broadcaster?.displayName || broadcaster?.login || 'beim Zielkanal'} selbst oder dort Moderator sein.`;
  }
  return `Twitch-Follows konnten nicht aktiviert werden: ${raw}`;
}

function handleEventSubNotification(payload) {
  const type = payload?.metadata?.subscription_type;
  const event = payload?.payload?.event;
  if (!type || !event) return;
  const deliveryId = payload.metadata.message_id;
  if (deliveryId) {
    const now = Date.now();
    for (const [id, timestamp] of seenEventSubIds) {
      if (now - timestamp <= 120000) break;
      seenEventSubIds.delete(id);
    }
    if (seenEventSubIds.has(deliveryId)) return;
    seenEventSubIds.set(deliveryId, now);
  }
  if (type === 'channel.chat.message') {
    dispatchChatMessage({
      ...event,
      platform: 'twitch',
      timestamp: Date.now(),
      badges: decorateBadges(event.badges),
      source_badges: decorateBadges(event.source_badges)
    }, 'EventSub');
  } else if (type === 'channel.chat.notification') {
    const notice = {
      ...event,
      platform: 'twitch',
      timestamp: Date.now(),
      badges: decorateBadges(event.badges),
      source_badges: decorateBadges(event.source_badges)
    };
    connectionDiagnostics.messagesReceived += 1;
    connectionDiagnostics.lastSource = 'Twitch-Ereignis';
    emitDiagnostics();
    recordHistory('twitch', 'notice', notice);
    send('chat:notice', notice);
  } else if (type === 'channel.follow') {
    const notice = toTwitchFollowNotice(event);
    connectionDiagnostics.messagesReceived += 1;
    connectionDiagnostics.lastSource = 'Twitch-Follow';
    emitDiagnostics();
    recordHistory('twitch', 'notice', notice);
    send('chat:notice', notice);
  } else if (type === 'channel.chat.message_delete') {
    removeHistoryWhere(entry => entry.platform === 'twitch' && entry.payload?.message_id === event.message_id);
    send('chat:delete', { platform: 'twitch', messageId: event.message_id });
  } else if (type === 'channel.chat.clear_user_messages') {
    removeHistoryWhere(entry => entry.platform === 'twitch' && entry.payload?.chatter_user_id === event.target_user_id);
    send('chat:clear-user', { platform: 'twitch', userId: event.target_user_id });
  } else if (type === 'channel.chat.clear') {
    clearPlatformHistory('twitch');
  }
}

async function connectEventSub(url, continuation, broadcaster, generation) {
  if (generation !== twitchGeneration || quitting) return;
  if (continuation && previousEventSocket) return;
  if (!continuation) closeEventSocket();
  const socket = new WebSocket(url, { handshakeTimeout: 15000 });
  const previous = continuation ? eventSocket : null;
  previousEventSocket = previous;
  eventSocket = socket;
  let keepaliveSeconds = 10;

  socket.on('open', () => {
    if (generation === twitchGeneration && socket === eventSocket) {
      setStatus('connecting', 'EventSub verbunden – Chat wird abonniert');
    }
  });
  socket.on('message', async data => {
    if (generation !== twitchGeneration || (socket !== eventSocket && socket !== previousEventSocket)) return;
    let envelope;
    try { envelope = JSON.parse(data.toString()); } catch { return; }
    resetKeepalive(keepaliveSeconds, generation, broadcaster, eventSocket);
    const messageType = envelope?.metadata?.message_type;
    if (messageType === 'session_welcome') {
      const session = envelope.payload.session;
      keepaliveSeconds = session.keepalive_timeout_seconds || 10;
      resetKeepalive(keepaliveSeconds, generation, broadcaster, socket);
      if (!continuation) {
        try {
          await createChatSubscriptions(session.id, broadcaster.id);
          if (generation !== twitchGeneration || socket !== eventSocket) return;
          eventReconnectAttempt = 0;
          setConnectionPart('eventSub', true);
          try {
            await createFollowSubscription(session.id, broadcaster.id);
            if (generation !== twitchGeneration || socket !== eventSocket) return;
            connectionDiagnostics.follows = true;
            connectionDiagnostics.followError = null;
          } catch (error) {
            connectionDiagnostics.follows = false;
            connectionDiagnostics.followError = followSubscriptionError(error, broadcaster);
          }
          emitDiagnostics();
        } catch (error) {
          if (generation !== twitchGeneration || socket !== eventSocket) return;
          reportConnectionError(error);
          socket.close();
        }
      } else {
        eventReconnectAttempt = 0;
        setConnectionPart('eventSub', true);
        if (previous && previous !== socket) {
          closeWebSocket(previous);
          if (previousEventSocket === previous) previousEventSocket = null;
        }
      }
    } else if (messageType === 'session_keepalive') {
      return;
    } else if (messageType === 'notification') {
      handleEventSubNotification(envelope);
    } else if (messageType === 'session_reconnect') {
      if (socket !== eventSocket) return;
      const reconnectUrl = envelope.payload?.session?.reconnect_url;
      if (reconnectUrl) connectEventSub(reconnectUrl, true, broadcaster, generation).catch(error => {
        if (generation === twitchGeneration) reportConnectionError(error);
      });
    } else if (messageType === 'revocation') {
      const revokedType = envelope?.metadata?.subscription_type || envelope?.payload?.subscription?.type;
      if (revokedType === 'channel.follow') {
        connectionDiagnostics.follows = false;
        connectionDiagnostics.followError = 'Twitch hat die Follow-Berechtigung widerrufen. Bitte erneut anmelden.';
        emitDiagnostics();
      } else {
        setConnectionPart('eventSub', false, 'Twitch hat eine Chat-Berechtigung widerrufen');
        setStatus('error', 'Twitch hat eine Chat-Berechtigung widerrufen');
      }
    }
  });
  socket.on('error', error => {
    if (generation === twitchGeneration && socket === eventSocket) setStatus('reconnecting', error.message);
  });
  socket.on('close', () => {
    if (quitting || generation !== twitchGeneration || socket !== eventSocket) return;
    clearTimeout(keepaliveTimer);
    connectionDiagnostics.follows = false;
    setConnectionPart('eventSub', false, 'EventSub-Verbindung unterbrochen');
    if (previous && previous !== socket) {
      closeWebSocket(previous);
      if (previousEventSocket === previous) previousEventSocket = null;
    }
    setStatus('reconnecting', 'Verbindung unterbrochen');
    const retryIn = reconnectDelay(eventReconnectAttempt++);
    reconnectTimer = setTimeout(() => {
      if (generation !== twitchGeneration || quitting) return;
      connectEventSub(EVENTSUB_URL, false, broadcaster, generation).catch(error => {
        if (generation === twitchGeneration) reportConnectionError(error);
      });
    }, retryIn);
  });
}

function scheduleTikTokReconnect(delay = 30000) {
  clearTimeout(tiktokReconnectTimer);
  if (!settings.tiktokUsername || quitting) return;
  connectionDiagnostics.tiktokRetryAt = Date.now() + delay;
  emitDiagnostics();
  tiktokReconnectTimer = setTimeout(() => connectTikTok().catch(() => {}), delay);
}

// The connector ignores disconnect() while it is still connecting and then opens the
// socket anyway. Such a connection would stay alive unseen and keep an Euler slot
// busy, so it is closed a second time as soon as its connect() has settled.
function discardTikTokConnection(connection) {
  if (!connection) return;
  connection.removeAllListeners();
  const disconnect = () => Promise.resolve().then(() => connection.disconnect()).catch(() => {});
  disconnect();
  tiktokConnecting.get(connection)?.then(disconnect, () => {});
}

// A stream that ends on TikTok's side is easy to miss while the Twitch stream goes
// on, so it gets a message that stays in the chat and a Windows notification.
function announceTikTokEnd(suspended) {
  if (!tiktokWasLive) return;
  tiktokWasLive = false;
  const text = suspended
    ? 'TikTok hat den LIVE-Stream gesperrt. Auf TikTok wird nicht mehr gesendet.'
    : 'Der TikTok-LIVE-Stream ist beendet. Auf TikTok wird nicht mehr gesendet.';
  send('chat:system', { text, error: true, sticky: true });
  try {
    if (typeof Notification === 'function' && Notification.isSupported()) {
      new Notification({ title: suspended ? 'TikTok-LIVE gesperrt' : 'TikTok-LIVE beendet', body: text }).show();
    }
  } catch {}
}

function closeTikTokConnection(clearHistory = false) {
  ++tiktokGeneration;
  // Changing the account or reconnecting by hand is not a stream end.
  tiktokWasLive = false;
  clearTimeout(tiktokReconnectTimer);
  tiktokReconnectTimer = null;
  const connection = tiktokConnection;
  tiktokConnection = null;
  discardTikTokConnection(connection);
  connectionDiagnostics.tiktok = false;
  connectionDiagnostics.tiktokRetryAt = null;
  updateStreamMetrics({
    tiktokLive: false,
    tiktokViewers: null,
    ...(clearHistory ? { tiktokStartedAt: null } : {})
  });
  emitDiagnostics();
  if (clearHistory && historyStore.tiktok) {
    historyStore.tiktok = null;
    saveHistorySoon();
    send('chat:clear', { platform: 'tiktok' });
  }
}

function tiktokStartMarker(connection) {
  const info = connection?.roomInfo?.data || connection?.roomInfo || {};
  return String(
    info.startTime || info.start_time || info.createTime || info.create_time ||
    info.liveRoom?.startTime || info.liveRoom?.start_time || ''
  );
}

function activateTikTokHistory(username, roomId, connection) {
  const startMarker = tiktokStartMarker(connection);
  const existing = historyStore.tiktok;
  const sameSession = existing && existing.username === username && existing.roomId === String(roomId) &&
    (!startMarker || !existing.startMarker || existing.startMarker === startMarker);
  const startedAt = isoTimestamp(startMarker) || (sameSession ? isoTimestamp(existing.startedAt) : null) || new Date().toISOString();
  if (!sameSession) {
    historyStore.tiktok = {
      username,
      roomId: String(roomId),
      startMarker,
      startedAt,
      entries: [],
      lastUpdated: Date.now()
    };
    confirmedHistory.add('tiktok');
    saveHistorySoon();
    if (existing) send('chat:clear', { platform: 'tiktok' });
  } else {
    if (!existing.startedAt) {
      existing.startedAt = startedAt;
      saveHistorySoon();
    }
    if (!confirmedHistory.has('tiktok')) {
      confirmedHistory.add('tiktok');
      emitHistory();
    }
  }
  return startedAt;
}

function dispatchTikTokGift(event) {
  connectionDiagnostics.messagesReceived += 1;
  connectionDiagnostics.lastSource = 'TikTok-Geschenk';
  emitDiagnostics();
  recordHistory('tiktok', 'gift', event, event.gift_key);
  send('chat:gift', event);
}

function dispatchTikTokSocial(event) {
  if (!settings.showTikTokSocials) return;
  connectionDiagnostics.messagesReceived += 1;
  connectionDiagnostics.lastSource = 'TikTok';
  emitDiagnostics();
  recordHistory('tiktok', 'social', event);
  send('chat:social', event);
}

async function connectTikTok() {
  const username = normalizeTikTokUsername(settings.tiktokUsername);
  closeTikTokConnection(!username);
  if (!username) {
    connectionDiagnostics.tiktokState = 'idle';
    connectionDiagnostics.tiktokError = null;
    connectionDiagnostics.tiktokRetryAt = null;
    emitDiagnostics();
    updateOverallStatus();
    return;
  }
  const generation = tiktokGeneration;
  connectionDiagnostics.tiktokState = 'connecting';
  connectionDiagnostics.tiktokError = null;
  connectionDiagnostics.tiktokRetryAt = null;
  emitDiagnostics();
  setStatus('connecting', `TikTok @${username} wird gesucht …`);
  recordTikTokEvent(`Verbindungsversuch @${username}, Euler-Key ${tiktokApiKey ? 'gespeichert' : 'fehlt'}`);
  let roomLookupError = null;
  try {
    tiktokModulePromise ||= import('tiktok-live-connector');
    const connector = await tiktokModulePromise;
    if (generation !== tiktokGeneration) return;
    configureTikTokSigner(connector, tiktokApiKey);

    // TikTok changes the order and formatting of the SIGI_STATE script tag regularly.
    // Keep the connector parser flexible and use Chromium's network stack as an independent fallback.
    if (connector.RoomInfoFromHtmlRouteConfig) {
      connector.RoomInfoFromHtmlRouteConfig.extractionPattern = /<script\b(?=[^>]*\bid\s*=\s*["']SIGI_STATE["'])[^>]*>([\s\S]*?)<\/script\s*>/i;
    }
    let resolvedRoomId = null;
    try {
      resolvedRoomId = await resolveTikTokRoomId(username, (url, options) => net.fetch(url, options));
    } catch (networkError) {
      // TikTok itself says the stream is over: no fallback and no connection attempt.
      if (networkError?.name === 'TikTokOfflineError') throw networkError;
      try {
        resolvedRoomId = await resolveTikTokRoomIdWithBrowser(username, BrowserWindow);
      } catch (browserError) {
        if (browserError?.name === 'TikTokOfflineError') throw browserError;
        roomLookupError = new Error(
          `Seitenabruf: ${networkError?.message || networkError}; versteckter Browser: ${browserError?.message || browserError}`,
          { cause: browserError }
        );
      }
    }
    if (generation !== tiktokGeneration) return;

    const openConnection = async enableExtendedGiftInfo => {
      const { TikTokLiveConnection, WebcastEvent, ControlEvent } = connector;
      const connection = new TikTokLiveConnection(username, {
        // TikTok would otherwise replay the last comments from before the connection.
        processInitialData: false,
        // The public LIVE page already verified this room. Avoid a second TikTok endpoint
        // that is frequently blocked even when the websocket itself is available.
        fetchRoomInfoOnConnect: !resolvedRoomId,
        enableExtendedGiftInfo,
        ...(tiktokApiKey ? { signApiKey: tiktokApiKey } : {}),
        webClientOptions: { timeout: { request: 15000 } },
        wsClientOptions: { handshakeTimeout: 15000 }
      });
      tiktokConnection = connection;
      let ready = false;
      const openedAt = Date.now();
      const counts = { message: 0, gift: 0, other: 0, backlog: 0 };
      let connectedAt = null;
      // TikTok's socket opens with the room's last comments, some of them many minutes
      // old, whatever processInitialData says. Twitch has no such replay, so the overlay
      // shows both chats from the moment of the connection. Only the first seconds are
      // checked: a wrong PC clock must never be able to swallow the live chat.
      const isBacklog = event => {
        if (connectedAt && Date.now() - connectedAt > TIKTOK_BACKLOG_WINDOW_MS) return false;
        if (!(Number(event?.timestamp) < openedAt - TIKTOK_BACKLOG_AGE_MS)) return false;
        counts.backlog += 1;
        return true;
      };
      const pendingEvents = createPendingEventBuffer((kind, raw, delivery) => {
        if (kind === 'viewer') {
          updateTikTokViewerMetrics(raw);
          return;
        }
        const event = kind === 'message' ? normalizeTikTokChat(raw)
          : kind === 'gift' ? normalizeTikTokGift(raw)
            : normalizeTikTokSocial(raw, kind);
        if (isBacklog(event)) return;
        if (kind === 'message') dispatchChatMessage(event, 'TikTok', delivery);
        else if (kind === 'gift') { if (settings.showTikTokGifts) dispatchTikTokGift(event); }
        else dispatchTikTokSocial(event);
      }, 500);
      const forward = (kind, raw) => {
        counts[kind in counts ? kind : 'other'] += 1;
        pendingEvents.push(kind, raw);
      };
      const summary = () => {
        const minutes = connectedAt ? Math.round((Date.now() - connectedAt) / 60000) : 0;
        return `nach ${minutes} min, ${counts.message} Kommentare, ${counts.gift} Geschenke, ${counts.other} sonstige Ereignisse` +
          (counts.backlog ? `, davon ${counts.backlog} ältere beim Verbinden übersprungen` : '');
      };

      connection.on(WebcastEvent.CHAT, data => forward('message', data));
      connection.on(WebcastEvent.GIFT, data => forward('gift', data));
      connection.on(WebcastEvent.FOLLOW, data => forward('follow', data));
      connection.on(WebcastEvent.SHARE, data => forward('share', data));
      connection.on(WebcastEvent.ROOM_USER, data => forward('viewer', data));
      let streamEnded = false;
      connection.on(WebcastEvent.STREAM_END, event => {
        if (generation !== tiktokGeneration || connection !== tiktokConnection) return;
        const suspended = Number(event?.action) === TIKTOK_STREAM_SUSPENDED;
        // The connector disconnects itself after a stream end; that DISCONNECTED
        // event must not replace the slower stream-end retry below.
        streamEnded = true;
        recordTikTokEvent(`${suspended ? 'Stream von TikTok gesperrt' : 'Stream-Ende gemeldet'} ${summary()}`);
        historyStore.tiktok = null;
        saveHistorySoon();
        send('chat:clear', { platform: 'tiktok' });
        announceTikTokEnd(suspended);
        updateStreamMetrics({ tiktokLive: false, tiktokViewers: null, tiktokStartedAt: null });
        connectionDiagnostics.tiktokState = 'waiting';
        connectionDiagnostics.tiktokError = null;
        setConnectionPart('tiktok', false);
        scheduleTikTokReconnect(30000);
      });
      connection.on(ControlEvent.ERROR, error => {
        if (generation !== tiktokGeneration || connection !== tiktokConnection) return;
        // connect() rejects with the same error. Let the outer connection flow
        // perform its optional gift-info fallback before exposing a failure.
        if (!ready) return;
        recordTikTokEvent(`Fehler während der Verbindung: ${tiktokErrorDetail(error)}`);
        const friendly = friendlyTikTokError(error, username, null, { apiKeyConfigured: Boolean(tiktokApiKey) });
        connectionDiagnostics.tiktokState = connectionDiagnostics.tiktok ? 'connected' : 'error';
        connectionDiagnostics.tiktokError = friendly;
        connectionDiagnostics.lastError = friendly;
        emitDiagnostics();
        updateOverallStatus();
      });
      connection.on(ControlEvent.DISCONNECTED, () => {
        if (generation !== tiktokGeneration || connection !== tiktokConnection || quitting || streamEnded) return;
        recordTikTokEvent(`Verbindung getrennt ${summary()}; neuer Versuch in 5 s`);
        updateStreamMetrics({ tiktokLive: false, tiktokViewers: null });
        connectionDiagnostics.tiktokState = 'waiting';
        setConnectionPart('tiktok', false);
        scheduleTikTokReconnect(5000);
      });

      let timeout;
      try {
        const timeoutPromise = new Promise((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error('Verbindungsaufbau nach 25 Sekunden abgebrochen (Timeout).');
            error.name = 'TikTokTimeoutError';
            reject(error);
          }, 25000);
        });
        const connecting = connection.connect(resolvedRoomId || undefined);
        tiktokConnecting.set(connection, connecting);
        const connected = await Promise.race([connecting, timeoutPromise]);
        if (generation !== tiktokGeneration || connection !== tiktokConnection) {
          discardTikTokConnection(connection);
          return null;
        }
        return {
          connection,
          connected,
          releasePending() {
            ready = true;
            connectedAt = Date.now();
            pendingEvents.release();
          }
        };
      } finally {
        clearTimeout(timeout);
      }
    };

    let opened;
    try {
      opened = await openConnection(true);
    } catch (error) {
      if (!shouldRetryWithoutExtendedGiftInfo(error) || generation !== tiktokGeneration) throw error;
      recordTikTokEvent(`Geschenkdetails nicht abrufbar, zweiter Versuch ohne: ${tiktokErrorDetail(error)}`);
      discardTikTokConnection(tiktokConnection);
      opened = await openConnection(false);
    }
    if (!opened || generation !== tiktokGeneration || opened.connection !== tiktokConnection) return;
    const { connection, connected } = opened;
    const startedAt = activateTikTokHistory(username, connected?.roomId || resolvedRoomId || connection.roomId, connection);
    tiktokRetryAttempt = 0;
    connectionDiagnostics.tiktokState = 'connected';
    connectionDiagnostics.tiktokError = null;
    connectionDiagnostics.tiktokRetryAt = null;
    connectionDiagnostics.lastError = null;
    updateStreamMetrics({ tiktokLive: true, tiktokStartedAt: startedAt });
    setConnectionPart('tiktok', true);
    opened.releasePending();
    tiktokWasLive = true;
    recordTikTokEvent(`Verbunden mit Raum ${connected?.roomId || resolvedRoomId || connection.roomId || 'unbekannt'}`);
    send('chat:system', { text: `TikTok-Chat für @${username} ist aktiv.` });
  } catch (error) {
    if (generation !== tiktokGeneration) return;
    discardTikTokConnection(tiktokConnection);
    tiktokConnection = null;
    const friendly = friendlyTikTokError(error, username, roomLookupError, { apiKeyConfigured: Boolean(tiktokApiKey) });
    connectionDiagnostics.tiktok = false;
    connectionDiagnostics.tiktokState = 'error';
    connectionDiagnostics.tiktokError = friendly;
    connectionDiagnostics.lastError = friendly;
    emitDiagnostics();
    updateOverallStatus();
    const retryDelay = tikTokRetryDelay(error, reconnectDelay(tiktokRetryAttempt++, 30000, 120000));
    // The connection dropped without a stream-end signal and TikTok now says "not live".
    if (error?.name === 'TikTokOfflineError') announceTikTokEnd(false);
    recordTikTokEvent(error?.name === 'TikTokOfflineError'
      ? `Nicht live laut TikTok-Seite; neuer Versuch in ${Math.round(retryDelay / 1000)} s`
      : `Verbindung fehlgeschlagen: ${tiktokErrorDetail(error, roomLookupError)}; neuer Versuch in ${Math.round(retryDelay / 1000)} s`);
    // Each failed attempt may start a hidden Chromium page, so an offline account
    // is polled with backoff (30 s → 2 min) instead of every 30 seconds.
    scheduleTikTokReconnect(retryDelay);
  }
}

async function connectTwitch() {
  if (!accessSession?.user) throw new Error('Bitte zuerst mit Twitch anmelden.');
  clearTwitchReconnect();
  const generation = ++twitchGeneration;
  closeEventSocket();
  closeIrcSocket();
  clearInterval(streamPollTimer);
  streamPollTimer = null;
  ircReconnectAttempt = 0;
  eventReconnectAttempt = 0;
  activeBroadcaster = null;
  setStatus('connecting', 'Twitch-Verbindung wird aufgebaut');
  await ensureAccessToken();
  if (generation !== twitchGeneration || quitting) return;
  const broadcaster = await resolveBroadcaster();
  if (generation !== twitchGeneration || quitting) return;
  activeBroadcaster = broadcaster;
  connectionDiagnostics.eventSub = false;
  connectionDiagnostics.irc = false;
  connectionDiagnostics.follows = false;
  connectionDiagnostics.followError = null;
  connectionDiagnostics.lastError = null;
  emitDiagnostics();
  loadBadges(broadcaster.id).then(result => {
    if (generation !== twitchGeneration || quitting) return;
    badgeMap = result.map;
    if (result.errors.length) {
      connectionDiagnostics.lastError = 'Einige Twitch-Badges konnten nicht geladen werden; der Chat läuft ohne diese Bilder weiter.';
      emitDiagnostics();
    }
  }).catch(error => {
    if (generation !== twitchGeneration) return;
    connectionDiagnostics.lastError = `Twitch-Badges: ${error.message}`;
    emitDiagnostics();
  });
  // The renderer already shows the stored history; a reconnect must not rebuild it.
  await syncTwitchStreamHistory(broadcaster, false, generation).catch(error => {
    if (generation !== twitchGeneration) return;
    connectionDiagnostics.lastError = `Streamstatus: ${error.message}`;
    emitDiagnostics();
  });
  if (generation !== twitchGeneration || quitting) return;
  startStreamHistoryPolling(broadcaster, generation);
  await Promise.all([
    connectEventSub(EVENTSUB_URL, false, broadcaster, generation),
    connectIrc(broadcaster, generation)
  ]);
}

function connectTwitchAndReport() {
  const pending = connectTwitch();
  const generation = twitchGeneration;
  pending.catch(error => {
    if (generation !== twitchGeneration || quitting) return;
    reportConnectionError(error);
    scheduleTwitchReconnect(generation);
  });
  return pending;
}

function clearTwitchReconnect() {
  clearTimeout(twitchReconnectTimer);
  twitchReconnectTimer = null;
}

function scheduleTwitchReconnect(generation) {
  clearTwitchReconnect();
  if (generation !== twitchGeneration || quitting || !accessSession?.user) return;
  twitchReconnectTimer = setTimeout(() => {
    twitchReconnectTimer = null;
    if (generation !== twitchGeneration || quitting || !accessSession?.user) return;
    connectTwitchAndReport();
  }, reconnectDelay(twitchReconnectAttempt++));
}

function reconnectAll() {
  if (accessSession?.user) connectTwitchAndReport();
  tiktokRetryAttempt = 0;
  connectTikTok().catch(error => {
    connectionDiagnostics.lastError = `TikTok: ${error.message}`;
    emitDiagnostics();
  });
}

function reportConnectionError(error) {
  setStatus('error', error?.message || 'Unbekannter Twitch-Fehler');
  send('chat:system', { text: `Verbindungsfehler: ${error?.message || 'Unbekannter Fehler'}`, error: true });
}

function logout() {
  ++authPollGeneration;
  ++twitchGeneration;
  clearTwitchReconnect();
  closeEventSocket();
  closeIrcSocket();
  clearInterval(streamPollTimer);
  streamPollTimer = null;
  historyStore.twitch = null;
  saveHistorySoon();
  send('chat:clear', { platform: 'twitch' });
  deleteSession();
  authRequirementReason = null;
  activeBroadcaster = null;
  updateStreamMetrics({ twitchLive: false, twitchViewers: null, twitchStartedAt: null });
  setStatus('signed-out', 'Nicht angemeldet');
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  send('auth:required');
  send('app:state', publicState());
}

function registerTrustedHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Nicht vertrauenswürdige IPC-Anfrage blockiert.');
    }
    return handler(event, ...args);
  });
}

function registerIpc() {
  registerTrustedHandler('app:get-state', () => ({ ...publicState(), history: currentHistoryEntries() }));
  registerTrustedHandler('settings:update', async (_event, update) => {
    const oldChannel = settings.channel;
    const oldTikTokUsername = settings.tiktokUsername;
    const oldShowTikTokGifts = settings.showTikTokGifts;
    const oldShowTikTokSocials = settings.showTikTokSocials;
    const oldStreamSafe = settings.streamSafe;
    const oldCaptions = CAPTION_SETTING_KEYS.map(key => settings[key]);
    const oldUpdateBeta = settings.updateBeta;
    const oldUpdateInstall = settings.updateInstall;
    settings = { ...settings, ...sanitizeSettingsUpdate(update, normalizeTikTokUsername) };
    saveSettings();
    send('settings:changed', publicSettings());
    if (settings.updateInstall !== oldUpdateInstall) updater?.setInstallMode(settings.updateInstall);
    if (settings.updateBeta !== oldUpdateBeta) {
      updater?.setPrerelease(settings.updateBeta);
      updater?.check();
    }
    if (CAPTION_SETTING_KEYS.some((key, index) => settings[key] !== oldCaptions[index])) {
      if (settings.captionsEnabled !== oldCaptions[0]) {
        recordCaptionEvent(`Untertitel ${settings.captionsEnabled ? 'eingeschaltet' : 'ausgeschaltet'} (Einstellungen)`);
      }
      applyCaptions();
      rebuildTray();
    }
    if (settings.channel !== oldChannel && accessSession?.user) connectTwitchAndReport();
    if (settings.tiktokUsername !== oldTikTokUsername) {
      tiktokRetryAttempt = 0;
      connectTikTok().catch(() => {});
    }
    if (settings.streamSafe !== oldStreamSafe && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(Boolean(settings.streamSafe));
      rebuildTray();
    }
    if (oldShowTikTokGifts && !settings.showTikTokGifts) {
      removeHistoryWhere(entry => entry.platform === 'tiktok' && entry.kind === 'gift');
      emitHistory();
    }
    if (oldShowTikTokSocials && !settings.showTikTokSocials) {
      removeHistoryWhere(entry => entry.platform === 'tiktok' && entry.kind === 'social');
      emitHistory();
    }
    return publicSettings();
  });
  registerTrustedHandler('tiktok:open-log', async () => {
    if (!fs.existsSync(tiktokLogPath())) throw new Error('Es gibt noch kein TikTok-Protokoll. Es entsteht beim ersten Verbindungsversuch.');
    const failure = await shell.openPath(tiktokLogPath());
    if (failure) throw new Error(failure);
  });
  registerTrustedHandler('captions:reveal-source-file', () => {
    const file = captionSourceFilePath();
    fs.writeFileSync(file, captionSourceHtml(), 'utf8');
    clipboard.writeText(file);
    shell.showItemInFolder(file);
    return file;
  });
  registerTrustedHandler('captions:open-log', async () => {
    if (!fs.existsSync(captionsLogPath())) throw new Error('Es gibt noch kein Untertitel-Protokoll.');
    const failure = await shell.openPath(captionsLogPath());
    if (failure) throw new Error(failure);
  });
  registerTrustedHandler('tiktok:set-api-key', (_event, value) => {
    saveTikTokApiKey(value);
    const next = publicSettings();
    send('settings:changed', next);
    tiktokRetryAttempt = 0;
    if (settings.tiktokUsername) connectTikTok().catch(() => {});
    return next;
  });
  registerTrustedHandler('translation:set-api-key', (_event, value) => {
    saveDeepLApiKey(value);
    const next = publicSettings();
    send('settings:changed', next);
    return next;
  });
  registerTrustedHandler('captions:test', () => sendTestCaption());
  registerTrustedHandler('captions:copy-url', () => {
    if (!captionServer?.url) throw new Error('Die Browserquelle läuft erst, wenn die Untertitel eingeschaltet sind.');
    clipboard.writeText(captionServer.url);
    return captionServer.url;
  });
  registerTrustedHandler('captions:set-api-key', (_event, value) => {
    saveDeepgramApiKey(value);
    const next = publicSettings();
    send('settings:changed', next);
    return next;
  });
  registerTrustedHandler('translation:request', (_event, platform, messageId) => translateMessage(platform, messageId));
  registerTrustedHandler('translation:usage', () => {
    if (!deeplApiKey || !translator) throw new Error('Kein DeepL-API-Key gespeichert.');
    return translator.usage();
  });
  registerTrustedHandler('auth:start', (_event, clientId) => beginDeviceAuth(clientId));
  registerTrustedHandler('auth:logout', () => logout());
  registerTrustedHandler('twitch:reconnect', () => reconnectAll());
  registerTrustedHandler('overlay:toggle-visible', () => toggleOverlay());
  registerTrustedHandler('overlay:clear', () => clearCurrentHistory());
  registerTrustedHandler('external:open', async (_event, url) => {
    if (!isAllowedExternalUrl(url)) throw new Error('Dieser externe Link ist nicht freigegeben.');
    await shell.openExternal(url);
  });
  registerTrustedHandler('app:quit', () => { quitting = true; app.quit(); });
  registerTrustedHandler('update:check', () => updater ? updater.check() : null);
  registerTrustedHandler('update:install', () => Boolean(updater?.installNow()));
  registerTrustedHandler('update:open-download', async () => {
    if (!updateReleasesUrl) throw new Error('Für diese Version ist keine Download-Seite hinterlegt.');
    await shell.openExternal(updateReleasesUrl);
  });
}

// The development build (npm start) keeps its own data folder. Sharing one with the
// installed app meant a shared single-use Twitch refresh token and a shared
// single-instance lock, so one copy could log the other out or block its start.
if (app && app.isPackaged === false) app.setPath('userData', path.join(app.getPath('appData'), 'twitch-chat-overlay-dev'));

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    overlayVisible = true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    send('app:state', publicState());
    rebuildTray();
  });
}

async function validateStoredToken() {
  if (!accessSession || tokenValidationInProgress) return;
  tokenValidationInProgress = true;
  const generation = twitchGeneration;
  try {
    const validation = await validateAccessToken();
    if (generation !== twitchGeneration || !accessSession) return;
    if (!validation) await refreshAccessToken();
  } catch (error) {
    if (generation !== twitchGeneration) return;
    connectionDiagnostics.lastError = `Twitch-Anmeldung konnte nicht geprüft werden: ${error.message}`;
    emitDiagnostics();
    updateOverallStatus();
    send('app:state', publicState());
  } finally {
    tokenValidationInProgress = false;
  }
}

async function initializeApp() {
  settings = loadSettings();
  tiktokApiKey = loadTikTokApiKey();
  deeplApiKey = loadDeepLApiKey();
  translator = createDeepLTranslator({
    fetchImpl: (url, options) => net.fetch(url, options),
    getApiKey: () => deeplApiKey,
    getOptions: () => ({ target: settings.translationTarget, skipLanguages: settings.translationSkipLanguages }),
    onStatus: setTranslationStatus
  });
  deepgramApiKey = loadDeepgramApiKey();
  captionServer = createCaptionServer({
    root: path.join(__dirname, 'captions'),
    getState: captionsDisplayState,
    onError: error => reportStorageError('Untertitel-Browserquelle', error),
    onClients: count => {
      if (connectionDiagnostics.captionsClients === count) return;
      recordCaptionEvent(`Verbundene Browserquellen: ${count}`);
      connectionDiagnostics.captionsClients = count;
      emitDiagnostics();
    }
  });
  captionStream = createDeepgramStream({
    WebSocketImpl: WebSocket,
    getApiKey: () => deepgramApiKey,
    onMessage: handleCaptionResult,
    onStatus: setCaptionStatus,
    reconnectDelay
  });
  historyStore = loadHistoryStore();
  registerIpc();
  registerCaptionsIpc();
  createWindow();
  createTray();
  updater = createAppUpdater();
  updater.start();
  registerShortcuts();
  recordCaptionEvent(`App gestartet, Untertitel ${settings.captionsEnabled ? 'an' : 'aus'}, Aufnahmefenster ${settings.captionsWindowVisible ? 'sichtbar' : 'unsichtbar'}`);
  applyCaptions();
  const authenticated = await hydrateSession();
  mainWindow.show();
  send('app:state', publicState());
  emitHistory();
  if (authenticated) connectTwitchAndReport();
  else updateOverallStatus();
  if (settings.tiktokUsername) connectTikTok().catch(() => {});
  tokenValidationTimer = setInterval(validateStoredToken, 60 * 60 * 1000);
  tokenValidationTimer.unref();
}

// A second instance only hands focus to the first one. It must never initialize,
// refresh the single-use Twitch refresh token or overwrite the stored history.
if (singleInstanceLock) {
  app.whenReady().then(initializeApp).catch(error => {
    console.error('Anwendungsstart fehlgeschlagen:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      reportConnectionError(new Error(`Anwendungsstart fehlgeschlagen: ${error.message}`));
    } else {
      app.quit();
    }
  });

  // Any quit path (Windows shutdown, updater, app.quit) must pass the close guard.
  app.on('before-quit', () => { quitting = true; });

  app.on('will-quit', () => {
    quitting = true;
    ++authPollGeneration;
    ++twitchGeneration;
    clearTwitchReconnect();
    closeEventSocket();
    closeIrcSocket();
    closeTikTokConnection();
    captionStream?.stop();
    captionServer?.stop().catch(() => {});
    updater?.installOnQuit();
    updater?.stop();
    clearInterval(streamPollTimer);
    clearInterval(tokenValidationTimer);
    flushHistory();
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {});
}
