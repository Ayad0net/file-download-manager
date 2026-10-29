import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './database/db.js';
import { streamSSE } from 'hono/streaming';
import { downloadsApi, getSnapshot } from './routes/downloads.js';
import { browserApi } from './routes/browser.js';
import { uiConnected } from './services/browser-requests.js';
import { getVersion } from './services/change-notifier.js';
import { settingsApi } from './routes/settings.js';
import { queueManager } from './services/queue-manager.js';

const FRONTEND_PATH = path.resolve(import.meta.dir, '..', '..', 'frontend');

async function main() {
  await initDatabase();
  queueManager.init();

  const app = new Hono();

  app.use('*', cors());

  app.route('/api/downloads', downloadsApi);
  app.route('/api/settings', settingsApi);

  // Live updates: push a snapshot whenever state changes (checked every 200ms), heartbeat otherwise.
  app.get('/api/events', (c) => streamSSE(c, async (stream) => {
    uiConnected(1);
    stream.onAbort(() => uiConnected(-1));
    let sent = -1;
    let idle = 0;
    while (!stream.aborted) {
      const v = getVersion();
      if (v !== sent) {
        sent = v;
        idle = 0;
        await stream.writeSSE({ data: JSON.stringify(getSnapshot()) });
      } else if (++idle >= 75) {
        idle = 0;
        await stream.write(': ping\n\n');
      }
      await stream.sleep(200);
    }
  }));

  app.route('/api/browser', browserApi);

  app.get('/api/stats', (c) => {
    return c.json(queueManager.getStats());
  });

  app.post('/api/actions/pause-all', (c) => {
    queueManager.pauseAll();
    return c.json({ success: true });
  });

  app.post('/api/actions/resume-all', (c) => {
    queueManager.resumeAll();
    return c.json({ success: true });
  });

  app.post('/api/actions/stop-all', (c) => {
    queueManager.stopAll();
    return c.json({ success: true });
  });

  app.post('/api/actions/clear-uncompleted', (c) => {
    queueManager.removeUncompleted();
    return c.json({ success: true });
  });

  app.use('/*', serveStatic({
    root: FRONTEND_PATH,
  }));

  app.get('*', (c) => {
    const filePath = path.join(FRONTEND_PATH, 'index.html');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return c.html(content);
    }
    return c.text('Not Found', 404);
  });

  const port = parseInt(process.env.PORT || '8080', 10);

  console.log(`Download Manager starting on http://localhost:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
  });

  queueManager.processQueue();
}

main().catch(console.error);

// Desktop sidecar: exit when the app shell is gone (crash, `tauri dev` restart), so an orphaned
// backend never keeps the port and leaves the new shell without its backend.
if (process.env.DM_DESKTOP === '1') {
  const parent = process.ppid;
  setInterval(() => {
    try { process.kill(parent, 0); if (process.ppid === parent) return; } catch {}
    process.exit(0);
  }, 2000).unref();
}
