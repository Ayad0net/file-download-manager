const API_BASE = '/api';

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
  if (!res.ok) throw new Error('Failed to add downloads');
  return res.json();
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

export async function clearCompleted() {
  const res = await fetch(`${API_BASE}/actions/clear-completed`, { method: 'POST' });
  return res.json();
}
