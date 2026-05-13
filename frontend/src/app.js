import { store } from './state/store.js';
import { renderHeader } from './components/header.js';
import { renderSidebar } from './components/sidebar.js';
import { renderToolbar } from './components/toolbar.js';
import { renderStatsPanel } from './components/stats-panel.js';
import { renderDownloadList } from './components/download-list.js';
import { initAddUrlModal } from './components/add-url-modal.js';
import { initSettingsModal } from './components/settings-modal.js';

function init() {
  renderHeader(document.getElementById('header'));
  renderSidebar(document.getElementById('sidebar'));
  renderToolbar(document.getElementById('toolbar'));
  renderStatsPanel(document.getElementById('stats-panel'));
  renderDownloadList(document.getElementById('download-list'));

  initAddUrlModal();
  initSettingsModal();

  store.startPolling(1500);
}

document.addEventListener('DOMContentLoaded', init);
