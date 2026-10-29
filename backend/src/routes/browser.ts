import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { markBrowserSeen, browserStatus } from './downloads.js';
import { requireTrusted } from '../services/trust.js';
import { makeZip } from '../services/zip.js';
import { installedBrowsers, openBrowser } from '../services/browsers.js';
import { addRequest, takeRequest, hasUi } from '../services/browser-requests.js';
import { queueManager, DOWNLOADS_DIR } from '../services/queue-manager.js';

// Browser extension: heartbeat, confirm-before-download requests, and the extension package.
// Desktop: Tauri bundles extension/ as a resource and passes its path; web/dev: repo folder.
const EXTENSION_DIR = process.env.DM_EXTENSION_DIR || path.resolve(import.meta.dir, '..', '..', '..', 'extension');

const browserApi = new Hono();

browserApi.post('/ping', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  markBrowserSeen(String(body.browser || 'Browser'));
  return c.json({ ok: true, app: 'download-manager' });
});

// A download caught in the browser: ask in the app before starting (queued directly if no UI is open).
browserApi.post('/request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = String(body.url || '');
  if (!/^https?:\/\//i.test(url)) return c.json({ error: 'Invalid URL' }, 400);
  const filename = body.filename ? path.basename(String(body.filename)).slice(0, 255) : undefined;
  const desktop = process.env.DM_DESKTOP === '1';
  // Web version with no tab open: nobody to ask, so queue it. Desktop: the window can always be shown.
  if (!desktop && !hasUi()) {
    const [d] = await queueManager.addDownloads([url], filename ? [filename] : undefined);
    return c.json({ queued: true, download: d }, 201);
  }
  const req = addRequest({ url, filename, size: Number(body.size) || null, referrer: body.referrer ? String(body.referrer) : null, browser: body.browser ? String(body.browser) : null });
  // The hidden window's webview may be suspended: ask the Tauri shell to bring it forward.
  if (desktop) console.log('DM_EVENT:show-window');
  return c.json({ queued: false, request: req }, 202);
});

browserApi.post('/request/:id/accept', requireTrusted, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const req = takeRequest(c.req.param('id')!);
  if (!req) return c.json({ error: 'This request has expired' }, 404);
  const name = body.filename ? path.basename(String(body.filename)).trim().slice(0, 255) : req.filename;
  const [d] = await queueManager.addDownloads([req.url], [name || req.filename]);
  if (body.paused && d) queueManager.pause(d.id);
  return c.json({ download: d }, 201);
});

browserApi.post('/request/:id/reject', requireTrusted, (c) => {
  takeRequest(c.req.param('id')!);
  return c.json({ success: true });
});

/** Address the extension should use: what the app's UI itself is talking to. */
function serverUrl(c: any): string {
  if (process.env.DM_DESKTOP === '1') return `http://127.0.0.1:${process.env.PORT || 17890}`;
  const u = new URL(c.req.url);
  const proto = c.req.header('X-Forwarded-Proto') || u.protocol.replace(':', '');
  const host = c.req.header('X-Forwarded-Host') || c.req.header('Host') || u.host;
  return `${proto}://${host}`;
}

browserApi.get('/info', requireTrusted, (c) => c.json({
  serverUrl: serverUrl(c),
  extensionAvailable: fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json')),
  ...browserStatus(),
}));

function buildExtensionZip(c: any): { name: string; data: Buffer } {
  if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) throw new Error('The extension files are not included in this build');
  const entries: { name: string; data: Buffer }[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'app.json') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
      else entries.push({ name: prefix + entry.name, data: fs.readFileSync(full) });
    }
  };
  walk(EXTENSION_DIR);
  // Tells the extension which address this app runs at.
  entries.push({ name: 'app.json', data: Buffer.from(JSON.stringify({ serverUrl: serverUrl(c) }, null, 2)) });
  const { version } = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  return { name: `download-manager-extension-${version}.zip`, data: makeZip(entries) };
}

browserApi.get('/extension.zip', requireTrusted, (c) => {
  try {
    const zip = buildExtensionZip(c);
    return new Response(new Uint8Array(zip.data), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zip.name}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Desktop: the webview can't save file downloads, so write the zip (and an unpacked copy for
// "Load unpacked") into the downloads folder and let the UI reveal it.
function saveExtension(c: any) {
  const zip = buildExtensionZip(c);
  const zipPath = path.join(DOWNLOADS_DIR, zip.name);
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  fs.writeFileSync(zipPath, zip.data);
  const folder = path.join(DOWNLOADS_DIR, 'Download Manager Extension');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.cpSync(EXTENSION_DIR, folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'app.json'), JSON.stringify({ serverUrl: serverUrl(c) }, null, 2));
  return { zipPath, folder, manifest: path.join(folder, 'manifest.json') };
}

if (process.env.DM_DESKTOP === '1') {
  browserApi.post('/extension/save', requireTrusted, (c) => {
    try {
      return c.json(saveExtension(c));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Install helper: browsers found on this computer.
  browserApi.get('/installed', requireTrusted, (c) => c.json({ browsers: installedBrowsers() }));

  // Install helper: fresh unpacked copy of the extension + the browser's extensions page.
  browserApi.post('/installed/:id/open', requireTrusted, (c) => {
    try {
      const saved = saveExtension(c);
      return c.json({ ...saved, browser: openBrowser(c.req.param('id')!) });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });
}

export { browserApi };
