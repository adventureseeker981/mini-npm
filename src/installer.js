'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadTarball } = require('./registry');
const { extractTarGz } = require('./tar');

const SUPPORTED_HASHES = ['sha512', 'sha384', 'sha256', 'sha1'];

// Compare the downloaded bytes against the hash the registry promised.
// Integrity strings look like "sha512-<base64>".
function verifyIntegrity(buffer, entry) {
  const label = `${entry.name}@${entry.version}`;
  for (const token of String(entry.integrity || '').split(/\s+/).filter(Boolean)) {
    const dash = token.indexOf('-');
    const algo = token.slice(0, dash);
    if (!SUPPORTED_HASHES.includes(algo)) continue;
    const actual = crypto.createHash(algo).update(buffer).digest('base64');
    if (actual !== token.slice(dash + 1)) throw new Error(`integrity check failed for ${label}`);
    return;
  }
  if (entry.shasum) {
    const actual = crypto.createHash('sha1').update(buffer).digest('hex');
    if (actual !== entry.shasum) throw new Error(`checksum mismatch for ${label}`);
  }
}

const depthOf = (location) => location.split('/node_modules/').length;

// Run `worker` over `items` with at most `limit` in flight. After the first
// failure no new items are started (in-flight ones are left to finish), so one
// bad package doesn't keep downloading the rest of the tree.
async function pool(items, limit, worker) {
  let next = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && next < items.length) {
      try {
        await worker(items[next++]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(runners);
}

function installedVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

// Remove anything in node_modules that isn't part of the plan.
function prune(cwd, entries) {
  const keep = new Set(entries.map((e) => e.location));
  const walk = (nmDir, prefix) => {
    if (!fs.existsSync(nmDir)) return;
    for (const dirent of fs.readdirSync(nmDir, { withFileTypes: true })) {
      if (dirent.name.startsWith('.')) continue; // .bin etc.
      const names = (dirent.isDirectory() && dirent.name.startsWith('@'))
        ? fs.readdirSync(path.join(nmDir, dirent.name)).map((n) => `${dirent.name}/${n}`)
        : [dirent.name];
      for (const name of names) {
        const location = path.posix.join(prefix, 'node_modules', name);
        const dir = path.join(nmDir, name);
        if (keep.has(location)) walk(path.join(dir, 'node_modules'), location);
        else fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  };
  walk(path.join(cwd, 'node_modules'), '');
}

// Create node_modules/.bin/<command> symlinks for top-level packages.
function linkBins(cwd, entries) {
  const binDir = path.join(cwd, 'node_modules', '.bin');
  fs.rmSync(binDir, { recursive: true, force: true });
  for (const entry of entries) {
    if (entry.location !== `node_modules/${entry.name}`) continue;
    const bins =
      typeof entry.bin === 'string' ? { [entry.name.split('/').pop()]: entry.bin } : entry.bin || {};
    for (const [command, file] of Object.entries(bins)) {
      const target = path.join(cwd, entry.location, file);
      if (!fs.existsSync(target)) continue;
      try {
        fs.mkdirSync(binDir, { recursive: true });
        fs.chmodSync(target, 0o755);
        fs.symlinkSync(path.relative(binDir, target), path.join(binDir, path.basename(command)));
      } catch {
        // symlinks can fail on Windows without privileges; skip rather than abort
      }
    }
  }
}

/**
 * Make node_modules match `entries`. Parents are installed before children
 * (one "depth wave" at a time) so extracting a parent never wipes a freshly
 * installed nested child. Within a wave, downloads run concurrently.
 */
async function installEntries(cwd, entries, { concurrency = 8, log = () => {} } = {}) {
  const waves = new Map();
  for (const entry of entries) {
    const d = depthOf(entry.location);
    if (!waves.has(d)) waves.set(d, []);
    waves.get(d).push(entry);
  }

  let installed = 0;
  let skipped = 0;
  for (const depth of [...waves.keys()].sort((a, b) => a - b)) {
    await pool(waves.get(depth), concurrency, async (entry) => {
      const dest = path.join(cwd, entry.location);
      if (installedVersion(dest) === entry.version) {
        skipped++;
        return;
      }
      fs.rmSync(dest, { recursive: true, force: true });
      const buffer = await downloadTarball(entry.resolved);
      verifyIntegrity(buffer, entry);
      extractTarGz(buffer, dest);
      installed++;
      log(`+ ${entry.name}@${entry.version}`);
    });
  }

  prune(cwd, entries);
  linkBins(cwd, entries);
  return { installed, skipped };
}

module.exports = { installEntries, verifyIntegrity };
