'use strict';

function errorText(error) {
  return String(error?.message || error || 'Unbekannter Fehler').trim();
}

function nestedErrorText(error, additionalError) {
  const parts = [];
  const pending = [error, additionalError];
  const seen = new Set();
  while (pending.length) {
    const value = pending.shift();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parts.push(`${value?.name || ''} ${errorText(value)}`);
    if (value?.cause) pending.push(value.cause);
    if (Array.isArray(value?.config?.requestErrs)) pending.push(...value.config.requestErrs);
  }
  return parts.join(' ').toLowerCase();
}

function isRateLimitError(searchable) {
  return searchable.includes('signatureratelimiterror') || searchable.includes('rate limited') ||
    // Match 429 as a standalone status so room IDs or other numbers do not count as rate limits.
    searchable.includes('rate limit') || /(?<!\d)429(?!\d)/.test(searchable) || searchable.includes('too many connections') ||
    searchable.includes("reading 'retry-after'") || searchable.includes('reading "retry-after"');
}

function friendlyTikTokError(error, username = '', additionalError = null, options = {}) {
  const raw = errorText(error);
  const searchable = nestedErrorText(error);
  const combined = nestedErrorText(error, additionalError);
  const account = username ? `@${username}` : 'Der TikTok-Account';
  const apiKeyConfigured = Boolean(options.apiKeyConfigured);

  if (searchable.includes('useroffline') || searchable.includes('offline') || searchable.includes('not live')) {
    return `${account} wird derzeit nicht als LIVE erkannt.`;
  }
  if (searchable.includes('available gifts') && searchable.includes('403')) {
    return 'TikTok verweigert den Abruf der Geschenkdetails (403). Der Chat wird ohne erweiterte Geschenkinfos erneut versucht.';
  }
  if (searchable.includes('failed to retrieve room id from all sources')) {
    // The usual reason is simply that nobody is live: TikTok then serves a page without a room.
    if (additionalError) {
      const detail = errorText(additionalError);
      // Both page lookups worked but found no room; a blocked or slow page keeps its detail.
      if (/keine passende room-id/i.test(detail) && !/HTTP \d{3}|nicht rechtzeitig/i.test(detail)) {
        return `${account} wird derzeit nicht als LIVE erkannt (TikTok nennt keinen laufenden Stream). Die App versucht es weiter.`;
      }
      return `TikTok-Room-ID konnte nicht gelesen werden: ${detail}`;
    }
    if (combined.includes('lack of permission')) {
      return 'TikTok liefert keine Room-ID, und der gespeicherte Euler-Key hat keine Berechtigung für den Room-ID-Fallback.';
    }
    return 'TikTok-Room-ID konnte weder aus der LIVE-Seite noch über die verfügbaren Fallbacks gelesen werden.';
  }
  if (isRateLimitError(searchable)) {
    return apiKeyConfigured
      ? 'Das Euler-Verbindungslimit ist trotz gespeichertem API-Key erreicht. Bitte Key und Tarif im Euler-Dashboard prüfen; die App versucht es später erneut.'
      : 'Das kostenlose TikTok-Verbindungslimit ist erreicht. Bitte später erneut versuchen oder einen Euler-API-Key eintragen.';
  }
  if (searchable.includes('premiumfeatureerror') || searchable.includes('premium feature') ||
      searchable.includes('unexpected sign server status 401') || searchable.includes('unexpected sign server status 402') ||
      searchable.includes('unexpected sign server status 403') || searchable.includes('invalid api key') ||
      searchable.includes('unauthorized') || searchable.includes('forbidden')) {
    return apiKeyConfigured
      ? 'Der gespeicherte Euler-API-Key wurde abgelehnt oder hat keine Berechtigung für TikTok-WebSocket-Verbindungen. Bitte Key und Tarif im Euler-Dashboard prüfen.'
      : 'Der TikTok-Signaturdienst verlangt für diese Verbindung einen berechtigten Euler-API-Key.';
  }
  if (searchable.includes('timeout') || searchable.includes('timed out') || searchable.includes('aborted')) {
    return 'TikTok antwortet nicht rechtzeitig. Die Verbindung wird automatisch erneut versucht.';
  }
  if (searchable.includes('connect error') || searchable.includes('failed to connect to sign server') ||
      searchable.includes('econnrefused') || searchable.includes('enotfound') || searchable.includes('network')) {
    return 'Der TikTok-Signaturdienst ist derzeit nicht erreichbar. Die Verbindung wird automatisch erneut versucht.';
  }
  if (searchable.includes('signature') || searchable.includes('failed to sign') || searchable.includes('sign error')) {
    return apiKeyConfigured
      ? 'TikTok-Signatur fehlgeschlagen, obwohl ein Euler-API-Key gespeichert ist. Der Dienst hat keine nutzbare WebSocket-Antwort geliefert; bitte Key und Tarif prüfen.'
      : 'Der TikTok-Signaturdienst konnte die Verbindung nicht signieren. Ein berechtigter Euler-API-Key kann erforderlich sein.';
  }
  return `TikTok-Verbindung fehlgeschlagen: ${raw}`;
}

function tikTokRetryDelay(error, fallback = 30000) {
  const searchable = nestedErrorText(error);
  const retryAfter = Number(error?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(10 * 60 * 1000, Math.max(5000, retryAfter));
  if (isRateLimitError(searchable)) return 60000;
  if (searchable.includes('premium feature') || searchable.includes('unexpected sign server status 401') ||
      searchable.includes('unexpected sign server status 402') || searchable.includes('unexpected sign server status 403') ||
      searchable.includes('invalid api key') || searchable.includes('unauthorized') || searchable.includes('forbidden')) return 5 * 60 * 1000;
  return fallback;
}

function shouldRetryWithoutExtendedGiftInfo(error) {
  const searchable = nestedErrorText(error);
  if (isRateLimitError(searchable)) return false;

  // In connector 2.4.x the optional gift-list request runs before the WebSocket.
  // Its signing errors do not mention gifts, while the WebSocket route does not
  // throw SignatureMissingTokensError. Treat these as a failed optional preflight
  // and retry the actual chat connection without the extra gift catalogue.
  return searchable.includes('signaturemissingtokenserror') ||
    (searchable.includes('empty payload') && searchable.includes('failed to sign')) ||
    searchable.includes('fetchroomgiftsroute') || searchable.includes('failed to fetch room gifts') ||
    searchable.includes('failed to fetch available gifts') || searchable.includes('available gifts') ||
    searchable.includes('permission from the signature provider to sign this url');
}

module.exports = { friendlyTikTokError, nestedErrorText, shouldRetryWithoutExtendedGiftInfo, tikTokRetryDelay };
