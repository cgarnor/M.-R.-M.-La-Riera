/**
 * Builders for exported files (PLY with every classification, comparison CSV).
 */
import type { ClassMethod } from '../engine/classify';
import type { ClassParams } from '../engine/types';
import { artefactPly, toCsv } from '../utils/files';
import { computeClasses, type ArtefactClasses } from './analysis';
import { artefactDimsMm, artefactToMm, hasCustomDims, type Artefact, type ScaleMode } from './model';

const TAG: Record<ClassMethod, string> = { jenks: 'Jenks', autok: 'Auto', sigma: 'Sigma' };

/** True when the common scale is really applied (it needs at least two processed artefacts). */
export const commonActive = (scale: ScaleMode, reference: Artefact[]) => scale === 'common' && reference.filter((r) => r.result).length >= 2;

/** PLY with MRM_Residuals, Rqr and Rqr_<method> for the 3 methods (per piece) + the common scale if active. */
export function buildArtefactPly(a: Artefact, params: ClassParams, scale: ScaleMode, reference: Artefact[], method: ClassMethod): Uint8Array {
  const fields: { label: string; data: ArtefactClasses }[] = [];
  for (const m of ['jenks', 'autok', 'sigma'] as ClassMethod[]) {
    const c = computeClasses([a], [], m, params, 'piece').get(a.id);
    if (c) fields.push({ label: `Rqr_${TAG[m]}`, data: c });
  }
  if (commonActive(scale, reference)) {
    const c = computeClasses([a], reference, method, params, 'common').get(a.id);
    if (c) fields.push({ label: `Rqr_${TAG[method]}_Common`, data: c });
  }
  return artefactPly(a, fields, artefactToMm(a));
}

/** How the millimetre scale of an artefact was obtained. */
function scaleSource(a: Artefact): string {
  if (hasCustomDims(a)) return 'measured dimensions';
  return a.unitConfirmed ? 'model unit (confirmed)' : 'model unit (estimated, not confirmed)';
}

export function buildCompareCsv(
  items: Artefact[],
  classes: Map<string, ArtefactClasses>,
  method: ClassMethod,
  params: ClassParams,
  scale: ScaleMode,
): Uint8Array {
  const common = commonActive(scale, items);
  // The common scale always uses exact Jenks (the legacy algorithm is defined per piece).
  const jenksAlgorithm = method === 'sigma' ? 'n/a' : common ? 'exact' : params.jenksMethod;
  const maxK = Math.max(0, ...items.map((a) => classes.get(a.id)?.classification.k ?? 0));
  const rows: (string | number)[][] = [];
  rows.push(['MRM Analysis Tool', __APP_VERSION__, new Date().toISOString()]);
  rows.push(['Classification', method, 'Jenks algorithm', jenksAlgorithm, 'Scale', common ? 'common' : 'piece']);
  rows.push(['Decimal separator: comma. Lengths, residuals, Rqr and thresholds in mm.']);
  rows.push([]);
  rows.push([
    'Artefact', 'File', 'Site', 'Type', 'Raw material', 'Model unit', 'Scale source', 'mm per model unit',
    'Length (mm)', 'Width (mm)', 'Thickness (mm)', 'Vertices', 'Faces',
    'Trend method', 'Poisson depth', 'Sample %', 'Decimation keep %', 'Laplacian iter', 'Laplacian factor', 'Sign smoothing',
    'Residual mean (mm)', 'Residual std (mm)', 'Residual min (mm)', 'Residual max (mm)',
    'Rqr mean (mm)', 'Rqr median (mm)', 'Rqr std (mm)', 'Rqr min (mm)', 'Rqr max (mm)', 'Rqr p5 (mm)', 'Rqr p25 (mm)', 'Rqr p75 (mm)', 'Rqr p95 (mm)',
    'k', ...Array.from({ length: maxK }, (_, i) => `R${i + 1} %`), ...Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => `Break ${i + 1} (mm)`),
  ]);
  for (const a of items) {
    const r = a.result!;
    const f = artefactToMm(a);
    const dm = artefactDimsMm(a) ?? [NaN, NaN, NaN];
    const c = classes.get(a.id);
    const p = r.params;
    const poisson = p.trendMethod === 'poisson';
    rows.push([
      a.name, a.fileName, a.meta.site, a.meta.type, a.meta.material, a.unit, scaleSource(a), f,
      dm[0], dm[1], dm[2], r.info.vertexCount, r.info.faceCount,
      p.trendMethod, poisson ? p.poissonDepth : '', poisson ? p.sampleFraction * 100 : '', poisson ? '' : p.decimationKeep * 100,
      p.smoothIterations, p.smoothFactor, p.signBoundarySmoothing ? 'yes' : 'no',
      r.residualStats.mean * f, r.residualStats.std * f, r.residualStats.min * f, r.residualStats.max * f,
      r.rqrStats.mean * f, r.rqrStats.median * f, r.rqrStats.std * f, r.rqrStats.min * f, r.rqrStats.max * f,
      r.rqrStats.p5 * f, r.rqrStats.p25 * f, r.rqrStats.p75 * f, r.rqrStats.p95 * f,
      c?.classification.k ?? '',
      ...Array.from({ length: maxK }, (_, i) => (c && i < c.distribution.length ? +c.distribution[i].toFixed(3) : '')),
      ...Array.from({ length: Math.max(0, maxK - 1) }, (_, i) => (c && i < c.classification.breaks.length ? c.classification.breaks[i] * f : '')),
    ]);
  }
  return toCsv(rows);
}
