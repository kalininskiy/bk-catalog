/**
 * BKStudio - BK Graphics Export
 *
 * Чистый модуль (без UI) экспорта изображения BK Graphics в ассемблерный
 * текст для файлов .ASM и .MAC (MACRO-11 / BKTurbo8).
 *
 * Файлы .ASM и .MAC идентичны по содержимому и отличаются только
 * расширением: чистый блок данных (метка символа + строки .BYTE).
 * Обёртка .MACRO ... .ENDM больше не добавляется.
 *
 * Модуль НЕ реализует собственную упаковку пикселей: байтовое
 * представление изображения получается исключительно из результата
 * bk-graphics-codec.js (BKGraphicsCodec.encode / getBytesPerRow).
 *
 * Формат экспорта (пример, режим ч/б, 32x32):
 *
 *   ; Размер: 32x32
 *   PLAYER:
 *       .BYTE 223,000,000,000,000,000,000,000 ; строка y=0
 *       .BYTE 000,000,000,000,000,000,000,000 ; строка y=1
 *       ...
 *
 * Системы счисления значений:
 *   - 8  — восьмеричная (по умолчанию в MACRO-11), например 223;
 *   - 10 — десятичная с суффиксом D, например 147D;
 *   - 2  — двоичная (8 бит) с суффиксом B, например 10010011B.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Значения настроек по умолчанию.
   * @type {Object}
   */
  const DEFAULT_OPTIONS = {
    symbol: 'IMAGE',
    bytesPerLine: 8,
    radix: 8,
    lineComments: false,
    sizeComment: true,
    indent: '    ',
    newLine: '\r\n'
  };

  /**
   * Форматирует значение байта в литерал выбранной системы счисления.
   * @param {number} value - значение 0..255.
   * @param {number} radix - система счисления (8, 10 или 2).
   * @returns {string} литерал, например '223', '147D', '10010011B'.
   * @throws {Error} если система счисления недопустима.
   */
  function formatByteValue(value, radix) {
    if (radix === 8) {
      return value.toString(8).padStart(3, '0');
    }
    if (radix === 10) {
      return value + 'D';
    }
    if (radix === 2) {
      return value.toString(2).padStart(8, '0') + 'B';
    }
    throw new Error('Недопустимая система счисления: ' + String(radix) + ' (допустимы: 8, 10, 2)');
  }

  /**
   * Объединяет переданные настройки со значениями по умолчанию
   * и проверяет их корректность.
   * @param {Object} [options] - настройки экспорта.
   * @returns {Object} итоговые настройки.
   * @throws {Error} при некорректных настройках.
   */
  function resolveOptions(options) {
    options = options || {};
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);
    if (typeof opts.symbol !== 'string' || opts.symbol.length === 0) {
      throw new Error('Имя символа должно быть непустой строкой');
    }
    if (!Number.isInteger(opts.bytesPerLine) || opts.bytesPerLine < 1) {
      throw new Error('Количество BYTE в строке должно быть целым положительным числом');
    }
    if (opts.radix !== 8 && opts.radix !== 10 && opts.radix !== 2) {
      throw new Error('Система счисления должна быть 8, 10 или 2');
    }
    opts.lineComments = !!opts.lineComments;
    opts.sizeComment = !!opts.sizeComment;
    return opts;
  }

  /**
   * Форматирует байты изображения в строки с директивой .BYTE.
   * Байты приходят из bk-graphics-codec.js; здесь только группировка.
   *
   * @param {Object} image - изображение { mode, width, height, ... }.
   * @param {Uint8Array} bytes - байты изображения (результат encode).
   * @param {Object} opts - итоговые настройки.
   * @returns {string[]} строки блока данных.
   */
  function formatDataBlock(image, bytes, opts) {
    const bytesPerRow = global.BKGraphicsCodec.getBytesPerRow(image.width, image.mode);
    const lines = [];
    for (let y = 0; y < image.height; y++) {
      const rowStart = y * bytesPerRow;
      for (let i = 0; i < bytesPerRow; i += opts.bytesPerLine) {
        const end = Math.min(i + opts.bytesPerLine, bytesPerRow);
        const values = [];
        for (let x = i; x < end; x++) {
          values.push(formatByteValue(bytes[rowStart + x], opts.radix));
        }
        let line = opts.indent + '.BYTE ' + values.join(',');
        // Комментарий с координатой строки — на первой .BYTE строки
        if (opts.lineComments && i === 0) {
          line += ' ; строка y=' + y;
        }
        lines.push(line);
      }
    }
    return lines;
  }

  /**
   * Собирает полный текст экспорта (общий для .ASM и .MAC).
   * @param {Object} image - изображение (BKGraphicsModel или
   *   объект { mode, width, height, pixels }).
   * @param {Object} opts - итоговые настройки.
   * @returns {string} текст файла.
   */
  function buildText(image, opts) {
    // Байты — только из bk-graphics-codec.js, собственной упаковки нет.
    const bytes = global.BKGraphicsCodec.encode(image);
    const lines = [];

    // Комментарий с размером изображения
    if (opts.sizeComment) {
      lines.push('; Размер: ' + image.width + 'x' + image.height);
    }

    // Чистый блок данных: метка символа + строки .BYTE.
    lines.push(opts.symbol + ':');
    lines.push.apply(lines, formatDataBlock(image, bytes, opts));

    return lines.join(opts.newLine);
  }

  /**
   * Экспортирует изображение в текст файла .ASM.
   *
   * Пример результата:
   *
   *   ; Размер: 32x32
   *   PLAYER:
   *       .BYTE 223,000,000,000,000,000,000,000
   *       ...
   *
   * @param {Object} image - изображение (BKGraphicsModel или
   *   объект { mode, width, height, pixels }).
   * @param {Object} [options] - настройки экспорта.
   * @param {string} [options.symbol='IMAGE'] - имя символа (например, PLAYER).
   * @param {number} [options.bytesPerLine=8] - количество BYTE в строке.
   * @param {number} [options.radix=8] - система счисления (8, 10 или 2).
   * @param {boolean} [options.lineComments=false] - комментарии с координатами строк.
   * @param {boolean} [options.sizeComment=true] - комментарий с размером изображения.
   * @param {string} [options.indent='    '] - отступ строк данных.
   * @param {string} [options.newLine='\r\n'] - разделитель строк.
   * @returns {string} текст файла .ASM.
   */
  function exportToAsm(image, options) {
    return buildText(image, resolveOptions(options));
  }

  /**
   * Экспортирует изображение в текст файла .MAC.
   * Содержимое идентично .ASM (отличается только расширением):
   * чистый блок данных без обёртки .MACRO ... .ENDM.
   *
   * @param {Object} image - изображение (BKGraphicsModel или
   *   объект { mode, width, height, pixels }).
   * @param {Object} [options] - настройки экспорта (см. exportToAsm).
   * @returns {string} текст файла .MAC.
   */
  function exportToMac(image, options) {
    return buildText(image, resolveOptions(options));
  }

  /**
   * То же resolveOptions, но без обязательного имени символа
   * (для экспорта листа спрайтов метки формируются автоматически).
   * @param {Object} [options] - настройки экспорта.
   * @returns {Object} итоговые настройки.
   * @throws {Error} при некорректных настройках.
   */
  function resolveOptionsNoSymbol(options) {
    options = options || {};
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);
    if (!Number.isInteger(opts.bytesPerLine) || opts.bytesPerLine < 1) {
      throw new Error('Количество BYTE в строке должно быть целым положительным числом');
    }
    if (opts.radix !== 8 && opts.radix !== 10 && opts.radix !== 2) {
      throw new Error('Система счисления должна быть 8, 10 или 2');
    }
    opts.lineComments = !!opts.lineComments;
    opts.sizeComment = !!opts.sizeComment;
    return opts;
  }

  /**
   * Извлекает пиксели одного фрейма из листа спрайтов.
   * @param {Object} image - модель листа (BKGraphicsModel или
   *   объект { mode, width, height, pixels }).
   * @param {number} fx - левый верхний угол фрейма по горизонтали.
   * @param {number} fy - левый верхний угол фрейма по вертикали.
   * @param {number} sw - ширина фрейма.
   * @param {number} sh - высота фрейма.
   * @returns {number[]} плоский массив индексов цветов фрейма.
   */
  function extractFramePixels(image, fx, fy, sw, sh) {
    const pixels = [];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        pixels.push(image.pixels[(fy + y) * image.width + (fx + x)]);
      }
    }
    return pixels;
  }

  /**
   * Экспортирует лист спрайтов в текст файла .ASM с меткой для
   * каждого фрейма: PLAYER_FRAME1, PLAYER_FRAME2, ...
   *
   * Пример результата:
   *
   *   ; Размер: 64x32
   *   ; Спрайтов: 8 (16x16)
   *   PLAYER_FRAME1:
   *       .BYTE ...
   *   PLAYER_FRAME2:
   *       .BYTE ...
   *
   * @param {Object} image - модель листа спрайтов (BKGraphicsModel или
   *   объект { mode, width, height, pixels }).
   * @param {Object} [options] - настройки экспорта (см. exportToAsm).
   * @param {Object} grid - сетка фреймов:
   *   { cols, rows, spriteWidth, spriteHeight, count, symbolPrefix }.
   * @returns {string} текст файла .ASM.
   */
  function exportSpritesToAsm(image, options, grid) {
    const opts = resolveOptionsNoSymbol(options);
    const lines = [];
    if (opts.sizeComment) {
      lines.push('; Размер: ' + image.width + 'x' + image.height);
    }
    lines.push('; Спрайтов: ' + grid.count + ' (' +
      grid.spriteWidth + 'x' + grid.spriteHeight + ')');
    for (let frame = 0; frame < grid.count; frame++) {
      const fx = (frame % grid.cols) * grid.spriteWidth;
      const fy = Math.floor(frame / grid.cols) * grid.spriteHeight;
      const frameImage = {
        mode: image.mode,
        width: grid.spriteWidth,
        height: grid.spriteHeight,
        pixels: extractFramePixels(image, fx, fy, grid.spriteWidth, grid.spriteHeight)
      };
      const sym = grid.symbolPrefix + '_FRAME' + (frame + 1);
      lines.push(sym + ':');
      const bytes = global.BKGraphicsCodec.encode(frameImage);
      lines.push.apply(lines, formatDataBlock(frameImage, bytes, opts));
    }
    return lines.join(opts.newLine);
  }

  /**
   * Экспортирует лист спрайтов в текст файла .MAC.
   * Содержимое идентично .ASM (отличается только расширением).
   *
   * @param {Object} image - модель листа спрайтов.
   * @param {Object} [options] - настройки экспорта (см. exportSpritesToAsm).
   * @param {Object} grid - сетка фреймов (см. exportSpritesToAsm).
   * @returns {string} текст файла .MAC.
   */
  function exportSpritesToMac(image, options, grid) {
    return exportSpritesToAsm(image, options, grid);
  }

  // Экспонирование API в глобальную область.
  global.BKGraphicsExport = {
    exportToAsm: exportToAsm,
    exportToMac: exportToMac,
    exportSpritesToAsm: exportSpritesToAsm,
    exportSpritesToMac: exportSpritesToMac,
    formatByteValue: formatByteValue
  };
})(typeof window !== 'undefined' ? window : this);
