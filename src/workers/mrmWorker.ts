/**
 * MRM worker — runs the engine off the UI thread.
 *
 * Protocol
 *   in : { type: 'run', jobId, fileName?, buffer?, mesh?, params }
 *        { type: 'poisson-result', reqId, ply?, error? }
 *   out: { type: 'progress', jobId, stage, fraction }
 *        { type: 'poisson', jobId, reqId, ply, opts }   (main thread forwards to Electron)
 *        { type: 'done', jobId, result }
 *        { type: 'error', jobId, message }
 */
import { loadMesh } from '../engine/meshio';
import { runMrm, type PoissonRunner } from '../engine/pipeline';
import { sanitizeMrmParams, type MeshData } from '../engine/types';
import { errorMessage } from '../engine/errors';

const ctx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let reqCounter = 0;
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();

function makePoissonRunner(jobId: string): PoissonRunner {
  return (ply, opts) =>
    new Promise((resolve, reject) => {
      const reqId = ++reqCounter;
      pending.set(reqId, { resolve, reject });
      ctx.postMessage({ type: 'poisson', jobId, reqId, ply, opts }, [ply.buffer]);
    });
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'poisson-result') {
    const p = pending.get(msg.reqId);
    if (!p) return;
    pending.delete(msg.reqId);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.ply as ArrayBuffer);
    return;
  }
  if (msg.type !== 'run') return;
  const jobId = msg.jobId as string;
  const params = sanitizeMrmParams(msg.params);
  try {
    let mesh: MeshData;
    if (msg.mesh) {
      mesh = msg.mesh;
    } else {
      ctx.postMessage({ type: 'progress', jobId, stage: 'loading', fraction: 0 });
      mesh = loadMesh(msg.fileName, msg.buffer);
    }
    let lastStage = '';
    let lastPost = 0;
    const result = await runMrm(mesh, params, msg.poissonAvailable ? makePoissonRunner(jobId) : null, (stage, fraction) => {
      const t = Date.now();
      if (stage !== lastStage || t - lastPost > 150) {
        lastStage = stage;
        lastPost = t;
        ctx.postMessage({ type: 'progress', jobId, stage, fraction });
      }
    });
    ctx.postMessage({ type: 'done', jobId, result }, [
      result.mesh.positions.buffer,
      result.mesh.indices.buffer,
      result.trend.positions.buffer,
      result.trend.indices.buffer,
      result.residuals.buffer,
      result.rqr.buffer,
    ]);
  } catch (err) {
    ctx.postMessage({ type: 'error', jobId, message: errorMessage(err) });
  }
};
