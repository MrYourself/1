'use strict';

function toTwitchFollowNotice(event = {}) {
  const login = String(event.user_login || '').trim();
  const name = String(event.user_name || login || 'Jemand').trim();
  const followedAt = Date.parse(event.followed_at || '');
  const timestamp = Number.isFinite(followedAt) ? followedAt : Date.now();
  const text = 'folgt jetzt dem Kanal!';
  return {
    platform: 'twitch',
    timestamp,
    message_id: `follow:${event.user_id || login || name}:${event.followed_at || timestamp}`,
    notice_type: 'follow',
    system_message: `${name} ${text}`,
    chatter_user_id: String(event.user_id || login || name),
    chatter_user_login: login.toLowerCase(),
    chatter_user_name: name,
    color: '#63e6a7',
    badges: [],
    message: { text, fragments: [{ type: 'text', text }] }
  };
}

module.exports = { toTwitchFollowNotice };
