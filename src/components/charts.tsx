/**
 * Comparison charts (SVG). The same components draw the on-screen charts (dark theme) and the
 * publication figures (light or dark theme, size in points, exported as SVG / PNG / JPEG).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClassMethod } from '../engine/classify';
import type { TKey } from '../i18n';
import { classColors, fmtMm, fmtNum, rampColor, toCss, type ArtefactClasses } from '../state/analysis';
import { artefactToMm, type Artefact } from '../state/model';

const SERIES = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16', '#d946ef'];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];
/** Dash pattern so that series sharing a colour (11th artefact onwards) remain distinguishable. */
const seriesDash = (i: number, unit: number) => (i < SERIES.length ? undefined : i < 2 * SERIES.length ? `${unit * 4} ${unit * 2}` : `${unit} ${unit * 1.5}`);

export interface ChartTheme {
  text: string;
  grid: string;
  axis: string;
  median: string;
  barLabel: string;
  background: string | null;
}

export const DARK_THEME: ChartTheme = { text: '#94a3b8', grid: 'rgba(255,255,255,0.07)', axis: 'rgba(255,255,255,0.25)', median: '#ffffff', barLabel: '#111111', background: null };
export const LIGHT_THEME: ChartTheme = { text: '#1f2937', grid: '#e5e7eb', axis: '#6b7280', median: '#000000', barLabel: '#111111', background: '#ffffff' };
export const PAPER_DARK_THEME: ChartTheme = { ...DARK_THEME, text: '#e5e7eb', background: '#0d0d14' };

export interface ChartTexts {
  mm: string;
  density: string;
  dist: string;
  box: string;
  hist: string;
  polishedMost: string;
  polishedLeast: string;
  kVaries: string;
}

/** Chart texts in the interface language. */
export function chartTexts(t: (k: TKey) => string): ChartTexts {
  return {
    mm: t('fig.axisRqr'), density: t('fig.axisDensity'), dist: t('cmp.dist'), box: t('cmp.box'), hist: t('cmp.hist'),
    polishedMost: t('view.polishedMost'), polishedLeast: t('view.polishedLeast'), kVaries: t('legend.kVaries'),
  };
}

export interface ChartProps {
  items: Artefact[];
  classes: Map<string, ArtefactClasses>;
  method: ClassMethod;
  /** Class labels for k classes. */
  labelsFor: (k: number) => string[];
  texts: ChartTexts;
  theme: ChartTheme;
  /** Total width in user units (on screen: 760; figures: width in points). */
  width: number;
  /** Base font size in user units. */
  font: number;
  title?: string;
}

const FONT = 'Segoe UI, Arial, Helvetica, sans-serif';
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const niceTicks = (max: number, n = 5) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n);

/** Round axis: step of 1, 2, 2.5 or 5 × 10^k, top = first tick ≥ max. */
export function niceAxis(max: number, target = 5): { top: number; ticks: number[]; digits: number } {
  const raw = Math.max(max, 1e-12) / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  const step = m * p;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + step * 1e-6; i++) ticks.push(+(i * step).toPrecision(12));
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (m === 2.5 ? 1 : 0));
  return { top, ticks, digits };
}

function Frame({ p, height, children }: { p: ChartProps; height: number; children: React.ReactNode }) {
  const titleH = p.title ? p.font * 2 : 0;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox={`0 0 ${p.width} ${height + titleH}`} fontFamily={FONT} fontSize={p.font} fill={p.theme.text}>
      {p.theme.background && <rect width={p.width} height={height + titleH} fill={p.theme.background} />}
      {p.title && <text x={0} y={p.font * 1.3} fontWeight={600} fontSize={p.font * 1.1}>{p.title}</text>}
      <g transform={`translate(0, ${titleH})`}>{children}</g>
    </svg>
  );
}

function layout(p: ChartProps) {
  const labelW = Math.min(p.width * 0.28, p.font * 12);
  const rowH = p.font * 2.3;
  const right = p.font * 2;
  return { labelW, rowH, plotW: p.width - labelW - right };
}

/** Stacked bars: % of vertices per class, one bar per artefact, with class legend. */
export function ClassDistChart(p: ChartProps) {
  const { labelW, rowH, plotW } = layout(p);
  const n = p.items.length;
  const ks = p.items.map((a) => p.classes.get(a.id)?.classification.k).filter((k): k is number => k !== undefined);
  const maxK = Math.max(1, ...ks);
  // Auto-k may give a different k to each artefact: class i of k = 3 is not class i of k = 4, so a
  // discrete legend would be wrong. A continuous R1 → Rk legend is shown instead.
  const mixed = new Set(ks).size > 1;
  const pal = classColors(maxK);
  const labels = p.labelsFor(maxK);
  const axisY = n * rowH + p.font * 0.4;
  const legendTop = axisY + p.font * 3.2;
  const sw = p.font * 0.9;
  const entries: { x: number; y: number; i: number }[] = [];
  let lx = 0, ly = legendTop;
  if (!mixed) {
    labels.forEach((l, i) => {
      const w = sw + p.font * 0.5 + l.length * p.font * 0.52 + p.font * 1.4;
      if (lx + w > p.width && lx > 0) { lx = 0; ly += p.font * 1.5; }
      entries.push({ x: lx, y: ly, i });
      lx += w;
    });
  } else {
    ly += p.font * 2.6;
  }
  const height = ly + p.font * 1.2;
  const gradW = Math.min(p.width * 0.5, p.font * 22);
  const gradId = `mrm-kgrad-${Math.round(p.width)}-${Math.round(p.font * 10)}`;
  return (
    <Frame p={p} height={height}>
      {p.items.map((a, r) => {
        const cl = p.classes.get(a.id);
        if (!cl) return null;
        const cpal = classColors(cl.classification.k);
        const rowLabels = p.labelsFor(cl.classification.k);
        let x = labelW;
        return (
          <g key={a.id} transform={`translate(0, ${r * rowH})`}>
            <text x={labelW - p.font * 0.6} y={rowH / 2 + p.font * 0.35} textAnchor="end">{short(a.name, 22)}{mixed ? ` (k=${cl.classification.k})` : ''}</text>
            {cl.distribution.map((pct, c) => {
              const w = (pct / 100) * plotW;
              const el = (
                <g key={c}>
                  <rect x={x} y={rowH * 0.15} width={Math.max(0, w)} height={rowH * 0.7} fill={toCss(cpal[c])}>
                    <title>{`${rowLabels[c]}: ${fmtNum(pct, 1)} %`}</title>
                  </rect>
                  {w > p.font * 2.6 && (
                    <text x={x + w / 2} y={rowH / 2 + p.font * 0.35} textAnchor="middle" fill={p.theme.barLabel} fontWeight={600} fontSize={p.font * 0.9}>{pct.toFixed(0)}</text>
                  )}
                </g>
              );
              x += w;
              return el;
            })}
          </g>
        );
      })}
      <line x1={labelW} x2={labelW + plotW} y1={axisY} y2={axisY} stroke={p.theme.axis} strokeWidth={p.font * 0.06} />
      {niceTicks(100, 4).map((v) => (
        <text key={v} x={labelW + (v / 100) * plotW} y={axisY + p.font * 1.4} textAnchor="middle">{v} %</text>
      ))}
      {!mixed && entries.map(({ x, y, i }) => (
        <g key={i} transform={`translate(${x}, ${y})`}>
          <rect y={-sw * 0.85} width={sw} height={sw} fill={toCss(pal[i])} />
          <text x={sw + p.font * 0.5} y={0}>{labels[i]}</text>
        </g>
      ))}
      {mixed && (
        <g transform={`translate(0, ${legendTop})`}>
          <defs>
            <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
              {Array.from({ length: 11 }, (_, i) => <stop key={i} offset={i / 10} stopColor={toCss(rampColor('bgyr', i / 10))} />)}
            </linearGradient>
          </defs>
          <text x={0} y={0}>R1</text>
          <rect x={p.font * 1.8} y={-sw * 0.85} width={gradW} height={sw} fill={`url(#${gradId})`} />
          <text x={p.font * 2.3 + gradW} y={0}>Rk</text>
          <text x={p.font * 1.8} y={p.font * 1.4} fontSize={p.font * 0.85}>{p.texts.polishedMost}</text>
          <text x={p.font * 1.8 + gradW} y={p.font * 1.4} fontSize={p.font * 0.85} textAnchor="end">{p.texts.polishedLeast}</text>
          <text x={0} y={p.font * 2.8} fontSize={p.font * 0.85}>{p.texts.kVaries}</text>
        </g>
      )}
    </Frame>
  );
}

/** Box plots of Rqr (mm): whiskers p5–p95, box p25–p75, median. */
export function BoxPlotChart(p: ChartProps) {
  const { labelW, rowH, plotW } = layout(p);
  const n = p.items.length;
  const ax = niceAxis(Math.max(1e-9, ...p.items.map((a) => a.result!.rqrStats.p95 * artefactToMm(a))) * 1.02);
  const boxMax = ax.top;
  const axisY = n * rowH + p.font * 0.4;
  const height = axisY + p.font * 3.4;
  const sw = p.font * 0.08;
  return (
    <Frame p={p} height={height}>
      {ax.ticks.map((v) => {
        const x = labelW + (v / boxMax) * plotW;
        return (
          <g key={v}>
            <line x1={x} x2={x} y1={0} y2={axisY} stroke={p.theme.grid} strokeWidth={sw} />
            <text x={x} y={axisY + p.font * 1.4} textAnchor="middle">{fmtNum(v, ax.digits)}</text>
          </g>
        );
      })}
      <line x1={labelW} x2={labelW + plotW} y1={axisY} y2={axisY} stroke={p.theme.axis} strokeWidth={sw} />
      <text x={labelW + plotW / 2} y={axisY + p.font * 2.9} textAnchor="middle">{p.texts.mm}</text>
      {p.items.map((a, i) => {
        const s = a.result!.rqrStats, f = artefactToMm(a);
        const X = (v: number) => labelW + ((v * f) / boxMax) * plotW;
        const mid = i * rowH + rowH / 2, c = seriesColor(i), bh = rowH * 0.32;
        const dash = seriesDash(i, sw * 3);
        return (
          <g key={a.id}>
            <text x={labelW - p.font * 0.6} y={mid + p.font * 0.35} textAnchor="end">{short(a.name, 22)}</text>
            <line x1={X(s.p5)} x2={X(s.p95)} y1={mid} y2={mid} stroke={c} strokeWidth={sw * 1.5} strokeDasharray={dash} />
            <line x1={X(s.p5)} x2={X(s.p5)} y1={mid - bh * 0.6} y2={mid + bh * 0.6} stroke={c} strokeWidth={sw * 1.5} />
            <line x1={X(s.p95)} x2={X(s.p95)} y1={mid - bh * 0.6} y2={mid + bh * 0.6} stroke={c} strokeWidth={sw * 1.5} />
            <rect x={X(s.p25)} y={mid - bh} width={Math.max(sw, X(s.p75) - X(s.p25))} height={bh * 2} fill={c} fillOpacity={0.35} stroke={c} strokeWidth={sw * 1.5} strokeDasharray={dash} />
            <line x1={X(s.median)} x2={X(s.median)} y1={mid - bh} y2={mid + bh} stroke={p.theme.median} strokeWidth={sw * 3} />
            <title>{`p5 ${fmtMm(s.p5 * f)} · p25 ${fmtMm(s.p25 * f)} · median ${fmtMm(s.median * f)} · p75 ${fmtMm(s.p75 * f)} · p95 ${fmtMm(s.p95 * f)} mm`}</title>
          </g>
        );
      })}
    </Frame>
  );
}

export interface HistData { maxX: number; maxY: number; bins: number; series: number[][] }

export function histogramData(items: Artefact[], bins = 60): HistData | null {
  if (!items.length) return null;
  const maxX = niceAxis(Math.max(1e-9, ...items.map((a) => a.result!.rqrStats.p95 * artefactToMm(a))) * 1.3).top;
  const series = items.map((a) => {
    const f = artefactToMm(a);
    const counts = new Float64Array(bins);
    const rq = a.result!.rqr;
    for (let i = 0; i < rq.length; i++) {
      const b = Math.floor(((rq[i] * f) / maxX) * bins);
      if (b >= 0 && b < bins) counts[b]++;
    }
    const w = maxX / bins;
    return Array.from(counts, (c) => c / (rq.length * w));
  });
  return { maxX, maxY: Math.max(1e-12, ...series.flatMap((s) => s)), bins, series };
}

const HIST_LEGEND_MAX = 12;

/** Overlaid Rqr density histograms (mm). */
export function HistChart(p: ChartProps & { hist: HistData }) {
  const h = p.hist;
  const x0 = p.font * 4.2, pw = p.width - x0 - p.font * 2, ph = p.width * 0.26, top = p.font * 0.6;
  const y0 = top + ph;
  const sw = p.font * 0.08;
  const height = y0 + p.font * 3.4;
  const xa = niceAxis(h.maxX);
  const ya = niceAxis(h.maxY, 4);
  const maxY = ya.top;
  const shown = p.items.slice(0, HIST_LEGEND_MAX);
  const hidden = p.items.length - shown.length;
  return (
    <Frame p={p} height={height}>
      {xa.ticks.filter((v) => v <= h.maxX + 1e-12).map((v) => (
        <g key={v}>
          <line x1={x0 + (v / h.maxX) * pw} x2={x0 + (v / h.maxX) * pw} y1={top} y2={y0} stroke={p.theme.grid} strokeWidth={sw} />
          <text x={x0 + (v / h.maxX) * pw} y={y0 + p.font * 1.4} textAnchor="middle">{fmtNum(v, xa.digits)}</text>
        </g>
      ))}
      {ya.ticks.map((v) => (
        <text key={v} x={x0 - p.font * 0.5} y={y0 - (v / maxY) * ph + p.font * 0.35} textAnchor="end" fontSize={p.font * 0.85}>{fmtNum(v, ya.digits)}</text>
      ))}
      <line x1={x0} x2={x0 + pw} y1={y0} y2={y0} stroke={p.theme.axis} strokeWidth={sw} />
      <line x1={x0} x2={x0} y1={top} y2={y0} stroke={p.theme.axis} strokeWidth={sw} />
      <text x={x0 + pw / 2} y={y0 + p.font * 2.9} textAnchor="middle">{p.texts.mm}</text>
      <text transform={`translate(${p.font * 0.9}, ${top + ph / 2}) rotate(-90)`} textAnchor="middle">{p.texts.density}</text>
      {h.series.map((s, i) => (
        <polyline key={i} fill="none" stroke={seriesColor(i)} strokeWidth={p.font * 0.15} strokeLinejoin="round" strokeDasharray={seriesDash(i, p.font * 0.3)}
          points={s.map((v, b) => `${(x0 + ((b + 0.5) / h.bins) * pw).toFixed(2)},${(y0 - (v / maxY) * ph).toFixed(2)}`).join(' ')} />
      ))}
      {shown.map((a, i) => (
        <g key={a.id} transform={`translate(${x0 + pw - p.font * 13}, ${top + p.font * (1.2 + i * 1.35)})`}>
          <line x1={0} x2={p.font * 1.1} y1={-p.font * 0.3} y2={-p.font * 0.3} stroke={seriesColor(i)} strokeWidth={p.font * 0.25} strokeDasharray={seriesDash(i, p.font * 0.15)} />
          <text x={p.font * 1.6} y={0}>{short(a.name, 24)}</text>
        </g>
      ))}
      {hidden > 0 && (
        <text x={x0 + pw - p.font * 13 + p.font * 1.6} y={top + p.font * (1.2 + shown.length * 1.35)} fontSize={p.font * 0.85}>{`+${hidden}`}</text>
      )}
    </Frame>
  );
}

export type ChartKind = 'dist' | 'box' | 'hist';

/** Standalone SVG markup of a chart (for figure export). Returns the SVG and its size in user units. */
export function chartSvg(kind: ChartKind, p: ChartProps): { svg: string; width: number; height: number } {
  const el =
    kind === 'dist' ? <ClassDistChart {...p} /> :
    kind === 'box' ? <BoxPlotChart {...p} /> :
    <HistChart {...p} hist={histogramData(p.items)!} />;
  let svg = renderToStaticMarkup(el);
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
  const width = +vb[1], height = +vb[2];
  // Physical size: user units are points in figures.
  svg = svg.replace('width="100%"', `width="${width}pt" height="${height}pt"`);
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, width, height };
}
