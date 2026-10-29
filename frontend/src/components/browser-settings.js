import { API_BASE } from '../services/api.js';
import { openExtensionInstall } from './extension-install.js';

// Settings > Browser: extension download and connection status.
const $ = (id) => document.getElementById(id);

async function getJson(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function loadBrowserPane() {
  try {
    const p = await getJson('/browser/info');
    $('br-url').textContent = p.serverUrl;
    $('br-status').innerHTML = p.connected
      ? `<span class="br-ok"><i class="fas fa-circle-check"></i> ${p.name} connected</span>`
      : 'Not connected. Install the extension, then keep the browser open.';
    $('br-get').disabled = !p.extensionAvailable;
    if (!p.extensionAvailable) $('br-status').textContent = 'The extension files are not included in this build.';
  } catch (err) {
    $('br-status').textContent = err.message;
  }
}

export function initBrowserSettings() {
  // Step-by-step install (saves the extension, brings the browser up, waits for it to connect).
  $('br-get').onclick = () => {
    document.getElementById('settings-modal').classList.add('hidden');
    openExtensionInstall();
  };
}
