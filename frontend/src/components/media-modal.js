import { probeMedia, addMedia } from '../services/api.js';

const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|tiktok\.com)$/i;

export function isMediaUrl(url) {
  try { return MEDIA_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

function formatBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `~${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatDuration(s) {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

const $ = (id) => document.getElementById(id);

/**
 * Reads the video / playlist and asks which resolution to download.
 * Resolves with the number of downloads queued (0 if cancelled). Throws if the URL can't be read.
 */
export async function pickMediaQuality(url) {
  const info = await probeMedia(url);
  const modal = $('media-modal');
  const qualitiesEl = $('media-qualities');
  const entriesEl = $('media-entries');
  const errorEl = $('media-error');
  const confirmBtn = $('media-confirm');
  const toggleBtn = $('media-toggle-all');

  $('media-name').textContent = info.title;
  $('media-meta').textContent = info.isPlaylist
    ? `Playlist · ${info.entries.length} videos`
    : [new URL(url).hostname.replace(/^www\./, ''), formatDuration(info.entries[0]?.duration)].filter(Boolean).join(' · ');
  const thumb = $('media-thumb');
  thumb.classList.toggle('hidden', !info.thumbnail);
  if (info.thumbnail) thumb.src = info.thumbnail; else thumb.removeAttribute('src');
  $('media-ffmpeg-note').classList.toggle('hidden', info.hasFfmpeg);
  errorEl.classList.add('hidden');

  let selected = info.qualities.find(q => q.height && q.height <= 1080)?.id || info.qualities[0].id;
  qualitiesEl.innerHTML = '';
  for (const q of info.qualities) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-quality';
    btn.setAttribute('role', 'radio');
    btn.dataset.id = q.id;
    btn.innerHTML = `<span></span><small></small>`;
    btn.querySelector('span').textContent = q.label;
    btn.querySelector('small').textContent = q.id === 'audio' ? (formatBytes(q.size) || 'Sound only') : (formatBytes(q.size) || (q.height ? 'MP4' : ''));
    qualitiesEl.appendChild(btn);
  }
  const markSelected = () => qualitiesEl.querySelectorAll('.media-quality')
    .forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === selected)));
  markSelected();
  qualitiesEl.onclick = (e) => {
    const b = e.target.closest('.media-quality');
    if (b) { selected = b.dataset.id; markSelected(); }
  };

  $('media-entries-wrap').classList.toggle('hidden', !info.isPlaylist);
  entriesEl.innerHTML = '';
  if (info.isPlaylist) {
    info.entries.forEach((en, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<label><input type="checkbox" checked data-i="${i}"><span></span><small></small></label>`;
      li.querySelector('span').textContent = `${i + 1}. ${en.title}`;
      li.querySelector('small').textContent = formatDuration(en.duration);
      entriesEl.appendChild(li);
    });
  }
  const boxes = () => [...entriesEl.querySelectorAll('input[type=checkbox]')];
  const updateToggle = () => { toggleBtn.textContent = boxes().every(b => b.checked) ? 'Select none' : 'Select all'; };
  entriesEl.onchange = updateToggle;
  toggleBtn.onclick = () => { const all = boxes().every(b => b.checked); boxes().forEach(b => { b.checked = !all; }); updateToggle(); };
  updateToggle();

  modal.classList.remove('hidden');

  return new Promise((resolve) => {
    const finish = (n) => { modal.classList.add('hidden'); resolve(n); };
    $('media-close').onclick = $('media-cancel').onclick = () => finish(0);
    modal.onclick = (e) => { if (e.target === modal) finish(0); };
    confirmBtn.onclick = async () => {
      const items = info.isPlaylist
        ? boxes().filter(b => b.checked).map(b => info.entries[+b.dataset.i])
        : info.entries;
      if (items.length === 0) {
        errorEl.textContent = 'Select at least one video';
        errorEl.classList.remove('hidden');
        return;
      }
      try {
        confirmBtn.disabled = true;
        const res = await addMedia(items.map(({ url, title }) => ({ url, title })), selected);
        finish(res.downloads.length);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      } finally {
        confirmBtn.disabled = false;
      }
    };
  });
}
