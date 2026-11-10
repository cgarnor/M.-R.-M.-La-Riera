/**
 * MRM pipeline (García-Noriega & Arias 2026; Pires et al. 2014, 2015).
 *
 *   Poisson (default, = CloudComPy script / article):
 *     1. Sample Points on Mesh (10 % of the vertex count, with normals)
 *     2. Screened Poisson Surface Reconstruction (Kazhdan & Hoppe 2013), octree depth 8
 *     3. Laplacian smoothing of the trend mesh (20 iterations, factor 0.2)
 *     4. Signed cloud-to-mesh distance original vertices -> trend mesh
 *   Decimation (Pires et al.):
 *     1. QEM edge-collapse decimation (meshoptimizer), 2-4 as above.
 *   Then: optional sign-boundary smoothing, Rqr over the 2-ring, statistics.
 */
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { MeshData, MrmParams, MrmResult, ProgressFn } from './types';
import {
  buildAdjacency, computeRqr, laplacianSmoothCC, readPly, samplePointsOnMesh,
  smoothSignBoundaries, vertexNormals, writeOrientedPointsPly,
} from './mesh';
import { computeStats, sortedCopy } from './classify';
import { principalExtents } from './pca';
import { MrmError } from './errors';

/** Below this size a 2-ring roughness and a 6-class partition are meaningless. */
const MIN_VERTICES = 100;

/** Runs PoissonRecon on a binary PLY of oriented points and returns the output PLY. */
export type PoissonRunner = (pointsPly: Uint8Array, opts: { depth: number; samplesPerNode: number; pointWeight: number }) => Promise<ArrayBuffer>;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

async function trendPoisson(mesh: MeshData, p: MrmParams, poisson: PoissonRunner, progress: ProgressFn, info: MrmResult['info']) {
  const nv = mesh.positions.length / 3;
  const nSamples = Math.max(500, Math.floor(nv * p.sampleFraction));
  progress('sampling', 0);
  const nrm = vertexNormals(mesh.positions, mesh.indices);
  const pts = samplePointsOnMesh(mesh.positions, mesh.indices, nrm, nSamples, p.sampleSeed);
  info.sampleCount = pts.length / 6;
  progress('poisson', 0);
  const out = await poisson(writeOrientedPointsPly(pts), {
    depth: p.poissonDepth,
    samplesPerNode: p.poissonSamplesPerNode,
    pointWeight: p.poissonPointWeight,
  });
  const ply = readPly(out);
  if (ply.indices.length === 0) throw new MrmError('POISSON_EMPTY');
  return { positions: Float32Array.from(ply.positions), indices: ply.indices };
}

async function trendDecimation(mesh: MeshData, p: MrmParams, progress: ProgressFn, info: MrmResult['info']) {
  progress('decimation', 0);
  await MeshoptSimplifier.ready;
  const target = Math.max(3, Math.floor((mesh.indices.length * p.decimationKeep) / 3) * 3);
  const [newIdx] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 1.0);
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  const pos: number[] = [];
  const idx = new Uint32Array(newIdx.length);
  for (let i = 0; i < newIdx.length; i++) {
    const v = newIdx[i];
    if (remap[v] < 0) {
      remap[v] = pos.length / 3;
      pos.push(mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]);
    }
    idx[i] = remap[v];
  }
  info.sampleCount = pos.length / 3;
  return { positions: Float32Array.from(pos), indices: idx };
}

/** Signed distance (CloudCompare C2M "signed"): sign of (P - closest) · normal of the closest triangle. */
function signedDistances(mesh: MeshData, trend: { positions: Float32Array; indices: Uint32Array }, progress: ProgressFn): Float64Array {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(trend.positions, 3));
  geom.setIndex(new Uint32BufferAttribute(trend.indices, 1));
  const bvh = new MeshBVH(geom);
  // MeshBVH rearranges the index buffer in place: faceIndex refers to geom.index, not trend.indices.
  const tp = trend.positions, ti = geom.index!.array as Uint32Array;
  const src = mesh.positions;
  const n = src.length / 3;
  const out = new Float64Array(n);
  const p = new Vector3();
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const report = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    p.set(src[3 * i], src[3 * i + 1], src[3 * i + 2]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bvh.closestPointToPoint(p, hit as any);
    const f = hit.faceIndex;
    const a = 3 * ti[3 * f], b = 3 * ti[3 * f + 1], c = 3 * ti[3 * f + 2];
    const ux = tp[b] - tp[a], uy = tp[b + 1] - tp[a + 1], uz = tp[b + 2] - tp[a + 2];
    const vx = tp[c] - tp[a], vy = tp[c + 1] - tp[a + 1], vz = tp[c + 2] - tp[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = (p.x - hit.point.x) * nx + (p.y - hit.point.y) * ny + (p.z - hit.point.z) * nz;
    out[i] = dot < 0 ? -hit.distance : hit.distance;
    if (i % report === 0) progress('distance', i / n);
  }
  return out;
}

export async function runMrm(mesh: MeshData, params: MrmParams, poisson: PoissonRunner | null, progress: ProgressFn): Promise<MrmResult> {
  const t: Record<string, number> = {};
  const nv = mesh.positions.length / 3;
  const info: MrmResult['info'] = {
    vertexCount: nv,
    faceCount: mesh.indices.length / 3,
    sampleCount: 0,
    trendVertexCount: 0,
    trendFaceCount: 0,
    signFlipsSmoothed: 0,
    bboxSize: [0, 0, 0],
    timingsMs: t,
  };
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      const v = mesh.positions[i + d];
      if (v < mn[d]) mn[d] = v;
      if (v > mx[d]) mx[d] = v;
    }
  }
  info.bboxSize = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  if (nv < MIN_VERTICES) throw new MrmError('TOO_SMALL', String(nv));
  if (!(Math.max(...info.bboxSize) > 0)) throw new MrmError('ZERO_AREA');
  info.principalSize = principalExtents(mesh.positions);

  // 1-2. Trend surface
  let t0 = now();
  let trend;
  if (params.trendMethod === 'poisson') {
    if (!poisson) throw new MrmError('POISSON_UNAVAILABLE');
    trend = await trendPoisson(mesh, params, poisson, progress, info);
  } else {
    trend = await trendDecimation(mesh, params, progress, info);
  }
  t.trend = now() - t0;

  // 3. Laplacian smoothing
  t0 = now();
  laplacianSmoothCC(trend.positions, trend.indices, params.smoothIterations, params.smoothFactor, (f) => progress('smoothing', f));
  info.trendVertexCount = trend.positions.length / 3;
  info.trendFaceCount = trend.indices.length / 3;
  t.smoothing = now() - t0;

  // 4. Signed distances
  t0 = now();
  let res = signedDistances(mesh, trend, progress);
  for (let i = 0; i < res.length; i++) if (!Number.isFinite(res[i])) res[i] = 0;
  t.distance = now() - t0;

  // 5. Adjacency, optional sign-boundary smoothing, Rqr
  t0 = now();
  progress('rqr', 0);
  const adj = buildAdjacency(mesh.indices, nv);
  let isolated = 0;
  for (let i = 0; i < nv; i++) if (adj.offsets[i] === adj.offsets[i + 1]) isolated++;
  info.isolatedVertices = isolated;
  if (params.signBoundarySmoothing) {
    const s = smoothSignBoundaries(res, adj);
    res = s.values;
    info.signFlipsSmoothed = s.changed;
  }
  // Store as float32 (like a CloudCompare scalar field) and compute Rqr from those values,
  // exactly as the scripts do when they read MRM_Residuals back.
  const residuals = Float32Array.from(res);
  const rqr = computeRqr(residuals, adj, (f) => progress('rqr', f));
  for (let i = 0; i < rqr.length; i++) if (!Number.isFinite(rqr[i])) rqr[i] = 0;
  t.rqr = now() - t0;

  progress('stats', 0);
  const residualStats = computeStats(residuals, sortedCopy(residuals));
  const rqrStats = computeStats(rqr, sortedCopy(rqr));
  progress('done', 1);

  return { mesh, trend, residuals, rqr, residualStats, rqrStats, info, params: { ...params } };
}
