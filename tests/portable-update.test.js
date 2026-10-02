'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPortableUpdate, portableAsset } = require('../src/portable-update');

const NEW_FILE = Buffer.from('new portable build');
const DOWNLOAD_URL = 'https://github.com/owner/repo/releases/download/v0.3.0/App-0.3.0.exe';

function setup({ digest = crypto.createHash('sha256').update(NEW_FILE).digest('hex'), url = DOWNLOAD_URL } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-update-'));
  const exePath = path.join(directory, 'App.exe');
  fs.writeFileSync(exePath, 'old portable build');
  const requests = [];
  const fetchImpl = async target => {
    requests.push(target);
    if (target.startsWith('https://api.github.com/')) {
      return { ok: true, status: 200, json: async () => ({ assets: [
        { name: 'App-Setup-0.3.0.exe', state: 'uploaded', size: 5, digest: `sha256:${'0'.repeat(64)}`, browser_download_url: `${DOWNLOAD_URL}.setup` },
        { name: 'App-0.3.0.exe', state: 'uploaded', size: NEW_FILE.length, digest: `sha256:${digest}`, browser_download_url: url }
      ] }) };
    }
    return { ok: true, status: 200, body: new Blob([NEW_FILE]).stream() };
  };
  const update = createPortableUpdate({ fetchImpl, exePath, owner: 'owner', repo: 'repo' });
  return { update, exePath, requests, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('picks the portable file of a release, never the installer', () => {
  assert.equal(portableAsset([{ name: 'App-Setup-1.0.0.exe', state: 'uploaded' }, { name: 'latest.yml', state: 'uploaded' }]), null);
  assert.equal(portableAsset([{ name: 'App-1.0.0.exe', state: 'starter' }]), null);
  assert.equal(portableAsset(null), null);
});

test('downloads the portable file, checks its digest and swaps it in', async t => {
  const { update, exePath, requests, cleanup } = setup();
  t.after(cleanup);
  const progress = [];
  await update.download('0.3.0', percent => progress.push(percent));
  assert.deepEqual(requests, ['https://api.github.com/repos/owner/repo/releases/tags/v0.3.0', DOWNLOAD_URL]);
  assert.equal(progress.at(-1), 100);
  assert.equal(fs.readFileSync(exePath, 'utf8'), 'old portable build', 'the running file is untouched until the swap');
  update.apply();
  assert.equal(fs.readFileSync(exePath, 'utf8'), 'new portable build');
  assert.equal(fs.readFileSync(`${exePath}.old`, 'utf8'), 'old portable build');
  update.cleanup();
  assert.equal(fs.existsSync(`${exePath}.old`), false);
  assert.throws(() => update.apply(), /kein heruntergeladenes Update/);
});

test('discards a download whose digest does not match', async t => {
  const { update, exePath, cleanup } = setup({ digest: 'a'.repeat(64) });
  t.after(cleanup);
  await assert.rejects(update.download('0.3.0'), /beschädigt/);
  assert.equal(fs.existsSync(`${exePath}.new`), false);
  assert.equal(fs.readFileSync(exePath, 'utf8'), 'old portable build');
});

test('refuses downloads from outside the release and odd version numbers', async t => {
  const foreign = setup({ url: 'https://example.com/App-0.3.0.exe' });
  t.after(foreign.cleanup);
  await assert.rejects(foreign.update.download('0.3.0'), /unvollständig/);
  assert.equal(foreign.requests.length, 1, 'nothing is downloaded');
  await assert.rejects(foreign.update.download('../../x'), /Versionsnummer/);
});
