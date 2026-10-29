import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

// Desktop browsers the extension can be loaded into, and how to open their extensions page.
interface BrowserDef {
  id: string;
  name: string;
  kind: 'chromium' | 'firefox';
  page: string; // extensions page
  mac: string; // .app name
  win: string[]; // exe paths below %ProgramFiles%, %ProgramFiles(x86)% or %LocalAppData%
  linux: string[]; // commands on PATH
}

const BROWSERS: BrowserDef[] = [
  { id: 'chrome', name: 'Google Chrome', kind: 'chromium', page: 'chrome://extensions', mac: 'Google Chrome.app', win: ['Google\\Chrome\\Application\\chrome.exe'], linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'] },
  { id: 'edge', name: 'Microsoft Edge', kind: 'chromium', page: 'edge://extensions', mac: 'Microsoft Edge.app', win: ['Microsoft\\Edge\\Application\\msedge.exe'], linux: ['microsoft-edge', 'microsoft-edge-stable'] },
  { id: 'brave', name: 'Brave', kind: 'chromium', page: 'brave://extensions', mac: 'Brave Browser.app', win: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'], linux: ['brave-browser', 'brave'] },
  { id: 'opera', name: 'Opera', kind: 'chromium', page: 'opera://extensions', mac: 'Opera.app', win: ['Programs\\Opera\\opera.exe', 'Opera\\opera.exe'], linux: ['opera'] },
  { id: 'vivaldi', name: 'Vivaldi', kind: 'chromium', page: 'vivaldi://extensions', mac: 'Vivaldi.app', win: ['Vivaldi\\Application\\vivaldi.exe'], linux: ['vivaldi', 'vivaldi-stable'] },
  { id: 'firefox', name: 'Firefox', kind: 'firefox', page: 'about:debugging#/runtime/this-firefox', mac: 'Firefox.app', win: ['Mozilla Firefox\\firefox.exe'], linux: ['firefox'] },
];

/** Executable that opens a URL in the (running or new) browser, or null if not installed. */
function executable(b: BrowserDef): string | null {
  if (process.platform === 'darwin') {
    for (const dir of ['/Applications', path.join(process.env.HOME || '', 'Applications')]) {
      const app = path.join(dir, b.mac);
      const macos = path.join(app, 'Contents', 'MacOS');
      if (!fs.existsSync(macos)) continue;
      // The binary is named after the app, except Firefox ("firefox").
      const bin = fs.readdirSync(macos).find(f => f.toLowerCase() === b.mac.replace(/\.app$/, '').toLowerCase())
        || fs.readdirSync(macos).find(f => f.toLowerCase() === b.id);
      if (bin) return path.join(macos, bin);
    }
    return null;
  }
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    for (const root of roots) for (const rel of b.win) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  for (const cmd of b.linux) {
    try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim() || null; } catch {}
  }
  return null;
}

export function installedBrowsers() {
  return BROWSERS.filter(b => executable(b)).map(({ id, name, kind, page }) => ({ id, name, kind, page }));
}

/**
 * Brings the browser up (a new tab in the running one). Browsers refuse to open their own
 * pages (chrome://extensions, about:debugging) from outside, so the UI copies that address.
 */
export function openBrowser(id: string) {
  const b = BROWSERS.find(x => x.id === id);
  const exe = b && executable(b);
  if (!b || !exe) throw new Error('This browser is not installed');
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  return { id: b.id, name: b.name, kind: b.kind, page: b.page };
}
