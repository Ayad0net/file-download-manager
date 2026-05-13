import { setMaxConcurrent, setSpeedLimit } from '../services/api.js';
import { store } from '../state/store.js';

export function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const saveBtn = document.getElementById('settings-save');
  const cancelBtn = document.getElementById('settings-cancel');
  const closeBtn = document.getElementById('settings-close');

  function close() {
    modal.classList.add('hidden');
  }

  closeBtn.onclick = close;
  cancelBtn.onclick = close;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  saveBtn.onclick = async () => {
    const concurrent = parseInt(document.getElementById('setting-concurrent').value, 10) || 3;
    const speedLimit = parseInt(document.getElementById('setting-speed-limit').value, 10) || 0;
    const theme = document.getElementById('setting-theme').value;

    await setMaxConcurrent(concurrent);
    await setSpeedLimit(speedLimit * 1024);
    document.documentElement.setAttribute('data-theme', theme);

    const icon = document.getElementById('header-theme-btn')?.querySelector('i');
    if (icon) icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';

    window.showToast('Settings saved', 'success');
    close();
  };
}
