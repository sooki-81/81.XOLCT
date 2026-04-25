import { applyTranslations } from './translations.js';

const { getCurrentWindow } = window.__TAURI__.window;

const win = getCurrentWindow();
applyTranslations();

document.getElementById('btn-minimize').addEventListener('click', () => win.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => win.toggleMaximize());
document.getElementById('btn-close').addEventListener('click', () => win.hide());

document.getElementById('btn-settings')?.addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// Переход на экран импорта
const btnStart = document.getElementById('btn-start');
if (btnStart) {
  btnStart.addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });
}
