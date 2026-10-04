'use strict';

// Browser-source page (OBS "Browser", TikTok LIVE Studio "Link"). It only displays:
// the app pushes caption lines and style changes over server-sent events.
const display = window.captionDisplay.createCaptionDisplay(document.getElementById('captions'), document);

function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

// EventSource reconnects on its own when the app restarts.
const events = new EventSource('events');
events.addEventListener('state', event => display.applyState(parse(event)));
events.addEventListener('interim', event => display.showInterim(parse(event) || {}));
events.addEventListener('line', event => display.showLine(parse(event)));
// A half-finished sentence must not stay on stream while the app is gone.
events.addEventListener('error', () => display.showInterim({}));
