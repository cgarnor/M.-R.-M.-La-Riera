/**
 * Electron main-process helpers (electron-helpers.cjs): private-scheme path resolution (no path
 * traversal), allowed external links, file names, IPC argument checks and error codes.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { assert, test } from './harness';
import { describeError, translate } from '../src/i18n';
import { errorMessage } from '../src/engine/errors';

const require = createRequire(import.meta.url);
const h = require('../electron-helpers.cjs');
const ROOT = path.resolve('C:/app/dist');

test('app:// requests cannot leave dist/ (path traversal, encoded dots, other hosts, NUL)', () => {
  assert.equal(h.resolveAppPath(ROOT, 'app://mrm/index.html'), path.join(ROOT, 'index.html'));
  assert.equal(h.resolveAppPath(ROOT, 'app://mrm/'), path.join(ROOT, 'index.html'));
  assert.equal(h.resolveAppPath(ROOT, 'app://mrm/assets/a%20b.js'), path.join(ROOT, 'assets', 'a b.js'));
  for (const bad of [
    'app://mrm/../package.json', 'app://mrm/%2e%2e/electron-main.cjs', 'app://mrm/assets/%2e%2e%2f%2e%2e%2fsecret',
    'app://mrm/..%5c..%5cWindows%5cwin.ini', 'app://mrm/%00.html', 'app://other/index.html', 'file:///C:/app/dist/index.html',
    'app://mrm/%E0%A4%A', 'not a url',
  ]) {
    const r = h.resolveAppPath(ROOT, bad);
    // Either rejected, or a path that stays inside dist/ (URL parsing already folds "../" in the
    // path: app://mrm/../package.json is dist/package.json, which does not exist -> 404).
    assert.ok(r === null || (r.startsWith(ROOT + path.sep) && !path.relative(ROOT, r).startsWith('..')), `${bad} -> ${r}`);
  }
  assert.equal(h.isAppUrl('app://mrm/index.html'), true);
  assert.equal(h.isAppUrl('file:///C:/app/dist/index.html'), false);
  assert.equal(h.isAppUrl('app://evil/index.html'), false);
});

test('only https links to known hosts are opened externally', () => {
  assert.equal(h.isAllowedExternal('https://doi.org/10.3989/tp.2026.1109'), true);
  assert.equal(h.isAllowedExternal('https://github.com/cgarnor/M.-R.-M.-La-Riera'), true);
  for (const bad of ['http://doi.org/x', 'https://doi.org.evil.com/x', 'https://evilgithub.com', 'file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'ms-settings:', '']) {
    assert.equal(h.isAllowedExternal(bad), false, bad);
  }
});

test('file names and dialog filters are sanitised', () => {
  assert.equal(h.safeFileName('..\\..\\Windows\\evil.ply', 'x'), 'evil.ply');
  assert.equal(h.safeFileName('a<b>:c"d|e?f*.csv', 'x'), 'a_b_c_d_e_f_.csv');
  assert.equal(h.safeFileName('CON.csv', 'x'), '_CON.csv');
  assert.equal(h.safeFileName('name. . ', 'x'), 'name');
  assert.equal(h.safeFileName('', 'fallback'), 'fallback');
  assert.equal(h.safeFileName('a'.repeat(500), 'x').length, 180);
  assert.deepEqual(h.sanitizeFilters([{ name: 'PLY', extensions: ['ply', '../x', 'exe;bat'] }, 'junk', { extensions: [] }]), [{ name: 'PLY', extensions: ['ply'] }]);
});

test('IPC argument checks and write-error codes', () => {
  assert.equal(h.isBytes(new Uint8Array(3)), true);
  assert.equal(h.isBytes(new Uint8Array(0)), false);
  assert.equal(h.isBytes('abc'), false);
  assert.equal(h.isBytes([1, 2, 3]), false);
  assert.equal(h.num(8, 5, 12, true), 8);
  assert.throws(() => h.num(8.5, 5, 12, true), /BAD_ARGS/);
  assert.throws(() => h.num(NaN, 0, 1), /BAD_ARGS/);
  assert.throws(() => h.num('8', 5, 12), /BAD_ARGS/);
  assert.equal(h.writeError(Object.assign(new Error('x'), { code: 'EBUSY' })).message, 'MRM_ERR:WRITE_FAILED:EBUSY');
  assert.equal(h.writeError(null).message, 'MRM_ERR:WRITE_FAILED:EIO');
});

test('read/write/memory errors are translated for the user', () => {
  const tEs = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('es', k, v);
  const tEn = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
  const ipc = "Error invoking remote method 'file:save': Error: MRM_ERR:WRITE_FAILED:EBUSY";
  assert.ok(describeError(ipc, tEs).startsWith('No se ha podido escribir el archivo') && describeError(ipc, tEs).endsWith('(EBUSY)'));
  assert.ok(describeError(ipc, tEn).includes('open in another program'));
  assert.equal(errorMessage(new RangeError('Invalid string length')), 'MRM_ERR:FILE_TOO_LARGE');
  assert.equal(errorMessage(new RangeError('Array buffer allocation failed')), 'MRM_ERR:MEMORY');
  assert.equal(errorMessage('Uncaught RangeError: Array buffer allocation failed'), 'MRM_ERR:MEMORY');
  assert.ok(describeError('MRM_ERR:FILE_TOO_LARGE', tEs).startsWith('El archivo de texto es demasiado grande'));
  assert.ok(describeError('MRM_ERR:READ_FAILED:NotReadableError', tEn).startsWith('The file could not be read'));
});
