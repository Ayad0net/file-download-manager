import { store } from './state/store.js';
import { renderHeader } from './components/header.js';
import { renderSidebar } from './components/sidebar.js';
import { renderToolbar } from './components/toolbar.js';
import { renderStatsPanel } from './components/stats-panel.js';
import { renderDownloadList } from './components/download-list.js';
import { initAddUrlModal } from './components/add-url-modal.js';
import { initSettingsModal } from './components/settings-modal.js';
import { initDeleteConfirmModal } from './components/delete-confirm-modal.js';
import { initContextMenu } from './components/context-menu.js';
import { initDesktopOpen } from './services/desktop-open.js';
import { initWindowGuards } from './services/window-guards.js';
import { initTray } from './services/tray.js';

function init() {
  renderHeader(document.getElementById('header'));
  renderSidebar(document.getElementById('sidebar'));
  renderToolbar(document.getElementById('toolbar'));
  renderStatsPanel(document.getElementById('stats-panel'));
  renderDownloadList(document.getElementById('download-list'));

  initAddUrlModal();
  initSettingsModal();
  initDeleteConfirmModal();
  initContextMenu();
  initDesktopOpen();
  initWindowGuards();
  initTray();

  // Desktop: reveal the (initially hidden) window only after this first frame is painted.
  if (window.__TAURI__?.core) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__TAURI__.core.invoke('app_ready').catch(() => {});
    }));
  }

  store.startLiveUpdates(1500);
}

document.addEventListener('DOMContentLoaded', init);
