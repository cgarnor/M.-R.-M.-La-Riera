/**
 * End-to-end test of the packaged application (`npm run test:packaged`, after `npm run electron:build`).
 *
 * Starts release/win-unpacked/MRM Analysis Tool.exe in test mode with a local debugging port and
 * runs the scenario of e2e-renderer.js in the page through the Chrome DevTools Protocol. This checks
 * the real distributed build: Electron fuses, asar integrity, bundled PoissonRecon.exe, CSP.
 * Requires Node.js 22 or later (global WebSocket).
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.argv[2] || join(here, '..', 'release', 'win-unpacked', 'MRM Analysis Tool.exe');
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(exe)) { console.error(`Not found: ${exe}`); process.exit(2); }
const app = spawn(exe, ['--mrm-test', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'], { stdio: 'ignore' });
let code = 1;
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('app://mrm/'));
    } catch { /* not ready yet */ }
  }
  if (!target) throw new Error('The application window did not open');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    // Crashes, reloads and page errors are reported (a reload would otherwise look like a test failure).
    if (d.method === 'Inspector.targetCrashed') events.push('RENDERER CRASHED');
    if (d.method === 'Page.frameNavigated' && !d.params.frame.parentId) events.push(`navigated: ${d.params.frame.url}`);
    if (d.method === 'Runtime.exceptionThrown') events.push(`exception: ${d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') events.push(`console.error: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  };
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Inspector.enable');
  // Wait until the interface has finished loading and the test hook is registered.
  for (let i = 0; i < 100; i++) {
    const r = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!window.__mrm", returnByValue: true });
    if (r.result?.result?.value === true) break;
    await sleep(200);
  }
  const scenario = readFileSync(join(here, 'e2e-renderer.js'), 'utf8');
  const res = await send('Runtime.evaluate', { expression: `(${scenario})()`, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails || !res.result?.result) throw new Error(JSON.stringify(res.result?.exceptionDetails ?? res).slice(0, 500) + '\n' + events.join('\n'));
  const results = res.result.result.value;
  // Keyboard editing in text fields without an application menu (trusted key events through CDP).
  await send('Runtime.evaluate', { expression: "(() => { const i = document.createElement('input'); i.id = 'mrm-kb'; i.value = 'texto de prueba'; document.body.appendChild(i); i.focus(); })()" });
  const key = (type, k, code, vk, modifiers = 0) => send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await key('rawKeyDown', 'a', 'KeyA', 65, 2); await key('keyUp', 'a', 'KeyA', 65, 2);
  await key('rawKeyDown', 'Backspace', 'Backspace', 8); await key('keyUp', 'Backspace', 'Backspace', 8);
  const kb = await send('Runtime.evaluate', { expression: "(() => { const i = document.getElementById('mrm-kb'); const v = i.value; i.remove(); return v; })()", returnByValue: true });
  results.push({ name: 'Ctrl+A / Backspace work in text fields (no application menu)', ok: kb.result?.result?.value === '', info: JSON.stringify(kb.result?.result?.value) });
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info ? ` — ${r.info}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} end-to-end checks passed (packaged application)`);
  code = failed ? 1 : 0;
  ws.close();
} catch (e) {
  console.error('E2E error:', e.message);
} finally {
  app.kill();
}
process.exit(code);
