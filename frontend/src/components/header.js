import { store } from '../state/store.js';
import { setSpeedLimit } from '../services/api.js';

export function renderHeader(container) {
  container.innerHTML = `
    <button id="sidebar-toggle"><i class="fas fa-bars"></i></button>
    <div class="header-logo">
      <i class="fas fa-download"></i>
      <span>Web Download Manager</span>
    </div>
    <div class="header-spacer"></div>
    <div class="header-controls">
      <div id="speed-control">
        <i class="fas fa-gauge-high" title="Global Speed Limit"></i>
        <input type="number" id="speed-limit-input" min="0" value="${store.globalSpeedLimit}" placeholder="KB/s">
        <span style="font-size:0.75rem;color:var(--text-muted)">KB/s</span>
      </div>
      <button class="btn btn-primary" id="header-add-btn"><i class="fas fa-plus"></i> Add</button>
      <button class="btn btn-icon" id="header-settings-btn" title="Settings"><i class="fas fa-gear"></i></button>
      <button class="btn btn-icon" id="header-theme-btn" title="Toggle Theme"><i class="fas fa-moon"></i></button>
    </div>
  `;

  document.getElementById('sidebar-toggle').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };

  document.getElementById('header-add-btn').onclick = () => {
    document.getElementById('add-url-modal').classList.remove('hidden');
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

  const speedInput = document.getElementById('speed-limit-input');
  let speedTimeout;
  speedInput.oninput = () => {
    clearTimeout(speedTimeout);
    speedTimeout = setTimeout(async () => {
      const val = parseInt(speedInput.value, 10) || 0;
      await setSpeedLimit(val * 1024);
    }, 500);
  };
}
