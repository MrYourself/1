'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { buildCaption, interimText, languageRuns, parseDeepgramMessage } = require('../src/caption-transcript');
const { createDeepgramStream, deepgramUrl, fatalErrorText } = require('../src/deepgram-client');
const { createSpeechGate, gateThreshold, levelFromRms } = require('../src/captions/speech-gate');
const { sanitizeSettingsUpdate } = require('../src/app-utils');

const word = (text, language) => ({ punctuated_word: text, word: text.toLowerCase(), language });

test('parses Deepgram results with per-word languages', () => {
  const parsed = parseDeepgramMessage({
    type: 'Results',
    is_final: true,
    channel: { alternatives: [{ transcript: 'Hallo zusammen', languages: ['de'], words: [word('Hallo', 'de'), word('zusammen.', 'de')] }] }
  });
  assert.deepEqual(parsed, { isFinal: true, words: [{ text: 'Hallo', language: 'de' }, { text: 'zusammen.', language: 'de' }] });
  assert.equal(parseDeepgramMessage({ type: 'Metadata' }), null);
});

test('groups languages and absorbs single misdetected words', () => {
  const words = [
    { text: 'Ich', language: 'de' }, { text: 'finde', language: 'de' }, { text: 'das', language: 'de' },
    { text: 'okay', language: 'en' }, { text: 'wirklich', language: 'de' }, { text: 'gut.', language: 'de' },
    { text: 'Let’s', language: 'en' }, { text: 'go', language: 'en' }, { text: 'guys!', language: 'en' }
  ];
  assert.deepEqual(languageRuns(words), [
    { language: 'de', text: 'Ich finde das okay wirklich gut.' },
    { language: 'en', text: 'Let’s go guys!' }
  ]);
});

test('translates only the parts that are not in the caption language', async () => {
  const requests = [];
  const caption = await buildCaption([
    { text: 'Wo', language: 'de' }, { text: 'ist', language: 'de' }, { text: 'der', language: 'de' }, { text: 'Shop?', language: 'de' },
    { text: 'Oh', language: 'en' }, { text: 'found', language: 'en' }, { text: 'it.', language: 'en' }
  ], {
    target: 'EN-US',
    translate: async (text, language) => {
      requests.push([text, language]);
      return 'Where is the shop?';
    }
  });
  assert.deepEqual(requests, [['Wo ist der Shop?', 'DE']]);
  assert.equal(caption.text, 'Where is the shop? Oh found it.');
  assert.equal(caption.original, 'Wo ist der Shop? Oh found it.');
  assert.equal(caption.translated, true);
});

test('falls back to the original when translation is unavailable', async () => {
  const caption = await buildCaption([{ text: 'Guten', language: 'de' }, { text: 'Morgen', language: 'de' }], {
    target: 'EN-US',
    translate: async () => { throw new Error('offline'); }
  });
  assert.equal(caption.text, 'Guten Morgen');
  assert.equal(caption.translated, false);
});

test('interim captions never show untranslated foreign text', () => {
  assert.equal(interimText([{ text: 'hello', language: 'en' }], 'EN-US'), 'hello');
  assert.equal(interimText([{ text: 'hallo', language: 'de' }], 'EN-US'), '…');
});

test('speech gate sends pre-roll, speech and hangover, then signals the end', () => {
  const sent = [];
  let ended = 0;
  const gate = createSpeechGate({ send: frame => sent.push(frame), speechEnded: () => { ended += 1; }, preRollFrames: 2, hangoverFrames: 2 });
  const threshold = gateThreshold(50);
  gate.push('quiet-1', 0, threshold);
  gate.push('quiet-2', 0, threshold);
  gate.push('quiet-3', 0, threshold);
  assert.deepEqual(sent, []);
  gate.push('speech', 0.05, threshold);
  assert.deepEqual(sent, ['quiet-2', 'quiet-3', 'speech']);
  gate.push('tail-1', 0, threshold);
  gate.push('tail-2', 0, threshold);
  gate.push('silence', 0, threshold);
  assert.deepEqual(sent, ['quiet-2', 'quiet-3', 'speech', 'tail-1', 'tail-2']);
  assert.equal(ended, 1);
});

test('gate threshold and level meter share one scale', () => {
  assert.ok(Math.abs(gateThreshold(50) - 0.01) < 1e-12);
  assert.equal(Math.round(levelFromRms(0.01)), 50);
  assert.equal(levelFromRms(0), 0);
});

function streamHarness(apiKey = 'dg-key') {
  const sockets = [];
  const timers = [];
  const statuses = [];
  const messages = [];
  let clock = 0;
  class Socket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.closed = true; }
    open() { this.readyState = 1; this.emit('open'); }
  }
  const stream = createDeepgramStream({
    WebSocketImpl: Socket,
    getApiKey: () => apiKey,
    onMessage: message => messages.push(message),
    onStatus: status => statuses.push(status),
    reconnectDelay: attempt => 1000 * (attempt + 1),
    now: () => clock,
    setTimer: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimer: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    setRepeat: callback => { const timer = { callback, repeat: true }; timers.push(timer); return timer; },
    clearRepeat: timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); }
  });
  return { stream, sockets, timers, statuses, messages, advance: ms => { clock += ms; } };
}

test('Deepgram stream authenticates, buffers early audio and keeps idle streams alive', () => {
  const { stream, sockets, timers, messages, advance } = streamHarness();
  stream.start();
  const socket = sockets[0];
  assert.equal(socket.url, deepgramUrl());
  assert.match(socket.url, /model=nova-3/);
  assert.match(socket.url, /language=multi/);
  assert.equal(socket.options.headers.Authorization, 'Token dg-key');
  stream.sendAudio(Buffer.alloc(3200));
  socket.open();
  assert.equal(socket.sent.length, 1, 'audio captured during the handshake is delivered');
  socket.emit('message', JSON.stringify({ type: 'Results', is_final: true }));
  assert.equal(messages.length, 1);
  advance(4000);
  timers.find(timer => timer.repeat).callback();
  assert.equal(socket.sent.at(-1), JSON.stringify({ type: 'KeepAlive' }));
  stream.finalize();
  assert.equal(socket.sent.at(-1), JSON.stringify({ type: 'Finalize' }));
});

test('Deepgram stream retries dropped connections but stops on a rejected key', () => {
  const { stream, sockets, timers, statuses } = streamHarness();
  stream.start();
  sockets[0].open();
  sockets[0].emit('close');
  const retry = timers.find(timer => !timer.repeat);
  assert.equal(retry.ms, 1000);
  retry.callback();
  assert.equal(sockets.length, 2);
  sockets[1].emit('error', new Error('Unexpected server response: 401'));
  sockets[1].emit('close');
  assert.equal(statuses.at(-1).state, 'error');
  assert.match(statuses.at(-1).message, /API-Key abgelehnt/);
  assert.equal(timers.filter(timer => !timer.repeat).length, 0);
  assert.equal(fatalErrorText('Unexpected server response: 402'), 'Das Deepgram-Guthaben ist aufgebraucht.');
});

test('stopping the stream closes the socket and ignores its late events', () => {
  const { stream, sockets, statuses } = streamHarness();
  stream.start();
  sockets[0].open();
  stream.stop();
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[0].sent.at(-1), JSON.stringify({ type: 'CloseStream' }));
  assert.equal(statuses.at(-1).state, 'off');
  stream.sendAudio(Buffer.alloc(10));
  assert.equal(sockets[0].sent.length, 1);
});

test('sanitizes caption settings', () => {
  assert.deepEqual(sanitizeSettingsUpdate({
    captionsEnabled: true,
    captionsTarget: 'xx',
    captionsBackground: 'pink',
    captionsFontSize: 500,
    captionsGate: -3,
    captionsDeviceId: 'abc"<script>'
  }), {
    captionsEnabled: true,
    captionsTarget: 'EN-US',
    captionsFontSize: 72,
    captionsGate: 0,
    captionsDeviceId: ''
  });
});
