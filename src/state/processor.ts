/**
 * Sequential processing queue around the MRM worker.
 * One artefact at a time (meshes can be large); the UI stays responsive.
 */
import type { MeshData, MrmParams, MrmResult } from '../engine/types';
import { errorMessage } from '../engine/errors';

export interface NativeApi {
  isDesktop: boolean;
  /** Started with --mrm-test (end-to-end test): enables the automation hook. */
  testMode?: boolean;
  poissonAvailable: () => Promise<boolean>;
  poisson: (ply: Uint8Array, opts: { depth: number; samplesPerNode: number; pointWeight: number }) => Promise<Uint8Array>;
  poissonCancel?: () => Promise<boolean>;
  saveFile: (defaultPath: string, filters: { name: string; extensions: string[] }[], data: Uint8Array) => Promise<string | null>;
  saveMany: (title: string, files: { name: string; data: Uint8Array }[], lang?: string) => Promise<string | null>;
  version: () => Promise<string>;
  /** Tells the main process whether there is unsaved work (asks before closing the window). */
  setDirty?: (dirty: boolean, lang: string) => Promise<boolean>;
}

declare global {
  interface Window {
    mrmNative?: NativeApi;
  }
}

export interface Job {
  id: string;
  params: MrmParams;
  file?: { name: string; buffer: ArrayBuffer };
  mesh?: MeshData;
}

export interface ProcessorCallbacks {
  onStart: (id: string) => void;
  onProgress: (id: string, stage: string, fraction: number) => void;
  onDone: (id: string, result: MrmResult) => void;
  onError: (id: string, message: string) => void;
}

export class Processor {
  private worker: Worker;
  private queue: Job[] = [];
  private current: Job | null = null;
  private poissonOk = false;
  private ready = false;
  private readyPromise: Promise<boolean>;
  private cb: ProcessorCallbacks;

  constructor(cb: ProcessorCallbacks) {
    this.cb = cb;
    this.worker = this.createWorker();
    this.readyPromise = this.checkPoisson().finally(() => { this.ready = true; });
  }

  private createWorker(): Worker {
    const w = new Worker(new URL('../workers/mrmWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { if (w === this.worker) this.onMessage(e.data); };
    w.onerror = (e) => {
      if (w !== this.worker) return;
      e.preventDefault();
      if (this.current) this.cb.onError(this.current.id, errorMessage(e.message || 'Worker error'));
      this.current = null;
      this.next();
    };
    return w;
  }

  get poissonAvailable(): boolean {
    return this.poissonOk;
  }

  whenReady(): Promise<boolean> {
    return this.readyPromise;
  }

  async checkPoisson(): Promise<boolean> {
    try {
      this.poissonOk = !!(await window.mrmNative?.poissonAvailable());
    } catch {
      this.poissonOk = false;
    }
    return this.poissonOk;
  }

  enqueue(job: Job): void {
    this.queue = this.queue.filter((j) => j.id !== job.id);
    this.queue.push(job);
    this.next();
  }

  /** Removes a job from the queue; if it is running, the worker (and PoissonRecon) are stopped. */
  cancel(id: string): void {
    this.queue = this.queue.filter((j) => j.id !== id);
    if (this.current?.id === id) {
      this.worker.terminate();
      window.mrmNative?.poissonCancel?.().catch(() => {});
      this.worker = this.createWorker();
      this.current = null;
      this.next();
    }
  }

  isBusy(id: string): boolean {
    return this.current?.id === id || this.queue.some((j) => j.id === id);
  }

  dispose(): void {
    this.worker.terminate();
    this.queue = [];
    if (this.current) window.mrmNative?.poissonCancel?.().catch(() => {});
    this.current = null;
  }

  private next(): void {
    if (!this.ready) {
      this.readyPromise.then(() => this.next());
      return;
    }
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.current = job;
    this.cb.onStart(job.id);
    const transfer: Transferable[] = [];
    if (job.file) transfer.push(job.file.buffer);
    if (job.mesh) transfer.push(job.mesh.positions.buffer, job.mesh.indices.buffer);
    this.worker.postMessage(
      {
        type: 'run',
        jobId: job.id,
        fileName: job.file?.name,
        buffer: job.file?.buffer,
        mesh: job.mesh,
        params: job.params,
        poissonAvailable: this.poissonOk,
      },
      transfer,
    );
  }

  private async onMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    const jobId = msg.jobId as string;
    if (msg.type !== 'poisson' && this.current?.id !== jobId) return; // stale message
    switch (msg.type) {
      case 'progress':
        this.cb.onProgress(jobId, msg.stage as string, msg.fraction as number);
        break;
      case 'poisson': {
        const reqId = msg.reqId as number;
        const worker = this.worker;
        try {
          if (!window.mrmNative) throw new Error('MRM_ERR:POISSON_UNAVAILABLE');
          const out = await window.mrmNative.poisson(msg.ply as Uint8Array, msg.opts as { depth: number; samplesPerNode: number; pointWeight: number });
          const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
          if (worker === this.worker) worker.postMessage({ type: 'poisson-result', reqId, ply: buf }, [buf as ArrayBuffer]);
        } catch (err) {
          if (worker === this.worker) worker.postMessage({ type: 'poisson-result', reqId, error: err instanceof Error ? err.message : String(err) });
        }
        break;
      }
      case 'done':
        this.current = null;
        this.cb.onDone(jobId, msg.result as MrmResult);
        this.next();
        break;
      case 'error':
        this.current = null;
        this.cb.onError(jobId, msg.message as string);
        this.next();
        break;
    }
  }
}
