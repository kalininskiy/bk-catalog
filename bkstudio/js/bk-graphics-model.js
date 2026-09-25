/**
 * BKStudio - BK Graphics Data Model
 *
 * Независимая модель индексированной пиксельной графики для семейства
 * Электроника БК (БК-0010 / БК-0011М).
 *
 * Модель хранит пиксели как индексы цветов (0..maxColors-1), а не RGB.
 * Палитра — массив hex-цветов, соответствующих этим индексам.
 *
 * Описание режимов и палитр берётся из модуля bk-graphics-modes.js
 * (загружается раньше), через глобальные BKGraphicsModes и getGraphicsMode.
 *
 * Поддерживаемые режимы:
 *   BK0010_MONO    — 1 бит/пиксель, 2 цвета (чёрный/белый), типично 512x256.
 *   BK0010_COLOR   — 2 бита/пиксель, 4 цвета, фиксированная палитра 00 БК-0011М.
 *   BK0011M_COLOR  — 2 бита/пиксель, 4 цвета, 16 палитр (выбор через paletteIndex).
 *
 * Размер изображения произвольный: от 1x1 до 512x256.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Режим по умолчанию.
   * @type {string}
   */
  const DEFAULT_MODE_ID = 'BK0010_MONO';

  // Кэшированные глобальные максимумы размеров (из всех режимов).
  // Вычисляются лениво, чтобы модуль не зависал от порядка загрузки.
  let _maxWidth = null;
  let _maxHeight = null;

  /**
   * Возвращает максимальную ширину изображения (макс. по всем режимам).
   * @returns {number} максимальная ширина.
   */
  function getMaxWidth() {
    if (_maxWidth === null) {
      _maxWidth = Math.max.apply(null, BKGraphicsModes.map(m => m.width));
    }
    return _maxWidth;
  }

  /**
   * Возвращает максимальную высоту изображения (макс. по всем режимам).
   * @returns {number} максимальная высота.
   */
  function getMaxHeight() {
    if (_maxHeight === null) {
      _maxHeight = Math.max.apply(null, BKGraphicsModes.map(m => m.height));
    }
    return _maxHeight;
  }

  /**
   * Модель индексированной пиксельной графики БК.
   */
  class BKGraphicsModel {

    /**
     * Создаёт модель изображения.
     * @param {Object} [options] - параметры создания.
     * @param {string} [options.mode] - режим: BK0010_MONO, BK0010_COLOR или BK0011M_COLOR.
     * @param {number} [options.width] - ширина в пикселях (1..512).
     * @param {number} [options.height] - высота в пикселях (1..256).
     * @param {number} [options.paletteIndex] - индекс палитры для BK0011M_COLOR (0..15).
     * @param {string[]} [options.palette] - пользовательская палитра (для BK0010_COLOR / BK0010_MONO).
     * @param {string} [options.name] - имя изображения.
     * @param {Object} [options.metadata] - произвольные метаданные.
     */
    constructor(options) {
      options = options || {};

      const modeId = options.mode || DEFAULT_MODE_ID;
      const mode = getGraphicsMode(modeId);
      if (!mode) {
        throw new Error('Неизвестный режим: ' + modeId);
      }

      this.mode = modeId;
      this.bitsPerPixel = mode.bitsPerPixel;
      this.maxColors = mode.colors;
      this.width = options.width != null ? options.width : mode.width;
      this.height = options.height != null ? options.height : mode.height;
      this.name = options.name || '';
      this.metadata = options.metadata ? Object.assign({}, options.metadata) : {};

      // Палитра: для BK0011M_COLOR выбирается из 16, для остальных — фиксированная
      // (или пользовательская), индекс палитры имеет смысл только для BK0011M_COLOR.
      if (mode.id === 'BK0011M_COLOR') {
        this.paletteIndex = (options.paletteIndex != null) ? options.paletteIndex : 0;
        if (!Number.isInteger(this.paletteIndex) || this.paletteIndex < 0 || this.paletteIndex >= mode.palette.length) {
          throw new Error('Индекс палитры должен быть целым числом от 0 до ' + (mode.palette.length - 1));
        }
        this.palette = mode.palette[this.paletteIndex].slice();
      } else {
        this.paletteIndex = 0;
        this.palette = options.palette ? options.palette.slice() : mode.palette.slice();
      }

      this._validateDimensions(this.width, this.height);

      // Пиксели хранятся как плоский массив индексов цветов (0..maxColors-1).
      this.pixels = new Array(this.width * this.height).fill(0);
    }

    /**
     * Проверяет допустимость размеров изображения.
     * @param {number} width - ширина.
     * @param {number} height - высота.
     * @throws {Error} если размеры вне допустимого диапазона.
     */
    _validateDimensions(width, height) {
      const maxWidth = getMaxWidth();
      const maxHeight = getMaxHeight();
      if (!Number.isInteger(width) || width < 1 || width > maxWidth) {
        throw new Error('Ширина должна быть целым числом от 1 до ' + maxWidth);
      }
      if (!Number.isInteger(height) || height < 1 || height > maxHeight) {
        throw new Error('Высота должна быть целым числом от 1 до ' + maxHeight);
      }
    }

    /**
     * Проверяет, является ли значение допустимым индексом цвета.
     * @param {number} index - индекс цвета.
     * @returns {boolean} true, если индекс в диапазоне 0..maxColors-1.
     */
    _isValidIndex(index) {
      return Number.isInteger(index) && index >= 0 && index < this.maxColors;
    }

    /**
     * Читает индекс цвета пикселя.
     * @param {number} x - координата по горизонтали.
     * @param {number} y - координата по вертикали.
     * @returns {number|undefined} индекс цвета или undefined вне границ.
     */
    getPixel(x, y) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        return undefined;
      }
      return this.pixels[y * this.width + x];
    }

    /**
     * Записывает индекс цвета в пиксель.
     * @param {number} x - координата по горизонтали.
     * @param {number} y - координата по вертикали.
     * @param {number} index - индекс цвета.
     * @returns {boolean} true, если запись выполнена.
     */
    setPixel(x, y, index) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        return false;
      }
      if (!this._isValidIndex(index)) {
        return false;
      }
      this.pixels[y * this.width + x] = index;
      return true;
    }

    /**
     * Читает область пикселей как массив строк (2D).
     * @param {number} x - левый верхний угол по горизонтали.
     * @param {number} y - левый верхний угол по вертикали.
     * @param {number} w - ширина области.
     * @param {number} h - высота области.
     * @returns {number[][]} массив строк индексов цветов.
     */
    getPixels(x, y, w, h) {
      const result = [];
      for (let dy = 0; dy < h; dy++) {
        const row = [];
        for (let dx = 0; dx < w; dx++) {
          row.push(this.getPixel(x + dx, y + dy));
        }
        result.push(row);
      }
      return result;
    }

    /**
     * Записывает область пикселей из 2D-массива индексов.
     * @param {number} x - левый верхний угол по горизонтали.
     * @param {number} y - левый верхний угол по вертикали.
     * @param {number[][]} data - массив строк индексов цветов.
     * @param {number} w - ширина области.
     * @param {number} h - высота области.
     * @returns {boolean} true, если запись выполнена.
     */
    setPixels(x, y, data, w, h) {
      if (!Array.isArray(data)) {
        return false;
      }
      for (let dy = 0; dy < h; dy++) {
        const row = data[dy];
        if (!Array.isArray(row)) {
          return false;
        }
        for (let dx = 0; dx < w; dx++) {
          if (!this.setPixel(x + dx, y + dy, row[dx])) {
            return false;
          }
        }
      }
      return true;
    }

    /**
     * Возвращает hex-цвет пикселя по его индексу.
     * @param {number} x - координата по горизонтали.
     * @param {number} y - координата по вертикали.
     * @returns {string|undefined} hex-цвет или undefined вне границ.
     */
    getPixelColor(x, y) {
      const index = this.getPixel(x, y);
      if (index === undefined) {
        return undefined;
      }
      return this.palette[index] || '#000000';
    }

    /**
     * Возвращает активную палитру (копию).
     * @returns {string[]} массив hex-цветов.
     */
    getPalette() {
      return this.palette.slice();
    }

    /**
     * Устанавливает индекс палитры для режима BK0011M_COLOR.
     * @param {number} index - индекс палитры от 0 до 15.
     * @returns {boolean} true, если палитра установлена.
     */
    setPalette(index) {
      if (this.mode !== 'BK0011M_COLOR') {
        return false;
      }
      const mode = getGraphicsMode(this.mode);
      if (!mode) {
        return false;
      }
      if (!Number.isInteger(index) || index < 0 || index >= mode.palette.length) {
        return false;
      }
      this.paletteIndex = index;
      this.palette = mode.palette[index].slice();
      return true;
    }

    /**
     * Заполняет всё изображение одним индексом цвета.
     * @param {number} index - индекс цвета.
     * @returns {boolean} true, если заполнение выполнено.
     */
    fill(index) {
      if (!this._isValidIndex(index)) {
        return false;
      }
      this.pixels.fill(index);
      return true;
    }

    /**
     * Очищает изображение (заполняет индексом 0 по умолчанию).
     * @param {number} [index=0] - индекс цвета очистки.
     * @returns {boolean} true, если очистка выполнена.
     */
    clear(index) {
      return this.fill(index === undefined ? 0 : index);
    }

    /**
     * Меняет размер изображения. Существующие пиксели копируются в
     * пересечении, новая область заполняется индексом fillIndex.
     * @param {number} width - новая ширина.
     * @param {number} height - новая высота.
     * @param {number} [fillIndex=0] - индекс цвета для новой области.
     * @returns {BKGraphicsModel} this для цепочек вызовов.
     */
    resize(width, height, fillIndex) {
      this._validateDimensions(width, height);
      const newPixels = new Array(width * height).fill(fillIndex === undefined ? 0 : fillIndex);
      const copyW = Math.min(width, this.width);
      const copyH = Math.min(height, this.height);
      for (let y = 0; y < copyH; y++) {
        for (let x = 0; x < copyW; x++) {
          newPixels[y * width + x] = this.pixels[y * this.width + x];
        }
      }
      this.width = width;
      this.height = height;
      this.pixels = newPixels;
      return this;
    }

    /**
     * Создаёт глубокую копию модели.
     * @returns {BKGraphicsModel} новая модель-копия.
     */
    clone() {
      const copy = new BKGraphicsModel({
        width: this.width,
        height: this.height,
        mode: this.mode,
        paletteIndex: this.paletteIndex,
        name: this.name,
        metadata: Object.assign({}, this.metadata)
      });
      copy.pixels = this.pixels.slice();
      return copy;
    }

    /**
     * Переворачивает изображение по горизонтали (зеркально по вертикальной оси).
     * @returns {BKGraphicsModel} this для цепочек вызовов.
     */
    flipHorizontal() {
      const w = this.width;
      const h = this.height;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w / 2; x++) {
          const a = y * w + x;
          const b = y * w + (w - 1 - x);
          const tmp = this.pixels[a];
          this.pixels[a] = this.pixels[b];
          this.pixels[b] = tmp;
        }
      }
      return this;
    }

    /**
     * Переворачивает изображение по вертикали (зеркально по горизонтальной оси).
     * @returns {BKGraphicsModel} this для цепочек вызовов.
     */
    flipVertical() {
      const w = this.width;
      const h = this.height;
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h / 2; y++) {
          const a = y * w + x;
          const b = (h - 1 - y) * w + x;
          const tmp = this.pixels[a];
          this.pixels[a] = this.pixels[b];
          this.pixels[b] = tmp;
        }
      }
      return this;
    }

    /**
     * Поворачивает изображение на 90 градусов по часовой стрелке.
     * @returns {BKGraphicsModel} this для цепочек вызовов.
     */
    rotate90() {
      const w = this.width;
      const h = this.height;
      const newW = h;
      const newH = w;
      const newPixels = new Array(newW * newH).fill(0);
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          const srcIndex = y * w + x;
          const dstX = h - 1 - y;
          const dstY = x;
          newPixels[dstY * newW + dstX] = this.pixels[srcIndex];
        }
      }
      this.width = newW;
      this.height = newH;
      this.pixels = newPixels;
      return this;
    }

    /**
     * Возвращает размеры изображения.
     * @returns {Object} {width, height}.
     */
    getBounds() {
      return { width: this.width, height: this.height };
    }

    /**
     * Возвращает общее количество пикселей.
     * @returns {number} width * height.
     */
    getPixelCount() {
      return this.width * this.height;
    }

    /**
     * Возвращает сериализуемый объект модели (для codec / сохранения).
     * @returns {Object} объект с полями модели.
     */
    toJSON() {
      return {
        width: this.width,
        height: this.height,
        mode: this.mode,
        paletteIndex: this.paletteIndex,
        palette: this.palette.slice(),
        name: this.name,
        metadata: Object.assign({}, this.metadata),
        pixels: this.pixels.slice()
      };
    }
  }

  /**
   * Фабрика создания модели.
   * @param {Object} [options] - параметры создания.
   * @returns {BKGraphicsModel} новая модель.
   */
  BKGraphicsModel.create = function (options) {
    return new BKGraphicsModel(options);
  };

  // Экспонирование API в глобальную область.
  // BKGraphicsModes и палитры уже экспонирует bk-graphics-modes.js,
  // поэтому здесь публикуем только саму модель.
  global.BKGraphicsModel = BKGraphicsModel;
})(typeof window !== 'undefined' ? window : this);
