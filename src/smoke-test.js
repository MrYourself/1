'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const TIMEOUT_MS = 60000;

// Self-test of a packaged build, started with --smoke-test (see scripts/smoke-test.ps1).
// GitHub runs it after every build, so a version that does not start, misses files or
// cannot load its libraries is never published. It uses a temporary data folder and
// writes its result to %TEMP%\twitch-chat-overlay-smoke.json.
function smokeReportPath(app) {
  return path.join(app.getPath('temp'), 'twitch-chat-overlay-smoke.json');
}

// Renderer problems are only visible as events, so they are collected from the start.
function watchRenderers(app, errors) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', details => {
      if (details?.level === 'error') errors.push(`Konsole: ${String(details.message).slice(0, 300)}`);
    });
    contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
      errors.push(`Preload ${path.basename(preloadPath)}: ${error?.message || error}`);
    });
    contents.on('render-process-gone', (_goneEvent, details) => {
      errors.push(`Renderer beendet: ${details?.reason || 'unbekannt'}`);
    });
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
}

function waitForLoad(contents) {
  if (!contents.isLoading()) return Promise.resolve();
  return new Promise(resolve => contents.once('did-finish-load', resolve));
}

async function runChecks({ mainWindow, captionServer, updater, sourceRoot }) {
  const passed = [];
  const errors = [];
  const check = async (name, run) => {
    try {
      await run();
      passed.push(name);
    } catch (error) {
      errors.push(`${name}: ${error?.message || error}`);
    }
  };

  await check('Overlay-Fenster', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('kein Fenster');
    await waitForLoad(mainWindow.webContents);
    const ready = await mainWindow.webContents.executeJavaScript(
      "Boolean(window.overlay && document.getElementById('settingsButton') && document.getElementById('messages'))");
    if (!ready) throw new Error('Oberfläche oder Preload fehlt');
  });
  await check('Dateien der Untertitel', async () => {
    for (const file of ['captions/index.html', 'captions/captions.js', 'captions/audio-worklet.js', 'captions-preload.js']) {
      if (!fs.existsSync(path.join(sourceRoot, file))) throw new Error(`${file} fehlt`);
    }
  });
  await check('Browserquelle', async () => {
    const url = await captionServer.start();
    if (!url) throw new Error('startet nicht');
    const origin = new URL(url).origin;
    for (const route of ['/captions', '/overlay.js', '/display.js', '/captions.css']) {
      const status = await get(origin + route);
      if (status !== 200) throw new Error(`${route} antwortet mit ${status}`);
    }
    await captionServer.stop();
  });
  await check('TikTok-Bibliothek', async () => {
    const connector = await import('tiktok-live-connector');
    if (typeof connector.TikTokLiveConnection !== 'function') throw new Error('TikTokLiveConnection fehlt');
  });
  await check('Updater', async () => {
    require('electron-updater');
    // Without app-update.yml the installed app could never update itself.
    if (updater?.state?.status === 'disabled') throw new Error('nicht aktiv, app-update.yml fehlt');
  });
  return { passed, errors };
}

function startSmokeTest(app) {
  const rendererErrors = [];
  watchRenderers(app, rendererErrors);
  const finish = (code, result) => {
    try {
      fs.writeFileSync(smokeReportPath(app), JSON.stringify({ version: app.getVersion(), code, ...result }, null, 2));
    } catch {}
    app.exit(code);
  };
  const timer = setTimeout(() => finish(2, { passed: [], errors: ['Zeitüberschreitung'] }), TIMEOUT_MS);
  return async dependencies => {
    try {
      if (dependencies.initError) throw dependencies.initError;
      const result = await runChecks(dependencies);
      // Give late renderer errors (scripts that fail after loading) a moment to arrive.
      await new Promise(resolve => setTimeout(resolve, 1500));
      result.errors.push(...rendererErrors);
      clearTimeout(timer);
      finish(result.errors.length ? 1 : 0, result);
    } catch (error) {
      clearTimeout(timer);
      finish(1, { passed: [], errors: [String(error?.stack || error)] });
    }
  };
}

module.exports = { smokeReportPath, startSmokeTest };
