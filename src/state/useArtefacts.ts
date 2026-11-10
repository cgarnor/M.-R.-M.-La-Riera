/**
 * Artefact collection state + processing queue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MrmParams, MrmResult } from '../engine/types';
import { clearArtefactCache } from './analysis';
import { baseName, guessUnit, newId, type Artefact } from './model';
import { Processor } from './processor';
import { errorMessage } from '../engine/errors';

/** Message for a file that could not be read (NotReadableError, NotFoundError or out of memory). */
function readErrorMessage(err: unknown): string {
  const m = errorMessage(err);
  if (m.startsWith('MRM_ERR:')) return m;
  return `MRM_ERR:READ_FAILED:${err instanceof Error ? err.name : m}`;
}

export function useArtefacts(getParams: () => MrmParams) {
  const [artefacts, setArtefacts] = useState<Artefact[]>([]);
  const [poissonAvailable, setPoissonAvailable] = useState(false);
  const files = useRef(new Map<string, File>());
  const proc = useRef<Processor | null>(null);
  const listRef = useRef<Artefact[]>([]);
  listRef.current = artefacts;

  const patch = useCallback((id: string, fn: (a: Artefact) => Partial<Artefact>) => {
    setArtefacts((list) => list.map((a) => (a.id === id ? { ...a, ...fn(a) } : a)));
  }, []);

  useEffect(() => {
    const p = new Processor({
      onStart: (id) => patch(id, () => ({ status: 'loading', stage: 'loading', progress: 0, error: undefined })),
      onProgress: (id, stage, fraction) =>
        patch(id, () => ({ status: stage === 'loading' ? 'loading' : 'processing', stage, progress: fraction })),
      onDone: (id, result: MrmResult) => {
        clearArtefactCache(id);
        patch(id, (a) => {
          const maxDim = Math.max(...result.info.bboxSize);
          return {
            status: 'done', stage: 'done', progress: 1, result, params: result.params, source: undefined,
            version: a.version + 1,
            unit: a.unitConfirmed ? a.unit : guessUnit(maxDim),
          };
        });
      },
      onError: (id, message) => patch(id, () => ({ status: 'error', error: message })),
    });
    proc.current = p;
    p.whenReady().then(setPoissonAvailable);
    return () => p.dispose();
  }, [patch]);

  /** Fall back to QEM decimation when Poisson is not available (browser). */
  const effectiveParams = useCallback((): MrmParams => {
    const p = getParams();
    if (p.trendMethod === 'poisson' && !proc.current?.poissonAvailable) return { ...p, trendMethod: 'decimation' };
    return p;
  }, [getParams]);

  const enqueueFile = useCallback(async (id: string, file: File) => {
    try {
      await proc.current?.whenReady();
      const buffer = await file.arrayBuffer();
      // The artefact may have been removed while the file was being read.
      if (!files.current.has(id)) return;
      proc.current?.enqueue({ id, params: effectiveParams(), file: { name: file.name, buffer } });
    } catch (err) {
      // File deleted or locked since it was chosen, or too large to be read into memory.
      if (files.current.has(id)) patch(id, () => ({ status: 'error', error: readErrorMessage(err) }));
    }
  }, [effectiveParams, patch]);

  const addFiles = useCallback((list: File[]) => {
    const created: Artefact[] = list.map((f) => ({
      id: newId(), name: baseName(f.name), fileName: f.name,
      meta: { site: '', type: '', material: '', notes: '' },
      unit: 'mm', unitConfirmed: false, status: 'queued', stage: 'queued', progress: 0,
      params: getParams(), version: 0,
    }));
    setArtefacts((l) => [...l, ...created]);
    created.forEach((a, i) => {
      files.current.set(a.id, list[i]);
      enqueueFile(a.id, list[i]);
    });
    return created.map((a) => a.id);
  }, [enqueueFile, getParams]);

  const reanalyse = useCallback((ids: string[]) => {
    for (const a of listRef.current) {
      if (!ids.includes(a.id) || !a.result) continue;
      const m = a.result.mesh;
      proc.current?.enqueue({
        id: a.id, params: effectiveParams(),
        mesh: { positions: m.positions.slice(), indices: m.indices.slice(), offset: [...m.offset] as [number, number, number] },
      });
    }
    setArtefacts((list) => list.map((a) => (ids.includes(a.id) && a.result ? { ...a, status: 'queued', stage: 'queued', progress: 0 } : a)));
  }, [effectiveParams]);

  const retry = useCallback((id: string) => {
    const f = files.current.get(id);
    if (f) { patch(id, () => ({ status: 'queued', error: undefined })); enqueueFile(id, f); }
    else reanalyse([id]);
  }, [enqueueFile, reanalyse, patch]);

  const remove = useCallback((id: string) => {
    proc.current?.cancel(id);
    files.current.delete(id);
    clearArtefactCache(id);
    setArtefacts((l) => l.filter((a) => a.id !== id));
  }, []);

  /** Adds artefacts loaded from a project; returns their (possibly renamed) ids. */
  const addLoaded = useCallback((loaded: Artefact[]): string[] => {
    const ids = new Set(listRef.current.map((a) => a.id));
    const fixed = loaded.map((a) => {
      const b = ids.has(a.id) ? { ...a, id: newId() } : a;
      ids.add(b.id);
      return b;
    });
    setArtefacts((l) => [...l, ...fixed]);
    return fixed.map((a) => a.id);
  }, []);

  return { artefacts, patch, addFiles, reanalyse, retry, remove, addLoaded, poissonAvailable };
}
