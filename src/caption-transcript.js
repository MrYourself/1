'use strict';

const { comparable, likelyLanguage } = require('./deepl-translator');

function baseLanguage(code) {
  return String(code || '').toLowerCase().split('-')[0];
}

function parseDeepgramMessage(message) {
  if (message?.type !== 'Results') return null;
  const alternative = message.channel?.alternatives?.[0];
  if (!alternative) return null;
  const fallback = baseLanguage(alternative.languages?.[0]);
  const rawWords = Array.isArray(alternative.words) ? alternative.words : [];
  let words = rawWords
    .map(word => ({
      text: String(word?.punctuated_word || word?.word || '').trim(),
      language: baseLanguage(word?.language) || fallback
    }))
    .filter(word => word.text);
  if (!words.length && String(alternative.transcript || '').trim()) {
    words = [{ text: String(alternative.transcript).trim(), language: fallback }];
  }
  return { isFinal: message.is_final === true, words };
}

function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function mergeAdjacent(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.language === run.language) last.text += ` ${run.text}`;
    else merged.push({ ...run });
  }
  return merged;
}

// Groups words into runs of one language. Single words that the recognizer tags
// differently ("okay", "nice", names) join their neighbours, so a German sentence
// with one English word is translated as a whole instead of in fragments.
function languageRuns(words) {
  const runs = mergeAdjacent((words || []).map(word => ({ language: word.language || '', text: word.text })));
  if (runs.length < 2) return runs;
  const smoothed = [];
  runs.forEach((run, index) => {
    if (wordCount(run.text) > 1) {
      smoothed.push(run);
      return;
    }
    const previous = smoothed.at(-1);
    const next = runs[index + 1];
    if (previous) previous.text += ` ${run.text}`;
    else if (next) next.text = `${run.text} ${next.text}`;
    else smoothed.push(run);
  });
  return mergeAdjacent(smoothed);
}

// The recognizer sometimes tags speech in the target language as another one
// (English labelled German). DeepL would then "translate" English into reworded
// English, so text that reads like the target language is left as spoken.
function needsTranslation(language, target, text = '') {
  const source = baseLanguage(language);
  if (!source || source === baseLanguage(target)) return false;
  return baseLanguage(likelyLanguage(text)) !== baseLanguage(target);
}

// Interim results are shown immediately. Text that still needs a translation is
// replaced by a typing indicator so viewers never read half-recognized German.
function interimText(words, target, { onlyTranslated = false } = {}) {
  if (!words?.length) return '';
  const text = words.map(word => word.text).join(' ');
  if (onlyTranslated) {
    const runs = languageRuns(words);
    return runs.every(run => needsTranslation(run.language, target, run.text)) ? '…' : '';
  }
  if (words.some(word => needsTranslation(word.language, target, text))) return '…';
  return text;
}

// With `onlyTranslated` the caption is a pure translator: a line appears only when
// all of it was foreign and could be translated. Speech in the target language and
// sentences that mix both languages produce no caption at all.
async function buildCaption(words, { target, translate, onlyTranslated = false }) {
  const runs = languageRuns(words);
  const built = await Promise.all(runs.map(async run => {
    if (!needsTranslation(run.language, target, run.text)) return { text: run.text, original: run.text, translated: false };
    let translated = null;
    try {
      translated = await translate(run.text, run.language.toUpperCase());
    } catch {}
    // Same words back, only tidied: the run was already in the target language.
    if (translated && comparable(translated) === comparable(run.text)) translated = null;
    return { text: translated || run.text, original: run.text, translated: Boolean(translated) };
  }));
  const parts = onlyTranslated && !built.every(part => part.translated) ? [] : built;
  return {
    text: parts.map(part => part.text).join(' ').trim(),
    original: parts.map(part => part.original).join(' ').trim(),
    translated: parts.some(part => part.translated),
    languages: [...new Set(runs.map(run => run.language).filter(Boolean))]
  };
}

module.exports = { buildCaption, interimText, languageRuns, needsTranslation, parseDeepgramMessage };
