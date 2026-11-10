/**
 * Mesh readers: OBJ, PLY (ASCII / binary LE / BE), STL (ASCII / binary) and malformed files.
 */
import { assert, test, throwsCode } from './harness';
import { loadMesh, parseObj, parseStl } from '../src/engine/meshio';
import { readPly, writeMeshPly } from '../src/engine/mesh';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** Binary STL with the given triangles (9 floats each), optional header text and padding. */
function binaryStl(tris: number[][], header = '', pad = 0): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50 + pad);
  const u8 = new Uint8Array(buf);
  u8.set(new TextEncoder().encode(header.slice(0, 80)));
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + 4 * k, v, true)));
  return buf;
}
const TET = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0, 1, 0]];

test('OBJ: quads, negative indices, v/vt/vn tokens, leading blanks, CRLF', () => {
  const m = parseObj(enc('# c\r\n  v 0 0 0\r\nv 2 0 0\r\nv 2 2 0\r\nv 0 2 0\r\nvt 0 0\r\n\tf 1/1/1 2/1/1 3/1/1 4/1/1\r\nf -4 -2 -1\r\n'));
  assert.equal(m.positions.length, 12);
  assert.deepEqual(Array.from(m.indices), [0, 1, 2, 0, 2, 3, 0, 2, 3]);
  assert.deepEqual(m.offset, [1, 1, 0]);
});

test('OBJ: face index out of range and missing faces are rejected', () => {
  throwsCode(() => parseObj(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n')), 'BAD_INDEX');
  throwsCode(() => parseObj(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\n')), 'NO_FACES');
  throwsCode(() => parseObj(enc('v 0 0 x\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')), 'BAD_COORDS');
});

test('STL: binary, binary with "solid" header, binary with padding, ASCII, empty', () => {
  assert.equal(parseStl(binaryStl(TET)).indices.length, 12);
  const s = parseStl(binaryStl(TET, 'solid exported by some CAD'));
  assert.equal(s.indices.length, 12);
  assert.equal(s.positions.length, 12, 'shared vertices merged');
  assert.equal(parseStl(binaryStl(TET, '', 7)).indices.length, 12);
  const ascii = 'solid t\n' + TET.map((t) => `facet normal 0 0 1\n outer loop\n${[0, 1, 2].map((v) => `  vertex ${t[3 * v]} ${t[3 * v + 1]} ${t[3 * v + 2]}`).join('\n')}\n endloop\nendfacet\n`).join('') + 'endsolid t\n';
  assert.equal(parseStl(enc(ascii)).indices.length, 12);
  throwsCode(() => parseStl(enc('solid x\nendsolid x\n')), 'NO_FACES');
  throwsCode(() => parseStl(new ArrayBuffer(10)), 'NO_FACES');
});

test('PLY: binary round trip with scalar fields (writeMeshPly -> readPly)', () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const idx = new Uint32Array([0, 1, 2, 0, 1, 3]);
  const bytes = writeMeshPly(pos, idx, [10, 20, 30], [{ name: 'Rqr', values: [1, 2, 3, 4] }], ['name with\nnewline\r\x00ctrl']);
  const text = new TextDecoder().decode(bytes.subarray(0, 300));
  assert.ok(text.includes('comment name with newline ctrl\n'), 'control characters removed from comments');
  const ply = readPly(bytes.slice().buffer);
  assert.deepEqual(Array.from(ply.indices), Array.from(idx));
  assert.deepEqual(Array.from(ply.positions.slice(0, 6)), [10, 20, 30, 11, 20, 30]);
  assert.deepEqual(Array.from(ply.vertexProps.scalar_Rqr), [1, 2, 3, 4]);
});

test('PLY: ASCII and big-endian files', () => {
  const ascii = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n';
  assert.equal(loadMesh('a.ply', enc(ascii)).indices.length, 3);
  const head = new TextEncoder().encode('ply\nformat binary_big_endian 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nelement face 1\nproperty list uchar uint vertex_indices\nend_header\n');
  const buf = new ArrayBuffer(head.length + 72 + 13);
  new Uint8Array(buf).set(head);
  const dv = new DataView(buf);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => dv.setFloat64(head.length + 8 * i, v, false));
  dv.setUint8(head.length + 72, 3);
  [0, 1, 2].forEach((v, i) => dv.setUint32(head.length + 73 + 4 * i, v, false));
  const m = loadMesh('b.ply', buf);
  assert.deepEqual(Array.from(m.indices), [0, 1, 2]);
  assert.deepEqual(m.offset, [0.5, 0.5, 0]);
});

test('PLY: malformed files are rejected with a clear code', () => {
  throwsCode(() => readPly(enc('not a ply file')), 'PLY_HEADER');
  throwsCode(() => readPly(enc('ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty quad x\nend_header\n')), 'PLY_TYPE');
  throwsCode(() => readPly(enc('ply\nformat binary_little_endian 1.0\nelement vertex 1000\nproperty float x\nproperty float y\nproperty float z\nend_header\n\x00\x00\x00\x00')), 'PLY_TRUNCATED');
  throwsCode(() => readPly(enc('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0\n')), 'PLY_TRUNCATED');
  throwsCode(() => readPly(enc('ply\nformat ascii 1.0\nelement vertex 1\nproperty float a\nend_header\n0\n')), 'PLY_NO_VERTEX');
  const cloud = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
  throwsCode(() => loadMesh('c.ply', enc(cloud)), 'NO_FACES');
  throwsCode(() => loadMesh('x.fbx', enc('')), 'FORMAT');
});
