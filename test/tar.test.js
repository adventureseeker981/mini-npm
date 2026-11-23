'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { extractTarGz } = require('../src/tar');

// Build a minimal ustar entry by hand: this is what a tar header really looks like.
function tarEntry(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148); // checksum field counts as spaces while summing
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  body.write(content);
  return Buffer.concat([header, body]);
}

const makeTgz = (entries) =>
  zlib.gzipSync(Buffer.concat([...entries.map(([n, c]) => tarEntry(n, c)), Buffer.alloc(1024)]));

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('extracts files and strips the leading "package/" folder', () => {
  withTempDir((dir) => {
    const tgz = makeTgz([
      ['package/index.js', 'console.log(1)'],
      ['package/lib/util.js', 'module.exports = 2'],
    ]);
    const count = extractTarGz(tgz, dir);
    assert.equal(count, 2);
    assert.equal(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), 'console.log(1)');
    assert.equal(fs.readFileSync(path.join(dir, 'lib', 'util.js'), 'utf8'), 'module.exports = 2');
  });
});

test('rejects path traversal ("zip slip") entries', () => {
  withTempDir((dir) => {
    const tgz = makeTgz([['package/../../evil.txt', 'gotcha']]);
    assert.throws(() => extractTarGz(tgz, path.join(dir, 'out')), /unsafe path/);
    assert.ok(!fs.existsSync(path.join(dir, 'evil.txt')));
  });
});

test('handles long paths written by the system tar (GNU/PAX extensions)', () => {
  const { execFileSync } = require('node:child_process');
  withTempDir((dir) => {
    const deep = path.join('package', 'a'.repeat(60), 'b'.repeat(60), 'file.txt');
    fs.mkdirSync(path.join(dir, 'src', path.dirname(deep)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', deep), 'deep');
    const archive = path.join(dir, 'x.tgz');
    execFileSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), 'package']);

    const out = path.join(dir, 'out');
    extractTarGz(fs.readFileSync(archive), out);
    const stripped = deep.split(path.sep).slice(1).join(path.sep);
    assert.equal(fs.readFileSync(path.join(out, stripped), 'utf8'), 'deep');
  });
});
