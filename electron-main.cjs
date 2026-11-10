/**
 * MRM Analysis Tool — Electron main process.
 *
 * Security model: the renderer is sandboxed, isolated and has no Node access. It only loads the
 * bundled interface from the private app://mrm scheme (never file://), cannot navigate, open
 * windows, request permissions or reach the network, and talks to this process through a small
 * IPC surface whose sender and arguments are validated here.
 *
 * SPDX-License-Identifier: MIT
 */
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, protocol, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const {
  APP_SCHEME, APP_ORIGIN, isBytes, num, safeFileName, sanitizeFilters, isAllowedExternal, resolveAppPath, isAppUrl, writeError,
} = require('./electron-helpers.cjs');

const APP_ID = 'com.mrm.analysis-tool';
/** Enables the automation hook used by the end-to-end tests (validation/). */
const TEST_MODE = process.argv.includes('--mrm-test');
/** Vite dev server (development only; never honoured by the packaged application). */
const DEV_URL = !app.isPackaged && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/?$/.test(process.env.MRM_DEV_URL || '')
  ? process.env.MRM_DEV_URL
  : null;
const DIST = path.join(__dirname, 'dist');
const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

/** Maximum run time of one Poisson reconstruction before it is cancelled. */
const POISSON_TIMEOUT_MS = 30 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// The private scheme behaves like https (secure context, same-origin rules, module workers).
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.enableSandbox();
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

/** PoissonRecon.exe: bundled in resources/bin when packaged, native/win-x64 in development. */
function poissonExe() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'PoissonRecon.exe')
    : path.join(__dirname, 'native', 'win-x64', 'PoissonRecon.exe');
}

// ─── Sender validation ─────────────────────────────────────────────────────

/** True if the IPC message comes from the main frame of our own page. */
function isTrustedSender(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  if (DEV_URL) {
    try { return new URL(frame.url).origin === new URL(DEV_URL).origin; } catch { return false; }
  }
  return isAppUrl(frame.url);
}

/** Registers an IPC handler that rejects untrusted senders. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('MRM_ERR:FORBIDDEN');
    return fn(event, ...args);
  });
}

// ─── Unsaved work ──────────────────────────────────────────────────────────

/** Set by the interface: processed artefacts not saved in a project since their last change. */
let dirty = false;
let dirtyLang = 'es';

function confirmClose(win) {
  const es = dirtyLang !== 'en';
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: es ? ['Salir sin guardar', 'Cancelar'] : ['Quit without saving', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'MRM Analysis Tool',
    message: es ? 'Hay artefactos procesados que no se han guardado en un proyecto.' : 'There are processed artefacts that have not been saved in a project.',
    detail: es ? 'Si sales ahora se perderán los resultados. Usa «Guardar proyecto» para conservarlos.' : 'If you quit now the results will be lost. Use "Save project" to keep them.',
  });
  return choice === 0;
}

// ─── Window ────────────────────────────────────────────────────────────────

function createWindow() {
  // Fit the window to the screen (small laptops and high display scaling).
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1500, work.width);
  const height = Math.min(950, work.height);
  const win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1000, width),
    minHeight: Math.min(640, height),
    title: 'MRM Analysis Tool',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || TEST_MODE,
      additionalArguments: TEST_MODE ? ['--mrm-test'] : [],
    },
  });
  if (work.width <= 1500 || work.height <= 950) win.maximize();

  // External links (DOI, repository...) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  // Never navigate away from the app (e.g. a file dropped outside the drop zone).
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.on('close', (event) => {
    if (dirty && !TEST_MODE && !confirmClose(win)) event.preventDefault();
  });

  // Recover from a crashed renderer (e.g. out of memory with a very large model).
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    dirty = false;
    dialog.showMessageBox(win, {
      type: 'error',
      title: 'MRM Analysis Tool',
      message: 'La ventana de la aplicación se ha cerrado inesperadamente / The application window stopped unexpectedly.',
      detail: `${details.reason}. Se recargará la aplicación; los artefactos no guardados se han perdido. / The application will reload; unsaved artefacts were lost.`,
    }).finally(() => { if (!win.isDestroyed()) win.reload(); });
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools();
  } else {
    win.loadURL(APP_INDEX_URL);
  }
}

/** Serves the bundled interface (dist/) on app://mrm/. Nothing outside dist/ can be requested. */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(DIST, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, {
        status: 200,
        headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'x-content-type-options': 'nosniff' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Session hardening: no permissions, no network (everything is bundled). */
function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  const devOrigin = DEV_URL ? new URL(DEV_URL).origin : null;
  const devWs = devOrigin ? devOrigin.replace(/^http/, 'ws') : null;
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const ok = isAppUrl(u) || /^(data|blob|devtools):/i.test(u)
      || (devOrigin && (u.startsWith(devOrigin) || u.startsWith(devWs)));
    callback({ cancel: !ok });
  });
}

// ─── Poisson Surface Reconstruction bridge ─────────────────────────────────

const running = new Set();

handle('poisson:available', () => fs.existsSync(poissonExe()));

handle('poisson:cancel', () => {
  for (const p of running) p.kill();
  return true;
});

handle('poisson:run', async (_event, pointsPly, opts) => {
  if (!isBytes(pointsPly) || !opts || typeof opts !== 'object') throw new Error('MRM_ERR:BAD_ARGS');
  const depth = num(opts.depth, 5, 12, true);
  const samplesPerNode = num(opts.samplesPerNode, 1, 20);
  const pointWeight = num(opts.pointWeight, 0, 100);
  const exe = poissonExe();
  if (!fs.existsSync(exe)) throw new Error('MRM_ERR:POISSON_UNAVAILABLE');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mrm-poisson-'));
  const inFile = path.join(dir, 'in.ply');
  const outFile = path.join(dir, 'out.ply');
  try {
    await fs.promises.writeFile(inFile, pointsPly).catch((e) => { throw writeError(e); });
    const args = [
      '--in', inFile, '--out', outFile,
      '--depth', String(depth),
      '--samplesPerNode', String(samplesPerNode),
      '--pointWeight', String(pointWeight),
      '--bType', '3', // Neumann (CloudCompare default)
    ];
    await new Promise((resolve, reject) => {
      const p = spawn(exe, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      running.add(p);
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; p.kill(); }, POISSON_TIMEOUT_MS);
      p.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
      p.on('error', (e) => { clearTimeout(timer); running.delete(p); reject(new Error(`MRM_ERR:POISSON_FAILED:${e.message}`)); });
      p.on('close', (code, signal) => {
        clearTimeout(timer);
        running.delete(p);
        if (code === 0) resolve();
        else if (timedOut) reject(new Error('MRM_ERR:POISSON_TIMEOUT'));
        else if (signal) reject(new Error('MRM_ERR:CANCELLED'));
        else reject(new Error(`MRM_ERR:POISSON_FAILED:code ${code} ${stderr.trim().slice(-300)}`));
      });
    });
    const out = await fs.promises.readFile(outFile);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── Native save dialogs ───────────────────────────────────────────────────

handle('file:save', async (event, req) => {
  if (!req || !isBytes(req.data)) throw new Error('MRM_ERR:BAD_ARGS');
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: safeFileName(req.defaultPath, 'MRM'),
    filters: sanitizeFilters(req.filters),
  });
  if (canceled || !filePath) return null;
  try {
    await fs.promises.writeFile(filePath, req.data);
  } catch (e) {
    throw writeError(e);
  }
  return filePath;
});

handle('file:saveMany', async (event, req) => {
  if (!req || !Array.isArray(req.files) || req.files.length === 0 || req.files.length > 50) throw new Error('MRM_ERR:BAD_ARGS');
  const es = req.lang !== 'en';
  const files = req.files.map((f, i) => {
    if (!f || !isBytes(f.data)) throw new Error('MRM_ERR:BAD_ARGS');
    return { name: safeFileName(f.name, `MRM_${i + 1}`), data: f.data };
  });
  if (new Set(files.map((f) => f.name.toLowerCase())).size !== files.length) throw new Error('MRM_ERR:BAD_ARGS');
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: String(req.title || '').slice(0, 120),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return null;
  const dir = filePaths[0];
  const existing = files.filter((f) => fs.existsSync(path.join(dir, f.name))).map((f) => f.name);
  if (existing.length) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: es ? ['Reemplazar', 'Cancelar'] : ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'MRM Analysis Tool',
      message: es ? 'Algunos archivos ya existen en la carpeta elegida.' : 'Some files already exist in the chosen folder.',
      detail: existing.slice(0, 12).join('\n') + (existing.length > 12 ? '\n…' : ''),
    });
    if (response !== 0) return null;
  }
  try {
    for (const f of files) await fs.promises.writeFile(path.join(dir, f.name), f.data);
  } catch (e) {
    throw writeError(e);
  }
  return dir;
});

handle('app:version', () => app.getVersion());

handle('app:setDirty', (_event, value, lang) => {
  dirty = value === true;
  dirtyLang = lang === 'en' ? 'en' : 'es';
  return true;
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null); // no reload / devtools accelerators
  registerAppProtocol();
  hardenSession();
  createWindow();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('will-quit', () => {
  for (const p of running) p.kill();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/** Read by the end-to-end test harness (validation/e2e-electron.cjs). */
module.exports = { isDirty: () => dirty };
