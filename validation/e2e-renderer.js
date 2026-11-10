async function e2eScenario() {
  const results = [];
  const check = (name, ok, info) => results.push({ name, ok: !!ok, info: info === undefined ? '' : String(info) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(200); } return null; };

  // Synthetic artefact: subdivided icosahedron on an ellipsoid with radial noise (OBJ text).
  const ellipsoidObj = (sub, R, noise, seed) => {
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) {
      const cache = new Map();
      const mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; let m = cache.get(k); if (m === undefined) { m = v.length; v.push([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]); cache.set(k, m); } return m; };
      const nf = [];
      for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      f = nf;
    }
    let st = seed;
    const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
    const lines = v.map((p) => { const l = Math.hypot(p[0], p[1], p[2]); const r = R * (1 + noise * (rnd() - 0.5)); return `v ${(p[0] / l) * r} ${(p[1] / l) * r * 0.6} ${(p[2] / l) * r * 0.3}`; });
    for (const [a, b, c] of f) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
    return lines.join('\n');
  };
  const file = (text, name) => new File([text], name);

  const ready = await waitFor(() => window.__mrm, 15000);
  check('automation hook available in test mode', ready);
  if (!ready) return results;
  // The hook is re-created on every render (it closes over the current state): always use the live one.
  const api = new Proxy({}, { get: (_, k) => window.__mrm[k] });

  // ── Security of the renderer ──
  check('no Node.js in the page', typeof window.require === 'undefined' && typeof window.process === 'undefined');
  check('native API is minimal and frozen by contextBridge', Object.keys(window.mrmNative).sort().join(',') === 'isDesktop,poisson,poissonAvailable,poissonCancel,saveFile,saveMany,setDirty,testMode,version');
  let netBlocked = false;
  try { await fetch('https://example.com/'); } catch { netBlocked = true; }
  check('network requests are blocked', netBlocked);
  check('interface served from the private app:// scheme (not file://)', location.protocol === 'app:' && location.host === 'mrm', location.href);
  let fileBlocked = false;
  try { await fetch('file:///C:/Windows/win.ini'); } catch { fileBlocked = true; }
  check('local files cannot be read from the page', fileBlocked);
  const trav = await Promise.all(['app://mrm/%2e%2e/electron-main.cjs', 'app://mrm/..%5celectron-main.cjs', 'app://mrm/../package.json']
    .map((u) => fetch(u).then((r) => r.status).catch(() => 'blocked')));
  check('app:// does not serve files outside the interface folder', trav.every((s) => s === 404 || s === 'blocked'), trav.join(','));
  let badArgs = '';
  try { await window.mrmNative.poisson(new Uint8Array(10), { depth: 99, samplesPerNode: 1.5, pointWeight: 2 }); } catch (e) { badArgs = e.message; }
  check('main process rejects invalid Poisson arguments', badArgs.includes('MRM_ERR:BAD_ARGS'), badArgs.slice(-40));
  let badSave = '';
  try { await window.mrmNative.saveFile('x.txt', [], 'not bytes'); } catch (e) { badSave = e.message; }
  check('main process rejects invalid save requests', badSave.includes('MRM_ERR:BAD_ARGS'));
  check('Poisson reconstruction available', await window.mrmNative.poissonAvailable());

  // ── Processing: two valid models (Poisson) and one damaged file ──
  api.lang('es');
  api.addFiles([
    file(ellipsoidObj(5, 0.05, 0.004, 3), 'pieza_m.obj'), // metres (≈ 100 mm long)
    file(ellipsoidObj(5, 45, 0.004, 5), 'pieza_mm.obj'), // millimetres
    file('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 7\n', 'danada.obj'),
  ]);
  await sleep(300);
  const queuedText = api.viewerText();
  check('viewer shows a translated status (no raw keys)', !/stage\.|status\./.test(queuedText), queuedText.slice(0, 60));
  const finished = await waitFor(() => { const s = api.state(); return s.length === 3 && s.every((a) => a.status === 'done' || a.status === 'error') ? s : null; }, 240000);
  check('all jobs finished', finished);
  if (!finished) return results;
  const [m, mm, bad] = finished;
  check('model in metres processed with Poisson', m.status === 'done' && m.trendMethod === 'poisson' && Number.isFinite(m.rqrMean), m.error);
  check('model in millimetres processed with Poisson', mm.status === 'done' && mm.trendMethod === 'poisson', mm.error);
  check('units estimated (m / mm) and flagged as not confirmed', m.unit === 'm' && mm.unit === 'mm' && !m.unitConfirmed, `${m.unit} ${mm.unit}`);
  check('dimensions in mm close to 100 × 60 × 30', m.dimsMm && Math.abs(m.dimsMm[0] - 100) < 2 && Math.abs(m.dimsMm[2] - 30) < 2, m.dimsMm && m.dimsMm.map((x) => x.toFixed(1)).join(' × '));
  check('damaged file reports a translated error', bad.status === 'error' && bad.errorText.startsWith('El archivo está dañado'), bad.errorText);
  api.lang('en');
  await sleep(100);
  check('error message follows the interface language', api.state()[2].errorText.startsWith('The file is damaged'));
  api.lang('es');
  api.remove(bad.id);
  api.confirmUnit(m.id);
  await sleep(100);
  check('unit confirmation', api.state()[0].unitConfirmed === true);

  // ── Classifications ──
  await sleep(200);
  let cls = api.classes();
  check('Jenks: 6 classes per piece summing to 100 %', cls.length === 2 && cls.every((c) => c.k === 6 && Math.abs(c.dist.reduce((a, b) => a + b, 0) - 100) < 0.5));
  api.update({ method: 'autok' }); await sleep(300);
  cls = api.classes();
  check('Auto-k classification', cls.every((c) => c.k >= 2 && c.k <= 10), cls.map((c) => c.k).join(','));
  api.update({ method: 'sigma', scaleMode: 'common' }); await sleep(300);
  check('μ ± σ with common scale', api.classes().every((c) => c.k === 6));
  api.update({ method: 'jenks', scaleMode: 'piece', viewMode: 'classes' }); await sleep(300);

  // ── Rendered pixels: colours survive switching view modes and viewer ↔ grid (regression test) ──
  // Mean saturation and brightness of the centre of a WebGL canvas (the model is framed there).
  const sample = (canvas) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.drawImage(canvas, w * 0.4, h * 0.4, w * 0.2, h * 0.2, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sat = 0, lum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      sat += mx ? (mx - mn) / mx : 0;
      lum += (d[i] + d[i + 1] + d[i + 2]) / 765;
    }
    return { sat: sat / 4096, lum: lum / 4096 };
  };
  const viewerPixels = async (mode) => { api.update({ viewMode: mode }); await sleep(500); const cv = document.querySelector('.viewport canvas'); return cv ? sample(cv) : { sat: 0, lum: 0 }; };
  api.setTab('viewer'); await sleep(500);
  const p1 = await viewerPixels('mrm');
  const p2 = await viewerPixels('original');
  const p3 = await viewerPixels('trend');
  const p4 = await viewerPixels('mrm');
  const p5 = await viewerPixels('rqr');
  const p6 = await viewerPixels('original');
  const p7 = await viewerPixels('classes');
  const fp = (p) => `${p.sat.toFixed(2)}/${p.lum.toFixed(2)}`;
  // Coloured views are strongly saturated; Original is neutral grey and Trend a bluish grey (≈ 0.23).
  check('colours are shown again after going back from Original/Trend to MRM, Rqr and classes',
    p1.sat > 0.5 && p4.sat > 0.5 && p5.sat > 0.5 && p7.sat > 0.5 && p2.sat < 0.15 && p3.sat < 0.35 && p2.lum > 0.3 && p6.lum > 0.3,
    `sat/lum mrm ${fp(p1)} → original ${fp(p2)} → trend ${fp(p3)} → mrm ${fp(p4)} → rqr ${fp(p5)} → original ${fp(p6)} → classes ${fp(p7)}`);
  for (let i = 0; i < 8; i++) {
    api.setTab('grid'); await sleep(250 + (i % 3) * 100);
    api.setTab('viewer'); await sleep(200 + (i % 2) * 150);
  }
  await sleep(800);
  const q1 = await viewerPixels('original');
  const q2 = await viewerPixels('trend');
  const q3 = await viewerPixels('mrm');
  check('model, lighting and colours intact after 8 fast viewer ↔ grid switches',
    q1.lum > 0.3 && q2.lum > 0.3 && q3.sat > 0.5, `original ${fp(q1)} · trend ${fp(q2)} · mrm ${fp(q3)}`);
  api.update({ viewMode: 'original' }); api.setTab('grid'); await sleep(1500);
  const gridPx = Array.from(document.querySelectorAll('.grid-cell canvas')).map(sample);
  api.update({ viewMode: 'mrm' }); await sleep(1000);
  const gridCol = Array.from(document.querySelectorAll('.grid-cell canvas')).map(sample);
  check('every grid cell shows its model (original) and its colours (MRM)',
    gridPx.length >= 2 && gridPx.every((p) => p.lum > 0.3) && gridCol.every((p) => p.sat > 0.5),
    `original lum ${gridPx.map((p) => p.lum.toFixed(2)).join(',')} · mrm sat ${gridCol.map((p) => p.sat.toFixed(2)).join(',')}`);
  api.update({ viewMode: 'classes' }); api.setTab('viewer'); await sleep(500);

  // ── Viewer: one WebGL context, released when switching artefacts; about dialog closes with Escape ──
  api.setTab('viewer'); await sleep(300);
  api.select(mm.id); await sleep(600);
  api.select(m.id); await sleep(600);
  check('single 3D canvas after switching artefacts (previous GPU context released)', document.querySelectorAll('.viewport canvas').length === 1, document.querySelectorAll('.viewport canvas').length);
  api.about(true); await sleep(150);
  const hadDialog = !!document.querySelector('[role="dialog"]');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await sleep(150);
  check('"About" is an accessible dialog that closes with Escape', hadDialog && !document.querySelector('[role="dialog"]'));

  // ── Figures and CSV ──
  const b64bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const opts = { format: 'png', dpi: 300, widthCm: 8.5, maxHeightCm: 23, fontPt: 8, background: 'white', fit: true, showName: true, showLegend: true, showScale: true, showTitle: false };
  api.setTab('viewer'); await sleep(800);
  const view = await api.figures('view', opts, { charts: [], csv: false });
  const png = view[0] && b64bytes(view[0].b64);
  check('view figure: PNG with 300 dpi metadata', png && png[1] === 0x50 && png[2] === 0x4e && String.fromCharCode(...png.subarray(37, 41)) === 'pHYs' && new DataView(png.buffer).getUint32(41) === 11811, view[0] && view[0].name);
  api.setTab('grid'); await sleep(1500);
  const grid = await api.figures('grid', { ...opts, widthCm: 17.5, format: 'jpg' }, { charts: [], csv: false });
  const jpg = grid[0] && b64bytes(grid[0].b64);
  check('grid figure: JPEG with 300 dpi metadata', jpg && jpg[0] === 0xff && jpg[1] === 0xd8 && jpg[13] === 1 && ((jpg[14] << 8) | jpg[15]) === 300, grid[0] && grid[0].name);
  api.setTab('compare'); await sleep(500);
  const cmp = await api.figures('compare', { ...opts, format: 'svg', widthCm: 17.5 }, { charts: ['dist', 'box', 'hist'], csv: true });
  check('comparison: 3 SVG charts + CSV', cmp.length === 4 && cmp.slice(0, 3).every((f) => f.name.endsWith('.svg')), cmp.map((f) => f.name).join(', '));
  const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(b64bytes(cmp[3].b64));
  const row = csv.split('\r\n')[5] || '';
  check('CSV: BOM, ";" separator and decimal comma', csv.charCodeAt(0) === 0xfeff && row.split(';').length > 30 && /;\d+,\d+;/.test(row) && !/\d\.\d/.test(row), row.slice(0, 80));
  const svg = new TextDecoder().decode(b64bytes(cmp[1].b64));
  check('charts use decimal comma in Spanish', /<text[^>]*>0,0\d+<\/text>/.test(svg));

  // ── Projects ──
  const before = api.state().length;
  const proj = api.project();
  await api.openProject(proj);
  await sleep(500);
  const after = api.state();
  check('project round trip adds the artefacts with unique ids', after.length === before + 2 && new Set(after.map((a) => a.id)).size === after.length);
  check('project keeps the unit confirmation', after[before].unitConfirmed === true && after[before + 1].unitConfirmed === false);
  await api.openProject(btoa('MRMP garbage that is not a project'));
  await sleep(200);
  check('damaged project shows a translated error', (api.toast() || '').startsWith('No se pudo abrir el proyecto: El archivo de proyecto no es válido'), api.toast());

  // ── Cancelling a running job ──
  api.update({ scaleMode: 'piece' });
  api.addFiles([file(ellipsoidObj(6, 50, 0.004, 9), 'grande.obj')]);
  const running = await waitFor(() => { const s = api.state(); const g = s[s.length - 1]; return g.status === 'processing' ? g : null; }, 30000);
  check('large model starts processing', running);
  if (running) api.remove(running.id);
  api.setMrmParams({ trendMethod: 'decimation' });
  api.addFiles([file(ellipsoidObj(4, 30, 0.004, 11), 'despues.obj')]);
  const next = await waitFor(() => { const s = api.state(); const g = s[s.length - 1]; return g.name === 'despues' && (g.status === 'done' || g.status === 'error') ? g : null; }, 60000);
  check('queue keeps working after cancelling a running job', next && next.status === 'done' && next.trendMethod === 'decimation', next && next.error);
  return results;
}
