'use strict';

function firstImageUrl(image) {
  if (typeof image === 'string') return /^https:\/\//i.test(image) ? image : null;
  const values = image?.urlList || image?.url || [];
  if (Array.isArray(values)) return values.find(value => /^https:\/\//i.test(String(value))) || null;
  return /^https:\/\//i.test(String(values || '')) ? String(values) : null;
}

function normalizeTikTokUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?tiktok\.com\/@/i, '')
    .replace(/\/live\/?(?:\?.*)?$/i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim()
    .replace(/[^a-z0-9._]/gi, '')
    .slice(0, 24);
}

function finiteCount(value, fallback, maximum = 1000000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(0, number));
}

function normalizeUser(user = {}) {
  const login = String(user.displayId || user.uniqueId || user.nickname || '').replace(/^@/, '').slice(0, 64);
  return {
    id: String(user.id || user.userId || user.secUid || login).slice(0, 256),
    login,
    name: String(user.nickname || login || 'TikTok-Zuschauer').slice(0, 100),
    avatarUrl: firstImageUrl(user.avatarMedium) || firstImageUrl(user.avatarThumb) || firstImageUrl(user.profilePicture)
  };
}

function messageTimestamp(common = {}) {
  const raw = Number(common.createTime || common.clientSendTime || 0);
  if (!Number.isFinite(raw) || raw <= 0) return Date.now();
  return raw < 100000000000 ? raw * 1000 : raw;
}

function tikTokEmoteFragments(content, emotes = []) {
  const fragments = [{ type: 'text', text: String(content || '') }];
  const seen = new Set();
  for (const item of emotes || []) {
    const emote = item?.emote || item;
    const url = firstImageUrl(emote?.image);
    const id = String(emote?.emoteId || emote?.uuid || url || '');
    if (!url || seen.has(id)) continue;
    seen.add(id);
    fragments.push({ type: 'text', text: ' ' });
    fragments.push({ type: 'gif', text: 'TikTok-Emote', gif: { url } });
  }
  return fragments;
}

function normalizeTikTokChat(data = {}) {
  const user = normalizeUser(data.user || {});
  const text = String(data.content ?? data.comment ?? '').slice(0, 2000);
  const timestamp = messageTimestamp(data.common);
  return {
    platform: 'tiktok',
    message_id: String(data.common?.msgId || data.msgId || `${user.id}:${timestamp}:${text}`),
    timestamp,
    chatter_user_id: user.id,
    chatter_user_login: user.login.toLowerCase(),
    chatter_user_name: user.name,
    profile_image_url: user.avatarUrl,
    color: '#69f3e7',
    badges: [],
    message: {
      text,
      fragments: tikTokEmoteFragments(text, data.emotes)
    }
  };
}

function normalizeTikTokGift(data = {}) {
  const user = normalizeUser(data.user || {});
  const giftDetails = data.giftDetails || {};
  const extendedGiftInfo = data.extendedGiftInfo || {};
  const gift = { ...giftDetails, ...extendedGiftInfo, ...(data.gift || {}) };
  const timestamp = messageTimestamp(data.common);
  const giftId = String(data.giftId || gift.id || gift.giftId || 'gift');
  const repeatCount = Math.max(1, finiteCount(data.repeatCount || data.comboCount || 1, 1));
  const diamondsEach = finiteCount(gift.diamondCount || data.diamondCount || 0, 0);
  const isStreak = Boolean(gift.combo || Number(gift.type ?? gift.giftType) === 1 ||
    Number(data.giftType ?? data.gift_type) === 1);
  const repeatEndValue = data.repeatEnd ?? data.repeat_end;
  const repeatEnd = !isStreak || repeatEndValue === true || Number(repeatEndValue) === 1;
  const groupId = String(data.groupId || data.orderId || data.group_id || data.common?.msgId || timestamp);
  return {
    platform: 'tiktok',
    message_id: String(data.common?.msgId || data.msgId || `${user.id}:${groupId}:${repeatCount}`),
    timestamp,
    gift_key: `tiktok:${user.id}:${giftId}:${groupId}`,
    chatter_user_id: user.id,
    chatter_user_login: user.login.toLowerCase(),
    chatter_user_name: user.name,
    profile_image_url: user.avatarUrl,
    gift: {
      id: giftId,
      name: String(gift.name || gift.giftName || data.giftName || data.gift_name || 'Geschenk').slice(0, 120),
      image_url: firstImageUrl(gift.image) || firstImageUrl(gift.icon) ||
        firstImageUrl(gift.giftPicture) || firstImageUrl(gift.giftPictureUrl) || firstImageUrl(data.giftPicture),
      count: repeatCount,
      diamonds_each: diamondsEach,
      diamonds_total: diamondsEach * repeatCount,
      is_streak: isStreak,
      repeat_end: repeatEnd
    }
  };
}

function normalizeTikTokSocial(data = {}, type) {
  const user = normalizeUser(data.user || {});
  const timestamp = messageTimestamp(data.common);
  const labels = { follow: 'folgt jetzt', share: 'hat den Stream geteilt' };
  return {
    platform: 'tiktok',
    message_id: String(data.common?.msgId || `${type}:${user.id}:${timestamp}`),
    timestamp,
    chatter_user_id: user.id,
    chatter_user_login: user.login.toLowerCase(),
    chatter_user_name: user.name,
    profile_image_url: user.avatarUrl,
    social_type: type,
    text: labels[type] || String(type || 'TikTok-Event')
  };
}

module.exports = {
  firstImageUrl,
  normalizeTikTokUsername,
  normalizeTikTokChat,
  normalizeTikTokGift,
  normalizeTikTokSocial,
  tikTokEmoteFragments
};
