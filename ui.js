globalThis.UI = {
  _stylesInjected: false,

  _injectStyles() {
    if (this._stylesInjected) return;
    this._stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = [
      '.ui-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:10000;animation:ui-fade 0.15s ease;}',
      '.ui-modal{background:rgba(26,26,28,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:20px;width:290px;max-width:calc(100vw - 48px);box-shadow:0 24px 60px rgba(0,0,0,0.5),0 0 60px rgba(123,92,255,0.15);animation:ui-rise 0.3s cubic-bezier(0.34,1.56,0.64,1);}',
      '.ui-modal-title{font-weight:600;font-size:15px;color:#E8E8E8;margin:0 0 10px;}',
      '.ui-modal-message{font-size:13px;color:rgba(232,232,232,0.7);line-height:1.5;margin:0 0 18px;}',
      '.ui-modal-actions{display:flex;gap:8px;justify-content:flex-end;}',
      '.ui-btn{font-family:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:10px;border:1px solid transparent;cursor:pointer;transition:transform 0.1s ease,background 0.15s ease,border-color 0.15s ease;}',
      '.ui-btn:active{transform:scale(0.97);}',
      '.ui-btn-cancel{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#E8E8E8;}',
      '.ui-btn-cancel:hover{background:rgba(255,255,255,0.1);}',
      '.ui-btn-confirm{background:#5CFFE0;color:#161618;}',
      '.ui-btn-confirm:hover{background:#7dffe8;}',
      '.ui-btn-confirm.ui-danger{background:#FF5252;color:#fff;}',
      '.ui-btn-confirm.ui-danger:hover{background:#ff6b6b;}',
      '.ui-btn:focus-visible{outline:2px solid #5CFFE0;outline-offset:2px;}',
      '.ui-toast-stack{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:10001;}',
      '.ui-toast{font-size:13px;font-weight:600;padding:10px 16px;border-radius:10px;max-width:300px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:ui-rise 0.2s ease;}',
      '.ui-toast.ui-error{background:rgba(255,82,82,0.15);border:1px solid rgba(255,82,82,0.35);color:#FF5252;}',
      '.ui-toast.ui-success{background:rgba(92,255,224,0.12);border:1px solid rgba(92,255,224,0.35);color:#5CFFE0;}',
      '.ui-toast.ui-info{background:rgba(123,92,255,0.15);border:1px solid rgba(123,92,255,0.35);color:#c3b5ff;}',
      '@keyframes ui-fade{from{opacity:0;}to{opacity:1;}}',
      '@keyframes ui-rise{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}'
    ].join('');

    document.head.appendChild(style);
  },

  confirm(message, options = {}) {
    this._injectStyles();

    const title = options.title || 'Confirmation';
    const confirmLabel = options.confirmLabel || 'Confirmer';
    const cancelLabel = options.cancelLabel || 'Annuler';
    const danger = options.danger === true;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ui-overlay';

      const modal = document.createElement('div');
      modal.className = 'ui-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      const titleEl = document.createElement('p');
      titleEl.className = 'ui-modal-title';
      titleEl.textContent = title;

      const messageEl = document.createElement('p');
      messageEl.className = 'ui-modal-message';
      messageEl.textContent = message;

      const actions = document.createElement('div');
      actions.className = 'ui-modal-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ui-btn ui-btn-cancel';
      cancelBtn.textContent = cancelLabel;

      const confirmBtn = document.createElement('button');
      confirmBtn.className = `ui-btn ui-btn-confirm${danger ? ' ui-danger' : ''}`;
      confirmBtn.textContent = confirmLabel;

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      modal.appendChild(titleEl);
      modal.appendChild(messageEl);
      modal.appendChild(actions);
      overlay.appendChild(modal);

      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        overlay.remove();
        resolve(result);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      };

      cancelBtn.addEventListener('click', () => close(false));
      confirmBtn.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      confirmBtn.focus();
    });
  },

  toast(message, type = 'info', duration = 3500) {
    this._injectStyles();

    let stack = document.querySelector('.ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'ui-toast-stack';
      document.body.appendChild(stack);
    }

    const toast = document.createElement('div');
    toast.className = `ui-toast ui-${type}`;
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    stack.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.2s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
};
