'use strict';

const FIRST_CHECK_DELAY_MS = 3 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// An update that is ready this soon after the start may restart the app on its own.
// Later ones wait for the next quit, so a running stream is not interrupted.
const STARTUP_INSTALL_WINDOW_MS = 3 * 60 * 1000;
const INSTALL_NOTICE_MS = 1500;
const INSTALL_MODES = Object.freeze(['start', 'quit', 'manual']);

function normalizeInstallMode(value) {
  return INSTALL_MODES.includes(value) ? value : 'start';
}

function releasesUrl(publish) {
  const config = Array.isArray(publish) ? publish.find(entry => entry?.provider === 'github') : publish;
  if (config?.provider !== 'github' || !/^[\w.-]+$/.test(config.owner || '') || !/^[\w.-]+$/.test(config.repo || '')) return null;
  return `https://github.com/${config.owner}/${config.repo}/releases/latest`;
}

function isPrerelease(version) {
  return String(version || '').includes('-');
}

function errorText(error) {
  const message = String(error?.message || error || 'Unbekannter Fehler');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(message)) return 'Keine Verbindung zum Update-Server.';
  if (/\b404\b/.test(message)) return 'Auf GitHub wurde noch keine veröffentlichte Version gefunden.';
  if (/sha512 checksum mismatch/i.test(message)) return 'Das heruntergeladene Update war beschädigt und wurde verworfen.';
  return `Update fehlgeschlagen: ${message.split('\n')[0].slice(0, 200)}`;
}

// Wraps electron-updater. Updates are always downloaded in the background; the install
// mode decides when they are applied: right after the start ('start'), when the app
// quits ('quit', also the fallback for 'start') or only on request ('manual').
// Installed (NSIS) builds are replaced by electron-updater. Portable builds cannot be,
// so `portableUpdate` downloads the new file and swaps it in.
function createUpdater({
  autoUpdater,
  currentVersion,
  enabled,
  portable = false,
  prerelease = false,
  installMode = 'start',
  portableUpdate = null,
  mayInstallAtStart = () => true,
  onInstallAtStart = () => {},
  onState = () => {},
  now = Date.now,
  setTimer = setTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval
}) {
  let state = enabled
    ? { status: 'idle', currentVersion, portable }
    : { status: 'disabled', currentVersion, portable };
  let repeatTimer = null;
  let startedAt = null;
  let mode = normalizeInstallMode(installMode);
  let applied = false;

  function update(patch) {
    state = { ...state, ...patch };
    onState({ ...state });
  }

  function applyMode() {
    if (enabled) autoUpdater.autoInstallOnAppQuit = !portable && mode !== 'manual';
  }

  function install() {
    if (!portable) {
      // Silent install, then start the new version again.
      autoUpdater.quitAndInstall(true, true);
      return true;
    }
    try {
      portableUpdate.apply();
      applied = true;
    } catch (error) {
      update({ status: 'available', error: errorText(error) });
      return false;
    }
    portableUpdate.relaunch();
    return true;
  }

  function downloaded(version) {
    update({ status: 'ready', version, progress: 100, error: null });
    if (mode !== 'start' || startedAt === null || now() - startedAt > STARTUP_INSTALL_WINDOW_MS) return;
    // One automatic attempt per version: a failing installer must not restart the app in a loop.
    if (!mayInstallAtStart(version)) return;
    onInstallAtStart(version);
    update({ status: 'installing' });
    setTimer(() => { install(); }, INSTALL_NOTICE_MS);
  }

  function downloadPortable(version) {
    let shown = 0;
    portableUpdate.download(version, percent => {
      const progress = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      if (progress === shown) return;
      shown = progress;
      update({ status: 'downloading', progress });
    }).then(
      () => downloaded(version),
      error => update({ status: 'available', error: errorText(error) })
    );
  }

  if (enabled) {
    autoUpdater.autoDownload = !portable;
    applyMode();
    // An installed pre-release keeps following pre-releases; stable installs only
    // see them when the user opted in.
    autoUpdater.allowPrerelease = isPrerelease(currentVersion) || prerelease === true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => update({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => update({ status: 'current', error: null, checkedAt: Date.now() }));
    autoUpdater.on('update-available', info => {
      const version = String(info?.version || '');
      const selfUpdating = !portable || Boolean(portableUpdate);
      update({
        status: selfUpdating ? 'downloading' : 'available',
        version,
        progress: 0,
        error: null,
        checkedAt: Date.now()
      });
      if (portable && portableUpdate) downloadPortable(version);
    });
    autoUpdater.on('download-progress', progress => update({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))
    }));
    autoUpdater.on('update-downloaded', info => downloaded(String(info?.version || state.version || '')));
    autoUpdater.on('error', error => {
      // A failed background check must not hide an update that is already downloaded.
      if (['ready', 'installing'].includes(state.status)) return;
      update({ status: 'error', error: errorText(error) });
    });
  }

  function check() {
    if (!enabled || ['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return Promise.resolve(state);
    return Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch(error => update({ status: 'error', error: errorText(error) }))
      .then(() => ({ ...state }));
  }

  function start() {
    if (!enabled || repeatTimer) return;
    startedAt = now();
    setTimer(() => { check(); }, FIRST_CHECK_DELAY_MS);
    repeatTimer = setRepeat(() => { check(); }, CHECK_INTERVAL_MS);
    repeatTimer?.unref?.();
  }

  function stop() {
    clearRepeat(repeatTimer);
    repeatTimer = null;
  }

  function setPrerelease(value) {
    if (enabled) autoUpdater.allowPrerelease = isPrerelease(currentVersion) || value === true;
  }

  function setInstallMode(value) {
    mode = normalizeInstallMode(value);
    applyMode();
  }

  function installNow() {
    if (state.status !== 'ready') return false;
    return install();
  }

  // electron-updater installs NSIS updates on quit by itself. The portable swap has
  // to happen here; the new file is then used by the next start.
  function installOnQuit() {
    if (!portable || !portableUpdate || applied || mode === 'manual' || state.status !== 'ready') return false;
    try {
      portableUpdate.apply();
      applied = true;
      return true;
    } catch {
      return false;
    }
  }

  return {
    check,
    installNow,
    installOnQuit,
    setInstallMode,
    setPrerelease,
    start,
    stop,
    get state() { return { ...state }; }
  };
}

module.exports = {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  INSTALL_MODES,
  STARTUP_INSTALL_WINDOW_MS,
  createUpdater,
  errorText,
  isPrerelease,
  normalizeInstallMode,
  releasesUrl
};
