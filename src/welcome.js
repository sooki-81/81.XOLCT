import { applyTranslations } from './translations.js';

const { getCurrentWindow } = window.__TAURI__.window;
const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

const win = getCurrentWindow();
applyTranslations();

// ── Window controls (одинаковые на welcome/dashboard/settings) ────────────────
document.getElementById('btn-minimize')?.addEventListener('click', () => win.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => win.toggleMaximize());
document.getElementById('btn-close')?.addEventListener('click',    () => win.hide());
document.getElementById('btn-settings')?.addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// ── Логика первого запуска — только на welcome.html ──────────────────────────
const isWelcomePage = !!document.querySelector('.welcome-screen');

if (isWelcomePage) {
  invoke('is_first_run').then(isFirst => {
    if (!isFirst) {
      // Существующий пользователь — сразу на дашборд, контент welcome не показываем
      window.location.href = 'dashboard.html';
    } else {
      // Первый запуск — раскрываем welcome
      document.body.style.visibility = 'visible';
    }
  }).catch(() => { document.body.style.visibility = 'visible'; });

  document.getElementById('btn-start')?.addEventListener('click', async () => {
    try { await invoke('mark_first_run_complete'); } catch {}
    window.location.href = 'dashboard.html';
  });
}

// ── Обновления (баннер появляется на любой странице с #update-banner) ────────
function showUpdateBanner(version) {
  const banner = document.getElementById('update-banner');
  const text   = document.getElementById('update-banner-text');
  if (!banner) return;
  if (text) text.textContent = `Доступно обновление v${version}`;
  banner.style.display = 'flex';
}

invoke('get_update_version').then(v => { if (v) showUpdateBanner(v); }).catch(() => {});
listen('update-available', e => showUpdateBanner(e.payload));

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

document.getElementById('btn-check-update')?.addEventListener('click', async () => {
  const text = document.getElementById('version-text');
  const original = text?.textContent || '';
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
