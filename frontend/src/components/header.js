import { store } from '../state/store.js';

export function renderHeader(container) {
  container.innerHTML = `
    <button id="sidebar-toggle"><i class="fas fa-bars"></i></button>
    <div class="header-logo">
      <i class="fas fa-download"></i>
      <span>Download Manager</span>
    </div>
    <div class="header-spacer"></div>
    <div class="header-controls">
      <button class="btn btn-icon" id="header-settings-btn" title="Settings"><i class="fas fa-gear"></i></button>
      <button class="btn btn-icon" id="header-theme-btn" title="Toggle Theme"><i class="fas fa-moon"></i></button>
    </div>
  `;

  document.getElementById('sidebar-toggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };

  document.getElementById('header-settings-btn').onclick = () => {
    const modal = document.getElementById('settings-modal');
    document.getElementById('setting-concurrent').value = store.maxConcurrent;
    document.getElementById('setting-speed-limit').value = store.globalSpeedLimit;
    document.getElementById('setting-theme').value = document.documentElement.getAttribute('data-theme') || 'dark';
    modal.classList.remove('hidden');
  };

  document.getElementById('header-theme-btn').onclick = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    const icon = document.getElementById('header-theme-btn').querySelector('i');
    icon.className = next === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
  };
}
