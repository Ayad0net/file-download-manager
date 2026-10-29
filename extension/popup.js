const api = globalThis.chrome; // also defined (callbacks + promises) in Firefox
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((resolve) => api.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: api.runtime.lastError?.message || 'No response' })));

function show(id, on = true) { $(id).classList.toggle('hidden', !on); }
function message(text, kind = 'ok') {
  const el = $('msg');
  el.textContent = text;
  el.className = `msg ${kind}`;
}

async function init() {
  const s = await api.storage.local.get(['serverUrl', 'intercept', 'minSizeMB', 'extensions', 'pendingMediaUrl']);
  $('intercept').checked = s.intercept !== false;
  $('intercept').onchange = () => api.storage.local.set({ intercept: $('intercept').checked });
  $('settings-btn').onclick = openSettings;
  $('back').onclick = () => location.reload();
  $('save').onclick = saveSettings;
  $('retry').onclick = () => location.reload();
  $('add-url').onclick = addUrls;

  if (location.hash === '#settings') return openSettings();

  const ping = await send({ type: 'ping' });
  const state = ping.ok ? ping.data.state : 'offline';
  $('conn').textContent = state === 'ok' ? '● Connected' : '● Offline';
  $('conn').className = `conn ${state === 'ok' ? 'ok' : 'bad'}`;
  if (state !== 'ok') return show('offline');

  show('quick');
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const target = s.pendingMediaUrl || tab?.url;
  if (s.pendingMediaUrl) api.storage.local.remove('pendingMediaUrl');
  if (target && DMQuality.isMediaUrl(target) && (s.pendingMediaUrl || DMQuality.isMediaPage(target))) loadMedia(target);
}

async function loadMedia(url) {
  show('media');
  $('title').textContent = 'Video on this page';
  const both = DMQuality.playlistChoice(url);
  const res = await send({ type: 'probe', url: both ? DMQuality.singleVideoUrl(url) : url });
  show('media-loading', false);
  if (!res.ok) { $('meta').textContent = res.error; return; }
  const info = res.data;
  $('title').textContent = info.title;
  $('meta').textContent = info.isPlaylist ? `Playlist · ${info.entries.length} videos` : DMQuality.duration(info.entries[0]?.duration);
  if (info.thumbnail) { $('thumb').src = info.thumbnail; show('thumb'); }
  const selected = DMQuality.render($('qualities'), info.qualities, 'q');

  // Watching a video inside a playlist: optionally queue the whole playlist.
  let playlist = null;
  if (both) {
    show('playlist-wrap');
    $('playlist-label').textContent = 'Whole playlist (loading…)';
    $('whole-playlist').checked = false;
    send({ type: 'probe', url: DMQuality.playlistUrl(url) }).then(r => {
      if (r.ok && r.data.isPlaylist) { playlist = r.data; $('playlist-label').textContent = `Whole playlist: ${playlist.title} (${playlist.entries.length} videos)`; }
      else show('playlist-wrap', false);
    });
  }

  $('media-dl').disabled = false;
  $('media-dl').onclick = async () => {
    const items = (playlist && $('whole-playlist').checked ? playlist.entries : info.entries).map(({ url, title }) => ({ url, title }));
    $('media-dl').disabled = true;
    const r = await send({ type: 'addMedia', items, quality: selected() });
    $('media-dl').disabled = false;
    if (r.ok) message(`Added ${r.data.downloads.length} video(s) to Download Manager`);
    else message(r.error, 'bad');
  };
}

async function addUrls() {
  const urls = $('url').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!urls.length) return message('Paste at least one link', 'bad');
  const media = urls.filter(u => DMQuality.isMediaUrl(u));
  if (media.length === 1 && urls.length === 1) { $('url').value = ''; return loadMedia(media[0]); }
  const r = await send({ type: 'addUrls', urls });
  if (r.ok) { message(`Added ${r.data.added} download(s)`); $('url').value = ''; }
  else message(r.error, 'bad');
}

async function openSettings() {
  ['offline', 'media', 'quick'].forEach(id => show(id, false));
  show('settings');
  const s = await api.storage.local.get(['serverUrl', 'captureMode', 'minSizeMB', 'extensions']);
  $('mode').value = s.captureMode || 'all';
  $('server').value = s.serverUrl || 'http://127.0.0.1:17890';
  $('min-size').value = s.minSizeMB ?? 1;
  $('exts').value = s.extensions || DM_DEFAULT_EXTENSIONS;
}

async function saveSettings() {
  let server = $('server').value.trim().replace(/\/+$/, '');
  try { const u = new URL(server); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return message('Enter a valid http:// address', 'bad'); }
  await api.storage.local.set({
    serverUrl: server,
    captureMode: $('mode').value,
    minSizeMB: Math.max(0, Number($('min-size').value) || 0),
  });
  // Store a custom list only; otherwise keep following the built-in list as it grows.
  const exts = $('exts').value.trim().toLowerCase().split(/[\s,]+/).filter(Boolean).join(' ');
  if (!exts || exts === DM_DEFAULT_EXTENSIONS) await api.storage.local.remove('extensions');
  else await api.storage.local.set({ extensions: exts });
  const r = await send({ type: 'ping' });
  const state = r.ok ? r.data.state : 'offline';
  message(state === 'ok' ? 'Saved · connected to the app' : 'Saved, but the app is not reachable at that address', state === 'ok' ? 'ok' : 'bad');
}

init();
