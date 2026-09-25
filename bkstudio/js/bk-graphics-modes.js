/**
 * BKStudio - BK Graphics Modes
 *
 * Чистое описание поддерживаемых графических режимов Электроника БК
 * и их палитр. Модуль содержит только данные и функции работы с ними,
 * без UI.
 *
 * Для каждого режима указаны: id, название, width, height, bitsPerPixel,
 * colors, palette.
 *
 * Палитры не выдумываются:
 *   - BK0010_MONO    — фиксированные 2 цвета (чёрный/белый).
 *   - BK0010_COLOR   — фиксированная палитра из 4 цветов (совпадает с палитрой 00 БК-0011М).
 *   - BK0011M_COLOR  — 16 фиксированных палитр по 4 цвета (выбор по индексу).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * 16 палитр БК-0011М, по 4 цвета. Индекс массива = индекс палитры (0..15).
   * @type {string[][]}
   */
  const BK0011M_PALETTES = [
    ['#000000', '#0000FF', '#00FF00', '#FF0000'], // 00
    ['#000000', '#00FF00', '#FF00FF', '#FF0000'], // 01
    ['#000000', '#00FFFF', '#0000FF', '#FF00FF'], // 02
    ['#000000', '#00FF00', '#00FFFF', '#FFFF00'], // 03
    ['#000000', '#FF00FF', '#00FFFF', '#FFFFFF'], // 04
    ['#000000', '#FFFFFF', '#FFFFFF', '#FFFFFF'], // 05
    ['#000000', '#C00000', '#900000', '#FF0000'], // 06
    ['#000000', '#C0FF00', '#90FF00', '#FFFF00'], // 07
    ['#000000', '#C000FF', '#9000FF', '#FF00FF'], // 08
    ['#000000', '#90FF00', '#9000FF', '#900000'], // 09
    ['#000000', '#C0FF00', '#C000FF', '#C00000'], // 10
    ['#000000', '#00FFFF', '#FFFF00', '#FF0000'], // 11
    ['#000000', '#FF0000', '#00FF00', '#00FFFF'], // 12
    ['#000000', '#FFFFFF', '#FFFF00', '#FFFFFF'], // 13
    ['#000000', '#00FF00', '#00FF00', '#FFFFFF'], // 14
    ['#000000', '#00FF00', '#00FF00', '#FFFFFF']  // 15
  ];

  /**
   * Описание поддерживаемых графических режимов БК.
   *
   * Поле palette:
   *   - для BK0010_MONO и BK0010_COLOR — одна фиксированная палитра
   *     (массив hex-цветов, длина = colors);
   *   - для BK0011M_COLOR — массив из 16 палитр (каждая — массив из 4 hex-цветов).
   *
   * @type {Object[]}
   */
  const GRAPHICS_MODES = [
    {
      id: 'BK0010_MONO',
      name: 'BK-0010 монохром',
      width: 512,
      height: 256,
      bitsPerPixel: 1,
      colors: 2,
      palette: ['#000000', '#FFFFFF']
    },
    {
      id: 'BK0010_COLOR',
      name: 'BK-0010 цвет',
      width: 256,
      height: 256,
      bitsPerPixel: 2,
      colors: 4,
      palette: ['#000000', '#0000FF', '#00FF00', '#FF0000']
    },
    {
      id: 'BK0011M_COLOR',
      name: 'BK-0011М цвет',
      width: 256,
      height: 256,
      bitsPerPixel: 2,
      colors: 4,
      palette: BK0011M_PALETTES
    }
  ];

  /**
   * Возвращает описание режима по его id.
   * @param {string} id - id режима (например, 'BK0011M_COLOR').
   * @returns {Object|null} объект режима или null, если режим не найден.
   */
  function getGraphicsMode(id) {
    for (let i = 0; i < GRAPHICS_MODES.length; i++) {
      if (GRAPHICS_MODES[i].id === id) {
        return GRAPHICS_MODES[i];
      }
    }
    return null;
  }

  /**
   * Возвращает палитру режима.
   * Для BK0010_MONO / BK0010_COLOR — одна палитра (массив hex-цветов).
   * Для BK0011M_COLOR — массив из 16 палитр.
   * @param {string} id - id режима.
   * @returns {string[]|string[][]|null} палитра или null, если режим не найден.
   */
  function getPalette(id) {
    const mode = getGraphicsMode(id);
    if (!mode) {
      return null;
    }
    return mode.palette;
  }

  /**
   * Проверяет, что изображение совместимо с его заявленным режимом.
   *
   * Ожидаемый объект image:
   *   {
   *     mode: 'BK0011M_COLOR',
   *     width: 256,
   *     height: 256,
   *     paletteIndex: 0,   // только для BK0011M_COLOR
   *     pixels: [0, 1, ...] // индексы цветов, длина = width * height
   *   }
   *
   * Проверяется:
   *   - корректность режима;
   *   - размеры в пределах режима (1..mode.width, 1..mode.height);
   *   - pixels — массив индексов 0..colors-1 длиной width*height;
   *   - paletteIndex (если задан) в диапазоне 0..15 для BK0011M_COLOR.
   *
   * @param {Object} image - объект изображения.
   * @returns {Object} { valid: boolean, errors: string[] }.
   */
  function validateImage(image) {
    const errors = [];

    if (!image || typeof image !== 'object') {
      return { valid: false, errors: ['image must be a non-null object'] };
    }

    const mode = getGraphicsMode(image.mode);
    if (!mode) {
      return { valid: false, errors: ['unknown mode: ' + String(image.mode)] };
    }

    if (!Number.isInteger(image.width) || image.width < 1 || image.width > mode.width) {
      errors.push('width must be an integer from 1 to ' + mode.width);
    }
    if (!Number.isInteger(image.height) || image.height < 1 || image.height > mode.height) {
      errors.push('height must be an integer from 1 to ' + mode.height);
    }

    if (image.width > 0 && image.height > 0) {
      const expected = image.width * image.height;
      if (!Array.isArray(image.pixels) || image.pixels.length !== expected) {
        errors.push('pixels must be an array of length ' + expected);
      } else {
        for (let i = 0; i < image.pixels.length; i++) {
          const p = image.pixels[i];
          if (!Number.isInteger(p) || p < 0 || p >= mode.colors) {
            errors.push('invalid pixel index at position ' + i + ': ' + String(p));
            break;
          }
        }
      }
    }

    if (mode.id === 'BK0011M_COLOR' && image.paletteIndex != null) {
      if (!Number.isInteger(image.paletteIndex) || image.paletteIndex < 0 || image.paletteIndex >= BK0011M_PALETTES.length) {
        errors.push('paletteIndex must be an integer from 0 to ' + (BK0011M_PALETTES.length - 1));
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Экспонирование API в глобальную область.
  global.BKGraphicsModes = GRAPHICS_MODES;
  global.getGraphicsMode = getGraphicsMode;
  global.getPalette = getPalette;
  global.validateImage = validateImage;
})(typeof window !== 'undefined' ? window : this);
