/**
 * Publication figures: composition of 3D renders with colour legend, metric scale bar and captions,
 * and rasterisation of SVG charts, at a given physical width and resolution (dpi).
 */
import type { ColorRamp } from '../state/model';
import { fmtMm, fmtNum, rampColor, toCss } from '../state/analysis';
import { cmToPx, encodeCanvas, ptToPx, type RasterFormat } from './imageEncode';

export type FigureBackground = 'white' | 'black' | 'transparent';
export type FigureFormat = RasterFormat | 'svg';

export interface FigureOptions {
  format: FigureFormat;
  dpi: number;
  widthCm: number;
  /** Maximum figure height (cm); 0 = unlimited. */
  maxHeightCm: number;
  fontPt: number;
  background: FigureBackground;
  /** Crop the 3D render to the outline of the piece (instead of the on-screen framing). */
  fit: boolean;
  showName: boolean;
  showLegend: boolean;
  showScale: boolean;
  showTitle: boolean;
}

/** Margin around the piece when cropping to its outline (fraction of its size, each side). */
export const FIT_MARGIN = 0.04;

export type LegendModel =
  | { kind: 'bar'; title: string; lo: number; hi: number; unit: string; loLabel?: string; hiLabel?: string; notes?: string[]; zero?: boolean; loText?: string; hiText?: string; /** Overrides the view colour ramp (e.g. classes with mixed k). */ ramp?: ColorRamp }
  | { kind: 'classes'; title: string; items: { color: string; label: string; pct?: number }[]; loLabel: string; hiLabel: string }
  | null;

interface Theme { bg: string | null; text: string; sub: string; line: string }
export function figureTheme(bg: FigureBackground, format: FigureFormat): Theme {
  const b = format === 'jpg' && bg === 'transparent' ? 'white' : bg;
  if (b === 'black') return { bg: '#000000', text: '#f3f4f6', sub: '#c7cad1', line: '#f3f4f6' };
  return { bg: b === 'white' ? '#ffffff' : null, text: '#111111', sub: '#444444', line: '#111111' };
}

const FONT = 'Segoe UI, Arial, Helvetica, sans-serif';

class Pen {
  readonly f: number;
  constructor(readonly ctx: CanvasRenderingContext2D, fontPt: number, dpi: number, readonly th: Theme) {
    this.f = ptToPx(fontPt, dpi);
  }
  font(scale = 1, weight = 400) { this.ctx.font = `${weight} ${this.f * scale}px ${FONT}`; }
  text(s: string, x: number, y: number, opts: { scale?: number; weight?: number; align?: CanvasTextAlign; color?: string } = {}) {
    this.font(opts.scale ?? 1, opts.weight ?? 400);
    this.ctx.fillStyle = opts.color ?? this.th.text;
    this.ctx.textAlign = opts.align ?? 'left';
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.fillText(s, x, y);
  }
  width(s: string, scale = 1, weight = 400) { this.font(scale, weight); return this.ctx.measureText(s).width; }
  /** s shortened with an ellipsis so that it fits in maxW pixels. */
  fit(s: string, maxW: number, scale = 1, weight = 400) {
    if (this.width(s, scale, weight) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.width(s.slice(0, m) + '…', scale, weight) <= maxW) lo = m; else hi = m - 1; }
    return s.slice(0, lo) + '…';
  }
}

// ─── Legend ─────────────────────────────────────────────────────────

/** Height (px) needed by a legend of the given width. */
function legendHeight(p: Pen, lg: LegendModel, w: number): number {
  if (!lg) return 0;
  const lh = p.f * 1.35;
  if (lg.kind === 'bar') return lh * 1.2 + p.f * 0.9 + lh * 1.1 + (lg.loLabel ? lh : 0) + (lg.notes?.length ?? 0) * lh;
  const cols = classColumns(p, lg, w);
  return lh * 1.2 + Math.ceil(lg.items.length / cols) * lh + lh;
}

function classItemWidth(p: Pen, lg: Extract<LegendModel, { kind: 'classes' }>): { label: number; total: number } {
  const label = Math.max(...lg.items.map((it) => p.width(it.label, 0.95)));
  const pct = lg.items.some((it) => it.pct !== undefined) ? p.width('100.0 %', 0.95) + p.f * 0.8 : 0;
  return { label, total: p.f * 1.4 + label + pct + p.f * 1.2 };
}

function classColumns(p: Pen, lg: Extract<LegendModel, { kind: 'classes' }>, w: number): number {
  return Math.max(1, Math.min(3, Math.floor(w / classItemWidth(p, lg).total)));
}

function drawLegend(p: Pen, lg: LegendModel, ramp: ColorRamp, x: number, y: number, w: number): void {
  if (!lg) return;
  const ctx = p.ctx;
  const lh = p.f * 1.35;
  let cy = y + p.f;
  p.text(lg.title, x, cy, { weight: 600 });
  cy += lh * 0.45;
  if (lg.kind === 'bar') {
    const bh = p.f * 0.9;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    for (let i = 0; i <= 40; i++) grad.addColorStop(i / 40, toCss(rampColor(lg.ramp ?? ramp, i / 40)));
    ctx.fillStyle = grad;
    ctx.fillRect(x, cy, w, bh);
    ctx.strokeStyle = p.th.line;
    ctx.lineWidth = Math.max(1, p.f * 0.05);
    ctx.strokeRect(x, cy, w, bh);
    cy += bh + p.f * 1.1;
    p.text(lg.loText ?? fmtMm(lg.lo, 3), x, cy, { scale: 0.9 });
    if (lg.zero) p.text('0', x + w / 2, cy, { scale: 0.9, align: 'center' });
    p.text(lg.hiText ?? `${fmtMm(lg.hi, 3)} ${lg.unit}`, x + w, cy, { scale: 0.9, align: 'right' });
    if (lg.loLabel && lg.hiLabel) {
      cy += lh;
      p.text(lg.loLabel, x, cy, { scale: 0.9, color: p.th.sub });
      p.text(lg.hiLabel, x + w, cy, { scale: 0.9, color: p.th.sub, align: 'right' });
    }
    for (const n of lg.notes ?? []) { cy += lh; p.text(n, x, cy, { scale: 0.9, color: p.th.sub }); }
    return;
  }
  const cols = classColumns(p, lg, w);
  const iw = classItemWidth(p, lg);
  const colW = Math.max(w / cols, iw.total);
  const rows = Math.ceil(lg.items.length / cols);
  const sw = p.f * 0.85;
  lg.items.forEach((it, i) => {
    const c = Math.floor(i / rows), r = i % rows;
    const ix = x + c * colW, iy = cy + r * lh + p.f * 0.9;
    ctx.fillStyle = it.color;
    ctx.fillRect(ix, iy - sw * 0.85, sw, sw);
    const tx = ix + sw + p.f * 0.45;
    p.text(it.label, tx, iy, { scale: 0.95 });
    if (it.pct !== undefined) p.text(`${fmtNum(it.pct, 1)} %`, tx + iw.label + p.f * 0.8 + p.width('100.0 %', 0.95), iy, { scale: 0.95, align: 'right', color: p.th.sub });
  });
  p.text(`R1 = ${lg.loLabel.toLowerCase()} · R${lg.items.length} = ${lg.hiLabel.toLowerCase()}`, x, cy + rows * lh + p.f * 0.9, { scale: 0.85, color: p.th.sub });
}

// ─── Scale bar ──────────────────────────────────────────────────────

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

function scaleBarHeight(p: Pen) { return p.f * 2.4; }

/** Draws a metric scale bar right-aligned at (xRight, yBottom). */
function drawScaleBar(p: Pen, mmPerPx: number, xRight: number, yBottom: number, maxW: number): void {
  const target = maxW * 0.2;
  let L = NICE[0];
  for (const n of NICE) if (n / mmPerPx <= Math.max(target, NICE[0] / mmPerPx)) L = n;
  const len = L / mmPerPx;
  const ctx = p.ctx;
  const h = p.f * 0.32;
  const x0 = xRight - len;
  ctx.fillStyle = p.th.line;
  ctx.fillRect(x0, yBottom - h, len, h);
  const tick = Math.max(1, p.f * 0.08);
  ctx.fillRect(x0, yBottom - h * 2.2, tick, h * 2.2);
  ctx.fillRect(xRight - tick, yBottom - h * 2.2, tick, h * 2.2);
  p.text(`${L < 1 ? fmtNum(L, 1) : L} mm`, x0 + len / 2, yBottom - h * 2.2 - p.f * 0.25, { align: 'center', scale: 0.95 });
}

// ─── Single view ────────────────────────────────────────────────────

export interface ViewRender { canvas: HTMLCanvasElement; mmPerPx: number }
/** Renders the view at width × height px; optional fixed scale (mm/px) and centre (mm, camera plane). */
export type RenderFn = (width: number, height: number, mmPerPx: number | undefined, background: string | null, centerMm?: [number, number]) => ViewRender;
/** Outline of the piece seen from the current camera: centre and size in mm (camera plane). */
export interface Extent { cx: number; cy: number; w: number; h: number }

function measurePen(o: FigureOptions): Pen {
  return new Pen(document.createElement('canvas').getContext('2d')!, o.fontPt, o.dpi, figureTheme(o.background, o.format));
}

function bandHeight(m: Pen, o: FigureOptions, lg: LegendModel, lgW: number, pad: number): number {
  return lg || o.showScale ? pad * 2 + Math.max(legendHeight(m, lg, lgW), o.showScale ? scaleBarHeight(m) : 0) : 0;
}

/**
 * Layout of a single-view figure (shared by the size preview and the composition).
 * `aspect` is the width/height of the render area (outline of the piece or on-screen view).
 */
export function viewLayout(o: FigureOptions, aspect: number, legend: LegendModel) {
  const m = measurePen(o);
  const W = cmToPx(o.widthCm, o.dpi);
  const pad = m.f * 0.8;
  const lg = o.showLegend ? legend : null;
  const lgW = Math.min(W * 0.72, cmToPx(9, o.dpi));
  const bandH = bandHeight(m, o, lg, lgW, pad);
  const nameH = o.showName ? m.f * 1.9 : 0;
  let renderW = W;
  let renderH = Math.round(W / aspect);
  const maxH = o.maxHeightCm > 0 ? cmToPx(o.maxHeightCm, o.dpi) - nameH - bandH : Infinity;
  if (renderH > maxH && maxH > 50) {
    renderH = Math.round(maxH);
    renderW = Math.round(renderH * aspect);
  }
  return { W, H: Math.round(nameH + renderH + bandH), renderW, renderH, pad, lgW, lg, bandH, nameH, f: m.f };
}

/** Width/height of the render area for the current options. */
export function viewAspect(o: FigureOptions, screenAspect: number, extent: Extent): number {
  return o.fit ? extent.w / Math.max(1e-9, extent.h) : screenAspect;
}

export function composeViewFigure(o: FigureOptions, screenAspect: number, extent: Extent, name: string, legend: LegendModel, ramp: ColorRamp, render: RenderFn): HTMLCanvasElement {
  const th = figureTheme(o.background, o.format);
  const L = viewLayout(o, viewAspect(o, screenAspect, extent), legend);
  const out = document.createElement('canvas');
  out.width = L.W; out.height = L.H;
  const ctx = out.getContext('2d')!;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, L.W, L.H); }
  const r = o.fit
    ? render(L.renderW, L.renderH, (extent.w * (1 + 2 * FIT_MARGIN)) / L.renderW, th.bg, [extent.cx, extent.cy])
    : render(L.renderW, L.renderH, undefined, th.bg);
  ctx.drawImage(r.canvas, Math.round((L.W - L.renderW) / 2), L.nameH);
  const p = new Pen(ctx, o.fontPt, o.dpi, th);
  if (o.showName) p.text(p.fit(name, L.W - 2 * L.pad, 1.1, 600), L.pad, L.f * 1.35, { weight: 600, scale: 1.1 });
  const bandY = L.nameH + L.renderH;
  if (L.lg) drawLegend(p, L.lg, ramp, L.pad, bandY + L.pad * 0.6, L.lgW);
  if (o.showScale) drawScaleBar(p, r.mmPerPx, L.W - L.pad, bandY + L.bandH - L.pad, L.W);
  return out;
}

// ─── Grid of views ──────────────────────────────────────────────────

export interface GridCell { name: string; caption?: string; extent: Extent; natural: (w: number, h: number) => number; render: RenderFn }

/** Layout of a grid figure (shared by the size preview and the composition). */
export function gridLayout(o: FigureOptions, cols: number, count: number, cellAspect: number, hasCaption: boolean, legend: LegendModel) {
  const m = measurePen(o);
  const W = cmToPx(o.widthCm, o.dpi);
  const pad = m.f * 0.8;
  const gap = Math.round(m.f * 0.6);
  const rows = Math.ceil(count / cols);
  const cellW = Math.floor((W - gap * (cols - 1)) / cols);
  let cellH = Math.round(cellW / cellAspect);
  const capLines = o.showName ? (hasCaption ? 2 : 1) : 0;
  const capH = capLines ? m.f * (0.6 + 1.3 * capLines) : 0;
  const lg = o.showLegend ? legend : null;
  const lgW = Math.min(W * 0.72, cmToPx(9, o.dpi));
  const bandH = bandHeight(m, o, lg, lgW, pad);
  if (o.maxHeightCm > 0) {
    const maxCellH = (cmToPx(o.maxHeightCm, o.dpi) - bandH - (rows - 1) * gap) / rows - capH;
    if (cellH > maxCellH && maxCellH > 50) cellH = Math.round(maxCellH);
  }
  const gridH = rows * (cellH + capH) + (rows - 1) * gap;
  return { W, H: Math.round(gridH + bandH), pad, gap, cellW, cellH, capH, lgW, lg, bandH, gridH, f: m.f };
}

/** Cell aspect: common outline box of all pieces (fit) or the on-screen cell. */
export function gridCellAspect(o: FigureOptions, screenAspect: number, extents: Extent[]): number {
  if (!o.fit || !extents.length) return screenAspect;
  return Math.max(...extents.map((e) => e.w)) / Math.max(1e-9, ...extents.map((e) => e.h));
}

export function composeGridFigure(o: FigureOptions, cols: number, screenAspect: number, cells: GridCell[], legend: LegendModel, ramp: ColorRamp): HTMLCanvasElement {
  const th = figureTheme(o.background, o.format);
  const exts = cells.map((c) => c.extent);
  const L = gridLayout(o, cols, cells.length, gridCellAspect(o, screenAspect, exts), cells.some((c) => c.caption), legend);
  // Same metric scale in every cell, so the pieces keep their relative size.
  const k = 1 + 2 * FIT_MARGIN;
  const mmPerPx = o.fit
    ? Math.max(Math.max(...exts.map((e) => e.w)) * k / L.cellW, Math.max(...exts.map((e) => e.h)) * k / L.cellH)
    : Math.max(...cells.map((c) => c.natural(L.cellW, L.cellH)));
  const out = document.createElement('canvas');
  out.width = L.W; out.height = L.H;
  const ctx = out.getContext('2d')!;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, L.W, L.H); }
  const p = new Pen(ctx, o.fontPt, o.dpi, th);
  cells.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * (L.cellW + L.gap), y = row * (L.cellH + L.capH + L.gap);
    const r = c.render(L.cellW, L.cellH, mmPerPx, th.bg, o.fit ? [c.extent.cx, c.extent.cy] : undefined);
    ctx.drawImage(r.canvas, x, y);
    if (o.showName) {
      p.text(p.fit(c.name, L.cellW, 1, 600), x + L.cellW / 2, y + L.cellH + L.f * 1.2, { weight: 600, align: 'center' });
      if (c.caption) p.text(p.fit(c.caption, L.cellW, 0.9), x + L.cellW / 2, y + L.cellH + L.f * 2.5, { scale: 0.9, align: 'center', color: th.sub });
    }
  });
  if (L.lg) drawLegend(p, L.lg, ramp, L.pad, L.gridH + L.pad * 0.6, L.lgW);
  if (o.showScale) drawScaleBar(p, mmPerPx, L.W - L.pad, L.gridH + L.bandH - L.pad, L.W);
  return out;
}

// ─── Charts (SVG → raster) ──────────────────────────────────────────

export async function rasterizeSvg(svg: string, widthUnits: number, heightUnits: number, o: FigureOptions): Promise<HTMLCanvasElement> {
  const th = figureTheme(o.background, o.format);
  const W = cmToPx(o.widthCm, o.dpi);
  const H = Math.round((W * heightUnits) / widthUnits);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  if (th.bg) { ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H); }
  ctx.drawImage(img, 0, 0, W, H);
  return c;
}

export async function encodeFigure(canvas: HTMLCanvasElement, o: FigureOptions): Promise<Uint8Array> {
  return encodeCanvas(canvas, o.format === 'jpg' ? 'jpg' : 'png', o.dpi);
}

/** Physical size summary, e.g. "17,5 × 12,3 cm · 2067 × 1453 px". */
export function sizeLabel(wPx: number, hPx: number, dpi: number): string {
  const cm = (px: number) => fmtNum((px / dpi) * 2.54, 1);
  return `${cm(wPx)} × ${cm(hPx)} cm · ${wPx} × ${hPx} px`;
}
