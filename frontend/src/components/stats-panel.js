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
  `;
}

store.subscribe(() => {
  const container = document.getElementById('stats-panel');
  if (container) renderStatsPanel(container);
});
