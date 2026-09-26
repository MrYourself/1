'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPendingEventBuffer } = require('../src/pending-events');

test('holds initial TikTok events until stream history is ready', () => {
  const delivered = [];
  const buffer = createPendingEventBuffer((kind, payload) => delivered.push([kind, payload]));
  buffer.push('message', { id: 'first' });
  buffer.push('viewer', { total: '42' });
  assert.deepEqual(delivered, []);
  assert.equal(buffer.pendingCount, 2);

  buffer.release();
  assert.deepEqual(delivered, [
    ['message', { id: 'first' }],
    ['viewer', { total: '42' }]
  ]);
  buffer.push('message', { id: 'live' });
  assert.deepEqual(delivered.at(-1), ['message', { id: 'live' }]);
});

test('bounds the initial event buffer and releases only once', () => {
  const delivered = [];
  const buffer = createPendingEventBuffer((kind, payload) => delivered.push([kind, payload]), 2);
  buffer.push('message', 1);
  buffer.push('message', 2);
  buffer.push('message', 3);
  buffer.release();
  buffer.release();
  assert.deepEqual(delivered, [['message', 2], ['message', 3]]);
});
