import { t, getLang, setLang, applyTranslations } from './translations.js';

const { invoke } = window.__TAURI__.core;
const { emit }   = window.__TAURI__.event;

let currentSettings = {};

// ─── Инициализация ────────────────────────────────────────────────────────────
async function init() {
  try {
    currentSettings = await invoke('load_settings');
  } catch (e) {
    console.warn('[settings] load failed:', e);
    currentSettings = {
      wall_background:  'dark',
      card_frame:       'light',
      card_radius:      'L',
      shortcut_open:    'ctrl+alt+z',
      shortcut_left:    'ctrl+alt+a',
      shortcut_right:   'ctrl+alt+d',
      shortcut_desktop: 'ctrl+alt+h',
      shortcut_up:      'ctrl+alt+w',
      shortcut_down:    'ctrl+alt+s',
    };
  }

  // ── Переключатели ────────────────────────────────────────────────────────────
  let autoStartEnabled = false;
  try { autoStartEnabled = await invoke('get_autostart_enabled'); } catch (_) {}
  document.getElementById('toggle-autostart').checked = autoStartEnabled;

  document.getElementById('toggle-autostart').addEventListener('change', async e => {
    try {
      await invoke('set_autostart_enabled', { enabled: e.target.checked });
    } catch (err) {
      console.error('[settings] autostart failed:', err);
    }
  });

  document.getElementById('toggle-icon-underlays').checked =
    currentSettings.icon_underlays_enabled !== false;

  document.getElementById('toggle-icon-underlays').addEventListener('change', async e => {
    currentSettings.icon_underlays_enabled = e.target.checked;
    try {
      await invoke('save_settings', { settings: currentSettings });
      await emit('settings-updated', currentSettings);
    } catch (err) {
      console.error('[settings] icon_underlays save failed:', err);
    }
  });

  // ── Заполняем поля горячих клавиш ────────────────────────────────────────────
  document.getElementById('hk-open').value    = fmt(currentSettings.shortcut_open);
  document.getElementById('hk-left').value    = fmt(currentSettings.shortcut_left);
  document.getElementById('hk-right').value   = fmt(currentSettings.shortcut_right);
  document.getElementById('hk-desktop').value = fmt(currentSettings.shortcut_desktop || 'ctrl+alt+h');
  document.getElementById('hk-up').value      = fmt(currentSettings.shortcut_up      || 'ctrl+alt+w');
  document.getElementById('hk-down').value    = fmt(currentSettings.shortcut_down    || 'ctrl+alt+s');

  // ── Захват горячих клавиш ────────────────────────────────────────────────────
  setupHotkeyCapture('hk-open',    'shortcut_open');
  setupHotkeyCapture('hk-left',    'shortcut_left');
  setupHotkeyCapture('hk-right',   'shortcut_right');
  setupHotkeyCapture('hk-desktop', 'shortcut_desktop');
  setupHotkeyCapture('hk-up',      'shortcut_up');
  setupHotkeyCapture('hk-down',    'shortcut_down');

  // ── Язык ─────────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.langBtn));
  });

  // ── Копирование крипто-адресов ───────────────────────────────────────────────
  document.querySelectorAll('.settings-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = document.getElementById(btn.dataset.copy)?.textContent;
      if (addr) navigator.clipboard.writeText(addr).then(() => {
        btn.textContent = t('settings.copied');
        setTimeout(() => { btn.textContent = t('settings.copy'); }, 2000);
      });
    });
  });

  // ── Кнопка назад ────────────────────────────────────────────────────────────
  document.getElementById('settings-back').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  applyTranslations();
}

// ─── Форматирование строки шорткута для отображения ───────────────────────────
function fmt(s) {
  if (!s) return '';
  return s.split('+').map(p => {
    const l = p.trim().toLowerCase();
    if (l === 'ctrl' || l === 'control') return 'Ctrl';
    if (l === 'alt')   return 'alt';
    if (l === 'shift') return 'Shift';
    if (l === 'arrowleft')  return '←';
    if (l === 'arrowright') return '→';
    if (l === 'arrowup')    return '↑';
    if (l === 'arrowdown')  return '↓';
    return p.trim().toUpperCase();
  }).join('+');
}

// ─── Захват горячей клавиши ───────────────────────────────────────────────────
function setupHotkeyCapture(fieldId, settingsKey) {
  const field = document.getElementById(fieldId);

  field.addEventListener('click', () => field.focus());

  field.addEventListener('focus', () => {
    field.value = t('settings.hk.capturing');
    field.classList.add('capturing');
  });

  field.addEventListener('blur', () => {
    field.value = fmt(currentSettings[settingsKey]);
    field.classList.remove('capturing');
  });

  field.addEventListener('keydown', async e => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      field.blur();
      return;
    }

    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const parts = [];
    if (e.ctrlKey)  parts.push('ctrl');
    if (e.altKey)   parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    const keyName = mapKey(e.key);
    if (!keyName) { field.blur(); return; }
    parts.push(keyName);

    const newShortcut = parts.join('+');
    currentSettings[settingsKey] = newShortcut;
    field.value = fmt(newShortcut);
    field.blur();

    try {
      await invoke('update_shortcuts', { settings: currentSettings });
      await invoke('save_settings',    { settings: currentSettings });
    } catch (err) {
      console.error('[settings] shortcut update failed:', err);
    }
  });
}

// ─── Нормализация имени клавиши ───────────────────────────────────────────────
function mapKey(key) {
  if (key.length === 1) return key.toLowerCase();
  const map = {
    ArrowLeft:  'arrowleft',
    ArrowRight: 'arrowright',
    ArrowUp:    'arrowup',
    ArrowDown:  'arrowdown',
  };
  return map[key] || null;
}

init();
