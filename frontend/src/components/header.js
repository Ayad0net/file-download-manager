import { store } from '../state/store.js';
import { toggleTheme } from './settings-modal.js';

const APP_VERSION = 'v1.0.0';

export function renderHeader(container) {
  const isDark = (document.documentElement.getAttribute('data-mode') || 'dark') === 'dark';
  container.innerHTML = `
    <button id="sidebar-toggle"><i class="fas fa-bars"></i></button>
    <div class="header-logo">
      <div class="logo-mark">
        <i class="fas fa-arrow-down"></i>
      </div>
      <div class="logo-text">
        <span class="logo-title">Download<em>Manager</em></span>
        <span class="logo-version">${APP_VERSION}</span>
      </div>
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
