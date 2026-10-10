'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createCaptionServer } = require('../src/caption-server');
const { createCaptionDisplay } = require('../src/captions/display');
const { sanitizeSettingsUpdate } = require('../src/app-utils');

const root = path.join(__dirname, '..', 'src', 'captions');

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({ host: target.hostname, port: target.port, path: target.pathname, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function withServer(run) {
  const server = createCaptionServer({ root, port: 0, getState: () => ({ fontSize: 30, textColor: '#ffcc00', box: false }) });
  const url = await server.start();
  try {
    await run(server, url);
  } finally {
    await server.stop();
  }
}

test('serves the browser-source page and its assets on the loopback address only', async () => {
  await withServer(async (server, url) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/captions$/);
    const page = await get(url);
    assert.equal(page.status, 200);
    assert.match(page.body, /class="browser-source boxed"/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    const origin = new URL(url).origin;
    for (const asset of ['/overlay.js', '/display.js', '/captions.css']) {
      assert.equal((await get(origin + asset)).status, 200, asset);
    }
    assert.equal((await get(`${origin}/../main.js`)).status, 404);
    assert.equal((await get(`${origin}/captions.js`)).status, 404, 'the microphone script is never served');
  });
});

test('rejects requests that address the server under a foreign host name', async () => {
  await withServer(async (server, url) => {
    assert.equal((await get(url, { Host: 'evil.example:80' })).status, 403);
    const port = new URL(url).port;
    assert.equal((await get(url, { Host: `localhost:${port}` })).status, 200);
  });
});

test('pushes the current style on connect and caption lines as they happen', async () => {
  await withServer(async (server, url) => {
    const chunks = [];
    const origin = new URL(url);
    const request = http.get({ host: origin.hostname, port: origin.port, path: '/events' });
    const response = await new Promise((resolve, reject) => {
      request.on('response', resolve);
      request.on('error', reject);
    });
    assert.match(response.headers['content-type'], /text\/event-stream/);
    response.setEncoding('utf8');
    const received = pattern => new Promise(resolve => {
      const check = () => { if (pattern.test(chunks.join(''))) resolve(); };
      response.on('data', chunk => { chunks.push(chunk); check(); });
      check();
    });
    await received(/event: state\ndata: \{"fontSize":30,"textColor":"#ffcc00","box":false\}/);
    assert.equal(server.clientCount, 1);
    server.broadcast('line', { text: 'Hello chat', translated: false });
    await received(/event: line\ndata: \{"text":"Hello chat","translated":false\}/);
    request.destroy();
  });
});

test('concurrent starts share one server instead of opening a second one', async () => {
  const server = createCaptionServer({ root, port: 0, getState: () => ({}) });
  try {
    const [first, second] = await Promise.all([server.start(), server.start()]);
    assert.equal(first, second);
    assert.equal((await get(first)).status, 200);
  } finally {
    await server.stop();
  }
});

test('moves to the next port when the preferred one is taken', async () => {
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const taken = blocker.address().port;
  const server = createCaptionServer({ root, port: taken, getState: () => ({}) });
  try {
    const url = await server.start();
    assert.notEqual(Number(new URL(url).port), taken);
    assert.equal((await get(url)).status, 200);
  } finally {
    await server.stop();
    await new Promise(resolve => blocker.close(resolve));
  }
});

test('a stop during startup leaves no server behind', async () => {
  const server = createCaptionServer({ root, port: 0, getState: () => ({}) });
  const starting = server.start();
  await server.stop();
  assert.equal(await starting, null);
  assert.equal(server.url, null);
});

test('reports how many sources are connected', async () => {
  const counts = [];
  const server = createCaptionServer({ root, port: 0, getState: () => ({}), onClients: count => counts.push(count) });
  const url = new URL(await server.start());
  try {
    const request = http.get({ host: url.hostname, port: url.port, path: '/events' });
    await new Promise((resolve, reject) => { request.on('response', resolve); request.on('error', reject); });
    assert.deepEqual(counts, [1]);
    request.destroy();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(counts, [1, 0]);
  } finally {
    await server.stop();
  }
});

function fakeDocument() {
  function element() {
    const classes = new Set();
    return {
      children: [], className: '', textContent: '',
      classList: {
        add: name => classes.add(name),
        toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
        contains: name => classes.has(name)
      },
      append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
      querySelectorAll(selector) {
        if (selector === '.caption-line:not(.interim)') return this.children.filter(child => child.className === 'caption-line');
        return [];
      }
    };
  }
  const properties = {};
  return {
    documentElement: { style: { setProperty: (name, value) => { properties[name] = value; } } },
    body: element(),
    createElement: element,
    createTextNode: text => ({ text }),
    properties
  };
}

test('caption display applies color and box, keeps two lines and replaces interim text', () => {
  const doc = fakeDocument();
  const container = doc.createElement('main');
  const display = createCaptionDisplay(container, doc, { set: () => {} });
  display.applyState({ fontSize: 44, textColor: '#FFCC00', box: false });
  assert.equal(doc.properties['--caption-size'], '44px');
  assert.equal(doc.properties['--caption-text'], '#FFCC00');
  assert.equal(doc.body.classList.contains('boxed'), false);
  display.applyState({ textColor: 'red; background:url(x)' });
  assert.equal(doc.properties['--caption-text'], '#ffffff', 'invalid colors fall back to white');

  display.showInterim({ text: 'hel' });
  assert.equal(container.children.length, 1);
  display.showLine({ text: 'one' });
  display.showLine({ text: 'two' });
  display.showLine({ text: 'three' });
  assert.deepEqual(container.children.map(child => child.children[0].text), ['two', 'three']);
});

test('sanitizes the new caption appearance settings', () => {
  assert.deepEqual(sanitizeSettingsUpdate({
    captionsTextColor: '#FFCC00',
    captionsBox: false,
    captionsWindowVisible: 'no'
  }), { captionsBox: false, captionsTextColor: '#ffcc00' });
  assert.deepEqual(sanitizeSettingsUpdate({ captionsTextColor: 'red' }), {});
});

test('the local source file embeds the caption page and retries the usual and the fallback ports', () => {
  const { captionSourceHtml } = require('../src/caption-source-file');
  const html = captionSourceHtml();
  assert.match(html, /var ports = \[17873,17874,17875,17876,17877,17878,17879,17880,17881,17882\];/);
  assert.match(html, /'http:\/\/127\.0\.0\.1:' \+ port \+ '\/captions/);
  assert.match(html, /captions-alive/);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/, 'nothing but the local caption server is contacted');
});

test('the caption page may be embedded and reports that it is alive', async () => {
  await withServer(async (server, url) => {
    const page = await get(`${url}?t=123`);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.headers['content-security-policy'], /frame-ancestors/);
    const script = (await get(`${new URL(url).origin}/overlay.js`)).body;
    assert.match(script, /postMessage\('captions-alive'/);
    assert.match(script, /setTimeout\(connect, RETRY_MS\)/);
  });
});
