import { applyTranslations } from './translations.js';

const { getCurrentWindow } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

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

// ── Обновления ────────────────────────────────────────────────────────────────
function showUpdateBanner(version) {
  const banner = document.getElementById('update-banner');
  const text   = document.getElementById('update-banner-text');
  if (!banner) return;
  if (text) text.textContent = `Доступно обновление v${version}`;
  banner.style.display = 'flex';
}

// Проверяем, не нашёл ли Rust обновление пока окно было закрыто
invoke('get_update_version').then(v => { if (v) showUpdateBanner(v); }).catch(() => {});

// Слушаем событие в реальном времени
listen('update-available', e => showUpdateBanner(e.payload));

// Ручная проверка обновлений
document.getElementById('btn-check-update')?.addEventListener('click', async () => {
  const text = document.getElementById('version-text');
  const original = text?.textContent || 'v1.0.8';
  if (text) text.textContent = 'Проверяем…';
  try {
    const newVersion = await invoke('check_for_updates');
    if (newVersion) {
      showUpdateBanner(newVersion);
      if (text) text.textContent = original;
    } else {
      if (text) text.textContent = 'Актуальная версия';
      setTimeout(() => { if (text) text.textContent = original; }, 2000);
    }
  } catch (e) {
    console.error('[update-check]', e);
    if (text) text.textContent = 'Ошибка проверки';
    setTimeout(() => { if (text) text.textContent = original; }, 2500);
  }
});

document.getElementById('btn-update')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-update');
  if (btn) { btn.textContent = 'Устанавливаем…'; btn.disabled = true; }
  try {
    await invoke('install_update');
  } catch (e) {
    console.error('[update]', e);
    if (btn) { btn.textContent = 'Обновить'; btn.disabled = false; }
  }
});
