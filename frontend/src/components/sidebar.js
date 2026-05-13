import { store } from '../state/store.js';

const filters = [
  { key: 'all', label: 'All', icon: 'fa-list' },
  { key: 'downloading', label: 'Active', icon: 'fa-spinner' },
  { key: 'queued', label: 'Queued', icon: 'fa-clock' },
  { key: 'paused', label: 'Paused', icon: 'fa-pause' },
  { key: 'completed', label: 'Completed', icon: 'fa-circle-check' },
  { key: 'failed', label: 'Failed', icon: 'fa-circle-xmark' },
];

export function renderSidebar(container) {
  container.innerHTML = filters.map(f => `
    <button class="sidebar-item ${store.filter === f.key ? 'active' : ''}" data-filter="${f.key}">
      <i class="fas ${f.icon}"></i>
      <span>${f.label}</span>
      <span class="sidebar-badge">${getCount(f.key)}</span>
    </button>
  `).join('');

  container.querySelectorAll('.sidebar-item').forEach(el => {
    el.onclick = () => {
      store.setFilter(el.dataset.filter);
    };
  });
}

function getCount(key) {
  if (key === 'all') return store.downloads.length;
  return store.downloads.filter(d => d.status === key).length;
}

store.subscribe(() => {
  const container = document.getElementById('sidebar');
  const currentFilter = store.filter;
  const items = container.querySelectorAll('.sidebar-item');
  items.forEach(el => {
    const isActive = el.dataset.filter === currentFilter;
    el.classList.toggle('active', isActive);
    const badge = el.querySelector('.sidebar-badge');
    if (badge) badge.textContent = getCount(el.dataset.filter);
  });
});
