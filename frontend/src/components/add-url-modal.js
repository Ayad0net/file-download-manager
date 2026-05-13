import { addDownloads } from '../services/api.js';

export function initAddUrlModal() {
  const modal = document.getElementById('add-url-modal');
  const urlInput = document.getElementById('url-input');
  const filenameInput = document.getElementById('filename-input');
  const errorEl = document.getElementById('url-error');
  const confirmBtn = document.getElementById('modal-confirm');
  const cancelBtn = document.getElementById('modal-cancel');
  const closeBtn = document.getElementById('modal-close');

  function close() {
    modal.classList.add('hidden');
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
    if (!raw) {
      errorEl.textContent = 'Please enter at least one URL';
      errorEl.classList.remove('hidden');
      return;
    }

    const urls = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const namesRaw = filenameInput.value.trim();
    const names = namesRaw ? namesRaw.split('\n').map(s => s.trim()).filter(Boolean) : undefined;

    const invalid = urls.filter(u => {
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
      const result = await addDownloads(urls, names);
      if (result.errors && result.errors.length > 0) {
        showToast(`Added ${result.downloads.length} downloads, ${result.errors.length} errors`, 'warning');
      } else {
        showToast(`Added ${result.downloads.length} download(s) to queue`, 'success');
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
