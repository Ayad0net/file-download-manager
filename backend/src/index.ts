import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './database/db.js';
import { downloadsApi } from './routes/downloads.js';
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

  app.post('/api/actions/clear-completed', (c) => {
    queueManager.clearCompleted();
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

  console.log(`Web Download Manager starting on http://localhost:${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
  });

  queueManager.processQueue();
}

main().catch(console.error);
