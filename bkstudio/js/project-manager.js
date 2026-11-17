/**
 * BKStudio - Project & File Manager с поддержкой IndexedDB,
 * защитой квоты localStorage, разделением исходников и артефактов и debounce-сохранением.
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'bkstudio_project_data';
  const MIGRATED_FLAG_KEY = 'bkstudio_idb_migrated';
  const DB_NAME = 'bkstudio_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'project_store';
  const RECORD_KEY = 'current_project';

  /**
   * Быстрое преобразование Uint8Array в Base64 чанками без переполнения стека вызовов
   * @param {Uint8Array|ArrayBufferView} bytes 
   * @returns {string}
   */
  function uint8ToBase64(bytes) {
    if (!bytes || bytes.byteLength === 0) return '';
    const CHUNK_SIZE = 0x8000; // 32 КБ
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let binary = '';
    for (let i = 0; i < view.length; i += CHUNK_SIZE) {
      const chunk = view.subarray(i, i + CHUNK_SIZE);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  /**
   * Преобразование Base64 в Uint8Array
   * @param {string} b64 
   * @returns {Uint8Array}
   */
  function base64ToUint8(b64) {
    if (!b64) return new Uint8Array(0);
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Адаптер хранения проектов: IndexedDB как основное хранилище (без лимита 5 МБ)
   * с надежным отказоустойчивым fallback на localStorage.
   */
  class BKProjectStorage {
    constructor(options = {}) {
      this.dbName = options.dbName || DB_NAME;
      this.storeName = options.storeName || STORE_NAME;
      this.version = options.version || DB_VERSION;
      this.localStorageKey = options.localStorageKey || STORAGE_KEY;
      this.db = null;
      this.isIDBSupported = typeof indexedDB !== 'undefined' && indexedDB !== null;
      this.isIDBReady = false;
      this._initPromise = null;
      this.lastStorageType = 'memory';
      this.lastSaveError = null;
      this.lastSavedAt = 0;
    }

    /**
     * Инициализация IndexedDB
     * @returns {Promise<boolean>}
     */
    async init() {
      if (!this.isIDBSupported) {
        return false;
      }
      if (this._initPromise) {
        return this._initPromise;
      }

      this._initPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(this.dbName, this.version);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              db.createObjectStore(this.storeName, { keyPath: 'id' });
            }
          };
          req.onsuccess = (e) => {
            this.db = e.target.result;
            this.isIDBReady = true;
            this.lastStorageType = 'indexeddb';
            resolve(true);
          };
          req.onerror = (e) => {
            console.warn('[BKStorage] IndexedDB недоступна или произошла ошибка:', e.target && e.target.error);
            this.isIDBReady = false;
            resolve(false);
          };
          req.onblocked = () => {
            console.warn('[BKStorage] Открытие IndexedDB заблокировано другой вкладкой');
            resolve(false);
          };
        } catch (err) {
          console.warn('[BKStorage] Исключение при открытии IndexedDB:', err);
          this.isIDBReady = false;
          resolve(false);
        }
      });

      return this._initPromise;
    }

    /**
     * Загрузка проекта из IndexedDB
     * @returns {Promise<Object|null>}
     */
    async loadFromIndexedDB() {
      if (!this.isIDBReady && !(await this.init())) {
        return null;
      }
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.get(RECORD_KEY);
          req.onsuccess = () => {
            const record = req.result;
            if (record && record.files && Object.keys(record.files).length > 0) {
              resolve(record);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => {
            resolve(null);
          };
        } catch (e) {
          console.warn('[BKStorage] Ошибка чтения из IndexedDB:', e);
          resolve(null);
        }
      });
    }

    /**
     * Сохранение проекта в IndexedDB (нативно поддерживает Uint8Array без Base64)
     * @param {Object} data 
     * @returns {Promise<boolean>}
     */
    async saveToIndexedDB(data) {
      if (!this.isIDBReady && !(await this.init())) {
        throw new Error('IndexedDB не инициализирована');
      }
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const record = Object.assign({ id: RECORD_KEY }, data);
          const req = store.put(record);
          req.onsuccess = () => resolve(true);
          req.onerror = (e) => reject(e.target.error || new Error('Ошибка записи в IndexedDB'));
          tx.onabort = (e) => reject(new Error('Транзакция IndexedDB прервана'));
        } catch (e) {
          reject(e);
        }
      });
    }

    /**
     * Синхронное чтение из localStorage (для немедленного старта при загрузке страницы)
     * @returns {Object|null}
     */
    loadFromLocalStorage() {
      try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(this.localStorageKey);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data && data.files && Object.keys(data.files).length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('[BKStorage] Не удалось прочитать из localStorage:', e);
      }
      return null;
    }

    /**
     * Сохранение в localStorage с защитой квоты и фильтрацией тяжелых артефактов
     * @param {Object} data 
     * @param {Object} options 
     * @returns {{ success: boolean, emergency?: boolean, error?: string }}
     */
    saveToLocalStorage(data, options = {}) {
      if (typeof localStorage === 'undefined') {
        return { success: false, error: 'localStorage не поддерживается' };
      }
      try {
        const safeFiles = {};
        const artifactsSet = options.artifacts || new Set();

        for (const [name, content] of Object.entries(data.files || {})) {
          const lower = name.toLowerCase();
          const isHeavyArtifact = artifactsSet.has(name) &&
            (lower.endsWith('.lst') || lower.endsWith('.map') || lower.endsWith('.obj'));

          // Пропускаем тяжелые диагностические файлы при записи в 5 МБ localStorage
          if (isHeavyArtifact && !options.includeHeavyArtifacts) {
            continue;
          }

          if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
            // Если бинарный файл больше 64 КБ, не забиваем им localStorage
            if (content.byteLength > 65536 && !options.includeLargeBinaries) {
              continue;
            }
            safeFiles[name] = {
              __binary: true,
              data: uint8ToBase64(content)
            };
          } else if (content && typeof content === 'object' && content.__binary) {
            safeFiles[name] = content;
          } else if (typeof content === 'string') {
            safeFiles[name] = content;
          }
        }

        const payload = {
          files: safeFiles,
          activeFileName: data.activeFileName,
          openTabs: data.openTabs,
          settings: data.settings,
          savedAt: data.savedAt || Date.now(),
          version: 2
        };

        localStorage.setItem(this.localStorageKey, JSON.stringify(payload));
        return { success: true };
      } catch (e) {
        // Защита от переполнения квоты (QuotaExceededError)
        const isQuotaErr = e && (
          e.name === 'QuotaExceededError' ||
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
          e.code === 22 ||
          e.code === 1014 ||
          (e.message && e.message.toLowerCase().includes('quota'))
        );

        if (isQuotaErr) {
          console.warn('[BKStorage] Превышена квота localStorage, пробуем аварийное сохранение только исходников...');
          try {
            const emergencyFiles = {};
            for (const [name, content] of Object.entries(data.files || {})) {
              const lower = name.toLowerCase();
              if (typeof content === 'string' && !lower.endsWith('.lst') && !lower.endsWith('.map')) {
                emergencyFiles[name] = content;
              }
            }
            const emergencyPayload = {
              files: emergencyFiles,
              activeFileName: data.activeFileName,
              openTabs: data.openTabs,
              settings: data.settings,
              savedAt: Date.now(),
              emergency: true
            };
            localStorage.setItem(this.localStorageKey, JSON.stringify(emergencyPayload));
            return { success: true, emergency: true };
          } catch (emergencyErr) {
            console.error('[BKStorage] Критическое переполнение localStorage:', emergencyErr);
            return { success: false, error: emergencyErr.message || 'QuotaExceededError' };
          }
        }
        return { success: false, error: e.message };
      }
    }
  }

  /**
   * Основной менеджер проектов BKStudio
   */
  class BKProjectManager {
    constructor() {
      this.files = {};
      this.artifacts = new Set();
      this.activeFileName = 'main.asm';
      this.openTabs = ['main.asm'];
      this.settings = {
        platform: 'BK-0010',
        startAddress: '1000',
        format: 'bin',
        theme: 'bk-crt-green'
      };
      this.listeners = [];

      // Настройки адаптера хранилища и таймеров автосохранения
      this.storage = new BKProjectStorage();
      this._saveDebounceTimer = null;
      this._pendingSave = false;
      this._isSaving = false;

      // 1. Немедленная синхронная загрузка (из localStorage или дефолтного сэмпла)
      this.loadFromStorage();

      // 2. Асинхронная инициализация IndexedDB и фоновая миграция
      this.syncWithIndexedDB();
    }

    /**
     * Подписка на события проекта
     * @param {Function} cb 
     */
    onChange(cb) {
      this.listeners.push(cb);
    }

    /**
     * Оповещение слушателей о событии проекта
     * @param {string} event 
     * @param {*} data 
     * @param {Object} [options]
     */
    notify(event, data, options = {}) {
      for (const cb of this.listeners) {
        try {
          cb(event, data);
        } catch (e) {
          console.error(e);
        }
      }
      if (options.save !== false) {
        this.saveNow();
      }
    }

    /**
     * Первичная синхронная загрузка проекта
     */
    loadFromStorage() {
      try {
        const data = this.storage.loadFromLocalStorage();
        if (data && data.files && Object.keys(data.files).length > 0) {
          this._applyLoadedProjectData(data);
          this.storage.lastStorageType = 'localstorage';
          return;
        }
      } catch (e) {
        console.warn('[BKStudio] Не удалось восстановить проект из localStorage:', e);
      }

      // Если в хранилище пусто - загружаем первый дефолтный пример без вызова UI-уведомления
      this.loadSample('hello_bk10', false);
    }

    /**
     * Асинхронная синхронизация с IndexedDB и миграция из localStorage
     */
    async syncWithIndexedDB() {
      if (!this.storage.isIDBSupported) {
        return;
      }
      try {
        const isReady = await this.storage.init();
        if (!isReady) return;

        const idbData = await this.storage.loadFromIndexedDB();
        const lsData = this.storage.loadFromLocalStorage();

        if (idbData && idbData.files && Object.keys(idbData.files).length > 0) {
          // Если в IndexedDB есть данные и они свежее или содержат артефакты
          const idbTime = idbData.savedAt || 0;
          const lsTime = (lsData && lsData.savedAt) || 0;

          if (idbTime >= lsTime) {
            this._applyLoadedProjectData(idbData);
            this.storage.lastStorageType = 'indexeddb';
            this.notify('storage-synced', { storageType: 'indexeddb' }, { save: false });
          } else if (lsData && lsTime > idbTime) {
            // Если localStorage был обновлен вне IndexedDB, сохраняем в IndexedDB
            await this._saveToIndexedDBDirect();
          }
        } else if (lsData && lsData.files && Object.keys(lsData.files).length > 0) {
          // Первая миграция из localStorage в IndexedDB:
          // Сохраняем в IndexedDB и только после успеха ставим метку
          await this._saveToIndexedDBDirect();
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(MIGRATED_FLAG_KEY, String(Date.now()));
            }
          } catch (_) {}
          this.storage.lastStorageType = 'indexeddb';
          console.log('[BKStudio] Транзакционная миграция проекта из localStorage в IndexedDB завершена успешно.');
          this.notify('storage-synced', { storageType: 'indexeddb', migrated: true }, { save: false });
        }
      } catch (e) {
        console.warn('[BKStudio] Ошибка при синхронизации с IndexedDB:', e);
      }
    }

    /**
     * Внутреннее применение прочитанной структуры проекта к памяти
     */
    _applyLoadedProjectData(data) {
      this.files = {};
      this.artifacts.clear();

      for (const [name, val] of Object.entries(data.files || {})) {
        if (val instanceof Uint8Array) {
          this.files[name] = val;
        } else if (val && typeof val === 'object' && val.__binary && typeof val.data === 'string') {
          try {
            this.files[name] = base64ToUint8(val.data);
          } catch (e) {
            this.files[name] = val;
          }
        } else {
          this.files[name] = val;
        }
      }

      if (Array.isArray(data.artifacts)) {
        for (const art of data.artifacts) {
          this.artifacts.add(art);
        }
      }

      this.activeFileName = data.activeFileName || Object.keys(this.files)[0] || 'main.asm';
      if (Array.isArray(data.openTabs) && data.openTabs.length > 0) {
        this.openTabs = data.openTabs.filter(n => typeof this.files[n] !== 'undefined');
        if (this.openTabs.length === 0) {
          this.openTabs = [this.activeFileName];
        }
      } else {
        this.openTabs = [this.activeFileName];
      }
      this.settings = Object.assign(this.settings, data.settings || {});
      this.storage.lastSavedAt = data.savedAt || Date.now();
    }

    /**
     * Планирование отложенного сохранения (debounce) при наборе текста в редакторе
     * @param {number} delayMs 
     */
    scheduleDebouncedSave(delayMs = 500) {
      this._pendingSave = true;
      if (this._saveDebounceTimer) {
        clearTimeout(this._saveDebounceTimer);
      }
      this._saveDebounceTimer = setTimeout(() => {
        this._saveDebounceTimer = null;
        if (this._pendingSave) {
          this.saveToStorage();
        }
      }, delayMs);
    }

    /**
     * Немедленный сброс таймера и принудительное сохранение (при компиляции, экспорте, выходе)
     * @returns {Object} Результат сохранения
     */
    saveNow() {
      if (this._saveDebounceTimer) {
        clearTimeout(this._saveDebounceTimer);
        this._saveDebounceTimer = null;
      }
      return this.saveToStorage();
    }

    /**
     * Псевдоним для saveNow()
     */
    flushSave() {
      return this.saveNow();
    }

    /**
     * Прямая запись текущего состояния в IndexedDB
     */
    async _saveToIndexedDBDirect() {
      if (!this.storage.isIDBReady) return false;

      // Для IndexedDB сохраняем бинарные файлы как нативные Uint8Array без Base64
      const idbFiles = {};
      for (const [name, content] of Object.entries(this.files)) {
        if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
          const view = content instanceof Uint8Array ? content : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
          idbFiles[name] = view;
        } else {
          idbFiles[name] = content;
        }
      }

      const idbData = {
        files: idbFiles,
        artifacts: Array.from(this.artifacts),
        activeFileName: this.activeFileName,
        openTabs: this.openTabs,
        settings: this.settings,
        savedAt: Date.now(),
        version: 2
      };

      await this.storage.saveToIndexedDB(idbData);
      this.storage.lastStorageType = 'indexeddb';
      this.storage.lastSavedAt = idbData.savedAt;
      this.storage.lastSaveError = null;
      return true;
    }

    /**
     * Сохранение проекта в хранилище (IndexedDB + безопасная резервная копия в localStorage)
     * @returns {Object}
     */
    saveToStorage() {
      this._pendingSave = false;
      const now = Date.now();

      const projectData = {
        files: this.files,
        artifacts: Array.from(this.artifacts),
        activeFileName: this.activeFileName,
        openTabs: this.openTabs,
        settings: this.settings,
        savedAt: now,
        version: 2
      };

      // 1. Синхронное сохранение резервной копии в localStorage (без тяжелых .lst и .map)
      const lsResult = this.storage.saveToLocalStorage(projectData, { artifacts: this.artifacts });
      if (lsResult.success) {
        this.storage.lastSavedAt = now;
        if (this.storage.lastStorageType !== 'indexeddb') {
          this.storage.lastStorageType = 'localstorage';
        }
      }

      // 2. Асинхронное сохранение в IndexedDB
      if (this.storage.isIDBSupported) {
        this._saveToIndexedDBDirect().catch((err) => {
          console.warn('[BKStudio] Ошибка сохранения в IndexedDB:', err);
          if (!lsResult.success) {
            this.storage.lastSaveError = err.message || 'Ошибка IndexedDB';
            for (const cb of this.listeners) {
              try { cb('save-error', { error: this.storage.lastSaveError }); } catch (_) {}
            }
          }
        });
      }

      // Если localStorage дал сбой и IndexedDB недоступна
      if (!lsResult.success && !this.storage.isIDBSupported) {
        this.storage.lastSaveError = lsResult.error || 'Ошибка localStorage';
        console.warn('[BKStudio] Ошибка сохранения в localStorage:', lsResult.error);
        for (const cb of this.listeners) {
          try { cb('save-error', { error: this.storage.lastSaveError }); } catch (_) {}
        }
        return { success: false, error: this.storage.lastSaveError };
      }

      return {
        success: true,
        storageType: this.storage.isIDBReady ? 'indexeddb' : 'localstorage',
        savedAt: now
      };
    }

    /**
     * Загрузка встроенного примера кода
     */
    loadSample(sampleId, notifyUser = true) {
      const sample = (global.BK_SAMPLES || []).find(s => s.id === sampleId) || (global.BK_SAMPLES && global.BK_SAMPLES[0]);
      if (!sample) return;

      this.artifacts.clear();

      if (sample.files && typeof sample.files === 'object') {
        this.files = { ...sample.files };
        const primaryFile = sample.filename || Object.keys(this.files)[0] || 'main.c';
        this.activeFileName = primaryFile;
        if (sample.openTabs && Array.isArray(sample.openTabs)) {
          this.openTabs = [...sample.openTabs];
        } else if (Object.keys(this.files).length > 4) {
          this.openTabs = [primaryFile];
        } else {
          this.openTabs = Object.keys(this.files);
        }
      } else {
        const filename = sample.filename || 'main.asm';
        this.files = {
          [filename]: sample.code
        };
        this.activeFileName = filename;
        this.openTabs = [filename];
      }
      this.settings.platform = sample.platform || 'BK-0010';
      this.settings.startAddress = '1000';
      this.settings.format = 'bin';

      if (notifyUser) {
        this.notify('project-reset', { sample });
      } else {
        this.saveNow();
      }
    }

    /**
     * Загрузка файлов стороннего проекта (из ZIP-архива или внешнего источника)
     */
    loadProjectFiles(filesMap, activeFileName = null, settings = null, openTabs = null) {
      if (!filesMap || Object.keys(filesMap).length === 0) return;
      this.files = filesMap;
      this.artifacts.clear();

      if (activeFileName && typeof this.files[activeFileName] !== 'undefined') {
        this.activeFileName = activeFileName;
      } else {
        this.activeFileName = Object.keys(this.files)[0] || 'main.asm';
      }

      if (Array.isArray(openTabs) && openTabs.length > 0) {
        this.openTabs = openTabs.filter(name => typeof this.files[name] !== 'undefined');
        if (this.openTabs.length === 0) {
          this.openTabs = [this.activeFileName];
        }
      } else {
        this.openTabs = [this.activeFileName];
      }

      if (settings) {
        this.settings = Object.assign(this.settings, settings);
      }
      this.notify('project-reset', { files: this.files, activeFileName: this.activeFileName, openTabs: this.openTabs });
    }

    /**
     * Создание нового файла проекта
     */
    createFile(name, content = '', silent = false) {
      if (!name) return false;
      const cleanName = name.trim();
      if (this.files[cleanName]) {
        if (!silent && typeof alert === 'function') {
          alert('Файл с таким именем уже существует!');
        }
        return false;
      }
      this.files[cleanName] = content;
      this.artifacts.delete(cleanName);
      if (!this.openTabs.includes(cleanName)) {
        this.openTabs.push(cleanName);
      }
      this.activeFileName = cleanName;
      this.notify('file-created', { name: cleanName });
      return true;
    }

    /**
     * Удаление файла проекта
     */
    deleteFile(name, silent = false) {
      if (!this.files[name]) return false;
      if (Object.keys(this.files).length <= 1) {
        if (!silent && typeof alert === 'function') {
          alert('Нельзя удалить единственный файл в проекте!');
        }
        return false;
      }
      delete this.files[name];
      this.artifacts.delete(name);

      const tabIdx = this.openTabs.indexOf(name);
      if (tabIdx !== -1) {
        this.openTabs.splice(tabIdx, 1);
      }
      if (this.activeFileName === name) {
        this.activeFileName = this.openTabs[0] || Object.keys(this.files)[0];
        if (!this.openTabs.includes(this.activeFileName)) {
          this.openTabs.push(this.activeFileName);
        }
      }
      this.notify('file-deleted', { name });
      return true;
    }

    /**
     * Переименование файла
     */
    renameFile(oldName, newName) {
      if (!this.files[oldName] || !newName || this.files[newName]) return false;
      this.files[newName] = this.files[oldName];
      delete this.files[oldName];

      if (this.artifacts.has(oldName)) {
        this.artifacts.delete(oldName);
        this.artifacts.add(newName);
      }

      const tabIdx = this.openTabs.indexOf(oldName);
      if (tabIdx !== -1) {
        this.openTabs[tabIdx] = newName;
      }
      if (this.activeFileName === oldName) {
        this.activeFileName = newName;
      }
      this.notify('file-renamed', { oldName, newName });
      return true;
    }

    /**
     * Добавление одиночного сгенерированного файла-артефакта в проект
     * Без дублирующего вызова saveToStorage
     */
    addArtifactFile(name, content) {
      if (!name || content === undefined || content === null) return;
      const cleanName = name.trim();
      this.files[cleanName] = content;
      this.artifacts.add(cleanName);
      this.notify('file-added', { name: cleanName });
    }

    /**
     * Пакетное добавление сгенерированных артефактов компиляции (.bin, .lst, .map, .obj)
     * Выполняет ровно одно сохранение и одно уведомление вместо N вызовов
     * @param {Object<string, string|Uint8Array>} artifactsMap 
     */
    addArtifactFiles(artifactsMap) {
      if (!artifactsMap || typeof artifactsMap !== 'object') return;
      let count = 0;
      for (const [name, content] of Object.entries(artifactsMap)) {
        if (!name || content === undefined || content === null) continue;
        const cleanName = name.trim();
        this.files[cleanName] = content;
        this.artifacts.add(cleanName);
        count++;
      }
      if (count > 0) {
        this.notify('artifacts-added', { count, files: Object.keys(artifactsMap) });
      }
    }

    /**
     * Очистка сгенерированных артефактов компиляции
     * @returns {number} Количество удаленных артефактов
     */
    clearArtifacts() {
      let removed = 0;
      for (const name of Array.from(this.artifacts)) {
        if (typeof this.files[name] !== 'undefined') {
          delete this.files[name];
          removed++;
        }
      }
      this.artifacts.clear();
      if (removed > 0) {
        this.notify('artifacts-cleared', { count: removed });
      }
      return removed;
    }

    /**
     * Проверка, является ли файл сгенерированным артефактом компиляции
     * @param {string} name 
     * @returns {boolean}
     */
    isArtifact(name) {
      return this.artifacts.has(name);
    }

    /**
     * Список имен всех текущих артефактов
     * @returns {string[]}
     */
    getArtifactNames() {
      return Array.from(this.artifacts);
    }

    getFileContent(name) {
      return this.files[name] || '';
    }

    /**
     * Установка содержимого файла с поддержкой debounce для Monaco Editor
     * В память записывается немедленно, в долговременное хранилище - с задержкой 500 мс
     */
    setFileContent(name, content) {
      if (typeof this.files[name] !== 'undefined') {
        if (typeof this.files[name] === 'string') {
          if (this.files[name] !== content) {
            this.files[name] = content;
            this.scheduleDebouncedSave(500);
          }
        }
      }
    }

    getActiveFile() {
      const content = this.files[this.activeFileName];
      if (typeof content === 'string') {
        return {
          name: this.activeFileName,
          content: content
        };
      }
      if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
        const len = content.byteLength;
        let headerInfo = '';
        if (this.activeFileName.toLowerCase().endsWith('.bin') && len >= 4) {
          const loadAddr = content[0] | (content[1] << 8);
          const progLen = content[2] | (content[3] << 8);
          headerInfo = `\n; Начальный адрес: 0${loadAddr.toString(8)} (восьмеричный)\n; Длина программы: ${progLen} байт\n;`;
        } else if (this.activeFileName.toLowerCase().endsWith('.obj')) {
          headerInfo = `\n; Формат: Объектный модуль DEC PDP-11 / RT-11 (.OBJ)\n; Сформирован ассемблером MACRO-11 для компоновщика pclink11\n;`;
        }
        const text = `; ========================================================\n; Двоичный файл (артефакт): ${this.activeFileName}\n; Размер: ${len} байт${headerInfo}\n; ========================================================\n; Для запуска файла в окне эмулятора нажмите зеленую кнопку ▶\n; в списке файлов слева или используйте кнопку «Запуск (F9)».\n`;
        return {
          name: this.activeFileName,
          content: text
        };
      }
      return {
        name: this.activeFileName,
        content: ''
      };
    }

    setActiveFile(name) {
      if (this.files[name]) {
        if (!this.openTabs.includes(name)) {
          this.openTabs.push(name);
        }
        this.activeFileName = name;
        this.notify('file-selected', { name });
      }
    }

    openFileInTab(name) {
      if (typeof this.files[name] === 'undefined') return;
      if (!this.openTabs.includes(name)) {
        this.openTabs.push(name);
      }
      this.activeFileName = name;
      this.notify('file-selected', { name });
    }

    closeTab(name) {
      const idx = this.openTabs.indexOf(name);
      if (idx === -1) return;
      this.openTabs.splice(idx, 1);
      if (this.activeFileName === name) {
        if (this.openTabs.length > 0) {
          const nextIdx = Math.min(idx, this.openTabs.length - 1);
          this.activeFileName = this.openTabs[nextIdx];
        } else {
          this.activeFileName = Object.keys(this.files)[0] || '';
          if (this.activeFileName) {
            this.openTabs = [this.activeFileName];
          }
        }
      }
      this.notify('tab-closed', { name, activeFileName: this.activeFileName });
    }

    getAllFiles() {
      return Object.assign({}, this.files);
    }

    updateSetting(key, val) {
      this.settings[key] = val;
      this.notify('settings-changed', { key, val });
    }

    /**
     * Получение диагностической информации о хранилище проекта
     * @returns {Promise<Object>}
     */
    async getStorageDiagnostics() {
      let totalBytes = 0;
      let sourcesBytes = 0;
      let artifactsBytes = 0;
      let sourcesCount = 0;
      let artifactsCount = 0;

      for (const [name, content] of Object.entries(this.files)) {
        let size = 0;
        if (typeof content === 'string') {
          size = content.length * 2;
        } else if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
          size = content.byteLength;
        } else if (content && typeof content === 'object' && content.data) {
          size = content.data.length;
        }

        totalBytes += size;
        if (this.artifacts.has(name)) {
          artifactsCount++;
          artifactsBytes += size;
        } else {
          sourcesCount++;
          sourcesBytes += size;
        }
      }

      let quotaEstimate = null;
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          quotaEstimate = await navigator.storage.estimate();
        } catch (_) {}
      }

      return {
        storageType: this.storage.lastStorageType,
        isIDBSupported: this.storage.isIDBSupported,
        isIDBReady: this.storage.isIDBReady,
        lastSavedAt: this.storage.lastSavedAt,
        lastSaveError: this.storage.lastSaveError,
        filesTotal: Object.keys(this.files).length,
        sourcesCount,
        sourcesBytes,
        artifactsCount,
        artifactsBytes,
        totalBytes,
        quotaEstimate
      };
    }

    /**
     * Программный экспорт всех файлов проекта в ZIP (в формате Base64)
     * Не зависит от DOM и подходит для вызова из Bridge / MCP
     * @returns {Promise<string>} Base64-строка архива
     */
    async exportZipBase64() {
      this.flushSave();
      const JSZipLib = global.JSZip || (typeof window !== 'undefined' ? window.JSZip : null);
      if (!JSZipLib) {
        throw new Error('Библиотека JSZip не загружена');
      }
      const zip = new JSZipLib();
      const files = this.getAllFiles();

      for (const [name, content] of Object.entries(files)) {
        if (typeof content === 'string') {
          zip.file(name, content);
        } else if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
          zip.file(name, content, { binary: true });
        } else if (content && typeof content === 'object' && content.__binary && content.data) {
          const bytes = base64ToUint8(content.data);
          zip.file(name, bytes, { binary: true });
        }
      }

      if (typeof zip.generateAsync === 'function') {
        return await zip.generateAsync({ type: 'base64' });
      }
      if (typeof zip.generate === 'function') {
        return zip.generate({ type: 'base64' });
      }
      throw new Error('Методы generate / generateAsync недоступны в текущей версии JSZip');
    }

    /**
     * Экспорт текущего файла
     */
    downloadActiveFile() {
      this.flushSave();
      const { name, content } = this.getActiveFile();
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  global.BKProjectStorage = BKProjectStorage;
  global.BKProjectManager = BKProjectManager;
  global.bkProject = new BKProjectManager();

})(typeof window !== 'undefined' ? window : this);
