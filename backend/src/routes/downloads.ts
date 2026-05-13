import { Hono } from 'hono';
import { queueManager } from '../services/queue-manager.js';

const downloadsApi = new Hono();

downloadsApi.get('/', (c) => {
  const downloads = queueManager.getAll();
  const stats = queueManager.getStats();
  const globalSpeedLimit = queueManager.getGlobalSpeedLimit();
  const maxConcurrent = queueManager.getMaxConcurrent();
  return c.json({ downloads, stats, globalSpeedLimit, maxConcurrent });
});

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

export { downloadsApi };
