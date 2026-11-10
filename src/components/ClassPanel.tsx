import React from 'react';
import { Gem } from 'lucide-react';
import { useI18n, type TKey } from '../i18n';
import type { ClassMethod } from '../engine/classify';
import type { ClassParams } from '../engine/types';
import { classColors, fmtMm, fmtNum, toCss, type ArtefactClasses } from '../state/analysis';
import type { Artefact, ScaleMode } from '../state/model';
import { artefactToMm } from '../state/model';

/** Labels for the classes of a classification. */
export function classLabels(method: ClassMethod, k: number, t: (k: TKey) => string): string[] {
  if (k === 6 && method !== 'autok') {
    return [1, 2, 3, 4, 5, 6].map((i) => `R${i} · ${t(`class.R${i}` as TKey)}`);
  }
  return Array.from({ length: k }, (_, i) => `R${i + 1}`);
}

interface Props {
  artefact: Artefact | null;
  classes?: ArtefactClasses;
  method: ClassMethod;
  params: ClassParams;
  scale: ScaleMode;
  commonCount: number;
  onMethod: (m: ClassMethod) => void;
  onParams: (p: ClassParams) => void;
  onScale: (s: ScaleMode) => void;
}

export function ClassPanel({ artefact, classes, method, params, scale, commonCount, onMethod, onParams, onScale }: Props) {
  const { t } = useI18n();
  const r = artefact?.result;
  const f = artefact ? artefactToMm(artefact) : 1;
  const methods: ClassMethod[] = ['jenks', 'autok', 'sigma'];
  const k = classes?.classification.k ?? 6;
  const labels = classLabels(method, k, t);
  const pal = classColors(k);

  return (
    <div className="card">
      <div className="card-title"><Gem size={15} />{t('class.title')}</div>
      <div className="card-body">
        <div className="seg">
          {methods.map((m) => (
            <button key={m} className={method === m ? 'on' : ''} onClick={() => onMethod(m)}>{t(`class.${m}` as TKey)}</button>
          ))}
        </div>
        <div className="note">{t(`class.desc.${method}` as TKey)}</div>
        {method === 'sigma' && <div className="note warn">{t('class.experimental')}</div>}

        {(method === 'jenks' || method === 'autok') && (
          <div className="field">
            <span className="field-label">{t('class.algorithm')}</span>
            <div className="seg">
              <button className={params.jenksMethod === 'exact' ? 'on' : ''} onClick={() => onParams({ ...params, jenksMethod: 'exact' })}>{t('class.exact')}</button>
              <button className={params.jenksMethod === 'legacy' ? 'on' : ''} onClick={() => onParams({ ...params, jenksMethod: 'legacy' })} disabled={scale === 'common'}>{t('class.legacy')}</button>
            </div>
            {params.jenksMethod === 'legacy' && scale === 'piece' && <div className="note warn">{t('class.legacyNote')}</div>}
          </div>
        )}

        <div className="field">
          <span className="field-label">{t('class.scale')}</span>
          <div className="seg">
            <button className={scale === 'piece' ? 'on' : ''} onClick={() => onScale('piece')}>{t('class.scalePiece')}</button>
            <button className={scale === 'common' ? 'on' : ''} onClick={() => onScale('common')}>{t('class.scaleCommon')}</button>
          </div>
          {scale === 'common' && (
            <>
              <div className={`note ${commonCount < 2 ? 'warn' : ''}`}>
                {commonCount < 2 ? t('class.scaleCommonNeed') : t('class.scaleCommonNote', { n: commonCount })}
              </div>
              {method !== 'sigma' && <div className="note warn">{t('class.experimental')}</div>}
            </>
          )}
        </div>

        {r && classes && (
          <>
            <div className="stat-grid">
              <div className="stat"><div className="v">{fmtMm(r.rqrStats.mean * f)}</div><div className="k">Rqr {t('stats.mean')} (mm)</div></div>
              <div className="stat"><div className="v">{fmtMm(r.rqrStats.min * f)}</div><div className="k">Rqr {t('stats.min')}</div></div>
              <div className="stat"><div className="v">{fmtMm(r.rqrStats.max * f)}</div><div className="k">Rqr {t('stats.max')}</div></div>
              <div className="stat"><div className="v">{fmtMm(r.rqrStats.std * f)}</div><div className="k">σ</div></div>
              <div className="stat"><div className="v">{fmtMm(r.rqrStats.median * f)}</div><div className="k">{t('stats.median')}</div></div>
              <div className="stat"><div className="v">{k}</div><div className="k">{method === 'autok' ? t('class.k', { k }).split(' (')[0] : 'k'}</div></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {classes.distribution.map((p, i) => (
                <div key={i} className="dist-row" title={labels[i]}>
                  <span className="sw" style={{ background: toCss(pal[i]) }} />
                  <span className="lbl">{labels[i]}</span>
                  <span className="bar"><div style={{ width: `${Math.min(100, p)}%`, background: toCss(pal[i]) }} /></span>
                  <span className="pct">{fmtNum(p, 1)} %</span>
                </div>
              ))}
            </div>
            <div className="note">
              {t('class.thresholds')} (mm): {classes.classification.breaks.map((b) => fmtMm(b * f, 5)).join(' · ')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
