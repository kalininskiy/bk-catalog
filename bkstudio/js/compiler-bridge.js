/**
 * BKStudio - Unified Compiler Bridge (BKTurbo8 WASM + PDPy11 Pyodide WASM + MACRO-11 / pclink11 WASM)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class CompilerBridgeManager {
    constructor() {
      this.activeCompiler = localStorage.getItem('bkstudio_compiler') || 'bkturbo8';
      this.pdpy11Worker = null;
      this.requestId = 1;
      this.pendingRequests = new Map();
      this.onStatusCallback = null;
    }

    /**
     * Получить имя активного компилятора ('bkturbo8' | 'pdpy11' | 'macro11')
     */
    getCompiler() {
      return this.activeCompiler;
    }

    /**
     * Установить активный компилятор
     */
    setCompiler(name) {
      if (name !== 'bkturbo8' && name !== 'pdpy11' && name !== 'macro11') {
        name = 'bkturbo8';
      }
      this.activeCompiler = name;
      localStorage.setItem('bkstudio_compiler', name);

      // Если выбран PDPy11, инициируем фоновую предзагрузку воркера
      if (name === 'pdpy11') {
        this.ensurePdpy11Worker();
      }
    }

    /**
     * Подписка на сообщения статуса инициализации
     */
    onStatus(callback) {
      this.onStatusCallback = callback;
    }

    /**
     * Инициализация Web Worker для PDPy11
     */
    ensurePdpy11Worker() {
      if (!this.pdpy11Worker) {
        try {
          this.pdpy11Worker = new Worker('js/pdpy11-worker.js');
          this.pdpy11Worker.onmessage = (e) => {
            const data = e.data;
            if (data.type === 'status' && typeof this.onStatusCallback === 'function') {
              this.onStatusCallback(data.message);
            } else if (data.id && this.pendingRequests.has(data.id)) {
              const { resolve } = this.pendingRequests.get(data.id);
              this.pendingRequests.delete(data.id);
              resolve(data);
            }
          };
          this.pdpy11Worker.onerror = (err) => {
            console.error('[CompilerBridge] Ошибка в PDPy11 Worker:', err);
            if (typeof this.onStatusCallback === 'function') {
              this.onStatusCallback('Ошибка в воркере PDPy11: ' + err.message);
            }
          };

          // Отправляем сигнал предварительной инициализации
          const zipUrl = (typeof window !== 'undefined' && window.location)
            ? new URL('wasm/pdpy11.zip', window.location.href).href
            : 'wasm/pdpy11.zip';

          this.pdpy11Worker.postMessage({
            action: 'init',
            zipUrl
          });
        } catch (err) {
          console.error('[CompilerBridge] Не удалось создать PDPy11 Worker:', err);
        }
      }
      return this.pdpy11Worker;
    }

    /**
     * Компиляция проекта через PDPy11
     */
    compileWithPdpy11(mainFileName, filesMap, options = {}) {
      return new Promise((resolve) => {
        const worker = this.ensurePdpy11Worker();
        if (!worker) {
          resolve({
            success: false,
            compiler: 'pdpy11',
            errors: [{ severity: 'Error', line: 1, column: 1, message: 'Не удалось инициализировать Web Worker PDPy11' }]
          });
          return;
        }

        const id = this.requestId++;
        this.pendingRequests.set(id, { resolve });

        const zipUrl = (typeof window !== 'undefined' && window.location)
          ? new URL('wasm/pdpy11.zip', window.location.href).href
          : 'wasm/pdpy11.zip';

        worker.postMessage({
          id,
          action: 'compile',
          mainFile: mainFileName,
          files: filesMap,
          zipUrl,
          options
        });
      });
    }

    /**
     * Парсер ошибок ассемблера MACRO-11
     */
    parseMacro11Errors(outputLines, defaultFile) {
      const errors = [];
      const errorRegex = /(?:^|\s*)(.*?):(\d+):\s*\*\*\*ERROR\s*(.+)/i;
      const genericErrorRegex = /\*\*\*ERROR\s*(.+)/i;

      for (const line of outputLines) {
        const match = line.match(errorRegex);
        if (match) {
          let file = match[1].trim();
          file = file.replace(/^\/+/, '').replace(/^.*[\\\/]/, '');
          if (!file) file = defaultFile;
          errors.push({
            file: file,
            line: parseInt(match[2], 10),
            column: 1,
            message: match[3].trim(),
            severity: 'Error'
          });
        } else {
          const genMatch = line.match(genericErrorRegex);
          if (genMatch) {
            errors.push({
              file: defaultFile,
              line: 1,
              column: 1,
              message: genMatch[1].trim(),
              severity: 'Error'
            });
          }
        }
      }
      return errors;
    }

    /**
     * Парсер ошибок компоновщика pclink11
     */
    parsePclink11Errors(outputLines, defaultFile) {
      const errors = [];
      const errPattern = /ERROR:\s*(.+)/i;
      const unresPattern = /Undefined symbol:\s*(\w+)/i;

      for (const line of outputLines) {
        const m = line.match(errPattern);
        if (m) {
          errors.push({
            file: defaultFile,
            line: 1,
            column: 1,
            message: 'Ошибка компоновщика: ' + m[1].trim(),
            severity: 'Error'
          });
        }
      }
      return errors;
    }

    /**
     * Компиляция проекта через двухстадийный пайплайн MACRO-11 + pclink11 (WASM)
     */
    async compileWithMacro11(mainFileName, filesMap, options = {}) {
      const startTime = performance.now();
      const logs = [];
      const onLog = (msg, type = 'info') => {
        logs.push({ message: msg, type });
        if (typeof options.onLog === 'function') {
          options.onLog(msg, type);
        }
      };

      try {
        if (typeof createMacro11Module !== 'function') {
          throw new Error('Модуль createMacro11Module не найден. Убедитесь, что wasm/macro11.js подключен.');
        }
        if (typeof createPclink11Module !== 'function') {
          throw new Error('Модуль createPclink11Module не найден. Убедитесь, что wasm/pclink11.js подключен.');
        }

        onLog('[MACRO-11] Инициализация классического макроассемблера MACRO-11 (DEC)...', 'info');
        const m11Stdout = [];
        const m11Stderr = [];

        const m11 = await createMacro11Module({
          locateFile: (path) => path.endsWith('.wasm') ? 'wasm/' + path : path,
          print: (text) => m11Stdout.push(text),
          printErr: (text) => m11Stderr.push(text)
        });

        // Записываем все файлы проекта в виртуальную FS Emscripten
        for (const [name, content] of Object.entries(filesMap)) {
          m11.FS.writeFile('/' + name, content);
        }

        const baseName = mainFileName.replace(/\.[^/.]+$/, '');
        const objFileName = baseName + '.obj';
        const lstFileName = baseName + '.lst';
        const binFileName = baseName + '.bin';
        const mapFileName = baseName + '.map';

        // Удаляем старые артефакты в FS перед новой сборкой
        if (m11.FS.analyzePath('/' + objFileName).exists) {
          m11.FS.unlink('/' + objFileName);
        }
        if (m11.FS.analyzePath('/' + lstFileName).exists) {
          m11.FS.unlink('/' + lstFileName);
        }

        // Формируем аргументы macro11:
        // -rt11: формат объектных модулей RT-11 (необходим для pclink11)
        // -yus: поддержка символа подчеркивания '_' в именах
        // -ysl 32: поддержка длинных идентификаторов до 32 символов
        // -se: отображать исходную строку при ошибке
        const m11Args = ['-rt11', '-yus', '-ysl', '32', '-se', '/' + mainFileName, '-o', '/' + objFileName, '-l', '/' + lstFileName];
        onLog(`[MACRO-11] Ассемблирование: macro11 ${m11Args.join(' ')}`, 'info');

        const m11ExitCode = m11.callMain(m11Args);
        const m11AllOut = m11Stdout.concat(m11Stderr);
        m11AllOut.forEach(l => onLog(`[MACRO-11] ${l}`, 'info'));

        const m11Errors = this.parseMacro11Errors(m11AllOut, mainFileName);

        if (m11ExitCode !== 0 || m11Errors.length > 0 || !m11.FS.analyzePath('/' + objFileName).exists) {
          onLog(`[MACRO-11] Ошибка ассемблирования (код ${m11ExitCode})`, 'error');
          return {
            success: false,
            compiler: 'macro11',
            errors: m11Errors.length > 0 ? m11Errors : [{ file: mainFileName, line: 1, column: 1, message: 'Ошибка ассемблирования MACRO-11', severity: 'Error' }],
            logLines: logs
          };
        }

        const objData = m11.FS.readFile('/' + objFileName);
        let lstText = '';
        if (m11.FS.analyzePath('/' + lstFileName).exists) {
          lstText = m11.FS.readFile('/' + lstFileName, { encoding: 'utf8' });
        }

        onLog(`[MACRO-11] Ассемблирование завершено успешно. Сформирован объектный модуль ${objFileName} (${objData.length} байт).`, 'success');

        // Шаг 2: Компоновка через pclink11
        onLog('[pclink11] Инициализация компоновщика pclink11...', 'info');
        const linkStdout = [];
        const linkStderr = [];

        const link11 = await createPclink11Module({
          locateFile: (path) => path.endsWith('.wasm') ? 'wasm/' + path : path,
          print: (text) => linkStdout.push(text),
          printErr: (text) => linkStderr.push(text)
        });

        // Записываем полученный объектный файл в виртуальную FS линковщика
        link11.FS.writeFile('/' + objFileName, objData);

        // Формируем аргументы компоновщика pclink11:
        // -MAP: генерация карты памяти
        // -EXECUTE:/<file>.bin: имя выходного бинарного файла для БК
        const linkArgs = ['-MAP', '-EXECUTE:/' + binFileName, '/' + objFileName];
        if (options.startAddress) {
          const cleanAddr = String(options.startAddress).replace(/^0o|^0/, '');
          if (cleanAddr) {
            linkArgs.push('-B:' + cleanAddr);
          }
        }

        onLog(`[pclink11] Компоновка: pclink11 ${linkArgs.join(' ')}`, 'info');
        const linkExitCode = link11.callMain(linkArgs);
        const linkAllOut = linkStdout.concat(linkStderr);
        linkAllOut.forEach(l => onLog(`[pclink11] ${l}`, 'info'));

        const linkErrors = this.parsePclink11Errors(linkAllOut, mainFileName);

        if (linkExitCode !== 0 || !link11.FS.analyzePath('/' + binFileName).exists) {
          onLog(`[pclink11] Ошибка компоновщика (код ${linkExitCode})`, 'error');
          return {
            success: false,
            compiler: 'macro11',
            errors: linkErrors.length > 0 ? linkErrors : [{ file: mainFileName, line: 1, column: 1, message: 'Ошибка компоновки pclink11', severity: 'Error' }],
            listingData: lstText,
            listingFileName: lstFileName,
            objData: objData,
            objFileName: objFileName,
            logLines: logs
          };
        }

        const binData = link11.FS.readFile('/' + binFileName);

        let mapText = '';
        const rootEntries = link11.FS.readdir('/');
        const foundMapName = rootEntries.find(f => f.toLowerCase() === mapFileName.toLowerCase() || f.toLowerCase() === (baseName + '.map').toLowerCase());
        if (foundMapName) {
          mapText = link11.FS.readFile('/' + foundMapName, { encoding: 'utf8' });
        }

        let loadAddress = null;
        if (binData.length >= 4) {
          loadAddress = binData[0] | (binData[1] << 8);
        }

        const durationMs = Math.round(performance.now() - startTime);
        const addrOct = loadAddress !== null ? '0' + loadAddress.toString(8) : 'N/A';
        onLog(`[MACRO-11] Пайплайн завершен успешно за ${durationMs} мс! Выходной файл: ${binFileName} (${binData.length} байт, адрес ${addrOct})`, 'success');

        const artifacts = {};
        artifacts[binFileName] = binData;
        artifacts[objFileName] = objData;
        if (lstText) artifacts[lstFileName] = lstText;
        if (mapText) artifacts[mapFileName] = mapText;

        return {
          success: true,
          compiler: 'macro11',
          binData: binData,
          binFileName: binFileName,
          loadAddress: loadAddress,
          programLength: binData.length >= 4 ? (binData[2] | (binData[3] << 8)) : binData.length,
          listingData: lstText,
          listingFileName: lstFileName,
          mapData: mapText,
          mapFileName: mapFileName,
          objData: objData,
          objFileName: objFileName,
          artifacts: artifacts,
          durationMs: durationMs,
          logLines: logs,
          errors: []
        };
      } catch (err) {
        onLog(`[MACRO-11] Исключение при сборке: ${err.message}`, 'error');
        return {
          success: false,
          compiler: 'macro11',
          errors: [{ file: mainFileName, line: 1, column: 1, message: err.message, severity: 'Error' }],
          logLines: logs
        };
      }
    }
  }

  global.compilerBridge = new CompilerBridgeManager();

})(typeof window !== 'undefined' ? window : this);
