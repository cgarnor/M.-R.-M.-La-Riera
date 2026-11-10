import React, { useMemo } from 'react';
import { BarChart3, Download, ImageDown } from 'lucide-react';
import { useI18n, type TKey } from '../i18n';
import type { ClassMethod } from '../engine/classify';
import { fmtInt, fmtMm, fmtNum, type ArtefactClasses } from '../state/analysis';
import type { Artefact } from '../state/model';
import { artefactDimsMm, artefactToMm as mmFactor } from '../state/model';
import { classLabels } from './ClassPanel';
import { BoxPlotChart, ClassDistChart, DARK_THEME, HistChart, chartTexts, histogramData, seriesColor, type ChartProps } from './charts';

export { seriesColor };

interface Props {
  items: Artefact[];
  usingChecked: boolean;
  classes: Map<string, ArtefactClasses>;
  method: ClassMethod;
  onExportCsv: () => void;
  onExportFigures: () => void;
}

export function ComparePanel({ items, usingChecked, classes, method, onExportCsv, onExportFigures }: Props) {
  const { t } = useI18n();
  const hist = useMemo(() => histogramData(items), [items]);

  if (!items.length) {
    return <div className="compare"><div className="empty" style={{ position: 'static' }}>{t('cmp.none')}</div></div>;
  }

  const cols: { key: TKey; get: (a: Artefact) => number }[] = [
    { key: 'cmp.col.resMean', get: (a) => a.result!.residualStats.mean },
    { key: 'cmp.col.resStd', get: (a) => a.result!.residualStats.std },
    { key: 'cmp.col.rqrMean', get: (a) => a.result!.rqrStats.mean },
    { key: 'cmp.col.rqrMedian', get: (a) => a.result!.rqrStats.median },
    { key: 'cmp.col.rqrStd', get: (a) => a.result!.rqrStats.std },
    { key: 'cmp.col.rqrMin', get: (a) => a.result!.rqrStats.min },
    { key: 'cmp.col.rqrMax', get: (a) => a.result!.rqrStats.max },
  ];
  const maxK = Math.max(...items.map((a) => classes.get(a.id)?.classification.k ?? 0));
  const chart: ChartProps = {
    items, classes, method,
    labelsFor: (k) => classLabels(method, k, t),
    texts: chartTexts(t),
    theme: DARK_THEME, width: 760, font: 11,
  };

  return (
    <div className="compare">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BarChart3 size={16} color="var(--accent)" />
        <div style={{ fontWeight: 600 }}>{t('cmp.title')}</div>
        <div className="note">{t('cmp.using', { n: items.length, which: usingChecked ? t('cmp.checked') : t('cmp.allDone') })}</div>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={onExportCsv}><Download size={12} />{t('cmp.exportCsv')}</button>
        <button className="btn sm primary" onClick={onExportFigures}><ImageDown size={12} />{t('fig.exportFigures')}</button>
      </div>

      {/* Table */}
      <div>
        <div className="section-title">{t('cmp.table')}</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('cmp.col.artefact')}</th>
                <th>{t('art.site')}</th>
                <th>{t('art.type')}</th>
                <th>{t('art.material')}</th>
                <th>{t('art.dims')} (mm)</th>
                <th>{t('cmp.col.vertices')}</th>
                {cols.map((c) => <th key={c.key}>{t(c.key)}</th>)}
                {Array.from({ length: maxK }, (_, i) => <th key={i}>R{i + 1} %</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((a, idx) => {
                const f = mmFactor(a);
                const cl = classes.get(a.id);
                return (
                  <tr key={a.id}>
                    <td><span className="dot" style={{ background: seriesColor(idx), display: 'inline-block', marginRight: 6 }} />{a.name}</td>
                    <td style={{ textAlign: 'left' }}>{a.meta.site}</td>
                    <td style={{ textAlign: 'left' }}>{a.meta.type}</td>
                    <td style={{ textAlign: 'left' }}>{a.meta.material}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{(artefactDimsMm(a) ?? []).map((d) => fmtNum(d, 1)).join(' × ')}</td>
                    <td>{fmtInt(a.result!.info.vertexCount)}</td>
                    {cols.map((c) => <td key={c.key}>{fmtMm(c.get(a) * f, 4)}</td>)}
                    {Array.from({ length: maxK }, (_, i) => <td key={i}>{cl && i < cl.distribution.length ? fmtNum(cl.distribution[i], 1) : ''}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart">
        <div className="section-title">{t('cmp.dist')} · {t(`class.${method}` as TKey)}</div>
        <ClassDistChart {...chart} />
      </div>
      <div className="chart">
        <div className="section-title">{t('cmp.box')}</div>
        <BoxPlotChart {...chart} />
      </div>
      {hist && (
        <div className="chart">
          <div className="section-title">{t('cmp.hist')}</div>
          <HistChart {...chart} hist={hist} />
        </div>
      )}
    </div>
  );
}
