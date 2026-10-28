import { API_BASE } from '../services/api.js';
class Store {
  constructor() {
    this.downloads = [];
    this.stats = { total: 0, active: 0, completed: 0, failed: 0, paused: 0, queued: 0, totalDownloadedBytes: 0, freeDiskBytes: null };
    this.globalSpeedLimit = 0;
    this.maxConcurrent = 3;
    this.connectionsPerDownload = 8;
    this.filter = 'all';
    this.view = ['cards', 'table'].includes(localStorage.getItem('dm-view')) ? localStorage.getItem('dm-view') : 'list';
    this.listeners = [];
    this.pollInterval = null;
    this.loaded = false;
    // Table sort: { key, dir } or null for queue order.
    try { this.sort = JSON.parse(localStorage.getItem('dm-sort')) || null; } catch { this.sort = null; }
  }

  // Cycles a column: ascending -> descending -> off (queue order).
  toggleSort(key) {
    if (this.sort?.key !== key) this.sort = { key, dir: 'asc' };
    else if (this.sort.dir === 'asc') this.sort = { key, dir: 'desc' };
    else this.sort = null;
    localStorage.setItem('dm-sort', JSON.stringify(this.sort));
    this.notify();
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  notify() {
    for (const fn of this.listeners) {
      fn(this);
    }
  }

  setDownloads(data) {
    // Skip re-rendering when nothing changed.
    const key = JSON.stringify(data);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.downloads = data.downloads || [];
    this.stats = data.stats || this.stats;
    this.globalSpeedLimit = data.globalSpeedLimit ?? this.globalSpeedLimit;
    this.maxConcurrent = data.maxConcurrent ?? this.maxConcurrent;
    this.connectionsPerDownload = data.connectionsPerDownload ?? this.connectionsPerDownload;
    this.notify();
  }

  setView(view) {
    this.view = view;
    localStorage.setItem('dm-view', view);
    this.notify();
  }

  setFilter(filter) {
    this.filter = filter;
    this.notify();
  }

  getFilteredDownloads() {
    if (this.filter === 'all') return this.downloads;
    return this.downloads.filter(d => d.status === this.filter);
  }

  // Prefer live server-pushed updates; fall back to polling while the stream is down.
  startLiveUpdates(interval = 1500) {
    this.startPolling(interval);
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API_BASE}/events`);
    es.onopen = () => this.stopPolling();
    es.onmessage = (e) => {
      this.loaded = true;
      this.setDownloads(JSON.parse(e.data));
    };
    es.onerror = () => {
      if (!this.pollInterval) this.startPolling(interval);
    };
  }

  startPolling(interval = 1500) {
    this.poll();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.poll(), interval);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async poll() {
    try {
      const res = await fetch(`${API_BASE}/downloads`);
      const data = await res.json();
      this.loaded = true;
      this.setDownloads(data);
    } catch (e) {
      // Backend not reachable yet (e.g. desktop sidecar still starting): retry quickly instead of waiting a full poll interval.
      if (!this.loaded) setTimeout(() => this.poll(), 150);
    }
  }
}

export const store = new Store();
