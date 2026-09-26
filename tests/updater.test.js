'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, errorText, releasesUrl } = require('../src/updater');

function harness({ enabled = true, portable = false, checkResult } = {}) {
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
  const updater = createUpdater({
    autoUpdater,
    currentVersion: '0.1.15',
    enabled,
    portable,
    onState: state => states.push(state),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    setRepeat: (callback, ms) => { const timer = { callback, ms, repeat: true }; timers.push(timer); return timer; },
    clearRepeat: () => {}
  });
  return { autoUpdater, updater, states, timers };
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
