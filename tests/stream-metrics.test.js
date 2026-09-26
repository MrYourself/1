'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isoTimestamp,
  normalizeTimestamp,
  normalizeViewerCount,
  tiktokViewerCount
} = require('../src/stream-metrics');

test('normalizes Twitch and TikTok viewer counters without accepting malformed values', () => {
  assert.equal(normalizeViewerCount(42.9), 42);
  assert.equal(normalizeViewerCount('12,345'), 12345);
  assert.equal(normalizeViewerCount(null), null);
  assert.equal(normalizeViewerCount('-1'), null);
  assert.equal(normalizeViewerCount('1.2K'), null);
  assert.equal(tiktokViewerCount({ viewerCount: 88 }), 88);
  assert.equal(tiktokViewerCount({ total: '1 234' }), 1234);
  assert.equal(tiktokViewerCount({ data: { totalUser: '77' } }), 77);
});

test('accepts ISO, second and millisecond stream timestamps', () => {
  const now = Date.UTC(2026, 8, 4, 20, 0, 0);
  const expected = Date.UTC(2026, 8, 4, 18, 30, 0);
  assert.equal(normalizeTimestamp('2026-09-04T18:30:00.000Z', now), expected);
  assert.equal(normalizeTimestamp(expected / 1000, now), expected);
  assert.equal(normalizeTimestamp(expected, now), expected);
  assert.equal(isoTimestamp(expected, now), '2026-09-04T18:30:00.000Z');
  assert.equal(normalizeTimestamp('not-a-date', now), null);
});
