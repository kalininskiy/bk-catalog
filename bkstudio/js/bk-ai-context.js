/**
 * BKStudio - AI Context Provider
 *
 * Модуль сбора контекста IDE для AI-ассистента.
 * Собирает информацию строго по запросу, не дублируя хранилище файлов:
 *   1. Текущий файл (имя, содержимое, курсор);
 *   2. Выделенный текст в редакторе (selection);
 *   3. Список файлов проекта (манифест без автоматической загрузки тел всех файлов);
 *   4. Содержимое указанного файла через существующий BKProjectManager;
 *   5. Целевая платформа (BK-0010, BK-0011M);
 *   6. Начальный адрес загрузки (startAddress, например 1000);
 *   7. Активный компилятор (bkturbo8, pdpy11, macro11);
 *   8. Текущие диагностические сообщения (LSP ошибки, предупреждения);
 *   9. Текущий ассемблерный листинг (если доступен).
 *
 * Принципы:
 *   - Не отправляет автоматически весь проект в LLM;
 *   - По умолчанию собирает только необходимый контекст для конкретного запроса;
 *   - Использует существующий синглтон BKProjectManager (global.bkProject);
 *   - Не создает вторую систему хранения файлов.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Класс поставщика контекста для AI
   */
  class BKAIContext {
    /**
     * @param {Object} [deps] - Зависимости (для тестирования или переопределения)
     * @param {Object} [deps.projectManager] - Экземпляр BKProjectManager
     * @param {Object} [deps.editor] - Экземпляр Monaco Editor
     * @param {Object} [deps.compilerBridge] - Экземпляр CompilerBridgeManager
     */
    constructor(deps = {}) {
      this._deps = deps;
    }

    /**
     * Возвращает активный экземпляр BKProjectManager.
     * @private
     * @returns {Object|null}
     */
    _getProjectManager() {
      return this._deps.projectManager || global.bkProject || null;
    }

    /**
     * Возвращает активный редактор Monaco.
     * @private
     * @returns {Object|null}
     */
    _getEditor() {
      return this._deps.editor || global.editor || null;
    }

    /**
     * Возвращает CompilerBridge.
     * @private
     * @returns {Object|null}
     */
    _getCompilerBridge() {
      return this._deps.compilerBridge || global.compilerBridge || null;
    }

    /**
     * 1. Возвращает информацию о текущем активном файле.
     * Если файл открыт в редакторе, возвращает актуальный текст из Monaco,
     * синхронизированный с незафиксированными изменениями.
     *
     * @returns {{
     *   name: string,
     *   path: string,
     *   content: string,
     *   isBinary: boolean,
     *   size: number
     * }}
     */
    getCurrentFile() {
      const pm = this._getProjectManager();
      const editor = this._getEditor();
      const activeName = (pm && pm.activeFileName) ? pm.activeFileName : 'main.asm';

      let content = '';
      let isBinary = false;

      // Если в редакторе открыт текущий файл, берем самое свежее содержимое из редактора
      if (editor && typeof editor.getValue === 'function') {
        content = editor.getValue();
      } else if (pm && typeof pm.getFileContent === 'function') {
        const raw = pm.getFileContent(activeName);
        if (raw instanceof Uint8Array || ArrayBuffer.isView(raw) || (raw && raw.__binary)) {
          isBinary = true;
          content = (pm.getActiveFile && pm.getActiveFile().content) || '';
        } else {
          content = String(raw || '');
        }
      }

      if (activeName.toLowerCase().endsWith('.bin') ||
          activeName.toLowerCase().endsWith('.obj') ||
          activeName.toLowerCase().endsWith('.bks')) {
        isBinary = true;
      }

      return {
        name: activeName,
        path: activeName,
        content: content,
        isBinary: isBinary,
        size: content.length
      };
    }

    /**
     * 2. Возвращает выделенный текст в текущем редакторе.
     * Если ничего не выделено, возвращает пустую строку и hasSelection: false.
     *
     * @returns {{
     *   text: string,
     *   hasSelection: boolean,
     *   startLine?: number,
     *   endLine?: number,
     *   startColumn?: number,
     *   endColumn?: number
     * }}
     */
    getSelection() {
      const editor = this._getEditor();
      if (!editor || typeof editor.getSelection !== 'function') {
        return {
          text: '',
          hasSelection: false
        };
      }

      try {
        const selection = editor.getSelection();
        if (!selection || (typeof selection.isEmpty === 'function' && selection.isEmpty())) {
          return {
            text: '',
            hasSelection: false
          };
        }

        const model = editor.getModel && editor.getModel();
        if (!model || typeof model.getValueInRange !== 'function') {
          return {
            text: '',
            hasSelection: false
          };
        }

        const selectedText = model.getValueInRange(selection);
        const hasText = Boolean(selectedText && selectedText.length > 0);

        return {
          text: selectedText || '',
          hasSelection: hasText,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
          startColumn: selection.startColumn,
          endColumn: selection.endColumn
        };
      } catch (err) {
        return {
          text: '',
          hasSelection: false
        };
      }
    }

    /**
     * 3. Возвращает список файлов проекта (метаданные без передачи всех тел файлов).
     * Предотвращает раздувание контекста LLM лишними данными.
     *
     * @returns {Array<{
     *   name: string,
     *   path: string,
     *   size: number,
     *   isBinary: boolean,
     *   isActive: boolean
     * }>}
     */
    getProjectFiles() {
      const pm = this._getProjectManager();
      if (!pm) return [];

      const rawFiles = (typeof pm.getAllFiles === 'function') ? pm.getAllFiles() : (pm.files || {});
      const activeName = pm.activeFileName || '';

      return Object.keys(rawFiles).map(name => {
        const val = rawFiles[name];
        const isBinary = Boolean(
          (val instanceof Uint8Array) ||
          (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(val)) ||
          (val && val.__binary) ||
          (val && val.constructor && val.constructor.name === 'Uint8Array') ||
          (val && typeof val.byteLength === 'number' && typeof val !== 'string')
        );
        let size = 0;

        if (isBinary) {
          if (val && typeof val.byteLength === 'number') {
            size = val.byteLength;
          } else if (val && val.data && typeof atob === 'function') {
            try { size = atob(val.data).length; } catch (_) {}
          }
        } else if (typeof val === 'string') {
          size = val.length;
        }

        return {
          name: name,
          path: name,
          size: size,
          isBinary: isBinary,
          isActive: (name === activeName)
        };
      });
    }

    /**
     * 4. Возвращает содержимое конкретного файла из существующего BKProjectManager.
     * Не создает вторую систему хранения.
     *
     * @param {string} filePath - Имя или путь к файлу в проекте
     * @returns {{
     *   name: string,
     *   path: string,
     *   exists: boolean,
     *   content: string|Uint8Array|null,
     *   isBinary: boolean,
     *   size: number
     * }}
     */
    getFile(filePath) {
      if (!filePath || typeof filePath !== 'string') {
        return {
          name: '',
          path: '',
          exists: false,
          content: null,
          isBinary: false,
          size: 0
        };
      }

      const cleanPath = filePath.trim();
      const pm = this._getProjectManager();
      if (!pm) {
        return {
          name: cleanPath,
          path: cleanPath,
          exists: false,
          content: null,
          isBinary: false,
          size: 0
        };
      }

      const rawFiles = (typeof pm.getAllFiles === 'function') ? pm.getAllFiles() : (pm.files || {});
      const exists = Object.prototype.hasOwnProperty.call(rawFiles, cleanPath);

      if (!exists) {
        return {
          name: cleanPath,
          path: cleanPath,
          exists: false,
          content: null,
          isBinary: false,
          size: 0
        };
      }

      let content = rawFiles[cleanPath];
      // Если запрошен активный файл и он открыт в редакторе, отдаем свежую версию из редактора
      if (cleanPath === pm.activeFileName) {
        const editor = this._getEditor();
        if (editor && typeof editor.getValue === 'function' && typeof content === 'string') {
          content = editor.getValue();
        }
      }

      const isBinary = (content instanceof Uint8Array || ArrayBuffer.isView(content) || (content && content.__binary));
      const size = isBinary ? (content.byteLength || 0) : (typeof content === 'string' ? content.length : 0);

      return {
        name: cleanPath,
        path: cleanPath,
        exists: true,
        content: content,
        isBinary: isBinary,
        size: size
      };
    }

    /**
     * 5. Возвращает целевую платформу (BK-0010, BK-0011M).
     * @returns {string}
     */
    getPlatform() {
      if (typeof document !== 'undefined') {
        const select = document.getElementById('platform-select');
        if (select && select.value) return select.value;
      }
      const pm = this._getProjectManager();
      if (pm && pm.settings && pm.settings.platform) {
        return pm.settings.platform;
      }
      return 'BK-0010';
    }

    /**
     * 6. Возвращает начальный адрес запуска / загрузки программы (восьмеричный, например 1000).
     * @returns {string}
     */
    getStartAddress() {
      if (typeof document !== 'undefined') {
        const input = document.getElementById('address-input');
        if (input && input.value) return input.value.trim();
      }
      const pm = this._getProjectManager();
      if (pm && pm.settings && pm.settings.startAddress) {
        return pm.settings.startAddress;
      }
      return '1000';
    }

    /**
     * 7. Возвращает имя текущего компилятора (bkturbo8, pdpy11, macro11).
     * @returns {string}
     */
    getCompiler() {
      const cb = this._getCompilerBridge();
      if (cb && typeof cb.getCompiler === 'function') {
        const comp = cb.getCompiler();
        if (comp) return comp;
      }
      if (typeof document !== 'undefined') {
        const select = document.getElementById('compiler-select');
        if (select && select.value) return select.value;
      }
      return 'bkturbo8';
    }

    /**
     * 8. Возвращает текущие диагностические сообщения (ошибки, предупреждения LSP/компилятора).
     *
     * @returns {Array<{
     *   message: string,
     *   severity: number,
     *   severityText: "error"|"warning"|"info",
     *   line: number,
     *   column: number,
     *   file: string,
     *   source: string
     * }>}
     */
    getDiagnostics() {
      const diagnostics = [];

      // 1. Извлечение маркеров из Monaco Editor (LSP PDP-11, BKTurbo8, etc.)
      if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getModelMarkers === 'function') {
        try {
          const markers = monaco.editor.getModelMarkers({});
          for (const m of markers) {
            let sevText = 'info';
            if (m.severity === 8 || m.severity === monaco.MarkerSeverity?.Error) {
              sevText = 'error';
            } else if (m.severity === 4 || m.severity === monaco.MarkerSeverity?.Warning) {
              sevText = 'warning';
            }

            const fileName = m.resource ? m.resource.path.replace(/^\//, '') : (this.getCurrentFile().name);

            diagnostics.push({
              message: m.message,
              severity: m.severity,
              severityText: sevText,
              line: m.startLineNumber,
              column: m.startColumn,
              endLine: m.endLineNumber,
              endColumn: m.endColumn,
              file: fileName,
              source: m.source || 'LSP'
            });
          }
        } catch (_) {}
      }

      // 2. Если в UI есть активное текстовое сообщение об ошибке компиляции в статусе
      if (diagnostics.length === 0 && typeof document !== 'undefined') {
        const statusEl = document.getElementById('status-text');
        if (statusEl && statusEl.textContent && statusEl.textContent.toLowerCase().includes('ошиб')) {
          diagnostics.push({
            message: statusEl.textContent.trim(),
            severity: 8,
            severityText: 'error',
            line: 0,
            column: 0,
            file: this.getCurrentFile().name,
            source: 'Compiler'
          });
        }
      }

      return diagnostics;
    }

    /**
     * 9. Возвращает текущий ассемблерный листинг (.LST), если он доступен.
     * @returns {string}
     */
    getListing() {
      // 1. Из глобальной переменной currentListingText, если доступна
      if (global.currentListingText && typeof global.currentListingText === 'string') {
        return global.currentListingText;
      }

      // 2. Из DOM-элемента листинга #listing-output
      if (typeof document !== 'undefined') {
        const el = document.getElementById('listing-output');
        if (el && el.textContent) {
          return el.textContent;
        }
      }

      return '';
    }

    /**
     * Возвращает сводную информацию о проекте и среде сборки.
     *
     * @returns {{
     *   platform: string,
     *   startAddress: string,
     *   compiler: string,
     *   format: string,
     *   activeFile: string,
     *   filesCount: number,
     *   hasListing: boolean,
     *   hasDiagnostics: boolean,
     *   diagnosticsCount: number
     * }}
     */
    getProjectInfo() {
      const pm = this._getProjectManager();
      const files = (pm && typeof pm.getAllFiles === 'function') ? pm.getAllFiles() : (pm ? pm.files : {});
      const diagnostics = this.getDiagnostics();
      const listing = this.getListing();

      let format = 'bin';
      if (typeof document !== 'undefined') {
        const fmtSelect = document.getElementById('format-select');
        if (fmtSelect && fmtSelect.value) format = fmtSelect.value;
      } else if (pm && pm.settings && pm.settings.format) {
        format = pm.settings.format;
      }

      return {
        platform: this.getPlatform(),
        startAddress: this.getStartAddress(),
        compiler: this.getCompiler(),
        format: format,
        activeFile: (pm && pm.activeFileName) ? pm.activeFileName : 'main.asm',
        filesCount: Object.keys(files || {}).length,
        hasListing: Boolean(listing && listing.trim().length > 0),
        hasDiagnostics: diagnostics.length > 0,
        diagnosticsCount: diagnostics.length
      };
    }

    /**
     * Формирует оптимальный и компактный контекст для передачи в LLM.
     * По умолчанию передает только необходимый минимум:
     *   - платформу и компилятор;
     *   - текущий файл или выделенный фрагмент (если есть выделение);
     *   - диагностические ошибки сборки (если они есть);
     *   - листинг только если включен флаг includeListing.
     *
     * Не отправляет все файлы проекта автоматически.
     *
     * @param {Object} [options]
     * @param {boolean} [options.includeSelection=true] - Учитывать выделенный фрагмент
     * @param {boolean} [options.includeDiagnostics=true] - Включать ошибки компиляции
     * @param {boolean} [options.includeListing=false] - Включать полный листинг (только по запросу)
     * @param {boolean} [options.includeFileList=false] - Включать список имен файлов проекта
     * @returns {{
     *   projectInfo: Object,
     *   currentFile: Object,
     *   selection: Object,
     *   diagnostics: Array<Object>,
     *   listing: string,
     *   toPromptString: Function
     * }}
     */
    buildContext(options = {}) {
      const includeSelection = options.includeSelection !== false;
      const includeDiagnostics = options.includeDiagnostics !== false;
      const includeListing = Boolean(options.includeListing);
      const includeFileList = Boolean(options.includeFileList);

      const projectInfo = this.getProjectInfo();
      const currentFile = this.getCurrentFile();
      const selection = includeSelection ? this.getSelection() : { text: '', hasSelection: false };
      const diagnostics = includeDiagnostics ? this.getDiagnostics() : [];
      const listing = includeListing ? this.getListing() : '';
      const projectFiles = includeFileList ? this.getProjectFiles() : [];

      return {
        projectInfo,
        currentFile,
        selection,
        diagnostics,
        listing,
        projectFiles,

        /**
         * Преобразует контекст в компактный Markdown-блок для промпта
         * @returns {string}
         */
        toPromptString() {
          const parts = [];

          // 1. Метаданные платформы и компилятора
          parts.push(`[BKStudio Environment: Platform=${projectInfo.platform}, Compiler=${projectInfo.compiler}, StartAddr=0${projectInfo.startAddress}, Format=${projectInfo.format}]`);

          // 2. Список файлов (если запрошен)
          if (projectFiles.length > 0) {
            const listStr = projectFiles.map(f => `${f.name}${f.isActive ? ' (active)' : ''}`).join(', ');
            parts.push(`Project files: ${listStr}`);
          }

          // 3. Выделенный фрагмент или текущий файл
          if (selection.hasSelection) {
            parts.push(`Selected code in ${currentFile.name} (lines ${selection.startLine}-${selection.endLine}):\n\`\`\`pdp11\n${selection.text}\n\`\`\``);
          } else if (currentFile.content && !currentFile.isBinary) {
            parts.push(`Current file: ${currentFile.name}\n\`\`\`pdp11\n${currentFile.content}\n\`\`\``);
          } else if (currentFile.isBinary) {
            parts.push(`Current file: ${currentFile.name} (binary artifact, size: ${currentFile.size} bytes)`);
          }

          // 4. Ошибки и предупреждения (если есть)
          if (diagnostics.length > 0) {
            const diagLines = diagnostics.slice(0, 10).map(d => {
              const loc = d.line ? `line ${d.line}: ` : '';
              return `- [${d.severityText.toUpperCase()}] ${loc}${d.message}`;
            });
            parts.push(`Diagnostics:\n${diagLines.join('\n')}`);
          }

          // 5. Листинг (только если явно запрошен)
          if (listing) {
            parts.push(`Compiler Listing:\n\`\`\`\n${listing.slice(0, 4000)}\n\`\`\``);
          }

          return parts.join('\n\n');
        }
      };
    }
  }

  // Экспорт класса и глобального синглтона
  const contextInstance = new BKAIContext();
  global.BKAIContext = BKAIContext;
  global.bkAIContext = contextInstance;

})(typeof window !== 'undefined' ? window : this);
