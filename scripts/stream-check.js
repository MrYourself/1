'use strict';

// Summary of what the installed overlay on this PC logged during a stream:
//   node scripts/stream-check.js [minutes]   (default: the last 30 minutes)
// Reads only the overlay's own log and history files; prints no chat text, only counts.
const fs = require('node:fs');
const path = require('node:path');

const minutes = Number(process.argv[2]) || 30;
const since = Date.now() - minutes * 60 * 1000;
const folder = path.join(process.env.APPDATA || '', 'twitch-chat-overlay');

function logLines(name) {
  try {
    return fs.readFileSync(path.join(folder, name), 'utf8').split(/\r?\n/).filter(Boolean)
      .filter(line => Date.parse(line.slice(0, 24)) >= since);
  } catch {
    return null;
  }
}

function section(title, name) {
  const lines = logLines(name);
  console.log(`\n== ${title} (${name}) ==`);
  if (lines === null) return console.log('  Datei fehlt');
  if (!lines.length) return console.log('  keine Einträge im Zeitraum');
  for (const line of lines) console.log(`  ${new Date(line.slice(0, 24)).toLocaleTimeString('de-DE')} ${line.slice(25)}`);
}

console.log(`Overlay-Protokolle der letzten ${minutes} Minuten (${new Date().toLocaleString('de-DE')})`);
section('Twitch', 'twitch-events.log');
section('TikTok', 'tiktok-events.log');
section('Untertitel', 'captions-events.log');

console.log('\n== Gespeicherter Verlauf (current-stream-history.json) ==');
try {
  const history = JSON.parse(fs.readFileSync(path.join(folder, 'current-stream-history.json'), 'utf8'));
  for (const platform of ['twitch', 'tiktok']) {
    const bucket = history[platform];
    if (!bucket) {
      console.log(`  ${platform}: kein laufender Stream gespeichert`);
      continue;
    }
    const recent = bucket.entries.filter(entry => Number(entry.timestamp) >= since);
    const kinds = {};
    for (const entry of recent) {
      const kind = entry.kind === 'notice' ? `notice:${entry.payload?.notice_type || '?'}` : entry.kind;
      kinds[kind] = (kinds[kind] || 0) + 1;
    }
    const last = bucket.entries.at(-1);
    console.log(`  ${platform}: ${recent.length} Einträge im Zeitraum ${JSON.stringify(kinds)}; letzter Eintrag ` +
      `${last ? new Date(last.timestamp).toLocaleTimeString('de-DE') : '–'}`);
  }
} catch (error) {
  console.log(`  nicht lesbar: ${error.message}`);
}
