// Zips extension/ into dist/ for the Chrome Web Store / Edge Add-ons and Firefox AMO.
// Same files for both: the manifest carries Chrome's service_worker and Firefox's scripts.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dir, '..');
const src = path.join(root, 'extension');
const out = path.join(root, 'dist');
const { version } = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
fs.mkdirSync(out, { recursive: true });

for (const target of ['chrome', 'firefox']) {
  const zip = path.join(out, `download-manager-extension-${target}-${version}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', '-X', zip, '.', '-x', '.*', '-x', 'README.md'], { cwd: src });
  console.log(path.relative(root, zip));
}
