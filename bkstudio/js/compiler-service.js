/**
 * BKStudio - Compiler Service (BKTurbo8 WebAssembly Bridge)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class BKCompilerService {
    constructor() {
      this.moduleInstance = null;
      this.isInitializing = false;
      this.initPromise = null;
    }

    /**
     * Инициализация WASM модуля BKTurbo8
     */
    async init() {
      if (this.moduleInstance) return this.moduleInstance;
      if (this.initPromise) return this.initPromise;

      this.initPromise = new Promise(async (resolve, reject) => {
        try {
          if (typeof createBKTurbo8Module !== 'function') {
            throw new Error('Функция createBKTurbo8Module не найдена. Убедитесь, что wasm/BKTurbo8.js подключен.');
          }

          console.log('[BKStudio] Инициализация WebAssembly компилятора BKTurbo8...');
          const startTime = performance.now();

          const instance = await createBKTurbo8Module({
            locateFile: (path) => {
              if (path.endsWith('.wasm')) {
                return 'wasm/' + path;
              }
              return path;
            },
            print: (text) => {
              if (this.currentStdoutHandler) this.currentStdoutHandler(text);
            },
            printErr: (text) => {
              if (this.currentStderrHandler) this.currentStderrHandler(text);
            }
          });

          const elapsed = (performance.now() - startTime).toFixed(1);
          console.log(`[BKStudio] BKTurbo8.wasm успешно загружен за ${elapsed} мс.`);
          this.moduleInstance = instance;
          resolve(instance);
        } catch (err) {
          console.error('[BKStudio] Ошибка инициализации BKTurbo8.wasm:', err);
          reject(err);
        }
      });

      return this.initPromise;
    }

    /**
     * Компиляция проекта или файла
     * @param {Object} params
     * @param {Object} params.files Словарь файлов { "main.asm": "...", "sprites.asm": "..." }
     * @param {string} params.mainFile Имя главного файла (по умолчанию 'main.asm')
     * @param {string} params.format Формат вывода: 'bin', 'sav', 'raw'
     * @param {string|number} params.startAddress Начальный адрес в восьмеричном формате (напр. '1000')
     * @param {string} params.platform Платформа: 'BK-0010' или 'BK-0011M'
     * @param {boolean} params.listing Генерировать листинг .LST
     * @param {Function} params.onLog Callback для сообщений компилятора
     */
    async compile(params) {
      const {
        files = {},
        mainFile = 'main.asm',
        format = 'bin',
        startAddress = null,
        platform = 'BK-0010',
        listing = true,
        onLog = () => {}
      } = params;

      const Module = await this.init();
      const FS = Module.FS;

      const stdoutLines = [];
      const stderrLines = [];
      this.currentStdoutHandler = (line) => {
        stdoutLines.push(line);
        onLog(line, 'stdout');
      };
      this.currentStderrHandler = (line) => {
        stderrLines.push(line);
        onLog(line, 'stderr');
      };

      const startTime = performance.now();
      const createdFiles = [];

      try {
        // 1. Записываем все файлы проекта в виртуальную память FS
        for (const [name, content] of Object.entries(files)) {
          const filePath = '/' + name;
          FS.writeFile(filePath, content);
          createdFiles.push(filePath);
        }

        // 2. Формируем аргументы командной строки BKTurbo8
        const args = [];

        // Входная кодировка: UTF-8
        args.push('-i8');

        // Кодировка выходных данных КОИ8: 0 для БК-0010, 1 для БК-0011М
        if (platform === 'BK-0011M') {
          args.push('-O1');
        } else {
          args.push('-O0');
        }

        // Формат вывода: SAV или RAW
        if (format === 'sav') {
          args.push('-x');
        } else if (format === 'raw') {
          args.push('-r');
        }

        // Генерация листинга
        if (listing) {
          args.push('-l');
        }

        // Начальный адрес (если указан явно)
        if (startAddress) {
          const cleanAddr = String(startAddress).replace(/^0o|^0/, '');
          if (cleanAddr) {
            args.push('-s' + cleanAddr);
          }
        }

        // Детализированный вывод
        args.push('-d');

        // Команда компиляции: 'co' (Compile to binary)
        args.push('co');

        // Имя входного файла
        args.push('/' + mainFile);

        onLog(`[BKTurbo8] Вызов: ${args.join(' ')}`, 'info');

        // 3. Запуск компилятора
        const exitCode = Module.callMain(args);
        const durationMs = (performance.now() - startTime).toFixed(1);

        // 4. Парсим ошибки из вывода
        const errors = this.parseErrors(stdoutLines.concat(stderrLines), mainFile);

        // 5. Имена ожидаемых выходных файлов
        const baseName = mainFile.replace(/\.[^/.]+$/, '');
        const binExt = (format === 'sav') ? '.sav' : (format === 'raw' ? '.raw' : '.bin');
        const outBinPath = '/' + baseName + binExt;
        const outLstPath = '/' + baseName + '.lst';

        let binData = null;
        let lstText = null;
        let loadAddress = null;
        let programLength = null;

        if (exitCode === 0) {
          try {
            if (FS.analyzePath(outBinPath).exists) {
              binData = FS.readFile(outBinPath);
              createdFiles.push(outBinPath);

              // Извлекаем заголовок БК (если формат bin):
              if (format === 'bin' && binData.length >= 4) {
                loadAddress = binData[0] | (binData[1] << 8);
                programLength = binData[2] | (binData[3] << 8);
              }
            }
          } catch (e) {
            console.warn('[BKStudio] Не удалось прочитать выходной бинарный файл:', e);
          }

          try {
            if (listing && FS.analyzePath(outLstPath).exists) {
              const lstBytes = FS.readFile(outLstPath);
              // BKTurbo8 генерирует листинг в кодировке КОИ-8 (KOI8-R)
              try {
                lstText = new TextDecoder('koi8-r').decode(lstBytes);
              } catch (decErr) {
                lstText = new TextDecoder('windows-1251').decode(lstBytes);
              }
              createdFiles.push(outLstPath);
            }
          } catch (e) {
            console.warn('[BKStudio] Не удалось прочитать файл листинга:', e);
          }

          const artifacts = {};
          if (binData) {
            artifacts[baseName + binExt] = binData;
          }
          if (lstText) {
            artifacts[baseName + '.lst'] = lstText;
          }

          onLog(`[BKStudio] Компиляция завершена успешно за ${durationMs} мс! Размер: ${binData ? binData.length : 0} байт.`, 'success');

          return {
            success: true,
            exitCode,
            binData,
            lstText,
            artifacts,
            format,
            loadAddress,
            programLength,
            durationMs,
            stdout: stdoutLines.join('\n'),
            stderr: stderrLines.join('\n'),
            errors: []
          };
        } else {
          onLog(`[BKStudio] Ошибка компиляции (код ${exitCode}). Ошибок обнаружено: ${errors.length}`, 'error');
          return {
            success: false,
            exitCode,
            durationMs,
            errors,
            stdout: stdoutLines.join('\n'),
            stderr: stderrLines.join('\n')
          };
        }
      } finally {
        // Очищаем временные файлы в виртуальной FS, освобождая память
        for (const f of createdFiles) {
          try {
            if (FS.analyzePath(f).exists) {
              FS.unlink(f);
            }
          } catch (e) {}
        }
        this.currentStdoutHandler = null;
        this.currentStderrHandler = null;
      }
    }

    /**
     * Парсинг строк вывода компилятора в структурированный список ошибок
     * @param {string[]} lines 
     * @param {string} defaultFile 
     * @returns {Array<{line: number, file: string, message: string, code: number, address: string}>}
     */
    parseErrors(lines, defaultFile) {
      const errors = [];
      // Регулярные выражения для формата ошибок BKTurbo8:
      // "Line 5 (Addr: 0001010) - Error 105: Неправильная псевдокоманда."
      // "Line 12: Ошибка синтаксиса"
      const errRe1 = /Line\s+(\d+)(?:\s+\(Addr:\s*([0-9a-fA-F]+)\))?\s*-\s*Error\s+(\d+):\s*(.+)/i;
      const errRe2 = /Line\s+(\d+):\s*(.+)/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let m = line.match(errRe1);
        if (m) {
          errors.push({
            line: parseInt(m[1], 10),
            address: m[2] || '',
            code: parseInt(m[3], 10),
            message: m[4].trim(),
            file: defaultFile
          });
          continue;
        }

        m = line.match(errRe2);
        if (m && !line.includes('none')) {
          errors.push({
            line: parseInt(m[1], 10),
            address: '',
            code: 0,
            message: m[2].trim(),
            file: defaultFile
          });
        }
      }

      return errors;
    }
  }

  global.BKCompilerService = BKCompilerService;
  global.bkCompiler = new BKCompilerService();

})(typeof window !== 'undefined' ? window : this);
