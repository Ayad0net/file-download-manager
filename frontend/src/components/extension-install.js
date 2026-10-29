import { API_BASE } from '../services/api.js';
import { store } from '../state/store.js';

// Guided install of the browser extension. Browsers only accept extensions from their stores
// or loaded by hand in developer mode, so this walks the user through "Load unpacked".
const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const NEVER_KEY = 'dm-ext-install-never';
const SEEN_KEY = 'dm-ext-connected-once';

// Web version (or no browser found): every supported browser, steps only.
const ALL = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', page: 'chrome://extensions' },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', page: 'edge://extensions' },
  { id: 'brave', name: 'Brave', kind: 'chromium', page: 'brave://extensions' },
  { id: 'opera', name: 'Opera', kind: 'chromium', page: 'opera://extensions' },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', page: 'vivaldi://extensions' },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', page: 'about:debugging#/runtime/this-firefox' },
];
const ICONS = { chrome: 'fa-chrome', edge: 'fa-edge', brave: 'fa-brave', opera: 'fa-opera', vivaldi: 'fa-globe', firefox: 'fa-firefox-browser' };

let open = false;
let folder = null;

async function getJson(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); window.showToast?.(`Copied ${text}`, 'success'); }
  catch { window.showToast?.(`Type ${text} in the address bar`, 'info'); }
}

function step(html) {
  const li = document.createElement('li');
  li.innerHTML = html;
  $('ei-list').appendChild(li);
  return li;
}

async function choose(b) {
  $('ei-pick').hidden = true;
  $('ei-steps').hidden = false;
  $('ei-back').hidden = false;
  $('ei-list').innerHTML = '';
  $('ei-wait').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Waiting for the extension to connect…';

  if (tauri?.core) {
    // Fresh unpacked copy (with this app's address) + bring the browser up.
    try {
      const r = await getJson(`/browser/installed/${b.id}/open`, { method: 'POST' });
      folder = b.kind === 'firefox' ? r.manifest : r.folder;
    } catch (err) {
      window.showToast?.(err.message, 'error');
    }
  }
  const pageStep = step(`In ${b.name}, open <code class="br-key">${b.page}</code> in the address bar <button class="btn btn-secondary btn-sm" data-copy>Copy</button>`);
  pageStep.querySelector('[data-copy]').onclick = () => copy(b.page);
  if (tauri?.core) copy(b.page);

  if (b.kind === 'firefox') {
    step('Click <b>Load Temporary Add-on…</b>');
  } else {
    step('Turn on <b>Developer mode</b> (top right)');
    step('Click <b>Load unpacked</b>');
  }
  const pick = b.kind === 'firefox' ? '<b>manifest.json</b> in the <b>Download Manager Extension</b> folder' : 'the <b>Download Manager Extension</b> folder';
  if (tauri?.core && folder) {
    const li = step(`Choose ${pick} <button class="btn btn-secondary btn-sm" data-show>Show folder</button>`);
    li.querySelector('[data-show]').onclick = () => tauri.opener.revealItemInDir(folder).catch(() => {});
    tauri.opener.revealItemInDir(folder).catch(() => {});
  } else {
    const li = step(`<a href="${API_BASE}/browser/extension.zip" download>Download the extension</a>, unzip it, then choose ${pick}`);
    li.querySelector('a').onclick = (e) => e.stopPropagation();
  }
  if (b.kind === 'firefox') step('<span class="ei-note">Firefox removes add-ons loaded this way when it restarts.</span>');
}

async function render() {
  $('ei-pick').hidden = false;
  $('ei-steps').hidden = true;
  $('ei-back').hidden = true;
  let list = ALL;
  if (tauri?.core) {
    try { list = (await getJson('/browser/installed')).browsers; } catch {}
    if (!list.length) list = ALL;
  }
  $('ei-browsers').innerHTML = '';
  for (const b of list) {
    const btn = document.createElement('button');
    btn.className = 'ei-browser';
    const brand = b.id === 'vivaldi' ? 'fas' : 'fab';
    btn.innerHTML = `<i class="${brand} ${ICONS[b.id] || 'fa-globe'}"></i><span>${b.name}</span>`;
    btn.onclick = () => choose(b);
    $('ei-browsers').appendChild(btn);
  }
}

export function openExtensionInstall() {
  open = true;
  $('ei-never').checked = localStorage.getItem(NEVER_KEY) === '1';
  $('ext-install-modal').classList.remove('hidden');
  render();
}

function close() {
  open = false;
  if ($('ei-never').checked) localStorage.setItem(NEVER_KEY, '1');
  else localStorage.removeItem(NEVER_KEY);
  $('ext-install-modal').classList.add('hidden');
}

export function initExtensionInstall() {
  $('ei-close').onclick = close;
  $('ei-later').onclick = close;
  $('ei-back').onclick = render;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });

  // Close with a success message as soon as the extension checks in.
  store.subscribe(() => {
    if (!store.browser?.connected) return;
    localStorage.setItem(SEEN_KEY, '1');
    if (!open) return;
    if ($('ei-steps').hidden) return close(); // it was already installed
    $('ei-wait').innerHTML = `<span class="br-ok"><i class="fas fa-circle-check"></i> ${store.browser.name} connected</span>`;
    setTimeout(() => { if (open) close(); window.showToast?.('Browser extension installed', 'success'); }, 1200);
  });

  // On start, offer it unless a browser has ever connected or the user said not to ask.
  // (If the extension is installed but hasn't checked in yet, the dialog closes when it does.)
  setTimeout(() => {
    if (store.browser?.connected || localStorage.getItem(SEEN_KEY) || localStorage.getItem(NEVER_KEY)) return;
    openExtensionInstall();
  }, 3000);
}
