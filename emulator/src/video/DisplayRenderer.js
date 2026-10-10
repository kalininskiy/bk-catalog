/**
 * DisplayRenderer.js - Видеоподсистема отображения и масштабирования для БК
 * 
 * Архитектура:
 * BK emulator native framebuffer (512×256)
 *          ↓
 * DisplayRenderer (WebGL2 / WebGL1 / 2D Canvas Fallback)
 *          ↓
 * Экран браузера (целевой display canvas #BK_canvas)
 * 
 * Режимы вывода:
 * 1. Pixel Perfect: чистейший аппаратный Nearest-Neighbor с точным физическим разрешением.
 * 2. GPU Sharp-Bilinear: субпиксельный шейдер для устранения мерцания и неравномерности
 *    пикселей при дробном масштабировании под нестандартные viewport.
 * 3. Nearest Fallback: предсказуемое масштабирование при отключенном GPU или отсутствии WebGL.
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

(function (global) {
    'use strict';

    const NATIVE_WIDTH = 512;
    const NATIVE_HEIGHT = 256;

    // Встроенный вершинный шейдер для полноэкранного квада
    const VS_SOURCE = `
        attribute vec2 aPosition;
        attribute vec2 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = vec4(aPosition, 0.0, 1.0);
            vTexCoord = aTexCoord;
        }
    `;

    // Встроенный фрагментный шейдер Nearest (Pixel Perfect)
    const FS_NEAREST_SOURCE = `
        precision highp float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    `;

    // Встроенный фрагментный шейдер Sharp-Bilinear
    const FS_SHARP_BILINEAR_SOURCE = `
        precision highp float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        uniform vec2 uSourceRes;
        uniform vec2 uTargetRes;

        void main() {
            vec2 scale = uTargetRes / uSourceRes;
            vec2 pos = vTexCoord * uSourceRes - 0.5;
            vec2 posFloor = floor(pos);
            vec2 posFract = fract(pos);
            
            // Плавный переход шириной ровно в 1 физический пиксель экрана
            vec2 sharpFract = clamp((posFract - 0.5) * scale + 0.5, 0.0, 1.0);
            vec2 sampleCoord = (posFloor + sharpFract + 0.5) / uSourceRes;
            
            gl_FragColor = texture2D(uTexture, sampleCoord);
        }
    `;

    /**
     * Создать и скомпилировать WebGL шейдер
     */
    function compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Ошибка компиляции шейдера: ' + info);
        }
        return shader;
    }

    /**
     * Создать WebGL программу из вершинного и фрагментного шейдеров
     */
    function createProgram(gl, vsSource, fsSource) {
        const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('Ошибка линковки программы: ' + info);
        }
        return program;
    }

    class DisplayRenderer {
        constructor() {
            this.canvas = null;
            this.gl = null;
            this.ctx2d = null;
            this.isWebGL = false;

            // WebGL ресурсы
            this.nearestProgram = null;
            this.sharpBilinearProgram = null;
            this.texture = null;
            this.quadBuffer = null;

            // Uniform locations
            this.sharpBilinearUniforms = {};

            // Текущее состояние вывода
            this.currentMode = 'pixel_perfect'; // 'pixel_perfect' | 'sharp_bilinear' | 'nearest_fallback'
            this.targetWidth = NATIVE_WIDTH;
            this.targetHeight = NATIVE_HEIGHT;
            this.lastResolutionInfo = null;

            // Размеры текстуры источника (поддерживает 512×256 БК и 1024×768 AZBK VGA)
            this.texWidth = NATIVE_WIDTH;
            this.texHeight = NATIVE_HEIGHT;

            // Флаг готовности
            this.isReady = false;

            // Callback на вывод каждого кадра (для видеозаписи и захвата)
            this.onFrameCallback = null;
        }

        /**
         * Инициализировать рендерер с целевым DOM canvas
         * @param {HTMLCanvasElement|string} canvasOrId
         * @returns {boolean} Успешность инициализации
         */
        init(canvasOrId) {
            this.canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
            if (!this.canvas) {
                console.error('[DisplayRenderer] Канвас не найден:', canvasOrId);
                return false;
            }

            // Пытаемся получить WebGL контекст с сохранением буфера для корректной работы скриншотов
            const glOptions = {
                alpha: false,
                depth: false,
                stencil: false,
                antialias: false,
                preserveDrawingBuffer: true,
                powerPreference: 'high-performance'
            };

            this.gl = this.canvas.getContext('webgl2', glOptions) ||
                      this.canvas.getContext('webgl', glOptions) ||
                      this.canvas.getContext('experimental-webgl', glOptions);

            if (this.gl) {
                try {
                    this._initWebGL();
                    this.isWebGL = true;
                    if (global.displayModeManager) {
                        global.displayModeManager.setWebglSupported(true);
                    }
                    console.log('[DisplayRenderer] WebGL успешно инициализирован');
                } catch (e) {
                    console.warn('[DisplayRenderer] Ошибка инициализации WebGL шейдеров, переключение на 2D:', e);
                    this.gl = null;
                    this.isWebGL = false;
                }
            }

            if (!this.isWebGL) {
                // Fallback на обычный Canvas 2D
                this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: false });
                if (global.displayModeManager) {
                    global.displayModeManager.setWebglSupported(false);
                }
                console.log('[DisplayRenderer] Работа в режиме 2D Canvas Fallback');
            }

            this.isReady = true;
            return true;
        }

        /**
         * Настройка WebGL геометрии, шейдеров и текстур
         * @private
         */
        _initWebGL() {
            const gl = this.gl;

            // Компиляция программ
            this.nearestProgram = createProgram(gl, VS_SOURCE, FS_NEAREST_SOURCE);
            this.sharpBilinearProgram = createProgram(gl, VS_SOURCE, FS_SHARP_BILINEAR_SOURCE);

            // Получение locations для sharp-bilinear программы
            this.sharpBilinearUniforms = {
                uTexture: gl.getUniformLocation(this.sharpBilinearProgram, 'uTexture'),
                uSourceRes: gl.getUniformLocation(this.sharpBilinearProgram, 'uSourceRes'),
                uTargetRes: gl.getUniformLocation(this.sharpBilinearProgram, 'uTargetRes')
            };

            // Геометрия полноэкранного квада (X, Y, U, V)
            // Примечание: в WebGL Y идет снизу вверх, а в Canvas — сверху вниз.
            // Маппим V координаты 0.0 на верх и 1.0 на низ для корректной ориентации без лишних копирований.
            const quadVertices = new Float32Array([
                // X,     Y,     U,   V
                -1.0, -1.0,   0.0, 1.0,
                 1.0, -1.0,   1.0, 1.0,
                -1.0,  1.0,   0.0, 0.0,
                 1.0,  1.0,   1.0, 0.0
            ]);

            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

            // Создание текстуры 512×256
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

            // Выделяем память под текстуру 512×256 RGBA
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA,
                NATIVE_WIDTH, NATIVE_HEIGHT, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, null
            );
        }

        /**
         * Задать физический и визуальный размер области вывода канваса
         * @param {number} width - Физическая ширина в px
         * @param {number} height - Физическая высота в px
         * @param {string} mode - 'pixel_perfect' | 'sharp_bilinear' | 'nearest_fallback'
         * @param {object} [resolutionInfo] - Диагностическая информация
         */
        setDisplaySize(width, height, mode, resolutionInfo) {
            const w = Math.max(1, Math.floor(width));
            const h = Math.max(1, Math.floor(height));

            this.targetWidth = w;
            this.targetHeight = h;
            this.currentMode = mode;
            this.lastResolutionInfo = resolutionInfo || null;

            if (this.canvas) {
                // Физический размер буфера канваса
                if (this.canvas.width !== w) this.canvas.width = w;
                if (this.canvas.height !== h) this.canvas.height = h;

                // Отображаемый CSS размер (ровно 1-в-1 с физическим размером буфера)
                this.canvas.style.width = w + 'px';
                this.canvas.style.height = h + 'px';
                this.canvas.style.aspectRatio = w + ' / ' + h;

                // Для nearest и pixel perfect выставляем свойство pixelated
                if (mode === 'pixel_perfect' || mode === 'nearest_fallback') {
                    this.canvas.style.imageRendering = 'pixelated';
                } else {
                    // При sharp-bilinear шейдер выполняет фильтрацию сам на GPU
                    this.canvas.style.imageRendering = 'auto';
                }
            }

            if (this.isWebGL && this.gl) {
                this.gl.viewport(0, 0, w, h);
            }
        }

        /**
         * Отрисовать кадр из native framebuffer БК (512×256)
         * @param {HTMLCanvasElement|ImageData} sourceFrame - Исходный кадр 512×256
         */
        present(sourceFrame) {
            if (!this.isReady || !sourceFrame) return;

            if (this.isWebGL && this.gl) {
                this._renderWebGL(sourceFrame);
            } else if (this.ctx2d) {
                this._render2D(sourceFrame);
            }

            // Уведомление слушателей кадра (для записи видео без потерь)
            if (this.onFrameCallback) {
                try {
                    this.onFrameCallback(sourceFrame);
                } catch (e) {
                    console.error('[DisplayRenderer] onFrameCallback error:', e);
                }
            }
        }

        /**
         * Рендеринг кадра через WebGL
         * @private
         */
        _renderWebGL(sourceFrame) {
            const gl = this.gl;
            const srcW = sourceFrame.width || NATIVE_WIDTH;
            const srcH = sourceFrame.height || NATIVE_HEIGHT;

            // Обновляем текстуру кадра
            gl.bindTexture(gl.TEXTURE_2D, this.texture);

            // Если размер источника изменился (например, переключение на AZBK 1024×768), перевыделяем текстуру
            if (this.texWidth !== srcW || this.texHeight !== srcH) {
                gl.texImage2D(
                    gl.TEXTURE_2D, 0, gl.RGBA,
                    srcW, srcH, 0,
                    gl.RGBA, gl.UNSIGNED_BYTE, null
                );
                this.texWidth = srcW;
                this.texHeight = srcH;
            }

            if (sourceFrame instanceof ImageData) {
                gl.texSubImage2D(
                    gl.TEXTURE_2D, 0, 0, 0,
                    srcW, srcH,
                    gl.RGBA, gl.UNSIGNED_BYTE, sourceFrame.data
                );
            } else {
                // Если передан offscreen canvas или image
                gl.texSubImage2D(
                    gl.TEXTURE_2D, 0, 0, 0,
                    gl.RGBA, gl.UNSIGNED_BYTE, sourceFrame
                );
            }

            let program;
            if (this.currentMode === 'sharp_bilinear') {
                // GPU Sharp-Bilinear шейдер: требует линейную фильтрацию текстуры
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                program = this.sharpBilinearProgram;
                gl.useProgram(program);

                gl.uniform1i(this.sharpBilinearUniforms.uTexture, 0);
                gl.uniform2f(this.sharpBilinearUniforms.uSourceRes, srcW, srcH);
                gl.uniform2f(this.sharpBilinearUniforms.uTargetRes, this.targetWidth, this.targetHeight);
            } else {
                // Pixel Perfect и Nearest Fallback: максимально простой и быстрый Nearest path
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

                program = this.nearestProgram;
                gl.useProgram(program);
            }

            // Настройка атрибутов вершинного буфера
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

            const aPosition = gl.getAttribLocation(program, 'aPosition');
            const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');

            gl.enableVertexAttribArray(aPosition);
            gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

            gl.enableVertexAttribArray(aTexCoord);
            gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

            // Отрисовка полноэкранного квада
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        /**
         * Рендеринг кадра через 2D Canvas Fallback
         * @private
         */
        _render2D(sourceFrame) {
            const ctx = this.ctx2d;
            const srcW = sourceFrame.width || NATIVE_WIDTH;
            const srcH = sourceFrame.height || NATIVE_HEIGHT;
            ctx.imageSmoothingEnabled = false;

            if (sourceFrame instanceof ImageData) {
                // Если передан ImageData, создаем или подстраиваем вспомогательный offscreen холст
                if (!this._tmpCanvas || this._tmpCanvas.width !== srcW || this._tmpCanvas.height !== srcH) {
                    this._tmpCanvas = document.createElement('canvas');
                    this._tmpCanvas.width = srcW;
                    this._tmpCanvas.height = srcH;
                    this._tmpCtx = this._tmpCanvas.getContext('2d');
                }
                this._tmpCtx.putImageData(sourceFrame, 0, 0);
                ctx.drawImage(this._tmpCanvas, 0, 0, srcW, srcH, 0, 0, this.targetWidth, this.targetHeight);
            } else {
                ctx.drawImage(sourceFrame, 0, 0, srcW, srcH, 0, 0, this.targetWidth, this.targetHeight);
            }
        }

        /**
         * Задать callback для каждого выведенного кадра
         * @param {Function|null} callback
         */
        setOnFrame(callback) {
            this.onFrameCallback = (typeof callback === 'function') ? callback : null;
        }

        /**
         * Получить холст для сохранения чистого скриншота без артефактов
         * @returns {HTMLCanvasElement}
         */
        getScreenshotCanvas() {
            return this.canvas;
        }
    }

    // Экспортируем в глобальную область
    global.DisplayRenderer = DisplayRenderer;
    global.displayRenderer = new DisplayRenderer();

})(typeof window !== 'undefined' ? window : this);
