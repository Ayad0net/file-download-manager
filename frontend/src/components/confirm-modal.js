let activeResolve = null;

function doClose(result) {
  const overlay = document.getElementById('action-confirm-modal');
  if (!overlay || !activeResolve) return;
  const resolve = activeResolve;
  activeResolve = null;
  overlay.classList.add('hidden');
  resolve(result);
}

function ensureOverlay() {
  let overlay = document.getElementById('action-confirm-modal');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'action-confirm-modal';
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal confirm-modal">
      <div class="confirm-icon" id="acm-icon"></div>
      <div class="modal-body">
        <h3 class="confirm-title" id="acm-title"></h3>
        <p class="confirm-text" id="acm-message"></p>
      </div>
      <div class="modal-footer confirm-footer">
        <button class="btn" id="acm-cancel">Cancel</button>
        <button class="btn btn-primary" id="acm-confirm-btn"></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#acm-cancel').onclick = () => doClose(false);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) doClose(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) doClose(false);
  });

  return overlay;
}

const TONES = {
  info: { iconClass: 'tone-info', btnClass: 'btn-primary' },
  warning: { iconClass: 'tone-warning', btnClass: 'btn-primary' },
  success: { iconClass: 'tone-success', btnClass: 'btn-success' },
  danger: { iconClass: 'tone-danger', btnClass: 'btn-danger' },
};

export function confirmAction({ title, message, icon = 'fa-circle-question', tone = 'info', confirmText = 'Confirm' }) {
  return new Promise((resolve) => {
    const overlay = ensureOverlay();
    const toneStyle = TONES[tone] || TONES.info;

    const iconEl = overlay.querySelector('#acm-icon');
    iconEl.className = `confirm-icon ${toneStyle.iconClass}`;
    iconEl.innerHTML = `<i class="fas ${icon}"></i>`;

    overlay.querySelector('#acm-title').textContent = title;
    overlay.querySelector('#acm-message').textContent = message;

    const confirmBtn = overlay.querySelector('#acm-confirm-btn');
    confirmBtn.className = `btn ${toneStyle.btnClass}`;
    confirmBtn.innerHTML = confirmText;
    confirmBtn.onclick = () => doClose(true);

    activeResolve = resolve;
    overlay.classList.remove('hidden');

    const card = overlay.querySelector('.confirm-modal');
    card.classList.remove('pop-in');
    void card.offsetWidth;
    card.classList.add('pop-in');
  });
}
