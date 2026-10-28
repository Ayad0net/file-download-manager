import { setMaxConcurrent, setSpeedLimit, setConnections } from '../services/api.js';
import { store } from '../state/store.js';
import { confirmAction } from './confirm-modal.js';

const ACCENTS = [
  { value: 'blue', name: 'Slate', color: '#3b82f6' },
  { value: 'ocean', name: 'Ocean', color: '#0ea5e9' },
  { value: 'forest', name: 'Forest', color: '#22c55e' },
  { value: 'violet', name: 'Violet', color: '#8b5cf6' },
  { value: 'rose', name: 'Rose', color: '#f43f5e' },
  { value: 'amber', name: 'Amber', color: '#f59e0b' },
  { value: 'teal', name: 'Teal', color: '#14b8a6' },
];

const THEME_FADE_MS = 350;
const tauri = window.__TAURI__;

export function applyTheme(mode, accent) {
  const root = document.documentElement;
  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    root.classList.add('theme-transition');
    clearTimeout(applyTheme._fadeTimer);
    applyTheme._fadeTimer = setTimeout(() => {
      root.classList.remove('theme-transition');
    }, THEME_FADE_MS);
  }
  root.setAttribute('data-mode', mode);
  root.setAttribute('data-accent', accent || 'blue');
  localStorage.setItem('dm-mode', mode);
  localStorage.setItem('dm-accent', accent || 'blue');
  const icon = document.getElementById('header-theme-btn')?.querySelector('i');
  if (icon) icon.className = mode === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

export function toggleTheme() {
  const next = (document.documentElement.getAttribute('data-mode') === 'light') ? 'dark' : 'light';
  applyTheme(next, document.documentElement.getAttribute('data-accent') || 'blue');
}

/** Bytes per second as a short label, e.g. "512 KB/s", "2.4 MB/s". */
function formatRate(bytesPerSec) {
  const units = ['KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSec / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Reads a number input, clamps it to its min/max and writes the clamped value back. */
function readClamped(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const parsed = parseInt(input.value, 10);
  const value = Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : min));
  input.value = value;
  return value;
}

// Desktop app only: login item (autostart plugin) and close-to-tray (Rust-side prefs).
async function loadDesktop() {
  const [autostart, prefs] = await Promise.all([
    tauri.core.invoke('plugin:autostart|is_enabled'),
    tauri.core.invoke('get_desktop_prefs'),
  ]);
  return { autostart, closeToTray: prefs.closeToTray };
}

async function saveDesktop({ autostart, closeToTray }) {
  const enabled = await tauri.core.invoke('plugin:autostart|is_enabled');
  if (enabled !== autostart) {
    await tauri.core.invoke(`plugin:autostart|${autostart ? 'enable' : 'disable'}`);
  }
  await tauri.core.invoke('set_desktop_prefs', { prefs: { closeToTray } });
}

export function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const dialog = modal.querySelector('.st-dialog');
  const tabs = [...modal.querySelectorAll('.st-nav-item')];
  const panes = [...modal.querySelectorAll('.st-pane')];
  const modeButtons = [...modal.querySelectorAll('[data-mode-value]')];
  const accentGrid = document.getElementById('setting-accent-seg');
  const speedInput = document.getElementById('setting-speed-limit');
  const speedLabel = document.getElementById('setting-speed-label');
  const hint = document.getElementById('settings-hint');
  const errorEl = document.getElementById('settings-error');
  const saveBtn = document.getElementById('settings-save');
  const numberFields = [
    document.getElementById('setting-concurrent'),
    document.getElementById('setting-connections'),
    speedInput,
  ];
  const autostartInput = document.getElementById('setting-autostart');
  const closeToTrayInput = document.getElementById('setting-close-to-tray');

  // Desktop-only rows and tabs stay hidden in the web version.
  modal.querySelectorAll('[data-desktop-only]').forEach(el => { el.hidden = !tauri?.core; });

  accentGrid.innerHTML = ACCENTS.map(a => `
    <button type="button" class="st-swatch" role="radio" data-accent-value="${a.value}" title="${a.name}">
      <span class="st-swatch-dot" style="--swatch:${a.color}"></span>
      <span>${a.name}</span>
    </button>
  `).join('');
  const accentButtons = [...accentGrid.querySelectorAll('[data-accent-value]')];

  let mode = 'dark';
  let accent = 'blue';
  let initial = '';

  const snapshot = () => JSON.stringify([
    ...numberFields.map(f => f.value),
    autostartInput.checked,
    closeToTrayInput.checked,
    mode,
    accent,
  ]);

  function refresh() {
    const kbPerSec = parseInt(speedInput.value, 10) || 0;
    speedLabel.textContent = kbPerSec > 0 ? formatRate(kbPerSec * 1024) : 'Unlimited';
    modeButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.modeValue === mode)));
    accentButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.accentValue === accent)));
    hint.hidden = snapshot() === initial;
  }

  function showTab(name) {
    tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    panes.forEach(p => { p.hidden = p.dataset.pane !== name; });
  }

  function close() {
    modal.classList.add('hidden');
  }

  async function requestClose() {
    if (snapshot() !== initial) {
      const discard = await confirmAction({
        title: 'Discard changes?',
        message: 'Settings you changed but did not save will be lost.',
        icon: 'fa-triangle-exclamation',
        tone: 'warning',
        confirmText: 'Discard',
      });
      if (!discard) return;
    }
    close();
  }

  window.openSettings = async () => {
    numberFields[0].value = store.maxConcurrent;
    numberFields[1].value = store.connectionsPerDownload;
    speedInput.value = Math.round((store.globalSpeedLimit || 0) / 1024);
    mode = document.documentElement.getAttribute('data-mode') || 'dark';
    accent = document.documentElement.getAttribute('data-accent') || 'blue';

    if (tauri?.core) {
      try {
        const desktop = await loadDesktop();
        autostartInput.checked = desktop.autostart;
        closeToTrayInput.checked = desktop.closeToTray;
      } catch (err) {
        console.error('Failed to load desktop settings', err);
      }
    }

    initial = snapshot();
    errorEl.hidden = true;
    showTab('downloads');
    refresh();
    modal.classList.remove('hidden');
    dialog.classList.remove('animating');
    void dialog.offsetWidth;
    dialog.classList.add('animating');
    tabs.find(t => t.classList.contains('active'))?.focus();
  };

  // One delegated handler for every control in the dialog.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) return requestClose();

    const tab = e.target.closest('.st-nav-item');
    if (tab) return showTab(tab.dataset.tab);

    const step = e.target.closest('[data-step]');
    if (step) {
      const input = document.getElementById(step.dataset.for);
      const delta = Number(step.dataset.delta || 1) * Number(step.dataset.step);
      const next = Math.min(Number(input.max), Math.max(Number(input.min), (parseInt(input.value, 10) || 0) + delta));
      input.value = next;
      return refresh();
    }

    const modeBtn = e.target.closest('[data-mode-value]');
    if (modeBtn) {
      mode = modeBtn.dataset.modeValue;
      return refresh();
    }

    const swatch = e.target.closest('[data-accent-value]');
    if (swatch) {
      accent = swatch.dataset.accentValue;
      refresh();
    }
  });

  modal.addEventListener('input', refresh);
  modal.addEventListener('change', refresh);

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type="number"]')) saveBtn.click();
  });

  document.getElementById('settings-close').onclick = requestClose;
  document.getElementById('settings-cancel').onclick = requestClose;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) requestClose();
  });

  saveBtn.onclick = async () => {
    const concurrent = readClamped(numberFields[0]);
    const connections = readClamped(numberFields[1]);
    const speedKb = readClamped(speedInput);
    refresh();

    errorEl.hidden = true;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    try {
      await setMaxConcurrent(concurrent);
      await setConnections(connections);
      await setSpeedLimit(speedKb * 1024);
      if (tauri?.core) {
        await saveDesktop({ autostart: autostartInput.checked, closeToTray: closeToTrayInput.checked });
      }
      applyTheme(mode, accent);
      initial = snapshot();
      refresh();
      window.showToast('Settings saved', 'success');
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Could not save settings';
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-check"></i> Save changes';
    }
  };
}
