import { store } from './state/store.js';
import { renderSidebar } from './components/sidebar.js';
import { renderToolbar } from './components/toolbar.js';
import { renderPageHead } from './components/page-head.js';
import { renderStatusBar } from './components/status-bar.js';
import { renderDownloadList } from './components/download-list.js';
import { initAddUrlModal } from './components/add-url-modal.js';
import { initSettingsModal, syncWindowBackground } from './components/settings-modal.js';
import { initDeleteConfirmModal } from './components/delete-confirm-modal.js';
import { initContextMenu } from './components/context-menu.js';
import { initDesktopOpen } from './services/desktop-open.js';
import { initWindowGuards } from './services/window-guards.js';
import { initTray } from './services/tray.js';
import { initBrowserRequests } from './components/browser-request-modal.js';
import { initExtensionInstall } from './components/extension-install.js';

function init() {
  renderSidebar(document.getElementById('sidebar'));
  renderToolbar(document.getElementById('toolbar'));
  renderPageHead(document.getElementById('page-head'));
  renderStatusBar(document.getElementById('statusbar'));
  renderDownloadList(document.getElementById('download-list'));

  initAddUrlModal();
  initSettingsModal();
  initDeleteConfirmModal();
  initContextMenu();
  initDesktopOpen();
  initWindowGuards();
  initTray();
  initBrowserRequests();
  initExtensionInstall();
  syncWindowBackground();

  // Desktop: reveal the (initially hidden) window only after this first frame is painted.
  if (window.__TAURI__?.core) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__TAURI__.core.invoke('app_ready').catch(() => {});
    }));
  }

  store.startLiveUpdates(1500);
}

document.addEventListener('DOMContentLoaded', init);
