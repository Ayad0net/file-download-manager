// Download Manager browser integration: background worker (Chrome service worker / Firefox event page).
// Chrome loads formats.js here; Firefox lists it before this file in the manifest.
if (typeof DM_DEFAULT_EXTENSIONS === 'undefined') importScripts('formats.js');

const api = globalThis.chrome; // also defined (callbacks + promises) in Firefox

const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:17890', // desktop app; use e.g. http://localhost:8080 for the web/Docker version
  intercept: true,
  // 'all': every browser download goes to the app. 'filtered': only listed types or big files.
  captureMode: 'all',
  minSizeMB: 1,
  // Always captured regardless of size (see formats.js).
  extensions: DM_DEFAULT_EXTENSIONS,
};

const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|tiktok\.com)$/i;
// Downloads we hand back to the browser (app unreachable): don't capture them again.
const passThrough = new Set();

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.local.get(Object.keys(DEFAULTS))) };
}

// Extensions downloaded from the app's Settings > Browser carry app.json with the app's address.
async function loadBundledAddress() {
  try {
    const res = await fetch(api.runtime.getURL('app.json'));
    if (!res.ok) return;
    const { serverUrl } = await res.json();
    const { bundledUrl } = await api.storage.local.get('bundledUrl');
    if (serverUrl && bundledUrl !== serverUrl) await api.storage.local.set({ serverUrl, bundledUrl: serverUrl });
  } catch {}
}

async function call(path, body, timeoutMs = 8000) {
  const { serverUrl } = await settings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || (data.details || []).join('; ') || `App returned ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError' || err instanceof TypeError) {
      throw new Error(timeoutMs > 8000 ? 'The app took too long to answer' : 'Download Manager is not running');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function browserName() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (navigator.brave) return 'Brave';
  if (/Chrome\//.test(ua)) return 'Chrome';
  return 'Browser';
}

// 'ok' | 'offline'
async function ping() {
  try {
    await call('/browser/ping', { browser: browserName() }, 4000);
    return 'ok';
  } catch {
    return 'offline';
  }
}

function setBadge(text, color = '#6366f1') {
  api.action.setBadgeText({ text: text || '' });
  if (text) api.action.setBadgeBackgroundColor({ color });
}

function notify(title, message) {
  api.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title, message: String(message).slice(0, 250) });
}

async function sendUrls(urls, filenames) {
  const res = await call('/downloads', { urls, filenames });
  const n = res.downloads?.length || 0;
  if (!n) throw new Error((res.details || res.errors || []).join('; ') || 'Nothing was added');
  return n;
}

function sendRequest(url, extra = {}) {
  return call('/browser/request', { url, browser: browserName(), ...extra });
}

function basename(path) {
  return (path || '').split(/[\\/]/).pop();
}

// ----- Capture browser downloads -----
function nameOf(item) {
  try { return basename(item.filename) || decodeURIComponent(new URL(item.finalUrl || item.url).pathname.split('/').pop() || ''); } catch { return ''; }
}

function matchesType(item, s) {
  const ext = (nameOf(item).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return !!ext && s.extensions.toLowerCase().split(/[\s,]+/).includes(ext);
}

const bigEnough = (item, s) => item.totalBytes > 0 && item.totalBytes >= s.minSizeMB * 1024 * 1024;

function wanted(item, s) {
  const url = item.finalUrl || item.url;
  if (!s.intercept || !/^https?:/i.test(url) || passThrough.has(url) || item.byExtensionId === api.runtime.id) return false;
  return s.captureMode === 'all' || matchesType(item, s) || bigEnough(item, s);
}

/** Hands the download to the app. Returns false if the app couldn't take it. */
async function handOver(item) {
  const url = item.finalUrl || item.url;
  try {
    // The app pops up and asks before starting.
    const r = await sendRequest(url, { filename: basename(item.filename), size: item.totalBytes, referrer: item.referrer });
    if (r.queued) notify('Sent to Download Manager', nameOf(item) || url);
    return true;
  } catch (err) {
    failed(err);
    return false;
  }
}

// Notifications can be turned off in the OS, so also flag the toolbar icon with the reason.
function failed(err) {
  notify('Downloaded by the browser instead', err.message);
  setBadge('!', '#dc2626');
  api.action.setTitle({ title: `Download Manager: ${err.message}` });
}

async function cancelInBrowser(id) {
  try { await api.downloads.cancel(id); } catch {}
  try { await api.downloads.erase({ id }); } catch {}
}

// Running, or stopped by the browser itself (blocked as insecure / dangerous), not by the user.
function takeable(item) {
  if (item.state === 'in_progress') return true;
  return item.state === 'interrupted' && item.error !== 'USER_CANCELED' && item.error !== 'USER_SHUTDOWN';
}

// Downloads already decided by onDeterminingFilename.
const decided = new Set();

// Chrome / Edge / Brave / Opera: this runs before the browser shows its "Save as" dialog or
// writes anything. Holding back suggest() keeps the native save waiting while the app is asked;
// once the app has it, the browser's download is cancelled and the dialog never appears.
if (api.downloads.onDeterminingFilename) {
  api.downloads.onDeterminingFilename.addListener((item, suggest) => {
    decided.add(item.id);
    (async () => {
      const s = await settings();
      if (wanted(item, s) && await handOver(item)) {
        await cancelInBrowser(item.id);
      } else {
        suggest(); // app offline or not wanted: the browser saves it as usual
      }
    })();
    return true; // suggest() is called asynchronously
  });
}

// Firefox, and Chrome when another extension or automation sets the file name instead.
api.downloads.onCreated.addListener(async (item) => {
  if (api.downloads.onDeterminingFilename) {
    await new Promise(r => setTimeout(r, 1000));
    if (decided.has(item.id)) return decided.delete(item.id);
    [item] = await api.downloads.search({ id: item.id });
    // Not only in-progress ones: the browser blocks http downloads started from https pages
    // ("insecure download", no onDeterminingFilename), but the app can still fetch them.
    if (!item || !takeable(item)) return;
  }
  const s = await settings();
  if (!wanted(item, s)) {
    // Size is often unknown when the download starts; look again once the response headers are in.
    if (s.captureMode === 'all' || !s.intercept) return;
    await new Promise(r => setTimeout(r, 700));
    [item] = await api.downloads.search({ id: item.id });
    if (!item || !takeable(item) || !wanted(item, s)) return;
  }
  // Stop the browser right away so it doesn't save in parallel; restart it if the app can't take it.
  await cancelInBrowser(item.id);
  if (!(await handOver(item))) {
    const url = item.finalUrl || item.url;
    passThrough.add(url);
    setTimeout(() => passThrough.delete(url), 60_000);
    api.downloads.download({ url });
  }
});

// ----- Context menus -----
function createMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'dm-link', title: 'Download with Download Manager', contexts: ['link'] });
    api.contextMenus.create({ id: 'dm-media', title: 'Download this media with Download Manager', contexts: ['video', 'audio', 'image'] });
    api.contextMenus.create({
      id: 'dm-page-video', title: 'Download video with Download Manager', contexts: ['page'],
      documentUrlPatterns: ['*://*.youtube.com/*', '*://*.tiktok.com/*'],
    });
  });
}
api.runtime.onInstalled.addListener(() => { createMenus(); loadBundledAddress().then(ping); });
api.runtime.onStartup?.addListener(createMenus);

api.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'dm-page-video') {
      await showPicker(tab, info.pageUrl);
      return;
    }
    const url = info.menuItemId === 'dm-link' ? info.linkUrl : info.srcUrl;
    if (!/^https?:/i.test(url || '')) throw new Error('This item has no downloadable address (it may be a stream or blob)');
    if (isMediaUrl(url)) return showPicker(tab, url);
    const r = await sendRequest(url, { referrer: info.pageUrl });
    if (r.queued) notify('Sent to Download Manager', url);
  } catch (err) {
    notify('Could not send to Download Manager', err.message);
  }
});

function isMediaUrl(url) {
  try { return MEDIA_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

// Opens the in-page quality picker (content script) on YouTube/TikTok tabs, else the action popup.
async function showPicker(tab, url) {
  if (tab?.id != null && isMediaUrl(tab.url || '')) {
    try { await api.tabs.sendMessage(tab.id, { type: 'dm-open-picker', url }); return; } catch {}
  }
  await api.storage.local.set({ pendingMediaUrl: url });
  if (api.action.openPopup) await api.action.openPopup().catch(() => notify('Download Manager', 'Click the toolbar icon to choose a quality'));
}

// ----- Messages from popup / content script -----
api.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    ping: () => ping().then(state => ({ ok: state === 'ok', state })),
    status: () => call('/downloads/media/status'),
    probe: () => call('/downloads/media/probe', { url: msg.url }, 120_000),
    addMedia: () => call('/downloads/media', { items: msg.items, quality: msg.quality }),
    addUrls: () => sendUrls(msg.urls).then(n => ({ added: n })),
    // A file link clicked in a page (content-links.js); the browser saves it if the app can't.
    catchLink: async () => {
      try {
        const r = await sendRequest(msg.url, { referrer: msg.referrer });
        if (r.queued) notify('Sent to Download Manager', msg.url);
        setBadge('');
      } catch (err) {
        failed(err);
        passThrough.add(msg.url);
        setTimeout(() => passThrough.delete(msg.url), 60_000);
        api.downloads.download({ url: msg.url });
      }
      return { ok: true };
    },
    openApp: async () => {
      const { serverUrl } = await settings();
      // The desktop app has no web UI to open; the web version does.
      if (!/:17890\/?$/.test(serverUrl)) api.tabs.create({ url: serverUrl });
      return { ok: true };
    },
  };
  const fn = handlers[msg?.type];
  if (!fn) return false;
  fn().then(data => reply({ ok: true, data }), err => reply({ ok: false, error: err.message }));
  return true; // async reply
});

// Heartbeat so the app can show "Browser connected".
api.alarms?.create?.('dm-ping', { periodInMinutes: 0.5 });
api.alarms?.onAlarm?.addListener(a => { if (a.name === 'dm-ping') ping(); });
loadBundledAddress().then(ping);
