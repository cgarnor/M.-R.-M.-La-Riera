/**
 * Mesh loading (OBJ / PLY / STL) into a centred, indexed MeshData.
 *
 * The OBJ parser keeps the original `v` indexing (like CloudCompare). three.js' OBJLoader would
 * duplicate vertices at texture/normal seams, which breaks the mesh topology used by the
 * 2-ring Rqr neighbourhood.
 *
 * Every loader validates its output (at least one face, finite coordinates, face indices inside
 * the vertex range) so that damaged or malformed files fail with a clear message.
 */
import type { MeshData } from './types';
import { MrmError } from './errors';
import { readPly } from './mesh';

/** Validates the mesh and centres it on its bounding-box centre (float32 precision). */
function centre(positions64: Float64Array, indices: Uint32Array | number[]): MeshData {
  const nv = positions64.length / 3;
  if (indices.length < 3) throw new MrmError('NO_FACES');
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (!(v >= 0 && v < nv) || !Number.isInteger(v)) throw new MrmError('BAD_INDEX', `${v} / ${nv}`);
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions64.length; i += 3) {
    const x = positions64[i], y = positions64[i + 1], z = positions64[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new MrmError('BAD_COORDS', String(i / 3 + 1));
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const offset: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const positions = new Float32Array(positions64.length);
  for (let i = 0; i < positions64.length; i += 3) {
    positions[i] = positions64[i] - offset[0];
    positions[i + 1] = positions64[i + 1] - offset[1];
    positions[i + 2] = positions64[i + 2] - offset[2];
  }
  return { positions, indices: indices instanceof Uint32Array ? indices : Uint32Array.from(indices), offset };
}

export function parseObj(buffer: ArrayBuffer): MeshData {
  const text = new TextDecoder().decode(buffer);
  const pos: number[] = [];
  const idx: number[] = [];
  const poly: number[] = [];
  let p = 0;
  const L = text.length;
  while (p < L) {
    let e = text.indexOf('\n', p);
    if (e < 0) e = L;
    // Skip leading blanks
    let s = p;
    while (s < e && (text.charCodeAt(s) === 32 || text.charCodeAt(s) === 9)) s++;
    const c0 = text.charCodeAt(s);
    const c1 = text.charCodeAt(s + 1);
    if (c0 === 118 /* v */ && (c1 === 32 || c1 === 9)) {
      const parts = text.substring(s + 2, e).trim().split(/\s+/);
      pos.push(+parts[0], +parts[1], +parts[2]);
    } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9)) {
      const parts = text.substring(s + 2, e).trim().split(/\s+/);
      poly.length = 0;
      const nv = pos.length / 3;
      for (const tok of parts) {
        if (!tok) continue;
        const slash = tok.indexOf('/');
        let vi = parseInt(slash < 0 ? tok : tok.substring(0, slash), 10);
        vi = vi < 0 ? nv + vi : vi - 1;
        poly.push(vi);
      }
      for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    }
    p = e + 1;
  }
  return centre(Float64Array.from(pos), idx);
}

export function parsePlyMesh(buffer: ArrayBuffer): MeshData {
  const ply = readPly(buffer);
  return centre(ply.positions, ply.indices);
}

/** STL (binary or ASCII) -> indexed mesh, merging vertices with identical coordinates. */
export function parseStl(buffer: ArrayBuffer): MeshData {
  const dv = new DataView(buffer);
  const n = buffer.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const binaryFits = n > 0 && 84 + n * 50 <= buffer.byteLength;
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512))).trimStart().toLowerCase();
  let tris: number[] = [];
  const readBinary = () => {
    const out: number[] = new Array(n * 9);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) out[9 * t + k] = dv.getFloat32(o + 4 * k, true);
    }
    return out;
  };
  const readAscii = () => {
    const out: number[] = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const text = new TextDecoder().decode(buffer);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    return out.length % 9 === 0 ? out : out.slice(0, out.length - (out.length % 9));
  };
  // Exact binary size, or a binary file that does not look like ASCII ("solid ... facet").
  // Some exporters write binary files whose 80-byte header starts with "solid" or that carry
  // trailing padding bytes, so the ASCII reader is used only if it actually finds triangles.
  if (binaryFits && 84 + n * 50 === buffer.byteLength) tris = readBinary();
  else if (head.startsWith('solid')) {
    tris = readAscii();
    if (tris.length === 0 && binaryFits) tris = readBinary();
  } else if (binaryFits) tris = readBinary();
  if (tris.length < 9) throw new MrmError('NO_FACES');

  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx = new Uint32Array(tris.length / 3);
  for (let i = 0; i < tris.length; i += 3) {
    const key = `${tris[i]},${tris[i + 1]},${tris[i + 2]}`;
    let v = map.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      map.set(key, v);
      pos.push(tris[i], tris[i + 1], tris[i + 2]);
    }
    idx[i / 3] = v;
  }
  return centre(Float64Array.from(pos), idx);
}

export function loadMesh(fileName: string, buffer: ArrayBuffer): MeshData {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'obj') return parseObj(buffer);
  if (ext === 'ply') return parsePlyMesh(buffer);
  if (ext === 'stl') return parseStl(buffer);
  throw new MrmError('FORMAT', `.${ext ?? ''}`);
}
