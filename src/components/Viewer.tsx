import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { MrmResult } from '../engine/types';
import { eigenSym3 } from '../engine/pca';
import { classColors, fmtMm, fmtNum, rampColor, rampCss, srgbToLinear, toCss, type ArtefactClasses } from '../state/analysis';
import type { ColorRamp, ViewMode } from '../state/model';
import type { Extent, LegendModel, RenderFn } from '../utils/figure';
import { useI18n } from '../i18n';

// ─── Camera synchronisation (grid view) ─────────────────────────────

interface CamState { dir: THREE.Vector3; dist: number; up: THREE.Vector3 }
export class CameraSync {
  private subs = new Map<number, (s: CamState) => void>();
  private n = 0;
  subscribe(fn: (s: CamState) => void): () => void {
    const id = ++this.n;
    this.subs.set(id, fn);
    return () => this.subs.delete(id);
  }
  publish(from: (s: CamState) => void, s: CamState): void {
    for (const fn of this.subs.values()) if (fn !== from) fn(s);
  }
}

// ─── Geometry cache ─────────────────────────────────────────────────

interface Framing { radius: number; dir: THREE.Vector3; up: THREE.Vector3; halfLong: number; halfMid: number }

const geomCache = new WeakMap<MrmResult, { orig: THREE.BufferGeometry; trend: THREE.BufferGeometry; framing: Framing }>();

function computeFraming(pos: Float32Array, radius: number): Framing {
  const n = pos.length / 3;
  const step = Math.max(1, Math.floor(n / 20000));
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (let i = 0; i < n; i += step) { cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2]; cnt++; }
  cx /= cnt; cy /= cnt; cz /= cnt;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i += step) {
    const d = [pos[3 * i] - cx, pos[3 * i + 1] - cy, pos[3 * i + 2] - cz];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r][c] += d[r] * d[c];
  }
  const { vectors } = eigenSym3(C);
  const ax = vectors.map((v) => new THREE.Vector3(v[0], v[1], v[2]).normalize());
  // Extents along the principal axes
  const ext = [0, 0, 0];
  for (let i = 0; i < n; i += step) {
    const p = new THREE.Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    for (let k = 0; k < 3; k++) ext[k] = Math.max(ext[k], Math.abs(p.dot(ax[k])));
  }
  return { radius, up: ax[0], dir: ax[2], halfLong: ext[0] || radius, halfMid: ext[1] || radius };
}

function getGeometries(r: MrmResult) {
  let g = geomCache.get(r);
  if (!g) {
    const orig = new THREE.BufferGeometry();
    orig.setAttribute('position', new THREE.BufferAttribute(r.mesh.positions, 3));
    orig.setIndex(new THREE.BufferAttribute(r.mesh.indices, 1));
    orig.computeVertexNormals();
    orig.computeBoundingSphere();
    const trend = new THREE.BufferGeometry();
    trend.setAttribute('position', new THREE.BufferAttribute(r.trend.positions, 3));
    trend.setIndex(new THREE.BufferAttribute(r.trend.indices, 1));
    trend.computeVertexNormals();
    g = { orig, trend, framing: computeFraming(r.mesh.positions, orig.boundingSphere?.radius || 1) };
    geomCache.set(r, g);
  }
  return g;
}

// ─── Scene parts ────────────────────────────────────────────────────

function Lights({ azimuth, elevation, colored }: { azimuth: number; elevation: number; colored: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const { camera, invalidate } = useThree();
  // The canvas only renders on demand: redraw when the light direction changes.
  useEffect(() => invalidate(), [azimuth, elevation, invalidate]);
  // Key light follows the camera (always lights the visible side), offset by azimuth/elevation.
  useFrame(() => {
    if (!ref.current) return;
    const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
    const local = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    ref.current.position.copy(local.applyQuaternion(camera.quaternion).multiplyScalar(10));
    ref.current.target.position.set(0, 0, 0);
    ref.current.target.updateMatrixWorld();
  });
  // Coloured views use a softer key light so the scalar colours are not washed out
  // (no tone mapping: the rendered colours correspond to the legend).
  return (
    <>
      <ambientLight intensity={colored ? 0.62 : 0.5} />
      <directionalLight ref={ref} intensity={colored ? 0.75 : 1.35} />
      <hemisphereLight args={[0xffffff, 0x222233, colored ? 0.15 : 0.3]} />
    </>
  );
}

function CameraRig({ framing, sync }: { framing: Framing; sync: CameraSync | null }) {
  const { camera, controls, size, invalidate } = useThree() as unknown as { invalidate: () => void; camera: THREE.PerspectiveCamera; size: { width: number; height: number }; controls: { target: THREE.Vector3; update: () => void; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void } | null };
  const radius = framing.radius;
  const dragging = useRef(false);
  const pendingRef = useRef<CamState | null>(null);

  useEffect(() => {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1.5;
    const dist = Math.max(framing.halfLong / tanV, framing.halfMid / (tanV * aspect)) * 1.18 + framing.radius * 0.2;
    camera.position.copy(framing.dir).multiplyScalar(dist);
    camera.up.copy(framing.up);
    camera.near = dist / 1000;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    controls?.target.set(0, 0, 0);
    controls?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framing, camera, controls]);

  useEffect(() => {
    if (!sync || !controls) return;
    const receive = (s: CamState) => { pendingRef.current = s; invalidate(); };
    const unsub = sync.subscribe(receive);
    const onStart = () => { dragging.current = true; };
    const onEnd = () => { dragging.current = false; };
    const onChange = () => {
      if (!dragging.current) return;
      const off = camera.position.clone().sub(controls.target);
      sync.publish(receive, { dir: off.clone().normalize(), dist: off.length() / radius, up: camera.up.clone() });
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    controls.addEventListener('change', onChange);
    return () => {
      unsub();
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.removeEventListener('change', onChange);
    };
  }, [sync, controls, camera, radius, invalidate]);

  useFrame(() => {
    const s = pendingRef.current;
    if (!s || !controls) return;
    pendingRef.current = null;
    camera.position.copy(controls.target).addScaledVector(s.dir, s.dist * radius);
    camera.up.copy(s.up);
    controls.update();
  });
  return null;
}

// ─── Viewer ─────────────────────────────────────────────────────────

export interface ViewerHandle {
  /** Aspect ratio (width / height) of the on-screen view. */
  aspect: () => number;
  /** mm per pixel needed to show the current view in a width × height image. */
  naturalMmPerPx: (width: number, height: number) => number;
  /** Outline of the piece seen from the current camera (mm, camera plane). */
  extent: () => Extent;
  /** Off-screen orthographic render of the current view (exact metric scale). */
  render: RenderFn;
  /** Colour legend of the current view mode. */
  legend: () => LegendModel;
}

export interface ViewerProps {
  result: MrmResult;
  name: string;
  mode: ViewMode;
  classes?: ArtefactClasses;
  classLabels: string[];
  ramp: ColorRamp;
  /** Half-range of the MRM colour scale, in mm. */
  mrmRangeMm: number;
  /** Multiply model units by this to get mm. */
  toMm: number;
  lightAzimuth: number;
  lightElevation: number;
  sync?: CameraSync | null;
  compact?: boolean;
}

interface OffscreenApi { natural: (w: number, h: number) => number; extent: () => Extent; render: RenderFn }

/** Lives inside the Canvas to access the renderer, scene and camera for high-resolution exports. */
function Offscreen({ api, toMm, radius, positions }: { api: React.MutableRefObject<OffscreenApi | null>; toMm: number; radius: number; positions: ArrayLike<number> }) {
  const { gl, scene, camera, controls } = useThree() as unknown as {
    gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3 } | null;
  };
  useEffect(() => {
    const target = () => controls?.target ?? new THREE.Vector3();
    /** World units per pixel so that the current view fits into w × h. */
    const worldPerPx = (w: number, h: number) => {
      const dist = camera.position.distanceTo(target());
      const viewH = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
      return Math.max(viewH / h, (viewH * camera.aspect) / w);
    };
    api.current = {
      natural: (w, h) => worldPerPx(w, h) * toMm,
      extent: () => {
        // Bounding box of all vertices in the camera plane (x right, y up), in mm.
        camera.updateMatrixWorld();
        const e = camera.matrixWorldInverse.elements;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
          const px = positions[i], py = positions[i + 1], pz = positions[i + 2];
          const x = e[0] * px + e[4] * py + e[8] * pz + e[12];
          const y = e[1] * px + e[5] * py + e[9] * pz + e[13];
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return { cx: ((x0 + x1) / 2) * toMm, cy: ((y0 + y1) / 2) * toMm, w: (x1 - x0) * toMm, h: (y1 - y0) * toMm };
      },
      render: (W, H, mmPerPx, background, centerMm) => {
        const max = gl.capabilities.maxTextureSize;
        if (W > max || H > max) throw new Error(`MAX_SIZE:${max}`);
        const wpp = mmPerPx ? mmPerPx / toMm : worldPerPx(W, H);
        const cx = centerMm ? centerMm[0] / toMm : 0, cy = centerMm ? centerMm[1] / toMm : 0;
        // Orthographic camera with the same orientation: parallel projection, so the scale bar
        // is exact at every depth of the piece. Its camera-plane coordinates equal those of the
        // on-screen camera (it is only moved along the viewing axis).
        const dir = camera.position.clone().sub(target()).normalize();
        const D = camera.position.distanceTo(target()) + 4 * radius;
        const ortho = new THREE.OrthographicCamera(cx - (W * wpp) / 2, cx + (W * wpp) / 2, cy + (H * wpp) / 2, cy - (H * wpp) / 2, radius * 0.01, D + 4 * radius);
        ortho.position.copy(camera.position).addScaledVector(dir, D - camera.position.distanceTo(target()));
        ortho.quaternion.copy(camera.quaternion);
        ortho.updateProjectionMatrix();
        ortho.updateMatrixWorld();
        const rt = new THREE.WebGLRenderTarget(W, H, { samples: W * H <= 9e6 ? 4 : 0, depthBuffer: true });
        rt.texture.colorSpace = THREE.SRGBColorSpace;
        const prevTarget = gl.getRenderTarget();
        const prevColor = new THREE.Color();
        gl.getClearColor(prevColor);
        const prevAlpha = gl.getClearAlpha();
        const buf = new Uint8Array(W * H * 4);
        try {
          if (background) gl.setClearColor(background, 1); else gl.setClearColor(0x000000, 0);
          gl.setRenderTarget(rt);
          gl.clear();
          gl.render(scene, ortho);
          gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        } finally {
          gl.setRenderTarget(prevTarget);
          gl.setClearColor(prevColor, prevAlpha);
          rt.dispose();
        }
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d')!;
        const img = ctx.createImageData(W, H);
        const row = W * 4;
        for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
        ctx.putImageData(img, 0, 0);
        return { canvas: c, mmPerPx: wpp * toMm };
      },
    };
    return () => { api.current = null; };
  }, [gl, scene, camera, controls, toMm, radius, positions, api]);
  return null;
}

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(props, ref) {
  const { result, name, mode, classes, classLabels, ramp, mrmRangeMm, toMm, lightAzimuth, lightElevation, sync, compact } = props;
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const offscreen = useRef<OffscreenApi | null>(null);
  const geoms = getGeometries(result);
  /** Bumped to recreate the canvas when the browser drops its WebGL context. */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const epochRef = useRef(0);
  epochRef.current = canvasEpoch;
  const mounted = useRef(true);
  /** Set while this view is being removed (its own context is released on purpose then). */
  const unloading = useRef(false);
  useEffect(() => {
    mounted.current = true;
    unloading.current = false;
    return () => { mounted.current = false; unloading.current = true; };
  }, []);

  const displayGeom = useMemo(() => {
    if (mode === 'trend') return geoms.trend;
    if (mode === 'original') return geoms.orig;
    const n = result.residuals.length;
    const colors = new Float32Array(n * 3);
    // Vertex colours are interpreted as linear by Three.js: convert from sRGB so the
    // on-screen colours match the legend (otherwise blues look pale and washed out).
    const put = (i: number, c: [number, number, number]) => {
      colors[3 * i] = srgbToLinear(c[0]); colors[3 * i + 1] = srgbToLinear(c[1]); colors[3 * i + 2] = srgbToLinear(c[2]);
    };
    if (mode === 'mrm') {
      const half = mrmRangeMm / toMm;
      for (let i = 0; i < n; i++) put(i, rampColor(ramp, (result.residuals[i] / half + 1) / 2));
    } else if (mode === 'rqr') {
      // Low Rqr (most polished) -> blue, high Rqr (least polished) -> red.
      const lo = result.rqrStats.p5, hi = result.rqrStats.p95;
      for (let i = 0; i < n; i++) put(i, rampColor(ramp, (result.rqr[i] - lo) / (hi - lo || 1)));
    } else if (mode === 'classes' && classes) {
      // R1 (most polished) -> blue ... Rk (least polished) -> red.
      const pal = classColors(classes.classification.k);
      for (let i = 0; i < n; i++) put(i, pal[classes.classes[i] - 1] ?? [0.5, 0.5, 0.5]);
    } else {
      for (let i = 0; i < n; i++) put(i, [0.6, 0.6, 0.6]); // classification not available yet
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geoms.orig.getAttribute('position'));
    g.setAttribute('normal', geoms.orig.getAttribute('normal'));
    g.setIndex(geoms.orig.getIndex());
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.boundingSphere = geoms.orig.boundingSphere;
    return g;
  }, [mode, result, classes, ramp, mrmRangeMm, toMm, geoms]);

  useEffect(() => () => {
    if (displayGeom !== geoms.orig && displayGeom !== geoms.trend) {
      // Detach shared attributes first so dispose() only frees the colour buffer.
      displayGeom.deleteAttribute('position');
      displayGeom.deleteAttribute('normal');
      displayGeom.setIndex(null);
      displayGeom.dispose();
    }
  }, [displayGeom, geoms]);

  const colored = mode === 'mrm' || mode === 'rqr' || mode === 'classes';

  // Legend model (shared by the on-screen overlay and the exported figures)
  const legend = useMemo((): LegendModel => {
    if (mode === 'mrm') {
      return { kind: 'bar', title: t('view.mrmLegend'), lo: -mrmRangeMm, hi: mrmRangeMm, unit: 'mm', zero: true, notes: [`▲ ${t('view.mrmPos')}`, `▼ ${t('view.mrmNeg')}`] };
    }
    if (mode === 'rqr') {
      return {
        kind: 'bar', title: t('view.rqrLegend'), lo: result.rqrStats.p5 * toMm, hi: result.rqrStats.p95 * toMm, unit: 'mm',
        loLabel: t('view.polishedMost'), hiLabel: t('view.polishedLeast'),
      };
    }
    if (mode === 'classes' && classes) {
      const pal = classColors(classes.classification.k);
      return {
        kind: 'classes',
        title: t('view.classes'),
        items: classes.distribution.map((p, i) => ({ color: toCss(pal[i]), label: classLabels[i] ?? `R${i + 1}`, pct: p })),
        loLabel: t('view.polishedMost'), hiLabel: t('view.polishedLeast'),
      };
    }
    return null;
  }, [mode, mrmRangeMm, result, toMm, classes, classLabels, t]);

  useImperativeHandle(ref, () => ({
    aspect: () => {
      const el = wrapRef.current;
      return el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1.5;
    },
    naturalMmPerPx: (w, h) => {
      if (!offscreen.current) throw new Error('Viewer not ready');
      return offscreen.current.natural(w, h);
    },
    extent: () => {
      if (!offscreen.current) throw new Error('Viewer not ready');
      return offscreen.current.extent();
    },
    render: (w, h, mmPerPx, bg, center) => {
      if (!offscreen.current) throw new Error('Viewer not ready');
      return offscreen.current.render(w, h, mmPerPx, bg, center);
    },
    legend: () => legend,
  }), [legend]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height: '100%', background: '#0d0d14' }}>
      <Canvas
        key={canvasEpoch}
        flat
        frameloop="demand"
        camera={{ fov: 40, position: [0, 0, 5] }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={[1, 2]}
        onCreated={({ gl }) => {
          // If the browser drops this WebGL context (e.g. too many 3D views opened quickly),
          // recreate the canvas instead of leaving an empty or grey view. Contexts released on
          // purpose (view closed, or canvas already replaced) are ignored.
          const epoch = epochRef.current;
          gl.domElement.addEventListener('webglcontextlost', () => {
            if (!mounted.current || unloading.current || epochRef.current !== epoch) return;
            setTimeout(() => {
              if (mounted.current && !unloading.current && epochRef.current === epoch) setCanvasEpoch(epoch + 1);
            }, 50);
          }, { once: true });
        }}
      >
        <Lights azimuth={lightAzimuth} elevation={lightElevation} colored={colored} />
        {/* dispose={null}: the original and trend geometries are shared by every open view (viewer
            and grid cells); letting the renderer dispose them when one view closes would delete
            the GPU buffers of the others. The colour geometry is freed by the effect above. */}
        <mesh geometry={displayGeom} dispose={null}>
          {/* Different keys: switching between coloured and plain views creates a new material.
              Toggling vertexColors on a reused material does not recompile its shader. */}
          {colored ? (
            <meshStandardMaterial key="vertex-colors" vertexColors roughness={0.8} metalness={0} side={THREE.DoubleSide} />
          ) : (
            <meshStandardMaterial key="plain" color={mode === 'trend' ? 0x9aa6c8 : 0xb8b4ac} roughness={0.6} metalness={0.02} side={THREE.DoubleSide} />
          )}
        </mesh>
        <OrbitControls makeDefault enableDamping={false} rotateSpeed={0.9} zoomSpeed={1.1} />
        <CameraRig framing={geoms.framing} sync={sync ?? null} />
        <Offscreen api={offscreen} toMm={toMm} radius={geoms.framing.radius} positions={result.mesh.positions} />
      </Canvas>

      {compact && (
        <div className="viewer-chip">{name}</div>
      )}

      {legend && !compact && (
        <div className="legend">
          <div className="legend-title">{legend.title}</div>
          {legend.kind === 'bar' ? (
            <>
              <div style={{ height: 10, borderRadius: 3, background: rampCss(ramp), margin: '6px 0 3px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem' }}>
                <span>{fmtMm(legend.lo, 3)}</span>
                {mode === 'mrm' && <span>0</span>}
                <span>{fmtMm(legend.hi, 3)} {legend.unit}</span>
              </div>
              {legend.loLabel && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', opacity: 0.8, marginTop: 2 }}>
                  <span>{legend.loLabel}</span>
                  <span>{legend.hiLabel}</span>
                </div>
              )}
              {mode === 'mrm' && (
                <div style={{ marginTop: 6, fontSize: '0.64rem', opacity: 0.75, lineHeight: 1.45 }}>
                  <div>▲ {t('view.mrmPos')}</div>
                  <div>▼ {t('view.mrmNeg')}</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              {legend.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                  {it.pct !== undefined && <span style={{ opacity: 0.75 }}>{fmtNum(it.pct, 1)} %</span>}
                </div>
              ))}
              <div style={{ fontSize: '0.62rem', opacity: 0.7, marginTop: 2 }}>
                R1 = {legend.loLabel.toLowerCase()} · R{legend.items.length} = {legend.hiLabel.toLowerCase()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
