import { deleteDownload } from '../services/api.js';
import { store } from '../state/store.js';

let pendingId = null;

export function initDeleteConfirmModal() {
  const modal = document.getElementById('delete-confirm-modal');
  const filenameEl = document.getElementById('delete-confirm-filename');
  const cancelBtn = document.getElementById('delete-cancel');
  const confirmBtn = document.getElementById('delete-confirm-btn');

  function close() {
    modal.classList.add('hidden');
    pendingId = null;
  }

  window.openDeleteConfirm = (id, filename) => {
    pendingId = id;
    filenameEl.textContent = filename;
    modal.classList.remove('hidden');
    const card = modal.querySelector('.confirm-modal');
    card.classList.remove('pop-in');
    void card.offsetWidth;
    card.classList.add('pop-in');
  };

  cancelBtn.onclick = close;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  confirmBtn.onclick = () => {
    const id = pendingId;
    close();
    if (id) wipeAndDelete(id);
  };
}

async function wipeAndDelete(id) {
  store.stopPolling();
  try {
    const el = findItem(id);
    if (el) {
      el.style.maxHeight = `${el.scrollHeight}px`;
      requestAnimationFrame(() => el.classList.add('wiping'));
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        el.addEventListener('animationend', function handler(e) {
          if (e.animationName === 'collapseOut') {
            el.removeEventListener('animationend', handler);
            finish();
          }
        });
        setTimeout(finish, 1200);
      });
    }
    await deleteDownload(id);
    if (typeof window.showToast === 'function') {
      window.showToast('Download deleted', 'success');
    }
  } catch (err) {
    if (typeof window.showToast === 'function') {
      window.showToast(err.message || 'Failed to delete download', 'error');
    }
  } finally {
    findItem(id)?.remove();
    store.poll();
    store.startPolling(1500);
  }
}

function findItem(id) {
  return document.querySelector(`.download-item[data-id="${CSS.escape(id)}"]`);
}
