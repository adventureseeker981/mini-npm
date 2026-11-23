'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const FILE = 'mnpm-lock.json';

function read(cwd) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, FILE), 'utf8'));
    if (lock.packages && typeof lock.packages === 'object') {
      return lock.lockfileVersion === 1 ? lock : null;
    }
    throw new Error;
  } catch {
    return null;
  }
}

// `root` records the dependencies the lock was generated from, so we can tell
// when package.json has changed and the lock is stale.
function write(cwd, root, entries) {
  const packages = {};
  for (const { location, ...rest } of entries) packages[location] = rest;
  const lock = { lockfileVersion: 1, root, packages };
  fs.writeFileSync(path.join(cwd, FILE), JSON.stringify(lock, null, 2) + '\n');
}

const toEntries = (lock) =>
  Object.entries(lock.packages).map(([location, rest]) => ({ location, ...rest }));

const isFresh = (lock, root) => isDeepStrictEqual(lock.root, root);

module.exports = { read, write, toEntries, isFresh };
