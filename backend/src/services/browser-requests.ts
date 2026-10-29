import { v4 as uuidv4 } from 'uuid';
import { markChanged } from './change-notifier.js';
import { probeUrl } from './download-engine.js';

// Downloads caught by the browser extension wait here until the user confirms them in the app.
export interface BrowserRequest {
  id: string;
  url: string;
  filename: string;
  size: number | null;
  referrer: string | null;
  browser: string | null;
  createdAt: string;
  probing: boolean;
}

const pending = new Map<string, BrowserRequest>();
let uiClients = 0;

/** Live UI connections (SSE). With none open, requests are queued without asking. */
export function uiConnected(delta: number) { uiClients = Math.max(0, uiClients + delta); }
export function hasUi() { return uiClients > 0; }

export function listRequests(): BrowserRequest[] {
  return [...pending.values()];
}

export function addRequest(r: { url: string; filename?: string; size?: number | null; referrer?: string | null; browser?: string | null }): BrowserRequest {
  const req: BrowserRequest = {
    id: uuidv4(),
    url: r.url,
    filename: r.filename || decodeURIComponent(new URL(r.url).pathname.split('/').pop() || '') || 'download',
    size: r.size && r.size > 0 ? r.size : null,
    referrer: r.referrer || null,
    browser: r.browser || null,
    createdAt: new Date().toISOString(),
    probing: true,
  };
  pending.set(req.id, req);
  markChanged();
  // Fill in the real file name and size for the dialog.
  probeUrl(req.url).then(p => {
    const cur = pending.get(req.id);
    if (!cur) return;
    if (!r.filename && p.filename) cur.filename = p.filename;
    cur.size = p.size ?? cur.size;
  }).catch(() => {}).finally(() => {
    const cur = pending.get(req.id);
    if (cur) { cur.probing = false; markChanged(); }
  });
  // Forgotten requests expire after an hour.
  setTimeout(() => { if (pending.delete(req.id)) markChanged(); }, 3_600_000);
  return req;
}

export function takeRequest(id: string): BrowserRequest | null {
  const r = pending.get(id) || null;
  if (r) { pending.delete(id); markChanged(); }
  return r;
}
