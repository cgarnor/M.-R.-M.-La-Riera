/**
 * MRM pipeline on synthetic meshes: Rqr against a direct implementation of the definition,
 * CloudCompare-style Laplacian smoothing, residual signs, noise sensitivity and guards.
 */
import { assert, close, test, throwsCode } from './harness';
import { buildAdjacency, computeRqr, laplacianSmoothCC, smoothSignBoundaries } from '../src/engine/mesh';
import { runMrm } from '../src/engine/pipeline';
import { principalExtents } from '../src/engine/pca';
import { DEFAULT_MRM_PARAMS, sanitizeClassParams, sanitizeMrmParams, type MeshData } from '../src/engine/types';

/** Subdivided icosahedron projected on an ellipsoid (semi-axes R, 0.6R, 0.3R) with radial noise. */
export function ellipsoid(sub: number, R: number, noise: number, seed = 3): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = cache.get(k);
      if (m === undefined) { m = v.length; v.push([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]); cache.set(k, m); }
      return m;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  let st = seed;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const pos = new Float32Array(v.length * 3);
  v.forEach((p, i) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    const r = R * (1 + noise * (rnd() - 0.5));
    pos[3 * i] = (p[0] / l) * r; pos[3 * i + 1] = (p[1] / l) * r * 0.6; pos[3 * i + 2] = (p[2] / l) * r * 0.3;
  });
  return { positions: pos, indices: Uint32Array.from(f.flat()), offset: [0, 0, 0] };
}

test('Rqr equals a direct (set-based, like the Python scripts) implementation', () => {
  const m = ellipsoid(3, 10, 0.01);
  const nv = m.positions.length / 3;
  const res = Float32Array.from({ length: nv }, (_, i) => Math.sin(i * 0.37) * 0.01);
  const adj = buildAdjacency(m.indices, nv);
  const rqr = computeRqr(res, adj);
  const sets: Set<number>[] = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]];
    sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
  }
  for (let i = 0; i < nv; i++) {
    const ring = new Set<number>([i]);
    for (const n1 of sets[i]) { ring.add(n1); for (const n2 of sets[n1]) ring.add(n2); }
    const vals = [...ring].map((j) => res[j]);
    const mu = vals.reduce((s, x) => s + x, 0) / vals.length;
    close(rqr[i], Math.sqrt(vals.reduce((s, x) => s + (x - mu) ** 2, 0) / vals.length), 1e-12, `vertex ${i}`);
  }
});

test('Laplacian smoothing (ccMesh::laplacianSmooth) keeps a flat grid flat and moves vertices to the neighbour mean', () => {
  const n = 5, pos: number[] = [], idx: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pos.push(x, y, 0);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const a = y * n + x; idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n); }
  const p = Float32Array.from(pos);
  p[3 * 12 + 2] = 1; // lift the centre vertex
  laplacianSmoothCC(p, Uint32Array.from(idx), 1, 1);
  for (let i = 0; i < n * n; i++) if (i !== 12) assert.ok(Math.abs(p[3 * i + 2]) < 0.5, 'others stay low');
  assert.ok(p[3 * 12 + 2] < 1e-6 && p[3 * 12 + 2] > -1e-6, 'centre moved to its neighbours mean');
});

test('sign-boundary smoothing replaces isolated sign flips only', () => {
  const m = ellipsoid(2, 10, 0);
  const nv = m.positions.length / 3;
  const res = new Float64Array(nv).fill(1);
  res[5] = -1;
  const s = smoothSignBoundaries(res, buildAdjacency(m.indices, nv));
  assert.equal(s.changed, 1);
  assert.ok(s.values[5] > 0);
});

test('pipeline (QEM decimation): finite results, consistent residual sign, Rqr grows with noise', async () => {
  const p = { ...DEFAULT_MRM_PARAMS, trendMethod: 'decimation' as const };
  const smooth = await runMrm(ellipsoid(5, 50, 0), p, null, () => {});
  const noisy = await runMrm(ellipsoid(5, 50, 0.01), p, null, () => {});
  for (const r of [smooth, noisy]) {
    assert.ok(Array.from(r.rqr).every(Number.isFinite) && Array.from(r.residuals).every(Number.isFinite));
    assert.equal(r.info.vertexCount, 10242);
  }
  const positive = Array.from(smooth.residuals).filter((x) => x > 0).length / smooth.residuals.length;
  assert.ok(positive > 0.99, `Laplacian shrinkage puts the surface above the trend (${positive})`);
  assert.ok(noisy.rqrStats.mean > 1.5 * smooth.rqrStats.mean, `roughness increases with noise (${smooth.rqrStats.mean} -> ${noisy.rqrStats.mean})`);
  const [L, W, T] = smooth.info.principalSize!;
  close(L, 100, 0.5); close(W, 60, 0.5); close(T, 30, 0.5);
});

test('pipeline guards: tiny meshes, missing Poisson, rotation-invariant dimensions', async () => {
  const tiny: MeshData = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), offset: [0, 0, 0] };
  await assertRejects(runMrm(tiny, DEFAULT_MRM_PARAMS, null, () => {}), 'TOO_SMALL');
  await assertRejects(runMrm(ellipsoid(3, 10, 0), DEFAULT_MRM_PARAMS, null, () => {}), 'POISSON_UNAVAILABLE');
  const m = ellipsoid(3, 10, 0);
  const c = Math.cos(0.7), s = Math.sin(0.7), r = m.positions.slice();
  for (let i = 0; i < r.length; i += 3) { const x = r[i], y = r[i + 1]; r[i] = c * x - s * y; r[i + 1] = s * x + c * y; }
  principalExtents(m.positions).forEach((v, i) => close(v, principalExtents(r)[i], 0.05));
});

test('parameter sanitising (UI, project files, IPC)', () => {
  const p = sanitizeMrmParams({ trendMethod: 'evil', poissonDepth: 99, sampleFraction: -1, smoothIterations: 1e9, signBoundarySmoothing: 'yes', __proto__: { x: 1 } });
  assert.equal(p.trendMethod, 'poisson');
  assert.equal(p.poissonDepth, 12);
  assert.equal(p.sampleFraction, 0.01);
  assert.equal(p.smoothIterations, 200);
  assert.equal(p.signBoundarySmoothing, true);
  assert.deepEqual(sanitizeMrmParams(undefined), DEFAULT_MRM_PARAMS);
  const c = sanitizeClassParams({ jenksSample: 1e9, jenksClasses: 0, autoKMin: 9, autoKMax: 3 });
  assert.equal(c.jenksSample, 20000);
  assert.equal(c.jenksClasses, 2);
  assert.ok(c.autoKMax > c.autoKMin);
});

async function assertRejects(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof Error && e.message.startsWith(`MRM_ERR:${code}`), `expected ${code}, got ${e}`);
    return;
  }
  assert.fail(`expected MRM_ERR:${code}`);
}
