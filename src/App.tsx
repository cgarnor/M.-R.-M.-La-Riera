/**
 * MRM Analysis Tool — Desktop application
 *
 * Standalone implementation of the MRM + Rqr workflow of García-Noriega & Arias (2026),
 * adapted from the authors' original Python scripts. Generative AI tools were used as
 * support for the adaptation, structuring, debugging and documentation of this code
 * (see "Declaración de uso de inteligencia artificial" in README.md).
 *
 * SPDX-License-Identifier: MIT
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Box, FolderOpen, Grid2x2, Info, Mountain, Plus, Save } from 'lucide-react';
import { I18nContext, describeError, translate, type Lang, type TKey } from './i18n';
import { DEFAULT_CLASS_PARAMS, DEFAULT_MRM_PARAMS, type MrmParams } from './engine/types';
import { errorMessage } from './engine/errors';
import { computeClasses, fmtMm, setNumberLang } from './state/analysis';
import { artefactDimsMm, artefactKey, artefactToMm, type Artefact, type Settings } from './state/model';
import { useArtefacts } from './state/useArtefacts';
import { buildArtefactPly, buildCompareCsv } from './state/exportActions';
import { deserializeProject, safeName, saveBytes, saveManyFiles, serializeProject, trendPly } from './utils/files';
import {
  composeGridFigure, composeViewFigure, encodeFigure, gridCellAspect, gridLayout, rasterizeSvg, viewAspect, viewLayout,
  type FigureOptions, type LegendModel,
} from './utils/figure';
import { chartSvg, chartTexts as makeChartTexts, LIGHT_THEME, PAPER_DARK_THEME, type ChartKind, type ChartProps } from './components/charts';
import { ExportDialog, type CompareSelection, type ExportMode } from './components/ExportDialog';
import { ArtefactList } from './components/ArtefactList';
import { ParamsPanel } from './components/ParamsPanel';
import { ClassPanel, classLabels } from './components/ClassPanel';
import { ArtefactPanel } from './components/ArtefactPanel';
import { ComparePanel } from './components/ComparePanel';
import { ViewToolbar } from './components/ViewToolbar';
import { CameraSync, Viewer, type ViewerHandle } from './components/Viewer';

type Tab = 'viewer' | 'grid' | 'compare';

const INITIAL_SETTINGS: Settings = {
  classParams: DEFAULT_CLASS_PARAMS,
  method: 'jenks',
  scaleMode: 'piece',
  viewMode: 'mrm',
  ramp: 'bgyr',
  mrmRangeMm: null,
  lightAzimuth: 25,
  lightElevation: 35,
  syncCameras: true,
};

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('mrm.lang') === 'en' ? 'en' : 'es'));
  // Decimal separator of every label (set before the children render).
  setNumberLang(lang);
  const i18n = useMemo(() => ({ lang, t: (k: TKey, v?: Record<string, string | number>) => translate(lang, k, v) }), [lang]);
  const { t } = i18n;
  useEffect(() => {
    localStorage.setItem('mrm.lang', lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const [mrmParams, setMrmParams] = useState<MrmParams>(DEFAULT_MRM_PARAMS);
  const paramsRef = useRef(mrmParams);
  paramsRef.current = mrmParams;
  const getParams = useCallback(() => paramsRef.current, []);
  const { artefacts, patch, addFiles, reanalyse, retry, remove, addLoaded, poissonAvailable } = useArtefacts(getParams);

  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const updateSettings = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('viewer');
  const [toast, setToast] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  useEffect(() => {
    if (!about) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbout(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [about]);
  const viewerRef = useRef<ViewerHandle>(null);
  const gridRefs = useRef(new Map<string, ViewerHandle>());
  const [exportMode, setExportMode] = useState<ExportMode | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const sync = useMemo(() => new CameraSync(), []);

  const toastTimer = useRef<number | undefined>(undefined);
  const notify = (msg: string, ms = 3500) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };

  // Selection follows the first artefact when nothing is selected
  useEffect(() => {
    if (selectedId && artefacts.some((a) => a.id === selectedId)) return;
    setSelectedId(artefacts[0]?.id ?? null);
  }, [artefacts, selectedId]);
  // Processed artefacts are ticked for comparison by default
  const seenDone = useRef(new Set<string>());
  useEffect(() => {
    const fresh = artefacts.filter((a) => a.status === 'done' && !seenDone.current.has(a.id));
    if (!fresh.length) return;
    fresh.forEach((a) => seenDone.current.add(a.id));
    setChecked((c) => new Set([...c, ...fresh.map((a) => a.id)]));
  }, [artefacts]);

  const done = useMemo(() => artefacts.filter((a) => a.result), [artefacts]);
  const checkedDone = useMemo(() => done.filter((a) => checked.has(a.id)), [done, checked]);
  const compareSet = checkedDone.length ? checkedDone : done;
  const selected = artefacts.find((a) => a.id === selectedId) ?? null;

  const classes = useMemo(
    () => computeClasses(done, compareSet, settings.method, settings.classParams, settings.scaleMode),
    [done, compareSet, settings.method, settings.classParams, settings.scaleMode],
  );

  const autoRange = (list: typeof done) =>
    Math.max(1e-6, ...list.map((a) => 3 * a.result!.residualStats.std * artefactToMm(a)));

  // ── Actions ──
  const onAddFiles = (files: File[]) => {
    const ids = addFiles(files);
    if (!selectedId && ids[0]) setSelectedId(ids[0]);
  };

  /**
   * Runs a save action once at a time and reports the result: errors (file open in another
   * program, no permission, disk full, file too large...) are shown instead of failing silently.
   */
  const saving = useRef(false);
  const guardedSave = async (build: () => Uint8Array | Promise<Uint8Array>, name: string, filter: { name: string; extensions: string[] }, okMsg: string): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    try {
      const path = await saveBytes(name, await build(), filter);
      if (path) notify(okMsg);
      return !!path;
    } catch (e) {
      notify(`${t('save.error')}: ${describeError(errorMessage(e), t)}`, 8000);
      return false;
    } finally {
      saving.current = false;
    }
  };

  const exportPly = () => {
    const a = selected;
    if (!a?.result) return;
    return guardedSave(() => buildArtefactPly(a, settings.classParams, settings.scaleMode, compareSet, settings.method),
      `${safeName(a.name)}_MRM_Rqr.ply`, { name: 'PLY', extensions: ['ply'] }, t('save.done'));
  };
  const exportTrend = () => {
    const a = selected;
    if (!a?.result) return;
    return guardedSave(() => trendPly(a, artefactToMm(a)), `${safeName(a.name)}_trend.ply`, { name: 'PLY', extensions: ['ply'] }, t('save.done'));
  };
  const exportCsv = () =>
    guardedSave(() => buildCompareCsv(compareSet, classes, settings.method, settings.classParams, settings.scaleMode),
      t('file.csvName'), { name: 'CSV', extensions: ['csv'] }, t('save.done'));

  // ── Publication figures ──
  const gridList = compareSet.slice(0, 9);
  const gridCols = Math.ceil(Math.sqrt(gridList.length || 1));
  const gridHandles = () => gridList.map((a) => ({ a, h: gridRefs.current.get(a.id) })).filter((x): x is { a: Artefact; h: ViewerHandle } => !!x.h);

  /** Shared legend and per-cell captions for the grid figure. */
  const gridLegend = (cells: { a: Artefact; h: ViewerHandle }[]): { legend: LegendModel; captions: (string | undefined)[] } => {
    const first = cells[0]?.h.legend() ?? null;
    if (!first) return { legend: null, captions: cells.map(() => undefined) };
    if (first.kind === 'classes') {
      const ks = cells.map(({ a }) => classes.get(a.id)?.classification.k ?? 0);
      if (new Set(ks).size > 1) {
        // Auto-k with a different k per artefact: a discrete legend would only match the first one.
        return {
          legend: {
            kind: 'bar', title: first.title, lo: 0, hi: 0, unit: '', loText: 'R1', hiText: t('legend.rk'), ramp: 'bgyr',
            loLabel: first.loLabel, hiLabel: first.hiLabel, notes: [t('legend.kVaries')],
          },
          captions: cells.map(({ a }) => { const c = classes.get(a.id); return c ? `k=${c.classification.k} · ${c.distribution.map((p) => p.toFixed(0)).join(' / ')} %` : undefined; }),
        };
      }
      return {
        legend: { ...first, items: first.items.map(({ color, label }) => ({ color, label })) },
        captions: cells.map(({ a }) => { const c = classes.get(a.id); return c ? `${c.distribution.map((p) => p.toFixed(0)).join(' / ')} %` : undefined; }),
      };
    }
    if (settings.viewMode === 'rqr') {
      return {
        legend: { ...first, loText: 'p5', hiText: 'p95', notes: [t('fig.rqrPerPiece')] },
        captions: cells.map(({ h }) => { const l = h.legend(); return l && l.kind === 'bar' ? `p5–p95: ${fmtMm(l.lo, 3)}–${fmtMm(l.hi, 3)} mm` : undefined; }),
      };
    }
    return { legend: first, captions: cells.map(() => undefined) };
  };

  const chartTexts = makeChartTexts(t);
  const chartProps = (o: FigureOptions, kind: ChartKind): ChartProps => ({
    items: compareSet, classes, method: settings.method, labelsFor: classLbls, texts: chartTexts,
    theme: o.background === 'black' ? PAPER_DARK_THEME : o.background === 'transparent' && o.format !== 'jpg' ? { ...LIGHT_THEME, background: null } : LIGHT_THEME,
    width: (o.widthCm / 2.54) * 72, // user units = points
    font: o.fontPt,
    title: o.showTitle ? (kind === 'dist' ? `${chartTexts.dist} · ${t(`class.${settings.method}` as TKey)}` : chartTexts[kind]) : undefined,
  });

  const previewFigure = useCallback((o: FigureOptions): [number, number] | null => {
    try {
      if (exportMode === 'view') {
        const v = viewerRef.current;
        if (!v) return null;
        const L = viewLayout(o, viewAspect(o, v.aspect(), v.extent()), v.legend());
        return [L.W, L.H];
      }
      if (exportMode === 'grid') {
        const cells = gridHandles();
        if (!cells.length) return null;
        const { legend, captions } = gridLegend(cells);
        const L = gridLayout(o, gridCols, cells.length, gridCellAspect(o, cells[0].h.aspect(), cells.map(({ h }) => h.extent())), captions.some(Boolean), legend);
        return [L.W, L.H];
      }
      return null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportMode, compareSet, classes, settings, t]);

  /** Generates the figure files of an export (no dialogs; also used by the automated tests). */
  const buildFigureFiles = async (mode: ExportMode, o: FigureOptions, sel: CompareSelection): Promise<{ name: string; data: Uint8Array }[]> => {
    const ext = o.format;
    const dpiTag = `_${o.dpi}${t('fig.dpiUnit')}`;
    if (mode === 'view') {
      const v = viewerRef.current;
      if (!v || !selected) return [];
      const canvas = composeViewFigure(o, v.aspect(), v.extent(), selected.name, v.legend(), settings.ramp, v.render);
      return [{ name: `${safeName(selected.name)}_${settings.viewMode}${dpiTag}.${ext}`, data: await encodeFigure(canvas, o) }];
    }
    if (mode === 'grid') {
      const cells = gridHandles();
      if (!cells.length) return [];
      const { legend, captions } = gridLegend(cells);
      const canvas = composeGridFigure(o, gridCols, cells[0].h.aspect(), cells.map(({ a, h }, i) => ({
        name: a.name, caption: captions[i], extent: h.extent(), natural: h.naturalMmPerPx, render: h.render,
      })), legend, settings.ramp);
      return [{ name: `${t('file.gridName')}_${settings.viewMode}${dpiTag}.${ext}`, data: await encodeFigure(canvas, o) }];
    }
    const NAMES: Record<ChartKind, string> = { dist: t('file.distName'), box: t('file.boxName'), hist: t('file.histName') };
    const files: { name: string; data: Uint8Array }[] = [];
    if (compareSet.length) {
      for (const kind of sel.charts) {
        const { svg, width, height } = chartSvg(kind, chartProps(o, kind));
        const data = o.format === 'svg' ? new TextEncoder().encode(svg) : await encodeFigure(await rasterizeSvg(svg, width, height, o), o);
        files.push({ name: `${NAMES[kind]}${o.format === 'svg' ? '' : dpiTag}.${ext}`, data });
      }
    }
    if (sel.csv) files.push({ name: t('file.csvName'), data: buildCompareCsv(compareSet, classes, settings.method, settings.classParams, settings.scaleMode) });
    return files;
  };

  const runExport = async (o: FigureOptions, sel: CompareSelection) => {
    if (!exportMode) return;
    const files = await buildFigureFiles(exportMode, o, sel);
    if (files.length === 1) {
      const fext = files[0].name.split('.').pop()!;
      const path = await saveBytes(files[0].name, files[0].data, { name: fext.toUpperCase(), extensions: [fext] });
      if (path) notify(t('fig.saved'));
    } else if (files.length > 1) {
      const dir = await saveManyFiles(t('fig.chooseFolder'), files, lang);
      if (dir) notify(t('fig.savedMany', { n: files.length }));
    }
  };

  // ── Unsaved work: the main process asks for confirmation before closing the window ──
  // An artefact is "saved" when its current data and record are in a project saved or opened here.
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const dirty = done.some((a) => !savedKeys.has(artefactKey(a)));
  useEffect(() => {
    window.mrmNative?.setDirty?.(dirty, lang).catch(() => {});
  }, [dirty, lang]);

  const saveProject = async () => {
    if (!done.length) return;
    if (done.length < artefacts.length) notify(t('project.unsavedSkip'));
    const keys = done.map(artefactKey);
    const ok = await guardedSave(() => serializeProject(done, settings), t('file.projectName'), { name: t('file.projectFilter'), extensions: ['mrm'] }, t('project.saved'));
    if (ok) setSavedKeys((s) => new Set([...s, ...keys]));
  };
  const openProject = async (file: File) => {
    try {
      const p = deserializeProject(await file.arrayBuffer());
      const ids = addLoaded(p.artefacts);
      // The artefacts just opened are stored in that project file: they are not unsaved work.
      setSavedKeys((s) => new Set([...s, ...p.artefacts.map((a, i) => artefactKey({ ...a, id: ids[i] }))]));
      // Settings are validated by deserializeProject.
      if (p.settings) updateSettings(p.settings);
      if (ids[0]) setSelectedId(ids[0]);
    } catch (e) {
      notify(`${t('project.loadError')}: ${describeError(errorMessage(e), t)}`, 7000);
    }
  };

  const classLbls = (k: number) => classLabels(settings.method, k, t);

  // Automation hook for the end-to-end test (validation/e2e-electron.cjs). Only registered when the
  // desktop app is started with --mrm-test, or in the Vite development server.
  useEffect(() => {
    if (!(window.mrmNative?.testMode || import.meta.env.DEV)) return;
    const w = window as unknown as { __mrm?: unknown };
    w.__mrm = {
      addFiles: onAddFiles,
      update: updateSettings,
      setTab,
      check: (ids: string[]) => setChecked(new Set(ids)),
      setDims: (id: string, dims: Artefact['dims']) => patch(id, () => ({ dims })),
      confirmUnit: (id: string, unit?: Artefact['unit']) => patch(id, (a) => ({ unit: unit ?? a.unit, unitConfirmed: true })),
      select: (id: string) => setSelectedId(id),
      remove: (id: string) => remove(id),
      setMrmParams: (p: Partial<MrmParams>) => setMrmParams((cur) => ({ ...cur, ...p })),
      reanalyse: (ids: string[]) => reanalyse(ids),
      about: (open: boolean) => setAbout(open),
      openExport: (m: ExportMode | null) => setExportMode(m),
      lang: (l: Lang) => setLang(l),
      figures: async (mode: ExportMode, o: FigureOptions, sel: CompareSelection) =>
        (await buildFigureFiles(mode, o, sel)).map((f) => ({ name: f.name, size: f.data.length, b64: btoa(Array.from(f.data, (b) => String.fromCharCode(b)).join('')) })),
      project: () => { const b = serializeProject(done, settings); return btoa(Array.from(b, (x) => String.fromCharCode(x)).join('')); },
      openProject: (b64: string, name = 'test.mrm') => openProject(new File([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], name)),
      toast: () => toast,
      viewerText: () => document.querySelector('.viewport')?.textContent ?? '',
      gridExtents: () => gridHandles().map(({ h }) => h.extent()),
      state: () => artefacts.map((a) => ({ id: a.id, name: a.name, status: a.status, stage: a.stage, progress: a.progress, error: a.error, errorText: a.error ? describeError(a.error, t) : undefined, unit: a.unit, unitConfirmed: a.unitConfirmed, rqrMean: a.result?.rqrStats.mean, rqrMeanMm: a.result ? a.result.rqrStats.mean * artefactToMm(a) : undefined, dimsMm: artefactDimsMm(a), trendMethod: a.result?.params.trendMethod })),
      classes: () => Array.from(classes.entries()).map(([id, c]) => ({ id, k: c.classification.k, dist: c.distribution.map((p) => +p.toFixed(1)) })),
    };
    return () => { delete w.__mrm; };
  });

  // ── Render helpers ──
  const renderViewer = () => {
    const a = selected;
    if (!a) return <div className="empty"><Box size={42} opacity={0.3} /><div>{t('view.noModel')}</div><div className="note">{t('view.noModelHint')}</div></div>;
    if (!a.result) {
      if (a.status === 'error') {
        return (
          <div className="empty">
            <AlertTriangle size={30} color="var(--error)" />
            <div style={{ maxWidth: 520, textAlign: 'center' }}>{describeError(a.error, t)}</div>
          </div>
        );
      }
      return (
        <div className="empty">
          <div className="spin" style={{ width: 26, height: 26, border: '3px solid var(--border-default)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
          <div>{a.status === 'queued' ? t('stage.queued') : `${t(`stage.${a.stage}` as TKey)} · ${Math.round(a.progress * 100)} %`}</div>
        </div>
      );
    }
    const cl = classes.get(a.id);
    return (
      <Viewer
        // One WebGL context per artefact: switching artefacts releases the GPU memory of the previous one.
        key={a.id}
        ref={viewerRef}
        result={a.result}
        name={a.name}
        mode={settings.viewMode}
        classes={cl}
        classLabels={classLbls(cl?.classification.k ?? 6)}
        ramp={settings.ramp}
        mrmRangeMm={settings.mrmRangeMm ?? autoRange([a])}
        toMm={artefactToMm(a)}
        lightAzimuth={settings.lightAzimuth}
        lightElevation={settings.lightElevation}
      />
    );
  };

  const renderGrid = () => {
    const list = compareSet.slice(0, 9);
    if (!list.length) return <div className="empty">{t('grid.hint')}</div>;
    const cols = Math.ceil(Math.sqrt(list.length));
    const range = settings.mrmRangeMm ?? autoRange(list);
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        {compareSet.length > 9 && (
          <div className="note warn" style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 2, background: 'rgba(10,10,15,0.85)', padding: '3px 10px', borderRadius: 6 }}>
            {t('grid.limit', { n: compareSet.length })}
          </div>
        )}
        <div className="grid-views" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(list.length / cols)}, 1fr)` }}>
          {list.map((a) => {
            const cl = classes.get(a.id);
            return (
              <div key={a.id} className="grid-cell" onDoubleClick={() => { setSelectedId(a.id); setTab('viewer'); }}>
                <Viewer
                  ref={(h) => { if (h) gridRefs.current.set(a.id, h); else gridRefs.current.delete(a.id); }}
                  result={a.result!}
                  name={cl && settings.viewMode === 'classes' ? `${a.name} · ${cl.distribution.map((p) => p.toFixed(0)).join('/')} %` : a.name}
                  mode={settings.viewMode}
                  classes={cl}
                  classLabels={classLbls(cl?.classification.k ?? 6)}
                  ramp={settings.ramp}
                  mrmRangeMm={range}
                  toMm={artefactToMm(a)}
                  lightAzimuth={settings.lightAzimuth}
                  lightElevation={settings.lightElevation}
                  sync={settings.syncCameras ? sync : null}
                  compact
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <header className="header">
          <div className="logo"><Mountain size={18} color="white" /></div>
          <div>
            <h1>MRM Analysis Tool</h1>
            <div className="sub">{t('app.subtitle')}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => addInput.current?.click()}><Plus size={14} />{t('header.add')}</button>
          <button className="btn" onClick={() => openInput.current?.click()}><FolderOpen size={14} />{t('header.open')}</button>
          <button className="btn" disabled={!done.length} onClick={saveProject}><Save size={14} />{t('header.save')}</button>
          <div className="seg" role="group" aria-label="Idioma / Language" style={{ width: 86 }}>
            <button className={lang === 'es' ? 'on' : ''} aria-pressed={lang === 'es'} lang="es" aria-label="Español" onClick={() => setLang('es')}>ES</button>
            <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} lang="en" aria-label="English" onClick={() => setLang('en')}>EN</button>
          </div>
          <button className="btn icon" title={t('header.about')} aria-label={t('header.about')} onClick={() => setAbout(true)}><Info size={15} /></button>
          <input ref={addInput} type="file" accept=".obj,.ply,.stl" multiple hidden onChange={(e) => { if (e.target.files) onAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
          <input ref={openInput} type="file" accept=".mrm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openProject(f); e.target.value = ''; }} />
        </header>

        <main className="main">
          <aside className="sidebar">
            <ArtefactList
              artefacts={artefacts}
              selectedId={selectedId}
              checked={checked}
              onSelect={setSelectedId}
              onToggleCheck={(id) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              onCheckAll={(on) => setChecked(on ? new Set(done.map((a) => a.id)) : new Set())}
              onAddFiles={onAddFiles}
              onRemove={(id) => { remove(id); setChecked((c) => { const n = new Set(c); n.delete(id); return n; }); }}
              onRetry={retry}
            />
            <ParamsPanel
              params={mrmParams}
              onChange={setMrmParams}
              poissonAvailable={poissonAvailable}
              canApplySelected={!!selected?.result}
              checkedCount={checkedDone.length}
              onApplySelected={() => selected && reanalyse([selected.id])}
              onApplyChecked={() => reanalyse(checkedDone.map((a) => a.id))}
            />
          </aside>

          <section className="center">
            <div className="tabs">
              <button className={`tab ${tab === 'viewer' ? 'on' : ''}`} onClick={() => setTab('viewer')}><Box size={14} />{t('tabs.viewer')}</button>
              <button className={`tab ${tab === 'grid' ? 'on' : ''}`} onClick={() => setTab('grid')}><Grid2x2 size={14} />{t('tabs.grid')}</button>
              <button className={`tab ${tab === 'compare' ? 'on' : ''}`} onClick={() => setTab('compare')}><BarChart3 size={14} />{t('tabs.compare')}</button>
            </div>
            <div className="panel">
              {tab !== 'compare' && (
                <ViewToolbar
                  settings={settings}
                  onSettings={updateSettings}
                  autoRangeMm={tab === 'grid' ? autoRange(compareSet.slice(0, 9)) : selected?.result ? autoRange([selected]) : 0.1}
                  hasResult={tab === 'grid' ? compareSet.length > 0 : !!selected?.result}
                  grid={tab === 'grid'}
                  onExport={() => setExportMode(tab === 'grid' ? 'grid' : 'view')}
                />
              )}
              {tab === 'compare' ? (
                <ComparePanel items={compareSet} usingChecked={checkedDone.length > 0} classes={classes} method={settings.method} onExportCsv={exportCsv} onExportFigures={() => setExportMode('compare')} />
              ) : (
                <div className="viewport">{tab === 'viewer' ? renderViewer() : renderGrid()}</div>
              )}
            </div>
          </section>

          <aside className="sidebar right">
            <ClassPanel
              artefact={selected}
              classes={selected ? classes.get(selected.id) : undefined}
              method={settings.method}
              params={settings.classParams}
              scale={settings.scaleMode}
              commonCount={compareSet.length}
              onMethod={(m) => updateSettings({ method: m })}
              onParams={(p) => updateSettings({ classParams: p })}
              onScale={(s) => updateSettings({ scaleMode: s })}
            />
            {selected && (
              <ArtefactPanel
                artefact={selected}
                onRename={(name) => patch(selected.id, () => ({ name }))}
                onMeta={(meta) => patch(selected.id, () => ({ meta }))}
                onUnit={(unit) => patch(selected.id, () => ({ unit, unitConfirmed: true }))}
                onDims={(dims) => patch(selected.id, () => ({ dims }))}
                onExportPly={exportPly}
                onExportTrend={exportTrend}
              />
            )}
          </aside>
        </main>

        {about && (
          <div className="modal-bg" onClick={() => setAbout(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mrm-about-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
              <div id="mrm-about-title" style={{ fontWeight: 700 }}>MRM Analysis Tool <span className="note">v{__APP_VERSION__}</span></div>
              <div className="note" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('about.text')}</div>
              <div className="field-label">{t('about.cite')}</div>
              <div className="note">
                García-Noriega, C. y Arias, P. (2026). Aplicación de la técnica de Modelo de Residuo Morfológico (MRM) a la macroindustria lítica: el caso de la azuela pulimentada de La Riera (Llanes, Asturias). <i>Trabajos de Prehistoria</i>, 83(2): 1109.{' '}
                <a href="https://doi.org/10.3989/tp.2026.1109" target="_blank" rel="noreferrer">https://doi.org/10.3989/tp.2026.1109</a>
              </div>
              <div className="field-label">{t('about.aiTitle')}</div>
              <div className="note">{t('about.ai')}</div>
              <div className="note">{t('about.license')}</div>
              <div className="note">{t('about.repo')}: <a href="https://github.com/cgarnor/M.-R.-M.-La-Riera" target="_blank" rel="noreferrer">https://github.com/cgarnor/M.-R.-M.-La-Riera</a></div>
              <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setAbout(false)}>{t('common.close')}</button>
            </div>
          </div>
        )}
        {exportMode && (
          <ExportDialog mode={exportMode} preview={previewFigure} onExport={runExport} onClose={() => setExportMode(null)} />
        )}
        {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      </div>
    </I18nContext.Provider>
  );
}
