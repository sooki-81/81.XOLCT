const { invoke } = window.__TAURI__.core;
const { emit }   = window.__TAURI__.event;

// ─── Элементы UI ─────────────────────────────────────────
const input     = document.getElementById('url-input');
const btnAdd    = document.getElementById('btn-add');
const errorEl   = document.getElementById('import-error');
const toast     = document.getElementById('import-toast');
const toastText = document.getElementById('toast-text');

// ─── Состояния ───────────────────────────────────────────
function setLoading(on) {
  btnAdd.disabled = on;
  btnAdd.innerHTML = on
    ? '<div class="import-spinner"></div>'
    : 'Добавить';
}

let errorTimer = null;
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('visible');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => errorEl.classList.remove('visible'), 5000);
}

function clearError() {
  errorEl.classList.remove('visible');
}

let toastTimer = null;
function showToast(name) {
  toastText.textContent = '«' + name + '» добавлен на стену';
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ─── Импорт ──────────────────────────────────────────────
async function handleImport() {
  const url = input.value.trim();
  if (!url) return;

  clearError();
  setLoading(true);

  try {
    // Запрос идёт через Rust — нет проблем с CORS
    const token = await invoke('fetch_token', { url });

    // Сохраняем в файл
    await invoke('save_token', { token });

    // Уведомляем главное окно (стену)
    await emit('token-added', token);

    input.value = '';
    showToast(token.name);
  } catch (err) {
    // err — строка из Rust (Result::Err)
    showError(typeof err === 'string' ? err : 'Не удалось загрузить объект');
  } finally {
    setLoading(false);
  }
}

btnAdd.addEventListener('click', handleImport);
input.addEventListener('keydown', e => { if (e.key === 'Enter') handleImport(); });
input.addEventListener('input',   () => { if (errorEl.classList.contains('visible')) clearError(); });
