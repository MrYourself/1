'use strict';

// Browser-source page (OBS "Browser", TikTok LIVE Studio "Link"). It only displays:
// the app pushes caption lines and style changes over server-sent events.
const RETRY_MS = 2000;
const display = window.captionDisplay.createCaptionDisplay(document.getElementById('captions'), document);

function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

// EventSource is meant to reconnect on its own, but the browser built into OBS does
// not do so reliably after the app was restarted. Every failure therefore closes the
// stream and opens a new one until the app answers again.
function connect() {
  const events = new EventSource('events');
  events.addEventListener('state', event => display.applyState(parse(event)));
  events.addEventListener('interim', event => display.showInterim(parse(event) || {}));
  events.addEventListener('line', event => display.showLine(parse(event)));
  events.addEventListener('error', () => {
    // A half-finished sentence must not stay on stream while the app is gone.
    display.showInterim({});
    events.close();
    setTimeout(connect, RETRY_MS);
  });
}

connect();

// Sign of life for the local source file that embeds this page (see caption-source-file.js).
if (window.parent !== window) {
  setInterval(() => window.parent.postMessage('captions-alive', '*'), 1000);
}
