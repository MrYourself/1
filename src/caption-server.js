'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 17873;
const PORT_ATTEMPTS = 10;
const MAX_CLIENTS = 20;
const HEARTBEAT_MS = 15000;
const HOST = '127.0.0.1';

const FILES = {
  '/': ['web/index.html', 'text/html; charset=utf-8'],
  '/captions': ['web/index.html', 'text/html; charset=utf-8'],
  '/overlay.js': ['web/overlay.js', 'text/javascript; charset=utf-8'],
  '/display.js': ['display.js', 'text/javascript; charset=utf-8'],
  '/captions.css': ['captions.css', 'text/css; charset=utf-8']
};

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  // No frame-ancestors rule: the local source file for OBS embeds this page.
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'"
};

// Serves the caption overlay for browser sources. It binds to the loopback address
// only and exposes nothing but the display page and the caption lines themselves.
function createCaptionServer({ root, getState, port = DEFAULT_PORT, onError = () => {}, onClients = () => {} }) {
  const clients = new Set();
  let server = null;
  let heartbeat = null;
  let activePort = null;
  let lastInterim = '';
  let starting = null;
  let wanted = false;

  function allowedHost(request) {
    // Rejects DNS-rebinding attempts: only loopback names may address this server.
    const host = String(request.headers.host || '').toLowerCase();
    return host === `${HOST}:${activePort}` || host === `localhost:${activePort}`;
  }

  function write(client, event, data) {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
  }

  function handleEvents(request, response) {
    if (clients.size >= MAX_CLIENTS) {
      response.writeHead(503, SECURITY_HEADERS).end();
      return;
    }
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive'
    });
    clients.add(response);
    onClients(clients.size);
    write(response, 'state', getState());
    if (lastInterim) write(response, 'interim', { text: lastInterim });
    request.on('close', () => {
      if (clients.delete(response)) onClients(clients.size);
    });
  }

  function handle(request, response) {
    if (!allowedHost(request)) {
      response.writeHead(403, SECURITY_HEADERS).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET' }).end();
      return;
    }
    const pathname = String(request.url || '/').split('?')[0];
    if (pathname === '/events') {
      handleEvents(request, response);
      return;
    }
    const entry = FILES[pathname];
    if (!entry) {
      response.writeHead(404, SECURITY_HEADERS).end();
      return;
    }
    try {
      const body = fs.readFileSync(path.join(root, entry[0]));
      response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': entry[1] }).end(body);
    } catch (error) {
      response.writeHead(500, SECURITY_HEADERS).end();
      onError(error);
    }
  }

  function listen(candidate) {
    return new Promise((resolve, reject) => {
      const instance = http.createServer(handle);
      instance.once('error', reject);
      instance.listen(candidate, HOST, () => {
        instance.removeListener('error', reject);
        instance.on('error', onError);
        resolve(instance);
      });
    });
  }

  // Ports to try, in order. A fixed port keeps the URL in OBS valid across restarts.
  // Windows reserves port ranges on some machines (Hyper-V, WSL, Docker) and then
  // answers EACCES, so those are skipped like occupied ports. A random free port is
  // the last resort: captions work, but the URL changes with every start.
  function candidates() {
    if (port === 0) return [0];
    const list = [];
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) list.push(port + attempt);
    return [...list, 0];
  }

  async function open() {
    let lastError = null;
    for (const candidate of candidates()) {
      try {
        return await listen(candidate);
      } catch (error) {
        lastError = error;
        if (!['EADDRINUSE', 'EACCES'].includes(error?.code)) break;
      }
    }
    throw lastError || new Error('Untertitel-Server konnte nicht gestartet werden.');
  }

  function start() {
    wanted = true;
    if (server) return Promise.resolve(url());
    // Callers may ask again while the server is still starting; they share one attempt.
    if (!starting) {
      starting = open().then(instance => {
        if (!wanted) {
          instance.close();
          return null;
        }
        server = instance;
        activePort = instance.address().port;
        heartbeat = setInterval(() => {
          for (const client of clients) client.write(': keep-alive\n\n');
        }, HEARTBEAT_MS);
        heartbeat.unref?.();
        return url();
      }).finally(() => { starting = null; });
    }
    return starting;
  }

  function stop() {
    wanted = false;
    clearInterval(heartbeat);
    heartbeat = null;
    for (const client of clients) client.end();
    clients.clear();
    onClients(0);
    const closing = server;
    server = null;
    activePort = null;
    lastInterim = '';
    if (!closing) return Promise.resolve();
    closing.closeAllConnections?.();
    return new Promise(resolve => closing.close(() => resolve()));
  }

  function broadcast(event, data) {
    if (event === 'interim') lastInterim = String(data?.text || '');
    if (event === 'line') lastInterim = '';
    for (const client of clients) write(client, event, data);
  }

  function url() {
    return activePort ? `http://${HOST}:${activePort}/captions` : null;
  }

  return {
    start,
    stop,
    broadcast,
    get url() { return url(); },
    get clientCount() { return clients.size; }
  };
}

module.exports = { DEFAULT_PORT, createCaptionServer };
