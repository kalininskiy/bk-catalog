/**
 * AzbkVideo.js - Видеоподсистема контроллера-расширителя AZBK (MAXIOL AZ Extended Video)
 * 
 * Характеристики видеоконтроллера AZBK:
 * - Разрешение: 1024×768 VGA
 * - Палитра: 338 цветов (палитра 32768 цветов в формате R5G5B5)
 *   - 0..255: 256-цветная палитра
 *   - 256..319: 16 палитр БК-0011М (16×4)
 *   - 320..335: 16-цветная палитра
 *   - 336..337: Монохромная палитра (2 цвета)
 * - Видеорежимы (0..7):
 *   - 0: 1 bpp (2 цвета)
 *   - 1: 2 bpp (4 цвета, стандартные палитры БК)
 *   - 2: 4 bpp (16 цветов)
 *   - 3: 8 bpp (256 цветов)
 *   - 4: 1 bpp (слоеный режим 8 цветов из 3 слоев)
 *   - 5: 2 bpp (3 слоя с прозрачностью, цвет 0 прозрачный)
 *   - 6: 4 bpp (3 слоя с прозрачностью, цвет 0 прозрачный)
 *   - 7: 8 bpp (3 слоя с прозрачностью, цвет 0 прозрачный)
 * - 3 аппаратных слоя: L0 (верхний), L1 (средний/спрайты), L2 (нижний/фон)
 * - Аппаратный скроллинг: независимый вертикальный и горизонтальный для каждого слоя
 * - Аппаратное масштабирование: XStretch (1..8) и YStretch (1..4)
 * - Циклический рулон (ScrlSize): от 6144 до 262144 слов
 * 
 * (c) 2026 - BK-Catalog Project
 */

class AzbkVideo {
    constructor(azbkController) {
        this.azbk = azbkController;

        // Размеры видеорежима
        this.WIDTH = 1024;
        this.HEIGHT = 768;

        // Фреймбуфер 1024×768 (32 бита на пиксель в формате RGBA)
        this.framebuffer = new Uint32Array(this.WIDTH * this.HEIGHT);
        this.lineBuffer = new Uint32Array(this.WIDTH);

        // Константы видеорежимов
        this.BPP_TABLE = [1, 2, 4, 8];
        this.LLEN_TABLE = [32, 64, 128, 256]; // ширина строки в словах
        this.XS_TABLE = [1, 2, 4, 8];         // растяжение по горизонтали
        this.YS_TABLE = [1, 2, 3, 4];         // повтор строк по вертикали
        this.LSCRL_TABLE = [
            6144, 8192, 12288, 16384, 24576, 32768,
            49152, 65536, 98304, 131072, 196608, 262144
        ];

        // Индексы блоков палитры
        this.PAL_256_IDX = 0;
        this.PAL_4_IDX   = 256;
        this.PAL_16_IDX  = 320;
        this.PAL_2_IDX   = 336;
        this.PALETTE_SIZE = 338;

        // Регистры видеоконтроллера
        this.regScrCsr      = 0;        // 177230
        this.regScrPgNumL0  = 0;        // 177232: верхний слой
        this.regScrPgNumL1  = 0;        // 177240: средний слой
        this.regScrPgNumL2  = 0;        // 177242: нижний слой
        this.regVScrlL2     = 0;        // 177244
        this.regVScrlL1     = 0;        // 177246
        this.regVScrlL0     = 0;        // 177250
        this.regHScrlL0     = 0;        // 177252
        this.regHScrlL1     = 0;        // 177254
        this.regHScrlL2     = 0;        // 177256

        // Доступ к палитре
        this.regPalCell     = 0;        // 177234: индекс ячейки 0..337
        this.regPalVal      = 0;        // 177236: значение R5G5B5

        // Декодированные параметры экрана
        this.videoMode      = 0;        // 0..7
        this.bpp            = 1;
        this.lineLen        = 32;       // слов на строку
        this.xStretch       = 1;
        this.yStretch       = 1;
        this.scrlSize       = 6144;
        this.scrlLines      = 192;
        this.syncro         = false;
        this.legacyPalette  = 0;        // номер 4-цветной палитры БК-11М (0..15)

        // Зафиксированные параметры на время кадра (для режима синхронизации)
        this.frameHScrlL0    = 0;
        this.frameHScrlL1    = 0;
        this.frameHScrlL2    = 0;
        this.frameVScrlL0    = 0;
        this.frameVScrlL1    = 0;
        this.frameVScrlL2    = 0;
        this.framePgNumL0   = 0;
        this.framePgNumL1   = 0;
        this.framePgNumL2   = 0;

        // Палитра (хранится в RGBA32 и исходном 16-битном R5G5B5)
        this.paletteRGBA = new Uint32Array(this.PALETTE_SIZE);
        this.paletteR5G5B5 = new Uint16Array(this.PALETTE_SIZE);

        this.initDefaultPalette();
    }

    /**
     * Преобразование цвета 15-бит R5G5B5 в RGBA32 (для Canvas ImageData)
     * В Canvas на Little-Endian: бит 0..7 = R, бит 8..15 = G, бит 16..23 = B, бит 24..31 = Alpha
     */
    static r5g5b5ToRGBA(c) {
        const b = (c & 0x1F) << 3;
        const g = ((c >> 5) & 0x1F) << 3;
        const r = ((c >> 10) & 0x1F) << 3;
        return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
    }

    /**
     * Преобразование цвета RGBA32 в 15-бит R5G5B5
     */
    static rgbaToR5G5B5(c) {
        const r = (c & 0xFF) >> 3;
        const g = ((c >> 8) & 0xFF) >> 3;
        const b = ((c >> 16) & 0xFF) >> 3;
        return ((r << 10) | (g << 5) | b) & 0x7FFF;
    }

    /**
     * Инициализация дефолтной палитры AZBK (соответствует эталону BKemuv4)
     */
    initDefaultPalette() {
        const rawPal = [
            // 256 цветов
            0xff000000, 0xff0f0f0f, 0xff101010, 0xff1f1f1f, 0xff202020, 0xff2f2f2f, 0xff303030, 0xff3f3f3f,
            0xff404040, 0xff4f4f4f, 0xff505050, 0xff5f5f5f, 0xff606060, 0xff6f6f6f, 0xff707070, 0xff7f7f7f,
            0xff808080, 0xff8f8f8f, 0xff909090, 0xff9f9f9f, 0xffa0a0a0, 0xffafafaf, 0xffb0b0b0, 0xffbfbfbf,
            0xffc0c0c0, 0xffcfcfcf, 0xffd0d0d0, 0xffdfdfdf, 0xffe0e0e0, 0xffefefef, 0xfff0f0f0, 0xffffffff,
            0xff000000, 0xff0000ff, 0xff00ff00, 0xff00ffff, 0xffff0000, 0xffff00ff, 0xffffff00, 0xffffffff,
            0xff000000, 0xff000033, 0xff000066, 0xff000099, 0xff0000cc, 0xff0000ff, 0xff003300, 0xff003333,
            0xff003366, 0xff003399, 0xff0033cc, 0xff0033ff, 0xff006600, 0xff006633, 0xff006666, 0xff006699,
            0xff0066cc, 0xff0066ff, 0xff009900, 0xff009933, 0xff009966, 0xff009999, 0xff0099cc, 0xff0099ff,
            0xff00cc00, 0xff00cc33, 0xff00cc66, 0xff00cc99, 0xff00cccc, 0xff00ccff, 0xff00ff00, 0xff00ff33,
            0xff00ff66, 0xff00ff99, 0xff00ffcc, 0xff00ffff, 0xff330000, 0xff330033, 0xff330066, 0xff330099,
            0xff3300cc, 0xff3300ff, 0xff333300, 0xff333333, 0xff333366, 0xff333399, 0xff3333cc, 0xff3333ff,
            0xff336600, 0xff336633, 0xff336666, 0xff336699, 0xff3366cc, 0xff3366ff, 0xff339900, 0xff339933,
            0xff339966, 0xff339999, 0xff3399cc, 0xff3399ff, 0xff33cc00, 0xff33cc33, 0xff33cc66, 0xff33cc99,
            0xff33cccc, 0xff33ccff, 0xff33ff00, 0xff33ff33, 0xff33ff66, 0xff33ff99, 0xff33ffcc, 0xff33ffff,
            0xff660000, 0xff660033, 0xff660066, 0xff660099, 0xff6600cc, 0xff6600ff, 0xff663300, 0xff663333,
            0xff663366, 0xff663399, 0xff6633cc, 0xff6633ff, 0xff666600, 0xff666633, 0xff666666, 0xff666699,
            0xff6666cc, 0xff6666ff, 0xff669900, 0xff669933, 0xff669966, 0xff669999, 0xff6699cc, 0xff6699ff,
            0xff66cc00, 0xff66cc33, 0xff66cc66, 0xff66cc99, 0xff66cccc, 0xff66ccff, 0xff66ff00, 0xff66ff33,
            0xff66ff66, 0xff66ff99, 0xff66ffcc, 0xff66ffff, 0xff990000, 0xff990033, 0xff990066, 0xff990099,
            0xff9900cc, 0xff9900ff, 0xff993300, 0xff993333, 0xff993366, 0xff993399, 0xff9933cc, 0xff9933ff,
            0xff996600, 0xff996633, 0xff996666, 0xff996699, 0xff9966cc, 0xff9966ff, 0xff999900, 0xff999933,
            0xff996666, 0xff999999, 0xff9999cc, 0xff9999ff, 0xff99cc00, 0xff99cc33, 0xff99cc66, 0xff99cc99,
            0xff99cccc, 0xff99ccff, 0xff99ff00, 0xff99ff33, 0xff99ff66, 0xff99ff99, 0xff99ffcc, 0xff99ffff,
            0xffcc0000, 0xffcc0033, 0xffcc0066, 0xffcc0099, 0xffcc00cc, 0xffcc00ff, 0xffcc3300, 0xffcc3333,
            0xffcc3366, 0xffcc3399, 0xffcc33cc, 0xffcc33ff, 0xffcc6600, 0xffcc6633, 0xffcc6666, 0xffcc6699,
            0xffcc66cc, 0xffcc66ff, 0xffcc9900, 0xffcc9933, 0xffcc9966, 0xffcc9999, 0xffcc99cc, 0xffcc99ff,
            0xffcccc00, 0xffcccc33, 0xffcccc66, 0xffcccc99, 0xffcccccc, 0xffccccff, 0xffccff00, 0xffccff33,
            0xffccff66, 0xffccff99, 0xffccffcc, 0xffccffff, 0xffff0000, 0xffff0033, 0xffff0066, 0xffff0099,
            0xffff00cc, 0xffff00ff, 0xffff3300, 0xffff3333, 0xffff3366, 0xffff3399, 0xffff33cc, 0xffff33ff,
            0xffff6600, 0xffff6633, 0xffff6666, 0xffff6699, 0xffff66cc, 0xffff66ff, 0xffff9900, 0xffff9933,
            0xffff9966, 0xffff9999, 0xffff99cc, 0xffff99ff, 0xffffcc00, 0xffffcc33, 0xffffcc66, 0xffffcc99,
            0xffffcccc, 0xffffccff, 0xffffff00, 0xffffff33, 0xffffff66, 0xffffff99, 0xffffffcc, 0xffffffff,

            // 4 цвета (16 палитр БК-11М по 4 цвета)
            0xff000000, 0xff0000ff, 0xff00ff00, 0xffff0000, 0xff000000, 0xffffff00, 0xffff00ff, 0xffff0000,
            0xff000000, 0xff00ffff, 0xff0000ff, 0xffff00ff, 0xff000000, 0xff00ff00, 0xff00ffff, 0xffffff00,
            0xff000000, 0xffff00ff, 0xff00ffff, 0xffffffff, 0xff000000, 0xffffffff, 0xffffffff, 0xffffffff,
            0xff000000, 0xffbf0000, 0xff9f0000, 0xffff0000, 0xff000000, 0xffbfff00, 0xff9fff00, 0xffffff00,
            0xff000000, 0xffbf00ff, 0xff9f00ff, 0xffff00ff, 0xff000000, 0xff9fff00, 0xff9f00ff, 0xff9f0000,
            0xff000000, 0xffb8ff00, 0xffbf00ff, 0xffbf0000, 0xff000000, 0xff00ffff, 0xffffff00, 0xffff0000,
            0xff000000, 0xffff0000, 0xff00ff00, 0xff00ffff, 0xff000000, 0xff00ffff, 0xffffff00, 0xffffffff,
            0xff000000, 0xffffff00, 0xff00ff00, 0xffffffff, 0xff000000, 0xff00ffff, 0xff00ff00, 0xffffffff,

            // 16 цветов
            0xff000000, 0xff0000aa, 0xff00aa00, 0xff00aaaa, 0xffaa0000, 0xffaa00aa, 0xffaa5500, 0xffaaaaaa,
            0xff555555, 0xff0000ff, 0xff00ff00, 0xff00ffff, 0xffff0000, 0xffff00ff, 0xffffff00, 0xffffffff,

            // 2 цвета (монохром)
            0xff000080, 0xffffffff
        ];

        for (let i = 0; i < this.PALETTE_SIZE && i < rawPal.length; i++) {
            const raw = rawPal[i];
            // Переставить Blue и Red для Canvas Little-Endian (0xAABBGGRR -> 0xAARRGGBB)
            const a = (raw >>> 24) & 0xFF;
            const r = (raw >>> 16) & 0xFF;
            const g = (raw >>> 8) & 0xFF;
            const b = raw & 0xFF;
            const rgba = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
            this.paletteRGBA[i] = rgba;
            this.paletteR5G5B5[i] = AzbkVideo.rgbaToR5G5B5(rgba);
        }
    }

    /**
     * Сброс регистров видеоконтроллера
     */
    reset() {
        this.regScrCsr      = 0;
        this.regScrPgNumL0  = 0;
        this.regScrPgNumL1  = 0;
        this.regScrPgNumL2  = 0;
        this.regVScrlL0     = 0;
        this.regVScrlL1     = 0;
        this.regVScrlL2     = 0;
        this.regHScrlL0     = 0;
        this.regHScrlL1     = 0;
        this.regHScrlL2     = 0;
        this.regPalCell     = 0;
        this.regPalVal      = 0;
        this.updateScreenParams(0);
    }

    /**
     * Обновление параметров видеорежима из регистра 177230
     * @param {number} v - 16-битное значение REG_SCR_CSR
     */
    updateScreenParams(v) {
        this.regScrCsr = v & 0xFFFF;
        this.videoMode = v & 7;
        this.bpp = this.BPP_TABLE[v & 3];
        this.lineLen = this.LLEN_TABLE[(v >> 3) & 3];
        this.xStretch = this.XS_TABLE[(v >> 6) & 3];
        this.yStretch = this.YS_TABLE[(v >> 9) & 3];

        let idx = (v >> 12) & 0x0F;
        if (idx > 11) idx = 11;
        this.scrlSize = this.LSCRL_TABLE[idx];
        this.scrlLines = Math.floor(this.scrlSize / this.lineLen);
        this.syncro = !!(v & 0o4000); // AZ_SCR_SYNCRO (бит 11)

        if (this.syncro) {
            this.syncFrameRegisters();
        }
    }

    /**
     * Фиксация регистров на время кадра в режиме синхронизации
     */
    syncFrameRegisters() {
        this.frameHScrlL0 = this.regHScrlL0;
        this.frameHScrlL1 = this.regHScrlL1;
        this.frameHScrlL2 = this.regHScrlL2;
        this.frameVScrlL0 = this.regVScrlL0;
        this.frameVScrlL1 = this.regVScrlL1;
        this.frameVScrlL2 = this.regVScrlL2;
        this.framePgNumL0 = this.regScrPgNumL0;
        this.framePgNumL1 = this.regScrPgNumL1;
        this.framePgNumL2 = this.regScrPgNumL2;
    }

    /**
     * Запись регистра палитры
     * @param {number} cellIdx - Индекс ячейки 0..337
     * @param {number} valR5G5B5 - Цвет в формате R5G5B5
     */
    writePalette(cellIdx, valR5G5B5) {
        if (cellIdx < 0 || cellIdx >= this.PALETTE_SIZE) return;
        const c15 = valR5G5B5 & 0x7FFF;
        this.paletteR5G5B5[cellIdx] = c15;
        this.paletteRGBA[cellIdx] = AzbkVideo.r5g5b5ToRGBA(c15);
    }

    /**
     * Чтение регистра палитры
     * @param {number} cellIdx - Индекс ячейки 0..337
     * @returns {number} 15-битный цвет R5G5B5
     */
    readPalette(cellIdx) {
        if (cellIdx < 0 || cellIdx >= this.PALETTE_SIZE) return 0;
        return this.paletteR5G5B5[cellIdx];
    }

    /**
     * Установка номера 4-цветной палитры БК-11М (0..15)
     * @param {number} p - Номер палитры 0..15
     */
    setLegacyPalette(p) {
        this.legacyPalette = p & 0xF;
    }

    /**
     * Чтение системного регистра видео/палитры (177230..177256)
     * @param {number} addr - 16-битный адрес регистра
     * @param {object} result - Объект { value: 0 }
     * @returns {boolean}
     */
    readRegister(addr, result) {
        const a = addr & 0xFFFE;
        switch (a) {
            case 0o177230: // REG_SCR_CSR
                result.value = this.regScrCsr;
                return true;
            case 0o177232: // REG_SCR_PGNUM_L0
                result.value = this.regScrPgNumL0;
                return true;
            case 0o177234: // REG_PAL_CELL
                result.value = this.regPalCell;
                return true;
            case 0o177236: // REG_PAL_VAL
                result.value = (this.regPalCell < this.PALETTE_SIZE) ? this.readPalette(this.regPalCell) : 0;
                return true;
            case 0o177240: // REG_SCR_PGNUM_L1
                result.value = this.regScrPgNumL1;
                return true;
            case 0o177242: // REG_SCR_PGNUM_L2
                result.value = this.regScrPgNumL2;
                return true;
            case 0o177244: // REG_SCR_VSCRL_L2
                result.value = this.regVScrlL2;
                return true;
            case 0o177246: // REG_SCR_VSCRL_L1
                result.value = this.regVScrlL1;
                return true;
            case 0o177250: // REG_SCR_VSCRL_L0
                result.value = this.regVScrlL0;
                return true;
            case 0o177252: // REG_SCR_HSCRL_L0
                result.value = this.regHScrlL0;
                return true;
            case 0o177254: // REG_SCR_HSCRL_L1
                result.value = this.regHScrlL1;
                return true;
            case 0o177256: // REG_SCR_HSCRL_L2
                result.value = this.regHScrlL2;
                return true;
        }
        return false;
    }

    /**
     * Запись системного регистра видео/палитры (177230..177256)
     * @param {number} addr - 16-битный адрес регистра
     * @param {number} data - 16-битное значение
     * @returns {boolean}
     */
    writeRegister(addr, data) {
        const a = addr & 0xFFFE;
        const val = data & 0xFFFF;
        switch (a) {
            case 0o177230: // REG_SCR_CSR
                this.updateScreenParams(val);
                return true;
            case 0o177232: // REG_SCR_PGNUM_L0
                this.regScrPgNumL0 = val & 0o17777;
                return true;
            case 0o177234: // REG_PAL_CELL
                this.regPalCell = val & 0x1FF;
                return true;
            case 0o177236: // REG_PAL_VAL
                if (this.regPalCell < this.PALETTE_SIZE) {
                    this.writePalette(this.regPalCell, val);
                }
                return true;
            case 0o177240: // REG_SCR_PGNUM_L1
                this.regScrPgNumL1 = val & 0o17777;
                return true;
            case 0o177242: // REG_SCR_PGNUM_L2
                this.regScrPgNumL2 = val & 0o17777;
                return true;
            case 0o177244: // REG_SCR_VSCRL_L2
                this.regVScrlL2 = val & 0x7FF;
                return true;
            case 0o177246: // REG_SCR_VSCRL_L1
                this.regVScrlL1 = val & 0x7FF;
                return true;
            case 0o177250: // REG_SCR_VSCRL_L0
                this.regVScrlL0 = val & 0x7FF;
                return true;
            case 0o177252: // REG_SCR_HSCRL_L0
                this.regHScrlL0 = val & 0xFF;
                return true;
            case 0o177254: // REG_SCR_HSCRL_L1
                this.regHScrlL1 = val & 0xFF;
                return true;
            case 0o177256: // REG_SCR_HSCRL_L2
                this.regHScrlL2 = val & 0xFF;
                return true;
        }
        return false;
    }

    /**
     * Получить ImageData объект фреймбуфера 1024×768 для рендерера
     * @returns {ImageData}
     */
    getImageData() {
        if (!this._imageData) {
            if (typeof ImageData !== 'undefined') {
                this._imageData = new ImageData(
                    new Uint8ClampedArray(this.framebuffer.buffer),
                    this.WIDTH,
                    this.HEIGHT
                );
            } else {
                this._imageData = {
                    data: new Uint8ClampedArray(this.framebuffer.buffer),
                    width: this.WIDTH,
                    height: this.HEIGHT
                };
            }
        }
        return this._imageData;
    }

    /**
     * Проверка: активен ли расширенный видеорежим AZBK
     * Если regScrCsr !== 0, то включен один из расширенных видеорежимов AZBK
     */
    isExtendedModeActive() {
        return (this.regScrCsr !== 0);
    }

    /**
     * Проверка: содержит ли текущий фреймбуфер AZBK видимые (не черные) пиксели.
     * Используется для автоматического переключения между экранами AZBK и БК.
     * @returns {boolean}
     */
    hasVisiblePixels() {
        const fb = this.framebuffer;
        const len = fb.length;
        for (let i = 0; i < len; i += 64) {
            const px = fb[i];
            if (px !== 0 && px !== 0xFF000000) {
                return true;
            }
        }
        return false;
    }

    /**
     * Построчный рендеринг кадра в `this.framebuffer` (1024×768)
     * Реализует логику `MakeScreenLine` из `AZBK_Video.cpp`
     * @param {Uint16Array} ram - 32 МБ оперативной памяти AZBK (16 М-слов)
     */
    renderFrame(ram) {
        if (!ram) return;

        // В начале кадра фиксируем параметры, если включен режим синхронизации
        if (this.syncro) {
            this.syncFrameRegisters();
        }

        const mode = this.videoMode;
        const lineLen = this.lineLen;
        const xStretch = this.xStretch;
        const yStretch = this.yStretch;
        const scrlLines = this.scrlLines > 0 ? this.scrlLines : 192;

        const pgL0 = (this.syncro ? this.framePgNumL0 : this.regScrPgNumL0) & 0o17777;
        const pgL1 = (this.syncro ? this.framePgNumL1 : this.regScrPgNumL1) & 0o17777;
        const pgL2 = (this.syncro ? this.framePgNumL2 : this.regScrPgNumL2) & 0o17777;

        // Смещение страниц в памяти AZBK (1 страница 4 КБ = 2048 слов)
        const baseOffsetL0 = pgL0 * 2048;
        const baseOffsetL1 = pgL1 * 2048;
        const baseOffsetL2 = pgL2 * 2048;

        const vScrlL0 = (this.syncro ? this.frameVScrlL0 : this.regVScrlL0) & 0xFFFF;
        const vScrlL1 = (this.syncro ? this.frameVScrlL1 : this.regVScrlL1) & 0xFFFF;
        const vScrlL2 = (this.syncro ? this.frameVScrlL2 : this.regVScrlL2) & 0xFFFF;

        const hScrlL0 = (this.syncro ? this.frameHScrlL0 : this.regHScrlL0) & 0xFFFF;
        const hScrlL1 = (this.syncro ? this.frameHScrlL1 : this.regHScrlL1) & 0xFFFF;
        const hScrlL2 = (this.syncro ? this.frameHScrlL2 : this.regHScrlL2) & 0xFFFF;

        const palRGBA = this.paletteRGBA;
        const pal4Offset = this.PAL_4_IDX + ((this.legacyPalette & 0xF) * 4);
        const pal4Offset2 = this.PAL_4_IDX + (((this.legacyPalette + 1) & 0xF) * 4);
        const pal4Offset3 = this.PAL_4_IDX + (((this.legacyPalette + 2) & 0xF) * 4);

        let curScrLinesCount = 0;
        let curScrYStretch = 0;

        for (let line = 0; line < 768; line++) {
            const dstLineOffset = line * 1024;

            // Если новая исходная строка (не повтор предыдущей при растяжении)
            if (curScrYStretch === 0) {
                let nWidth = 1024;
                let pBitsPos = 0;

                const lineIdxL0 = (curScrLinesCount + vScrlL0) % scrlLines;
                const lineIdxL1 = (curScrLinesCount + vScrlL1) % scrlLines;
                const lineIdxL2 = (curScrLinesCount + vScrlL2) % scrlLines;

                const wordOffsetL0 = baseOffsetL0 + lineIdxL0 * lineLen;
                const wordOffsetL1 = baseOffsetL1 + lineIdxL1 * lineLen;
                const wordOffsetL2 = baseOffsetL2 + lineIdxL2 * lineLen;

                let idxL0 = hScrlL0 % lineLen;
                let idxL1 = hScrlL1 % lineLen;
                let idxL2 = hScrlL2 % lineLen;

                switch (mode) {
                    case 0: { // 1 бит на цвет (2 цвета)
                        const pPal = this.PAL_2_IDX;
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;

                            for (let i = 16; i > 0 && nWidth > 0; i--) {
                                const px = palRGBA[pPal + (w & 1)];
                                w >>>= 1;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 1: { // 2 бита на цвет (4 цвета, легаси палитра БК)
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;

                            for (let i = 8; i > 0 && nWidth > 0; i--) {
                                const px = palRGBA[pal4Offset + (w & 3)];
                                w >>>= 2;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 2: { // 4 бита на цвет (16 цветов)
                        const pPal = this.PAL_16_IDX;
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;

                            for (let i = 4; i > 0 && nWidth > 0; i--) {
                                const px = palRGBA[pPal + (w & 0xF)];
                                w >>>= 4;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 3: { // 8 бит на цвет (256 цветов)
                        const pPal = this.PAL_256_IDX;
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;

                            for (let i = 2; i > 0 && nWidth > 0; i--) {
                                const px = palRGBA[pPal + (w & 0xFF)];
                                w >>>= 8;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 4: { // 1 бит на цвет (мультиплексирование 3 слоев -> 8 цветов)
                        const pPal = this.PAL_256_IDX;
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w1 = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;
                            let w2 = ram[wordOffsetL1 + idxL1++];
                            if (idxL1 >= lineLen) idxL1 = 0;
                            let w3 = ram[wordOffsetL2 + idxL2++];
                            if (idxL2 >= lineLen) idxL2 = 0;

                            for (let i = 16; i > 0 && nWidth > 0; i--) {
                                const p = ((w1 & 1) << 2) | ((w2 & 1) << 1) | (w3 & 1);
                                w1 >>>= 1; w2 >>>= 1; w3 >>>= 1;
                                const px = palRGBA[pPal + p];
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 5: { // 2 бита на цвет (3 слоя с прозрачностью)
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w1 = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;
                            let w2 = ram[wordOffsetL1 + idxL1++];
                            if (idxL1 >= lineLen) idxL1 = 0;
                            let w3 = ram[wordOffsetL2 + idxL2++];
                            if (idxL2 >= lineLen) idxL2 = 0;

                            for (let i = 8; i > 0 && nWidth > 0; i--) {
                                const p1 = w1 & 3;
                                const p2 = w2 & 3;
                                const p3 = w3 & 3;
                                const px = p1 ? palRGBA[pal4Offset + p1]
                                              : (p2 ? palRGBA[pal4Offset2 + p2]
                                                    : palRGBA[pal4Offset3 + p3]);
                                w1 >>>= 2; w2 >>>= 2; w3 >>>= 2;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 6: { // 4 бита на цвет (3 слоя с прозрачностью)
                        const pPal1 = this.PAL_256_IDX;
                        const pPal2 = this.PAL_256_IDX + 16;
                        const pPal3 = this.PAL_256_IDX + 32;

                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w1 = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;
                            let w2 = ram[wordOffsetL1 + idxL1++];
                            if (idxL1 >= lineLen) idxL1 = 0;
                            let w3 = ram[wordOffsetL2 + idxL2++];
                            if (idxL2 >= lineLen) idxL2 = 0;

                            for (let i = 4; i > 0 && nWidth > 0; i--) {
                                const p1 = w1 & 0xF;
                                const p2 = w2 & 0xF;
                                const p3 = w3 & 0xF;
                                const px = p1 ? palRGBA[pPal1 + p1]
                                              : (p2 ? palRGBA[pPal2 + p2]
                                                    : palRGBA[pPal3 + p3]);
                                w1 >>>= 4; w2 >>>= 4; w3 >>>= 4;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }

                    case 7: { // 8 бит на цвет (3 слоя с прозрачностью)
                        const pPal = this.PAL_256_IDX;
                        for (let c = lineLen; c > 0 && nWidth > 0; c--) {
                            let w1 = ram[wordOffsetL0 + idxL0++];
                            if (idxL0 >= lineLen) idxL0 = 0;
                            let w2 = ram[wordOffsetL1 + idxL1++];
                            if (idxL1 >= lineLen) idxL1 = 0;
                            let w3 = ram[wordOffsetL2 + idxL2++];
                            if (idxL2 >= lineLen) idxL2 = 0;

                            for (let i = 2; i > 0 && nWidth > 0; i--) {
                                const p1 = w1 & 0xFF;
                                const p2 = w2 & 0xFF;
                                const p3 = w3 & 0xFF;
                                const px = p1 ? palRGBA[pPal + p1]
                                              : (p2 ? palRGBA[pPal + p2]
                                                    : palRGBA[pPal + p3]);
                                w1 >>>= 8; w2 >>>= 8; w3 >>>= 8;
                                for (let sx = xStretch; sx > 0 && nWidth > 0; sx--) {
                                    this.lineBuffer[pBitsPos++] = px;
                                    nWidth--;
                                }
                            }
                        }
                        break;
                    }
                }

                // Заполнить остаток строки черным цветом, если ширина меньше 1024
                while (pBitsPos < 1024) {
                    this.lineBuffer[pBitsPos++] = 0xFF000000;
                }
            }

            // Копируем готовую строку в общий фреймбуфер
            this.framebuffer.set(this.lineBuffer, dstLineOffset);

            // Обработка повторов строки YStretch
            curScrYStretch++;
            if (curScrYStretch >= yStretch) {
                curScrYStretch = 0;
                curScrLinesCount++;
            }
        }
    }

    /**
     * Загрузка фирменного логотипа AZLOGO.RAW в страницу 32 (040 octal)
     * и включение видеорежима 063223 (как в эталоне az.ini BKemuv4)
     * @param {Uint8Array} logoBytes - Байты файла AZLOGO.RAW
     * @param {Uint16Array} ram - 32 МБ оперативной памяти AZBK
     */
    loadLogo(logoBytes, ram) {
        if (!logoBytes || !ram) return;
        // Страница 32 (040 octal) = 32 * 4096 = 131072 байт (65536 слов)
        const wordOffset = 32 * 2048;
        const lenWords = Math.min(logoBytes.length >>> 1, 65536);
        for (let i = 0; i < lenWords; i++) {
            ram[wordOffset + i] = logoBytes[i * 2] | (logoBytes[i * 2 + 1] << 8);
        }

        // Установка страницы L0 = 040 octal и видеорежима 063223
        this.regScrPgNumL0 = 0o040;
        this.updateScreenParams(0o063223);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AzbkVideo;
}
if (typeof window !== 'undefined') {
    window.AzbkVideo = AzbkVideo;
}
