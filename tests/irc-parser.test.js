'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIrcLine, toChatEvent, buildFragments } = require('../src/twitch-irc');

test('parses a Twitch PRIVMSG with badges, color and message id', () => {
  const line = '@badge-info=subscriber/8;badges=moderator/1,subscriber/6;color=#00FF7F;display-name=MrYourself;emotes=;id=abc-123;user-id=42 :mryourself!mryourself@mryourself.tmi.twitch.tv PRIVMSG #koy_cat :Yipppiiieee';
  const event = toChatEvent(parseIrcLine(line), { moderator: { 1: 'mod.png' } });
  assert.equal(event.message_id, 'abc-123');
  assert.equal(event.chatter_user_login, 'mryourself');
  assert.equal(event.chatter_user_name, 'MrYourself');
  assert.equal(event.message.text, 'Yipppiiieee');
  assert.equal(event.badges[0].url, 'mod.png');
});

test('creates ordered text and emote fragments', () => {
  assert.deepEqual(buildFragments('Hi Kappa!', '25:3-7'), [
    { type: 'text', text: 'Hi ' },
    { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } },
    { type: 'text', text: '!' }
  ]);
});

test('uses Twitch code-point offsets when emoji precede an emote', () => {
  assert.deepEqual(buildFragments('😀 Kappa!', '25:2-6'), [
    { type: 'text', text: '😀 ' },
    { type: 'emote', text: 'Kappa', emote: { id: '25', format: ['static'] } },
    { type: 'text', text: '!' }
  ]);
});

test('keeps the IRC timestamp and ignores invalid zero-bit cheers', () => {
  const event = toChatEvent(parseIrcLine('@bits=0;tmi-sent-ts=1700000000123 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :hello'));
  assert.equal(event.timestamp, 1700000000123);
  assert.equal(event.cheer, null);
});

test('respondable PING line is parsed without tags', () => {
  const parsed = parseIrcLine('PING :tmi.twitch.tv');
  assert.equal(parsed.command, 'PING');
  assert.equal(parsed.trailing, 'tmi.twitch.tv');
});
