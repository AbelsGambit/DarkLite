'use strict';

/**
 * LostCity Launcher — Electron preload.
 *
 * Runs in an isolated context with access to Node/Electron APIs, and exposes
 * a tiny, safe surface to the renderer (the dashboard's React code).
 *
 * The dashboard currently drives the launcher entirely through its own
 * Next.js API (`/api/launcher`, `/api/player-preferences`, etc.), so this
 * preload is intentionally minimal — it just announces that we're running
 * inside Electron and the host platform, for any UI that wants to detect it.
 *
 * If you later want the dashboard to call Electron directly (e.g. to read a
 * file from disk, show a native save dialog, or quit the app), add the
 * `ipcRenderer.invoke` / `ipcRenderer.on` channels here and register the
 * matching `ipcMain.handle` / `ipcMain.on` listeners in main.js.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('lostcityLauncher', {
  /** true iff the dashboard is currently running inside the Electron shell. */
  isElectron: true,
  /** Launcher version — mirrors electron/package.json. */
  version: '0.1.0',
  /** Host OS: 'win32' | 'darwin' | 'linux'. */
  platform: process.platform,
  /** Dashboard URL the window is pointing at. */
  dashboardUrl: 'http://localhost:3000',
});
