# LostCity Launcher (Electron wrapper)

This folder contains the **standalone Electron app** that wraps the LostCity
dashboard (the Next.js app in the project root) into a single double-clickable
desktop program — no browser, no terminal, no `bun run dev` to remember.

```
/home/z/my-project/            ← Next.js dashboard (project root)
├── package.json               ← "dev": "next dev -p 3000"
├── src/...
└── electron/                  ← this folder
    ├── package.json           ← Electron-only package + build config
    ├── main.js                ← Electron main process
    ├── preload.js             ← minimal renderer bridge
    ├── README.md              ← this file
    └── icon.png               ← (you supply) app icon — see below
```

## How it works

1. On launch, `main.js` checks whether something is already serving
   `http://localhost:3000`.
2. If not, it spawns `bun run dev` (falling back to `npm run dev`, then
   `npx next dev -p 3000`) in the **parent directory** (the project root).
3. It polls `http://localhost:3000` until the dashboard responds.
4. A dark `BrowserWindow` (1200×800, `#0a0a0a` background, title
   "LostCity Launcher") opens and loads the dashboard URL.
5. When the user closes the window, `main.js` kills the whole Next.js
   process tree (using `taskkill /F /T` on Windows, or `kill -<pgrp>` on
   Unix).

The Electron app **does not bundle the Next.js app**. It always runs it from
the adjacent directory. This keeps the `.exe` tiny (~100 MB for Electron
itself) and lets you patch the dashboard code without rebuilding the
launcher.

## Prerequisites

| Tool         | Why                                           | Notes                              |
|--------------|-----------------------------------------------|------------------------------------|
| Node.js ≥ 18 | Required by Electron + electron-builder       |                                    |
| `bun`        | Preferred runner for `bun run dev`            | Falls back to `npm` / `npx`        |
| `npm`        | Used to install Electron locally              | `bun` works too                    |
| ~1 GB disk   | Electron + electron-builder binaries          | First build downloads Electron     |

The Next.js project itself must already be installed (i.e. `node_modules/`
present in the project root). The launcher does **not** run `bun install`
for you.

## Dev mode (run the Electron shell locally)

```bash
cd /home/z/my-project/electron
npm install                 # installs electron + electron-builder (~250 MB)
npm start                   # runs `electron .`
```

`npm start` launches the Electron app, which in turn spawns the dashboard
in the parent directory. Watch the terminal you started it from — you'll
see `[next] ...` lines from the Next.js dev server, prefixed for clarity.

> Tip: If you want to start the dashboard separately (e.g. to use the
> Next.js dev overlay), run `bun run dev` in the project root first. The
> Electron app will detect the running server and skip its own spawn —
> just connect to it.

## Building a standalone release

### 1. Supply an icon

Place a `icon.png` (minimum 512×512, ideally 1024×1024, PNG with alpha)
in this folder. electron-builder uses it to generate `.ico` (Windows) and
the AppImage icon (Linux). If you omit it, the build will fail.

### 2. Build the installer

All commands run from this `electron/` folder:

```bash
# Windows .exe installer (NSIS) — run on Windows or via Wine
npm run build-win

# Linux AppImage — run on Linux
npm run build-linux

# Both (cross-build — requires wine + mono on Linux for the Windows target)
npm run build
```

Output lands in `electron/dist/`:

```
electron/dist/
├── LostCity Launcher Setup 0.1.0.exe     ← Windows NSIS installer
├── LostCity Launcher-0.1.0.AppImage       ← Linux AppImage
└── builder-effective-config.yaml
```

### 3. Install alongside the game

The NSIS installer is configured with `oneClick: false` and
`allowToChangeInstallationDirectory: true`, so the user can pick the
install folder. Recommended layout:

```
C:\LostCity\
├── LostCity Launcher.exe        ← installed by the NSIS installer
├── resources\app\main.js        ← Electron app code (bundled)
├── lostcity\                    ← game files (engine, client, content)
└── dashboard\                   ← the Next.js project (from /home/z/my-project)
    ├── package.json
    ├── src\
    └── node_modules\
```

For `main.js` to find the dashboard, the dashboard project must live in
the directory **directly above** wherever `LostCity Launcher.exe` ends up.
So if the launcher is at `C:\LostCity\LostCity Launcher.exe`, the
dashboard project must be at `C:\LostCity\dashboard\` — i.e. you should
either:

- Copy the entire `/home/z/my-project` folder (minus `electron/`,
  `.next/`, screenshots, etc.) into the install dir as `dashboard\`, **or**
- Edit `PROJECT_ROOT` in `main.js` to point somewhere else (e.g. an
  environment variable, or `path.join(app.getPath('exe'), '..', 'dashboard')`),
  rebuild, and re-package.

For the AppImage release on Linux, the same adjacency rule applies —
extract the AppImage into a folder that also contains the dashboard
project as a sibling directory.

## Configuration knobs (in `main.js`)

| Constant                  | Default | Meaning                                             |
|---------------------------|---------|-----------------------------------------------------|
| `PORT`                    | `3000`  | Port the dashboard is served on                     |
| `DASHBOARD_URL`           | derived | Full URL the window loads                           |
| `PROJECT_ROOT`            | `..`    | Where to spawn `bun run dev`                        |
| `WINDOW_TITLE`            | string  | BrowserWindow + app name                            |
| `WINDOW_BG`               | `#0a0a0a` | Window background before page loads               |
| `SERVER_READY_TIMEOUT_MS` | `180000`| How long to wait for the dashboard to come online  |

## Troubleshooting

- **"Dashboard did not come online within 180s"** — Check the `[next] ...`
  output in the terminal. Most likely `bun install` was never run in the
  project root, or port 3000 is already taken by a non-dashboard process.
- **Window opens but is blank** — Open DevTools with `Ctrl+Shift+I`
  (or `Cmd+Option+I` on macOS) and inspect the console. The dashboard
  URL may have changed, or the Next.js server may have crashed after
  coming up.
- **Build fails with "icon.png not found"** — Drop a `icon.png` into
  this folder (see step 1 above).
- **AppImage won't run on Linux** — `chmod +x "LostCity Launcher-0.1.0.AppImage"`
  and try again. AppImages need to be executable.
- **Windows: dashboard doesn't shut down when closing the window** —
  Make sure you're not running the launcher as a different user than the
  one that spawned `bun`. `taskkill /T` only kills processes owned by
  the same user.

## Files in this folder

| File           | Purpose                                                          |
|----------------|------------------------------------------------------------------|
| `package.json` | Electron-only package + electron-builder config (NSIS/AppImage)  |
| `main.js`      | Electron main process: spawn server, open window, clean up       |
| `preload.js`   | Tiny `contextBridge` exposing `window.lostcityLauncher` to the UI |
| `README.md`    | This file                                                        |
| `icon.png`     | (you supply) app icon for the installer                          |

## What this folder does NOT contain

- The Next.js app itself — that lives in the project root and is run
  live by the Electron shell.
- Electron / electron-builder binaries — install them with `npm install`
  inside this folder before building.
- A bundled `node_modules/` for the dashboard — install with
  `bun install` in the project root.
