'use strict';

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2';
const DEEPL_PRO_URL = 'https://api.deepl.com/v2';
const TARGET_LANGUAGES = Object.freeze(['DE', 'EN-US', 'EN-GB', 'ES', 'FR', 'IT', 'NL', 'PL', 'PT-BR', 'TR']);
// Source languages DeepL accepts; anything else is left to DeepL's own detection.
const SOURCE_LANGUAGES = new Set(['AR', 'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'ES', 'ET', 'FI', 'FR', 'HU', 'ID', 'IT',
  'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'RO', 'RU', 'SK', 'SL', 'SV', 'TR', 'UK', 'ZH']);
const MIN_LETTERS = 4;
const MIN_WORDS = 2;
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_SIZE = 500;

// Short, distinctive function words. They let obvious English or German messages
// skip the API entirely, which saves most of the free monthly character quota.
const STOPWORDS = {
  EN: new Set(['the', 'and', 'you', 'is', 'are', 'this', 'that', 'what', 'with', 'for', 'have', 'just', 'not', "it's",
    'im', "i'm", "don't", 'dont', 'can', 'your', 'but', 'how', 'why', 'be', 'do', 'it', 'of', 'to', 'my', 'me', 'we',
    'they', 'he', 'she', 'will', 'would', 'there', 'good', 'like', 'get', 'know', 'love', 'when', 'where', 'who',
    'all', 'if', 'on', 'at', 'from', 'been', 'has', 'had', "you're", 'thanks', 'please', 'yes', 'nice', 'play']),
  DE: new Set(['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'ein', 'eine', 'mit', 'auf', 'für', 'zu',
    'den', 'dem', 'sie', 'es', 'wie', 'was', 'auch', 'noch', 'aber', 'bin', 'bist', 'hast', 'habe', 'mal', 'schon',
    'jetzt', 'hier', 'wir', 'ihr', 'mein', 'dein', 'kann', 'doch', 'nur', 'oder', 'sehr', 'gut', 'danke', 'bitte',
    'heute', 'warum', 'weil', 'dass', 'wenn', 'geil', 'ja', 'nein', 'spiel'])
};

function normalizeTargetLanguage(value, fallback = 'DE') {
  const code = String(value || '').trim().toUpperCase();
  return TARGET_LANGUAGES.includes(code) ? code : fallback;
}

function normalizeLanguageList(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  for (const value of values) {
    const code = String(value ?? '').trim().toUpperCase().slice(0, 2);
    if (/^[A-Z]{2}$/.test(code) && !result.includes(code)) result.push(code);
    if (result.length >= 20) break;
  }
  return result;
}

function baseLanguage(code) {
  return String(code || '').toUpperCase().split('-')[0];
}

function deeplBaseUrl(apiKey) {
  return /:fx$/i.test(String(apiKey || '').trim()) ? DEEPL_FREE_URL : DEEPL_PRO_URL;
}

function escapeXml(text) {
  return String(text).replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

function unescapeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

// Chat stretches words ("sooooo", "aniimoooo"). Unknown stretched words make DeepL
// guess both language and meaning, so runs of three or more letters shrink to two.
function collapseElongation(text) {
  return String(text).replace(/(\p{L})\1{2,}/gu, '$1$1');
}

// Emotes, cheermotes, mentions and links are wrapped in DeepL ignore tags so that
// names such as "Kappa" or "@streamer" survive the translation unchanged.
function translationSource(message) {
  const fragments = Array.isArray(message?.fragments) && message.fragments.length
    ? message.fragments
    : [{ type: 'text', text: message?.text || '' }];
  let xml = '';
  let plain = '';
  for (const fragment of fragments) {
    const text = String(fragment?.text || '');
    if (!text) continue;
    if (fragment.type && fragment.type !== 'text') {
      xml += `<x>${escapeXml(text)}</x>`;
      continue;
    }
    let cursor = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      const before = collapseElongation(text.slice(cursor, match.index));
      xml += escapeXml(before);
      plain += before;
      xml += `<x>${escapeXml(match[0])}</x>`;
      cursor = match.index + match[0].length;
    }
    const rest = collapseElongation(text.slice(cursor));
    xml += escapeXml(rest);
    plain += rest;
  }
  return { xml: xml.trim(), plain: plain.trim() };
}

function translatedText(xml) {
  return unescapeXml(String(xml || '').replace(/<x>([\s\S]*?)<\/x>/g, '$1')).trim();
}

function likelyLanguage(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}']+/gu) || [];
  const hits = {};
  for (const [language, stopwords] of Object.entries(STOPWORDS)) {
    hits[language] = words.filter(word => stopwords.has(word)).length;
  }
  const [best, second] = Object.entries(hits).sort((left, right) => right[1] - left[1]);
  if (!best || best[1] < 2 || best[1] < (second?.[1] || 0) * 2) return null;
  return best[0];
}

function shouldTranslate(source, skipLanguages = []) {
  const letters = (source.plain.match(/\p{L}/gu) || []).length;
  if (letters < MIN_LETTERS || source.plain.startsWith('!')) return false;
  // A single word is usually a name, an emote word or an exclamation; DeepL then
  // guesses a language and invents a meaning ("aniimoooo" → "I'm so happy").
  const words = source.plain.split(/\s+/).filter(word => /\p{L}/u.test(word));
  if (words.length < MIN_WORDS) return false;
  const likely = likelyLanguage(source.plain);
  return !(likely && skipLanguages.includes(likely));
}

function createDeepLTranslator({
  fetchImpl,
  getApiKey,
  getOptions,
  onStatus = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const cache = new Map();
  let queue = [];
  let flushTimer = null;
  let blockedUntil = 0;
  let disabledReason = null;

  function status(state, message = null) {
    onStatus({ state, message });
  }

  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  }

  async function request(path, init) {
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey) throw new Error('Kein DeepL-API-Key gespeichert.');
    const controller = new AbortController();
    const timeout = setTimer(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${deeplBaseUrl(apiKey)}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {})
        }
      });
      const body = await response.text();
      return { status: response.status, ok: response.ok, body };
    } finally {
      clearTimer(timeout);
    }
  }

  function handleFailure(statusCode) {
    if (statusCode === 403) {
      disabledReason = 'DeepL hat den API-Key abgelehnt. Bitte den Key prüfen.';
      status('error', disabledReason);
    } else if (statusCode === 456) {
      disabledReason = 'Das DeepL-Zeichenkontingent ist aufgebraucht. Die Übersetzung pausiert bis zum nächsten Abrechnungszeitraum.';
      status('error', disabledReason);
    } else if (statusCode === 429) {
      blockedUntil = now() + 10000;
      status('limited', 'DeepL drosselt gerade die Anfragen. Übersetzungen werden kurz ausgesetzt.');
    } else {
      blockedUntil = now() + 5000;
      status('limited', `DeepL antwortet mit HTTP ${statusCode}. Übersetzungen werden kurz ausgesetzt.`);
    }
  }

  async function flush() {
    clearTimer(flushTimer);
    flushTimer = null;
    const batch = queue.splice(0, BATCH_SIZE);
    if (queue.length) flushTimer = setTimer(flush, 0);
    if (!batch.length) return;
    const target = batch[0].target;
    try {
      const response = await request('/translate', {
        method: 'POST',
        body: JSON.stringify({
          text: batch.map(item => item.xml),
          target_lang: target,
          tag_handling: 'xml',
          ignore_tags: ['x']
        })
      });
      if (!response.ok) {
        handleFailure(response.status);
        for (const item of batch) item.resolve(null);
        return;
      }
      const translations = JSON.parse(response.body)?.translations || [];
      status('ok');
      batch.forEach((item, index) => {
        const translation = translations[index];
        const source = String(translation?.detected_source_language || '').toUpperCase();
        const text = translatedText(translation?.text);
        const skipped = !text || item.skip.includes(baseLanguage(source)) ||
          text.toLowerCase() === translatedText(item.xml).toLowerCase();
        // DeepL's detection is unreliable for short chat lines ("ti amo" → Guarani).
        // The translation is usually still right, so keep it but only show a
        // language label for well-established languages.
        const label = SOURCE_LANGUAGES.has(baseLanguage(source)) ? source : '';
        const result = skipped ? null : { text: text.slice(0, 2000), source: label, target };
        cacheSet(item.cacheKey, result);
        item.resolve(result);
      });
    } catch (error) {
      blockedUntil = now() + 5000;
      status('limited', `DeepL ist nicht erreichbar: ${error?.message || error}`);
      for (const item of batch) item.resolve(null);
    }
  }

  function translate(message) {
    if (disabledReason || now() < blockedUntil || !getApiKey()) return Promise.resolve(null);
    const options = getOptions() || {};
    const target = normalizeTargetLanguage(options.target);
    // The target language itself never needs a translation.
    const skip = [...new Set([...normalizeLanguageList(options.skipLanguages), baseLanguage(target)])];
    const source = translationSource(message);
    if (!shouldTranslate(source, skip)) return Promise.resolve(null);
    const cacheKey = `${target}\n${skip.join(',')}\n${source.xml.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = queue.find(item => item.cacheKey === cacheKey);
    if (pending) return pending.promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    // A batch must share one target language; a changed target starts a new batch.
    if (queue.length && queue[0].target !== target) flush();
    queue.push({ xml: source.xml, target, skip, cacheKey, resolve, promise });
    if (queue.length >= BATCH_SIZE) flush();
    else if (!flushTimer) flushTimer = setTimer(flush, BATCH_DELAY_MS);
    return promise;
  }

  // Direct translation for spoken captions: the source language is already known
  // from speech recognition, and latency matters more than batching.
  async function translateText(text, { source, target } = {}) {
    if (disabledReason || now() < blockedUntil || !getApiKey()) return null;
    const clean = String(text || '').trim().slice(0, 2000);
    if (!clean) return null;
    const targetCode = normalizeTargetLanguage(target, 'EN-US');
    const sourceCode = String(source || '').trim().toUpperCase();
    const sourceLanguage = SOURCE_LANGUAGES.has(sourceCode) ? sourceCode : null;
    const cacheKey = `text\n${sourceLanguage}\n${targetCode}\n${clean.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const response = await request('/translate', {
        method: 'POST',
        body: JSON.stringify({
          text: [clean],
          target_lang: targetCode,
          ...(sourceLanguage ? { source_lang: sourceLanguage } : {})
        })
      });
      if (!response.ok) {
        handleFailure(response.status);
        return null;
      }
      const result = String(JSON.parse(response.body)?.translations?.[0]?.text || '').trim() || null;
      status('ok');
      cacheSet(cacheKey, result);
      return result;
    } catch (error) {
      blockedUntil = now() + 5000;
      status('limited', `DeepL ist nicht erreichbar: ${error?.message || error}`);
      return null;
    }
  }

  async function usage() {
    const response = await request('/usage', { method: 'GET' });
    if (!response.ok) {
      if (response.status === 403) throw new Error('DeepL hat den API-Key abgelehnt.');
      throw new Error(`DeepL-Kontingent konnte nicht abgerufen werden (HTTP ${response.status}).`);
    }
    const body = JSON.parse(response.body);
    return {
      used: Number(body.character_count) || 0,
      limit: Number(body.character_limit) || 0
    };
  }

  function reset() {
    cache.clear();
    blockedUntil = 0;
    disabledReason = null;
    status('idle');
  }

  return { translate, translateText, usage, reset };
}

module.exports = {
  TARGET_LANGUAGES,
  collapseElongation,
  createDeepLTranslator,
  deeplBaseUrl,
  likelyLanguage,
  normalizeLanguageList,
  normalizeTargetLanguage,
  shouldTranslate,
  translatedText,
  translationSource
};
