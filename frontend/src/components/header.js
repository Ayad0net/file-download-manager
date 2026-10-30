import { LOGO_SVG } from './logo.js';

const APP_VERSION = 'v1.13.1';

/** App name and version at the top of the sidebar. */
export function brandHtml() {
  return `
    <div class="brand" data-tauri-drag-region>
      <div class="logo-mark">${LOGO_SVG}</div>
      <span class="brand-text" data-tauri-drag-region>
        <span class="brand-name">Download Manager</span>
        <span class="brand-version">${APP_VERSION}</span>
      </span>
    </div>`;
}
