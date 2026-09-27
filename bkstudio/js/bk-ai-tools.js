/**
 * BKStudio - AI Controlled Tools API
 *
 * Предоставляет безопасный и строго контролируемый набор инструментов (Tool API)
 * для вызова из LLM (Function Calling / Tool Use в OpenAI, Anthropic и др.).
 *
 * Архитектурные правила и безопасность:
 *   - LLM НЕ имеет прямого доступа к DOM;
 *   - Вызовы eval и произвольное выполнение JavaScript СТРОГО ЗАПРЕЩЕНЫ;
 *   - Все инструменты работают ТОЛЬКО через существующие API BKStudio:
 *       * Файловая система -> window.bkProject (BKProjectManager);
 *       * Сборка и компиляция -> compileProject / window.compilerBridge / compilerService;
 *       * Эмуляция -> window.emulatorBridge (BKEmulatorBridge);
 *       * Отладка -> window.emulatorBridge.debug().
 *   - Каждый инструмент содержит:
 *       * name (строковый идентификатор);
 *       * description (подробное описание назначения);
 *       * parameters (JSON Schema аргументов);
 *       * execute(args) (асинхронная функция выполнения с валидацией).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Безопасный парсер адресов для PDP-11 / БК-0010.
   * Поддерживает восьмеричные строки ('1000', '01000', '0o1000'),
   * шестнадцатеричные ('0x200') и числовые значения.
   *
   * @param {number|string} addr
   * @returns {number}
   */
  function parseBKAddress(addr) {
    if (typeof addr === 'number') {
      return Math.floor(addr);
    }
    if (typeof addr === 'string') {
      const s = addr.trim();
      if (s.startsWith('0x') || s.startsWith('0X')) {
        return parseInt(s, 16);
      }
      if (s.startsWith('0o') || s.startsWith('0O')) {
        return parseInt(s.slice(2), 8);
      }
      // Если все символы 0-7, интерпретируем как восьмеричное число (стандарт БК)
      if (/^[0-7]+$/.test(s)) {
        return parseInt(s, 8);
      }
      return parseInt(s, 10);
    }
    return 0;
  }

  /**
   * Класс определения отдельного инструмента
   */
  class BKAITool {
    /**
     * @param {Object} options
     * @param {string} options.name - Уникальное имя (например 'project.read_file')
     * @param {string} options.description - Описание для LLM
     * @param {Object} options.parameters - JSON Schema параметров
     * @param {Function} options.execute - Функция выполнения (args, registry)
     */
    constructor(options) {
      if (!options || typeof options.name !== 'string' || !options.name) {
        throw new Error('BKAITool: имя инструмента (name) обязательно.');
      }
      if (typeof options.description !== 'string' || !options.description) {
        throw new Error(`BKAITool [${options.name}]: описание (description) обязательно.`);
      }
      if (!options.parameters || typeof options.parameters !== 'object') {
        throw new Error(`BKAITool [${options.name}]: схема параметров (parameters) обязательна.`);
      }
      if (typeof options.execute !== 'function') {
        throw new Error(`BKAITool [${options.name}]: функция выполнения (execute) обязательна.`);
      }

      this.name = options.name;
      this.description = options.description;
      this.parameters = options.parameters;
      this.execute = options.execute;
    }

    /**
     * Приведение схемы инструмента к формату целевого провайдера
     * @param {"standard"|"openai"|"anthropic"} [format="standard"]
     * @returns {Object}
     */
    toSchema(format = 'standard') {
      if (format === 'openai') {
        return {
          type: 'function',
          function: {
            name: this.name,
            description: this.description,
            parameters: this.parameters
          }
        };
      }
      if (format === 'anthropic') {
        return {
          name: this.name,
          description: this.description,
          input_schema: this.parameters
        };
      }
      return {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      };
    }
  }

  /**
   * Реестр инструментов BKStudio AI
   */
  class BKAIToolRegistry {
    /**
     * @param {Object} [deps] - Зависимости для тестирования
     */
    constructor(deps = {}) {
      this._deps = deps;
      /** @type {Map<string, BKAITool>} */
      this._tools = new Map();

      this._registerBuiltInTools();
    }

    /**
     * Получить менеджер проекта BKProjectManager
     * @private
     * @returns {Object|null}
     */
    _getProjectManager() {
      return this._deps.bkProject || global.bkProject || null;
    }

    /**
     * Получить активный редактор Monaco
     * @private
     * @returns {Object|null}
     */
    _getEditor() {
      return this._deps.editor || global.editor || null;
    }

    /**
     * Получить мост компилятора CompilerBridgeManager
     * @private
     * @returns {Object|null}
     */
    _getCompilerBridge() {
      return this._deps.compilerBridge || global.compilerBridge || null;
    }

    /**
     * Получить мост эмулятора BKEmulatorBridge
     * @private
     * @returns {Object|null}
     */
    _getEmulatorBridge() {
      return this._deps.emulatorBridge || global.emulatorBridge || global.bkEmulator || null;
    }

    /**
     * Получить сервис компилятора BKCompilerService
     * @private
     * @returns {Object|null}
     */
    _getCompilerService() {
      return this._deps.compilerService || global.compilerService || null;
    }

    /**
     * Получить контекст BKAIContext
     * @private
     * @returns {Object|null}
     */
    _getContext() {
      if (this._deps.bkAIContext) return this._deps.bkAIContext;
      if (global.bkAI && typeof global.bkAI.getContext === 'function') {
        return global.bkAI.getContext();
      }
      return global.bkAIContext || null;
    }

    /**
     * Получить графический AI API (BKGraphicsAIApi)
     * @private
     * @returns {Object|null}
     */
    _getGraphicsAI() {
      return this._deps.bkGraphicsAI || global.bkGraphicsAI || null;
    }

    /**
     * Регистрирует новый инструмент в реестре
     * @param {BKAITool|Object} tool
     */
    register(tool) {
      const instance = (tool instanceof BKAITool) ? tool : new BKAITool(tool);
      this._tools.set(instance.name, instance);
      return instance;
    }

    /**
     * Возвращает инструмент по имени
     * @param {string} name
     * @returns {BKAITool|undefined}
     */
    get(name) {
      if (name === 'graphics.save_png') return this._tools.get('graphics.export_png');
      return this._tools.get(name);
    }

    /**
     * Проверяет наличие инструмента в реестре
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
      if (name === 'graphics.save_png') return this._tools.has('graphics.export_png');
      return this._tools.has(name);
    }

    /**
     * Возвращает список всех зарегистрированных инструментов
     * @returns {BKAITool[]}
     */
    list() {
      return Array.from(this._tools.values());
    }

    /**
     * Возвращает схемы всех инструментов для передачи в LLM
     * @param {"standard"|"openai"|"anthropic"} [format="standard"]
     * @returns {Array<Object>}
     */
    getSchemas(format = 'standard') {
      return this.list().map(t => t.toSchema(format));
    }

    /**
     * Безопасно выполняет инструмент по имени
     * @param {string} name - Имя инструмента
     * @param {Object} [args={}] - Аргументы вызова
     * @returns {Promise<{success: boolean, [key: string]: any}>}
     */
    async execute(name, args = {}) {
      if (!name || typeof name !== 'string') {
        return {
          success: false,
          error: 'Имя инструмента должно быть непустой строкой.'
        };
      }

      const tool = this.get(name.trim());
      if (!tool) {
        return {
          success: false,
          error: `Инструмент "${name}" не найден в реестре BKStudio Tool API.`
        };
      }

      let parsedArgs = args;
      if (typeof args === 'string') {
        try {
          parsedArgs = JSON.parse(args);
        } catch (e) {
          return {
            success: false,
            error: `Неверный JSON в аргументах инструмента "${name}": ${e.message}`
          };
        }
      }
      if (!parsedArgs || typeof parsedArgs !== 'object') {
        parsedArgs = {};
      }

      try {
        const result = await tool.execute(parsedArgs, this);
        if (result && typeof result === 'object' && result.success !== undefined) {
          return result;
        }
        return Object.assign({ success: true }, result || {});
      } catch (err) {
        return {
          success: false,
          error: err.message || `Ошибка при выполнении инструмента "${name}"`
        };
      }
    }

    /**
     * Регистрация встроенных инструментов BKStudio
     * @private
     */
    _registerBuiltInTools() {
      // -----------------------------------------------------------------------
      // 1. Категория: project.*
      // -----------------------------------------------------------------------

      // project.list_files
      this.register({
        name: 'project.list_files',
        description: 'Возвращает список всех файлов в текущем проекте BKStudio с метаданными (имя, размер, признак бинарного файла, активный файл).',
        parameters: {
          type: 'object',
          properties: {
            includeArtifacts: {
              type: 'boolean',
              description: 'Включать ли сгенерированные бинарные артефакты (.BIN, .OBJ, .LST). По умолчанию true.'
            }
          }
        },
        execute: async (args, registry) => {
          const pm = registry._getProjectManager();
          if (!pm) throw new Error('Менеджер проекта (BKProjectManager) недоступен.');

          const files = pm.getAllFiles();
          const active = pm.activeFileName;
          const includeArtifacts = args.includeArtifacts !== false;

          const result = [];
          for (const [name, content] of Object.entries(files)) {
            const isBin = content instanceof Uint8Array || ArrayBuffer.isView(content) || (content && content.__binary);
            if (!includeArtifacts && isBin) continue;

            const size = (content instanceof Uint8Array || ArrayBuffer.isView(content))
              ? content.byteLength
              : (typeof content === 'string' ? content.length : 0);

            result.push({
              name: name,
              path: name,
              size: size,
              isBinary: Boolean(isBin),
              isActive: name === active
            });
          }

          return {
            files: result,
            totalCount: result.length,
            activeFileName: active
          };
        }
      });

      // project.read_file
      this.register({
        name: 'project.read_file',
        description: 'Считывает содержимое указанного текстового файла из проекта BKStudio. Для открытого файла возвращает актуальное содержимое из редактора.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Имя или относительный путь к файлу в проекте (например, "main.asm" или "sprites.asm").'
            }
          },
          required: ['path']
        },
        execute: async (args, registry) => {
          const path = String(args.path || '').trim();
          if (!path) throw new Error('Не указан параметр path.');

          const pm = registry._getProjectManager();
          if (!pm) throw new Error('Менеджер проекта недоступен.');

          const editor = registry._getEditor();
          const allFiles = pm.getAllFiles();

          if (typeof allFiles[path] === 'undefined') {
            throw new Error(`Файл "${path}" не найден в проекте.`);
          }

          let content = '';
          let isBinary = false;
          let size = 0;

          // Если файл активен и открыт в Monaco, читаем актуальную редакцию
          if (editor && typeof editor.getValue === 'function' && pm.activeFileName === path) {
            content = editor.getValue();
            size = content.length;
          } else {
            const raw = pm.getFileContent(path);
            if (raw instanceof Uint8Array || ArrayBuffer.isView(raw) || (raw && raw.__binary)) {
              isBinary = true;
              size = (raw instanceof Uint8Array || ArrayBuffer.isView(raw)) ? raw.byteLength : 0;
              content = `[Двоичные данные: ${size} байт]`;
            } else {
              content = String(raw || '');
              size = content.length;
            }
          }

          return {
            path: path,
            content: content,
            size: size,
            isBinary: isBinary
          };
        }
      });

      // project.write_file
      this.register({
        name: 'project.write_file',
        description: 'Записывает или заменяет содержимое текстового файла в проекте BKStudio. Если файл открыт в редакторе, обновляет его и в окне Monaco.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Имя файла в проекте (например, "main.asm").'
            },
            content: {
              type: 'string',
              description: 'Новый текст файла на ассемблере или данные.'
            }
          },
          required: ['path', 'content']
        },
        execute: async (args, registry) => {
          const path = String(args.path || '').trim();
          if (!path) throw new Error('Не указан параметр path.');
          if (args.content === undefined || args.content === null) {
            throw new Error('Не указан параметр content.');
          }

          const pm = registry._getProjectManager();
          if (!pm) throw new Error('Менеджер проекта недоступен.');

          const content = String(args.content);
          const allFiles = pm.getAllFiles();

          if (typeof allFiles[path] === 'undefined') {
            // Если файл не существует, создаем его
            const created = pm.createFile(path, content);
            if (!created) {
              throw new Error(`Не удалось создать файл "${path}".`);
            }
          } else {
            pm.setFileContent(path, content);
          }

          // Если открыт в редакторе, синхронизируем
          const editor = registry._getEditor();
          if (editor && typeof editor.setValue === 'function' && pm.activeFileName === path) {
            editor.setValue(content);
          }

          return {
            path: path,
            bytesWritten: content.length,
            message: `Файл "${path}" успешно сохранен.`
          };
        }
      });

      // project.create_file
      this.register({
        name: 'project.create_file',
        description: 'Создает новый файл в проекте с указанным именем и содержимым.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Имя создаваемого файла (например, "subroutines.asm").'
            },
            content: {
              type: 'string',
              description: 'Начальный текст файла (по умолчанию пустая строка).'
            }
          },
          required: ['path']
        },
        execute: async (args, registry) => {
          const path = String(args.path || '').trim();
          if (!path) throw new Error('Не указан параметр path.');

          const pm = registry._getProjectManager();
          if (!pm) throw new Error('Менеджер проекта недоступен.');

          const content = String(args.content || '');
          const ok = pm.createFile(path, content);
          if (!ok) {
            throw new Error(`Файл "${path}" уже существует или не может быть создан.`);
          }

          return {
            path: path,
            message: `Файл "${path}" создан.`
          };
        }
      });

      // project.delete_file
      this.register({
        name: 'project.delete_file',
        description: 'Удаляет файл из проекта BKStudio.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Имя удаляемого файла.'
            }
          },
          required: ['path']
        },
        execute: async (args, registry) => {
          const path = String(args.path || '').trim();
          if (!path) throw new Error('Не указан параметр path.');

          const pm = registry._getProjectManager();
          if (!pm) throw new Error('Менеджер проекта недоступен.');

          const ok = pm.deleteFile(path);
          if (!ok) {
            throw new Error(`Не удалось удалить файл "${path}" (возможно, он единственный в проекте или не существует).`);
          }

          return {
            path: path,
            message: `Файл "${path}" удален.`
          };
        }
      });

      // project.get_project_info
      this.register({
        name: 'project.get_project_info',
        description: 'Возвращает текущие настройки проекта: платформу (BK-0010/11M), начальный адрес, активный файл, формат вывода и компилятор.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const pm = registry._getProjectManager();
          const bridge = registry._getCompilerBridge();

          const settings = (pm && pm.settings) ? pm.settings : {};
          const compiler = (bridge && typeof bridge.getCompiler === 'function') ? bridge.getCompiler() : 'bkturbo8';

          return {
            platform: settings.platform || 'BK-0010',
            startAddress: settings.startAddress || '1000',
            format: settings.format || 'bin',
            activeFileName: pm ? pm.activeFileName : 'main.asm',
            compiler: compiler
          };
        }
      });

      // -----------------------------------------------------------------------
      // 2. Категория: build.*
      // -----------------------------------------------------------------------

      // build.compile
      this.register({
        name: 'build.compile',
        description: 'Компилирует проект с помощью активного компилятора BKStudio (BKTurbo8, PDPy11 или MACRO-11). Возвращает статус сборки, список ошибок, начальный адрес и размер бинарного файла.',
        parameters: {
          type: 'object',
          properties: {
            mainFile: {
              type: 'string',
              description: 'Главный файл сборки (по умолчанию активный файл проекта).'
            },
            compiler: {
              type: 'string',
              enum: ['bkturbo8', 'pdpy11', 'macro11'],
              description: 'Явное указание компилятора.'
            },
            platform: {
              type: 'string',
              enum: ['BK-0010', 'BK-0011M'],
              description: 'Целевая платформа.'
            },
            startAddress: {
              type: 'string',
              description: 'Начальный адрес в восьмеричном формате (например, "1000").'
            }
          }
        },
        execute: async (args, registry) => {
          const bridge = registry._getCompilerBridge();
          const pm = registry._getProjectManager();

          if (args.compiler && bridge && typeof bridge.setCompiler === 'function') {
            bridge.setCompiler(args.compiler);
          }
          if (args.platform && pm && typeof pm.updateSetting === 'function') {
            pm.updateSetting('platform', args.platform);
          }
          if (args.startAddress && pm && typeof pm.updateSetting === 'function') {
            pm.updateSetting('startAddress', args.startAddress);
          }

          // Если в среде доступна глобальная функция compileProject из app.js
          if (typeof global.compileProject === 'function') {
            const res = await global.compileProject();
            if (!res) {
              throw new Error('Функция compileProject вернула пустой результат.');
            }
            return {
              success: Boolean(res.success),
              loadAddress: res.loadAddress !== null && res.loadAddress !== undefined ? '0' + res.loadAddress.toString(8) : null,
              programLength: res.programLength || (res.binData ? res.binData.length : 0),
              durationMs: res.durationMs || 0,
              errors: res.errors || [],
              hasArtifacts: Boolean(res.artifacts && Object.keys(res.artifacts).length > 0)
            };
          }

          // Резервный вызов через CompilerBridge / CompilerService (например в тестах)
          if (bridge) {
            const files = pm ? pm.getAllFiles() : {};
            const mainFile = args.mainFile || (pm ? pm.activeFileName : 'main.asm');
            const comp = bridge.getCompiler ? bridge.getCompiler() : 'bkturbo8';

            let res;
            if (comp === 'macro11' && typeof bridge.compileWithMacro11 === 'function') {
              res = await bridge.compileWithMacro11(mainFile, files, args);
            } else if (comp === 'pdpy11' && typeof bridge.compileWithPdpy11 === 'function') {
              res = await bridge.compileWithPdpy11(mainFile, files, args);
            } else {
              const srv = registry._getCompilerService();
              if (srv && typeof srv.compile === 'function') {
                res = await srv.compile({ files, mainFile, ...args });
              } else {
                throw new Error('Компилятор не настроен в текущей среде.');
              }
            }

            return {
              success: Boolean(res && res.success),
              loadAddress: res && res.loadAddress ? '0' + res.loadAddress.toString(8) : null,
              programLength: res && (res.programLength || (res.binData && res.binData.length) || 0),
              errors: (res && res.errors) || []
            };
          }

          throw new Error('Сервис компиляции недоступен.');
        }
      });

      // build.get_listing
      this.register({
        name: 'build.get_listing',
        description: 'Возвращает текст текущего ассемблерного листинга (.LST) после последней компиляции проекта.',
        parameters: {
          type: 'object',
          properties: {
            maxLines: {
              type: 'integer',
              description: 'Ограничить вывод указанным числом строк (по умолчанию все строки).'
            }
          }
        },
        execute: async (args, registry) => {
          let lst = global.currentListingText || '';

          if (!lst) {
            const pm = registry._getProjectManager();
            if (pm) {
              const files = pm.getAllFiles();
              for (const [name, content] of Object.entries(files)) {
                if (name.toLowerCase().endsWith('.lst') && typeof content === 'string') {
                  lst = content;
                  break;
                }
              }
            }
          }

          if (!lst) {
            return {
              hasListing: false,
              listing: '',
              message: 'Листинг отсутствует. Сначала выполните успешную компиляцию (build.compile).'
            };
          }

          if (args.maxLines && typeof args.maxLines === 'number' && args.maxLines > 0) {
            const lines = lst.split('\n');
            const truncated = lines.slice(0, args.maxLines).join('\n');
            return {
              hasListing: true,
              totalLines: lines.length,
              displayedLines: Math.min(lines.length, args.maxLines),
              listing: truncated
            };
          }

          return {
            hasListing: true,
            totalLines: lst.split('\n').length,
            listing: lst
          };
        }
      });

      // build.get_diagnostics
      this.register({
        name: 'build.get_diagnostics',
        description: 'Возвращает текущие ошибки, предупреждения компилятора и статического анализатора кода для проекта или указанного файла.',
        parameters: {
          type: 'object',
          properties: {
            file: {
              type: 'string',
              description: 'Фильтровать ошибки по конкретному файлу (опционально).'
            }
          }
        },
        execute: async (args, registry) => {
          let diags = [];
          const ctx = registry._getContext();

          if (ctx && typeof ctx.getDiagnostics === 'function') {
            diags = ctx.getDiagnostics(args.file) || [];
          }

          if ((!diags || diags.length === 0) && Array.isArray(global.monacoMarkers)) {
            diags = global.monacoMarkers;
            if (args.file) {
              diags = diags.filter(d => !d.file || d.file === args.file);
            }
          }

          return {
            diagnostics: diags,
            count: diags.length,
            hasErrors: diags.some(d => d.severity === 1 || d.severity === 8 || d.severity === 'Error' || d.severityText === 'error')
          };
        }
      });

      // -----------------------------------------------------------------------
      // 3. Категория: emulator.*
      // -----------------------------------------------------------------------

      // emulator.run
      this.register({
        name: 'emulator.run',
        description: 'Загружает и запускает скомпилированную бинарную программу в виртуальном компьютере БК-0010 / БК-0011М.',
        parameters: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Имя запускаемого бинарного файла (.BIN) из проекта. Если не указано, берется последний скомпилированный файл.'
            },
            platform: {
              type: 'string',
              enum: ['БК0010', 'БК0011М'],
              description: 'Целевая конфигурация эмулятора БК.'
            }
          }
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu) throw new Error('Эмулятор БК недоступен.');

          const pm = registry._getProjectManager();
          let binData = null;
          let filename = args.filename;

          if (filename && pm) {
            const raw = pm.getAllFiles()[filename];
            if (raw instanceof Uint8Array || ArrayBuffer.isView(raw)) {
              binData = raw;
            }
          }

          // Если файл не указан явно, берем последний скомпилированный
          if (!binData && global.lastCompiledBin) {
            binData = global.lastCompiledBin;
            filename = filename || global.lastCompiledName || 'program.bin';
          }

          // Или ищем первый попавшийся .BIN файл в проекте
          if (!binData && pm) {
            const files = pm.getAllFiles();
            for (const [name, content] of Object.entries(files)) {
              if (name.toLowerCase().endsWith('.bin') && (content instanceof Uint8Array || ArrayBuffer.isView(content))) {
                binData = content;
                filename = name;
                break;
              }
            }
          }

          if (!binData) {
            throw new Error('Бинарный файл (.BIN) для запуска не найден. Сначала скомпилируйте проект с помощью build.compile.');
          }

          const platform = args.platform || (pm && pm.settings && pm.settings.platform === 'BK-0011M' ? 'БК0011М' : 'БК0010');
          const is11M = platform === 'БК0011М';

          if (typeof emu.setBoot === 'function') {
            emu.setBoot(is11M ? 'B11' : 'B10');
          }
          if (typeof emu.setPlatform === 'function') {
            emu.setPlatform(platform);
          }

          const ok = emu.runBinary(filename, binData, platform);
          if (!ok) {
            throw new Error('Не удалось передать бинарный файл во фрейм эмулятора.');
          }

          return {
            filename: filename,
            bytes: binData.length,
            platform: platform,
            message: `Программа "${filename}" (${binData.length} байт) успешно запущена в эмуляторе.`
          };
        }
      });

      // emulator.reset
      this.register({
        name: 'emulator.reset',
        description: 'Выполняет аппаратный сброс (Reset) процессора виртуального компьютера БК.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu) throw new Error('Эмулятор БК недоступен.');

          emu.reset();
          return {
            message: 'Сброс эмулятора выполнен.'
          };
        }
      });

      // emulator.getScreenShot
      this.register({
        name: 'emulator.getScreenShot',
        description: 'Делает снимок текущего графического экрана эмулятора БК.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu) throw new Error('Эмулятор БК недоступен.');
          if (typeof emu.debug !== 'function') throw new Error('Метод debug эмулятора недоступен.');

          const result = await emu.debug('getScreenShot');
          return {
            screenshot: result,
            hasData: Boolean(result)
          };
        }
      });

      // -----------------------------------------------------------------------
      // 4. Категория: debug.*
      // -----------------------------------------------------------------------

      // debug.get_registers
      this.register({
        name: 'debug.get_registers',
        description: 'Считывает текущие значения 16-битных регистров процессора К1801ВМ1 (R0-R7, SP, PC, флаги PSW).',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const regs = await emu.debug('getRegisters');
          return {
            registers: regs
          };
        }
      });

      // debug.read_memory
      this.register({
        name: 'debug.read_memory',
        description: 'Считывает блок 16-битных слов из памяти БК по указанному адресу.',
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: ['number', 'string'],
              description: 'Восьмеричный адрес (например, "01000", "0o1000", "40000") или число.'
            },
            length: {
              type: 'integer',
              description: 'Количество 16-битных слов для чтения (по умолчанию 16).'
            }
          },
          required: ['address']
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const addr = parseBKAddress(args.address);
          const len = (typeof args.length === 'number' && args.length > 0) ? Math.min(args.length, 256) : 16;

          const words = await emu.debug('readMemory', addr, len);
          return {
            address: '0' + addr.toString(8),
            length: len,
            words: words
          };
        }
      });

      // debug.disassemble
      this.register({
        name: 'debug.disassemble',
        description: 'Дизассемблирует машинный код памяти виртуальной БК в команды PDP-11 по указанному адресу.',
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: ['number', 'string'],
              description: 'Начальный адрес в памяти (восьмеричный, например "01000"). Если не указан, берется текущий PC.'
            },
            count: {
              type: 'integer',
              description: 'Количество инструкций для дизассемблирования (по умолчанию 16).'
            }
          }
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          let addr = 0;
          if (args.address !== undefined && args.address !== null) {
            addr = parseBKAddress(args.address);
          } else {
            addr = await emu.debug('getPC');
          }

          const count = (typeof args.count === 'number' && args.count > 0) ? Math.min(args.count, 64) : 16;
          const instructions = await emu.debug('disassemble', addr, count);

          return {
            address: '0' + addr.toString(8),
            count: count,
            instructions: instructions
          };
        }
      });

      // debug.step
      this.register({
        name: 'debug.step',
        description: 'Выполняет один шаг выполнения программы (Step Into) в отладчике виртуальной БК.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const res = await emu.debug('step');
          return {
            result: res,
            message: 'Выполнен 1 шаг.'
          };
        }
      });

      // debug.pause
      this.register({
        name: 'debug.pause',
        description: 'Приостанавливает выполнение виртуальной БК в отладчике.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const res = await emu.debug('pause');
          return {
            result: res,
            message: 'Исполнение приостановлено.'
          };
        }
      });

      // debug.continue
      this.register({
        name: 'debug.continue',
        description: 'Возобновляет непрерывное выполнение виртуальной БК в эмуляторе.',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const res = await emu.debug('continue');
          return {
            result: res,
            message: 'Исполнение возобновлено.'
          };
        }
      });

      // debug.set_breakpoint
      this.register({
        name: 'debug.set_breakpoint',
        description: 'Устанавливает точку останова (breakpoint) по указанному адресу в памяти БК.',
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: ['number', 'string'],
              description: 'Восьмеричный адрес точки останова (например "01000").'
            }
          },
          required: ['address']
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const addr = parseBKAddress(args.address);
          await emu.debug('setBreakpoint', addr);

          return {
            address: '0' + addr.toString(8),
            message: `Точка останова установлена на адресе 0${addr.toString(8)}.`
          };
        }
      });

      // debug.clear_breakpoint
      this.register({
        name: 'debug.clear_breakpoint',
        description: 'Удаляет точку останова (breakpoint) по указанному адресу в памяти БК.',
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: ['number', 'string'],
              description: 'Восьмеричный адрес точки останова.'
            }
          },
          required: ['address']
        },
        execute: async (args, registry) => {
          const emu = registry._getEmulatorBridge();
          if (!emu || typeof emu.debug !== 'function') {
            throw new Error('Отладчик эмулятора недоступен.');
          }

          const addr = parseBKAddress(args.address);
          await emu.debug('clearBreakpoint', addr);

          return {
            address: '0' + addr.toString(8),
            message: `Точка останова снята с адреса 0${addr.toString(8)}.`
          };
        }
      });

      // -----------------------------------------------------------------------
      // 5. Категория: graphics.* (Безопасный программный API работы с графикой БК)
      // -----------------------------------------------------------------------

      const getGfx = (registry) => {
        const g = registry._getGraphicsAI();
        if (!g) {
          throw new Error('Модуль BKGraphicsAI (bk-graphics-ai-api.js) не загружен.');
        }
        return g;
      };

      // graphics.create
      this.register({
        name: 'graphics.create',
        description: 'Создает новый холст БК в памяти. Если холст с таким именем уже существует, возвращает ошибку (для замены содержимого используй graphics.set). После вызова graphics.create используй graphics.set для заполнения изображения ASCII Matrix. Режимы: BK0010_COLOR (256x256, 4 цвета), BK0010_MONO (512x256, 2 цвета), BK0011M_COLOR.',
        parameters: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['BK0010_MONO', 'BK0010_COLOR', 'BK0011M_COLOR'],
              description: 'Графический режим БК.'
            },
            width: {
              type: 'integer',
              minimum: 1,
              maximum: 512,
              description: 'Ширина изображения в пикселях (для спрайтов 16, 32; для экрана 256 или 512).'
            },
            height: {
              type: 'integer',
              minimum: 1,
              maximum: 256,
              description: 'Высота изображения в пикселях (для спрайтов 16, 32; для экрана 256).'
            },
            paletteIndex: {
              type: 'integer',
              minimum: 0,
              maximum: 15,
              description: 'Номер палитры (0..15) для режима БК-0011М.'
            },
            name: {
              type: 'string',
              description: 'Имя ресурса / метки (например "PLAYER", "TITLE", "ICONS").'
            },
            copyFrom: {
              type: 'string',
              description: 'Имя существующего изображения или "true" (для активного), чтобы создать копию спрайта с сохранением пикселей.'
            }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).create(args);
          return {
            ok: true,
            success: true,
            message: `OK\ncreated ${res.width}x${res.height} ${res.mode}`,
            name: res.name,
            mode: res.mode,
            width: res.width,
            height: res.height
          };
        }
      });

      // graphics.get
      this.register({
        name: 'graphics.get',
        description: 'Возвращает полное изображение в виде ASCII Matrix. Используй ТОЛЬКО для небольших изображений и спрайтов (до 32x32). Для больших изображений и экранов предпочитай graphics.get_region для экономии контекста. Матрица содержит цветовые символы БК: "K" black (цвет 0), "B" blue (1), "G" green (2), "R" red (3).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально, по умолчанию активное).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).get(args);
          return {
            ok: true,
            success: true,
            name: res.name,
            width: res.width,
            height: res.height,
            mode: res.mode,
            matrix: res.matrix
          };
        }
      });

      // graphics.set
      this.register({
        name: 'graphics.set',
        description: 'Заполняет или заменяет изображение целиком с помощью ASCII Matrix. Не используй числовые массивы пикселей! Матрица содержит цветовые символы БК: "K" black (цвет 0), "B" blue (1), "G" green (2), "R" red (3). Пример матрицы 4x4:\nKKRR\nKRRR\nKKKK\nKKKK',
        parameters: {
          type: 'object',
          properties: {
            matrix: {
              type: 'string',
              description: 'ASCII-матрица изображения. Строки разделяются \\n. Символы цветов: "K" black (0), "B" blue (1), "G" green (2), "R" red (3).'
            },
            x: {
              type: 'integer',
              description: 'Начальная координата X левого верхнего угла (по умолчанию 0).'
            },
            y: {
              type: 'integer',
              description: 'Начальная координата Y левого верхнего угла (по умолчанию 0).'
            },
            name: {
              type: 'string',
              description: 'Имя изображения (опционально).'
            }
          },
          required: ['matrix']
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).set(args);
          return {
            ok: true,
            success: true,
            width: res.width,
            height: res.height,
            changed: res.changed,
            result: res.message,
            message: res.message
          };
        }
      });

      // graphics.patch
      this.register({
        name: 'graphics.patch',
        description: 'Точечно изменяет прямоугольную область изображения в координатах (x, y) через ASCII Matrix. Размеры определяются из матрицы. Матрица содержит цветовые символы БК: "K" black (цвет 0), "B" blue (1), "G" green (2), "R" red (3). Не вызывай graphics.get после patch, если tool result уже сообщает успешное изменение. Пример матрицы 4x3:\nKRRK\nRRRR\nKKKK',
        parameters: {
          type: 'object',
          properties: {
            x: {
              type: 'integer',
              description: 'Координата X левого верхнего угла патча.'
            },
            y: {
              type: 'integer',
              description: 'Координата Y левого верхнего угла патча.'
            },
            matrix: {
              type: 'string',
              description: 'ASCII-матрица патча. Строки разделяются \\n. Символы цветов: "K" black (0), "B" blue (1), "G" green (2), "R" red (3).'
            },
            name: {
              type: 'string',
              description: 'Имя изображения (опционально, по умолчанию активное).'
            }
          },
          required: ['x', 'y', 'matrix']
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).patch(args);
          return {
            ok: true,
            success: true,
            x: res.x,
            y: res.y,
            width: res.width,
            height: res.height,
            changed: res.changed,
            result: res.message,
            message: res.message
          };
        }
      });

      // graphics.fill
      this.register({
        name: 'graphics.fill',
        description: 'Заливает всё изображение или прямоугольник цветом по индексу: 0 (black/K), 1 (blue/B), 2 (green/G), 3 (red/R). Для рисования форм используй graphics.set или graphics.patch.',
        parameters: {
          type: 'object',
          properties: {
            colorIndex: { type: 'integer', description: 'Индекс цвета заливки БК: 0 (black/K), 1 (blue/B), 2 (green/G), 3 (red/R).' },
            x: { type: 'integer', description: 'Начальный X прямоугольника (опционально).' },
            y: { type: 'integer', description: 'Начальный Y прямоугольника (опционально).' },
            width: { type: 'integer', description: 'Ширина прямоугольника (опционально).' },
            height: { type: 'integer', description: 'Высота прямоугольника (опционально).' },
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          },
          required: ['colorIndex']
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).fill(args);
          return {
            ok: true,
            success: true,
            filledCount: res.filledCount,
            colorIndex: res.colorIndex !== undefined ? res.colorIndex : args.colorIndex
          };
        }
      });

      // graphics.info
      this.register({
        name: 'graphics.info',
        description: 'Возвращает метаданные изображения: ширина, высота, режим, палитра БК (без пикселей). Используй graphics.info для первичного ознакомления с изображением перед работой.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).getInfo(args);
          return {
            ok: true,
            success: true,
            name: res.name,
            width: res.width,
            height: res.height,
            mode: res.mode,
            palette: res.palette,
            paletteIndex: res.paletteIndex
          };
        }
      });

      // graphics.get_region
      this.register({
        name: 'graphics.get_region',
        description: 'Возвращает прямоугольную область изображения в виде ASCII Matrix. Рекомендуется для анализа перед точечным изменением: graphics.get_region → анализ → graphics.patch. Для больших изображений всегда предпочитай get_region вместо get. Матрица содержит цветовые символы БК: "K" black (цвет 0), "B" blue (1), "G" green (2), "R" red (3).',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'integer', description: 'Начальный X левого верхнего угла.' },
            y: { type: 'integer', description: 'Начальный Y левого верхнего угла.' },
            width: { type: 'integer', description: 'Ширина области.' },
            height: { type: 'integer', description: 'Высота области.' },
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          },
          required: ['x', 'y', 'width', 'height']
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).getRegion(args);
          return {
            ok: true,
            success: true,
            x: res.x,
            y: res.y,
            width: res.width,
            height: res.height,
            matrix: res.matrix
          };
        }
      });

      // graphics.export_asm
      this.register({
        name: 'graphics.export_asm',
        description: 'Экспортирует изображение в ассемблерный исходный код (.BYTE). Не возвращает бинарные данные в контекст. Для сохранения в файл проекта используй graphics.add_to_project.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Имя метки символа в ассемблере.' },
            radix: { type: 'integer', enum: [8, 10, 2], description: 'Система счисления чисел (8 - восьмеричная, 10 - десятичная, 2 - двоичная).' },
            bytesPerLine: { type: 'integer', description: 'Количество BYTE в одной строке.' },
            lineComments: { type: 'boolean', description: 'Добавлять комментарии с номерами строк Y.' },
            sizeComment: { type: 'boolean', description: 'Добавлять комментарий с размерами.' },
            spriteGrid: {
              type: 'object',
              description: 'Сетка для экспорта листа спрайтов: { cols, rows, spriteWidth, spriteHeight, count, symbolPrefix }.'
            },
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportAsm(args);
          return {
            ok: true,
            success: true,
            format: 'ASM',
            symbol: res.symbol,
            length: res.length,
            preview: res.text.slice(0, 300) + (res.text.length > 300 ? '\n; ...' : ''),
            message: `Готово. Ассемблерный код .ASM сгенерирован (${res.length} символов). Для записи в проект вызовите graphics.add_to_project.`
          };
        }
      });

      // graphics.export_mac
      this.register({
        name: 'graphics.export_mac',
        description: 'Экспортирует изображение в ассемблерный код формата MACRO-11 (.BYTE). Для сохранения в файл проекта используй graphics.add_to_project.',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Имя метки символа.' },
            radix: { type: 'integer', enum: [8, 10, 2] },
            bytesPerLine: { type: 'integer' },
            spriteGrid: { type: 'object' },
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportMac(args);
          return {
            ok: true,
            success: true,
            format: 'MAC',
            symbol: res.symbol,
            length: res.length,
            preview: res.text.slice(0, 300) + (res.text.length > 300 ? '\n; ...' : ''),
            message: `Готово. Ассемблерный код .MAC сгенерирован (${res.length} символов). Для записи в проект вызовите graphics.add_to_project.`
          };
        }
      });

      // graphics.export_bin
      this.register({
        name: 'graphics.export_bin',
        description: 'Формирует бинарный образ экрана БК (.BIN, 16388 байт с адресом 040000). Возвращает метаданные без дампа байтов в контекст. Для сохранения в проект используй graphics.add_to_project.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportBin(args);
          return {
            ok: true,
            success: true,
            format: 'BIN',
            byteLength: res.byteLength,
            startAddress: '040000',
            message: `Бинарный образ экрана БК сформирован (${res.byteLength} байт). Для сохранения в проект вызовите graphics.add_to_project.`
          };
        }
      });

      // graphics.export_dat
      this.register({
        name: 'graphics.export_dat',
        description: 'Формирует сырой дамп видеопамяти экрана БК (.DAT, 16384 байт без заголовка). Возвращает размер без передачи бинарных данных в контекст.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportDat(args);
          return {
            ok: true,
            success: true,
            format: 'DAT',
            byteLength: res.byteLength,
            message: `Сырой дамп видеопамяти экрана БК сформирован (${res.byteLength} байт).`
          };
        }
      });

      // graphics.export_bks
      this.register({
        name: 'graphics.export_bks',
        description: 'Формирует образ экрана БК-0011М (.BKS, 16389 байт с палитрой). Возвращает метаданные без дампа байтов в контекст.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportBks(args);
          return {
            ok: true,
            success: true,
            format: 'BKS',
            byteLength: res.byteLength,
            paletteIndex: res.paletteIndex,
            message: `Образ экрана .BKS сформирован (${res.byteLength} байт, палитра ${res.paletteIndex}).`
          };
        }
      });

      // graphics.export_png
      this.register({
        name: 'graphics.export_png',
        description: 'Экспортирует изображение/спрайт в формате .PNG и сохраняет его в проект (по умолчанию в папку "gfx"), чтобы человек мог визуально посмотреть на него своими глазами.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' },
            folder: { type: 'string', description: 'Папка в проекте (по умолчанию "gfx").' },
            scale: { type: 'integer', description: 'Масштаб пикселей при экспорте (1, 2, 4 и т.д., по умолчанию 1).' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).exportPng(Object.assign({ saveToProject: true }, args));
          return {
            ok: true,
            success: true,
            format: 'PNG',
            path: res.path || '',
            width: res.width,
            height: res.height,
            size: res.byteLength,
            message: res.path
              ? `Изображение PNG успешно сохранено в проект: "${res.path}" (${res.width}x${res.height}, ${res.byteLength} байт).`
              : `PNG сформирован (${res.width}x${res.height}, ${res.byteLength} байт).`
          };
        }
      });

      // graphics.save_state
      this.register({
        name: 'graphics.save_state',
        description: 'Сохраняет графическое состояние изображения в проект в формате .BKGfxState (по умолчанию в папку "gfx"), чтобы человек мог открыть и доработать его в графическом редакторе BKStudio.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя изображения (опционально).' },
            folder: { type: 'string', description: 'Папка в проекте (по умолчанию "gfx").' }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).saveState(Object.assign({ saveToProject: true }, args));
          const stateObj = res.state || {};
          const modelObj = stateObj.model || {};
          return {
            ok: true,
            success: true,
            format: 'BKGfxState',
            path: res.path || '',
            size: res.size || 0,
            name: modelObj.name || stateObj.name || '',
            width: stateObj.width || modelObj.width || 0,
            height: stateObj.height || modelObj.height || 0,
            mode: stateObj.mode || modelObj.mode || '',
            message: res.path
              ? `Состояние редактора (.BKGfxState) успешно сохранено в проект: "${res.path}". Откройте файл в редакторе BKStudio для доработки.`
              : 'Графическое состояние сохранено в памяти.'
          };
        }
      });

      // graphics.add_to_project
      this.register({
        name: 'graphics.add_to_project',
        description: 'Сохраняет графический ресурс в текущий проект BKStudio (форматы ASM, MAC, BIN, DAT, BKS, STATE, PNG). Поддерживает опции одновременного сохранения PNG (savePng: true) и состояния редактора (saveState: true).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Имя файла ресурса (например "title_screen" или "player_sprite").' },
            folder: { type: 'string', description: 'Папка в проекте (например "gfx" или "").' },
            format: {
              type: 'string',
              enum: ['ASM', 'MAC', 'BIN', 'DAT', 'BKS', 'STATE', 'PNG'],
              description: 'Формат сохраняемого ресурса (по умолчанию "ASM").'
            },
            savePng: {
              type: 'boolean',
              description: 'Автоматически сохранить рядом файл .PNG для просмотра человеком своими глазами.'
            },
            saveState: {
              type: 'boolean',
              description: 'Автоматически сохранить рядом файл состояния редактора .BKGfxState для доработки в BKStudio.'
            },
            insertInclude: {
              type: 'boolean',
              description: 'Автоматически вставить директиву .INCLUDE "путь" в активный asm-файл проекта.'
            },
            spriteGrid: {
              type: 'object',
              description: 'Сетка спрайтов { cols, rows, spriteWidth, spriteHeight, count, symbolPrefix }.'
            }
          }
        },
        execute: async (args, registry) => {
          const res = getGfx(registry).addToProject(args);
          let extraMsg = '';
          if (res.extraFiles && res.extraFiles.length > 0) {
            extraMsg = ' Также сохранены: ' + res.extraFiles.join(', ') + '.';
          }
          return {
            ok: true,
            success: true,
            path: res.path,
            format: res.format,
            size: res.size,
            included: res.included,
            pngPath: res.pngPath,
            statePath: res.statePath,
            message: `Ресурс "${res.path}" (${res.format}, ${res.size} байт) успешно сохранен в проект.${extraMsg}` + (res.included ? ' Директива .INCLUDE добавлена в активный файл.' : '')
          };
        }
      });
    }
  }

  // Создаем глобальный реестр инструментов
  const toolRegistry = new BKAIToolRegistry();

  global.BKAITool = BKAITool;
  global.BKAIToolRegistry = BKAIToolRegistry;
  global.bkAITools = toolRegistry;
  global.bkAIToolRegistry = toolRegistry;

  // Интеграция с BKAIManager (window.bkAI)
  if (global.bkAI) {
    global.bkAI.getTools = function () {
      return toolRegistry;
    };
    global.bkAI.executeTool = function (name, args) {
      return toolRegistry.execute(name, args);
    };
  }

})(typeof window !== 'undefined' ? window : this);
