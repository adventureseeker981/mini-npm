'use strict';

const { satisfies, maxSatisfying, isValidRange } = require('./semver');

const REGISTRY = (process.env.MNPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');

// The "abbreviated" packument is much smaller than the full one: it keeps only
// what an installer needs (versions, dependencies, dist info, dist-tags).
const ACCEPT = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';

const packuments = new Map(); // name -> Promise<packument>

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.noRetry) throw err;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  const cause = lastErr.cause?.message ? ` (${lastErr.cause.message})` : '';
  throw new Error(`${lastErr.message}${cause}`);
}

async function fetchPackument(name) {
  const url = `${REGISTRY}/${name.replace('/', '%2f')}`; // scoped names: @a/b -> @a%2fb
  return withRetry(async () => {
    const res = await fetch(url, { headers: { accept: ACCEPT } });
    if (res.status === 404) {
      const err = new Error(`package "${name}" not found in the registry`);
      err.noRetry = true;
      throw err;
    }
    if (!res.ok) throw new Error(`registry returned HTTP ${res.status} for "${name}"`);
    return res.json();
  });
}

// Cached by name; the cached value is the *promise*, so concurrent requests
// for the same package share one network call.
function getPackument(name) {
  if (!packuments.has(name)) {
    const p = fetchPackument(name);
    packuments.set(name, p);
    p.catch(() => packuments.delete(name)); // don't cache failures
  }
  return packuments.get(name);
}

async function downloadTarball(url) {
  return withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

// Choose which version of a package satisfies a range (or dist-tag like "latest").
function pickVersion(packument, range) {
  const spec = (range || 'latest').trim();
  const tags = packument['dist-tags'] || {};
  const versions = Object.keys(packument.versions || {});

  if (Object.hasOwn(tags, spec)) return tags[spec]; // "latest", "next", ...
  if (!isValidRange(spec)) throw new Error(`"${spec}" is not a valid version range or tag`);

  // npm prefers the "latest" tag when it satisfies the range, even if a higher
  // version exists, so maintainers can steer people away from a new release.
  if (tags.latest && satisfies(tags.latest, spec)) return tags.latest;

  const best = maxSatisfying(versions, spec);
  if (!best) throw new Error(`no version of "${packument.name}" matches "${spec}"`);
  return best;
}

module.exports = { getPackument, downloadTarball, pickVersion };
