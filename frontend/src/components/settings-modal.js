import { setMaxConcurrent, setSpeedLimit } from '../services/api.js';
import { store } from '../state/store.js';

const ACCENTS = [
  { value: 'blue', name: 'Slate', color: '#3b82f6' },
  { value: 'ocean', name: 'Ocean', color: '#0ea5e9' },
  { value: 'forest', name: 'Forest', color: '#22c55e' },
  { value: 'violet', name: 'Violet', color: '#8b5cf6' },
  { value: 'rose', name: 'Rose', color: '#f43f5e' },
  { value: 'amber', name: 'Amber', color: '#f59e0b' },
  { value: 'teal', name: 'Teal', color: '#14b8a6' },
];

export function applyTheme(mode, accent) {
  document.documentElement.setAttribute('data-mode', mode);
  document.documentElement.setAttribute('data-accent', accent || 'blue');
  localStorage.setItem('dm-mode', mode);
  localStorage.setItem('dm-accent', accent || 'blue');
  const icon = document.getElementById('header-theme-btn')?.querySelector('i');
  if (icon) icon.className = mode === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

export function toggleTheme() {
  const next = (document.documentElement.getAttribute('data-mode') === 'light') ? 'dark' : 'light';
  applyTheme(next, document.documentElement.getAttribute('data-accent') || 'blue');
}

export function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const card = modal.querySelector('.settings-modal');
  const saveBtn = document.getElementById('settings-save');
  const cancelBtn = document.getElementById('settings-cancel');
  const closeBtn = document.getElementById('settings-close');
  const modeSeg = document.getElementById('setting-mode-seg');
  const accentGrid = document.getElementById('setting-accent-seg');

  accentGrid.innerHTML = ACCENTS.map(t => `
    <button type="button" class="theme-swatch" data-value="${t.value}" title="${t.name}">
      <span class="dot" style="--sw:${t.color}"></span>
      <span>${t.name}</span>
    </button>
  `).join('');

  function getMode() {
    return document.getElementById('setting-mode').value;
  }

  function getAccent() {
    return document.getElementById('setting-accent').value;
  }

  function setModeSelection(value) {
    document.getElementById('setting-mode').value = value;
    modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  }

  function setAccentSelection(value) {
    document.getElementById('setting-accent').value = value;
    accentGrid.querySelectorAll('.theme-swatch').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  }

  function close() {
    modal.classList.add('hidden');
  }

  window.openSettings = () => {
    document.getElementById('setting-concurrent').value = store.maxConcurrent;
    document.getElementById('setting-speed-limit').value = Math.round((store.globalSpeedLimit || 0) / 1024);
    setModeSelection(document.documentElement.getAttribute('data-mode') || 'dark');
    setAccentSelection(document.documentElement.getAttribute('data-accent') || 'blue');
    modal.classList.remove('hidden');
    card.classList.remove('animating');
    void card.offsetWidth;
    card.classList.add('animating');
  };

  modeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (btn) setModeSelection(btn.dataset.value);
  });

  accentGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-swatch');
    if (btn) setAccentSelection(btn.dataset.value);
  });

  closeBtn.onclick = close;
  cancelBtn.onclick = close;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  saveBtn.onclick = async () => {
    const concurrent = parseInt(document.getElementById('setting-concurrent').value, 10) || 3;
    const speedLimit = parseInt(document.getElementById('setting-speed-limit').value, 10) || 0;

    try {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
      await setMaxConcurrent(concurrent);
      await setSpeedLimit(speedLimit * 1024);
      applyTheme(getMode(), getAccent());
      window.showToast('Settings saved', 'success');
      close();
    } catch (err) {
      window.showToast(err.message || 'Failed to save settings', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Changes';
    }
  };
}
