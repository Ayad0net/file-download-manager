import { store } from '../state/store.js';

const sections = [
  {
    items: [{ key: 'all', label: 'All Downloads', icon: 'fa-layer-group' }],
  },
  {
    title: 'Status',
    items: [
      { key: 'downloading', label: 'Active', icon: 'fa-circle-down', tone: 'blue' },
      { key: 'queued', label: 'Queued', icon: 'fa-clock', tone: 'muted' },
      { key: 'paused', label: 'Paused', icon: 'fa-circle-pause', tone: 'yellow' },
      { key: 'completed', label: 'Completed', icon: 'fa-circle-check', tone: 'green' },
      { key: 'failed', label: 'Failed', icon: 'fa-circle-xmark', tone: 'red' },
    ],
  },
];

const isMac = /Mac/.test(navigator.platform);
const shortcut = isMac ? '⌘B' : 'Ctrl+B';

// Sidebar-panel glyph: outlined window with a left column, filled while the sidebar is expanded.
const PANEL_ICON = `
  <svg class="panel-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect class="panel-icon-col" x="4.5" y="5.5" width="4" height="9" rx="1"/>
    <line x1="9.5" y1="3.5" x2="9.5" y2="16.5" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;

function isCollapsed() {
  return document.documentElement.classList.contains('sidebar-collapsed');
}

export function toggleSidebarCollapsed() {
  const collapsed = !isCollapsed();
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('dm-sidebar-collapsed', collapsed ? '1' : '0');
  hideTip();
  updateToggle();
}

function updateToggle() {
  const btn = document.getElementById('sidebar-collapse');
  if (!btn) return;
  const label = `${isCollapsed() ? 'Expand' : 'Collapse'} sidebar`;
  btn.dataset.tip = `${label}  ${shortcut}`;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', String(!isCollapsed()));
}

function getCount(key) {
  if (key === 'all') return store.downloads.length;
  return store.downloads.filter(d => d.status === key).length;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function renderItem(item) {
  const count = getCount(item.key);
  return `
    <button type="button" class="nav-item${store.filter === item.key ? ' active' : ''}" data-filter="${item.key}" data-tip="${item.label}"${item.tone ? ` data-tone="${item.tone}"` : ''}>
      <span class="nav-icon"><i class="fas ${item.icon}"></i></span>
      <span class="nav-label">${item.label}</span>
      <span class="nav-count"${count ? '' : ' data-zero'}>${count}</span>
    </button>
  `;
}

function storageText() {
  const { totalDownloadedBytes, freeDiskBytes } = store.stats;
  return {
    used: formatBytes(totalDownloadedBytes),
    free: freeDiskBytes != null ? formatBytes(freeDiskBytes) : '—',
  };
}

export function renderSidebar(container) {
  container.setAttribute('aria-label', 'Download filters');
  container.innerHTML = `
    <div class="nav-head">
      <span class="nav-head-title">Library</span>
      <button type="button" class="nav-toggle" id="sidebar-collapse">${PANEL_ICON}</button>
    </div>
    <nav class="nav-scroll">
      ${sections.map(s => `
        <div class="nav-section">
          ${s.title ? `<div class="nav-section-title">${s.title}</div>` : ''}
          ${s.items.map(renderItem).join('')}
        </div>
      `).join('')}
    </nav>
    <div class="nav-foot" id="nav-storage" data-tip="">
      <span class="nav-icon"><i class="fas fa-hard-drive"></i></span>
      <div class="nav-storage-text">
        <div class="nav-storage-free"><strong></strong> free</div>
        <div class="nav-storage-used"></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => {
      store.setFilter(el.dataset.filter);
      container.classList.remove('open'); // close the mobile drawer
    };
  });
  document.getElementById('sidebar-collapse').onclick = toggleSidebarCollapsed;
  updateToggle();
  updateSidebar();
}

function updateSidebar() {
  const container = document.getElementById('sidebar');
  if (!container) return;
  container.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === store.filter);
    el.toggleAttribute('aria-current', el.dataset.filter === store.filter);
    const badge = el.querySelector('.nav-count');
    const count = getCount(el.dataset.filter);
    badge.textContent = count;
    badge.toggleAttribute('data-zero', !count);
  });
  const { used, free } = storageText();
  const foot = document.getElementById('nav-storage');
  if (foot) {
    foot.querySelector('strong').textContent = free;
    foot.querySelector('.nav-storage-used').textContent = `${used} downloaded`;
    foot.dataset.tip = `${free} free · ${used} downloaded`;
  }
}

store.subscribe(updateSidebar);

// Floating tooltip for the collapsed rail (a pseudo-element would be clipped by the scrolling sidebar).
let tipEl = null;

function showTip(target) {
  if (!isCollapsed() && target.id !== 'sidebar-collapse') return;
  const text = target.dataset.tip;
  if (!text) return;
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'nav-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  const r = target.getBoundingClientRect();
  tipEl.style.top = `${r.top + r.height / 2}px`;
  tipEl.style.left = `${r.right + 10}px`;
  tipEl.classList.add('visible');
}

function hideTip() {
  tipEl?.classList.remove('visible');
}

document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('#sidebar [data-tip]');
  if (t) showTip(t); else hideTip();
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest?.('#sidebar [data-tip]');
  if (t && t.matches(':focus-visible')) showTip(t); else hideTip();
});
document.addEventListener('scroll', hideTip, true);

document.addEventListener('keydown', (e) => {
  if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    if (e.target.closest?.('input, textarea')) return;
    e.preventDefault();
    toggleSidebarCollapsed();
  }
});
