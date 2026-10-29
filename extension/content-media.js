// YouTube / TikTok: floating "Download" button that opens a quality picker inside the page.
(() => {
  const api = globalThis.chrome;
  const send = (msg) => new Promise((resolve) => api.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: 'Extension not responding' })));

  const host = document.createElement('div');
  host.id = 'dm-integration';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .fab { position: fixed; right: 20px; bottom: 24px; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
        padding: 9px 14px; border: none; border-radius: 999px; background: #6366f1; color: #fff; font-size: 13px; font-weight: 600;
        box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; opacity: .92; transition: opacity .15s, transform .15s; }
      .fab:hover { opacity: 1; transform: translateY(-1px); }
      .fab svg { width: 15px; height: 15px; }
      .fab .x { margin-left: 4px; opacity: .7; font-size: 15px; line-height: 1; }
      .panel { position: fixed; right: 20px; bottom: 72px; z-index: 2147483647; width: 330px; padding: 14px; border-radius: 12px;
        background: #0f0f15; color: #ececf3; border: 1px solid #262631; box-shadow: 0 16px 40px rgba(0,0,0,.5); font-size: 13px; }
      .head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
      .head img { width: 88px; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; }
      .title { font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .meta { color: #8a8a9b; font-size: 11px; margin-top: 2px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 10px; }
      .q { padding: 6px; border: 1px solid #262631; border-radius: 7px; background: #16161e; color: #ececf3; font-size: 12px; cursor: pointer; }
      .q small { display: block; color: #8a8a9b; font-size: 10px; }
      .q[aria-checked=true] { border-color: #6366f1; box-shadow: inset 0 0 0 1px #6366f1; }
      .row { display: flex; gap: 6px; }
      .btn { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #262631; background: transparent; color: #ececf3; font-weight: 600; font-size: 13px; cursor: pointer; }
      .btn.primary { background: #6366f1; border-color: #6366f1; color: #fff; }
      .btn:disabled { opacity: .5; cursor: default; }
      .check { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; font-size: 12px; cursor: pointer; }
      .msg { margin-top: 8px; font-size: 12px; } .ok { color: #22c55e; } .bad { color: #f87171; }
      .hidden { display: none !important; }
    </style>
    <button class="fab hidden" part="fab">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
      Download<span class="x" title="Hide on this page">×</span>
    </button>
    <div class="panel hidden">
      <div class="head"><img class="hidden" alt=""><div><div class="title"></div><div class="meta"></div></div></div>
      <div class="grid"></div>
      <label class="check hidden"><input type="checkbox"> <span></span></label>
      <div class="row"><button class="btn cancel">Close</button><button class="btn primary go" disabled>Download</button></div>
      <div class="msg hidden"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const fab = $('.fab'), panel = $('.panel');
  let hiddenFor = null; // URL the user dismissed the button on
  let lastUrl = '';

  function message(text, ok) {
    const m = $('.msg');
    m.textContent = text;
    m.className = `msg ${ok ? 'ok' : 'bad'}`;
  }

  async function openPicker(url = location.href) {
    panel.classList.remove('hidden');
    $('.title').textContent = 'Reading available qualities…';
    $('.meta').textContent = '';
    $('.grid').textContent = '';
    $('.head img').classList.add('hidden');
    $('.check').classList.add('hidden');
    $('.msg').classList.add('hidden');
    $('.go').disabled = true;

    const both = DMQuality.playlistChoice(url);
    const r = await send({ type: 'probe', url: both ? DMQuality.singleVideoUrl(url) : url });
    if (!r.ok) { $('.title').textContent = 'Can\'t download this video'; return message(r.error, false); }
    const info = r.data;
    $('.title').textContent = info.title;
    $('.meta').textContent = info.isPlaylist ? `Playlist · ${info.entries.length} videos` : DMQuality.duration(info.entries[0]?.duration);
    if (info.thumbnail) { $('.head img').src = info.thumbnail; $('.head img').classList.remove('hidden'); }
    const selected = DMQuality.render($('.grid'), info.qualities, 'q');

    let playlist = null;
    const box = $('.check input');
    if (both) {
      box.checked = false;
      $('.check span').textContent = 'Whole playlist (loading…)';
      $('.check').classList.remove('hidden');
      send({ type: 'probe', url: DMQuality.playlistUrl(url) }).then(p => {
        if (p.ok && p.data.isPlaylist) { playlist = p.data; $('.check span').textContent = `Whole playlist (${playlist.entries.length} videos)`; }
        else $('.check').classList.add('hidden');
      });
    }
    $('.go').disabled = false;
    $('.go').onclick = async () => {
      $('.go').disabled = true;
      const items = (playlist && box.checked ? playlist.entries : info.entries).map(({ url, title }) => ({ url, title }));
      const res = await send({ type: 'addMedia', items, quality: selected() });
      $('.go').disabled = false;
      if (res.ok) { message(`Added ${res.data.downloads.length} video(s) to Download Manager`, true); setTimeout(() => panel.classList.add('hidden'), 1800); }
      else message(res.error, false);
    };
  }

  fab.onclick = (e) => {
    if (e.target.closest('.x')) { hiddenFor = location.href; fab.classList.add('hidden'); panel.classList.add('hidden'); return; }
    if (panel.classList.contains('hidden')) openPicker(); else panel.classList.add('hidden');
  };
  $('.cancel').onclick = () => panel.classList.add('hidden');

  // YouTube and TikTok are single-page apps: follow URL changes.
  function update() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    panel.classList.add('hidden');
    fab.classList.toggle('hidden', !DMQuality.isMediaPage(location.href) || hiddenFor === location.href);
  }
  (document.body || document.documentElement).appendChild(host);
  update();
  setInterval(update, 800);

  // Context menu "Download video with Download Manager".
  api.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'dm-open-picker') return;
    openPicker(msg.url);
    reply({ ok: true });
  });
})();
