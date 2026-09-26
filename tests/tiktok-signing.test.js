'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureTikTokSigner } = require('../src/tiktok-signing');

function cachedClient(apiKey = '') {
  return {
    configuration: {
      baseOptions: { headers: apiKey ? { 'X-Api-Key': apiKey } : {} }
    }
  };
}

test('drops a cached keyless signer when an Euler key is added', () => {
  const cachedInstance = cachedClient();
  const connector = { SignConfig: { apiKey: undefined, cachedInstance } };
  assert.deepEqual(configureTikTokSigner(connector, 'new-key'), { configured: true, cacheReset: true });
  assert.equal(connector.SignConfig.apiKey, 'new-key');
  assert.equal(connector.SignConfig.cachedInstance, undefined);
});

test('keeps a signer whose cached key already matches', () => {
  const cachedInstance = cachedClient('same-key');
  const connector = { SignConfig: { apiKey: 'same-key', cachedInstance } };
  assert.deepEqual(configureTikTokSigner(connector, 'same-key'), { configured: true, cacheReset: false });
  assert.equal(connector.SignConfig.cachedInstance, cachedInstance);
});

test('repairs an inconsistent cache even when SignConfig already contains the key', () => {
  const connector = { SignConfig: { apiKey: 'same-key', cachedInstance: cachedClient() } };
  assert.equal(configureTikTokSigner(connector, 'same-key').cacheReset, true);
  assert.equal(connector.SignConfig.cachedInstance, undefined);
});
