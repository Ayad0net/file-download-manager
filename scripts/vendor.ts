#!/usr/bin/env bun
/** Copies Font Awesome (CSS + webfonts) into frontend/vendor so the UI works offline. Runs on postinstall. */
import { cpSync, rmSync, mkdirSync } from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dir, '..');
const src = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
const dest = path.join(root, 'frontend', 'vendor', 'fontawesome');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['css', 'webfonts']) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
