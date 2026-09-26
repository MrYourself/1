'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpamTracker } = require('../src/renderer/spam-filter');

test('history replay uses original timestamps instead of render speed', () => {
  const tracker = createSpamTracker();
  const start = 1700000000000;
  for (let index = 0; index < 10; index += 1) {
    assert.equal(tracker.isSpam('leo', `Nachricht ${index}`, start + index * 60000), false);
  }
});

test('still filters actual rapid bursts and repeated messages', () => {
  const start = 1700000000000;
  const burstTracker = createSpamTracker();
  for (let index = 0; index < 5; index += 1) {
    assert.equal(burstTracker.isSpam('viewer', `Text ${index}`, start + index * 500), false);
  }
  assert.equal(burstTracker.isSpam('viewer', 'Text 5', start + 2500), true);

  const repeatTracker = createSpamTracker();
  assert.equal(repeatTracker.isSpam('viewer', 'gleich', start), false);
  assert.equal(repeatTracker.isSpam('viewer', 'gleich', start + 1000), true);
});

test('does not mistake separate emote-only messages for exact text repeats', () => {
  const tracker = createSpamTracker();
  const start = 1700000000000;
  assert.equal(tracker.isSpam('viewer', '', start), false);
  assert.equal(tracker.isSpam('viewer', '', start + 1000), false);
});
