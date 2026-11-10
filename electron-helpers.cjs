/**
 * Pure helpers of the Electron main process (no Electron imports, so they can be unit-tested
 * with Node: validation/tests-main.ts).
 *
 * SPDX-License-Identifier: MIT
 */
const path = require('path');

/** Custom scheme that serves the bundled interface (instead of file://). */
const APP_SCHEME = 'app';
const APP_HOST = 'mrm';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Upper bound for any buffer received from the renderer (2 GiB). */
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** External links the interface may open in the system browser. */
const EXTERNAL_HOSTS = ['doi.org', 'github.com', 'orcid.org', 'creativecommons.org'];

function isBytes(v) {
  return v instanceof Uint8Array && v.byteLength > 0 && v.byteLength <= MAX_BYTES;
}

/** Validated number in [min, max] (integer if required); throws MRM_ERR:BAD_ARGS otherwise. */
function num(v, min, max, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('MRM_ERR:BAD_ARGS');
  if (integer && !Number.isInteger(v)) throw new Error('MRM_ERR:BAD_ARGS');
  return v;
}

/** Plain file name: no folders, no reserved characters, no Windows device names. */
function safeFileName(name, fallback) {
  let s = path.basename(String(name || '')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/[. ]+$/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = `_${s}`;
  return (s || fallback).slice(0, 180);
}

function sanitizeFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return filters.slice(0, 4).map((f) => ({
    name: String(f && f.name ? f.name : 'File').slice(0, 40),
    extensions: (Array.isArray(f && f.extensions) ? f.extensions : []).map(String).filter((e) => /^[a-z0-9]{1,8}$/i.test(e)).slice(0, 4),
  })).filter((f) => f.extensions.length);
}

/** Only https links to a few known hosts (DOI, repository, ORCID, licence) are opened. */
function isAllowedExternal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && EXTERNAL_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * File inside `root` for a request to app://mrm/<path> (null if the request leaves `root`, uses
 * another host or is malformed). The path is decoded and normalised before the containment check.
 */
function resolveAppPath(root, requestUrl) {
  let u;
  try { u = new URL(requestUrl); } catch { return null; }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null;
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel}`);
  const inside = path.relative(base, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return file;
}

/** True for URLs of the bundled interface. */
function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST;
  } catch {
    return false;
  }
}

/** Converts a file-system error into a stable code for the interface (MRM_ERR:WRITE_FAILED:<code>). */
function writeError(err) {
  const code = err && typeof err.code === 'string' ? err.code : 'EIO';
  return new Error(`MRM_ERR:WRITE_FAILED:${code}`);
}

module.exports = {
  APP_SCHEME, APP_HOST, APP_ORIGIN, MAX_BYTES, EXTERNAL_HOSTS,
  isBytes, num, safeFileName, sanitizeFilters, isAllowedExternal, resolveAppPath, isAppUrl, writeError,
};
