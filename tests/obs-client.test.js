'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { authentication, isCaptionSource, refreshCaptionSources } = require('../src/obs-client');

// A small stand-in for the OBS WebSocket server (protocol 5).
function fakeObs({ password = 'geheim', inputs }) {
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  const pressed = [];
  const auth = { salt: 'c2FsdA==', challenge: 'Y2hhbGxlbmdl' };
  server.on('connection', socket => {
    socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: auth } }));
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.op === 1) {
        if (message.d.authentication !== authentication(password, auth)) socket.close(4009, 'Authentication failed');
        else socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        return;
      }
      const { requestType, requestId, requestData } = message.d;
      let responseData = {};
      if (requestType === 'GetInputList') responseData = { inputs: inputs.map(input => ({ inputName: input.name, inputKind: 'browser_source' })) };
      if (requestType === 'GetInputSettings') responseData = { inputSettings: inputs.find(input => input.name === requestData.inputName).settings };
      if (requestType === 'PressInputPropertiesButton') pressed.push([requestData.inputName, requestData.propertyName]);
      socket.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } }));
    });
  });
  return new Promise(resolve => server.on('listening', () => resolve({ server, pressed, port: server.address().port })));
}

const inputs = [
  { name: 'Untertitel', settings: { is_local_file: true, local_file: 'C:/Users/Koy/AppData/Roaming/twitch-chat-overlay/Untertitel-Quelle.html' } },
  { name: 'Untertitel Adresse', settings: { url: 'http://192.168.178.23:17873/captions?key=abc' } },
  { name: 'Alerts', settings: { url: 'https://streamlabs.com/alert-box/v3/123' } }
];

test('refreshes only the caption browser sources in OBS', async t => {
  const obs = await fakeObs({ inputs });
  t.after(() => obs.server.close());
  const refreshed = await refreshCaptionSources({ WebSocketImpl: WebSocket, port: obs.port, password: 'geheim' });
  assert.deepEqual(refreshed, ['Untertitel', 'Untertitel Adresse']);
  assert.deepEqual(obs.pressed, [['Untertitel', 'refreshnocache'], ['Untertitel Adresse', 'refreshnocache']]);
});

test('reports a wrong OBS password in plain words', async t => {
  const obs = await fakeObs({ inputs });
  t.after(() => obs.server.close());
  await assert.rejects(refreshCaptionSources({ WebSocketImpl: WebSocket, port: obs.port, password: 'falsch' }), /Passwort stimmt nicht/);
  await assert.rejects(refreshCaptionSources({ WebSocketImpl: WebSocket, port: obs.port, password: '' }), /verlangt ein Passwort/);
  assert.deepEqual(obs.pressed, []);
});

test('reports an OBS that does not run', async () => {
  await assert.rejects(refreshCaptionSources({ WebSocketImpl: WebSocket, port: 1, timeoutMs: 2000 }), /nicht erreichbar|antwortet nicht/);
});

test('recognizes caption sources by file name or caption address', () => {
  assert.equal(isCaptionSource({ local_file: 'D:/OBS/Untertitel-Quelle.html' }), true);
  assert.equal(isCaptionSource({ url: 'http://127.0.0.1:17874/captions' }), true);
  assert.equal(isCaptionSource({ url: 'https://example.com/captions' }), false);
  assert.equal(isCaptionSource({}), false);
});
