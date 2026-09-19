/**
 * BKStudio - Unified Compiler Bridge (BKTurbo8 WASM + PDPy11 Pyodide WASM)
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
     * Получить имя активного компилятора ('bkturbo8' | 'pdpy11')
     */
    getCompiler() {
      return this.activeCompiler;
    }

    /**
     * Установить активный компилятор
     */
    setCompiler(name) {
      if (name !== 'bkturbo8' && name !== 'pdpy11') {
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
  }

  global.compilerBridge = new CompilerBridgeManager();

})(typeof window !== 'undefined' ? window : this);
