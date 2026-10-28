import { API_BASE } from './api.js';
import { store } from '../state/store.js';

// Desktop app: .torrent files opened from Finder / Explorer / file managers are queued by
// the Rust side (see src-tauri/src/main.rs) and added here once the backend is reachable.
const tauri = window.__TAURI__;

let retry = [];
let draining = false;
let firstDrainDone = false;

function reportAdded(result) {
  const added = result.downloads || [];
  if (added.length === 1) window.showToast?.(`Added torrent: ${added[0].filename}`, 'success');
  else if (added.length > 1) window.showToast?.(`Added ${added.length} torrents`, 'success');
  for (const err of result.details || result.errors || []) window.showToast?.(`Couldn't add ${err}`, 'error');
}

/** Desktop only: adds local .torrent files by path. Throws if the backend is unreachable. */
export async function addTorrentPaths(paths) {
  const res = await fetch(`${API_BASE}/downloads/torrent-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  reportAdded(await res.json());
}

export { reportAdded };

async function drain() {
  if (draining || !store.loaded) return;
  draining = true;
  try {
    const paths = retry.concat(await tauri.core.invoke('take_pending_torrents'));
    retry = [];
    firstDrainDone = true;
    if (paths.length === 0) return;
    try {
      await addTorrentPaths(paths);
    } catch {
      retry = paths; // backend briefly unavailable: try again on the next update
    }
  } finally {
    draining = false;
  }
}

export function initDesktopOpen() {
  if (!tauri?.core || !tauri?.event) return;
  tauri.event.listen('torrents-opened', drain);
  // Cold start: files arrive before the backend is up, so wait for the first successful load.
  store.subscribe(() => {
    if (store.loaded && (!firstDrainDone || retry.length > 0)) drain();
  });
}
