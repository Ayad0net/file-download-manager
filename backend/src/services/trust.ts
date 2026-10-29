import type { Context, Next } from 'hono';

// Endpoints only the app's own UI may call (confirming browser requests, getting the extension):
// same origin, or the Tauri webview.
const TAURI_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isTrustedOrigin(c: Context): boolean {
  const origin = c.req.header('Origin');
  // No Origin: same-origin GETs, navigations (file links), curl. Browsers always send Origin
  // on cross-site POSTs.
  if (!origin) return true;
  if (TAURI_ORIGINS.has(origin)) return true;
  try {
    const o = new URL(origin);
    // `tauri dev` serves the UI from its own localhost port, not the backend's.
    if (process.env.DM_DESKTOP === '1' && o.protocol === 'http:' && LOOPBACK.has(o.hostname)) return true;
    const host = c.req.header('Host');
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

export async function requireTrusted(c: Context, next: Next) {
  if (isTrustedOrigin(c)) return next();
  return c.json({ error: 'Forbidden' }, 403);
}
