import React from 'react';
import { ImageDown, Link2 } from 'lucide-react';
import { useI18n, type TKey } from '../i18n';
import type { ColorRamp, Settings, ViewMode } from '../state/model';
import { rampCss } from '../state/analysis';
import { NumInput } from './NumInput';

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  autoRangeMm: number;
  hasResult: boolean;
  grid?: boolean;
  onExport?: () => void;
}

const MODES: ViewMode[] = ['original', 'trend', 'mrm', 'rqr', 'classes'];
const RAMPS: ColorRamp[] = ['bgyr', 'coolwarm', 'grey'];

export function ViewToolbar({ settings, onSettings, autoRangeMm, hasResult, grid, onExport }: Props) {
  const { t } = useI18n();
  const range = settings.mrmRangeMm ?? autoRangeMm;
  return (
    <div className="toolbar">
      <div className="seg" style={{ flex: '0 0 auto' }}>
        {MODES.map((m) => (
          <button key={m} className={settings.viewMode === m ? 'on' : ''} disabled={!hasResult} onClick={() => onSettings({ viewMode: m })}>
            {t(`view.${m}` as TKey)}
          </button>
        ))}
      </div>

      {hasResult && (settings.viewMode === 'mrm' || settings.viewMode === 'rqr') && (
        <div style={{ display: 'flex', gap: 3 }} title={t('view.ramp')}>
          {RAMPS.map((r) => (
            <button
              key={r}
              aria-label={`${t('view.ramp')}: ${r}`}
              aria-pressed={settings.ramp === r}
              onClick={() => onSettings({ ramp: r })}
              style={{
                width: 34, height: 14, borderRadius: 4, background: rampCss(r), cursor: 'pointer',
                border: settings.ramp === r ? '2px solid var(--accent-light)' : '1px solid var(--border-default)',
                opacity: settings.ramp === r ? 1 : 0.55,
              }}
            />
          ))}
        </div>
      )}

      {hasResult && settings.viewMode === 'mrm' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="field-label">{t('view.range')}</span>
          <NumInput ariaLabel={`${t('view.range')} (mm)`} value={+range.toPrecision(3)} min={0.0001} max={1000} step={0.01} onCommit={(v) => { if (v !== undefined && v > 0) onSettings({ mrmRangeMm: v }); }} />
          <span className="field-label">mm</span>
          {settings.mrmRangeMm !== null && (
            <button className="btn sm" onClick={() => onSettings({ mrmRangeMm: null })}>Auto (3σ)</button>
          )}
        </div>
      )}

      <div className="spacer" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 150 }} title={t('view.light')}>
        <span className="field-label">{t('view.light')}</span>
        <input type="range" aria-label={t('view.light')} min={-90} max={90} step={5} value={settings.lightAzimuth} onChange={(e) => onSettings({ lightAzimuth: +e.target.value })} />
      </div>

      {grid && (
        <label className="check">
          <input type="checkbox" checked={settings.syncCameras} onChange={(e) => onSettings({ syncCameras: e.target.checked })} />
          <Link2 size={13} /> {t('grid.sync')}
        </label>
      )}
      {onExport && (
        <button className="btn sm" disabled={!hasResult} onClick={onExport}><ImageDown size={13} />{t('view.capture')}</button>
      )}
    </div>
  );
}
