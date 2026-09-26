'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractTikTokRoomId,
  extractTikTokRoomIdByPattern,
  resolveTikTokRoomId,
  resolveTikTokRoomIdWithBrowser
} = require('../src/tiktok-room');

test('extracts the current SIGI_STATE LiveRoom structure with flexible script attributes', () => {
  const html = `<!doctype html><script nonce="abc" type="application/json"
    id="SIGI_STATE">${JSON.stringify({
      LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'koy_cat_gaming', roomId: '7681363798007073558' } } }
    })}</script>`;
  assert.equal(extractTikTokRoomId(html, 'koy_cat_gaming'), '7681363798007073558');
});

test('does not return a room belonging to a different account', () => {
  const html = `<script id="SIGI_STATE" type="application/json">${JSON.stringify({
    LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'someone_else', roomId: '7681363798007073558' } } }
  })}</script>`;
  assert.equal(extractTikTokRoomId(html, 'koy_cat_gaming'), null);
});

test('extracts room ids from escaped stream data and query parameters', () => {
  const escaped = String.raw`{"uniqueId":"koy_cat_gaming","stream_data":"{\\"room_id\\":7681363798007073558}"}`;
  assert.equal(extractTikTokRoomIdByPattern(escaped, 'koy_cat_gaming'), '7681363798007073558');
  assert.equal(extractTikTokRoomIdByPattern('https://example.test/live?room_id=7681363798007073558'), '7681363798007073558');
});

test('falls back to raw page patterns when TikTok JSON cannot be parsed', () => {
  const html = '<script id="SIGI_STATE" type="application/json">broken JSON with roomId\\\":\\\"7681363798007073558</script>';
  assert.equal(extractTikTokRoomId(html, 'koy_cat_gaming'), '7681363798007073558');
});

test('fetches the public LIVE page with a browser user agent', async () => {
  let request;
  const roomId = await resolveTikTokRoomId('koy_cat_gaming', async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => `<script id="SIGI_STATE" type="application/json">${JSON.stringify({
        LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'koy_cat_gaming', roomId: '7681363798007073558' } } }
      })}</script>`
    };
  });
  assert.equal(roomId, '7681363798007073558');
  assert.equal(request.url, 'https://www.tiktok.com/@koy_cat_gaming/live');
  assert.match(request.options.headers['User-Agent'], /Chrome/);
});

test('uses a hidden protected Chromium window as the final room-id fallback', async () => {
  let helperWindow;
  class FakeBrowserWindow {
    constructor(options) {
      helperWindow = this;
      this.options = options;
      this.destroyed = false;
      this.contentProtected = false;
      this.webContents = {
        setAudioMuted: value => { this.audioMuted = value; },
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        session: {
          setPermissionRequestHandler: handler => { this.permissionRequestHandler = handler; },
          setPermissionCheckHandler: handler => { this.permissionCheckHandler = handler; }
        },
        on: (_event, handler) => { this.navigationHandler = handler; },
        stop: () => { this.stopped = true; },
        executeJavaScript: async () => ({
          sigi: JSON.stringify({
            LiveRoom: { liveRoomUserInfo: { user: { uniqueId: 'koy_cat_gaming', roomId: '7681363798007073558' } } }
          }),
          universal: null,
          html: '',
          resources: [],
          title: 'Koy_Cat ist LIVE',
          url: 'https://www.tiktok.com/@koy_cat_gaming/live'
        })
      };
    }
    setContentProtection(value) { this.contentProtected = value; }
    async loadURL(url, options) { this.loaded = { url, options }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }

  const roomId = await resolveTikTokRoomIdWithBrowser('koy_cat_gaming', FakeBrowserWindow, 1000);
  assert.equal(roomId, '7681363798007073558');
  assert.equal(helperWindow.options.show, false);
  assert.equal(helperWindow.options.webPreferences.sandbox, true);
  assert.equal(helperWindow.contentProtected, true);
  assert.equal(helperWindow.audioMuted, true);
  assert.equal(helperWindow.openHandler().action, 'deny');
  assert.equal(helperWindow.permissionCheckHandler(), false);
  assert.equal(helperWindow.stopped, true);
  assert.equal(helperWindow.destroyed, true);
});
