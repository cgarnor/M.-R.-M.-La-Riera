/**
 * Exported and imported files: CSV (decimal comma, formula injection), .mrm projects (round trip
 * and rejection of damaged or malicious files), PNG / JPEG resolution metadata, error messages.
 */
import { assert, close, test, throwsCode } from './harness';
import { deserializeProject, serializeProject, toCsv } from '../src/utils/files';
import { setJpegDpi, setPngDpi } from '../src/utils/imageEncode';
import { runMrm } from '../src/engine/pipeline';
import { DEFAULT_CLASS_PARAMS, DEFAULT_MRM_PARAMS } from '../src/engine/types';
import { describeError, translate } from '../src/i18n';
import type { Artefact, Settings } from '../src/state/model';
import { ellipsoid } from './tests-pipeline';

test('CSV: decimal comma, no exponent, quoting and spreadsheet-formula neutralisation', () => {
  const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(toCsv([['a', 'b;c', '=HYPERLINK("x")', '+1', '@SUM(A1)', '-x'], [123.456, 1e-7, -0.5, 12, NaN, 0]]));
  assert.ok(csv.startsWith('\ufeff'));
  const [h, r] = csv.slice(1).split('\r\n');
  assert.equal(h, `a;"b;c";"'=HYPERLINK(""x"")";'+1;'@SUM(A1);'-x`);
  assert.equal(r, '123,456;0,0000001;-0,5;12;;0');
});

const SETTINGS: Settings = {
  classParams: DEFAULT_CLASS_PARAMS, method: 'autok', scaleMode: 'common', viewMode: 'mrm', ramp: 'bgyr',
  mrmRangeMm: null, lightAzimuth: 0, lightElevation: 0, syncCameras: true,
};

async function sampleArtefact(): Promise<Artefact> {
  const result = await runMrm(ellipsoid(3, 30, 0.004), { ...DEFAULT_MRM_PARAMS, trendMethod: 'decimation' }, null, () => {});
  return {
    id: 'a1', name: 'Pieza 1', fileName: 'p1.obj', meta: { site: 'La Riera', type: 'azuela', material: 'x', notes: 'n' },
    unit: 'mm', unitConfirmed: false, dims: { lengthMm: 61 }, status: 'done', stage: 'done', progress: 1,
    params: result.params, result, version: 1,
  };
}

test('project: round trip keeps data, metadata, units and settings', async () => {
  const a = await sampleArtefact();
  const p = deserializeProject(serializeProject([a], SETTINGS).slice().buffer);
  const b = p.artefacts[0];
  assert.equal(b.name, 'Pieza 1');
  assert.equal(b.unitConfirmed, false);
  assert.deepEqual(b.meta, a.meta);
  assert.equal(b.dims?.lengthMm, 61);
  assert.deepEqual(Array.from(b.result!.residuals), Array.from(a.result!.residuals));
  assert.deepEqual(Array.from(b.result!.rqr), Array.from(a.result!.rqr));
  close(b.result!.rqrStats.mean, a.result!.rqrStats.mean, 1e-15);
  assert.equal(p.settings?.method, 'autok');
  assert.equal(p.settings?.scaleMode, 'common');
});

/** Rewrites the JSON header of a serialized project. */
function withHead(bytes: Uint8Array, edit: (h: any) => void): ArrayBuffer { // eslint-disable-line @typescript-eslint/no-explicit-any
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const len = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len)));
  const oldStart = Math.ceil((12 + len) / 8) * 8;
  edit(head);
  const json = new TextEncoder().encode(JSON.stringify(head));
  const start = Math.ceil((12 + json.length) / 8) * 8;
  const out = new Uint8Array(start + bytes.length - oldStart);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  out.set(bytes.subarray(oldStart), start);
  return out.buffer;
}

test('project: damaged or malicious files are rejected or sanitised', async () => {
  const good = serializeProject([await sampleArtefact()], SETTINGS);
  throwsCode(() => deserializeProject(new ArrayBuffer(4)), 'PROJECT_INVALID');
  const badMagic = good.slice(); badMagic[0] = 0; throwsCode(() => deserializeProject(badMagic.buffer), 'PROJECT_INVALID');
  const badVer = good.slice(); new DataView(badVer.buffer).setUint32(4, 99, true); throwsCode(() => deserializeProject(badVer.buffer), 'PROJECT_VERSION');
  throwsCode(() => deserializeProject(good.slice(0, good.length - 1000).buffer), 'PROJECT_INVALID');
  throwsCode(() => deserializeProject(withHead(good, (h) => { h.artefacts[0].data.indices.n += 1e6; })), 'PROJECT_INVALID');
  throwsCode(() => deserializeProject(withHead(good, (h) => { h.artefacts[0].data.positions.k = 'u32'; })), 'PROJECT_INVALID');
  // A face index pointing outside the vertex array (written directly into the binary data).
  const corrupt = good.slice();
  const h = JSON.parse(new TextDecoder().decode(corrupt.subarray(12, 12 + new DataView(corrupt.buffer).getUint32(8, true))));
  const start = Math.ceil((12 + new DataView(corrupt.buffer).getUint32(8, true)) / 8) * 8;
  new DataView(corrupt.buffer).setUint32(start + h.artefacts[0].data.indices.o, 0xffffffff, true);
  throwsCode(() => deserializeProject(corrupt.buffer), 'PROJECT_INVALID');
  // Hostile strings, ids, units and parameters are neutralised.
  const p = deserializeProject(withHead(good, (hd) => {
    const it = hd.artefacts[0];
    it.name = { toString: 1 }; it.id = '<img src=x>'; it.unit = 'parsec'; it.dims = { lengthMm: -5, widthMm: 'x' };
    it.params = { poissonDepth: 50, trendMethod: 'rm -rf' };
    hd.settings = { classParams: { jenksSample: 1e12 }, method: 'percentile', scaleMode: 'x' };
  }));
  const a = p.artefacts[0];
  assert.equal(typeof a.name, 'string');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a.id));
  assert.equal(a.unit, 'mm');
  assert.equal(a.dims, undefined);
  assert.equal(a.params.poissonDepth, 12);
  assert.equal(a.params.trendMethod, 'poisson');
  assert.equal(p.settings?.classParams?.jenksSample, 20000);
  assert.equal(p.settings?.method, 'jenks');
  assert.equal(p.settings?.scaleMode, undefined);
});

/** CRC-32 as used by PNG (to check the inserted chunk). */
function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}

test('PNG pHYs and JPEG JFIF resolution metadata', () => {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82];
  const png = setPngDpi(Uint8Array.from([...sig, ...ihdr, ...iend]), 300);
  const o = 8 + 25;
  assert.equal(String.fromCharCode(...png.subarray(o + 4, o + 8)), 'pHYs');
  const dv = new DataView(png.buffer);
  assert.equal(dv.getUint32(o + 8), 11811); // 300 dpi in pixels per metre
  assert.equal(dv.getUint32(o + 17), crc32(png.subarray(o + 4, o + 17)));
  const jpg = setJpegDpi(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 2]), 600);
  assert.deepEqual(Array.from(jpg.subarray(2, 20)), [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, 2, 88, 2, 88, 0, 0]);
});

test('error codes are translated (with and without detail) in both languages', () => {
  const tEs = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('es', k, v);
  const tEn = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
  assert.equal(describeError('MRM_ERR:NO_FACES', tEn), 'The file has no faces (a triangulated mesh is required, not a point cloud)');
  assert.equal(describeError('MRM_ERR:TOO_SMALL:42', tEs), 'La malla es demasiado pequeña para el análisis (42 vértices; mínimo 100)');
  assert.equal(describeError("Error invoking remote method 'poisson:run': Error: MRM_ERR:POISSON_TIMEOUT", tEn).startsWith('Poisson reconstruction exceeded'), true);
  assert.equal(describeError('MRM_ERR:FORMAT', tEs), 'Formato no admitido. Usa OBJ, PLY o STL');
  assert.equal(describeError('something else', tEs), 'something else');
});
