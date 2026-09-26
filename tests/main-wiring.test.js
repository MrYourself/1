'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

test('activates TikTok history before releasing buffered initial events', () => {
  const activation = source.indexOf('const startedAt = activateTikTokHistory(');
  const release = source.indexOf('opened.releasePending();', activation);
  assert.ok(activation >= 0, 'TikTok history activation is wired');
  assert.ok(release > activation, 'initial TikTok events are released after activation');
});

test('the Twitch metrics poll does not rebuild an unchanged chat history', () => {
  // Line-ending agnostic: CI checkouts on Windows may use CRLF.
  const polling = source.match(/function startStreamHistoryPolling[\s\S]*?\r?\n}\r?\n/)?.[0] || '';
  assert.match(polling, /syncTwitchStreamHistory\(broadcaster, false, generation\)/);
});
