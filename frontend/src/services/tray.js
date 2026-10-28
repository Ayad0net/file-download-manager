import { pauseAll, resumeAll } from './api.js';
import { store } from '../state/store.js';

// Desktop app: handles tray menu actions and keeps the tray tooltip showing live status.
// The page keeps running while the window is hidden in the tray.
const tauri = window.__TAURI__;

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytesPerSec) / Math.log(1024)));
  return (bytesPerSec / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function statusText() {
  const active = store.downloads.filter(d => d.status === 'downloading' || d.status === 'connecting');
  if (active.length === 0) {
    const queued = store.downloads.filter(d => d.status === 'queued').length;
    return queued ? `${queued} queued` : 'Idle';
  }
  const speed = active.reduce((sum, d) => sum + (d.speed || 0), 0);
  return `${active.length} active · ${formatSpeed(speed)}`;
}

export function initTray() {
  if (!tauri?.core || !tauri?.event) return;

  tauri.event.listen('tray-action', async (e) => {
    try {
      if (e.payload === 'pause-all') {
        await pauseAll();
        window.showToast?.('All active downloads paused', 'info');
      } else if (e.payload === 'resume-all') {
        await resumeAll();
        window.showToast?.('All paused downloads resumed', 'success');
      }
    } catch (err) {
      window.showToast?.(err.message || 'Tray action failed', 'error');
    }
  });

  let last = '';
  store.subscribe(() => {
    if (!store.loaded) return;
    const text = statusText();
    if (text === last) return;
    last = text;
    tauri.core.invoke('set_tray_status', { text }).catch(() => {});
  });
}
