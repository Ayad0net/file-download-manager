import { API_BASE } from '../services/api.js';

// File-type categories shown in the sidebar, matched by extension.
export const CATEGORIES = [
  { key: 'video', label: 'Video', icon: 'fa-film', ext: 'mp4 m4v mkv webm avi mov wmv flv f4v mpg mpeg mpe m2v m2ts mts ts vob 3gp 3g2 ogv rm rmvb asf divx xvid hevc h264 h265 mxf' },
  { key: 'music', label: 'Music', icon: 'fa-music', ext: 'mp3 m4a m4b aac flac wav wave aiff aif alac ogg oga opus wma ape wv mka mid midi amr ac3 dts caf ra au' },
  { key: 'documents', label: 'Documents', icon: 'fa-file-lines', ext: 'pdf doc docx docm dot dotx odt rtf txt md tex xls xlsx xlsm xlsb ods csv tsv ppt pptx pps ppsx odp key pages numbers epub mobi azw azw3 fb2 djvu xps oxps chm' },
  { key: 'programs', label: 'Programs', icon: 'fa-cube', ext: 'exe msi msix msixbundle appx appxbundle pkg mpkg app deb rpm appimage flatpak snap apk apks xapk aab ipa jar run sh bat cmd vsix crx xpi' },
  { key: 'compressed', label: 'Compressed', icon: 'fa-file-zipper', ext: 'zip rar 7z tar gz tgz bz2 tbz2 xz txz zst tzst lz lzma lz4 z cab arj ace lha lzh sit sitx war ear cpio pak' },
  { key: 'disk', label: 'Disk images', icon: 'fa-compact-disc', ext: 'iso img dmg vhd vhdx vmdk vdi qcow2 ova ovf toast nrg mdf mds cue bin wim esd' },
  { key: 'images', label: 'Images', icon: 'fa-image', ext: 'jpg jpeg jpe jfif png gif webp avif heic heif bmp tif tiff svg svgz ico icns psd ai eps raw cr2 cr3 nef arw dng orf rw2 raf xcf jxl tga exr hdr' },
  { key: 'other', label: 'Other', icon: 'fa-shapes', ext: '' },
].map(c => ({ ...c, ext: new Set(c.ext.split(' ').filter(Boolean)) }));

export function categoryOf(d) {
  const ext = (d.filename.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const hit = CATEGORIES.find(c => c.ext.has(ext));
  if (hit) return hit.key;
  if (d.kind === 'media') return d.mediaQuality === 'audio' ? 'music' : 'video';
  return 'other';
}

// Status chips above the list.
export const STATUS_GROUPS = {
  all: () => true,
  active: d => d.status === 'downloading' || d.status === 'connecting',
  waiting: d => d.status === 'queued' || d.status === 'paused' || d.status === 'stopped',
  completed: d => d.status === 'completed',
  failed: d => d.status === 'failed',
};

const SPEED_SAMPLES = 60;
class Store {
  constructor() {
    this.downloads = [];
    this.stats = { total: 0, active: 0, completed: 0, failed: 0, paused: 0, queued: 0, totalDownloadedBytes: 0, freeDiskBytes: null };
    this.globalSpeedLimit = 0;
    this.maxConcurrent = 3;
    this.connectionsPerDownload = 8;
    this.filter = 'all';      // status chip
    this.scope = 'all';       // sidebar: all | unfinished | finished | torrents | category:<key>
    this.search = '';
    this.speedHistory = [];
    this.peakSpeed = 0;
    this.view = localStorage.getItem('dm-view') === 'cards' ? 'cards' : 'table';
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
    this.browser = data.browser || null;
    this.browserRequests = data.browserRequests || [];
    const speed = this.totalSpeed();
    this.speedHistory = this.speedHistory.concat(speed).slice(-SPEED_SAMPLES);
    this.peakSpeed = Math.max(this.peakSpeed, speed);
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

  setScope(scope) {
    this.scope = scope;
    this.notify();
  }

  setSearch(text) {
    this.search = text;
    this.notify();
  }

  totalSpeed() {
    return this.downloads.reduce((n, d) => n + (d.status === 'downloading' ? d.speed || 0 : 0), 0);
  }

  inScope(d, scope = this.scope) {
    if (scope === 'unfinished') return d.status !== 'completed';
    if (scope === 'finished') return d.status === 'completed';
    if (scope === 'torrents') return d.kind === 'torrent';
    if (scope.startsWith('category:')) return categoryOf(d) === scope.slice(9);
    return true;
  }

  /** Sidebar scope + search, before the status chip. */
  getScopedDownloads() {
    const q = this.search.trim().toLowerCase();
    return this.downloads.filter(d => this.inScope(d)
      && (!q || d.filename.toLowerCase().includes(q) || d.url.toLowerCase().includes(q)));
  }

  getFilteredDownloads() {
    return this.getScopedDownloads().filter(STATUS_GROUPS[this.filter] || STATUS_GROUPS.all);
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
