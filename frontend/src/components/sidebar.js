import { store, CATEGORIES } from '../state/store.js';
import { brandHtml } from './header.js';
import { toggleTheme } from './settings-modal.js';

const library = [
  { key: 'all', label: 'All downloads', icon: 'fa-table-cells-large' },
  { key: 'unfinished', label: 'Unfinished', icon: 'fa-circle-down' },
  { key: 'finished', label: 'Finished', icon: 'fa-circle-check' },
];

const sections = [
  { items: library },
  {
    title: 'Categories',
    items: [
      ...CATEGORIES.map(c => ({ key: `category:${c.key}`, label: c.label, icon: c.icon })),
      { key: 'torrents', label: 'Torrents', icon: 'fa-magnet' },
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
  return store.downloads.filter(d => store.inScope(d, key)).length;
}

function formatSpeedParts(bps) {
  if (!bps) return ['0', 'B/s'];
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bps) / Math.log(1024)));
  const v = bps / Math.pow(1024, i);
  return [v.toFixed(i > 0 && v < 100 ? 1 : 0), units[i]];
}

// Area chart of the last minute of total speed.
function sparkline(samples) {
  const w = 200, h = 44;
  if (samples.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
  const max = Math.max(...samples, 1);
  const step = w / (samples.length - 1);
  const pts = samples.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent-blue)" stop-opacity="0.35"/><stop offset="1" stop-color="var(--accent-blue)" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="M0,${h} L${pts.join(' L')} L${w},${h} Z" fill="url(#spark-fill)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent-blue)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
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
    <button type="button" class="nav-item${store.scope === item.key ? ' active' : ''}" data-filter="${item.key}" data-tip="${item.label}"${item.tone ? ` data-tone="${item.tone}"` : ''}>
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
  const isDark = (document.documentElement.getAttribute('data-mode') || 'dark') === 'dark';
  container.innerHTML = `
    <div class="nav-head" data-tauri-drag-region>
      ${brandHtml()}
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
    <div class="speed-card" id="speed-card" data-tip="">
      <div class="speed-card-head"><span>Total speed</span><span class="speed-active"></span></div>
      <div class="speed-value"><strong></strong> <small></small></div>
      <div class="speed-chart"></div>
      <div class="speed-foot"><span class="speed-limit"></span><span class="speed-peak"></span></div>
    </div>
    <div class="nav-bottom">
      <span class="nav-storage" id="nav-storage"><i class="fas fa-hard-drive"></i> <span></span></span>
      <button type="button" class="nav-icon-btn" id="header-theme-btn" data-tip="Toggle theme" aria-label="Toggle theme"><i class="fas fa-${isDark ? 'moon' : 'sun'}"></i></button>
      <button type="button" class="nav-icon-btn" id="sidebar-settings" data-tip="Settings" aria-label="Settings"><i class="fas fa-gear"></i></button>
    </div>
  `;

  container.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => {
      store.setScope(el.dataset.filter);
      container.classList.remove('open'); // close the mobile drawer
    };
  });
  document.getElementById('sidebar-collapse').onclick = toggleSidebarCollapsed;
  document.getElementById('header-theme-btn').onclick = () => toggleTheme();
  document.getElementById('sidebar-settings').onclick = () => window.openSettings();
  updateToggle();
  updateSidebar();
}

function updateSidebar() {
  const container = document.getElementById('sidebar');
  if (!container) return;
  container.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === store.scope);
    el.toggleAttribute('aria-current', el.dataset.filter === store.scope);
    const badge = el.querySelector('.nav-count');
    const count = getCount(el.dataset.filter);
    badge.textContent = count;
    badge.toggleAttribute('data-zero', !count);
  });

  const card = document.getElementById('speed-card');
  if (card) {
    const [v, unit] = formatSpeedParts(store.totalSpeed());
    const active = store.stats.active || 0;
    card.querySelector('.speed-value strong').textContent = v;
    card.querySelector('.speed-value small').textContent = unit;
    const pill = card.querySelector('.speed-active');
    pill.textContent = `${active} active`;
    pill.hidden = !active;
    card.querySelector('.speed-chart').innerHTML = sparkline(store.speedHistory);
    card.querySelector('.speed-limit').innerHTML = `<i class="fas fa-gauge"></i> Limit ${store.globalSpeedLimit ? formatSpeedParts(store.globalSpeedLimit).join(' ') : 'Off'}`;
    card.querySelector('.speed-peak').textContent = `Peak ${formatSpeedParts(store.peakSpeed).join(' ')}`;
    card.dataset.tip = `${v} ${unit} · ${active} active`;
  }
  const { used, free } = storageText();
  const storage = document.getElementById('nav-storage');
  if (storage) {
    storage.querySelector('span').textContent = `${free} free`;
    storage.title = `${free} free · ${used} downloaded`;
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
