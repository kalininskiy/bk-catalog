/**
 * AzbkController.js - Контроллер-расширитель AZBK (MAXIOL AZ) для BK-Catalog Web Emulator
 * 
 * Реализация на основе:
 * - Документация: bk0010-01-docs/19-AZБК.md
 * - Эталонная реализация BKemuv4 (gid): reference/BKemuv4/BK/devemu/AZBK/
 * 
 * Возможности:
 * - 32 МБ оперативной памяти (16M 16-битных слов)
 * - 16 независимых окон маппера по 4 КБ (000000..177777)
 * - Трансляция маппера БК-0011М (177716) и СМК-512 (177130)
 * - Командный процессор CSR (177220) и DR (177222)
 * - Поддержка до 32 виртуальных дисков D0..D31 (.IMG, .DSK, .BKD, .HDI)
 * - Энергонезависимая память EEPROM (CMOS) 255 слов с сохранением в localStorage
 * - RTC (часы реального времени) в форматах RT-11 и FAT
 * - Загрузка ROM (azboot, SETUP BIOS, AZLIB, системные ПЗУ)
 * - Стартовый триггер bSEL1 и вектор холодного старта
 * 
 * (c) 2026 - BK-Catalog Project
 */

class AzbkController {
    constructor(bkSystem) {
        this.bkSystem = bkSystem;

        // Константы памяти
        this.MEMORY_SIZE_BYTES = 32 * 1024 * 1024;      // 32 МБ
        this.MEMORY_SIZE_WORDS = 16 * 1024 * 1024;      // 16 М-слов
        this.WINDOW_COUNT = 16;                         // 16 окон по 4 КБ
        this.WINDOW_SIZE_WORDS = 2048;                  // 2048 слов (4 КБ)
        this.WINDOW_MASK = 0x0FFF;                      // Маска смещения в окне (4 КБ)
        this.PORTS_IO_CUTOFF = 0o177000;                // Отсечка портов ввода-вывода в окне 15

        // Версии оборудования и прошивок
        this.AZ_VERSION = 4;
        this.STM_VERSION = 18;
        this.FPGA_VERSION = 18;

        // Флаги регистра CSR (177220)
        this.CS_CMD_MASK = 0o077;
        this.CS_IE       = 0o100;                       // Разрешение прерываний
        this.CS_DONE     = 0o200;                       // Готовность контроллера
        this.CS_BIG      = 0o40000;                     // Диск > 32 МБ
        this.CS_ERR      = 0o100000;                    // Ошибка
        this.CS_VECTOR   = 0o174;                       // Вектор прерываний AZBK

        // Флаги регистра 177346 (MMU CSR)
        this.AZ_MMU_SMK_WND1_ENA = (1 << 15);
        this.AZ_MMU_WND1_REVTYPE = (1 << 14);           // 1 = доработка с управлением 037
        this.AZ_MMU_SMK_WND1_REV = (1 << 13);
        this.AZ_MMU_BRDTYPE      = (1 << 12);           // 0 = 11M, 1 = БК-10
        this.AZ_MMU_BK11EMU_ENA  = (1 << 11);           // 1 = эмуляция 11М
        this.AZ_MMU_014_OFF      = (1 << 10);
        this.AZ_MMU_037_OFF      = (1 << 9);
        this.AZ_MMU_BK11ROM_EMU  = (1 << 5);
        this.AZ_MMU_V100_ON      = (1 << 3);
        this.AZ_MMU_50HZ_TIMER   = (1 << 2);

        // Коды команд контроллера CSR
        this.CMD_RESET            = 0o00;
        this.CMD_SETUNI           = 0o01;
        this.CMD_SETBLK           = 0o02;
        this.CMD_SETBLKX          = 0o12;
        this.CMD_READ             = 0o05;
        this.CMD_READ_BUF         = 0o15;
        this.CMD_WRITE            = 0o06;
        this.CMD_WRITE_BUF        = 0o16;
        this.CMD_GET_SIZE         = 0o07;
        this.CMD_GET_SIZEX        = 0o17;
        this.CMD_GET_EEPROM       = 0o21;
        this.CMD_GET_IOBLOCK      = 0o22;
        this.CMD_PUT_IOBLOCK      = 0o23;
        this.CMD_PUT_EEPROM       = 0o24;
        this.CMD_GET_FEAT         = 0o27;
        this.CMD_NOP              = 0o30;
        this.CMD_RTC_GET_TIME_HW  = 0o31;
        this.CMD_RTC_READ_TIME    = 0o32;
        this.CMD_RTC_WRITE_TIME   = 0o33;
        this.CMD_RTC_SET_TIME_BUF = 0o34;
        this.CMD_RESET_AZBK       = 0o37;
        this.CMD_IO_GET_SDSIZE    = 0o56;
        this.CMD_IO_READ_SDSIZE   = 0o57;

        // Выделение 32 МБ оперативной памяти
        this.ram = new Uint16Array(this.MEMORY_SIZE_WORDS);

        // 16 окон маппера: номер страницы 4 КБ (0..8191) для каждого окна 0..15
        this.windows = new Uint16Array(this.WINDOW_COUNT);

        // Регистры маппера
        this.regWinCtrl = 0;                            // 177340: маска активации окон
        this.regWinRo = 0;                              // 177342: маска только для чтения
        this.regWinShadow = 0;                          // 177344: маска теневого ОЗУ
        this.regMmuCtrl = this.AZ_VERSION;              // 177346: регистр управления
        this.regCopy177130 = 0;                         // 177350: копия 177130
        this.regCopy177716 = 0;                         // 177352: копия 177716

        // Регистры контроллера
        this.azcs = this.CS_DONE;                       // 177220 (CSR)
        this.azdr = 0;                                  // 177222 (DR)
        this.azbr1 = 0;                                 // 177224 (BR1)
        this.azbr2 = 0o776;                             // 177226 (BR2)

        // Состояние обмена
        this.azunit = 0;                                // Текущий привод (0..31)
        this.azblkn = 0;                                // Номер блока (32-бит)
        this.azcmd = 0;                                 // Текущая команда

        // Буферы ввода-вывода
        this.IO_BUF_SIZE = 256;                         // 256 слов = 512 байт (1 блок)
        this.ioBuf = new Uint16Array(this.IO_BUF_SIZE);
        this.ioBufPos = 0;
        this.ioBufCount = 0;
        this.ioBufMode = 'none';                        // 'read' | 'write' | 'none'

        // Буфер EEPROM (255 слов) и буфер обмена CMOS (256 слов, AZ_IOBUF_SIZE_W)
        this.EEPROM_SIZE = 255;
        this.eeprom = new Uint16Array(this.EEPROM_SIZE);
        this.cmosBuf = new Uint16Array(256);
        this.cmosBufPos = 0;
        this.cmosBufCount = 0;

        // Буфер RTC Timestamp
        this.timestampBuf = new Uint16Array(14);
        this.timestampPos = 0;

        // Буфер размера SD-карты
        this.sdSizeBuf = new Uint16Array(2);
        this.sdSizePos = 0;

        // Таблица виртуальных дисков D0..D31
        this.MAX_UNITS = 32;
        this.drives = [];
        for (let i = 0; i < this.MAX_UNITS; i++) {
            this.drives.push({
                name: '',
                data: null,                             // Uint8Array с содержимым образа
                sizeBytes: 0,
                numBlocks: 0,
                readOnly: false
            });
        }

        // Стартовый триггер bSEL1
        this.bSEL1 = true;

        // Видеосистема AZBK: VGA 1024x768, палитра 32768, 3 слоя, скроллинг
        const VideoClass = (typeof AzbkVideo !== 'undefined') ? AzbkVideo :
                           (typeof global !== 'undefined' && global.AzbkVideo) ? global.AzbkVideo :
                           (typeof window !== 'undefined' && window.AzbkVideo) ? window.AzbkVideo : null;
        if (VideoClass) {
            this.video = new VideoClass(this);
        } else {
            this.video = null;
        }

        // Аппаратный 2D-блиттер AZBK
        const BlitterClass = (typeof AzbkBlitter !== 'undefined') ? AzbkBlitter :
                             (typeof global !== 'undefined' && global.AzbkBlitter) ? global.AzbkBlitter :
                             (typeof window !== 'undefined' && window.AzbkBlitter) ? window.AzbkBlitter : null;
        if (BlitterClass) {
            this.blitter = new BlitterClass(this);
        } else {
            this.blitter = null;
        }

        // Звуковая подсистема AZBK: Covox 16-бит, DMA PCM/ADPCM
        const SoundClass = (typeof AzbkSound !== 'undefined') ? AzbkSound :
                           (typeof global !== 'undefined' && global.AzbkSound) ? global.AzbkSound :
                           (typeof window !== 'undefined' && window.AzbkSound) ? window.AzbkSound : null;
        if (SoundClass) {
            this.sound = new SoundClass(this);
        } else {
            this.sound = null;
        }

        // Генератор псевдослучайных чисел RND (177550)
        this.nRND = 0x12345678;

        // Инициализация EEPROM и предзагрузка ПЗУ
        this._loadEEPROM();
        this._loadDefaultROMs();
    }

    /**
     * Сброс контроллера в холодное стартовое состояние
     */
    resetCold() {
        this.azcs = this.CS_DONE;
        this.azdr = 0;
        this.azunit = 0;
        this.azblkn = 0;
        this.ioBufMode = 'none';

        this.regWinCtrl = 0;
        this.regWinRo = 0;
        this.regWinShadow = 0;
        this.regMmuCtrl = this.AZ_VERSION | this.AZ_MMU_WND1_REVTYPE | 0o700;

        // Сброс видеосистемы и загрузка стартового логотипа
        if (this.video) {
            this.video.reset();
            const roms = (typeof AzbkROMs !== 'undefined') ? AzbkROMs :
                         (typeof global !== 'undefined' && global.AzbkROMs) ? global.AzbkROMs :
                         (typeof window !== 'undefined' && window.AzbkROMs) ? window.AzbkROMs : null;
            if (roms && roms.AZLOGO_RAW) {
                this.video.loadLogo(roms.AZLOGO_RAW, this.ram);
            }
        }

        // Сброс аппаратного блиттера
        if (this.blitter) {
            this.blitter.reset();
        }

        // Сброс звуковой подсистемы
        if (this.sound) {
            this.sound.reset();
        }

        // Подключаем стартовое ПЗУ (azboot.ROM: слот 0 = страница 0100 = 64 dec) в окно 15 (170000..177777)
        this.mapToWindow(15, 0o100, false);
        this.bSEL1 = true;
    }

    /**
     * Мягкий сброс по команде процессора RESET
     */
    onReset() {
        this.azcs = this.CS_DONE;
        this.azdr = 0;
        this.ioBufMode = 'none';
        this.ioBufPos = 0;
        // BKemuv4 не сбрасывает видео/палитры при сигнале INIT процессора
        if (this.blitter) {
            this.blitter.reset();
        }
        if (this.sound) {
            this.sound.reset();
        }
    }

    /**
     * Проверка, включен ли таймер 50/60 Гц (вектор 100)
     * @returns {boolean}
     */
    is50HzTimerEnabled() {
        return (this.regMmuCtrl & this.AZ_MMU_V100_ON) !== 0;
    }

    /**
     * Подключение страницы физической памяти 4 КБ в окно адресов БК
     * @param {number} wnd - Индекс окна 0..15 (шаг 4 КБ)
     * @param {number} page - Номер страницы 0..8191 в 32 МБ памяти
     * @param {boolean} isWritable - Доступ на запись (false = ПЗУ / Read-Only)
     */
    mapToWindow(wnd, page, isWritable) {
        if (wnd < 0 || wnd >= this.WINDOW_COUNT) return;
        const mask = 1 << wnd;
        this.windows[wnd] = page & 0o17777;
        this.regWinCtrl |= mask;

        // Страницы 64..127 (0100..0177) аппаратно всегда Read-Only (область ПЗУ)
        if (page >= 0o100 && page < 0o200) {
            this.regWinRo |= mask;
        } else if (isWritable) {
            this.regWinRo &= ~mask;
        } else {
            this.regWinRo |= mask;
        }
    }

    /**
     * Отключение окна от шины (обращения идут к штатной памяти БК)
     * @param {number} wnd - Индекс окна 0..15
     */
    unmapWindow(wnd) {
        if (wnd < 0 || wnd >= this.WINDOW_COUNT) return;
        this.regWinCtrl &= ~(1 << wnd);
    }

    // =========================================================================
    // Доступ к памяти через окна маппера AZBK
    // =========================================================================

    /**
     * Проверка, перехватывает ли AZBK чтение по указанному адресу
     * @param {number} addr - 16-битный адрес
     * @returns {boolean}
     */
    isAddressIntercepted(addr) {
        const ia = addr & 0xFFFF;
        if (ia >= this.PORTS_IO_CUTOFF) {
            return false; // Область системных регистров 177000..177777 не перехватывается маппером памяти
        }
        const wnd = (ia >>> 12) & 0xF;
        return !!(this.regWinCtrl & (1 << wnd));
    }

    /**
     * Чтение слова из маппированной памяти AZBK
     * @param {number} addr - 16-битный адрес
     * @param {object} result - DTO для записи результата
     * @returns {boolean}
     */
    readWordFromMemory(addr, result) {
        const ia = addr & 0xFFFF;
        const wnd = (ia >>> 12) & 0xF;
        if (!(this.regWinCtrl & (1 << wnd))) {
            return false;
        }
        const page = this.windows[wnd];
        const offsetInWindow = (ia & this.WINDOW_MASK) >>> 1;
        const physWordAddr = (page * this.WINDOW_SIZE_WORDS) + offsetInWindow;

        if (physWordAddr < this.MEMORY_SIZE_WORDS) {
            result.value = this.ram[physWordAddr] & 0xFFFF;
            return true;
        }
        return false;
    }

    /**
     * Запись слова в маппированную память AZBK
     * @param {number} addr - 16-битный адрес
     * @param {number} data - 16-битные данные
     * @returns {boolean}
     */
    writeWordToMemory(addr, data) {
        const ia = addr & 0xFFFF;
        const wnd = (ia >>> 12) & 0xF;
        const mask = (1 << wnd);

        if (!(this.regWinCtrl & mask)) {
            return false;
        }

        // Если окно в режиме Read-Only, запись блокируется
        if (this.regWinRo & mask) {
            return true; // СИП выдан, но запись проигнорирована
        }

        const page = this.windows[wnd];
        // Аппаратная блокировка записи в область ПЗУ 0100..0177
        if (page >= 0o100 && page < 0o200) {
            return true;
        }

        const offsetInWindow = (ia & this.WINDOW_MASK) >>> 1;
        const physWordAddr = (page * this.WINDOW_SIZE_WORDS) + offsetInWindow;

        if (physWordAddr < this.MEMORY_SIZE_WORDS) {
            this.ram[physWordAddr] = data & 0xFFFF;

            // Теневая запись в первые 128 КБ (страницы 0..31) при включенном shadow
            if (this.regWinShadow & mask) {
                const shadowPage = page & 0x1F;
                const shadowWordAddr = (shadowPage * this.WINDOW_SIZE_WORDS) + offsetInWindow;
                this.ram[shadowWordAddr] = data & 0xFFFF;
            }
            return true;
        }
        return false;
    }

    /**
     * Теневая фиксация записи с шины МПИ в ОЗУ AZBK
     * Вызывается при любой записи в память БК (если окно не перехвачено контроллером)
     * @param {number} addr - 16-битный адрес
     * @param {number} val - 16-битное слово или 8-битный байт
     * @param {boolean} isByte - Флаг байтовой операции
     */
    dropLegacyShadowMap(addr, val, isByte = false) {
        if (addr >= 0o177000) return;
        const wnd = (addr >>> 12) & 0xF;
        const mask = (1 << wnd);
        // Если окно отключено в маппере, но включен shadow-режим для этого окна
        if (!(this.regWinCtrl & mask) && (this.regWinShadow & mask)) {
            const page = this.windows[wnd];
            const wordOffset = (page * this.WINDOW_SIZE_WORDS) + ((addr & this.WINDOW_MASK) >>> 1);
            if (wordOffset < this.MEMORY_SIZE_WORDS) {
                if (isByte) {
                    const isOdd = (addr & 1) !== 0;
                    const byteVal = (isOdd && val > 0xFF) ? ((val >>> 8) & 0xFF) : (val & 0xFF);
                    let cur = this.ram[wordOffset];
                    if (isOdd) {
                        cur = (cur & 0x00FF) | (byteVal << 8);
                    } else {
                        cur = (cur & 0xFF00) | byteVal;
                    }
                    this.ram[wordOffset] = cur;
                } else {
                    this.ram[wordOffset] = val & 0xFFFF;
                }
            }
        }
    }

    // =========================================================================
    // Трансляция старых мапперов (177716 БК-11М и 177130 СМК-512)
    // =========================================================================

    /**
     * Перехват чтения регистра 177716
     * @returns {number}
     */
    az716Out() {
        let w = 0o100200;
        if (this.bSEL1) {
            // При старте выдаем адрес 170000 для прыжка в azboot.ROM
            w |= 0o070000;
        } else if ((this.regMmuCtrl & (this.AZ_MMU_WND1_REVTYPE | this.AZ_MMU_037_OFF | this.AZ_MMU_BK11EMU_ENA)) ===
                   (this.AZ_MMU_WND1_REVTYPE | this.AZ_MMU_037_OFF | this.AZ_MMU_BK11EMU_ENA)) {
            w |= 0o040000;
        }
        return w;
    }

    /**
     * Перехват записи в регистр 177716
     * @param {number} w - Записанное значение
     */
    az716In(w) {
        if (!(w & 0o4000)) return; // Только при наличии строба записи

        const is10 = !!(this.regMmuCtrl & this.AZ_MMU_BRDTYPE);
        const has037Mod = !!(this.regMmuCtrl & this.AZ_MMU_WND1_REVTYPE);
        const off037 = !!(this.regMmuCtrl & this.AZ_MMU_037_OFF);

        if (!is10 || (has037Mod && off037)) {
            this.regCopy177716 = w & 0xFFFF;

            // Окно 0 БК-11М: 40000..77777 (окна 4, 5, 6, 7 по 4 КБ)
            let win0Map = ((w >> 12) & 7) << 2;
            this.windows[4] = win0Map++;
            this.windows[5] = win0Map++;
            this.windows[6] = win0Map++;
            this.windows[7] = win0Map++;

            // Окно 1 БК-11М: 100000..137777 (окна 8, 9, 10, 11 по 4 КБ)
            if (w & 2) {
                // БОС ПЗУ 11М
                this.windows[8]  = 0o124;
                this.windows[9]  = 0o125;
                this.windows[10] = 0o122;
                this.windows[11] = 0o123;
            } else if (w & 1) {
                // Бейсик ПЗУ 11М
                this.windows[8]  = 0o126;
                this.windows[9]  = 0o127;
                this.windows[10] = 0o130;
                this.windows[11] = 0o131;
            } else {
                let win1Map = ((w >> 8) & 7) << 2;
                this.windows[8]  = win1Map++;
                this.windows[9]  = win1Map++;
                this.windows[10] = win1Map++;
                this.windows[11] = win1Map++;
            }

            // Окно 0 (40000..77777: окна 4, 5, 6, 7): активный маппер или теневое ОЗУ
            const win0Active = off037 ? 0x00F0 : 0;
            this.regWinCtrl = (this.regWinCtrl & ~0x00F0) | win0Active;
            this.regWinShadow = (this.regWinShadow & ~0x00F0) | ((~win0Active) & 0x00F0);

            // Подключение ПЗУ или ОЗУ в окно 1 (100000..137777: окна 8, 9, 10, 11)
            const win1Roms01 = !!(w & 3);
            const win1Roms34 = !!(w & 0o30);
            this.regWinCtrl &= ~0x0F00;
            this.regWinShadow &= ~0x0F00;
            if ((win1Roms01 && (this.regMmuCtrl & this.AZ_MMU_BK11ROM_EMU)) ||
                (!win1Roms34 && off037)) {
                this.regWinCtrl |= 0x0F00; // Активируем окна 8, 9, 10, 11
            } else if (!(win1Roms01 || win1Roms34) && !off037) {
                this.regWinShadow |= 0x0F00; // Включаем shadow для окон 8, 9, 10, 11
            }

            // Передача номера палитры БК-11М в видеосистему AZBK
            if (this.video) {
                this.video.setLegacyPalette((w >> 6) & 0xF);
            }
        }
    }

    /**
     * Перехват записи в регистр 177130 (СМК-512)
     * @param {number} w - Записанное значение
     */
    az130In(w) {
        this.regCopy177130 = w & 0xFFFF;
        // Трансляция логики СМК в маппер AZ при необходимости
    }

    // =========================================================================
    // Регистровый интерфейс портов AZBK
    // =========================================================================

    /**
     * Проверка, принадлежит ли адрес системным регистрам AZBK
     * @param {number} addr - 16-битный адрес
     * @returns {boolean}
     */
    isSystemRegister(addr) {
        const a = addr & 0xFFFE;
        // Регистры DMA (177160..177170)
        if (a >= 0o177160 && a <= 0o177170) return true;
        // Регистры звука / Covox (177200..177212)
        if (a >= 0o177200 && a <= 0o177212) return true;
        // Регистры контроллера (177220..177226)
        if (a >= 0o177220 && a <= 0o177226) return true;
        // Регистры экрана и палитры (177230..177256)
        if (a >= 0o177230 && a <= 0o177256) return true;
        // Регистры блиттера (177270..177272)
        if (a === 0o177270 || a === 0o177272) return true;
        // Регистры маппера (177300..177352, 177370)
        if (a >= 0o177300 && a <= 0o177352) return true;
        if (a === 0o177370) return true;
        // Регистр RND (177550)
        if (a === 0o177550) return true;
        return false;
    }

    /**
     * Чтение системного регистра AZBK
     * @param {number} addr - 16-битный адрес
     * @param {object} result - DTO для результата
     * @returns {boolean}
     */
    readRegister(addr, result) {
        const a = addr & 0xFFFE;

        // 1. Регистры управления маппером (177300..177336)
        if (a >= 0o177300 && a <= 0o177336) {
            const wnd = (a - 0o177300) >>> 1;
            result.value = this.windows[wnd] & 0o17777;
            return true;
        }

        switch (a) {
            case 0o177340: // Маска активации окон
                result.value = this.regWinCtrl & 0xFFFF;
                return true;
            case 0o177342: // Маска Read-Only
                result.value = this.regWinRo & 0xFFFF;
                return true;
            case 0o177344: // Маска Shadow
                result.value = this.regWinShadow & 0xFFFF;
                return true;
            case 0o177346: // Регистр управления MMU
                result.value = this.regMmuCtrl & 0xFFFF;
                return true;
            case 0o177350: // Копия записи в 177130 (СМК)
                result.value = this.regCopy177130 & 0xFFFF;
                return true;
            case 0o177352: // Копия записи в 177716 (11М)
                result.value = this.regCopy177716 & 0xFFFF;
                return true;

            // 2. Регистры контроллера STM32
            case 0o177220: // CSR
                result.value = this.readCSR();
                return true;
            case 0o177222: // DR
                result.value = this.readDR();
                return true;
            case 0o177224: // BR1
                result.value = (this.azcs & this.CS_DONE) ? 0 : 0;
                return true;
            case 0o177226: // BR2
                result.value = (this.azcs & this.CS_DONE) ? 0o776 : 0;
                return true;

            // 3. Регистр случайных чисел RND (177550)
            case 0o177550:
                // 32-битный LFSR / PRNG по алгоритму BKemuv4
                this.nRND = (((8253729 * (this.nRND ^ ((Math.random() * 0xFFFFFFFF) >>> 0)) + 2396403) >>> 0)) >>> 0;
                this.nRND = (((this.nRND >>> 7) | (this.nRND << 25)) ^ ((Math.random() * 0xFFFFFFFF) >>> 0)) >>> 0;
                result.value = this.nRND & 0xFFFF;
                return true;

            // 4. Версия контроллера (177370) - возвращает версию ПЛИС (FPGA)
            case 0o177370:
                result.value = this.FPGA_VERSION & 0xFFFF;
                return true;
        }

        // 5. Регистры экрана и палитры AZBK (177230..177256)
        if (this.video && a >= 0o177230 && a <= 0o177256) {
            return this.video.readRegister(a, result);
        }

        // 6. Регистры аппаратного блиттера AZBK (177270, 177272)
        if (this.blitter) {
            if (a === 0o177270) {
                result.value = this.blitter.readCmdRegister();
                return true;
            }
            if (a === 0o177272) {
                result.value = this.blitter.readPgnRegister();
                return true;
            }
        }

        // 7. Регистры звука и DMA (177160..177170, 177200..177212)
        if (this.sound && this.sound.isSoundRegister(a)) {
            return this.sound.readRegister(a, result);
        }

        return false;
    }

    /**
     * Запись системного регистра AZBK
     * @param {number} addr - 16-битный адрес
     * @param {number} data - 16-битные данные
     * @returns {boolean}
     */
    writeRegister(addr, data) {
        const a = addr & 0xFFFE;
        const val = data & 0xFFFF;

        // 1. Регистры номеров страниц окон (177300..177336)
        if (a >= 0o177300 && a <= 0o177336) {
            const wnd = (a - 0o177300) >>> 1;
            this.windows[wnd] = val & 0o17777;
            return true;
        }

        switch (a) {
            case 0o177340: // Маска окон
                this.regWinCtrl = val;
                return true;
            case 0o177342: // Маска Read-Only
                this.regWinRo = val;
                return true;
            case 0o177344: // Маска Shadow
                this.regWinShadow = val;
                return true;
            case 0o177346: // Управление MMU
                // Бит 14 (тип доработки) и биты 0..1 (версия платы) только для чтения!
                const roBits = this.AZ_MMU_WND1_REVTYPE | 3;
                this.regMmuCtrl = (val & ~roBits) | (this.regMmuCtrl & roBits);
                return true;

            // 2. Регистры контроллера STM32
            case 0o177220: // CSR
                this.writeCSR(val);
                return true;
            case 0o177222: // DR
                this.writeDR(val);
                return true;
            case 0o177224: // BR1
            case 0o177226: // BR2
                return true;
        }

        // 3. Регистры экрана и палитры AZBK (177230..177256)
        if (this.video && a >= 0o177230 && a <= 0o177256) {
            return this.video.writeRegister(a, val);
        }

        // 4. Регистры аппаратного блиттера AZBK (177270, 177272)
        if (this.blitter) {
            if (a === 0o177270) {
                this.blitter.writeCmdRegister(val);
                return true;
            }
            if (a === 0o177272) {
                this.blitter.writePgnRegister(val);
                return true;
            }
        }

        // 5. Регистры звука и DMA (177160..177170, 177200..177212)
        if (this.sound && this.sound.isSoundRegister(a)) {
            return this.sound.writeRegister(a, val);
        }

        return false;
    }

    // =========================================================================
    // Командный процессор CSR/DR (эмуляция контроллера STM32)
    // =========================================================================

    readCSR() {
        return this.azcs;
    }

    writeCSR(v) {
        const CS_WR_MASK = this.CS_IE | this.CS_CMD_MASK;
        this.azcs = (this.azcs & ~CS_WR_MASK) | (v & CS_WR_MASK);
        this.startCommand();
    }

    readDR() {
        if (!(this.azcs & this.CS_DONE)) {
            return this.azdr;
        }

        if (this.ioBufMode === 'read') {
            if (this.ioBufPos < this.ioBufCount) {
                this.azdr = this.ioBuf[this.ioBufPos++];
            }
            if (this.ioBufPos >= this.ioBufCount) {
                this.ioBufMode = 'none';
            }
        } else if (this.ioBufMode === 'cmos_read') {
            if (this.cmosBufPos < this.cmosBufCount) {
                this.azdr = this.cmosBuf[this.cmosBufPos++];
            }
            if (this.cmosBufPos >= this.cmosBufCount) {
                this.ioBufMode = 'none';
            }
        } else if (this.ioBufMode === 'time_read') {
            if (this.timestampPos < this.timestampBuf.length) {
                this.azdr = this.timestampBuf[this.timestampPos++];
            }
            if (this.timestampPos >= this.timestampBuf.length) {
                this.ioBufMode = 'none';
            }
        } else if (this.ioBufMode === 'sdsize_read') {
            if (this.sdSizePos < this.sdSizeBuf.length) {
                this.azdr = this.sdSizeBuf[this.sdSizePos++];
            }
            if (this.sdSizePos >= this.sdSizeBuf.length) {
                this.ioBufMode = 'none';
            }
        }

        return this.azdr;
    }

    writeDR(v) {
        this.azdr = v & 0xFFFF;
        if (!(this.azcs & this.CS_DONE)) return;

        if (this.ioBufMode === 'write') {
            if (this.ioBufPos < this.ioBufCount) {
                this.ioBuf[this.ioBufPos++] = this.azdr;
            }
            if (this.ioBufPos >= this.ioBufCount) {
                this.ioBufMode = 'none';
            }
        } else if (this.ioBufMode === 'cmos_write') {
            if (this.cmosBufPos < this.cmosBufCount) {
                this.cmosBuf[this.cmosBufPos++] = this.azdr;
            }
            if (this.cmosBufPos >= this.cmosBufCount) {
                this.ioBufMode = 'none';
            }
        }
    }

    startCommand() {
        const cmd = this.azcs & this.CS_CMD_MASK;

        if (cmd === this.CMD_RESET) {
            this.ioBufMode = 'none';
            this.ioBufPos = 0;
            this.azblkn = 0;
            this.azcs = this.CS_DONE;
            return;
        }

        if (this.azcs & this.CS_DONE) {
            this.azcmd = cmd;
            this.azcs &= ~(this.CS_DONE | this.CS_BIG | this.CS_ERR | this.CS_CMD_MASK);

            switch (this.azcmd) {
                case this.CMD_SETUNI: // Выбор диска
                    this.azunit = this.azdr & 0o37;
                    this._setDone();
                    break;

                case this.CMD_SETBLK: // Номер блока, младшие 16 бит
                    this.azblkn = ((this.azblkn & 0xFFFF0000) >>> 0) | (this.azdr & 0xFFFF);
                    this._setDone();
                    break;

                case this.CMD_SETBLKX: // Номер блока, старшие 16 бит
                    this.azblkn = ((this.azdr & 0xFFFF) << 16) | (this.azblkn & 0xFFFF);
                    this._setDone();
                    break;

                case this.CMD_READ: // Чтение блока 512 байт в буфер
                    this._executeReadBlock();
                    this._setDone();
                    break;

                case this.CMD_READ_BUF: // Начать передачу считанного блока
                    this.ioBufMode = 'read';
                    this.ioBufPos = 0;
                    this.ioBufCount = this.IO_BUF_SIZE;
                    this.azdr = this.ioBuf[0];
                    this._setDone();
                    break;

                case this.CMD_WRITE: // Записать буфер на диск
                    this._executeWriteBlock();
                    this._setDone();
                    break;

                case this.CMD_WRITE_BUF: // Принять блок данных в буфер
                    this.ioBufMode = 'write';
                    this.ioBufPos = 0;
                    this.ioBufCount = this.IO_BUF_SIZE;
                    this._setDone();
                    break;

                case this.CMD_GET_SIZE: // Размер диска в блоках (младшие 16 бит)
                    const drive = this.drives[this.azunit];
                    const numBlocks = drive ? drive.numBlocks : 0;
                    this.azdr = numBlocks & 0xFFFF;
                    if (numBlocks > 0xFFFF) {
                        this.azcs |= this.CS_BIG;
                    }
                    this._setDone();
                    break;

                case this.CMD_GET_SIZEX: // Размер диска (старшие 16 бит)
                    const driveX = this.drives[this.azunit];
                    const blocksX = driveX ? driveX.numBlocks : 0;
                    this.azdr = (blocksX >>> 16) & 0xFFFF;
                    this._setDone();
                    break;

                case this.CMD_GET_EEPROM: // Считать EEPROM в CMOS буфер (buff[0] = код ошибки 0, buff[1..255] = eeprom)
                    this.cmosBuf.fill(0);
                    this.cmosBuf[0] = 0; // Код статуса: 0 = УСПЕХ
                    for (let i = 0; i < this.EEPROM_SIZE; i++) {
                        this.cmosBuf[i + 1] = this.eeprom[i];
                    }
                    this._setDone();
                    break;

                case this.CMD_GET_IOBLOCK: // Отдать CMOS буфер на шину (256 слов)
                    this.ioBufMode = 'cmos_read';
                    this.cmosBufPos = 0;
                    this.cmosBufCount = 256;
                    this._setDone();
                    break;

                case this.CMD_PUT_IOBLOCK: // Принять CMOS буфер с шины (256 слов)
                    this.ioBufMode = 'cmos_write';
                    this.cmosBufPos = 0;
                    this.cmosBufCount = 256;
                    this.cmosBuf.fill(0);
                    this._setDone();
                    break;

                case this.CMD_PUT_EEPROM: // Сохранить CMOS буфер в EEPROM (первые 255 слов)
                    for (let i = 0; i < this.EEPROM_SIZE; i++) {
                        this.eeprom[i] = this.cmosBuf[i];
                    }
                    const ok = this._saveEEPROM();
                    if (!ok) {
                        this.azcs |= this.CS_ERR;
                    }
                    this._setDone();
                    break;

                case this.CMD_GET_FEAT: // Версия прошивки (выдача 2 слов через буфер DR)
                    this.ioBufMode = 'read';
                    this.ioBufPos = 0;
                    this.ioBufCount = 2;
                    this.ioBuf[0] = (this.STM_VERSION << 8) | (this.AZ_VERSION & 0xFF);
                    this.ioBuf[1] = this.MAX_UNITS - 1; // 31
                    this.azdr = this.ioBuf[0];
                    this._setDone();
                    break;

                case this.CMD_NOP: // Нет операции
                    this._setDone();
                    break;

                case this.CMD_RTC_GET_TIME_HW: // Получить время RTC в буфер
                    this._fillTimestamp();
                    this._setDone();
                    break;

                case this.CMD_RTC_READ_TIME: // Читать время из буфера
                    this.ioBufMode = 'time_read';
                    this.timestampPos = 0;
                    this.azdr = this.timestampBuf[0];
                    this._setDone();
                    break;

                case this.CMD_RESET_AZBK: // Перезапуск БК
                    this.onReset();
                    const targetCpu = (this.bkSystem && this.bkSystem.cpu) ? this.bkSystem.cpu :
                                      (typeof cpu !== 'undefined') ? cpu :
                                      (typeof window !== 'undefined' && window.cpu) ? window.cpu : null;
                    if (targetCpu && targetCpu.reset) {
                        targetCpu.reset();
                    }
                    this._setDone();
                    break;

                case this.CMD_IO_GET_SDSIZE: // Получить размер SD-карты
                    // Эмулируем 32 ГБ (67108864 секторов по 512 байт)
                    this.sdSizeBuf[0] = 0x0000;
                    this.sdSizeBuf[1] = 0x0400; // 0x04000000 = 67108864 секторов
                    this._setDone();
                    break;

                case this.CMD_IO_READ_SDSIZE: // Прочитать размер SD-карты (2 слова)
                    this.ioBufMode = 'sdsize_read';
                    this.sdSizePos = 0;
                    this.azdr = this.sdSizeBuf[0];
                    this._setDone();
                    break;

                default:
                    // Неизвестная команда
                    this._setDone();
                    break;
            }
        }
    }

    _setDone() {
        this.azcs |= this.CS_DONE;
        if ((this.azcmd === this.CMD_READ || this.azcmd === this.CMD_WRITE) && (this.azcs & this.CS_IE)) {
            if (this.bkSystem && this.bkSystem.cpu && this.bkSystem.cpu.irq) {
                this.bkSystem.cpu.irq(this.CS_VECTOR);
            }
        }
    }

    _executeReadBlock() {
        const drive = this.drives[this.azunit];
        if (!drive || !drive.data) {
            this.azcs |= this.CS_ERR;
            return;
        }

        if (typeof this.onDiskActivity === 'function') {
            this.onDiskActivity(this.azunit, false);
        }

        const byteOffset = this.azblkn * 512;
        if (byteOffset + 512 > drive.sizeBytes) {
            this.azcs |= this.CS_ERR;
            return;
        }

        const u8 = drive.data;
        for (let i = 0; i < this.IO_BUF_SIZE; i++) {
            const idx = byteOffset + (i << 1);
            this.ioBuf[i] = u8[idx] | (u8[idx + 1] << 8);
        }
    }

    _executeWriteBlock() {
        const drive = this.drives[this.azunit];
        if (!drive || !drive.data || drive.readOnly) {
            this.azcs |= this.CS_ERR;
            return;
        }

        if (typeof this.onDiskActivity === 'function') {
            this.onDiskActivity(this.azunit, true);
        }

        const byteOffset = this.azblkn * 512;
        if (byteOffset + 512 > drive.sizeBytes) {
            this.azcs |= this.CS_ERR;
            return;
        }

        const u8 = drive.data;
        for (let i = 0; i < this.IO_BUF_SIZE; i++) {
            const word = this.ioBuf[i];
            const idx = byteOffset + (i << 1);
            u8[idx] = word & 0xFF;
            u8[idx + 1] = (word >>> 8) & 0xFF;
        }
    }

    // =========================================================================
    // RTC и энергонезависимая память EEPROM
    // =========================================================================

    _fillTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const wday = now.getDay();
        const hour = now.getHours();
        const min = now.getMinutes();
        const sec = now.getSeconds();

        // Формат RT-11
        const rt11date = (month & 0o17) | ((day & 0o37) << 4) | (((year - 1972) & 0o37) << 9);
        const secsToday = hour * 3600 + min * 60 + sec;
        const rt11time50 = secsToday * 50;
        const rt11time60 = secsToday * 60;

        // Формат FAT
        const fatdate = (day & 0o37) | ((month & 0o17) << 5) | (((year - 1980) & 0o177) << 9);
        const fattime = (((sec >>> 1) & 0o37)) | ((min & 0o77) << 5) | ((hour & 0o37) << 11);

        this.timestampBuf[0] = rt11date & 0xFFFF;
        this.timestampBuf[1] = (rt11time50 >>> 16) & 0xFFFF;
        this.timestampBuf[2] = rt11time50 & 0xFFFF;
        this.timestampBuf[3] = (rt11time60 >>> 16) & 0xFFFF;
        this.timestampBuf[4] = rt11time60 & 0xFFFF;
        this.timestampBuf[5] = fatdate & 0xFFFF;
        this.timestampBuf[6] = fattime & 0xFFFF;
        this.timestampBuf[7] = year & 0xFFFF;
        this.timestampBuf[8] = month & 0xFFFF;
        this.timestampBuf[9] = day & 0xFFFF;
        this.timestampBuf[10] = wday & 0xFFFF;
        this.timestampBuf[11] = hour & 0xFFFF;
        this.timestampBuf[12] = min & 0xFFFF;
        this.timestampBuf[13] = sec & 0xFFFF;
    }

    /**
     * Загрузка энергонезависимой памяти EEPROM из localStorage
     * или инициализация заводскими настройками по умолчанию (eeprom.dat)
     */
    _loadEEPROM() {
        let loaded = false;
        try {
            if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
                const saved = localStorage.getItem('bk_azbk_eeprom');
                if (saved) {
                    const arr = JSON.parse(saved);
                    // Проверяем корректность размера и сигнатуру 0o123456 в нулевом слове
                    if (Array.isArray(arr) && arr.length >= this.EEPROM_SIZE && (arr[0] & 0xFFFF) === 0o123456) {
                        for (let i = 0; i < this.EEPROM_SIZE; i++) {
                            this.eeprom[i] = arr[i] & 0xFFFF;
                        }
                        loaded = true;
                    }
                }
            }
        } catch (e) {}

        if (!loaded) {
            this._resetDefaultEEPROM();
        }
    }

    /**
     * Заводская конфигурация по умолчанию (из reference/Release_x64/AZBK/eeprom.dat):
     * Слово 0: сигнатура 0o123456
     * Слово 1: контрольная сумма 0o13207
     * Слова 2..254: системные настройки BIOS AZBK
     */
    _resetDefaultEEPROM() {
        this.eeprom.fill(0);
        try {
            // Закодированный в base64 заводской eeprom.dat (510 байт = 255 слов)
            const b64 = 'LqeHFgAAAAAAAAAAAQAAAAEAAQAAAX8AAAH/AAAAfwAAAcCoAFDAqABawKgAAQABAgMEBUFaTkVULUJLMTAuaG9tZS5tYXhpb2wuY29tAAAAAAAAAAD/////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
            const bin = (typeof atob !== 'undefined') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
            for (let i = 0; i < this.EEPROM_SIZE; i++) {
                const lo = bin.charCodeAt(i * 2);
                const hi = bin.charCodeAt(i * 2 + 1);
                this.eeprom[i] = (lo | (hi << 8)) & 0xFFFF;
            }
        } catch (e) {
            this.eeprom[0] = 0o123456;
            this.eeprom[1] = 0o13207;
        }
        this._saveEEPROM();
    }

    /**
     * Сохранение EEPROM в localStorage
     * @returns {boolean}
     */
    _saveEEPROM() {
        try {
            if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
                const arr = Array.from(this.eeprom);
                localStorage.setItem('bk_azbk_eeprom', JSON.stringify(arr));
            }
        } catch (e) {}
        return true;
    }

    // =========================================================================
    // Загрузка образов ROM в физическую память AZBK
    // =========================================================================

    _loadDefaultROMs() {
        const ROMS = (typeof window !== 'undefined' && window.AzbkROMs) ? window.AzbkROMs :
                     (typeof require !== 'undefined' ? require('../../system/AzbkROMs.js') : null);

        if (!ROMS) return;

        // Вспомогательная функция записи байтового буфера в память AZBK по смещению
        const loadBytesToMemory = (byteOffset, u8Data) => {
            if (!u8Data) return;
            const wordOffset = byteOffset >>> 1;
            const wordCount = u8Data.length >>> 1;
            for (let i = 0; i < wordCount; i++) {
                const byteIdx = i << 1;
                this.ram[wordOffset + i] = u8Data[byteIdx] | (u8Data[byteIdx + 1] << 8);
            }
            if (u8Data.length & 1) {
                this.ram[wordOffset + wordCount] = u8Data[u8Data.length - 1];
            }
        };

        // 1. Загрузка логотипа AZLOGO.RAW в страницу 040 (32 dec = смещение 128 КБ)
        if (ROMS.AZLOGO_RAW) {
            loadBytesToMemory(128 * 1024, ROMS.AZLOGO_RAW);
        }

        // 2. Загрузка слотов ROM в область 256..512 КБ (слоты 0..63 по 4 КБ)
        const ROM_BASE = 256 * 1024; // 256 КБ
        const SLOT_SIZE = 4 * 1024;  // 4 КБ

        // R00: azboot.ROM
        if (ROMS.azboot_ROM) {
            loadBytesToMemory(ROM_BASE + 0 * SLOT_SIZE, ROMS.azboot_ROM);
        }
        // R01..R04: AZLIB00..AZLIB03
        if (ROMS.AZLIB00_ROM) loadBytesToMemory(ROM_BASE + 1 * SLOT_SIZE, ROMS.AZLIB00_ROM);
        if (ROMS.AZLIB01_ROM) loadBytesToMemory(ROM_BASE + 2 * SLOT_SIZE, ROMS.AZLIB01_ROM);
        if (ROMS.AZLIB02_ROM) loadBytesToMemory(ROM_BASE + 3 * SLOT_SIZE, ROMS.AZLIB02_ROM);
        if (ROMS.AZLIB03_ROM) loadBytesToMemory(ROM_BASE + 4 * SLOT_SIZE, ROMS.AZLIB03_ROM);

        // R08: AZ337.ROM
        if (ROMS.AZ337_ROM) loadBytesToMemory(ROM_BASE + 8 * SLOT_SIZE, ROMS.AZ337_ROM);

        // R56: SETUP.ROM (AZBK BIOS Setup Utility v1.05)
        if (ROMS.SETUP_ROM) {
            loadBytesToMemory(ROM_BASE + 56 * SLOT_SIZE, ROMS.SETUP_ROM);
        }

        // 3. Загрузка системных ПЗУ БК-11М и БК-0010 (если доступны из SystemROMs)
        if (typeof b11mbos_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 16 * SLOT_SIZE, b11mbos_data);
        }
        if (typeof b11mext_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 20 * SLOT_SIZE, b11mext_data);
        }
        if (typeof bas11m0_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 22 * SLOT_SIZE, bas11m0_data);
        }
        if (typeof bas11m1_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 24 * SLOT_SIZE, bas11m1_data);
        }
        if (typeof monit10_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 28 * SLOT_SIZE, monit10_data);
        }
        if (typeof basic10_data !== 'undefined') {
            this._copyWordsToMemory(ROM_BASE + 30 * SLOT_SIZE, basic10_data);
        }
    }

    _copyWordsToMemory(byteOffset, u16Words) {
        if (!u16Words) return;
        const wordOffset = byteOffset >>> 1;
        for (let i = 0; i < u16Words.length; i++) {
            this.ram[wordOffset + i] = u16Words[i] & 0xFFFF;
        }
    }

    // =========================================================================
    // Управление приводами дисков D0..D31
    // =========================================================================

    /**
     * Смонтировать образ диска в слот D0..D31
     * @param {number} unit - Номер привода 0..31
     * @param {string} filename - Имя файла
     * @param {Uint8Array|Array} bytes - Содержимое файла
     * @param {boolean} [readOnly=false] - Флаг защиты от записи
     */
    attachDisk(unit, filename, bytes, readOnly = false) {
        if (unit < 0 || unit >= this.MAX_UNITS) return false;
        const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
        this.drives[unit] = {
            name: filename,
            data: u8,
            sizeBytes: u8.length,
            numBlocks: (u8.length + 511) >>> 9,
            readOnly: !!readOnly
        };
        return true;
    }

    /**
     * Размонтировать образ диска
     * @param {number} unit - Номер привода 0..31
     */
    detachDisk(unit) {
        if (unit < 0 || unit >= this.MAX_UNITS) return;
        this.drives[unit] = {
            name: '',
            data: null,
            sizeBytes: 0,
            numBlocks: 0,
            readOnly: false
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AzbkController;
}
if (typeof window !== 'undefined') {
    window.AzbkController = AzbkController;
}
