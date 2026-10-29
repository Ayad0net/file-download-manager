import { store } from '../state/store.js';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function renderStatusBar(container) {
  const { stats } = store;
  const limit = store.globalSpeedLimit ? `${formatBytes(store.globalSpeedLimit)}/s` : 'Off';
  container.innerHTML = `
    <span class="sb-speed"><i class="fas fa-arrow-down"></i> ${formatBytes(store.totalSpeed())}/s</span>
    <span>${stats.active || 0} active · ${stats.queued || 0} queued</span>
    <span>${stats.completed || 0} completed${stats.failed ? ` · <span class="sb-failed">${stats.failed} failed</span>` : ''}</span>
    <span class="sb-spacer"></span>
    <span><i class="fas fa-gauge"></i> Limit <strong>${limit}</strong></span>
    <span><i class="fas fa-hard-drive"></i> <strong>${stats.freeDiskBytes != null ? formatBytes(stats.freeDiskBytes) : '—'}</strong> free</span>
    <span class="${store.browser?.connected ? 'sb-ok' : ''}" title="${store.browser?.connected ? 'The browser extension is connected' : 'Install the browser extension to send downloads from your browser'}"><i class="fas fa-puzzle-piece"></i> ${store.browser?.connected ? `${store.browser.name} connected` : 'No browser'}</span>
    <span>${store.maxConcurrent} at once · ${store.connectionsPerDownload} connections</span>
  `;
}

store.subscribe(() => {
  const container = document.getElementById('statusbar');
  if (container) renderStatusBar(container);
});
