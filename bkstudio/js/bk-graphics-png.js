/**
 * BKStudio - BK Graphics PNG
 *
 * Чистый модуль (без UI) для импорта/экспорта PNG в/из BK Graphics.
 *
 * PNG — только входная/выходная точка, НЕ внутренний формат:
 * изображение внутри приложения остаётся набором индексов цветов
 * и палитры (BKGraphicsModel). Байтовое представление экрана
 * (bk-graphics-codec.js) здесь не используется и не затрагивается.
 *
 * Экспорт: индексы пикселей → выбранная палитра БК → RGBA → canvas → PNG.
 * Импорт:  PNG → canvas → RGBA → ближайший цвет выбранной палитры БК.
 *
 * Если PNG содержит цвета, отсутствующие в палитре БК:
 *   - определяется количество цветов;
 *   - формируется информация о преобразовании (formatConversionInfo);
 *   - каждому цвету подбирается ближайший цвет палитры;
 *   - исходный файл не изменяется (производится только чтение).
 *
 * Внешние библиотеки не используются — только браузерные API:
 * canvas 2D, ImageData, createImageBitmap / Image, Blob, URL.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Разбирает hex-цвет '#RRGGBB' (или 'RRGGBB') в компоненты.
   * @param {string} hex - цвет в hex-записи.
   * @returns {{r: number, g: number, b: number}}
   * @throws {Error} если строка не является hex-цветом.
   */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex));
    if (!m) {
      throw new Error('Некорректный цвет: ' + String(hex));
    }
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }

  /**
   * Преобразует RGB в строку '#rrggbb'.
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @returns {string}
   */
  function rgbToHex(r, g, b) {
    return ('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')).toUpperCase();
  }

  /**
   * Индекс ближайшего цвета палитры (квадрат евклидова расстояния в RGB,
   * при равенстве расстояний выбирается первый в палитре).
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {string[]} palette - цвета палитры в hex.
   * @returns {number} индекс цвета в палитре.
   */
  function findNearestColorIndex(r, g, b, palette) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = hexToRgb(palette[i]);
      const dr = c.r - r;
      const dg = c.g - g;
      const db = c.b - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  /**
   * Квантует RGBA-пиксели в индексы выбранной палитры (ближайший цвет).
   * Исходные данные не изменяются.
   *
   * @param {Uint8ClampedArray|Uint8Array|Array} rgba - RGBA, длина width*height*4.
   * @param {number} width - ширина в пикселях.
   * @param {number} height - высота в пикселях.
   * @param {string[]} palette - цвета палитры в hex.
   * @returns {{pixels: number[], info: Object}} индексы цветов и информация
   *   о преобразовании:
   *   - width, height, totalPixels;
   *   - sourceColors — количество различных цветов на входе;
   *   - inPaletteColors — сколько из них есть в палитре БК;
   *   - convertedColors — сколько цветов вне палитры;
   *   - convertedPixels — сколько пикселей переведено в ближайший цвет;
   *   - colors — список цветов { hex, count, inPalette, index, mappedHex }.
   */
  function quantizeImage(rgba, width, height, palette) {
    if (!rgba || rgba.length < width * height * 4) {
      throw new Error('Недостаточно RGBA-данных');
    }
    const paletteRgb = palette.map(hexToRgb);
    const paletteIndexByKey = {};
    paletteRgb.forEach((c, i) => {
      paletteIndexByKey[c.r + ',' + c.g + ',' + c.b] = i;
    });

    const sourceColors = Object.create(null);
    const colorsOrder = [];
    const pixels = new Array(width * height);
    let convertedPixels = 0;

    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3];
      if (a !== undefined && a < 128) {
        pixels[i] = 0;
        continue;
      }
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const key = r + ',' + g + ',' + b;
      let color = sourceColors[key];
      if (!color) {
        const inPalette = (key in paletteIndexByKey);
        color = {
          r: r,
          g: g,
          b: b,
          hex: rgbToHex(r, g, b),
          count: 0,
          inPalette: inPalette,
          index: inPalette
            ? paletteIndexByKey[key]
            : findNearestColorIndex(r, g, b, palette)
        };
        sourceColors[key] = color;
        colorsOrder.push(color);
      }
      color.count++;
      pixels[i] = color.index;
      if (!color.inPalette) {
        convertedPixels++;
      }
    }

    const convertedColors = colorsOrder.filter((c) => !c.inPalette).length;
    const info = {
      width: width,
      height: height,
      totalPixels: width * height,
      sourceColors: colorsOrder.length,
      inPaletteColors: colorsOrder.length - convertedColors,
      convertedColors: convertedColors,
      convertedPixels: convertedPixels,
      colors: colorsOrder.map((c) => ({
        hex: c.hex,
        count: c.count,
        inPalette: c.inPalette,
        index: c.index,
        mappedHex: palette[c.index]
      }))
    };
    return { pixels: pixels, info: info };
  }

  /**
   * Форматирует информацию о преобразовании в человекочитаемый текст
   * (для показа пользователю при импорте).
   * @param {Object} info - информация из quantizeImage.
   * @returns {string}
   */
  function formatConversionInfo(info) {
    const lines = [];
    lines.push('Цвета в PNG: ' + info.sourceColors);
    if (info.convertedColors > 0) {
      lines.push('Цвета вне палитры БК: ' + info.convertedColors +
        ', переведено пикселей: ' + info.convertedPixels + ' из ' + info.totalPixels);
      info.colors.forEach((c) => {
        if (!c.inPalette) {
          lines.push('  ' + c.hex + ' (' + c.count + ' пикс.) → ' + c.mappedHex);
        }
      });
    } else {
      lines.push('Все цвета присутствуют в палитре БК, конвертация не потребовалась');
    }
    return lines.join('\n');
  }

  /**
   * Строит RGBA-массив из индексов цветов и палитры (для экспорта).
   * @param {Object} image - изображение (BKGraphicsModel или
   *   объект { width, height, pixels }).
   * @param {string[]} [palette] - палитра в hex; по умолчанию image.palette.
   * @returns {Uint8ClampedArray} RGBA-данные.
   */
  function imageToRgba(image, palette) {
    const width = image.width;
    const height = image.height;
    const pixels = image.pixels;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error('Некорректные размеры изображения');
    }
    palette = palette || image.palette;
    if (!palette || !palette.length) {
      throw new Error('Не задана палитра');
    }
    if (!pixels || pixels.length !== width * height) {
      throw new Error('Массив пикселей должен иметь длину width * height');
    }
    const paletteRgb = palette.map(hexToRgb);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const index = pixels[i];
      if (!Number.isInteger(index) || index < 0 || index >= paletteRgb.length) {
        throw new Error('Недопустимый индекс цвета: ' + String(index));
      }
      const c = paletteRgb[index];
      rgba[i * 4] = c.r;
      rgba[i * 4 + 1] = c.g;
      rgba[i * 4 + 2] = c.b;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  /**
   * Экспортирует изображение в PNG (Blob) через canvas.
   * Индексы пикселей переводятся в цвета выбранной палитры БК.
   *
   * @param {Object} image - изображение (BKGraphicsModel или
   *   объект { width, height, pixels }).
   * @param {string[]} [palette] - палитра в hex; по умолчанию image.palette.
   * @returns {Promise<Blob>} PNG-файл.
   */
  function exportToPng(image, palette) {
    const rgba = imageToRgba(image, palette);
    const canvas = global.document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new global.ImageData(rgba, image.width, image.height), 0, 0);
    return new Promise((resolve, reject) => {
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
   * Превращает File/Blob/ArrayBuffer/TypedArray в Blob.
   * @param {*} source
   * @returns {Blob}
   */
  function toBlob(source) {
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      return new Blob([source], { type: 'image/png' });
    }
    return source;
  }

  /**
   * Читает PNG и возвращает ImageData через canvas.
   * @param {*} source - File, Blob, ArrayBuffer или TypedArray.
   * @returns {Promise<ImageData>}
   */
  function loadPngToImageData(source) {
    const blob = toBlob(source);
    if (typeof global.createImageBitmap === 'function') {
      return global.createImageBitmap(blob).then((bitmap) => {
        const canvas = global.document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      });
    }
    // Запасной путь для браузеров без createImageBitmap
    return new Promise((resolve, reject) => {
      const url = global.URL.createObjectURL(blob);
      const img = new global.Image();
      img.onload = function () {
        const canvas = global.document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        global.URL.revokeObjectURL(url);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = function () {
        global.URL.revokeObjectURL(url);
        reject(new Error('Не удалось прочитать PNG'));
      };
      img.src = url;
    });
  }

  /**
   * Импортирует PNG в индексы цветов выбранной палитры БК.
   * Исходный файл не изменяется (только чтение).
   *
   * @param {*} source - File, Blob, ArrayBuffer или TypedArray с PNG.
   * @param {string[]} palette - палитра БК в hex (например, из BKGraphicsModes).
   * @returns {Promise<{width: number, height: number, pixels: number[], info: Object}>}
   *   индексы цветов 0..palette.length-1 и информация о преобразовании
   *   (см. quantizeImage).
   */
  function importFromPng(source, palette) {
    if (!palette || !palette.length) {
      return Promise.reject(new Error('Не задана палитра'));
    }
    return loadPngToImageData(source).then((imageData) => {
      const result = quantizeImage(imageData.data, imageData.width, imageData.height, palette);
      return {
        width: imageData.width,
        height: imageData.height,
        pixels: result.pixels,
        info: result.info
      };
    });
  }

  // Экспонирование API в глобальную область.
  global.BKGraphicsPng = {
    exportToPng: exportToPng,
    importFromPng: importFromPng,
    imageToRgba: imageToRgba,
    quantizeImage: quantizeImage,
    findNearestColorIndex: findNearestColorIndex,
    formatConversionInfo: formatConversionInfo,
    hexToRgb: hexToRgb
  };
})(typeof window !== 'undefined' ? window : this);
