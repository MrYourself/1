'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');

const sourceRoot = path.join(__dirname, '..');
const localRequire = createRequire(path.join(sourceRoot, 'src/main.js'));
const mainSource = fs.readFileSync(path.join(sourceRoot, 'src/main.js'), 'utf8').split('const singleInstanceLock =')[0];
const rendererSource = fs.readFileSync(path.join(sourceRoot, 'src/renderer/app.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function mainContext(extra = {}) {
  const timers = new Map();
  const sockets = [];
  class Socket extends EventEmitter {
    constructor() { super(); sockets.push(this); }
    close() { this.closed = true; }
    send() {}
  }
  function timer(callback, ms, interval = false) {
    const key = { unref() {} };
    timers.set(key, { callback, ms, interval });
    return key;
  }
  const context = vm.createContext({
    require: name => name === 'electron' ? (extra.electron || {}) : name === 'ws' ? Socket : localRequire(name),
    __dirname: path.join(sourceRoot, 'src'),
    console, URL, URLSearchParams, AbortController, Buffer,
    setTimeout: (callback, ms) => timer(callback, ms),
    clearTimeout: key => timers.delete(key),
    setInterval: (callback, ms) => timer(callback, ms, true),
    clearInterval: key => timers.delete(key),
    ...extra
  });
  const run = code => vm.runInContext(code, context);
  run(mainSource);
  run('settings = { ...DEFAULT_SETTINGS };');
  async function fire(key) {
    const scheduled = timers.get(key);
    assert.ok(scheduled, 'timer must be scheduled');
    if (!scheduled.interval) timers.delete(key);
    scheduled.callback();
    await tick();
  }
  return { context, timers, sockets, run, fire };
}

// Minimal DOM boundary: application rendering and IPC handlers execute unchanged.
function rendererContext() {
  const elements = new Map();
  const handlers = {};
  function element() {
    return {
      children: [], dataset: {}, style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, addEventListener() {},
      append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
      replaceChildren() { this.children = []; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
      get firstElementChild() { return this.children[0]; },
      querySelectorAll(selector) {
        const conditions = [...selector.matchAll(/\[data-([a-z-]+)="([^"]*)"\]/g)];
        return this.children.filter(child => conditions.every(([, key, value]) =>
          child.dataset?.[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] === value));
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
  }
  const overlay = new Proxy({}, {
    get(_target, name) {
      if (name === 'getState') return () => new Promise(() => {});
      if (name.startsWith('on')) return callback => { handlers[name] = callback; };
      return async () => {};
    }
  });
  const context = vm.createContext({
    window: { overlay, chatSpamFilter: localRequire('./renderer/spam-filter'), setTimeout() {}, setInterval() {} },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element,
      createTextNode: text => ({ text })
    },
    CSS: { escape: String },
    crypto: { randomUUID: () => 'id' }
  });
  const run = code => vm.runInContext(code, context);
  run(rendererSource);
  run('state.settings = { maxMessages: 200, fadeSeconds: 0 };');
  return { context, elements, handlers, run };
}

function linkChat(app, renderer) {
  const handlerNames = {
    'chat:message': 'onMessage', 'chat:history': 'onHistory', 'chat:notice': 'onNotice',
    'chat:clear': 'onClear', 'chat:clear-user': 'onClearUser', 'chat:delete': 'onDelete'
  };
  app.context.deliver = (channel, payload) => renderer.handlers[handlerNames[channel]]?.(payload);
  app.run('send = deliver;');
}

function configureTwitch(app) {
  app.run(`
    accessSession = { user: { id: '1', login: 'viewer' }, refreshToken: 'dummy' };
    settings.channel = 'viewer';
    ensureAccessToken = async () => 'dummy';
    loadBadges = async () => ({ map: {}, errors: [] });
    syncTwitchStreamHistory = async () => null;
  `);
}

test('TikTok connect delivers all spaced initial messages while still filtering live bursts', async () => {
  const renderer = rendererContext();
  const app = mainContext({ electron: { net: { fetch: async () => ({
    ok: true,
    text: async () => '<script id="SIGI_STATE">{"LiveRoom":{"liveRoomUserInfo":{"user":{"uniqueId":"streamer","roomId":"123456789"}}}}</script>'
  }) } } });
  linkChat(app, renderer);
  let connection;
  class TikTokConnection extends EventEmitter {
    constructor() { super(); connection = this; }
    async connect() {
      for (let i = 0; i < 10; i++) {
        this.emit('chat', {
          user: { id: '1', uniqueId: 'viewer' }, content: `Initial ${i}`,
          common: { msgId: `m${i}`, createTime: 1700000000 + i * 10 }
        });
      }
      return { roomId: '123456789' };
    }
    async disconnect() {}
  }
  app.context.connector = {
    TikTokLiveConnection: TikTokConnection,
    WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow', SHARE: 'share', ROOM_USER: 'viewer', STREAM_END: 'end' },
    ControlEvent: { ERROR: 'error', DISCONNECTED: 'disconnected' }
  };
  app.run(`
    settings.tiktokUsername = 'streamer';
    tiktokModulePromise = Promise.resolve(connector);
  `);
  await app.run('connectTikTok()');
  assert.equal(renderer.elements.get('messages').children.length, 10);
  assert.equal(app.run('historyStore.tiktok.entries.length'), 10);
  for (let i = 0; i < 10; i++) {
    connection.emit('chat', {
      user: { id: '1', uniqueId: 'viewer' }, content: `Live ${i}`,
      common: { msgId: `live${i}`, createTime: 1700000100 + i * 10 }
    });
  }
  // Live messages use arrival time even if their supplied timestamps are spaced.
  assert.equal(renderer.elements.get('messages').children.length, 15);
});

test('history rebuild does not bring back messages that already faded out', () => {
  const renderer = rendererContext();
  renderer.run('state.settings = { maxMessages: 200, fadeSeconds: 30 };');
  const now = Date.now();
  const message = (id, age) => ({ kind: 'message', timestamp: now - age, payload: {
    platform: 'twitch', message_id: id, chatter_user_login: id, message: { text: id }
  } });
  renderer.handlers.onHistory([message('faded', 60000), message('visible', 5000)]);
  const children = renderer.elements.get('messages').children;
  assert.equal(children.length, 1);
  assert.equal(children[0].dataset.messageId, 'visible');
  assert.equal(children[0].dataset.shownAt, String(now - 5000));
});

test('stored TikTok history appears once its live session is confirmed, reconnects do not rebuild it', () => {
  const app = mainContext();
  const channels = [];
  app.context.deliver = channel => channels.push(channel);
  app.run(`send = deliver;
    historyStore.tiktok = { username: 'streamer', roomId: '123456789', startMarker: '', startedAt: null,
      entries: [{ id: 'old', platform: 'tiktok', kind: 'message', timestamp: 1, payload: { message_id: 'old' } }] };`);
  assert.equal(app.run('currentHistoryEntries().length'), 0, 'unconfirmed history is not shown on startup');
  app.run("activateTikTokHistory('streamer', '123456789', {});");
  assert.deepEqual(channels, ['chat:history']);
  assert.equal(app.run('currentHistoryEntries().length'), 1);
  app.run("activateTikTokHistory('streamer', '123456789', {});");
  assert.deepEqual(channels, ['chat:history'], 'a reconnect into the same session does not rebuild the chat');
});

test('history of a stream that was never seen ending expires on startup', () => {
  const app = mainContext();
  const stale = { version: 1, twitch: null, tiktok: { username: 'streamer', roomId: '1', lastUpdated: Date.now() - 13 * 60 * 60 * 1000,
    entries: [{ id: 'old', payload: { message_id: 'old' } }] } };
  app.context.stale = stale;
  app.run('readJson = () => JSON.parse(JSON.stringify(stale)); historyPath = () => "history.json";');
  assert.equal(app.run('loadHistoryStore().tiktok'), null);
  stale.tiktok.lastUpdated = Date.now();
  assert.equal(app.run('loadHistoryStore().tiktok.entries.length'), 1);
});

test('TikTok connections do not replay comments from before the connection', () => {
  let options;
  class TikTokConnection extends EventEmitter {
    constructor(_username, connectionOptions) { super(); options = connectionOptions; }
    async connect() { return { roomId: '123456789' }; }
    async disconnect() {}
  }
  const app = mainContext({ electron: { net: { fetch: async () => ({ ok: true,
    text: async () => '<script id="SIGI_STATE">{"LiveRoom":{"liveRoomUserInfo":{"user":{"uniqueId":"streamer","roomId":"123456789"}}}}</script>'
  }) } } });
  app.context.connector = {
    TikTokLiveConnection: TikTokConnection,
    WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow', SHARE: 'share', ROOM_USER: 'viewer', STREAM_END: 'end' },
    ControlEvent: { ERROR: 'error', DISCONNECTED: 'disconnected' }
  };
  app.run("settings.tiktokUsername = 'streamer'; tiktokModulePromise = Promise.resolve(connector); send = () => {};");
  return app.run('connectTikTok()').then(() => assert.equal(options.processInitialData, false));
});

test('Twitch clear preserves TikTok history and visible messages; local clear removes both', () => {
  const app = mainContext();
  const renderer = rendererContext();
  linkChat(app, renderer);
  app.run(`
    historyStore.twitch = { entries: [] };
    historyStore.tiktok = { entries: [] };
    dispatchChatMessage({ message_id: 't', message: { text: 'Twitch' } }, 'IRC');
    dispatchChatMessage({ message_id: 'k', message: { text: 'TikTok' } }, 'TikTok');
    handleEventSubNotification({ metadata: { subscription_type: 'channel.chat.clear' }, payload: { event: {} } });
  `);
  assert.equal(app.run('historyStore.twitch.entries.length'), 0);
  assert.equal(app.run('historyStore.tiktok.entries.length'), 1);
  assert.equal(renderer.elements.get('messages').children.length, 1);
  assert.equal(renderer.elements.get('messages').children[0].dataset.platform, 'tiktok');
  app.run('clearCurrentHistory()');
  assert.equal(app.run('historyStore.tiktok.entries.length'), 0);
  assert.equal(renderer.elements.get('messages').children.length, 0);
});

for (const moderation of ['channel.chat.message_delete', 'channel.chat.clear_user_messages']) {
  test(`${moderation} preserves TikTok messages with matching identifiers`, () => {
    const app = mainContext();
    const renderer = rendererContext();
    linkChat(app, renderer);
    app.run(`
      historyStore.twitch = { entries: [] };
      historyStore.tiktok = { entries: [] };
      for (const platform of ['twitch', 'tiktok']) {
        const message = { platform, message_id: 'same', chatter_user_id: 'same-user', message: { text: platform } };
        recordHistory(platform, 'message', message);
        send('chat:message', message);
      }
    `);
    app.context.moderation = moderation;
    app.run(`handleEventSubNotification({ metadata: { subscription_type: moderation }, payload: {
      event: { message_id: 'same', target_user_id: 'same-user' }
    } });`);
    assert.equal(app.run('historyStore.twitch.entries.length'), 0);
    assert.equal(app.run('historyStore.tiktok.entries.length'), 1);
    assert.equal(renderer.elements.get('messages').children.length, 1);
    assert.equal(renderer.elements.get('messages').children[0].dataset.platform, 'tiktok');
  });
}

test('Twitch retries transient startup failures with backoff and recovers', async () => {
  const app = mainContext();
  configureTwitch(app);
  app.run("ensureAccessToken = async () => { throw new Error('temporary outage'); };");
  await assert.rejects(app.run('connectTwitchAndReport()'), /temporary outage/);
  const first = app.run('twitchReconnectTimer');
  assert.equal(app.timers.get(first).ms, 3000);
  await app.fire(first);
  const second = app.run('twitchReconnectTimer');
  assert.equal(app.timers.get(second).ms, 6000);
  app.run("ensureAccessToken = async () => 'dummy';");
  await app.fire(second);
  assert.equal(app.sockets.length, 2);
  assert.equal(app.run('twitchReconnectTimer'), null);
  app.sockets[1].emit('message', ':viewer!viewer@host JOIN #viewer\r\n');
  assert.equal(app.run('connectionDiagnostics.irc'), true);
  assert.equal(app.run('twitchReconnectAttempt'), 0);
});

test('logout cancels retries and a stale timer cannot reconnect another session', async () => {
  const app = mainContext();
  configureTwitch(app);
  app.run("ensureAccessToken = async () => { throw new Error('temporary outage'); };");
  await assert.rejects(app.run('connectTwitchAndReport()'));
  const timer = app.run('twitchReconnectTimer');
  const staleCallback = app.timers.get(timer).callback;
  app.run('logout()');
  assert.equal(app.timers.has(timer), false);
  configureTwitch(app);
  staleCallback();
  await tick();
  assert.equal(app.sockets.length, 0);
});

test('expired login does not schedule another Twitch connection', async () => {
  const app = mainContext();
  configureTwitch(app);
  app.run(`ensureAccessToken = async () => {
    requireNewTwitchLogin('expired');
    throw new Error('expired');
  };`);
  await assert.rejects(app.run('connectTwitchAndReport()'), /expired/);
  assert.equal(app.run('twitchReconnectTimer'), null);
  assert.equal(app.run('accessSession'), null);
});

test('IRC retries again if its token refresh fails during a reconnect', async () => {
  const app = mainContext();
  configureTwitch(app);
  await app.run("connectIrc({ id: '1', login: 'viewer' }, twitchGeneration)");
  app.sockets[0].emit('close');
  app.run("ensureAccessToken = async () => { throw new Error('temporary outage'); };");
  await app.fire(app.run('ircReconnectTimer'));
  const retry = app.run('ircReconnectTimer');
  assert.equal(app.timers.get(retry).ms, 6000);
  app.run("ensureAccessToken = async () => 'dummy';");
  await app.fire(retry);
  assert.equal(app.sockets.length, 2);
});

test('HTTP timeout remains active through body consumption and aborts a stalled body', async () => {
  let signal;
  const app = mainContext({ fetch: async (_url, options) => {
    signal = options.signal;
    return { ok: true, status: 200, text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) };
  } });
  const pending = app.run("fetchWithTimeout('https://example.invalid', {}, 1000)");
  const rejected = assert.rejects(pending, /Twitch antwortet seit 1 Sekunden nicht/);
  await tick();
  assert.equal(signal.aborted, false);
  assert.equal(app.timers.size, 1);
  await app.fire([...app.timers.keys()][0]);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(app.timers.size, 0);
});

test('HTTP success caches the body and clears the deadline after reading', async () => {
  let finishBody;
  let bodyReads = 0;
  const app = mainContext({ fetch: async () => ({ ok: true, status: 200, text: () => {
    bodyReads++;
    return new Promise(resolve => { finishBody = resolve; });
  } }) });
  const pending = app.run("fetchWithTimeout('https://example.invalid')");
  await tick();
  assert.equal(app.timers.size, 1);
  finishBody('{"data":[1]}');
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()), '{"data":[1]}');
  assert.equal(await response.text(), '{"data":[1]}');
  assert.equal(bodyReads, 1);
  assert.equal(app.timers.size, 0);
});

test('HTTP body read preserves upstream abort reason and removes its timer', async () => {
  const upstream = new AbortController();
  const app = mainContext({ fetch: async (_url, { signal }) => ({ ok: true, status: 200,
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  }), upstream });
  const pending = app.run("fetchWithTimeout('https://example.invalid', { signal: upstream.signal })");
  const rejected = assert.rejects(pending, /user cancelled/);
  await tick();
  upstream.abort(new Error('user cancelled'));
  await rejected;
  assert.equal(app.timers.size, 0);
});

function followEnvelope(id) {
  return JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.follow', message_id: id },
    payload: { event: { user_id: '2', user_login: 'follower', followed_at: '2026-09-05T10:00:00Z' } } });
}

test('EventSub receives old-socket events through handover and deduplicates delivery IDs', async () => {
  const app = mainContext();
  const notices = [];
  app.context.deliver = (channel, payload) => { if (channel === 'chat:notice') notices.push(payload); };
  app.run('send = deliver;');
  await app.run("connectEventSub('wss://example.invalid/old', false, { id: '1' }, twitchGeneration)");
  const previous = app.sockets[0];
  previous.emit('message', followEnvelope('before'));
  await app.run("connectEventSub('wss://example.invalid/new', true, { id: '1' }, twitchGeneration)");
  previous.emit('message', followEnvelope('during'));
  assert.equal(previous.closed, undefined);
  assert.equal(notices.length, 2);
  const next = app.sockets[1];
  next.emit('message', JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: {} } }));
  assert.equal(previous.closed, true);
  assert.equal(app.run('previousEventSocket'), null);
  next.emit('message', followEnvelope('during'));
  next.emit('message', followEnvelope('after'));
  previous.emit('message', followEnvelope('stale'));
  assert.equal(notices.length, 3);
});

test('EventSub cleanup closes both handover sockets and tolerates late socket errors', async () => {
  const app = mainContext();
  await app.run("connectEventSub('wss://example.invalid/old', false, { id: '1' }, twitchGeneration)");
  await app.run("connectEventSub('wss://example.invalid/new', true, { id: '1' }, twitchGeneration)");
  app.run('closeEventSocket()');
  for (const socket of app.sockets) {
    assert.equal(socket.closed, true);
    assert.doesNotThrow(() => socket.emit('error', new Error('closed during handshake')));
  }
  assert.equal(app.run('previousEventSocket'), null);
  assert.equal(app.run('eventSocket'), null);
});

test('failed EventSub handover closes the old socket and schedules recovery', async () => {
  const app = mainContext();
  await app.run("connectEventSub('wss://example.invalid/old', false, { id: '1' }, twitchGeneration)");
  await app.run("connectEventSub('wss://example.invalid/new', true, { id: '1' }, twitchGeneration)");
  app.sockets[1].emit('close');
  assert.equal(app.sockets[0].closed, true);
  assert.equal(app.run('previousEventSocket'), null);
  await app.fire(app.run('reconnectTimer'));
  assert.equal(app.sockets.length, 3);
});
