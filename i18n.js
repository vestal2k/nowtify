globalThis.I18N = {
  t(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions);
  },

  locale() {
    return chrome.i18n.getUILanguage();
  },

  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = this.t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.getAttribute('data-i18n-title'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'));
    });
  }
};
