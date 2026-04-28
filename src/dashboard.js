import { t, applyTranslations } from './translations.js';

const { invoke }       = window.__TAURI__.core;
const { emit, listen } = window.__TAURI__.event;

// ─── Настройки (боковая панель) ───────────────────────────────────────────────
let currentSettings = {};
let settingsChanged  = false;

function setSidebarSelected(selector, value) {
  document.querySelectorAll(selector).forEach(el => {
    el.classList.toggle('selected', el.dataset.value === value);
  });
}

// ─── Таблица конфигов карточек (фон × рамка) ─────────────────────────────────
const _SF = '0 6px 24px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.75)';
const _S15 = '0 6px 24px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.15)';
const _S7  = '0 6px 24px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.07)';
const _SN  = 'none';
const _GG  = 'linear-gradient(to bottom, #6b6b6b, #ffffff)';

const PREVIEW_CONFIGS = {
  dark: {
    light:       { bg:'#272727',               s:_SF,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
    dark:        { bg:'#050505',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
    gray:        { bg:_GG,                     s:_SF,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    total_black: { bg:'#000000',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
  },
  pixpix: {
    light:       { bg:'#2065F3',               s:_S15, tc:'var(--fg)',        ac:'var(--fg)'        },
    dark:        { bg:'#0036A7',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg)'        },
    gray:        { bg:_GG,                     s:_SN,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    total_black: { bg:'#000000',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
  },
  fff: {
    light:       { bg:'#ffffff',               s:_S7,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    dark:        { bg:'#e9e9e9',               s:_SN,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    gray:        { bg:_GG,                     s:_SN,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    total_black: { bg:'#000000',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
  },
  gradient81: {
    light:       { bg:'rgba(255,255,255,0.2)', s:_S7,  tc:'var(--fg-invert)', ac:'var(--fg-invert)' },
    dark:        { bg:'rgba(0,0,0,0.2)',       s:_SN,  tc:'var(--fg)',        ac:'var(--fg)'        },
    gray:        { bg:_GG,                     s:_SN,  tc:'var(--fg-invert)', ac:'var(--fg-muted)'  },
    total_black: { bg:'#000000',               s:_SN,  tc:'var(--fg)',        ac:'var(--fg-subtle)' },
  },
};

// Применяет текущие настройки как живой превью в холсте дашборда
function applyPreviewToCanvas() {
  const dashRight = document.querySelector('.dash-right');
  if (!dashRight) return;

  // Фон секции (viewport + скролл + кнопки — единый фон)
  switch (currentSettings.wall_background) {
    case 'pixpix':
      dashRight.style.backgroundImage  = "url('./bg-pixpix.jpg')";
      dashRight.style.backgroundRepeat = 'repeat';
      dashRight.style.backgroundSize   = '320px auto';
      dashRight.style.backgroundColor  = '#0033bb';
      break;
    case 'fff':
      dashRight.style.backgroundImage = '';
      dashRight.style.backgroundSize  = '';
      dashRight.style.backgroundColor = '#ffffff';
      break;
    case 'gradient81':
      dashRight.style.backgroundImage = 'radial-gradient(ellipse at 94% 96%, #c3f73a 0%, #0044f1 100%)';
      dashRight.style.backgroundSize  = 'cover';
      dashRight.style.backgroundColor = '';
      break;
    default:
      dashRight.style.backgroundImage = 'linear-gradient(to bottom, #111111, #050505)';
      dashRight.style.backgroundSize  = 'cover';
      dashRight.style.backgroundColor = '';
  }

  // Конфиг карточки (фон + тень + цвета текста)
  const wallBg = currentSettings.wall_background || 'dark';
  const frame  = currentSettings.card_frame      || 'light';
  const cfgRow = PREVIEW_CONFIGS[wallBg] || PREVIEW_CONFIGS.dark;
  const cfg    = cfgRow[frame] || cfgRow.light;

  document.documentElement.style.setProperty('--dash-card-preview-bg',     cfg.bg);
  document.documentElement.style.setProperty('--dash-card-preview-shadow', cfg.s);
  document.documentElement.style.setProperty('--card-title-color',         cfg.tc);
  document.documentElement.style.setProperty('--card-authors-color',       cfg.ac);

  // Скругление карточек
  const radii = { '0': '0px', 'L': '10px', 'XL': '20px' };
  document.documentElement.style.setProperty(
    '--dash-card-preview-radius',
    radii[currentSettings.card_radius] || '10px'
  );

  // Цвет скроллбаров — инвертируем на светлом фоне
  const isLight = currentSettings.wall_background === 'fff';
  dashRight.style.setProperty('--scroll-bar-track', isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)');
  dashRight.style.setProperty('--scroll-bar-thumb', isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.38)');
}

// ─── Константы ────────────────────────────────────────────────────────────────
const CANVAS_PAD   = 36;   // отступ холста слева/справа
const CARD_GAP     = 24;   // зазор между карточками
const LABEL_H      = 52;   // высота подписи внутри карточки
const CARD_PAD_V   = 20;   // вертикальный паддинг карточки (top/bottom суммарно)
const CARD_PAD_H   = 20;   // горизонтальный паддинг (на каждую сторону)
const MIN_CARD_H   = 130;  // минимальная высота карточки при ресайзе
// Пропорциональная высота карточки — совпадает с обоями: (screenH-200)*0.75 / screenH * vH
function computeBaseDashH() {
  const vH = viewport.clientHeight || 560;
  return Math.round(0.75 * (1 - 200 / (window.screen.height || 1080)) * vH);
}

// ─── Соотношение сторон ───────────────────────────────────────────────────────
function getFrameRatio(w, h) {
  const r = w / h;
  if (r > 1.52) return [16, 9];
  if (r > 1.15) return [4, 3];
  if (r >= 0.87) return [1, 1];
  if (r >= 0.65) return [3, 4];
  return [9, 16];
}

// ─── Размеры карточки по высоте и соотношению ────────────────────────────────
function cardDims(h, rw, rh, isPinterest) {
  if (isPinterest) {
    const w = Math.max(Math.round(h * rw / rh), 40);
    return { w, artW: w, artH: h };
  }
  const artH = Math.max(h - CARD_PAD_V - LABEL_H, 40);
  const artW = Math.round(artH * rw / rh);
  return { w: artW + CARD_PAD_H * 2, artW, artH };
}

// ─── Состояние ───────────────────────────────────────────────────────────────
let cards        = [];        // [{ token, rw, rh, dashH, dashX, dashY, el }]
let selSet       = new Set(); // индексы выбранных карточек
let hasChanges   = false;
let scrollX      = 0;
let scrollY      = 0;
let maxScrollX   = 0;
let maxScrollY   = 0;
let totalCanvasW = 0;
let rubberBand   = null;      // { startVX, startVY, el } — резиновое выделение

// ─── Drag ─────────────────────────────────────────────────────────────────────
// { type:'move'|'resize', idx, startMX, startMY, origX, origY, origH, origW, corner }
let drag     = null;
let didDrag  = false;  // чтобы отличить click от drag

// ─── Snap-to-guides ───────────────────────────────────────────────────────────
const SNAP_THRESHOLD = 6;  // пикселей до примагничивания
let   snapGuideEl    = null;

// Создаём контейнер для линий-гайдов (лениво, при первом перетаскивании)
function ensureSnapGuideEl() {
  if (!snapGuideEl) {
    snapGuideEl = document.createElement('div');
    snapGuideEl.style.cssText =
      'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:999;overflow:hidden;';
    viewport.appendChild(snapGuideEl);
  }
}

// Собираем snap-линии от видимых карточек (исключая все выбранные)
function getVisibleSnapLines() {
  const vW = viewport.clientWidth  || 860;
  const vH = viewport.clientHeight || 560;
  const vLines = [], hLines = [];

  cards.forEach((c, i) => {
    if (selSet.has(i)) return; // исключаем все выбранные
    const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
    const x = c.dashX || 0;
    const y = c.dashY || 0;
    // Карточка видима если её bbox пересекает viewport
    if ((x - scrollX) + w < 0 || (x - scrollX) > vW) return;
    if ((y - scrollY) + c.dashH < 0 || (y - scrollY) > vH) return;

    vLines.push(x, x + w, x + w / 2);
    hLines.push(y, y + c.dashH, y + c.dashH / 2);
  });

  return { vLines, hLines };
}

// «Умное распределение» — снап к эталонным отступам из существующей раскладки
function getEqualSpacingSnap(rawX, rawY, cardW, cardH) {
  const result = { snapX: null, snapY: null, guideLines: [] };

  const others = [];
  cards.forEach((c, i) => {
    if (selSet.has(i)) return;
    const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
    others.push({ x: c.dashX || 0, y: c.dashY || 0, w, h: c.dashH });
  });

  if (others.length < 2) return result;

  // Собираем все существующие зазоры между парами карточек (H и V)
  const refGaps = [];
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i], b = others[j];
      const hg = b.x - (a.x + a.w);
      if (hg > 0 && hg < 4000) refGaps.push({
        gap: hg, axis: 'h', edgeA: a.x + a.w, edgeB: b.x,
        midY: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
      });
      const vg = b.y - (a.y + a.h);
      if (vg > 0 && vg < 4000) refGaps.push({
        gap: vg, axis: 'v', edgeA: a.y + a.h, edgeB: b.y,
        midX: (a.x + a.w / 2 + b.x + b.w / 2) / 2,
      });
    }
  }
  if (!refGaps.length) return result;

  const THR = 6;

  // --- Снап по X ---
  let bestDX = THR + 1, bestSnapX = null, bestRefX = null, bestAnchorX = null, anchorSideX = null;
  for (const o of others) {
    for (const ref of refGaps) {
      const cR = o.x + o.w + ref.gap;
      const dR = Math.abs(rawX - cR);
      if (dR < bestDX) { bestDX = dR; bestSnapX = cR; bestRefX = ref; bestAnchorX = o; anchorSideX = 'right'; }
      const cL = o.x - cardW - ref.gap;
      const dL = Math.abs(rawX - cL);
      if (dL < bestDX) { bestDX = dL; bestSnapX = cL; bestRefX = ref; bestAnchorX = o; anchorSideX = 'left'; }
    }
  }

  if (bestSnapX !== null) {
    result.snapX = bestSnapX;
    const anchorMidY = bestAnchorX.y + bestAnchorX.h / 2;
    // Отрезок референсного зазора
    if (bestRefX.axis === 'h') {
      result.guideLines.push({ type: 'span-h', x1: bestRefX.edgeA, x2: bestRefX.edgeB, y: bestRefX.midY });
    } else {
      result.guideLines.push({ type: 'span-v', y1: bestRefX.edgeA, y2: bestRefX.edgeB, x: bestRefX.midX });
    }
    // Отрезок нового зазора
    if (anchorSideX === 'right') {
      result.guideLines.push({ type: 'span-h', x1: bestAnchorX.x + bestAnchorX.w, x2: bestSnapX, y: anchorMidY });
    } else {
      result.guideLines.push({ type: 'span-h', x1: bestSnapX + cardW, x2: bestAnchorX.x, y: anchorMidY });
    }
  }

  // --- Снап по Y ---
  let bestDY = THR + 1, bestSnapY = null, bestRefY = null, bestAnchorY = null, anchorSideY = null;
  for (const o of others) {
    for (const ref of refGaps) {
      const cD = o.y + o.h + ref.gap;
      const dD = Math.abs(rawY - cD);
      if (dD < bestDY) { bestDY = dD; bestSnapY = cD; bestRefY = ref; bestAnchorY = o; anchorSideY = 'below'; }
      const cU = o.y - cardH - ref.gap;
      const dU = Math.abs(rawY - cU);
      if (dU < bestDY) { bestDY = dU; bestSnapY = cU; bestRefY = ref; bestAnchorY = o; anchorSideY = 'above'; }
    }
  }

  if (bestSnapY !== null) {
    result.snapY = bestSnapY;
    const anchorMidX = bestAnchorY.x + bestAnchorY.w / 2;
    // Отрезок референсного зазора
    if (bestRefY.axis === 'v') {
      result.guideLines.push({ type: 'span-v', y1: bestRefY.edgeA, y2: bestRefY.edgeB, x: bestRefY.midX });
    } else {
      result.guideLines.push({ type: 'span-h', x1: bestRefY.edgeA, x2: bestRefY.edgeB, y: bestRefY.midY });
    }
    // Отрезок нового зазора
    if (anchorSideY === 'below') {
      result.guideLines.push({ type: 'span-v', y1: bestAnchorY.y + bestAnchorY.h, y2: bestSnapY, x: anchorMidX });
    } else {
      result.guideLines.push({ type: 'span-v', y1: bestSnapY + cardH, y2: bestAnchorY.y, x: anchorMidX });
    }
  }

  return result;
}

// Показываем гайды и возвращаем примагниченные координаты
function applySnap(rawX, rawY, cardW, cardH) {
  const { vLines, hLines } = getVisibleSnapLines();

  // Три контрольные точки перетаскиваемой карточки: левый край, правый, центр
  const edgesX    = [rawX,  rawX + cardW,  rawX + cardW / 2];
  const snappedXFor = (line, ei) => [line, line - cardW, line - cardW / 2][ei];

  const edgesY    = [rawY,  rawY + cardH,  rawY + cardH / 2];
  const snappedYFor = (line, ei) => [line, line - cardH, line - cardH / 2][ei];

  // Ищем ближайший вертикальный снап (выравнивание)
  let snapLineX = null, bestX = rawX, minDX = SNAP_THRESHOLD + 1;
  for (let ei = 0; ei < edgesX.length; ei++) {
    for (const line of vLines) {
      const d = Math.abs(edgesX[ei] - line);
      if (d < minDX) { minDX = d; snapLineX = line; bestX = snappedXFor(line, ei); }
    }
  }

  // Ищем ближайший горизонтальный снап (выравнивание)
  let snapLineY = null, bestY = rawY, minDY = SNAP_THRESHOLD + 1;
  for (let ei = 0; ei < edgesY.length; ei++) {
    for (const line of hLines) {
      const d = Math.abs(edgesY[ei] - line);
      if (d < minDY) { minDY = d; snapLineY = line; bestY = snappedYFor(line, ei); }
    }
  }

  // Равные отступы (smart distribute) — перекрывает выравнивание если активен
  const eq = getEqualSpacingSnap(rawX, rawY, cardW, cardH);
  if (eq.snapX !== null) { bestX = eq.snapX; snapLineX = null; }
  if (eq.snapY !== null) { bestY = eq.snapY; snapLineY = null; }

  // Рисуем (или убираем) гайды
  ensureSnapGuideEl();
  snapGuideEl.innerHTML = '';
  if (eq.guideLines.length) {
    // Оранжевые отрезки равных отступов: span-h (горизонт.) и span-v (вертик.)
    for (const gl of eq.guideLines) {
      const el = document.createElement('div');
      if (gl.type === 'span-h') {
        const x = Math.min(gl.x1, gl.x2) - scrollX;
        const w = Math.max(2, Math.abs(gl.x2 - gl.x1));
        el.style.cssText = `position:absolute;left:${x}px;top:${Math.round(gl.y - scrollY)}px;width:${w}px;height:2px;background:#FF6B2B;opacity:0.9;`;
      } else if (gl.type === 'span-v') {
        const y = Math.min(gl.y1, gl.y2) - scrollY;
        const h = Math.max(2, Math.abs(gl.y2 - gl.y1));
        el.style.cssText = `position:absolute;left:${Math.round(gl.x - scrollX)}px;top:${y}px;width:2px;height:${h}px;background:#FF6B2B;opacity:0.9;`;
      }
      snapGuideEl.appendChild(el);
    }
  } else {
    if (snapLineX !== null) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${snapLineX - scrollX}px;top:0;width:1px;height:100%;background:#FF6B2B;opacity:0.8;`;
      snapGuideEl.appendChild(el);
    }
    if (snapLineY !== null) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;top:${snapLineY - scrollY}px;left:0;width:100%;height:1px;background:#FF6B2B;opacity:0.8;`;
      snapGuideEl.appendChild(el);
    }
  }

  return { snappedX: bestX, snappedY: bestY };
}

function hideSnapGuides() {
  if (snapGuideEl) snapGuideEl.innerHTML = '';
}

// Обратная функция: из целевой ширины карточки → высота (через aspect ratio)
function heightFromWidth(targetW, rw, rh, isPinterest) {
  if (isPinterest) return Math.max(Math.round(targetW * rh / rw), MIN_CARD_H);
  const artW = targetW - CARD_PAD_H * 2;
  if (artW <= 0) return MIN_CARD_H;
  return Math.round(artW * rh / rw) + CARD_PAD_V + LABEL_H;
}

// Снапп при ресайзе: возвращает итоговую высоту с учётом притяжения к гайдам
function applyResizeSnap(corner, rawH, origX, origY, origH, origW, rw, rh, isPinterest) {
  const { w: rawW } = cardDims(rawH, rw, rh, isPinterest);

  // Вычисляем положение всех 4 краёв при текущей rawH
  const isLeft   = corner === 'tl' || corner === 'bl';
  const isTop    = corner === 'tl' || corner === 'tr';
  const left     = isLeft  ? origX + origW - rawW : origX;
  const right    = isLeft  ? origX + origW         : origX + rawW;
  const top      = isTop   ? origY + origH - rawH  : origY;
  const bottom   = isTop   ? origY + origH          : origY + rawH;

  const { vLines, hLines } = getVisibleSnapLines();

  // Вертикальный снапп — движущийся крайний X
  const movingX = isLeft ? left : right;
  let snapLineX = null, bestH_X = rawH, minDX = SNAP_THRESHOLD + 1;
  for (const line of vLines) {
    const d = Math.abs(movingX - line);
    if (d < minDX) {
      minDX = d; snapLineX = line;
      const targetW = isLeft ? right - line : line - left;
      bestH_X = heightFromWidth(targetW, rw, rh, isPinterest);
    }
  }

  // Горизонтальный снапп — движущийся крайний Y
  const movingY = isTop ? top : bottom;
  let snapLineY = null, bestH_Y = rawH, minDY = SNAP_THRESHOLD + 1;
  for (const line of hLines) {
    const d = Math.abs(movingY - line);
    if (d < minDY) {
      minDY = d; snapLineY = line;
      bestH_Y = isTop ? bottom - line : line - top;
    }
  }

  // Если оба снаппа активны — берём тот, что меньше меняет высоту
  const snapByX = minDX <= SNAP_THRESHOLD;
  const snapByY = minDY <= SNAP_THRESHOLD;
  let finalH = rawH;
  const activeVGuides = [], activeHGuides = [];

  if (snapByX && snapByY) {
    if (Math.abs(bestH_X - rawH) <= Math.abs(bestH_Y - rawH)) {
      finalH = bestH_X; activeVGuides.push(snapLineX);
    } else {
      finalH = bestH_Y; activeHGuides.push(snapLineY);
    }
  } else if (snapByX) {
    finalH = bestH_X; activeVGuides.push(snapLineX);
  } else if (snapByY) {
    finalH = bestH_Y; activeHGuides.push(snapLineY);
  }

  finalH = Math.max(MIN_CARD_H, finalH);

  // Рисуем гайды
  ensureSnapGuideEl();
  snapGuideEl.innerHTML = '';
  activeVGuides.forEach(x => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${x - scrollX}px;top:0;width:1px;height:100%;background:#FF6B2B;opacity:0.8;`;
    snapGuideEl.appendChild(el);
  });
  activeHGuides.forEach(y => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;top:${y - scrollY}px;left:0;width:100%;height:1px;background:#FF6B2B;opacity:0.8;`;
    snapGuideEl.appendChild(el);
  });

  return finalH;
}

// ─── DOM ──────────────────────────────────────────────────────────────────────
const viewport     = document.getElementById('dash-viewport');
const canvas       = document.getElementById('dash-canvas');
const scrollTrack  = document.getElementById('scroll-track');
const scrollThumb  = document.getElementById('scroll-thumb');
const vScrollTrack = document.getElementById('vscroll-track');
const vScrollThumb = document.getElementById('vscroll-thumb');
const addBtn       = document.getElementById('dash-add-btn');
const saveBtn      = document.getElementById('dash-save-btn');
const overlay      = document.getElementById('dash-overlay');
const popup        = document.getElementById('dash-popup');
const popupInput   = document.getElementById('popup-input');
const popupSubmit  = document.getElementById('popup-submit');
const popupError   = document.getElementById('popup-error');
const popupClose   = document.getElementById('popup-close');
const confirmPopup  = document.getElementById('dash-confirm-popup');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmDelete = document.getElementById('confirm-delete');

// Верификация
const verifyPopup       = document.getElementById('dash-verify-popup');
const verifyStateInput  = document.getElementById('verify-state-input');
const verifyStateLoad   = document.getElementById('verify-state-loading');
const verifyStateOk     = document.getElementById('verify-state-success');
const verifyWalletInput = document.getElementById('verify-wallet-input');
const verifySubmit      = document.getElementById('verify-submit');
const verifyError       = document.getElementById('verify-error');
const verifyClose       = document.getElementById('verify-close');
const verifyDone        = document.getElementById('verify-done');
const verifyTokenName   = document.getElementById('verify-token-name');
const verifySuccessAddr = document.getElementById('verify-success-addr');
const verifyWalletHistory = document.getElementById('verify-wallet-history');

// ─── История кошельков ────────────────────────────────────────────────────────
const WALLET_HISTORY_KEY = 'xolct-wallet-history';

function getWalletHistory() {
  try { return JSON.parse(localStorage.getItem(WALLET_HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveWalletToHistory(addr) {
  const list = getWalletHistory().filter(a => a !== addr);
  list.unshift(addr);
  localStorage.setItem(WALLET_HISTORY_KEY, JSON.stringify(list.slice(0, 8)));
}

function shortenWallet(addr) {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 7) + '…' + addr.slice(-5);
}

function renderWalletHistory() {
  const list = getWalletHistory();
  if (!list.length) { verifyWalletHistory.classList.add('hidden'); return; }
  verifyWalletHistory.classList.remove('hidden');
  verifyWalletHistory.innerHTML = '';
  list.forEach(addr => {
    const tag = document.createElement('button');
    tag.className = 'verify-wallet-tag';
    tag.textContent = shortenWallet(addr);
    tag.title = addr;
    tag.type = 'button';
    tag.addEventListener('click', () => {
      verifyWalletInput.value = addr;
      verifyWalletInput.focus();
    });
    verifyWalletHistory.appendChild(tag);
  });
}
const verifyTrialBlock  = document.getElementById('verify-trial-block');
const verifyTrialBtn    = document.getElementById('verify-trial-btn');
const verifyQuotaText   = document.getElementById('verify-quota-text');

let pendingDeleteIdx  = -1;
let verifyTargetIdx   = -1;
// Токен из импорт-флоу (ещё не добавлен на холст)
let verifyPendingToken = null;

// ─── Инициализация ────────────────────────────────────────────────────────────
async function init() {
  await document.fonts.ready;
  applyTranslations();

  // ── Загружаем настройки и инициализируем боковую панель ──────────────────────
  try {
    currentSettings = await invoke('load_settings');
  } catch {
    currentSettings = {
      wall_background: 'dark',
      card_frame:      'light',
      card_radius:     'L',
      shortcut_open:   'ctrl+alt+z',
      shortcut_left:   'ctrl+alt+a',
      shortcut_right:  'ctrl+alt+d',
    };
  }

  setSidebarSelected('.dash-sb-bg-item',     currentSettings.wall_background);
  setSidebarSelected('.dash-sb-frame-item',  currentSettings.card_frame);
  setSidebarSelected('.dash-sb-radius-item', currentSettings.card_radius);
  applyPreviewToCanvas();

  document.querySelectorAll('.dash-sb-bg-item').forEach(item => {
    item.addEventListener('click', () => {
      currentSettings.wall_background = item.dataset.value;
      setSidebarSelected('.dash-sb-bg-item', item.dataset.value);
      applyPreviewToCanvas();
      settingsChanged = true;
      markChanged();
    });
  });

  document.querySelectorAll('.dash-sb-frame-item').forEach(item => {
    item.addEventListener('click', () => {
      currentSettings.card_frame = item.dataset.value;
      setSidebarSelected('.dash-sb-frame-item', item.dataset.value);
      applyPreviewToCanvas();
      settingsChanged = true;
      markChanged();
    });
  });

  document.querySelectorAll('.dash-sb-radius-item').forEach(item => {
    item.addEventListener('click', () => {
      currentSettings.card_radius = item.dataset.value;
      setSidebarSelected('.dash-sb-radius-item', item.dataset.value);
      applyPreviewToCanvas();
      settingsChanged = true;
      markChanged();
    });
  });

  // ── Очищаем истёкшие пробные токены ──────────────────────────────────────────
  try {
    const expiredIds = await invoke('cleanup_expired_tokens');
    if (expiredIds.length > 0) {
      // Уведомляем стену об удалении
      await emit('tokens-updated');
    }
  } catch (e) {
    console.warn('[cleanup] failed:', e);
  }

  // ── Загружаем токены ─────────────────────────────────────────────────────────
  let tokens = [];
  try { tokens = await invoke('load_tokens'); } catch { tokens = []; }

  // Загружаем соотношения сторон параллельно
  cards = await Promise.all(tokens.map(token => new Promise(resolve => {
    const img = new Image();
    const onDone = (rw, rh) => {
      const isPinterest = token.source === 'pinterest';
      const dashH = Math.round(computeBaseDashH() * (token.wall_scale || 1.0));
      const { w }  = cardDims(dashH, rw, rh, isPinterest);
      const vW     = viewport.clientWidth  || 860;
      const vH     = viewport.clientHeight || 560;
      resolve({
        token,
        rw, rh,
        dashH,
        isPinterest,
        // Восстанавливаем позицию из сохранённых нормализованных координат
        dashX: token.dash_x != null ? token.dash_x * computeBaseDashH() : null,
        dashY: token.dash_y != null ? token.dash_y * computeBaseDashH() : null,
        el:   null,
      });
    };
    img.onload  = () => { const [rw, rh] = getFrameRatio(img.naturalWidth || 1, img.naturalHeight || 1); onDone(rw, rh); };
    img.onerror = () => onDone(1, 1);
    img.src = token.display_uri;
  })));

  layoutAndRender();
  setupScrollEvents();
}

// ─── Layout & render ─────────────────────────────────────────────────────────
function layoutAndRender() {
  canvas.innerHTML = '';
  selSet.clear();

  const vH = viewport.clientHeight || 560;
  let x = CANVAS_PAD;

  cards.forEach((c, i) => {
    const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
    if (c.dashX == null) {
      c.dashX = x;
      c.dashY = Math.round((vH - c.dashH) / 2);
    }
    x = c.dashX + w + CARD_GAP;
    c.el = buildCardEl(c, i);
    canvas.appendChild(c.el);
  });

  scrollY = 0;
  recalcTotalWidth();
  applyScroll(0, 0);
  updateScrollThumb();
  renderEmpty();
}

// ─── Строим DOM-элемент карточки ──────────────────────────────────────────────
function buildCardEl(c, idx) {
  const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);

  const card = document.createElement('div');
  card.className    = 'dash-card';
  card.style.left   = c.dashX + 'px';
  card.style.top    = c.dashY + 'px';
  card.style.width  = w + 'px';
  card.style.height = c.dashH + 'px';
  card.dataset.idx  = idx;

  if (c.isPinterest) {
    // Pinterest: чистая картинка без рамки и подписи
    card.style.background = c.token.display_uri
      ? `url("${c.token.display_uri}") center/cover no-repeat`
      : 'linear-gradient(135deg, #1a1a2e, #16213e)';
    card.style.boxShadow = 'none';
  } else {
    // Обычная карточка: рамка + изображение + подпись
    const body = document.createElement('div');
    body.className = 'dash-card-body';

    const imgArea = document.createElement('div');
    imgArea.className = 'dash-card-image';
    if (c.token.display_uri) {
      const art = document.createElement('div');
      art.className = 'dash-card-art';
      art.style.backgroundImage = `url("${c.token.display_uri}")`;
      imgArea.appendChild(art);
    } else {
      imgArea.style.background = 'linear-gradient(135deg, #1a1a2e, #16213e)';
    }

    const label = document.createElement('div');
    label.className = 'dash-card-label';
    const title = document.createElement('div');
    title.className   = 'dash-card-title';
    title.textContent = c.token.name || '';
    const authors = document.createElement('div');
    authors.className   = 'dash-card-authors';
    authors.textContent = (c.token.creators || []).join(', ');
    label.appendChild(title);
    label.appendChild(authors);

    body.appendChild(imgArea);
    body.appendChild(label);
    card.appendChild(body);

    // Таймер пробного периода
    if (!c.token.verified && c.token.trial_expires_at) {
      const timer = document.createElement('div');
      timer.className = 'dash-card-timer';
      timer.dataset.expires = c.token.trial_expires_at;
      timer.textContent = fmtTimeLeft(c.token.trial_expires_at);
      card.appendChild(timer);
    }

    // Бейдж верификации или кнопка верифицировать
    if (c.token.verified) {
      const badge = document.createElement('div');
      badge.className = 'dash-card-verified-badge';
      badge.title = `Владение подтверждено: ${c.token.verified_address || ''}`;
      badge.innerHTML = `<svg width="12" height="10" viewBox="0 0 12 10" fill="none">
        <path d="M1 5L4.5 8.5L11 1" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      card.appendChild(badge);
    } else {
      const vBtn = document.createElement('button');
      vBtn.className = 'dash-card-verify-btn';
      vBtn.textContent = t('card.verify.btn');
      vBtn.addEventListener('mousedown', e => e.stopPropagation());
      vBtn.addEventListener('click', e => { e.stopPropagation(); openVerifyPopup(Number(card.dataset.idx), null); });
      card.appendChild(vBtn);
    }
  }

  // Кнопка удаления (общая для всех типов)
  const del = document.createElement('button');
  del.className = 'dash-card-delete icon-btn';
  del.innerHTML = `<svg width="12" height="14" viewBox="0 0 12 14" fill="none">
    <path d="M1 3.5H11M4 3.5V2H8V3.5M2 3.5L2.8 12H9.2L10 3.5H2Z"
      stroke="#656565" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="5" y1="6" x2="5" y2="10" stroke="#656565" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="7.5" y1="6" x2="7.5" y2="10" stroke="#656565" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
  del.addEventListener('mousedown', e => e.stopPropagation());
  del.addEventListener('click', e => { e.stopPropagation(); openConfirmPopup(Number(card.dataset.idx)); });
  card.appendChild(del);

  // Ручки ресайза (общие)
  ['tl', 'tr', 'bl', 'br'].forEach(corner => {
    const h = document.createElement('div');
    h.className = `dash-handle dash-handle-${corner}`;
    h.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      startResize(e, Number(card.dataset.idx), corner);
    });
    card.appendChild(h);
  });

  // Drag перемещения (общий)
  card.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('dash-handle') ||
        e.target.closest('.dash-card-delete')) return;
    startMove(e, Number(card.dataset.idx));
  });

  return card;
}

// ─── Управление выделением ───────────────────────────────────────────────────
function clearSelection() {
  selSet.forEach(i => cards[i]?.el?.classList.remove('selected'));
  selSet.clear();
}

function setSelection(indices) {
  clearSelection();
  indices.forEach(i => {
    if (i >= 0 && i < cards.length && cards[i]?.el) {
      selSet.add(i);
      cards[i].el.classList.add('selected');
    }
  });
}

// Выбор одной карточки (−1 = снять всё)
function selectCard(idx) {
  setSelection(idx >= 0 ? [idx] : []);
}

// ─── Удаление ────────────────────────────────────────────────────────────────
function deleteCard(idx) {
  if (idx < 0 || idx >= cards.length) return;
  cards[idx].el.remove();
  cards.splice(idx, 1);
  // Пересчитываем selSet: убираем idx, сдвигаем индексы выше него
  const newSel = new Set();
  selSet.forEach(i => { if (i !== idx) newSel.add(i > idx ? i - 1 : i); });
  selSet = newSel;
  selSet.forEach(i => cards[i]?.el?.classList.add('selected'));
  // Переиндексируем dataset
  cards.forEach((c, i) => { if (c.el) c.el.dataset.idx = i; });
  recalcTotalWidth();
  updateScrollThumb();
  renderEmpty();
  markChanged();
}

// ─── Начало перемещения ───────────────────────────────────────────────────────
function startMove(e, idx) {
  if (!selSet.has(idx)) setSelection([idx]); // клик вне выделения — выбрать одну
  // Запоминаем начальные позиции всех выбранных карточек
  const origPositions = {};
  selSet.forEach(i => { origPositions[i] = { x: cards[i].dashX, y: cards[i].dashY }; });
  drag = {
    type: 'move', idx,
    startMX: e.clientX, startMY: e.clientY,
    origX: cards[idx].dashX, origY: cards[idx].dashY, // для snap
    origPositions,
  };
  didDrag = false;
  e.preventDefault();
}

// ─── Начало ресайза ───────────────────────────────────────────────────────────
function startResize(e, idx, corner) {
  if (!selSet.has(idx)) setSelection([idx]);
  const c = cards[idx];
  const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
  // Запоминаем исходные размеры и позиции всех выбранных карточек
  const origDims = {};
  selSet.forEach(i => {
    const ci = cards[i];
    const { w: wi } = cardDims(ci.dashH, ci.rw, ci.rh, ci.isPinterest);
    origDims[i] = { h: ci.dashH, x: ci.dashX, y: ci.dashY, w: wi };
  });
  drag = {
    type: 'resize', idx, corner,
    startMX: e.clientX, startMY: e.clientY,
    origH: c.dashH, origX: c.dashX, origY: c.dashY, origW: w,
    origDims,
  };
  didDrag = false;
  e.preventDefault();
}

// ─── Обработчики мыши ────────────────────────────────────────────────────────
document.addEventListener('mousemove', e => {
  // ── Резиновое выделение ───────────────────────────────────────────────────
  if (rubberBand) {
    const vRect = viewport.getBoundingClientRect();
    const curVX = e.clientX - vRect.left;
    const curVY = e.clientY - vRect.top;
    const x = Math.min(rubberBand.startVX, curVX);
    const y = Math.min(rubberBand.startVY, curVY);
    const w = Math.abs(curVX - rubberBand.startVX);
    const h = Math.abs(curVY - rubberBand.startVY);

    if (!rubberBand.el && (w > 4 || h > 4)) {
      rubberBand.el = document.createElement('div');
      rubberBand.el.style.cssText =
        'position:absolute;border:1.5px solid #FF6B2B;background:rgba(255,107,43,0.07);pointer-events:none;z-index:998;box-sizing:border-box;';
      viewport.appendChild(rubberBand.el);
    }
    if (rubberBand.el) {
      Object.assign(rubberBand.el.style, { left: x+'px', top: y+'px', width: w+'px', height: h+'px' });
      // Ищем карточки, которые пересекают выделяемый прямоугольник (canvas-координаты)
      const cl = x + scrollX, ct = y + scrollY, cr = cl + w, cb = ct + h;
      const hit = [];
      cards.forEach((c, i) => {
        const { w: cw } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
        if (cr >= c.dashX && cl <= c.dashX + cw && cb >= c.dashY && ct <= c.dashY + c.dashH) hit.push(i);
      });
      setSelection(hit);
    }
    return;
  }

  if (!drag) return;

  const c = cards[drag.idx];
  const dx = e.clientX - drag.startMX;
  const dy = e.clientY - drag.startMY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;

  if (drag.type === 'move') {
    const rawX = drag.origX + dx;
    const rawY = drag.origY + dy;
    const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
    const { snappedX, snappedY } = applySnap(rawX, rawY, w, c.dashH);

    // Фактическое смещение первичной карточки (после снаппинга и зажима)
    const dxActual = Math.max(0, snappedX) - drag.origX;
    const dyActual = snappedY              - drag.origY;

    // Применяем ко всем выбранным карточкам
    selSet.forEach(i => {
      const ci = cards[i];
      ci.dashX = Math.max(0, drag.origPositions[i].x + dxActual);
      ci.dashY = drag.origPositions[i].y + dyActual;
      ci.el.style.left = ci.dashX + 'px';
      ci.el.style.top  = ci.dashY + 'px';
    });

  } else if (drag.type === 'resize') {
    const scaleDy = (drag.corner === 'tl' || drag.corner === 'tr') ? -dy : dy;
    const rawH    = Math.max(MIN_CARD_H, drag.origH + scaleDy);
    const newH    = applyResizeSnap(
      drag.corner, rawH,
      drag.origX, drag.origY, drag.origH, drag.origW,
      c.rw, c.rh, c.isPinterest
    );

    const scaleFactor = newH / drag.origH;

    // Скейлим все выбранные карточки тем же коэффициентом
    selSet.forEach(i => {
      const ci   = cards[i];
      const orig = drag.origDims[i];
      const scaledH = Math.max(MIN_CARD_H, Math.round(orig.h * scaleFactor));
      const { w: scaledW } = cardDims(scaledH, ci.rw, ci.rh, ci.isPinterest);
      ci.dashH = scaledH;
      ci.el.style.height = scaledH + 'px';
      ci.el.style.width  = scaledW  + 'px';
      ci.token.wall_scale = parseFloat((scaledH / computeBaseDashH()).toFixed(3));
    });

    // Первичная карточка: корректировка позиции по углу
    const { w } = cardDims(newH, c.rw, c.rh, c.isPinterest);
    if (drag.corner === 'tl' || drag.corner === 'bl') {
      c.dashX = drag.origX + drag.origW - w;
      c.el.style.left = c.dashX + 'px';
    }
    if (drag.corner === 'tl' || drag.corner === 'tr') {
      c.dashY = drag.origY + drag.origH - newH;
      c.el.style.top = c.dashY + 'px';
    }

    markChanged();
  }
});

document.addEventListener('mouseup', () => {
  // Завершаем резиновое выделение
  if (rubberBand) {
    if (rubberBand.el) rubberBand.el.remove();
    rubberBand = null;
    return;
  }
  if (!drag) return;
  hideSnapGuides();
  if (didDrag) {
    recalcTotalWidth();
    updateScrollThumb();
    markChanged();
  } else {
    // Клик без перемещения → выбираем только эту карточку
    if (drag.type === 'move') selectCard(drag.idx);
  }
  drag = null;
});

// Клик на пустую область → начать резиновое выделение
viewport.addEventListener('mousedown', e => {
  if (e.target !== viewport && e.target !== canvas) return;
  clearSelection();
  const vRect = viewport.getBoundingClientRect();
  rubberBand = {
    startVX: e.clientX - vRect.left,
    startVY: e.clientY - vRect.top,
    el: null,
  };
  e.preventDefault();
});

// ─── Утилиты ─────────────────────────────────────────────────────────────────
function recalcTotalWidth() {
  let maxRight  = 0;
  let maxBottom = 0;
  cards.forEach(c => {
    const { w } = cardDims(c.dashH, c.rw, c.rh, c.isPinterest);
    maxRight  = Math.max(maxRight,  (c.dashX || 0) + w);
    maxBottom = Math.max(maxBottom, (c.dashY || 0) + c.dashH);
  });
  totalCanvasW = Math.max(maxRight + CANVAS_PAD, (viewport.clientWidth || 860) + 1);
  canvas.style.width = totalCanvasW + 'px';
  maxScrollX = Math.max(0, totalCanvasW - (viewport.clientWidth || 860));
  maxScrollY = Math.max(0, maxBottom + CANVAS_PAD - (viewport.clientHeight || 560));
  applyScroll(scrollX, scrollY);
}

function applyScroll(x, y) {
  scrollX = Math.max(0, Math.min(x, maxScrollX));
  if (y !== undefined) scrollY = Math.max(0, Math.min(y, maxScrollY));
  canvas.style.transform = `translate(-${scrollX}px,-${scrollY}px)`;
}

function updateScrollThumb() {
  const vW     = viewport.clientWidth || 860;
  const trackW = scrollTrack.clientWidth || 820;
  if (maxScrollX <= 0 || totalCanvasW <= vW) {
    scrollThumb.style.display = 'none';
  } else {
    scrollThumb.style.display = 'block';
    const thumbW = Math.max(40, Math.round(trackW * vW / totalCanvasW));
    const thumbX = Math.round((scrollX / maxScrollX) * (trackW - thumbW));
    scrollThumb.style.width = thumbW + 'px';
    scrollThumb.style.left  = thumbX + 'px';
  }
  updateVScrollThumb();
}

function updateVScrollThumb() {
  const vH     = viewport.clientHeight || 560;
  const trackH = vScrollTrack.clientHeight || 520;
  if (maxScrollY <= 0) {
    vScrollTrack.classList.remove('visible');
    return;
  }
  vScrollTrack.classList.add('visible');
  const thumbH = Math.max(40, Math.round(trackH * vH / (vH + maxScrollY)));
  const thumbY = Math.round((scrollY / maxScrollY) * (trackH - thumbH));
  vScrollThumb.style.height = thumbH + 'px';
  vScrollThumb.style.top    = thumbY + 'px';
}

function renderEmpty() {
  let el = canvas.querySelector('.dash-empty');
  if (cards.length === 0) {
    if (!el) {
      el = document.createElement('div');
      el.className = 'dash-empty';
      el.innerHTML = `<div class="dash-empty-text">${t('dash.empty')}</div>`;
      canvas.appendChild(el);
    }
  } else if (el) {
    el.remove();
  }
}

function markChanged() {
  hasChanges = true;
  saveBtn.dataset.active = 'true';
}

// ─── Скролл-события ──────────────────────────────────────────────────────────
function setupScrollEvents() {
  // Колесо: обычный скролл — вертикально, Shift+колесо — горизонтально
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.shiftKey) {
      applyScroll(scrollX + delta, scrollY);
      updateScrollThumb();
    } else {
      applyScroll(scrollX, scrollY + delta);
    }
  }, { passive: false });

  // Drag горизонтального ползунка
  let thumbDrag = null;
  scrollThumb.addEventListener('mousedown', e => {
    thumbDrag = { startX: e.clientX, startScroll: scrollX };
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', e => {
    if (!thumbDrag) return;
    const trackW = scrollTrack.clientWidth;
    const thumbW = parseFloat(scrollThumb.style.width) || 40;
    const ratio  = maxScrollX / Math.max(1, trackW - thumbW);
    applyScroll(thumbDrag.startScroll + (e.clientX - thumbDrag.startX) * ratio, scrollY);
    updateScrollThumb();
  });
  document.addEventListener('mouseup', () => { thumbDrag = null; vThumbDrag = null; });

  // Клик по горизонтальному треку
  scrollTrack.addEventListener('click', e => {
    if (e.target === scrollThumb) return;
    const rect   = scrollTrack.getBoundingClientRect();
    const thumbW = parseFloat(scrollThumb.style.width) || 40;
    const ratio  = maxScrollX / Math.max(1, rect.width - thumbW);
    applyScroll((e.clientX - rect.left - thumbW / 2) * ratio, scrollY);
    updateScrollThumb();
  });

  // Drag вертикального ползунка
  let vThumbDrag = null;
  vScrollThumb.addEventListener('mousedown', e => {
    vThumbDrag = { startY: e.clientY, startScroll: scrollY };
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', e => {
    if (!vThumbDrag) return;
    const trackH = vScrollTrack.clientHeight;
    const thumbH = parseFloat(vScrollThumb.style.height) || 40;
    const ratio  = maxScrollY / Math.max(1, trackH - thumbH);
    applyScroll(scrollX, vThumbDrag.startScroll + (e.clientY - vThumbDrag.startY) * ratio);
    updateVScrollThumb();
  });

  // Клик по вертикальному треку
  vScrollTrack.addEventListener('click', e => {
    if (e.target === vScrollThumb) return;
    const rect   = vScrollTrack.getBoundingClientRect();
    const thumbH = parseFloat(vScrollThumb.style.height) || 40;
    const ratio  = maxScrollY / Math.max(1, rect.height - thumbH);
    applyScroll(scrollX, (e.clientY - rect.top - thumbH / 2) * ratio);
    updateVScrollThumb();
  });

  // Ресайз окна
  window.addEventListener('resize', () => {
    recalcTotalWidth();
    updateScrollThumb();
  });
}

// ─── Сохранить ────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (saveBtn.dataset.active !== 'true') return;

  const vW = viewport.clientWidth;
  const vH = viewport.clientHeight;

  // Сортируем по X-позиции на холсте — это порядок на стене
  const sorted = [...cards].sort((a, b) => (a.dashX || 0) - (b.dashX || 0));
  const updatedTokens = sorted.map(c => {
    // Сохраняем верхний левый угол (не центр) — чтобы выравнивание совпадало на стене
    const baseH = computeBaseDashH();
    c.token.dash_x = parseFloat((c.dashX / baseH).toFixed(4));
    c.token.dash_y = parseFloat((c.dashY / baseH).toFixed(4));
    return c.token;
  });

  try {
    await invoke('update_tokens', { tokens: updatedTokens });
    await emit('tokens-updated');
  } catch (err) {
    console.error('[dashboard] positions save failed:', err);
  }

  // Применяем настройки на рабочий стол
  if (settingsChanged) {
    try {
      await invoke('save_settings', { settings: currentSettings });
      await emit('settings-updated', currentSettings);
      settingsChanged = false;
    } catch (err) {
      console.error('[dashboard] settings save failed:', err);
    }
  }

  hasChanges = false;
  saveBtn.dataset.active = 'false';
});

// ─── Попап верификации владения ──────────────────────────────────────────────
// idx  — индекс существующей карточки (режим «подтвердить уже добавленную»)
// token — объект токена (режим импорта, ещё не на холсте)
async function openVerifyPopup(idx, token = null) {
  verifyTargetIdx    = idx;
  verifyPendingToken = token;

  const t = token ?? cards[idx]?.token;
  verifyTokenName.textContent = t?.name || '';
  verifyWalletInput.value = '';
  verifyError.textContent = '';
  setVerifyState('input');
  renderWalletHistory();

  // Показываем кнопку «без подтверждения» только в режиме импорта
  const isImport = token !== null;
  verifyTrialBlock.classList.toggle('hidden', !isImport);

  if (isImport) {
    // Загружаем квоту
    try {
      const left = await invoke('get_trial_quota');
      verifyTrialBtn.disabled = left === 0;
      verifyQuotaText.textContent = t('verify.quota', left);
    } catch {
      verifyTrialBlock.classList.add('hidden');
    }
  }

  overlay.classList.remove('hidden');
  verifyPopup.classList.remove('hidden');
  setTimeout(() => verifyWalletInput.focus(), 40);
}

function closeVerifyPopup() {
  verifyTargetIdx = -1;
  overlay.classList.add('hidden');
  verifyPopup.classList.add('hidden');
}

function setVerifyState(state) {
  verifyStateInput.classList.toggle('hidden', state !== 'input');
  verifyStateLoad .classList.toggle('hidden', state !== 'loading');
  verifyStateOk   .classList.toggle('hidden', state !== 'success');
}

async function handleVerifySubmit() {
  const wallet = verifyWalletInput.value.trim();
  if (!wallet) return;

  // Определяем токен (режим импорта или существующая карточка)
  const token = verifyPendingToken ?? cards[verifyTargetIdx]?.token;
  if (!token) return;

  verifyError.textContent = '';
  setVerifyState('loading');

  try {
    const ok = await invoke('verify_ownership', {
      contract: token.contract,
      tokenId:  token.token_id,
      wallet,
    });

    if (ok) {
      token.verified         = true;
      token.verified_address = wallet;
      token.trial_expires_at = undefined;
      verifySuccessAddr.textContent = wallet.slice(0, 8) + '…' + wallet.slice(-6);
      saveWalletToHistory(wallet);
      setVerifyState('success');

      if (verifyPendingToken) {
        // Режим импорта: сохраняем и добавляем на холст
        await invoke('save_token', { token });
        await addCardToCanvas(token);
      } else {
        // Режим существующей карточки: обновляем и убираем таймер
        const c = cards[verifyTargetIdx];
        const el = c?.el;
        el?.querySelector('.dash-card-verify-btn')?.replaceWith(makeBadge(wallet));
        el?.querySelector('.dash-card-timer')?.remove();
        try {
          await invoke('update_tokens', { tokens: cards.map(cd => cd.token) });
        } catch (e) { console.warn('[verify] save failed:', e); }
      }
    } else {
      setVerifyState('input');
      verifyError.textContent = t('verify.error.notowner');
    }
  } catch (err) {
    setVerifyState('input');
    verifyError.textContent = typeof err === 'string' ? err : 'Ошибка при проверке. Попробуйте ещё раз.';
  }
}

function makeBadge(wallet) {
  const badge = document.createElement('div');
  badge.className = 'dash-card-verified-badge';
  badge.title = `Владение подтверждено: ${wallet}`;
  badge.innerHTML = `<svg width="12" height="10" viewBox="0 0 12 10" fill="none">
    <path d="M1 5L4.5 8.5L11 1" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  return badge;
}

// Кнопка «добавить без подтверждения»
verifyTrialBtn.addEventListener('click', async () => {
  const token = verifyPendingToken;
  if (!token) return;

  verifyTrialBtn.disabled = true;
  verifyError.textContent = '';
  setVerifyState('loading');

  try {
    // Устанавливаем trial_expires_at на JS-объекте ДО добавления на холст,
    // иначе buildCardEl не увидит поле и не нарисует таймер
    const TRIAL_SECS = 3 * 24 * 60 * 60;
    token.trial_expires_at = Math.floor(Date.now() / 1000) + TRIAL_SECS;

    await invoke('add_trial_token', { token });
    await addCardToCanvas(token);
    closeVerifyPopup();
  } catch (err) {
    setVerifyState('input');
    verifyError.textContent = typeof err === 'string' ? err : 'Ошибка при добавлении.';
    verifyTrialBtn.disabled = false;
  }
});

verifySubmit.addEventListener('click', handleVerifySubmit);
verifyWalletInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleVerifySubmit(); });
verifyWalletInput.addEventListener('input', () => { verifyError.textContent = ''; });
verifyClose.addEventListener('click', closeVerifyPopup);
verifyDone.addEventListener('click', closeVerifyPopup);

// ─── Попап подтверждения удаления ────────────────────────────────────────────
function openConfirmPopup(idx) {
  pendingDeleteIdx = idx;
  overlay.classList.remove('hidden');
  confirmPopup.classList.remove('hidden');
}

function closeConfirmPopup() {
  pendingDeleteIdx = -1;
  overlay.classList.add('hidden');
  confirmPopup.classList.add('hidden');
}

confirmCancel.addEventListener('click', closeConfirmPopup);
confirmDelete.addEventListener('click', () => {
  if (pendingDeleteIdx !== -1) deleteCard(pendingDeleteIdx);
  closeConfirmPopup();
});
overlay.addEventListener('click', e => {
  if (e.target === overlay) {
    closePopup();
    closeConfirmPopup();
    closeVerifyPopup();
  }
});

// ─── Попап добавления объекта ─────────────────────────────────────────────────
addBtn.addEventListener('click', openPopup);

function openPopup() {
  overlay.classList.remove('hidden');
  popup.classList.remove('hidden');
  popupInput.value = '';
  popupError.textContent = '';
  setTimeout(() => popupInput.focus(), 40);
}

function closePopup() {
  overlay.classList.add('hidden');
  popup.classList.add('hidden');
}

popupClose.addEventListener('click', closePopup);

let popupErrTimer = null;
function showPopupError(msg) {
  popupError.textContent = msg;
  clearTimeout(popupErrTimer);
  popupErrTimer = setTimeout(() => { popupError.textContent = ''; }, 5000);
}

async function handlePopupAdd() {
  const url = popupInput.value.trim();
  if (!url) return;

  popupError.textContent = '';
  popupSubmit.disabled = true;
  popupSubmit.innerHTML = '<div class="dash-spinner"></div>';

  try {
    const token = await invoke('fetch_token', { url });
    closePopup();
    // Pinterest верифицирован автоматически — добавляем сразу
    if (token.source === 'pinterest') {
      await invoke('save_token', { token });
      await addCardToCanvas(token);
    } else {
      // objkt — открываем попап верификации
      openVerifyPopup(null, token);
    }
  } catch (err) {
    showPopupError(typeof err === 'string' ? err : t('popup.load.error'));
  } finally {
    popupSubmit.disabled = false;
    popupSubmit.textContent = t('popup.import.submit');
  }
}

// ─── Добавить карточку на холст (вызывается после верификации или пробного) ───
async function addCardToCanvas(token) {
  // Сразу создаём карточку с дефолтным соотношением 3:4 — пользователь видит её мгновенно.
  // Когда картинка догрузится — обновим ratio и переотрисуем.
  const cardEntry = {
    token,
    rw: 3, rh: 4,
    dashH: computeBaseDashH(),
    isPinterest: token.source === 'pinterest',
    dashX: null, dashY: null, el: null,
    loading: true,
  };
  cards.push(cardEntry);
  const vH = viewport.clientHeight || 560;
  cardEntry.dashY = Math.round((vH - cardEntry.dashH) / 2);
  if (cards.length > 1) {
    const prev = cards[cards.length - 2];
    const { w: prevW } = cardDims(prev.dashH, prev.rw, prev.rh, prev.isPinterest);
    cardEntry.dashX = (prev.dashX || 0) + prevW + CARD_GAP;
  } else {
    cardEntry.dashX = CANVAS_PAD;
  }
  cardEntry.el = buildCardEl(cardEntry, cards.length - 1);
  cardEntry.el.classList.add('dash-card-loading');
  canvas.appendChild(cardEntry.el);
  recalcTotalWidth();
  updateScrollThumb();
  renderEmpty();
  markChanged();
  await emit('token-added', token);

  // Параллельно дожимаем настоящее соотношение и пересоздаём карточку без лоадера
  const img = new Image();
  img.onload = () => {
    const [rw, rh] = getFrameRatio(img.naturalWidth || 1, img.naturalHeight || 1);
    if (rw === cardEntry.rw && rh === cardEntry.rh) {
      cardEntry.el.classList.remove('dash-card-loading');
      cardEntry.loading = false;
      return;
    }
    cardEntry.rw = rw;
    cardEntry.rh = rh;
    cardEntry.loading = false;
    const idx = cards.indexOf(cardEntry);
    const oldEl = cardEntry.el;
    const newEl = buildCardEl(cardEntry, idx);
    oldEl.replaceWith(newEl);
    cardEntry.el = newEl;
    recalcTotalWidth();
    updateScrollThumb();
  };
  img.onerror = () => {
    cardEntry.el.classList.remove('dash-card-loading');
    cardEntry.loading = false;
  };
  img.src = token.display_uri;
}

popupSubmit.addEventListener('click', handlePopupAdd);
popupInput.addEventListener('keydown', e => { if (e.key === 'Enter') handlePopupAdd(); });
popupInput.addEventListener('input', () => { popupError.textContent = ''; });

// ─── Форматирование оставшегося времени ──────────────────────────────────────
function fmtTimeLeft(expiresSec) {
  const now  = Math.floor(Date.now() / 1000);
  const left = expiresSec - now;
  if (left <= 0) return 'истёк';
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  if (d > 0)  return `${d}д ${h}ч`;
  if (h > 0)  return `${h}ч ${m}м`;
  return `${m}м`;
}

// Обновляем все таймеры каждую минуту
setInterval(() => {
  document.querySelectorAll('.dash-card-timer').forEach(el => {
    const exp = Number(el.dataset.expires);
    if (!exp) return;
    el.textContent = fmtTimeLeft(exp);
  });
}, 60_000);

// ─── Кнопка настроек ─────────────────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// ═══════════════════════════════════════════════════════════════════════════
// ПОДАРКИ — отправка и приём
// ═══════════════════════════════════════════════════════════════════════════
const giftBtn          = document.getElementById('dash-gift-btn');
const giftFormPopup    = document.getElementById('gift-form-popup');
const giftFormClose    = document.getElementById('gift-form-close');
const giftFormCancel   = document.getElementById('gift-form-cancel');
const giftFormNext     = document.getElementById('gift-form-next');
const giftFormUrl      = document.getElementById('gift-form-url');
const giftFormToId     = document.getElementById('gift-form-toid');
const giftFormFromName = document.getElementById('gift-form-fromname');
const giftFormMessage  = document.getElementById('gift-form-message');
const giftFormExpires  = document.getElementById('gift-form-expires');
const giftFormExpiresTrigger = document.getElementById('gift-form-expires-trigger');
const giftFormExpiresLabel   = document.getElementById('gift-form-expires-label');
const giftFormExpiresMenu    = document.getElementById('gift-form-expires-menu');

// Логика кастомного дропдауна
giftFormExpiresTrigger?.addEventListener('click', (e) => {
  e.stopPropagation();
  giftFormExpires.classList.toggle('open');
});
giftFormExpiresMenu?.querySelectorAll('.gift-form-dropdown-option').forEach(opt => {
  if (opt.dataset.value === giftFormExpires.dataset.value) opt.classList.add('selected');
  opt.addEventListener('click', () => {
    giftFormExpires.dataset.value = opt.dataset.value;
    giftFormExpiresLabel.textContent = opt.textContent;
    giftFormExpiresMenu.querySelectorAll('.gift-form-dropdown-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    giftFormExpires.classList.remove('open');
  });
});
document.addEventListener('click', (e) => {
  if (!giftFormExpires?.contains(e.target)) giftFormExpires?.classList.remove('open');
});
const giftFormError    = document.getElementById('gift-form-error');
const giftFormMyCode   = document.getElementById('gift-form-mycode');
const giftFormCopy     = document.getElementById('gift-form-copy');

const giftPlacePopup    = document.getElementById('gift-placement-popup');
const giftPlaceClose    = document.getElementById('gift-placement-close');
const giftPlaceBack     = document.getElementById('gift-placement-back');
const giftPlaceSend     = document.getElementById('gift-placement-send');
const giftPlaceCanvasEl = document.getElementById('gift-placement-canvas');
const giftPlaceCard     = document.getElementById('gift-placement-card');
const giftPlaceImage    = document.getElementById('gift-placement-image');
const giftPlaceFromEl   = document.getElementById('gift-placement-from');
const giftPlaceMsgEl    = document.getElementById('gift-placement-message');
const giftPlaceResize   = document.getElementById('gift-placement-resize');
const giftPlaceError    = document.getElementById('gift-placement-error');

invoke('get_my_code').then(c => { if (giftFormMyCode) giftFormMyCode.textContent = c; }).catch(() => {});
giftFormCopy?.addEventListener('click', async () => {
  const c = giftFormMyCode?.textContent;
  if (c && c !== '…') {
    try { await navigator.clipboard.writeText(c); } catch {}
    giftFormCopy.title = 'Скопировано';
    setTimeout(() => { giftFormCopy.title = 'Скопировать'; }, 1500);
  }
});

let pendingGift = null;
let recipientLayout = null;
let recipientLayoutTimer = null;

// Подгружаем раскладку получателя при вводе/изменении кода
giftFormToId?.addEventListener('input', () => {
  clearTimeout(recipientLayoutTimer);
  recipientLayoutTimer = setTimeout(async () => {
    const id = giftFormToId.value.trim();
    if (!id) { recipientLayout = null; return; }
    try {
      recipientLayout = await invoke('get_user_layout', { userId: id });
    } catch (e) {
      console.warn('[layout]', e);
      recipientLayout = null;
    }
  }, 600);
});

function renderRecipientLayout() {
  if (!giftPlaceCanvasEl) return;
  giftPlaceCanvasEl.querySelectorAll('.gift-recipient-rect').forEach(el => el.remove());
  if (!recipientLayout || !recipientLayout.length) return;
  const cw = giftPlaceCanvasEl.clientWidth;
  const ch = giftPlaceCanvasEl.clientHeight;
  recipientLayout.forEach(r => {
    const div = document.createElement('div');
    div.className = 'gift-recipient-rect';
    Object.assign(div.style, {
      position: 'absolute',
      left:   (r.x * cw) + 'px',
      top:    (r.y * ch) + 'px',
      width:  Math.max(8, r.w * cw) + 'px',
      height: Math.max(8, r.h * ch) + 'px',
      background: 'rgba(255,255,255,0.10)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '4px',
      pointerEvents: 'none',
      zIndex: '1',
    });
    giftPlaceCanvasEl.insertBefore(div, giftPlaceCard);
  });
}

function openGiftForm() {
  overlay.classList.remove('hidden');
  giftFormPopup.classList.remove('hidden');
  giftFormError.textContent = '';
}
function closeGiftAll() {
  giftFormPopup.classList.add('hidden');
  giftPlacePopup.classList.add('hidden');
  overlay.classList.add('hidden');
  pendingGift = null;
}
function gotoPlacement() { giftFormPopup.classList.add('hidden'); giftPlacePopup.classList.remove('hidden'); }
function gotoForm()      { giftPlacePopup.classList.add('hidden'); giftFormPopup.classList.remove('hidden'); }

giftBtn?.addEventListener('click', openGiftForm);
giftFormClose?.addEventListener('click', closeGiftAll);
giftFormCancel?.addEventListener('click', closeGiftAll);
giftPlaceClose?.addEventListener('click', closeGiftAll);
giftPlaceBack?.addEventListener('click', gotoForm);

giftFormNext?.addEventListener('click', async () => {
  const url      = giftFormUrl.value.trim();
  const toId     = giftFormToId.value.trim();
  const fromName = giftFormFromName.value.trim();
  const message  = giftFormMessage.value.trim();
  const hours    = parseInt(giftFormExpires.dataset.value || '8');

  if (!url)      { giftFormError.textContent = 'Введи ссылку на объект'; return; }
  if (!toId)     { giftFormError.textContent = 'Введи код друга';        return; }
  if (!fromName) { giftFormError.textContent = 'Укажи своё имя';         return; }

  giftFormNext.disabled = true;
  giftFormNext.innerHTML = '<div class="dash-spinner"></div>';
  giftFormError.textContent = '';

  try {
    const token = await invoke('fetch_token', { url });
    if (!token.display_uri) throw new Error('Не удалось получить картинку');

    pendingGift = {
      token, toId, fromName, message,
      expiresHours: hours,
      posX: 0.5, posY: 0.5, widthPct: 0.15,
      ratio: 1,
    };

    giftPlaceImage.src = token.display_uri;
    giftPlaceFromEl.textContent = 'от ' + fromName;
    if (message) { giftPlaceMsgEl.textContent = message; giftPlaceMsgEl.style.display = ''; }
    else { giftPlaceMsgEl.style.display = 'none'; }

    giftPlaceImage.onload  = () => {
      pendingGift.ratio = (giftPlaceImage.naturalWidth || 1) / (giftPlaceImage.naturalHeight || 1);
      gotoPlacement();
      requestAnimationFrame(() => { renderRecipientLayout(); positionPlaceCard(); });
    };
    giftPlaceImage.onerror = () => {
      gotoPlacement();
      requestAnimationFrame(() => { renderRecipientLayout(); positionPlaceCard(); });
    };
  } catch (e) {
    console.error('[gift]', e);
    giftFormError.textContent = typeof e === 'string' ? e : 'Не удалось загрузить';
  } finally {
    giftFormNext.disabled = false;
    giftFormNext.textContent = 'Далее';
  }
});

function positionPlaceCard() {
  if (!pendingGift || !giftPlaceCanvasEl) return;
  const cw = giftPlaceCanvasEl.clientWidth;
  const ch = giftPlaceCanvasEl.clientHeight;
  const cardW = pendingGift.widthPct * cw;
  const cardH = (cardW / pendingGift.ratio) + 22;
  const left = pendingGift.posX * cw - cardW / 2;
  const top  = pendingGift.posY * ch - cardH / 2;
  Object.assign(giftPlaceCard.style, {
    left:   Math.max(0, Math.min(cw - cardW, left)) + 'px',
    top:    Math.max(0, Math.min(ch - cardH, top))  + 'px',
    width:  cardW + 'px',
    height: cardH + 'px',
  });
}

let placeDrag = null;
giftPlaceCard?.addEventListener('mousedown', (e) => {
  if (e.target === giftPlaceResize) return;
  placeDrag = {
    type: 'move',
    startMX: e.clientX, startMY: e.clientY,
    origLeft: giftPlaceCard.offsetLeft,
    origTop:  giftPlaceCard.offsetTop,
  };
  e.preventDefault();
});
giftPlaceResize?.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  placeDrag = { type: 'resize', startMX: e.clientX, origW: giftPlaceCard.offsetWidth };
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!placeDrag || !pendingGift) return;
  const cw = giftPlaceCanvasEl.clientWidth;
  const ch = giftPlaceCanvasEl.clientHeight;
  if (placeDrag.type === 'move') {
    const newLeft = placeDrag.origLeft + (e.clientX - placeDrag.startMX);
    const newTop  = placeDrag.origTop  + (e.clientY - placeDrag.startMY);
    const cardW = giftPlaceCard.offsetWidth;
    const cardH = giftPlaceCard.offsetHeight;
    const x = Math.max(0, Math.min(cw - cardW, newLeft));
    const y = Math.max(0, Math.min(ch - cardH, newTop));
    giftPlaceCard.style.left = x + 'px';
    giftPlaceCard.style.top  = y + 'px';
    pendingGift.posX = (x + cardW / 2) / cw;
    pendingGift.posY = (y + cardH / 2) / ch;
  } else {
    let newW = placeDrag.origW + (e.clientX - placeDrag.startMX);
    newW = Math.max(40, Math.min(cw * 0.45, newW));
    const newH = newW / pendingGift.ratio + 22;
    giftPlaceCard.style.width  = newW + 'px';
    giftPlaceCard.style.height = newH + 'px';
    pendingGift.widthPct = newW / cw;
    if (giftPlaceCard.offsetLeft + newW > cw) giftPlaceCard.style.left = (cw - newW) + 'px';
    if (giftPlaceCard.offsetTop  + newH > ch) giftPlaceCard.style.top  = (ch - newH) + 'px';
    pendingGift.posX = (giftPlaceCard.offsetLeft + newW / 2) / cw;
    pendingGift.posY = (giftPlaceCard.offsetTop  + newH / 2) / ch;
  }
});
document.addEventListener('mouseup', () => { placeDrag = null; });

giftPlaceSend?.addEventListener('click', async () => {
  if (!pendingGift) return;
  giftPlaceSend.disabled = true;
  giftPlaceSend.innerHTML = '<div class="dash-spinner"></div>';
  giftPlaceError.textContent = '';
  try {
    const t = pendingGift.token;
    await invoke('send_gift', {
      toId:        pendingGift.toId,
      fromName:    pendingGift.fromName,
      name:        t.name || '',
      creators:    t.creators || [],
      imageUrl:    t.display_uri,
      source:      t.source || 'pinterest',
      message:     pendingGift.message,
      expiresHours: pendingGift.expiresHours,
      posX:        pendingGift.posX,
      posY:        pendingGift.posY,
      widthPct:    pendingGift.widthPct,
    });
    closeGiftAll();
    giftFormUrl.value = '';
    giftFormToId.value = '';
    giftFormMessage.value = '';
  } catch (e) {
    console.error('[gift-send]', e);
    giftPlaceError.textContent = typeof e === 'string' ? e : 'Не удалось отправить';
  } finally {
    giftPlaceSend.disabled = false;
    giftPlaceSend.textContent = 'Отправить';
  }
});

// ─── Входящие подарки на дашборде ────────────────────────────────────────────
const dashGifts = new Map();

function renderDashGift(gift) {
  if (dashGifts.has(gift.id)) return;
  const right = document.querySelector('.dash-right');
  if (!right) return;

  const wrap = document.createElement('div');
  wrap.className = 'dash-incoming-gift';
  const widthPx = Math.max(60, gift.width_pct * right.clientWidth);
  Object.assign(wrap.style, {
    position: 'absolute',
    left: (gift.pos_x * right.clientWidth) + 'px',
    top:  (gift.pos_y * right.clientHeight) + 'px',
    width: widthPx + 'px',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '8px',
    overflow: 'visible',
    zIndex: '4',
    pointerEvents: 'auto',
  });

  const inner = document.createElement('div');
  inner.style.cssText = 'overflow:hidden;border-radius:8px;';
  const img = document.createElement('img');
  img.src = gift.image_url;
  img.style.cssText = 'width:100%;display:block;';
  inner.appendChild(img);

  const meta = document.createElement('div');
  meta.style.cssText = 'padding:6px 8px;font-family:var(--font-main);font-size:11px;color:var(--fg-subtle);line-height:1.3;background:rgba(0,0,0,0.55);';
  const fromLine = document.createElement('div');
  fromLine.textContent = 'от ' + (gift.from_name || 'неизвестно');
  fromLine.style.cssText = 'color:var(--fg);font-weight:600;';
  meta.appendChild(fromLine);
  if (gift.message) {
    const msg = document.createElement('div');
    msg.textContent = gift.message;
    msg.style.cssText = 'color:rgba(255,255,255,0.65);';
    meta.appendChild(msg);
  }
  inner.appendChild(meta);
  wrap.appendChild(inner);

  const close = document.createElement('button');
  close.textContent = '×';
  close.style.cssText = 'position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;background:#FF453A;color:#fff;border:none;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
  close.addEventListener('click', async () => {
    wrap.remove();
    dashGifts.delete(gift.id);
    try { await invoke('dismiss_gift', { giftId: gift.id }); } catch {}
    await emit('gift-dismissed', gift.id);
  });
  wrap.appendChild(close);

  right.appendChild(wrap);
  dashGifts.set(gift.id, wrap);
}

async function loadIncomingGifts() {
  try {
    const gifts = await invoke('get_incoming_gifts');
    gifts.forEach(renderDashGift);
  } catch (e) { console.warn('[gifts]', e); }
}

loadIncomingGifts();
listen('gift-received', e => renderDashGift(e.payload));

// ─── Запуск ───────────────────────────────────────────────────────────────────
init();
