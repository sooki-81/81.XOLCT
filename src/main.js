const { invoke } = window.__TAURI__.core;
const { listen }  = window.__TAURI__.event;

// ─── Конфигурация карточек (фон × рамка) ─────────────────────────────────────
const SHADOW_FULL = '0 6px 24px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.75)';
const SHADOW_15   = '0 6px 24px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.15)';
const SHADOW_7    = '0 6px 24px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.07)';
const SHADOW_NONE = 'none';
const GRAY_BG     = 'linear-gradient(to bottom, #6b6b6b, #ffffff)';

const CARD_CONFIGS = {
  dark: {
    light:       { bg: '#272727',                shadow: SHADOW_FULL, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
    dark:        { bg: '#050505',                shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
    gray:        { bg: GRAY_BG,                  shadow: SHADOW_FULL, title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    total_black: { bg: '#000000',                shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
  },
  pixpix: {
    light:       { bg: '#2065F3',                shadow: SHADOW_15,   title: 'var(--fg)',        authors: 'var(--fg)'        },
    dark:        { bg: '#0036A7',                shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg)'        },
    gray:        { bg: GRAY_BG,                  shadow: SHADOW_NONE, title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    total_black: { bg: '#000000',                shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
  },
  fff: {
    light:       { bg: '#ffffff',                shadow: SHADOW_7,    title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    dark:        { bg: '#e9e9e9',                shadow: SHADOW_NONE, title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    gray:        { bg: GRAY_BG,                  shadow: SHADOW_NONE, title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    total_black: { bg: '#000000',                shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
  },
  gradient81: {
    light:       { bg: 'rgba(255,255,255,0.2)',  shadow: SHADOW_7,    title: 'var(--fg-invert)', authors: 'var(--fg-invert)' },
    dark:        { bg: 'rgba(0,0,0,0.2)',         shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg)'        },
    gray:        { bg: GRAY_BG,                   shadow: SHADOW_NONE, title: 'var(--fg-invert)', authors: 'var(--fg-muted)'  },
    total_black: { bg: '#000000',                 shadow: SHADOW_NONE, title: 'var(--fg)',        authors: 'var(--fg-subtle)' },
  },
};

// ─── Применение настроек ──────────────────────────────────────────────────────
function applySettings(settings) {
  const wall = wallEl || document.getElementById('wall');
  if (!wall || !settings) return;

  // Фон стены
  switch (settings.wall_background) {
    case 'pixpix':
      wall.style.backgroundImage  = "url('./bg-pixpix.jpg')";
      wall.style.backgroundRepeat = 'repeat';
      wall.style.backgroundSize   = '320px auto';
      wall.style.backgroundColor  = '#0033bb';
      break;
    case 'fff':
      wall.style.backgroundImage = '';
      wall.style.backgroundColor = '#ffffff';
      break;
    case 'gradient81':
      wall.style.backgroundImage = 'radial-gradient(ellipse at 94% 96%, #c3f73a 0%, #0044f1 100%)';
      wall.style.backgroundSize  = 'cover';
      wall.style.backgroundColor = '';
      break;
    default: // 'dark'
      wall.style.backgroundImage = 'linear-gradient(to bottom, #111111, #050505)';
      wall.style.backgroundSize  = 'cover';
      wall.style.backgroundColor = '';
  }

  // Конфиг карточки (фон + тень + цвета текста)
  const wallBg = settings.wall_background || 'dark';
  const frame  = settings.card_frame      || 'light';
  const cfgRow = CARD_CONFIGS[wallBg] || CARD_CONFIGS.dark;
  const cfg    = cfgRow[frame] || cfgRow.light;

  document.documentElement.style.setProperty('--card-frame-bg',      cfg.bg);
  document.documentElement.style.setProperty('--card-shadow',        cfg.shadow);
  document.documentElement.style.setProperty('--card-title-color',   cfg.title);
  document.documentElement.style.setProperty('--card-authors-color', cfg.authors);

  // Скругление карточки
  const radii = { '0': '0px', 'L': '10px', 'XL': '20px' };
  document.documentElement.style.setProperty(
    '--card-radius',
    radii[settings.card_radius] || '10px'
  );
}

// ─── Соотношение сторон рамки ─────────────────────────────────────────────────
function getFrameRatio(w, h) {
  const ratio = w / h;
  if (ratio > 1.52) return [16, 9];
  if (ratio > 1.15) return [4, 3];
  if (ratio >= 0.87) return [1, 1];
  if (ratio >= 0.65) return [3, 4];
  return [9, 16];
}

// ─── Константы ───────────────────────────────────────────────────────────────
const WALL_PADDING  = 160;
const CARD_GAP      = 80;
const SCREEN_MARGIN = 100;
const MIN_ART       = 80;  // пониженный порог — не раздуваем маленькие карточки сверх wall_scale
const TITLE_H       = Math.round(11 * 1.333 * 1.3);
const AUTHORS_H     = Math.round(9  * 1.333 * 1.3);
const LABEL_GAP     = 6;
const LABEL_H       = TITLE_H + LABEL_GAP + AUTHORS_H;

// ─── Адаптивный отступ паспарту ───────────────────────────────────────────────
function computePad(minDim) {
  const slope = (45 - 20) / (631 - 250);
  return Math.round(20 + Math.max(0, minDim - 250) * slope);
}

// ─── Размеры карточки ─────────────────────────────────────────────────────────
function computeCard(desiredFrameH, rw, rh) {
  let frameH = desiredFrameH;
  for (let i = 0; i < 8; i++) {
    const frameW   = Math.round(frameH * rw / rh);
    const minDim   = Math.min(frameW, frameH);
    const pad      = computePad(minDim);
    const artworkW = frameW - 2 * pad;
    const artworkH = frameH - 3 * pad - LABEL_H;
    if (artworkW >= MIN_ART && artworkH >= MIN_ART) {
      return { frameH, frameW, artworkW, artworkH, pad };
    }
    const scaleW = artworkW < MIN_ART ? (MIN_ART + 2 * pad) / frameW : 1;
    const scaleH = artworkH < MIN_ART ? (MIN_ART + 3 * pad + LABEL_H) / frameH : 1;
    frameH = Math.round(frameH * Math.max(scaleW, scaleH));
  }
  const frameW  = Math.round(frameH * rw / rh);
  const minDim  = Math.min(frameW, frameH);
  const pad     = computePad(minDim);
  return { frameH, frameW,
    artworkW: Math.max(frameW - 2 * pad, MIN_ART),
    artworkH: Math.max(frameH - 3 * pad - LABEL_H, MIN_ART), pad };
}

// ─── Измерение текста ─────────────────────────────────────────────────────────
const _mc  = document.createElement('canvas');
const _mct = _mc.getContext('2d');

function measureText(text, weight, sizePx) {
  _mct.font = `${weight} ${sizePx}px 'Involve', sans-serif`;
  return _mct.measureText(text).width;
}

const AUTHORS_PX = Math.round(9 * 1.333);

function formatAuthors(authors, maxWidthPx) {
  if (!authors || authors.length === 0) return '';
  const full = authors.join(', ');
  if (measureText(full, '400', AUTHORS_PX) <= maxWidthPx) return full;
  for (let visible = authors.length - 1; visible >= 1; visible--) {
    const hidden = authors.length - visible;
    const text   = authors.slice(0, visible).join(', ') + ` +${hidden}`;
    if (measureText(text, '400', AUTHORS_PX) <= maxWidthPx) return text;
  }
  return `+${authors.length}`;
}

// ─── Фильтр небезопасных URL + нормализация устаревших IPFS-шлюзов ──────────
function safeUri(uri) {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    const host = url.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null;
    // cloudflare-ipfs.com закрыт — заменяем на ipfs.io
    if (host === 'cloudflare-ipfs.com') {
      return 'https://ipfs.io' + url.pathname + url.search;
    }
  } catch { /* не URL — оставляем как есть */ }
  return uri;
}

// ─── Плейсхолдер (показывается пока нет интернета) ───────────────────────────
const placeholder = document.getElementById('wall-placeholder');

function hidePlaceholder() {
  if (placeholder) placeholder.classList.add('hidden');
}

// ─── Подложки под ярлыки рабочего стола ──────────────────────────────────────
let _iconLayerEl         = null;
let _prevIconData        = '';
let _iconUnderlaysEnabled = true;

function getIconLayer() {
  if (!_iconLayerEl) {
    _iconLayerEl = document.createElement('div');
    _iconLayerEl.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:100;';
    document.body.appendChild(_iconLayerEl);
  }
  return _iconLayerEl;
}

async function updateIconUnderlays() {
  if (!_iconUnderlaysEnabled) {
    if (_iconLayerEl) { _iconLayerEl.innerHTML = ''; _prevIconData = ''; }
    return;
  }
  let icons;
  try { icons = await invoke('get_desktop_icons'); } catch { return; }

  const key = JSON.stringify(icons);
  if (key === _prevIconData) return; // позиции не изменились — не трогаем DOM
  _prevIconData = key;

  // Позиции изменились (ярлык перетащили) — убираем пунктирную рамку фокуса
  invoke('clear_icon_selection').catch(() => {});

  const layer = getIconLayer();
  const dpr   = window.devicePixelRatio || 1;
  layer.innerHTML = '';

  const TOP_OFFSET    = 3;
  const BOTTOM_OFFSET = 2;
  icons.forEach(ic => {
    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;` +
      `left:${ic.x / dpr}px;top:${(ic.y - TOP_OFFSET) / dpr}px;` +
      `width:${ic.w / dpr}px;height:${(ic.h + TOP_OFFSET + BOTTOM_OFFSET) / dpr}px;` +
      `background:var(--card-frame-bg);` +
      `border-radius:var(--card-radius);`;
    layer.appendChild(el);
  });
}

// ─── Создать карточку из токена ───────────────────────────────────────────────
function createCard(token, frameH) {
  const imgUrl = safeUri(token.display_uri);
  return new Promise(resolve => {
    if (!imgUrl) {
      resolve({ el: buildCardEl(token, frameH, 1, 1, null), loaded: false });
      return;
    }
    const img = new Image();
    img.onload = () => {
      const [rw, rh] = getFrameRatio(img.naturalWidth || 1, img.naturalHeight || 1);
      resolve({ el: buildCardEl(token, frameH, rw, rh, imgUrl), loaded: true });
    };
    img.onerror = () => {
      resolve({ el: buildCardEl(token, frameH, 1, 1, null), loaded: false });
    };
    img.src = imgUrl;
  });
}

function buildCardEl(token, desiredFrameH, rw, rh, imgUrl) {
  const safeImg = safeUri(imgUrl);
  // Pinterest: чистая картинка, без рамки и подписи
  if (token.source === 'pinterest') {
    const frameW = Math.max(Math.round(desiredFrameH * rw / rh), 40);
    const wrapper = document.createElement('div');
    wrapper.className    = 'card-wrapper';
    wrapper.style.width  = frameW + 'px';
    wrapper.style.height = desiredFrameH + 'px';
    wrapper.style.borderRadius = 'var(--card-radius)';
    wrapper.style.overflow = 'hidden';
    wrapper.style.background = safeImg
      ? `url("${safeImg}") center/cover no-repeat`
      : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
    return wrapper;
  }

  const { frameH, frameW, artworkW, artworkH, pad } = computeCard(desiredFrameH, rw, rh);

  // Обёртка — через неё считаем ширину/высоту в buildWall
  const wrapper = document.createElement('div');
  wrapper.className    = 'card-wrapper';
  wrapper.style.width  = frameW + 'px';
  wrapper.style.height = frameH + 'px';

  const mat = document.createElement('div');
  mat.className           = 'frame-mat';
  mat.style.width         = frameW + 'px';
  mat.style.height        = frameH + 'px';
  mat.style.paddingTop    = pad + 'px';
  mat.style.paddingBottom = pad + 'px';
  mat.style.gap           = pad + 'px';

  const inner = document.createElement('div');
  inner.className        = 'artwork-inner';
  inner.style.width      = artworkW + 'px';
  inner.style.height     = artworkH + 'px';
  inner.style.position   = 'relative';
  inner.style.zIndex     = '1';

  if (safeImg) {
    inner.style.backgroundImage    = `url("${safeImg}")`;
    inner.style.backgroundSize     = 'cover';
    inner.style.backgroundPosition = 'center';
  } else {
    inner.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
  }

  const label = document.createElement('div');
  label.className  = 'card-label';
  label.style.gap  = LABEL_GAP + 'px';
  label.style.width = artworkW + 'px';

  const titleEl = document.createElement('div');
  titleEl.className   = 'card-title';
  titleEl.textContent = token.name || '';

  const authorsEl = document.createElement('div');
  authorsEl.className   = 'card-authors';
  authorsEl.textContent = formatAuthors(token.creators, artworkW);

  label.appendChild(titleEl);
  label.appendChild(authorsEl);
  mat.appendChild(inner);
  mat.appendChild(label);
  wrapper.appendChild(mat);
  return wrapper;
}

// ─── Стена ───────────────────────────────────────────────────────────────────
let tokens     = [];
let maxScrollX = 0;
let isFreeform = false; // true когда все токены имеют сохранённые позиции
const BASE_WALL_SCALE = 1.0; // базовый масштаб карточки
let _wallRetryTimer = null;

async function buildWall() {
  const wall = document.getElementById('wall');
  wall.innerHTML = '';

  // Если токенов нет — сразу прячем заглушку (показывать нечего)
  if (tokens.length === 0) {
    hidePlaceholder();
    return;
  }

  // Если все токены Pinterest — скрываем заглушку сразу (CSS-фон, img.onload не стреляет)
  const allPinterest = tokens.every(t => t.source === 'pinterest');
  if (allPinterest) hidePlaceholder();

  const hasPositions = tokens.length > 0 &&
    tokens.every(t => t.dash_x != null && t.dash_y != null);

  const maxH   = window.innerHeight - SCREEN_MARGIN * 2;
  const results = await Promise.all(
    tokens.map(token => createCard(token, Math.round(maxH * 0.75 * (token.wall_scale || 1.0))))
  );
  const cards    = results.map(r => r.el);
  const anyLoaded = results.some(r => r.loaded);

  isFreeform = hasPositions;

  if (hasPositions) {
    // Свободное расположение — позиции заданы в дашборде
    wall.style.display  = 'block';
    wall.style.padding  = '0';
    wall.style.gap      = '0';

    let maxRight = 0;
    let maxBottom = 0;
    cards.forEach((card, i) => {
      const token  = tokens[i];
      const frameW = parseInt(card.style.width);
      const frameH = parseInt(card.style.height);
      const wallBase = (window.innerHeight - SCREEN_MARGIN * 2) * 0.75;
      const left = Math.round(token.dash_x * wallBase);
      const top  = Math.round(token.dash_y * wallBase);

      card.style.position = 'absolute';
      card.style.left     = left + 'px';
      card.style.top      = top  + 'px';
      wall.appendChild(card);
      maxRight  = Math.max(maxRight,  left + frameW);
      maxBottom = Math.max(maxBottom, top  + frameH);
    });

    wall.style.width  = Math.max(maxRight  + WALL_PADDING, window.innerWidth)  + 'px';
    wall.style.height = Math.max(maxBottom + WALL_PADDING, window.innerHeight) + 'px';
    maxScrollX = Math.max(0, maxRight  + WALL_PADDING - window.innerWidth);
    maxScrollY = Math.max(0, maxBottom + WALL_PADDING - window.innerHeight);

  } else {
    // Горизонтальная галерея (стили из CSS)
    wall.style.removeProperty('display');
    wall.style.removeProperty('padding');
    wall.style.removeProperty('gap');
    wall.style.removeProperty('width');

    let totalWidth = WALL_PADDING * 2;
    cards.forEach((card, i) => {
      wall.appendChild(card);
      totalWidth += parseInt(card.style.width);
      if (i < cards.length - 1) totalWidth += CARD_GAP;
    });

    maxScrollX = Math.max(0, totalWidth - window.innerWidth);
    maxScrollY = 0;
  }

  // Всегда скрываем плейсхолдер после построения стены
  hidePlaceholder();

  // Если ни одно изображение не загрузилось — ставим таймер повтора (макс 10 попыток)
  if (!anyLoaded && tokens.some(t => t.source !== 'pinterest')) {
    if (_wallRetryTimer) clearTimeout(_wallRetryTimer);
    const attempt = (buildWall._retries || 0) + 1;
    if (attempt <= 10) {
      buildWall._retries = attempt;
      _wallRetryTimer = setTimeout(async () => {
        await buildWall();
        applyTransform(false);
      }, Math.min(30_000 * attempt, 120_000));
    }
  } else {
    buildWall._retries = 0;
  }
}

// ─── Добавить токен (всегда пересобираем стену целиком) ──────────────────────
async function addTokenToWall(_token) {
  buildWall._retries = 0;
  await buildWall();
}

// ─── Скролл ──────────────────────────────────────────────────────────────────
// CSS transition вместо JS RAF: compositor thread, нет «холодного старта» GPU-слоя
let targetX  = 0;
let targetY  = 0;
let maxScrollY = 0;
let wallEl   = null; // кешированная ссылка — не ищем в DOM каждый кадр

const SCROLL_EASING = 'transform 480ms cubic-bezier(0.16, 1, 0.3, 1)';

function applyTransform(animated) {
  wallEl.style.transition = animated ? SCROLL_EASING : 'none';
  wallEl.style.transform  = `translate3d(-${targetX}px,-${targetY}px,0)`;
}

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  targetX = Math.max(0, Math.min(targetX + delta, maxScrollX));
  applyTransform(false); // колесо — мгновенный отклик, без transition
}, { passive: false });

window.scrollWall = function(direction) {
  const step = Math.round(window.innerWidth * 0.7);
  targetX = direction === 'left'
    ? Math.max(0, targetX - step)
    : Math.min(maxScrollX, targetX + step);
  applyTransform(true);
};

window.scrollWallV = function(direction) {
  const step = Math.round(window.innerHeight * 0.4);
  targetY = direction === 'up'
    ? Math.max(0, targetY - step)
    : Math.min(maxScrollY, targetY + step);
  applyTransform(true);
};

window.addEventListener('resize', () => {
  buildWall();
  targetX = Math.min(targetX, maxScrollX);
  targetY = Math.min(targetY, maxScrollY);
  applyTransform(false);
});

// ─── Подарки на рабочем столе ────────────────────────────────────────────────
const activeGifts = new Map();

function showGift(gift) {
  if (activeGifts.has(gift.id)) return;
  const wrap = document.createElement('div');
  const offset = activeGifts.size * 12;
  wrap.style.cssText = `
    position:fixed;
    bottom:${48 + offset}px;
    right:${48 + offset}px;
    max-width:220px;
    pointer-events:auto;
    border-radius:14px;
    overflow:hidden;
    box-shadow:0 8px 40px rgba(0,0,0,0.85);
    z-index:300;
    animation:giftIn .45s cubic-bezier(.16,1,.3,1);
  `;

  const img = document.createElement('img');
  img.src = gift.image_url;
  img.style.cssText = 'width:100%;display:block;';

  if (gift.message) {
    const msg = document.createElement('div');
    msg.textContent = gift.message;
    msg.style.cssText = 'padding:8px 12px;background:rgba(10,10,15,.92);color:#e0e0e0;font-size:12px;line-height:1.4;font-family:sans-serif;';
    wrap.appendChild(msg);
  }
  wrap.appendChild(img);

  const close = document.createElement('button');
  close.textContent = '×';
  close.style.cssText = 'position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;border:none;cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;';
  close.addEventListener('click', async () => {
    wrap.remove();
    activeGifts.delete(gift.id);
    invoke('dismiss_gift', { giftId: gift.id }).catch(() => {});
  });
  wrap.appendChild(close);

  document.body.appendChild(wrap);
  activeGifts.set(gift.id, wrap);
}

// ─── Старт ───────────────────────────────────────────────────────────────────
async function init() {
  await document.fonts.ready;
  wallEl = document.getElementById('wall');

  // Загружаем и применяем настройки
  try {
    const settings = await invoke('load_settings');
    applySettings(settings);
    _iconUnderlaysEnabled = settings.icon_underlays_enabled !== false;
  } catch (e) {
    console.warn('[wall] Не удалось загрузить настройки:', e);
  }

  // Загружаем сохранённые токены
  try {
    tokens = await invoke('load_tokens');
  } catch (e) {
    console.warn('[wall] Не удалось загрузить токены:', e);
    tokens = [];
  }

  await buildWall();

  // Слушаем новые токены от окна импорта / дашборда
  await listen('token-added', async (event) => {
    const token = event.payload;
    tokens.push(token);
    // В режиме свободного расположения не перестраиваем стену:
    // новый объект появится после сохранения позиций в дашборде
    if (!isFreeform) {
      await addTokenToWall(token);
    }
  });

  // Слушаем обновление всего списка (после сохранения дашборда)
  await listen('tokens-updated', async () => {
    try { tokens = await invoke('load_tokens'); } catch { tokens = []; }
    targetX = 0;
    targetY = 0;
    await buildWall();
    applyTransform(false);
  });

  // Слушаем изменение настроек (из окна настроек — применяем сразу)
  await listen('settings-updated', (event) => {
    applySettings(event.payload);
    _iconUnderlaysEnabled = event.payload.icon_underlays_enabled !== false;
    updateIconUnderlays();
  });

  // Подложки под ярлыки рабочего стола
  await updateIconUnderlays();
  setInterval(updateIconUnderlays, 1000);

  // Входящие подарки: загружаем активные + слушаем новые
  try {
    const gifts = await invoke('get_incoming_gifts');
    gifts.forEach(showGift);
  } catch (e) { console.warn('[gifts]', e); }
  await listen('gift-received', e => showGift(e.payload));

  // Авторетрай: как только появится сеть — сбрасываем счётчик и перестраиваем стену
  window.addEventListener('online', async () => {
    buildWall._retries = 0;
    await buildWall();
    applyTransform(false);
  });
}

init();
