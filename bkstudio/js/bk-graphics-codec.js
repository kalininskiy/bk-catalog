/**
 * BKStudio - BK Graphics Codec
 *
 * Чистый модуль (без UI) преобразования модели BK Graphics в байтовое
 * представление и обратно.
 *
 * Факты о видеопамяти БК (адреса и числа — в восьмеричной системе,
 * как принято для PDP-11 / БК):
 *
 *   - Экранное ОЗУ занимает адреса 40000…77777 (16 Кбайт).
 *     Адрес 40000 — левый верхний угол, 77777 — правый нижний.
 *   - Одна точечная строка занимает 64 (десятичных) байта; при росте
 *     адреса движение идёт вправо по строке, затем переход к следующей.
 *     Всего строк 256.
 *
 * Чёрно-белый режим (1 бит/пиксель):
 *   - 1 бит = 1 точка; единичный бит — белая точка, нулевой — чёрная.
 *   - Разряды байта выводятся слева направо, начиная с МЛАДШЕГО
 *     (левый пиксель строки — бит 0 байта).
 *   - Пример: MOVB #223,@#56036 даст по адресу 56036:
 *         разряды байта:   1    1    0    0    1    0    0    1
 *         номера разрядов: 0    1    2    3    4    5    6    7
 *         ч/б изображение: ▓    ▓              ▓              ▓
 *
 * Цветной режим (2 бита/пиксель, 4 точки в байте):
 *   - Индекс цвета = (младший бит пары) + 2 × (старший бит пары).
 *     Пара пикселя X занимает биты (2·(X mod 4)) и (2·(X mod 4) + 1).
 *
 *     | Биты пары (мл., ст.) | Индекс | Цвет   |
 *     | ---------------------+--------+--------|
 *     | 0, 0                 | 0      | чёрный |
 *     | 1, 0                 | 1      | синий  |
 *     | 0, 1                 | 2      | зелёный|
 *     | 1, 1                 | 3      | красный|
 *
 *   Базовая нумерация битов — с нуля. Подтверждено масками цвета:
 *   зелёный 0o125252 (0xAAAA) — единицы в нечётных разрядах,
 *   синий  0o052525 (0x5555) — в чётных.
 *   Пример: 0o223 = 0b10010011 в цветном режиме —
 *   красная, чёрная, синяя, зелёная точки.
 *
 * Пакетирование (общее для обоих режимов):
 *   байты строк идут подряд, строки — слева направо, сверху вниз;
 *   пиксель X строки занимает биты начиная с (X mod 8/bpp) * bpp
 *   внутри байта floor(X / (8/bpp)) своей строки;
 *   неиспользованные старшие биты последнего байта строки — нули.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Определяет глубину цвета (бит на пиксель) по режиму.
   * @param {string|number} mode - id режима ('BK0010_MONO', 'BK0010_COLOR',
   *   'BK0011M_COLOR') или число бит на пиксель (1 или 2).
   * @returns {number} бит на пиксель (1 или 2).
   * @throws {Error} если режим недопустим.
   */
  function getBitsPerPixel(mode) {
    if (mode === 1 || mode === 2) {
      return mode;
    }
    if (typeof mode === 'string') {
      // Если загружен bk-graphics-modes.js — доверяем ему
      if (typeof global.getGraphicsMode === 'function') {
        const desc = global.getGraphicsMode(mode);
        if (desc) {
          return desc.bitsPerPixel;
        }
      }
      if (mode === 'BK0010_MONO') {
        return 1;
      }
      if (mode === 'BK0010_COLOR' || mode === 'BK0011M_COLOR') {
        return 2;
      }
    }
    throw new Error('Недопустимый режим изображения: ' + String(mode));
  }

  /**
   * Количество байт, занимаемых одной строкой изображения.
   * @param {number} width - ширина в пикселях.
   * @param {string|number} mode - режим (id или бит на пиксель).
   * @returns {number} байт на строку.
   */
  function getBytesPerRow(width, mode) {
    const bpp = getBitsPerPixel(mode);
    return Math.ceil((width * bpp) / 8);
  }

  /**
   * Полное количество байт, необходимое для кодирования изображения.
   * @param {number} width - ширина в пикселях.
   * @param {number} height - высота в пикселях.
   * @param {string|number} mode - режим (id или бит на пиксель).
   * @returns {number} количество байт.
   */
  function getEncodedSize(width, height, mode) {
    return getBytesPerRow(width, mode) * height;
  }

  /**
   * Преобразует модель изображения в байтовое представление БК.
   *
   * @param {Object} image - модель изображения: экземпляр BKGraphicsModel
   *   или обычный объект { mode, width, height, pixels }, где pixels —
   *   плоский массив индексов цветов (0..2^bpp-1), длина width*height,
   *   порядок — слева направо, сверху вниз.
   * @returns {Uint8Array} байты изображения (bytesPerRow * height).
   * @throws {Error} при некорректных параметрах.
   */
  function encode(image) {
    if (!image || typeof image !== 'object') {
      throw new Error('Некорректное изображение');
    }
    const width = image.width;
    const height = image.height;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error('Некорректные размеры изображения: ' + width + 'x' + height);
    }
    const bpp = getBitsPerPixel(image.mode);
    const maxIndex = 1 << bpp;
    const pixels = image.pixels;
    if (!pixels || pixels.length !== width * height) {
      throw new Error('Массив пикселей должен иметь длину width * height = ' + (width * height));
    }

    const pixelsPerByte = 8 / bpp;
    const bytesPerRow = Math.ceil((width * bpp) / 8);
    const bytes = new Uint8Array(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * bytesPerRow;
      let byte = 0;
      let bitPos = 0;
      let byteIndex = 0;
      for (let x = 0; x < width; x++) {
        const index = pixels[y * width + x];
        if (!Number.isInteger(index) || index < 0 || index >= maxIndex) {
          throw new Error('Недопустимый индекс цвета: ' + String(index));
        }
        // Индекс цвета записывается парой (или одиночным) битом начиная
        // с младшего свободного положения: левый пиксель строки — бит 0.
        byte |= index << bitPos;
        bitPos += bpp;
        if (bitPos === 8) {
          bytes[rowOffset + byteIndex++] = byte;
          byte = 0;
          bitPos = 0;
        }
      }
      // Последний (неполный) байт строки; неиспользованные биты — нули.
      if (bitPos) {
        bytes[rowOffset + byteIndex] = byte;
      }
    }
    return bytes;
  }

  /**
   * Восстанавливает изображение из байтового представления БК.
   *
   * @param {Uint8Array|Array} bytes - байты (не меньше, чем
   *   getEncodedSize(width, height, mode)).
   * @param {number} width - ширина в пикселях.
   * @param {number} height - высота в пикселях.
   * @param {string|number} mode - режим (id или бит на пиксель).
   * @returns {Object} изображение { mode, width, height, pixels },
   *   где pixels — плоский массив индексов цветов, длина width*height.
   * @throws {Error} при некорректных параметрах.
   */
  function decode(bytes, width, height, mode) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error('Некорректные размеры изображения: ' + width + 'x' + height);
    }
    const bpp = getBitsPerPixel(mode);
    const pixelsPerByte = 8 / bpp;
    const mask = (1 << bpp) - 1;
    const bytesPerRow = Math.ceil((width * bpp) / 8);
    const required = bytesPerRow * height;
    if (!bytes || bytes.length < required) {
      throw new Error('Недостаточно байтов: нужно ' + required + ', а есть ' +
        (bytes ? bytes.length : 0));
    }

    const pixels = new Array(width * height);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        const byteIndex = Math.floor(x / pixelsPerByte);
        const bitPos = (x % pixelsPerByte) * bpp;
        pixels[y * width + x] = (bytes[rowOffset + byteIndex] >> bitPos) & mask;
      }
    }
    return {
      mode: (typeof mode === 'number') ? null : mode,
      width: width,
      height: height,
      pixels: pixels
    };
  }

  // Экспонирование API в глобальную область.
  // Форматирование ассемблерного текста (.ASM / .MAC) реализовано
  // в модуле bk-graphics-export.js, который использует encode() из этого модуля.
  global.BKGraphicsCodec = {
    encode: encode,
    decode: decode,
    getBytesPerRow: getBytesPerRow,
    getEncodedSize: getEncodedSize,
    getBitsPerPixel: getBitsPerPixel
  };
})(typeof window !== 'undefined' ? window : this);
