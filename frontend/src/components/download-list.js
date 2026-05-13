import { pauseDownload, resumeDownload, stopDownload, retryDownload, deleteDownload } from '../services/api.js';
import { store } from '../state/store.js';

export function renderDownloadList(container) {
  const downloads = store.getFilteredDownloads();

  if (downloads.length === 0) {
    container.innerHTML = `
      <div class="download-empty">
        <i class="fas fa-download"></i>
        <h3>No downloads yet</h3>
        <p style="color:var(--text-muted);font-size:0.9rem">Add a URL to get started</p>
      </div>
    `;
    return;
  }

  container.innerHTML = downloads.map(d => renderDownloadItem(d)).join('');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
  return formatBytes(bytesPerSec) + '/s';
}

function formatTime(seconds) {
  if (!seconds || seconds === Infinity) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getStatusIcon(status) {
  const icons = {
    queued: 'fa-clock',
    connecting: 'fa-plug',
    downloading: 'fa-arrow-down',
    paused: 'fa-pause',
    completed: 'fa-circle-check',
    failed: 'fa-circle-xmark',
    stopped: 'fa-stop',
    retrying: 'fa-rotate-right',
  };
  return icons[status] || 'fa-question';
}

function renderDownloadItem(d) {
  const progress = d.progress || 0;
  const status = d.status;
  const isActive = status === 'downloading' || status === 'connecting';

  const actions = [];
  if (isActive) {
    actions.push(`<button class="btn btn-sm btn-icon action-pause" data-id="${d.id}" title="Pause"><i class="fas fa-pause"></i></button>`);
  } else if (status === 'paused') {
    actions.push(`<button class="btn btn-sm btn-icon action-resume" data-id="${d.id}" title="Resume"><i class="fas fa-play"></i></button>`);
    actions.push(`<button class="btn btn-sm btn-icon action-stop" data-id="${d.id}" title="Stop"><i class="fas fa-stop"></i></button>`);
  } else if (status === 'queued') {
    actions.push(`<button class="btn btn-sm btn-icon action-pause" data-id="${d.id}" title="Pause"><i class="fas fa-pause"></i></button>`);
  } else if (status === 'failed' || status === 'stopped') {
    actions.push(`<button class="btn btn-sm btn-icon action-retry" data-id="${d.id}" title="Retry"><i class="fas fa-rotate-right"></i></button>`);
  }
  if (status !== 'downloading' && status !== 'connecting') {
    actions.push(`<button class="btn btn-sm btn-icon btn-danger-ghost action-delete" data-id="${d.id}" title="Delete"><i class="fas fa-trash"></i></button>`);
  }

  const progressClass = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : '';

  return `
    <div class="download-item" data-id="${d.id}" draggable="true">
      <div class="download-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <div class="download-icon status-${status}">
          <i class="fas ${getStatusIcon(status)}"></i>
        </div>
        <div class="download-info">
          <div class="download-filename">${escapeHtml(d.filename)}</div>
          <div class="download-url">${escapeHtml(d.url)}</div>
        </div>
        <span class="download-status-badge badge-${status}">${status}</span>
      </div>
      <div class="download-progress-area">
        <div class="progress-bar-container">
          <div class="progress-bar ${progressClass}" style="width: ${Math.min(progress, 100)}%"></div>
        </div>
        <div class="download-meta">
          <span><i class="fas fa-file"></i> ${formatBytes(d.downloadedBytes)} / ${formatBytes(d.totalBytes)}</span>
          <span><i class="fas fa-gauge-high"></i> ${formatSpeed(d.speed)}</span>
          <span><i class="fas fa-clock"></i> ${formatTime(d.remainingTime)} left</span>
          <span><i class="fas fa-percentage"></i> ${Math.round(progress)}%</span>
          <div class="download-actions">
            ${actions.join('')}
          </div>
        </div>
        ${d.errorMessage ? `<div class="download-error"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(d.errorMessage)}</div>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

store.subscribe(() => {
  const container = document.getElementById('download-list');
  if (container) renderDownloadList(container);
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;

  const id = btn.dataset.id;

  if (btn.classList.contains('action-pause')) {
    e.stopPropagation();
    await pauseDownload(id);
  } else if (btn.classList.contains('action-resume')) {
    e.stopPropagation();
    await resumeDownload(id);
  } else if (btn.classList.contains('action-stop')) {
    e.stopPropagation();
    await stopDownload(id);
  } else if (btn.classList.contains('action-retry')) {
    e.stopPropagation();
    await retryDownload(id);
  } else if (btn.classList.contains('action-delete')) {
    e.stopPropagation();
    if (confirm('Delete this download entry?')) {
      await deleteDownload(id);
    }
  }
});

let dragSrcId = null;

document.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.download-item');
  if (!item) return;
  dragSrcId = item.dataset.id;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

document.addEventListener('dragend', (e) => {
  const item = e.target.closest('.download-item');
  if (item) item.classList.remove('dragging');
  document.querySelectorAll('.download-item').forEach(el => el.classList.remove('drag-over'));
});

document.addEventListener('dragover', (e) => {
  const item = e.target.closest('.download-item');
  if (!item || item.dataset.id === dragSrcId) return;
  e.preventDefault();
  item.classList.add('drag-over');
});

document.addEventListener('dragleave', (e) => {
  const item = e.target.closest('.download-item');
  if (item) item.classList.remove('drag-over');
});

document.addEventListener('drop', async (e) => {
  const item = e.target.closest('.download-item');
  if (!item || !dragSrcId || item.dataset.id === dragSrcId) return;
  e.preventDefault();
  item.classList.remove('drag-over');

  const allItems = [...document.querySelectorAll('.download-item')];
  const ids = allItems.map(el => el.dataset.id);
  const fromIdx = ids.indexOf(dragSrcId);
  const toIdx = ids.indexOf(item.dataset.id);

  if (fromIdx === -1 || toIdx === -1) return;
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, dragSrcId);

  const { reorderDownloads } = await import('../services/api.js');
  await reorderDownloads(ids);
});
