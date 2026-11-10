/**
 * Statistics and classification: numpy-compatible percentiles, exact Fisher-Jenks against brute
 * force, legacy Jenks, auto-k, mu +/- sigma, common scale and degenerate inputs.
 */
import { assert, close, test } from './harness';
import {
  applyClassification, classify, classOf, computeGvf, computeStats, elbowK, fisherJenksAll, makePooledSource,
  makeSource, percentileSorted, quantileSample, sigmaBreaks, sortedCopy,
} from '../src/engine/classify';
import { DEFAULT_CLASS_PARAMS } from '../src/engine/types';
import { mulberry32 } from '../src/engine/mesh';

test('percentiles and moments match numpy (linear method, population std)', () => {
  const s = sortedCopy([4, 1, 3, 2]);
  close(percentileSorted(s, 25), 1.75, 1e-15);
  close(percentileSorted(s, 50), 2.5, 1e-15);
  close(percentileSorted(s, 95), 3.85, 1e-12);
  const st = computeStats([1, 2, 3, 4]);
  close(st.mean, 2.5, 1e-15);
  close(st.std, Math.sqrt(1.25), 1e-15);
  assert.equal(st.min, 1);
  assert.equal(st.max, 4);
});

/** Within-class sum of squares of a partition given by breaks (value <= break -> lower class). */
function sse(values: number[], breaks: number[]): number {
  const groups: number[][] = Array.from({ length: breaks.length + 1 }, () => []);
  for (const v of values) groups[classOf(v, breaks, false) - 1].push(v);
  return groups.reduce((s, g) => {
    if (!g.length) return s;
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    return s + g.reduce((a, b) => a + (b - m) ** 2, 0);
  }, 0);
}

test('exact Fisher-Jenks equals the brute-force optimum (k = 2..4)', () => {
  const rnd = mulberry32(42);
  for (let trial = 0; trial < 20; trial++) {
    const v = Array.from({ length: 14 }, () => Math.round(rnd() * 1000) / 100).sort((a, b) => a - b);
    const all = fisherJenksAll(Float64Array.from(v), 4);
    for (let k = 2; k <= 4; k++) {
      let best = Infinity;
      const rec = (start: number, left: number, br: number[]) => {
        if (left === 0) { best = Math.min(best, sse(v, br)); return; }
        for (let i = start; i < v.length - left; i++) rec(i + 1, left - 1, [...br, v[i]]);
      };
      rec(0, k - 1, []);
      close(sse(v, all[k]), best, 1e-9, `trial ${trial} k ${k}`);
      assert.ok(all[k].every((b, i) => i === 0 || b >= all[k][i - 1]), 'breaks sorted');
    }
  }
});

test('Fisher-Jenks with fewer values than classes does not produce NaN', () => {
  const all = fisherJenksAll(Float64Array.from([1, 2, 3]), 6);
  for (let k = 1; k <= 6; k++) {
    assert.equal(all[k].length, k - 1);
    assert.ok(all[k].every(Number.isFinite));
  }
});

test('class assignment rules (<= for Jenks, < for sigma) and GVF', () => {
  assert.equal(classOf(2, [2, 5], false), 1);
  assert.equal(classOf(2, [2, 5], true), 2);
  assert.equal(classOf(9, [2, 5], false), 3);
  assert.deepEqual(Array.from(applyClassification([1, 2, 3, 6], { breaks: [2, 5], strict: false })), [1, 1, 2, 3]);
  close(computeGvf([1, 1, 5, 5], [1], 2), 1, 1e-15);
  assert.equal(computeGvf([3, 3, 3], [3], 2), 1);
});

test('sigma thresholds are clamped at 0 and auto-k elbow picks the largest curvature', () => {
  assert.deepEqual(sigmaBreaks(1, 1), [0, 0, 0.5, 1.5, 2]);
  assert.equal(elbowK([0.5, 0.9, 0.95, 0.97], 2), 3);
  assert.equal(elbowK([0.5, 0.6], 2), 2);
});

test('classify(): 6 Jenks classes, auto-k in range, legacy and sigma on a skewed distribution', () => {
  const rnd = mulberry32(7);
  const v = Float64Array.from({ length: 20000 }, () => -Math.log(1 - rnd()) * 0.01);
  const src = makeSource(v);
  const j = classify(src, 'jenks', DEFAULT_CLASS_PARAMS);
  assert.equal(j.k, 6);
  assert.equal(j.breaks.length, 5);
  const a = classify(src, 'autok', DEFAULT_CLASS_PARAMS);
  assert.ok(a.k >= 2 && a.k <= 10 && a.breaks.length === a.k - 1 && a.gvf!.length === 9);
  const l = classify(src, 'jenks', { ...DEFAULT_CLASS_PARAMS, jenksMethod: 'legacy' });
  assert.equal(l.breaks.length, 5);
  const s = classify(src, 'sigma', DEFAULT_CLASS_PARAMS);
  assert.ok(s.strict && s.k === 6);
  // Exact Jenks is scale invariant (the result does not depend on the model units).
  const scaled = classify(makeSource(v.map((x) => x * 1000)), 'jenks', DEFAULT_CLASS_PARAMS);
  scaled.breaks.forEach((b, i) => close(b / 1000, j.breaks[i], 1e-12));
});

test('quantile sample and pooled (common scale) moments', () => {
  const s = Float64Array.from({ length: 10001 }, (_, i) => i);
  const q = quantileSample(s, 5);
  assert.deepEqual(Array.from(q), [0, 2500, 5000, 7500, 10000]);
  const A = makeSource([1, 2, 3]), B = makeSource([10, 20, 30, 40, 50]);
  const pooled = makePooledSource([A, B], 4000);
  close(pooled.mean, (A.mean + B.mean) / 2, 1e-12);
  close(pooled.std, Math.sqrt((A.std ** 2 + B.std ** 2) / 2 + ((A.mean - B.mean) / 2) ** 2), 1e-12);
});
