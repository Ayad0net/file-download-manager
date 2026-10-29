// Shared by the popup and the YouTube/TikTok content script.
var DMQuality = {
  isMediaUrl(url) {
    try { return /(^|\.)(youtube\.com|youtu\.be|tiktok\.com)$/i.test(new URL(url).hostname); } catch { return false; }
  },
  // Pages where there is something to download (not the YouTube home page, search, etc.).
  isMediaPage(url) {
    try {
      const u = new URL(url);
      if (/tiktok\.com$/i.test(u.hostname)) return /\/video\/\d+/.test(u.pathname);
      if (/youtu\.be$/i.test(u.hostname)) return u.pathname.length > 1;
      return /^\/(watch|shorts\/|playlist|live\/)/.test(u.pathname) && (u.searchParams.has('v') || u.searchParams.has('list') || /^\/(shorts|live)\//.test(u.pathname));
    } catch { return false; }
  },
  size(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `~${n.toFixed(i ? 1 : 0)} ${u[i]}`;
  },
  duration(s) {
    if (!s) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
  },
  defaultId(qualities) {
    return (qualities.find(q => q.height && q.height <= 1080) || qualities[0]).id;
  },
  // Renders quality buttons into `el`; returns a getter for the selected id.
  render(el, qualities, className) {
    let selected = this.defaultId(qualities);
    el.textContent = '';
    for (const q of qualities) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className;
      b.setAttribute('role', 'radio');
      b.dataset.id = q.id;
      b.textContent = q.label.replace('Audio only (MP3)', 'MP3 audio').replace('Audio only', 'Audio');
      const small = document.createElement('small');
      small.textContent = this.size(q.size) || (q.id === 'audio' ? 'sound only' : '');
      b.appendChild(small);
      el.appendChild(b);
    }
    const mark = () => el.querySelectorAll('[data-id]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === selected)));
    el.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) { selected = b.dataset.id; mark(); } };
    mark();
    return () => selected;
  },
  // Playlist links that also point to one video: offer the single video or the whole list.
  playlistChoice(url) {
    try {
      const u = new URL(url);
      return u.searchParams.has('v') && u.searchParams.has('list');
    } catch { return false; }
  },
  singleVideoUrl(url) {
    const u = new URL(url);
    u.searchParams.delete('list'); u.searchParams.delete('index'); u.searchParams.delete('start_radio');
    return u.toString();
  },
  playlistUrl(url) {
    const u = new URL(url);
    return `https://www.youtube.com/playlist?list=${u.searchParams.get('list')}`;
  },
};
