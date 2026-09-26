'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDirectory = path.join(__dirname, '..', 'src', 'renderer');
const styles = fs.readFileSync(path.join(rendererDirectory, 'styles.css'), 'utf8');
const markup = fs.readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(rendererDirectory, 'app.js'), 'utf8');

test('the overlay stays interactive with a persistent toolbar and no lock mode', () => {
  const appRule = styles.match(/(?:^|\n)#app\s*\{([^}]+)\}/)?.[1] || '';
  const toolbarRule = styles.match(/(?:^|\n)\.toolbar\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(appRule, /grid-template-rows:\s*58px\s+0\s+minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(appRule, /pointer-events:\s*none/);
  assert.match(styles, /#app\.stats-visible\s*\{\s*grid-template-rows:\s*58px\s+30px\s+minmax\(0,\s*1fr\)/);
  assert.match(toolbarRule, /display:\s*flex/);
  assert.doesNotMatch(markup, /id="lockButton"|id="lockedHint"/);
  assert.doesNotMatch(script, /toggleEdit|editMode/);
});

test('live statistics remain available without weakening the renderer boundary', () => {
  assert.match(markup, /id="streamStats"/);
  assert.match(markup, /id="twitchViewerCount"/);
  assert.match(markup, /id="tiktokViewerCount"/);
  assert.match(markup, /id="streamDuration"/);
  assert.match(markup, /id="localClock"/);
  assert.match(markup, /<script src="spam-filter\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.match(script, /window\.overlay\.onMetrics\(applyStreamMetrics\)/);
});
