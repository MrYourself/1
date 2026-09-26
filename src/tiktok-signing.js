'use strict';

function cachedApiKey(signConfig) {
  return String(signConfig?.cachedInstance?.configuration?.baseOptions?.headers?.['X-Api-Key'] || '').trim();
}

function configureTikTokSigner(connector, value) {
  const apiKey = String(value || '').trim();
  const signConfig = connector?.SignConfig;
  if (!signConfig) return { configured: Boolean(apiKey), cacheReset: false };

  const configuredKey = String(signConfig.apiKey || '').trim();
  const cachedKey = cachedApiKey(signConfig);
  const cacheMatches = !signConfig.cachedInstance || cachedKey === apiKey;
  const cacheReset = configuredKey !== apiKey || !cacheMatches;

  signConfig.apiKey = apiKey || undefined;
  if (cacheReset) signConfig.cachedInstance = undefined;
  return { configured: Boolean(apiKey), cacheReset };
}

module.exports = { configureTikTokSigner };
