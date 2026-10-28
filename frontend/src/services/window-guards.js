import { addTorrentFiles } from './api.js';
import { addTorrentPaths, reportAdded } from './desktop-open.js';

// Keeps the app feeling like a native window: no page zoom, and files dropped on the
// window are added as torrents instead of making the webview open them.

const tauri = window.__TAURI__;
const isTorrent = (name) => /\.torrent$/i.test(name);

function preventZoom() {
  // Chromium / WebView2: trackpad pinch arrives as ctrl+wheel.
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  // WebKit (macOS webview, Safari): pinch arrives as gesture events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  // Keyboard zoom: Cmd/Ctrl with + - = 0.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && ['+', '-', '=', '0', '_'].includes(e.key)) e.preventDefault();
  });
}

let overlay = null;

function showOverlay(show) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.innerHTML = '<div class="drop-overlay-card"><i class="fas fa-magnet"></i><strong>Drop .torrent files to add them</strong></div>';
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('visible', show);
}

function rejectOthers(names) {
  if (names.length) window.showToast?.(`Only .torrent files can be dropped here (${names.length} skipped)`, 'warning');
}

async function handlePaths(paths) {
  const torrents = paths.filter(isTorrent);
  rejectOthers(paths.filter(p => !isTorrent(p)));
  if (!torrents.length) return;
  try {
    await addTorrentPaths(torrents);
  } catch {
    window.showToast?.("Couldn't add torrents: app backend isn't ready yet", 'error');
  }
}

async function handleFiles(files) {
  const torrents = files.filter(f => isTorrent(f.name));
  rejectOthers(files.filter(f => !isTorrent(f.name)));
  if (!torrents.length) return;
  try {
    reportAdded(await addTorrentFiles(torrents));
  } catch (err) {
    window.showToast?.(err.message || "Couldn't add torrents", 'error');
  }
}

function setupDrop() {
  if (tauri?.event) {
    // Desktop: Tauri takes over native file drops and reports paths (HTML drop events don't get files).
    tauri.event.listen('tauri://drag-enter', () => showOverlay(true));
    tauri.event.listen('tauri://drag-leave', () => showOverlay(false));
    tauri.event.listen('tauri://drag-drop', (e) => {
      showOverlay(false);
      handlePaths(e.payload?.paths || []);
    });
  }

  // Never let the webview/browser navigate to a dropped file.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!tauri && ++depth === 1) showOverlay(true);
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (!tauri && --depth <= 0) { depth = 0; showOverlay(false); }
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    showOverlay(false);
    // Desktop drops are handled by the Tauri event above; the Add dialog's drop zone handles its own.
    if (tauri || e.target.closest?.('.torrent-drop')) return;
    handleFiles([...e.dataTransfer.files]);
  });
}

export function initWindowGuards() {
  preventZoom();
  setupDrop();
}
