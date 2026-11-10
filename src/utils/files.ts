/**
 * File output: native save dialog (Electron) with browser download fallback,
 * PLY / CSV exports and the binary .mrm v2 project container.
 */
import { writeMeshPly } from '../engine/mesh';
import { computeStats, sortedCopy } from '../engine/classify';
import { principalExtents } from '../engine/pca';
import { MrmError } from '../engine/errors';
import { sanitizeClassParams, sanitizeMrmParams, type MrmResult } from '../engine/types';
import type { ArtefactClasses } from '../state/analysis';
import { UNITS, newId, type Artefact, type ArtefactDims, type Settings, type Unit } from '../state/model';

export async function saveBytes(defaultName: string, data: Uint8Array, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (window.mrmNative?.saveFile) return window.mrmNative.saveFile(defaultName, [filter], data);
  const blob = new Blob([data as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return defaultName;
}

/** File-name safe version of a user-entered name (Windows reserved characters and names removed). */
export const safeName = (s: string) => {
  const n = s.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/[. ]+$/, '').trim().slice(0, 120);
  return !n ? 'artefact' : /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n) ? `_${n}` : n;
};

/** Saves several files into a folder chosen by the user (desktop) or as individual downloads (browser). */
export async function saveManyFiles(title: string, files: { name: string; data: Uint8Array }[], lang: string): Promise<string | null> {
  if (window.mrmNative?.saveMany) return window.mrmNative.saveMany(title, files, lang);
  for (const f of files) {
    const url = URL.createObjectURL(new Blob([f.data as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return files.length ? 'downloads' : null;
}

// ─── PLY exports ────────────────────────────────────────────────────

/** Header comments describing the units of an exported PLY. */
function plyComments(title: string, a: Artefact, mmPerUnit: number, scalars: boolean): string[] {
  const c = [`MRM Analysis Tool ${__APP_VERSION__}`, `${title}: ${a.name}`, `source file: ${a.fileName}`];
  c.push(`coordinates in original model units; 1 model unit = ${mmPerUnit.toPrecision(8)} mm`);
  if (scalars) c.push('scalar_MRM_Residuals and scalar_Rqr in model units (multiply by the factor above for mm); class fields: 1 = lowest Rqr');
  return c;
}

export function artefactPly(a: Artefact, classes: { label: string; data: ArtefactClasses }[], mmPerUnit: number): Uint8Array {
  const r = a.result!;
  const scalars: { name: string; values: ArrayLike<number> }[] = [
    { name: 'MRM_Residuals', values: r.residuals },
    { name: 'Rqr', values: r.rqr },
    ...classes.map((c) => ({ name: c.label, values: c.data.classes })),
  ];
  return writeMeshPly(r.mesh.positions, r.mesh.indices, r.mesh.offset, scalars, plyComments('artefact', a, mmPerUnit, true));
}

export function trendPly(a: Artefact, mmPerUnit: number): Uint8Array {
  const r = a.result!;
  return writeMeshPly(r.trend.positions, r.trend.indices, r.mesh.offset, [], plyComments('MRM trend surface', a, mmPerUnit, false));
}

// ─── CSV ────────────────────────────────────────────────────────────

/** Number with decimal comma and without exponent (European CSV convention, matches the ";" separator). */
function csvNumber(v: number): string {
  if (!Number.isFinite(v)) return '';
  let s = String(v);
  if (/e/i.test(s)) s = Math.abs(v) < 1 ? v.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(0);
  return s.replace('.', ',');
}

/**
 * Text cell: neutralises spreadsheet formulas (CSV injection, values starting with = + - @ or a
 * control character are prefixed with an apostrophe) and quotes it when needed.
 */
function csvText(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ";"-separated CSV with decimal comma and BOM, so Excel (es-ES) opens it correctly. */
export function toCsv(rows: (string | number)[][]): Uint8Array {
  const cell = (v: string | number) => (typeof v === 'number' ? csvNumber(v) : csvText(v));
  return new TextEncoder().encode('\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n');
}

// ─── Project container (.mrm v2) ────────────────────────────────────
// [ "MRMP" | u32 version=2 | u32 jsonLength | json (utf-8) | binary blobs ]

type BlobKind = 'f32' | 'f64' | 'u32';
interface BlobRef { o: number; n: number; k: BlobKind }

const MAGIC = 0x504d524d; // "MRMP" little endian
const FORMAT_VERSION = 2;
const BYTES: Record<BlobKind, number> = { f32: 4, f64: 8, u32: 4 };

export function serializeProject(artefacts: Artefact[], settings: Settings): Uint8Array {
  const blobs: Uint8Array[] = [];
  let offset = 0;
  const add = (arr: Float32Array | Float64Array | Uint32Array, k: BlobKind): BlobRef => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (8 - (offset % 8)) % 8; // keep 8-byte alignment
    if (pad) { blobs.push(new Uint8Array(pad)); offset += pad; }
    const ref = { o: offset, n: arr.length, k };
    blobs.push(bytes);
    offset += bytes.byteLength;
    return ref;
  };
  const items = artefacts.filter((a) => a.result).map((a) => {
    const r = a.result!;
    return {
      id: a.id, name: a.name, fileName: a.fileName, meta: a.meta, unit: a.unit, unitConfirmed: a.unitConfirmed, dims: a.dims, params: r.params,
      offset: r.mesh.offset, info: r.info,
      data: {
        positions: add(r.mesh.positions, 'f32'),
        indices: add(r.mesh.indices, 'u32'),
        trendPositions: add(r.trend.positions, 'f32'),
        trendIndices: add(r.trend.indices, 'u32'),
        residuals: add(r.residuals, 'f32'),
        rqr: add(r.rqr, 'f64'),
      },
    };
  });
  const json = new TextEncoder().encode(JSON.stringify({
    app: 'MRM Analysis Tool', appVersion: __APP_VERSION__, format: FORMAT_VERSION, saved: new Date().toISOString(),
    settings: { classParams: settings.classParams, method: settings.method, scaleMode: settings.scaleMode },
    artefacts: items,
  }));
  const headLen = 12 + json.byteLength;
  const dataStart = Math.ceil(headLen / 8) * 8;
  const out = new Uint8Array(dataStart + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, FORMAT_VERSION, true);
  dv.setUint32(8, json.byteLength, true);
  out.set(json, 12);
  let o = dataStart;
  for (const b of blobs) { out.set(b, o); o += b.byteLength; }
  return out;
}

export interface LoadedProject {
  artefacts: Artefact[];
  settings?: Partial<Settings>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** String field from untrusted JSON: only strings and finite numbers are accepted. */
const str = (v: unknown, max: number, def = ''): string =>
  (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : def).slice(0, max);
const finiteOr = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const posDim = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7 ? v : undefined);

/** Vertices not referenced by any face. */
function countIsolated(indices: Uint32Array, nv: number): number {
  const used = new Uint8Array(nv);
  for (let i = 0; i < indices.length; i++) used[indices[i]] = 1;
  let n = 0;
  for (let i = 0; i < nv; i++) if (!used[i]) n++;
  return n;
}

function bad(detail: string): never {
  throw new MrmError('PROJECT_INVALID', detail);
}

/**
 * Reads a .mrm project. Project files may come from other people, so everything is validated:
 * blob bounds, array sizes, face indices, finite values, strings and parameters. Statistics and
 * dimensions are recomputed from the stored data instead of being trusted.
 */
export function deserializeProject(buffer: ArrayBuffer): LoadedProject {
  if (buffer.byteLength < 12) bad('size');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) bad('magic');
  const version = dv.getUint32(4, true);
  if (version !== FORMAT_VERSION) {
    // A small number is a real (future or old) format version; anything else is a damaged file.
    if (version > 0 && version < 100) throw new MrmError('PROJECT_VERSION', String(version));
    bad('version');
  }
  const jsonLen = dv.getUint32(8, true);
  if (jsonLen === 0 || 12 + jsonLen > buffer.byteLength) bad('header');
  let head: Json;
  try {
    head = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 12, jsonLen)));
  } catch {
    bad('json');
  }
  if (!head || typeof head !== 'object' || !Array.isArray(head.artefacts)) bad('json');
  const dataStart = Math.ceil((12 + jsonLen) / 8) * 8;

  const get = (ref: Json, k: BlobKind, what: string): Float32Array | Float64Array | Uint32Array => {
    if (!ref || ref.k !== k || !Number.isSafeInteger(ref.o) || !Number.isSafeInteger(ref.n) || ref.o < 0 || ref.n < 0) bad(what);
    const start = dataStart + ref.o;
    const end = start + ref.n * BYTES[k];
    if (end > buffer.byteLength) bad(what);
    const slice = buffer.slice(start, end);
    return k === 'f32' ? new Float32Array(slice) : k === 'u32' ? new Uint32Array(slice) : new Float64Array(slice);
  };

  const usedIds = new Set<string>();
  const artefacts: Artefact[] = head.artefacts.map((it: Json, idx: number) => {
    if (!it || typeof it !== 'object' || !it.data) bad(`artefact ${idx + 1}`);
    const where = (w: string) => `artefact ${idx + 1}: ${w}`;
    const positions = get(it.data.positions, 'f32', where('positions')) as Float32Array;
    const indices = get(it.data.indices, 'u32', where('indices')) as Uint32Array;
    const trendPositions = get(it.data.trendPositions, 'f32', where('trend')) as Float32Array;
    const trendIndices = get(it.data.trendIndices, 'u32', where('trend')) as Uint32Array;
    const residuals = get(it.data.residuals, 'f32', where('residuals')) as Float32Array;
    const rqr = get(it.data.rqr, 'f64', where('rqr')) as Float64Array;
    const nv = positions.length / 3;
    const tnv = trendPositions.length / 3;
    if (!Number.isInteger(nv) || nv < 3 || indices.length < 3 || indices.length % 3) bad(where('mesh'));
    if (!Number.isInteger(tnv) || trendIndices.length % 3) bad(where('trend'));
    if (residuals.length !== nv || rqr.length !== nv) bad(where('scalar fields'));
    for (let i = 0; i < positions.length; i++) if (!Number.isFinite(positions[i])) bad(where('coordinates'));
    for (let i = 0; i < trendPositions.length; i++) if (!Number.isFinite(trendPositions[i])) bad(where('trend'));
    for (let i = 0; i < indices.length; i++) if (indices[i] >= nv) bad(where('face indices'));
    for (let i = 0; i < trendIndices.length; i++) if (trendIndices[i] >= tnv) bad(where('trend'));
    for (let i = 0; i < nv; i++) {
      if (!Number.isFinite(residuals[i])) residuals[i] = 0;
      if (!Number.isFinite(rqr[i])) rqr[i] = 0;
    }

    const offset: [number, number, number] = Array.isArray(it.offset) && it.offset.length === 3 && it.offset.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
      ? [it.offset[0], it.offset[1], it.offset[2]]
      : [0, 0, 0];
    const params = sanitizeMrmParams(it.params);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let d = 0; d < 3; d++) {
        const v = positions[i + d];
        if (v < mn[d]) mn[d] = v;
        if (v > mx[d]) mx[d] = v;
      }
    }
    const info0: Json = it.info && typeof it.info === 'object' ? it.info : {};
    const timingsMs: Record<string, number> = {};
    if (info0.timingsMs && typeof info0.timingsMs === 'object') {
      for (const [k, v] of Object.entries(info0.timingsMs).slice(0, 20)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) timingsMs[str(k, 40)] = v;
    }
    const result: MrmResult = {
      mesh: { positions, indices, offset },
      trend: { positions: trendPositions, indices: trendIndices },
      residuals,
      rqr,
      residualStats: computeStats(residuals, sortedCopy(residuals)),
      rqrStats: computeStats(rqr, sortedCopy(rqr)),
      info: {
        vertexCount: nv,
        faceCount: indices.length / 3,
        sampleCount: Math.max(0, Math.round(finiteOr(info0.sampleCount, 0))),
        trendVertexCount: tnv,
        trendFaceCount: trendIndices.length / 3,
        signFlipsSmoothed: Math.max(0, Math.round(finiteOr(info0.signFlipsSmoothed, 0))),
        bboxSize: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
        principalSize: principalExtents(positions),
        isolatedVertices: countIsolated(indices, nv),
        timingsMs,
      },
      params,
    };
    const meta: Json = it.meta && typeof it.meta === 'object' ? it.meta : {};
    const dims0: Json = it.dims && typeof it.dims === 'object' ? it.dims : {};
    const dims: ArtefactDims = { lengthMm: posDim(dims0.lengthMm), widthMm: posDim(dims0.widthMm), thicknessMm: posDim(dims0.thicknessMm) };
    const hasDims = dims.lengthMm !== undefined || dims.widthMm !== undefined || dims.thicknessMm !== undefined;
    let id = /^[A-Za-z0-9_-]{1,40}$/.test(it.id) ? it.id : newId();
    if (usedIds.has(id)) id = newId();
    usedIds.add(id);
    return {
      id,
      name: str(it.name, 200, `artefact ${idx + 1}`) || `artefact ${idx + 1}`,
      fileName: str(it.fileName, 260),
      meta: { site: str(meta.site, 500), type: str(meta.type, 500), material: str(meta.material, 500), notes: str(meta.notes, 10000) },
      unit: (UNITS as string[]).includes(it.unit) ? (it.unit as Unit) : 'mm',
      // Projects saved before this field existed: the unit was shown to the user when saving.
      unitConfirmed: typeof it.unitConfirmed === 'boolean' ? it.unitConfirmed : true,
      dims: hasDims ? dims : undefined,
      status: 'done', stage: 'done', progress: 1, params, result, version: 1,
    } as Artefact;
  });

  let settings: Partial<Settings> | undefined;
  const s: Json = head.settings;
  if (s && typeof s === 'object') {
    settings = {};
    if (s.classParams) settings.classParams = sanitizeClassParams(s.classParams);
    // Projects saved before the percentile method was removed fall back to Jenks.
    if (typeof s.method === 'string') settings.method = ['jenks', 'autok', 'sigma'].includes(s.method) ? s.method : 'jenks';
    if (s.scaleMode === 'piece' || s.scaleMode === 'common') settings.scaleMode = s.scaleMode;
  }
  return { artefacts, settings };
}
