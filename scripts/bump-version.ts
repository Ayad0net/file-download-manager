#!/usr/bin/env bun
/**
 * Bumps the app version everywhere it lives and adds a CHANGELOG entry.
 *
 *   bun run version:bump <patch|minor|major> "Short description of the change"
 *
 * patch = hotfix (bug fix, no new behaviour)
 * minor = new feature or visible improvement, backwards compatible
 * major = breaking change (data format, removed feature, incompatible API)
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dir, '..');
const [level, ...descParts] = process.argv.slice(2);
const description = descParts.join(' ').trim();

if (!['patch', 'minor', 'major'].includes(level) || !description) {
  console.error('Usage: bun run version:bump <patch|minor|major> "Description of the change"');
  process.exit(1);
}

const file = (p: string) => path.join(root, p);
const pkg = JSON.parse(fs.readFileSync(file('package.json'), 'utf8'));
const [major, minor, patch] = String(pkg.version).split('.').map(Number);
const next =
  level === 'major' ? `${major + 1}.0.0` :
  level === 'minor' ? `${major}.${minor + 1}.0` :
  `${major}.${minor}.${patch + 1}`;

function replaceOnce(rel: string, pattern: RegExp, replacement: string) {
  const text = fs.readFileSync(file(rel), 'utf8');
  if (!pattern.test(text)) throw new Error(`Version not found in ${rel}`);
  fs.writeFileSync(file(rel), text.replace(pattern, replacement));
}

// Every place the version is declared. Keep this list in sync with AGENTS.md.
replaceOnce('package.json', /"version": "[^"]+"/, `"version": "${next}"`);
replaceOnce('src-tauri/tauri.conf.json', /"version": "[^"]+"/, `"version": "${next}"`);
replaceOnce('src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${next}"`);
replaceOnce('extension/manifest.json', /"version": "[^"]+"/, `"version": "${next}"`);
replaceOnce('frontend/src/components/header.js', /const APP_VERSION = 'v[^']+'/, `const APP_VERSION = 'v${next}'`);

const changelog = file('CHANGELOG.md');
const header = '# Changelog\n\nAll notable changes to this project. Versions follow [Semantic Versioning](https://semver.org/).\n';
const existing = fs.existsSync(changelog) ? fs.readFileSync(changelog, 'utf8').replace(header, '') : '';
const date = new Date().toISOString().slice(0, 10);
const kind = { patch: 'Hotfix', minor: 'Minor', major: 'Major' }[level];
fs.writeFileSync(changelog, `${header}\n## ${next} — ${date} (${kind})\n\n- ${description}\n${existing}`);

console.log(`${pkg.version} → ${next} (${kind})`);
