'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedExternalUrl,
  normalizeTwitchChannel,
  reconnectDelay,
  sanitizeBounds,
  sanitizeSettingsUpdate,
  sanitizeStringList
} = require('../src/app-utils');

test('sanitizes channels, filter lists and numeric settings', () => {
  assert.equal(normalizeTwitchChannel(' #Koy-Cat_Gaming '), 'koycat_gaming');
  assert.deepEqual(sanitizeStringList([' Bot ', 'bot', '', 'TERM']), ['bot', 'term']);
  assert.deepEqual(sanitizeSettingsUpdate({ opacity: 150, fadeSeconds: '', maxMessages: '12' }), {
    opacity: 100,
    maxMessages: 12
  });
});

test('accepts only boolean values for the stream statistics setting', () => {
  assert.deepEqual(sanitizeSettingsUpdate({ showStreamStats: true, streamSafe: 'yes' }), {
    showStreamStats: true
  });
});

test('keeps saved window bounds finite and within supported dimensions', () => {
  assert.deepEqual(sanitizeBounds({ x: 20.4, y: 40.6, width: 99999, height: 'bad' }), {
    x: 20,
    y: 41,
    width: 3840,
    height: 760
  });
});

test('only allows the external support sites used by the settings screen', () => {
  assert.equal(isAllowedExternalUrl('https://dev.twitch.tv/console/apps'), true);
  assert.equal(isAllowedExternalUrl('https://www.eulerstream.com/'), true);
  assert.equal(isAllowedExternalUrl('https://example.test/'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
});

test('reconnect delay uses a bounded exponential backoff', () => {
  assert.equal(reconnectDelay(0), 3000);
  assert.equal(reconnectDelay(2), 12000);
  assert.equal(reconnectDelay(20), 30000);
});

test('fits the overlay into a small handheld screen and keeps a valid position', () => {
  const { fitBoundsToWorkArea } = require('../src/app-utils');
  // 1920x1080 at 200 % scaling leaves a work area lower than the default window.
  const handheld = { x: 0, y: 0, width: 960, height: 492 };
  assert.deepEqual(fitBoundsToWorkArea({ width: 520, height: 760 }, handheld), { x: 440, y: 0, width: 520, height: 492 });
  assert.deepEqual(fitBoundsToWorkArea({ x: 700, y: 300, width: 400, height: 400 }, handheld), { x: 560, y: 92, width: 400, height: 400 });
  const desktop = { x: 1920, y: 0, width: 2560, height: 1400 };
  const stored = { x: 4119, y: 192, width: 360, height: 1030 };
  assert.deepEqual(fitBoundsToWorkArea(stored, desktop), stored, 'a position that already fits is left alone');
});
