/**
 * BKStudio - Прямой HTTP-клиент для сетевого адаптера Gryphon-MPI
 *
 * Обеспечивает прямое взаимодействие браузерной среды BKStudio с аппаратным
 * сетевым контроллером Gryphon-MPI (установленным на реальном компьютере
 * Электроника БК-0010 / БК-0011М) по официальному HTTP REST API:
 *   - https://night-gryphon.ru/Gryphon-MPI/api.php
 *
 * Архитектура:
 *   BKStudio (браузер) ─── HTTP REST API ───► Gryphon-MPI ───► Реальный БК
 *   (BKStudio Bridge больше не является посредником для работы с Gryphon)
 *
 * Поддерживаемые операции:
 *   - GET  /api/version      — проверка версии прошивки и доступности адаптера
 *   - GET  /api/bkinfo       — информация о модели подключенного БК
 *   - GET  /api/status       — текущее состояние контроллера
 *   - POST /api/upload       — загрузка .BIN файла в память контроллера (/BK_Uploads/)
 *   - GET  /api/run          — немедленный запуск загруженного .BIN на реальном БК
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class BKStudioGryphonClient {
    /**
     * Создает экземпляр клиента Gryphon-MPI
     */
    constructor() {
      this.enabled = false;
      this.host = '192.168.0.92';
      this._loadSettings();
    }

    /**
     * Загружает настройки из URL-параметра ?GMPI=... или из localStorage
     * @private
     */
    _loadSettings() {
      // 1. Проверяем URL-параметр ?GMPI=... (наивысший приоритет)
      try {
        if (typeof window !== 'undefined' && window.location) {
          const params = new URLSearchParams(window.location.search);
          const gmpiParam = params.get('GMPI') || params.get('gmpi');
          if (gmpiParam && gmpiParam.trim()) {
            this.enabled = true;
            this.host = this._sanitizeHost(gmpiParam);
            this._saveSettings();
            return;
          }
        }
      } catch (e) {
        // Игнорируем ошибки парсинга URL
      }

      // 2. Проверяем localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          const savedEnabled = localStorage.getItem('bkstudio_gryphon_enabled');
          if (savedEnabled !== null) {
            this.enabled = (savedEnabled === 'true');
          }
          const savedHost = localStorage.getItem('bkstudio_gryphon_host');
          if (savedHost && savedHost.trim()) {
            this.host = this._sanitizeHost(savedHost);
          }
        }
      } catch (e) {
        // Игнорируем ошибки доступа к localStorage
      }
    }

    /**
     * Сохраняет настройки в localStorage
     * @private
     */
    _saveSettings() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bkstudio_gryphon_enabled', String(this.enabled));
          localStorage.setItem('bkstudio_gryphon_host', this.host);
        }
      } catch (e) {
        // Игнорируем ошибки квоты или доступа к localStorage
      }
    }

    /**
     * Очищает IP-адрес или хост от схемы протокола и лишних слэшей
     * @param {string} host
     * @returns {string}
     * @private
     */
    _sanitizeHost(host) {
      if (!host || typeof host !== 'string') return '192.168.0.92';
      let h = host.trim();
      h = h.replace(/^https?:\/\//i, '');
      h = h.replace(/\/api\/?$/i, '');
      h = h.replace(/\/+$/, '');
      return h || '192.168.0.92';
    }

    /**
     * Нормализует имя файла для безопасной отправки на контроллер
     * @param {string} fileName
     * @returns {string}
     * @private
     */
    _sanitizeFileName(fileName) {
      if (!fileName || typeof fileName !== 'string') return 'PROGRAM.BIN';
      // Убираем любые префиксы путей (\ или /)
      let name = fileName.replace(/^.*[\\\/]/, '').trim();
      // Оставляем только безопасные символы для файловой системы
      name = name.replace(/[^a-zA-Z0-9._\-]/g, '_');
      if (!name.toUpperCase().endsWith('.BIN')) {
        name += '.BIN';
      }
      return name || 'PROGRAM.BIN';
    }

    /**
     * Проверяет, включена ли отправка на реальный БК
     * @returns {boolean}
     */
    isEnabled() {
      return this.enabled;
    }

    /**
     * Включает или выключает режим запуска на реальном БК
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      this._saveSettings();
    }

    /**
     * Возвращает текущий IP-адрес или хост Gryphon-MPI
     * @returns {string}
     */
    getHost() {
      return this.host;
    }

    /**
     * Устанавливает IP-адрес или хост Gryphon-MPI
     * @param {string} host
     */
    setHost(host) {
      if (host && typeof host === 'string' && host.trim()) {
        this.host = this._sanitizeHost(host);
        this._saveSettings();
      }
    }

    /**
     * Возвращает базовый URL API Gryphon-MPI
     * @param {string} [host] - опциональный хост (по умолчанию текущий)
     * @returns {string} например "http://192.168.0.92/api"
     */
    getBaseUrl(host = this.host) {
      const cleanHost = this._sanitizeHost(host);
      return `http://${cleanHost}/api`;
    }

    /**
     * Выполняет HTTP-запрос через fetch с поддержкой тайм-аута через AbortController
     * и развернутой диагностикой сетевых и браузерных ошибок (CORS, Mixed Content).
     *
     * @param {string} url
     * @param {Object} [fetchOptions={}]
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<Response>}
     * @private
     */
    async _fetchWithTimeout(url, fetchOptions = {}, timeoutMs = 5000) {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const signal = controller ? controller.signal : undefined;
      let timer = null;

      if (controller) {
        timer = setTimeout(() => {
          try { controller.abort(); } catch (e) {}
        }, timeoutMs);
      }

      try {
        const res = await fetch(url, {
          ...fetchOptions,
          signal: signal
        });
        if (timer) clearTimeout(timer);
        return res;
      } catch (err) {
        if (timer) clearTimeout(timer);

        if (controller && controller.signal && controller.signal.aborted) {
          throw new Error(`Gryphon-MPI: timeout (${timeoutMs} мс)`);
        }

        // Диагностика Mixed Content (HTTPS -> HTTP)
        if (typeof window !== 'undefined' && window.location) {
          if (window.location.protocol === 'https:' && url.startsWith('http:')) {
            throw new Error(
              'Gryphon-MPI: Запрос заблокирован браузером (Mixed Content). ' +
              'BKStudio открыт по протоколу HTTPS, а контроллер доступен по незащищенному HTTP. ' +
              'Откройте BKStudio по HTTP (например, в локальной сети) для прямого доступа к контроллеру.'
            );
          }
        }

        // Диагностика CORS / недоступности сервера
        const msg = (err && err.message) ? err.message : String(err);
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
          throw new Error(
            'Gryphon-MPI недоступен из браузера. ' +
            'Возможно, контроллер выключен, IP-адрес указан неверно или контроллер не разрешает CORS-запросы.'
          );
        }

        throw err;
      }
    }

    /**
     * Проверяет доступность контроллера Gryphon-MPI по HTTP API
     *
     * @param {number} [timeoutMs=5000] - тайм-аут запроса в мс
     * @param {Object} [options={}]
     * @param {string} [options.host] - альтернативный IP-адрес для проверки
     * @returns {Promise<{ok: boolean, available: boolean, host: string, version?: any, bkinfo?: any, status?: string, model?: string, error?: string}>}
     */
    async check(timeoutMs = 5000, options = {}) {
      const host = options.host || this.host;
      const baseUrl = this.getBaseUrl(host);
      const cleanHost = this._sanitizeHost(host);

      try {
        // 1. Обязательный запрос к /api/version
        const verRes = await this._fetchWithTimeout(`${baseUrl}/version`, { method: 'GET' }, timeoutMs);
        if (!verRes.ok) {
          throw new Error(`Gryphon-MPI ответил с ошибкой HTTP ${verRes.status} (${verRes.statusText})`);
        }

        let versionData = null;
        try {
          versionData = await verRes.json();
        } catch (e) {
          throw new Error('Некорректный JSON-ответ от Gryphon-MPI (/api/version)');
        }

        // 2. Вторичные информационные запросы (не блокируют успех проверки)
        let bkinfoData = null;
        let statusData = null;
        try {
          const bkRes = await this._fetchWithTimeout(`${baseUrl}/bkinfo`, { method: 'GET' }, Math.min(timeoutMs, 2000));
          if (bkRes.ok) {
            bkinfoData = await bkRes.json();
          }
        } catch (e) {}

        try {
          const stRes = await this._fetchWithTimeout(`${baseUrl}/status`, { method: 'GET' }, Math.min(timeoutMs, 2000));
          if (stRes.ok) {
            const stText = await stRes.text();
            try { statusData = JSON.parse(stText); } catch (e) { statusData = stText.trim(); }
          }
        } catch (e) {}

        let model = 'БК-0010 / БК-0011М';
        if (bkinfoData && typeof bkinfoData === 'object') {
          model = bkinfoData.model || bkinfoData.bk_model || bkinfoData.name || model;
        }

        let statusStr = 'ACTIVE';
        if (statusData) {
          if (typeof statusData === 'string') statusStr = statusData;
          else if (statusData.status) statusStr = statusData.status;
        }

        return {
          ok: true,
          available: true,
          host: cleanHost,
          version: versionData,
          bkinfo: bkinfoData,
          status: statusStr,
          model: model
        };
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        return {
          ok: false,
          available: false,
          host: cleanHost,
          error: errMsg
        };
      }
    }

    /**
     * Загружает бинарный файл .BIN в память Gryphon-MPI через multipart/form-data
     *
     * @param {string} fileName - имя файла (например "GAME.BIN")
     * @param {Uint8Array|ArrayBuffer|Blob|Array<number>} data - бинарные данные
     * @param {Object} [options={}]
     * @param {string} [options.host] - IP-адрес Gryphon-MPI
     * @param {number} [options.timeoutMs=15000] - тайм-аут загрузки
     * @returns {Promise<{ok: boolean, success: boolean, host: string, fileName: string, storeas: string, size: number, result?: any, error?: string}>}
     */
    async upload(fileName, data, options = {}) {
      const host = options.host || this.host;
      const timeoutMs = options.timeoutMs || 15000;
      const cleanHost = this._sanitizeHost(host);
      const cleanName = this._sanitizeFileName(fileName);
      const baseUrl = this.getBaseUrl(host);
      const storeAsPath = `/BK_Uploads/${cleanName}`;

      let blob;
      let size = 0;

      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        blob = data;
        size = data.size;
      } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        blob = new Blob([data], { type: 'application/octet-stream' });
        size = blob.size;
      } else if (Array.isArray(data)) {
        blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
        size = blob.size;
      } else {
        return {
          ok: false,
          success: false,
          host: cleanHost,
          fileName: cleanName,
          storeas: storeAsPath,
          size: 0,
          error: 'Бинарные данные файла отсутствуют или имеют неподдерживаемый формат'
        };
      }

      if (size === 0) {
        return {
          ok: false,
          success: false,
          host: cleanHost,
          fileName: cleanName,
          storeas: storeAsPath,
          size: 0,
          error: 'Размер бинарных данных равен 0 байт'
        };
      }

      const formData = new FormData();
      formData.append('storeas', storeAsPath);
      formData.append('size', String(size));
      formData.append('file', blob, cleanName);

      try {
        const res = await this._fetchWithTimeout(`${baseUrl}/upload`, {
          method: 'POST',
          body: formData
        }, timeoutMs);

        if (!res.ok) {
          throw new Error(`Ошибка загрузки на Gryphon-MPI: HTTP ${res.status} (${res.statusText})`);
        }

        let resultJson = null;
        const text = await res.text();
        try {
          resultJson = JSON.parse(text);
        } catch (e) {
          resultJson = { raw: text };
        }

        return {
          ok: true,
          success: true,
          host: cleanHost,
          fileName: cleanName,
          storeas: storeAsPath,
          size: size,
          result: resultJson
        };
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        return {
          ok: false,
          success: false,
          host: cleanHost,
          fileName: cleanName,
          storeas: storeAsPath,
          size: size,
          error: errMsg
        };
      }
    }

    /**
     * Запускает ранее загруженный файл .BIN на реальном БК через GET /api/run
     *
     * @param {string} fileName - имя файла в /BK_Uploads/ (например "GAME.BIN")
     * @param {Object} [options={}]
     * @param {string} [options.host] - IP-адрес Gryphon-MPI
     * @param {string} [options.emu10='no'] - флаг эмуляции БК-0010 ('no' | 'yes')
     * @param {string} [options.dev='file'] - устройство запуска
     * @param {number} [options.timeoutMs=10000] - тайм-аут запроса
     * @returns {Promise<{ok: boolean, success: boolean, host: string, fileName: string, fname: string, result?: any, error?: string}>}
     */
    async run(fileName, options = {}) {
      const host = options.host || this.host;
      const timeoutMs = options.timeoutMs || 10000;
      const cleanHost = this._sanitizeHost(host);
      const cleanName = this._sanitizeFileName(fileName);
      const baseUrl = this.getBaseUrl(host);
      const fname = `/BK_Uploads/${cleanName}`;
      const emu10 = options.emu10 || 'no';
      const dev = options.dev || 'file';

      const queryParams = new URLSearchParams({
        dev: dev,
        emu10: emu10,
        fname: fname
      });

      try {
        const res = await this._fetchWithTimeout(`${baseUrl}/run?${queryParams.toString()}`, {
          method: 'GET'
        }, timeoutMs);

        if (!res.ok) {
          throw new Error(`Ошибка запуска на Gryphon-MPI: HTTP ${res.status} (${res.statusText})`);
        }

        let resultJson = null;
        const text = await res.text();
        try {
          resultJson = JSON.parse(text);
        } catch (e) {
          resultJson = { raw: text };
        }

        return {
          ok: true,
          success: true,
          host: cleanHost,
          fileName: cleanName,
          fname: fname,
          result: resultJson
        };
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        return {
          ok: false,
          success: false,
          host: cleanHost,
          fileName: cleanName,
          fname: fname,
          error: errMsg
        };
      }
    }

    /**
     * Полный цикл: загрузка (.BIN) и немедленный запуск на реальном БК (upload -> run)
     *
     * @param {string} fileName - имя файла
     * @param {Uint8Array|ArrayBuffer|Blob|Array<number>} data - бинарные данные
     * @param {Object} [options={}]
     * @param {string} [options.host] - IP-адрес Gryphon-MPI
     * @param {string} [options.emu10='no'] - эмуляция БК-0010
     * @param {number} [options.timeoutMs]
     * @returns {Promise<{ok: boolean, success: boolean, host: string, fileName: string, upload: Object, run?: Object, error?: string}>}
     */
    async deploy(fileName, data, options = {}) {
      const cleanName = this._sanitizeFileName(fileName);
      const host = options.host || this.host;
      const cleanHost = this._sanitizeHost(host);

      // Шаг 1: Загрузка
      const uploadRes = await this.upload(cleanName, data, options);
      if (!uploadRes.ok) {
        return {
          ok: false,
          success: false,
          host: cleanHost,
          fileName: cleanName,
          upload: uploadRes,
          error: uploadRes.error || 'Ошибка загрузки файла на Gryphon-MPI'
        };
      }

      // Шаг 2: Запуск
      const runRes = await this.run(cleanName, options);
      return {
        ok: runRes.ok,
        success: runRes.ok,
        host: cleanHost,
        fileName: cleanName,
        upload: uploadRes,
        run: runRes,
        error: runRes.ok ? undefined : (runRes.error || 'Ошибка запуска программы на Gryphon-MPI')
      };
    }
  }

  // Экспорт в глобальную область
  global.BKStudioGryphonClient = BKStudioGryphonClient;
  global.bkGryphonClient = new BKStudioGryphonClient();

})(typeof window !== 'undefined' ? window : this);
