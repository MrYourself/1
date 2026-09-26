'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  friendlyTikTokError,
  shouldRetryWithoutExtendedGiftInfo,
  tikTokRetryDelay
} = require('../src/tiktok-errors');

test('turns an offline response into a useful German message', () => {
  const error = Object.assign(new Error('User is offline'), { name: 'UserOfflineError' });
  assert.equal(friendlyTikTokError(error, 'Koy_Cat'), '@Koy_Cat wird derzeit nicht als LIVE erkannt.');
});

test('explains signature and timeout failures', () => {
  assert.match(friendlyTikTokError(new Error('Failed to sign request: 404')), /Signaturdienst/);
  assert.match(friendlyTikTokError(new Error('Failed to sign request: 404'), '', null, { apiKeyConfigured: true }), /API-Key gespeichert/);
  assert.match(friendlyTikTokError(new Error('Request timed out')), /automatisch erneut/);
});

test('distinguishes signer limits and rejected stored keys', () => {
  const limited = Object.assign(new Error('Too many connections started'), { name: 'SignatureRateLimitError', retryAfter: 90000 });
  assert.match(friendlyTikTokError(limited, '', null, { apiKeyConfigured: true }), /trotz gespeichertem API-Key/);
  assert.equal(tikTokRetryDelay(limited), 90000);

  const connectorRateLimitBug = new TypeError("Cannot read properties of undefined (reading 'retry-after')");
  assert.match(friendlyTikTokError(connectorRateLimitBug), /Verbindungslimit/);
  assert.equal(tikTokRetryDelay(connectorRateLimitBug), 60000);

  const forbidden = new Error('[Sign Error] Unexpected sign server status 403. Payload: Forbidden');
  assert.match(friendlyTikTokError(forbidden, '', null, { apiKeyConfigured: true }), /wurde abgelehnt oder hat keine Berechtigung/);
  assert.equal(tikTokRetryDelay(forbidden), 300000);
});

test('only a standalone 429 counts as rate limit', () => {
  assert.equal(tikTokRetryDelay(new Error('Request failed with status 429')), 60000);
  const roomError = new Error('Room 7429123456 could not be joined');
  assert.doesNotMatch(friendlyTikTokError(roomError), /Verbindungslimit/);
  assert.equal(tikTokRetryDelay(roomError, 45000), 45000);
});

test('does not mistake an unrelated page fallback error for a rejected Euler key', () => {
  const signature = new Error('[Empty Payload] Failed to sign a request due to missing tokens');
  const pageFallback = new Error('TikTok-LIVE-Seite antwortet mit HTTP 403.');
  assert.match(
    friendlyTikTokError(signature, '', pageFallback, { apiKeyConfigured: true }),
    /keine nutzbare WebSocket-Antwort/
  );
});

test('detects the optional gift-info failure used by the connection fallback', () => {
  assert.equal(shouldRetryWithoutExtendedGiftInfo(new Error('Failed to fetch available gifts (403)')), true);

  const missingTokens = Object.assign(new Error('[Empty Payload] Failed to sign a request due to missing tokens'), {
    name: 'SignatureMissingTokensError'
  });
  assert.equal(shouldRetryWithoutExtendedGiftInfo(missingTokens), true);
  assert.equal(shouldRetryWithoutExtendedGiftInfo(new Error('[Sign Error] Unexpected sign server status 404')), false);
  assert.equal(shouldRetryWithoutExtendedGiftInfo(new Error('Too many connections started (429)')), false);
});

test('explains a composite room-id failure including the direct page fallback', () => {
  const error = Object.assign(new Error('Failed to retrieve Room ID from all sources.'), {
    config: { requestErrs: [new Error('Failed to extract the SIGI_STATE HTML tag')] }
  });
  const directError = new Error('TikTok-LIVE-Seite antwortet mit HTTP 403.');
  assert.match(friendlyTikTokError(error, 'koy_cat_gaming', directError), /HTTP 403/);
});
