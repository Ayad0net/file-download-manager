import { API_BASE } from '../services/api.js';
import { store, CATEGORIES, categoryOf } from '../state/store.js';

// Downloads caught by the browser extension: bring the app forward and ask before starting.
const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
let current = null; // request shown in the dialog
const dismissed = new Set();
let nameEdited = false;

function formatBytes(n) {
  if (!n) return 'Unknown size';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

async function bringToFront() {
  const win = tauri?.window?.getCurrentWindow?.();
  if (!win) return window.focus();
  try {
    await win.show();
    await win.unminimize();
    await win.setFocus();
  } catch {}
}

function render(req) {
  $('br-req-name').value = req.filename;
  const host = (() => { try { return new URL(req.referrer || req.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  $('br-req-meta').textContent = [req.probing && !req.size ? 'Checking size…' : formatBytes(req.size), host, req.browser].filter(Boolean).join(' · ');
  $('br-req-url').textContent = req.url;
  $('br-req-url').title = req.url;
  const cat = CATEGORIES.find(c => c.key === categoryOf({ filename: req.filename }));
  $('br-req-icon').className = `file-icon cat-${cat?.key || 'other'}`;
  $('br-req-icon').innerHTML = `<i class="fas ${cat?.icon || 'fa-file'}"></i>`;
  const waiting = store.browserRequests.filter(r => !dismissed.has(r.id)).length - 1;
  $('br-req-count').textContent = waiting > 0 ? `+${waiting} more waiting` : '';
}

function update() {
  const open = store.browserRequests.filter(r => !dismissed.has(r.id));
  if (current) {
    const fresh = open.find(r => r.id === current.id);
    if (fresh) {
      // Refresh size/name found by the probe, but keep a name the user typed.
      const typed = $('br-req-name').value;
      current = fresh;
      render(nameEdited ? { ...fresh, filename: typed } : fresh);
      return;
    }
    current = null;
  }
  if (!open.length) return $('browser-request-modal').classList.add('hidden');
  current = open[0];
  nameEdited = false;
  render(current);
  $('br-req-paused').checked = false;
  $('browser-request-modal').classList.remove('hidden');
  bringToFront();
  $('br-req-start').focus();
}

async function decide(accept) {
  if (!current) return;
  const req = current;
  dismissed.add(req.id);
  current = null;
  const body = accept ? { filename: $('br-req-name').value.trim(), paused: $('br-req-paused').checked } : {};
  try {
    const res = await fetch(`${API_BASE}/browser/request/${req.id}/${accept ? 'accept' : 'reject'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed');
    if (accept) window.showToast?.(`${body.paused ? 'Added' : 'Downloading'}: ${data.download?.filename || req.filename}`, 'success');
  } catch (err) {
    window.showToast?.(err.message, 'error');
  }
  update();
}

export function initBrowserRequests() {
  $('br-req-start').onclick = () => decide(true);
  $('br-req-cancel').onclick = () => decide(false);
  $('br-req-name').addEventListener('input', () => { nameEdited = true; });
  $('br-req-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') decide(true); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) decide(false);
  });
  store.subscribe(update);
}
