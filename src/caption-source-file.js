'use strict';

const { DEFAULT_PORT } = require('./caption-server');

const PORT_ATTEMPTS = 10;

// A page OBS loads from disk ("Lokale Datei"). A browser source that points straight
// at the caption server stays empty for good when OBS was started before the app,
// because OBS never retries a page that failed to load. This file always loads and
// keeps trying to embed the live caption page until it answers.
// For OBS on another computer, host and key point at the computer running the app.
// Several host names (address and computer name) cover a home network address that
// the router has changed in the meantime.
function captionSourceHtml({ port = DEFAULT_PORT, hosts = ['127.0.0.1'], key = '' } = {}) {
  const targets = [];
  for (const host of hosts) targets.push(`${host}:${port}`);
  // Only this computer moves to the next ports when one is taken.
  if (hosts.length === 1) for (let attempt = 1; attempt < PORT_ATTEMPTS; attempt += 1) targets.push(`${hosts[0]}:${port + attempt}`);
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Stream-Untertitel</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; background: transparent; }
</style>
</head>
<body>
<iframe id="captions" title="Stream-Untertitel"></iframe>
<script>
  // Created by Twitch Chat Overlay. The caption page reports once per second that it
  // is loaded; without that sign of life the frame is loaded again.
  var targets = ${JSON.stringify(targets)};
  var key = ${JSON.stringify(key)};
  var frame = document.getElementById('captions');
  var attempt = 0;
  var aliveAt = 0;
  function load() {
    // The usual address is tried every other time, the alternatives in between.
    var target = attempt % 2 === 0 ? targets[0] : targets[1 + ((attempt - 1) / 2) % (targets.length - 1)];
    attempt += 1;
    frame.src = 'http://' + target + '/captions?' + (key ? 'key=' + key + '&' : '') + 't=' + Date.now();
  }
  window.addEventListener('message', function (event) {
    if (event.source === frame.contentWindow && event.data === 'captions-alive') aliveAt = Date.now();
  });
  setInterval(function () {
    if (Date.now() - aliveAt > 4000) load();
  }, 3000);
  load();
</script>
</body>
</html>
`;
}

module.exports = { captionSourceHtml };
