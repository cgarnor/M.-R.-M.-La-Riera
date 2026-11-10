import React from 'react';
import { Check, Download, FileBox, Ruler, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Artefact, ArtefactDims, ArtefactMeta, Unit } from '../state/model';
import { UNITS, UNIT_LABEL, artefactDimsMm, artefactToMm, dimsMismatchPct, hasCustomDims } from '../state/model';
import { fmtInt, fmtNum } from '../state/analysis';
import { NumInput } from './NumInput';

interface Props {
  artefact: Artefact;
  onRename: (name: string) => void;
  onMeta: (meta: ArtefactMeta) => void;
  onUnit: (u: Unit) => void;
  onDims: (dims: ArtefactDims | undefined) => void;
  onExportPly: () => void;
  onExportTrend: () => void;
}

const DIM_KEYS: { key: keyof ArtefactDims; label: 'art.length' | 'art.width' | 'art.thickness' }[] = [
  { key: 'lengthMm', label: 'art.length' },
  { key: 'widthMm', label: 'art.width' },
  { key: 'thicknessMm', label: 'art.thickness' },
];

/** Number with up to 5 significant digits, trailing zeros removed. */
const sig = (v: number) => fmtNum(v, Math.max(0, 4 - Math.floor(Math.log10(Math.abs(v) || 1)))).replace(/([.,]\d*?)0+$/, '$1').replace(/[.,]$/, '');

export function ArtefactPanel({ artefact: a, onRename, onMeta, onUnit, onDims, onExportPly, onExportTrend }: Props) {
  const { t } = useI18n();
  const r = a.result;
  const setMeta = (patch: Partial<ArtefactMeta>) => onMeta({ ...a.meta, ...patch });
  const custom = hasCustomDims(a);
  const dimsMm = artefactDimsMm(a);
  const f = artefactToMm(a);
  const mismatch = dimsMismatchPct(a);
  const totalMs = r ? Object.values(r.info.timingsMs).reduce((s, v) => s + v, 0) : 0;

  const setDim = (key: keyof ArtefactDims, v: number | undefined) => {
    const next: ArtefactDims = { ...a.dims, [key]: v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined };
    const any = DIM_KEYS.some((d) => next[d.key] !== undefined);
    onDims(any ? next : undefined);
  };

  return (
    <div className="card">
      <div className="card-title"><FileBox size={15} />{t('art.title')}</div>
      <div className="card-body">
        <div className="field">
          <label>{t('art.name')}</label>
          <input className="input" value={a.name} maxLength={200} onChange={(e) => onRename(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="field"><label>{t('art.site')}</label><input className="input" value={a.meta.site} maxLength={500} onChange={(e) => setMeta({ site: e.target.value })} /></div>
          <div className="field"><label>{t('art.type')}</label><input className="input" value={a.meta.type} maxLength={500} onChange={(e) => setMeta({ type: e.target.value })} /></div>
          <div className="field"><label>{t('art.material')}</label><input className="input" value={a.meta.material} maxLength={500} onChange={(e) => setMeta({ material: e.target.value })} /></div>
          <div className="field">
            <label>{t('art.unit')}</label>
            <select className="select" value={a.unit} disabled={custom} onChange={(e) => onUnit(e.target.value as Unit)}>
              {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </div>
        </div>

        {r && (
          <>
            {/* Real dimensions: rescale unscaled / wrongly scaled models */}
            <div className="field">
              <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Ruler size={13} />{t('art.dimsTitle')}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '4px 8px', alignItems: 'center', fontSize: '0.74rem' }}>
                <span />
                <span className="field-label" style={{ fontSize: '0.66rem' }}>{t('art.dimsMeasured')}</span>
                <span className="field-label" style={{ fontSize: '0.66rem' }}>{t('art.dimsModel')}</span>
                {DIM_KEYS.map((d, i) => (
                  <React.Fragment key={d.key}>
                    <span>{t(d.label)}</span>
                    <NumInput ariaLabel={`${t(d.label)} (mm)`} value={a.dims?.[d.key]} min={0.001} max={1e6} step={0.1} digits={3} allowEmpty placeholder="–" onCommit={(v) => setDim(d.key, v)} />
                    <span style={{ opacity: 0.75 }}>{dimsMm ? `${fmtNum(dimsMm[i], 1)} mm` : '–'}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className="note">{t('art.dimsHint')}</div>
              {custom && (
                <>
                  <div className="note">{t('art.unitOverridden')} {t('art.dimsScale', { f: sig(f) })}</div>
                  {mismatch > 5 && <div className="note warn">{t('art.dimsMismatch', { p: fmtNum(mismatch, 1) })}</div>}
                  <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onDims(undefined)}><X size={12} />{t('art.dimsClear')}</button>
                </>
              )}
            </div>
          </>
        )}

        <div className="field"><label>{t('art.notes')}</label><textarea className="textarea" value={a.meta.notes} maxLength={10000} onChange={(e) => setMeta({ notes: e.target.value })} /></div>

        {r && (
          <>
            <div className="kv">
              <span className="k">{t('art.vertices')}</span><span className="v">{fmtInt(r.info.vertexCount)}</span>
              <span className="k">{t('art.faces')}</span><span className="v">{fmtInt(r.info.faceCount)}</span>
              <span className="k">{t('art.method')}</span>
              <span className="v">
                {r.params.trendMethod === 'poisson'
                  ? `Poisson d${r.params.poissonDepth} · ${Math.round(r.params.sampleFraction * 100)} %`
                  : `QEM ${Math.round(r.params.decimationKeep * 100)} %`}
                {` · Lap ${r.params.smoothIterations}×${sig(r.params.smoothFactor)}`}
              </span>
              <span className="k">{t('art.trend')}</span><span className="v">{fmtInt(r.info.trendVertexCount)} v</span>
              <span className="k">{t('art.time')}</span><span className="v">{fmtNum(totalMs / 1000, 1)} s</span>
            </div>
            {(r.info.isolatedVertices ?? 0) > 0 && <div className="note warn">{t('art.isolated', { n: fmtInt(r.info.isolatedVertices!) })}</div>}
            {!a.unitConfirmed && !custom && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="note warn">{t('art.unitEstimated', { u: UNIT_LABEL[a.unit] })}</div>
                <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onUnit(a.unit)}><Check size={12} />{t('art.unitConfirm')}</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={onExportPly}><Download size={12} />{t('art.exportPly')}</button>
              <button className="btn sm" onClick={onExportTrend}><Download size={12} />{t('art.exportTrend')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
