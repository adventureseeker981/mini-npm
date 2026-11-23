'use strict';

// A small semver implementation: exact versions, ^ ~ >= > <= < =, x-ranges
// (1.x, 1.2.*), hyphen ranges (1.2.3 - 2.3.4), and "||" unions.

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_RE =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(v) {
  const m = VERSION_RE.exec(String(v).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

// A version with no prerelease tag sorts ABOVE one with a tag (1.0.0 > 1.0.0-beta).
function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      if (+a[i] !== +b[i]) return +a[i] < +b[i] ? -1 : 1;
    } else if (aNum) return -1; // numeric identifiers sort below alphanumeric
    else if (bNum) return 1;
    else if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function compare(a, b) {
  const x = typeof a === 'string' ? parse(a) : a;
  const y = typeof b === 'string' ? parse(b) : b;
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}

// "1", "1.2", "1.2.3", "1.x", "*" -> numbers, with null for wildcards/missing parts.
function parsePartial(s) {
  const m = PARTIAL_RE.exec(s);
  if (!m) return null;
  const num = (x) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x));
  const major = num(m[1]);
  const minor = major === null ? null : num(m[2]);
  const patch = minor === null ? null : num(m[3]);
  return { major, minor, patch, pre: m[4] ? m[4].split('.') : [] };
}

const comp = (op, major, minor, patch, pre = []) => ({ op, v: { major, minor, patch, pre } });

// Turn one operator + partial version into plain comparators (>=, <, etc.).
// This is the heart of semver: "^1.2.3" really means ">=1.2.3 <2.0.0".
function desugar(op, p) {
  const { major: M, minor: m, patch: pt, pre } = p;
  if (M === null) return []; // "*" matches everything
  switch (op) {
    case '':
    case '=':
      if (m === null) return [comp('>=', M, 0, 0), comp('<', M + 1, 0, 0)];
      if (pt === null) return [comp('>=', M, m, 0), comp('<', M, m + 1, 0)];
      return [comp('=', M, m, pt, pre)];
    case '^':
      if (m === null) return [comp('>=', M, 0, 0), comp('<', M + 1, 0, 0)];
      if (pt === null) {
        return M > 0
          ? [comp('>=', M, m, 0), comp('<', M + 1, 0, 0)]
          : [comp('>=', 0, m, 0), comp('<', 0, m + 1, 0)];
      }
      if (M > 0) return [comp('>=', M, m, pt, pre), comp('<', M + 1, 0, 0)];
      if (m > 0) return [comp('>=', 0, m, pt, pre), comp('<', 0, m + 1, 0)];
      return [comp('>=', 0, 0, pt, pre), comp('<', 0, 0, pt + 1)];
    case '~':
      if (m === null) return [comp('>=', M, 0, 0), comp('<', M + 1, 0, 0)];
      return [comp('>=', M, m, pt ?? 0, pre), comp('<', M, m + 1, 0)];
    case '>=':
      return [comp('>=', M, m ?? 0, pt ?? 0, pre)];
    case '>':
      if (m === null) return [comp('>=', M + 1, 0, 0)];
      if (pt === null) return [comp('>=', M, m + 1, 0)];
      return [comp('>', M, m, pt, pre)];
    case '<':
      return [comp('<', M, m ?? 0, pt ?? 0, pre)];
    case '<=':
      if (m === null) return [comp('<', M + 1, 0, 0)];
      if (pt === null) return [comp('<', M, m + 1, 0)];
      return [comp('<=', M, m, pt, pre)];
    default:
      return [];
  }
}

// Returns an array of comparator sets (OR of ANDs), or null if the range is invalid.
function parseRange(range) {
  const sets = [];
  for (let part of String(range ?? '').split('||')) {
    part = part
      .trim()
      .replace(/(\S+)\s+-\s+(\S+)/, '>=$1 <=$2') // hyphen range
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1'); // ">= 1.2" -> ">=1.2"
    const set = [];
    for (const token of part.split(/\s+/).filter(Boolean)) {
      const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
      const partial = parsePartial(m[2]);
      if (!partial) return null;
      set.push(...desugar(m[1] || '', partial));
    }
    sets.push(set);
  }
  return sets;
}

function testSet(v, set) {
  for (const { op, v: bound } of set) {
    const c = compare(v, bound);
    const ok =
      (op === '>=' && c >= 0) ||
      (op === '>' && c > 0) ||
      (op === '<=' && c <= 0) ||
      (op === '<' && c < 0) ||
      (op === '=' && c === 0);
    if (!ok) return false;
  }
  // Prereleases only match if a comparator names the same major.minor.patch with a tag.
  if (v.pre.length) {
    return set.some(
      ({ v: b }) =>
        b.pre.length && b.major === v.major && b.minor === v.minor && b.patch === v.patch
    );
  }
  return true;
}

function satisfies(version, range) {
  const v = parse(version);
  const sets = parseRange(range);
  if (!v || !sets) return false;
  return sets.some((set) => testSet(v, set));
}

function maxSatisfying(versions, range) {
  const sets = parseRange(range);
  if (!sets) return null;
  let best = null;
  let bestParsed = null;
  for (const version of versions) {
    const v = parse(version);
    if (!v || !sets.some((set) => testSet(v, set))) continue;
    if (!bestParsed || compare(v, bestParsed) > 0) {
      best = version;
      bestParsed = v;
    }
  }
  return best;
}

function isValidRange(range) {
  return parseRange(range) !== null;
}

module.exports = { parse, compare, satisfies, maxSatisfying, isValidRange };
