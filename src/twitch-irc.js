'use strict';

function unescapeTag(value = '') {
  return value.replace(/\\([sn:r\\])/g, (_match, code) => ({
    s: ' ',
    n: '\n',
    r: '\r',
    ':': ';',
    '\\': '\\'
  })[code] ?? code);
}

function parseTags(raw = '') {
  const tags = {};
  for (const entry of raw.split(';')) {
    if (!entry) continue;
    const separator = entry.indexOf('=');
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const value = separator === -1 ? '' : entry.slice(separator + 1);
    tags[key] = unescapeTag(value);
  }
  return tags;
}

function parseIrcLine(line) {
  let rest = String(line || '').trimEnd();
  if (!rest) return null;
  let tags = {};
  let prefix = '';
  let trailing = '';

  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    tags = parseTags(rest.slice(1, end));
    rest = rest.slice(end + 1);
  }
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const trailingIndex = rest.indexOf(' :');
  if (trailingIndex !== -1) {
    trailing = rest.slice(trailingIndex + 2);
    rest = rest.slice(0, trailingIndex);
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  return { tags, prefix, command: parts.shift() || '', params: parts, trailing };
}

function buildFragments(text, emotesTag = '') {
  const characters = Array.from(String(text || ''));
  const ranges = [];
  for (const group of String(emotesTag).split('/')) {
    if (!group) continue;
    const separator = group.indexOf(':');
    if (separator === -1) continue;
    const id = group.slice(0, separator);
    for (const range of group.slice(separator + 1).split(',')) {
      const [start, end] = range.split('-').map(Number);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start) {
        ranges.push({ id, start, end });
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ranges.length) return [{ type: 'text', text: characters.join('') }];

  const fragments = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.start >= characters.length) continue;
    if (range.start > cursor) fragments.push({ type: 'text', text: characters.slice(cursor, range.start).join('') });
    const emoteText = characters.slice(range.start, Math.min(characters.length, range.end + 1)).join('');
    fragments.push({
      type: 'emote',
      text: emoteText,
      emote: { id: range.id, format: ['static'] }
    });
    cursor = range.end + 1;
  }
  if (cursor < characters.length) fragments.push({ type: 'text', text: characters.slice(cursor).join('') });
  return fragments.length ? fragments : [{ type: 'text', text: characters.join('') }];
}

function parseBadges(value, badgeMap = {}) {
  if (!value) return [];
  return value.split(',').map(entry => {
    const separator = entry.indexOf('/');
    const setId = separator === -1 ? entry : entry.slice(0, separator);
    const id = separator === -1 ? '' : entry.slice(separator + 1);
    return { set_id: setId, id, info: '', url: badgeMap[setId]?.[id] || null };
  }).filter(badge => badge.set_id);
}

function toChatEvent(parsed, badgeMap = {}) {
  if (!parsed || parsed.command !== 'PRIVMSG') return null;
  const tags = parsed.tags || {};
  const login = parsed.prefix.split('!')[0] || tags.login || '';
  let text = parsed.trailing || '';
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
    text = text.slice(8, -1);
  }
  const bits = Number.parseInt(tags.bits || '', 10);
  return {
    broadcaster_user_login: String(parsed.params[0] || '').replace(/^#/, ''),
    chatter_user_id: tags['user-id'] || '',
    chatter_user_login: login.toLowerCase(),
    chatter_user_name: tags['display-name'] || login,
    color: tags.color || '#bf94ff',
    badges: parseBadges(tags.badges, badgeMap),
    message_id: tags.id || '',
    timestamp: Number.isFinite(Number(tags['tmi-sent-ts'])) ? Number(tags['tmi-sent-ts']) : Date.now(),
    message_type: tags['message-type'] || 'text',
    cheer: Number.isFinite(bits) && bits > 0 ? { bits } : null,
    message: {
      text,
      fragments: buildFragments(text, tags.emotes)
    }
  };
}

module.exports = { parseIrcLine, toChatEvent, buildFragments, parseBadges };
