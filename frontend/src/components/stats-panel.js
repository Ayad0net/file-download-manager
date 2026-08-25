import { store } from '../state/store.js';

export function renderStatsPanel(container) {
  const { stats } = store;
  container.innerHTML = `
    <div class="stat-card stat-active">
      <div class="stat-value">${stats.active || 0}</div>
      <div class="stat-label"><i class="fas fa-arrow-down"></i> Downloading</div>
    </div>
    <div class="stat-card stat-queued">
      <div class="stat-value">${stats.queued || 0}</div>
      <div class="stat-label"><i class="fas fa-clock"></i> Queued</div>
    </div>
    <div class="stat-card stat-completed">
      <div class="stat-value">${stats.completed || 0}</div>
      <div class="stat-label"><i class="fas fa-circle-check"></i> Completed</div>
    </div>
    <div class="stat-card stat-failed">
      <div class="stat-value">${stats.failed || 0}</div>
      <div class="stat-label"><i class="fas fa-circle-xmark"></i> Failed</div>
    </div>
    <div class="stat-card stat-paused">
      <div class="stat-value">${stats.paused || 0}</div>
      <div class="stat-label"><i class="fas fa-pause"></i> Paused</div>
    </div>
    <div class="stat-card stat-storage">
      <div class="stat-value">${formatBytes(stats.totalDownloadedBytes)} <span class="stat-div">/</span> ${stats.freeDiskBytes != null ? formatBytes(stats.freeDiskBytes) : '--'}</div>
      <div class="stat-label"><i class="fas fa-hard-drive"></i> Downloaded / Free Space</div>
    </div>
  `;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

store.subscribe(() => {
  const container = document.getElementById('stats-panel');
  if (container) renderStatsPanel(container);
});
