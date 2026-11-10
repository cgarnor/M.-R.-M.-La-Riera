/**
 * Rqr classification and descriptive statistics.
 *
 * This module is a line-by-line port of the v2 Python scripts
 * (Pythonplugin/mrm_roughness.py, CloudComPy/mrm_roughness_cloudcompy.py) so that the app and
 * the scripts produce identical classes:
 *   - exact Fisher-Jenks (dynamic programming on a deterministic quantile sample)
 *   - "legacy" Jenks (v1 algorithm, reproduces the published values)
 *   - auto-k (elbow = max |second difference| of the GVF, k = 2..10)
 *   - mu +/- sigma (6 classes)
 */
import type { ClassParams, DistStats } from './types';

export type ClassMethod = 'jenks' | 'autok' | 'sigma';

export interface Classification {
  method: ClassMethod;
  /** Upper bounds of classes 1..k-1 (value <= breaks[b] -> class b+1). */
  breaks: number[];
  k: number;
  /** For sigma: strict "<" comparison instead of "<=". */
  strict: boolean;
  /** GVF per k (auto-k only), k = autoKMin..autoKMax. */
  gvf?: number[];
}

// ─── Basic statistics ───────────────────────────────────────────────

export function sortedCopy(values: ArrayLike<number>): Float64Array {
  const s = Float64Array.from(values as ArrayLike<number>);
  s.sort();
  return s;
}

/** numpy.percentile(a, q) with the default "linear" method, on an already sorted array. */
export function percentileSorted(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const qq = q / 100;
  // numpy: virtual_index = n*q + (alpha + q*(1-alpha-beta)) - 1, alpha = beta = 1
  let vi = n * qq + (1 + qq * (1 - 1 - 1)) - 1;
  if (vi < 0) vi = 0;
  if (vi > n - 1) vi = n - 1;
  const prev = Math.floor(vi);
  const next = Math.min(prev + 1, n - 1);
  const t = vi - prev;
  const a = sorted[prev];
  const b = sorted[next];
  const diff = b - a;
  // numpy _lerp: a + diff*t, but b - diff*(1-t) when t >= 0.5
  return t >= 0.5 ? b - diff * (1 - t) : a + diff * t;
}

export function computeStats(values: ArrayLike<number>, sorted?: Float64Array): DistStats {
  const s = sorted ?? sortedCopy(values);
  const n = s.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = s[i] - mean;
    sq += d * d;
  }
  return {
    n,
    min: s[0],
    max: s[n - 1],
    mean,
    std: Math.sqrt(sq / n),
    median: percentileSorted(s, 50),
    p5: percentileSorted(s, 5),
    p25: percentileSorted(s, 25),
    p75: percentileSorted(s, 75),
    p95: percentileSorted(s, 95),
  };
}

// ─── Class assignment ───────────────────────────────────────────────

/** First-match rule, identical to the scripts: class b+1 if value <= breaks[b] ("<" if strict). */
export function classOf(value: number, breaks: number[], strict: boolean): number {
  if (strict) {
    for (let b = 0; b < breaks.length; b++) if (value < breaks[b]) return b + 1;
  } else {
    for (let b = 0; b < breaks.length; b++) if (value <= breaks[b]) return b + 1;
  }
  return breaks.length + 1;
}

export function applyClassification(values: ArrayLike<number>, c: Pick<Classification, 'breaks' | 'strict'>): Uint8Array {
  const out = new Uint8Array(values.length);
  const { breaks, strict } = c;
  for (let i = 0; i < values.length; i++) out[i] = classOf(values[i], breaks, strict);
  return out;
}

export function classDistribution(classes: Uint8Array, k: number): number[] {
  const counts = new Array(k).fill(0);
  for (let i = 0; i < classes.length; i++) counts[classes[i] - 1]++;
  return counts.map((c) => (100 * c) / classes.length);
}

/** Goodness of Variance Fit on the full data: 1 - SDCM / SDAM. */
export function computeGvf(values: ArrayLike<number>, breaks: number[], k: number, strict = false): number {
  const n = values.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += values[i];
  const mean = total / n;
  const sums = new Float64Array(k);
  const counts = new Float64Array(k);
  const cls = new Uint8Array(n);
  let sdam = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    sdam += (v - mean) * (v - mean);
    const c = classOf(v, breaks, strict) - 1;
    cls[i] = c;
    sums[c] += v;
    counts[c]++;
  }
  if (sdam === 0) return 1;
  const means = new Float64Array(k);
  for (let c = 0; c < k; c++) means[c] = counts[c] > 0 ? sums[c] / counts[c] : 0;
  let sdcm = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - means[cls[i]];
    sdcm += d * d;
  }
  return 1 - sdcm / sdam;
}

/** Elbow = argmax |GVF[i-1] - 2 GVF[i] + GVF[i+1]| (first maximum, like numpy.argmax). */
export function elbowK(gvf: number[], kMin: number): number {
  if (gvf.length < 3) return kMin;
  let best = -Infinity;
  let bestIdx = 0;
  for (let i = 1; i < gvf.length - 1; i++) {
    const d2 = Math.abs(gvf[i - 1] - 2 * gvf[i] + gvf[i + 1]);
    if (d2 > best) {
      best = d2;
      bestIdx = i - 1;
    }
  }
  return kMin + bestIdx + 1;
}

// ─── Exact Fisher-Jenks ─────────────────────────────────────────────

/** Deterministic sample: m values evenly spaced in rank over the sorted distribution. */
export function quantileSample(sorted: Float64Array, m: number): Float64Array {
  const n = sorted.length;
  if (n <= m) return sorted.slice();
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) out[i] = sorted[Math.floor((i * (n - 1)) / (m - 1))];
  return out;
}

/**
 * Fisher (1958) optimal partition of a sorted sample into k = 1..kMax contiguous classes
 * minimising the within-class sum of squares. Returns breaks[k] = upper bounds of classes 1..k-1.
 */
export function fisherJenksAll(sample: Float64Array, kMax: number): number[][] {
  const n = sample.length;
  const c1 = new Float64Array(n + 1);
  const c2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    c1[i + 1] = c1[i] + sample[i];
    c2[i + 1] = c2[i] + sample[i] * sample[i];
  }
  const W = n + 1;
  const D = new Float64Array((kMax + 1) * W).fill(Infinity);
  const B = new Int32Array((kMax + 1) * W);
  D[0] = 0;
  for (let m = 1; m <= kMax; m++) {
    const prev = (m - 1) * W;
    const cur = m * W;
    for (let j = m; j <= n; j++) {
      const c1j = c1[j];
      const c2j = c2[j];
      let best = Infinity;
      let bestI = m - 1;
      for (let i = m - 1; i < j; i++) {
        const sm = c1j - c1[i];
        const cost = D[prev + i] + (c2j - c2[i]) - (sm * sm) / (j - i);
        if (cost < best) {
          best = cost;
          bestI = i;
        }
      }
      D[cur + j] = best;
      B[cur + j] = bestI;
    }
  }
  const out: number[][] = [[]];
  for (let k = 1; k <= kMax; k++) {
    if (k > n) {
      // Fewer values than classes: the extra classes are empty (repeat the last value).
      const base = out[n] ?? [];
      out[k] = [...base, ...new Array(k - 1 - base.length).fill(sample[n - 1])];
      continue;
    }
    const starts: number[] = [];
    let j = n;
    for (let m = k; m >= 1; m--) {
      const i = B[m * W + j];
      starts.push(i);
      j = i;
    }
    starts.sort((a, b) => a - b);
    out[k] = starts.slice(1).map((st) => sample[st - 1]);
  }
  return out;
}

// ─── Legacy Jenks (v1 scripts, reproduces published values) ─────────

export function legacyJenks(sorted: Float64Array, nClasses: number, maxIter = 30): number[] {
  const n = sorted.length;
  const nSamples = Math.min(n, 3000);
  const step = Math.max(1, Math.floor(n / nSamples));
  const smp: number[] = [];
  for (let i = 0; i < n; i += step) smp.push(sorted[i]);
  if (smp[smp.length - 1] !== sorted[n - 1]) smp.push(sorted[n - 1]);
  const L = smp.length;
  const breaks: number[] = [];
  for (let i = 0; i < nClasses - 1; i++) breaks.push(smp[Math.floor(((i + 1) * L) / nClasses)]);
  for (let it = 0; it < maxIter; it++) {
    const sums = new Array(nClasses).fill(0);
    const counts = new Array(nClasses).fill(0);
    for (const s of smp) {
      let cls = nClasses - 1;
      for (let b = 0; b < breaks.length; b++) {
        if (s <= breaks[b]) {
          cls = b;
          break;
        }
      }
      sums[cls] += s;
      counts[cls]++;
    }
    const means = sums.map((s, c) => (counts[c] > 0 ? s / Math.max(counts[c], 1) : 0));
    let changed = false;
    for (let b = 0; b < breaks.length; b++) {
      if (counts[b] > 0 && counts[b + 1] > 0) {
        const nb = (means[b] + means[b + 1]) / 2;
        if (Math.abs(nb - breaks[b]) > 0.0001) changed = true;
        breaks[b] = nb;
      }
    }
    if (!changed) break;
  }
  return breaks;
}

// ─── Sigma ──────────────────────────────────────────────────────────

export function sigmaBreaks(mean: number, std: number): number[] {
  return [
    Math.max(0, mean - 2 * std),
    Math.max(0, mean - std),
    Math.max(0, mean - 0.5 * std),
    mean + 0.5 * std,
    mean + std,
  ];
}

// ─── High-level API ─────────────────────────────────────────────────

/** Everything needed to classify one artefact (or a pooled reference distribution). */
export interface ClassSource {
  /** Full data used for GVF / class assignment. */
  values: ArrayLike<number>;
  /** Sorted full data (or pooled equal-weight sample for common scales). */
  sorted: Float64Array;
  mean: number;
  std: number;
}

export function makeSource(values: ArrayLike<number>): ClassSource {
  const sorted = sortedCopy(values);
  const st = computeStats(values, sorted);
  return { values, sorted, mean: st.mean, std: st.std };
}

export function classify(src: ClassSource, method: ClassMethod, p: ClassParams): Classification {
  switch (method) {
    case 'sigma':
      return { method, breaks: sigmaBreaks(src.mean, src.std), k: 6, strict: true };
    case 'jenks': {
      const breaks =
        p.jenksMethod === 'legacy'
          ? legacyJenks(src.sorted, p.jenksClasses)
          : fisherJenksAll(quantileSample(src.sorted, p.jenksSample), p.jenksClasses)[p.jenksClasses];
      return { method, breaks, k: p.jenksClasses, strict: false };
    }
    case 'autok': {
      const all =
        p.jenksMethod === 'legacy'
          ? null
          : fisherJenksAll(quantileSample(src.sorted, p.jenksSample), Math.max(p.autoKMax, p.jenksClasses));
      const gvf: number[] = [];
      const brs: Record<number, number[]> = {};
      for (let k = p.autoKMin; k <= p.autoKMax; k++) {
        const b = all ? all[k] : legacyJenks(src.sorted, k);
        brs[k] = b;
        gvf.push(computeGvf(src.values, b, k));
      }
      const k = Math.max(p.autoKMin, Math.min(elbowK(gvf, p.autoKMin), p.autoKMax));
      return { method, breaks: brs[k], k, strict: false, gvf };
    }
  }
}

/**
 * Pooled reference distribution for a common scale across artefacts.
 * Every artefact contributes the same number of values (equal weight regardless of mesh size).
 */
export function makePooledSource(items: { sorted: Float64Array; mean: number; std: number }[], perItem: number): ClassSource {
  const parts = items.map((it) => quantileSample(it.sorted, perItem));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const pooled = new Float64Array(total);
  let o = 0;
  for (const p of parts) {
    pooled.set(p, o);
    o += p.length;
  }
  pooled.sort();
  // Equal-weight mixture moments (exact, from per-item full-data moments)
  const mean = items.reduce((s, it) => s + it.mean, 0) / items.length;
  const variance = items.reduce((s, it) => s + it.std * it.std + (it.mean - mean) ** 2, 0) / items.length;
  return { values: pooled, sorted: pooled, mean, std: Math.sqrt(variance) };
}
