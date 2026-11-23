'use strict';

const { getPackument, pickVersion } = require('./registry');
const { satisfies } = require('./semver');

// We only support plain registry dependencies: semver ranges and dist-tags.
function isUnsupportedSpec(range) {
  return (
    /^(git|git\+\w+|github|http|https|file|link|workspace|npm):/.test(range) ||
    /^[\w.-]+\/[\w.-]+(#.*)?$/.test(range) || /^[\w.-]+@[\w.-]+/.test(range)// github shorthand: user/repo
  );
}

function listAllows(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const allowed = list.filter((x) => !x.startsWith('!'));
  return allowed.length === 0 || allowed.includes(value);
}

function platformOk(manifest) {
  return listAllows(manifest.os, process.platform) && listAllows(manifest.cpu, process.arch);
}

// Node's require() looks for node_modules/<name> in the current package, then
// walks up through every parent. Mirror that lookup over our in-memory tree.
function findExisting(from, name) {
  for (let node = from; node; node = node.parent) {
    const hit = node.children.get(name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build the dependency tree.
 *
 * Placement strategy (a simplified version of npm's "hoisting"):
 *  - If a satisfying copy is already reachable from the requester, reuse it.
 *  - If nothing with that name is reachable, install it at the top level.
 *  - If a *conflicting* version is reachable, nest the new one under the requester
 *    so it shadows the conflicting one for that package only.
 *
 * Returns a flat list of { name, version, location, resolved, integrity, ... }.
 */
async function resolveTree(rootDeps) {
  const root = { name: null, version: null, parent: null, children: new Map(), location: '' };
  const queue = [];

  const enqueue = (parent, deps, optional, skip = {}) => {
    for (const [name, range] of Object.entries(deps || {})) {
      if (Object.hasOwn(skip, name)) continue;
      if (!isUnsupportedSpec(range)) getPackument(name).catch(() => {}); // prefetch in parallel
      queue.push({ parent, name, range, optional });
    }
  };

  enqueue(root, rootDeps, false);

  while (queue.length) {
    const { parent, name, range, optional } = queue.shift();
    try {
      if (isUnsupportedSpec(range)) {
        throw new Error(
          `unsupported spec "${range}" (mnpm only handles registry versions and dist-tags)`
        );
      }

      const existing = findExisting(parent, name);
      if (existing && satisfies(existing.version, range)) continue; // already satisfied

      const packument = await getPackument(name);
      const version = pickVersion(packument, range);
      const manifest = packument.versions[version];
      if (optional && !platformOk(manifest)) continue;

      const holder = existing ? parent : root;
      const node = {
        name,
        version,
        parent: holder,
        children: new Map(),
        location: [holder.location, 'node_modules', name].filter(Boolean).join('/'),
        resolved: manifest.dist.tarball,
        integrity: manifest.dist.integrity,
        shasum: manifest.dist.shasum,
        bin: manifest.bin,
      };
      holder.children.set(name, node);

      const optionalDeps = manifest.optionalDependencies || {};
      enqueue(node, manifest.dependencies, false, optionalDeps);
      enqueue(node, optionalDeps, true);
    } catch (err) {
      if (optional) continue; // optional deps are allowed to fail
      err.message = `${name}@${range || 'latest'}: ${err.message}`;
      throw err;
    }
  }

  return flatten(root);
}

function flatten(root) {
  const out = [];
  (function walk(node) {
    for (const child of node.children.values()) {
      const { name, version, location, resolved, integrity, shasum, bin } = child;
      out.push({ name, version, location, resolved, integrity, shasum, bin });
      walk(child);
    }
  })(root);
  return out.sort((a, b) => (a.location < b.location ? -1 : 1));
}

module.exports = { resolveTree };
