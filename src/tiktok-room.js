'use strict';

const ROOM_ID_PATTERN = /^\d{8,30}$/;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const TIKTOK_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function validRoomId(value) {
  const roomId = String(value || '').trim();
  return ROOM_ID_PATTERN.test(roomId) ? roomId : null;
}

function scriptJson(html, id) {
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<script\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>([\\s\\S]*?)<\\/script\\s*>`,
    'i'
  );
  const match = String(html || '').match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseJsonText(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function matchingUserRoomId(payload, username) {
  if (!payload || typeof payload !== 'object') return null;
  const wanted = String(username || '').toLowerCase();
  const pending = [payload];
  const seen = new Set();
  let inspected = 0;
  let cursor = 0;

  while (cursor < pending.length && inspected < 20000) {
    const value = pending[cursor++];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    inspected += 1;

    const uniqueId = String(value.uniqueId || value.unique_id || '').replace(/^@/, '').toLowerCase();
    const roomId = validRoomId(value.roomId || value.room_id || value.roomID);
    if (roomId && uniqueId === wanted) return roomId;

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return null;
}

function extractTikTokRoomIdByPattern(value, username = '') {
  const text = String(value || '');
  const wanted = String(username || '').toLowerCase();
  const pattern = /(?:roomId|room_id|room%5Fid)(?:(?:\\u0022)|\\{0,4}["']|&quot;|&#34;|%22|%3A|%3D|[:=,\s]){1,16}(\d{8,30})/gi;
  const candidates = new Map();
  let match;
  while ((match = pattern.exec(text))) {
    const roomId = validRoomId(match[1]);
    if (!roomId) continue;
    const nearby = text.slice(Math.max(0, match.index - 5000), match.index + 2000).toLowerCase();
    const existing = candidates.get(roomId) || { roomId, score: 0, count: 0, firstIndex: match.index };
    existing.count += 1;
    existing.score += 1;
    if (wanted && nearby.includes(wanted)) existing.score += 30;
    if (nearby.includes('liveroom')) existing.score += 10;
    if (/roomId/i.test(match[0].slice(0, 10))) existing.score += 5;
    candidates.set(roomId, existing);
  }
  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || right.count - left.count || left.firstIndex - right.firstIndex)[0]?.roomId || null;
}

function extractTikTokRoomId(html, username) {
  const sigiState = scriptJson(html, 'SIGI_STATE');
  const sigiUniqueId = String(sigiState?.LiveRoom?.liveRoomUserInfo?.user?.uniqueId || '').replace(/^@/, '').toLowerCase();
  const wanted = String(username || '').toLowerCase();
  if (sigiUniqueId && wanted && sigiUniqueId !== wanted) return null;
  const structuredRoomId = extractTikTokRoomIdFromScripts(
    sigiState,
    scriptJson(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__'),
    username
  );
  return structuredRoomId || extractTikTokRoomIdByPattern(html, username);
}

function extractTikTokRoomIdFromScripts(sigiState, universalData, username) {
  const sigiUser = sigiState?.LiveRoom?.liveRoomUserInfo?.user;
  const sigiRoomId = validRoomId(sigiUser?.roomId || sigiUser?.room_id || sigiUser?.roomID);
  const sigiUniqueId = String(sigiUser?.uniqueId || '').replace(/^@/, '').toLowerCase();
  if (sigiRoomId && (!username || sigiUniqueId === String(username).toLowerCase())) return sigiRoomId;

  return matchingUserRoomId(sigiState, username) || matchingUserRoomId(universalData, username);
}

async function resolveTikTokRoomId(username, fetchImpl, timeoutMs = 15000) {
  if (typeof fetchImpl !== 'function') throw new TypeError('TikTok-Seitenabruf ist nicht verfügbar.');
  const safeUsername = String(username || '').replace(/^@/, '').trim();
  if (!safeUsername) throw new TypeError('TikTok-Benutzername fehlt.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://www.tiktok.com/@${encodeURIComponent(safeUsername)}/live`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent': TIKTOK_BROWSER_UA
      }
    });
    if (!response.ok) throw new Error(`TikTok-LIVE-Seite antwortet mit HTTP ${response.status}.`);
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_PAGE_BYTES) throw new Error('TikTok-LIVE-Seite ist unerwartet groß.');
    const roomId = extractTikTokRoomId(html, safeUsername);
    if (!roomId) throw new Error('TikTok-LIVE-Seite enthält keine passende Room-ID.');
    return roomId;
  } finally {
    clearTimeout(timeout);
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function resolveTikTokRoomIdWithBrowser(username, BrowserWindowClass, timeoutMs = 25000) {
  if (typeof BrowserWindowClass !== 'function') throw new TypeError('Chromium-Fenster ist nicht verfügbar.');
  const safeUsername = String(username || '').replace(/^@/, '').trim();
  if (!safeUsername) throw new TypeError('TikTok-Benutzername fehlt.');

  const helperWindow = new BrowserWindowClass({
    show: false,
    skipTaskbar: true,
    width: 800,
    height: 600,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'tiktok-room-resolver'
    }
  });
  helperWindow.setContentProtection?.(true);
  helperWindow.webContents.setAudioMuted(true);
  helperWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  helperWindow.webContents.session?.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));
  helperWindow.webContents.session?.setPermissionCheckHandler?.(() => false);
  const preventForeignNavigation = (event, url) => {
    try {
      if (new URL(url).hostname !== 'www.tiktok.com') event.preventDefault();
    } catch {
      event.preventDefault();
    }
  };
  helperWindow.webContents.on?.('will-navigate', preventForeignNavigation);
  helperWindow.webContents.on?.('will-redirect', preventForeignNavigation);

  let timeout;
  try {
    const target = `https://www.tiktok.com/@${encodeURIComponent(safeUsername)}/live`;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Versteckter TikTok-Browser hat nicht rechtzeitig geantwortet.')), timeoutMs);
    });
    await Promise.race([
      helperWindow.loadURL(target, {
        userAgent: TIKTOK_BROWSER_UA,
        extraHeaders: 'Accept-Language: de-DE,de;q=0.9,en;q=0.7\r\n'
      }),
      timeoutPromise
    ]);

    let lastPage = null;
    for (const delay of [0, 500, 1000, 2000]) {
      if (delay) await wait(delay);
      lastPage = await helperWindow.webContents.executeJavaScript(`(() => ({
        sigi: document.getElementById('SIGI_STATE')?.textContent || null,
        universal: document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || null,
        html: document.documentElement?.innerHTML?.slice(0, 6 * 1024 * 1024) || '',
        resources: typeof performance === 'object' && performance.getEntriesByType
          ? performance.getEntriesByType('resource').slice(0, 1500).map(entry => entry.name)
          : [],
        title: document.title,
        url: location.href
      }))()`, true);
      const roomId = extractTikTokRoomIdFromScripts(
        parseJsonText(lastPage?.sigi),
        parseJsonText(lastPage?.universal),
        safeUsername
      ) || extractTikTokRoomIdByPattern(lastPage?.html, safeUsername)
        || extractTikTokRoomIdByPattern((lastPage?.resources || []).join('\n'), safeUsername);
      if (roomId) return roomId;
    }

    const pageTitle = String(lastPage?.title || 'unbekannte Seite').replace(/[\r\n]+/g, ' ').slice(0, 120);
    const pageDetails = `HTML ${String(lastPage?.html || '').length}, SIGI ${String(lastPage?.sigi || '').length}, Ressourcen ${(lastPage?.resources || []).length}`;
    throw new Error(`Versteckte TikTok-Seite enthält keine passende Room-ID (${pageTitle}; ${pageDetails}).`);
  } finally {
    clearTimeout(timeout);
    helperWindow.webContents.stop?.();
    if (!helperWindow.isDestroyed()) helperWindow.destroy();
  }
}

module.exports = {
  extractTikTokRoomId,
  extractTikTokRoomIdByPattern,
  extractTikTokRoomIdFromScripts,
  resolveTikTokRoomId,
  resolveTikTokRoomIdWithBrowser,
  scriptJson,
  validRoomId
};
