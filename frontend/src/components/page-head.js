import { store, CATEGORIES, STATUS_GROUPS } from '../state/store.js';

const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

const SCOPE_TITLES = { all: 'All downloads', unfinished: 'Unfinished', finished: 'Finished', torrents: 'Torrents' };

function title() {
  if (store.scope.startsWith('category:')) return CATEGORIES.find(c => `category:${c.key}` === store.scope)?.label || 'Downloads';
  return SCOPE_TITLES[store.scope] || 'Downloads';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

export function renderPageHead(container) {
  const scoped = store.getScopedDownloads();
  const downloading = scoped.filter(STATUS_GROUPS.active).length;
  const total = scoped.reduce((n, d) => n + (d.totalBytes || d.downloadedBytes || 0), 0);
  const summary = store.loaded
    ? `${scoped.length} item${scoped.length === 1 ? '' : 's'} · ${downloading} downloading · ${formatBytes(total)} total${store.search ? ` · matching “${store.search}”` : ''}`
    : 'Loading…';

  container.innerHTML = `
    <div class="ph-text">
      <h1>${title()}</h1>
      <p></p>
    </div>
    <div class="ph-controls">
      <div class="chips" role="tablist" aria-label="Status">
        ${CHIPS.map(c => {
          const n = scoped.filter(STATUS_GROUPS[c.key]).length;
          const on = store.filter === c.key;
          return `<button type="button" role="tab" class="chip${on ? ' active' : ''}" aria-selected="${on}" data-chip="${c.key}">${c.label}<span>${n}</span></button>`;
        }).join('')}
      </div>
      <div class="view-switch" role="group" aria-label="View">
        <button type="button" data-view="cards" class="${store.view === 'cards' ? 'active' : ''}" title="Card view" aria-pressed="${store.view === 'cards'}"><i class="fas fa-table-cells-large"></i></button>
        <button type="button" data-view="table" class="${store.view === 'table' ? 'active' : ''}" title="Table view" aria-pressed="${store.view === 'table'}"><i class="fas fa-table-columns"></i></button>
      </div>
    </div>
  `;
  container.querySelector('.ph-text p').textContent = summary;
  container.querySelectorAll('[data-chip]').forEach(b => { b.onclick = () => store.setFilter(b.dataset.chip); });
  container.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => store.setView(b.dataset.view); });
}

store.subscribe(() => {
  const container = document.getElementById('page-head');
  if (container) renderPageHead(container);
});
