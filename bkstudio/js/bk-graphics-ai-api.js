/**
 * BKStudio - BK Graphics AI API
 *
 * Специализированный программный API для безопасной работы AI-ассистента
 * с графикой семейства компьютеров Электроника БК (БК-0010 / БК-0011М).
 *
 * Архитектурные правила и безопасность:
 *   - AI не имеет прямого доступа к DOM, Canvas, window, document или внутренностям BKGraphicsEditor;
 *   - Запрещены вызовы eval и произвольный JavaScript;
 *   - Все операции выполняются в памяти над BKGraphicsModel;
 *   - Экспорт использует исключительно BKGraphicsCodec и BKGraphicsExport (без собственной упаковки бит);
 *   - Добавление в проект выполняется через существующий bkProject (BKProjectManager);
 *   - Ограничение размера передаваемых в AI массивов пикселей (защита контекста LLM).
 *
 * Поддерживаемые операции:
 *   - graphics.create
 *   - graphics.get
 *   - graphics.set_pixel
 *   - graphics.set_pixels
 *   - graphics.fill
 *   - graphics.clear
 *   - graphics.resize
 *   - graphics.rotate90
 *   - graphics.get_info
 *   - graphics.get_region
 *   - graphics.export_asm
 *   - graphics.export_mac
 *   - graphics.export_bin
 *   - graphics.export_dat
 *   - graphics.export_bks
 *   - graphics.export_png
 *   - graphics.save_state
 *   - graphics.add_to_project
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  const MAX_REGION_PIXELS = 4096; // Например, до 64x64

  /**
   * Ограничения на ASCII Matrix в AI API для защиты от случайной передачи мегабайтов текста:
   *   - MAX_MATRIX_CHARS: 150000 символов (достаточно для 512x256 + переносы строк)
   *   - MAX_MATRIX_WIDTH: 512 колонок (максимальное разрешение БК в ч/б режиме)
   *   - MAX_MATRIX_HEIGHT: 256 строк (максимальное разрешение БК по вертикали)
   *   - MAX_PATCH_WIDTH / MAX_PATCH_HEIGHT: 128x128 (максимальный размер точечного патча)
   */
  const MAX_MATRIX_CHARS = 150000;
  const MAX_MATRIX_WIDTH = 512;
  const MAX_MATRIX_HEIGHT = 256;
  const MAX_PATCH_WIDTH = 128;
  const MAX_PATCH_HEIGHT = 128;

  /**
   * Вспомогательное объединение путей проекта
   * @param {string} folder
   * @param {string} file
   * @returns {string}
   */
  function joinProjectPath(folder, file) {
    const f = String(folder || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
    const cleanFile = String(file || '').trim().replace(/^[\\/]+/, '');
    return f ? f + '/' + cleanFile : cleanFile;
  }

  /**
   * Разбирает hex-цвет в компоненты { r, g, b }
   * @param {string} hex
   * @returns {{r: number, g: number, b: number}}
   */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) {
      return { r: 0, g: 0, b: 0 };
    }
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }

  /**
   * Переводит пиксели модели БК в RGBA с учетом масштаба (чистый JS без canvas)
   * @param {Object} model - BKGraphicsModel
   * @param {number} [scale=1] - Масштаб (1..16)
   * @returns {Uint8Array}
   */
  function renderModelToRgba(model, scale = 1) {
    const w = model.width;
    const h = model.height;
    const palette = (model.palette && model.palette.length)
      ? model.palette
      : ['#000000', '#0000FF', '#00FF00', '#FF0000'];
    const paletteRgb = palette.map(hexToRgb);

    const s = Math.max(1, Math.min(16, Math.floor(scale) || 1));
    const outW = w * s;
    const outH = h * s;
    const rgba = new Uint8Array(outW * outH * 4);

    if (s === 1) {
      for (let i = 0; i < w * h; i++) {
        const pIndex = (model.pixels && model.pixels[i] !== undefined)
          ? model.pixels[i]
          : (model.getPixel ? model.getPixel(i % w, Math.floor(i / w)) : 0);
        const c = paletteRgb[pIndex] || paletteRgb[0];
        const off = i * 4;
        rgba[off] = c.r;
        rgba[off + 1] = c.g;
        rgba[off + 2] = c.b;
        rgba[off + 3] = 255;
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const pIndex = (model.pixels && model.pixels[y * w + x] !== undefined)
            ? model.pixels[y * w + x]
            : (model.getPixel ? model.getPixel(x, y) : 0);
          const c = paletteRgb[pIndex] || paletteRgb[0];
          for (let sy = 0; sy < s; sy++) {
            const rowOff = ((y * s + sy) * outW + x * s) * 4;
            for (let sx = 0; sx < s; sx++) {
              const off = rowOff + sx * 4;
              rgba[off] = c.r;
              rgba[off + 1] = c.g;
              rgba[off + 2] = c.b;
              rgba[off + 3] = 255;
            }
          }
        }
      }
    }
    return rgba;
  }

  const pngCrcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    pngCrcTable[n] = c >>> 0;
  }

  function pngCrc32(buf, offset, length) {
    let c = 0xFFFFFFFF;
    const end = (offset || 0) + (length !== undefined ? length : buf.length);
    for (let i = offset || 0; i < end; i++) {
      c = (c >>> 8) ^ pngCrcTable[(c ^ buf[i]) & 0xFF];
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function pngAdler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /**
   * Чистый JS энкодер PNG без зависимостей от canvas или внешних библиотек
   * @param {number} w - ширина
   * @param {number} h - высота
   * @param {Uint8Array} rgba - RGBA данные (w * h * 4)
   * @returns {Uint8Array} Бинарные байты стандартного PNG файла
   */
  function encodePng(w, h, rgba) {
    const stride = w * 4;
    const raw = new Uint8Array(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0; // Filter 0: None
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }

    const adler = pngAdler32(raw);
    const maxBlock = 65535;
    const numBlocks = Math.ceil(raw.length / maxBlock) || 1;
    const idatData = new Uint8Array(2 + numBlocks * 5 + raw.length + 4);
    idatData[0] = 0x78;
    idatData[1] = 0x01; // zlib header
    let offset = 2;
    for (let i = 0; i < numBlocks; i++) {
      const start = i * maxBlock;
      const end = Math.min(start + maxBlock, raw.length);
      const len = end - start;
      idatData[offset++] = (i === numBlocks - 1) ? 1 : 0;
      idatData[offset++] = len & 0xFF;
      idatData[offset++] = (len >> 8) & 0xFF;
      const nlen = (~len) & 0xFFFF;
      idatData[offset++] = nlen & 0xFF;
      idatData[offset++] = (nlen >> 8) & 0xFF;
      idatData.set(raw.subarray(start, end), offset);
      offset += len;
    }
    idatData[offset++] = (adler >>> 24) & 0xFF;
    idatData[offset++] = (adler >>> 16) & 0xFF;
    idatData[offset++] = (adler >>> 8) & 0xFF;
    idatData[offset++] = adler & 0xFF;

    function makeChunk(type, data) {
      const len = data.length;
      const res = new Uint8Array(12 + len);
      const dv = new DataView(res.buffer);
      dv.setUint32(0, len);
      for (let i = 0; i < 4; i++) {
        res[4 + i] = type.charCodeAt(i);
      }
      res.set(data, 8);
      const c = pngCrc32(res, 4, 4 + len);
      dv.setUint32(8 + len, c);
      return res;
    }

    const ihdr = new Uint8Array(13);
    const ihdrDv = new DataView(ihdr.buffer);
    ihdrDv.setUint32(0, w);
    ihdrDv.setUint32(4, h);
    ihdr[8] = 8; // 8 бит на канал
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0; // Deflate
    ihdr[11] = 0; // Adaptive filter
    ihdr[12] = 0; // Non-interlaced

    const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const cIhdr = makeChunk('IHDR', ihdr);
    const cIdat = makeChunk('IDAT', idatData);
    const cIend = makeChunk('IEND', new Uint8Array(0));

    const totalLen = sig.length + cIhdr.length + cIdat.length + cIend.length;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    out.set(sig, pos); pos += sig.length;
    out.set(cIhdr, pos); pos += cIhdr.length;
    out.set(cIdat, pos); pos += cIdat.length;
    out.set(cIend, pos); pos += cIend.length;
    return out;
  }

  /**
   * Класс безопасного графического API для AI
   */
  class BKGraphicsAIApi {
    /**
     * @param {Object} [deps] - Зависимости для тестирования или внедрения
     */
    constructor(deps = {}) {
      this._deps = deps;
      /** @type {Object<string, Object>} Коллекция поименованных моделей */
      this._models = new Map();
      /** @type {Object|null} Активная рабочая модель */
      this._activeModel = null;
    }

    // --- Доступ к зависимостям с fallback на глобальные объекты ---

    _getModelClass() {
      return this._deps.BKGraphicsModel || global.BKGraphicsModel || null;
    }

    _getCodec() {
      return this._deps.BKGraphicsCodec || global.BKGraphicsCodec || null;
    }

    _getExport() {
      return this._deps.BKGraphicsExport || global.BKGraphicsExport || null;
    }

    _getModes() {
      return this._deps.BKGraphicsModes || global.BKGraphicsModes || null;
    }

    _getEditor() {
      return this._deps.BKGraphicsEditor || global.BKGraphicsEditor || null;
    }

    _getProject() {
      return this._deps.bkProject || global.bkProject || null;
    }

    /**
     * Возвращает активную модель или модель по имени
     * @param {string} [name]
     * @returns {Object}
     */
    _resolveModel(name) {
      if (name && typeof name === 'string' && this._models.has(name.trim())) {
        return this._models.get(name.trim());
      }
      if (this._activeModel) {
        return this._activeModel;
      }
      throw new Error('Активное изображение не создано. Сначала вызовите graphics.create.');
    }

    /**
     * Возвращает экземпляр активной модели BKGraphicsModel
     * @returns {Object|null}
     */
    getActiveModel() {
      return this._activeModel || null;
    }

    /**
     * Возвращает экземпляр модели BKGraphicsModel по имени
     * @param {string} name
     * @returns {Object|null}
     */
    getModel(name) {
      return this._models.get(name) || null;
    }

    /**
     * Создает новое изображение в памяти
     * @param {Object} params
     * @param {string} [params.mode='BK0010_COLOR'] - Режим: BK0010_MONO, BK0010_COLOR или BK0011M_COLOR
     * @param {number} [params.width] - Ширина (1..512)
     * @param {number} [params.height] - Высота (1..256)
     * @param {number} [params.paletteIndex=0] - Индекс палитры для BK0011M_COLOR (0..15)
     * @param {string} [params.name='IMAGE'] - Имя изображения / символа
     * @returns {Object}
     */
    create(params = {}) {
      const ModelClass = this._getModelClass();
      if (!ModelClass) {
        throw new Error('Модуль BKGraphicsModel не загружен.');
      }

      // 1. Определение целевого имени создаваемого объекта
      let targetName = 'IMAGE';
      if (params.name) {
        targetName = String(params.name).trim();
      } else if (params.copyFrom && typeof params.copyFrom === 'string' && params.copyFrom !== 'true') {
        targetName = params.copyFrom.trim() + '_COPY';
      }

      // 2. Защита от случайной перезаписи: если объект уже существует, вернуть ошибку ERROR_ALREADY_EXISTS
      if (this._models.has(targetName)) {
        throw new Error(`ERROR_ALREADY_EXISTS: graphics "${targetName}" already exists. Use graphics.set to replace its contents.`);
      }

      // 3. Клонирование существующей модели (copyFrom)
      if (params.copyFrom) {
        let source = null;
        if (typeof params.copyFrom === 'string' && params.copyFrom !== 'true') {
          const sourceName = params.copyFrom.trim();
          source = this._models.get(sourceName);
          if (!source) {
            throw new Error(`ERROR_NOT_FOUND: source graphics "${params.copyFrom}" not found.`);
          }
        } else {
          source = this._activeModel;
          if (!source) {
            throw new Error('ERROR_NOT_FOUND: no active graphics to copy from.');
          }
        }

        const copy = source.clone();
        copy.name = targetName;
        if (params.mode && (params.mode === 'BK0010_MONO' || params.mode === 'BK0010_COLOR' || params.mode === 'BK0011M_COLOR')) {
          copy.mode = params.mode;
        }
        if (Number.isInteger(params.paletteIndex) && copy.mode === 'BK0011M_COLOR') {
          copy.setPalette(params.paletteIndex);
        }
        this._activeModel = copy;
        this._models.set(targetName, copy);
        return {
          success: true,
          name: copy.name,
          mode: copy.mode,
          width: copy.width,
          height: copy.height,
          bitsPerPixel: copy.bitsPerPixel,
          colors: copy.maxColors,
          paletteIndex: copy.paletteIndex,
          palette: copy.getPalette(),
          copiedFrom: source.name
        };
      }

      const mode = params.mode || 'BK0010_COLOR';
      if (mode !== 'BK0010_MONO' && mode !== 'BK0010_COLOR' && mode !== 'BK0011M_COLOR') {
        throw new Error(`Недопустимый графический режим: "${mode}". Допустимы: BK0010_MONO, BK0010_COLOR, BK0011M_COLOR.`);
      }

      let width = params.width;
      let height = params.height;
      if (width === undefined || width === null) {
        width = (mode === 'BK0010_MONO') ? 512 : 256;
      }
      if (height === undefined || height === null) {
        height = 256;
      }

      if (!Number.isInteger(width) || width < 1 || width > 512) {
        throw new Error(`Ширина должна быть целым числом от 1 до 512 (передано: ${width}).`);
      }
      if (!Number.isInteger(height) || height < 1 || height > 256) {
        throw new Error(`Высота должна быть целым числом от 1 до 256 (передано: ${height}).`);
      }

      let paletteIndex = 0;
      if (mode === 'BK0011M_COLOR') {
        paletteIndex = Number.isInteger(params.paletteIndex) ? params.paletteIndex : 0;
        if (paletteIndex < 0 || paletteIndex > 15) {
          throw new Error(`Индекс палитры БК-0011М должен быть в диапазоне 0..15 (передано: ${paletteIndex}).`);
        }
      }

      const model = new ModelClass({
        mode: mode,
        width: width,
        height: height,
        paletteIndex: paletteIndex,
        name: targetName
      });

      this._activeModel = model;
      this._models.set(targetName, model);

      return {
        success: true,
        message: `OK\ncreated ${model.width}x${model.height} ${model.mode}`,
        name: targetName,
        mode: model.mode,
        width: model.width,
        height: model.height,
        colors: model.maxColors,
        paletteIndex: model.paletteIndex
      };
    }

    /**
     * Возвращает изображение в виде компактной ASCII-матрицы
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object} { success, name, width, height, mode, matrix, text }
     */
    get(params = {}) {
      const model = this._resolveModel(params.name);
      const matrix = pixelsToMatrix(model.pixels, model.width, model.height, model);
      return {
        success: true,
        name: model.name,
        width: model.width,
        height: model.height,
        mode: model.mode,
        matrix: matrix
      };
    }

    /**
     * Возвращает подробную техническую информацию об изображении (метаданные без пикселей)
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object}
     */
    getInfo(params = {}) {
      const model = this._resolveModel(params.name);
      const Codec = this._getCodec();

      const bytesPerRow = Codec ? Codec.getBytesPerRow(model.width, model.mode) : Math.ceil((model.width * model.bitsPerPixel) / 8);
      const totalBytes = Codec ? Codec.getEncodedSize(model.width, model.height, model.mode) : bytesPerRow * model.height;

      return {
        success: true,
        name: model.name,
        width: model.width,
        height: model.height,
        mode: model.mode,
        palette: model.getPalette(),
        paletteIndex: model.paletteIndex,
        bitsPerPixel: model.bitsPerPixel,
        colors: model.maxColors,
        bytesPerRow: bytesPerRow,
        totalBytes: totalBytes,
        pixelCount: model.getPixelCount(),
        text: `width: ${model.width}\nheight: ${model.height}\nmode: ${model.mode}\npalette: ${model.getPalette().join(', ')}`
      };
    }

    /**
     * Алиас для getInfo: компактные метаданные без пикселей
     * @param {Object} [params]
     * @returns {Object}
     */
    info(params = {}) {
      return this.getInfo(params);
    }

    /**
     * Устанавливает или заменяет изображение с помощью ASCII Matrix.
     * Операция строго атомарна: если матрица невалидна или выходит за границы,
     * модель не изменяется.
     *
     * @param {Object} params
     * @param {string} params.matrix - Текстовая ASCII-матрица (обязательна).
     * @param {number} [params.x=0] - Начальная координата X.
     * @param {number} [params.y=0] - Начальная координата Y.
     * @param {string} [params.name] - Имя модели (опционально).
     * @param {string} [params.mode] - Режим БК (если создается новая модель).
     * @returns {{ success: boolean, width: number, height: number, changed: number, message: string }}
     */
    set(params = {}) {
      if (!params || typeof params.matrix !== 'string') {
        throw new Error('Параметр matrix обязателен и должен быть строкой ASCII-матрицы.');
      }

      let model = null;
      let modelMode = (params && params.mode) ? params.mode : 'BK0010_COLOR';
      if (params.name && typeof params.name === 'string' && this._models.has(params.name.trim())) {
        model = this._models.get(params.name.trim());
        modelMode = model.mode || modelMode;
      } else if (!params.name && this._activeModel) {
        model = this._activeModel;
        modelMode = model.mode || modelMode;
      }

      // 1. Валидация матрицы ДО любых изменений и ДО создания модели (атомарность)
      const validation = validateMatrix(params.matrix, params.width, params.height, model || modelMode);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const w = validation.width;
      const h = validation.height;
      const x = Number.isInteger(params.x) ? params.x : 0;
      const y = Number.isInteger(params.y) ? params.y : 0;

      // 2. Проверка границ холста ДО записи (атомарность)
      if (model) {
        if (x < 0 || x + w > model.width || y < 0 || y + h > model.height) {
          throw new Error(`ERROR: matrix dimensions (${w}x${h}) at (${x},${y}) exceed image bounds (${model.width}x${model.height})`);
        }
      }

      // 3. Преобразование матрицы в индексы цветов ДО любых изменений модели
      const parsedPixels = matrixToPixels(params.matrix, model || modelMode, { width: w, height: h });

      // Если модели еще не было, создаем ее ТОЛЬКО после 100% успешной валидации и конверсии
      if (!model) {
        this.create({
          name: params.name || 'IMAGE',
          mode: modelMode,
          width: w,
          height: h
        });
        model = this._resolveModel(params.name);
      }

      // 4. Запись в существующий BKGraphicsModel
      let writtenCount = 0;

      for (let r = 0; r < h; r++) {
        const rowOffset = r * w;
        for (let c = 0; c < w; c++) {
          const color = parsedPixels[rowOffset + c];
          writtenCount++;
          model.setPixel(x + c, y + r, color);
        }
      }

      return {
        success: true,
        width: w,
        height: h,
        changed: writtenCount,
        message: `OK\n${w}x${h}\nchanged: ${writtenCount} pixels`
      };
    }

    /**
     * Точечно изменяет прямоугольную область изображения через ASCII-матрицу.
     * Размеры области определяются из matrix.
     * Операция строго атомарна: если патч выходит за границы или матрица невалидна, модель не изменяется.
     *
     * @param {Object} params
     * @param {number} params.x - Координата X левого верхнего угла.
     * @param {number} params.y - Координата Y левого верхнего угла.
     * @param {string} params.matrix - ASCII-матрица патча.
     * @param {string} [params.name] - Имя модели (опционально).
     * @returns {{ success: boolean, x: number, y: number, width: number, height: number, changed: number, message: string }}
     */
    patch(params = {}) {
      if (!params || typeof params.matrix !== 'string') {
        throw new Error('Параметр matrix обязателен и должен быть строкой ASCII-матрицы.');
      }
      if (!Number.isInteger(params.x) || !Number.isInteger(params.y)) {
        throw new Error('Параметры x и y обязательны и должны быть целыми числами.');
      }

      const model = this._resolveModel(params.name);

      // 1. Валидация матрицы ДО любых изменений (атомарность)
      const validation = validateMatrix(params.matrix, null, null, model);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const w = validation.width;
      const h = validation.height;
      const x = params.x;
      const y = params.y;

      // Ограничение максимального размера патча для AI API (до 128x128)
      if (w > MAX_PATCH_WIDTH || h > MAX_PATCH_HEIGHT) {
        throw new Error(`ERROR: patch dimensions (${w}x${h}) exceed maximum patch limit (${MAX_PATCH_WIDTH}x${MAX_PATCH_HEIGHT}). Use graphics.set to replace larger areas.`);
      }

      // 2. Проверка границ холста ДО записи (атомарность, не обрезать автоматически)
      if (x < 0 || y < 0 || x + w > model.width || y + h > model.height) {
        throw new Error(`ERROR: patch ${w}x${h} at (${x},${y}) exceeds image ${model.width}x${model.height}`);
      }

      // 3. Преобразование матрицы в индексы цветов ДО записи
      const parsedPixels = matrixToPixels(params.matrix, model, { width: w, height: h });

      // 4. Запись в существующий BKGraphicsModel
      let writtenCount = 0;
      for (let r = 0; r < h; r++) {
        const rowOffset = r * w;
        for (let c = 0; c < w; c++) {
          const color = parsedPixels[rowOffset + c];
          writtenCount++;
          model.setPixel(x + c, y + r, color);
        }
      }

      return {
        success: true,
        x: x,
        y: y,
        width: w,
        height: h,
        changed: writtenCount,
        message: `OK\npatched ${w}x${h} at ${x},${y}\nchanged: ${writtenCount} pixels`
      };
    }

    /**
     * Устанавливает цвет одного пикселя
     * @param {Object} params
     * @param {number} params.x
     * @param {number} params.y
     * @param {number} params.colorIndex
     * @param {string} [params.name]
     * @returns {Object}
     */
    setPixel(params = {}) {
      const model = this._resolveModel(params.name);

      const x = params.x;
      const y = params.y;
      const colorIndex = params.colorIndex;

      if (!Number.isInteger(x) || x < 0 || x >= model.width) {
        throw new Error(`Координата x вне границ [0..${model.width - 1}]: ${x}`);
      }
      if (!Number.isInteger(y) || y < 0 || y >= model.height) {
        throw new Error(`Координата y вне границ [0..${model.height - 1}]: ${y}`);
      }
      if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= model.maxColors) {
        throw new Error(`Индекс цвета colorIndex должен быть в диапазоне 0..${model.maxColors - 1} (передано: ${colorIndex}).`);
      }

      const ok = model.setPixel(x, y, colorIndex);
      if (!ok) {
        throw new Error(`Не удалось установить пиксель (${x}, ${y}) = ${colorIndex}.`);
      }

      return {
        success: true,
        x: x,
        y: y,
        colorIndex: colorIndex
      };
    }

    /**
     * Устанавливает блок пикселей (2D-массив строк или плоский массив)
     * @param {Object} params
     * @param {number} [params.x=0]
     * @param {number} [params.y=0]
     * @param {number} params.width
     * @param {number} params.height
     * @param {Array<number>|Array<Array<number>>} params.pixels
     * @param {string} [params.name]
     * @returns {Object}
     */
    setPixels(params = {}) {
      const model = this._resolveModel(params.name);

      const x = Number.isInteger(params.x) ? params.x : 0;
      const y = Number.isInteger(params.y) ? params.y : 0;
      let width = params.width;
      let height = params.height;
      let rawPixels = params.pixels;

      // Поддержка ASCII Matrix (строка текста) в параметре matrix или pixels
      if (typeof params.matrix === 'string' || typeof rawPixels === 'string') {
        const matrixStr = typeof params.matrix === 'string' ? params.matrix : rawPixels;
        const parsed = matrixToPixels(matrixStr, model, { width, height });
        width = parsed.width;
        height = parsed.height;
        rawPixels = parsed;
      }

      // Автоматическое определение width и height для 2D-массива строк, если не переданы
      if (Array.isArray(rawPixels) && rawPixels.length > 0 && Array.isArray(rawPixels[0])) {
        if (!Number.isInteger(height) || height <= 0) {
          height = rawPixels.length;
        }
        if (!Number.isInteger(width) || width <= 0) {
          width = rawPixels[0].length;
        }
      }

      if (!Number.isInteger(width) || width <= 0) {
        throw new Error('Параметр width должен быть положительным целым числом.');
      }
      if (!Number.isInteger(height) || height <= 0) {
        throw new Error('Параметр height должен быть положительным целым числом.');
      }
      if (x < 0 || x + width > model.width || y < 0 || y + height > model.height) {
        throw new Error(`Область (${x}, ${y}, ${width}x${height}) выходит за границы изображения (${model.width}x${model.height}).`);
      }
      if (!Array.isArray(rawPixels)) {
        throw new Error('Параметр pixels должен быть массивом или строкой ASCII matrix.');
      }

      let count = 0;
      // Случай 1: 2D-массив строк
      if (rawPixels.length > 0 && Array.isArray(rawPixels[0])) {
        if (rawPixels.length !== height) {
          throw new Error(`Высота массива pixels (${rawPixels.length}) не соответствует height (${height}).`);
        }
        for (let r = 0; r < height; r++) {
          const row = rawPixels[r];
          if (!Array.isArray(row) || row.length !== width) {
            throw new Error(`Строка ${r} массива pixels имеет длину ${row ? row.length : 0}, ожидалось ${width}.`);
          }
          for (let c = 0; c < width; c++) {
            const color = row[c];
            if (!Number.isInteger(color) || color < 0 || color >= model.maxColors) {
              throw new Error(`Недопустимый индекс цвета ${color} в позиции (${x + c}, ${y + r}). Допустимо: 0..${model.maxColors - 1}.`);
            }
            model.setPixel(x + c, y + r, color);
            count++;
          }
        }
      } else {
        // Случай 2: Плоский массив длины width * height
        const expected = width * height;
        if (rawPixels.length !== expected) {
          throw new Error(`Длина плоского массива pixels (${rawPixels.length}) не соответствует width*height (${expected}).`);
        }
        for (let r = 0; r < height; r++) {
          for (let c = 0; c < width; c++) {
            const color = rawPixels[r * width + c];
            if (!Number.isInteger(color) || color < 0 || color >= model.maxColors) {
              throw new Error(`Недопустимый индекс цвета ${color} в позиции (${x + c}, ${y + r}). Допустимо: 0..${model.maxColors - 1}.`);
            }
            model.setPixel(x + c, y + r, color);
            count++;
          }
        }
      }

      return {
        success: true,
        x: x,
        y: y,
        width: width,
        height: height,
        count: count
      };
    }

    /**
     * Заполняет цветом всё изображение или прямоугольную область
     * @param {Object} params
     * @param {number} params.colorIndex
     * @param {number} [params.x]
     * @param {number} [params.y]
     * @param {number} [params.width]
     * @param {number} [params.height]
     * @param {string} [params.name]
     * @returns {Object}
     */
    fill(params = {}) {
      const model = this._resolveModel(params.name);
      const colorIndex = params.colorIndex;

      if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= model.maxColors) {
        throw new Error(`Индекс цвета colorIndex должен быть в диапазоне 0..${model.maxColors - 1} (передано: ${colorIndex}).`);
      }

      // Полное заполнение
      if (params.x === undefined && params.y === undefined && params.width === undefined && params.height === undefined) {
        model.fill(colorIndex);
        return {
          success: true,
          filledCount: model.getPixelCount(),
          full: true
        };
      }

      // Заполнение прямоугольной области
      const x = Number.isInteger(params.x) ? params.x : 0;
      const y = Number.isInteger(params.y) ? params.y : 0;
      const width = Number.isInteger(params.width) ? params.width : (model.width - x);
      const height = Number.isInteger(params.height) ? params.height : (model.height - y);

      if (x < 0 || x + width > model.width || y < 0 || y + height > model.height || width <= 0 || height <= 0) {
        throw new Error(`Область заливки (${x}, ${y}, ${width}x${height}) выходит за границы изображения (${model.width}x${model.height}).`);
      }

      let count = 0;
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          model.setPixel(x + dx, y + dy, colorIndex);
          count++;
        }
      }

      return {
        success: true,
        x: x,
        y: y,
        width: width,
        height: height,
        colorIndex: colorIndex,
        filledCount: count
      };
    }

    /**
     * Очищает всё изображение указанным цветом (по умолчанию 0 - фон)
     * @param {Object} [params]
     * @param {number} [params.colorIndex=0]
     * @param {string} [params.name]
     * @returns {Object}
     */
    clear(params = {}) {
      const model = this._resolveModel(params.name);
      const colorIndex = Number.isInteger(params.colorIndex) ? params.colorIndex : 0;
      if (colorIndex < 0 || colorIndex >= model.maxColors) {
        throw new Error(`Индекс цвета очистки colorIndex должен быть в диапазоне 0..${model.maxColors - 1}.`);
      }
      model.clear(colorIndex);
      return {
        success: true,
        clearedColor: colorIndex,
        pixelCount: model.getPixelCount()
      };
    }

    /**
     * Изменяет размеры изображения
     * @param {Object} params
     * @param {number} params.width
     * @param {number} params.height
     * @param {number} [params.fillIndex=0]
     * @param {string} [params.name]
     * @returns {Object}
     */
    resize(params = {}) {
      const model = this._resolveModel(params.name);
      const width = params.width;
      const height = params.height;
      const fillIndex = Number.isInteger(params.fillIndex) ? params.fillIndex : 0;

      if (!Number.isInteger(width) || width < 1 || width > 512) {
        throw new Error(`Ширина должна быть целым числом от 1 до 512.`);
      }
      if (!Number.isInteger(height) || height < 1 || height > 256) {
        throw new Error(`Высота должна быть целым числом от 1 до 256.`);
      }

      model.resize(width, height, fillIndex);
      return {
        success: true,
        width: model.width,
        height: model.height
      };
    }

    /**
     * Поворачивает изображение на 90 градусов по часовой стрелке
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object}
     */
    rotate90(params = {}) {
      const model = this._resolveModel(params.name);
      model.rotate90();
      return {
        success: true,
        width: model.width,
        height: model.height
      };
    }

    /**
     * Считывает пиксели указанной области (с защитой от переполнения контекста LLM)
     * @param {Object} params
     * @param {number} params.x
     * @param {number} params.y
     * @param {number} params.width
     * @param {number} params.height
     * @param {string} [params.name]
     * @returns {Object}
     */
    getRegion(params = {}) {
      const model = this._resolveModel(params.name);

      const x = params.x;
      const y = params.y;
      const width = params.width;
      const height = params.height;

      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
        throw new Error('Параметры x, y, width, height обязательны и должны быть целыми числами.');
      }
      if (width <= 0 || height <= 0) {
        throw new Error('Ширина и высота области должны быть положительными.');
      }
      if (x < 0 || x + width > model.width || y < 0 || y + height > model.height) {
        throw new Error(`Область (${x}, ${y}, ${width}x${height}) выходит за границы изображения (${model.width}x${model.height}).`);
      }

      const totalPixels = width * height;
      if (totalPixels > MAX_REGION_PIXELS) {
        throw new Error(`Запрошенная область слишком велика (${totalPixels} пикселей, максимум ${MAX_REGION_PIXELS}). Запрашивайте фрагменты частями.`);
      }

      const regionPixels = new Array(totalPixels);
      let ptr = 0;
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          regionPixels[ptr++] = model.getPixel(x + dx, y + dy);
        }
      }

      const matrix = pixelsToMatrix(regionPixels, width, height, model);
      return {
        success: true,
        x: x,
        y: y,
        width: width,
        height: height,
        matrix: matrix
      };
    }

    /**
     * Экспорт в ассемблерный текст (.ASM)
     * @param {Object} [params]
     * @param {string} [params.symbol] - Метка символа (по умолчанию имя модели)
     * @param {number} [params.radix=8] - Система счисления (8, 10, 2)
     * @param {number} [params.bytesPerLine=8] - Количество байт в строке .BYTE
     * @param {boolean} [params.lineComments=false]
     * @param {boolean} [params.sizeComment=true]
     * @param {Object} [params.spriteGrid] - Сетка спрайтов { cols, rows, spriteWidth, spriteHeight, count, symbolPrefix }
     * @param {string} [params.name]
     * @returns {Object}
     */
    exportAsm(params = {}) {
      const model = this._resolveModel(params.name);
      const Export = this._getExport();
      if (!Export || typeof Export.exportToAsm !== 'function') {
        throw new Error('Модуль BKGraphicsExport не загружен.');
      }

      const options = {
        symbol: params.symbol || model.name || 'IMAGE',
        radix: params.radix || 8,
        bytesPerLine: params.bytesPerLine || 8,
        lineComments: Boolean(params.lineComments),
        sizeComment: params.sizeComment !== false,
        newLine: '\n'
      };

      let text = '';
      if (params.spriteGrid && typeof Export.exportSpritesToAsm === 'function') {
        text = Export.exportSpritesToAsm(model, options, params.spriteGrid);
      } else {
        text = Export.exportToAsm(model, options);
      }

      return {
        success: true,
        format: 'ASM',
        symbol: options.symbol,
        text: text,
        length: text.length
      };
    }

    /**
     * Экспорт в ассемблерный текст (.MAC)
     * @param {Object} [params]
     * @returns {Object}
     */
    exportMac(params = {}) {
      const model = this._resolveModel(params.name);
      const Export = this._getExport();
      if (!Export || typeof Export.exportToMac !== 'function') {
        throw new Error('Модуль BKGraphicsExport не загружен.');
      }

      const options = {
        symbol: params.symbol || model.name || 'IMAGE',
        radix: params.radix || 8,
        bytesPerLine: params.bytesPerLine || 8,
        lineComments: Boolean(params.lineComments),
        sizeComment: params.sizeComment !== false,
        newLine: '\n'
      };

      let text = '';
      if (params.spriteGrid && typeof Export.exportSpritesToMac === 'function') {
        text = Export.exportSpritesToMac(model, options, params.spriteGrid);
      } else {
        text = Export.exportToMac(model, options);
      }

      return {
        success: true,
        format: 'MAC',
        symbol: options.symbol,
        text: text,
        length: text.length
      };
    }

    /**
     * Экспорт полноэкранного изображения 256x256 в формат .BIN (16388 байт)
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object}
     */
    exportBin(params = {}) {
      const model = this._resolveModel(params.name);
      const Editor = this._getEditor();
      if (Editor && typeof Editor.exportBin === 'function') {
        const bytes = Editor.exportBin(model);
        return {
          success: true,
          format: 'BIN',
          byteLength: bytes.length,
          bytes: bytes
        };
      }

      // Fallback через Codec при изолированном вызове
      const Codec = this._getCodec();
      if (!Codec || typeof Codec.encode !== 'function') {
        throw new Error('Модуль BKGraphicsCodec не загружен.');
      }
      if (model.width !== 256 || model.height !== 256) {
        throw new Error(`Формат экрана .BIN требует размер 256x256 (текущий: ${model.width}x${model.height}).`);
      }
      const raw = Codec.encode(model);
      const bin = new Uint8Array(16388);
      bin[0] = 0x00; bin[1] = 0x40; // Адрес 0o40000
      bin[2] = 0x00; bin[3] = 0x40; // Длина 16384 байт
      bin.set(raw, 4);

      return {
        success: true,
        format: 'BIN',
        byteLength: bin.length,
        bytes: bin
      };
    }

    /**
     * Экспорт экрана в сырой дамп .DAT (16384 байт)
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object}
     */
    exportDat(params = {}) {
      const model = this._resolveModel(params.name);
      const Codec = this._getCodec();
      if (!Codec || typeof Codec.encode !== 'function') {
        throw new Error('Модуль BKGraphicsCodec не загружен.');
      }
      if (model.width !== 256 || model.height !== 256) {
        throw new Error(`Формат экрана .DAT требует размер 256x256 (текущий: ${model.width}x${model.height}).`);
      }
      const raw = Codec.encode(model);
      return {
        success: true,
        format: 'DAT',
        byteLength: raw.length,
        bytes: raw
      };
    }

    /**
     * Экспорт экрана в формат .BKS (16389 байт, BIN + 1 байт палитры)
     * @param {Object} [params]
     * @param {string} [params.name]
     * @returns {Object}
     */
    exportBks(params = {}) {
      const model = this._resolveModel(params.name);
      const binRes = this.exportBin(params);
      const bks = new Uint8Array(16389);
      bks.set(binRes.bytes, 0);
      bks[16388] = (model.paletteIndex || 0) & 0x0F;

      return {
        success: true,
        format: 'BKS',
        byteLength: bks.length,
        paletteIndex: model.paletteIndex || 0,
        bytes: bks
      };
    }

    /**
     * Экспортирует изображение в формате PNG (Uint8Array) и при необходимости сохраняет в проект
     * @param {Object} [params]
     * @param {string} [params.name] - Имя модели
     * @param {string} [params.folder='gfx'] - Папка в проекте (по умолчанию 'gfx')
     * @param {number} [params.scale=1] - Масштаб пикселей (1, 2, 4...)
     * @param {boolean} [params.saveToProject=true] - Сохранять ли файл в проект
     * @returns {Object}
     */
    exportPng(params = {}) {
      const model = this._resolveModel(params.name);
      const cleanName = String(params.name || model.name || 'image').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      const folder = (params.folder !== undefined && params.folder !== null) ? String(params.folder).trim() : 'gfx';
      const scale = Math.max(1, Math.min(16, parseInt(params.scale, 10) || 1));

      const rgba = renderModelToRgba(model, scale);
      const outWidth = model.width * scale;
      const outHeight = model.height * scale;
      const pngBytes = encodePng(outWidth, outHeight, rgba);

      let targetPath = '';
      const shouldSave = (params.saveToProject !== false);
      const pm = this._getProject();
      if (shouldSave && pm) {
        targetPath = joinProjectPath(folder, cleanName + '.png');
        if (typeof pm.addArtifactFile === 'function') {
          pm.addArtifactFile(targetPath, pngBytes);
        } else if (typeof pm.writeFile === 'function') {
          pm.writeFile(targetPath, pngBytes);
        } else if (typeof pm.createFile === 'function') {
          pm.createFile(targetPath, pngBytes);
        }
      }

      return {
        success: true,
        format: 'PNG',
        name: cleanName,
        path: targetPath,
        width: outWidth,
        height: outHeight,
        scale: scale,
        byteLength: pngBytes.length,
        bytes: pngBytes
      };
    }

    /**
     * Сохраняет состояние редактора графики в формате .BKGfxState и при необходимости записывает в проект
     * @param {Object} [params]
     * @param {string} [params.name] - Имя модели
     * @param {string} [params.folder='gfx'] - Папка в проекте (по умолчанию 'gfx')
     * @param {boolean} [params.saveToProject=true] - Сохранять ли файл в проект
     * @returns {Object}
     */
    saveState(params = {}) {
      const model = this._resolveModel(params.name);
      const cleanName = String(params.name || model.name || 'image').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      const folder = (params.folder !== undefined && params.folder !== null) ? String(params.folder).trim() : 'gfx';

      const isSprite = (model.width <= 32 && model.height <= 32);
      const modelJson = model.toJSON();
      const gfxState = {
        format: 'BKGfxState',
        version: 1,
        savedAt: new Date().toISOString(),
        editorMode: isSprite ? 'sprites' : 'graphics',
        tool: 'pencil',
        colorIndex: 1,
        zoom: isSprite ? 12 : 4,
        previewZoom: 1,
        showGrid: true,
        spriteWidth: isSprite ? model.width : 16,
        spriteHeight: isSprite ? model.height : 16,
        spriteCount: 1,
        animDelay: 200,
        // Для обратной совместимости с существующими проверками
        name: model.name || cleanName,
        width: model.width,
        height: model.height,
        mode: model.mode,
        paletteIndex: model.paletteIndex || 0,
        model: modelJson
      };

      let targetPath = '';
      const shouldSave = (params.saveToProject !== false);
      const pm = this._getProject();
      const jsonString = JSON.stringify(gfxState, null, 2);

      if (shouldSave && pm) {
        targetPath = joinProjectPath(folder, cleanName + '.BKGfxState');
        if (typeof pm.addArtifactFile === 'function') {
          pm.addArtifactFile(targetPath, jsonString);
        } else if (typeof pm.writeFile === 'function') {
          pm.writeFile(targetPath, jsonString);
        } else if (typeof pm.createFile === 'function') {
          pm.createFile(targetPath, jsonString);
        }
      }

      return {
        success: true,
        format: 'BKGfxState',
        name: cleanName,
        path: targetPath,
        size: jsonString.length,
        state: gfxState
      };
    }

    /**
     * Сохраняет графический ресурс в текущий проект BKStudio
     * @param {Object} params
     * @param {string} [params.name] - Базовое имя файла (по умолчанию имя модели)
     * @param {string} [params.folder=''] - Подпапка в проекте (например "gfx")
     * @param {"ASM"|"MAC"|"BIN"|"DAT"|"BKS"|"STATE"|"PNG"} [params.format='ASM'] - Целевой формат
     * @param {boolean} [params.savePng=false] - Также сохранить рядом файл .PNG
     * @param {boolean} [params.saveState=false] - Также сохранить рядом файл состояния редактора .BKGfxState
     * @param {boolean} [params.insertInclude=false] - Вставить ли директиву .INCLUDE в активный исходный файл
     * @param {Object} [params.spriteGrid] - Сетка спрайтов для ASM/MAC
     * @returns {Object}
     */
    addToProject(params = {}) {
      const model = this._resolveModel(params.name);
      const pm = this._getProject();
      if (!pm) {
        throw new Error('Менеджер проекта BKProjectManager недоступен.');
      }

      const cleanName = String(params.name || model.name || 'image').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      const folder = String(params.folder || '').trim();
      const format = String(params.format || 'ASM').toUpperCase();

      let targetPath = '';
      let fileData = null;

      if (format === 'ASM' || format === 'MAC') {
        const isAsm = format === 'ASM';
        const res = isAsm ? this.exportAsm(params) : this.exportMac(params);
        targetPath = joinProjectPath(folder, cleanName + (isAsm ? '.asm' : '.mac'));
        fileData = res.text;
      } else if (format === 'BIN') {
        const res = this.exportBin(params);
        targetPath = joinProjectPath(folder, cleanName + '.bin');
        fileData = res.bytes;
      } else if (format === 'DAT') {
        const res = this.exportDat(params);
        targetPath = joinProjectPath(folder, cleanName + '.dat');
        fileData = res.bytes;
      } else if (format === 'BKS') {
        const res = this.exportBks(params);
        targetPath = joinProjectPath(folder, cleanName + '.bks');
        fileData = res.bytes;
      } else if (format === 'STATE' || format === 'BKGFXSTATE') {
        const res = this.saveState(Object.assign({}, params, { saveToProject: false }));
        targetPath = joinProjectPath(folder, cleanName + '.BKGfxState');
        fileData = JSON.stringify(res.state, null, 2);
      } else if (format === 'PNG') {
        const res = this.exportPng(Object.assign({}, params, { saveToProject: false }));
        targetPath = joinProjectPath(folder, cleanName + '.png');
        fileData = res.bytes;
      } else {
        throw new Error(`Неизвестный формат ресурса: "${format}". Допустимы: ASM, MAC, BIN, DAT, BKS, STATE, PNG.`);
      }

      const saveFile = (p, data) => {
        if (typeof pm.addArtifactFile === 'function') {
          pm.addArtifactFile(p, data);
        } else if (typeof pm.writeFile === 'function') {
          pm.writeFile(p, data);
        } else if (typeof pm.createFile === 'function') {
          pm.createFile(p, data);
        } else {
          throw new Error('В объекте bkProject не найден метод сохранения файла.');
        }
      };

      saveFile(targetPath, fileData);

      // Сопутствующее сохранение PNG при флаге savePng
      let pngPath = null;
      if (params.savePng && format !== 'PNG') {
        const pngRes = this.exportPng(Object.assign({}, params, { saveToProject: false }));
        pngPath = joinProjectPath(folder || 'gfx', cleanName + '.png');
        saveFile(pngPath, pngRes.bytes);
      }

      // Сопутствующее сохранение состояния редактора .BKGfxState при флаге saveState
      let statePath = null;
      if (params.saveState && format !== 'STATE' && format !== 'BKGFXSTATE') {
        const stateRes = this.saveState(Object.assign({}, params, { saveToProject: false }));
        statePath = joinProjectPath(folder || 'gfx', cleanName + '.BKGfxState');
        saveFile(statePath, JSON.stringify(stateRes.state, null, 2));
      }

      let included = false;
      if (params.insertInclude && (format === 'ASM' || format === 'MAC')) {
        const active = pm.activeFileName;
        if (active && active !== targetPath) {
          const Editor = this._getEditor();
          if (Editor && typeof Editor.insertInclude === 'function') {
            Editor.insertInclude(targetPath);
            included = true;
          } else if (typeof pm.getFileContent === 'function' && typeof pm.setFileContent === 'function') {
            const currentCode = pm.getFileContent(active) || '';
            const directive = `\n.INCLUDE "${targetPath}"\n`;
            pm.setFileContent(active, currentCode + directive);
            included = true;
          }
        }
      }

      const extraFiles = [];
      if (pngPath) extraFiles.push(pngPath);
      if (statePath) extraFiles.push(statePath);

      return {
        success: true,
        path: targetPath,
        format: format,
        size: (fileData && fileData.byteLength) || (fileData ? fileData.length : 0),
        included: included,
        pngPath: pngPath,
        statePath: statePath,
        extraFiles: extraFiles
      };
    }

    /**
     * Открывает текущую модель в графическом редакторе BKStudio GUI (если он загружен)
     * @param {Object} [params]
     * @returns {Object}
     */
    /**
     * Открывает текущую модель в графическом редакторе BKStudio GUI (если он загружен)
     * @param {Object} [params]
     * @returns {Object}
     */
    openInEditor(params = {}) {
      const model = this._resolveModel(params.name);
      const Editor = this._getEditor();
      if (!Editor || typeof Editor.open !== 'function') {
        throw new Error('Графический редактор BKGraphicsEditor недоступен.');
      }
      Editor.open({ model: model });
      return {
        success: true,
        message: 'Изображение открыто в редакторе BKStudio.'
      };
    }

    // =========================================================================
    // ASCII Matrix API (AI-представление пиксельной графики БК)
    // =========================================================================

    /**
     * Проверяет корректность текстовой ASCII-матрицы для заданных размеров и режима.
     * @param {string} text - Входной текст ASCII-матрицы.
     * @param {number} [width] - Ожидаемая ширина (если задана).
     * @param {number} [height] - Ожидаемая высота (если задана).
     * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
     * @param {Object} [options] - Дополнительные параметры (palette, paletteIndex).
     * @returns {{ valid: boolean, error?: string, width?: number, height?: number, lines?: string[] }}
     */
    validateMatrix(text, width, height, mode, options) {
      return validateMatrix(text, width, height, mode, options);
    }

    /**
     * Преобразует текстовую ASCII-матрицу в компактный массив индексов цветов BKGraphicsModel.
     * @param {string} text - Входной текст матрицы.
     * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
     * @param {Object} [options] - Опции { width, height, palette, paletteIndex }.
     * @returns {number[]} Плоский массив индексов (свойства .width и .height).
     */
    matrixToPixels(text, mode, options) {
      return matrixToPixels(text, mode, options);
    }

    /**
     * Преобразует массив индексов пикселей BKGraphicsModel в компактную текстовую ASCII-матрицу.
     * @param {Array<number>} pixels - Массив индексов цветов БК.
     * @param {number} width - Ширина.
     * @param {number} height - Высота.
     * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
     * @param {Object} [options] - Опции { palette, paletteIndex }.
     * @returns {string} Текстовая ASCII-матрица с переводами строк.
     */
    pixelsToMatrix(pixels, width, height, mode, options) {
      return pixelsToMatrix(pixels, width, height, mode, options);
    }
  }

  // ===========================================================================
  // Внутренняя реализация ASCII Matrix API
  // ===========================================================================

  /**
   * Набор всех потенциально известных логических символов цветов БК.
   */
  const ALL_KNOWN_COLOR_CHARS = Object.freeze(new Set([
    'K', 'k', 'B', 'b', 'G', 'g', 'R', 'r',
    'W', 'w', 'Y', 'y', 'M', 'm', 'C', 'c'
  ]));

  /**
   * Разрешает сопоставление символов и индексов цветов для режима и палитры.
   * @param {string|Object} [modeInput] - ID режима или экземпляр BKGraphicsModel.
   * @param {Object} [options] - Дополнительные настройки.
   * @returns {{ modeId: string, charToIndex: Object<string, number>, indexToChar: string[] }}
   */
  function getColorMapping(modeInput, options = {}) {
    let modeId = 'BK0010_COLOR';
    let palette = null;
    let paletteIndex = 0;

    if (typeof modeInput === 'string') {
      modeId = modeInput.trim();
    } else if (modeInput && typeof modeInput === 'object') {
      modeId = modeInput.mode || 'BK0010_COLOR';
      palette = modeInput.palette || null;
      paletteIndex = modeInput.paletteIndex || 0;
    }

    if (options.paletteIndex !== undefined) {
      paletteIndex = options.paletteIndex;
    }
    if (options.palette) {
      palette = options.palette;
    }

    let charToIndex = {};
    let indexToChar = [];

    if (modeId === 'BK0010_MONO') {
      charToIndex = {
        'K': 0, 'k': 0,
        'W': 1, 'w': 1
      };
      indexToChar = ['K', 'W'];
    } else if (modeId === 'BK0010_COLOR') {
      charToIndex = {
        'K': 0, 'k': 0,
        'B': 1, 'b': 1,
        'G': 2, 'g': 2,
        'R': 3, 'r': 3
      };
      indexToChar = ['K', 'B', 'G', 'R'];
    } else if (modeId === 'BK0011M_COLOR') {
      if (!palette && typeof global.getPalette === 'function') {
        const allPalettes = global.getPalette('BK0011M_COLOR');
        if (Array.isArray(allPalettes)) {
          palette = allPalettes[paletteIndex] || allPalettes[0];
        }
      }

      if (!palette || !Array.isArray(palette)) {
        palette = ['#000000', '#0000FF', '#00FF00', '#FF0000'];
      }

      const hexToChar = {
        '#000000': 'K',
        '#0000FF': 'B',
        '#00FF00': 'G',
        '#FF0000': 'R',
        '#FFFF00': 'Y',
        '#FF00FF': 'M',
        '#00FFFF': 'C',
        '#FFFFFF': 'W',
        '#C00000': 'R', '#900000': 'R',
        '#C0FF00': 'G', '#90FF00': 'G',
        '#C000FF': 'M', '#9000FF': 'M'
      };

      charToIndex = {};
      indexToChar = [];
      for (let i = 0; i < palette.length; i++) {
        const hex = String(palette[i]).toUpperCase();
        const ch = hexToChar[hex] || (i === 0 ? 'K' : String(i));
        indexToChar.push(ch);
        charToIndex[ch] = i;
        charToIndex[ch.toLowerCase()] = i;
      }
    } else {
      charToIndex = {
        'K': 0, 'k': 0,
        'B': 1, 'b': 1,
        'G': 2, 'g': 2,
        'R': 3, 'r': 3
      };
      indexToChar = ['K', 'B', 'G', 'R'];
    }

    return {
      modeId,
      charToIndex,
      indexToChar
    };
  }

  /**
   * Разбивает ASCII-матрицу на строки с очисткой допустимых служебных элементов форматирования.
   * @param {string} text - Входной текст.
   * @returns {string[]} Массив строк матрицы.
   */
  function parseMatrixLines(text) {
    if (typeof text !== 'string') {
      return [];
    }

    let clean = text.replace(/\r/g, '').trim();
    // Снятие markdown-обертки ```text / ``` если LLM передала блок кода
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    if (!clean) {
      return [];
    }

    return clean.split('\n');
  }

  /**
   * Проверяет корректность ASCII-матрицы.
   *
   * @param {string} text - Входной текст матрицы.
   * @param {number} [width] - Ожидаемая ширина (если задана).
   * @param {number} [height] - Ожидаемая высота (если задана).
   * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
   * @param {Object} [options] - Дополнительные параметры.
   * @returns {{ valid: boolean, error?: string, width?: number, height?: number, lines?: string[] }}
   */
  function validateMatrix(text, width, height, mode, options = {}) {
    if (typeof text !== 'string') {
      return { valid: false, error: 'ERROR: matrix text must be a string' };
    }

    if (text.length > MAX_MATRIX_CHARS) {
      return {
        valid: false,
        error: `ERROR: matrix text length (${text.length}) exceeds maximum limit (${MAX_MATRIX_CHARS} characters)`
      };
    }

    const lines = parseMatrixLines(text);
    if (lines.length === 0) {
      return { valid: false, error: 'ERROR: matrix text is empty' };
    }

    if (lines.length > MAX_MATRIX_HEIGHT) {
      return {
        valid: false,
        error: `ERROR: matrix height (${lines.length}) exceeds maximum limit (${MAX_MATRIX_HEIGHT} rows)`
      };
    }

    if (height != null && lines.length !== height) {
      return { valid: false, error: `ERROR: expected ${height} rows, received ${lines.length}` };
    }

    const expectedWidth = (width != null) ? width : lines[0].length;
    if (expectedWidth <= 0) {
      return { valid: false, error: 'ERROR: row width must be greater than 0' };
    }

    if (expectedWidth > MAX_MATRIX_WIDTH) {
      return {
        valid: false,
        error: `ERROR: matrix width (${expectedWidth}) exceeds maximum limit (${MAX_MATRIX_WIDTH} columns)`
      };
    }

    for (let r = 0; r < lines.length; r++) {
      const row = lines[r];
      if (row.length !== expectedWidth) {
        return {
          valid: false,
          error: `ERROR: row ${r + 1} must contain exactly ${expectedWidth} characters (found ${row.length})`
        };
      }
    }

    const mapping = getColorMapping(mode, options);

    for (let r = 0; r < lines.length; r++) {
      const row = lines[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (mapping.charToIndex[ch] === undefined) {
          if (ch === '.') {
            return {
              valid: false,
              error: "ERROR_INVALID_CHARACTER: '.' (transparent) is not supported. Use 'K' for black (pixel color index 0)."
            };
          }
          if (ALL_KNOWN_COLOR_CHARS.has(ch)) {
            return {
              valid: false,
              error: `ERROR_INVALID_COLOR: unsupported color '${ch}' for mode ${mapping.modeId}`
            };
          }
          return {
            valid: false,
            error: `ERROR_INVALID_CHARACTER: unsupported character '${ch}'`
          };
        }
      }
    }

    return {
      valid: true,
      width: expectedWidth,
      height: lines.length,
      lines: lines
    };
  }

  /**
   * Преобразует текстовую ASCII-матрицу в массив индексов цветов BKGraphicsModel.
   *
   * @param {string} text - Входной текст ASCII-матрицы.
   * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
   * @param {Object} [options] - Опции { width, height, palette, paletteIndex }.
   * @returns {number[]} Плоский массив индексов (свойства .width и .height).
   * @throws {Error} При нарушении валидации матрицы.
   */
  function matrixToPixels(text, mode, options = {}) {
    const opts = options || {};
    const validation = validateMatrix(text, opts.width, opts.height, mode, opts);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const mapping = getColorMapping(mode, opts);
    const lines = validation.lines;
    const w = validation.width;
    const h = validation.height;
    const pixels = new Array(w * h);

    let ptr = 0;
    for (let r = 0; r < h; r++) {
      const line = lines[r];
      for (let c = 0; c < w; c++) {
        pixels[ptr++] = mapping.charToIndex[line[c]];
      }
    }

    pixels.width = w;
    pixels.height = h;

    return pixels;
  }

  /**
   * Преобразует массив индексов пикселей BKGraphicsModel в компактную текстовую ASCII-матрицу.
   *
   * @param {Array<number>} pixels - Массив индексов цветов.
   * @param {number} width - Ширина.
   * @param {number} height - Высота.
   * @param {string|Object} [mode='BK0010_COLOR'] - Режим БК или модель.
   * @param {Object} [options] - Опции { palette, paletteIndex }.
   * @returns {string} Текстовая ASCII-матрица.
   */
  function pixelsToMatrix(pixels, width, height, mode, options = {}) {
    if (!Array.isArray(pixels)) {
      throw new Error('ERROR: pixels must be an array');
    }
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error('ERROR: width must be a positive integer');
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new Error('ERROR: height must be a positive integer');
    }
    if (pixels.length !== width * height) {
      throw new Error(`ERROR: pixels length (${pixels.length}) does not match width * height (${width * height})`);
    }

    const mapping = getColorMapping(mode, options);
    const rows = [];

    for (let r = 0; r < height; r++) {
      let rowStr = '';
      const offset = r * width;
      for (let c = 0; c < width; c++) {
        const val = pixels[offset + c];
        const ch = (val != null && val >= 0 && val < mapping.indexToChar.length)
          ? mapping.indexToChar[val]
          : 'K';
        rowStr += ch;
      }
      rows.push(rowStr);
    }

    return rows.join('\n');
  }

  // Экспонирование статических функций на классе
  BKGraphicsAIApi.validateMatrix = validateMatrix;
  BKGraphicsAIApi.matrixToPixels = matrixToPixels;
  BKGraphicsAIApi.pixelsToMatrix = pixelsToMatrix;

  // Экспонирование синглтона и класса в глобальную область
  global.BKGraphicsAIApi = BKGraphicsAIApi;
  global.bkGraphicsAI = new BKGraphicsAIApi();
  global.validateMatrix = validateMatrix;
  global.matrixToPixels = matrixToPixels;
  global.pixelsToMatrix = pixelsToMatrix;

})(typeof window !== 'undefined' ? window : this);

