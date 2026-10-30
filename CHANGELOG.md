# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).

## 1.13.1 — 2026-10-30 (Hotfix)

- Launch at login starts in the tray only, without a Dock icon or taskbar button

## 1.13.0 — 2026-10-30 (Minor)

- Setting to hide the app from the Dock/taskbar when closed to the tray

## 1.12.2 — 2026-10-29 (Hotfix)

- macOS: panel corners match the window's rounded corner

## 1.12.1 — 2026-10-29 (Hotfix)

- Desktop window background follows the theme (no dark ring at the corners in light mode)

## 1.12.0 — 2026-10-29 (Minor)

- Guided extension install: detects browsers, pops up on first start, waits until the extension connects

## 1.11.1 — 2026-10-29 (Hotfix)

- Disable text selection across the app UI (inputs stay selectable)

## 1.11.0 — 2026-10-29 (Minor)

- Extension catches clicks on file links in pages and sends them to the app before the browser handles them

## 1.10.2 — 2026-10-29 (Hotfix)

- Extension catches http downloads the browser blocks on https pages; fix Forbidden when confirming in tauri dev

## 1.10.1 — 2026-10-29 (Hotfix)

- Browser downloads now bring the desktop app forward to confirm, even when it is hidden in the tray or on another desktop; the desktop backend exits with the app instead of lingering

## 1.10.0 — 2026-10-28 (Minor)

- Removed the pairing key; browser's own download and Save-as dialog are cancelled before they start when the app takes a file

## 1.9.0 — 2026-10-28 (Minor)

- Pairing key between app and extension; every browser download opens a confirm dialog in the app; get the pre-paired extension from Settings > Browser

## 1.8.0 — 2026-10-28 (Minor)

- Extension captures ~200 file types (video, audio, images, documents, apps, archives, disk images); new Disk images category in the app

## 1.7.0 — 2026-10-28 (Minor)

- Browser extension (Chrome, Edge, Brave, Opera, Firefox): captures downloads, right-click menu, YouTube/TikTok quality picker; app shows browser connection

## 1.6.1 — 2026-10-28 (Hotfix)

- macOS: move window buttons inside the sidebar card so they no longer overlap its edge

## 1.6.0 — 2026-10-28 (Minor)

- Redesigned UI: floating sidebar with categories and live speed graph, search, status chips, new table and status bar

## 1.5.1 — 2026-10-28 (Hotfix)

- Release: skip AppImage on Linux ARM64 (linuxdeploy fails there); ship .deb and .rpm

## 1.5.0 — 2026-10-28 (Minor)

- YouTube video/playlist and TikTok downloader (via yt-dlp) with resolution picker

## 1.4.1 — 2026-10-28 (Hotfix)

- Fix Linux ARM64 AppImage bundling in the release workflow

## 1.4.0 — 2026-10-28 (Minor)

- GitHub release workflow for macOS, Windows and Linux; cross-platform build scripts

## 1.3.0 — 2026-10-28 (Minor)

- Header logo now uses the app icon mark (inline SVG, follows accent color)

## 1.2.0 — 2026-10-28 (Minor)

- Redesigned Settings: sidebar sections, steppers, segmented theme switch, accent swatches, unsaved-changes guard

## 1.1.0 — 2026-10-28 (Minor)

- Larger sectioned Settings, simpler tray icon, themed scrollbars and native controls, skeleton app shell with flash-free window reveal, AGENTS.md versioning rules
