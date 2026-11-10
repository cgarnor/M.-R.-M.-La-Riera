/**
 * App-level data model: artefacts, units, settings.
 */
import type { ClassMethod, ClassSource } from '../engine/classify';
import type { ClassParams, MrmParams, MrmResult } from '../engine/types';

export type Unit = 'm' | 'cm' | 'mm' | 'um';
export const UNITS: Unit[] = ['m', 'cm', 'mm', 'um'];
/** Multiply model units by this factor to obtain millimetres. */
export const TO_MM: Record<Unit, number> = { m: 1000, cm: 10, mm: 1, um: 0.001 };
export const UNIT_LABEL: Record<Unit, string> = { m: 'm', cm: 'cm', mm: 'mm', um: 'µm' };

/** Heuristic for hand-held artefacts (≈1–50 cm): guess the unit from the largest bbox side. */
export function guessUnit(maxDim: number): Unit {
  if (maxDim < 1.5) return 'm';
  if (maxDim < 60) return 'cm';
  if (maxDim < 5000) return 'mm';
  return 'um';
}

export type Status = 'queued' | 'loading' | 'processing' | 'done' | 'error';

export interface ArtefactMeta {
  site: string;
  type: string;
  material: string;
  notes: string;
}

/** Optional physical dimensions in mm (overrides model scale when unscaled or inaccurate). */
export interface ArtefactDims {
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
}

export interface Artefact {
  id: string;
  name: string;
  fileName: string;
  meta: ArtefactMeta;
  unit: Unit;
  unitConfirmed: boolean;
  dims?: ArtefactDims;
  status: Status;
  stage: string;
  progress: number;
  error?: string;
  params: MrmParams;
  result?: MrmResult;
  /** Lazily computed sorted Rqr + moments (for classification). */
  source?: ClassSource;
  /** Bumped whenever heavy data changes (used as cache key). */
  version: number;
}

/** [length >= width >= thickness] of the model in raw model units (principal axes; AABB for old projects). */
export function modelDimsSorted(a: Artefact): [number, number, number] | null {
  if (!a.result) return null;
  const src = a.result.info.principalSize ?? a.result.info.bboxSize;
  const s = [...src].sort((x, y) => y - x);
  return [s[0] || 1, s[1] || 1, s[2] || 1];
}

const validDim = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Measured dimensions entered by the user, as [index (0 = length, 1 = width, 2 = thickness), mm]. */
function enteredDims(a: Artefact): [number, number][] {
  const d = a.dims;
  if (!d) return [];
  const out: [number, number][] = [];
  if (validDim(d.lengthMm)) out.push([0, d.lengthMm]);
  if (validDim(d.widthMm)) out.push([1, d.widthMm]);
  if (validDim(d.thicknessMm)) out.push([2, d.thicknessMm]);
  return out;
}

export function hasCustomDims(a: Artefact): boolean {
  return enteredDims(a).length > 0;
}

/**
 * Factor that converts raw model units to millimetres.
 * If measured dimensions are entered, the model is rescaled uniformly to fit them
 * (least squares over the entered dimensions); otherwise the declared model unit is used.
 */
export function artefactToMm(a: Artefact): number {
  const md = modelDimsSorted(a);
  const ent = enteredDims(a);
  if (md && ent.length) {
    let num = 0, den = 0;
    for (const [i, mm] of ent) { num += mm * md[i]; den += md[i] * md[i]; }
    if (den > 0) return num / den;
  }
  return TO_MM[a.unit];
}

/** [length, width, thickness] in mm of the model as the app uses it (after scaling). */
export function artefactDimsMm(a: Artefact): [number, number, number] | null {
  const md = modelDimsSorted(a);
  if (!md) return null;
  const f = artefactToMm(a);
  return [md[0] * f, md[1] * f, md[2] * f];
}

/** Largest relative difference (%) between entered and scaled model dimensions (0 if < 2 entered). */
export function dimsMismatchPct(a: Artefact): number {
  const ent = enteredDims(a);
  const dm = artefactDimsMm(a);
  if (!dm || ent.length < 2) return 0;
  return Math.max(...ent.map(([i, mm]) => (100 * Math.abs(dm[i] - mm)) / mm));
}

export type ViewMode = 'original' | 'trend' | 'mrm' | 'rqr' | 'classes';
export type ColorRamp = 'bgyr' | 'coolwarm' | 'grey';
export type ScaleMode = 'piece' | 'common';

export interface Settings {
  classParams: ClassParams;
  method: ClassMethod;
  scaleMode: ScaleMode;
  viewMode: ViewMode;
  ramp: ColorRamp;
  /** Half-range of the MRM colour scale in mm (null = automatic ±3σ). */
  mrmRangeMm: number | null;
  lightAzimuth: number;
  lightElevation: number;
  syncCameras: boolean;
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `a${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Identity of the current data and record of an artefact (used to detect unsaved changes). */
export function artefactKey(a: Pick<Artefact, 'id' | 'version' | 'name' | 'meta' | 'unit' | 'unitConfirmed' | 'dims'>): string {
  return JSON.stringify([a.id, a.version, a.name, a.meta, a.unit, a.unitConfirmed, a.dims ?? null]);
}
