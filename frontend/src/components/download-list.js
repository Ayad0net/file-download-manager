import { API_BASE, pauseDownload, resumeDownload, stopDownload, retryDownload } from '../services/api.js';
import { store, CATEGORIES, categoryOf } from '../state/store.js';
import { openContextMenu } from './context-menu.js';

const opener = window.__TAURI__?.opener;
// Torrents whose file panel is open; kept across re-renders.
const expandedFiles = new Set();

export function renderDownloadList(container) {
  const downloads = store.getFilteredDownloads();
  container.classList.toggle('view-cards', store.view === 'cards');
  container.classList.toggle('view-table', store.view === 'table');

  if (!store.loaded) {
    // Placeholder rows shaped like real items, so the layout doesn't jump when data arrives.
    const row = `
      <div class="download-item skeleton-item" aria-hidden="true">
        <div class="download-item-header">
          <span class="skeleton" style="width:36px;height:36px;border-radius:var(--radius)"></span>
          <div class="download-info">
            <span class="skeleton" style="width:45%;height:12px"></span>
            <span class="skeleton" style="width:70%;height:10px;margin-top:8px"></span>
          </div>
        </div>
        <span class="skeleton" style="width:100%;height:6px;margin-top:6px"></span>
      </div>`;
    container.innerHTML = `<div aria-busy="true" aria-label="Loading downloads">${row.repeat(4)}</div>`;
    return;
  }

  if (downloads.length === 0) {
    container.innerHTML = `
      <div class="download-empty">
        <i class="fas fa-download"></i>
        <h3>${store.downloads.length ? 'Nothing here' : 'No downloads yet'}</h3>
        <p style="color:var(--text-muted);font-size:0.9rem">${store.downloads.length ? 'No downloads match this view' : 'Add a URL to get started'}</p>
      </div>
    `;
    return;
  }

  if (store.view === 'table') {
    const sorted = sortDownloads(downloads, store.sort);
    // Manual drag-reordering only makes sense in queue order.
    const draggable = !store.sort;
    container.innerHTML = `
      <table class="download-table-view${draggable ? '' : ' is-sorted'}">
        <thead>
          <tr>
            ${TABLE_COLUMNS.map(c => renderHeaderCell(c)).join('')}
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>${sorted.map(d => renderDownloadRow(d, draggable)).join('')}</tbody>
      </table>
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

function renderActions(d) {
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
  } else if (status === 'completed' && !(d.kind === 'torrent' && (d.torrentFiles?.length || 0) > 1)) {
    actions.push(`<a class="btn btn-sm btn-icon action-save" href="${API_BASE}/downloads/${d.id}/file" download title="Save to PC"><i class="fas fa-download"></i></a>`);
  }
  if (status !== 'downloading' && status !== 'connecting') {
    actions.push(`<button class="btn btn-sm btn-icon btn-danger-soft action-delete" data-id="${d.id}" title="Delete"><i class="fas fa-trash"></i></button>`);
  }
  return actions.join('');
}

function renderProgressBar(d) {
  const progress = d.progress || 0;
  const status = d.status;
  const isActive = status === 'downloading' || status === 'connecting';
  const progressClass = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : '';
  // Server sent no Content-Length: size unknown, so show an animated bar instead of a stuck 0%.
  const indeterminate = isActive && !d.totalBytes;
  // The list re-renders on every poll; a negative delay keeps the animation phase continuous across re-renders.
  const barStyle = indeterminate
    ? `animation-delay: -${(Date.now() % 1500) / 1000}s`
    : `width: ${Math.min(progress, 100)}%`;
  const parts = getParts(d);
  if (parts) {
    return { indeterminate: false, parts: parts.length, html: renderSegmentedBar(parts, d.totalBytes, progressClass) };
  }
  return {
    indeterminate,
    html: `<div class="progress-bar-container"><div class="progress-bar ${progressClass}${indeterminate ? ' indeterminate' : ''}" style="${barStyle}"></div></div>`,
  };
}

// Multi-connection downloads still in progress (completed ones show a plain full bar).
function getParts(d) {
  if (d.status === 'completed' || !d.totalBytes || !Array.isArray(d.segments) || d.segments.length < 2) return null;
  return d.segments;
}

// One slot per part, placed at its byte range; each slot fills as that part downloads.
function renderSegmentedBar(parts, total, progressClass) {
  const slots = parts.map((s, i) => {
    const len = s.end - s.start + 1;
    const pct = Math.min(100, (s.downloaded / len) * 100);
    return `<div class="segment-slot${pct >= 100 ? ' done' : ''}" style="left:${(s.start / total) * 100}%;width:${(len / total) * 100}%" title="Part ${i + 1}: ${Math.floor(pct)}% of ${formatBytes(len)}"><div class="segment-fill" style="width:${pct}%"></div></div>`;
  }).join('');
  return `<div class="progress-bar-container segmented-bar ${progressClass}" role="progressbar" aria-label="${parts.length} parts">${slots}</div>`;
}

const STATUS_RANK = { downloading: 0, connecting: 1, queued: 2, paused: 3, stopped: 4, failed: 5, completed: 6 };

const TABLE_COLUMNS = [
  { key: 'name', label: 'Name', className: 'col-name', value: d => d.filename.toLowerCase() },
  { key: 'size', label: 'Size', className: 'col-num col-size', value: d => d.totalBytes ?? d.downloadedBytes ?? 0 },
  { key: 'status', label: 'Status', className: 'col-status', value: d => STATUS_RANK[d.status] ?? 99 },
  { key: 'progress', label: 'Progress', className: 'col-progress', value: d => d.progress || 0 },
  { key: 'speed', label: 'Speed', className: 'col-num', value: d => (d.status === 'downloading' ? d.speed || 0 : 0) },
  { key: 'eta', label: 'Time left', className: 'col-num', value: d => d.remainingTime },
  { key: 'added', label: 'Added', className: 'col-num col-added', value: d => d.createdAt },
];

function sortDownloads(list, sort) {
  const col = sort && TABLE_COLUMNS.find(c => c.key === sort.key);
  if (!col) return list;
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    // Missing values (e.g. unknown time left) always go last.
    if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

function renderHeaderCell(col) {
  const active = store.sort?.key === col.key;
  const dir = active ? store.sort.dir : null;
  const icon = dir === 'asc' ? 'fa-sort-up' : dir === 'desc' ? 'fa-sort-down' : 'fa-sort';
  const aria = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
  return `
    <th class="${col.className || ''} sortable${active ? ' sorted' : ''}" aria-sort="${aria}">
      <button type="button" class="th-sort" data-sort="${col.key}" title="Sort by ${col.label}">
        ${col.label} <i class="fas ${icon}"></i>
      </button>
    </th>
  `;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.th-sort');
  if (btn) store.toggleSort(btn.dataset.sort);
});

const STATUS_LABELS = {
  downloading: ['Downloading', 'fa-circle-down'],
  connecting: ['Connecting', 'fa-circle-notch'],
  queued: ['Queued', 'fa-clock'],
  paused: ['Paused', 'fa-circle-pause'],
  stopped: ['Stopped', 'fa-circle-stop'],
  completed: ['Completed', 'fa-circle-check'],
  failed: ['Failed', 'fa-circle-exclamation'],
};

function hostOf(d) {
  if (d.kind === 'torrent') return 'BitTorrent';
  try { return new URL(d.url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function sublineOf(d) {
  const cat = CATEGORIES.find(c => c.key === categoryOf(d));
  const parts = [hostOf(d), cat?.label];
  if (d.kind === 'media' && d.mediaQuality) parts.push(d.mediaQuality === 'audio' ? 'Audio' : /^\d+$/.test(d.mediaQuality) ? `${d.mediaQuality}p` : 'Best');
  if (d.kind === 'torrent' && d.torrentFiles?.length > 1) parts.push(`${d.torrentFiles.length} files`);
  return parts.filter(Boolean).join(' · ');
}

function formatAdded(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return '—';
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const diff = Math.floor((day - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return t.toLocaleDateString([], { month: 'short', day: 'numeric', year: t.getFullYear() === day.getFullYear() ? undefined : 'numeric' });
}

function renderDownloadRow(d, draggable = true) {
  const status = d.status;
  const isActive = status === 'downloading' || status === 'connecting';
  const bar = renderProgressBar(d);
  const cat = CATEGORIES.find(c => c.key === categoryOf(d));
  const [label, icon] = STATUS_LABELS[status] || [status, 'fa-circle-question'];
  const statusText = status === 'failed' && d.errorMessage ? d.errorMessage : label;
  const pct = bar.indeterminate ? '—' : `${(d.progress || 0).toFixed(status === 'completed' ? 0 : 1)}%`;
  const bytes = status === 'completed' || !d.totalBytes
    ? formatBytes(d.totalBytes || d.downloadedBytes)
    : `${formatBytes(d.downloadedBytes)} / ${formatBytes(d.totalBytes)}`;
  return `
    <tr class="download-item download-row row-${status}" data-id="${d.id}" draggable="${draggable}">
      <td class="col-name">
        <div class="row-name">
          <span class="file-icon cat-${cat?.key || 'other'}">${d.kind === 'torrent' ? '<i class="fas fa-magnet"></i>' : d.kind === 'media' ? '<i class="fab fa-youtube"></i>' : `<i class="fas ${cat?.icon || 'fa-file'}"></i>`}</span>
          <div class="row-name-text">
            <div class="download-filename" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename)}</div>
            <div class="row-sub">${escapeHtml(sublineOf(d))}</div>
          </div>
        </div>
      </td>
      <td class="col-num col-size">${d.totalBytes ? formatBytes(d.totalBytes) : '—'}</td>
      <td class="col-status"><span class="row-status st-${status}" title="${escapeHtml(statusText)}"><i class="fas ${icon}"></i><span>${escapeHtml(statusText)}</span></span></td>
      <td class="col-progress">
        <div class="pg-top"><strong>${pct}</strong><span>${bytes}</span></div>
        ${bar.html}
      </td>
      <td class="col-num">${isActive && d.speed ? formatSpeed(d.speed) : '—'}</td>
      <td class="col-num">${isActive && !bar.indeterminate && d.remainingTime ? formatTime(d.remainingTime) : '—'}</td>
      <td class="col-num col-added">${formatAdded(d.createdAt)}</td>
      <td class="col-actions">
        <div class="row-actions">${renderActions(d)}<button type="button" class="btn btn-sm btn-icon row-more" data-more="${d.id}" title="More" aria-label="More actions"><i class="fas fa-ellipsis"></i></button></div>
      </td>
    </tr>
  `;
}

document.addEventListener('click', (e) => {
  const more = e.target.closest('[data-more]');
  if (!more) return;
  e.stopPropagation();
  const d = store.downloads.find(x => x.id === more.dataset.more);
  const r = more.getBoundingClientRect();
  if (d) openContextMenu(d, r.right - 200, r.bottom + 4);
});

function renderTorrentFiles(d) {
  const files = d.torrentFiles || [];
  const rows = files.map((f, i) => {
    const pct = f.length ? Math.min(100, (f.downloaded / f.length) * 100) : 100;
    const done = pct >= 100;
    let action = '';
    if (done && opener && f.absPath) {
      action = `<button type="button" class="btn btn-sm btn-icon action-reveal-file" data-id="${d.id}" data-path="${escapeHtml(f.absPath)}" title="Show in folder"><i class="fas fa-folder-open"></i></button>`;
    } else if (done) {
      action = `<a class="btn btn-sm btn-icon" href="${API_BASE}/downloads/${d.id}/files/${i}" download title="Save to PC"><i class="fas fa-download"></i></a>`;
    }
    // Drop the torrent's root folder from displayed paths.
    const shown = f.path.split(/[\\/]/).slice(1).join('/') || f.name;
    return `
      <li class="tfile${done ? ' done' : ''}">
        <i class="fas ${done ? 'fa-circle-check' : 'fa-file'} tfile-icon"></i>
        <span class="tfile-name" title="${escapeHtml(shown)}">${escapeHtml(shown)}</span>
        <span class="tfile-size">${formatBytes(f.length)}</span>
        <span class="tfile-bar"><span style="width:${pct}%"></span></span>
        <span class="tfile-pct">${Math.floor(pct)}%</span>
        <span class="tfile-action">${action}</span>
      </li>`;
  }).join('');
  return `<ul class="torrent-files">${rows}</ul>`;
}

function renderDownloadItem(d) {
  const progress = d.progress || 0;
  const status = d.status;
  const { indeterminate, parts, html: progressBar } = renderProgressBar(d);
  const isTorrent = d.kind === 'torrent';
  const fileCount = d.torrentFiles?.length || 0;
  const filesOpen = isTorrent && fileCount > 1 && expandedFiles.has(d.id);
  const isActive = status === 'downloading' || status === 'connecting';
  const subline = isTorrent
    ? `<i class="fas fa-magnet"></i> Torrent${fileCount ? ` · ${fileCount} file${fileCount === 1 ? '' : 's'}` : ' · fetching metadata'}`
    : escapeHtml(d.url);

  return `
    <div class="download-item" data-id="${d.id}" draggable="true">
      <div class="download-item-header">
        <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
        <div class="download-icon status-${status}">
          <i class="fas ${getStatusIcon(status)}"></i>
        </div>
        <div class="download-info">
          <div class="download-filename">${escapeHtml(d.filename)}</div>
          <div class="download-url${isTorrent ? ' is-torrent' : ''}">${subline}</div>
        </div>
        <span class="download-status-badge badge-${status}">${status}</span>
      </div>
      <div class="download-progress-area">
        ${progressBar}
        <div class="download-meta">
          <span><i class="fas fa-file"></i> ${formatBytes(d.downloadedBytes)} / ${d.totalBytes ? formatBytes(d.totalBytes) : 'Unknown size'}</span>
          <span><i class="fas fa-gauge-high"></i> ${formatSpeed(d.speed)}</span>
          ${parts ? `<span title="Downloading over ${parts} connections"><i class="fas fa-layer-group"></i> ${parts} parts</span>` : ''}
          ${isTorrent && isActive ? `<span title="Connected peers"><i class="fas fa-users"></i> ${d.peers || 0} peers</span>
          <span title="Upload speed"><i class="fas fa-arrow-up"></i> ${formatSpeed(d.uploadSpeed)}</span>` : ''}
          ${isTorrent && fileCount > 1 ? `<button type="button" class="files-toggle action-files" data-id="${d.id}" aria-expanded="${filesOpen}"><i class="fas fa-chevron-${filesOpen ? 'up' : 'down'}"></i> Files (${fileCount})</button>` : ''}
          ${indeterminate ? '' : `<span><i class="fas fa-clock"></i> ${formatTime(d.remainingTime)} left</span>
          <span><i class="fas fa-percentage"></i> ${Math.round(progress)}%</span>`}
          <div class="download-actions">
            ${renderActions(d)}
          </div>
        </div>
        ${d.errorMessage ? `<div class="download-error"><i class="fas fa-exclamation-triangle"></i> ${escapeHtml(d.errorMessage)}</div>` : ''}
        ${filesOpen ? renderTorrentFiles(d) : ''}
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

  if (btn.classList.contains('action-files')) {
    e.stopPropagation();
    if (expandedFiles.has(id)) expandedFiles.delete(id); else expandedFiles.add(id);
    renderDownloadList(document.getElementById('download-list'));
    return;
  }
  if (btn.classList.contains('action-reveal-file')) {
    e.stopPropagation();
    opener?.revealItemInDir(btn.dataset.path).catch(err => window.showToast?.(`Couldn't show file: ${err}`, 'error'));
    return;
  }

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
    const record = store.downloads.find(d => d.id === id);
    window.openDeleteConfirm(id, record ? record.filename : 'this download');
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
