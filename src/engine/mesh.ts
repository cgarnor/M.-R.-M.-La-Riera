/**
 * Mesh algorithms used by the MRM pipeline. Pure TypeScript, no DOM.
 */
import { MrmError } from './errors';

// ─── Adjacency (CSR) ────────────────────────────────────────────────

export interface Adjacency {
  /** offsets[i]..offsets[i+1] index into `neighbors` for vertex i (unique, sorted). */
  offsets: Uint32Array;
  neighbors: Uint32Array;
}

/** 1-ring vertex adjacency from triangle connectivity (same as the scripts' set-based adjacency). */
export function buildAdjacency(indices: Uint32Array, vertexCount: number): Adjacency {
  const deg = new Uint32Array(vertexCount + 1);
  const nf = indices.length / 3;
  for (let f = 0; f < nf; f++) {
    const a = indices[3 * f], b = indices[3 * f + 1], c = indices[3 * f + 2];
    deg[a] += 2;
    deg[b] += 2;
    deg[c] += 2;
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) start[i + 1] = start[i] + deg[i];
  const raw = new Uint32Array(start[vertexCount]);
  const fill = start.slice(0, vertexCount);
  for (let f = 0; f < nf; f++) {
    const a = indices[3 * f], b = indices[3 * f + 1], c = indices[3 * f + 2];
    raw[fill[a]++] = b; raw[fill[a]++] = c;
    raw[fill[b]++] = a; raw[fill[b]++] = c;
    raw[fill[c]++] = a; raw[fill[c]++] = b;
  }
  // Sort + unique per vertex
  const offsets = new Uint32Array(vertexCount + 1);
  let w = 0;
  for (let i = 0; i < vertexCount; i++) {
    const s = start[i], e = start[i + 1];
    const seg = raw.subarray(s, e);
    seg.sort();
    offsets[i] = w;
    let last = -1;
    for (let j = 0; j < seg.length; j++) {
      const v = seg[j];
      if (v !== last && v !== i) {
        raw[w++] = v;
        last = v;
      }
    }
  }
  offsets[vertexCount] = w;
  return { offsets, neighbors: raw.slice(0, w) };
}

// ─── Rqr (residual roughness over the 2-ring) ───────────────────────

/**
 * Rqr(i) = sqrt( mean_{j in N2(i)} (r_j - mean_{N2}(r))^2 ),  N2(i) = {i} ∪ 1-ring ∪ 2-ring.
 * Same definition as the scripts (population RMS around the local mean).
 */
export function computeRqr(residuals: ArrayLike<number>, adj: Adjacency, onProgress?: (f: number) => void): Float64Array {
  const n = residuals.length;
  const out = new Float64Array(n);
  const mark = new Int32Array(n).fill(-1);
  const ring: number[] = [];
  const { offsets, neighbors } = adj;
  const report = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    ring.length = 0;
    mark[i] = i;
    ring.push(i);
    for (let a = offsets[i]; a < offsets[i + 1]; a++) {
      const n1 = neighbors[a];
      if (mark[n1] !== i) { mark[n1] = i; ring.push(n1); }
      for (let b = offsets[n1]; b < offsets[n1 + 1]; b++) {
        const n2 = neighbors[b];
        if (mark[n2] !== i) { mark[n2] = i; ring.push(n2); }
      }
    }
    let sum = 0;
    for (let k = 0; k < ring.length; k++) sum += residuals[ring[k]];
    const mu = sum / ring.length;
    let sq = 0;
    for (let k = 0; k < ring.length; k++) {
      const d = residuals[ring[k]] - mu;
      sq += d * d;
    }
    out[i] = Math.sqrt(sq / ring.length);
    if (onProgress && i % report === 0) onProgress(i / n);
  }
  return out;
}

// ─── Sign-boundary smoothing (GitHub CloudComPy script) ─────────────

/** Replace a vertex value by the neighbour mean when >60 % of its (>=3) neighbours have the opposite sign. */
export function smoothSignBoundaries(res: Float64Array, adj: Adjacency): { values: Float64Array; changed: number } {
  const out = res.slice();
  let changed = 0;
  const { offsets, neighbors } = adj;
  for (let i = 0; i < res.length; i++) {
    const s = offsets[i], e = offsets[i + 1];
    if (e - s < 3) continue;
    let pos = 0, neg = 0, sum = 0;
    for (let a = s; a < e; a++) {
      const v = res[neighbors[a]];
      sum += v;
      if (v > 0) pos++;
      else if (v < 0) neg++;
    }
    const total = pos + neg;
    if (total === 0) continue;
    const mySign = res[i] >= 0 ? 1 : -1;
    const majSign = pos >= neg ? 1 : -1;
    if (Math.max(pos, neg) / total > 0.6 && mySign !== majSign) {
      out[i] = sum / (e - s);
      changed++;
    }
  }
  return { values: out, changed };
}

// ─── Normals and sampling ───────────────────────────────────────────

/** Area-weighted vertex normals. */
export function vertexNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const nrm = new Float32Array(pos.length);
  for (let f = 0; f < idx.length; f += 3) {
    const a = 3 * idx[f], b = 3 * idx[f + 1], c = 3 * idx[f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  return nrm;
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Equivalent of CloudCompare "Sample Points on Mesh" (MeshSamplingTools::samplePointsOnMesh):
 * per triangle floor(area * density) points + 1 extra with probability = fractional part,
 * uniform barycentric positions, normals interpolated from vertex normals.
 * Returns interleaved [x y z nx ny nz] float32.
 */
export function samplePointsOnMesh(pos: Float32Array, idx: Uint32Array, nrm: Float32Array, count: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const nf = idx.length / 3;
  const areas = new Float64Array(nf);
  let total = 0;
  for (let f = 0; f < nf; f++) {
    const a = 3 * idx[3 * f], b = 3 * idx[3 * f + 1], c = 3 * idx[3 * f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    areas[f] = ar;
    total += ar;
  }
  if (!(total > 0) || !Number.isFinite(total)) throw new MrmError('ZERO_AREA');
  const density = count / total;
  const out: number[] = [];
  for (let f = 0; f < nf; f++) {
    const fp = areas[f] * density;
    let k = Math.floor(fp);
    if (rnd() < fp - k) k++;
    if (k === 0) continue;
    const a = idx[3 * f], b = idx[3 * f + 1], c = idx[3 * f + 2];
    for (let s = 0; s < k; s++) {
      let r1 = rnd(), r2 = rnd();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      const w0 = 1 - r1 - r2;
      const px = w0 * pos[3 * a] + r1 * pos[3 * b] + r2 * pos[3 * c];
      const py = w0 * pos[3 * a + 1] + r1 * pos[3 * b + 1] + r2 * pos[3 * c + 1];
      const pz = w0 * pos[3 * a + 2] + r1 * pos[3 * b + 2] + r2 * pos[3 * c + 2];
      let nx = w0 * nrm[3 * a] + r1 * nrm[3 * b] + r2 * nrm[3 * c];
      let ny = w0 * nrm[3 * a + 1] + r1 * nrm[3 * b + 1] + r2 * nrm[3 * c + 1];
      let nz = w0 * nrm[3 * a + 2] + r1 * nrm[3 * b + 2] + r2 * nrm[3 * c + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      out.push(px, py, pz, nx, ny, nz);
    }
  }
  return Float32Array.from(out);
}

// ─── Laplacian smoothing (CloudCompare ccMesh::laplacianSmooth) ─────

/**
 * Port of ccMesh::laplacianSmooth: for every triangle the edge vectors are accumulated on its
 * vertices; each vertex then moves by displacement * factor / edgesCount (edgesCount = 2 per
 * incident triangle). Jacobi update, `iterations` times. Operates in place.
 */
export function laplacianSmoothCC(pos: Float32Array, idx: Uint32Array, iterations: number, factor: number, onProgress?: (f: number) => void): void {
  const nv = pos.length / 3;
  const edges = new Uint32Array(nv);
  for (let f = 0; f < idx.length; f += 3) {
    edges[idx[f]] += 2; edges[idx[f + 1]] += 2; edges[idx[f + 2]] += 2;
  }
  const disp = new Float64Array(pos.length);
  for (let it = 0; it < iterations; it++) {
    disp.fill(0);
    for (let f = 0; f < idx.length; f += 3) {
      const A = 3 * idx[f], B = 3 * idx[f + 1], C = 3 * idx[f + 2];
      for (let d = 0; d < 3; d++) {
        const ab = pos[B + d] - pos[A + d];
        const ac = pos[C + d] - pos[A + d];
        const bc = pos[C + d] - pos[B + d];
        disp[A + d] += ab + ac;
        disp[B + d] += bc - ab;
        disp[C + d] -= ac + bc;
      }
    }
    for (let i = 0; i < nv; i++) {
      if (edges[i] === 0) continue;
      const s = factor / edges[i];
      pos[3 * i] += disp[3 * i] * s;
      pos[3 * i + 1] += disp[3 * i + 1] * s;
      pos[3 * i + 2] += disp[3 * i + 2] * s;
    }
    onProgress?.((it + 1) / iterations);
  }
}

// ─── PLY I/O (for the Poisson bridge and exports) ───────────────────

/** Binary little-endian PLY with oriented points (input of PoissonRecon). */
export function writeOrientedPointsPly(points: Float32Array): Uint8Array {
  const n = points.length / 6;
  const header =
    'ply\nformat binary_little_endian 1.0\n' +
    `element vertex ${n}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property float nx\nproperty float ny\nproperty float nz\nend_header\n';
  const hb = new TextEncoder().encode(header);
  const out = new Uint8Array(hb.length + points.byteLength);
  out.set(hb, 0);
  out.set(new Uint8Array(points.buffer, points.byteOffset, points.byteLength), hb.length);
  return out;
}

const PLY_TYPES: Record<string, [number, string]> = {
  char: [1, 'Int8'], int8: [1, 'Int8'], uchar: [1, 'Uint8'], uint8: [1, 'Uint8'],
  short: [2, 'Int16'], int16: [2, 'Int16'], ushort: [2, 'Uint16'], uint16: [2, 'Uint16'],
  int: [4, 'Int32'], int32: [4, 'Int32'], uint: [4, 'Uint32'], uint32: [4, 'Uint32'],
  float: [4, 'Float32'], float32: [4, 'Float32'], double: [8, 'Float64'], float64: [8, 'Float64'],
};

interface PlyProp { name: string; type?: string; list?: { count: string; item: string } }
interface PlyElement { name: string; count: number; props: PlyProp[] }

export interface PlyMesh {
  positions: Float64Array;
  indices: Uint32Array;
  /** Extra per-vertex scalar properties (e.g. scalar_MRM_Residuals). */
  vertexProps: Record<string, Float64Array>;
}

/** Minimal PLY reader (binary little/big endian and ASCII) for vertices + triangle faces. */
export function readPly(buffer: ArrayBuffer): PlyMesh {
  const bytes = new Uint8Array(buffer);
  const marker = 'end_header';
  let headerEnd = -1;
  const isPly = bytes.length >= 3 && bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79; // "ply"
  for (let i = 0; isPly && i < Math.min(bytes.length, 1 << 16); i++) {
    if (bytes[i] === 0x65 && String.fromCharCode(...bytes.subarray(i, i + marker.length)) === marker) {
      let j = i + marker.length;
      if (bytes[j] === 0x0d) j++;
      if (bytes[j] === 0x0a) j++;
      headerEnd = j;
      break;
    }
  }
  if (headerEnd < 0) throw new MrmError('PLY_HEADER');
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd));
  const lines = header.split(/\r?\n/);
  let format = 'ascii';
  const elements: PlyElement[] = [];
  for (const raw of lines) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') {
      const count = Number(t[2]);
      if (!Number.isInteger(count) || count < 0) throw new MrmError('PLY_HEADER');
      elements.push({ name: t[1], count, props: [] });
    } else if (t[0] === 'property') {
      const el = elements[elements.length - 1];
      if (!el) throw new MrmError('PLY_HEADER');
      if (t[1] === 'list') {
        if (!PLY_TYPES[t[2]] || !PLY_TYPES[t[3]]) throw new MrmError('PLY_TYPE', `${t[2]} ${t[3]}`);
        el.props.push({ name: t[4], list: { count: t[2], item: t[3] } });
      } else {
        if (!PLY_TYPES[t[1]]) throw new MrmError('PLY_TYPE', t[1]);
        el.props.push({ name: t[2], type: t[1] });
      }
    }
  }
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) throw new MrmError('PLY_HEADER', format);
  const vEl = elements.find((e) => e.name === 'vertex');
  if (!vEl || !['x', 'y', 'z'].every((c) => vEl.props.some((p) => p.name === c && !p.list))) throw new MrmError('PLY_NO_VERTEX');
  // Every vertex needs at least 3 bytes in a binary file: reject absurd counts before allocating.
  if (format !== 'ascii' && vEl.count * 3 > bytes.length) throw new MrmError('PLY_TRUNCATED');
  const positions = new Float64Array(vEl.count * 3);
  const vertexProps: Record<string, Float64Array> = {};
  for (const p of vEl.props) if (!p.list && !['x', 'y', 'z'].includes(p.name)) vertexProps[p.name] = new Float64Array(vEl.count);
  const faces: number[] = [];

  if (format === 'ascii') {
    const body = new TextDecoder().decode(bytes.subarray(headerEnd)).split(/\s+/).filter((s) => s.length);
    let k = 0;
    const next = (): number => {
      if (k >= body.length) throw new MrmError('PLY_TRUNCATED');
      return +body[k++];
    };
    for (const el of elements) {
      for (let r = 0; r < el.count; r++) {
        if (el.name === 'vertex') {
          for (const p of el.props) {
            if (p.list) { const c = next(); for (let q = 0; q < c; q++) next(); continue; }
            const v = next();
            if (p.name === 'x') positions[3 * r] = v;
            else if (p.name === 'y') positions[3 * r + 1] = v;
            else if (p.name === 'z') positions[3 * r + 2] = v;
            else vertexProps[p.name][r] = v;
          }
        } else {
          for (const p of el.props) {
            if (p.list) {
              const c = next();
              const poly: number[] = [];
              for (let q = 0; q < c; q++) poly.push(next());
              if (el.name === 'face') for (let q = 1; q + 1 < poly.length; q++) faces.push(poly[0], poly[q], poly[q + 1]);
            } else next();
          }
        }
      }
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(buffer);
    let o = headerEnd;
    const read = (type: string): number => {
      const [size, kind] = PLY_TYPES[type];
      if (o + size > buffer.byteLength) throw new MrmError('PLY_TRUNCATED');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (dv as any)['get' + kind](o, le) as number;
      o += size;
      return v;
    };
    for (const el of elements) {
      const isV = el.name === 'vertex';
      const isF = el.name === 'face';
      for (let r = 0; r < el.count; r++) {
        for (const p of el.props) {
          if (p.list) {
            const c = read(p.list.count);
            if (isF && c >= 3) {
              const v0 = read(p.list.item);
              let prev = read(p.list.item);
              for (let q = 2; q < c; q++) {
                const cur = read(p.list.item);
                faces.push(v0, prev, cur);
                prev = cur;
              }
            } else for (let q = 0; q < c; q++) read(p.list.item);
            continue;
          }
          const v = read(p.type!);
          if (isV) {
            if (p.name === 'x') positions[3 * r] = v;
            else if (p.name === 'y') positions[3 * r + 1] = v;
            else if (p.name === 'z') positions[3 * r + 2] = v;
            else vertexProps[p.name][r] = v;
          }
        }
      }
    }
  }
  return { positions, indices: Uint32Array.from(faces), vertexProps };
}

/** Binary PLY mesh with float per-vertex scalar fields (readable by CloudCompare as SFs). */
export function writeMeshPly(
  positions: Float32Array,
  indices: Uint32Array,
  offset: [number, number, number],
  scalars: { name: string; values: ArrayLike<number> }[],
  comments: string[] = ['MRM Analysis Tool'],
): Uint8Array {
  const nv = positions.length / 3;
  const nf = indices.length / 3;
  let header = 'ply\nformat binary_little_endian 1.0\n';
  // One line per comment: control characters would break the header.
  for (const c of comments) header += `comment ${c.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()}\n`;
  header += `element vertex ${nv}\n`;
  // Double precision coordinates so the original (un-centred) position is preserved.
  header += 'property double x\nproperty double y\nproperty double z\n';
  for (const s of scalars) header += `property float scalar_${s.name}\n`;
  header += `element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  const hb = new TextEncoder().encode(header);
  const vSize = 24 + 4 * scalars.length;
  const buf = new ArrayBuffer(hb.length + nv * vSize + nf * 13);
  const u8 = new Uint8Array(buf);
  u8.set(hb, 0);
  const dv = new DataView(buf);
  let o = hb.length;
  for (let i = 0; i < nv; i++) {
    dv.setFloat64(o, positions[3 * i] + offset[0], true);
    dv.setFloat64(o + 8, positions[3 * i + 1] + offset[1], true);
    dv.setFloat64(o + 16, positions[3 * i + 2] + offset[2], true);
    o += 24;
    for (const s of scalars) { dv.setFloat32(o, s.values[i], true); o += 4; }
  }
  for (let f = 0; f < nf; f++) {
    dv.setUint8(o, 3);
    dv.setInt32(o + 1, indices[3 * f], true);
    dv.setInt32(o + 5, indices[3 * f + 1], true);
    dv.setInt32(o + 9, indices[3 * f + 2], true);
    o += 13;
  }
  return u8;
}
