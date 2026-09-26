'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeTikTokUsername,
  normalizeTikTokChat,
  normalizeTikTokGift
} = require('../src/tiktok-normalizer');

test('normalizes TikTok names and live URLs', () => {
  assert.equal(normalizeTikTokUsername('@Koy_Cat'), 'Koy_Cat');
  assert.equal(normalizeTikTokUsername('https://www.tiktok.com/@Koy_Cat/live'), 'Koy_Cat');
  assert.equal(normalizeTikTokUsername('@Koy Cat!'), 'KoyCat');
});

test('keeps malformed gift counters finite', () => {
  const event = normalizeTikTokGift({
    user: { id: '55', displayId: 'viewer' },
    repeatCount: 'not-a-number',
    gift: { diamondCount: 'not-a-number' }
  });
  assert.equal(event.gift.count, 1);
  assert.equal(event.gift.diamonds_each, 0);
  assert.equal(event.gift.diamonds_total, 0);
});

test('maps a TikTok comment to the shared chat format', () => {
  const event = normalizeTikTokChat({
    common: { msgId: 'tt-1', createTime: '1700000000000' },
    user: {
      id: '55', displayId: 'viewer', nickname: 'Viewer',
      avatarThumb: { urlList: ['https://example.test/avatar.png'] }
    },
    content: 'Hallo zusammen'
  });
  assert.equal(event.platform, 'tiktok');
  assert.equal(event.message_id, 'tt-1');
  assert.equal(event.chatter_user_login, 'viewer');
  assert.equal(event.message.text, 'Hallo zusammen');
  assert.equal(event.profile_image_url, 'https://example.test/avatar.png');
});

test('aggregates a TikTok gift streak and diamond count', () => {
  const event = normalizeTikTokGift({
    common: { msgId: 'gift-message', createTime: '1700000000000' },
    groupId: 'combo-9',
    repeatCount: 15,
    repeatEnd: 1,
    user: { id: '55', displayId: 'viewer', nickname: 'Viewer' },
    giftId: '5655',
    gift: {
      id: '5655', name: 'Rose', type: 1, combo: true, diamondCount: 1,
      image: { urlList: ['https://example.test/rose.png'] }
    }
  });
  assert.equal(event.gift_key, 'tiktok:55:5655:combo-9');
  assert.equal(event.gift.count, 15);
  assert.equal(event.gift.diamonds_total, 15);
  assert.equal(event.gift.repeat_end, true);
});

test('keeps basic gift event details when the optional gift catalogue is unavailable', () => {
  const event = normalizeTikTokGift({
    user: { id: '77', displayId: 'supporter' },
    giftId: '99',
    repeatCount: 2,
    giftDetails: {
      giftName: 'TikTok Universe',
      giftType: 1,
      diamondCount: 34999,
      giftPictureUrl: 'https://example.test/universe.png'
    }
  });
  assert.equal(event.gift.name, 'TikTok Universe');
  assert.equal(event.gift.diamonds_total, 69998);
  assert.equal(event.gift.is_streak, true);
  assert.equal(event.gift.image_url, 'https://example.test/universe.png');
});
