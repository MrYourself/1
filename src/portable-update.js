'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

// The portable build is the .exe of a release that is not the installer.
function portableAsset(assets) {
  return (Array.isArray(assets) ? assets : []).find(asset =>
    /\.exe$/i.test(asset?.name || '') && !/setup/i.test(asset.name) && asset.state === 'uploaded') || null;
}

// Self-update for the portable build, which electron-updater cannot replace. The new
// file is downloaded next to the running one as "<name>.exe.new" and checked against
// the SHA-256 digest GitHub publishes for the release asset. Windows allows renaming
// a running .exe, so the swap keeps the file name and existing shortcuts stay valid.
function createPortableUpdate({ fetchImpl, exePath, owner, repo, relaunch = () => {}, files = fs }) {
  const fresh = `${exePath}.new`;
  const old = `${exePath}.old`;

  function remove(file) {
    try {
      files.rmSync(file, { force: true });
    } catch {
      // Still in use by the previous version; the next start tries again.
    }
  }

  async function findAsset(version) {
    if (!VERSION_PATTERN.test(version)) throw new Error('Unerwartete Versionsnummer.');
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`GitHub antwortet mit ${response.status}.`);
    const asset = portableAsset((await response.json())?.assets);
    if (!asset) throw new Error('Die Version enthält keine portable Datei.');
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '')?.[1];
    const url = String(asset.browser_download_url || '');
    if (!digest || !(asset.size > 0) || !url.startsWith(`https://github.com/${owner}/${repo}/releases/download/`)) {
      throw new Error('Die Angaben zur portablen Datei sind unvollständig.');
    }
    return { url, digest, size: asset.size };
  }

  async function download(version, onProgress = () => {}) {
    const asset = await findAsset(version);
    const response = await fetchImpl(asset.url);
    if (!response.ok || !response.body) throw new Error(`Download antwortet mit ${response.status}.`);
    const hash = crypto.createHash('sha256');
    const handle = await files.promises.open(fresh, 'w');
    let received = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        await handle.write(value);
        received += value.length;
        if (received > asset.size) throw new Error('Der Download ist größer als angekündigt.');
        onProgress(received / asset.size * 100);
      }
    } catch (error) {
      await handle.close();
      remove(fresh);
      throw error;
    }
    await handle.close();
    if (received !== asset.size || hash.digest('hex') !== asset.digest) {
      remove(fresh);
      throw new Error('Das heruntergeladene Update war beschädigt und wurde verworfen.');
    }
    return fresh;
  }

  function apply() {
    if (!files.existsSync(fresh)) throw new Error('Es liegt kein heruntergeladenes Update bereit.');
    remove(old);
    files.renameSync(exePath, old);
    try {
      files.renameSync(fresh, exePath);
    } catch (error) {
      files.renameSync(old, exePath);
      throw error;
    }
  }

  // Leftovers of an earlier update: the replaced version and unfinished downloads.
  function cleanup({ download: unfinished = true } = {}) {
    remove(old);
    if (unfinished) remove(fresh);
  }

  return { download, apply, cleanup, relaunch };
}

module.exports = { createPortableUpdate, portableAsset };
