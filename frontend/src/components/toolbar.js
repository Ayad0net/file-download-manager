import { pauseAll, resumeAll, stopAll, clearCompleted } from '../services/api.js';

export function renderToolbar(container) {
  container.innerHTML = `
    <button class="btn btn-primary" id="toolbar-add"><i class="fas fa-plus"></i> Add URL</button>
    <button class="btn" id="toolbar-pause-all"><i class="fas fa-pause"></i> Pause All</button>
    <button class="btn btn-success" id="toolbar-resume-all"><i class="fas fa-play"></i> Resume All</button>
    <button class="btn btn-danger" id="toolbar-stop-all"><i class="fas fa-stop"></i> Stop All</button>
    <button class="btn" id="toolbar-clear"><i class="fas fa-eraser"></i> Clear Completed</button>
  `;

  document.getElementById('toolbar-add').onclick = () => {
    document.getElementById('add-url-modal').classList.remove('hidden');
  };

  document.getElementById('toolbar-pause-all').onclick = async () => {
    await pauseAll();
  };

  document.getElementById('toolbar-resume-all').onclick = async () => {
    await resumeAll();
  };

  document.getElementById('toolbar-stop-all').onclick = async () => {
    await stopAll();
  };

  document.getElementById('toolbar-clear').onclick = async () => {
    await clearCompleted();
  };
}
