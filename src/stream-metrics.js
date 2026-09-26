'use strict';

function normalizeViewerCount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') {
    return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{1,3}(?:[.,\s]\d{3})+$/.test(trimmed)) value = trimmed.replace(/[.,\s]/g, '');
    else if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number));
}

function tiktokViewerCount(data = {}) {
  const payloads = [data, data?.data, data?.roomUser, data?.room_user].filter(Boolean);
  for (const payload of payloads) {
    for (const key of ['viewerCount', 'viewer_count', 'total', 'totalUser', 'total_user', 'userCount', 'memberCount']) {
      const value = normalizeViewerCount(payload?.[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function normalizeTimestamp(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  let timestamp;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    timestamp = Number(value);
    if (timestamp > 0 && timestamp < 100000000000) timestamp *= 1000;
  } else {
    timestamp = Date.parse(String(value));
  }
  const earliest = Date.UTC(2000, 0, 1);
  if (!Number.isFinite(timestamp) || timestamp < earliest || timestamp > now + 24 * 60 * 60 * 1000) return null;
  return Math.floor(timestamp);
}

function isoTimestamp(value, now = Date.now()) {
  const timestamp = normalizeTimestamp(value, now);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

module.exports = { isoTimestamp, normalizeTimestamp, normalizeViewerCount, tiktokViewerCount };
