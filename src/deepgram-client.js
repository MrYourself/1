'use strict';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
const SAMPLE_RATE = 16000;
const KEEPALIVE_MS = 4000;
const MAX_PENDING_CHUNKS = 20;
const MAX_CHUNK_BYTES = 64 * 1024;
const OPEN = 1;

function deepgramUrl(sampleRate = SAMPLE_RATE) {
  const params = new URLSearchParams({
    model: 'nova-3',
    // "multi" recognizes English and German even when they are mixed in one sentence.
    language: 'multi',
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '100'
  });
  return `${DEEPGRAM_URL}?${params}`;
}

function fatalErrorText(message) {
  const status = Number(/Unexpected server response: (\d+)/.exec(String(message || ''))?.[1]);
  if (status === 401 || status === 403) return 'Deepgram hat den API-Key abgelehnt. Bitte den Key prüfen.';
  if (status === 402) return 'Das Deepgram-Guthaben ist aufgebraucht.';
  return null;
}

function createDeepgramStream({
  WebSocketImpl,
  getApiKey,
  onMessage,
  onStatus = () => {},
  reconnectDelay,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval
}) {
  let socket = null;
  let wanted = false;
  let attempt = 0;
  let generation = 0;
  let retryTimer = null;
  let keepaliveTimer = null;
  let lastSentAt = 0;
  let fatal = null;
  let pending = [];

  function status(state, message = null) {
    onStatus({ state, message });
  }

  function isOpen() {
    return socket?.readyState === OPEN;
  }

  function sendJson(value) {
    if (!isOpen()) return;
    try {
      socket.send(JSON.stringify(value));
      lastSentAt = now();
    } catch {}
  }

  function connect() {
    clearTimer(retryTimer);
    retryTimer = null;
    if (!wanted) return;
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey) {
      status('error', 'Kein Deepgram-API-Key gespeichert.');
      return;
    }
    const current = ++generation;
    fatal = null;
    status('connecting');
    const ws = new WebSocketImpl(deepgramUrl(), {
      headers: { Authorization: `Token ${apiKey}` },
      handshakeTimeout: 15000
    });
    socket = ws;

    ws.on('open', () => {
      if (current !== generation) return;
      attempt = 0;
      lastSentAt = now();
      status('live');
      for (const chunk of pending.splice(0)) ws.send(chunk);
    });
    ws.on('message', data => {
      if (current !== generation) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      onMessage(message);
    });
    ws.on('error', error => {
      if (current !== generation) return;
      fatal = fatalErrorText(error?.message) || fatal;
    });
    ws.on('close', () => {
      if (current !== generation) return;
      socket = null;
      if (!wanted) return;
      if (fatal) {
        status('error', fatal);
        return;
      }
      status('reconnecting', 'Deepgram-Verbindung unterbrochen, neuer Versuch folgt.');
      retryTimer = setTimer(connect, reconnectDelay(attempt++));
    });
  }

  function start() {
    if (wanted) return;
    wanted = true;
    attempt = 0;
    connect();
    // Deepgram closes idle streams after about 10 seconds; the speech gate in the
    // capture window sends no audio during silence, so keep the stream alive here.
    keepaliveTimer = setRepeat(() => {
      if (isOpen() && now() - lastSentAt >= KEEPALIVE_MS) sendJson({ type: 'KeepAlive' });
    }, 1000);
  }

  function stop() {
    wanted = false;
    ++generation;
    clearTimer(retryTimer);
    clearRepeat(keepaliveTimer);
    retryTimer = null;
    keepaliveTimer = null;
    pending = [];
    const closing = socket;
    socket = null;
    if (closing) {
      try { if (closing.readyState === OPEN) closing.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
      closing.removeAllListeners?.();
      closing.on?.('error', () => {});
      try { closing.close(); } catch {}
    }
    status('off');
  }

  function restart() {
    stop();
    start();
  }

  function sendAudio(chunk) {
    if (!wanted || !chunk || chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES) return;
    if (isOpen()) {
      socket.send(chunk);
      lastSentAt = now();
    } else if (socket) {
      pending.push(chunk);
      if (pending.length > MAX_PENDING_CHUNKS) pending.shift();
    }
  }

  // Flushes the current utterance so its final transcript arrives without waiting
  // for more audio.
  function finalize() {
    sendJson({ type: 'Finalize' });
  }

  return {
    start,
    stop,
    restart,
    sendAudio,
    finalize,
    get active() { return wanted; }
  };
}

module.exports = { SAMPLE_RATE, createDeepgramStream, deepgramUrl, fatalErrorText };
