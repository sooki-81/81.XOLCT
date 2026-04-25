const T = {
  ru: {
    'settings.back':             'Назад',
    'settings.section.view':     'Вид',
    'settings.section.hotkeys':  'Горячие клавиши',
    'settings.section.contacts': 'Контакты и поддержка',
    'settings.autostart':        'Автозапуск при входе в систему',
    'settings.icon_underlays':   'Подложки под ярлыки рабочего стола',
    'settings.lang.label':       'Язык',
    'settings.hk.open':          'Открытие приложения',
    'settings.hk.left':          'Пролистывание галереи влево',
    'settings.hk.right':         'Пролистывание галереи вправо',
    'settings.hk.desktop':       'Скрыть / показать ярлыки рабочего стола',
    'settings.hk.up':            'Прокрутка галереи вверх',
    'settings.hk.down':          'Прокрутка галереи вниз',
    'settings.contact.email':    'Почта',
    'settings.contact.telegram': 'Telegram',
    'settings.donate.title':     'Поддержать донатом',
    'settings.copy':             'Скопировать',
    'settings.copied':           'Скопировано',
    'settings.hk.capturing':     'Нажмите сочетание…',

    'dash.bg.title':          'Фон домашнего экрана',
    'dash.bg.dark':           'темнота',
    'dash.bg.pixpix':         'пикс-пикс',
    'dash.bg.fff':            'f-f-f',
    'dash.bg.gradient81':     'это 81',
    'dash.frame.label':       'Фон рамки',
    'dash.frame.light':       'светлый',
    'dash.frame.dark':        'тёмный',
    'dash.frame.gray':        'серый',
    'dash.frame.totalblack':  'total-black',
    'dash.radius.label':      'Скругление',
    'dash.save':              'Сохранить изменения',
    'dash.add.title':         'Добавить объект',

    'popup.import.title':       'Импорт объектов',
    'popup.import.desc':        'Поддерживаются <span class="dash-popup-platform">objkt.com</span> и <span class="dash-popup-platform">Pinterest</span>. Вставьте ссылку на произведение.',
    'popup.import.placeholder': 'Ссылка на объект',
    'popup.import.submit':      'Добавить',

    'verify.title':       'Подтвердить владение',
    'verify.desc':        'Введите адрес Tezos-кошелька, которому принадлежит этот объект. Приложение проверит владение напрямую через блокчейн.',
    'verify.placeholder': 'tz1...',
    'verify.submit':      'Проверить',
    'verify.checking':    'Проверяем на блокчейне…',
    'verify.success':     'Владение подтверждено',
    'verify.done':        'Готово',
    'verify.trial.btn':   'Добавить без подтверждения на 3 дня',
    'verify.trial.or':    'или',
    'verify.quota':       (n) => n > 0
      ? `Осталось бесплатных добавлений в этом месяце: ${n} из 5`
      : 'Лимит исчерпан — бесплатные добавления недоступны в этом месяце',
    'verify.error.notowner': 'Этот кошелёк не является владельцем данного объекта.',

    'confirm.title':  'Вы точно хотите удалить этот объект с экрана?',
    'confirm.desc':   'Чтобы вернуть данный объект на холст вам понадобится снова вставить ссылку, но подтверждать владение уже не понадобится.',
    'confirm.cancel': 'Отменить',
    'confirm.delete': 'Да, удалить',

    'dash.empty':           'Нажмите + чтобы добавить первый объект',
    'card.verify.btn':      'Подтвердить владение',
    'popup.load.error':     'Не удалось загрузить объект',

    'welcome.title':    'Преврати ПК в персональную галерею',
    'welcome.subtitle': 'Импортируй объекты цифрового искусства с блокчейн-платформ и размещай их на своём экране',
    'welcome.start':    'Начать',
  },

  en: {
    'settings.back':             'Back',
    'settings.section.view':     'Display',
    'settings.section.hotkeys':  'Hotkeys',
    'settings.section.contacts': 'Contacts & Support',
    'settings.autostart':        'Launch at startup',
    'settings.icon_underlays':   'Desktop icon underlays',
    'settings.lang.label':       'Language',
    'settings.hk.open':          'Open application',
    'settings.hk.left':          'Scroll gallery left',
    'settings.hk.right':         'Scroll gallery right',
    'settings.hk.desktop':       'Hide / show desktop icons',
    'settings.hk.up':            'Scroll gallery up',
    'settings.hk.down':          'Scroll gallery down',
    'settings.contact.email':    'Email',
    'settings.contact.telegram': 'Telegram',
    'settings.donate.title':     'Support with a donation',
    'settings.copy':             'Copy',
    'settings.copied':           'Copied',
    'settings.hk.capturing':     'Press keys…',

    'dash.bg.title':          'Home screen background',
    'dash.bg.dark':           'darkness',
    'dash.bg.pixpix':         'pix-pix',
    'dash.bg.fff':            'f-f-f',
    'dash.bg.gradient81':     "it's 81",
    'dash.frame.label':       'Frame background',
    'dash.frame.light':       'light',
    'dash.frame.dark':        'dark',
    'dash.frame.gray':        'gray',
    'dash.frame.totalblack':  'total-black',
    'dash.radius.label':      'Corner radius',
    'dash.save':              'Save changes',
    'dash.add.title':         'Add object',

    'popup.import.title':       'Import objects',
    'popup.import.desc':        'Supported: <span class="dash-popup-platform">objkt.com</span> and <span class="dash-popup-platform">Pinterest</span>. Paste a link to the artwork.',
    'popup.import.placeholder': 'Link to artwork',
    'popup.import.submit':      'Add',

    'verify.title':       'Confirm ownership',
    'verify.desc':        'Enter the Tezos wallet address that owns this object. The app will verify ownership directly on the blockchain.',
    'verify.placeholder': 'tz1...',
    'verify.submit':      'Verify',
    'verify.checking':    'Checking on blockchain…',
    'verify.success':     'Ownership confirmed',
    'verify.done':        'Done',
    'verify.trial.btn':   'Add without confirmation for 3 days',
    'verify.trial.or':    'or',
    'verify.quota':       (n) => n > 0
      ? `Free additions remaining this month: ${n} of 5`
      : 'Limit reached — free additions are unavailable this month',
    'verify.error.notowner': 'This wallet is not the owner of this object.',

    'confirm.title':  'Remove this object from the screen?',
    'confirm.desc':   'To add it back you will need to paste the link again, but you will not need to verify ownership.',
    'confirm.cancel': 'Cancel',
    'confirm.delete': 'Yes, delete',

    'dash.empty':           'Press + to add your first object',
    'card.verify.btn':      'Confirm ownership',
    'popup.load.error':     'Failed to load object',

    'welcome.title':    'Turn your PC into a personal gallery',
    'welcome.subtitle': 'Import digital art objects from blockchain platforms and display them on your screen',
    'welcome.start':    'Start',
  },
};

export function getLang() {
  return localStorage.getItem('lang') || 'ru';
}

export function setLang(lang) {
  localStorage.setItem('lang', lang);
  applyTranslations();
}

export function t(key, ...args) {
  const lang = getLang();
  const val = (T[lang] && T[lang][key]) ?? T.ru[key];
  if (typeof val === 'function') return val(...args);
  return val ?? key;
}

export function applyTranslations() {
  const lang = getLang();
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.dataset.i18n);
    if (v !== undefined) el.textContent = v;
  });

  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const v = t(el.dataset.i18nHtml);
    if (v !== undefined) el.innerHTML = v;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const v = t(el.dataset.i18nPlaceholder);
    if (v !== undefined) el.placeholder = v;
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const v = t(el.dataset.i18nTitle);
    if (v !== undefined) el.title = v;
  });

  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.langBtn === lang);
  });
}
