'use strict';

const KNOWN_BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot',
  'soundalerts', 'sery_bot', 'commanderroot', 'botrixoficial', 'own3d'
]);

const dom = Object.fromEntries([
  'app', 'messages', 'emptyState', 'connectionStatus', 'setupPanel', 'settingsPanel',
  'settingsButton', 'closeSettingsButton', 'hideButton', 'closeButton', 'clientIdInput',
  'streamStats', 'twitchViewerStat', 'tiktokViewerStat', 'streamDurationStat', 'localClockStat',
  'twitchViewerCount', 'tiktokViewerCount', 'streamDuration', 'localClock',
  'developerConsoleButton', 'authButton', 'deviceCodeBox', 'deviceCode', 'authError',
  'authReason', 'diagnosticsLabel',
  'channelInput', 'tiktokUsernameInput', 'tiktokApiKeyInput', 'saveTikTokApiKeyButton',
  'clearTikTokApiKeyButton', 'tiktokApiKeyStatus', 'eulerButton', 'tiktokLogButton', 'captionsLogButton', 'twitchFollowErrorText', 'tiktokErrorText',
  'fontSizeInput', 'fontSizeOutput', 'opacityInput', 'opacityOutput',
  'fadeInput', 'fadeOutput', 'maxMessagesInput', 'maxMessagesOutput', 'timestampsInput',
  'compactInput', 'botsInput', 'commandsInput', 'tiktokGiftsInput', 'tiktokSocialsInput', 'streamStatsInput', 'streamSafeInput',
  'hiddenUsersInput', 'blockedTermsInput',
  'translationInput', 'translationTargetInput', 'translationSkipInput', 'deeplApiKeyInput',
  'saveDeepLApiKeyButton', 'clearDeepLApiKeyButton', 'deeplApiKeyStatus', 'deeplUsageButton', 'deeplButton',
  'translationErrorText',
  'captionsInput', 'deepgramApiKeyInput', 'saveDeepgramApiKeyButton', 'clearDeepgramApiKeyButton',
  'deepgramApiKeyStatus', 'deepgramButton', 'captionsDeviceInput', 'captionsGateInput', 'captionsGateOutput',
  'captionsLevelBar', 'captionsGateMark', 'captionsTargetInput', 'captionsBackgroundInput', 'captionsFontSizeInput',
  'captionsFontSizeOutput', 'captionsOriginalInput', 'captionsOnlyTranslatedInput', 'captionsErrorText',
  'captionsUrlInput', 'copyCaptionsUrlButton', 'captionsUrlHelp', 'captionsTextColorInput', 'captionsBoxInput',
  'captionsWindowInput', 'captionsBackgroundField', 'captionsSourceStatus', 'captionsTestButton', 'captionsSourceFileButton', 'captionsSourceFileHelp',
  'updateStatusText', 'checkUpdateButton', 'installUpdateButton', 'downloadUpdateButton', 'updateBetaInput', 'updateInstallInput',
  'demoButton', 'clearButton', 'accountLabel', 'reconnectButton', 'logoutButton'
].map(id => [id, document.getElementById(id)]));

let state = {
  settings: {},
  metrics: {
    twitchLive: false, twitchViewers: null, twitchStartedAt: null,
    tiktokLive: false, tiktokViewers: null, tiktokStartedAt: null
  },
  authenticated: false,
  user: null
};
let saveTimer;
let saveGeneration = 0;
const spamTracker = window.chatSpamFilter.createSpamTracker();
const viewerFormatter = new Intl.NumberFormat('de-DE');
const compactViewerFormatter = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
const clockFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function parseList(value) {
  return value.split(/[\n,]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
}

function formatFade(seconds) {
  return Number(seconds) === 0 ? 'nie' : `${seconds} s`;
}

function formatViewerCount(value) {
  if (value === null || value === undefined || value === '') return '–';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '–';
  return number >= 10000 ? compactViewerFormatter.format(number) : viewerFormatter.format(number);
}

function activeDurationSource(metrics, now) {
  const candidates = [
    [metrics.twitchLive, metrics.twitchStartedAt, 'Twitch-Streamdauer'],
    [metrics.tiktokLive, metrics.tiktokStartedAt, 'TikTok-Livedauer']
  ];
  for (const [active, value, label] of candidates) {
    if (!active || !value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 1000) return { timestamp, label };
  }
  return null;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function renderStreamStats(now = Date.now()) {
  const metrics = state.metrics || {};
  const twitchValue = metrics.twitchLive ? formatViewerCount(metrics.twitchViewers) : '–';
  const tiktokValue = metrics.tiktokLive ? formatViewerCount(metrics.tiktokViewers) : '–';
  dom.twitchViewerCount.textContent = twitchValue;
  dom.tiktokViewerCount.textContent = tiktokValue;
  dom.twitchViewerStat.setAttribute('aria-label', `Twitch-Zuschauer: ${twitchValue}`);
  dom.tiktokViewerStat.setAttribute('aria-label', `TikTok-Zuschauer: ${tiktokValue}`);

  const duration = activeDurationSource(metrics, now);
  dom.streamDuration.textContent = duration ? formatDuration(now - duration.timestamp) : '--:--:--';
  dom.streamDurationStat.title = duration?.label || 'Streamdauer';
  dom.localClock.textContent = clockFormatter.format(new Date(now));
}

function applyStreamMetrics(next) {
  state.metrics = { ...state.metrics, ...(next || {}) };
  renderStreamStats();
}

function applySettings(next) {
  // Settings also arrive from the tray and other windows. Text that is being typed
  // right now must survive that and is put back after the form was filled.
  const typing = document.activeElement;
  const typed = typing?.matches?.('input[type="text"], input:not([type]), textarea') ? typing.value : null;
  try {
    fillSettings(next);
  } finally {
    if (typed !== null) typing.value = typed;
  }
}

function fillSettings(next) {
  const previousFade = Number(state.settings.fadeSeconds || 0);
  state.settings = { ...state.settings, ...next };
  const settings = state.settings;
  document.documentElement.style.setProperty('--font-size', `${settings.fontSize || 20}px`);
  document.documentElement.style.setProperty('--bubble-opacity', String((settings.opacity ?? 78) / 100));
  dom.app.classList.toggle('compact', Boolean(settings.compactMode));

  dom.channelInput.value = settings.channel || '';
  dom.tiktokUsernameInput.value = settings.tiktokUsername || '';
  dom.clientIdInput.value = settings.clientId || '';
  dom.fontSizeInput.value = settings.fontSize ?? 20;
  dom.opacityInput.value = settings.opacity ?? 78;
  dom.fadeInput.value = settings.fadeSeconds ?? 35;
  dom.maxMessagesInput.value = settings.maxMessages ?? 45;
  dom.timestampsInput.checked = Boolean(settings.showTimestamps);
  dom.compactInput.checked = Boolean(settings.compactMode);
  dom.botsInput.checked = Boolean(settings.hideKnownBots);
  dom.commandsInput.checked = Boolean(settings.hideCommands);
  dom.tiktokGiftsInput.checked = settings.showTikTokGifts !== false;
  dom.tiktokSocialsInput.checked = Boolean(settings.showTikTokSocials);
  dom.streamStatsInput.checked = settings.showStreamStats !== false;
  dom.streamSafeInput.checked = settings.streamSafe !== false;
  const showStreamStats = settings.showStreamStats !== false;
  dom.app.classList.toggle('stats-visible', showStreamStats);
  dom.streamStats.setAttribute('aria-hidden', String(!showStreamStats));
  dom.tiktokApiKeyStatus.textContent = settings.tiktokApiKeyConfigured
    ? 'API-Key ist verschlüsselt gespeichert.'
    : 'Kein API-Key gespeichert.';
  dom.clearTikTokApiKeyButton.disabled = !settings.tiktokApiKeyConfigured;
  dom.hiddenUsersInput.value = (settings.hiddenUsers || []).join(', ');
  dom.blockedTermsInput.value = (settings.blockedTerms || []).join('\n');
  dom.translationInput.checked = Boolean(settings.translationEnabled);
  dom.translationTargetInput.value = settings.translationTarget || 'DE';
  dom.translationSkipInput.value = (settings.translationSkipLanguages || []).join(', ');
  dom.deeplApiKeyStatus.textContent = settings.deeplApiKeyConfigured
    ? 'API-Key ist verschlüsselt gespeichert.'
    : settings.translationEnabled ? 'Für die Übersetzung wird ein DeepL-API-Key benötigt.' : 'Kein API-Key gespeichert.';
  dom.clearDeepLApiKeyButton.disabled = !settings.deeplApiKeyConfigured;
  dom.deeplUsageButton.disabled = !settings.deeplApiKeyConfigured;
  dom.captionsInput.checked = Boolean(settings.captionsEnabled);
  dom.deepgramApiKeyStatus.textContent = settings.deepgramApiKeyConfigured
    ? 'API-Key ist verschlüsselt gespeichert.'
    : settings.captionsEnabled ? 'Für die Untertitel wird ein Deepgram-API-Key benötigt.' : 'Kein API-Key gespeichert.';
  dom.clearDeepgramApiKeyButton.disabled = !settings.deepgramApiKeyConfigured;
  renderCaptionDevices();
  dom.captionsGateInput.value = settings.captionsGate ?? 40;
  dom.captionsTargetInput.value = settings.captionsTarget || 'EN-US';
  dom.captionsBackgroundInput.value = settings.captionsBackground || 'dark';
  dom.captionsFontSizeInput.value = settings.captionsFontSize ?? 30;
  dom.captionsOriginalInput.checked = Boolean(settings.captionsShowOriginal);
  dom.captionsOnlyTranslatedInput.checked = settings.captionsOnlyTranslated !== false;
  dom.updateBetaInput.checked = Boolean(settings.updateBeta);
  dom.updateInstallInput.value = settings.updateInstall || 'start';
  renderUpdateState(lastUpdateState);
  dom.captionsTextColorInput.value = settings.captionsTextColor || '#ffffff';
  dom.captionsBoxInput.checked = settings.captionsBox !== false;
  dom.captionsWindowInput.checked = Boolean(settings.captionsWindowVisible);
  dom.captionsBackgroundField.classList.toggle('hidden', !settings.captionsWindowVisible);
  dom.captionsUrlInput.value = settings.captionsUrl || '';
  dom.copyCaptionsUrlButton.disabled = !settings.captionsUrl;
  renderCaptionSourceStatus(lastDiagnostics);
  updateOutputs();
  trimMessages();
  if (previousFade !== Number(settings.fadeSeconds || 0)) {
    for (const element of dom.messages.children) {
      element.dataset.fadeToken = String(Number(element.dataset.fadeToken || 0) + 1);
      element.classList.remove('fading');
      scheduleFade(element);
    }
  }
}

function updateOutputs() {
  dom.fontSizeOutput.value = `${dom.fontSizeInput.value}px`;
  dom.opacityOutput.value = `${dom.opacityInput.value}%`;
  dom.fadeOutput.value = formatFade(dom.fadeInput.value);
  dom.maxMessagesOutput.value = dom.maxMessagesInput.value;
  dom.captionsGateOutput.value = dom.captionsGateInput.value;
  dom.captionsGateMark.style.left = `${dom.captionsGateInput.value}%`;
  dom.captionsFontSizeOutput.value = `${dom.captionsFontSizeInput.value}px`;
}

let captionDevices = [];
let lastDiagnostics = {};

function renderCaptionDevices() {
  const selected = state.settings.captionsDeviceId || '';
  const options = [{ deviceId: '', label: 'Windows-Standardmikrofon' }, ...captionDevices];
  if (selected && !captionDevices.some(device => device.deviceId === selected)) {
    options.push({ deviceId: selected, label: 'Gespeichertes Mikrofon (nicht verbunden)' });
  }
  dom.captionsDeviceInput.replaceChildren(...options.map(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    return option;
  }));
  dom.captionsDeviceInput.value = selected;
}

let lastUpdateState = null;

function renderUpdateState(update) {
  if (!update) return;
  lastUpdateState = update;
  const manual = dom.updateInstallInput.value === 'manual';
  const current = update.currentVersion ? `Version ${update.currentVersion}` : 'Diese Version';
  const texts = {
    disabled: `${current} · Automatische Updates sind in dieser Ausführung nicht aktiv. Installiere einmal die aktuelle Version von github.com/MrYourself/1/releases, danach aktualisiert sich die App selbst.`,
    idle: `${current}`,
    checking: 'Suche nach Updates …',
    current: `${current} ist aktuell.`,
    downloading: `Update ${update.version || ''} wird im Hintergrund geladen … ${update.progress || 0} %`,
    ready: `Update ${update.version} ist bereit${manual ? '.' : ' und wird beim Beenden installiert.'}`,
    installing: `Update ${update.version} wird installiert. Das Overlay startet gleich neu.`,
    available: `Version ${update.version} ist verfügbar${update.error ? `, konnte aber nicht automatisch geladen werden (${update.error})` : ''}. Bitte von der Download-Seite holen.`,
    error: update.error || 'Update fehlgeschlagen.'
  };
  dom.updateStatusText.textContent = texts[update.status] || current;
  dom.checkUpdateButton.disabled = ['disabled', 'checking', 'downloading', 'ready', 'installing'].includes(update.status);
  dom.installUpdateButton.classList.toggle('hidden', update.status !== 'ready');
  dom.downloadUpdateButton.classList.toggle('hidden', update.status !== 'available');
}

// An opened page in a normal browser counts as a connected source too.
function renderCaptionSourceStatus(diagnostics) {
  const clients = Number(diagnostics.captionsClients) || 0;
  const running = Boolean(state.settings.captionsUrl);
  dom.captionsSourceStatus.classList.toggle('connected', running && clients > 0);
  dom.captionsTestButton.disabled = !running;
  if (!running) {
    dom.captionsSourceStatus.textContent = 'Die Browserquelle läuft, sobald die Untertitel eingeschaltet sind.';
  } else if (clients === 0) {
    dom.captionsSourceStatus.textContent = 'Browserquelle läuft, aber es ist noch keine Quelle verbunden. Adresse in OBS oder TikTok LIVE Studio einfügen.';
  } else {
    dom.captionsSourceStatus.textContent = clients === 1 ? 'Browserquelle läuft · 1 Quelle verbunden' : `Browserquelle läuft · ${clients} Quellen verbunden`;
  }
}

function showCaptionLevel({ level = 0, speaking = false } = {}) {
  dom.captionsLevelBar.style.width = `${Math.min(100, Math.max(0, Number(level) || 0))}%`;
  dom.captionsLevelBar.classList.toggle('speaking', speaking === true);
}

function applyState(next) {
  const previousMetrics = state.metrics;
  state = { ...state, ...next, metrics: { ...previousMetrics, ...(next.metrics || {}) } };
  if (Array.isArray(next.captionDevices)) captionDevices = next.captionDevices;
  if (next.update) renderUpdateState(next.update);
  if (next.settings) applySettings(next.settings);
  dom.setupPanel.classList.toggle('hidden', Boolean(state.authenticated));
  dom.accountLabel.textContent = state.user ? `Angemeldet als ${state.user.login}` : 'Nicht angemeldet';
  const reason = next.authRequirementReason ?? state.authRequirementReason;
  dom.authReason.textContent = reason || '';
  dom.authReason.classList.toggle('hidden', !reason);
  if (next.diagnostics) updateDiagnostics(next.diagnostics);
  if (Array.isArray(next.history)) restoreHistory(next.history);
  renderStreamStats();
  updateEmptyState();
}

function updateDiagnostics(diagnostics) {
  const eventSub = diagnostics.eventSub ? '✓' : '–';
  const irc = diagnostics.irc ? '✓' : '–';
  const follows = diagnostics.followError ? 'Fehler' : diagnostics.follows ? '✓' : '–';
  const tiktokStates = { connecting: 'verbindet', connected: '✓', waiting: 'wartet', error: 'Fehler', idle: '–' };
  const tiktok = tiktokStates[diagnostics.tiktokState] || (diagnostics.tiktok ? '✓' : '–');
  const source = diagnostics.lastSource ? ` · zuletzt ${diagnostics.lastSource}` : '';
  const captionStates = { connecting: 'verbindet', live: '✓', reconnecting: 'verbindet', error: 'Fehler' };
  const captions = captionStates[diagnostics.captions] ? ` · Untertitel ${captionStates[diagnostics.captions]}` : '';
  dom.diagnosticsLabel.textContent = `EventSub ${eventSub} · IRC ${irc} · Follows ${follows} · TikTok ${tiktok}${captions} · ${diagnostics.messagesReceived || 0} Ereignisse${source}`;
  dom.twitchFollowErrorText.textContent = diagnostics.followError || '';
  dom.twitchFollowErrorText.classList.toggle('hidden', !diagnostics.followError);
  dom.tiktokErrorText.textContent = diagnostics.tiktokError || '';
  dom.tiktokErrorText.classList.toggle('hidden', !diagnostics.tiktokError);
  dom.translationErrorText.textContent = diagnostics.translationError || '';
  dom.translationErrorText.classList.toggle('hidden', !diagnostics.translationError);
  const captionsError = diagnostics.captionsServerError || diagnostics.captionsAudioError || diagnostics.captionsError || '';
  lastDiagnostics = diagnostics;
  renderCaptionSourceStatus(diagnostics);
  dom.captionsErrorText.textContent = captionsError;
  dom.captionsErrorText.classList.toggle('hidden', !captionsError);
  const row = dom.diagnosticsLabel.closest('.diagnostics-row');
  const tiktokWanted = Boolean(state.settings.tiktokUsername);
  row.classList.toggle('healthy', diagnostics.eventSub && diagnostics.irc && (!tiktokWanted || diagnostics.tiktok));
  row.classList.toggle('error', Boolean(diagnostics.followError) || Boolean(diagnostics.tiktokError) || (Boolean(diagnostics.lastError) && !diagnostics.eventSub && !diagnostics.irc));
}

function updateEmptyState() {
  dom.emptyState.classList.toggle('visible', dom.messages.children.length === 0 && (state.authenticated || state.settings.tiktokUsername));
}

function setConnectionStatus(status) {
  const labels = {
    connected: status.detail || 'Verbunden', connecting: status.detail || 'Verbinden …',
    reconnecting: status.detail || 'Neu verbinden …', error: status.detail || 'Fehler',
    'signed-out': status.detail || 'Nicht angemeldet'
  };
  dom.connectionStatus.textContent = labels[status.state] || status.detail || status.state;
  dom.connectionStatus.className = `status status-${status.state}`;
}

function isHighlighted(event) {
  const fragments = event.message?.fragments || [];
  const text = event.message?.text || '';
  const me = state.user;
  const mentionNames = [me?.login, state.settings.tiktokUsername].filter(Boolean);
  const mention = fragments.some(fragment => fragment.type === 'mention' && (
    fragment.mention?.user_id === me?.id || fragment.mention?.user_login?.toLowerCase() === me?.login?.toLowerCase()
  )) || mentionNames.some(login => new RegExp(`(^|\\s)@${escapeRegExp(login)}\\b`, 'i').test(text));
  const bits = Boolean(event.cheer?.bits) || fragments.some(fragment => fragment.type === 'cheermote');
  return { mention, bits };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldFilter(event, highlight, observedAt = Date.now()) {
  if (highlight.mention || highlight.bits) return false;
  const settings = state.settings;
  const login = String(event.chatter_user_login || event.chatter_user_name || '').toLowerCase();
  const text = String(event.message?.text || '').trim();
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if ((settings.hiddenUsers || []).includes(login)) return true;
  if (settings.hideKnownBots && KNOWN_BOTS.has(login)) return true;
  if (settings.hideCommands && text.startsWith('!')) return true;
  if ((settings.blockedTerms || []).some(term => normalized.includes(term))) return true;
  if (/(.)\1{14,}/iu.test(text)) return true;

  // Separate platforms, and never pool anonymous users into a single spam bucket.
  const spamKey = `${event.platform || 'twitch'}:${login || event.chatter_user_id || ''}`;
  return spamTracker.isSpam(spamKey, normalized, observedAt);
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function setImageSource(image, value) {
  const url = safeImageUrl(value);
  if (!url) return false;
  image.src = url;
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  return true;
}

function badgeElements(badges = []) {
  return badges.map(badge => {
    const image = document.createElement('img');
    image.className = 'badge';
    if (!setImageSource(image, badge.url)) return null;
    image.alt = badge.set_id;
    image.title = badge.set_id;
    return image;
  }).filter(Boolean);
}

function emoteUrl(fragment) {
  const id = fragment.emote?.id;
  if (!id) return null;
  const animated = fragment.emote?.format?.includes('animated');
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/${animated ? 'animated' : 'static'}/dark/2.0`;
}

function appendFragments(container, message) {
  const fragments = message?.fragments || [];
  if (!fragments.length) {
    container.append(document.createTextNode(message?.text || ''));
    return;
  }
  for (const fragment of fragments) {
    if (fragment.type === 'emote' && fragment.emote?.id) {
      const image = document.createElement('img');
      image.className = 'emote';
      if (!setImageSource(image, emoteUrl(fragment))) continue;
      image.alt = fragment.text;
      image.title = fragment.text;
      container.append(image);
    } else if (fragment.type === 'gif' && fragment.gif?.url) {
      const image = document.createElement('img');
      image.className = 'emote';
      if (!setImageSource(image, fragment.gif.url)) continue;
      image.alt = fragment.text || 'GIF';
      container.append(image);
    } else {
      const span = document.createElement('span');
      if (fragment.type === 'mention') span.className = 'mention';
      span.textContent = fragment.text || '';
      container.append(span);
    }
  }
}

function markShown(element, shownAt) {
  const now = Date.now();
  const value = Number(shownAt);
  // Future timestamps (platform clock skew) must not extend the visible time.
  element.dataset.shownAt = String(Number.isFinite(value) && value > 0 ? Math.min(value, now) : now);
}

function scheduleFade(element) {
  const seconds = Number(state.settings.fadeSeconds || 0);
  if (!seconds || element.dataset.pinned === 'true') return;
  const fadeToken = String(Number(element.dataset.fadeToken || 0) + 1);
  element.dataset.fadeToken = fadeToken;
  // Fade relative to when the message first appeared, so restored history does
  // not stay on screen for another full fade period.
  const shownAt = Number(element.dataset.shownAt) || Date.now();
  const remaining = Math.max(0, seconds * 1000 - (Date.now() - shownAt));
  window.setTimeout(() => {
    if (!element.isConnected || element.dataset.fadeToken !== fadeToken) return;
    element.classList.add('fading');
    window.setTimeout(() => {
      if (element.dataset.fadeToken !== fadeToken) return;
      element.remove();
      updateEmptyState();
    }, 550);
  }, remaining);
}

function appendPlatformMark(header, platform) {
  const mark = document.createElement('span');
  mark.className = `platform-mark platform-${platform === 'tiktok' ? 'tiktok' : 'twitch'}`;
  mark.textContent = platform === 'tiktok' ? 'TT' : 'T';
  mark.title = platform === 'tiktok' ? 'TikTok' : 'Twitch';
  header.append(mark);
}

function appendAvatar(header, event) {
  if (!event.profile_image_url) return;
  const image = document.createElement('img');
  image.className = 'avatar';
  if (!setImageSource(image, event.profile_image_url)) return;
  image.alt = '';
  header.append(image);
}

function addChatMessage(event, options = {}) {
  const highlight = options.highlight || isHighlighted(event);
  const historyTimestamp = Number(event.timestamp);
  const observedAt = (options.historyReplay || event.historyReplay === true) && Number.isFinite(historyTimestamp) && historyTimestamp > 0
    ? historyTimestamp
    : Date.now();
  if (!options.bypassFilter && shouldFilter(event, highlight, observedAt)) return;
  const article = document.createElement('article');
  article.className = 'chat-message';
  article.dataset.platform = event.platform || 'twitch';
  article.dataset.messageId = event.message_id || crypto.randomUUID();
  article.dataset.userId = event.chatter_user_id || '';
  markShown(article, options.shownAt);
  if (highlight.mention) article.classList.add('highlight-mention');
  if (highlight.bits) article.classList.add('highlight-bits');
  if (options.sub) article.classList.add('highlight-sub');
  if (options.follow) article.classList.add('highlight-follow');
  if (options.pinned) article.dataset.pinned = 'true';

  if (options.noticeLabel) {
    const label = document.createElement('span');
    label.className = 'notice-label';
    label.textContent = options.noticeLabel;
    article.append(label);
  }

  const header = document.createElement('span');
  header.className = 'message-header';
  appendPlatformMark(header, event.platform || 'twitch');
  if (state.settings.showTimestamps) {
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = new Date(event.timestamp || Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    header.append(time);
  }
  appendAvatar(header, event);
  header.append(...badgeElements(event.badges));
  const username = document.createElement('span');
  username.className = 'username';
  username.style.setProperty('--user-color', event.color || '#bf94ff');
  username.textContent = event.chatter_user_name || event.chatter_user_login || (event.platform === 'tiktok' ? 'TikTok' : 'Twitch');
  header.append(username);
  const separator = document.createElement('span');
  separator.className = 'separator';
  separator.textContent = ':';
  header.append(separator);
  article.append(header, document.createTextNode(' '));

  const body = document.createElement('span');
  body.className = 'message-body';
  appendFragments(body, event.message);
  article.append(body);
  if (event.translation) appendTranslation(article, event.translation);
  dom.messages.append(article);
  trimMessages();
  scheduleFade(article);
  updateEmptyState();
  return article;
}

const LANGUAGE_LABELS = { DE: 'DE', EN: 'EN', 'EN-US': 'EN', 'EN-GB': 'EN', 'PT-BR': 'PT' };

function appendTranslation(article, translation) {
  if (!translation?.text || article.dataset.translated === 'true') return;
  article.dataset.translated = 'true';
  const line = document.createElement('span');
  line.className = 'translation';
  const language = document.createElement('span');
  language.className = 'translation-lang';
  const source = String(translation.source || '');
  const target = String(translation.target || '');
  const targetLabel = LANGUAGE_LABELS[target] || target;
  // Without a reliable source language only the target is shown.
  language.textContent = source ? `${LANGUAGE_LABELS[source] || source} → ${targetLabel}` : `→ ${targetLabel}`;
  line.append(language, document.createTextNode(String(translation.text)));
  article.append(line);
}

function requestTranslation(article, event) {
  const settings = state.settings;
  if (!article || !settings.translationEnabled || !settings.deeplApiKeyConfigured) return;
  if (event.translation || !event.message_id) return;
  window.overlay.translate(event.platform || 'twitch', event.message_id)
    .then(translation => {
      if (translation && article.isConnected) appendTranslation(article, translation);
    })
    .catch(() => {});
}

function noticeLabel(type) {
  if (!type) return 'Twitch-Event';
  if (type.includes('community_sub_gift')) return 'Community-Geschenkabo';
  if (type.includes('sub_gift')) return 'Geschenkabo';
  if (type.includes('resub')) return 'Resub';
  if (type.includes('sub')) return 'Neues Abo';
  if (type === 'follow') return 'Neuer Follow';
  if (type.includes('raid')) return 'Raid';
  if (type.includes('announcement')) return 'Ankündigung';
  return type.replaceAll('_', ' ');
}

function handleNotice(event, options = {}) {
  const type = String(event.notice_type || '');
  const sub = type.includes('sub') || type.includes('paid_upgrade');
  const follow = type === 'follow';
  const message = event.message?.text ? event.message : {
    text: event.system_message || noticeLabel(type),
    fragments: [{ type: 'text', text: event.system_message || noticeLabel(type) }]
  };
  addChatMessage({ ...event, message }, {
    bypassFilter: true,
    sub,
    follow,
    highlight: { mention: false, bits: false },
    noticeLabel: noticeLabel(type),
    shownAt: options.shownAt
  });
}

function addTikTokGift(event, options = {}) {
  const gift = event.gift || {};
  const selector = `[data-gift-key="${CSS.escape(event.gift_key || event.message_id || '')}"]`;
  dom.messages.querySelector(selector)?.remove();

  const article = document.createElement('article');
  article.className = 'chat-message highlight-gift';
  article.dataset.platform = 'tiktok';
  article.dataset.messageId = event.message_id || crypto.randomUUID();
  article.dataset.userId = event.chatter_user_id || '';
  article.dataset.giftKey = event.gift_key || event.message_id || '';
  markShown(article, options.shownAt);
  if (Number(gift.diamonds_total || 0) >= 100) article.classList.add('gift-premium');

  const label = document.createElement('span');
  label.className = 'notice-label gift-label';
  label.textContent = gift.is_streak && !gift.repeat_end ? 'TikTok-Geschenkserie läuft …' : 'TikTok-Geschenk';

  const row = document.createElement('div');
  row.className = 'gift-row';
  if (gift.image_url) {
    const image = document.createElement('img');
    image.className = 'gift-image';
    if (setImageSource(image, gift.image_url)) {
      image.alt = gift.name || 'Geschenk';
      row.append(image);
    }
  }

  const content = document.createElement('div');
  content.className = 'gift-content';
  const header = document.createElement('span');
  header.className = 'message-header';
  appendPlatformMark(header, 'tiktok');
  if (state.settings.showTimestamps) {
    const time = document.createElement('time');
    time.className = 'message-time';
    time.textContent = new Date(event.timestamp || Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    header.append(time);
  }
  appendAvatar(header, event);
  const username = document.createElement('span');
  username.className = 'username';
  username.style.setProperty('--user-color', '#69f3e7');
  username.textContent = event.chatter_user_name || event.chatter_user_login || 'TikTok';
  header.append(username);

  const description = document.createElement('span');
  description.className = 'gift-description';
  description.textContent = `sendet ${gift.name || 'ein Geschenk'} × ${Number(gift.count || 1)}`;
  content.append(header, description);
  if (Number(gift.diamonds_total || 0) > 0) {
    const value = document.createElement('small');
    value.className = 'gift-value';
    value.textContent = `${gift.diamonds_total} Diamanten`;
    content.append(value);
  }
  row.append(content);
  article.append(label, row);
  dom.messages.append(article);
  trimMessages();
  scheduleFade(article);
  updateEmptyState();
}

function addTikTokSocial(event, options = {}) {
  const label = event.social_type === 'follow' ? 'TikTok Follow' : 'TikTok Share';
  addChatMessage({
    ...event,
    color: '#ff6b9f',
    badges: [],
    message: { text: event.text, fragments: [{ type: 'text', text: event.text }] }
  }, {
    bypassFilter: true,
    noticeLabel: label,
    highlight: { mention: false, bits: false },
    shownAt: options.shownAt
  });
}

function restoreHistory(entries) {
  dom.messages.replaceChildren();
  spamTracker.reset();
  const now = Date.now();
  const fadeMs = Number(state.settings.fadeSeconds || 0) * 1000;
  for (const entry of entries || []) {
    const timestamp = Number(entry.timestamp);
    const shownAt = Number.isFinite(timestamp) && timestamp > 0 ? Math.min(timestamp, now) : now;
    // Entries that already faded out must not reappear on a history rebuild.
    if (fadeMs && now - shownAt >= fadeMs) continue;
    if (entry.kind === 'message') addChatMessage(entry.payload, { historyReplay: true, shownAt });
    else if (entry.kind === 'notice') handleNotice(entry.payload, { shownAt });
    else if (entry.kind === 'gift') addTikTokGift(entry.payload, { shownAt });
    else if (entry.kind === 'social') addTikTokSocial(entry.payload, { shownAt });
  }
  trimMessages();
  updateEmptyState();
}

function addSystemMessage(payload) {
  const article = document.createElement('article');
  article.className = `chat-message system-message${payload.error ? ' system-error' : ''}`;
  article.textContent = payload.text;
  markShown(article);
  dom.messages.append(article);
  trimMessages();
  // Sticky notices (a stream that ended) stay until newer messages push them out.
  if (payload.sticky) article.dataset.pinned = 'true';
  scheduleFade(article);
  updateEmptyState();
}

function trimMessages() {
  const max = Number(state.settings.maxMessages || 45);
  while (dom.messages.children.length > max) dom.messages.firstElementChild?.remove();
  updateEmptyState();
}

function clearMessages(platform) {
  if (platform === 'twitch' || platform === 'tiktok') {
    dom.messages.querySelectorAll(`[data-platform="${platform}"]`).forEach(element => element.remove());
  } else {
    dom.messages.replaceChildren();
  }
  spamTracker.reset();
  updateEmptyState();
}

function settingsFromForm() {
  return {
    channel: dom.channelInput.value,
    tiktokUsername: dom.tiktokUsernameInput.value,
    fontSize: Number(dom.fontSizeInput.value),
    opacity: Number(dom.opacityInput.value),
    fadeSeconds: Number(dom.fadeInput.value),
    maxMessages: Number(dom.maxMessagesInput.value),
    showTimestamps: dom.timestampsInput.checked,
    compactMode: dom.compactInput.checked,
    hideKnownBots: dom.botsInput.checked,
    hideCommands: dom.commandsInput.checked,
    showTikTokGifts: dom.tiktokGiftsInput.checked,
    showTikTokSocials: dom.tiktokSocialsInput.checked,
    showStreamStats: dom.streamStatsInput.checked,
    streamSafe: dom.streamSafeInput.checked,
    hiddenUsers: parseList(dom.hiddenUsersInput.value),
    blockedTerms: parseList(dom.blockedTermsInput.value),
    translationEnabled: dom.translationInput.checked,
    translationTarget: dom.translationTargetInput.value,
    translationSkipLanguages: parseList(dom.translationSkipInput.value).map(code => code.toUpperCase()),
    captionsEnabled: dom.captionsInput.checked,
    captionsDeviceId: dom.captionsDeviceInput.value,
    captionsGate: Number(dom.captionsGateInput.value),
    captionsTarget: dom.captionsTargetInput.value,
    captionsBackground: dom.captionsBackgroundInput.value,
    captionsFontSize: Number(dom.captionsFontSizeInput.value),
    captionsShowOriginal: dom.captionsOriginalInput.checked,
    captionsOnlyTranslated: dom.captionsOnlyTranslatedInput.checked,
    captionsTextColor: dom.captionsTextColorInput.value,
    captionsBox: dom.captionsBoxInput.checked,
    captionsWindowVisible: dom.captionsWindowInput.checked,
    updateBeta: dom.updateBetaInput.checked,
    updateInstall: dom.updateInstallInput.value
  };
}

function queueSettingsSave(immediate = false) {
  updateOutputs();
  const next = settingsFromForm();
  applySettings(next);
  clearTimeout(saveTimer);
  const generation = ++saveGeneration;
  saveTimer = window.setTimeout(async () => {
    try {
      const saved = await window.overlay.updateSettings(next);
      if (generation === saveGeneration) applySettings(saved);
    } catch (error) {
      if (generation === saveGeneration) addSystemMessage({ text: `Einstellungen konnten nicht gespeichert werden: ${error.message}`, error: true });
    }
  }, immediate ? 0 : 280);
}

function showDemoMessages() {
  clearMessages();
  addChatMessage({ message_id: 'demo-normal', chatter_user_id: '1', chatter_user_login: 'viewer', chatter_user_name: 'Viewer', color: '#5ec7ff', badges: [], message: { text: 'So sieht eine normale Nachricht aus Kappa', fragments: [{ type: 'text', text: 'So sieht eine normale Nachricht aus ' }, { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } }] } }, { bypassFilter: true });
  addChatMessage({ message_id: 'demo-mention', chatter_user_id: '2', chatter_user_login: 'freund', chatter_user_name: 'Freund', color: '#ffd166', badges: [], message: { text: `@${state.user?.login || 'streamer'} kannst du das sehen?`, fragments: [{ type: 'mention', text: `@${state.user?.login || 'streamer'}`, mention: { user_id: state.user?.id, user_login: state.user?.login } }, { type: 'text', text: ' kannst du das sehen?' }] } }, { bypassFilter: true, highlight: { mention: true, bits: false } });
  addChatMessage({ message_id: 'demo-bits', chatter_user_id: '3', chatter_user_login: 'supporter', chatter_user_name: 'Supporter', color: '#4bd8ff', badges: [], cheer: { bits: 250 }, message: { text: 'Cheer250 Starkes Overlay!', fragments: [{ type: 'cheermote', text: 'Cheer250', cheermote: { bits: 250 } }, { type: 'text', text: ' Starkes Overlay!' }] } }, { bypassFilter: true, highlight: { mention: false, bits: true }, noticeLabel: '250 Bits' });
  addChatMessage({ message_id: 'demo-sub', chatter_user_id: '4', chatter_user_login: 'newsub', chatter_user_name: 'NewSub', color: '#bf94ff', badges: [], message: { text: 'Ist jetzt Teil der Community!', fragments: [{ type: 'text', text: 'Ist jetzt Teil der Community!' }] } }, { bypassFilter: true, sub: true, highlight: { mention: false, bits: false }, noticeLabel: 'Neues Abo' });
  handleNotice({ platform: 'twitch', timestamp: Date.now(), message_id: 'demo-follow', notice_type: 'follow', chatter_user_id: '7', chatter_user_login: 'newfollower', chatter_user_name: 'NewFollower', color: '#63e6a7', badges: [], message: { text: 'folgt jetzt dem Kanal!', fragments: [{ type: 'text', text: 'folgt jetzt dem Kanal!' }] } });
  addChatMessage({ message_id: 'demo-translation', chatter_user_id: '8', chatter_user_login: 'amigo', chatter_user_name: 'Amigo', color: '#ff9f5e', badges: [], message: { text: '¡Hola! ¿Qué juego es este?', fragments: [{ type: 'text', text: '¡Hola! ¿Qué juego es este?' }] }, translation: { text: 'Hallo! Was ist das für ein Spiel?', source: 'ES', target: state.settings.translationTarget || 'DE' } }, { bypassFilter: true });
  addChatMessage({ platform: 'tiktok', timestamp: Date.now(), message_id: 'demo-tiktok', chatter_user_id: '5', chatter_user_login: 'tiktokviewer', chatter_user_name: 'TikTokViewer', color: '#69f3e7', badges: [], message: { text: 'Liebe Grüße aus dem TikTok-Chat!', fragments: [{ type: 'text', text: 'Liebe Grüße aus dem TikTok-Chat!' }] } }, { bypassFilter: true });
  addTikTokGift({ platform: 'tiktok', timestamp: Date.now(), message_id: 'demo-gift', gift_key: 'demo-gift', chatter_user_id: '6', chatter_user_login: 'supporter', chatter_user_name: 'Supporter', gift: { name: 'Rose', count: 15, diamonds_total: 15, is_streak: true, repeat_end: true } });
}

dom.settingsButton.addEventListener('click', () => dom.settingsPanel.classList.toggle('hidden'));
dom.closeSettingsButton.addEventListener('click', () => dom.settingsPanel.classList.add('hidden'));
dom.closeButton.addEventListener('click', () => window.overlay.quit().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.hideButton.addEventListener('click', () => window.overlay.toggleVisible().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.clearButton.addEventListener('click', () => window.overlay.clear().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.demoButton.addEventListener('click', showDemoMessages);
dom.reconnectButton.addEventListener('click', () => window.overlay.reconnect().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.logoutButton.addEventListener('click', () => window.overlay.logout().catch(error => addSystemMessage({ text: error.message, error: true })));
const SOURCE_FILE_HELP = dom.captionsSourceFileHelp.textContent;
let sourceFileHelpTimer = null;
dom.captionsSourceFileButton.addEventListener('click', async () => {
  clearTimeout(sourceFileHelpTimer);
  try {
    await window.overlay.revealCaptionsSourceFile();
    dom.captionsSourceFileHelp.textContent = 'Der Ordner ist geöffnet und der Dateipfad liegt in der Zwischenablage. In OBS bei „Lokale Datei“ einfügen.';
  } catch (error) {
    dom.captionsSourceFileHelp.textContent = error.message;
  }
  sourceFileHelpTimer = window.setTimeout(() => { dom.captionsSourceFileHelp.textContent = SOURCE_FILE_HELP; }, 8000);
});
dom.captionsLogButton.addEventListener('click', () => window.overlay.openCaptionsLog().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.tiktokLogButton.addEventListener('click', () => window.overlay.openTikTokLog().catch(error => addSystemMessage({ text: error.message, error: true })));
dom.eulerButton.addEventListener('click', () => window.overlay.openExternal('https://www.eulerstream.com/').catch(error => addSystemMessage({ text: error.message, error: true })));
dom.saveTikTokApiKeyButton.addEventListener('click', async () => {
  const apiKey = dom.tiktokApiKeyInput.value.trim();
  if (!apiKey) {
    dom.tiktokApiKeyStatus.textContent = 'Bitte zuerst einen API-Key einfügen.';
    return;
  }
  dom.saveTikTokApiKeyButton.disabled = true;
  try {
    const next = await window.overlay.setTikTokApiKey(apiKey);
    dom.tiktokApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.tiktokApiKeyStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
  } finally {
    dom.saveTikTokApiKeyButton.disabled = false;
  }
});
dom.clearTikTokApiKeyButton.addEventListener('click', async () => {
  try {
    const next = await window.overlay.setTikTokApiKey('');
    dom.tiktokApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.tiktokApiKeyStatus.textContent = `Entfernen fehlgeschlagen: ${error.message}`;
  }
});
dom.developerConsoleButton.addEventListener('click', () => window.overlay.openExternal('https://dev.twitch.tv/console/apps').catch(error => addSystemMessage({ text: error.message, error: true })));
dom.authButton.addEventListener('click', async () => {
  dom.authError.classList.add('hidden');
  dom.authButton.disabled = true;
  dom.authButton.textContent = 'Twitch wird geöffnet …';
  try {
    const info = await window.overlay.startAuth(dom.clientIdInput.value);
    dom.deviceCode.textContent = info.userCode;
    dom.deviceCodeBox.classList.remove('hidden');
    dom.authButton.textContent = 'Warte auf Bestätigung …';
  } catch (error) {
    dom.authError.textContent = error.message;
    dom.authError.classList.remove('hidden');
    dom.authButton.disabled = false;
    dom.authButton.textContent = 'Mit Twitch anmelden';
  }
});

for (const input of [dom.fontSizeInput, dom.opacityInput, dom.fadeInput, dom.maxMessagesInput,
  dom.captionsGateInput, dom.captionsFontSizeInput]) {
  input.addEventListener('input', () => queueSettingsSave());
}
for (const input of [dom.timestampsInput, dom.compactInput, dom.botsInput, dom.commandsInput, dom.tiktokGiftsInput, dom.tiktokSocialsInput, dom.streamStatsInput, dom.streamSafeInput]) {
  input.addEventListener('change', () => queueSettingsSave(true));
}
for (const input of [dom.channelInput, dom.tiktokUsernameInput, dom.hiddenUsersInput, dom.blockedTermsInput,
  dom.translationInput, dom.translationTargetInput, dom.translationSkipInput,
  dom.captionsInput, dom.captionsDeviceInput, dom.captionsTargetInput, dom.captionsBackgroundInput, dom.captionsOriginalInput, dom.captionsOnlyTranslatedInput,
  dom.captionsBoxInput, dom.captionsWindowInput, dom.updateBetaInput, dom.updateInstallInput]) {
  input.addEventListener('change', () => queueSettingsSave(true));
}
dom.saveDeepgramApiKeyButton.addEventListener('click', async () => {
  const apiKey = dom.deepgramApiKeyInput.value.trim();
  if (!apiKey) {
    dom.deepgramApiKeyStatus.textContent = 'Bitte zuerst einen API-Key einfügen.';
    return;
  }
  dom.saveDeepgramApiKeyButton.disabled = true;
  try {
    const next = await window.overlay.setDeepgramApiKey(apiKey);
    dom.deepgramApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.deepgramApiKeyStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
  } finally {
    dom.saveDeepgramApiKeyButton.disabled = false;
  }
});
dom.clearDeepgramApiKeyButton.addEventListener('click', async () => {
  try {
    const next = await window.overlay.setDeepgramApiKey('');
    dom.deepgramApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.deepgramApiKeyStatus.textContent = `Entfernen fehlgeschlagen: ${error.message}`;
  }
});
// The color picker fires continuously while dragging; save debounced like the sliders.
dom.captionsTextColorInput.addEventListener('input', () => queueSettingsSave());
dom.copyCaptionsUrlButton.addEventListener('click', async () => {
  const help = dom.captionsUrlHelp.textContent;
  try {
    await window.overlay.copyCaptionsUrl();
    dom.captionsUrlHelp.textContent = 'Adresse kopiert. In OBS oder TikTok LIVE Studio einfügen.';
  } catch (error) {
    dom.captionsUrlHelp.textContent = error.message;
  }
  window.setTimeout(() => { dom.captionsUrlHelp.textContent = help; }, 4000);
});
dom.captionsTestButton.addEventListener('click', async () => {
  const previous = dom.captionsSourceStatus.textContent;
  try {
    const clients = await window.overlay.testCaptions();
    dom.captionsSourceStatus.textContent = clients > 0
      ? 'Testzeile gesendet. Sie sollte jetzt für einige Sekunden in der Quelle erscheinen.'
      : 'Testzeile gesendet, aber es ist keine Quelle verbunden. Stimmt die Adresse in OBS oder TikTok LIVE Studio?';
  } catch (error) {
    dom.captionsSourceStatus.textContent = error.message;
  }
  window.setTimeout(() => { dom.captionsSourceStatus.textContent = previous; }, 6000);
});
dom.deepgramButton.addEventListener('click', () => window.overlay.openExternal('https://console.deepgram.com/').catch(error => addSystemMessage({ text: error.message, error: true })));
dom.saveDeepLApiKeyButton.addEventListener('click', async () => {
  const apiKey = dom.deeplApiKeyInput.value.trim();
  if (!apiKey) {
    dom.deeplApiKeyStatus.textContent = 'Bitte zuerst einen API-Key einfügen.';
    return;
  }
  dom.saveDeepLApiKeyButton.disabled = true;
  try {
    const next = await window.overlay.setDeepLApiKey(apiKey);
    dom.deeplApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.deeplApiKeyStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
  } finally {
    dom.saveDeepLApiKeyButton.disabled = false;
  }
});
dom.clearDeepLApiKeyButton.addEventListener('click', async () => {
  try {
    const next = await window.overlay.setDeepLApiKey('');
    dom.deeplApiKeyInput.value = '';
    applySettings(next);
  } catch (error) {
    dom.deeplApiKeyStatus.textContent = `Entfernen fehlgeschlagen: ${error.message}`;
  }
});
dom.deeplUsageButton.addEventListener('click', async () => {
  dom.deeplApiKeyStatus.textContent = 'Kontingent wird abgerufen …';
  try {
    const { used, limit } = await window.overlay.translationUsage();
    dom.deeplApiKeyStatus.textContent = limit
      ? `${viewerFormatter.format(used)} von ${viewerFormatter.format(limit)} Zeichen in diesem Monat verbraucht.`
      : `${viewerFormatter.format(used)} Zeichen in diesem Monat verbraucht.`;
  } catch (error) {
    dom.deeplApiKeyStatus.textContent = error.message;
  }
});
dom.deeplButton.addEventListener('click', () => window.overlay.openExternal('https://www.deepl.com/pro-api').catch(error => addSystemMessage({ text: error.message, error: true })));

window.overlay.onState(applyState);
window.overlay.onSettings(applySettings);
window.overlay.onStatus(setConnectionStatus);
window.overlay.onDiagnostics(updateDiagnostics);
window.overlay.onMetrics(applyStreamMetrics);
window.overlay.onAuthDevice(info => {
  dom.deviceCode.textContent = info.userCode;
  dom.deviceCodeBox.classList.remove('hidden');
});
window.overlay.onAuthSuccess(next => {
  dom.authButton.disabled = false;
  dom.authButton.textContent = 'Mit Twitch anmelden';
  dom.deviceCodeBox.classList.add('hidden');
  dom.setupPanel.classList.add('hidden');
  applyState(next);
});
window.overlay.onAuthError(error => {
  dom.authError.textContent = error.message;
  dom.authError.classList.remove('hidden');
  dom.authButton.disabled = false;
  dom.authButton.textContent = 'Erneut versuchen';
});
window.overlay.onAuthRequired(() => {
  dom.authButton.disabled = false;
  dom.authButton.textContent = 'Mit Twitch anmelden';
  dom.deviceCodeBox.classList.add('hidden');
  applyState({ authenticated: false, user: null });
});
window.overlay.onMessage(event => requestTranslation(addChatMessage(event), event));
window.overlay.onNotice(handleNotice);
window.overlay.onGift(addTikTokGift);
window.overlay.onSocial(addTikTokSocial);
window.overlay.onHistory(restoreHistory);
window.overlay.onDelete(({ messageId, platform = 'twitch' }) => {
  dom.messages.querySelector(`[data-platform="${CSS.escape(platform)}"][data-message-id="${CSS.escape(String(messageId || ''))}"]`)?.remove();
  updateEmptyState();
});
window.overlay.onClearUser(({ userId, platform = 'twitch' }) => {
  dom.messages.querySelectorAll(`[data-platform="${CSS.escape(platform)}"][data-user-id="${CSS.escape(String(userId || ''))}"]`).forEach(element => element.remove());
  updateEmptyState();
});
window.overlay.onClear(payload => clearMessages(payload?.platform));
window.overlay.onSystem(addSystemMessage);
window.overlay.onCaptionDevices(devices => {
  captionDevices = Array.isArray(devices) ? devices : [];
  renderCaptionDevices();
});
window.overlay.onCaptionLevel(showCaptionLevel);
window.overlay.onUpdateState(renderUpdateState);
dom.checkUpdateButton.addEventListener('click', () => window.overlay.checkForUpdates()
  .then(renderUpdateState)
  .catch(error => { dom.updateStatusText.textContent = error.message; }));
dom.installUpdateButton.addEventListener('click', () => window.overlay.installUpdate()
  .catch(error => { dom.updateStatusText.textContent = error.message; }));
dom.downloadUpdateButton.addEventListener('click', () => window.overlay.openUpdateDownload()
  .catch(error => { dom.updateStatusText.textContent = error.message; }));

renderStreamStats();
window.setInterval(renderStreamStats, 1000);

window.overlay.getState().then(applyState).catch(error => {
  setConnectionStatus({ state: 'error', detail: 'Overlay konnte nicht initialisiert werden' });
  addSystemMessage({ text: `Startfehler: ${error.message}`, error: true });
});
