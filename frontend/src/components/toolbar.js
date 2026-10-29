import { pauseAll, resumeAll, stopAll, clearUncompleted } from '../services/api.js';
import { store } from '../state/store.js';
import { confirmAction } from './confirm-modal.js';

const isMac = /Mac/.test(navigator.platform);

const iconBtn = (id, icon, tip, enabled, extra = '') =>
  `<button type="button" class="tb-icon${extra}" id="${id}" ${enabled ? '' : 'disabled'} data-tb-tip="${tip}" aria-label="${tip}"><i class="fas ${icon}"></i></button>`;

export function renderToolbar(container) {
  const hasActive = store.downloads.some(d => d.status === 'downloading' || d.status === 'connecting' || d.status === 'queued');
  const hasPaused = store.downloads.some(d => d.status === 'paused');
  const uncompletedCount = store.downloads.filter(d => d.status !== 'completed').length;

  // Built once; later store updates only refresh the button states so the search box keeps focus.
  if (!container.querySelector('#toolbar-search')) {
    container.setAttribute('data-tauri-drag-region', '');
    container.innerHTML = `
      <button type="button" class="tb-icon tb-menu" id="toolbar-menu" aria-label="Menu"><i class="fas fa-bars"></i></button>
      <button class="btn btn-primary tb-add" id="toolbar-add" title="Add a new download"><i class="fas fa-plus"></i> Add URL</button>
      <div class="tb-group" id="toolbar-actions"></div>
      <div class="toolbar-spacer" data-tauri-drag-region></div>
      <label class="tb-search">
        <i class="fas fa-magnifying-glass"></i>
        <input type="search" id="toolbar-search" placeholder="Search downloads" autocomplete="off" spellcheck="false">
        <kbd>${isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </label>
      <button type="button" class="tb-icon" id="toolbar-settings" data-tb-tip="Settings" aria-label="Settings"><i class="fas fa-sliders"></i></button>
    `;
    const search = document.getElementById('toolbar-search');
    search.value = store.search;
    search.oninput = () => store.setSearch(search.value);
    search.onkeydown = (e) => { if (e.key === 'Escape') { search.value = ''; store.setSearch(''); search.blur(); } };
    document.getElementById('toolbar-settings').onclick = () => window.openSettings();
    document.getElementById('toolbar-menu').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  }

  document.getElementById('toolbar-actions').innerHTML = `
    ${iconBtn('toolbar-resume-all', 'fa-play', 'Resume all', hasPaused)}
    ${iconBtn('toolbar-pause-all', 'fa-pause', 'Pause all', hasActive)}
    ${iconBtn('toolbar-stop-all', 'fa-stop', 'Stop all', hasActive)}
    <span class="tb-sep"></span>
    ${iconBtn('toolbar-clear-all', 'fa-broom', uncompletedCount ? 'Clear uncompleted' : 'No uncompleted downloads', uncompletedCount > 0, ' tb-danger')}
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

document.addEventListener('keydown', (e) => {
  if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.getElementById('toolbar-search')?.focus();
  }
});
