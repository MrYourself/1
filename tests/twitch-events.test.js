'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toTwitchFollowNotice } = require('../src/twitch-events');

test('maps a Twitch follow to a highlighted notice payload', () => {
  const notice = toTwitchFollowNotice({
    user_id: '1234',
    user_login: 'newfollower',
    user_name: 'NewFollower',
    followed_at: '2026-09-03T12:34:56Z'
  });
  assert.equal(notice.notice_type, 'follow');
  assert.equal(notice.chatter_user_name, 'NewFollower');
  assert.equal(notice.message.text, 'folgt jetzt dem Kanal!');
  assert.equal(notice.timestamp, Date.parse('2026-09-03T12:34:56Z'));
});
