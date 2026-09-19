/**
 * BKStudio - Project & File Manager
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'bkstudio_project_data';

  class BKProjectManager {
    constructor() {
      this.files = {};
      this.activeFileName = 'main.asm';
      this.openTabs = ['main.asm'];
      this.settings = {
        platform: 'BK-0010',
        startAddress: '1000',
        format: 'bin',
        theme: 'bk-crt-green'
      };
      this.listeners = [];
      this.loadFromStorage();
    }

    onChange(cb) {
      this.listeners.push(cb);
    }

    notify(event, data) {
      for (const cb of this.listeners) {
        try { cb(event, data); } catch (e) { console.error(e); }
      }
      this.saveToStorage();
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.files && Object.keys(data.files).length > 0) {
            this.files = {};
            for (const [name, val] of Object.entries(data.files)) {
              if (val && typeof val === 'object' && val.__binary && typeof val.data === 'string') {
                try {
                  const binary = atob(val.data);
                  const len = binary.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) {
                    bytes[i] = binary.charCodeAt(i);
                  }
                  this.files[name] = bytes;
                } catch (e) {
                  this.files[name] = val;
                }
              } else {
                this.files[name] = val;
              }
            }

            this.activeFileName = data.activeFileName || Object.keys(this.files)[0];
            if (Array.isArray(data.openTabs) && data.openTabs.length > 0) {
              this.openTabs = data.openTabs.filter(n => typeof this.files[n] !== 'undefined');
              if (this.openTabs.length === 0) {
                this.openTabs = [this.activeFileName];
              }
            } else {
              this.openTabs = [this.activeFileName];
            }
            this.settings = Object.assign(this.settings, data.settings || {});
            return;
          }
        }
      } catch (e) {
        console.warn('[BKStudio] Не удалось восстановить проект из localStorage:', e);
      }

      // Если в хранилище пусто - загружаем первый дефолтный пример
      this.loadSample('hello_bk10', false);
    }

    saveToStorage() {
      try {
        const serializedFiles = {};
        for (const [name, content] of Object.entries(this.files)) {
          if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
            let binary = '';
            const len = content.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(content[i]);
            }
            serializedFiles[name] = {
              __binary: true,
              data: btoa(binary)
            };
          } else if (content && typeof content === 'object' && content.__binary) {
            serializedFiles[name] = content;
          } else if (typeof content === 'string') {
            serializedFiles[name] = content;
          }
        }

        const data = {
          files: serializedFiles,
          activeFileName: this.activeFileName,
          openTabs: this.openTabs,
          settings: this.settings,
          savedAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.warn('[BKStudio] Ошибка сохранения в localStorage:', e);
      }
    }

    loadSample(sampleId, notifyUser = true) {
      const sample = (global.BK_SAMPLES || []).find(s => s.id === sampleId) || (global.BK_SAMPLES && global.BK_SAMPLES[0]);
      if (!sample) return;

      const filename = sample.filename || 'main.asm';
      this.files = {
        [filename]: sample.code
      };
      this.activeFileName = filename;
      this.openTabs = [filename];
      this.settings.platform = sample.platform || 'BK-0010';
      this.settings.startAddress = '1000';
      this.settings.format = 'bin';

      if (notifyUser) {
        this.notify('project-reset', { sample });
      }
    }

    loadProjectFiles(filesMap, activeFileName = null, settings = null, openTabs = null) {
      if (!filesMap || Object.keys(filesMap).length === 0) return;
      this.files = filesMap;
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

    createFile(name, content = '') {
      if (!name) return false;
      const cleanName = name.trim();
      if (this.files[cleanName]) {
        alert('Файл с таким именем уже существует!');
        return false;
      }
      this.files[cleanName] = content;
      if (!this.openTabs.includes(cleanName)) {
        this.openTabs.push(cleanName);
      }
      this.activeFileName = cleanName;
      this.notify('file-created', { name: cleanName });
      return true;
    }

    deleteFile(name) {
      if (!this.files[name]) return false;
      if (Object.keys(this.files).length <= 1) {
        alert('Нельзя удалить единственный файл в проекте!');
        return false;
      }
      delete this.files[name];
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

    renameFile(oldName, newName) {
      if (!this.files[oldName] || !newName || this.files[newName]) return false;
      this.files[newName] = this.files[oldName];
      delete this.files[oldName];
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
     * Добавление сгенерированного файла-артефакта в проект
     */
    addArtifactFile(name, content) {
      if (!name || content === undefined || content === null) return;
      const cleanName = name.trim();
      this.files[cleanName] = content;
      this.saveToStorage();
      this.notify('file-added', { name: cleanName });
    }

    getFileContent(name) {
      return this.files[name] || '';
    }

    setFileContent(name, content) {
      if (typeof this.files[name] !== 'undefined') {
        if (typeof this.files[name] === 'string') {
          this.files[name] = content;
          this.saveToStorage();
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
          // Если все вкладки закрыты, оставляем первую доступную
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
     * Экспорт текущего файла
     */
    downloadActiveFile() {
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

  global.BKProjectManager = BKProjectManager;
  global.bkProject = new BKProjectManager();

})(typeof window !== 'undefined' ? window : this);
