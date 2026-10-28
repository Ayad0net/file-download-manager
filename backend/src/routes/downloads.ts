import { Hono } from 'hono';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import parseTorrent, { toMagnetURI } from 'parse-torrent';
import { queueManager, DOWNLOADS_DIR, TORRENTS_DIR } from '../services/queue-manager.js';
import { isTorrentSource } from '../services/torrent-manager.js';

const downloadsApi = new Hono();

export function getSnapshot() {
  return {
    downloads: queueManager.getAll(),
    stats: queueManager.getStats(),
    globalSpeedLimit: queueManager.getGlobalSpeedLimit(),
    maxConcurrent: queueManager.getMaxConcurrent(),
    connectionsPerDownload: queueManager.getConnectionsPerDownload(),
  };
}

downloadsApi.get('/', (c) => c.json(getSnapshot()));

downloadsApi.post('/', async (c) => {
  const body = await c.req.json();
  const urls: string[] = body.urls || [];
  const names: string[] | undefined = body.filenames;

  if (urls.length === 0) {
    return c.json({ error: 'No URLs provided' }, 400);
  }

  const validUrls: string[] = [];
  const errors: string[] = [];

  for (const url of urls) {
    if (url.startsWith('magnet:')) {
      if (isTorrentSource(url)) validUrls.push(url);
      else errors.push(`Invalid magnet link: ${url}`);
      continue;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`Invalid protocol: ${url}`);
      } else {
        validUrls.push(url);
      }
    } catch {
      errors.push(`Invalid URL: ${url}`);
    }
  }

  if (validUrls.length === 0) {
    return c.json({ error: 'No valid URLs', details: errors }, 400);
  }

  const downloads = await queueManager.addDownloads(validUrls, names);
  return c.json({ downloads, errors: errors.length > 0 ? errors : undefined }, 201);
});

// Upload one or more .torrent files (multipart field "files").
downloadsApi.post('/torrent', async (c) => {
  const form = await c.req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return c.json({ error: 'No .torrent files provided' }, 400);

  const downloads = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      downloads.push(await addTorrentBuffer(Buffer.from(await file.arrayBuffer()), file.name));
    } catch (err: any) {
      errors.push(`${file.name}: ${err.message || 'invalid torrent'}`);
    }
  }
  if (downloads.length === 0) return c.json({ error: 'No valid torrents', details: errors }, 400);
  return c.json({ downloads, errors: errors.length > 0 ? errors : undefined }, 201);
});

// Desktop only: add .torrent files the OS opened with the app, by local path.
// Not registered for the web/Docker server, where it would let clients read server files.
if (process.env.DM_DESKTOP === '1') {
  downloadsApi.post('/torrent-path', async (c) => {
    const body = await c.req.json();
    const paths: string[] = Array.isArray(body.paths) ? body.paths : [];
    const downloads = [];
    const errors: string[] = [];
    for (const p of paths) {
      const name = path.basename(String(p));
      try {
        if (!/\.torrent$/i.test(name)) throw new Error('not a .torrent file');
        const stat = fs.statSync(p);
        if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('not a valid .torrent file');
        downloads.push(await addTorrentBuffer(fs.readFileSync(p), name));
      } catch (err: any) {
        errors.push(`${name}: ${err.code === 'ENOENT' ? 'file not found' : err.message || 'invalid torrent'}`);
      }
    }
    return c.json({ downloads, errors: errors.length > 0 ? errors : undefined }, downloads.length ? 201 : 400);
  });
}

async function addTorrentBuffer(buf: Buffer, originalName: string) {
  const parsed = await parseTorrent(buf);
  if (!parsed.infoHash || !parsed.files) throw new Error('not a valid .torrent file');
  fs.mkdirSync(TORRENTS_DIR, { recursive: true });
  const id = uuidv4();
  const torrentFile = path.join(TORRENTS_DIR, `${id}.torrent`);
  fs.writeFileSync(torrentFile, buf);
  return queueManager.addTorrentFile({
    id,
    magnet: toMagnetURI(parsed),
    name: parsed.name || originalName.replace(/\.torrent$/i, ''),
    size: parsed.length ?? 0,
    infoHash: parsed.infoHash,
    torrentFile,
  });
}

downloadsApi.post('/reorder', async (c) => {
  const body = await c.req.json();
  const ids: string[] = body.ids;
  if (!ids || !Array.isArray(ids)) {
    return c.json({ error: 'ids array required' }, 400);
  }
  queueManager.reorder(ids);
  return c.json({ success: true });
});

downloadsApi.post('/:id/pause', (c) => {
  const id = c.req.param('id');
  queueManager.pause(id);
  return c.json({ success: true });
});

downloadsApi.post('/:id/resume', (c) => {
  const id = c.req.param('id');
  queueManager.resume(id);
  return c.json({ success: true });
});

downloadsApi.post('/:id/stop', (c) => {
  const id = c.req.param('id');
  queueManager.stop(id);
  return c.json({ success: true });
});

downloadsApi.post('/:id/retry', (c) => {
  const id = c.req.param('id');
  queueManager.retry(id);
  return c.json({ success: true });
});

downloadsApi.delete('/:id', (c) => {
  const id = c.req.param('id');
  queueManager.remove(id);
  return c.json({ success: true });
});

function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

downloadsApi.get('/:id/file', (c) => {
  const id = c.req.param('id');
  const record = queueManager.getById(id);

  if (!record) {
    return c.json({ error: 'Download not found' }, 404);
  }
  if (record.status !== 'completed') {
    return c.json({ error: 'Download is not completed yet' }, 409);
  }

  if (record.kind === 'torrent') {
    // Single-file torrents can be served directly; multi-file ones per file via /files/:index.
    if (record.torrentFiles?.length !== 1) {
      return c.json({ error: 'This torrent has multiple files; download them individually' }, 409);
    }
    return serveTorrentFile(c, id, 0);
  }

  const filePath = path.join(DOWNLOADS_DIR, `${id}_${record.filename}`);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return c.json({ error: 'File no longer exists on the server' }, 404);
  }

  const stat = fs.statSync(filePath);
  return new Response(Bun.file(filePath), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': buildContentDisposition(record.filename),
      'Cache-Control': 'no-store',
    },
  });
});

function serveTorrentFile(c: any, id: string, index: number) {
  const record = queueManager.getById(id);
  const file = record?.torrentFiles?.[index];
  if (!record || !file) return c.json({ error: 'File not found' }, 404);
  if (file.downloaded < file.length) return c.json({ error: 'File is not completed yet' }, 409);

  const root = path.join(DOWNLOADS_DIR, id);
  const filePath = path.resolve(root, file.path);
  // Paths come from torrent metadata: refuse anything that escapes the torrent's folder.
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return c.json({ error: 'File no longer exists on the server' }, 404);
  }
  return new Response(Bun.file(filePath), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fs.statSync(filePath).size),
      'Content-Disposition': buildContentDisposition(file.name),
      'Cache-Control': 'no-store',
    },
  });
}

downloadsApi.get('/:id/files/:index', (c) => {
  const index = parseInt(c.req.param('index'), 10);
  if (!Number.isInteger(index) || index < 0) return c.json({ error: 'Invalid file index' }, 400);
  return serveTorrentFile(c, c.req.param('id'), index);
});

export { downloadsApi };
