'use strict';

const crypto = require('node:crypto');

const TIMEOUT_MS = 10000;

// The caption browser sources: the local source file or an address of the caption server.
function isCaptionSource(settings = {}) {
  const target = `${settings.local_file || ''} ${settings.url || ''}`.toLowerCase();
  return target.includes('untertitel-quelle') || /:\d{5}\/captions\b/.test(target);
}

function authentication(password, { salt, challenge }) {
  const hash = text => crypto.createHash('sha256').update(text).digest('base64');
  return hash(hash(String(password) + salt) + challenge);
}

// Talks to the WebSocket server built into OBS (version 28 and later, protocol 5) and
// presses "Refresh cache of current page" on every caption browser source. A source
// whose browser died (game or GPU driver crash) or that loaded before the app was
// running only comes back this way.
function refreshCaptionSources({ WebSocketImpl, host = '127.0.0.1', port = 4455, password = '', timeoutMs = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(`ws://${host}:${port}`, { handshakeTimeout: timeoutMs });
    const pending = new Map();
    let nextId = 0;
    let done = false;

    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('OBS antwortet nicht.')), timeoutMs);

    const request = (requestType, requestData = {}) => new Promise((done, fail) => {
      const requestId = String(++nextId);
      pending.set(requestId, { done, fail });
      socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });

    async function refreshAll() {
      const { inputs = [] } = await request('GetInputList', { inputKind: 'browser_source' });
      const refreshed = [];
      for (const input of inputs) {
        const { inputSettings } = await request('GetInputSettings', { inputName: input.inputName });
        if (!isCaptionSource(inputSettings)) continue;
        await request('PressInputPropertiesButton', { inputName: input.inputName, propertyName: 'refreshnocache' });
        refreshed.push(input.inputName);
      }
      return refreshed;
    }

    socket.on('error', error => finish(new Error(`OBS nicht erreichbar: ${error?.message || error}`)));
    socket.on('close', code => {
      if (code === 4009) finish(new Error('Das OBS-Passwort stimmt nicht.'));
      else finish(new Error('OBS hat die Verbindung beendet.'));
    });
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.op === 0) {
        const auth = message.d?.authentication;
        if (auth && !password) {
          finish(new Error('OBS verlangt ein Passwort.'));
          return;
        }
        socket.send(JSON.stringify({
          op: 1,
          d: { rpcVersion: 1, eventSubscriptions: 0, ...(auth ? { authentication: authentication(password, auth) } : {}) }
        }));
      } else if (message.op === 2) {
        refreshAll().then(names => finish(null, names), error => finish(error));
      } else if (message.op === 7) {
        const entry = pending.get(message.d?.requestId);
        if (!entry) return;
        pending.delete(message.d.requestId);
        const status = message.d.requestStatus || {};
        if (status.result) entry.done(message.d.responseData || {});
        else entry.fail(new Error(`OBS lehnt ${message.d.requestType} ab: ${status.comment || status.code}`));
      }
    });
  });
}

module.exports = { authentication, isCaptionSource, refreshCaptionSources };
