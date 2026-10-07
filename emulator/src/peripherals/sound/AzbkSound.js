/**
 * AzbkSound.js - Звуковая подсистема расширения AZBK (MAXIOL AZ)
 * 
 * Реализует:
 * 1. 16-битный стерео Covox ЦАП (регистры 177200..177212):
 *    - 177200: левый канал 16-бит
 *    - 177202: правый канал 16-бит
 *    - 177204: моно 16-бит (одновременная запись в левый и правый канал)
 *    - 177206: 8-битный стерео/моно регистр
 *    - 177212: регистр управления (CSR) с масками перехвата legacy 177714 / 177716
 * 2. DMA Звук (регистры 177160..177170):
 *    - 177160: CSR управления (старт, one-shot/цикл, остановка, частота, формат)
 *    - 177162: начальный номер страницы 4 КБ в памяти AZBK (0..8191)
 *    - 177164: старшая часть длины трека (8 бит)
 *    - 177166: младшая часть длины трека (16 бит)
 *    - 177170: номер текущей страницы воспроизведения
 *    - Аппаратный декодер IMA ADPCM (моно и стерео)
 *    - Режим PCM 16-бит моно
 * 
 * (c) 2026 - BK-Catalog Project
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AzbkSound = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    // =========================================================================
    // Таблицы декодера IMA ADPCM (стандартный алгоритм IMA/DVI)
    // =========================================================================

    const IMA_INDEX_TABLE = new Int32Array([
        -1, -1, -1, -1, 2, 4, 6, 8
    ]);

    const IMA_STEP_TABLE = new Int32Array([
        7,     8,     9,    10,    11,    12,    13,    14,
        16,    17,    19,    21,    23,    25,    28,    31,
        34,    37,    41,    45,    50,    55,    60,    66,
        73,    80,    88,    97,   107,   118,   130,   143,
        157,   173,   190,   209,   230,   253,   279,   307,
        337,   371,   408,   449,   494,   544,   598,   658,
        724,   796,   876,   963,  1060,  1166,  1282,  1411,
        1552,  1707,  1878,  2066,  2272,  2499,  2749,  3024,
        3327,  3660,  4026,  4428,  4871,  5358,  5894,  6484,
        7132,  7845,  8630,  9493, 10442, 11487, 12635, 13899,
        15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
        32767
    ]);

    class AzbkSound {
        /**
         * @param {object} azbkController - Родительский контроллер AZBK
         */
        constructor(azbkController) {
            this.azbk = azbkController;

            // Константы регистров Covox
            this.REG_CVX_L16 = 0o177200;
            this.REG_CVX_R16 = 0o177202;
            this.REG_CVX_M16 = 0o177204;
            this.REG_CVX_LR8 = 0o177206;
            this.REG_CVX_CSR = 0o177212;

            // Флаги регистра управления Covox (177212)
            this.AZ_CVX_LEGACY_STEREO = (1 << 0); // 0=моно, 1=стерео
            this.AZ_CVX_LEGACY_ENABLE = (1 << 1); // 1=разрешен перехват 177714, 0=выключен
            this.AZ_CVX_LEGACY_SPEAKER = (1 << 2);// 1=разрешен перехват 177716, 0=выключен
            this.AZ_CVX_PSGTYPE        = (1 << 3);// 0=YM2149, 1=AY-3-8910

            // Константы регистров DMA
            this.REG_DMA_CSR    = 0o177160;
            this.REG_DMA_MEM    = 0o177162;
            this.REG_DMA_LEN_HI = 0o177164;
            this.REG_DMA_LEN_LO = 0o177166;
            this.REG_DMA_PGNUM  = 0o177170;

            // Флаги регистра управления DMA (177160)
            this.AZ_DMA_START     = (1 << 0); // 1 = старт
            this.AZ_DMA_ONESHOOT  = (1 << 1); // 1 = однократный запуск, 0 = циклический
            this.AZ_DMA_IMMSTOP   = (1 << 2); // 1 = принудительная остановка
            this.AZ_DMA_ENDONE    = (1 << 3); // 1 = однократный запуск завершился
            this.AZ_DMA_IMASTREAM = (1 << 4); // 1 = потоковое воспроизведение без сброса состояния

            // Состояние Covox (16-битные значения 0..65535, середина 32768)
            this.cvxLeft = 32768;
            this.cvxRight = 32768;
            this.cvxMono = 32768;
            this.cvxCsr = 0; // По умолчанию legacy перехват выключен

            // Фильтры подавления постоянной составляющей (DC-blocker) для Covox
            this.azDcInL = 0;
            this.azDcOutL = 0;
            this.azDcInR = 0;
            this.azDcOutR = 0;

            // Состояние DMA Sound
            this.dmaCsr = 0;
            this.dmaStartPage = 0;
            this.dmaFileSize = 0;       // Размер в словах (24 бита)
            this.dmaCurrentPage = 0;
            this.dmaRunning = false;

            // Внутренние указатели DMA
            this.dmaSndBytePtr = 0;     // Счётчик прочитанных байт
            this.dmaDataBytePtr = 0;    // Смещение внутри текущей 4КБ страницы (0..4095)

            // Учёт тактов и времени для независимого тайминга DMA
            this.dmaLastCycle = null;
            this.dmaFractionalCycles = 0;
            this.dmaSamplesConsumedSinceSync = 0;
            this.dmaLastTime = 0;

            // Состояние декодера IMA ADPCM
            this.imaState = [
                { current: 0, stepindex: 0 }, // Левый канал
                { current: 0, stepindex: 0 }  // Правый канал
            ];

            // Буфер готовых сэмплов DMA
            this.dmaSampleQueue = [];
            this.MAX_QUEUE_SIZE = 4096;

            // Частоты дискретизации DMA
            this.SAMPLE_RATES = [44100, 22050, 11025, 5512, 48000, 32000, 16000, 8000];

            this.reset();
        }

        /**
         * Полный сброс звуковой подсистемы
         */
        reset() {
            this.cvxLeft = 32768;
            this.cvxRight = 32768;
            this.cvxMono = 32768;
            this.cvxCsr = 0; // По умолчанию legacy перехват отключен

            this.azDcInL = 0;
            this.azDcOutL = 0;
            this.azDcInR = 0;
            this.azDcOutR = 0;

            this.dmaCsr = 0;
            this.dmaStartPage = 0;
            this.dmaFileSize = 0;
            this.dmaCurrentPage = 0;
            this.dmaRunning = false;
            this.dmaSndBytePtr = 0;
            this.dmaDataBytePtr = 0;

            this.dmaLastCycle = null;
            this.dmaFractionalCycles = 0;
            this.dmaSamplesConsumedSinceSync = 0;
            this.dmaLastTime = 0;
            this.dmaResamplePhase = 0;
            this.dmaLastSample = [0, 0];

            this.imaState[0].current = 0;
            this.imaState[0].stepindex = 0;
            this.imaState[1].current = 0;
            this.imaState[1].stepindex = 0;

            this.dmaSampleQueue.length = 0;
        }

        /**
         * Проверка, активен ли звук AZBK
         * @returns {boolean}
         */
        isActive() {
            return this.dmaRunning || Math.abs(this.azDcOutL) >= 0.01 || Math.abs(this.azDcOutR) >= 0.01;
        }

        // =====================================================================
        // Чтение и запись системных регистров AZBK Sound
        // =====================================================================

        /**
         * Проверка адреса регистра звука
         * @param {number} addr 
         * @returns {boolean}
         */
        isSoundRegister(addr) {
            const a = addr & 0xFFFE;
            return (a >= 0o177160 && a <= 0o177170) || (a >= 0o177200 && a <= 0o177212);
        }

        /**
         * Чтение регистра звука
         * @param {number} addr 
         * @param {object} result - { value: number }
         * @returns {boolean}
         */
        readRegister(addr, result) {
            const a = addr & 0xFFFE;

            // Перед чтением состояния DMA продвигаем воспроизведение по тактам CPU
            if (this.dmaRunning && (a === this.REG_DMA_CSR || a === this.REG_DMA_PGNUM)) {
                this._advanceDma();
            }

            switch (a) {
                // DMA Sound регистры
                case this.REG_DMA_CSR:
                    result.value = this.dmaCsr;
                    return true;
                case this.REG_DMA_MEM:
                    result.value = this.dmaStartPage;
                    return true;
                case this.REG_DMA_LEN_HI:
                    result.value = (this.dmaFileSize >>> 16) & 0xFF;
                    return true;
                case this.REG_DMA_LEN_LO:
                    result.value = this.dmaFileSize & 0xFFFF;
                    return true;
                case this.REG_DMA_PGNUM:
                    result.value = this.dmaCurrentPage;
                    return true;

                // Covox регистры
                case this.REG_CVX_L16:
                    result.value = this.cvxLeft;
                    return true;
                case this.REG_CVX_R16:
                    result.value = this.cvxRight;
                    return true;
                case this.REG_CVX_M16:
                    result.value = this.cvxMono;
                    return true;
                case this.REG_CVX_LR8:
                    result.value = ((this.cvxLeft >>> 8) & 0xFF) | (this.cvxRight & 0xFF00);
                    return true;
                case this.REG_CVX_CSR:
                    result.value = this.cvxCsr;
                    return true;
            }

            return false;
        }

        /**
         * Запись регистра звука
         * @param {number} addr 
         * @param {number} val 
         * @returns {boolean}
         */
        writeRegister(addr, val) {
            const a = addr & 0xFFFE;
            const value = val & 0xFFFF;

            switch (a) {
                // DMA Sound регистры
                case this.REG_DMA_CSR:
                    this.dmaCsr = value;
                    this._updateDmaState();
                    return true;
                case this.REG_DMA_MEM:
                    this.dmaStartPage = value & 0o17777; // Страница 4КБ в ОЗУ (до 8191)
                    return true;
                case this.REG_DMA_LEN_HI:
                    this.dmaFileSize = (this.dmaFileSize & 0xFFFF) | ((value & 0xFF) << 16);
                    return true;
                case this.REG_DMA_LEN_LO:
                    this.dmaFileSize = (this.dmaFileSize & 0xFF0000) | value;
                    return true;
                case this.REG_DMA_PGNUM:
                    // Запись в PGNUM игнорируется
                    return true;

                // Covox регистры
                case this.REG_CVX_L16:
                    this.cvxLeft = value;
                    return true;
                case this.REG_CVX_R16:
                    this.cvxRight = value;
                    return true;
                case this.REG_CVX_M16:
                    this.cvxLeft = this.cvxRight = this.cvxMono = value;
                    return true;
                case this.REG_CVX_LR8:
                    // Младший байт -> левый канал, старший байт -> правый канал
                    this.cvxLeft = (value & 0xFF) << 7;
                    this.cvxRight = (value & 0xFF00) >> 1;
                    return true;
                case this.REG_CVX_CSR:
                    this.cvxCsr = value & 0x0F;
                    return true;
            }

            return false;
        }

        // =====================================================================
        // Обработка Legacy перехвата портов 177714 и 177716
        // =====================================================================

        /**
         * Перехват записи в 177714 (Legacy Covox)
         * @param {number} val 
         */
        legacyWrite714(val) {
            if ((this.cvxCsr & this.AZ_CVX_LEGACY_ENABLE) === 0) {
                return false; // Перехват выключен
            }

            if ((this.cvxCsr & this.AZ_CVX_LEGACY_STEREO) !== 0) {
                // Стерео перехват
                this.cvxLeft = (val & 0xFF) << 7;
                this.cvxRight = ((val >>> 8) & 0xFF) << 7;
            } else {
                // Моно перехват
                const v = (val & 0xFF) << 7;
                this.cvxLeft = this.cvxRight = this.cvxMono = v;
            }
            return true;
        }

        /**
         * Перехват записи в 177716 (Legacy Speaker)
         * @param {number} val 
         */
        legacyWrite716(val) {
            if ((this.cvxCsr & this.AZ_CVX_LEGACY_SPEAKER) === 0) {
                return false; // Перехват выключен
            }

            // 3-битный перехват динамика (биты 6..4)
            const spk3 = (val >>> 4) & 0x07;
            const spkVal = (spk3 * 9362) & 0xFFFF;
            this.cvxLeft = this.cvxRight = this.cvxMono = spkVal;
            return true;
        }

        // =====================================================================
        // Управление DMA Sound и декодирование
        // =====================================================================

        /**
         * Обновление состояния DMA воспроизведения
         */
        _updateDmaState() {
            if (this.dmaCsr & this.AZ_DMA_IMMSTOP) {
                this.dmaRunning = false;
                this._dmaDoneReading = false;
                this.dmaSampleQueue.length = 0;
                this.dmaLastCycle = null;
            } else if ((this.dmaCsr & (this.AZ_DMA_START | this.AZ_DMA_IMMSTOP | this.AZ_DMA_ENDONE)) === this.AZ_DMA_START) {
                this.dmaRunning = true;
                this._dmaDoneReading = false;
                this.dmaCurrentPage = this.dmaStartPage;
                this.dmaSndBytePtr = 0;
                this.dmaDataBytePtr = 0;

                this.dmaLastCycle = this._getCpuCycles();
                this.dmaFractionalCycles = 0;
                this.dmaSamplesConsumedSinceSync = 0;
                this.dmaLastTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

                if (!(this.dmaCsr & this.AZ_DMA_IMASTREAM)) {
                    this.imaState[0].current = 0;
                    this.imaState[0].stepindex = 0;
                    this.imaState[1].current = 0;
                    this.imaState[1].stepindex = 0;
                }
                this.dmaSampleQueue.length = 0;
                this._fillDmaBuffer();
            }
        }

        /**
         * Подкачка сэмплов из памяти AZBK в очередь
         */
        _fillDmaBuffer() {
            if (!this.dmaRunning || this._dmaDoneReading || !this.azbk || !this.azbk.ram) {
                return;
            }

            const ram = this.azbk.ram;
            const mode = (this.dmaCsr >>> 9) & 7; // 0 = PCM 16 mono, 4 = IMA mono, 5 = IMA stereo
            const totalBytes = this.dmaFileSize * 2;

            while (this.dmaSampleQueue.length < this.MAX_QUEUE_SIZE && this.dmaRunning && !this._dmaDoneReading) {
                // Проверка завершения трека
                if (this.dmaSndBytePtr >= totalBytes) {
                    if (this.dmaCsr & this.AZ_DMA_ONESHOOT) {
                        this._dmaDoneReading = true;
                        break;
                    } else {
                        // Зацикливание
                        this.dmaSndBytePtr = 0;
                        this.dmaDataBytePtr = 0;
                        this.dmaCurrentPage = this.dmaStartPage;
                        if (!(this.dmaCsr & this.AZ_DMA_IMASTREAM)) {
                            this.imaState[0].current = 0;
                            this.imaState[0].stepindex = 0;
                            this.imaState[1].current = 0;
                            this.imaState[1].stepindex = 0;
                        }
                    }
                }

                // Базовый адрес 4КБ страницы в ОЗУ (в 16-битных словах: 2048 слов на 4КБ)
                const pageBaseWords = (this.dmaCurrentPage & 0o17777) * 2048;

                if (mode === 0) {
                    // Режим 0: PCM 16-бит моно (2 байта = 1 сэмпл)
                    const wordIdx = (pageBaseWords + (this.dmaDataBytePtr >>> 1)) & 0x00FFFFFF;
                    let pcmWord = ram[wordIdx] || 0;
                    // Преобразование в знаковый 16-битный PCM (-32768..32767)
                    if (pcmWord >= 32768) pcmWord -= 65536;

                    this.dmaSampleQueue.push([pcmWord, pcmWord]);
                    this.dmaDataBytePtr += 2;
                    this.dmaSndBytePtr += 2;
                } else {
                    // Режимы ADPCM: читаем 1 байт из ОЗУ
                    const wordIdx = (pageBaseWords + (this.dmaDataBytePtr >>> 1)) & 0x00FFFFFF;
                    const word = ram[wordIdx] || 0;
                    const byteVal = (this.dmaDataBytePtr & 1) ? ((word >>> 8) & 0xFF) : (word & 0xFF);

                    this.dmaDataBytePtr++;
                    this.dmaSndBytePtr++;

                    if (mode === 4) {
                        // IMA ADPCM Mono: 1 байт = 2 моно-сэмпла
                        const smp1 = this._decodeImaSample(this.imaState[0], byteVal & 0x0F);
                        const smp2 = this._decodeImaSample(this.imaState[0], (byteVal >>> 4) & 0x0F);
                        this.dmaSampleQueue.push([smp1, smp1]);
                        this.dmaSampleQueue.push([smp2, smp2]);
                    } else if (mode === 5) {
                        // IMA ADPCM Stereo: 1 байт = 1 стерео-сэмпл (L: младший ниббл, R: старший ниббл)
                        const smpL = this._decodeImaSample(this.imaState[0], byteVal & 0x0F);
                        const smpR = this._decodeImaSample(this.imaState[1], (byteVal >>> 4) & 0x0F);
                        this.dmaSampleQueue.push([smpL, smpR]);
                    } else {
                        // Неизвестный режим: тишина
                        this.dmaSampleQueue.push([0, 0]);
                    }
                }

                // Переход на следующую страницу 4КБ (4096 байт)
                if (this.dmaDataBytePtr >= 4096) {
                    this.dmaDataBytePtr = 0;
                    this.dmaCurrentPage = (this.dmaCurrentPage + 1) & 0o17777;
                }
            }
        }

        /**
         * Декодирование одного 4-битного ниббла IMA ADPCM
         * @param {object} state - { current, stepindex }
         * @param {number} value - 4-битный ниббл (0..15)
         * @returns {number} 16-битный PCM сэмпл (-32768..32767)
         */
        _decodeImaSample(state, value) {
            let current = state.current;
            let stepindex = state.stepindex;
            let step = IMA_STEP_TABLE[stepindex];

            let diff = step >>> 3;
            if (value & 1) diff += (step >>> 2);
            if (value & 2) diff += (step >>> 1);
            if (value & 4) diff += step;

            if (value & 8) {
                current -= diff;
                if (current < -32768) current = -32768;
            } else {
                current += diff;
                if (current > 32767) current = 32767;
            }

            stepindex += IMA_INDEX_TABLE[value & 7];
            if (stepindex < 0) stepindex = 0;
            if (stepindex > 88) stepindex = 88;

            state.current = current;
            state.stepindex = stepindex;
            return current;
        }

        // =====================================================================
        // Выдача следующего аудио-сэмпла для SoundRenderer
        // =====================================================================

        /**
         * Возвращает следующий стерео-сэмпл [left, right] в шкале SoundRenderer
         * (нормализованный в диапазон ~[-32.0, +32.0])
         * @returns {Array<number>} [left, right]
         */
        nextSample() {
            // Базовый уровень Covox (0..65535, середина 32768 -> сдвиг в -32..+32)
            const rawL = (this.cvxLeft - 32768) / 1024.0;
            const rawR = (this.cvxRight - 32768) / 1024.0;

            // DC-blocking фильтр (High-Pass): устраняет постоянное смещение и утечку щелчков
            let covOutL = rawL - this.azDcInL + 0.995 * this.azDcOutL;
            this.azDcInL = rawL;
            if (Math.abs(covOutL) < 0.01) {
                covOutL = 0;
                this.azDcOutL = 0;
            } else {
                this.azDcOutL = covOutL;
            }

            let covOutR = rawR - this.azDcInR + 0.995 * this.azDcOutR;
            this.azDcInR = rawR;
            if (Math.abs(covOutR) < 0.01) {
                covOutR = 0;
                this.azDcOutR = 0;
            } else {
                this.azDcOutR = covOutR;
            }

            let outL = covOutL;
            let outR = covOutR;

            // Если работает DMA, подмешиваем сэмпл из очереди
            if (this.dmaRunning) {
                if (!this._dmaDoneReading && this.dmaSampleQueue.length < 512) {
                    this._fillDmaBuffer();
                }

                const rateIdx = (this.dmaCsr >> 6) & 7;
                const dmaRate = this.SAMPLE_RATES[rateIdx] || 44100;
                let outputRate = dmaRate;
                if (this.azbk && this.azbk.bkSystem && this.azbk.bkSystem.srend && typeof this.azbk.bkSystem.srend.getSampleRate === 'function') {
                    outputRate = this.azbk.bkSystem.srend.getSampleRate();
                }

                const step = dmaRate / outputRate;
                this.dmaResamplePhase = (this.dmaResamplePhase || 0) + step;

                while (this.dmaResamplePhase >= 1.0) {
                    this.dmaResamplePhase -= 1.0;
                    if (this.dmaSampleQueue.length > 0) {
                        this.dmaLastSample = this.dmaSampleQueue.shift();
                        this.dmaSamplesConsumedSinceSync++;
                    } else {
                        break;
                    }
                }

                if (this.dmaLastSample) {
                    // Знаковый 16-битный PCM (-32768..32767) масштабируем в -32..+32
                    outL += (this.dmaLastSample[0] / 1024.0);
                    outR += (this.dmaLastSample[1] / 1024.0);
                }

                if (this._dmaDoneReading && this.dmaSampleQueue.length === 0) {
                    this.dmaRunning = false;
                    this.dmaCsr |= this.AZ_DMA_ENDONE;
                    this.dmaCsr &= ~this.AZ_DMA_START;
                }
            }

            // Ограничение переполнения (clamping)
            if (outL > 48.0) outL = 48.0; else if (outL < -48.0) outL = -48.0;
            if (outR > 48.0) outR = 48.0; else if (outR < -48.0) outR = -48.0;

            return [outL, outR];
        }

        // =====================================================================
        // Независимое продвижение DMA Sound по времени и тактам
        // =====================================================================

        /**
         * Получение текущего счетчика тактов процессора
         * @returns {number|null}
         */
        _getCpuCycles() {
            if (this.azbk && this.azbk.bkSystem && this.azbk.bkSystem.cpu && typeof this.azbk.bkSystem.cpu.Cycles === 'number') {
                return this.azbk.bkSystem.cpu.Cycles;
            }
            if (typeof cpu !== 'undefined' && cpu && typeof cpu.Cycles === 'number') {
                return cpu.Cycles;
            }
            if (typeof self !== 'undefined' && self.cpu && typeof self.cpu.Cycles === 'number') {
                return self.cpu.Cycles;
            }
            return null;
        }

        /**
         * Продвижение воспроизведения DMA звука по тактам процессора или времени
         */
        _advanceDma(isFrameSync = false) {
            if (!this.dmaRunning) {
                return;
            }

            const isSoundActive = !!(this.azbk && this.azbk.bkSystem && this.azbk.bkSystem.srend && this.azbk.bkSystem.srend.On);

            if (isSoundActive) {
                // Если WebAudio активно, продвигаем SoundRenderer до текущего такта CPU
                if (this.azbk.bkSystem.srend.updateTimer) {
                    this.azbk.bkSystem.srend.updateTimer();
                }
                // Защита очереди от избыточного накопления при турбо-скорости CPU
                if (this.dmaSampleQueue.length > this.MAX_QUEUE_SIZE * 2) {
                    this.dmaSampleQueue.splice(0, this.dmaSampleQueue.length - this.MAX_QUEUE_SIZE);
                }
                return;
            }

            // Headless или звук выключен: автономное продвижение DMA по тактам процессора или времени кадра
            const curCycle = this._getCpuCycles();
            const rateIdx = (this.dmaCsr >> 6) & 7;
            const sampleRate = this.SAMPLE_RATES[rateIdx] || 44100;

            let expectedSamples = 0;
            if (curCycle !== null) {
                if (this.dmaLastCycle === null || curCycle < this.dmaLastCycle) {
                    this.dmaLastCycle = curCycle;
                    this.dmaFractionalCycles = 0;
                } else {
                    const deltaCycles = curCycle - this.dmaLastCycle;
                    this.dmaLastCycle = curCycle;
                    const cpuHz = (this.azbk && this.azbk.bkSystem && this.azbk.bkSystem.getVsyncPeriod)
                        ? (this.azbk.bkSystem.getVsyncPeriod() * 50)
                        : 4000000;
                    const cyclesPerSample = cpuHz / sampleRate;
                    const total = deltaCycles + this.dmaFractionalCycles;
                    expectedSamples = Math.floor(total / cyclesPerSample);
                    this.dmaFractionalCycles = total - (expectedSamples * cyclesPerSample);
                }
            } else if (isFrameSync) {
                // Если CPU недоступен, но произошел VSYNC кадра (50 Гц)
                expectedSamples = Math.round(sampleRate / 50);
            }

            let needed = expectedSamples - this.dmaSamplesConsumedSinceSync;
            if (needed <= 0) {
                this.dmaSamplesConsumedSinceSync = -needed;
                return;
            }
            this.dmaSamplesConsumedSinceSync = 0;

            while (needed > 0 && this.dmaRunning) {
                if (this.dmaSampleQueue.length === 0) {
                    this._fillDmaBuffer();
                    if (this.dmaSampleQueue.length === 0) break;
                }
                const drop = Math.min(needed, this.dmaSampleQueue.length);
                this.dmaSampleQueue.splice(0, drop);
                needed -= drop;
            }

            if (this._dmaDoneReading && this.dmaSampleQueue.length === 0) {
                this.dmaRunning = false;
                this.dmaCsr |= this.AZ_DMA_ENDONE;
                this.dmaCsr &= ~this.AZ_DMA_START;
            }
        }

        /**
         * Вызывается в конце каждого видеокадра 50 Гц (VSYNC)
         */
        onFrame() {
            if (this.dmaRunning) {
                this._advanceDma(true);
            }
        }

        /**
         * Корректировка счетчика тактов при сбросе/уменьшении счетчиков процессора
         * @param {number} reduction 
         */
        minimizeCycles(reduction) {
            if (this.dmaLastCycle !== null) {
                this.dmaLastCycle -= reduction;
            }
        }
    }

    return AzbkSound;
}));
