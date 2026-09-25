/**
 * BKStudio - BK Graphics Editor (UI)
 *
 * Графический редактор пиксельной графики БК в виде модального окна поверх BKStudio.
 *
 * Единственный источник состояния изображения — экземпляр BKGraphicsModel
 * (из bk-graphics-model.js). DOM только отображает состояние; пиксели,
 * история и настройки инструментов живут в замыкании модуля.
 *
 * Возможности:
 *   - canvas с пиксельной сеткой и масштабом (zoom):
 *     кнопки (+/-), Пробел + колесо мыши, Ctrl+= / Ctrl+-;
 *   - инструменты: карандаш, ластик, заливка, линия, прямоугольник,
 *     выделение, трансформация (Ctrl+T), копирование (Ctrl+C), вставка (Ctrl+V);
 *   - трансформация: масштабирование и поворот выделенной области
 *     мышью за угловые маркеры;
 *   - очистка, переворот по горизонтали/вертикали, поворот на 90°;
 *   - отмена/повтор (undo/redo) с историей;
 *   - выбор цвета, выбор палитры (16 палитр БК-0011М);
 *   - preview с масштабом (кнопки +/−); при превышении размеров —
 *     скролл-бары справа и снизу;
 *   - информация о размере изображения и размере данных;
 *   - единый экспорт данных (.ASM/.MAC — одинаковое содержимое,
 *     различаются только расширением);
 *   - добавление изображения в проект (через bkProject):
 *     файлы .MAC/.ASM + опционально .PNG и вставка .INCLUDE в текущий файл.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  // =====================================================================
  // Константы
  // =====================================================================

  /** Максимальная длина истории undo/redo. */
  const HISTORY_LIMIT = 60;

  /** Доступные уровни масштаба главного холста. */
  const ZOOM_LEVELS = [1, 2, 4, 8, 12, 16];

  /** Масштаб по умолчанию. */
  const DEFAULT_ZOOM = 4;

  /** Режим по умолчанию при первом открытии редактора. */
  const DEFAULT_MODE_ID = 'BK0011M_COLOR';

  // =====================================================================
  // Состояние (не в DOM!)
  // =====================================================================

  /**
   * Активное состояние редактора.
   * @type {?Object} {
   *   model: BKGraphicsModel,  — модель изображения (источник истины);
   *   tool: string,            — активный инструмент;
   *   colorIndex: number,      — выбранный индекс цвета;
   *   zoom: number,            — масштаб главного холста;
   *   previewZoom: number,     — масштаб preview;
   *   showGrid: boolean,       — показывать сетку пикселей;
   *   history: Object[],       — снимки {pixels: Uint8Array, width, height};
   *   historyIndex: number,    — индекс текущего снимка в history;
   *   drawing: Object|null     — текущий штрих (для line/rect preview).
   * }
   */
  let state = null;

  /** Корневой элемент модального окна (создаётся один раз). */
  let overlay = null;

  /** Карта id → DOM-элементы редактора. */
  const els = {};

  /** Вспомогательный холст натурального размера (w×h) для быстрого рендера. */
  let offscreen = null;
  let offCtx = null;

  /** Флаг: удерживается ли клавиша Пробел (для зума колесом мыши). */
  let spaceHeld = false;

  // =====================================================================
  // Вспомогательные функции
  // =====================================================================

  /**
   * Разбирает hex-цвет в [r, g, b].
   * @param {string} hex - hex-цвет, например '#FF0000'.
   * @returns {number[]} [r, g, b].
   */
  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  /**
   * Форматирует количество байт для отображения.
   * @param {number} n - количество байт.
   * @returns {string} например '16384 байт (16 КБайт)'.
   */
  function formatBytes(n) {
    if (n < 1024) {
      return n + ' байт';
    }
    const kb = n / 1024;
    const kbStr = (Math.abs(kb - Math.round(kb)) < 0.05) ? String(Math.round(kb)) : kb.toFixed(1);
    return n + ' байт (' + kbStr + ' КБайт)';
  }

  /**
   * Размер данных изображения в байтах (байтовое представление БК).
   * Использует BKGraphicsCodec, если он загружен.
   * @returns {number} количество байт.
   */
  function getDataSize() {
    const m = state.model;
    if (global.BKGraphicsCodec) {
      return global.BKGraphicsCodec.getEncodedSize(m.width, m.height, m.mode);
    }
    const mode = getGraphicsMode(m.mode);
    return Math.ceil((m.width * mode.bitsPerPixel) / 8) * m.height;
  }

  /**
   * Целое число из значения с ограничением диапазона.
   * @param {number|string} value - исходное значение.
   * @param {number} min - минимум.
   * @param {number} max - максимум.
   * @returns {number} целое в диапазоне [min, max].
   */
  function clampInt(value, min, max) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) {
      return min;
    }
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Определяет сетку фреймов для заданного количества спрайтов:
   * cols × rows, где cols*rows >= count, cols >= rows (альбомная
   * ориентация), минимальная общая площадь, при равенстве — ближе к
   * квадрату.
   * @param {number} count - количество спрайтов (1..12).
   * @returns {{cols: number, rows: number}}
   */
  function getSpriteGrid(count) {
    let best = null;
    let bestArea = Infinity;
    let bestDiff = Infinity;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      if (cols < rows) {
        continue;
      }
      const area = cols * rows;
      const diff = Math.abs(cols - rows);
      if (best === null || area < bestArea || (area === bestArea && diff < bestDiff)) {
        best = { cols: cols, rows: rows };
        bestArea = area;
        bestDiff = diff;
      }
    }
    return best;
  }

  /**
   * Сетка фреймов с учётом ограничений режима: ширина/высота спрайта
   * ограничиваются так, чтобы лист влез в режим.
   * @returns {{cols, rows, spriteWidth, spriteHeight, count, totalWidth, totalHeight}}
   */
  function spriteGridInfo() {
    const m = state.model;
    const mode = getGraphicsMode(m.mode);
    const grid = getSpriteGrid(state.spriteCount);
    const maxSw = Math.floor(mode.width / grid.cols);
    const maxSh = Math.floor(mode.height / grid.rows);
    const sw = Math.max(2, Math.min(state.spriteWidth, maxSw));
    const sh = Math.max(2, Math.min(state.spriteHeight, maxSh));
    return {
      cols: grid.cols,
      rows: grid.rows,
      spriteWidth: sw,
      spriteHeight: sh,
      count: state.spriteCount,
      totalWidth: sw * grid.cols,
      totalHeight: sh * grid.rows
    };
  }

  /**
   * Пиксели одного фрейма из листа.
   * @param {number} frame - индекс фрейма (0..count-1).
   * @returns {number[]} плоский массив индексов цветов.
   */
  function getFramePixels(frame) {
    const m = state.model;
    const grid = spriteGridInfo();
    const fx = (frame % grid.cols) * grid.spriteWidth;
    const fy = Math.floor(frame / grid.cols) * grid.spriteHeight;
    const pixels = [];
    for (let y = 0; y < grid.spriteHeight; y++) {
      for (let x = 0; x < grid.spriteWidth; x++) {
        pixels.push(m.getPixel(fx + x, fy + y));
      }
    }
    return pixels;
  }

  // =====================================================================
  // История (undo / redo)
  // =====================================================================

  /**
   * Снимок состояния изображения (пиксели как Uint8Array — экономно).
   * @param {BKGraphicsModel} model - модель.
   * @returns {Object} {pixels: Uint8Array, width, height}.
   */
  function snapshot(model) {
    return {
      pixels: Uint8Array.from(model.pixels),
      width: model.width,
      height: model.height
    };
  }

  /**
   * Восстанавливает модель из снимка.
   * @param {Object} snap - снимок состояния.
   */
  function restoreSnapshot(snap) {
    const m = state.model;
    m.width = snap.width;
    m.height = snap.height;
    m.pixels = Array.from(snap.pixels);
  }

  /**
   * Добавляет текущее состояние модели в историю (вызывается
   * после завершённого изменения). Обрезает ветку redo.
   */
  function pushHistory() {
    state.history.splice(state.historyIndex + 1);
    state.history.push(snapshot(state.model));
    state.historyIndex = state.history.length - 1;
    if (state.history.length > HISTORY_LIMIT) {
      state.history.shift();
      state.historyIndex--;
    }
  }

  /**
   * Сбрасывает историю (например, при смене режима).
   */
  function resetHistory() {
    state.history = [snapshot(state.model)];
    state.historyIndex = 0;
  }

  /**
   * Отменяет последнее изменение.
   */
  function undo() {
    if (state.historyIndex <= 0) {
      return;
    }
    state.historyIndex--;
    restoreSnapshot(state.history[state.historyIndex]);
    renderAll();
  }

  /**
   * Повторяет отменённое изменение.
   */
  function redo() {
    if (state.historyIndex >= state.history.length - 1) {
      return;
    }
    state.historyIndex++;
    restoreSnapshot(state.history[state.historyIndex]);
    renderAll();
  }

  // =====================================================================
  // Примитивы рисования (работают с моделью напрямую)
  // =====================================================================

  /**
   * Заливает однотонную область цветом от точки (x, y) (flood fill).
   * @param {number} x - стартовая точка по горизонтали.
   * @param {number} y - стартовая точка по вертикали.
   * @param {number} color - индекс цвета.
   * @returns {boolean} true, если хотя бы один пиксель изменился.
   */
  function floodFill(x, y, color) {
    const m = state.model;
    const target = m.getPixel(x, y);
    if (target === undefined || target === color) {
      return false;
    }
    let changed = false;
    const w = m.width;
    const h = m.height;
    const px = m.pixels;
    const stack = [[x, y]];
    while (stack.length > 0) {
      const cell = stack.pop();
      const cx = cell[0];
      const cy = cell[1];
      const i = cy * w + cx;
      if (px[i] !== target) {
        continue;
      }
      px[i] = color;
      changed = true;
      if (cx > 0) { stack.push([cx - 1, cy]); }
      if (cx < w - 1) { stack.push([cx + 1, cy]); }
      if (cy > 0) { stack.push([cx, cy - 1]); }
      if (cy < h - 1) { stack.push([cx, cy + 1]); }
    }
    return changed;
  }

  /**
   * Рисует линию по алгоритму Брезенхема (включая обе концы).
   * @param {number} x0 @param {number} y0 - начало.
   * @param {number} x1 @param {number} y1 - конец.
   * @param {number} color - индекс цвета.
   */
  function drawLine(x0, y0, x1, y1, color) {
    const m = state.model;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      m.setPixel(x, y, color);
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    m.setPixel(x, y, color);
  }

  /**
   * Рисует контур прямоугольника (рамку) между двумя точками.
   * @param {number} x0 @param {number} y0 - первая точка.
   * @param {number} x1 @param {number} y1 - вторая точка.
   * @param {number} color - индекс цвета.
   */
  function drawRectOutline(x0, y0, x1, y1, color) {
    const m = state.model;
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    for (let x = xa; x <= xb; x++) {
      m.setPixel(x, ya, color);
      m.setPixel(x, yb, color);
    }
    for (let y = ya; y <= yb; y++) {
      m.setPixel(xa, y, color);
      m.setPixel(xb, y, color);
    }
  }

  // =====================================================================
  // Выделение, буфер (clipboard) и вставка
  // =====================================================================

  /**
   * Текущая область выделения: либо в процессе перетаскивания
   * (state.drawing.rect), либо зафиксированная (state.selection).
   * @returns {?{x: number, y: number, w: number, h: number}}
   */
  function getActiveSelectionRect() {
    if (state.drawing && state.drawing.tool === 'select' && state.drawing.rect) {
      return state.drawing.rect;
    }
    return state.selection;
  }

  /**
   * Рисует рамку выделения (маркированный контур) на главном холсте.
   * @param {CanvasRenderingContext2D} ctx - контекст.
   * @param {number} z - масштаб.
   */
  function drawSelection(ctx, z) {
    const sel = getActiveSelectionRect();
    if (!sel) {
      return;
    }
    ctx.save();
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(sel.x * z, sel.y * z, sel.w * z, sel.h * z);
    ctx.restore();
  }

  /**
   * Рисует 4 угловых маркера трансформации.
   * @param {CanvasRenderingContext2D} ctx - контекст.
   * @param {number} z - масштаб.
   */
  function drawTransformHandles(ctx, z) {
    const sel = state.selection;
    if (!sel) {
      return;
    }
    const hs = 8; // размер маркера в пикселях экрана
    const corners = [
      { x: sel.x, y: sel.y },           // tl
      { x: sel.x + sel.w, y: sel.y },   // tr
      { x: sel.x, y: sel.y + sel.h },   // bl
      { x: sel.x + sel.w, y: sel.y + sel.h }  // br
    ];
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    corners.forEach(function (c) {
      const hx = c.x * z - hs / 2;
      const hy = c.y * z - hs / 2;
      ctx.fillRect(hx, hy, hs, hs);
      ctx.strokeRect(hx, hy, hs, hs);
    });
    ctx.restore();
  }

  /**
   * Проверяет, находится ли точка (mx, my) в пределах углового маркера.
   * Возвращает имя маркера ('tl'|'tr'|'bl'|'br') или null.
   * @param {number} mx - координата мыши по X (пиксели модели).
   * @param {number} my - координата мыши по Y (пиксели модели).
   * @returns {string|null}
   */
  function hitTestTransformHandle(mx, my) {
    const sel = state.selection;
    if (!sel) {
      return null;
    }
    const z = state.zoom;
    const hs = 12 / z; // размер маркера в пикселях модели (увеличен)
    const corners = [
      { name: 'tl', x: sel.x, y: sel.y },
      { name: 'tr', x: sel.x + sel.w, y: sel.y },
      { name: 'bl', x: sel.x, y: sel.y + sel.h },
      { name: 'br', x: sel.x + sel.w, y: sel.y + sel.h }
    ];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (mx >= c.x - hs && mx <= c.x + hs && my >= c.y - hs && my <= c.y + hs) {
        return c.name;
      }
    }
    return null;
  }

  /**
   * Применяет текущую трансформацию (масштаб + поворот) к выделенной области.
   * Трансформация происходит вокруг фиксированного центра выделения.
   * Масштабирование ограничено только размером основного изображения.
   */
  function applyTransform() {
    const sel = state.selection;
    const ts = state.transformState;
    if (!sel || !ts) {
      return;
    }
    const m = state.model;
    const scale = ts.scale;
    const rotation = ts.rotation;
    // Фиксированные размеры выделения (не меняются!)
    const fixedW = sel.w;
    const fixedH = sel.h;
    // Размер трансформированного изображения (ограничен размером модели)
    let newW = Math.max(1, Math.round(fixedW * scale));
    let newH = Math.max(1, Math.round(fixedH * scale));
    // Ограничиваем размерами основного изображения
    newW = Math.min(newW, m.width);
    newH = Math.min(newH, m.height);
    console.log('[applyTransform] scale:', scale.toFixed(2), 'fixed:', fixedW, 'x', fixedH, 'new:', newW, 'x', newH, 'img:', m.width, 'x', m.height);
    // Извлекаем пиксели выделения
    const srcPixels = [];
    for (let y = 0; y < fixedH; y++) {
      for (let x = 0; x < fixedW; x++) {
        srcPixels.push(m.getPixel(sel.x + x, sel.y + y));
      }
    }
    // Создаём буфер результата
    const resultPixels = new Uint8Array(newW * newH);
    // Центры в локальных координатах
    const srcCx = fixedW / 2;
    const srcCy = fixedH / 2;
    const dstCx = newW / 2;
    const dstCy = newH / 2;
    const cosR = Math.cos(-rotation);
    const sinR = Math.sin(-rotation);
    // Для каждого пикселя результата вычисляем позицию в исходнике
    for (let dy = 0; dy < newH; dy++) {
      for (let dx = 0; dx < newW; dx++) {
        // Вектор от центра результата (локальные координаты)
        const vx = dx - dstCx;
        const vy = dy - dstCy;
        // Обратный поворот и масштабирование
        const rx = (vx * cosR - vy * sinR) / scale;
        const ry = (vx * sinR + vy * cosR) / scale;
        // Позиция в исходнике (локальные координаты)
        const sx = Math.round(rx + srcCx);
        const sy = Math.round(ry + srcCy);
        // Проверяем границы
        if (sx >= 0 && sx < fixedW && sy >= 0 && sy < fixedH) {
          resultPixels[dy * newW + dx] = srcPixels[sy * fixedW + sx];
        }
      }
    }
    // Записываем результат в модель (с центрированием внутри выделения)
    const dstX = sel.x + Math.floor((fixedW - newW) / 2);
    const dstY = sel.y + Math.floor((fixedH - newH) / 2);
    console.log('[applyTransform] dst:', dstX, dstY, 'sel:', sel.x, sel.y, 'newW:', newW, 'newH:', newH, 'scale:', scale.toFixed(2));
    let written = 0;
    for (let dy = 0; dy < newH; dy++) {
      for (let dx = 0; dx < newW; dx++) {
        const px = dstX + dx;
        const py = dstY + dy;
        if (px >= 0 && px < m.width && py >= 0 && py < m.height) {
          m.setPixel(px, py, resultPixels[dy * newW + dx]);
          written++;
        }
      }
    }
    console.log('[applyTransform] written:', written, 'total:', newW * newH);
    // Выделение не обновляем — оно фиксировано
    // Сбрасываем состояние трансформации
    state.transformState = {
      sel: { x: sel.x, y: sel.y, w: fixedW, h: fixedH },
      scale: 1,
      rotation: 0
    };
    pushHistory();
  }

  /**
   * Копирует выделенную область в буфер (2D-массив индексов цветов).
   * @returns {boolean} true, если буфер заполнен.
   */
  function copySelection() {
    const sel = getActiveSelectionRect();
    if (!sel) {
      return false;
    }
    const m = state.model;
    const pixels = [];
    for (let dy = 0; dy < sel.h; dy++) {
      const row = [];
      for (let dx = 0; dx < sel.w; dx++) {
        row.push(m.getPixel(sel.x + dx, sel.y + dy));
      }
      pixels.push(row);
    }
    state.clipboard = { width: sel.w, height: sel.h, pixels: pixels };
    renderGhostCanvas();
    // Если инструмент Paste активен — показываем ghost-preview
    if (state.tool === 'paste') {
      startPasteGhost();
    }
    return true;
  }

  /**
   * Вставляет содержимое буфера в точку (x, y): верхний левый угол
   * буфера совмещается с (x, y). Пиксели вне границ изображения
   * обрезаются.
   * @param {number} x - координата по горизонтали.
   * @param {number} y - координата по вертикали.
   * @returns {boolean} true, если вставка выполнена.
   */
  function pasteAt(x, y) {
    if (!state.clipboard) {
      return false;
    }
    const cb = state.clipboard;
    const m = state.model;
    for (let dy = 0; dy < cb.height; dy++) {
      for (let dx = 0; dx < cb.width; dx++) {
        m.setPixel(x + dx, y + dy, cb.pixels[dy][dx]);
      }
    }
    pushHistory();
    renderAll();
    return true;
  }

  /**
   * Отменяет трансформацию: сбрасывает scale/rotation к единице/нулю,
   * но не применяет изменения к пикселям.
   */
  function cancelTransform() {
    if (!state.selection || !state.transformState) {
      return;
    }
    state.transformState.scale = 1;
    state.transformState.rotation = 0;
    state.transformHandle = null;
    state.transformStart = null;
    state.drawing = null;
    setTool('pencil');
    renderAll();
  }

  /**
   * Сбрасывает выделение: очищает state.selection, переключает
   * инструмент на карандаш, обновляет состояние кнопки Transform.
   */
  function resetSelection() {
    state.selection = null;
    state.transformState = null;
    state.transformHandle = null;
    state.transformStart = null;
    setTool('pencil');
    updateTransformButton();
    renderAll();
  }

  /**
   * Обновляет состояние кнопки Transform:
   * включает/выключает disabled в зависимости от наличия выделения.
   */
  function updateTransformButton() {
    if (els.toolTransform) {
      els.toolTransform.disabled = !state.selection;
    }
  }

  /**
   * Рендерит содержимое буфера в отдельный холст (кэш для призрака
   * вставки), используя текущую палитру модели.
   */
  function renderGhostCanvas() {
    if (!state.clipboard) {
      state.ghostCanvas = null;
      return;
    }
    const cb = state.clipboard;
    const m = state.model;
    const canvas = document.createElement('canvas');
    canvas.width = cb.width;
    canvas.height = cb.height;
    const ctx = canvas.getContext('2d');
    const img = new ImageData(cb.width, cb.height);
    const d = img.data;
    const rgb = m.palette.map(hexToRgb);
    for (let i = 0; i < cb.width * cb.height; i++) {
      const idx = cb.pixels[Math.floor(i / cb.width)][i % cb.width];
      const c = rgb[idx] || rgb[0];
      const o = i << 2;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    state.ghostCanvas = canvas;
  }

  /**
   * Рисует «призрачный» контур вставки (содержимое буфера) в позиции
   * state.pastePos на главном холсте. Масштабирует содержимое буфера
   * с учётом текущего зума.
   * @param {CanvasRenderingContext2D} ctx - контекст.
   * @param {number} z - масштаб.
   */
  function drawPasteGhost(ctx, z) {
    if (!state.ghostCanvas || !state.pastePos) {
      return;
    }
    const px = state.pastePos.x;
    const py = state.pastePos.y;
    const cb = state.clipboard;
    ctx.save();
    ctx.globalAlpha = 0.7; // полупрозрачность 70%
    ctx.drawImage(state.ghostCanvas, px * z, py * z, cb.width * z, cb.height * z);
    ctx.restore();
  }

  /**
   * Запускает ghost превью вставки (полупрозрачность).
   * Вызывается при активном инструменте Paste.
   */
  function startPasteGhost() {
    // Ghost рисуется всегда при активном инструменте Paste
  }

  /**
   * Останавливает ghost превью вставки.
   */
  function stopPasteGhost() {
    state.ghostCanvas = null;
  }

  /**
   * Рисует ghost превью результата трансформации на холсте.
   * Показывает полный результат трансформации без обрезки по области
   * выделения. Трансформация происходит вокруг фиксированного центра
   * выделения.
   * @param {CanvasRenderingContext2D} ctx - контекст.
   * @param {number} z - масштаб.
   */
  function drawTransformGhost(ctx, z) {
    if (state.tool !== 'transform' || !state.selection || !state.transformState) {
      return;
    }
    const sel = state.selection;
    const ts = state.transformState;
    const scale = ts.scale;
    const rotation = ts.rotation;
    // Размер результата (без ограничения размерами выделения)
    const newW = Math.max(1, Math.round(sel.w * scale));
    const newH = Math.max(1, Math.round(sel.h * scale));
    // Создаём временный холст для превью
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = newW;
    tmpCanvas.height = newH;
    const tmpCtx = tmpCanvas.getContext('2d');
    const img = new ImageData(newW, newH);
    const d = img.data;
    const rgb = state.model.palette.map(hexToRgb);
    // Фиксированный центр выделения (не меняется!)
    const srcCx = sel.w / 2;
    const srcCy = sel.h / 2;
    // Центр результата
    const dstCx = newW / 2;
    const dstCy = newH / 2;
    const cosR = Math.cos(-rotation);
    const sinR = Math.sin(-rotation);
    // Для каждого пикселя результата вычисляем позицию в исходнике
    for (let dy = 0; dy < newH; dy++) {
      for (let dx = 0; dx < newW; dx++) {
        // Вектор от центра результата (локальные координаты)
        const vx = dx - dstCx;
        const vy = dy - dstCy;
        // Обратный поворот и масштабирование
        const rx = (vx * cosR - vy * sinR) / scale;
        const ry = (vx * sinR + vy * cosR) / scale;
        // Позиция в исходнике (локальные координаты)
        const sx = Math.round(rx + srcCx);
        const sy = Math.round(ry + srcCy);
        const o = (dy * newW + dx) << 2;
        if (sx >= 0 && sx < sel.w && sy >= 0 && sy < sel.h) {
          const colorIdx = state.model.getPixel(sel.x + sx, sel.y + sy);
          const c = rgb[colorIdx] || rgb[0];
          d[o] = c[0];
          d[o + 1] = c[1];
          d[o + 2] = c[2];
          d[o + 3] = 180; // полупрозрачность 70%
        } else {
          d[o + 3] = 0; // прозрачный
        }
      }
    }
    tmpCtx.putImageData(img, 0, 0);
    // Рисуем на главном холсте с центрированием внутри выделения
    const offsetX = sel.x + Math.floor((sel.w - newW) / 2);
    const offsetY = sel.y + Math.floor((sel.h - newH) / 2);
    ctx.drawImage(tmpCanvas, offsetX * z, offsetY * z, newW * z, newH * z);
  }

  // =====================================================================
  // Создание состояния
  // =====================================================================

  /**
   * Создаёт начальное состояние редактора.
   * @param {Object} [options] - параметры: mode, width, height,
   *   paletteIndex или готовая модель (model).
   * @returns {Object} состояние редактора.
   */
  function createState(options) {
    options = options || {};
    let model;
    if (options.model && options.model instanceof BKGraphicsModel) {
      model = options.model;
    } else {
      model = new BKGraphicsModel({
        mode: options.mode || DEFAULT_MODE_ID,
        width: options.width,
        height: options.height,
        paletteIndex: options.paletteIndex
      });
    }
    return {
      model: model,
      editorMode: 'graphics',
      tool: 'pencil',
      colorIndex: 1,
      zoom: DEFAULT_ZOOM,
      previewZoom: 1,
      showGrid: true,
      history: [snapshot(model)],
      historyIndex: 0,
      drawing: null,
      selection: null,      // {x, y, w, h} — зафиксированная область выделения (пиксели модели)
      clipboard: null,      // {width, height, pixels: number[][]} — буфер (2D-массив индексов цветов)
      ghostCanvas: null,    // кэшированный холст с содержимым буфера (призрак вставки)
      pastePos: null,       // {x, y} — позиция призрака вставки (верхний левый угол), пиксели модели
      lastMousePos: null,   // {x, y} — последняя позиция мыши на холсте (для Ctrl+V)
      // Состояние трансформации (инструмент Transform)
      transformState: null,   // { sel: {x,y,w,h}, scale: number, rotation: number }
      transformHandle: null,  // текущий перетаскиваемый маркер: 'tl'|'tr'|'bl'|'br'
      transformStart: null,   // { mx, my, scale, rotation } — начальная точка перетаскивания
      // Ghost preview трансформации
      transformGhostAlpha: 0.7, // полупрозрачность ghost превью
      spriteWidth: 16,
      spriteHeight: 16,
      spriteCount: 8,
      animFrame: 0,
      animPlaying: false,
      animDelay: 200,
      animTimer: null
    };
  }

  // =====================================================================
  // DOM: построение модального окна
  // =====================================================================

  /**
   * Строит DOM модального окна один раз и привязывает события.
   */
  function buildDom() {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay bk-g-overlay';
    overlay.id = 'bk-g-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML =
      '<div class="bk-g-dialog" role="dialog" aria-label="BK Graphics" tabindex="-1">' +
      '<div class="bk-g-header">' +
      '  <span id="bk-g-title">🎨 BK Graphics — редактор пиксельной графики БК</span>' +
      '  <span id="bk-g-mode-label" class="bk-g-mode-label"></span>' +
      '  <button class="icon-btn" id="bk-g-close" title="Закрыть редактор (Esc)">✕</button>' +
      '</div>' +
      '<div class="bk-g-setup">' +
      '  <label class="bk-g-field">Режим <select id="bk-g-mode"></select></label>' +
      '  <span class="bk-g-dims" id="bk-g-dims">' +
      '    <label class="bk-g-field">Шир. <input id="bk-g-width" type="number" min="1"></label>' +
      '    <label class="bk-g-field">Выс. <input id="bk-g-height" type="number" min="1"></label>' +
      '    <button class="bk-g-btn" id="bk-g-apply-size" title="Применить размер (существующие пиксели сохраняются)">Размер</button>' +
      '  </span>' +
      '  <span class="bk-g-sprite-dims" id="bk-g-sprite-dims" style="display:none;">' +
      '    <label class="bk-g-field">Ширина спрайта: <input id="bk-g-sprite-width" type="number" min="2" max="128"></label>' +
      '    <label class="bk-g-field">Высота спрайта: <input id="bk-g-sprite-height" type="number" min="2" max="128"></label>' +
      '    <label class="bk-g-field">Кол-во спрайтов: <input id="bk-g-sprite-count" type="number" min="1" max="64"></label>' +
      '  </span>' +
      '  <label class="bk-g-field" id="bk-g-palette-field">Палитра <select id="bk-g-palette"></select></label>' +
      '</div>' +
      '<div class="bk-g-toolbar">' +
      '  <div class="bk-g-group">' +
      '    <button class="bk-g-btn" id="bk-g-new" title="Новое пустое изображение (режим и размер — из строки настроек)">✚ New</button>' +
      '    <button class="bk-g-btn" id="bk-g-open-png" title="Открыть изображение из PNG-файла">📂 Open PNG</button>' +
      '    <button class="bk-g-btn" id="bk-g-save-png" title="Сохранить текущее изображение в PNG-файл">💾 Save PNG</button>' +
      '    <button class="bk-g-btn" id="bk-g-open-bin" title="Загрузить бинарный экран БК (.BIN, .DAT, .BKS) из файла" style="display:none;">📂 Экран БК</button>' +
      '    <label class="bk-g-field">Экспорт <select id="bk-g-export-format"></select></label>' +
      '    <button class="bk-g-btn" id="bk-g-export" title="Скачать данные изображения">📄 Export</button>' +
      '    <button class="bk-g-btn" id="bk-g-add-project" title="Добавить данные изображения в проект">➕ Add to project</button>' +
      '    <button class="bk-g-btn" id="bk-g-import-project" title="Импортировать экран БК или состояние из проекта">📥 Из проекта</button>' +
      '    <button class="bk-g-btn" id="bk-g-save-state" title="Сохранить полное состояние редактора (.BKGfxState)">💾 Сохранить состояние</button>' +
      '    <button class="bk-g-btn" id="bk-g-load-state" title="Загрузить состояние редактора (.BKGfxState) из файла">📂 Загрузить состояние</button>' +
      '    <input type="file" id="bk-g-png-file" accept="image/png" style="display:none;">' +
      '    <input type="file" id="bk-g-bin-file" accept=".bin,.dat,.bks" style="display:none;">' +
      '    <input type="file" id="bk-g-state-file" accept=".BKGfxState,.json" style="display:none;">' +
      '  </div>' +
      '  <div class="bk-g-group">' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="pencil" title="Карандаш: рисовать текущим цветом">✏ Карандаш</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="erase" title="Ластик: стирать в чёрный">⌫ Ластик</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="fill" title="Заливка: заполнить однотонную область">▒ Заливка</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="line" title="Линия: перетащите от начала до конца">╱ Линия</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="rect" title="Прямоугольник: перетащите по диагонали">▭ Рамка</button>' +
      '    <button class="bk-g-btn bk-g-tool" id="bk-g-tool-select" data-tool="select" title="Выделение: прямоугольная область мышкой">▢ Выделение <span id="bk-g-select-reset" class="bk-g-reset-btn" title="Сбросить выделение">✕</span></button>' +
      '    <button class="bk-g-btn bk-g-tool" id="bk-g-tool-transform" data-tool="transform" title="Трансформация: масштабирование и поворот выделенной области" disabled>⤡ Трансформация</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="copy" title="Копировать выделение (Ctrl+C)">📋 Copy</button>' +
      '    <button class="bk-g-btn bk-g-tool" data-tool="paste" title="Вставить буфер (Ctrl+V)">📥 Paste</button>' +
      '  </div>' +
      '  <div class="bk-g-group">' +
      '    <button class="bk-g-btn" id="bk-g-clear" title="Очистить изображение (в чёрный)">⌦ Очистить</button>' +
      '    <button class="bk-g-btn" id="bk-g-flip-h" title="Отразить по горизонтали">⇆ Гориз.</button>' +
      '    <button class="bk-g-btn" id="bk-g-flip-v" title="Отразить по вертикали">⇅ Вертик.</button>' +
      '    <button class="bk-g-btn" id="bk-g-rotate" title="Повернуть на 90° по часовой стрелке">⟳ 90°</button>' +
      '  </div>' +
      '  <div class="bk-g-group">' +
      '    <button class="bk-g-btn" id="bk-g-undo" title="Отменить (Ctrl+Z)">↶ Отменить</button>' +
      '    <button class="bk-g-btn" id="bk-g-redo" title="Вернуть (Ctrl+Y)">↷ Вернуть</button>' +
      '  </div>' +
      '</div>' +
      '<div class="bk-g-body">' +
      '  <div class="bk-g-canvas-wrap"><canvas id="bk-g-canvas"></canvas></div>' +
      '  <div class="bk-g-side">' +
      '    <div class="bk-g-section">' +
      '      <div class="bk-g-section-title">Цвет</div>' +
      '      <div class="bk-g-colors" id="bk-g-colors"></div>' +
      '    </div>' +
      '    <div class="bk-g-section">' +
      '      <div class="bk-g-section-title">Вид</div>' +
      '      <label class="bk-g-check"><input type="checkbox" id="bk-g-grid" checked> Сетка пикселей</label>' +
      '      <div class="bk-g-zoom-row">' +
      '        <button class="bk-g-btn bk-g-zoom" id="bk-g-zoom-out" title="Уменьшить масштаб (-)">−</button>' +
      '        <label class="bk-g-field">Масштаб <select id="bk-g-zoom"></select></label>' +
      '        <button class="bk-g-btn bk-g-zoom" id="bk-g-zoom-in" title="Увеличить масштаб (+)">+</button>' +
      '      </div>' +
      '    </div>' +
      '    <div class="bk-g-section">' +
      '      <div class="bk-g-section-title">Preview 1:1</div>' +
      '      <div class="bk-g-preview-controls">' +
      '        <button class="bk-g-btn bk-g-zoom" id="bk-g-preview-zoom-out" title="Уменьшить preview (-)">−</button>' +
      '        <span class="bk-g-zoom-value" id="bk-g-preview-zoom-value">1×</span>' +
      '        <button class="bk-g-btn bk-g-zoom" id="bk-g-preview-zoom-in" title="Увеличить preview (+)">+</button>' +
      '      </div>' +
      '      <div class="bk-g-preview-wrap"><canvas id="bk-g-preview"></canvas></div>' +
      '      <div class="bk-g-anim" id="bk-g-anim" style="display:none;">' +
      '        <div class="bk-g-anim-row">' +
      '          <span class="bk-g-anim-label">Задержка (мс):</span>' +
      '          <button class="bk-g-btn bk-g-delay" data-delay="200">200</button>' +
      '          <button class="bk-g-btn bk-g-delay" data-delay="100">100</button>' +
      '          <button class="bk-g-btn bk-g-delay" data-delay="83">83</button>' +
      '          <button class="bk-g-btn bk-g-delay" data-delay="41">41</button>' +
      '          <button class="bk-g-btn bk-g-delay" data-delay="20">20</button>' +
      '        </div>' +
      '        <div class="bk-g-anim-controls">' +
      '          <button class="bk-g-btn bk-g-anim-btn" id="bk-g-anim-prev" title="Предыдущий кадр">[<<]</button>' +
      '          <button class="bk-g-btn bk-g-anim-btn" id="bk-g-anim-play" title="Воспроизведение/пауза">[PLAY/PAUSE]</button>' +
      '          <button class="bk-g-btn bk-g-anim-btn" id="bk-g-anim-next" title="Следующий кадр">[>>]</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="bk-g-section bk-g-info">' +
      '      <div>Размер: <span id="bk-g-size-info"></span></div>' +
      '      <div>Пикселей: <span id="bk-g-pixels-info"></span></div>' +
      '      <div>Данные: <span id="bk-g-bytes-info"></span></div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="bk-g-project-dialog" id="bk-g-project-dialog" style="display:none;">' +
      '  <div class="bk-g-project-title">➕ Добавить в проект</div>' +
      '  <label class="bk-g-field bk-g-proj-field">Имя ресурса <input id="bk-g-proj-name" type="text" spellcheck="false"></label>' +
      '  <label class="bk-g-field bk-g-proj-field">Папка <input id="bk-g-proj-folder" type="text" spellcheck="false"></label>' +
      '  <label class="bk-g-field bk-g-proj-field">Формат <select id="bk-g-proj-format">' +
      '    <option value="MAC">MAC (MACRO-11)</option>' +
      '    <option value="ASM">ASM</option>' +
      '  </select></label>' +
      '  <label class="bk-g-check"><input type="checkbox" id="bk-g-proj-png" checked> Сохранить PNG</label>' +
      '  <div class="bk-g-project-actions">' +
      '    <button class="bk-g-btn" id="bk-g-proj-ok">Добавить</button>' +
      '    <button class="bk-g-btn" id="bk-g-proj-cancel">Отмена</button>' +
      '  </div>' +
      '</div>' +
      '<div class="bk-g-mode-dialog" id="bk-g-mode-dialog" style="display:none;">' +
      '  <div class="bk-g-mode-title">Создать новое изображение</div>' +
      '  <button class="bk-g-btn bk-g-mode-opt" id="bk-g-mode-graphics">🖼 Режим «Графика»</button>' +
      '  <button class="bk-g-btn bk-g-mode-opt" id="bk-g-mode-sprites">🎮 Режим «Спрайты»</button>' +
      '  <button class="bk-g-btn" id="bk-g-mode-cancel">Отмена</button>' +
      '</div>' +
      '<div class="bk-g-sprite-import-dialog" id="bk-g-sprite-import-dialog" style="display:none;">' +
      '  <div class="bk-g-sprite-import-title">🎮 Импорт спрайтов из PNG (Sprite Sheet)</div>' +
      '  <div class="bk-g-sprite-import-meta" id="bk-g-sprite-import-meta"></div>' +
      '  <div class="bk-g-sprite-import-presets" id="bk-g-sprite-import-presets"></div>' +
      '  <div class="bk-g-sprite-import-fields">' +
      '    <label class="bk-g-field bk-g-sprite-import-field"><span>Ширина спрайта:</span> <input id="bk-g-sprite-import-width" type="number" min="2" max="128"></label>' +
      '    <label class="bk-g-field bk-g-sprite-import-field"><span>Высота спрайта:</span> <input id="bk-g-sprite-import-height" type="number" min="2" max="128"></label>' +
      '    <label class="bk-g-field bk-g-sprite-import-field"><span>Количество спрайтов:</span> <input id="bk-g-sprite-import-count" type="number" min="1" max="64"></label>' +
      '  </div>' +
      '  <div class="bk-g-sprite-import-info" id="bk-g-sprite-import-info"></div>' +
      '  <div class="bk-g-sprite-import-actions">' +
      '    <button class="bk-g-btn" id="bk-g-sprite-import-ok">Импортировать</button>' +
      '    <button class="bk-g-btn" id="bk-g-sprite-import-cancel">Отмена</button>' +
      '  </div>' +
      '</div>' +
      '<div class="bk-g-state-dialog" id="bk-g-state-dialog" style="display:none;">' +
      '  <div class="bk-g-dialog-title">💾 Сохранить состояние редактора (.BKGfxState)</div>' +
      '  <label class="bk-g-field bk-g-proj-field">Имя ресурса <input id="bk-g-state-name" type="text" spellcheck="false"></label>' +
      '  <label class="bk-g-field bk-g-proj-field">Папка в проекте <input id="bk-g-state-folder" type="text" value="gfx" spellcheck="false"></label>' +
      '  <div class="bk-g-state-options">' +
      '    <label class="bk-g-check"><input type="checkbox" id="bk-g-state-download" checked> Скачать файл (.BKGfxState)</label>' +
      '    <label class="bk-g-check"><input type="checkbox" id="bk-g-state-project" checked> Сохранить в проект</label>' +
      '  </div>' +
      '  <div class="bk-g-project-actions">' +
      '    <button class="bk-g-btn" id="bk-g-state-ok">Сохранить</button>' +
      '    <button class="bk-g-btn" id="bk-g-state-cancel">Отмена</button>' +
      '  </div>' +
      '</div>' +
      '<div class="bk-g-import-dialog" id="bk-g-import-dialog" style="display:none;">' +
      '  <div class="bk-g-dialog-title">📥 Импорт из проекта</div>' +
      '  <div class="bk-g-import-desc">Выберите файл экрана (.BIN, .DAT, .BKS) или состояние (.BKGfxState):</div>' +
      '  <div class="bk-g-proj-import-list" id="bk-g-proj-import-list"></div>' +
      '  <div class="bk-g-project-actions">' +
      '    <button class="bk-g-btn" id="bk-g-proj-import-ok" disabled>Загрузить в редактор</button>' +
      '    <button class="bk-g-btn" id="bk-g-proj-import-cancel">Отмена</button>' +
      '  </div>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    els.dialog = overlay.querySelector('.bk-g-dialog');
    els.canvas = overlay.querySelector('#bk-g-canvas');
    els.preview = overlay.querySelector('#bk-g-preview');
    els.colors = overlay.querySelector('#bk-g-colors');
    els.mode = overlay.querySelector('#bk-g-mode');
    els.width = overlay.querySelector('#bk-g-width');
    els.height = overlay.querySelector('#bk-g-height');
    els.applySize = overlay.querySelector('#bk-g-apply-size');
    els.paletteField = overlay.querySelector('#bk-g-palette-field');
    els.palette = overlay.querySelector('#bk-g-palette');
    els.modeLabel = overlay.querySelector('#bk-g-mode-label');
    els.dims = overlay.querySelector('#bk-g-dims');
    els.spriteDims = overlay.querySelector('#bk-g-sprite-dims');
    els.spriteWidth = overlay.querySelector('#bk-g-sprite-width');
    els.spriteHeight = overlay.querySelector('#bk-g-sprite-height');
    els.spriteCount = overlay.querySelector('#bk-g-sprite-count');
    els.anim = overlay.querySelector('#bk-g-anim');
    els.animPrev = overlay.querySelector('#bk-g-anim-prev');
    els.animPlay = overlay.querySelector('#bk-g-anim-play');
    els.animNext = overlay.querySelector('#bk-g-anim-next');
    els.delays = Array.prototype.slice.call(overlay.querySelectorAll('.bk-g-delay'));
    els.modeDialog = overlay.querySelector('#bk-g-mode-dialog');
    els.modeGraphics = overlay.querySelector('#bk-g-mode-graphics');
    els.modeSprites = overlay.querySelector('#bk-g-mode-sprites');
    els.modeCancel = overlay.querySelector('#bk-g-mode-cancel');
    els.grid = overlay.querySelector('#bk-g-grid');
    els.zoom = overlay.querySelector('#bk-g-zoom');
    els.clear = overlay.querySelector('#bk-g-clear');
    els.flipH = overlay.querySelector('#bk-g-flip-h');
    els.flipV = overlay.querySelector('#bk-g-flip-v');
    els.rotate = overlay.querySelector('#bk-g-rotate');
    els.undo = overlay.querySelector('#bk-g-undo');
    els.redo = overlay.querySelector('#bk-g-redo');
    els.sizeInfo = overlay.querySelector('#bk-g-size-info');
    els.pixelsInfo = overlay.querySelector('#bk-g-pixels-info');
    els.bytesInfo = overlay.querySelector('#bk-g-bytes-info');
    els.toolButtons = Array.prototype.slice.call(overlay.querySelectorAll('.bk-g-tool'));
    els.toolSelect = overlay.querySelector('#bk-g-tool-select');
    els.toolTransform = overlay.querySelector('#bk-g-tool-transform');
    els.selectReset = overlay.querySelector('#bk-g-select-reset');
    els.newImage = overlay.querySelector('#bk-g-new');
    els.openPng = overlay.querySelector('#bk-g-open-png');
    els.pngFile = overlay.querySelector('#bk-g-png-file');
    els.savePng = overlay.querySelector('#bk-g-save-png');
    els.export = overlay.querySelector('#bk-g-export');
    els.exportFormat = overlay.querySelector('#bk-g-export-format');
    els.zoomIn = overlay.querySelector('#bk-g-zoom-in');
    els.zoomOut = overlay.querySelector('#bk-g-zoom-out');
    els.previewZoomIn = overlay.querySelector('#bk-g-preview-zoom-in');
    els.previewZoomOut = overlay.querySelector('#bk-g-preview-zoom-out');
    els.previewZoomValue = overlay.querySelector('#bk-g-preview-zoom-value');
    els.addProject = overlay.querySelector('#bk-g-add-project');
    els.projDialog = overlay.querySelector('#bk-g-project-dialog');
    els.projName = overlay.querySelector('#bk-g-proj-name');
    els.projFolder = overlay.querySelector('#bk-g-proj-folder');
    els.projFormat = overlay.querySelector('#bk-g-proj-format');
    els.projPng = overlay.querySelector('#bk-g-proj-png');
    els.projOk = overlay.querySelector('#bk-g-proj-ok');
    els.projCancel = overlay.querySelector('#bk-g-proj-cancel');
    els.spriteImportDialog = overlay.querySelector('#bk-g-sprite-import-dialog');
    els.spriteImportMeta = overlay.querySelector('#bk-g-sprite-import-meta');
    els.spriteImportPresets = overlay.querySelector('#bk-g-sprite-import-presets');
    els.spriteImportWidth = overlay.querySelector('#bk-g-sprite-import-width');
    els.spriteImportHeight = overlay.querySelector('#bk-g-sprite-import-height');
    els.spriteImportCount = overlay.querySelector('#bk-g-sprite-import-count');
    els.spriteImportInfo = overlay.querySelector('#bk-g-sprite-import-info');
    els.spriteImportOk = overlay.querySelector('#bk-g-sprite-import-ok');
    els.spriteImportCancel = overlay.querySelector('#bk-g-sprite-import-cancel');

    els.openBin = overlay.querySelector('#bk-g-open-bin');
    els.binFile = overlay.querySelector('#bk-g-bin-file');
    els.importProject = overlay.querySelector('#bk-g-import-project');
    els.saveState = overlay.querySelector('#bk-g-save-state');
    els.loadState = overlay.querySelector('#bk-g-load-state');
    els.stateFile = overlay.querySelector('#bk-g-state-file');

    els.stateDialog = overlay.querySelector('#bk-g-state-dialog');
    els.stateName = overlay.querySelector('#bk-g-state-name');
    els.stateFolder = overlay.querySelector('#bk-g-state-folder');
    els.stateDownload = overlay.querySelector('#bk-g-state-download');
    els.stateProject = overlay.querySelector('#bk-g-state-project');
    els.stateOk = overlay.querySelector('#bk-g-state-ok');
    els.stateCancel = overlay.querySelector('#bk-g-state-cancel');

    els.importDialog = overlay.querySelector('#bk-g-import-dialog');
    els.projImportList = overlay.querySelector('#bk-g-proj-import-list');
    els.projImportOk = overlay.querySelector('#bk-g-proj-import-ok');
    els.projImportCancel = overlay.querySelector('#bk-g-proj-import-cancel');

    offscreen = document.createElement('canvas');
    offCtx = offscreen.getContext('2d');

    fillModeSelect();
    fillPaletteSelect();
    fillZoomSelect();

    overlay.querySelector('#bk-g-close').addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) {
        close();
      }
    });
    els.mode.addEventListener('change', function () {
      applyMode(els.mode.value);
    });
    els.applySize.addEventListener('click', applySize);
    [els.width, els.height].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          applySize();
        }
      });
    });
    els.palette.addEventListener('change', function () {
      state.model.setPalette(parseInt(els.palette.value, 10));
      renderAll();
    });
    els.grid.addEventListener('change', function () {
      state.showGrid = els.grid.checked;
      renderAll();
    });
    els.zoom.addEventListener('change', function () {
      state.zoom = parseInt(els.zoom.value, 10);
      renderAll();
    });
    els.toolButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tool = btn.dataset.tool;
        if (tool === 'copy') {
          // Копирование — команда: копируем выделение в буфер,
          // активный инструмент не меняется
          copySelection();
        } else {
          setTool(tool);
        }
      });
    });
    // Сброс выделения (крестик в кнопке «Выделение»)
    els.selectReset.addEventListener('click', function (e) {
      e.stopPropagation();
      resetSelection();
    });
    els.newImage.addEventListener('click', createNewImage);
    els.openPng.addEventListener('click', function () {
      els.pngFile.click();
    });
    els.pngFile.addEventListener('change', function () {
      const file = els.pngFile.files && els.pngFile.files[0];
      els.pngFile.value = '';
      if (!file) {
        return;
      }
      importPngFile(file).catch(function (err) {
        alert('Не удалось открыть PNG: ' + err.message);
      });
    });
    els.savePng.addEventListener('click', function () {
      savePngFile().catch(function (err) {
        alert('Не удалось сохранить PNG: ' + err.message);
      });
    });
    els.openBin.addEventListener('click', function () {
      els.binFile.click();
    });
    els.binFile.addEventListener('change', function () {
      const file = els.binFile.files && els.binFile.files[0];
      els.binFile.value = '';
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          importBinaryScreen(new Uint8Array(e.target.result), file.name);
        } catch (err) {
          alert('Не удалось загрузить экран БК: ' + err.message);
        }
      };
      reader.onerror = function () {
        alert('Ошибка чтения файла');
      };
      reader.readAsArrayBuffer(file);
    });
    els.saveState.addEventListener('click', openStateSaveDialog);
    els.loadState.addEventListener('click', function () {
      els.stateFile.click();
    });
    els.stateFile.addEventListener('change', function () {
      const file = els.stateFile.files && els.stateFile.files[0];
      els.stateFile.value = '';
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          importGfxState(e.target.result);
        } catch (err) {
          alert('Не удалось загрузить состояние: ' + err.message);
        }
      };
      reader.onerror = function () {
        alert('Ошибка чтения файла');
      };
      reader.readAsText(file, 'utf-8');
    });
    els.stateOk.addEventListener('click', submitStateSave);
    els.stateCancel.addEventListener('click', closeStateSaveDialog);
    [els.stateName, els.stateFolder].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitStateSave();
        }
      });
    });
    els.importProject.addEventListener('click', openProjectImportDialog);
    els.projImportOk.addEventListener('click', submitProjectImport);
    els.projImportCancel.addEventListener('click', closeProjectImportDialog);
    fillExportFormat();
    els.export.addEventListener('click', function () {
      downloadExport(els.exportFormat.value);
    });
    els.zoomIn.addEventListener('click', zoomIn);
    els.zoomOut.addEventListener('click', zoomOut);
    els.previewZoomIn.addEventListener('click', previewZoomIn);
    els.previewZoomOut.addEventListener('click', previewZoomOut);
    els.addProject.addEventListener('click', openProjectDialog);
    els.projOk.addEventListener('click', submitProjectAddition);
    els.projCancel.addEventListener('click', closeProjectDialog);
    [els.projName, els.projFolder].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitProjectAddition();
        }
      });
    });
    els.clear.addEventListener('click', function () {
      state.model.clear(0);
      pushHistory();
      renderAll();
    });
    els.flipH.addEventListener('click', function () {
      state.model.flipHorizontal();
      pushHistory();
      renderAll();
    });
    els.flipV.addEventListener('click', function () {
      state.model.flipVertical();
      pushHistory();
      renderAll();
    });
    els.rotate.addEventListener('click', function () {
      state.model.rotate90();
      pushHistory();
      renderAll();
    });
    els.undo.addEventListener('click', undo);
    els.redo.addEventListener('click', redo);

    // Спрайты: параметры
    [els.spriteWidth, els.spriteHeight, els.spriteCount].forEach(function (inp) {
      inp.addEventListener('change', applySpriteParams);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          applySpriteParams();
        }
      });
    });

    // Спрайты: анимация
    els.animPrev.addEventListener('click', animPrev);
    els.animPlay.addEventListener('click', playPause);
    els.animNext.addEventListener('click', animNext);
    els.delays.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAnimDelay(parseInt(btn.dataset.delay, 10));
      });
    });

    // Выбор режима (диалог)
    els.modeGraphics.addEventListener('click', function () { chooseMode('graphics'); });
    els.modeSprites.addEventListener('click', function () { chooseMode('sprites'); });
    els.modeCancel.addEventListener('click', cancelModeDialog);

    // Импорт Sprite Sheet (диалог)
    els.spriteImportOk.addEventListener('click', submitSpriteImport);
    els.spriteImportCancel.addEventListener('click', cancelSpriteImport);
    [els.spriteImportWidth, els.spriteImportHeight, els.spriteImportCount].forEach(function (inp) {
      inp.addEventListener('input', updateSpriteImportSummary);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSpriteImport();
        }
      });
    });

    // События рисования на главном холсте
    els.canvas.addEventListener('pointerdown', onPointerDown);
    els.canvas.addEventListener('pointermove', onPointerMove);
    els.canvas.addEventListener('pointerup', onPointerUp);
    els.canvas.addEventListener('pointercancel', onPointerUp);

    // Зум колесом мыши при удержанном Пробеле (Photoshop)
    els.canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

    // Клавиатура (только когда редактор открыт)
    document.addEventListener('keydown', onDocumentKeydown, true);
    document.addEventListener('keyup', onDocumentKeyup, true);
  }

  // =====================================================================
  // Заполнение выпадающих списков
  // =====================================================================

  /**
   * Заполняет список режимов (BKGraphicsModes).
   */
  function fillModeSelect() {
    els.mode.innerHTML = '';
    BKGraphicsModes.forEach(function (mode) {
      const opt = document.createElement('option');
      opt.value = mode.id;
      opt.textContent = mode.name + ' (' + mode.width + '×' + mode.height + ')';
      els.mode.appendChild(opt);
    });
  }

  /**
   * Заполняет список палитр БК-0011М (16 палитр, 00…15).
   */
  function fillPaletteSelect() {
    els.palette.innerHTML = '';
    const palettes = getGraphicsMode('BK0011M_COLOR').palette;
    palettes.forEach(function (_, i) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'Палитра ' + String(i).padStart(2, '0');
      els.palette.appendChild(opt);
    });
  }

  /**
   * Заполняет список масштабов.
   */
  function fillZoomSelect() {
    els.zoom.innerHTML = '';
    ZOOM_LEVELS.forEach(function (z) {
      const opt = document.createElement('option');
      opt.value = String(z);
      opt.textContent = z + '×';
      els.zoom.appendChild(opt);
    });
  }

  /**
   * Заполняет список формата экспорта в тулбаре (.ASM, .MAC, а также .BIN, .DAT, .BKS при 256x256).
   */
  function fillExportFormat() {
    if (!els.exportFormat) {
      return;
    }
    const isScreen256 = (state && state.editorMode === 'graphics' &&
      state.model.width === 256 && state.model.height === 256);
    const prev = els.exportFormat.value || 'ASM';
    els.exportFormat.innerHTML = '';
    const formats = isScreen256
      ? ['ASM', 'MAC', 'BIN', 'DAT', 'BKS']
      : ['ASM', 'MAC'];
    formats.forEach(function (fmt) {
      const opt = document.createElement('option');
      opt.value = fmt;
      opt.textContent = fmt;
      els.exportFormat.appendChild(opt);
    });
    if (formats.indexOf(prev) !== -1) {
      els.exportFormat.value = prev;
    } else {
      els.exportFormat.value = 'ASM';
    }
    if (els.openBin) {
      els.openBin.style.display = isScreen256 ? '' : 'none';
    }
  }

  // =====================================================================
  // Настройки инструментов
  // =====================================================================

  /**
   * Устанавливает активный инструмент.
   * @param {string} tool - 'pencil' | 'erase' | 'fill' | 'line' | 'rect' |
   *   'select' | 'transform' | 'copy' | 'paste'.
   */
  function setTool(tool) {
    state.tool = tool;
    els.toolButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    // Призрачный контур вставки: показываем только при активном Paste
    if (tool === 'paste' && state.clipboard) {
      startPasteGhost();
    } else {
      stopPasteGhost();
    }
    // Transform: если нет выделения — переключаемся на выделение
    if (tool === 'transform' && !state.selection) {
      setTool('select');
      return;
    }
    // Transform: инициализируем состояние при активации
    if (tool === 'transform' && state.selection && !state.transformState) {
      state.transformState = {
        sel: { x: state.selection.x, y: state.selection.y,
               w: state.selection.w, h: state.selection.h },
        scale: 1,
        rotation: 0
      };
    }
    // Transform: очищаем ghost Paste при выходе из режима
    if (tool !== 'paste') {
      state.ghostCanvas = null;
    }
    // Обновляем состояние кнопки Transform
    updateTransformButton();
    // Перерисовываем холст (для отображения маркеров трансформации)
    renderAll();
  }

  /**
   * Устанавливает выбранный индекс цвета.
   * @param {number} index - индекс цвета (0..3).
   */
  function setColor(index) {
    state.colorIndex = index;
    updateSwatchActive();
  }

  /**
   * Обновляет подсветку активного образца цвета.
   */
  function updateSwatchActive() {
    Array.prototype.forEach.call(els.colors.children, function (btn) {
      btn.classList.toggle('active', parseInt(btn.dataset.index, 10) === state.colorIndex);
    });
  }

  /**
   * Перерисовывает образцы цветов под текущую палитру модели.
   */
  function renderSwatches() {
    els.colors.innerHTML = '';
    state.model.palette.forEach(function (hex, i) {
      const btn = document.createElement('button');
      btn.className = 'bk-g-swatch';
      btn.dataset.index = String(i);
      btn.style.background = hex;
      btn.title = 'Цвет ' + i + ' (' + hex + ')';
      btn.addEventListener('click', function () {
        setColor(i);
      });
      els.colors.appendChild(btn);
    });
    updateSwatchActive();
  }

  // =====================================================================
  // Рендеринг
  // =====================================================================

  /**
   * Полный перерисовывание: холст, preview, информация, состояние кнопок.
   */
  function renderAll() {
    renderCanvas();
    renderInfo();
    updateControls();
  }

  /**
   * Рендерит изображение: offscreen (w×h) → главный холст (×zoom) + preview.
   * В режиме «Спрайты» на главном холсте рисуются границы фреймов,
   * а preview показывает текущий кадр анимации.
   */
  function renderCanvas() {
    const m = state.model;
    const z = state.zoom;

    // 1) Натуральный размер: ImageData из индексов палитры
    offscreen.width = m.width;
    offscreen.height = m.height;
    const img = new ImageData(m.width, m.height);
    const d = img.data;
    const rgb = m.palette.map(hexToRgb);
    for (let i = 0; i < m.pixels.length; i++) {
      const c = rgb[m.pixels[i]] || rgb[0];
      const o = i << 2;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);

    // 2) Главный холст: масштабирование без сглаживания
    const cw = m.width * z;
    const ch = m.height * z;
    const ctx = els.canvas.getContext('2d');
    if (els.canvas.width !== cw) { els.canvas.width = cw; }
    if (els.canvas.height !== ch) { els.canvas.height = ch; }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, cw, ch);

    // 3) Сетка пикселей (видима при масштабе >= 2)
    if (state.showGrid && z >= 2) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= m.width; x++) {
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, ch);
      }
      for (let y = 0; y <= m.height; y++) {
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(cw, y * z + 0.5);
      }
      ctx.stroke();
    }

    // 4) Границы фреймов (только в режиме «Спрайты»)
    if (state.editorMode === 'sprites') {
      drawFrameBorders(ctx, cw, ch, z);
    }

    // 5) Рамка выделения и призрачный контур вставки
    drawSelection(ctx, z);
    drawPasteGhost(ctx, z);

    // 5.5) Ghost превью трансформации (мерцающее)
    drawTransformGhost(ctx, z);

    // 5.6) Маркеры трансформации (угловые квадраты)
    if (state.tool === 'transform' && state.selection) {
      drawTransformHandles(ctx, z);
    }

    // 6) Preview
    renderPreview();
  }

  /**
   * Рисует границы фреймов на главном холсте (пунктир) и номера фреймов.
   * @param {CanvasRenderingContext2D} ctx - контекст главного холста.
   * @param {number} cw - ширина холста в пикселях экрана.
   * @param {number} ch - высота холста в пикселях экрана.
   * @param {number} z - масштаб.
   */
  function drawFrameBorders(ctx, cw, ch, z) {
    const grid = spriteGridInfo();
    const sw = grid.spriteWidth * z;
    const sh = grid.spriteHeight * z;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    for (let k = 0; k <= grid.cols; k++) {
      ctx.moveTo(k * sw + 0.5, 0);
      ctx.lineTo(k * sw + 0.5, ch);
    }
    for (let k = 0; k <= grid.rows; k++) {
      ctx.moveTo(0, k * sh + 0.5);
      ctx.lineTo(cw, k * sh + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Номера фреймов
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = 'bold ' + Math.max(10, z * 2) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let frame = 0; frame < grid.count; frame++) {
      const fx = (frame % grid.cols) * sw;
      const fy = Math.floor(frame / grid.cols) * sh;
      ctx.fillText(String(frame + 1), fx + sw / 2, fy + 2);
    }
    ctx.restore();
  }

  /**
   * Рендерит preview: в режиме «Графика» — всё изображение, в режиме
   * «Спрайты» — текущий кадр анимации.
   */
  function renderPreview() {
    const m = state.model;
    const pz = state.previewZoom;
    const pctx = els.preview.getContext('2d');
    if (state.editorMode === 'graphics') {
      const pw = m.width * pz;
      const ph = m.height * pz;
      if (els.preview.width !== pw) { els.preview.width = pw; }
      if (els.preview.height !== ph) { els.preview.height = ph; }
      pctx.imageSmoothingEnabled = false;
      pctx.drawImage(offscreen, 0, 0, pw, ph);
    } else {
      const grid = spriteGridInfo();
      const pixels = getFramePixels(state.animFrame);
      const sw = grid.spriteWidth;
      const sh = grid.spriteHeight;
      const pw = sw * pz;
      const ph = sh * pz;
      if (els.preview.width !== pw) { els.preview.width = pw; }
      if (els.preview.height !== ph) { els.preview.height = ph; }
      const img = new ImageData(sw, sh);
      const d = img.data;
      const rgb = m.palette.map(hexToRgb);
      for (let i = 0; i < sw * sh; i++) {
        const c = rgb[pixels[i]] || rgb[0];
        const o = i << 2;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
      offscreen.width = sw;
      offscreen.height = sh;
      offCtx.putImageData(img, 0, 0);
      pctx.imageSmoothingEnabled = false;
      pctx.drawImage(offscreen, 0, 0, pw, ph);
    }
  }

  /**
   * Обновляет текстовую информацию (размер, пиксели, данные).
   */
  function renderInfo() {
    const m = state.model;
    els.sizeInfo.textContent = m.width + ' × ' + m.height + ' px';
    els.pixelsInfo.textContent = m.getPixelCount().toLocaleString('ru-RU');
    els.bytesInfo.textContent = formatBytes(getDataSize());
  }

  /**
   * Синхронизирует управляющие элементы с состоянием:
   * списки, вводы, кнопки undo/redo/rotate, образцы цветов,
   * режим (графика/спрайты) и анимация.
   */
  function updateControls() {
    const m = state.model;
    const mode = getGraphicsMode(m.mode);

    if (document.activeElement !== els.mode) { els.mode.value = m.mode; }
    if (document.activeElement !== els.width) { els.width.value = m.width; }
    if (document.activeElement !== els.height) { els.height.value = m.height; }
    els.width.max = String(mode.width);
    els.height.max = String(mode.height);
    if (document.activeElement !== els.palette) { els.palette.value = String(m.paletteIndex); }
    els.paletteField.style.display = (m.mode === 'BK0011M_COLOR') ? '' : 'none';
    if (document.activeElement !== els.zoom) { els.zoom.value = String(state.zoom); }
    if (els.grid.checked !== state.showGrid) { els.grid.checked = state.showGrid; }
    els.previewZoomValue.textContent = state.previewZoom + '×';

    // Режим: переключение полей размера и блока анимации
    els.dims.style.display = (state.editorMode === 'graphics') ? '' : 'none';
    els.spriteDims.style.display = (state.editorMode === 'sprites') ? '' : 'none';
    els.anim.style.display = (state.editorMode === 'sprites') ? '' : 'none';
    if (document.activeElement !== els.spriteWidth) { els.spriteWidth.value = String(state.spriteWidth); }
    if (document.activeElement !== els.spriteHeight) { els.spriteHeight.value = String(state.spriteHeight); }
    if (document.activeElement !== els.spriteCount) { els.spriteCount.value = String(state.spriteCount); }

    // Заголовок: режим
    els.modeLabel.textContent = state.editorMode === 'graphics'
      ? ' (Режим "Графика")'
      : ' (Режим "Спрайты")';

    // Кнопки undo/redo
    els.undo.disabled = state.historyIndex <= 0;
    els.redo.disabled = state.historyIndex >= state.history.length - 1;

    // Поворот/переворот доступны только в режиме «Графика»
    const canRotate = (state.editorMode === 'graphics') && m.height <= mode.width && m.width <= mode.height;
    els.rotate.disabled = !canRotate;
    els.rotate.title = canRotate
      ? 'Повернуть на 90° по часовой стрелке'
      : 'Недоступно: после поворота изображение не влезает в режим ' + mode.name;
    els.flipH.disabled = (state.editorMode === 'sprites');
    els.flipV.disabled = (state.editorMode === 'sprites');

    updateAnimControls();
    renderSwatches();
    fillExportFormat();
  }

  /**
   * Индекс текущего масштаба в списке ZOOM_LEVELS.
   * @returns {number} индекс (0, если масштаб не найден).
   */
  function zoomIndex() {
    const i = ZOOM_LEVELS.indexOf(state.zoom);
    return i >= 0 ? i : 0;
  }

  /**
   * Увеличивает масштаб главного холста на один уровень.
   */
  function zoomIn() {
    const i = zoomIndex();
    if (i >= ZOOM_LEVELS.length - 1) {
      return;
    }
    state.zoom = ZOOM_LEVELS[i + 1];
    renderAll();
  }

  /**
   * Уменьшает масштаб главного холста на один уровень.
   */
  function zoomOut() {
    const i = zoomIndex();
    if (i <= 0) {
      return;
    }
    state.zoom = ZOOM_LEVELS[i - 1];
    renderAll();
  }

  /**
   * Увеличивает масштаб preview на один уровень.
   */
  function previewZoomIn() {
    const i = ZOOM_LEVELS.indexOf(state.previewZoom);
    const idx = i >= 0 ? i : 0;
    if (idx >= ZOOM_LEVELS.length - 1) {
      return;
    }
    state.previewZoom = ZOOM_LEVELS[idx + 1];
    renderAll();
  }

  /**
   * Уменьшает масштаб preview на один уровень.
   */
  function previewZoomOut() {
    const i = ZOOM_LEVELS.indexOf(state.previewZoom);
    const idx = i >= 0 ? i : 0;
    if (idx <= 0) {
      return;
    }
    state.previewZoom = ZOOM_LEVELS[idx - 1];
    renderAll();
  }

  /**
   * Обновляет кнопки анимации (текст play/pause, активная задержка).
   */
  function updateAnimControls() {
    els.animPlay.textContent = state.animPlaying ? '[PAUSE]' : '[PLAY/PAUSE]';
    els.animPlay.title = state.animPlaying ? 'Пауза' : 'Воспроизведение';
    els.animPrev.disabled = state.spriteCount <= 1;
    els.animNext.disabled = state.spriteCount <= 1;
    els.delays.forEach(function (btn) {
      btn.classList.toggle('active', parseInt(btn.dataset.delay, 10) === state.animDelay);
    });
  }

  /**
   * Запускает анимацию (цикл по фреймам с заданной задержкой).
   */
  function startAnimation() {
    stopAnimation();
    state.animPlaying = true;
    state.animTimer = setInterval(function () {
      state.animFrame = (state.animFrame + 1) % state.spriteCount;
      renderPreview();
      updateAnimControls();
    }, state.animDelay);
  }

  /**
   * Останавливает анимацию.
   */
  function stopAnimation() {
    if (state.animTimer) {
      clearInterval(state.animTimer);
      state.animTimer = null;
    }
    state.animPlaying = false;
  }

  /**
   * Переключает воспроизведение/паузу.
   */
  function playPause() {
    if (state.animPlaying) {
      stopAnimation();
    } else {
      startAnimation();
    }
    updateAnimControls();
  }

  /**
   * Предыдущий кадр.
   */
  function animPrev() {
    if (state.spriteCount <= 1) {
      return;
    }
    state.animFrame = (state.animFrame - 1 + state.spriteCount) % state.spriteCount;
    renderPreview();
    updateAnimControls();
  }

  /**
   * Следующий кадр.
   */
  function animNext() {
    if (state.spriteCount <= 1) {
      return;
    }
    state.animFrame = (state.animFrame + 1) % state.spriteCount;
    renderPreview();
    updateAnimControls();
  }

  /**
   * Устанавливает задержку анимации и перезапускает её, если идёт.
   * @param {number} delay - задержка в мс.
   */
  function setAnimDelay(delay) {
    state.animDelay = delay;
    if (state.animPlaying) {
      startAnimation();
    }
    updateAnimControls();
  }

  // =====================================================================
  // Смена режима и размера
  // =====================================================================

  /**
   * Применяет новый режим: создаёт новую модель того же (ограниченного)
   * размера, копирует пересекающиеся пиксели, индексы вне палитры
   * нового режима обрезаются до допустимых.
   * @param {string} modeId - id режима.
   */
  function applyMode(modeId) {
    const oldModel = state.model;
    const mode = getGraphicsMode(modeId);
    const opts = { mode: modeId };
    if (modeId === 'BK0011M_COLOR') {
      opts.paletteIndex = oldModel.paletteIndex;
    }
    let w, h;
    if (state.editorMode === 'graphics') {
      w = Math.min(oldModel.width, mode.width);
      h = Math.min(oldModel.height, mode.height);
    } else {
      const grid = getSpriteGrid(state.spriteCount);
      const maxSw = Math.floor(mode.width / grid.cols);
      const maxSh = Math.floor(mode.height / grid.rows);
      const sw = Math.max(2, Math.min(state.spriteWidth, maxSw));
      const sh = Math.max(2, Math.min(state.spriteHeight, maxSh));
      state.spriteWidth = sw;
      state.spriteHeight = sh;
      w = sw * grid.cols;
      h = sh * grid.rows;
    }
    opts.width = w;
    opts.height = h;
    const newModel = new BKGraphicsModel(opts);

    // Копируем пересечение, обрезая индексы под количество цветов режима
    const cw = Math.min(w, oldModel.width);
    const ch = Math.min(h, oldModel.height);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const v = oldModel.pixels[y * oldModel.width + x];
        newModel.pixels[y * w + x] = Math.min(v, mode.colors - 1);
      }
    }

    state.model = newModel;
    state.colorIndex = Math.min(state.colorIndex, mode.colors - 1);
    resetHistory();
    renderAll();
  }

  /**
   * Применяет размер из полей ввода (с ограничением режима).
   */
  function applySize() {
    const mode = getGraphicsMode(state.model.mode);
    const w = clampInt(els.width.value, 1, mode.width);
    const h = clampInt(els.height.value, 1, mode.height);
    els.width.value = String(w);
    els.height.value = String(h);
    if (w === state.model.width && h === state.model.height) {
      return;
    }
    state.model.resize(w, h);
    pushHistory();
    renderAll();
  }

  /**
   * Применяет параметры спрайтов: пересчитывает сетку и размер листа,
   * при необходимости изменяет размер модели (с сохранением пикселей в
   * пересечении).
   */
  function applySpriteParams() {
    const m = state.model;
    const mode = getGraphicsMode(m.mode);
    const count = clampInt(els.spriteCount.value, 1, 64);
    const grid = getSpriteGrid(count);
    const maxSw = Math.floor(mode.width / grid.cols);
    const maxSh = Math.floor(mode.height / grid.rows);
    const sw = Math.max(2, Math.min(clampInt(els.spriteWidth.value, 2, 128), maxSw));
    const sh = Math.max(2, Math.min(clampInt(els.spriteHeight.value, 2, 128), maxSh));
    els.spriteWidth.value = String(sw);
    els.spriteHeight.value = String(sh);
    els.spriteCount.value = String(count);
    state.spriteWidth = sw;
    state.spriteHeight = sh;
    state.spriteCount = count;
    if (state.animFrame >= count) {
      state.animFrame = 0;
    }
    const newW = sw * grid.cols;
    const newH = sh * grid.rows;
    if (newW !== m.width || newH !== m.height) {
      m.resize(newW, newH);
      pushHistory();
    }
    renderAll();
  }

  // =====================================================================
  // Рисование: события указателя
  // =====================================================================

  /**
   * Пиксельные координаты под указателем (с учётом рамки холста 1px).
   * @param {PointerEvent} e - событие мыши.
   * @returns {?{x: number, y: number}} точка или null вне холста.
   */
  function getPixelAt(e) {
    const m = state.model;
    const rect = els.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - 1) * (m.width / (rect.width - 2)));
    const y = Math.floor((e.clientY - rect.top - 1) * (m.height / (rect.height - 2)));
    if (x < 0 || x >= m.width || y < 0 || y >= m.height) {
      return null;
    }
    return { x: x, y: y };
  }

  /**
   * Начало штриха.
   * @param {PointerEvent} e - событие.
   */
  function onPointerDown(e) {
    if (e.button !== 0 || !isOpen()) {
      return;
    }
    const p = getPixelAt(e);
    if (!p) {
      return;
    }
    e.preventDefault();
    els.canvas.setPointerCapture(e.pointerId);

    // Снимок "до" уже есть в истории (history[historyIndex]) —
    // для line/rect используем его как основу для предпросмотра
    state.drawing = {
      tool: state.tool,
      start: p,
      pre: state.history[state.historyIndex]
    };

    const m = state.model;

    // Transform: проверка попадания в маркер
    if (state.tool === 'transform' && state.selection) {
      const handle = hitTestTransformHandle(p.x, p.y);
      if (handle) {
        state.transformHandle = handle;
        // Запоминаем начальную позицию мыши и состояние трансформации
        state.transformStart = {
          mx: p.x,
          my: p.y,
          scale: state.transformState.scale,
          rotation: state.transformState.rotation
        };
        // Ghost превью рисуется всегда при активном Transform
        return;
      }
      // Клик вне маркера — отмена трансформации
      cancelTransform();
      return;
    }

    if (state.tool === 'pencil') {
      m.setPixel(p.x, p.y, state.colorIndex);
      renderAll();
    } else if (state.tool === 'erase') {
      m.setPixel(p.x, p.y, 0);
      renderAll();
    } else if (state.tool === 'fill') {
      state.drawing = null;
      if (floodFill(p.x, p.y, state.colorIndex)) {
        pushHistory();
        renderAll();
      }
    } else if (state.tool === 'select') {
      // Выделение: предпросмотр появится при перемещении
      state.drawing.rect = { x: p.x, y: p.y, w: 1, h: 1 };
      renderCanvas();
    } else if (state.tool === 'paste') {
      // Вставка: фиксируем содержимое буфера в точке клика
      state.drawing = null;
      state.pastePos = p;
      pasteAt(p.x, p.y);
    }
    // line/rect: предпросмотр появится при перемещении
  }

  /**
   * Перемещение указателя во время штриха.
   * @param {PointerEvent} e - событие.
   */
  function onPointerMove(e) {
    if (!isOpen()) {
      return;
    }
    const p = getPixelAt(e);
    if (!p) {
      return;
    }
    // Последняя позиция мыши (для Ctrl+V)
    state.lastMousePos = p;

    // Инструмент Paste: призрачный контур следует за мышью
    if (state.tool === 'paste') {
      state.pastePos = p;
      renderCanvas();
      return;
    }

    // Transform: перетаскивание маркера — масштабирование и поворот
    if (state.tool === 'transform' && state.transformHandle && state.transformStart) {
      const start = state.transformStart;
      const sel = state.selection;
      // Фиксированный центр выделения (НЕ меняется!)
      const cx = sel.x + sel.w / 2;
      const cy = sel.y + sel.h / 2;
      // Угловая точка (зависит от маркера)
      const cornerMap = {
        tl: { x: sel.x, y: sel.y },
        tr: { x: sel.x + sel.w, y: sel.y },
        bl: { x: sel.x, y: sel.y + sel.h },
        br: { x: sel.x + sel.w, y: sel.y + sel.h }
      };
      const corner = cornerMap[state.transformHandle];
      // Вектор от фиксированного центра к начальной позиции мыши
      const dx0 = start.mx - cx;
      const dy0 = start.my - cy;
      const dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      // Вектор от фиксированного центра к текущей позиции мыши
      const dx1 = p.x - cx;
      const dy1 = p.y - cy;
      const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      // Масштаб: отношение текущей дистанции к начальной (относительно центра)
      let newScale = dist1 / dist0;
      // Ограничиваем масштаб
      if (newScale < 0.1) {
        newScale = 0.1;
      }
      if (newScale > 5) {
        newScale = 5;
      }
      // Поворот: разница углов относительно фиксированного центра
      const angle0 = Math.atan2(dy0, dx0);
      const angle1 = Math.atan2(dy1, dx1);
      let newRotation = angle1 - angle0;
      // Нормализуем угол
      while (newRotation > Math.PI) {
        newRotation -= 2 * Math.PI;
      }
      while (newRotation < -Math.PI) {
        newRotation += 2 * Math.PI;
      }
      state.transformState.scale = newScale;
      state.transformState.rotation = newRotation;
      console.log('[Transform] scale:', newScale.toFixed(2), 'rotation:', newRotation.toFixed(2), 'sel:', sel.w, 'x', sel.h);
      renderCanvas();
      return;
    }

    if (!state.drawing) {
      return;
    }
    const m = state.model;
    const d = state.drawing;

    if (d.tool === 'pencil') {
      m.setPixel(p.x, p.y, state.colorIndex);
      renderCanvas();
    } else if (d.tool === 'erase') {
      m.setPixel(p.x, p.y, 0);
      renderCanvas();
    } else if (d.tool === 'line') {
      // Восстанавливаем "до" и рисуем линию от старта до текущей точки
      m.pixels = Array.from(d.pre.pixels);
      drawLine(d.start.x, d.start.y, p.x, p.y, state.colorIndex);
      renderCanvas();
    } else if (d.tool === 'rect') {
      m.pixels = Array.from(d.pre.pixels);
      drawRectOutline(d.start.x, d.start.y, p.x, p.y, state.colorIndex);
      renderCanvas();
    } else if (d.tool === 'select') {
      // Выделение: обновляем предпросмотр рамки
      const x = Math.min(d.start.x, p.x);
      const y = Math.min(d.start.y, p.y);
      const w = Math.abs(p.x - d.start.x) + 1;
      const h = Math.abs(p.y - d.start.y) + 1;
      d.rect = { x: x, y: y, w: w, h: h };
      renderCanvas();
    }
  }

  /**
   * Окончание штриха.
   * @param {PointerEvent} e - событие.
   */
  function onPointerUp(e) {
    if (!state.drawing) {
      return;
    }
    try {
      els.canvas.releasePointerCapture(e.pointerId);
    } catch (err) {
      // захват уже снят — не критично
    }
    const d = state.drawing;
    const hadStroke = (d.tool === 'pencil') ||
      (d.tool === 'erase') ||
      (d.tool === 'line') ||
      (d.tool === 'rect');
    // Transform: применяем трансформацию к пикселям
    if (state.tool === 'transform' && state.transformHandle) {
      applyTransform();
      state.transformHandle = null;
      state.transformStart = null;
      renderAll();
      return;
    }
    // Выделение: фиксируем область
    if (d.tool === 'select' && d.rect) {
      state.selection = { x: d.rect.x, y: d.rect.y, w: d.rect.w, h: d.rect.h };
      updateTransformButton();
    }
    state.drawing = null;
    if (hadStroke) {
      pushHistory();
    }
    renderAll();
  }

  // =====================================================================
  // Клавиатура
  // =====================================================================

  /**
   * Обработчик клавиатуры (capture): работает только при открытом редакторе.
   * Esc — закрыть; Ctrl+Z — отменить; Ctrl+Y / Ctrl+Shift+Z — повторить;
   * Пробел (удерживать) + колесо мыши — зум (Photoshop);
   * Ctrl+= / Ctrl+- — зум.
   * @param {KeyboardEvent} e - событие.
   */
  function onDocumentKeydown(e) {
    if (!isOpen()) {
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (els.modeDialog && els.modeDialog.style.display === 'flex') {
        cancelModeDialog();
      } else if (els.stateDialog && els.stateDialog.style.display === 'flex') {
        closeStateSaveDialog();
      } else if (els.importDialog && els.importDialog.style.display === 'flex') {
        closeProjectImportDialog();
      } else if (els.projDialog && els.projDialog.style.display === 'flex') {
        closeProjectDialog();
      } else if (els.spriteImportDialog && els.spriteImportDialog.style.display === 'flex') {
        cancelSpriteImport();
      } else if (state.tool === 'transform') {
        // Отмена трансформации
        cancelTransform();
      } else if (state.tool === 'paste') {
        // Выход из режима вставки
        setTool('pencil');
      } else if (state.tool === 'select' && state.drawing) {
        // Отмена выделения в процессе
        state.drawing = null;
        renderAll();
      } else {
        close();
      }
      return;
    }
    // Пробел: удержание для зума колесом мыши (как в Photoshop).
    if (e.code === 'Space') {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        return;
      }
      spaceHeld = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) {
      return;
    }
    if (e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      undo();
    } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      redo();
    } else if (e.code === 'Equals') {
      e.preventDefault();
      e.stopPropagation();
      zoomIn();
    } else if (e.code === 'Minus') {
      e.preventDefault();
      e.stopPropagation();
      zoomOut();
    } else if (e.code === 'KeyC') {
      // Копирование выделенной области в буфер
      e.preventDefault();
      e.stopPropagation();
      copySelection();
    } else if (e.code === 'KeyV') {
      // Вставка буфера в позицию курсора мыши (верхний левый угол)
      e.preventDefault();
      e.stopPropagation();
      const pos = state.lastMousePos || { x: 0, y: 0 };
      pasteAt(pos.x, pos.y);
    } else if (e.code === 'KeyT') {
      // Трансформация: активируем если есть выделение
      e.preventDefault();
      e.stopPropagation();
      if (state.selection) {
        setTool('transform');
      }
    }
  }

  /**
   * Снятие удержания Пробела (сброс зума колесом).
   * @param {KeyboardEvent} e - событие.
   */
  function onDocumentKeyup(e) {
    if (e.code === 'Space') {
      spaceHeld = false;
    }
  }

  /**
   * Зум колесом мыши при удержанном Пробеле (как в Photoshop).
   * @param {WheelEvent} e - событие.
   */
  function onCanvasWheel(e) {
    if (!spaceHeld) {
      return;
    }
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  }

  // =====================================================================
  // Файловые операции: New / Open PNG / Save PNG / Export / Project
  // =====================================================================

  /**
   * Базовое имя файла для экспорта (без расширения).
   * @param {BKGraphicsModel} m - модель изображения.
   * @returns {string} имя: model.name или 'bk-image-ШxВ'.
   */
  function baseFileName(m) {
    const name = String(m.name || '').trim().replace(/\.[a-z0-9]+$/i, '');
    return name || ('bk-image-' + m.width + 'x' + m.height);
  }

  /**
   * Скачивает Blob в файл через временную ссылку.
   * @param {Blob} blob - данные для скачивания.
   * @param {string} filename - имя файла.
   */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /**
   * Открывает диалог выбора режима (графика/спрайты) для создания
   * нового изображения.
   */
  function createNewImage() {
    if (!state) {
      return;
    }
    openModeDialog();
  }

  /**
   * Строит новое изображение в заданном режиме (графика/спрайты).
   * @param {string} editorMode - 'graphics' | 'sprites'.
   */
  function buildNewModel(editorMode) {
    const m = state.model;
    const modeId = els.mode.value;
    const mode = getGraphicsMode(modeId);
    const opts = { mode: modeId };
    if (modeId === 'BK0011M_COLOR') {
      opts.paletteIndex = m.paletteIndex;
    }
    if (editorMode === 'graphics') {
      const w = clampInt(els.width.value, 1, mode.width);
      const h = clampInt(els.height.value, 1, mode.height);
      els.width.value = String(w);
      els.height.value = String(h);
      opts.width = w;
      opts.height = h;
    } else {
      const grid = getSpriteGrid(state.spriteCount);
      const maxSw = Math.floor(mode.width / grid.cols);
      const maxSh = Math.floor(mode.height / grid.rows);
      const sw = Math.max(2, Math.min(state.spriteWidth, maxSw));
      const sh = Math.max(2, Math.min(state.spriteHeight, maxSh));
      els.spriteWidth.value = String(sw);
      els.spriteHeight.value = String(sh);
      state.spriteWidth = sw;
      state.spriteHeight = sh;
      opts.width = sw * grid.cols;
      opts.height = sh * grid.rows;
    }
    return new BKGraphicsModel(opts);
  }

  /**
   * Создаёт новое изображение в выбранном режиме и сбрасывает состояние.
   * @param {string} editorMode - 'graphics' | 'sprites'.
   */
  function createNewModelForMode(editorMode) {
    state.model = buildNewModel(editorMode);
    state.colorIndex = Math.min(state.colorIndex, state.model.maxColors - 1);
    state.animFrame = 0;
    state.drawing = null;
    stopAnimation();
    resetHistory();
    renderAll();
  }

  /**
   * Открывает диалог выбора режима.
   */
  function openModeDialog() {
    els.modeDialog.style.display = 'flex';
  }

  /**
   * Выбирает режим и создаёт новое изображение.
   * @param {string} editorMode - 'graphics' | 'sprites'.
   */
  function chooseMode(editorMode) {
    state.editorMode = editorMode;
    createNewModelForMode(editorMode);
    els.modeDialog.style.display = 'none';
  }

  /**
   * Закрывает диалог выбора режима без изменений.
   */
  function cancelModeDialog() {
    els.modeDialog.style.display = 'none';
  }

  /**
   * Создаёт новое изображение в режиме «Спрайты» (без диалога).
   * Используется из публичного API (createSprite).
   */
  function createNewSprite() {
    if (!state) {
      return;
    }
    state.editorMode = 'sprites';
    createNewModelForMode('sprites');
  }

  let pendingSpriteImport = null;

  /**
   * Вычисляет варианты конфигурации фреймов спрайтов на основе размеров PNG
   * и доступных функций сетки (getSpriteGrid).
   * @param {number} pngW - ширина PNG в пикселях.
   * @param {number} pngH - высота PNG в пикселях.
   * @returns {Array<Object>} список вариантов { sw, sh, count, label, cols, rows, grid }.
   */
  function suggestSpriteConfigurations(pngW, pngH) {
    const mode = getGraphicsMode(state.model.mode);
    const configs = [];
    const seen = new Set();

    const candidateSizes = [
      { w: state.spriteWidth, h: state.spriteHeight },
      { w: 16, h: 16 },
      { w: 8, h: 8 },
      { w: 24, h: 24 },
      { w: 32, h: 32 },
      { w: 48, h: 48 },
      { w: 64, h: 64 }
    ];

    [8, 16, 24, 32, 48, 64].forEach(function (s) {
      if (pngW % s === 0 && pngH % s === 0) {
        candidateSizes.push({ w: s, h: s });
      }
      if (pngW % (s + 2) === 0 && pngH % (s + 2) === 0) {
        candidateSizes.push({ w: s, h: s });
      }
    });

    candidateSizes.forEach(function (cand) {
      const sw = cand.w;
      const sh = cand.h;
      if (!sw || !sh || sw < 2 || sh < 2 || sw > 128 || sh > 128) {
        return;
      }
      let stepX = sw;
      let stepY = sh;
      if (pngW % (sw + 2) === 0 && pngH % (sh + 2) === 0 && (pngW % sw !== 0 || pngH % sh !== 0)) {
        stepX = sw + 2;
        stepY = sh + 2;
      }
      const cols = Math.floor(pngW / stepX);
      const rows = Math.floor(pngH / stepY);
      const total = cols * rows;
      if (total < 1) {
        return;
      }

      const countVariants = [total];
      if (state.spriteCount > 0 && state.spriteCount < total) {
        countVariants.push(state.spriteCount);
      }
      if (total > 8 && !countVariants.includes(8)) {
        countVariants.push(8);
      }

      countVariants.forEach(function (cnt) {
        const grid = getSpriteGrid(cnt);
        if (sw * grid.cols <= mode.width && sh * grid.rows <= mode.height) {
          const key = sw + 'x' + sh + ':' + cnt;
          if (!seen.has(key)) {
            seen.add(key);
            configs.push({
              sw: sw,
              sh: sh,
              count: cnt,
              cols: cols,
              rows: rows,
              totalInFile: total,
              grid: grid,
              label: sw + '×' + sh + ' (' + cnt + ' шт)'
            });
          }
        }
      });
    });

    return configs.slice(0, 6);
  }

  /**
   * Обновляет динамическую сводку и валидацию в диалоге импорта спрайтов.
   */
  function updateSpriteImportSummary() {
    if (!pendingSpriteImport || !els.spriteImportInfo) {
      return;
    }
    const pngResult = pendingSpriteImport.result;
    const sw = clampInt(els.spriteImportWidth.value, 2, 128);
    const sh = clampInt(els.spriteImportHeight.value, 2, 128);
    const count = clampInt(els.spriteImportCount.value, 1, 64);

    let stepX = sw;
    let stepY = sh;
    let hasBorder = false;
    if (pngResult.width % (sw + 2) === 0 && pngResult.height % (sh + 2) === 0 &&
        (pngResult.width % sw !== 0 || pngResult.height % sh !== 0)) {
      stepX = sw + 2;
      stepY = sh + 2;
      hasBorder = true;
    }

    const pngCols = Math.max(1, Math.floor(pngResult.width / stepX));
    const pngRows = Math.max(1, Math.floor(pngResult.height / stepY));
    const maxInFile = pngCols * pngRows;

    const grid = getSpriteGrid(count);
    const totalW = sw * grid.cols;
    const totalH = sh * grid.rows;
    const mode = getGraphicsMode(state.model.mode);

    const fits = (totalW <= mode.width && totalH <= mode.height);

    let html = '<div>В файле: ' + pngCols + ' × ' + pngRows + ' фреймов (всего: ' + maxInFile +
      (hasBorder ? ', рамка 2px' : '') + ')</div>' +
      '<div>Сетка БК: ' + grid.cols + ' × ' + grid.rows + ' (размер листа ' + totalW + ' × ' + totalH + ' px)</div>';

    if (count > maxInFile) {
      html += '<div class="bk-g-warn">⚠ В файле найдено только ' + maxInFile + ' фреймов, остальные будут пустыми</div>';
    }
    if (!fits) {
      html += '<div class="bk-g-warn">⚠ Лист ' + totalW + '×' + totalH + ' превышает экран режима ' + mode.name + ' (' + mode.width + '×' + mode.height + ')</div>';
      els.spriteImportOk.disabled = true;
    } else {
      els.spriteImportOk.disabled = false;
    }

    els.spriteImportInfo.innerHTML = html;
  }

  /**
   * Открывает диалог настройки импорта Sprite Sheet.
   * @param {Object} result - результат BKGraphicsPng.importFromPng.
   * @param {Function} resolve - callback завершения Promise.
   * @param {Function} reject - callback ошибки Promise.
   */
  function openSpriteImportDialog(result, resolve, reject) {
    pendingSpriteImport = {
      result: result,
      resolve: resolve,
      reject: reject
    };

    els.spriteImportMeta.textContent = 'Размер PNG: ' + result.width + ' × ' + result.height + ' px';

    els.spriteImportPresets.innerHTML = '';
    const configs = suggestSpriteConfigurations(result.width, result.height);

    let initialSw = state.spriteWidth;
    let initialSh = state.spriteHeight;
    let initialCount = state.spriteCount;

    if (configs.length > 0) {
      initialSw = configs[0].sw;
      initialSh = configs[0].sh;
      initialCount = configs[0].count;

      configs.forEach(function (cfg, idx) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bk-g-sprite-import-preset-btn' + (idx === 0 ? ' active' : '');
        btn.textContent = cfg.label;
        btn.title = 'Кадр ' + cfg.sw + '×' + cfg.sh + ', сетка БК ' + cfg.grid.cols + '×' + cfg.grid.rows;
        btn.addEventListener('click', function () {
          els.spriteImportWidth.value = String(cfg.sw);
          els.spriteImportHeight.value = String(cfg.sh);
          els.spriteImportCount.value = String(cfg.count);
          const allBtns = els.spriteImportPresets.querySelectorAll('.bk-g-sprite-import-preset-btn');
          for (let i = 0; i < allBtns.length; i++) {
            allBtns[i].classList.remove('active');
          }
          btn.classList.add('active');
          updateSpriteImportSummary();
        });
        els.spriteImportPresets.appendChild(btn);
      });
    }

    els.spriteImportWidth.value = String(initialSw);
    els.spriteImportHeight.value = String(initialSh);
    els.spriteImportCount.value = String(initialCount);

    updateSpriteImportSummary();
    els.spriteImportDialog.style.display = 'flex';
    els.spriteImportWidth.focus();
  }

  /**
   * Закрывает диалог импорта спрайтов без применения.
   */
  function cancelSpriteImport() {
    if (els.spriteImportDialog) {
      els.spriteImportDialog.style.display = 'none';
    }
    if (pendingSpriteImport) {
      const resolve = pendingSpriteImport.resolve;
      pendingSpriteImport = null;
      if (resolve) {
        resolve();
      }
    }
  }

  /**
   * Подтверждает параметры импорта спрайтов из диалога.
   */
  function submitSpriteImport() {
    if (!pendingSpriteImport) {
      return;
    }
    const sw = clampInt(els.spriteImportWidth.value, 2, 128);
    const sh = clampInt(els.spriteImportHeight.value, 2, 128);
    const count = clampInt(els.spriteImportCount.value, 1, 64);
    const mode = getGraphicsMode(state.model.mode);
    const grid = getSpriteGrid(count);
    if (sw * grid.cols > mode.width || sh * grid.rows > mode.height) {
      alert('Лист ' + (sw * grid.cols) + '×' + (sh * grid.rows) +
        ' превышает экран режима ' + mode.name + ' (' + mode.width + '×' + mode.height + ')');
      return;
    }

    const res = pendingSpriteImport.result;
    const resolve = pendingSpriteImport.resolve;
    pendingSpriteImport = null;
    els.spriteImportDialog.style.display = 'none';

    applySpriteSheetImport(res, sw, sh, count);
    if (resolve) {
      resolve();
    }
  }

  /**
   * Применяет импорт спрайтшита: нарезает фреймы и размещает их в модели по сетке БК.
   * @param {Object} result - результат импорта PNG.
   * @param {number} sw - ширина спрайта.
   * @param {number} sh - высота спрайта.
   * @param {number} count - количество спрайтов.
   */
  function applySpriteSheetImport(result, sw, sh, count) {
    const m = state.model;
    const mode = getGraphicsMode(m.mode);
    const grid = getSpriteGrid(count);

    let stepX = sw;
    let stepY = sh;
    if (result.width % (sw + 2) === 0 && result.height % (sh + 2) === 0 &&
        (result.width % sw !== 0 || result.height % sh !== 0)) {
      stepX = sw + 2;
      stepY = sh + 2;
    }
    const pngCols = Math.max(1, Math.floor(result.width / stepX));

    const totalW = sw * grid.cols;
    const totalH = sh * grid.rows;

    const opts = { mode: m.mode, width: totalW, height: totalH };
    if (m.mode === 'BK0011M_COLOR') {
      opts.paletteIndex = m.paletteIndex;
    }
    const newModel = new BKGraphicsModel(opts);

    for (let frame = 0; frame < count; frame++) {
      const srcCol = frame % pngCols;
      const srcRow = Math.floor(frame / pngCols);
      const srcFx = srcCol * stepX;
      const srcFy = srcRow * stepY;

      const dstCol = frame % grid.cols;
      const dstRow = Math.floor(frame / grid.cols);
      const dstFx = dstCol * sw;
      const dstFy = dstRow * sh;

      for (let y = 0; y < sh; y++) {
        const srcY = srcFy + y;
        if (srcY >= result.height) {
          continue;
        }
        for (let x = 0; x < sw; x++) {
          const srcX = srcFx + x;
          if (srcX >= result.width) {
            continue;
          }
          const colorIdx = result.pixels[srcY * result.width + srcX];
          newModel.pixels[(dstFy + y) * totalW + (dstFx + x)] = colorIdx;
        }
      }
    }

    state.spriteWidth = sw;
    state.spriteHeight = sh;
    state.spriteCount = count;
    state.animFrame = 0;

    els.spriteWidth.value = String(sw);
    els.spriteHeight.value = String(sh);
    els.spriteCount.value = String(count);

    state.model = newModel;
    state.colorIndex = Math.min(state.colorIndex, newModel.maxColors - 1);
    state.drawing = null;
    stopAnimation();
    resetHistory();
    renderAll();

    const notes = [];
    if (result.info && result.info.convertedColors > 0) {
      notes.push(BKGraphicsPng.formatConversionInfo(result.info));
    }
    if (notes.length > 0 && typeof alert === 'function') {
      alert('Импорт Sprite Sheet:\n\n' + notes.join('\n'));
    }
  }

  /**
   * Импортирует PNG-файл:
   * - в режиме «Графика»: квантизирует в палитру текущего режима и заменяет
   *   текущее изображение (размер — не больше максимума режима);
   * - в режиме «Спрайты»: импортирует Sprite Sheet с разбиением на фреймы.
   *   Запрашивает у пользователя (или берёт из options) ширину, высоту спрайта
   *   и их количество, затем правильно формирует сетку фреймов в модели.
   *
   * @param {File|Blob} file - файл PNG.
   * @param {Object} [options] - параметры импорта (для спрайтов):
   *   { spriteWidth, spriteHeight, spriteCount }.
   * @returns {Promise<void>} завершается после загрузки изображения.
   */
  function importPngFile(file, options) {
    if (!state) {
      return Promise.reject(new Error('редактор не открыт'));
    }
    if (typeof BKGraphicsPng === 'undefined') {
      return Promise.reject(new Error('модуль bk-graphics-png.js не загружен'));
    }
    const m = state.model;
    return BKGraphicsPng.importFromPng(file, m.palette).then(function (result) {
      if (state.editorMode === 'sprites') {
        if (options && options.spriteWidth && options.spriteHeight && options.spriteCount) {
          applySpriteSheetImport(
            result,
            clampInt(options.spriteWidth, 2, 128),
            clampInt(options.spriteHeight, 2, 128),
            clampInt(options.spriteCount, 1, 64)
          );
          return;
        }
        return new Promise(function (resolve, reject) {
          openSpriteImportDialog(result, resolve, reject);
        });
      }

      const mode = getGraphicsMode(m.mode);
      const w = Math.min(result.width, mode.width);
      const h = Math.min(result.height, mode.height);
      const opts = { mode: m.mode, width: w, height: h };
      if (m.mode === 'BK0011M_COLOR') {
        opts.paletteIndex = m.paletteIndex;
      }
      const newModel = new BKGraphicsModel(opts);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          newModel.pixels[y * w + x] = result.pixels[y * result.width + x];
        }
      }
      state.model = newModel;
      state.colorIndex = Math.min(state.colorIndex, newModel.maxColors - 1);
      state.drawing = null;
      resetHistory();
      renderAll();
      const notes = [];
      if (result.width > mode.width || result.height > mode.height) {
        notes.push('Изображение уменьшено до ' + w + '×' + h +
          ' (максимальный размер режима ' + mode.name + ')');
      }
      if (result.info && result.info.convertedColors > 0) {
        notes.push(BKGraphicsPng.formatConversionInfo(result.info));
      }
      if (notes.length > 0 && typeof alert === 'function') {
        alert('Open PNG:\n\n' + notes.join('\n'));
      }
    });
  }

  /**
   * Экспортирует лист спрайтов в PNG (превью): сетка фреймов с
   * рамками и номерами.
   * @returns {Promise<Blob>} PNG-файл.
   */
  function exportSpriteSheetPng() {
    const m = state.model;
    const grid = spriteGridInfo();
    const border = 2;
    const cellW = grid.spriteWidth + border;
    const cellH = grid.spriteHeight + border;
    const canvas = document.createElement('canvas');
    canvas.width = grid.cols * cellW;
    canvas.height = grid.rows * cellH;
    const ctx = canvas.getContext('2d');
    // Чёрный фон (рамки)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Рисуем каждый фрейм
    for (let frame = 0; frame < grid.count; frame++) {
      const fx = (frame % grid.cols) * grid.spriteWidth;
      const fy = Math.floor(frame / grid.cols) * grid.spriteHeight;
      const fcanvas = document.createElement('canvas');
      fcanvas.width = grid.spriteWidth;
      fcanvas.height = grid.spriteHeight;
      const fctx = fcanvas.getContext('2d');
      const img = new ImageData(grid.spriteWidth, grid.spriteHeight);
      const d = img.data;
      const rgb = m.palette.map(hexToRgb);
      for (let i = 0; i < grid.spriteWidth * grid.spriteHeight; i++) {
        const px = m.getPixel(fx + (i % grid.spriteWidth), fy + Math.floor(i / grid.spriteHeight));
        const c = rgb[px] || rgb[0];
        const o = i << 2;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
      fctx.putImageData(img, 0, 0);
      ctx.drawImage(fcanvas, (frame % grid.cols) * cellW, Math.floor(frame / grid.cols) * cellH);
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Не удалось создать PNG'));
        }
      }, 'image/png');
    });
  }

  /**
   * Сохраняет текущее изображение в PNG-файл (скачивание).
   * В режиме «Спрайты» — лист с рамками.
   * @returns {Promise<void>}
   */
  function savePngFile() {
    if (!state) {
      return Promise.reject(new Error('редактор не открыт'));
    }
    const m = state.model;
    let blobPromise;
    if (state.editorMode === 'sprites') {
      blobPromise = exportSpriteSheetPng();
    } else {
      if (typeof BKGraphicsPng === 'undefined') {
        return Promise.reject(new Error('модуль bk-graphics-png.js не загружен'));
      }
      blobPromise = BKGraphicsPng.exportToPng(m, m.palette);
    }
    return blobPromise.then(function (blob) {
      downloadBlob(blob, baseFileName(m) + '.png');
    });
  }

  /**
   * Опции экспорта ASM/MAC: имя символа из имени модели (IMAGE по умолчанию).
   * @param {string} [symbolOverride] - явное имя символа (приоритетнее имени модели).
   * @returns {Object} опции для BKGraphicsExport.
   */
  function getExportOptions(symbolOverride) {
    let symbol = symbolOverride
      ? String(symbolOverride).toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      : '';
    if (!symbol) {
      const name = String(state.model.name || '').trim();
      symbol = name ? name.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : '';
    }
    if (/^[0-9]/.test(symbol)) {
      symbol = '_' + symbol; // MACRO-11: символ не может начинаться с цифры
    }
    return { symbol: symbol || 'IMAGE' };
  }

  /**
   * Строит текст экспорта данных изображения (общий для .ASM и .MAC).
   * В режиме «Спрайты» — с меткой для каждого фрейма.
   * @param {string} [symbolOverride] - явное имя символа данных.
   * @returns {?string} текст файла или null, если редактор не открыт
   *   или модуль экспорта не загружен.
   */
  function buildExportText(symbolOverride) {
    if (!state || typeof BKGraphicsExport === 'undefined') {
      return null;
    }
    const opts = getExportOptions(symbolOverride);
    if (state.editorMode === 'sprites') {
      const grid = spriteGridInfo();
      return BKGraphicsExport.exportSpritesToAsm(state.model, opts, {
        cols: grid.cols,
        rows: grid.rows,
        spriteWidth: grid.spriteWidth,
        spriteHeight: grid.spriteHeight,
        count: grid.count,
        symbolPrefix: opts.symbol
      });
    }
    return BKGraphicsExport.exportToAsm(state.model, opts);
  }

  /**
   * Скачивает данные изображения как файл .ASM или .MAC.
   * @param {string} format - 'ASM' или 'MAC' (определяет расширение).
   */
  /**
   * Получает 16384 байтов бинарного экрана БК для модели 256x256.
   * @param {BKGraphicsModel} model - модель изображения.
   * @returns {Uint8Array} ровно 16384 байт.
   */
  function getScreen256Bytes(model) {
    if (model.width !== 256 || model.height !== 256) {
      throw new Error('Размер изображения должен быть 256×256 (текущий: ' + model.width + '×' + model.height + ')');
    }
    if (typeof BKGraphicsCodec === 'undefined') {
      throw new Error('Модуль bk-graphics-codec.js не загружен');
    }
    if (model.bitsPerPixel === 2) {
      return BKGraphicsCodec.encode(model);
    }
    // Если bpp !== 2 (например 1 bpp монохром 256x256), кодируем в 2 bpp
    const tempModel = new BKGraphicsModel({
      mode: 'BK0011M_COLOR',
      width: 256,
      height: 256,
      paletteIndex: model.paletteIndex || 0
    });
    for (let i = 0; i < model.pixels.length; i++) {
      tempModel.pixels[i] = model.pixels[i];
    }
    return BKGraphicsCodec.encode(tempModel);
  }

  /**
   * Экспортирует изображение 256x256 в формат .BIN (16388 байт).
   * Заголовок БК:
   *   - слово 0 (2 байта, little-endian): адрес 0o40000 = 0x4000 = [0x00, 0x40]
   *   - слово 1 (2 байта, little-endian): длина тела 0o40000 = 16384 = [0x00, 0x40]
   *   - данные тела: 16384 байт (0o40000 байт)
   * @param {BKGraphicsModel} [model] - модель (по умолчанию state.model).
   * @returns {Uint8Array} 16388 байт.
   */
  function exportBin(model) {
    const m = model || (state ? state.model : null);
    if (!m) {
      throw new Error('Модель не задана');
    }
    const raw = getScreen256Bytes(m);
    const bin = new Uint8Array(16388);
    // Адрес 0o40000 (16384, 0x4000)
    bin[0] = 0x00;
    bin[1] = 0x40;
    // Длина 0o40000 (16384, 0x4000)
    bin[2] = 0x00;
    bin[3] = 0x40;
    bin.set(raw, 4);
    return bin;
  }

  /**
   * Экспортирует изображение 256x256 в формат .DAT (16384 байт, без 4-байтового заголовка).
   * @param {BKGraphicsModel} [model] - модель.
   * @returns {Uint8Array} 16384 байт.
   */
  function exportDat(model) {
    const m = model || (state ? state.model : null);
    if (!m) {
      throw new Error('Модель не задана');
    }
    return getScreen256Bytes(m);
  }

  /**
   * Экспортирует изображение 256x256 в формат .BKS (16389 байт).
   * Как .BIN (16388 байт), но в конце файла добавлен 1 байт с номером палитры (0..15).
   * @param {BKGraphicsModel} [model] - модель.
   * @returns {Uint8Array} 16389 байт.
   */
  function exportBks(model) {
    const m = model || (state ? state.model : null);
    if (!m) {
      throw new Error('Модель не задана');
    }
    const raw = getScreen256Bytes(m);
    const bks = new Uint8Array(16389);
    bks[0] = 0x00;
    bks[1] = 0x40;
    bks[2] = 0x00;
    bks[3] = 0x40;
    bks.set(raw, 4);
    bks[16388] = (m.paletteIndex || 0) & 0x0F;
    return bks;
  }

  /**
   * Импортирует экран БК из бинарного буфера (.BIN, .DAT или .BKS).
   * Переключает редактор в режим «Графика», устанавливает размер 256×256,
   * палитру (если BKS) и декодирует пиксели.
   * @param {Uint8Array|ArrayBuffer} input - двоичные данные.
   * @param {string} [formatOrName] - расширение ('bin', 'dat', 'bks') или имя файла.
   * @returns {BKGraphicsModel} загруженная модель.
   */
  function importBinaryScreen(input, formatOrName) {
    if (!state) {
      throw new Error('Редактор не открыт');
    }
    let bytes = input;
    if (bytes instanceof ArrayBuffer) {
      bytes = new Uint8Array(bytes);
    } else if (ArrayBuffer.isView(bytes) && !(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    if (!bytes || !(bytes instanceof Uint8Array)) {
      throw new Error('Некорректные бинарные данные');
    }

    const name = String(formatOrName || '').toLowerCase();
    let format = '';
    if (name.endsWith('.bks') || name === 'bks') {
      format = 'BKS';
    } else if (name.endsWith('.dat') || name === 'dat') {
      format = 'DAT';
    } else if (name.endsWith('.bin') || name === 'bin') {
      format = 'BIN';
    } else {
      if (bytes.length === 16389) {
        format = 'BKS';
      } else if (bytes.length === 16384) {
        format = 'DAT';
      } else if (bytes.length >= 16388) {
        format = 'BIN';
      } else {
        throw new Error('Не удалось определить формат экрана БК (размер: ' + bytes.length + ' байт)');
      }
    }

    let bodyBytes;
    let paletteIndex = (state.model && state.model.paletteIndex) || 0;
    let targetMode = (state.model && state.model.mode === 'BK0010_COLOR') ? 'BK0010_COLOR' : 'BK0011M_COLOR';

    if (format === 'DAT') {
      if (bytes.length < 16384) {
        throw new Error('Файл .DAT слишком мал: ' + bytes.length + ' байт (требуется 16384)');
      }
      bodyBytes = bytes.subarray(0, 16384);
    } else if (format === 'BKS') {
      if (bytes.length < 16389) {
        throw new Error('Файл .BKS слишком мал: ' + bytes.length + ' байт (требуется 16389)');
      }
      bodyBytes = bytes.subarray(4, 16388);
      paletteIndex = bytes[16388] & 0x0F;
      targetMode = 'BK0011M_COLOR';
    } else { // BIN
      if (bytes.length < 16388) {
        throw new Error('Файл .BIN слишком мал: ' + bytes.length + ' байт (требуется 16388)');
      }
      bodyBytes = bytes.subarray(4, 16388);
    }

    const decoded = BKGraphicsCodec.decode(bodyBytes, 256, 256, targetMode);

    const newModel = new BKGraphicsModel({
      mode: targetMode,
      width: 256,
      height: 256,
      paletteIndex: paletteIndex
    });
    for (let i = 0; i < 256 * 256; i++) {
      newModel.pixels[i] = decoded.pixels[i];
    }

    state.editorMode = 'graphics';
    state.model = newModel;
    state.colorIndex = Math.min(state.colorIndex, newModel.maxColors - 1);
    state.drawing = null;
    state.selection = null;
    state.clipboard = null;
    state.transformState = null;
    stopAnimation();
    stopPasteGhost();
    resetHistory();
    renderAll();
    return newModel;
  }

  /**
   * Сериализует полное состояние редактора в JSON-строку формата .BKGfxState.
   * @returns {string} JSON-строка.
   */
  function exportGfxState() {
    if (!state) {
      throw new Error('Редактор не открыт');
    }
    const stateData = {
      format: 'BKGfxState',
      version: 1,
      savedAt: new Date().toISOString(),
      editorMode: state.editorMode,
      tool: state.tool,
      colorIndex: state.colorIndex,
      zoom: state.zoom,
      previewZoom: state.previewZoom,
      showGrid: state.showGrid,
      spriteWidth: state.spriteWidth,
      spriteHeight: state.spriteHeight,
      spriteCount: state.spriteCount,
      animDelay: state.animDelay,
      model: state.model.toJSON()
    };
    return JSON.stringify(stateData, null, 2);
  }

  /**
   * Восстанавливает полное состояние редактора из JSON (формат .BKGfxState).
   * @param {string|Object} stateData - JSON-строка или распарсенный объект.
   * @returns {Object} восстановленное состояние state.
   */
  function importGfxState(stateData) {
    if (!state) {
      throw new Error('Редактор не открыт');
    }
    let data = stateData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (err) {
        throw new Error('Ошибка разбора JSON .BKGfxState: ' + err.message);
      }
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Некорректный формат данных состояния');
    }
    if (data.format && data.format !== 'BKGfxState') {
      throw new Error('Неизвестный формат состояния: ' + data.format);
    }
    const mData = data.model;
    if (!mData) {
      throw new Error('Данные модели отсутствуют в файле состояния');
    }

    stopAnimation();
    stopPasteGhost();

    const newModel = new BKGraphicsModel({
      mode: mData.mode || DEFAULT_MODE_ID,
      width: mData.width,
      height: mData.height,
      paletteIndex: mData.paletteIndex,
      palette: mData.palette,
      name: mData.name,
      metadata: mData.metadata
    });
    if (Array.isArray(mData.pixels)) {
      const len = Math.min(newModel.pixels.length, mData.pixels.length);
      for (let i = 0; i < len; i++) {
        newModel.pixels[i] = mData.pixels[i];
      }
    }

    state.model = newModel;
    if (data.editorMode === 'sprites' || data.editorMode === 'graphics') {
      state.editorMode = data.editorMode;
    }
    if (typeof data.colorIndex === 'number') {
      state.colorIndex = Math.min(Math.max(0, data.colorIndex), newModel.maxColors - 1);
    }
    if (typeof data.zoom === 'number') {
      state.zoom = data.zoom;
    }
    if (typeof data.previewZoom === 'number') {
      state.previewZoom = data.previewZoom;
    }
    if (typeof data.showGrid === 'boolean') {
      state.showGrid = data.showGrid;
    }
    if (typeof data.spriteWidth === 'number') {
      state.spriteWidth = data.spriteWidth;
    }
    if (typeof data.spriteHeight === 'number') {
      state.spriteHeight = data.spriteHeight;
    }
    if (typeof data.spriteCount === 'number') {
      state.spriteCount = data.spriteCount;
    }
    if (typeof data.animDelay === 'number') {
      state.animDelay = data.animDelay;
    }

    state.animFrame = 0;
    state.selection = null;
    state.clipboard = null;
    state.transformState = null;
    state.drawing = null;

    resetHistory();
    setTool(data.tool || 'pencil');
    renderAll();
    return state;
  }

  /**
   * Сохраняет состояние редактора в файл на диск (.BKGfxState).
   * @param {string} [fileName] - имя файла (без расширения).
   */
  function saveStateToFile(fileName) {
    if (!state) {
      throw new Error('Редактор не открыт');
    }
    const name = sanitizeResourceName(fileName) || baseFileName(state.model) || 'gfx_state';
    const json = exportGfxState();
    downloadBlob(
      new Blob([json], { type: 'application/json;charset=utf-8' }),
      name + '.BKGfxState'
    );
  }

  /**
   * Сохраняет состояние редактора в файл проекта.
   * @param {string} name - имя ресурса.
   * @param {string} [folder='gfx'] - папка.
   * @returns {string} путь к файлу в проекте.
   */
  function saveStateToProject(name, folder) {
    if (typeof bkProject === 'undefined') {
      throw new Error('Project Manager (bkProject) не загружен');
    }
    const cleanName = sanitizeResourceName(name) || 'gfx_state';
    const json = exportGfxState();
    const filePath = joinProjectPath(folder || 'gfx', cleanName + '.BKGfxState');
    bkProject.addArtifactFile(filePath, json);
    return filePath;
  }

  /**
   * Загружает состояние редактора из файла проекта.
   * @param {string} filePath - путь к файлу в проекте.
   * @returns {Object} восстановленное состояние.
   */
  function loadStateFromProject(filePath) {
    if (typeof bkProject === 'undefined') {
      throw new Error('Project Manager (bkProject) не загружен');
    }
    let content = bkProject.getFileContent(filePath);
    if (!content && bkProject.files && bkProject.files[filePath]) {
      content = bkProject.files[filePath];
    }
    if (!content) {
      throw new Error('Файл не найден в проекте: ' + filePath);
    }
    if (typeof content !== 'string') {
      if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
        let dec = '';
        for (let i = 0; i < content.length; i++) {
          dec += String.fromCharCode(content[i]);
        }
        try {
          content = decodeURIComponent(escape(dec));
        } catch (e) {
          content = dec;
        }
      } else if (content && content.__binary && content.data) {
        content = atob(content.data);
      }
    }
    return importGfxState(content);
  }

  /**
   * Импортирует бинарный экран (.BIN, .DAT, .BKS) из проекта.
   * @param {string} filePath - путь к файлу в проекте.
   * @returns {BKGraphicsModel} загруженная модель.
   */
  function importBinaryFromProject(filePath) {
    if (typeof bkProject === 'undefined') {
      throw new Error('Project Manager (bkProject) не загружен');
    }
    let content = bkProject.files && bkProject.files[filePath];
    if (content === undefined) {
      content = bkProject.getFileContent(filePath);
    }
    if (content === undefined || content === null) {
      throw new Error('Файл не найден в проекте: ' + filePath);
    }
    let bytes;
    if (content instanceof Uint8Array) {
      bytes = content;
    } else if (ArrayBuffer.isView(content)) {
      bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    } else if (content && typeof content === 'object' && content.__binary && typeof content.data === 'string') {
      const binary = atob(content.data);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
    } else if (typeof content === 'string') {
      bytes = new Uint8Array(content.length);
      for (let i = 0; i < content.length; i++) {
        bytes[i] = content.charCodeAt(i) & 0xFF;
      }
    } else {
      throw new Error('Некорректное содержимое файла в проекте: ' + filePath);
    }
    return importBinaryScreen(bytes, filePath);
  }

  /**
   * Открывает диалог сохранения состояния (.BKGfxState).
   */
  function openStateSaveDialog() {
    if (!state) {
      return;
    }
    const name = String(state.model.name || '').trim();
    els.stateName.value = sanitizeResourceName(name) || 'gfx_state';
    els.stateFolder.value = 'gfx';
    els.stateDownload.checked = true;
    els.stateProject.checked = true;
    els.stateDialog.style.display = 'flex';
    els.stateName.focus();
    if (typeof els.stateName.select === 'function') {
      els.stateName.select();
    }
  }

  /**
   * Закрывает диалог сохранения состояния.
   */
  function closeStateSaveDialog() {
    if (els.stateDialog) {
      els.stateDialog.style.display = 'none';
    }
  }

  /**
   * Подтверждает сохранение состояния из диалога.
   */
  function submitStateSave() {
    const rawName = els.stateName.value;
    const cleanName = sanitizeResourceName(rawName) || 'gfx_state';
    const folder = els.stateFolder.value || 'gfx';
    const doDownload = els.stateDownload.checked;
    const doProject = els.stateProject.checked;

    if (!doDownload && !doProject) {
      alert('Выберите хотя бы один вариант сохранения (файл или проект).');
      return;
    }

    try {
      if (doDownload) {
        saveStateToFile(cleanName);
      }
      if (doProject) {
        saveStateToProject(cleanName, folder);
      }
      closeStateSaveDialog();
    } catch (err) {
      alert('Ошибка сохранения состояния: ' + err.message);
    }
  }

  let selectedImportPath = null;

  /**
   * Открывает диалог импорта из проекта (.BIN, .DAT, .BKS, .BKGfxState).
   */
  function openProjectImportDialog() {
    if (!state) {
      return;
    }
    if (typeof bkProject === 'undefined') {
      alert('Project Manager (bkProject) не загружен.');
      return;
    }
    selectedImportPath = null;
    els.projImportOk.disabled = true;
    renderProjectImportList();
    els.importDialog.style.display = 'flex';
  }

  /**
   * Закрывает диалог импорта из проекта.
   */
  function closeProjectImportDialog() {
    if (els.importDialog) {
      els.importDialog.style.display = 'none';
    }
    selectedImportPath = null;
  }

  /**
   * Отрисовывает список подходящих файлов проекта.
   */
  function renderProjectImportList() {
    els.projImportList.innerHTML = '';
    const files = (typeof bkProject !== 'undefined') ? bkProject.getAllFiles() : {};
    const eligiblePaths = Object.keys(files).filter(function (path) {
      return /\.(bin|dat|bks|BKGfxState)$/i.test(path);
    });

    if (eligiblePaths.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bk-g-proj-import-empty';
      empty.textContent = 'В проекте нет файлов .BIN, .DAT, .BKS или .BKGfxState';
      els.projImportList.appendChild(empty);
      return;
    }

    eligiblePaths.forEach(function (path) {
      const item = document.createElement('div');
      item.className = 'bk-g-proj-import-item';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';

      const tag = document.createElement('span');
      tag.className = 'bk-g-proj-import-tag';
      const lower = path.toLowerCase();
      if (lower.endsWith('.bin')) {
        tag.className += ' bk-g-tag-bin';
        tag.textContent = 'BIN';
      } else if (lower.endsWith('.dat')) {
        tag.className += ' bk-g-tag-dat';
        tag.textContent = 'DAT';
      } else if (lower.endsWith('.bks')) {
        tag.className += ' bk-g-tag-bks';
        tag.textContent = 'BKS';
      } else {
        tag.className += ' bk-g-tag-state';
        tag.textContent = 'STATE';
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = path;

      left.appendChild(tag);
      left.appendChild(nameSpan);

      const content = files[path];
      let sizeText = '';
      if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
        sizeText = content.byteLength + ' байт';
      } else if (typeof content === 'string') {
        sizeText = content.length + ' байт';
      } else if (content && content.__binary && content.data) {
        sizeText = Math.round(content.data.length * 0.75) + ' байт';
      }
      const sizeSpan = document.createElement('span');
      sizeSpan.style.color = 'var(--text-secondary)';
      sizeSpan.style.fontSize = '10px';
      sizeSpan.textContent = sizeText;

      item.appendChild(left);
      item.appendChild(sizeSpan);

      item.addEventListener('click', function () {
        Array.prototype.slice.call(els.projImportList.querySelectorAll('.bk-g-proj-import-item'))
          .forEach(function (el) { el.classList.remove('selected'); });
        item.classList.add('selected');
        selectedImportPath = path;
        els.projImportOk.disabled = false;
      });

      item.addEventListener('dblclick', function () {
        selectedImportPath = path;
        submitProjectImport();
      });

      els.projImportList.appendChild(item);
    });
  }

  /**
   * Подтверждает импорт выбранного файла из проекта.
   */
  function submitProjectImport() {
    if (!selectedImportPath) {
      return;
    }
    const path = selectedImportPath;
    closeProjectImportDialog();
    try {
      if (/\.bkgfxstate$/i.test(path)) {
        loadStateFromProject(path);
      } else {
        importBinaryFromProject(path);
      }
    } catch (err) {
      alert('Ошибка импорта из проекта: ' + err.message);
    }
  }

  /**
   * Скачивает данные изображения: .ASM/.MAC или бинарные форматы .BIN/.DAT/.BKS.
   * @param {string} format - 'ASM' | 'MAC' | 'BIN' | 'DAT' | 'BKS'.
   */
  function downloadExport(format) {
    if (!state) {
      alert('Редактор не открыт.');
      return;
    }
    const fmt = String(format || (els.exportFormat && els.exportFormat.value) || 'ASM').toUpperCase();
    if (fmt === 'BIN') {
      try {
        const bytes = exportBin(state.model);
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }),
          baseFileName(state.model) + '.bin');
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (fmt === 'DAT') {
      try {
        const bytes = exportDat(state.model);
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }),
          baseFileName(state.model) + '.dat');
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (fmt === 'BKS') {
      try {
        const bytes = exportBks(state.model);
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }),
          baseFileName(state.model) + '.bks');
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (typeof BKGraphicsExport === 'undefined') {
      alert('Модуль bk-graphics-export.js не загружен.');
      return;
    }
    const text = buildExportText();
    const ext = fmt === 'MAC' ? 'mac' : 'asm';
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }),
      baseFileName(state.model) + '.' + ext);
  }

  /**
   * Санирует имя ресурса: недопустимые для имени файла символы
   * заменяет на '_', обрезает крайние '_' и длину до 64 символов.
   * @param {string} raw - введённое пользователем имя.
   * @returns {string} безопасное имя (может быть пустым).
   */
  function sanitizeResourceName(raw) {
    return String(raw || '').trim()
      .replace(/[\\/:*?"<>|\s]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  /**
   * Склеивает папку и имя файла в путь проекта (разделитель '/').
   * @param {string} folder - папка (может быть пустой).
   * @param {string} fileName - имя файла.
   * @returns {string} путь вида 'gfx/player.mac' или 'player.mac'.
   */
  function joinProjectPath(folder, fileName) {
    const clean = String(folder || '').trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/g, '');
    return clean ? clean + '/' + fileName : fileName;
  }

  /**
   * Обновляет опции выпадающего списка формата в диалоге проекта.
   */
  function updateProjectFormatOptions() {
    if (!els.projFormat) {
      return;
    }
    const isScreen256 = (state && state.editorMode === 'graphics' &&
      state.model.width === 256 && state.model.height === 256);
    const prev = els.projFormat.value || 'MAC';
    els.projFormat.innerHTML = '';
    const opts = [
      { value: 'MAC', text: 'MAC (MACRO-11)' },
      { value: 'ASM', text: 'ASM' }
    ];
    if (isScreen256) {
      opts.push({ value: 'BIN', text: 'BIN (экран БК, 16388 байт)' });
      opts.push({ value: 'DAT', text: 'DAT (дамп экрана, 16384 байт)' });
      opts.push({ value: 'BKS', text: 'BKS (экран с палитрой, 16389 байт)' });
    }
    opts.push({ value: 'STATE', text: 'BKGfxState (состояние редактора)' });
    opts.forEach(function (item) {
      const el = document.createElement('option');
      el.value = item.value;
      el.textContent = item.text;
      els.projFormat.appendChild(el);
    });
    if (opts.some(function (o) { return o.value === prev; })) {
      els.projFormat.value = prev;
    } else {
      els.projFormat.value = 'MAC';
    }
  }

  /**
   * Открывает диалог «Добавить в проект» с параметрами по умолчанию
   * (имя — из имени модели, папка — gfx, формат — MAC, PNG — да).
   */
  function openProjectDialog() {
    if (!state) {
      return;
    }
    const name = String(state.model.name || '').trim();
    els.projName.value = sanitizeResourceName(name) || 'image';
    els.projFolder.value = 'gfx';
    updateProjectFormatOptions();
    els.projPng.checked = true;
    els.projDialog.style.display = 'flex';
    els.projName.focus();
    if (typeof els.projName.select === 'function') {
      els.projName.select();
    }
  }

  /**
   * Закрывает диалог «Добавить в проект».
   */
  function closeProjectDialog() {
    if (els.projDialog) {
      els.projDialog.style.display = 'none';
    }
  }

  /**
   * Ядро «Добавить в проект»: создаёт файлы ресурса через существующий
   * Project Manager (bkProject.addArtifactFile), без нового хранилища.
   * Поддерживает форматы MAC, ASM, BIN, DAT, BKS, STATE.
   * @param {string} name - имя ресурса (без расширения).
   * @param {string} [folder] - папка в проекте (например, 'gfx').
   * @param {string} [format] - 'MAC' (по умолчанию), 'ASM', 'BIN', 'DAT', 'BKS' или 'STATE'.
   * @param {boolean} [savePng] - сохранять ли PNG рядом с кодом.
   * @returns {Promise<string>} путь к файлу ресурса в проекте.
   */
  function addProjectResource(name, folder, format, savePng) {
    if (!state) {
      return Promise.reject(new Error('редактор не открыт'));
    }
    if (typeof bkProject === 'undefined') {
      return Promise.reject(new Error('Project Manager (bkProject) не загружен'));
    }
    const cleanName = sanitizeResourceName(name);
    if (!cleanName) {
      return Promise.reject(new Error('имя ресурса пустое'));
    }
    const fmt = String(format || 'MAC').toUpperCase();

    // Бинарные форматы экрана
    if (fmt === 'BIN') {
      const bytes = exportBin(state.model);
      const binPath = joinProjectPath(folder, cleanName + '.bin');
      bkProject.addArtifactFile(binPath, bytes);
      return Promise.resolve(binPath);
    }
    if (fmt === 'DAT') {
      const bytes = exportDat(state.model);
      const datPath = joinProjectPath(folder, cleanName + '.dat');
      bkProject.addArtifactFile(datPath, bytes);
      return Promise.resolve(datPath);
    }
    if (fmt === 'BKS') {
      const bytes = exportBks(state.model);
      const bksPath = joinProjectPath(folder, cleanName + '.bks');
      bkProject.addArtifactFile(bksPath, bytes);
      return Promise.resolve(bksPath);
    }
    if (fmt === 'STATE' || fmt === 'BKGFXSTATE') {
      const json = exportGfxState();
      const statePath = joinProjectPath(folder, cleanName + '.BKGfxState');
      bkProject.addArtifactFile(statePath, json);
      return Promise.resolve(statePath);
    }

    // Ассемблерные форматы ASM / MAC
    const isAsm = fmt === 'ASM';
    const text = buildExportText(cleanName);
    if (text === null) {
      return Promise.reject(new Error('модуль bk-graphics-export.js не загружен'));
    }
    const asmPath = joinProjectPath(folder, cleanName + (isAsm ? '.asm' : '.mac'));
    bkProject.addArtifactFile(asmPath, text);
    if (!savePng || typeof BKGraphicsPng === 'undefined') {
      return Promise.resolve(asmPath);
    }
    const pngPath = joinProjectPath(folder, cleanName + '.png');
    const m = state.model;
    return BKGraphicsPng.exportToPng(m, m.palette)
      .then(function (blob) { return blob.arrayBuffer(); })
      .then(function (buf) {
        bkProject.addArtifactFile(pngPath, new Uint8Array(buf));
      })
      .catch(function (err) {
        console.warn('[BKGraphics] Не удалось сохранить PNG: ' + err.message);
      })
      .then(function () { return asmPath; });
  }

  /**
   * Обработка кнопки «Добавить» в диалоге: читает поля формы
   * и вызывает addProjectResource.
   */
  function submitProjectAddition() {
    addProjectResource(
      els.projName.value,
      els.projFolder.value,
      els.projFormat.value,
      els.projPng.checked
    ).then(function (asmPath) {
      finishProjectAddition(asmPath);
    }).catch(function (err) {
      alert(err.message);
    });
  }

  /**
   * Завершение «Добавить в проект»: закрывает диалог и предлагает
   * вставить .INCLUDE в текущий файл проекта (только для .ASM / .MAC).
   * @param {string} resPath - путь к созданному файлу ресурса.
   */
  function finishProjectAddition(resPath) {
    closeProjectDialog();
    if (!/\.(asm|mac)$/i.test(resPath)) {
      return;
    }
    const active = bkProject.activeFileName;
    if (active === resPath) {
      return; // не вставлять INCLUDE в сам ресурс
    }
    if (typeof bkProject.files[active] !== 'string') {
      return; // двоичный или несуществующий файл
    }
    if (!confirm('Вставить INCLUDE в текущий файл («' + active + '»)?')) {
      return;
    }
    insertIncludeDirective(resPath);
  }

  /**
   * Вставляет директиву .INCLUDE в текущий файл проекта.
   * Синтаксис MACRO-11 (.INCLUDE "файл") понимают и BKTurbo8, и PDPy11.
   * Если доступен Monaco — на новую строку в позиции курсора,
   * иначе — в конец файла.
   * @param {string} asmPath - путь к включаемому файлу.
   */
  function insertIncludeDirective(asmPath) {
    const directive = '.INCLUDE "' + asmPath + '"';
    const active = bkProject.activeFileName;
    const mon = global.bkEditor;
    if (mon && typeof mon.executeEdits === 'function' &&
        typeof global.monaco !== 'undefined') {
      const pos = mon.getPosition();
      if (pos) {
        const model = mon.getModel();
        const lineEndCol = model.getLineMaxColumn(pos.lineNumber);
        mon.executeEdits('bk-graphics', [{
          range: new global.monaco.Range(pos.lineNumber, lineEndCol, pos.lineNumber, lineEndCol),
          text: '\n' + directive
        }]);
        return;
      }
    }
    const content = bkProject.getFileContent(active);
    bkProject.setFileContent(active, content + '\n' + directive);
  }

  // =====================================================================
  // Публичный API
  // =====================================================================

  /**
   * Открывает редактор (создавая состояние при первом вызове).
   * @param {Object} [options] - параметры начальной модели:
   *   mode, width, height, paletteIndex или готовая модель (model).
   * @returns {BKGraphicsModel} модель изображения.
   */
  function open(options) {
    if (!overlay) {
      buildDom();
    }
    if (!state) {
      state = createState(options);
    }
    overlay.style.display = 'flex';
    setTool(state.tool);
    renderAll();
    els.dialog.focus();
    return state.model;
  }

  /**
   * Закрывает модальное окно (состояние сохраняется).
   */
  function close() {
    if (!overlay) {
      return;
    }
    cancelSpriteImport();
    closeStateSaveDialog();
    closeProjectImportDialog();
    closeProjectDialog();
    cancelModeDialog();
    state.drawing = null;
    stopAnimation();
    stopPasteGhost();
    overlay.style.display = 'none';
  }

  /**
   * Открыт ли сейчас редактор.
   * @returns {boolean} флаг.
   */
  function isOpen() {
    return !!(overlay && overlay.style.display !== 'none');
  }

  /**
   * Возвращает текущую модель изображения.
   * @returns {?BKGraphicsModel} модель или null.
   */
  function getModel() {
    return state ? state.model : null;
  }

  // =====================================================================
  // Инициализация
  // =====================================================================

  /**
   * Привязывает кнопку "Графика" в шапке BKStudio.
   */
  function wireLaunchButton() {
    const btn = document.getElementById('btn-graphics');
    if (btn) {
      btn.addEventListener('click', function () {
        open();
      });
    }
  }

  global.BKGraphicsEditor = {
    open: open,
    close: close,
    isOpen: isOpen,
    getModel: getModel,
    getState: function () { return state; },
    createSprite: createNewSprite,
    importPng: importPngFile,
    savePng: savePngFile,
    exportAsm: function () { return buildExportText(); },
    exportMac: function () { return buildExportText(); },
    exportBin: exportBin,
    exportDat: exportDat,
    exportBks: exportBks,
    importBinary: importBinaryScreen,
    importBinaryScreen: importBinaryScreen,
    exportGfxState: exportGfxState,
    importGfxState: importGfxState,
    exportState: exportGfxState,
    importState: importGfxState,
    saveStateToFile: saveStateToFile,
    saveStateToProject: saveStateToProject,
    loadStateFromProject: loadStateFromProject,
    importBinaryFromProject: importBinaryFromProject,
    addToProject: openProjectDialog,
    addProjectResource: addProjectResource,
    insertInclude: insertIncludeDirective
  };

  if (typeof BKGraphicsModel === 'undefined') {
    console.error('[BKGraphicsEditor] Не найдан BKGraphicsModel — загрузите bk-graphics-model.js раньше редактора.');
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireLaunchButton);
  } else {
    wireLaunchButton();
  }

})(typeof window !== 'undefined' ? window : this);
