/**
 * Validation against CloudCompare / CloudComPy (`npm run validate:cloudcompare`).
 *
 * Reproduces the "Validación" table of the README with the La Riera adze:
 *   A. Rqr and classes computed by the app on the CloudCompare residuals vs. the CloudComPy output.
 *   B. Full app pipeline (Poisson, PoissonRecon.exe) on the original model vs. CloudCompare.
 *
 * Usage:
 *   npm run validate:cloudcompare -- [model.obj] [reference_MRM_mesh_Rqr.ply] [unscaled_model.obj]
 * Defaults: data/Azuela_LaRiera_S.obj and data/Azuela_LaRiera_S_MRM_mesh_Rqr.ply. The reference file
 * is produced by the CloudComPy scripts of this repository (run_mrm_cloudcompy.bat, then
 * run_rqr_cloudcompy.bat) and is also attached to the GitHub release. The optional third file
 * (the same piece without scale) checks the rescaling from real dimensions (part C).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyClassification, classify, makePooledSource, makeSource } from '../src/engine/classify';
import { buildAdjacency, computeRqr, readPly } from '../src/engine/mesh';
import { loadMesh } from '../src/engine/meshio';
import { runMrm, type PoissonRunner } from '../src/engine/pipeline';
import { DEFAULT_CLASS_PARAMS, DEFAULT_MRM_PARAMS } from '../src/engine/types';
import { TO_MM, guessUnit } from '../src/state/model';

const [modelPath = 'data/Azuela_LaRiera_S.obj', refPath = 'data/Azuela_LaRiera_S_MRM_mesh_Rqr.ply', unscaledPath] = process.argv.slice(2);
const EXE = 'native/win-x64/PoissonRecon.exe';

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}

const pct = (x: number) => `${(100 * x).toFixed(3)} %`;
const agree = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) s++; return s / a.length; };

const poisson: PoissonRunner = async (ply, opts) => {
  const dir = mkdtempSync(join(tmpdir(), 'mrm-val-'));
  try {
    writeFileSync(join(dir, 'in.ply'), ply);
    const r = spawnSync(EXE, ['--in', join(dir, 'in.ply'), '--out', join(dir, 'out.ply'), '--depth', String(opts.depth),
      '--samplesPerNode', String(opts.samplesPerNode), '--pointWeight', String(opts.pointWeight), '--bType', '3'], { windowsHide: true });
    if (r.status !== 0) throw new Error(`PoissonRecon failed: ${r.error?.message ?? r.stderr?.toString().slice(-300)}`);
    return toArrayBuffer(readFileSync(join(dir, 'out.ply')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

async function main() {
  for (const p of [modelPath, refPath]) if (!existsSync(p)) { console.error(`Not found: ${p}`); process.exit(2); }
  console.log(`Model:     ${modelPath}\nReference: ${refPath}\n`);

  // ── A. Rqr and classes on the CloudCompare residuals ──
  const ref = readPly(toArrayBuffer(readFileSync(refPath)));
  const nv = ref.positions.length / 3;
  const ccRes = ref.vertexProps.scalar_MRM_Residuals, ccRqr = ref.vertexProps.scalar_Rqr;
  if (!ccRes || !ccRqr) throw new Error('The reference PLY must contain scalar_MRM_Residuals and scalar_Rqr');
  const rqr = computeRqr(Float32Array.from(ccRes), buildAdjacency(ref.indices, nv));
  let maxRel = 0;
  for (let i = 0; i < nv; i++) if (ccRqr[i] > 1e-12) maxRel = Math.max(maxRel, Math.abs(rqr[i] - ccRqr[i]) / ccRqr[i]);
  console.log(`A. ${nv} vertices, ${ref.indices.length / 3} faces`);
  console.log(`   Rqr (app) vs Rqr (CloudComPy): max relative difference ${maxRel.toExponential(1)}`);
  const src = makeSource(rqr);
  const legacy = { ...DEFAULT_CLASS_PARAMS, jenksMethod: 'legacy' as const };
  const fields: [string, Parameters<typeof classify>[1], typeof legacy][] = [['scalar_Rqr_Jenks', 'jenks', legacy], ['scalar_Rqr_Auto', 'autok', legacy], ['scalar_Rqr_Sigma', 'sigma', legacy]];
  for (const [name, method, params] of fields) {
    const stored = ref.vertexProps[name];
    if (!stored) { console.log(`   ${name}: not in the reference file`); continue; }
    const c = classify(src, method, params);
    console.log(`   ${name.replace('scalar_', '')} (${method}${method === 'sigma' ? '' : ', legacy'}): identical classes in ${pct(agree(applyClassification(rqr, c), stored))} of the vertices`);
  }

  // ── B. Full pipeline on the original model ──
  console.log('\nB. Full app pipeline (Poisson, default parameters of the article)...');
  const mesh = loadMesh(modelPath, toArrayBuffer(readFileSync(modelPath)));
  const t0 = Date.now();
  const res = await runMrm(mesh, DEFAULT_MRM_PARAMS, poisson, () => {});
  if (res.info.vertexCount !== nv) throw new Error(`Vertex count differs: ${res.info.vertexCount} vs ${nv}`);
  let maxD = 0;
  for (let i = 0; i < nv; i++) for (let d = 0; d < 3; d++) maxD = Math.max(maxD, Math.abs(res.mesh.positions[3 * i + d] + res.mesh.offset[d] - ref.positions[3 * i + d]));
  const unit = guessUnit(Math.max(...res.info.bboxSize));
  const f = TO_MM[unit];
  const ccStats = makeSource(ccRqr);
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)} s · vertex correspondence: max coordinate difference ${maxD.toExponential(1)} · model unit: ${unit}`);
  console.log(`   residuals: r = ${pearson(res.residuals, ccRes).toFixed(3)}`);
  console.log(`   Rqr:       r = ${pearson(res.rqr, ccRqr).toFixed(3)}`);
  console.log(`   Rqr mean ${(res.rqrStats.mean * f).toFixed(4)} mm (CloudCompare ${(ccStats.mean * f).toFixed(4)} mm) · σ ${(res.rqrStats.std * f).toFixed(4)} mm (CloudCompare ${(ccStats.std * f).toFixed(4)} mm)`);

  // ── C. Optional: unscaled model of the same piece + real dimensions ──
  if (!unscaledPath) return;
  if (!existsSync(unscaledPath)) { console.error(`Not found: ${unscaledPath}`); process.exit(2); }
  console.log('\nC. Unscaled model + real dimensions (length, width, thickness of the scaled model, in mm)...');
  const raw = await runMrm(loadMesh(unscaledPath, toArrayBuffer(readFileSync(unscaledPath))), DEFAULT_MRM_PARAMS, poisson, () => {});
  const mmDims = res.info.principalSize!.map((v) => v * f);
  const rawDims = raw.info.principalSize!;
  // Same least-squares factor as the app (state/model.ts, artefactToMm).
  let num = 0, den = 0;
  for (let i = 0; i < 3; i++) { num += mmDims[i] * rawDims[i]; den += rawDims[i] * rawDims[i]; }
  const g = num / den;
  console.log(`   real dimensions ${mmDims.map((v) => v.toFixed(2)).join(' × ')} mm · scale applied 1 unit = ${g.toPrecision(6)} mm`);
  console.log(`   Rqr mean ${(raw.rqrStats.mean * g).toFixed(5)} mm (scaled model: ${(res.rqrStats.mean * f).toFixed(5)} mm)`);
  if (raw.info.vertexCount === nv) {
    const pooled = makePooledSource([res, raw].map((r, i) => {
      const k = i === 0 ? f : g;
      const s = makeSource(r.rqr);
      return { sorted: s.sorted.map((v) => v * k), mean: s.mean * k, std: s.std * k };
    }), 4000);
    const common = classify(pooled, 'jenks', DEFAULT_CLASS_PARAMS);
    const a = applyClassification(res.rqr, { ...common, breaks: common.breaks.map((b) => b / f) });
    const b = applyClassification(raw.rqr, { ...common, breaks: common.breaks.map((x) => x / g) });
    console.log(`   common-scale Jenks classes identical in ${pct(agree(a, b))} of the vertices`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
