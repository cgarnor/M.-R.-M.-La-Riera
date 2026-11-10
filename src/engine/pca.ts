/**
 * Principal component analysis of a vertex cloud (used for artefact dimensions and view framing).
 */

/** Symmetric 3x3 eigen-decomposition (Jacobi). Eigenvectors sorted by eigenvalue (desc). */
export function eigenSym3(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => r.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => [v[0][i], v[1][i], v[2][i]]) };
}

/**
 * Extents (max - min) of the cloud along its principal axes, sorted desc:
 * [length, width, thickness] in model units, independent of how the model is rotated.
 */
export function principalExtents(pos: ArrayLike<number>): [number, number, number] {
  const n = pos.length / 3;
  if (n === 0) return [0, 0, 0];
  const step = Math.max(1, Math.floor(n / 200000));
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (let i = 0; i < n; i += step) { cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2]; cnt++; }
  cx /= cnt; cy /= cnt; cz /= cnt;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i += step) {
    const d = [pos[3 * i] - cx, pos[3 * i + 1] - cy, pos[3 * i + 2] - cz];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += d[r] * d[c];
  }
  const ax = eigenSym3(C).vectors;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  // Extents use every vertex (the extremes matter, not only the sample used for the axes).
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i] - cx, y = pos[3 * i + 1] - cy, z = pos[3 * i + 2] - cz;
    for (let k = 0; k < 3; k++) {
      const p = x * ax[k][0] + y * ax[k][1] + z * ax[k][2];
      if (p < mn[k]) mn[k] = p;
      if (p > mx[k]) mx[k] = p;
    }
  }
  const e = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].sort((p, q) => q - p);
  return [e[0], e[1], e[2]];
}
