/**
 * AzbkBlitter.js - Аппаратный 2D-блиттер контроллера AZBK (MAXIOL AZ Hardware Blitter)
 * 
 * Реализация на основе:
 * - reference/BKemuv4/BK/devemu/AZBK/AZBK_Blitter.h
 * - reference/BKemuv4/BK/devemu/AZBK/AZBK_Blitter.cpp
 * - reference/BKemuv4/BK/devemu/AZBK/AZBK_const.h
 * 
 * Назначение:
 * - Аппаратное ускорение 2D-графики: перемещение спрайтов, заливка прямоугольников,
 *   наложение с прозрачным цветом (Color Keying), сохранение/восстановление фона,
 *   контурная заливка и аппаратное зеркалирование (X/Y).
 * - Поддержка пакетного выполнения очередей команд (до 511 команд за один запуск).
 * - Прямой доступ ко всем 32 МБ оперативной памяти AZBK.
 * 
 * Регистры управления:
 * - 177270 (REG_BLT_CMD): Количество команд, ручной/авто режим, статус выполнения.
 * - 177272 (REG_BLT_PGN): Номер 4КБ страницы памяти, содержащей дескрипторы команд.
 * 
 * (c) 2026 - BK-Catalog Project
 */

(function (global) {
    'use strict';

    // Флаги регистра статуса блиттера 177270
    const AZ_BLT_RUNNING = 0o100000; // Бит 15 (RO): 1 = блиттер работает
    const AZ_BLT_MANUAL  = 0o040000; // Бит 14 (RW): 0 = автозапуск каждый кадр, 1 = ручной режим
    const AZ_BLT_RUNMAN  = 0o010000; // Бит 12 (WO): 1 = ручной запуск
    const AZ_BLT_READCMD = 0o001000; // Бит 9  (RO): 1 = чтение пачки команд

    // Константы формата дескриптора команд
    const AZ_BLT_CMDSIZE   = 8;      // 8 слов на одну команду
    const AZ_BLT_MAXCMDNUM = 511;    // Максимальное количество команд в очереди

    // Флаги команды (nCMD, 4-е слово дескриптора)
    const BLT_RDSRC      = (1 << 0); // Требуется чтение источника
    const BLT_RDDST      = (1 << 1); // Требуется чтение приемника
    const BLT_NOP        = (1 << 2); // NOP: пропуск команды
    const BLT_OPMASK     = (7 << 3); // Маска типа операции
    const BLT_OP_FILL    = (0 << 3); // Заполнение константой
    const BLT_OP_COPYS2D = (1 << 3); // Копирование SRC => DST
    const BLT_OP_OVLOVER = (2 << 3); // Наложение SRC поверх DST с прозрачностью SRC
    const BLT_OP_OVLUNDR = (3 << 3); // Наложение под DST с прозрачностью SRC и DST
    const BLT_OP_COPYD2S = (4 << 3); // Копирование DST => SRC (сохранение фона)
    const BLT_OP_CONTURF = (5 << 3); // Заполнение константой по контуру
    const BLT_SWAPB      = (1 << 6); // Перестановка байтов в слове
    const BLT_MIRRORH    = (1 << 9); // Зеркалирование по горизонтали
    const BLT_MIRRORV    = (1 << 10);// Зеркалирование по вертикали

    class AzbkBlitter {
        /**
         * @param {object} azbkController - Ссылка на родительский контроллер AZBK
         */
        constructor(azbkController) {
            this.azbk = azbkController;

            // Регистры блиттера
            this.regBltCmd = 0; // 177270 (REG_BLT_CMD)
            this.regBltPgn = 0; // 177272 (REG_BLT_PGN)

            // Состояние выполнения
            this.isRunning = false;
            this.isReadingCmds = false;

            // Внутренний буфер дескрипторов команд (до 511 * 8 слов)
            this.cmdBuffer = new Uint16Array(AZ_BLT_MAXCMDNUM * AZ_BLT_CMDSIZE);

            // Маска адресации 16M слов (32 МБ)
            this.MEM_WORD_MASK = (16 * 1024 * 1024) - 1;
        }

        /**
         * Сброс состояния блиттера
         */
        reset() {
            this.regBltCmd = 0;
            this.isRunning = false;
            this.isReadingCmds = false;
        }

        /**
         * Чтение регистра 177270 (REG_BLT_CMD)
         * @returns {number} 16-битное значение регистра статуса
         */
        readCmdRegister() {
            let val = this.regBltCmd & (0x1FF | AZ_BLT_MANUAL);
            if (this.isRunning) {
                val |= AZ_BLT_RUNNING;
            }
            if (this.isReadingCmds) {
                val |= AZ_BLT_READCMD;
            }
            return val & 0xFFFF;
        }

        /**
         * Запись регистра 177270 (REG_BLT_CMD)
         * @param {number} val - 16-битное записанное значение
         */
        writeCmdRegister(val) {
            const cmdCount = val & 0x1FF;
            const newval = val & (0x1FF | AZ_BLT_MANUAL);

            if (cmdCount === 0) {
                // Запись 0 = немедленный сброс блиттера
                this.reset();
                this.regBltCmd = newval;
            } else if (this.isRunning) {
                // Если уже работает — можно лишь обновить число команд
                this.regBltCmd = (this.regBltCmd & 0xFE00) | cmdCount;
            } else {
                // Ручной режим: запуск по биту 12 (AZ_BLT_RUNMAN)
                const isManual = !!((this.regBltCmd | val) & AZ_BLT_MANUAL);
                if (isManual && (val & AZ_BLT_RUNMAN)) {
                    const startAddrWords = (this.regBltPgn & 0o17777) * 2048;
                    this.doExec(cmdCount, startAddrWords);
                }
                this.regBltCmd = newval;
            }
        }

        /**
         * Чтение регистра 177272 (REG_BLT_PGN)
         * @returns {number}
         */
        readPgnRegister() {
            return this.regBltPgn & 0o17777;
        }

        /**
         * Запись регистра 177272 (REG_BLT_PGN)
         * @param {number} val
         */
        writePgnRegister(val) {
            this.regBltPgn = val & 0o17777;
        }

        /**
         * Автоматический вызов блиттера в конце кадра (VSYNC)
         * Вызывается видеосистемой каждый кадр
         */
        onFrameVsync() {
            const isManual = !!(this.regBltCmd & AZ_BLT_MANUAL);
            const cmdCount = this.regBltCmd & 0x1FF;

            // Если не ручной режим и есть активные команды — выполняем
            if (!isManual && cmdCount > 0 && !this.isRunning) {
                const startAddrWords = (this.regBltPgn & 0o17777) * 2048;
                this.doExec(cmdCount, startAddrWords);
            }
        }

        /**
         * Запуск исполнения пакета команд блиттера
         * @param {number} cmdCount - Количество команд в пакете (1..511)
         * @param {number} startAddrWords - Адрес массива дескрипторов в памяти AZBK (в словах)
         */
        doExec(cmdCount, startAddrWords) {
            const ram = this.azbk.ram;
            if (!ram) return;

            const count = Math.min(cmdCount & 0x1FF, AZ_BLT_MAXCMDNUM);
            if (count === 0) return;

            this.isReadingCmds = true;
            this.isRunning = true;

            // Копируем дескрипторы команд во внутренний буфер
            const wordsToRead = count * AZ_BLT_CMDSIZE;
            const ramMask = this.MEM_WORD_MASK;
            let srcAddr = startAddrWords & ramMask;

            for (let i = 0; i < wordsToRead; i++) {
                this.cmdBuffer[i] = ram[srcAddr];
                srcAddr = (srcAddr + 1) & ramMask;
            }

            this.isReadingCmds = false;

            // Выполняем каждую команду очереди
            const u8Ram = new Uint8Array(ram.buffer);
            const u8Mask = (ram.length * 2) - 1;

            for (let c = 0; c < count; c++) {
                this._executeCommand(c * AZ_BLT_CMDSIZE, ram, u8Ram, ramMask, u8Mask);
            }

            this.isRunning = false;
        }

        /**
         * Выполнение одного дескриптора команды из внутреннего буфера
         * @private
         */
        _executeCommand(offset, ram, u8Ram, ramMask, u8Mask) {
            const buf = this.cmdBuffer;

            // 1. Декодирование параметров команды (8 слов дескриптора)
            // Слово 0: [23..16] старшие байты адресов SRC и DST
            const w0 = buf[offset];
            // Слово 1: [15..0] младшая часть SRC
            const w1 = buf[offset + 1];
            // Слово 2: [15..0] младшая часть DST
            const w2 = buf[offset + 2];
            // Слово 3: Команда nCMD
            const nCMD = buf[offset + 3];
            // Слово 4: wWidth (мл. байт) и Height (ст. байт)
            const w4 = buf[offset + 4];
            // Слово 5: Pitch (мл. байт)
            const w5 = buf[offset + 5];
            // Слово 6: DstYAdd
            const w6 = buf[offset + 6];
            // Слово 7: SRCconst (мл. байт) и DSTconst (ст. байт)
            const w7 = buf[offset + 7];

            // Пропуск команды NOP
            if (nCMD & BLT_NOP) {
                return;
            }

            // 24-битные адреса в словах
            let nSRC = (w1 | ((w0 & 0xFF00) << 8)) & ramMask;
            let nDST = (w2 | ((w0 & 0x00FF) << 16)) & ramMask;
            const nDstYAdd = (w6 << 8) & ramMask;
            nDST = (nDST + nDstYAdd) & ramMask;

            const nWWidth = (w4 & 0xFF) + 1;        // Длина строки в словах
            let nHeight = (w4 >> 8) & 0xFF;         // Число строк
            const nPitch = (w5 & 0xFF) - 1;         // Инкремент DST после строки
            const nSRCconst = w7 & 0xFF;            // Константа SRC / заливка
            const nDSTconst = (w7 >> 8) & 0xFF;     // Константа прозрачности DST

            const needReadSrc = !!(nCMD & BLT_RDSRC);
            const needReadDst = !!(nCMD & BLT_RDDST);
            const swapBytes   = !!(nCMD & BLT_SWAPB);

            // Настройка шагов при зеркалировании
            let nHorStep = 1;
            let nVertStep = nPitch;
            const mirrorBits = (nCMD & (BLT_MIRRORH | BLT_MIRRORV)) >> 9;
            switch (mirrorBits) {
                case 0: // Без зеркалирования
                    nHorStep = 1;
                    nVertStep = nPitch;
                    break;
                case 1: // Зеркалирование по горизонтали
                    nHorStep = -1;
                    nVertStep = nPitch + 2;
                    break;
                case 2: // Зеркалирование по вертикали
                    nHorStep = 1;
                    nVertStep = -(nPitch + 2);
                    break;
                case 3: // Зеркалирование по обеим осям
                    nHorStep = -1;
                    nVertStep = -nPitch;
                    break;
            }

            const op = nCMD & BLT_OPMASK;
            const fillWord = nSRCconst | (nSRCconst << 8);

            // 2. Построчное выполнение операции
            let curDstWord = nDST;
            let curSrcWord = nSRC;

            while (nHeight > 0) {
                let wordsLeft = nWWidth;

                while (wordsLeft > 0) {
                    let s = 0;
                    let d = 0;

                    switch (op) {
                        case BLT_OP_FILL: // 0: Заполнение прямоугольника константой
                            ram[curDstWord] = fillWord;
                            break;

                        case BLT_OP_COPYS2D: // 1: Копирование SRC => DST
                            if (needReadSrc) {
                                s = ram[curSrcWord];
                            }
                            if (swapBytes) {
                                s = ((s << 8) | (s >> 8)) & 0xFFFF;
                            }
                            ram[curDstWord] = s;
                            curSrcWord = (curSrcWord + 1) & ramMask;
                            break;

                        case BLT_OP_OVLOVER: { // 2: Наложение SRC поверх DST с прозрачностью SRC
                            if (needReadSrc) {
                                s = ram[curSrcWord];
                            }
                            if (swapBytes) {
                                s = ((s << 8) | (s >> 8)) & 0xFFFF;
                            }
                            // Побайтовая проверка на прозрачность
                            const dstByteOffset = (curDstWord << 1) & u8Mask;
                            const b0 = s & 0xFF;
                            const b1 = (s >> 8) & 0xFF;

                            if (b0 !== nSRCconst) {
                                u8Ram[dstByteOffset] = b0;
                            }
                            if (b1 !== nSRCconst) {
                                u8Ram[(dstByteOffset + 1) & u8Mask] = b1;
                            }

                            curSrcWord = (curSrcWord + 1) & ramMask;
                            break;
                        }

                        case BLT_OP_OVLUNDR: { // 3: Наложение под DST (SRC != прозрачный и DST == прозрачный)
                            if (needReadSrc) {
                                s = ram[curSrcWord];
                            }
                            if (needReadDst) {
                                d = ram[curDstWord];
                            }
                            if (swapBytes) {
                                s = ((s << 8) | (s >> 8)) & 0xFFFF;
                                d = ((d << 8) | (d >> 8)) & 0xFFFF;
                            }
                            const dstByteOffset = (curDstWord << 1) & u8Mask;
                            const s0 = s & 0xFF;
                            const s1 = (s >> 8) & 0xFF;
                            const d0 = d & 0xFF;
                            const d1 = (d >> 8) & 0xFF;

                            if (s0 !== nSRCconst && d0 === nDSTconst) {
                                u8Ram[dstByteOffset] = s0;
                            }
                            if (s1 !== nSRCconst && d1 === nDSTconst) {
                                u8Ram[(dstByteOffset + 1) & u8Mask] = s1;
                            }

                            curSrcWord = (curSrcWord + 1) & ramMask;
                            break;
                        }

                        case BLT_OP_COPYD2S: // 4: Копирование DST => SRC (сохранение фона)
                            if (needReadDst) {
                                d = ram[curDstWord];
                            }
                            if (swapBytes) {
                                d = ((d << 8) | (d >> 8)) & 0xFFFF;
                            }
                            ram[curSrcWord] = d;
                            curSrcWord = (curSrcWord + 1) & ramMask;
                            break;

                        case BLT_OP_CONTURF: { // 5: Заполнение контура константой
                            if (needReadSrc) {
                                s = ram[curSrcWord];
                            }
                            if (swapBytes) {
                                s = ((s << 8) | (s >> 8)) & 0xFFFF;
                            }
                            const dstByteOffset = (curDstWord << 1) & u8Mask;
                            const b0 = s & 0xFF;
                            const b1 = (s >> 8) & 0xFF;

                            if (b0 !== nDSTconst) {
                                u8Ram[dstByteOffset] = nSRCconst;
                            }
                            if (b1 !== nDSTconst) {
                                u8Ram[(dstByteOffset + 1) & u8Mask] = nSRCconst;
                            }

                            curSrcWord = (curSrcWord + 1) & ramMask;
                            break;
                        }
                    }

                    curDstWord = (curDstWord + nHorStep) & ramMask;
                    wordsLeft--;
                }

                // Переход к следующей строке с учетом шага nVertStep
                curDstWord = (curDstWord + nVertStep) & ramMask;
                nHeight--;
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AzbkBlitter;
    }
    if (typeof global !== 'undefined') {
        global.AzbkBlitter = AzbkBlitter;
    }
    if (typeof window !== 'undefined') {
        window.AzbkBlitter = AzbkBlitter;
    }

})(typeof window !== 'undefined' ? window : global);
