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

// ── Мой код ───────────────────────────────────────────────────────────────────
invoke('get_my_code').then(code => {
  const el = document.getElementById('my-code-value');
  if (el) el.textContent = code;
}).catch(() => {});

document.getElementById('btn-copy-code')?.addEventListener('click', async () => {
  const code = document.getElementById('my-code-value')?.textContent || '';
  if (code && code !== '…') {
    await navigator.clipboard.writeText(code);
    const btn = document.getElementById('btn-copy-code');
    if (btn) { btn.title = 'Скопировано!'; setTimeout(() => { btn.title = 'Скопировать код'; }, 1500); }
  }
});

// ── Отправка подарка ──────────────────────────────────────────────────────────
let selectedFilePath = null;

document.getElementById('btn-open-gift')?.addEventListener('click', () => {
  document.getElementById('gift-modal').style.display = 'flex';
});
document.getElementById('btn-cancel-gift')?.addEventListener('click', () => {
  document.getElementById('gift-modal').style.display = 'none';
  resetGiftForm();
});

const giftFileArea = document.getElementById('gift-file-area');
const giftFileInput = document.getElementById('gift-file');

giftFileArea?.addEventListener('click', () => giftFileInput?.click());
giftFileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  selectedFilePath = file.path || file.name;
  const label = document.getElementById('gift-file-label');
  if (label) label.textContent = file.name;
  // Показываем превью
  const reader = new FileReader();
  reader.onload = ev => {
    giftFileArea.style.backgroundImage = `url("${ev.target.result}")`;
    if (label) label.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

document.getElementById('btn-send-gift')?.addEventListener('click', async () => {
  const toId      = document.getElementById('gift-to-id')?.value?.trim();
  const message   = document.getElementById('gift-message')?.value?.trim() || '';
  const expires   = parseInt(document.getElementById('gift-expires')?.value || '24');
  const statusEl  = document.getElementById('gift-status');
  const btn       = document.getElementById('btn-send-gift');

  if (!selectedFilePath) { if (statusEl) statusEl.textContent = 'Выбери изображение'; return; }
  if (!toId)             { if (statusEl) statusEl.textContent = 'Введи код друга'; return; }

  if (btn) { btn.textContent = 'Отправляем…'; btn.disabled = true; }
  if (statusEl) statusEl.textContent = '';

  try {
    await invoke('send_gift', {
      toId,
      imagePath: selectedFilePath,
      message,
      expiresHours: expires,
    });
    if (statusEl) statusEl.textContent = 'Подарок отправлен!';
    setTimeout(() => {
      document.getElementById('gift-modal').style.display = 'none';
      resetGiftForm();
    }, 1500);
  } catch (e) {
    console.error('[gift]', e);
    if (statusEl) statusEl.textContent = 'Ошибка: ' + e;
  } finally {
    if (btn) { btn.textContent = 'Отправить'; btn.disabled = false; }
  }
});

function resetGiftForm() {
  selectedFilePath = null;
  const label = document.getElementById('gift-file-label');
  if (label) { label.textContent = 'Нажмите чтобы выбрать изображение'; label.style.display = ''; }
  if (giftFileArea) giftFileArea.style.backgroundImage = '';
  const toId = document.getElementById('gift-to-id');
  const msg  = document.getElementById('gift-message');
  if (toId) toId.value = '';
  if (msg)  msg.value  = '';
  const status = document.getElementById('gift-status');
  if (status) status.textContent = '';
  if (giftFileInput) giftFileInput.value = '';
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
