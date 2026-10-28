import { addDownloads, addTorrentFiles } from '../services/api.js';
import { isMediaUrl, pickMediaQuality } from './media-modal.js';

export function initAddUrlModal() {
  const modal = document.getElementById('add-url-modal');
  const urlInput = document.getElementById('url-input');
  const filenameInput = document.getElementById('filename-input');
  const errorEl = document.getElementById('url-error');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');
  const closeBtn = document.getElementById('modal-close');
  const drop = document.getElementById('torrent-drop');
  const fileInput = document.getElementById('torrent-input');
  const pickedList = document.getElementById('torrent-picked');
  let torrentFiles = [];

  function renderPicked() {
    pickedList.classList.toggle('hidden', torrentFiles.length === 0);
    pickedList.innerHTML = torrentFiles.map((f, i) => `
      <li><i class="fas fa-file"></i><span></span>
        <button type="button" class="btn btn-sm btn-icon" data-remove="${i}" title="Remove"><i class="fas fa-xmark"></i></button>
      </li>`).join('');
    pickedList.querySelectorAll('li span').forEach((el, i) => { el.textContent = torrentFiles[i].name; });
  }

  function addPicked(files) {
    const valid = [...files].filter(f => /\.torrent$/i.test(f.name));
    if (valid.length < files.length) window.showToast?.('Only .torrent files can be added here', 'warning');
    torrentFiles = torrentFiles.concat(valid);
    renderPicked();
  }

  drop.onclick = () => fileInput.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => { addPicked(fileInput.files); fileInput.value = ''; };
  pickedList.onclick = (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    torrentFiles.splice(+btn.dataset.remove, 1);
    renderPicked();
  };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    drop.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('dragging')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    // Desktop: Tauri reports native drops itself (window-guards.js adds them directly).
    if (window.__TAURI__) return;
    addPicked(e.dataTransfer.files);
  });

  function close() {
    modal.classList.add('hidden');
    torrentFiles = [];
    renderPicked();
    urlInput.value = '';
    filenameInput.value = '';
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }

  closeBtn.onclick = close;
  cancelBtn.onclick = close;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  confirmBtn.onclick = async () => {
    const raw = urlInput.value.trim();
    if (!raw && torrentFiles.length === 0) {
      errorEl.textContent = 'Enter a URL or magnet link, or choose a .torrent file';
      errorEl.classList.remove('hidden');
      return;
    }

    const allUrls = raw.split('\n').map(s => s.trim()).filter(Boolean);
    // YouTube / TikTok links go through the quality picker instead of the HTTP engine.
    const mediaUrls = allUrls.filter(isMediaUrl);
    const urls = allUrls.filter(u => !isMediaUrl(u));
    const namesRaw = filenameInput.value.trim();
    const names = namesRaw ? namesRaw.split('\n').map(s => s.trim()).filter(Boolean) : undefined;

    const invalid = urls.filter(u => {
      if (u.startsWith('magnet:')) return !/xt=urn:bt[im]h:/i.test(u);
      try {
        const p = new URL(u);
        return p.protocol !== 'http:' && p.protocol !== 'https:';
      } catch {
        return true;
      }
    });

    if (invalid.length > 0) {
      errorEl.textContent = `Invalid URLs: ${invalid.join(', ')}`;
      errorEl.classList.remove('hidden');
      return;
    }

    try {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
      const results = [];
      if (mediaUrls.length > 0) {
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading video info...';
        modal.classList.add('hidden');
        for (const u of mediaUrls) {
          try {
            results.push({ downloads: new Array(await pickMediaQuality(u)) });
          } catch (err) {
            results.push({ errors: [`${u}: ${err.message}`] });
          }
        }
        if (urls.length === 0 && torrentFiles.length === 0) {
          const added = results.reduce((n, r) => n + (r.downloads?.length || 0), 0);
          const errors = results.flatMap(r => r.errors || []);
          if (errors.length) showToast(errors.join('; '), added ? 'warning' : 'error');
          else if (added) showToast(`Added ${added} video(s) to queue`, 'success');
          close();
          return;
        }
      }
      if (urls.length > 0) results.push(await addDownloads(urls, names));
      if (torrentFiles.length > 0) results.push(await addTorrentFiles(torrentFiles));
      const added = results.reduce((n, r) => n + (r.downloads?.length || 0), 0);
      const errors = results.flatMap(r => r.details || r.errors || []);
      if (added === 0) throw new Error(errors.join('; ') || 'Nothing could be added');
      if (errors.length > 0) {
        showToast(`Added ${added} download(s), ${errors.length} failed: ${errors[0]}`, 'warning');
      } else {
        showToast(`Added ${added} download(s) to queue`, 'success');
      }
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to add downloads';
      errorEl.classList.remove('hidden');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fas fa-download"></i> Add to Queue';
    }
  };

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      confirmBtn.click();
    }
  });
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-info-circle' };
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.showToast = showToast;
