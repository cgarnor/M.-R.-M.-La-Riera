/**
 * Classification cache + colour scales used by the UI.
 */
import {
  applyClassification, classDistribution, classify, makePooledSource, makeSource,
  type ClassMethod, type Classification, type ClassSource,
} from '../engine/classify';
import type { ClassParams } from '../engine/types';
import { artefactToMm, hasCustomDims, type Artefact, type ColorRamp, type ScaleMode } from './model';

export interface ArtefactClasses {
  classification: Classification;
  classes: Uint8Array;
  /** % of vertices per class. */
  distribution: number[];
}

export function getSource(a: Artefact): ClassSource | null {
  if (!a.result) return null;
  if (!a.source) a.source = makeSource(a.result.rqr);
  return a.source;
}

const POOL_PER_ITEM = 4000;
const cache = new Map<string, ArtefactClasses>();
const refCache = new Map<string, Classification>();

function paramsKey(p: ClassParams): string {
  return `${p.jenksMethod}|${p.jenksSample}|${p.jenksClasses}|${p.autoKMin}-${p.autoKMax}`;
}

/**
 * Classes for every processed artefact.
 * scale = 'piece': thresholds from each artefact's own distribution.
 * scale = 'common': thresholds from the pooled (equal-weight) distribution of `reference`.
 */
export function computeClasses(
  artefacts: Artefact[],
  reference: Artefact[],
  method: ClassMethod,
  params: ClassParams,
  scale: ScaleMode,
): Map<string, ArtefactClasses> {
  const out = new Map<string, ArtefactClasses>();
  const usedKeys = new Set<string>();
  const pk = paramsKey(params);
  const done = artefacts.filter((a) => a.result);
  let common: Classification | null = null;
  let refKey = '';
  const refs = reference.filter((a) => a.result);
  if (scale === 'common' && refs.length >= 2) {
    refKey = refs.map((a) => `${a.id}:${a.version}:${artefactToMm(a).toPrecision(8)}`).join(',');
    const ck = `${refKey}|${method}|${pk}`;
    common = refCache.get(ck) ?? null;
    if (!common) {
      // Pool in millimetres: artefacts may come in different model units or custom scales.
      const items = refs.map((a) => {
        const s = getSource(a)!;
        const f = artefactToMm(a);
        return { sorted: s.sorted.map((v) => v * f), mean: s.mean * f, std: s.std * f };
      });
      const pooled = makePooledSource(items, POOL_PER_ITEM);
      // The legacy algorithm is defined per piece; the common scale always uses exact Jenks.
      common = classify(pooled, method, { ...params, jenksMethod: 'exact' });
      refCache.set(ck, common);
    }
  }
  for (const a of done) {
    const f = artefactToMm(a);
    const custom = hasCustomDims(a);
    const key = `${a.id}:${a.version}:${f.toPrecision(8)}:${custom ? 1 : 0}|${method}|${pk}|${common ? refKey : 'piece'}`;
    usedKeys.add(key);
    let entry = cache.get(key);
    if (!entry) {
      let cls: Classification;
      if (common) {
        // Common thresholds are in mm; convert them to this artefact's raw model units.
        cls = { ...common, breaks: common.breaks.map((b) => b / f) };
      } else if (custom && params.jenksMethod === 'legacy' && (method === 'jenks' || method === 'autok')) {
        // Legacy Jenks uses a 0.0001 m tolerance; scale custom-dimensioned models to metres first.
        const s = getSource(a)!;
        const toM = f / 1000;
        const scaled: ClassSource = {
          values: Array.from(s.values, (v) => v * toM),
          sorted: s.sorted.map((v) => v * toM),
          mean: s.mean * toM,
          std: s.std * toM,
        };
        const c = classify(scaled, method, params);
        cls = { ...c, breaks: c.breaks.map((b) => b / toM) };
      } else {
        cls = classify(getSource(a)!, method, params);
      }
      const classes = applyClassification(a.result!.rqr, cls);
      entry = { classification: cls, classes, distribution: classDistribution(classes, cls.k) };
      cache.set(key, entry);
    }
    out.set(a.id, entry);
  }
  // Keep memory bounded (each entry holds one byte per vertex)
  if (cache.size > 120) {
    for (const k of Array.from(cache.keys())) if (!usedKeys.has(k)) cache.delete(k);
  }
  return out;
}

export function clearArtefactCache(id: string): void {
  for (const k of Array.from(cache.keys())) if (k.startsWith(id + ':')) cache.delete(k);
}

// ─── Colours ────────────────────────────────────────────────────────

type RGB = [number, number, number];

function lerpStops(stops: [number, RGB][], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const u = (x - t0) / (t1 - t0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * CloudCompare "Blue > Green > Yellow > Red":
 *   0 (low Rqr = most polished) → Deep Blue
 *   0.25                        → Cyan
 *   0.50                        → Green
 *   0.75                        → Yellow
 *   1 (high Rqr = least polished) → Red
 */
const BGYR: [number, RGB][] = [
  [0, [0.04, 0.25, 0.96]],
  [0.25, [0.0, 0.72, 0.88]],
  [0.5, [0.1, 0.8, 0.22]],
  [0.75, [0.96, 0.86, 0.06]],
  [1, [0.92, 0.12, 0.12]],
];
const COOLWARM: [number, RGB][] = [[0, [0.15, 0.3, 0.85]], [0.5, [0.87, 0.87, 0.87]], [1, [0.82, 0.1, 0.15]]];
const GREY: [number, RGB][] = [[0, [0.1, 0.1, 0.1]], [1, [0.95, 0.95, 0.95]]];

export function rampColor(ramp: ColorRamp, t: number): RGB {
  return lerpStops(ramp === 'bgyr' ? BGYR : ramp === 'coolwarm' ? COOLWARM : GREY, t);
}

export function rampCss(ramp: ColorRamp, direction = 'to right'): string {
  const stops = ramp === 'bgyr' ? BGYR : ramp === 'coolwarm' ? COOLWARM : GREY;
  return `linear-gradient(${direction}, ${stops
    .map(([t, c]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)}) ${Math.round(t * 100)}%`)
    .join(', ')})`;
}

/**
 * Class colours R1 (smoothest / most polished = deep blue) → R6 (roughest / least polished = red),
 * matching the CloudCompare BGYR scale in Figures 13–15 of the article.
 */
const SIX: RGB[] = [
  [0.05, 0.28, 0.96], // R1 - muy baja (más pulido): azul intenso
  [0.0, 0.68, 0.88],  // R2 - baja: cian / azul-verde
  [0.1, 0.78, 0.26],  // R3 - media-baja: verde
  [0.95, 0.85, 0.08], // R4 - media-alta: amarillo
  [0.97, 0.48, 0.06], // R5 - alta: naranja
  [0.92, 0.12, 0.12], // R6 - muy alta (menos pulido): rojo intenso
];

export function classColors(k: number): RGB[] {
  if (k === 6) return SIX;
  const out: RGB[] = [];
  for (let i = 0; i < k; i++) out.push(lerpStops(BGYR, k > 1 ? i / (k - 1) : 0));
  return out;
}

/** Converts an sRGB component [0..1] to Three.js Linear-sRGB so vertex colours are not gamma-washed. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const toCss = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

// ─── Number formatting (decimal comma in Spanish, point in English) ──

let decimalComma = true;

/** Sets the decimal separator used by every on-screen and figure label. */
export function setNumberLang(lang: 'es' | 'en'): void {
  decimalComma = lang === 'es';
}

const localise = (s: string) => (decimalComma ? s.replace('.', ',') : s);

/** Fixed-point number with the decimal separator of the interface language. */
export function fmtNum(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '–';
  return localise(v.toFixed(digits));
}

/** Formats a value already converted to mm with sensible precision. */
export function fmtMm(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && a < 0.001) return localise(v.toExponential(2));
  return localise(v.toFixed(digits));
}

/** Integer with thousands separators of the interface language. */
export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString(decimalComma ? 'es-ES' : 'en-GB');
}
