import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react';
import { describeError, useI18n, type TKey } from '../i18n';
import { UNIT_LABEL, hasCustomDims, type Artefact } from '../state/model';

interface Props {
  artefacts: Artefact[];
  selectedId: string | null;
  checked: Set<string>;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onCheckAll: (on: boolean) => void;
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const ACCEPT = '.obj,.ply,.stl';

export function ArtefactList({ artefacts, selectedId, checked, onSelect, onToggleCheck, onCheckAll, onAddFiles, onRemove, onRetry }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => /\.(obj|ply|stl)$/i.test(f.name));
    if (files.length) onAddFiles(files);
  };

  return (
    <div className="card">
      <div className="card-title">
        <Layers size={15} />
        {t('list.title')}
        <span className="muted" style={{ fontWeight: 400 }}>({artefacts.length})</span>
        {artefacts.length > 1 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button className="btn sm" onClick={() => onCheckAll(true)}>{t('list.all')}</button>
            <button className="btn sm" onClick={() => onCheckAll(false)}>{t('list.none')}</button>
          </span>
        )}
      </div>
      <div className="card-body">
        <div
          className={`drop ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        >
          <Upload size={16} style={{ marginBottom: 4 }} />
          <div>{t('list.drop')}</div>
          <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </div>

        {artefacts.length === 0 ? (
          <div className="note">{t('list.empty')}</div>
        ) : (
          <div className="items">
            {artefacts.map((a) => (
              <div key={a.id} className={`item ${a.id === selectedId ? 'sel' : ''}`} role="button" tabIndex={0} aria-current={a.id === selectedId}
                onClick={() => onSelect(a.id)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(a.id); } }}>
                <input
                  type="checkbox"
                  title={t('list.compare')}
                  aria-label={t('a11y.compare', { name: a.name })}
                  checked={checked.has(a.id)}
                  disabled={a.status !== 'done'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleCheck(a.id)}
                  style={{ accentColor: 'var(--accent-dark)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{a.name}</div>
                  <div className="sub" title={a.status === 'error' ? describeError(a.error, t) : undefined}>
                    {a.status === 'processing' || a.status === 'loading'
                      ? `${t(`stage.${a.stage}` as TKey)} · ${Math.round(a.progress * 100)} %`
                      : a.status === 'error'
                        ? describeError(a.error, t)
                        : [a.meta.site, a.meta.type, t(`status.${a.status}` as TKey)].filter(Boolean).join(' · ')}
                  </div>
                  {a.status === 'done' && !a.unitConfirmed && !hasCustomDims(a) && (
                    <div className="sub" style={{ color: 'var(--warning)' }}>{t('list.unitEstimated', { u: UNIT_LABEL[a.unit] })}</div>
                  )}
                  {(a.status === 'processing' || a.status === 'loading') && (
                    <div className="mini-bar"><div style={{ width: `${Math.round(a.progress * 100)}%` }} /></div>
                  )}
                </div>
                <StatusIcon status={a.status} />
                {a.status === 'error' && (
                  <button className="btn icon sm" title={t('list.retry')} aria-label={t('a11y.retry', { name: a.name })} onClick={(e) => { e.stopPropagation(); onRetry(a.id); }}>
                    <RotateCcw size={12} />
                  </button>
                )}
                <button className="btn icon sm" title={t('list.remove')} aria-label={t('a11y.remove', { name: a.name })} onClick={(e) => { e.stopPropagation(); onRemove(a.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Artefact['status'] }) {
  if (status === 'done') return <CheckCircle2 size={14} color="var(--success)" />;
  if (status === 'error') return <AlertTriangle size={14} color="var(--error)" />;
  if (status === 'queued') return <span className="dot" style={{ background: 'var(--text-muted)' }} />;
  return <Loader2 size={14} className="spin" color="var(--accent)" />;
}
