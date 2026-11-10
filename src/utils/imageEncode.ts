/**
 * Image encoding for publication figures: PNG / JPEG with the physical resolution (dpi)
 * written into the file metadata (PNG pHYs chunk, JPEG JFIF density), so that word
 * processors and journal systems read the intended print size.
 */

export type RasterFormat = 'png' | 'jpg';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Inserts (or replaces) the pHYs chunk right after IHDR. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Walk the chunks: drop an existing pHYs, insert ours after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let o = 8;
  const src = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (o < png.length) {
    const len = src.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const end = o + 12 + len;
    if (type !== 'pHYs') parts.push(png.subarray(o, end));
    if (type === 'IHDR') parts.push(chunk);
    o = end;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}

/** Sets the JFIF density to `dpi` (inserting a JFIF APP0 segment if the encoder did not write one). */
export function setJpegDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const isJfif = jpg[2] === 0xff && jpg[3] === 0xe0 && jpg[6] === 0x4a && jpg[7] === 0x46 && jpg[8] === 0x49 && jpg[9] === 0x46 && jpg[10] === 0;
  if (isJfif) {
    const out = jpg.slice();
    out[13] = 1; // units: dots per inch
    out[14] = (dpi >> 8) & 0xff; out[15] = dpi & 0xff;
    out[16] = (dpi >> 8) & 0xff; out[17] = dpi & 0xff;
    return out;
  }
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01,
    (dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff, 0x00, 0x00,
  ]);
  const out = new Uint8Array(jpg.length + app0.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(jpg.subarray(2), 2 + app0.length);
  return out;
}

export async function encodeCanvas(canvas: HTMLCanvasElement, format: RasterFormat, dpi: number, quality = 0.95): Promise<Uint8Array> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error('MRM_ERR:FIGURE_ENCODE');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return format === 'png' ? setPngDpi(bytes, dpi) : setJpegDpi(bytes, dpi);
}

/** Pixels for a physical length. */
export const cmToPx = (cm: number, dpi: number) => Math.round((cm / 2.54) * dpi);
/** Pixels for a font size in points. */
export const ptToPx = (pt: number, dpi: number) => (pt / 72) * dpi;
