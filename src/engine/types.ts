/**
 * Shared types for the MRM engine (worker, main thread and validation scripts).
 */

export type TrendMethod = 'poisson' | 'decimation';

/** Parameters of the MRM pipeline (defaults = García-Noriega & Arias 2026, CloudComPy script). */
export interface MrmParams {
  trendMethod: TrendMethod;
  /** Poisson: fraction of original vertex count used for "Sample Points on Mesh". */
  sampleFraction: number;
  /** Seed of the deterministic sampler (CloudCompare's sampler is random; we make it reproducible). */
  sampleSeed: number;
  poissonDepth: number;
  poissonSamplesPerNode: number;
  poissonPointWeight: number;
  /** Decimation method: fraction of triangles kept (QEM edge collapse). */
  decimationKeep: number;
  /** Laplacian smoothing of the trend surface (CloudCompare ccMesh::laplacianSmooth). */
  smoothIterations: number;
  smoothFactor: number;
  /** Post-process of the GitHub CloudComPy script: smooth isolated sign flips of the residual field. */
  signBoundarySmoothing: boolean;
}

export const DEFAULT_MRM_PARAMS: MrmParams = {
  trendMethod: 'poisson',
  sampleFraction: 0.1,
  sampleSeed: 1,
  poissonDepth: 8,
  poissonSamplesPerNode: 1.5,
  poissonPointWeight: 2,
  decimationKeep: 0.1,
  smoothIterations: 20,
  smoothFactor: 0.2,
  signBoundarySmoothing: true,
};

export type JenksMethod = 'exact' | 'legacy';

/** Parameters of the Rqr classification (identical to the v2 Python scripts). */
export interface ClassParams {
  jenksMethod: JenksMethod;
  jenksSample: number;
  jenksClasses: number;
  autoKMin: number;
  autoKMax: number;
}

export const DEFAULT_CLASS_PARAMS: ClassParams = {
  jenksMethod: 'exact',
  jenksSample: 4000,
  jenksClasses: 6,
  autoKMin: 2,
  autoKMax: 10,
};

// ─── Parameter validation (UI input, project files, IPC) ────────────

function clampNum(v: unknown, def: number, min: number, max: number, integer = false): number {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : def;
  const c = Math.min(max, Math.max(min, x));
  return integer ? Math.round(c) : c;
}

const asRecord = (p: unknown): Record<string, unknown> => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

/** Valid MRM parameters from any input (missing or out-of-range values -> defaults / limits). */
export function sanitizeMrmParams(p: unknown): MrmParams {
  const o = asRecord(p);
  const d = DEFAULT_MRM_PARAMS;
  return {
    trendMethod: o.trendMethod === 'decimation' ? 'decimation' : 'poisson',
    sampleFraction: clampNum(o.sampleFraction, d.sampleFraction, 0.01, 1),
    sampleSeed: clampNum(o.sampleSeed, d.sampleSeed, 0, 2147483647, true),
    poissonDepth: clampNum(o.poissonDepth, d.poissonDepth, 5, 12, true),
    poissonSamplesPerNode: clampNum(o.poissonSamplesPerNode, d.poissonSamplesPerNode, 1, 20),
    poissonPointWeight: clampNum(o.poissonPointWeight, d.poissonPointWeight, 0, 100),
    decimationKeep: clampNum(o.decimationKeep, d.decimationKeep, 0.01, 0.9),
    smoothIterations: clampNum(o.smoothIterations, d.smoothIterations, 0, 200, true),
    smoothFactor: clampNum(o.smoothFactor, d.smoothFactor, 0, 1),
    signBoundarySmoothing: typeof o.signBoundarySmoothing === 'boolean' ? o.signBoundarySmoothing : d.signBoundarySmoothing,
  };
}

/** Valid classification parameters from any input. */
export function sanitizeClassParams(p: unknown): ClassParams {
  const o = asRecord(p);
  const d = DEFAULT_CLASS_PARAMS;
  const autoKMin = clampNum(o.autoKMin, d.autoKMin, 2, 9, true);
  return {
    jenksMethod: o.jenksMethod === 'legacy' ? 'legacy' : 'exact',
    jenksSample: clampNum(o.jenksSample, d.jenksSample, 100, 20000, true),
    jenksClasses: clampNum(o.jenksClasses, d.jenksClasses, 2, 10, true),
    autoKMin,
    autoKMax: clampNum(o.autoKMax, d.autoKMax, autoKMin + 1, 10, true),
  };
}

export interface DistStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  median: number;
  /** p5, p25, p75, p95 (numpy "linear" method). */
  p5: number;
  p25: number;
  p75: number;
  p95: number;
}

/** A raw triangle mesh with coordinates centred on `offset` (to keep float32 precision). */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  /** Original coordinates = positions + offset. */
  offset: [number, number, number];
}

export interface MrmResult {
  mesh: MeshData;
  trend: { positions: Float32Array; indices: Uint32Array };
  /** Signed C2M distance original -> trend (model units), stored as float32 like a CloudCompare SF. */
  residuals: Float32Array;
  /** Residual roughness per vertex (model units). */
  rqr: Float64Array;
  residualStats: DistStats;
  rqrStats: DistStats;
  info: {
    vertexCount: number;
    faceCount: number;
    sampleCount: number;
    trendVertexCount: number;
    trendFaceCount: number;
    signFlipsSmoothed: number;
    bboxSize: [number, number, number];
    /** Length >= width >= thickness along the principal axes (model units). Missing in old projects. */
    principalSize?: [number, number, number];
    /** Vertices that belong to no face (Rqr = 0, as in the scripts). Missing in old projects. */
    isolatedVertices?: number;
    timingsMs: Record<string, number>;
  };
  params: MrmParams;
}

export type ProgressFn = (stage: string, fraction: number) => void;
