'use strict';

/**
 * LostCity Launcher — Electron main process.
 *
 * Responsibilities:
 *   1. Ensure the Next.js dashboard (running on http://localhost:3000) is up.
 *      If it isn't, spawn `bun run dev` (falling back to `npm`/`npx`) in the
 *      project root (the directory above `electron/`).
 *   2. Poll http://localhost:3000 until the dashboard responds.
 *   3. Open a dark BrowserWindow pointing at the dashboard URL.
 *   4. On quit, tear down the spawned Next.js process tree.
 *
 * The Electron app does NOT bundle the Next.js app — it always runs it from the
 * adjacent directory. This keeps the launcher tiny and lets the user update the
 * dashboard code without rebuilding the .exe.
 */

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = 3000;
const DASHBOARD_URL = `http://localhost:${PORT}`;
/** The Next.js project lives in the directory above this `electron/` folder. */
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WINDOW_TITLE = 'LostCity Launcher';
const WINDOW_BG = '#0a0a0a';

const SERVER_READY_TIMEOUT_MS = 180_000;  // allow time for `bun install` + next dev
const SERVER_QUICK_CHECK_MS = 4_000;      // short probe to detect an already-running server
const POLL_INTERVAL_MS = 1_500;

let mainWindow = null;
let nextProcess = null;
/** True iff WE started the Next.js server (and therefore own its lifecycle). */
let serverWasStartedByUs = false;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort check whether a binary is on PATH. */
function commandExists(cmd) {
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(lookup, [cmd], { stdio: 'ignore' });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

/** Pick the best runner for `next dev`. Prefer bun, then npm, then npx. */
function pickRunner() {
  if (commandExists('bun')) return { cmd: 'bun', args: ['run', 'dev'] };
  if (commandExists('npm')) return { cmd: 'npm', args: ['run', 'dev'] };
  if (commandExists('npx')) return { cmd: 'npx', args: ['next', 'dev', '-p', String(PORT)] };
  return null;
}

/**
 * Poll an HTTP URL until it returns a 2xx/3xx status, or the timeout lapses.
 * Resolves true on success, false on timeout.
 */
function waitForServer(url, { timeoutMs = SERVER_READY_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    function checkAgain() {
      if (Date.now() - startedAt >= timeoutMs) return resolve(false);
      setTimeout(attempt, intervalMs);
    }
    function attempt() {
      const req = http.get(url, (res) => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
        res.resume();
        if (ok) resolve(true); else checkAgain();
      });
      req.on('error', () => checkAgain());
      req.setTimeout(3_000, () => { req.destroy(); checkAgain(); });
    }
    attempt();
  });
}

/**
 * Ensure the dashboard is reachable on :3000. If something is already
 * listening, just connect to it. Otherwise spawn `bun run dev` (or a fallback)
 * in PROJECT_ROOT and wait for it to come online.
 */
async function ensureServer() {
  // Quick probe: is something already serving on :3000?
  const alreadyUp = await waitForServer(DASHBOARD_URL, {
    timeoutMs: SERVER_QUICK_CHECK_MS,
    intervalMs: 500,
  });
  if (alreadyUp) {
    serverWasStartedByUs = false;
    console.log('[LostCity Launcher] Dashboard already running on :3000 — connecting.');
    return;
  }

  serverWasStartedByUs = true;
  const runner = pickRunner();
  if (!runner) {
    throw new Error(
      'Neither bun, npm, nor npx found on PATH. Install one of them to launch the dashboard.'
    );
  }

  console.log(
    `[LostCity Launcher] Starting Next.js dev server in "${PROJECT_ROOT}" ` +
    `via ${runner.cmd} ${runner.args.join(' ')} ...`
  );

  const useShell = process.platform === 'win32';
  nextProcess = spawn(runner.cmd, runner.args, {
    cwd: PROJECT_ROOT,
    shell: useShell,
    // On Unix, create a new process group so we can kill the whole tree.
    detached: !useShell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nextProcess.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`));
  nextProcess.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`));
  nextProcess.on('error', (err) => {
    console.error('[LostCity Launcher] Failed to spawn Next.js:', err);
  });
  nextProcess.on('exit', (code, signal) => {
    if (!isQuitting) {
      console.log(`[LostCity Launcher] Next.js exited (code=${code} signal=${signal}).`);
    }
  });

  console.log('[LostCity Launcher] Waiting for dashboard to come online ...');
  const up = await waitForServer(DASHBOARD_URL, { timeoutMs: SERVER_READY_TIMEOUT_MS });
  if (!up) {
    // Best-effort cleanup before throwing.
    killProcessTree(nextProcess);
    nextProcess = null;
    throw new Error(
      `Dashboard did not come online within ${SERVER_READY_TIMEOUT_MS / 1000}s. ` +
      `Check that "bun run dev" works in ${PROJECT_ROOT}.`
    );
  }
  console.log('[LostCity Launcher] Dashboard is online.');
}

/**
 * Kill the spawned Next.js process tree (including grandchildren).
 * - Windows: `taskkill /F /T /PID` walks the tree.
 * - Unix:    we spawned with detached:true, so the child is a process-group
 *            leader; killing -<pid> kills the whole group.
 */
function killProcessTree(proc) {
  if (!proc || proc.pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    } else {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) { /* already gone */ }
      // Escalate to SIGKILL after a short grace period.
      setTimeout(() => {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) { /* already gone */ }
      }, 2_500);
    }
  } catch (_) {
    try { proc.kill('SIGKILL'); } catch (__) { /* already gone */ }
  }
}

function cleanupServer() {
  if (!serverWasStartedByUs || !nextProcess) return;
  console.log('[LostCity Launcher] Cleaning up Next.js process tree ...');
  killProcessTree(nextProcess);
  nextProcess = null;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: WINDOW_TITLE,
    backgroundColor: WINDOW_BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(DASHBOARD_URL);

  // Force the window title to stay "LostCity Launcher" even if the loaded
  // page tries to set its own <title>.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // Open external links (http/https outside localhost) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.setName(WINDOW_TITLE);

app.whenReady().then(async () => {
  try {
    await ensureServer();
  } catch (err) {
    dialog.showErrorBox(
      'LostCity Launcher — startup failed',
      err && err.message ? err.message : String(err)
    );
    app.quit();
    return;
  }
  createWindow();

  // macOS: re-create the window when the dock icon is clicked and no windows
  // are open. The dashboard server stays running across window toggles.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // The launcher is useless without a window, so quit on every platform
  // (including macOS) and tear down the dev server.
  isQuitting = true;
  cleanupServer();
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  cleanupServer();
});

app.on('will-quit', () => {
  isQuitting = true;
  cleanupServer();
});

// Last-resort synchronous cleanup if the process is killed hard.
process.on('exit', () => {
  if (nextProcess && nextProcess.pid != null && process.platform === 'win32') {
    try { spawnSync('taskkill', ['/F', '/T', '/PID', String(nextProcess.pid)], { stdio: 'ignore' }); }
    catch (_) { /* ignore */ }
  }
});
