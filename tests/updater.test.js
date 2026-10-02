'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { STARTUP_INSTALL_WINDOW_MS, createUpdater, errorText, isPrerelease, releasesUrl } = require('../src/updater');
const { sanitizeSettingsUpdate } = require('../src/app-utils');

function harness({ enabled = true, portable = false, prerelease = false, currentVersion = '0.1.15', checkResult,
  installMode = 'quit', portableUpdate = null, mayInstallAtStart = () => true } = {}) {
  const autoUpdater = new EventEmitter();
  autoUpdater.checks = 0;
  autoUpdater.installs = [];
  autoUpdater.checkForUpdates = async () => {
    autoUpdater.checks += 1;
    if (checkResult instanceof Error) throw checkResult;
    return null;
  };
  autoUpdater.quitAndInstall = (...args) => autoUpdater.installs.push(args);
  const states = [];
  const timers = [];
  const attempts = [];
  const clock = { time: 0 };
  const updater = createUpdater({
    autoUpdater,
    currentVersion,
    enabled,
    portable,
    prerelease,
    installMode,
    portableUpdate,
    mayInstallAtStart,
    onInstallAtStart: version => attempts.push(version),
    now: () => clock.time,
    onState: state => states.push(state),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    setRepeat: (callback, ms) => { const timer = { callback, ms, repeat: true }; timers.push(timer); return timer; },
    clearRepeat: () => {}
  });
  return { autoUpdater, updater, states, timers, attempts, clock };
}

test('builds the GitHub releases page only from a valid publish target', () => {
  assert.equal(releasesUrl({ provider: 'github', owner: 'jonas', repo: 'twitch-chat-overlay' }),
    'https://github.com/jonas/twitch-chat-overlay/releases/latest');
  assert.equal(releasesUrl([{ provider: 'generic' }, { provider: 'github', owner: 'a', repo: 'b' }]), 'https://github.com/a/b/releases/latest');
  assert.equal(releasesUrl({ provider: 'github', owner: 'x/../evil', repo: 'b' }), null);
  assert.equal(releasesUrl(null), null);
});

test('installed builds download in the background and install only on request or quit', async () => {
  const { autoUpdater, updater, states, timers } = harness();
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  updater.start();
  assert.deepEqual(timers.map(timer => timer.repeat === true), [false, true]);
  await timers[0].callback();
  assert.equal(autoUpdater.checks, 1);
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '0.1.16' });
  autoUpdater.emit('download-progress', { percent: 42.4 });
  assert.equal(states.at(-1).status, 'downloading');
  assert.equal(states.at(-1).progress, 42);
  assert.equal(updater.installNow(), false, 'nothing to install before the download finished');
  autoUpdater.emit('update-downloaded', { version: '0.1.16' });
  assert.equal(updater.state.status, 'ready');
  // A later failed check keeps the downloaded update available.
  autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.equal(updater.state.status, 'ready');
  await updater.check();
  assert.equal(autoUpdater.checks, 1, 'no new check while an update is ready');
  assert.equal(updater.installNow(), true);
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
});

test('portable builds only announce new versions', () => {
  const { autoUpdater, updater } = harness({ portable: true });
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  autoUpdater.emit('update-available', { version: '0.1.16' });
  assert.equal(updater.state.status, 'available');
  assert.equal(updater.state.version, '0.1.16');
});

test('stable installs ignore pre-releases unless the user opts in', () => {
  const stable = harness();
  assert.equal(stable.autoUpdater.allowPrerelease, false);
  stable.updater.setPrerelease(true);
  assert.equal(stable.autoUpdater.allowPrerelease, true);
  stable.updater.setPrerelease(false);
  assert.equal(stable.autoUpdater.allowPrerelease, false);
  assert.equal(harness({ prerelease: true }).autoUpdater.allowPrerelease, true);
});

test('an installed pre-release keeps following pre-releases', () => {
  const beta = harness({ currentVersion: '0.2.1-beta.1' });
  assert.equal(beta.autoUpdater.allowPrerelease, true);
  beta.updater.setPrerelease(false);
  assert.equal(beta.autoUpdater.allowPrerelease, true, 'opting out cannot strand a beta install');
  assert.equal(isPrerelease('0.2.1'), false);
});

test('disabled updater never touches electron-updater', async () => {
  const { updater, timers } = harness({ enabled: false });
  updater.start();
  await updater.check();
  assert.equal(updater.state.status, 'disabled');
  assert.equal(timers.length, 0);
  assert.equal(updater.installNow(), false);
});

test('failed checks become readable German messages', async () => {
  const { updater } = harness({ checkResult: new Error('getaddrinfo ENOTFOUND github.com') });
  await updater.check();
  assert.equal(updater.state.status, 'error');
  assert.equal(updater.state.error, 'Keine Verbindung zum Update-Server.');
  assert.equal(errorText(new Error('HttpError: 404 Not Found')), 'Auf GitHub wurde noch keine veröffentlichte Version gefunden.');
});

test('start mode installs an update that is ready right after the start', async () => {
  const { autoUpdater, updater, timers, attempts } = harness({ installMode: 'start' });
  updater.start();
  autoUpdater.emit('update-available', { version: '0.1.16' });
  autoUpdater.emit('update-downloaded', { version: '0.1.16' });
  assert.equal(updater.state.status, 'installing');
  assert.deepEqual(attempts, ['0.1.16']);
  assert.deepEqual(autoUpdater.installs, [], 'the notice is shown before the restart');
  await updater.check();
  assert.equal(autoUpdater.checks, 0, 'no new check while installing');
  timers.at(-1).callback();
  assert.deepEqual(autoUpdater.installs, [[true, true]]);
});

test('start mode leaves a running session alone and never retries a failed version', () => {
  const late = harness({ installMode: 'start' });
  late.updater.start();
  late.clock.time = STARTUP_INSTALL_WINDOW_MS + 1;
  late.autoUpdater.emit('update-downloaded', { version: '0.1.16' });
  assert.equal(late.updater.state.status, 'ready');
  assert.equal(late.autoUpdater.autoInstallOnAppQuit, true, 'it is installed on quit instead');

  const failed = harness({ installMode: 'start', mayInstallAtStart: version => version !== '0.1.16' });
  failed.updater.start();
  failed.autoUpdater.emit('update-downloaded', { version: '0.1.16' });
  assert.equal(failed.updater.state.status, 'ready');
  assert.deepEqual(failed.attempts, []);
});

test('manual mode downloads but installs only on request', () => {
  const { autoUpdater, updater } = harness({ installMode: 'manual' });
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  updater.start();
  autoUpdater.emit('update-downloaded', { version: '0.1.16' });
  assert.equal(updater.state.status, 'ready');
  updater.setInstallMode('quit');
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.deepEqual(sanitizeSettingsUpdate({ updateInstall: 'manual' }), { updateInstall: 'manual' });
  assert.deepEqual(sanitizeSettingsUpdate({ updateInstall: 'always' }), {});
});

function fakePortableUpdate({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    download: async (version, onProgress) => {
      calls.push(`download ${version}`);
      if (fail) throw fail;
      onProgress(50.2);
      onProgress(50.4);
    },
    apply: () => { calls.push('apply'); },
    relaunch: () => { calls.push('relaunch'); }
  };
}

const settled = () => new Promise(resolve => setImmediate(resolve));

test('portable builds download the new file and swap it on request', async () => {
  const portableUpdate = fakePortableUpdate();
  const { autoUpdater, updater, states } = harness({ portable: true, portableUpdate });
  assert.equal(autoUpdater.autoDownload, false, 'electron-updater cannot replace a portable file');
  updater.start();
  autoUpdater.emit('update-available', { version: '0.1.16' });
  assert.equal(updater.state.status, 'downloading');
  await settled();
  assert.equal(states.filter(state => state.progress === 50).length, 1, 'progress is reported once per percent');
  assert.equal(updater.state.status, 'ready');
  assert.equal(updater.installNow(), true);
  assert.deepEqual(portableUpdate.calls, ['download 0.1.16', 'apply', 'relaunch']);
  assert.equal(updater.installOnQuit(), false, 'already swapped');
});

test('portable builds swap the file on quit unless the mode is manual', async () => {
  const portableUpdate = fakePortableUpdate();
  const { autoUpdater, updater } = harness({ portable: true, portableUpdate, installMode: 'manual' });
  autoUpdater.emit('update-available', { version: '0.1.16' });
  await settled();
  assert.equal(updater.installOnQuit(), false);
  updater.setInstallMode('quit');
  assert.equal(updater.installOnQuit(), true);
  assert.deepEqual(portableUpdate.calls, ['download 0.1.16', 'apply']);
});

test('portable builds fall back to the download page when the download fails', async () => {
  const portableUpdate = fakePortableUpdate({ fail: new Error('EPERM: operation not permitted') });
  const { autoUpdater, updater } = harness({ portable: true, portableUpdate, installMode: 'start' });
  updater.start();
  autoUpdater.emit('update-available', { version: '0.1.16' });
  await settled();
  assert.equal(updater.state.status, 'available');
  assert.match(updater.state.error, /EPERM/);
  assert.equal(updater.installNow(), false);
});
