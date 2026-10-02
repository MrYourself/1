'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collapseElongation,
  comparable,
  createDeepLTranslator,
  deeplBaseUrl,
  likelyLanguage,
  normalizeLanguageList,
  normalizeTargetLanguage,
  translatedText,
  translationSource
} = require('../src/deepl-translator');

function fakeTranslator({ responses = [], options = { target: 'DE', skipLanguages: ['EN'] }, apiKey = 'key:fx' } = {}) {
  const requests = [];
  const statuses = [];
  const timers = [];
  let clock = 1000;
  const translator = createDeepLTranslator({
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      const next = responses.shift() || { status: 200, body: { translations: [] } };
      return { ok: next.status < 400, status: next.status, text: async () => JSON.stringify(next.body || {}) };
    },
    getApiKey: () => apiKey,
    getOptions: () => options,
    onStatus: status => statuses.push(status),
    now: () => clock,
    setTimer: callback => { timers.push(callback); return callback; },
    clearTimer: callback => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); }
  });
  async function flush() {
    // Run the batch timer (the request timeout timer is cleared by the request itself).
    const pending = timers.splice(0);
    for (const callback of pending) await callback();
    await new Promise(resolve => setImmediate(resolve));
  }
  return { translator, requests, statuses, flush, advance: ms => { clock += ms; } };
}

const message = text => ({ text, fragments: [{ type: 'text', text }] });

test('chooses the free or pro endpoint from the key suffix', () => {
  assert.equal(deeplBaseUrl('abc:fx'), 'https://api-free.deepl.com/v2');
  assert.equal(deeplBaseUrl('abc'), 'https://api.deepl.com/v2');
});

test('normalizes language settings', () => {
  assert.equal(normalizeTargetLanguage('en-us'), 'EN-US');
  assert.equal(normalizeTargetLanguage('xx'), 'DE');
  assert.deepEqual(normalizeLanguageList([' en ', 'EN', 'de', 'x', 42]), ['EN', 'DE']);
});

test('protects emotes, mentions and links from translation', () => {
  const source = translationSource({ text: '', fragments: [
    { type: 'mention', text: '@streamer' },
    { type: 'text', text: ' mira <esto> https://example.com/a?b=1 ' },
    { type: 'emote', text: 'Kappa' }
  ] });
  assert.equal(source.xml, '<x>@streamer</x> mira &lt;esto&gt; <x>https://example.com/a?b=1</x> <x>Kappa</x>');
  assert.equal(source.plain, 'mira <esto>');
  assert.equal(translatedText('<x>@streamer</x> schau &lt;das&gt; <x>Kappa</x>'), '@streamer schau <das> Kappa');
});

test('recognizes obvious English and German without an API call', () => {
  assert.equal(likelyLanguage('what is the name of this game'), 'EN');
  assert.equal(likelyLanguage('was ist das für ein spiel'), 'DE');
  assert.equal(likelyLanguage('qué juego es este'), null);
});

test('batches messages, skips the target and ignored languages and caches results', async () => {
  const { translator, requests, flush } = fakeTranslator({ responses: [{ status: 200, body: { translations: [
    { detected_source_language: 'ES', text: 'Was ist das für ein Spiel?' },
    { detected_source_language: 'EN', text: 'Guter Zug' }
  ] } }] });
  // Obvious English is skipped locally and short messages are never sent.
  assert.equal(await translator.translate(message('what is the name of this game')), null);
  assert.equal(await translator.translate(message('gg')), null);
  const spanish = translator.translate(message('¿Qué juego es este?'));
  const english = translator.translate(message('Nice move mate'));
  await flush();
  assert.deepEqual(await spanish, { text: 'Was ist das für ein Spiel?', source: 'ES', target: 'DE' });
  assert.equal(await english, null, 'English was detected by DeepL and is in the skip list');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(requests[0].init.headers.Authorization, 'DeepL-Auth-Key key:fx');
  assert.deepEqual(requests[0].body.text, ['¿Qué juego es este?', 'Nice move mate']);
  assert.equal(requests[0].body.target_lang, 'DE');
  assert.equal(requests[0].body.tag_handling, 'xml');
  assert.deepEqual(await translator.translate(message('¿Qué juego es este?')), await spanish);
  assert.equal(requests.length, 1, 'repeated text is served from the cache');
});

test('skips single stretched words like game names instead of letting DeepL guess', async () => {
  const { translator, requests, flush } = fakeTranslator();
  assert.equal(await translator.translate(message('aniimooooo')), null);
  await flush();
  assert.equal(requests.length, 0);
  assert.equal(collapseElongation('I am sooooo happy, aniimooooo!'), 'I am soo happy, aniimoo!');
});

test('recognizes stretched chat English locally instead of asking DeepL', async () => {
  const { translator, requests, flush } = fakeTranslator({ options: { target: 'EN-US', skipLanguages: [] } });
  const source = translationSource(message("hellooo I'm backkkkk[wow]"));
  assert.equal(source.xml, "helloo I'm backk<x>[wow]</x>");
  assert.equal(likelyLanguage(source.plain), 'EN');
  assert.equal(await translator.translate(message("hellooo I'm backkkkk[wow]")), null);
  await flush();
  assert.equal(requests.length, 0);
  assert.equal(likelyLanguage('me gusta mucho tu stream'), null, 'Spanish is not mistaken for English');
});

test('drops a translation that only tidies the spelling of the original', async () => {
  const { translator, flush } = fakeTranslator({
    options: { target: 'EN-US', skipLanguages: [] },
    responses: [{ status: 200, body: { translations: [{ detected_source_language: 'NL', text: 'Omg, sweet kitty!' }] } }]
  });
  const pending = translator.translate(message('omggg sweeet kittyyy'));
  await flush();
  assert.equal(await pending, null);
  assert.equal(comparable('helloo <x>[wow]</x> I&apos;m backk'), comparable("Hello, I'm back!"));
  assert.equal(comparable('Grr flames'), comparable('Grr, flames'));
});

test('keeps a correct translation even when DeepL names an unlikely language', async () => {
  const { translator, requests, flush } = fakeTranslator({
    options: { target: 'EN-US', skipLanguages: [] },
    responses: [{ status: 200, body: { translations: [{ detected_source_language: 'GN', text: 'I love you' }] } }]
  });
  const pending = translator.translate(message('ti amo'));
  await flush();
  assert.deepEqual(await pending, { text: 'I love you', source: '', target: 'EN-US' });
  assert.deepEqual(requests[0].body.text, ['ti amo']);
});

test('pauses after quota exhaustion until the key is reset', async () => {
  const { translator, requests, statuses, flush } = fakeTranslator({ responses: [
    { status: 456 },
    { status: 200, body: { translations: [{ detected_source_language: 'FR', text: 'Hallo zusammen' }] } }
  ] });
  const first = translator.translate(message('Bonjour tout le monde'));
  await flush();
  assert.equal(await first, null);
  assert.match(statuses.at(-1).message, /Zeichenkontingent/);
  assert.equal(await translator.translate(message('Salut les amis')), null);
  assert.equal(requests.length, 1);
  translator.reset();
  const retry = translator.translate(message('Bonjour tout le monde'));
  await flush();
  assert.equal((await retry).text, 'Hallo zusammen');
});

test('backs off briefly after rate limiting', async () => {
  const { translator, requests, flush, advance } = fakeTranslator({ responses: [{ status: 429 }] });
  const first = translator.translate(message('Bonjour tout le monde'));
  await flush();
  assert.equal(await first, null);
  assert.equal(await translator.translate(message('Salut les amis')), null);
  assert.equal(requests.length, 1);
  advance(10001);
  translator.translate(message('Salut les amis'));
  await flush();
  assert.equal(requests.length, 2);
});
