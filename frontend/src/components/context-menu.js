import { API_BASE, pauseDownload, resumeDownload, stopDownload, retryDownload, reorderDownloads } from '../services/api.js';
import { store } from '../state/store.js';

// Present only in the Tauri desktop app (withGlobalTauri).
const opener = window.__TAURI__?.opener;
const isMac = /Mac/.test(navigator.platform);
const revealLabel = isMac ? 'Show in Finder' : /Win/.test(navigator.platform) ? 'Show in Explorer' : 'Show in Folder';

let menuEl = null;

function buildItems(d) {
  const status = d.status;
  const isActive = status === 'downloading' || status === 'connecting';
  const done = status === 'completed';
  const items = [];

  if (opener) {
    items.push({ icon: 'fa-file-arrow-up', label: 'Open', disabled: !done, run: () => opener.openPath(d.filePath) });
    items.push({ icon: 'fa-folder-open', label: revealLabel, disabled: !done, run: () => opener.revealItemInDir(d.filePath) });
  } else if (done && !(d.kind === 'torrent' && (d.torrentFiles?.length || 0) > 1)) {
    items.push({ icon: 'fa-download', label: 'Save to PC', run: () => { window.location.href = `${API_BASE}/downloads/${d.id}/file`; } });
  }
  items.push('sep');

  if (isActive || status === 'queued') items.push({ icon: 'fa-pause', label: 'Pause', run: () => pauseDownload(d.id) });
  if (status === 'paused') items.push({ icon: 'fa-play', label: 'Resume', run: () => resumeDownload(d.id) });
  if (isActive || status === 'paused' || status === 'queued') items.push({ icon: 'fa-stop', label: 'Stop', run: () => stopDownload(d.id) });
  if (status === 'failed' || status === 'stopped') items.push({ icon: 'fa-rotate-right', label: 'Retry', run: () => retryDownload(d.id) });
  if (done) items.push({ icon: 'fa-rotate-right', label: 'Download Again', run: () => retryDownload(d.id) });
  items.push('sep');

  const isTorrent = d.kind === 'torrent';
  if (isTorrent) {
    items.push({ icon: 'fa-magnet', label: 'Copy Magnet Link', run: () => copy(d.url, 'Magnet link copied') });
    if (d.infoHash) items.push({ icon: 'fa-hashtag', label: 'Copy Info Hash', run: () => copy(d.infoHash, 'Info hash copied') });
  } else {
    items.push({ icon: 'fa-link', label: 'Copy URL', run: () => copy(d.url, 'URL copied') });
  }
  items.push({ icon: 'fa-file', label: isTorrent ? 'Copy Name' : 'Copy File Name', run: () => copy(d.filename, 'Name copied') });
  if (opener && done) items.push({ icon: 'fa-route', label: 'Copy File Path', run: () => copy(d.filePath, 'File path copied') });
  if (!isTorrent) {
    items.push({ icon: 'fa-arrow-up-right-from-square', label: 'Open URL in Browser', run: () => (opener ? opener.openUrl(d.url) : window.open(d.url, '_blank', 'noopener')) });
  }
  items.push('sep');

  const ids = store.downloads.map(x => x.id);
  const idx = ids.indexOf(d.id);
  items.push({ icon: 'fa-angles-up', label: 'Move to Top', disabled: idx <= 0, run: () => move(ids, idx, 0) });
  items.push({ icon: 'fa-angles-down', label: 'Move to Bottom', disabled: idx === ids.length - 1, run: () => move(ids, idx, ids.length - 1) });
  items.push('sep');

  items.push({
    icon: 'fa-trash', label: 'Delete', danger: true, disabled: isActive,
    run: () => window.openDeleteConfirm(d.id, d.filename),
  });

  // Drop leading/trailing/duplicate separators left by conditional items.
  return items.filter((it, i, arr) => it !== 'sep' || (i > 0 && i < arr.length - 1 && arr[i - 1] !== 'sep'));
}

function move(ids, from, to) {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return reorderDownloads(next);
}

async function copy(text, msg) {
  await navigator.clipboard.writeText(text);
  window.showToast?.(msg, 'success');
}

function close() {
  menuEl?.remove();
  menuEl = null;
}

function open(d, x, y) {
  close();
  menuEl = document.createElement('div');
  menuEl.className = 'context-menu';
  menuEl.setAttribute('role', 'menu');

  for (const it of buildItems(d)) {
    if (it === 'sep') {
      menuEl.insertAdjacentHTML('beforeend', '<div class="context-menu-sep"></div>');
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = `context-menu-item${it.danger ? ' danger' : ''}`;
    btn.disabled = !!it.disabled;
    btn.innerHTML = `<i class="fas ${it.icon}"></i><span></span>`;
    btn.querySelector('span').textContent = it.label;
    btn.onclick = async () => {
      close();
      try {
        await it.run();
      } catch (err) {
        window.showToast?.(`${it.label} failed: ${err?.message || err}`, 'error');
      }
    };
    menuEl.appendChild(btn);
  }

  document.body.appendChild(menuEl);
  // Keep the menu inside the viewport.
  const { innerWidth: vw, innerHeight: vh } = window;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.min(x, vw - r.width - 4)}px`;
  menuEl.style.top = `${Math.min(y, vh - r.height - 4)}px`;
  menuEl.querySelector('button:not(:disabled)')?.focus();
}

export function initContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.download-item');
    if (!item) {
      // In the desktop app, hide the webview's "Reload / Inspect" menu elsewhere, except in text fields.
      if (opener && !e.target.closest('input, textarea')) e.preventDefault();
      return close();
    }
    const d = store.downloads.find(x => x.id === item.dataset.id);
    if (!d) return;
    e.preventDefault();
    open(d, e.clientX, e.clientY);
  });

  document.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!menuEl) return;
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...menuEl.querySelectorAll('button:not(:disabled)')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    }
  });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
}
