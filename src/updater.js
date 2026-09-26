'use strict';

const FIRST_CHECK_DELAY_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function releasesUrl(publish) {
  const config = Array.isArray(publish) ? publish.find(entry => entry?.provider === 'github') : publish;
  if (config?.provider !== 'github' || !/^[\w.-]+$/.test(config.owner || '') || !/^[\w.-]+$/.test(config.repo || '')) return null;
  return `https://github.com/${config.owner}/${config.repo}/releases/latest`;
}

function errorText(error) {
  const message = String(error?.message || error || 'Unbekannter Fehler');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(message)) return 'Keine Verbindung zum Update-Server.';
  if (/\b404\b/.test(message)) return 'Auf GitHub wurde noch keine veröffentlichte Version gefunden.';
  if (/sha512 checksum mismatch/i.test(message)) return 'Das heruntergeladene Update war beschädigt und wurde verworfen.';
  return `Update fehlgeschlagen: ${message.split('\n')[0].slice(0, 200)}`;
}

// Wraps electron-updater. Installed (NSIS) builds download updates in the background
// and install them when the app quits or when the user chooses to restart; they never
// restart on their own, so a running stream is not interrupted. Portable builds cannot
// replace themselves and only announce new versions with a download link.
function createUpdater({
  autoUpdater,
  currentVersion,
  enabled,
  portable = false,
  onState = () => {},
  setTimer = setTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval
}) {
  let state = enabled
    ? { status: 'idle', currentVersion, portable }
    : { status: 'disabled', currentVersion, portable };
  let repeatTimer = null;

  function update(patch) {
    state = { ...state, ...patch };
    onState({ ...state });
  }

  if (enabled) {
    autoUpdater.autoDownload = !portable;
    autoUpdater.autoInstallOnAppQuit = !portable;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => update({ status: 'checking', error: null }));
    autoUpdater.on('update-not-available', () => update({ status: 'current', error: null, checkedAt: Date.now() }));
    autoUpdater.on('update-available', info => update({
      status: portable ? 'available' : 'downloading',
      version: String(info?.version || ''),
      progress: 0,
      error: null,
      checkedAt: Date.now()
    }));
    autoUpdater.on('download-progress', progress => update({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)))
    }));
    autoUpdater.on('update-downloaded', info => update({
      status: 'ready',
      version: String(info?.version || state.version || ''),
      progress: 100,
      error: null
    }));
    autoUpdater.on('error', error => {
      // A failed background check must not hide an update that is already downloaded.
      if (state.status === 'ready') return;
      update({ status: 'error', error: errorText(error) });
    });
  }

  function check() {
    if (!enabled || ['checking', 'downloading', 'ready'].includes(state.status)) return Promise.resolve(state);
    return Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch(error => update({ status: 'error', error: errorText(error) }))
      .then(() => ({ ...state }));
  }

  function start() {
    if (!enabled || repeatTimer) return;
    setTimer(() => { check(); }, FIRST_CHECK_DELAY_MS);
    repeatTimer = setRepeat(() => { check(); }, CHECK_INTERVAL_MS);
    repeatTimer?.unref?.();
  }

  function stop() {
    clearRepeat(repeatTimer);
    repeatTimer = null;
  }

  function installNow() {
    if (state.status !== 'ready') return false;
    // Silent install, then start the new version again.
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  return {
    check,
    installNow,
    start,
    stop,
    get state() { return { ...state }; }
  };
}

module.exports = { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, createUpdater, errorText, releasesUrl };
