import { store } from '../state/store.js';
import { toggleTheme } from './settings-modal.js';

export function renderHeader(container) {
  const isDark = (document.documentElement.getAttribute('data-mode') || 'dark') === 'dark';
  container.innerHTML = `
    <button id="sidebar-toggle"><i class="fas fa-bars"></i></button>
    <div class="header-logo">
      <i class="fas fa-download"></i>
      <span>Download Manager</span>
    </div>
    <div class="header-spacer"></div>
    <div class="header-controls">
      <button class="btn btn-icon" id="header-settings-btn" title="Settings"><i class="fas fa-gear"></i></button>
      <button class="btn btn-icon" id="header-theme-btn" title="Toggle Theme"><i class="fas fa-${isDark ? 'moon' : 'sun'}"></i></button>
    </div>
  `;

  document.getElementById('sidebar-toggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };

  document.getElementById('header-settings-btn').onclick = () => {
    window.openSettings();
  };

  document.getElementById('header-theme-btn').onclick = () => {
    toggleTheme();
  };
}
