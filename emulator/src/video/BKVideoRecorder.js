/**
 * BKVideoRecorder.js — Встроенная запись видео экрана эмулятора БК
 *
 * Архитектура:
 * Native emulator framebuffer (512×256 или AZBK)
 *              ↓
 * Pixel-Perfect целочисленное масштабирование (2× по горизонтали, 3× по вертикали)
 *              ↓
 * Recording Canvas 1024×768 (imageSmoothingEnabled = false)
 *              ↓
 * canvas.captureStream(50) [+ опциональный Web Audio трек]
 *              ↓
 * MediaRecorder (VP9 -> VP8 -> WebM)
 *              ↓
 * Blob -> URL.createObjectURL -> Предпросмотр / Скачивание
 *
 * Состояния: IDLE | RECORDING | STOPPING | READY | ERROR
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

(function (global) {
    'use strict';

    /**
     * Конфигурация записи видео для ретро-компьютера БК
     */
    const RECORDING_CONFIG = {
        width: 1024,
        height: 768,
        fps: 50,
        videoBitsPerSecond: 4000000, // 4 Мбит/с — оптимально для 1024×768 50 FPS ретро-графики
        preferredMimeTypes: [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm'
        ]
    };

    /**
     * Состояния автомата записи
     */
    const RECORDER_STATES = {
        IDLE: 'IDLE',
        RECORDING: 'RECORDING',
        STOPPING: 'STOPPING',
        READY: 'READY',
        ERROR: 'ERROR'
    };

    /**
     * Вспомогательная функция дополнения числа нулем
     * @param {number} n
     * @returns {string}
     */
    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /**
     * Форматирование времени в MM:SS
     * @param {number} totalSeconds
     * @returns {string}
     */
    function formatDuration(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return pad2(mins) + ':' + pad2(secs);
    }

    /**
     * Форматирование размера файла (байты -> КБ/МБ)
     * @param {number} bytes
     * @returns {string}
     */
    function formatFileSize(bytes) {
        if (!bytes || bytes <= 0) return '0 КБ';
        if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + ' КБ';
        }
        return (bytes / (1024 * 1024)).toFixed(2) + ' МБ';
    }

    /**
     * Основной класс захвата и записи видео экрана БК
     */
    class BKVideoRecorder {
        /**
         * @param {object} [emulator] - Ссылка на объект Emulator/BaseBK001x
         * @param {object} [options] - Пользовательские настройки
         */
        constructor(emulator, options) {
            this.emulator = emulator || (typeof Emulator !== 'undefined' ? Emulator : null);
            this.options = Object.assign({}, options);
            this.config = Object.assign({}, RECORDING_CONFIG, this.options);

            // Текущее состояние
            this.state = RECORDER_STATES.IDLE;
            this.lastError = null;

            // Холст записи (строго 1024×768)
            this.recordingCanvas = null;
            this.recordingCtx = null;

            // Вспомогательный offscreen холст для промежуточной отрисовки нестандартных кадров
            this._tempCanvas = null;
            this._tempCtx = null;

            // MediaStream и MediaRecorder
            this.mediaStream = null;
            this.mediaRecorder = null;
            this.selectedMimeType = '';
            this.chunks = [];

            // Web Audio интеграция
            this.audioDestination = null;
            this.audioGainNode = null;

            // Результаты записи
            this.blob = null;
            this.objectURL = null;
            this.currentFilename = '';
            this.startTime = 0;
            this.endTime = 0;
            this.durationSeconds = 0;
            this.timerInterval = null;

            // Слушатели событий
            this.stateListeners = [];
            this.errorListeners = [];

            // Инициализация холста записи
            this._initRecordingCanvas();
        }

        /**
         * Проверка поддержки записи браузером
         * @returns {boolean}
         */
        isSupported() {
            if (typeof window === 'undefined') return false;
            const hasMediaRecorder = typeof window.MediaRecorder === 'function';
            const hasCaptureStream = typeof HTMLCanvasElement !== 'undefined' &&
                (typeof HTMLCanvasElement.prototype.captureStream === 'function' ||
                 typeof HTMLCanvasElement.prototype.mozCaptureStream === 'function');

            if (!hasMediaRecorder || !hasCaptureStream) {
                return false;
            }

            // Проверяем хотя бы один поддерживаемый WebM MIME type
            return !!this.getSupportedMimeType(false);
        }

        /**
         * Определение поддерживаемого MIME типа с приоритетом VP9 -> VP8 -> WebM
         * @param {boolean} [withAudio=false]
         * @returns {string}
         */
        getSupportedMimeType(withAudio) {
            if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
                return '';
            }

            const candidates = withAudio ? [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8,opus',
                'video/webm;codecs=vp8',
                'video/webm'
            ] : [
                'video/webm;codecs=vp9',
                'video/webm;codecs=vp8',
                'video/webm'
            ];

            for (let i = 0; i < candidates.length; i++) {
                if (MediaRecorder.isTypeSupported(candidates[i])) {
                    return candidates[i];
                }
            }

            return MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
        }

        /**
         * Инициализация целевого холста 1024×768 с отключенным сглаживанием
         * @private
         */
        _initRecordingCanvas() {
            if (typeof document === 'undefined') return;

            this.recordingCanvas = document.createElement('canvas');
            this.recordingCanvas.width = this.config.width;
            this.recordingCanvas.height = this.config.height;

            const ctx = this.recordingCanvas.getContext('2d', {
                alpha: false,
                desynchronized: true
            });

            if (ctx) {
                ctx.imageSmoothingEnabled = false;
                ctx.mozImageSmoothingEnabled = false;
                ctx.webkitImageSmoothingEnabled = false;
                ctx.msImageSmoothingEnabled = false;

                // Заполняем начальным черным цветом
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, this.config.width, this.config.height);
                this.recordingCtx = ctx;
            }
        }

        /**
         * Начать запись экрана БК
         * @returns {boolean} Успешность запуска
         */
        start() {
            if (!this.isSupported()) {
                const err = 'Браузер не поддерживает MediaRecorder или canvas.captureStream';
                console.error('[BKVideoRecorder]', err);
                this._setError(err);
                return false;
            }

            if (this.state === RECORDER_STATES.RECORDING || this.state === RECORDER_STATES.STOPPING) {
                console.warn('[BKVideoRecorder] Запись уже выполняется или останавливается');
                return false;
            }

            // Освобождаем ресурсы предыдущей записи
            this._cleanupPreviousRecording();

            try {
                // 1. Отрисовываем текущий кадр в recording canvas, чтобы поток сразу получил данные
                this._captureCurrentFrame();

                // 2. Создаем MediaStream с целевой частотой кадров (50 FPS)
                const streamFn = this.recordingCanvas.captureStream || this.recordingCanvas.mozCaptureStream;
                this.mediaStream = streamFn.call(this.recordingCanvas, this.config.fps);

                // 3. Подключаем аудио (Web Audio API), если оно доступно и включено
                let hasAudioTrack = false;
                try {
                    hasAudioTrack = this._attachAudioTrack(this.mediaStream);
                } catch (audioErr) {
                    console.warn('[BKVideoRecorder] Не удалось подключить аудио, запись продолжается без звука:', audioErr);
                }

                // 4. Подбираем оптимальный MIME тип (VP9 -> VP8 -> WebM)
                this.selectedMimeType = this.getSupportedMimeType(hasAudioTrack);
                if (!this.selectedMimeType) {
                    this.selectedMimeType = this.getSupportedMimeType(false);
                }

                if (!this.selectedMimeType) {
                    throw new Error('Не найден поддерживаемый WebM кодек (VP9/VP8)');
                }

                // 5. Конфигурация MediaRecorder
                const recorderOptions = {
                    mimeType: this.selectedMimeType,
                    videoBitsPerSecond: this.config.videoBitsPerSecond
                };

                this.mediaRecorder = new MediaRecorder(this.mediaStream, recorderOptions);
                this.chunks = [];

                this.mediaRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        this.chunks.push(event.data);
                    }
                };

                this.mediaRecorder.onerror = (event) => {
                    console.error('[BKVideoRecorder] Ошибка MediaRecorder:', event.error || event);
                    this._setError(event.error ? event.error.message : 'Ошибка MediaRecorder');
                };

                this.mediaRecorder.onstop = () => {
                    this._handleRecorderStop();
                };

                // Запуск с чанками по 1 секунде для стабильного выделения памяти
                this.mediaRecorder.start(1000);

                // 6. Подключаем хук захвата кадров к DisplayRenderer
                if (global.displayRenderer && typeof global.displayRenderer.setOnFrame === 'function') {
                    global.displayRenderer.setOnFrame((sourceFrame) => {
                        this.recordFrame(sourceFrame);
                    });
                }

                // 7. Запускаем таймер продолжительности
                this.startTime = performance.now();
                this.endTime = 0;
                this.durationSeconds = 0;
                this._startTimer();

                this._setState(RECORDER_STATES.RECORDING);
                console.log('[BKVideoRecorder] Запись начата: 1024×768 @ ' + this.config.fps + ' FPS, кодек: ' + this.selectedMimeType + (hasAudioTrack ? ' (+Audio)' : ''));
                return true;

            } catch (err) {
                console.error('[BKVideoRecorder] Ошибка при старте записи:', err);
                this._cleanupStreams();
                this._setError(err && err.message ? err.message : String(err));
                return false;
            }
        }

        /**
         * Остановить запись и сформировать готовый WebM Blob
         * @returns {Promise<Blob>|null}
         */
        stop() {
            if (this.state !== RECORDER_STATES.RECORDING) {
                console.warn('[BKVideoRecorder] Запись не активна, остановка не требуется');
                return null;
            }

            this._setState(RECORDER_STATES.STOPPING);
            this._stopTimer();
            this.endTime = performance.now();
            this.durationSeconds = Math.max(0, (this.endTime - this.startTime) / 1000);

            // Отключаем хук кадра от DisplayRenderer
            if (global.displayRenderer && typeof global.displayRenderer.setOnFrame === 'function') {
                global.displayRenderer.setOnFrame(null);
            }

            return new Promise((resolve, reject) => {
                this._stopResolve = resolve;
                this._stopReject = reject;

                try {
                    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                        this.mediaRecorder.stop();
                    } else {
                        this._handleRecorderStop();
                    }
                } catch (err) {
                    console.error('[BKVideoRecorder] Ошибка при вызове MediaRecorder.stop:', err);
                    this._setError(err && err.message ? err.message : String(err));
                    reject(err);
                }
            });
        }

        /**
         * Отменить текущую запись без сохранения
         */
        cancel() {
            this._stopTimer();

            // Отключаем хук кадра
            if (global.displayRenderer && typeof global.displayRenderer.setOnFrame === 'function') {
                global.displayRenderer.setOnFrame(null);
            }

            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                try {
                    this.mediaRecorder.onstop = null;
                    this.mediaRecorder.stop();
                } catch (e) {}
            }

            this._cleanupStreams();
            this.chunks = [];
            this._setState(RECORDER_STATES.IDLE);
            console.log('[BKVideoRecorder] Запись отменена');
        }

        /**
         * Сбросить результат и вернуться в состояние IDLE
         */
        reset() {
            this.cancel();
            this._cleanupPreviousRecording();
            this._setState(RECORDER_STATES.IDLE);
        }

        /**
         * Получить текущее состояние автомата
         * @returns {string} IDLE | RECORDING | STOPPING | READY | ERROR
         */
        getState() {
            return this.state;
        }

        /**
         * Получить готовый Blob видеофайла
         * @returns {Blob|null}
         */
        getBlob() {
            return this.blob;
        }

        /**
         * Получить URL для воспроизведения в браузере
         * @returns {string|null}
         */
        getObjectURL() {
            return this.objectURL;
        }

        /**
         * Получить длительность текущей/последней записи в секундах
         * @returns {number}
         */
        getDurationSeconds() {
            if (this.state === RECORDER_STATES.RECORDING) {
                return Math.max(0, (performance.now() - this.startTime) / 1000);
            }
            return this.durationSeconds;
        }

        /**
         * Получить отформатированную длительность MM:SS
         * @returns {string}
         */
        getDurationFormatted() {
            return formatDuration(this.getDurationSeconds());
        }

        /**
         * Скачать готовый видеофайл
         * @param {string} [filename]
         * @returns {boolean}
         */
        download(filename) {
            if (!this.blob || !this.objectURL) {
                console.warn('[BKVideoRecorder] Нет готовой записи для скачивания');
                return false;
            }

            const downloadName = filename || this.currentFilename || this.generateFilename();
            const link = document.createElement('a');
            link.href = this.objectURL;
            link.download = downloadName;
            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                if (link.parentNode) {
                    link.parentNode.removeChild(link);
                }
            }, 100);

            console.log('[BKVideoRecorder] Скачивание запущено:', downloadName, formatFileSize(this.blob.size));
            return true;
        }

        /**
         * Генерация имени файла по стандарту:
         * <имя_загруженной_программы>-YYYY-MM-DD-HH-mm-ss.webm
         * или BK_Emulator-YYYY-MM-DD-HH-mm-ss.webm
         * @returns {string}
         */
        generateFilename() {
            let loadedName = '';

            // 1. Проверяем Gbin.name
            if (typeof Gbin !== 'undefined' && Gbin.name && Gbin.name.length > 0) {
                loadedName = Gbin.name;
            }

            // 2. Проверяем функцию getUrlLoadedFileBaseName из app.js
            if (!loadedName && typeof getUrlLoadedFileBaseName === 'function') {
                try {
                    loadedName = getUrlLoadedFileBaseName();
                } catch (e) {}
            }

            // 3. Проверяем URL параметры
            if (!loadedName && typeof window !== 'undefined' && window.location) {
                try {
                    const params = new URLSearchParams(window.location.search);
                    const urlVal = params.get('url') || params.get('URL') || params.get('file') || params.get('FILE');
                    if (urlVal) {
                        const slash = Math.max(urlVal.lastIndexOf('/'), urlVal.lastIndexOf('\\'));
                        loadedName = slash >= 0 ? urlVal.substr(slash + 1) : urlVal;
                    }
                } catch (e) {}
            }

            // Очищаем от недопустимых символов файловой системы
            if (loadedName) {
                loadedName = loadedName.replace(/[\\/:*?"<>|]/g, '').trim();
            }

            let prefix = loadedName;
            if (!prefix) {
                // Если эмулятор встроен в BKStudio (или iframe) — префикс BKStudio, иначе BK_Emulator
                const isEmbedded = (typeof window !== 'undefined' &&
                    (window.self !== window.top || new URLSearchParams(window.location.search).has('embed')));
                prefix = isEmbedded ? 'BKStudio' : 'BK_Emulator';
            }

            const d = new Date();
            const stamp = d.getFullYear() + '-' +
                pad2(d.getMonth() + 1) + '-' +
                pad2(d.getDate()) + '-' +
                pad2(d.getHours()) + '-' +
                pad2(d.getMinutes()) + '-' +
                pad2(d.getSeconds());

            return prefix + '-' + stamp + '.webm';
        }

        /**
         * Запись одного кадра эмулятора в recording canvas (1024×768)
         * Вызывается синхронно с кадровым прерыванием БК (50 Гц)
         * @param {HTMLCanvasElement|ImageData} [sourceFrame]
         */
        recordFrame(sourceFrame) {
            if (this.state !== RECORDER_STATES.RECORDING) return;
            if (!this.recordingCtx) return;

            const ctx = this.recordingCtx;

            // Гарантируем отключение сглаживания перед отрисовкой
            if (ctx.imageSmoothingEnabled) {
                ctx.imageSmoothingEnabled = false;
                ctx.mozImageSmoothingEnabled = false;
                ctx.webkitImageSmoothingEnabled = false;
                ctx.msImageSmoothingEnabled = false;
            }

            const baseObj = (this.emulator && this.emulator.base) ? this.emulator.base : (typeof base !== 'undefined' ? base : null);

            // 1. Проверяем режим AZBK (расширенная графика VGA)
            const isAzbk = baseObj && typeof baseObj.isAzbkScreenActive === 'function' && baseObj.isAzbkScreenActive();
            if (isAzbk && baseObj.azbkController && baseObj.azbkController.video) {
                const azVideo = baseObj.azbkController.video;
                const azImg = (sourceFrame instanceof ImageData) ? sourceFrame : azVideo.getImageData();

                if (azImg.width === this.config.width && azImg.height === this.config.height) {
                    // Ровно 1024×768 — прямое попиксельное копирование
                    ctx.putImageData(azImg, 0, 0);
                    return;
                }

                // Масштабирование нестандартного AZBK кадра через временный холст
                this._drawWithPixelPerfect(azImg);
                return;
            }

            // 2. Стандартный режим БК (512×256)
            // Достаем оригинальный native framebuffer canvas (CS)
            const fbCanvas = (baseObj && typeof baseObj.getFramebufferCanvas === 'function') ?
                baseObj.getFramebufferCanvas() : null;

            if (fbCanvas) {
                // Чистейшее целочисленное аппаратное масштабирование:
                // 512 × 2 = 1024
                // 256 × 3 = 768
                // Соотношение сторон 4:3, идеальный Pixel Perfect
                ctx.drawImage(fbCanvas, 0, 0, 512, 256, 0, 0, this.config.width, this.config.height);
                return;
            }

            // 3. Fallback, если холст недоступен напрямую
            if (sourceFrame instanceof ImageData) {
                this._drawWithPixelPerfect(sourceFrame);
            }
        }

        /**
         * Отрисовка произвольного ImageData с отключенным сглаживанием
         * @private
         * @param {ImageData} imgData
         */
        _drawWithPixelPerfect(imgData) {
            const ctx = this.recordingCtx;
            const srcW = imgData.width || 512;
            const srcH = imgData.height || 256;

            if (!this._tempCanvas || this._tempCanvas.width !== srcW || this._tempCanvas.height !== srcH) {
                this._tempCanvas = document.createElement('canvas');
                this._tempCanvas.width = srcW;
                this._tempCanvas.height = srcH;
                this._tempCtx = this._tempCanvas.getContext('2d');
            }

            this._tempCtx.putImageData(imgData, 0, 0);
            ctx.drawImage(this._tempCanvas, 0, 0, srcW, srcH, 0, 0, this.config.width, this.config.height);
        }

        /**
         * Захват текущего видимого кадра при старте записи
         * @private
         */
        _captureCurrentFrame() {
            const baseObj = (this.emulator && this.emulator.base) ? this.emulator.base : (typeof base !== 'undefined' ? base : null);
            if (baseObj && typeof baseObj.getFramebufferCanvas === 'function') {
                const fb = baseObj.getFramebufferCanvas();
                if (fb && this.recordingCtx) {
                    this.recordingCtx.drawImage(fb, 0, 0, 512, 256, 0, 0, this.config.width, this.config.height);
                    return;
                }
            }

            // Fallback на displayRenderer canvas
            if (global.displayRenderer && global.displayRenderer.canvas && this.recordingCtx) {
                try {
                    this.recordingCtx.drawImage(global.displayRenderer.canvas, 0, 0, this.config.width, this.config.height);
                } catch (e) {}
            }
        }

        /**
         * Подключение аудиотрека эмулятора к MediaStream записи (если звук включен)
         * @private
         * @param {MediaStream} stream
         * @returns {boolean} Было ли подключено аудио
         */
        _attachAudioTrack(stream) {
            const baseObj = (this.emulator && this.emulator.base) ? this.emulator.base : (typeof base !== 'undefined' ? base : null);
            if (!baseObj || !baseObj.srend) return false;

            const srend = baseObj.srend;
            const audioCtx = (typeof srend.getAudioContext === 'function') ? srend.getAudioContext() : null;
            const gainNode = (typeof srend.getGainNode === 'function') ? srend.getGainNode() : null;

            if (!audioCtx || !gainNode || typeof audioCtx.createMediaStreamDestination !== 'function') {
                return false;
            }

            // Если AudioContext существует и работает (running/suspended)
            try {
                this.audioDestination = audioCtx.createMediaStreamDestination();
                gainNode.connect(this.audioDestination);
                this.audioGainNode = gainNode;

                const audioTracks = this.audioDestination.stream.getAudioTracks();
                if (audioTracks && audioTracks.length > 0) {
                    stream.addTrack(audioTracks[0]);
                    return true;
                }
            } catch (err) {
                console.warn('[BKVideoRecorder] Не удалось создать audio stream destination:', err);
                if (this.audioDestination && this.audioGainNode) {
                    try { this.audioGainNode.disconnect(this.audioDestination); } catch (e) {}
                }
                this.audioDestination = null;
                this.audioGainNode = null;
            }

            return false;
        }

        /**
         * Завершение записи при событии MediaRecorder.onstop
         * @private
         */
        _handleRecorderStop() {
            try {
                // Создаем итоговый Blob
                const mime = this.selectedMimeType || 'video/webm';
                this.blob = new Blob(this.chunks, { type: mime });
                this.chunks = []; // Очищаем массив для освобождения памяти

                // Создаем Object URL для локального предпросмотра
                this.objectURL = URL.createObjectURL(this.blob);
                this.currentFilename = this.generateFilename();

                // Останавливаем все медиа-треки
                this._cleanupStreams();

                this._setState(RECORDER_STATES.READY);
                console.log('[BKVideoRecorder] Запись завершена успешно: ' +
                    this.currentFilename + ' (' +
                    formatDuration(this.durationSeconds) + ', ' +
                    formatFileSize(this.blob.size) + ', ' + mime + ')');

                if (this._stopResolve) {
                    this._stopResolve(this.blob);
                    this._stopResolve = null;
                    this._stopReject = null;
                }
            } catch (err) {
                console.error('[BKVideoRecorder] Ошибка сборки Blob:', err);
                this._setError(err && err.message ? err.message : String(err));
                if (this._stopReject) {
                    this._stopReject(err);
                    this._stopResolve = null;
                    this._stopReject = null;
                }
            }
        }

        /**
         * Остановка треков MediaStream и отключение аудио
         * @private
         */
        _cleanupStreams() {
            if (this.mediaStream) {
                try {
                    this.mediaStream.getTracks().forEach(track => {
                        try { track.stop(); } catch (e) {}
                    });
                } catch (e) {}
                this.mediaStream = null;
            }

            if (this.audioDestination && this.audioGainNode) {
                try {
                    this.audioGainNode.disconnect(this.audioDestination);
                } catch (e) {}
                try {
                    this.audioDestination.stream.getTracks().forEach(t => {
                        try { t.stop(); } catch (e) {}
                    });
                } catch (e) {}
                this.audioDestination = null;
                this.audioGainNode = null;
            }
        }

        /**
         * Очистка результатов предыдущей записи
         * @private
         */
        _cleanupPreviousRecording() {
            if (this.objectURL) {
                try {
                    URL.revokeObjectURL(this.objectURL);
                } catch (e) {}
                this.objectURL = null;
            }
            this.blob = null;
            this.chunks = [];
            this.currentFilename = '';
            this.lastError = null;
        }

        /**
         * Таймер отсчета времени записи
         * @private
         */
        _startTimer() {
            this._stopTimer();
            this.timerInterval = setInterval(() => {
                if (this.state === RECORDER_STATES.RECORDING) {
                    this._notifyStateChange();
                }
            }, 500);
        }

        /**
         * Остановка таймера
         * @private
         */
        _stopTimer() {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
        }

        /**
         * Установка нового состояния
         * @private
         * @param {string} newState
         */
        _setState(newState) {
            this.state = newState;
            this._notifyStateChange();
        }

        /**
         * Фиксация ошибки
         * @private
         * @param {string} err
         */
        _setError(err) {
            this.lastError = err;
            this._setState(RECORDER_STATES.ERROR);
            for (let i = 0; i < this.errorListeners.length; i++) {
                try {
                    this.errorListeners[i](err);
                } catch (e) {}
            }
        }

        /**
         * Оповещение слушателей об изменении состояния или длительности
         * @private
         */
        _notifyStateChange() {
            const info = {
                state: this.state,
                durationSeconds: this.getDurationSeconds(),
                durationFormatted: this.getDurationFormatted(),
                fileSize: this.blob ? this.blob.size : 0,
                fileSizeFormatted: this.blob ? formatFileSize(this.blob.size) : '0 КБ',
                filename: this.currentFilename,
                mimeType: this.selectedMimeType,
                error: this.lastError
            };

            for (let i = 0; i < this.stateListeners.length; i++) {
                try {
                    this.stateListeners[i](this.state, info);
                } catch (e) {}
            }
        }

        /**
         * Подписка на изменение состояния
         * @param {Function} callback
         */
        onStateChange(callback) {
            if (typeof callback === 'function') {
                this.stateListeners.push(callback);
            }
        }

        /**
         * Подписка на ошибки
         * @param {Function} callback
         */
        onError(callback) {
            if (typeof callback === 'function') {
                this.errorListeners.push(callback);
            }
        }

        /**
         * Полная очистка ресурсов при уничтожении
         */
        destroy() {
            this.cancel();
            this._cleanupPreviousRecording();
            this.stateListeners = [];
            this.errorListeners = [];
            this.recordingCanvas = null;
            this.recordingCtx = null;
            this._tempCanvas = null;
            this._tempCtx = null;
        }
    }

    /**
     * UI-контроллер видеозаписи: кнопки управления, таймер и модальный просмотр
     */
    class BKVideoRecorderUI {
        /**
         * @param {BKVideoRecorder} recorder
         */
        constructor(recorder) {
            this.recorder = recorder;

            // DOM элементы кнопок
            this.btnRecord = null;
            this.btnPlay = null;
            this.btnDownload = null;
            this.btnReset = null;

            // Модальное окно предпросмотра
            this.modalOverlay = null;
            this.previewVideo = null;
            this.metaFilename = null;
            this.metaResolution = null;
            this.metaDuration = null;
            this.metaSize = null;
            this.metaCodec = null;

            this._initUI();
        }

        /**
         * Инициализация элементов управления и привязка событий
         * @private
         */
        _initUI() {
            if (typeof document === 'undefined') return;

            // Поиск или создание кнопок в .button-group
            this._setupButtons();

            // Создание модального окна предпросмотра
            this._setupModal();

            // Подписка на изменения состояния рекордера
            this.recorder.onStateChange((state, info) => {
                this._updateUI(state, info);
            });

            this.recorder.onError((err) => {
                this._showToast('Ошибка записи: ' + err, true);
            });
        }

        /**
         * Настройка кнопок на панели эмулятора
         * @private
         */
        _setupButtons() {
            this.btnRecord = document.getElementById('btn-top-record');
            this.btnPlay = document.getElementById('btn-record-play');
            this.btnDownload = document.getElementById('btn-record-download');
            this.btnReset = document.getElementById('btn-record-reset');

            if (this.btnRecord) {
                this.btnRecord.onclick = () => this.toggleRecording();
            }
            if (this.btnPlay) {
                this.btnPlay.onclick = () => this.showPreview();
            }
            if (this.btnDownload) {
                this.btnDownload.onclick = () => this.recorder.download();
            }
            if (this.btnReset) {
                this.btnReset.onclick = () => this.recorder.reset();
            }
        }

        /**
         * Создание модального окна предпросмотра в DOM
         * @private
         */
        _setupModal() {
            if (document.getElementById('video-recorder-preview-modal')) {
                this.modalOverlay = document.getElementById('video-recorder-preview-modal');
                this.previewVideo = document.getElementById('bk-preview-video');
                this.metaFilename = document.getElementById('bk-modal-filename');
                this.metaResolution = document.getElementById('bk-meta-resolution');
                this.metaDuration = document.getElementById('bk-meta-duration');
                this.metaSize = document.getElementById('bk-meta-size');
                this.metaCodec = document.getElementById('bk-meta-codec');
                return;
            }

            const modalHtml = `
                <div id="video-recorder-preview-modal" class="bk-modal-overlay" style="display: none;">
                    <div class="bk-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="bk-modal-filename">
                        <div class="bk-modal-header">
                            <div class="bk-modal-title">
                                <span class="bk-modal-icon">🎥</span>
                                <span id="bk-modal-filename">recording.webm</span>
                            </div>
                            <button type="button" class="bk-modal-close" id="bk-modal-close-btn" title="Закрыть (Esc)">✕</button>
                        </div>
                        <div class="bk-modal-body">
                            <div class="bk-video-container">
                                <video id="bk-preview-video" controls autoplay loop playsinline></video>
                            </div>
                            <div class="bk-video-meta" id="bk-video-meta">
                                <span class="meta-item meta-badge" id="bk-meta-resolution">1024×768 (Pixel Perfect)</span>
                                <span class="meta-item" id="bk-meta-duration">00:00</span>
                                <span class="meta-item" id="bk-meta-size">0.0 МБ</span>
                                <span class="meta-item meta-codec" id="bk-meta-codec">VP9 / WebM</span>
                            </div>
                        </div>
                        <div class="bk-modal-footer">
                            <button type="button" class="bk-modal-btn bk-btn-download" id="bk-modal-download-btn">
                                <span class="btn-icon">⬇</span>
                                <span class="btn-text">Скачать видео</span>
                            </button>
                            <button type="button" class="bk-modal-btn bk-btn-secondary" id="bk-modal-dismiss-btn">
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const wrapper = document.createElement('div');
            wrapper.innerHTML = modalHtml;
            const modalEl = wrapper.firstElementChild;
            document.body.appendChild(modalEl);

            this.modalOverlay = modalEl;
            this.previewVideo = document.getElementById('bk-preview-video');
            this.metaFilename = document.getElementById('bk-modal-filename');
            this.metaResolution = document.getElementById('bk-meta-resolution');
            this.metaDuration = document.getElementById('bk-meta-duration');
            this.metaSize = document.getElementById('bk-meta-size');
            this.metaCodec = document.getElementById('bk-meta-codec');

            // Обработчики кнопок модального окна
            const closeBtn = document.getElementById('bk-modal-close-btn');
            const dismissBtn = document.getElementById('bk-modal-dismiss-btn');
            const downloadBtn = document.getElementById('bk-modal-download-btn');

            const closeModal = () => this.hidePreview();
            if (closeBtn) closeBtn.onclick = closeModal;
            if (dismissBtn) dismissBtn.onclick = closeModal;
            if (downloadBtn) downloadBtn.onclick = () => this.recorder.download();

            // Закрытие по клику вне диалога
            this.modalOverlay.onclick = (e) => {
                if (e.target === this.modalOverlay) {
                    closeModal();
                }
            };

            // Закрытие по клавише Esc
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.modalOverlay.style.display !== 'none') {
                    closeModal();
                }
            });
        }

        /**
         * Переключение записи (старт / стоп)
         */
        toggleRecording() {
            if (this.recorder.getState() === RECORDER_STATES.RECORDING) {
                this.recorder.stop();
            } else if (this.recorder.getState() === RECORDER_STATES.STOPPING) {
                // В процессе остановки повторные клики игнорируются
            } else {
                const ok = this.recorder.start();
                if (ok) {
                    this._showToast('🔴 Запись экрана БК начата (1024×768 Pixel Perfect)');
                }
            }
        }

        /**
         * Открыть окно предпросмотра видео
         */
        showPreview() {
            const url = this.recorder.getObjectURL();
            if (!url || !this.modalOverlay) {
                console.warn('[BKVideoRecorderUI] Нет доступного видео для предпросмотра');
                return;
            }

            if (this.previewVideo) {
                this.previewVideo.src = url;
                this.previewVideo.play().catch(() => {});
            }

            if (this.metaFilename) {
                this.metaFilename.textContent = this.recorder.currentFilename || 'recording.webm';
            }
            if (this.metaDuration) {
                this.metaDuration.textContent = '⏱ ' + this.recorder.getDurationFormatted();
            }
            if (this.metaSize && this.recorder.blob) {
                this.metaSize.textContent = '💾 ' + formatFileSize(this.recorder.blob.size);
            }
            if (this.metaCodec) {
                const isVP9 = /vp9/i.test(this.recorder.selectedMimeType);
                const hasAudio = /opus/i.test(this.recorder.selectedMimeType);
                this.metaCodec.textContent = (isVP9 ? 'VP9' : 'VP8') + (hasAudio ? ' + Opus' : '') + ' / WebM';
            }

            this.modalOverlay.style.display = 'flex';
        }

        /**
         * Закрыть окно предпросмотра
         */
        hidePreview() {
            if (this.modalOverlay) {
                this.modalOverlay.style.display = 'none';
            }
            if (this.previewVideo) {
                this.previewVideo.pause();
                this.previewVideo.removeAttribute('src');
                this.previewVideo.load();
            }
        }

        /**
         * Обновление состояния элементов интерфейса
         * @private
         * @param {string} state
         * @param {object} info
         */
        _updateUI(state, info) {
            if (!this.btnRecord) return;

            const isRecording = state === RECORDER_STATES.RECORDING;
            const isStopping = state === RECORDER_STATES.STOPPING;
            const isReady = state === RECORDER_STATES.READY;

            // Кнопка записи
            if (isRecording) {
                this.btnRecord.classList.add('is-recording');
                this.btnRecord.classList.remove('is-stopping');
                this.btnRecord.title = 'Остановить запись (нажмите для завершения)';
                this.btnRecord.innerHTML = `<span class="rec-dot">🔴</span><span class="rec-label">REC</span><span class="rec-timer">${info.durationFormatted}</span>`;
            } else if (isStopping) {
                this.btnRecord.classList.remove('is-recording');
                this.btnRecord.classList.add('is-stopping');
                this.btnRecord.title = 'Сохранение видео...';
                this.btnRecord.innerHTML = `<span class="rec-spinner">⏳</span><span class="rec-label">...</span>`;
            } else {
                this.btnRecord.classList.remove('is-recording');
                this.btnRecord.classList.remove('is-stopping');
                this.btnRecord.title = 'Запись видео (1024×768 WebM)';
                this.btnRecord.innerHTML = `<span class="btn-icon">🎥</span>`;
            }

            // Кнопки просмотра и скачивания
            if (this.btnPlay) {
                this.btnPlay.style.display = isReady ? 'flex' : 'none';
                if (isReady) {
                    this.btnPlay.title = 'Просмотр записи (' + info.durationFormatted + ')';
                }
            }
            if (this.btnDownload) {
                this.btnDownload.style.display = isReady ? 'flex' : 'none';
                if (isReady) {
                    this.btnDownload.title = 'Скачать видео (' + info.fileSizeFormatted + ')';
                }
            }
            if (this.btnReset) {
                this.btnReset.style.display = isReady ? 'flex' : 'none';
                if (isReady) {
                    this.btnReset.title = 'Закрыть запись / начать новую';
                }
            }

            // Всплывающее уведомление о готовности
            if (isReady) {
                this._showToast('✅ Видео записано: ' + info.filename + ' (' + info.durationFormatted + ', ' + info.fileSizeFormatted + ')');
            }
        }

        /**
         * Показ неблокирующего всплывающего сообщения
         * @private
         * @param {string} message
         * @param {boolean} [isError=false]
         */
        _showToast(message, isError) {
            let toast = document.getElementById('bk-recorder-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'bk-recorder-toast';
                toast.className = 'bk-toast';
                document.body.appendChild(toast);
            }

            toast.textContent = message;
            toast.className = 'bk-toast' + (isError ? ' is-error' : ' is-success') + ' is-visible';

            clearTimeout(this._toastTimeout);
            this._toastTimeout = setTimeout(() => {
                if (toast) {
                    toast.classList.remove('is-visible');
                }
            }, 3500);
        }
    }

    // Экспорт в глобальную область видимости
    global.RECORDING_CONFIG = RECORDING_CONFIG;
    global.RECORDER_STATES = RECORDER_STATES;
    global.BKVideoRecorder = BKVideoRecorder;
    global.BKVideoRecorderUI = BKVideoRecorderUI;

    // Глобальный синглтон рекордера
    global.bkVideoRecorder = new BKVideoRecorder();

    // Глобальные функции для обработчиков onclick в HTML
    global.toggleVideoRecording = function () {
        if (global.bkVideoRecorderUI) {
            global.bkVideoRecorderUI.toggleRecording();
        } else if (global.bkVideoRecorder) {
            if (global.bkVideoRecorder.getState() === RECORDER_STATES.RECORDING) {
                global.bkVideoRecorder.stop();
            } else {
                global.bkVideoRecorder.start();
            }
        }
    };
    global.showRecordingPreview = function () {
        if (global.bkVideoRecorderUI) {
            global.bkVideoRecorderUI.showPreview();
        }
    };
    global.downloadRecording = function () {
        if (global.bkVideoRecorder) {
            global.bkVideoRecorder.download();
        }
    };
    global.resetRecording = function () {
        if (global.bkVideoRecorder) {
            global.bkVideoRecorder.reset();
        }
    };

    // Автоматическая инициализация UI после загрузки DOM
    if (typeof document !== 'undefined') {
        const initUI = function () {
            if (!global.bkVideoRecorderUI) {
                global.bkVideoRecorderUI = new BKVideoRecorderUI(global.bkVideoRecorder);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initUI);
        } else {
            initUI();
        }
    }

})(typeof window !== 'undefined' ? window : this);
