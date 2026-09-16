/**
 * SmkMemoryManager - Менеджер дополнительной памяти контроллера СМК-512 (АльтПро)
 * 
 * Точная реализация на основе референсного эмулятора bkemu-android (Java):
 * @link https://github.com/3cky/bkemu-android
 * 
 * Обеспечивает:
 * - 512 КБ дополнительного ОЗУ (ДОЗУ), разбитого на 16 страниц по 32 КБ (128 сегментов по 4 КБ)
 * - 8 аппаратных режимов работы (SYS, Std10, ОЗУ10, All, Std11, ОЗУ11, Hlt10, Hlt11)
 * - Трёхтактный протокол переключения раскладки памяти по спаду строба через регистр 177130
 * - Подключение ПЗУ контроллера (4 КБ) в окне 160000..167777 и зеркала в 170000..177777 (режим SYS)
 * - Теневую запись в HALT-режимах (Hlt10, Hlt11) для области системных регистров 177000..177777
 * - Управление доступом к фоновым ПЗУ Монитора БК-10, БОС БК-11М и дополнительному ОЗУ БК-11М
 * 
 * (c) 2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
class SmkMemoryManager {
    constructor(bkSystem) {
        // Ссылка на базовую систему БК
        this.bkSystem = bkSystem;

        // Константы памяти (в словах)
        this.MEMORY_TOTAL_SIZE = 512 * 1024 / 2; // 256 K-слов (512 КБ)
        this.MEMORY_START_ADDRESS = 0o100000;    // Начальный адрес окна ДОЗУ: 0100000 (32768)
        this.NUM_MEMORY_SEGMENTS = 8;            // 8 сегментов по 4 КБ в окне 100000..177777
        this.MEMORY_SEGMENT_SIZE = 2048;         // Размер сегмента в словах (4 КБ = 2048 слов)
        this.SEGMENT_7_NON_RESTRICTED = 0o3400;  // Неограниченная область сегмента 7 (170000..176777) = 1792 слова

        // Шаблон строба переключения (младшая тетрада = 6)
        this.STROBE_PATTERN = 0b0110;

        // Маски регистра 177130
        this.LAYOUT_MODE_MASK = 0o160;
        this.LAYOUT_PAGE_MASK = 0o2015;

        // Коды режимов СМК
        this.MODE_SYS   = 0o160;
        this.MODE_STD10 = 0o060;
        this.MODE_RAM10 = 0o120;
        this.MODE_ALL   = 0o020;
        this.MODE_STD11 = 0o140;
        this.MODE_RAM11 = 0o040;
        this.MODE_HLT10 = 0o100;
        this.MODE_HLT11 = 0o000;

        // 512 КБ ОЗУ (262144 16-битных слов)
        this.ram = new Uint16Array(this.MEMORY_TOTAL_SIZE);

        // Текущее состояние конфигурации
        this.currentLayout = this.MODE_SYS;
        this.currentMode = this.MODE_SYS;
        this.currentPage = 0;
        this.pageStartIndex = 0;
        this.memoryLayoutUpdateStrobe = false;
        this.lastControlReg = 0;

        // Флаги доступности фоновых областей памяти (по аналогии с SelectableMemory в Java)
        this.bk10MonitorRomSelected = true;
        this.bk11BosRomSelected = true;
        this.bk11SecondBankedMemorySelected = true;

        // 8 сегментов памяти в окне 100000..177777
        this.segments = [];
        for (let i = 0; i < this.NUM_MEMORY_SEGMENTS; i++) {
            this.segments.push({
                activeIndex: -1,
                isRom: false,
                readableWords: 0,
                writableWords: 0,
                shadowWrite: false
            });
        }

        // Инициализация стартовой конфигурации
        this.init(true);
    }

    /**
     * Сброс менеджера памяти в исходное состояние (режим SYS, страница 0)
     * @param {boolean} [isHardwareReset=false] - Сброс раскладки памяти только при аппаратном сбросе
     */
    init(isHardwareReset = false) {
        this.memoryLayoutUpdateStrobe = false;
        this.lastControlReg = 0;
        if (isHardwareReset) {
            this.updateMemoryLayout(this.MODE_SYS);
        }
    }

    /**
     * Обработка записи в регистр управления 177130 для отслеживания трёхтактного строба.
     * Раскладка памяти обновляется по спаду строба (когда строб снимается).
     * @param {number} value - Записанное 16-битное значение
     */
    writeControlRegister(value) {
        this.lastControlReg = value & 0xFFFF;
        const lastStrobe = this.memoryLayoutUpdateStrobe;
        this.memoryLayoutUpdateStrobe = (value & 0b1111) === this.STROBE_PATTERN;

        // Память переключается на спаде строба
        if (lastStrobe && !this.memoryLayoutUpdateStrobe) {
            this.updateMemoryLayout(value);
        }
    }

    /**
     * Проверка, включен ли режим All (020)
     * @returns {boolean}
     */
    isModeAll() {
        return this.currentMode === this.MODE_ALL;
    }

    /**
     * Проверка, включен ли режим HALT (Hlt10 или Hlt11)
     * @returns {boolean}
     */
    isHltMode() {
        return this.currentMode === this.MODE_HLT10 || this.currentMode === this.MODE_HLT11;
    }

    /**
     * Сброс всех сегментов окна перед установкой нового режима
     */
    resetSegments() {
        for (let i = 0; i < this.NUM_MEMORY_SEGMENTS; i++) {
            this.segments[i].activeIndex = -1;
            this.segments[i].isRom = false;
            this.segments[i].readableWords = 0;
            this.segments[i].writableWords = 0;
            this.segments[i].shadowWrite = false;
        }
        this.bk10MonitorRomSelected = true;
        this.bk11BosRomSelected = true;
        this.bk11SecondBankedMemorySelected = true;
    }

    /**
     * Настройка сегмента памяти
     * @param {number} segment - Номер сегмента в окне (0..7)
     * @param {number} activeIndex - Индекс сегмента в ДОЗУ (0..127)
     * @param {number} readableWords - Доступно слов для чтения
     * @param {number} writableWords - Доступно слов для записи
     */
    setupSegment(segment, activeIndex, readableWords = this.MEMORY_SEGMENT_SIZE, writableWords = this.MEMORY_SEGMENT_SIZE) {
        const seg = this.segments[segment];
        seg.activeIndex = activeIndex;
        seg.isRom = false;
        seg.readableWords = readableWords;
        seg.writableWords = writableWords;
        seg.shadowWrite = false;
    }

    /**
     * Настройка сегмента 7 (область 170000..177777)
     * @param {number} activeIndex - Индекс сегмента в ДОЗУ
     * @param {boolean} isExtentReadable - Доступна ли область 177000..177777 для чтения
     * @param {boolean} isExtentWritable - Доступна ли область 177000..177777 для записи (теневая запись)
     */
    setupSegment7(activeIndex, isExtentReadable, isExtentWritable) {
        const seg = this.segments[7];
        seg.activeIndex = activeIndex;
        seg.isRom = false;
        seg.readableWords = isExtentReadable ? this.MEMORY_SEGMENT_SIZE : this.SEGMENT_7_NON_RESTRICTED;
        seg.writableWords = isExtentWritable ? this.MEMORY_SEGMENT_SIZE : this.SEGMENT_7_NON_RESTRICTED;
        seg.shadowWrite = isExtentWritable;
    }

    /**
     * Обновление карты памяти при переключении режима и страницы
     * В точности повторяет su.comp.bk.arch.io.memory.SmkMemoryManager#setupMemoryLayout
     * @param {number} memoryLayoutValue - Значение режима и страницы
     */
    updateMemoryLayout(memoryLayoutValue) {
        this.currentLayout = memoryLayoutValue & 0xFFFF;
        const pageValue = memoryLayoutValue & this.LAYOUT_PAGE_MASK;
        const modeValue = memoryLayoutValue & this.LAYOUT_MODE_MASK;
        this.currentMode = modeValue;

        // Расчёт начального индекса 4 КБ сегмента для выбранной 32 КБ страницы:
        // pageStartIndex = разр.10*1 + разр.02*2 + разр.03*4 + разр.00*8 (умноженное на 8 сегментов)
        let pageStartIndex = 0;
        if ((pageValue & 0o2000) !== 0) pageStartIndex += 0o10; // 8
        if ((pageValue & 4) !== 0)      pageStartIndex += 0o20; // 16
        if ((pageValue & 0o10) !== 0)   pageStartIndex += 0o40; // 32
        if ((pageValue & 1) !== 0)      pageStartIndex += 0o100; // 64

        this.pageStartIndex = pageStartIndex;
        this.currentPage = pageStartIndex >> 3;

        this.resetSegments();

        switch (modeValue) {
            case this.MODE_SYS: // 0160 - Стартовый режим
                this.setupSegment(2, pageStartIndex + 6);
                this.setupSegment(3, pageStartIndex + 7);
                this.setupSegment(4, pageStartIndex + 0);
                this.setupSegment(5, pageStartIndex + 1);
                // Сегменты 6 и 7 - ПЗУ контроллера (зеркало в 170000..177777)
                this.segments[6].isRom = true;
                this.segments[6].readableWords = this.MEMORY_SEGMENT_SIZE;
                this.segments[7].isRom = true;
                this.segments[7].readableWords = this.MEMORY_SEGMENT_SIZE;
                this.bk11BosRomSelected = false;
                this.bk11SecondBankedMemorySelected = false;
                break;

            case this.MODE_STD10: // 060 - Штатный режим БК-0010
                this.setupSegment(2, pageStartIndex + 2);
                this.setupSegment(3, pageStartIndex + 3);
                this.setupSegment(4, pageStartIndex + 4);
                this.setupSegment(5, pageStartIndex + 5);
                this.setupSegment7(pageStartIndex + 7, false, false);
                this.segments[6].isRom = true;
                this.segments[6].readableWords = this.MEMORY_SEGMENT_SIZE;
                this.bk11BosRomSelected = false;
                this.bk11SecondBankedMemorySelected = false;
                break;

            case this.MODE_RAM10: // 0120 - ОЗУ10 (сплошная страница ДОЗУ)
                this.setupSegment(0, pageStartIndex + 0);
                this.setupSegment(1, pageStartIndex + 1);
                this.setupSegment(2, pageStartIndex + 2);
                this.setupSegment(3, pageStartIndex + 3);
                this.setupSegment(4, pageStartIndex + 4);
                this.setupSegment(5, pageStartIndex + 5);
                this.setupSegment(6, pageStartIndex + 6);
                this.setupSegment7(pageStartIndex + 7, false, false);
                this.bk10MonitorRomSelected = false;
                this.bk11BosRomSelected = false;
                this.bk11SecondBankedMemorySelected = false;
                break;

            case this.MODE_ALL: // 020 - Режим All (смещение на 4 сегмента)
                this.setupSegment(0, pageStartIndex + 4);
                this.setupSegment(1, pageStartIndex + 5);
                this.setupSegment(2, pageStartIndex + 6);
                this.setupSegment(3, pageStartIndex + 7);
                this.setupSegment(4, pageStartIndex + 0);
                this.setupSegment(5, pageStartIndex + 1);
                this.setupSegment(6, pageStartIndex + 2);
                // Сегмент 3 подключен в окно 7 и доступен для чтения по всей длине 170000..177777
                this.setupSegment7(pageStartIndex + 3, true, false);
                this.bk10MonitorRomSelected = false;
                this.bk11BosRomSelected = false;
                this.bk11SecondBankedMemorySelected = false;
                break;

            case this.MODE_STD11: // 0140 - Штатный режим БК-0011М
                this.setupSegment7(pageStartIndex + 7, false, false);
                this.segments[6].isRom = true;
                this.segments[6].readableWords = this.MEMORY_SEGMENT_SIZE;
                // Фоновые области БК-11М остаются активными:
                // bk10MonitorRomSelected, bk11BosRomSelected, bk11SecondBankedMemorySelected = true
                break;

            case this.MODE_RAM11: // 040 - ОЗУ11 (сегменты 4..7)
                this.setupSegment(4, pageStartIndex + 4);
                this.setupSegment(5, pageStartIndex + 5);
                this.setupSegment(6, pageStartIndex + 6);
                this.setupSegment7(pageStartIndex + 7, false, false);
                this.bk11BosRomSelected = false;
                break;

            case this.MODE_HLT10: // 0100 - Hlt10 (с защитой сегмента 0 от записи и теневой записью)
                this.setupSegment(0, pageStartIndex + 0, this.MEMORY_SEGMENT_SIZE, 0); // Только чтение
                this.setupSegment(1, pageStartIndex + 1);
                this.setupSegment(2, pageStartIndex + 2);
                this.setupSegment(3, pageStartIndex + 3);
                this.setupSegment(4, pageStartIndex + 4);
                this.setupSegment(5, pageStartIndex + 5);
                this.setupSegment(6, pageStartIndex + 6);
                this.setupSegment7(pageStartIndex + 7, false, true); // Теневая запись в 177000..177777
                this.bk10MonitorRomSelected = false;
                this.bk11BosRomSelected = false;
                this.bk11SecondBankedMemorySelected = false;
                break;

            case this.MODE_HLT11: // 0 - Hlt11 (сегменты 4..7 с теневой записью)
                this.setupSegment(4, pageStartIndex + 4);
                this.setupSegment(5, pageStartIndex + 5);
                this.setupSegment(6, pageStartIndex + 6);
                this.setupSegment7(pageStartIndex + 7, false, true); // Теневая запись в 177000..177777
                this.bk10MonitorRomSelected = false;
                this.bk11BosRomSelected = false;
                break;
        }
    }

    /**
     * Получить данные ПЗУ СМК-512 (поддержка браузера и Node.js)
     * @returns {Uint16Array|number[]|null}
     */
    getRom() {
        if (typeof smk512_data !== 'undefined' && smk512_data) return smk512_data;
        if (typeof global !== 'undefined' && global.smk512_data) return global.smk512_data;
        if (typeof window !== 'undefined' && window.smk512_data) return window.smk512_data;
        if (typeof SystemROMs !== 'undefined' && SystemROMs.smk512_data) return SystemROMs.smk512_data;
        return null;
    }

    /**
     * Проверить, перехватывается ли данный адрес окном контроллера СМК
     * @param {number} addr - 16-битный адрес
     * @returns {boolean}
     */
    isSegmentIntercepted(addr) {
        const ia = addr & 0xFFFF;
        if (ia < this.MEMORY_START_ADDRESS) return false;
        if (ia >= 0o177740 && ia <= 0o177756) return false; // Регистры IDE
        const segIndex = (ia - this.MEMORY_START_ADDRESS) >> 12;
        if (segIndex === 7) {
            return this.segments[7].isRom || this.currentMode === this.MODE_ALL || ((ia & 0o7777) >> 1) < this.SEGMENT_7_NON_RESTRICTED;
        }
        const seg = this.segments[segIndex];
        return seg && (seg.activeIndex >= 0 || seg.isRom);
    }

    /**
     * Чтение 16-битного слова из адресного пространства СМК
     * @param {number} addr - 16-битный адрес
     * @param {Object} result - DTO для сохранения значения (result.value)
     * @returns {boolean} true если адрес обработан СМК, false если передать БК
     */
    readWord(addr, result) {
        const ia = addr & 0xFFFF;
        if (ia < this.MEMORY_START_ADDRESS) {
            return false;
        }

        // Регистры IDE обрабатываются контроллером SmkIdeController
        if (ia >= 0o177740 && ia <= 0o177756) {
            return false;
        }

        const segIndex = (ia - this.MEMORY_START_ADDRESS) >> 12; // 0..7
        const wordOffset = (ia & 0o7777) >> 1;                   // 0..2047
        const seg = this.segments[segIndex];

        // Сегмент 7 (170000..177777)
        if (segIndex === 7) {
            // В режиме SYS ПЗУ зеркалится на всю область 170000..177777
            if (seg.isRom) {
                // Регистры клавиатуры, экрана и дисковода пропускаем к аппаратуре БК
                // Адрес 0177716 (вектор запуска процессора) читается из ПЗУ СМК (0166400)!
                if (ia === 0o177660 || ia === 0o177662 || ia === 0o177664 || ia === 0o177714 || ia === 0o177130 || ia === 0o177132) {
                    return false;
                }
                const rom = this.getRom();
                if (rom && wordOffset < rom.length) {
                    result.value = rom[wordOffset];
                    return true;
                }
                return false;
            }

            // В режиме All сегмент 3 читается по всей области 170000..177777
            if (this.currentMode === this.MODE_ALL) {
                if (ia === 0o177660 || ia === 0o177662 || ia === 0o177664 || ia === 0o177714 || ia === 0o177716 || ia === 0o177130 || ia === 0o177132) {
                    return false;
                }
                if (seg.activeIndex >= 0 && wordOffset < seg.readableWords) {
                    result.value = this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset];
                    return true;
                }
                return false;
            }

            // В остальных режимах читается ОЗУ 170000..176777 (до 1792 слов)
            if (wordOffset < this.SEGMENT_7_NON_RESTRICTED && seg.activeIndex >= 0) {
                result.value = this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset];
                return true;
            }

            // Область 177000..177777 пропускается к системным регистрам БК
            return false;
        }

        // Сегмент 6 (160000..167777)
        if (segIndex === 6) {
            if (seg.isRom) {
                const rom = this.getRom();
                if (rom && wordOffset < rom.length) {
                    result.value = rom[wordOffset];
                    return true;
                }
                return false;
            }
            if (seg.activeIndex >= 0 && wordOffset < seg.readableWords) {
                result.value = this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset];
                return true;
            }
            return false;
        }

        // Сегменты 0..5 (100000..157777)
        if (seg.activeIndex >= 0 && wordOffset < seg.readableWords) {
            result.value = this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset];
            return true;
        }

        // Сегмент не активен в СМК (activeIndex === -1).
        // Проверяем, разрешен ли доступ к фоновому ПЗУ/ОЗУ БК в данном режиме:
        if (this.bkSystem && this.bkSystem.isM && this.bkSystem.isM()) {
            // Для БК-0011М:
            if (segIndex <= 3 && !this.bk11SecondBankedMemorySelected) {
                result.value = -1; // Bus error
                return false;
            }
            if ((segIndex === 4 || segIndex === 5) && !this.bk11BosRomSelected) {
                result.value = -1; // Bus error
                return false;
            }
        } else {
            // Для БК-0010:
            if (segIndex <= 1 && !this.bk10MonitorRomSelected) {
                result.value = -1; // Bus error
                return false;
            }
        }

        return false; // Разрешено чтение из базовой памяти БК (mmap)
    }

    /**
     * Запись 16-битного слова в адресное пространство СМК
     * @param {number} addr - 16-битный адрес
     * @param {number} data - Записываемое слово
     * @returns {boolean} true если запись обработана СМК
     */
    writeWord(addr, data) {
        const ia = addr & 0xFFFF;
        if (ia < this.MEMORY_START_ADDRESS) {
            return false;
        }

        // Регистры IDE обрабатываются контроллером SmkIdeController
        if (ia >= 0o177740 && ia <= 0o177756) {
            return false;
        }

        const segIndex = (ia - this.MEMORY_START_ADDRESS) >> 12;
        const wordOffset = (ia & 0o7777) >> 1;
        const seg = this.segments[segIndex];

        // Сегмент 7 (170000..177777)
        if (segIndex === 7) {
            if (seg.isRom) {
                return false; // ПЗУ не перезаписывается
            }

            // До адреса 177000 (неограниченная часть сегмента 7)
            if (wordOffset < this.SEGMENT_7_NON_RESTRICTED) {
                if (seg.activeIndex >= 0 && wordOffset < seg.writableWords) {
                    this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset] = data & 0xFFFF;
                    return true;
                }
                return false;
            }

            // Теневая запись в области 177000..177777 (Hlt10, Hlt11)
            if (seg.shadowWrite && seg.activeIndex >= 0) {
                this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset] = data & 0xFFFF;
                return false; // Запись также передаётся в системные регистры БК
            }

            return false;
        }

        // Сегмент 6 (160000..167777)
        if (segIndex === 6) {
            if (seg.isRom) {
                return false; // Ошибка шины при попытке записи в ПЗУ
            }
            if (seg.activeIndex >= 0 && wordOffset < seg.writableWords) {
                this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset] = data & 0xFFFF;
                return true;
            }
            return false;
        }

        // Сегменты 0..5 (включая защиту от записи квази-ПЗУ в Hlt10, где writableWords === 0)
        if (seg.activeIndex >= 0) {
            if (wordOffset < seg.writableWords) {
                this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset] = data & 0xFFFF;
                return true;
            }
            return false; // Защищено от записи
        }

        return false;
    }

    /**
     * Теневая запись в сегмент 7 (вызывается при записи в область 177000..177777 в HALT-режимах)
     * @param {number} addr - Адрес записи
     * @param {number} data - Данные
     */
    shadowWrite(addr, data) {
        const seg = this.segments[7];
        if (seg.shadowWrite && seg.activeIndex >= 0) {
            const wordOffset = (addr & 0o7777) >> 1;
            this.ram[seg.activeIndex * this.MEMORY_SEGMENT_SIZE + wordOffset] = data & 0xFFFF;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmkMemoryManager;
}
