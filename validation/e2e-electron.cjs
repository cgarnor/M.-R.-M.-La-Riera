/**
 * End-to-end test of the desktop application (`npm run test:e2e`).
 *
 * Starts the real Electron app in test mode, runs the scenario of e2e-renderer.js inside the page
 * (Poisson reconstruction through the native bridge, errors, classifications, figures, CSV,
 * projects, cancellation, security checks) and exits with code 0 if every check passes.
 * Afterwards it reports start-up time, idle CPU usage and memory of the application processes.
 */
process.argv.push('--mrm-test');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const tStart = Date.now();
const main = require(path.join(__dirname, '..', 'electron-main.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CPU (% of one core, from cumulative CPU time) and working set (MB) of all application processes over `ms`. */
async function sampleMetrics(ms) {
  const cum = (m) => new Map(m.map((p) => [p.pid, { type: p.type, t: p.cpu.cumulativeCPUUsage ?? 0 }]));
  const a = cum(app.getAppMetrics());
  const t0 = Date.now();
  await sleep(ms);
  const m = app.getAppMetrics();
  const dt = (Date.now() - t0) / 1000;
  const b = cum(m);
  let cpu = 0;
  const parts = [];
  for (const [pid, v] of b) {
    const pct = Math.max(0, (100 * (v.t - (a.get(pid)?.t ?? v.t))) / dt);
    cpu += pct;
    parts.push(`${v.type} ${pct.toFixed(1)}%`);
  }
  const mem = m.reduce((s, p) => s + p.memory.workingSetSize, 0) / 1024;
  return { cpu, mem, byType: parts.join(', ') };
}

/**
 * Grid view with synchronised cameras and on-demand rendering: a real mouse drag on the first cell
 * (trusted input events sent by the main process) must rotate the camera of the other cells too.
 */
async function cameraSyncCheck(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js("window.__mrm.update({ syncCameras: true, viewMode: 'mrm' }); window.__mrm.setTab('grid'); new Promise((r) => setTimeout(r, 1500))");
  const cells = await js("Array.from(document.querySelectorAll('.grid-cell')).map((c) => { const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })");
  if (cells.length < 2) return { name: 'synchronised cameras in the grid', ok: false, info: `${cells.length} cells` };
  const before = await js('window.__mrm.gridExtents()');
  const [x, y] = cells[0].map(Math.round);
  win.focus();
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + i * 12, y: y + i * 4, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(30);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: x + 144, y: y + 48, button: 'left', clickCount: 1 });
  await sleep(500);
  const after = await js('window.__mrm.gridExtents()');
  const moved = (i) => Math.abs(after[i].w - before[i].w) + Math.abs(after[i].h - before[i].h) > 0.5;
  return { name: 'synchronised cameras in the grid (drag on one cell rotates the others)', ok: moved(0) && moved(1), info: `cell 1 ${before[0].w.toFixed(1)}→${after[0].w.toFixed(1)} mm, cell 2 ${before[1].w.toFixed(1)}→${after[1].w.toFixed(1)} mm` };
}

app.whenReady().then(async () => {
  let code = 1;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await sleep(50);
    if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
    const tLoaded = Date.now();
    // Show errors and warnings of the page (including workers) in the test output.
    win.webContents.on('console-message', (e) => {
      const level = e.level ?? e;
      if (level === 'warning' || level === 'error' || level === 2 || level === 3) console.log(`  [page ${level}] ${e.message ?? ''}`);
    });
    const custom = process.argv.find((a) => a.endsWith('.js') && a !== __filename && fs.existsSync(a));
    const scenario = fs.readFileSync(custom || path.join(__dirname, 'e2e-renderer.js'), 'utf8');
    const dirtyAtStart = typeof main.isDirty === 'function' ? main.isDirty() : null;
    const results = await win.webContents.executeJavaScript(`(${scenario})()`, true);
    if (dirtyAtStart !== null) results.unshift({ name: 'no unsaved-work warning when nothing has been processed', ok: dirtyAtStart === false, info: '' });
    if (!custom) results.push(await cameraSyncCheck(win));
    // Main-process state checked after the scenario.
    if (typeof main.isDirty === 'function') {
      results.push({ name: 'main process knows there is unsaved work (close confirmation)', ok: main.isDirty() === true, info: '' });
    }
    let failed = 0;
    for (const r of results) {
      if (!r.ok) failed++;
      console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info ? ` — ${r.info}` : ''}`);
    }
    console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed`);
    const idle = await sampleMetrics(5000);
    console.log(`\nMetrics: window loaded in ${tLoaded - tStart} ms · idle CPU (5 s, all processes) ${idle.cpu.toFixed(1)} % of one core · memory ${idle.mem.toFixed(0)} MB`);
    console.log(`         ${idle.byType}`);
    code = failed ? 1 : 0;
  } catch (e) {
    console.error('E2E error:', e);
  }
  app.exit(code);
});
