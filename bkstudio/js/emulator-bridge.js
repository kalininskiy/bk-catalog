/**
 * BKStudio - Emulator Bridge
 * 
 * Controls the embedded BK Web Emulator iframe via postMessage
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class BKEmulatorBridge {
    constructor(iframeId) {
      this.iframeId = iframeId;
      this.iframe = null;
      this.isReady = false;
      this._debugSeq = 0;
      this._debugPending = new Map();
      this._breakCallbacks = new Set();
      this._debugListener = (event) => this._onDebugResponse(event);
      window.addEventListener('message', this._debugListener);
    }

    /**
     * Подписка на событие срабатывания точки останова
     * @param {function(number): void} callback 
     * @returns {function(): void} Функция отписки
     */
    onBreak(callback) {
      this._breakCallbacks.add(callback);
      return () => this._breakCallbacks.delete(callback);
    }

    /**
     * Обработчик ответов эмулятора на DEBUG_CALL и DEBUG_BREAK
     * @param {MessageEvent} event 
     */
    _onDebugResponse(event) {
      if (!event.data) return;

      if (event.data.type === 'DEBUG_BREAK') {
        const pc = event.data.pc;
        for (const cb of this._breakCallbacks) {
          try { cb(pc); } catch (err) { console.error('[EmulatorBridge] Error in break callback:', err); }
        }
        return;
      }

      if (event.data.type !== 'DEBUG_RESPONSE') return;
      const pending = this._debugPending.get(event.data.id);
      if (!pending) return;
      this._debugPending.delete(event.data.id);
      clearTimeout(pending.timer);
      if (event.data.ok) {
        pending.resolve(event.data.result);
      } else {
        pending.reject(new Error(event.data.error || 'Ошибка эмулятора'));
      }
    }

    getIframe() {
      if (!this.iframe) {
        this.iframe = document.getElementById(this.iframeId);
      }
      return this.iframe;
    }

    /**
     * Отправить бинарный файл в эмулятор для немедленного запуска
     * @param {string} filename 
     * @param {Uint8Array} data 
     * @param {string} platform 'БК0010' | 'БК0011М'
     */
    runBinary(filename, data, platform = 'БК0010') {
      const iframe = this.getIframe();
      if (!iframe || !iframe.contentWindow) {
        console.warn('[BKStudio] Iframe эмулятора не найден');
        return false;
      }

      // Передаем массив байтов и целевую платформу
      const arrayData = Array.from(data);
      iframe.contentWindow.postMessage({
        type: 'LOAD_BIN',
        filename: filename || 'program.bin',
        platform: platform,
        data: arrayData
      }, '*');

      console.log(`[BKStudio] Бинарный файл ${filename} (${data.length} байт, платформа ${platform}) отправлен в эмулятор.`);
      return true;
    }

    /**
     * Установить конфигурацию загрузки (B10, B11, etc.)
     * @param {string} bootCode 'B10' | 'B11'
     */
    setBoot(bootCode) {
      const iframe = this.getIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'SET_BOOT',
          boot: bootCode
        }, '*');
      }
    }

    /**
     * Установить текущую платформу ('БК0010' или 'БК0011М')
     * @param {string} platformStr
     */
    setPlatform(platformStr) {
      const iframe = this.getIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'SET_PLATFORM',
          platform: platformStr
        }, '*');
      }
    }

    /**
     * Передать тему оформления в эмулятор
     * @param {string} themeKey
     */
    setTheme(themeKey) {
      const iframe = this.getIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'SET_THEME',
          theme: themeKey
        }, '*');
      }
    }

    /**
     * Сброс / перезапуск виртуальной БК
     */
    reset() {
      const iframe = this.getIframe();
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'RESET'
        }, '*');
      }
    }

    /**
     * Перезагрузить страницу эмулятора во фрейме
     */
    reload() {
      const iframe = this.getIframe();
      if (iframe) {
        iframe.src = iframe.src;
      }
    }

    /**
     * Вызвать отладочную функцию эмулятора (JSON-RPC через postMessage)
     *
     * Примеры методов:
     *   debug('getRegisters')
     *   debug('readMemory', 0o100000, 16)
     *   debug('writeMemory', 0o100000, [0x1234, 0x5678])
     *   debug('disassemble', 0o100360, 32)
     *   debug('step'), debug('continue'), debug('pause')
     *   debug('reset'), debug('resetAndClear')
     *   debug('setBreakpoint', 0o100360), debug('clearBreakpoint', 0o100360)
     *   debug('getScreenShot')
     *   debug('Stack'), debug('getPC'), debug('getSP'), debug('getStatus')
     *
     * @param {string} method - имя метода emulatorDebug
     * @param {...*} params - позиционные аргументы метода
     * @returns {Promise<any>} JSON-результат вызова
     */
    debug(method, ...params) {
      const iframe = this.getIframe();
      if (!iframe || !iframe.contentWindow) {
        return Promise.reject(new Error('Iframe эмулятора не найден'));
      }
      const id = ++this._debugSeq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._debugPending.delete(id);
          reject(new Error('Таймаут ожидания ответа эмулятора (' + method + ')'));
        }, 5000);
        this._debugPending.set(id, { resolve, reject, timer });
        iframe.contentWindow.postMessage({
          type: 'DEBUG_CALL',
          id: id,
          method: method,
          params: params
        }, '*');
      });
    }
  }

  global.BKEmulatorBridge = BKEmulatorBridge;

})(typeof window !== 'undefined' ? window : this);
