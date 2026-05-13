import { Hono } from 'hono';
import { getDb, save } from '../database/db.js';
import { queueManager } from '../services/queue-manager.js';

const settingsApi = new Hono();

settingsApi.get('/', (c) => {
  const db = getDb();
  const result = db.exec('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  if (result.length > 0) {
    for (const row of result[0].values) {
      settings[row[0] as string] = row[1] as string;
    }
  }
  return c.json(settings);
});

settingsApi.post('/speed-limit', async (c) => {
  const body = await c.req.json();
  const limit = parseInt(body.limit, 10);
  if (isNaN(limit) || limit < 0) {
    return c.json({ error: 'Invalid speed limit' }, 400);
  }
  queueManager.setGlobalSpeedLimit(limit);
  return c.json({ success: true, limit });
});

settingsApi.post('/max-concurrent', async (c) => {
  const body = await c.req.json();
  const count = parseInt(body.count, 10);
  if (isNaN(count) || count < 1) {
    return c.json({ error: 'Invalid count' }, 400);
  }
  queueManager.setMaxConcurrent(count);
  return c.json({ success: true, count });
});

settingsApi.post('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json();
  const db = getDb();
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(body.value)]);
  save();
  return c.json({ success: true });
});

export { settingsApi };
