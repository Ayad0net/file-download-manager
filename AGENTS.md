# Agent Guide

Download Manager: a download manager with HTTP (multi-connection) and BitTorrent support.
It runs as a web app (Bun + Hono backend serving the frontend, also in Docker) and as a
cross-platform desktop app (Tauri v2 shell with the same backend compiled into a sidecar).

## Versioning: required after every change

Every change you make must end with a version bump. Pick the level by the most significant
part of the change:

| Level   | Use for                                                                 | Example                       |
|---------|-------------------------------------------------------------------------|-------------------------------|
| `patch` | **Hotfix**: bug fix, no new behaviour                                   | 1.4.2 → 1.4.3                 |
| `minor` | New feature or visible improvement that keeps existing data and APIs working | 1.4.2 → 1.5.0          |
| `major` | Breaking change: incompatible DB/data format, removed feature, changed API contract | 1.4.2 → 2.0.0   |

Run exactly one bump per change set, after the change is done and verified:

```sh
bun run version:bump <patch|minor|major> "One-line description of what changed"
```

This updates every place the version lives and prepends an entry to `CHANGELOG.md`:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `frontend/src/components/header.js` (`APP_VERSION`, shown in the app header)
- `extension/manifest.json` (browser extension)

Never edit these version strings by hand; if you add a new place that shows the version,
add it to `scripts/bump-version.ts` and to the list above.

## Project layout

- `backend/src/` Bun + Hono API. `services/queue-manager.ts` owns the queue and DB state;
  `download-engine.ts` (single connection), `segmented-download.ts` (multi-connection),
  `torrent-manager.ts` (WebTorrent). DB is sql.js persisted to `DATA_DIR/downloads.db`;
  new columns are added by the migration block in `database/db.ts`.
- `frontend/` Vanilla JS ES modules, no build step. Served by the backend (web) and loaded
  directly by Tauri (`frontendDist`). Desktop-only code checks `window.__TAURI__`.
- `src-tauri/` Tauri shell: starts the backend sidecar, tray, file associations, autostart.
- `stubs/webrtc-polyfill` disables native WebRTC so the backend compiles to one binary.
- `extension/` browser extension (Manifest V3, one codebase for Chrome/Edge/Brave/Opera and
  Firefox). Talks to the backend's HTTP API; caught downloads
  wait in the app for confirmation (`routes/browser.ts`, `services/browser-requests.ts`). The app
  serves the extension with its address (`app.json`) from Settings > Browser (Tauri bundles
  `extension/` as a resource). `bun run extension:build` zips it into `dist/`.
- `design/` icon render scripts (Pillow). Re-run them instead of editing PNGs by hand.

## Checks before finishing

```sh
bun run typecheck                 # backend TypeScript
node --check <changed .js files>  # frontend syntax
cd src-tauri && cargo build       # if Rust or tauri.conf.json changed
```

Test behaviour against a running backend when you touch download logic
(`PORT=… DATA_DIR=… DOWNLOAD_PATH=… bun backend/src/index.ts`), not just types.

## Releasing

`.github/workflows/release.yml` builds macOS (Apple Silicon + Intel), Windows x64 and
Linux x64/ARM64 installers and attaches them to a **draft** GitHub Release. To release:

```sh
bun run version:bump minor "…"   # if not already bumped
git commit -am "Release vX.Y.Z"
git tag vX.Y.Z && git push && git push --tags
```

The tag must equal the `package.json` version or the workflow fails. Review the draft on
GitHub, then publish it. Builds are unsigned (macOS Gatekeeper / Windows SmartScreen warn);
add signing secrets to the workflow when certificates are available.
