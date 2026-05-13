class Store {
  constructor() {
    this.downloads = [];
    this.stats = { total: 0, active: 0, completed: 0, failed: 0, paused: 0, queued: 0 };
    this.globalSpeedLimit = 0;
    this.maxConcurrent = 3;
    this.filter = 'all';
    this.listeners = [];
    this.pollInterval = null;
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
    this.downloads = data.downloads || [];
    this.stats = data.stats || this.stats;
    this.globalSpeedLimit = data.globalSpeedLimit ?? this.globalSpeedLimit;
    this.maxConcurrent = data.maxConcurrent ?? this.maxConcurrent;
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
      const res = await fetch('/api/downloads');
      const data = await res.json();
      this.setDownloads(data);
    } catch (e) {
      // silent
    }
  }
}

export const store = new Store();
