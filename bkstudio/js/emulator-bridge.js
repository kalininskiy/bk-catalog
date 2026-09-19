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
  }

  global.BKEmulatorBridge = BKEmulatorBridge;

})(typeof window !== 'undefined' ? window : this);
