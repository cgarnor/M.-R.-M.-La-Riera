import React, { useEffect, useMemo, useState } from 'react';
import { ImageDown, Loader2 } from 'lucide-react';
import { describeError, useI18n, type TKey } from '../i18n';
import { fmtNum } from '../state/analysis';
import type { ChartKind } from './charts';
import { sizeLabel, type FigureBackground, type FigureFormat, type FigureOptions } from '../utils/figure';
import { NumInput } from './NumInput';

export type ExportMode = 'view' | 'grid' | 'compare';
export interface CompareSelection { charts: ChartKind[]; csv: boolean }

const DEFAULTS: Record<ExportMode, FigureOptions> = {
  view: { format: 'png', dpi: 300, widthCm: 8.5, maxHeightCm: 23, fontPt: 8, background: 'white', fit: true, showName: true, showLegend: true, showScale: true, showTitle: false },
  grid: { format: 'png', dpi: 300, widthCm: 17.5, maxHeightCm: 23, fontPt: 8, background: 'white', fit: true, showName: true, showLegend: true, showScale: true, showTitle: false },
  compare: { format: 'png', dpi: 300, widthCm: 17.5, maxHeightCm: 23, fontPt: 8, background: 'white', fit: true, showName: true, showLegend: true, showScale: false, showTitle: false },
};
const WIDTHS = [8.5, 12, 17.5];
const DPIS = [300, 600];

const LIMITS = { dpi: [72, 1200], widthCm: [3, 50], maxHeightCm: [0, 100], fontPt: [4, 24] } as const;

/** Last options used for this kind of export (validated: localStorage is not trusted). */
function load(mode: ExportMode): FigureOptions {
  const d = DEFAULTS[mode];
  try {
    const s = JSON.parse(localStorage.getItem(`mrm.figure.${mode}`) || 'null');
    if (!s || typeof s !== 'object') return d;
    const n = (k: keyof typeof LIMITS) => {
      const v = s[k];
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)) : d[k];
    };
    const b = (k: 'fit' | 'showName' | 'showLegend' | 'showScale' | 'showTitle') => (typeof s[k] === 'boolean' ? s[k] : d[k]);
    const formats: FigureFormat[] = mode === 'compare' ? ['png', 'jpg', 'svg'] : ['png', 'jpg'];
    const format = formats.includes(s.format) ? s.format : d.format;
    const bgs: FigureBackground[] = format === 'jpg' ? ['white', 'black'] : ['white', 'black', 'transparent'];
    return {
      format, background: bgs.includes(s.background) ? s.background : 'white',
      dpi: Math.round(n('dpi')), widthCm: n('widthCm'), maxHeightCm: n('maxHeightCm'), fontPt: n('fontPt'),
      fit: b('fit'), showName: b('showName'), showLegend: b('showLegend'), showScale: b('showScale'), showTitle: b('showTitle'),
    };
  } catch {
    return d;
  }
}

interface Props {
  mode: ExportMode;
  /** Pixel size of the resulting image for the given options (null if unknown). */
  preview: (o: FigureOptions) => [number, number] | null;
  onExport: (o: FigureOptions, sel: CompareSelection) => Promise<void>;
  onClose: () => void;
}

export function ExportDialog({ mode, preview, onExport, onClose }: Props) {
  const { t } = useI18n();
  const [o, setO] = useState<FigureOptions>(() => load(mode));
  const [sel, setSel] = useState<CompareSelection>({ charts: ['dist', 'box', 'hist'], csv: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<FigureOptions>) => setO((cur) => {
    const next = { ...cur, ...p };
    if (next.format === 'jpg' && next.background === 'transparent') next.background = 'white';
    return next;
  });
  const size = useMemo(() => (o.format === 'svg' ? null : preview(o)), [o, preview]);
  const formats: FigureFormat[] = mode === 'compare' ? ['png', 'jpg', 'svg'] : ['png', 'jpg'];
  const bgs: FigureBackground[] = o.format === 'jpg' ? ['white', 'black'] : ['white', 'black', 'transparent'];
  const toggleChart = (k: ChartKind) => setSel((s) => ({ ...s, charts: s.charts.includes(k) ? s.charts.filter((c) => c !== k) : [...s.charts, k] }));
  const nothing = mode === 'compare' && !sel.charts.length && !sel.csv;

  // Escape closes the dialog (except while saving).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(`mrm.figure.${mode}`, JSON.stringify(o));
      await onExport(o, sel);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.startsWith('MAX_SIZE:') ? t('fig.tooLarge', { n: msg.split(':')[1] }) : describeError(msg, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mrm-export-title" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div id="mrm-export-title" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><ImageDown size={16} />{t(`fig.title.${mode}` as TKey)}</div>

        {mode === 'compare' && (
          <div className="field">
            <span className="field-label">{t('fig.content')}</span>
            {(['dist', 'box', 'hist'] as ChartKind[]).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={sel.charts.includes(k)} onChange={() => toggleChart(k)} />{t(`cmp.${k}` as TKey)}</label>
            ))}
            <label className="check"><input type="checkbox" checked={sel.csv} onChange={(e) => setSel((s) => ({ ...s, csv: e.target.checked }))} />{t('fig.csv')}</label>
          </div>
        )}

        <div className="field">
          <span className="field-label">{t('fig.format')}</span>
          <div className="seg">
            {formats.map((f) => <button key={f} className={o.format === f ? 'on' : ''} onClick={() => set({ format: f })}>{f.toUpperCase()}</button>)}
          </div>
          {o.format === 'svg' && <div className="note">{t('fig.svgNote')}</div>}
        </div>

        {o.format !== 'svg' && (
          <div className="field">
            <span className="field-label">{t('fig.dpi')}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div className="seg" style={{ flex: 1 }}>
                {DPIS.map((d) => <button key={d} className={o.dpi === d ? 'on' : ''} onClick={() => set({ dpi: d })}>{d} {t('fig.dpiUnit')}</button>)}
              </div>
              <NumInput ariaLabel={t('fig.dpi')} value={o.dpi} min={LIMITS.dpi[0]} max={LIMITS.dpi[1]} step={50} integer onCommit={(v) => v !== undefined && set({ dpi: v })} style={{ width: 80 }} />
            </div>
            {o.dpi < 300 && <div className="note warn">{t('fig.dpiLow')}</div>}
          </div>
        )}

        <div className="field">
          <span className="field-label">{t('fig.width')}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="seg" style={{ flex: 1 }}>
              {WIDTHS.map((w) => <button key={w} className={o.widthCm === w ? 'on' : ''} onClick={() => set({ widthCm: w })}>{fmtNum(w, w % 1 ? 1 : 0)} cm</button>)}
            </div>
            <NumInput ariaLabel={`${t('fig.width')} (cm)`} value={o.widthCm} min={LIMITS.widthCm[0]} max={LIMITS.widthCm[1]} step={0.5} digits={2} onCommit={(v) => v !== undefined && set({ widthCm: v })} style={{ width: 80 }} />
          </div>
          <div className="note">{t('fig.widthHint')}</div>
        </div>

        {mode !== 'compare' && (
          <div className="field-row">
            <span className="field-label">{t('fig.maxHeight')}</span>
            <NumInput ariaLabel={t('fig.maxHeight')} value={o.maxHeightCm} min={LIMITS.maxHeightCm[0]} max={LIMITS.maxHeightCm[1]} step={0.5} digits={2} onCommit={(v) => v !== undefined && set({ maxHeightCm: v })} style={{ width: 80 }} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <span className="field-label">{t('fig.background')}</span>
            <select className="select" aria-label={t('fig.background')} value={o.background} onChange={(e) => set({ background: e.target.value as FigureBackground })}>
              {bgs.map((b) => <option key={b} value={b}>{t(`fig.bg.${b}` as TKey)}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field-label">{t('fig.font')}</span>
            <NumInput ariaLabel={t('fig.font')} value={o.fontPt} min={LIMITS.fontPt[0]} max={LIMITS.fontPt[1]} step={0.5} digits={1} onCommit={(v) => v !== undefined && set({ fontPt: v })} />
          </div>
        </div>

        <div className="field">
          <span className="field-label">{t('fig.include')}</span>
          {mode !== 'compare' ? (
            <>
              <label className="check"><input type="checkbox" checked={o.fit} onChange={(e) => set({ fit: e.target.checked })} />{t('fig.fit')}</label>
              <label className="check"><input type="checkbox" checked={o.showName} onChange={(e) => set({ showName: e.target.checked })} />{t(mode === 'grid' ? 'fig.names' : 'fig.name')}</label>
              <label className="check"><input type="checkbox" checked={o.showLegend} onChange={(e) => set({ showLegend: e.target.checked })} />{t('fig.legend')}</label>
              <label className="check"><input type="checkbox" checked={o.showScale} onChange={(e) => set({ showScale: e.target.checked })} />{t('fig.scale')}</label>
            </>
          ) : (
            <label className="check"><input type="checkbox" checked={o.showTitle} onChange={(e) => set({ showTitle: e.target.checked })} />{t('fig.chartTitle')}</label>
          )}
        </div>

        {mode !== 'compare' && <div className="note">{t('fig.orthoNote')}</div>}
        {size && <div className="note" style={{ color: 'var(--text-secondary)' }}>{t('fig.size')}: {sizeLabel(size[0], size[1], o.dpi)} · {o.dpi} {t('fig.dpiUnit')}</div>}
        {error && <div className="note err" role="alert">{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={busy || nothing} onClick={run}>
            {busy ? <Loader2 size={14} className="spin" /> : <ImageDown size={14} />}{t('fig.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
