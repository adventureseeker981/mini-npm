'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// A tar archive is a sequence of 512-byte blocks: a header block describing a
// file, then the file's bytes padded up to a multiple of 512. Two zero blocks
// mark the end. npm tarballs are tar + gzip ("tgz").

function readString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.toString('utf8', 0, nul === -1 ? slice.length : nul);
}

function isZeroBlock(block) {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

// PAX extended headers are "<len> <key>=<value>\n" records; we only need "path".
function parsePaxPath(data) {
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) break;
    const len = parseInt(data.toString('utf8', pos, space), 10);
    if (!len || len <= (space - pos)) break;
    const record = data.toString('utf8', space + 1, pos + len - 1); // drop trailing \n
    const eq = record.indexOf('=');
    if (record.slice(0, eq) === 'path') return record.slice(eq + 1);
    pos += len;
  }
  return null;
}

/**
 * Extract a .tgz buffer into destDir, dropping the first path component
 * ("package/") the way npm does. Throws if an entry would escape destDir.
 */
function extractTarGz(buffer, destDir, { strip = 1 } = {}) {
  const tar = zlib.gunzipSync(buffer);
  const root = path.resolve(destDir);
  let offset = 0;
  let longName = null; // from a GNU 'L' entry
  let paxPath = null; // from a PAX 'x' entry
  let files = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (isZeroBlock(header)) break;

    const size = parseInt(readString(header, 124, 12).trim() || '0', 8);
    const mode = parseInt(readString(header, 100, 8).trim() || '0', 8);
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'L') {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === 'x') {
      paxPath = parsePaxPath(data);
      continue;
    }
    if (type === 'g') continue; // global PAX header: ignore

    const prefix = readString(header, 345, 155);
    const rawName = paxPath || longName || (prefix ? `${prefix}/${readString(header, 0, 100)}` : readString(header, 0, 100));
    paxPath = null;
    longName = null;

    // Only regular files and directories. Symlinks/hardlinks are skipped on purpose:
    // they are a classic way for a malicious tarball to write outside its folder.
    if (type !== '0' && type !== '5') continue;

    const rel = rawName.split('/').filter(Boolean).slice(strip).join('/');
    if (!rel) continue;

    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`unsafe path in tarball: ${rawName}`);
    }

    if (type === '5') {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data, { mode: mode & 0o111 ? 0o755 : 0o644 });
      files++;
    }
  }
  return files;
}

module.exports = { extractTarGz };
