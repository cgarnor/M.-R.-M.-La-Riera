import React, { useState } from 'react';
import { ChevronDown, RefreshCw, RotateCcw, Settings2 } from 'lucide-react';
import { useI18n, type TKey } from '../i18n';
import { DEFAULT_MRM_PARAMS, sanitizeMrmParams, type MrmParams } from '../engine/types';
import { NumInput } from './NumInput';

interface Props {
  params: MrmParams;
  onChange: (p: MrmParams) => void;
  poissonAvailable: boolean;
  canApplySelected: boolean;
  checkedCount: number;
  onApplySelected: () => void;
  onApplyChecked: () => void;
}

function NumField({ label, value, onChange, step = 1, min, max, scale = 1, integer }: {
  label: TKey; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; scale?: number; integer?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="field-row">
      <span className="field-label">{t(label)}</span>
      <NumInput ariaLabel={t(label)} value={+(value * scale).toFixed(6)} min={min} max={max} step={step} integer={integer} onCommit={(v) => { if (v !== undefined) onChange(v / scale); }} />
    </div>
  );
}

export function ParamsPanel({ params, onChange, poissonAvailable, canApplySelected, checkedCount, onApplySelected, onApplyChecked }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  // Every change is validated (same limits as project files and the desktop bridge).
  const set = (patch: Partial<MrmParams>) => onChange(sanitizeMrmParams({ ...params, ...patch }));
  const isDefault = JSON.stringify(params) === JSON.stringify(DEFAULT_MRM_PARAMS);

  return (
    <div className="card">
      <div className="card-title clickable" role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}>
        <Settings2 size={15} />
        {t('params.title')}
        <ChevronDown size={14} style={{ marginLeft: 'auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s', color: 'var(--text-muted)' }} />
      </div>
      {open && (
        <div className="card-body">
          <div className="field">
            <span className="field-label">{t('params.trend')}</span>
            <div className="seg two-line">
              <button className={params.trendMethod === 'poisson' ? 'on' : ''} onClick={() => set({ trendMethod: 'poisson' })}>
                {t('params.poisson')}<span className="ref">({t('params.poissonRef')})</span>
              </button>
              <button className={params.trendMethod === 'decimation' ? 'on' : ''} onClick={() => set({ trendMethod: 'decimation' })}>
                {t('params.decimation')}<span className="ref">({t('params.decimationRef')})</span>
              </button>
            </div>
            {params.trendMethod === 'poisson' && !poissonAvailable && <div className="note warn">{t('params.poissonMissing')}</div>}
          </div>

          {params.trendMethod === 'poisson' ? (
            <>
              <NumField label="params.sampleFraction" value={params.sampleFraction} scale={100} step={1} min={1} max={100} onChange={(v) => set({ sampleFraction: v })} />
              <NumField label="params.depth" value={params.poissonDepth} step={1} min={5} max={12} integer onChange={(v) => set({ poissonDepth: v })} />
              <NumField label="params.spn" value={params.poissonSamplesPerNode} step={0.5} min={1} max={20} onChange={(v) => set({ poissonSamplesPerNode: v })} />
              <NumField label="params.pointWeight" value={params.poissonPointWeight} step={0.5} min={0} max={100} onChange={(v) => set({ poissonPointWeight: v })} />
              <NumField label="params.seed" value={params.sampleSeed} step={1} min={0} max={2147483647} integer onChange={(v) => set({ sampleSeed: v })} />
            </>
          ) : (
            <NumField label="params.decimationKeep" value={params.decimationKeep} scale={100} step={1} min={1} max={90} onChange={(v) => set({ decimationKeep: v })} />
          )}
          <NumField label="params.iterations" value={params.smoothIterations} step={1} min={0} max={200} integer onChange={(v) => set({ smoothIterations: v })} />
          <NumField label="params.factor" value={params.smoothFactor} step={0.05} min={0} max={1} onChange={(v) => set({ smoothFactor: v })} />
          <label className="check">
            <input type="checkbox" checked={params.signBoundarySmoothing} onChange={(e) => set({ signBoundarySmoothing: e.target.checked })} />
            {t('params.signSmoothing')}
          </label>

          <div className="note">{t('params.note')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_MRM_PARAMS })}>
              <RotateCcw size={12} /> {t('params.reset')}
            </button>
            <button className="btn sm" disabled={!canApplySelected} onClick={onApplySelected}>
              <RefreshCw size={12} /> {t('params.applySelected')}
            </button>
            <button className="btn sm" disabled={checkedCount === 0} onClick={onApplyChecked}>
              <RefreshCw size={12} /> {t('params.applyChecked')} ({checkedCount})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
