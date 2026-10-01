'use strict';

const { normalizeLanguageList, normalizeTargetLanguage } = require('./deepl-translator');

const EXTERNAL_HOSTS = new Set([
  'dev.twitch.tv',
  'eulerstream.com',
  'www.eulerstream.com',
  'www.deepl.com',
  'console.deepgram.com'
]);

function boundedNumber(value, minimum, maximum) {
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeTwitchChannel(value) {
  return String(value || '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 25);
}

function sanitizeStringList(values, maxItems = 200, maxLength = 120) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? '').trim().toLowerCase().slice(0, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeSettingsUpdate(update, normalizeTikTokUsername = value => String(value || '').trim()) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return {};
  const result = {};
  if (typeof update.channel === 'string') result.channel = normalizeTwitchChannel(update.channel);
  if (typeof update.tiktokUsername === 'string') result.tiktokUsername = normalizeTikTokUsername(update.tiktokUsername);
  for (const [key, minimum, maximum] of [
    ['fontSize', 12, 42],
    ['opacity', 0, 100],
    ['fadeSeconds', 0, 180],
    ['maxMessages', 5, 200]
  ]) {
    const value = boundedNumber(update[key], minimum, maximum);
    if (value !== null) result[key] = value;
  }
  for (const key of [
    'showTimestamps', 'hideKnownBots', 'hideCommands', 'compactMode',
    'showTikTokGifts', 'showTikTokSocials', 'streamSafe', 'showStreamStats'
  ]) {
    if (typeof update[key] === 'boolean') result[key] = update[key];
  }
  for (const key of ['hiddenUsers', 'blockedTerms']) {
    if (Array.isArray(update[key])) result[key] = sanitizeStringList(update[key]);
  }
  if (typeof update.translationEnabled === 'boolean') result.translationEnabled = update.translationEnabled;
  if (typeof update.translationTarget === 'string') result.translationTarget = normalizeTargetLanguage(update.translationTarget);
  if (Array.isArray(update.translationSkipLanguages)) {
    result.translationSkipLanguages = normalizeLanguageList(update.translationSkipLanguages);
  }
  for (const key of ['captionsEnabled', 'captionsShowOriginal', 'captionsBox', 'captionsWindowVisible', 'updateBeta']) {
    if (typeof update[key] === 'boolean') result[key] = update[key];
  }
  if (typeof update.captionsTarget === 'string') result.captionsTarget = normalizeTargetLanguage(update.captionsTarget, 'EN-US');
  if (typeof update.captionsTextColor === 'string' && /^#[0-9a-f]{6}$/i.test(update.captionsTextColor)) {
    result.captionsTextColor = update.captionsTextColor.toLowerCase();
  }
  if (update.captionsBackground === 'dark' || update.captionsBackground === 'green') {
    result.captionsBackground = update.captionsBackground;
  }
  for (const [key, minimum, maximum] of [['captionsFontSize', 16, 72], ['captionsGate', 0, 100]]) {
    const value = boundedNumber(update[key], minimum, maximum);
    if (value !== null) result[key] = value;
  }
  // Chromium device IDs are opaque hashes; an empty string means the default microphone.
  if (typeof update.captionsDeviceId === 'string') {
    result.captionsDeviceId = /^[\w\-.=+/:]{0,256}$/.test(update.captionsDeviceId) ? update.captionsDeviceId : '';
  }
  return result;
}

function sanitizeBounds(value, fallback = { width: 520, height: 760 }, minWidth = 360, minHeight = 320) {
  const bounds = {
    width: Math.round(boundedNumber(value?.width, minWidth, 3840) ?? fallback.width),
    height: Math.round(boundedNumber(value?.height, minHeight, 2160) ?? fallback.height)
  };
  const x = boundedNumber(value?.x, -100000, 100000);
  const y = boundedNumber(value?.y, -100000, 100000);
  if (x !== null && y !== null) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }
  return bounds;
}

function reconnectDelay(attempt, base = 3000, maximum = 30000) {
  const safeAttempt = Math.max(0, Math.min(10, Number.isFinite(attempt) ? attempt : 0));
  return Math.min(maximum, base * (2 ** safeAttempt));
}

function isAllowedExternalUrl(value, additionalHosts = []) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return EXTERNAL_HOSTS.has(url.hostname.toLowerCase()) || additionalHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = {
  boundedNumber,
  isAllowedExternalUrl,
  normalizeTwitchChannel,
  reconnectDelay,
  sanitizeBounds,
  sanitizeSettingsUpdate,
  sanitizeStringList
};
