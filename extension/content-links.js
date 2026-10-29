// Catches clicks on links to files and sends them to the app before the browser starts a
// download (and before it can block it as insecure or show its own "Save as" dialog).
(() => {
  const api = globalThis.chrome;
  // Types that are usually opened in the tab, or that are also source-file / page names
  // (e.g. .ts or .sh on GitHub): left to the browser and caught as downloads if they are one.
  const OPENED = new Set((DM_FORMATS.image + ' pdf txt md tex csv tsv ts sh bat cmd app key pages numbers ra au z').split(/\s+/));
  let s = { intercept: true, extensions: DM_DEFAULT_EXTENSIONS };

  const load = () => api.storage.local.get(['intercept', 'extensions'], (v) => { s = { ...s, ...v }; });
  load();
  api.storage.onChanged.addListener(load);

  function fileLink(a) {
    if (!a?.href || a.hasAttribute('data-dm-skip')) return null;
    let u;
    try { u = new URL(a.href, location.href); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (!ext || OPENED.has(ext)) return null;
    return s.extensions.toLowerCase().split(/[\s,]+/).includes(ext) ? u.href : null;
  }

  addEventListener('click', (e) => {
    if (!s.intercept || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.composedPath().find(el => el.tagName === 'A' || el.tagName === 'AREA');
    const url = fileLink(a);
    if (!url) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    api.runtime.sendMessage({ type: 'catchLink', url, referrer: location.href });
  }, true);
})();
