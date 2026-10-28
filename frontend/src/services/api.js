// In the Tauri desktop app the backend runs as a sidecar on a fixed local port.
export const API_BASE = window.__TAURI_INTERNALS__ ? 'http://127.0.0.1:17890/api' : '/api';

export async function fetchDownloads() {
  const res = await fetch(`${API_BASE}/downloads`);
  if (!res.ok) throw new Error('Failed to fetch downloads');
  return res.json();
}

export async function addDownloads(urls, filenames) {
  const res = await fetch(`${API_BASE}/downloads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, filenames }),
  });
  if (!res.ok && res.status !== 400) throw new Error('Failed to add downloads');
  return res.json();
}

export async function addTorrentFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  const res = await fetch(`${API_BASE}/downloads/torrent`, { method: 'POST', body: form });
  // 400 still carries per-file error details for the caller to show.
  if (!res.ok && res.status !== 400) throw new Error('Failed to add torrent files');
  return res.json();
}

export async function probeMedia(url) {
  const res = await fetch(`${API_BASE}/downloads/media/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not read video info');
  return data;
}

export async function addMedia(items, quality) {
  const res = await fetch(`${API_BASE}/downloads/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, quality }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add videos');
  return data;
}

export async function pauseDownload(id) {
  const res = await fetch(`${API_BASE}/downloads/${id}/pause`, { method: 'POST' });
  return res.json();
}

export async function resumeDownload(id) {
  const res = await fetch(`${API_BASE}/downloads/${id}/resume`, { method: 'POST' });
  return res.json();
}

export async function stopDownload(id) {
  const res = await fetch(`${API_BASE}/downloads/${id}/stop`, { method: 'POST' });
  return res.json();
}

export async function retryDownload(id) {
  const res = await fetch(`${API_BASE}/downloads/${id}/retry`, { method: 'POST' });
  return res.json();
}

export async function deleteDownload(id) {
  const res = await fetch(`${API_BASE}/downloads/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function reorderDownloads(ids) {
  const res = await fetch(`${API_BASE}/downloads/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${API_BASE}/stats`);
  return res.json();
}

export async function getSettings() {
  const res = await fetch(`${API_BASE}/settings`);
  return res.json();
}

export async function setSpeedLimit(limit) {
  const res = await fetch(`${API_BASE}/settings/speed-limit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  });
  return res.json();
}

export async function setMaxConcurrent(count) {
  const res = await fetch(`${API_BASE}/settings/max-concurrent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  return res.json();
}

export async function setConnections(count) {
  const res = await fetch(`${API_BASE}/settings/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  return res.json();
}

export async function pauseAll() {
  const res = await fetch(`${API_BASE}/actions/pause-all`, { method: 'POST' });
  return res.json();
}

export async function resumeAll() {
  const res = await fetch(`${API_BASE}/actions/resume-all`, { method: 'POST' });
  return res.json();
}

export async function stopAll() {
  const res = await fetch(`${API_BASE}/actions/stop-all`, { method: 'POST' });
  return res.json();
}

export async function clearUncompleted() {
  const res = await fetch(`${API_BASE}/actions/clear-uncompleted`, { method: 'POST' });
  return res.json();
}
