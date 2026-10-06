/**
 * DisplayMode.js - Управление режимами масштабирования и геометрией экрана БК
 * 
 * Назначение:
 * - Хранение и расчет проверенных кандидатов Pixel Perfect с учетом раздельных
 *   коэффициентов scaleX и scaleY (историческая геометрия видеорежимов БК).
 * - Алгоритм многокритериального выбора наилучшего Pixel Perfect режима под viewport.
 * - Принятие решения: Pixel Perfect vs GPU Sharp-Bilinear vs Nearest Fallback.
 * - Управление пользовательскими настройками масштабирования.
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

(function (global) {
    'use strict';

    /**
     * Базовое (native) разрешение видеобуфера БК
     */
    const NATIVE_WIDTH = 512;
    const NATIVE_HEIGHT = 256;

    /**
     * Стандартное соотношение сторон экрана БК на телевизоре/мониторе (4:3)
     */
    const TARGET_ASPECT_RATIO = 4.0 / 3.0;

    /**
     * Проверенные кандидаты Pixel Perfect режимов.
     * scaleX - коэффициент по горизонтали относительно 512
     * scaleY - коэффициент по вертикали относительно 256
     * width = 512 * scaleX
     * height = 256 * scaleY
     * par = resulting pixel aspect ratio (соотношение сторон пикселя)
     */
    const PIXEL_PERFECT_CANDIDATES = [
        { id: '512x384',   scaleX: 1.0, scaleY: 1.5, width: 512,  height: 384,  par: 1.000, name: '1.0×1.5 (512×384, 4:3)' },
        { id: '1024x768',  scaleX: 2.0, scaleY: 3.0, width: 1024, height: 768,  par: 1.000, name: '2.0×3.0 (1024×768, 4:3)' },
        { id: '1536x1024', scaleX: 3.0, scaleY: 4.0, width: 1536, height: 1024, par: 0.889, name: '3.0×4.0 (1536×1024)' },
        { id: '1536x1280', scaleX: 3.0, scaleY: 5.0, width: 1536, height: 1280, par: 1.111, name: '3.0×5.0 (1536×1280)' },
        // Расширенные кандидаты высокого разрешения (1440p, 4K)
        { id: '2048x1280', scaleX: 4.0, scaleY: 5.0, width: 2048, height: 1280, par: 0.889, name: '4.0×5.0 (2048×1280)' },
        { id: '2048x1536', scaleX: 4.0, scaleY: 6.0, width: 2048, height: 1536, par: 1.000, name: '4.0×6.0 (2048×1536, 4:3)' },
        { id: '2560x1792', scaleX: 5.0, scaleY: 7.0, width: 2560, height: 1792, par: 0.952, name: '5.0×7.0 (2560×1792)' },
        { id: '2560x2048', scaleX: 5.0, scaleY: 8.0, width: 2560, height: 2048, par: 1.111, name: '5.0×8.0 (2560×2048)' },
        { id: '3072x2048', scaleX: 6.0, scaleY: 8.0, width: 3072, height: 2048, par: 0.889, name: '6.0×8.0 (3072×2048)' },
        { id: '3072x2304', scaleX: 6.0, scaleY: 9.0, width: 3072, height: 2304, par: 1.000, name: '6.0×9.0 (3072×2304, 4:3)' }
    ];

    /**
     * Доступные режимы политики масштабирования
     */
    const SCALE_POLICY = {
        AUTO: 'auto',                   // В первую очередь Pixel Perfect; если не подходит — GPU Sharp-Bilinear
        PIXEL_PERFECT: 'pixel_perfect', // Строго лучший Pixel Perfect, помещающийся в viewport
        FIT_4_3: 'fit_4_3'              // Максимальное заполнение 4:3 области экрана
    };

    /**
     * Класс управления геометрией и режимами экрана
     */
    class DisplayModeManager {
        constructor() {
            this.candidates = [...PIXEL_PERFECT_CANDIDATES];
            this.policy = this._loadSavedPolicy();
            this.gpuSharpBilinearEnabled = this._loadSavedGpuSetting();
            this.webglSupported = true; // Будет уточнено рендерером
            this.debugOverlayEnabled = false;
        }

        /**
         * Загрузить сохраненную политику масштабирования
         * @private
         */
        _loadSavedPolicy() {
            try {
                const saved = localStorage.getItem('bk_display_scale_mode');
                if (saved && Object.values(SCALE_POLICY).includes(saved)) {
                    return saved;
                }
            } catch (e) {}
            return SCALE_POLICY.PIXEL_PERFECT; // По умолчанию: Pixel Perfect
        }

        /**
         * Загрузить настройку GPU Sharp-Bilinear
         * @private
         */
        _loadSavedGpuSetting() {
            try {
                const saved = localStorage.getItem('bk_display_gpu_sharp_bilinear');
                if (saved !== null) {
                    return saved === '1' || saved === 'true';
                }
            } catch (e) {}
            return true; // По умолчанию включено
        }

        /**
         * Установить политику масштабирования
         * @param {string} policy - 'auto' | 'pixel_perfect' | 'fit_4_3'
         */
        setPolicy(policy) {
            if (Object.values(SCALE_POLICY).includes(policy)) {
                this.policy = policy;
                try {
                    localStorage.setItem('bk_display_scale_mode', policy);
                } catch (e) {}
            }
        }

        /**
         * Включить/выключить GPU Sharp-Bilinear
         * @param {boolean} enabled
         */
        setGpuSharpBilinear(enabled) {
            this.gpuSharpBilinearEnabled = Boolean(enabled);
            try {
                localStorage.setItem('bk_display_gpu_sharp_bilinear', this.gpuSharpBilinearEnabled ? '1' : '0');
            } catch (e) {}
        }

        /**
         * Уведомить о поддержке WebGL в текущем браузере
         * @param {boolean} supported
         */
        setWebglSupported(supported) {
            this.webglSupported = Boolean(supported);
        }

        /**
         * Найти всех кандидатов, помещающихся в указанные границы
         * @param {number} viewportWidth
         * @param {number} viewportHeight
         * @returns {Array<object>}
         */
        getFittingCandidates(viewportWidth, viewportHeight) {
            return this.candidates.filter(
                c => c.width <= viewportWidth && c.height <= viewportHeight
            );
        }

        /**
         * Найти наилучшего кандидата Pixel Perfect по описанным критериям:
         * 1. Полностью помещаться в viewport.
         * 2. Максимально использовать площадь экрана.
         * 3. Предпочитать больший режим меньшему.
         * 4. При близкой площади предпочитать режим с PAR ближе к 1.0 (4:3) и меньшими полями.
         * 5. Сохранять геометрию БК.
         * 
         * @param {number} viewportWidth
         * @param {number} viewportHeight
         * @returns {object|null}
         */
        findBestPixelPerfectCandidate(viewportWidth, viewportHeight) {
            const fitting = this.getFittingCandidates(viewportWidth, viewportHeight);
            if (fitting.length === 0) {
                return null;
            }

            // Находим максимальную площадь среди помещающихся
            let maxArea = 0;
            for (const c of fitting) {
                const area = c.width * c.height;
                if (area > maxArea) {
                    maxArea = area;
                }
            }

            // Кандидаты с площадью >= 90% от максимальной считаются конкурентными по размеру.
            // Среди них выбираем режим с минимальным отклонением PAR от 1.0 (идеальное 4:3)
            // и максимальным коэффициентом заполнения.
            let best = null;
            let bestScore = -Infinity;

            for (const c of fitting) {
                const area = c.width * c.height;
                const areaRatio = area / maxArea; // 0..1
                
                // Штраф за отклонение от PAR = 1.0 (идеальные пропорции)
                const parDeviation = Math.abs(c.par - 1.0);
                
                // Комплексная оценка: доминирует площадь, при близкой площади побеждает правильный PAR
                const score = (areaRatio * 100.0) - (parDeviation * 15.0);
                
                if (score > bestScore) {
                    bestScore = score;
                    best = c;
                }
            }

            return best;
        }

        /**
         * Вычислить максимальный прямоугольник 4:3, вписывающийся в заданный viewport
         * @param {number} viewportWidth
         * @param {number} viewportHeight
         * @returns {{width: number, height: number}}
         */
        calculateFit43Resolution(viewportWidth, viewportHeight) {
            const vpAspect = viewportWidth / viewportHeight;
            let fitW, fitH;

            if (vpAspect >= TARGET_ASPECT_RATIO) {
                // Ограничение по высоте, черные поля по бокам (pillarbox)
                fitH = Math.floor(viewportHeight);
                fitW = Math.floor(fitH * TARGET_ASPECT_RATIO);
            } else {
                // Ограничение по ширине, черные поля сверху/снизу (letterbox)
                fitW = Math.floor(viewportWidth);
                fitH = Math.floor(fitW / TARGET_ASPECT_RATIO);
            }

            // Гарантируем четные размеры для корректной работы растра
            if (fitW % 2 !== 0) fitW--;
            if (fitH % 2 !== 0) fitH--;

            return {
                width: Math.max(NATIVE_WIDTH, fitW),
                height: Math.max(NATIVE_HEIGHT, fitH)
            };
        }

        /**
         * Проверить, является ли кандидат подходящим (suitable) для режима AUTO.
         * Подходящим считается режим, который не оставляет чрезмерно больших пустых полей:
         * - Покрывает не менее 80% высоты максимальной 4:3 области экрана,
         * - ИЛИ вертикальный зазор до границы viewport меньше 64 пикселей (например 1024 в 1080p).
         * 
         * @param {object} candidate
         * @param {number} fit43Width
         * @param {number} fit43Height
         * @param {number} viewportHeight
         * @returns {boolean}
         */
        isCandidateSuitableForAuto(candidate, fit43Width, fit43Height, viewportHeight) {
            if (!candidate) return false;

            const heightRatio = candidate.height / fit43Height;
            const areaRatio = (candidate.width * candidate.height) / (fit43Width * fit43Height);
            const verticalMargin = viewportHeight - candidate.height;

            // Если кандидат заполняет >= 80% высоты и >= 70% площади 4:3,
            // либо вертикальные поля очень малы (<= 64px суммарно), то он великолепен!
            if (heightRatio >= 0.80 && areaRatio >= 0.70) {
                return true;
            }
            if (verticalMargin <= 64 && heightRatio >= 0.75) {
                return true;
            }

            return false;
        }

        /**
         * Разрешить display режим для текущего viewport и настроек.
         * 
         * Главная логика:
         * 1. В режиме AUTO:
         *    - Ищется лучший Pixel Perfect кандидат.
         *    - Если он подходит (suitable) -> Pixel Perfect.
         *    - Если не подходит (остаются огромные дыры, как 768×512 в 720p):
         *      - Если GPU включен и WebGL доступен -> GPU Sharp-Bilinear (заполнение 4:3).
         *      - Иначе -> Nearest Fallback (заполнение 4:3).
         * 2. В режиме PIXEL_PERFECT:
         *    - Всегда лучший Pixel Perfect кандидат <= viewport.
         * 3. В режиме FIT_4_3:
         *    - Если кандидат точно совпадает с 4:3 размером -> Pixel Perfect.
         *    - Иначе -> GPU Sharp-Bilinear (если включен) или Nearest Fallback.
         * 
         * @param {number} viewportWidth - Доступная ширина (px)
         * @param {number} viewportHeight - Доступная высота (px)
         * @returns {object} Итоговые параметры масштабирования
         */
        resolve(viewportWidth, viewportHeight) {
            const vpW = Math.max(320, Math.floor(viewportWidth));
            const vpH = Math.max(240, Math.floor(viewportHeight));

            const bestCandidate = this.findBestPixelPerfectCandidate(vpW, vpH);
            const fit43 = this.calculateFit43Resolution(vpW, vpH);

            let chosenMode = null; // 'pixel_perfect' | 'sharp_bilinear' | 'nearest_fallback'
            let targetW = 0;
            let targetH = 0;
            let scaleX = 1.0;
            let scaleY = 1.0;
            let candidateRef = null;

            const isGpuUsable = this.gpuSharpBilinearEnabled && this.webglSupported;

            if (this.policy === SCALE_POLICY.PIXEL_PERFECT) {
                // Принудительный Pixel Perfect
                if (bestCandidate) {
                    chosenMode = 'pixel_perfect';
                    targetW = bestCandidate.width;
                    targetH = bestCandidate.height;
                    scaleX = bestCandidate.scaleX;
                    scaleY = bestCandidate.scaleY;
                    candidateRef = bestCandidate;
                } else {
                    // Даже 512×256 не влез — минимальный fallback
                    chosenMode = isGpuUsable ? 'sharp_bilinear' : 'nearest_fallback';
                    targetW = fit43.width;
                    targetH = fit43.height;
                    scaleX = targetW / NATIVE_WIDTH;
                    scaleY = targetH / NATIVE_HEIGHT;
                }
            } else if (this.policy === SCALE_POLICY.FIT_4_3) {
                // Принудительное заполнение 4:3
                if (bestCandidate && bestCandidate.width === fit43.width && bestCandidate.height === fit43.height) {
                    chosenMode = 'pixel_perfect';
                    targetW = bestCandidate.width;
                    targetH = bestCandidate.height;
                    scaleX = bestCandidate.scaleX;
                    scaleY = bestCandidate.scaleY;
                    candidateRef = bestCandidate;
                } else if (isGpuUsable) {
                    chosenMode = 'sharp_bilinear';
                    targetW = fit43.width;
                    targetH = fit43.height;
                    scaleX = targetW / NATIVE_WIDTH;
                    scaleY = targetH / NATIVE_HEIGHT;
                } else {
                    chosenMode = 'nearest_fallback';
                    targetW = fit43.width;
                    targetH = fit43.height;
                    scaleX = targetW / NATIVE_WIDTH;
                    scaleY = targetH / NATIVE_HEIGHT;
                }
            } else {
                // Режим AUTO (по умолчанию)
                const isSuitable = this.isCandidateSuitableForAuto(bestCandidate, fit43.width, fit43.height, vpH);

                if (isSuitable && bestCandidate) {
                    // Найден великолепный Pixel Perfect кандидат
                    chosenMode = 'pixel_perfect';
                    targetW = bestCandidate.width;
                    targetH = bestCandidate.height;
                    scaleX = bestCandidate.scaleX;
                    scaleY = bestCandidate.scaleY;
                    candidateRef = bestCandidate;
                } else {
                    // Подходящего Pixel Perfect нет (оставляет слишком большие пустые поля)
                    if (isGpuUsable) {
                        chosenMode = 'sharp_bilinear';
                        targetW = fit43.width;
                        targetH = fit43.height;
                        scaleX = targetW / NATIVE_WIDTH;
                        scaleY = targetH / NATIVE_HEIGHT;
                    } else {
                        // GPU выключен или недоступен — честный nearest fallback для заполнения 4:3
                        // Если есть хотя бы какой-то Pixel Perfect кандидат и он занимает > 50% площади,
                        // пользователь при отключенном GPU может предпочесть четкий режим,
                        // но если пустые поля слишком велики — выводим nearest 4:3.
                        if (bestCandidate && (bestCandidate.height / fit43.height) >= 0.70) {
                            chosenMode = 'pixel_perfect';
                            targetW = bestCandidate.width;
                            targetH = bestCandidate.height;
                            scaleX = bestCandidate.scaleX;
                            scaleY = bestCandidate.scaleY;
                            candidateRef = bestCandidate;
                        } else {
                            chosenMode = 'nearest_fallback';
                            targetW = fit43.width;
                            targetH = fit43.height;
                            scaleX = targetW / NATIVE_WIDTH;
                            scaleY = targetH / NATIVE_HEIGHT;
                        }
                    }
                }
            }

            // Вычисляем размер полей (padding/letterbox/pillarbox)
            const padX = Math.max(0, Math.floor((vpW - targetW) / 2));
            const padY = Math.max(0, Math.floor((vpH - targetH) / 2));

            return {
                mode: chosenMode,               // 'pixel_perfect' | 'sharp_bilinear' | 'nearest_fallback'
                targetWidth: targetW,
                targetHeight: targetH,
                scaleX: Number(scaleX.toFixed(4)),
                scaleY: Number(scaleY.toFixed(4)),
                candidate: candidateRef,
                viewportWidth: vpW,
                viewportHeight: vpH,
                padX: padX,
                padY: padY,
                gpuActive: (chosenMode === 'sharp_bilinear'),
                policy: this.policy,
                isGpuOptionEnabled: this.gpuSharpBilinearEnabled,
                webglSupported: this.webglSupported
            };
        }
    }

    // Экспортируем в глобальную область видимости
    global.DisplayModeManager = DisplayModeManager;
    global.SCALE_POLICY = SCALE_POLICY;
    global.displayModeManager = new DisplayModeManager();

})(typeof window !== 'undefined' ? window : this);
