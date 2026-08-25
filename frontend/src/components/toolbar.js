import { pauseAll, resumeAll, stopAll, clearUncompleted } from '../services/api.js';
import { store } from '../state/store.js';
import { confirmAction } from './confirm-modal.js';

export function renderToolbar(container) {
  const { stats } = store;
  const hasActive = store.downloads.some(d => d.status === 'downloading' || d.status === 'connecting');
  const hasPaused = store.downloads.some(d => d.status === 'paused');
  const uncompletedCount = store.downloads.filter(d => d.status !== 'completed').length;

  container.innerHTML = `
    <button class="btn btn-primary" id="toolbar-add" title="Add a new download URL"><i class="fas fa-plus"></i> Add URL</button>
    <button class="btn" id="toolbar-pause-all" ${hasActive ? '' : 'disabled'} title="${hasActive ? 'Pause every active download' : 'No active downloads'}"><i class="fas fa-pause"></i> Pause All</button>
    <button class="btn" id="toolbar-resume-all" ${hasPaused ? '' : 'disabled'} title="${hasPaused ? 'Resume every paused download' : 'No paused downloads'}"><i class="fas fa-play"></i> Resume All</button>
    <button class="btn" id="toolbar-stop-all" ${hasActive ? '' : 'disabled'} title="${hasActive ? 'Stop every active download' : 'No active downloads'}"><i class="fas fa-stop"></i> Stop All</button>
    <button class="btn btn-danger" id="toolbar-clear-all" ${uncompletedCount === 0 ? 'disabled' : ''} title="${uncompletedCount === 0 ? 'No uncompleted downloads' : 'Remove uncompleted entries and their files'}"><i class="fas fa-broom"></i> Clear Uncompleted</button>
  `;

  document.getElementById('toolbar-add').onclick = () => {
    document.getElementById('add-url-modal').classList.remove('hidden');
  };

  document.getElementById('toolbar-pause-all').onclick = async () => {
    const ok = await confirmAction({
      title: 'Pause all downloads?',
      message: 'Every active download will be paused. You can resume them anytime.',
      icon: 'fa-pause',
      tone: 'warning',
      confirmText: '<i class="fas fa-pause"></i> Yes, Pause All',
    });
    if (!ok) return;
    await pauseAll();
    window.showToast?.('All active downloads paused', 'info');
  };

  document.getElementById('toolbar-resume-all').onclick = async () => {
    const ok = await confirmAction({
      title: 'Resume all downloads?',
      message: 'Every paused download will rejoin the queue and start downloading.',
      icon: 'fa-play',
      tone: 'success',
      confirmText: '<i class="fas fa-play"></i> Yes, Resume All',
    });
    if (!ok) return;
    await resumeAll();
    window.showToast?.('All paused downloads resumed', 'success');
  };

  document.getElementById('toolbar-stop-all').onclick = async () => {
    const ok = await confirmAction({
      title: 'Stop all downloads?',
      message: 'All active and queued downloads will be stopped. Partial progress is kept for resuming later.',
      icon: 'fa-stop',
      tone: 'danger',
      confirmText: '<i class="fas fa-stop"></i> Yes, Stop All',
    });
    if (!ok) return;
    await stopAll();
    window.showToast?.('All downloads stopped', 'error');
  };

  document.getElementById('toolbar-clear-all').onclick = async () => {
    const ok = await confirmAction({
      title: 'Clear uncompleted downloads?',
      message: `This removes ${uncompletedCount} uncompleted entr${uncompletedCount === 1 ? 'y' : 'ies'} (queued, paused, failed, stopped) along with their partial files. Completed downloads are kept. This cannot be undone.`,
      icon: 'fa-broom',
      tone: 'danger',
      confirmText: '<i class="fas fa-broom"></i> Yes, Clear Uncompleted',
    });
    if (!ok) return;

    store.stopPolling();
    try {
      const items = [...document.querySelectorAll('#download-list .download-item')]
        .filter(el => {
          const record = store.downloads.find(d => d.id === el.dataset.id);
          return record && record.status !== 'completed';
        });
      items.forEach((el, i) => {
        el.style.maxHeight = `${el.scrollHeight}px`;
        el.style.setProperty('--wipe-delay', `${i * 50}ms`);
        requestAnimationFrame(() => el.classList.add('wiping'));
      });
      if (items.length > 0) {
        await new Promise(r => setTimeout(r, items.length * 50 + 1100));
      }
      await clearUncompleted();
      window.showToast?.('Uncompleted downloads cleared', 'success');
    } catch (err) {
      window.showToast?.(err.message || 'Failed to clear downloads', 'error');
    } finally {
      document.querySelectorAll('#download-list .download-item').forEach(el => {
        const record = store.downloads.find(d => d.id === el.dataset.id);
        if (!record || record.status !== 'completed') el.remove();
      });
      store.poll();
      store.startPolling(1500);
    }
  };
}

store.subscribe(() => {
  const container = document.getElementById('toolbar');
  if (container) renderToolbar(container);
});
