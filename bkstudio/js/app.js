/**
 * BKStudio - Main Application Controller
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  let editor = null;
  let emulatorBridge = null;
  let currentListingText = '';
  let lastCompiledBin = null;
  let lastCompiledName = 'program.bin';

  // =====================================================================
  // Состояние режима отладки
  // =====================================================================
  let debugModeActive = false;
  let debugUpdateInterval = null;
  let prevRegisters = null; // предыдущие регистры для отображения old→new
  const PSW_FLAGS = ['N', 'Z', 'V', 'C']; // статусные флаги PSW

  // Карта адрес → номер строки исходника, строится из листинга после компиляции
  // Map<number_address, number_lineNumber>
  let lstAddressMap = new Map();
  // Обратная карта: номер строки → адрес
  let lstLineToAddress = new Map();

  function setPauseButtonActive(isPaused) {
    const btnPause = document.getElementById('btn-debug-pause');
    if (!btnPause) return;
    if (isPaused) {
      btnPause.classList.add('btn-paused');
      btnPause.classList.add('active');
    } else {
      btnPause.classList.remove('btn-paused');
      btnPause.classList.remove('active');
    }
  }

  /**
   * Запуск приложения после загрузки DOM
   */
  async function initApp() {
    console.log('[BKStudio] Запуск среды разработки...');

    // 1. Инициализация моста к эмулятору
    emulatorBridge = new BKEmulatorBridge('emulator-frame');
    global.bkEmulator = emulatorBridge;
    global.emulatorBridge = emulatorBridge;

    // Обработчик остановки эмулятора по точке breakpoint
    emulatorBridge.onBreak((pc) => {
      const octalStr = typeof pc === 'number' ? ('000000' + pc.toString(8)).slice(-6) : String(pc);
      logToConsole(`🛑 Остановка по точке breakpoint @ 0${octalStr}`, 'warning');
      if (!debugModeActive) {
        enableDebugMode();
      }
      
      setPauseButtonActive(true);
      updateDebugPanel();
      updateMemoryPanel();
      updateCurrentLine();
      debugView.lastDisasmPC = -1;
      updateDisassemblerPanel();
    });

    // 2. Инициализация Monaco Editor
    initMonaco();

    // 3. Привязка событий интерфейса
    setupUIEvents();
    setupSplitters();
    setupSamplesMenu();
    renderFileTree();
    renderTabs();

    // 4. Слушатель изменений в проекте
    global.bkProject.onChange((event, data) => {
      renderFileTree();
      renderTabs();
      if (event === 'file-selected' || event === 'project-reset' || event === 'tab-closed') {
        const file = global.bkProject.getActiveFile();
        if (editor && typeof file.content === 'string' && editor.getValue() !== file.content) {
          editor.setValue(file.content);
        }
        triggerLspDiagnostics();
      }
    });

    // 5. Предзагрузка WASM компилятора в фоне
    global.bkCompiler.init().then(() => {
      updateStatus('Компилятор BKTurbo8.wasm готов', false);
    }).catch(err => {
      updateStatus('Ошибка инициализации компилятора: ' + err.message, false);
    });

    // 6. Проверка URL-параметров ?src= (или ?URL=) и ?platform= (или ?PLATFORM=)
    const urlParams = new URLSearchParams(window.location.search);
    const srcParam = urlParams.get('src') || urlParams.get('URL') || urlParams.get('url');
    const platformParam = urlParams.get('platform') || urlParams.get('PLATFORM') || urlParams.get('Platform');
    if (srcParam) {
      loadProjectFromZipUrl(srcParam, platformParam);
    }

    // 7. Слушатель postMessage от встроенного эмулятора
    window.addEventListener('message', function (event) {
      if (!event.data || typeof event.data !== 'object') return;

      // Эмулятор вышел из полноэкранного режима — восстанавливаем размеры Monaco Editor
      if (event.data.type === 'EMULATOR_FULLSCREEN_EXIT') {
        // requestAnimationFrame — ждём завершения fullscreen-перехода в браузере
        requestAnimationFrame(() => {
          // Событие resize заставляет Monaco Editor пересчитать размеры
          window.dispatchEvent(new Event('resize'));
          if (editor && typeof editor.layout === 'function') {
            editor.layout();
          }
          // Повторно через 2000мс — на случай если браузер ещё не завершил transition
          setTimeout(() => {
            console.log('[BKStudio] resize event');
            window.dispatchEvent(new Event('resize'));
            if (editor && typeof editor.layout === 'function') {
              console.log('[BKStudio] layout event');
              editor.layout();
            }
          }, 2000);
        });
      }
    });
  }

  /**
   * Получение CSS правила для семейства шрифта
   */
  function getFontFamilyCSS(fontKey) {
    switch (fontKey) {
      case 'Iosevka Nerd Mono':
        return "'Iosevka Nerd Mono', 'Iosevka Term Nerd Font Mono', 'IosevkaTerm Nerd Font Mono', 'Iosevka Nerd Font', 'Iosevka', monospace";
      case 'JetBrains Mono':
        return "'JetBrains Mono', 'JetBrainsMono Nerd Font Mono', monospace";
      case 'Fira Code':
        return "'Fira Code', 'Fira Mono', monospace";
      case 'Cascadia Code':
        return "'Cascadia Code', 'Cascadia Mono', monospace";
      case 'Consolas':
        return "Consolas, 'Courier New', monospace";
      case 'Courier New':
        return "'Courier New', Courier, monospace";
      default:
        return `'${fontKey}', monospace`;
    }
  }

  /**
   * Настройка и запуск Monaco Editor
   */
  /**
   * Кастомный рендерер номеров строк в Monaco: в режиме отладки отображает адрес из .LST
   * @param {number} lineNumber 
   * @returns {string}
   */
  function getLineNumberDisplay(lineNumber) {
    if (debugView && debugView.active && lstLineToAddress && lstLineToAddress.has(lineNumber)) {
      const addr = lstLineToAddress.get(lineNumber);
      const addrOct = ('000000' + addr.toString(8)).slice(-6);
      return `${addrOct}  ${lineNumber}`;
    }
    return String(lineNumber);
  }

  function initMonaco() {
    if (typeof require === 'undefined') {
      console.error('[BKStudio] require.js не найден. Невозможно загрузить Monaco Editor.');
      return;
    }

    // Загрузка Monaco через встроенный loader (локальные файлы)
    require.config({
      paths: {
        'vs': new URL('libs/monaco/vs', window.location.href).href
      }
    });

    require(['vs/editor/editor.main'], function () {
      console.log('[BKStudio] Monaco Editor core loaded.');

      // Регистрируем синтаксис и провайдеры PDP-11
      if (typeof global.registerPdp11Language === 'function') {
        global.registerPdp11Language(monaco);
      }

      const container = document.getElementById('monaco-container');
      const activeFile = global.bkProject.getActiveFile();
      const savedTheme = localStorage.getItem('bkstudio_theme') || 'bk-crt-green';
      const savedFontFamily = localStorage.getItem('bkstudio_font_family') || 'Iosevka Nerd Mono';
      const savedFontSize = parseInt(localStorage.getItem('bkstudio_font_size') || '14', 10);

      editor = monaco.editor.create(container, {
        value: activeFile.content,
        language: 'pdp11-asm',
        theme: getMonacoThemeName(savedTheme),
        automaticLayout: true,
        fontSize: savedFontSize,
        fontFamily: getFontFamilyCSS(savedFontFamily),
        fontLigatures: true,
        tabSize: 8,
        insertSpaces: true,
        renderWhitespace: 'selection',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        glyphMargin: true,
        lineNumbers: getLineNumberDisplay,
        lineNumbersMinChars: 4,
        renderLineHighlight: 'all',
        bracketPairColorization: { enabled: true },
        hover: { enabled: true, delay: 150 },
        quickSuggestions: true
      });

      global.editor = editor;
      global.bkEditor = editor;

      // Применяем сохранённую тему к интерфейсу и эмулятору
      applyTheme(savedTheme);

      // Синхронизируем тему при загрузке фрейма эмулятора
      const emuIframe = document.getElementById('emulator-frame');
      if (emuIframe) {
        emuIframe.addEventListener('load', () => {
          const currentTheme = localStorage.getItem('bkstudio_theme') || 'bk-crt-green';
          emulatorBridge.setTheme(currentTheme);
        });
      }

      // Синхронизируем селекторы шрифта и размера в панели
      const fontFamSelect = document.getElementById('font-family-select');
      if (fontFamSelect) fontFamSelect.value = savedFontFamily;
      const fontSizeSelect = document.getElementById('font-size-select');
      if (fontSizeSelect) fontSizeSelect.value = String(savedFontSize);

      // Слушатель изменения текста в редакторе
      editor.onDidChangeModelContent(() => {
        const val = editor.getValue();
        global.bkProject.setFileContent(global.bkProject.activeFileName, val);
        updateCursorStatus();
        triggerLspDiagnostics();
      });

      editor.onDidChangeCursorPosition(() => {
        updateCursorStatus();
      });

      // Переход к метке по Ctrl+Клик или Alt+Клик мышью
      editor.onMouseDown((e) => {
        if ((e.event.ctrlKey || e.event.metaKey || e.event.altKey) && e.target && e.target.position) {
          const model = editor.getModel();
          if (!model) return;
          const word = model.getWordAtPosition(e.target.position);
          if (word && word.word) {
            jumpToDefinition(word.word);
          }
        }
      });

      // Горячие клавиши
      editor.addCommand(monaco.KeyCode.F9, () => compileAndRun());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => compileAndRun());
      editor.addCommand(monaco.KeyCode.F7, () => compileOnly());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => compileOnly());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        global.bkProject.saveToStorage();
        updateStatus('Проект сохранен в браузере', false);
      });
      editor.addCommand(monaco.KeyCode.F12, () => {
        const pos = editor.getPosition();
        if (pos) {
          const word = editor.getModel().getWordAtPosition(pos);
          if (word) jumpToDefinition(word.word);
        }
      });

      // Клик на glyph margin / line numbers — добавить/удалить точку останова
      editor.onMouseDown((e) => {
        if (!debugView.active) return;
        if (e.target && (
            e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
            e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
            e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
        )) {
          e.event.preventDefault();
          e.event.stopPropagation();
          const pos = e.target.position;
          if (pos && pos.lineNumber) {
            toggleBreakpointAtLine(pos.lineNumber);
          }
        }
      });

      // Первый запуск диагностики и построение дерева меток
      setTimeout(() => {
        triggerLspDiagnostics();
      }, 100);

      console.log('[BKStudio] Monaco Editor готов к работе.');
    });
  }

  let lspTimer = null;
  function triggerLspDiagnostics() {
    clearTimeout(lspTimer);
    lspTimer = setTimeout(runLspDiagnostics, 250);
  }

  /**
   * Запуск статического LSP-анализатора и расстановка маркеров ошибок
   */
  function runLspDiagnostics() {
    if (!editor || !global.PDP11_PARSER || !global.PDP11_ANALYZER) return;
    const model = editor.getModel();
    if (!model) return;
    const text = model.getValue();
    const platform = document.getElementById('platform-select')?.value || 'BK-0010';

    try {
      const ast = global.PDP11_PARSER.parseProgram(text);
      const analysis = global.PDP11_ANALYZER.analyzeProgram(ast, platform);

      const allDiagnostics = [...(ast.diagnostics || []), ...(analysis.diagnostics || [])];
      const markers = allDiagnostics.map(d => {
        const startLine = (d.range?.start?.line ?? 0) + 1;
        const startCol = (d.range?.start?.character ?? 0) + 1;
        const endLine = (d.range?.end?.line ?? d.range?.start?.line ?? 0) + 1;
        const endCol = (d.range?.end?.character ?? d.range?.start?.character ?? 20) + 1;

        return {
          severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
          source: 'PDP-11 LSP'
        };
      });

      monaco.editor.setModelMarkers(model, 'pdp11-lsp', markers);

      // Обновляем дерево меток (Outline)
      updateOutlineView(ast, analysis);

      // Обновляем статус
      const errCount = markers.filter(m => m.severity === monaco.MarkerSeverity.Error).length;
      const warnCount = markers.length - errCount;
      const statusText = document.getElementById('status-text');
      if (statusText) {
        if (errCount > 0) {
          statusText.innerHTML = `<span style="color: var(--accent-red);">Ошибок: ${errCount}</span>, пред: ${warnCount}`;
        } else if (warnCount > 0) {
          statusText.innerHTML = `<span style="color: var(--accent-amber);">Предупреждений: ${warnCount}</span>`;
        } else {
          statusText.textContent = 'Ошибок нет (LSP)';
        }
      }
    } catch (err) {
      console.warn('[BKStudio LSP] Ошибка анализа:', err);
    }
  }

  /**
   * Обновление панели Outline (список меток в левой панели)
   */
  function updateOutlineView(ast, analysis) {
    const outlineList = document.getElementById('outline-list');
    const countEl = document.getElementById('outline-count');
    if (!outlineList) return;

    const labels = [];
    const seen = new Set();

    // 1. Символы из анализатора
    if (analysis && analysis.symbols) {
      analysis.symbols.forEach((sym, name) => {
        const u = name.toUpperCase();
        if (!seen.has(u)) {
          seen.add(u);
          labels.push({ name: sym.displayName || name, line: (sym.line ?? 0) + 1 });
        }
      });
    }

    // 2. Сканируем текст регулярным выражением для меток
    if (editor) {
      const text = editor.getValue();
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\s*([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$):/);
        if (m) {
          const name = m[1];
          const u = name.toUpperCase();
          if (!seen.has(u)) {
            seen.add(u);
            labels.push({ name: name, line: i + 1 });
          }
        }
      }
    }

    // Сортировка по номеру строки
    labels.sort((a, b) => a.line - b.line);

    if (countEl) countEl.textContent = labels.length;

    if (labels.length === 0) {
      outlineList.innerHTML = '<li class="outline-empty" style="padding: 8px 12px; font-size: 11px; color: var(--text-muted);">Метки не найдены</li>';
      return;
    }

    outlineList.innerHTML = '';
    labels.forEach(lbl => {
      const li = document.createElement('li');
      li.className = 'file-item outline-item';
      li.title = `Перейти к метке ${lbl.name} (строка ${lbl.line})`;
      li.innerHTML = `
        <span style="color: var(--accent-green);">🏷️</span>
        <span style="font-weight: 600; color: var(--text-primary);">${lbl.name}</span>
        <span style="margin-left: auto; font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono);">:${lbl.line}</span>
      `;
      li.onclick = () => {
        if (editor) {
          editor.revealLineInCenter(lbl.line);
          editor.setPosition({ lineNumber: lbl.line, column: 1 });
          editor.focus();
        }
      };
      outlineList.appendChild(li);
    });
  }

  /**
   * Быстрый переход к метке в редакторе
   */
  function jumpToDefinition(target) {
    if (!editor) return;
    const cleanTarget = target.replace(/[:]/g, '').trim();
    const model = editor.getModel();
    if (!model) return;
    const text = model.getValue();
    const lines = text.split(/\r?\n/);
    const regex = new RegExp(`^\\s*(${cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}):`, 'i');

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        const targetLine = i + 1;
        editor.revealLineInCenter(targetLine);
        editor.setPosition({ lineNumber: targetLine, column: 1 });
        editor.focus();
        updateStatus(`Переход к метке: ${cleanTarget} (строка ${targetLine})`, false);
        return;
      }
    }
  }

  /**
   * Преобразование ключа темы в название темы Monaco
   */
  function getMonacoThemeName(themeKey) {
    const map = {
      'bk-crt-green': 'bk-crt-green',
      'bk-crt-amber': 'bk-crt-amber',
      'vs-dark': 'vs-dark-modern',
      'monokai': 'monokai-retro',
      'vs-light': 'vs-light-theme'
    };
    return map[themeKey] || 'bk-crt-green';
  }

  /**
   * Применение темы оформления ко всей среде BKStudio и встроенному эмулятору
   */
  function applyTheme(themeKey) {
    const monacoTheme = getMonacoThemeName(themeKey);
    if (typeof monaco !== 'undefined' && monaco.editor) {
      monaco.editor.setTheme(monacoTheme);
    }
    document.body.setAttribute('data-theme', themeKey);
    localStorage.setItem('bkstudio_theme', themeKey);

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect && themeSelect.value !== themeKey) {
      themeSelect.value = themeKey;
    }

    // Синхронизируем тему с встроенным эмулятором
    if (typeof emulatorBridge !== 'undefined' && emulatorBridge.setTheme) {
      emulatorBridge.setTheme(themeKey);
    }
  }

  /**
   * Сборка и запуск программы в эмуляторе
   */
  async function compileAndRun() {
    const res = await compileProject();
    if (res && res.success && res.binData) {
      logToConsole('Запуск скомпилированной программы в эмуляторе...', 'info');
      const filename = global.bkProject.activeFileName.replace(/\.[^/.]+$/, '') + '.bin';
      lastCompiledBin = res.binData;
      lastCompiledName = filename;

      // Устанавливаем целевую платформу БК перед запуском (БК0011М или БК0010)
      const platformVal = document.getElementById('platform-select').value;
      const is11M = (platformVal === 'BK-0011M');
      const platformStr = is11M ? 'БК0011М' : 'БК0010';

      emulatorBridge.setBoot(is11M ? 'B11' : 'B10');

      // Отправляем бинарник и точное наименование платформы в эмулятор для правильного автозапуска клавиш
      setTimeout(() => {
        emulatorBridge.runBinary(filename, res.binData, platformStr);
      }, 100);
      return res;
    }
    return res;
  }

  /**
   * Только сборка без автоматического запуска
   */
  async function compileOnly() {
    return await compileProject();
  }

  /**
   * Синхронизация UI элементов компилятора (селектора)
   */
  function updateCompilerUI(compilerName) {
    const select = document.getElementById('compiler-select');
    if (select && select.value !== compilerName) {
      select.value = compilerName;
    }
  }

  /**
   * Основной процесс компиляции (BKTurbo8.wasm или PDPy11 Pyodide)
   */
  async function compileProject() {
    if (!editor) return null;

    const compilerName = (typeof compilerBridge !== 'undefined') ? compilerBridge.getCompiler() : 'bkturbo8';
    updateCompilerUI(compilerName);

    clearConsole();
    updateStatus('Компиляция...', true);

    const files = global.bkProject.getAllFiles();
    const mainFile = global.bkProject.activeFileName;
    if (editor && mainFile) {
      files[mainFile] = editor.getValue();
    }
    const platform = document.getElementById('platform-select').value;
    const format = document.getElementById('format-select') ? document.getElementById('format-select').value : 'bin';
    const startAddress = document.getElementById('address-input').value.trim();

    // 1. Компиляция через PDPy11 (Python WASM)
    if (compilerName === 'pdpy11' && typeof compilerBridge !== 'undefined') {
      logToConsole('=== Сборка проекта с помощью PDPy11 (Python WASM) ===', 'info');
      const startTime = performance.now();

      try {
        const pdpyResult = await compilerBridge.compileWithPdpy11(mainFile, files, {
          startAddress,
          platform
        });

        const durationMs = Math.round(performance.now() - startTime);

        // Преобразуем ошибки в формат Monaco Editor
        const monacoErrors = (pdpyResult.errors || []).map(err => ({
          file: err.file || mainFile,
          line: err.line || 1,
          column: err.column || 1,
          message: err.message || 'Ошибка компиляции',
          severity: err.severity === 'Warning' ? 2 : 1
        }));

        updateMonacoMarkers(monacoErrors);

        // Выводим сообщения в консоль
        for (const err of (pdpyResult.errors || [])) {
          const type = err.severity === 'Warning' ? 'warning' : 'error';
          const loc = `${err.file || mainFile}:${err.line || 1}:${err.column || 1}`;
          logToConsole(`[PDPy11 ${err.severity}] ${loc}: ${err.message}`, type);
        }

        if (pdpyResult.success && (pdpyResult.bin || (pdpyResult.artifacts && Object.keys(pdpyResult.artifacts).length > 0))) {
          // Сохраняем все сгенерированные артефакты в состав файлов проекта
          if (pdpyResult.artifacts) {
            let artCount = 0;
            for (const [artName, artContent] of Object.entries(pdpyResult.artifacts)) {
              if (artContent) {
                global.bkProject.addArtifactFile(artName, artContent);
                artCount++;
              }
            }
            if (artCount > 0) {
              logToConsole(`Сгенерировано и сохранено артефактов в проект: ${artCount} (${Object.keys(pdpyResult.artifacts).join(', ')})`, 'info');
            }
          }

          let effectiveBin = pdpyResult.bin;
          let effectiveBinName = mainFile.replace(/\.[^/.]+$/, '') + '.bin';
          if (!effectiveBin && pdpyResult.artifacts) {
            for (const [aName, aData] of Object.entries(pdpyResult.artifacts)) {
              if (aName.toLowerCase().endsWith('.bin')) {
                effectiveBin = aData;
                effectiveBinName = aName;
                break;
              }
            }
          }

          lastCompiledBin = effectiveBin;
          lastCompiledName = effectiveBinName;
          currentListingText = pdpyResult.listing || '';
          document.getElementById('listing-output').textContent = currentListingText;

          // Перестраиваем карту адресов для debug view
          buildLstAddressMap(currentListingText);

          const baseOct = '0' + (pdpyResult.baseAddress || 0o1000).toString(8);
          const lenStr = (effectiveBin ? effectiveBin.length : 0) + ' байт';

          logToConsole(`Компиляция PDPy11 завершена успешно! Размер: ${lenStr}, Адрес: ${baseOct} (${durationMs} мс)`, 'info');
          updateStatus(`Сборка успешна (PDPy11): адрес ${baseOct}, длина ${lenStr} (${durationMs} мс)`, false);

          return {
            success: true,
            binData: effectiveBin,
            artifacts: pdpyResult.artifacts,
            loadAddress: pdpyResult.baseAddress,
            programLength: effectiveBin ? effectiveBin.length : 0,
            lstText: currentListingText,
            durationMs,
            errors: monacoErrors
          };
        } else {
          logToConsole(`Ошибка сборки PDPy11 (${(pdpyResult.errors || []).length} ошибок)`, 'error');
          updateStatus('Ошибка сборки PDPy11', false);
          switchBottomTab('console');
          return {
            success: false,
            errors: monacoErrors
          };
        }
      } catch (err) {
        logToConsole('Исключение при компиляции PDPy11: ' + err.message, 'error');
        updateStatus('Ошибка PDPy11: ' + err.message, false);
        return null;
      }
    }

    // 1.5. Компиляция через классический макроассемблер MACRO-11 (DEC) + pclink11 (WASM)
    if (compilerName === 'macro11' && typeof compilerBridge !== 'undefined') {
      logToConsole('=== Сборка проекта с помощью MACRO-11 & pclink11 (WASM) ===', 'info');
      const startTime = performance.now();

      try {
        const m11Result = await compilerBridge.compileWithMacro11(mainFile, files, {
          startAddress,
          platform,
          onLog: (msg, type) => logToConsole(msg, type)
        });

        const durationMs = m11Result.durationMs || Math.round(performance.now() - startTime);

        // Преобразуем ошибки в формат Monaco Editor
        const monacoErrors = (m11Result.errors || []).map(err => ({
          file: err.file || mainFile,
          line: err.line || 1,
          column: err.column || 1,
          message: err.message || 'Ошибка сборки MACRO-11',
          severity: err.severity === 'Warning' ? 2 : 1
        }));

        updateMonacoMarkers(monacoErrors);

        for (const err of (m11Result.errors || [])) {
          const type = err.severity === 'Warning' ? 'warning' : 'error';
          const loc = `${err.file || mainFile}:${err.line || 1}:${err.column || 1}`;
          logToConsole(`[MACRO-11 ${err.severity || 'Error'}] ${loc}: ${err.message}`, type);
        }

        if (m11Result.success && m11Result.binData) {
          // Сохраняем все артефакты (BIN, OBJ, LST, MAP) в файлы проекта
          if (m11Result.artifacts) {
            let artCount = 0;
            for (const [artName, artContent] of Object.entries(m11Result.artifacts)) {
              if (artContent) {
                global.bkProject.addArtifactFile(artName, artContent);
                artCount++;
              }
            }
            logToConsole(`Сгенерировано и сохранено артефактов в проект: ${artCount} (${Object.keys(m11Result.artifacts).join(', ')})`, 'info');
          }

          lastCompiledBin = m11Result.binData;
          lastCompiledName = m11Result.binFileName;
          currentListingText = m11Result.listingData || '';
          document.getElementById('listing-output').textContent = currentListingText;

          // Перестраиваем карту адресов для debug view
          buildLstAddressMap(currentListingText);

          // Статический анализ машинного кода MACRO-11
          runBKStaticAnalysis(
            currentListingText,
            'macro11',
            mainFile
          );

          const baseOct = m11Result.loadAddress !== null ? '0' + m11Result.loadAddress.toString(8) : 'N/A';
          const lenStr = m11Result.binData.length + ' байт';

          logToConsole(`Компиляция MACRO-11 завершена успешно! Размер: ${lenStr}, Адрес: ${baseOct} (${durationMs} мс)`, 'info');
          updateStatus(`Сборка успешна (MACRO-11): адрес ${baseOct}, длина ${lenStr} (${durationMs} мс)`, false);

          return {
            success: true,
            binData: m11Result.binData,
            artifacts: m11Result.artifacts,
            loadAddress: m11Result.loadAddress,
            programLength: m11Result.binData.length,
            lstText: currentListingText,
            durationMs,
            errors: monacoErrors
          };
        } else {
          logToConsole(`Ошибка сборки MACRO-11 (${(m11Result.errors || []).length} ошибок)`, 'error');
          updateStatus('Ошибка сборки MACRO-11', false);
          switchBottomTab('console');
          return {
            success: false,
            errors: monacoErrors
          };
        }
      } catch (err) {
        logToConsole('Исключение при компиляции MACRO-11: ' + err.message, 'error');
        updateStatus('Ошибка MACRO-11: ' + err.message, false);
        return null;
      }
    }

    // 2. Компиляция через BKTurbo8.wasm (по умолчанию)
    logToConsole('=== Сборка проекта с помощью BKTurbo8.wasm ===', 'info');

    try {
      const result = await global.bkCompiler.compile({
        files,
        mainFile,
        platform,
        format,
        startAddress,
        listing: true,
        onLog: (line, type) => {
          logToConsole(line, type);
        }
      });

      // Обновляем маркеры ошибок в Monaco
      updateMonacoMarkers(result.errors || []);

      if (result.success) {
        lastCompiledBin = result.binData;
        lastCompiledName = mainFile.replace(/\.[^/.]+$/, '') + '.' + format;
        currentListingText = result.lstText || '';
        document.getElementById('listing-output').textContent = currentListingText;

        // Перестраиваем карту адресов для debug view
        buildLstAddressMap(currentListingText);

        // Статический анализ машинного кода BKTurbo8
        runBKStaticAnalysis(
          currentListingText,
          'bkturbo8',
          mainFile
        );

        // Сохраняем все сгенерированные артефакты в состав файлов проекта
        if (result.artifacts) {
          let artCount = 0;
          for (const [artName, artContent] of Object.entries(result.artifacts)) {
            if (artContent) {
              global.bkProject.addArtifactFile(artName, artContent);
              artCount++;
            }
          }
          if (artCount > 0) {
            logToConsole(`Сгенерировано и сохранено артефактов в проект: ${artCount} (${Object.keys(result.artifacts).join(', ')})`, 'info');
          }
        }

        const addrStr = result.loadAddress !== null ? '0' + result.loadAddress.toString(8) : 'N/A';
        const lenStr = result.programLength !== null ? result.programLength + ' байт' : (result.binData ? result.binData.length + ' байт' : '0');

        updateStatus(`Сборка успешна: адрес ${addrStr}, длина ${lenStr} (${result.durationMs} мс)`, false);
        return result;
      } else {
        updateStatus(`Ошибка сборки (${(result.errors || []).length} ошибок)`, false);
        // Переключаемся на вкладку консоли
        switchBottomTab('console');
        return result;
      }
    } catch (err) {
      logToConsole('Исключение при компиляции: ' + err.message, 'error');
      updateStatus('Ошибка: ' + err.message, false);
      return null;
    }
  }

  /**
   * Обновление маркеров ошибок в редакторе
   */
  function updateMonacoMarkers(errors) {
    if (!editor || typeof monaco === 'undefined') return;

    const model = editor.getModel();
    if (!model) return;

    const markers = errors.map(err => {
      const line = Math.max(1, err.line || 1);
      const lineLen = model.getLineLength(line);
      return {
        severity: monaco.MarkerSeverity.Error,
        message: err.message + (err.code ? ` (Код ${err.code})` : ''),
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: Math.max(1, lineLen + 1)
      };
    });

    monaco.editor.setModelMarkers(model, 'bkturbo8', markers);
  }

  /**
   * Запуск статического анализа машинного кода по .LST.
   *
   * Анализатор пока работает только для:
   *   - BKTurbo8
   *   - MACRO-11
   *
   * Результаты публикуются в Monaco отдельным owner:
   *   "bk-static-analyzer"
   *
   */
  function runBKStaticAnalysis(listingText, compilerName, mainFile) {

    if (typeof window.bkStaticAnalyzer === 'undefined') {
      console.warn(
        '[BK Static Analyzer] Анализатор не подключен.'
      );

      return {
        success: false,
        warnings: 0,
        diagnostics: []
      };
    }

    if (
      compilerName !== 'bkturbo8' &&
      compilerName !== 'macro11'
    ) {
      clearBKStaticAnalysisMarkers();

      return {
        success: true,
        skipped: true,
        reason: 'unsupported-compiler',
        warnings: 0,
        diagnostics: []
      };
    }

    if (
      typeof listingText !== 'string' ||
      listingText.trim().length === 0
    ) {
      clearBKStaticAnalysisMarkers();

      return {
        success: true,
        skipped: true,
        reason: 'empty-listing',
        warnings: 0,
        diagnostics: []
      };
    }

    try {

      const result =
        window.bkStaticAnalyzer.analyze(
          listingText,
          {
            file: mainFile || null
          }
        );

      if (!result || !Array.isArray(result.diagnostics)) {

        clearBKStaticAnalysisMarkers();

        return {
          success: false,
          warnings: 0,
          diagnostics: []
        };
      }

      /*
       * Monaco-маркеры текущей модели.
       */
      if (
        typeof monaco !== 'undefined' &&
        monaco.editor &&
        editor
      ) {

        const model = editor.getModel();

        if (model) {

          const markers = result.diagnostics.map(
            diagnostic => {

              const line =
                Math.max(
                  1,
                  diagnostic.line || 1
                );

              const maxLine =
                model.getLineCount();

              const safeLine =
                Math.min(
                  line,
                  maxLine
                );

              const lineLength =
                model.getLineLength(
                  safeLine
                );

              const startColumn = 1;

              /*
               * Для двухстрочных предупреждений
               * подсвечиваем первую строку.
               *
               * Основное сообщение относится к первой
               * инструкции конструкции.
               */
              const endColumn =
                Math.max(
                  2,
                  Math.min(
                    lineLength + 1,
                    200
                  )
                );

              let message =
                diagnostic.message || '';

              if (
                diagnostic.address !== null &&
                diagnostic.address !== undefined
              ) {
                const addressOctal =
                  diagnostic.address
                    .toString(8)
                    .padStart(6, '0');

                message +=
                  ` [адрес 0${addressOctal}]`;
              }

              return {
                severity:
                  monaco.MarkerSeverity.Warning,

                message,

                startLineNumber:
                  safeLine,

                startColumn,

                endLineNumber:
                  safeLine,

                endColumn,

                source:
                  `BK Static Analyzer ${window.bkStaticAnalyzer.version}`,

                code:
                  diagnostic.rule || undefined
              };
            }
          );

          monaco.editor.setModelMarkers(
            model,
            'bk-static-analyzer',
            markers
          );
        }
      }

      /*
       * Пишем краткий результат в консоль.
       */
      if (result.warnings > 0) {

        logToConsole(
          `[BK Static Analyzer] Найдено предупреждений: ${result.warnings}`,
          'warning'
        );

        for (const diagnostic of result.diagnostics) {

          const location =
            `${diagnostic.file || mainFile || 'source'}:${diagnostic.line}`;

          logToConsole(
            `[BK Analyzer] ${location}: ${diagnostic.message}`,
            'warning'
          );
        }

      } else {

        logToConsole(
          `[BK Static Analyzer] Анализ завершён: подозрительных мест не найдено.`,
          'success'
        );
      }

      /*
       * Обновляем статус только если нет ошибок компиляции.
       *
       * Не перезаписываем здесь основной status-text,
       * чтобы не мешать существующей логике BKStudio.
       */

      return result;

    } catch (error) {

      console.warn(
        '[BK Static Analyzer] Ошибка анализа:',
        error
      );

      clearBKStaticAnalysisMarkers();

      return {
        success: false,
        warnings: 0,
        diagnostics: [],
        error: error.message
      };
    }
  }


  /**
  * Удалить только предупреждения BK Static Analyzer.
  * Ошибки компилятора и LSP не затрагиваются.
  */
  function clearBKStaticAnalysisMarkers() {

    if (
      typeof monaco === 'undefined' ||
      !monaco.editor ||
      !editor
    ) {
      return;
    }

    const model = editor.getModel();

    if (!model) {
      return;
    }

    monaco.editor.setModelMarkers(
      model,
      'bk-static-analyzer',
      []
    );
  }

  /**
   * Вывод сообщений в консоль
   */
  function logToConsole(text, type = 'stdout') {
    const consoleEl = document.getElementById('console-output');
    if (!consoleEl) return;

    const div = document.createElement('div');
    div.className = 'log-' + type;
    div.textContent = text;

    // Ищем имя файла, строку и колонку в тексте ошибки:
    // 1. "main.asm:15:2:" или "[PDPy11 Error] main.asm:15:1: Unknown opcode"
    // 2. "Line 5 (Addr: 0001010) - Error 105: ..." или "Line 12: Ошибка"
    // 3. "line 15"
    let targetFile = null;
    let lineNum = null;
    let colNum = 1;

    const fileLineMatch = text.match(/(?:\[.*?\]\s*)?([a-zA-Z0-9_\-./\\]+\.(?:asm|mac|inc|txt|s|mac11|pdp11|b10|b11|lst))\s*:\s*(\d+)(?::(\d+))?/i);
    if (fileLineMatch) {
      targetFile = fileLineMatch[1].replace(/^[./\\]+/, '');
      lineNum = parseInt(fileLineMatch[2], 10);
      if (fileLineMatch[3]) colNum = parseInt(fileLineMatch[3], 10);
    } else {
      const lineMatch = text.match(/(?:^|\s)Line\s+(\d+)(?::(\d+))?/i) || text.match(/(?:^|\s)line\s+(\d+)/i);
      if (lineMatch) {
        lineNum = parseInt(lineMatch[1], 10);
        if (lineMatch[2]) colNum = parseInt(lineMatch[2], 10);
      }
    }

    if (lineNum !== null && !isNaN(lineNum) && lineNum > 0) {
      div.classList.add('log-clickable');
      const locStr = targetFile ? `${targetFile}:${lineNum}:${colNum}` : `строке ${lineNum}`;
      div.title = `Нажмите для перехода к ${locStr}`;

      div.onclick = () => {
        if (!editor) return;

        // Если указан файл и он есть в проекте — открываем его
        if (targetFile && global.bkProject) {
          const files = global.bkProject.getAllFiles();
          let matchedName = null;
          for (const fname of Object.keys(files)) {
            if (fname.toLowerCase() === targetFile.toLowerCase() || fname.toLowerCase().endsWith('/' + targetFile.toLowerCase())) {
              matchedName = fname;
              break;
            }
          }
          if (matchedName && matchedName !== global.bkProject.activeFileName) {
            global.bkProject.openFileInTab(matchedName);
          }
        }

        setTimeout(() => {
          if (editor) {
            editor.revealLineInCenter(lineNum);
            editor.setPosition({ lineNumber: lineNum, column: colNum || 1 });
            editor.focus();
          }
        }, 50);
      };
    }

    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function clearConsole() {
    const consoleEl = document.getElementById('console-output');
    if (consoleEl) consoleEl.innerHTML = '';
  }

  /**
   * Обновление статус-бара
   */
  function updateStatus(text, isCompiling = false) {
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      if (isCompiling) statusDot.classList.add('compiling');
      else statusDot.classList.remove('compiling');
    }
  }

  function updateCursorStatus() {
    if (!editor) return;
    const pos = editor.getPosition();
    const el = document.getElementById('status-pos');
    if (el && pos) {
      el.textContent = `Стр ${pos.lineNumber}, Кол ${pos.column}`;
    }
  }

  /**
   * Запуск бинарного файла напрямую из списка файлов проекта
   */
  function runBinaryFile(name, content) {
    if (!content) {
      alert(`Файл ${name} пуст.`);
      return;
    }

    let binData = null;
    if (content instanceof Uint8Array) {
      binData = content;
    } else if (ArrayBuffer.isView(content)) {
      binData = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
    } else if (typeof content === 'string') {
      binData = new Uint8Array(content.length);
      for (let i = 0; i < content.length; i++) {
        binData[i] = content.charCodeAt(i) & 0xff;
      }
    } else if (content && typeof content === 'object' && content.__binary && content.data) {
      const binary = atob(content.data);
      binData = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        binData[i] = binary.charCodeAt(i);
      }
    }

    if (!binData || binData.length === 0) {
      alert(`Не удалось прочитать двоичные данные файла ${name}.`);
      return;
    }

    lastCompiledBin = binData;
    lastCompiledName = name;

    const platformVal = document.getElementById('platform-select').value;
    const is11M = (platformVal === 'BK-0011M');
    const platformStr = is11M ? 'БК0011М' : 'БК0010';

    emulatorBridge.setBoot(is11M ? 'B11' : 'B10');

    logToConsole(`Запуск бинарного файла ${name} (${binData.length} байт, ${platformStr}) в эмуляторе...`, 'info');
    updateStatus(`Запуск ${name} в эмуляторе...`, false);

    setTimeout(() => {
      emulatorBridge.runBinary(name, binData, platformStr);
    }, 100);
  }

  /**
   * Отрисовка дерева файлов в боковой панели
   */
  function renderFileTree() {
    const list = document.getElementById('file-list');
    if (!list) return;

    list.innerHTML = '';
    const files = global.bkProject.getAllFiles();
    const active = global.bkProject.activeFileName;

    for (const name of Object.keys(files)) {
      const lower = name.toLowerCase();
      const isBin = lower.endsWith('.bin');
      let icon = '📄';
      if (isBin) icon = '💾';
      else if (lower.endsWith('.raw') || lower.endsWith('.sav') || lower.endsWith('.rom')) icon = '⚙️';
      else if (lower.endsWith('.obj')) icon = '📦';
      else if (lower.endsWith('.map')) icon = '🗺️';
      else if (lower.endsWith('.wav')) icon = '📼';
      else if (lower.endsWith('.lst')) icon = '📋';
      else if (lower.endsWith('.mac') || lower.endsWith('.asm')) icon = '📄';
      else if (lower.endsWith('.inc')) icon = '📑';
      else if (lower.endsWith('.txt') || lower.endsWith('.doc')) icon = '📝';

      const li = document.createElement('li');
      li.className = 'file-item' + (name === active ? ' active' : '') + (isBin ? ' is-bin' : '');

      let runBinBtn = '';
      if (isBin) {
        runBinBtn = `<button class="icon-btn btn-run-file" title="Запустить ${name} в эмуляторе">▶</button>`;
      }

      li.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name" title="${name}">${name}</span>
        <div class="file-actions">
          ${runBinBtn}
          <button class="icon-btn btn-rename" title="Переименовать">✏️</button>
          <button class="icon-btn btn-delete" title="Удалить">🗑️</button>
        </div>
      `;

      li.onclick = (e) => {
        if (e.target.closest('.file-actions')) return;
        if (isBin) {
          runBinaryFile(name, files[name]);
          return;
        }
        global.bkProject.openFileInTab(name);
      };

      if (isBin) {
        const btnRun = li.querySelector('.btn-run-file');
        if (btnRun) {
          btnRun.onclick = (e) => {
            e.stopPropagation();
            runBinaryFile(name, files[name]);
          };
        }
      }

      const btnRename = li.querySelector('.btn-rename');
      btnRename.onclick = (e) => {
        e.stopPropagation();
        const newName = prompt('Новое имя файла:', name);
        if (newName && newName !== name) {
          global.bkProject.renameFile(name, newName);
        }
      };

      const btnDel = li.querySelector('.btn-delete');
      btnDel.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Удалить файл ${name}?`)) {
          global.bkProject.deleteFile(name);
        }
      };

      list.appendChild(li);
    }
  }

  /**
   * Отрисовка вкладок над редактором
   */
  function renderTabs() {
    const container = document.getElementById('editor-tabs');
    if (!container) return;

    container.innerHTML = '';
    const openTabs = global.bkProject.openTabs || [global.bkProject.activeFileName];
    const active = global.bkProject.activeFileName;

    for (const name of openTabs) {
      const tab = document.createElement('div');
      tab.className = 'tab' + (name === active ? ' active' : '');
      tab.innerHTML = `
        <span>${name}</span>
        <span class="tab-close" title="Закрыть вкладку">×</span>
      `;

      tab.onclick = (e) => {
        if (e.target.classList.contains('tab-close')) return;
        global.bkProject.setActiveFile(name);
      };

      tab.querySelector('.tab-close').onclick = (e) => {
        e.stopPropagation();
        global.bkProject.closeTab(name);
      };

      container.appendChild(tab);
    }
  }

  /**
   * Настройка меню примеров
   */
  function setupSamplesMenu() {
    const select = document.getElementById('samples-select');
    if (!select || !global.BK_SAMPLES) return;

    select.innerHTML = '<option value="">-- Выберите пример программы --</option>';
    global.BK_SAMPLES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `[${s.platform}] ${s.title}`;
      select.appendChild(opt);
    });

    select.onchange = () => {
      const sampleId = select.value;
      if (!sampleId) return;
      if (confirm('Загрузить выбранный пример? Текущий проект будет заменен.')) {
        global.bkProject.loadSample(sampleId, true);
        const sample = global.BK_SAMPLES.find(s => s.id === sampleId);
        if (sample && sample.platform) {
          const platformSelect = document.getElementById('platform-select');
          if (platformSelect) {
            platformSelect.value = sample.platform;
          }
          const is11M = (sample.platform === 'BK-0011M');
          emulatorBridge.setPlatform(is11M ? 'БК0011М' : 'БК0010');
          emulatorBridge.setBoot(is11M ? 'B11' : 'B10');
        }

        // Настраиваем целевой компилятор для сэмпла (pdpy11 или bkturbo8 по умолчанию)
        const targetCompiler = (sample && sample.compiler) ? sample.compiler : 'bkturbo8';
        if (typeof compilerBridge !== 'undefined') {
          compilerBridge.setCompiler(targetCompiler);
          updateCompilerUI(targetCompiler);
        }
      }
      select.value = '';
    };
  }

  /**
   * Привязка кнопок тулбара и действий
   */
  function setupUIEvents() {
    // Кнопка «Собрать и запустить» (F9)
    document.getElementById('btn-run').onclick = () => compileAndRun();

    // Селектор компилятора (BKTurbo8 / PDPy11)
    const compilerSelect = document.getElementById('compiler-select');
    if (compilerSelect && typeof compilerBridge !== 'undefined') {
      const savedCompiler = compilerBridge.getCompiler();
      updateCompilerUI(savedCompiler);

      compilerBridge.onStatus((statusMsg) => {
        logToConsole('[PDPy11] ' + statusMsg, 'info');
        updateStatus(statusMsg, false);
      });

      compilerSelect.onchange = () => {
        const val = compilerSelect.value;
        compilerBridge.setCompiler(val);
        updateCompilerUI(val);
        const compTitle = (val === 'macro11') ? 'MACRO-11 (DEC) + pclink11 (WASM)' : ((val === 'pdpy11') ? 'PDPy11 (Python WASM)' : 'BKTurbo8 (C++ WASM)');
        logToConsole(`Выбран компилятор: ${compTitle}`, 'info');
        updateStatus(`Активный компилятор: ${compTitle}`, false);
      };
    }

    // Кнопка «Собрать» (F7) если присутствует в DOM
    const btnCompile = document.getElementById('btn-compile');
    if (btnCompile) {
      btnCompile.onclick = () => compileOnly();
    }

    // Кнопка «Скачать проект в .ZIP»
    const btnDownloadZip = document.getElementById('btn-download-zip') || document.getElementById('btn-download-bin');
    if (btnDownloadZip) {
      btnDownloadZip.onclick = async () => {
        if (typeof JSZip === 'undefined') {
          alert('Библиотека JSZip не загружена.');
          return;
        }
        try {
          const zip = new JSZip();
          const files = global.bkProject.getAllFiles();
          const keys = Object.keys(files);
          if (keys.length === 0) {
            alert('В проекте нет файлов для скачивания.');
            return;
          }

          for (const [name, content] of Object.entries(files)) {
            if (typeof content === 'string') {
              zip.file(name, content);
            } else if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
              zip.file(name, content, { binary: true });
            } else if (content && typeof content === 'object' && content.__binary && content.data) {
              const binary = atob(content.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              zip.file(name, bytes, { binary: true });
            }
          }

          if (lastCompiledBin && !files[lastCompiledName]) {
            zip.file(lastCompiledName, lastCompiledBin, { binary: true });
          }
          if (currentListingText) {
            const baseName = (global.bkProject.activeFileName || 'program').replace(/\.[^/.]+$/, '');
            if (!files[baseName + '.lst']) {
              zip.file(baseName + '.lst', currentListingText);
            }
          }

          const baseName = (global.bkProject.activeFileName || 'bk_project').replace(/\.[^/.]+$/, '');
          let blob;
          if (typeof zip.generateAsync === 'function') {
            blob = await zip.generateAsync({ type: 'blob' });
          } else {
            blob = zip.generate({ type: 'blob' });
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = baseName + '.zip';
          a.click();
          URL.revokeObjectURL(url);
          updateStatus(`Проект упакован и скачан: ${baseName}.zip (${keys.length} файлов)`, false);
        } catch (err) {
          console.error('[BKStudio] Ошибка создания ZIP:', err);
          alert('Ошибка при формировании архива проекта: ' + err.message);
        }
      };
    }

    // Кнопка «Загрузить проект (.ZIP)»
    const btnUploadZip = document.getElementById('btn-upload-zip');
    const fileUploadZipInput = document.getElementById('file-upload-zip-input');
    if (btnUploadZip && fileUploadZipInput) {
      btnUploadZip.onclick = () => {
        fileUploadZipInput.click();
      };
      fileUploadZipInput.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          logToConsole(`Чтение выбранного архива: ${file.name}...`, 'info');
          updateStatus(`Чтение архива ${file.name}...`, true);
          const arrayBuffer = await file.arrayBuffer();
          await loadProjectFromZipBuffer(arrayBuffer, file.name);
        } catch (err) {
          console.error('[BKStudio] Ошибка чтения ZIP-файла:', err);
          logToConsole(`Ошибка при открытии ZIP: ${err.message}`, 'error');
          updateStatus(`Ошибка: ${err.message}`, false);
        } finally {
          fileUploadZipInput.value = '';
        }
      };
    }

    // Кнопка добавления нового файла
    document.getElementById('btn-new-file').onclick = () => {
      const name = prompt('Имя нового файла (например subroutines.asm):', 'code.asm');
      if (name) {
        global.bkProject.createFile(name, '; Новый файл модуля\n');
      }
    };

    // Управление эмулятором
    document.getElementById('btn-emu-reset').onclick = () => emulatorBridge.reset();
    document.getElementById('btn-emu-reload').onclick = () => emulatorBridge.reload();

    // Переключение вкладок нижней панели
    document.querySelectorAll('.bottom-tab').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.dataset.tab;
        console.log('[BKStudio Debug] Bottom tab click:', tab);
        if (tab === 'debug') {
          // Вкладка debug — переключает режим отладки
          console.log('[BKStudio Debug] Toggling debug mode...');
          toggleDebugMode();
        } else {
          switchBottomTab(tab);
        }
      };
    });

    // Кнопка выключения режима отладки в sidebar
    const btnDebugDisable = document.getElementById('btn-debug-disable');
    if (btnDebugDisable) {
      btnDebugDisable.onclick = () => {
        disableDebugMode();
      };
    }

    // =====================================================================
    // Обработчики переключения формата чисел (OCT/DEC/BIN)
    // =====================================================================
    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.onclick = () => {
        numFormat = btn.dataset.format;
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Перерисовываем все панели
        if (debugModeActive) {
          updateDebugPanel();
          updateMemoryPanel();
        }
      };
    });

    // =====================================================================
    // Обработчики кнопок управления отладкой
    // =====================================================================
    const btnPause = document.getElementById('btn-debug-pause');
    const btnStep = document.getElementById('btn-debug-step');
    const btnContinue = document.getElementById('btn-debug-continue');
    const btnReset = document.getElementById('btn-debug-reset');
    const btnResetClear = document.getElementById('btn-debug-reset-clear');

    function debugAction(method, label) {
      return async () => {
        try {
          if (method === 'pause' || method === 'step') {
            setPauseButtonActive(true);
          } else if (method === 'continue' || method === 'reset' || method === 'resetAndClear') {
            setPauseButtonActive(false);
          }
          const result = await emulatorBridge.debug(method);
          logToConsole(`[Debug] ${label}: ${JSON.stringify(result)}`, 'info');
          if (method === 'continue') {
            setPauseButtonActive(false);
          } else if (method === 'pause' || method === 'step') {
            setPauseButtonActive(true);
            updateDebugPanel();
            updateMemoryPanel();
            updateCurrentLine();
            debugView.lastDisasmPC = -1;
            updateDisassemblerPanel();
          }
        } catch (err) {
          logToConsole(`[Debug] Ошибка ${label}: ${err.message}`, 'error');
        }
      };
    }

    if (btnPause) btnPause.onclick = debugAction('pause', 'Pause');
    if (btnStep) btnStep.onclick = debugAction('step', 'Step');
    if (btnContinue) btnContinue.onclick = debugAction('continue', 'Continue');
    if (btnReset) btnReset.onclick = debugAction('reset', 'Reset');
    if (btnResetClear) btnResetClear.onclick = debugAction('resetAndClear', 'Reset & Clear');

    // =====================================================================
    // Обработчики Memory Viewer
    // =====================================================================

    // Кнопки Follow PC / SP / Manual
    const btnFollowPc = document.getElementById('btn-follow-pc');
    const btnFollowSp = document.getElementById('btn-follow-sp');
    const btnFollowManual = document.getElementById('btn-follow-manual');

    if (btnFollowPc) {
      btnFollowPc.onclick = () => {
        memViewer.followMode = 'pc';
        updateFollowButtons();
      };
    }
    if (btnFollowSp) {
      btnFollowSp.onclick = () => {
        memViewer.followMode = 'sp';
        updateFollowButtons();
      };
    }
    if (btnFollowManual) {
      btnFollowManual.onclick = () => {
        memViewer.followMode = 'manual';
        if (!memViewer.manualAddress) {
          memViewer.manualAddress = memViewer.baseAddress || 0o1000;
        }
        memViewer.baseAddress = memViewer.manualAddress;
        updateFollowButtons();
        renderMemorySimple(memViewer.baseAddress, memViewer.lastPC, memViewer.lastSP);
        updateMemoryAddressInput(memViewer.baseAddress);
      };
    }

    // Кнопка Go по адресу
    const btnGoAddr = document.getElementById('btn-go-address');
    const memAddrInput = document.getElementById('mem-address-input');

    if (btnGoAddr && memAddrInput) {
      memAddrInput.onfocus = () => {
        memViewer.followMode = 'manual';
        updateFollowButtons();
      };
      btnGoAddr.onclick = () => {
        const addr = parseInt(memAddrInput.value.trim(), 8);
        if (!isNaN(addr) && addr >= 0 && addr <= 0xFFFF) {
          setMemoryAddress(addr);
        }
      };
      // Enter в поле адреса
      memAddrInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          btnGoAddr.click();
        }
      };
    }

    // Кнопки Go To PC / SP
    const btnGoPc = document.getElementById('btn-go-pc');
    const btnGoSp = document.getElementById('btn-go-sp');

    if (btnGoPc) {
      btnGoPc.onclick = async () => {
        try {
          const pc = await emulatorBridge.debug('getPC');
          setMemoryAddress((pc & 0xFFFC) - 16);
        } catch (e) { console.warn(e); }
      };
    }
    if (btnGoSp) {
      btnGoSp.onclick = async () => {
        try {
          const sp = await emulatorBridge.debug('getSP');
          setMemoryAddress((sp & 0xFFFC) - 16);
        } catch (e) { console.warn(e); }
      };
    }

    // Настройки сборки в тулбаре
    const platformSelect = document.getElementById('platform-select');
    platformSelect.value = global.bkProject.settings.platform || 'BK-0010';
    platformSelect.onchange = () => {
      const is11M = platformSelect.value === 'BK-0011M';
      global.bkProject.updateSetting('platform', platformSelect.value);
      emulatorBridge.setPlatform(is11M ? 'БК0011М' : 'БК0010');
      triggerLspDiagnostics();
    };

    const formatSelect = document.getElementById('format-select');
    formatSelect.value = global.bkProject.settings.format || 'bin';
    formatSelect.onchange = () => {
      global.bkProject.updateSetting('format', formatSelect.value);
    };

    const addrInput = document.getElementById('address-input');
    addrInput.value = global.bkProject.settings.startAddress || '1000';
    addrInput.onchange = () => {
      global.bkProject.updateSetting('startAddress', addrInput.value);
    };

    // Селектор цветовой темы интерфейса и редактора
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      const savedTheme = localStorage.getItem('bkstudio_theme') || 'bk-crt-green';
      themeSelect.value = savedTheme;
      themeSelect.onchange = () => {
        applyTheme(themeSelect.value);
      };
    }

    // Селектор шрифта редактора
    const fontFamSelect = document.getElementById('font-family-select');
    if (fontFamSelect) {
      const savedFontFamily = localStorage.getItem('bkstudio_font_family') || 'Iosevka Nerd Mono';
      fontFamSelect.value = savedFontFamily;
      fontFamSelect.onchange = () => {
        const family = fontFamSelect.value;
        localStorage.setItem('bkstudio_font_family', family);
        if (editor) {
          editor.updateOptions({ fontFamily: getFontFamilyCSS(family) });
        }
      };
    }

    // Селектор размера шрифта
    const fontSizeSelect = document.getElementById('font-size-select');
    if (fontSizeSelect) {
      const savedFontSize = localStorage.getItem('bkstudio_font_size') || '14';
      fontSizeSelect.value = savedFontSize;
      fontSizeSelect.onchange = () => {
        const size = parseInt(fontSizeSelect.value, 10) || 14;
        localStorage.setItem('bkstudio_font_size', String(size));
        if (editor) {
          editor.updateOptions({ fontSize: size });
        }
      };
    }

    // Обработчики панелей дизассемблера (синхронизация чекбоксов "Следить за PC")
    setupDisasmPanelEvents();
    setupSideDisasmEvents();
  }

  /**
   * Интеллектуальное автоопределение необходимого компилятора по исходным текстам проекта
   * @param {string} allText Текст всех исходников проекта
   * @param {object} filesMap Словарь файлов проекта
   * @returns {'pdpy11'|'bkturbo8'}
   */
  function detectCompilerFromSources(allText, filesMap) {
    if (!filesMap && global.bkProject) {
      filesMap = global.bkProject.getAllFiles();
    }
    if (!allText && filesMap) {
      allText = Object.values(filesMap)
        .filter(v => typeof v === 'string')
        .join('\n');
    }
    if (!allText) return 'bkturbo8';

    // 0. Специфичные маркеры MACRO-11 (DEC PDP-11 / RT-11)
    // Директивы .title, .ident, .mcall, .psect, .asect, .rad50, .limit, .irp, .irpc
    const macro11Patterns = [
      /\.title\b/i,
      /\.ident\b/i,
      /\.mcall\b/i,
      /\.psect\b/i,
      /\.asect\b/i,
      /\.rad50\b/i,
      /\.limit\b/i,
      /\.irp\b|\.irpc\b/i
    ];

    if (filesMap) {
      const hasMacFiles = Object.keys(filesMap).some(f => f.toLowerCase().endsWith('.mac'));
      if (hasMacFiles) {
        for (const pattern of macro11Patterns) {
          if (pattern.test(allText)) {
            return 'macro11';
          }
        }
      }
    }

    for (const pattern of macro11Patterns) {
      if (pattern.test(allText)) {
        return 'macro11';
      }
    }

    // 1. Специфичные маркеры PDPy11
    // Метакоманды без точки: make_bin, make_raw, make_wav, make_turbo_wav, make_bk0010_rom, insert_file
    // Директивы с точкой: .repeat, .extern, .dword, .charset, .encoding
    // Фигурные скобки в блоках повторов: .repeat ... { ... }
    // Упоминания pdpy11
    const pdpy11Patterns = [
      /\b(make_bin|make_raw|make_wav|make_turbo_wav|make_bk0010_rom|insert_file)\b/i,
      /\.repeat\b/i,
      /\.extern\b/i,
      /\.dword\b/i,
      /\.charset\b/i,
      /\bpdpy11\b/i,
      /\.repeat\s+[^;{\n]*\{/i
    ];

    for (const pattern of pdpy11Patterns) {
      if (pattern.test(allText)) {
        return 'pdpy11';
      }
    }

    // 2. Специфичные маркеры BKTurbo8
    const bkturbo8Patterns = [
      /\.script\b/i,
      /\.ends\b/i,
      /@include\b/i,
      /\.addr\b/i,
      /\.flt2\b|\.flt4\b/i,
      /\.packed\b/i,
      /%[0-7]\s*=/i,
      /\bbkturbo\b/i
    ];

    for (const pattern of bkturbo8Patterns) {
      if (pattern.test(allText)) {
        return 'bkturbo8';
      }
    }

    // 3. По умолчанию для классического кода MACRO-11 — быстрый BKTurbo8
    return 'bkturbo8';
  }
  global.detectCompilerFromSources = detectCompilerFromSources;

  /**
   * Распаковка и инициализация проекта из ArrayBuffer ZIP-архива
   */
  async function loadProjectFromZipBuffer(arrayBuffer, sourceName, platformParam = null) {
    if (typeof JSZip === 'undefined') {
      throw new Error('Библиотека JSZip не найдена.');
    }

    let zip;
    if (typeof JSZip.loadAsync === 'function') {
      zip = await JSZip.loadAsync(arrayBuffer);
    } else {
      zip = new JSZip(arrayBuffer);
    }

    const filesMap = {};
    const zipEntries = (zip.file && typeof zip.file === 'function' && Array.isArray(zip.file(/.+/)) && zip.file(/.+/).length > 0)
      ? zip.file(/.+/)
      : (zip.files ? Object.values(zip.files) : []);

    let allTextForDetection = '';
    const textFiles = [];
    const asmOrMacFiles = [];

    for (const entry of zipEntries) {
      if (entry.dir) continue;
      const rawName = entry.name;
      if (rawName.startsWith('__MACOSX') || rawName.includes('/.DS_Store')) continue;

      const cleanName = rawName.includes('/') ? rawName.substring(rawName.lastIndexOf('/') + 1) : rawName;
      if (!cleanName) continue;

      let uint8;
      if (typeof entry.async === 'function') {
        uint8 = await entry.async('uint8array');
      } else if (typeof entry.asUint8Array === 'function') {
        uint8 = entry.asUint8Array();
      } else {
        uint8 = new TextEncoder().encode(entry.asText ? entry.asText() : '');
      }

      const isText = /\.(asm|mac|s|inc|txt|doc|me|lss|lst|pas|c|h|bas|foc)$/i.test(cleanName);

      if (isText) {
        let text = '';
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
        } catch (e) {
          text = new TextDecoder('koi8-r').decode(uint8);
        }
        filesMap[cleanName] = text;
        allTextForDetection += '\n' + text;
        textFiles.push(cleanName);

        if (/\.(asm|mac|s)$/i.test(cleanName)) {
          asmOrMacFiles.push(cleanName);
        }
      } else {
        filesMap[cleanName] = uint8;
      }
    }

    if (Object.keys(filesMap).length === 0) {
      logToConsole('Архив не содержит подходящих файлов.', 'error');
      updateStatus('Ошибка: в архиве нет файлов', false);
      return;
    }

    // Выбор единственного главного файла для открытия во вкладке (Требование 1)
    let candidateMain = null;
    for (const name of asmOrMacFiles) {
      if (/^(main|start)\.(asm|mac)$/i.test(name)) {
        candidateMain = name;
        break;
      }
    }
    if (!candidateMain && asmOrMacFiles.length > 0) {
      candidateMain = asmOrMacFiles[0];
    }
    if (!candidateMain && textFiles.length > 0) {
      candidateMain = textFiles[0];
    }
    if (!candidateMain) {
      candidateMain = Object.keys(filesMap)[0];
    }

    // Определение целевой платформы (Требование 3)
    let detectedPlatform = null;
    if (platformParam) {
      const pUpper = platformParam.toUpperCase();
      if (pUpper.includes('11') || pUpper.includes('БК11') || pUpper.includes('BK11') || pUpper.includes('BK-11') || pUpper.includes('BK-0011')) {
        detectedPlatform = 'BK-0011M';
      } else {
        detectedPlatform = 'BK-0010';
      }
    } else {
      if (/BK-?0011|BK11|11M|\.INCLUDE\s+["'<]?.*BK11/i.test(allTextForDetection) || (sourceName && /BK-?0011|BK11|11M/i.test(sourceName))) {
        detectedPlatform = 'BK-0011M';
      } else {
        detectedPlatform = 'BK-0010';
      }
    }

    // Применяем платформу в селекторе интерфейса и в эмуляторе
    const platformSelect = document.getElementById('platform-select');
    if (platformSelect) {
      platformSelect.value = detectedPlatform;
    }
    const is11M = (detectedPlatform === 'BK-0011M');
    emulatorBridge.setPlatform(is11M ? 'БК0011М' : 'БК0010');
    emulatorBridge.setBoot(is11M ? 'B11' : 'B10');

    // Интеллектуальное автоопределение компилятора по исходникам проекта
    const detectedCompiler = detectCompilerFromSources(allTextForDetection, filesMap);
    if (typeof compilerBridge !== 'undefined') {
      compilerBridge.setCompiler(detectedCompiler);
      updateCompilerUI(detectedCompiler);
      const compTitle = detectedCompiler === 'macro11' ? 'MACRO-11 (DEC WASM)' : (detectedCompiler === 'pdpy11' ? 'PDPy11 (Python WASM)' : 'BKTurbo8 (C++ WASM)');
      logToConsole(`Автоопределение компилятора: ${compTitle}`, 'info');
    }

    // Загружаем файлы проекта: во вкладки открываем ТОЛЬКО candidateMain!
    global.bkProject.loadProjectFiles(filesMap, candidateMain, { platform: detectedPlatform }, [candidateMain]);

    if (editor && typeof filesMap[candidateMain] === 'string') {
      editor.setValue(filesMap[candidateMain]);
    }

    logToConsole(`Архив успешно распакован! Файлов: ${Object.keys(filesMap).length}, Главный файл: ${candidateMain}, Платформа: ${detectedPlatform}`, 'info');
    updateStatus(`Проект загружен: ${candidateMain}`, false);

    setTimeout(() => {
      triggerLspDiagnostics();
    }, 150);
  }

  /**
   * Загрузка и распаковка проекта по URL архива (?src=... / ?URL=...)
   */
  async function loadProjectFromZipUrl(srcParam, platformParam) {
    if (!srcParam) return;
    try {
      logToConsole(`Загрузка архива проекта по ссылке: ${srcParam}...`, 'info');
      updateStatus('Загрузка архива проекта...', true);

      let fetchUrl = srcParam;
      // Корректировка путей для локальной среды и GitHub Pages
      if (fetchUrl.includes('kalininskiy.github.io/bk-catalog/')) {
        const pathAfter = fetchUrl.split('kalininskiy.github.io/bk-catalog/')[1];
        fetchUrl = '../' + pathAfter;
      } else if (fetchUrl.includes('/bk_files/')) {
        fetchUrl = '../bk_files/' + fetchUrl.split('/bk_files/')[1];
      } else if (fetchUrl.includes('/bk_games_files/')) {
        fetchUrl = '../bk_games_files/' + fetchUrl.split('/bk_games_files/')[1];
      } else if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://') && !fetchUrl.startsWith('../') && !fetchUrl.startsWith('/')) {
        fetchUrl = '../' + fetchUrl;
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} при загрузке ${fetchUrl}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      await loadProjectFromZipBuffer(arrayBuffer, srcParam, platformParam);

    } catch (err) {
      console.error('[BKStudio] Ошибка загрузки архива проекта:', err);
      logToConsole(`Не удалось загрузить архив: ${err.message}`, 'error');
      updateStatus(`Ошибка загрузки: ${err.message}`, false);
    }
  }

  // =====================================================================
  // Режим отладки эмулятора
  // =====================================================================

  /**
   * Включить режим отладки эмулятора
   */
  function enableDebugMode() {
    if (debugModeActive) return;
    debugModeActive = true;
    prevRegisters = null;

    // Показываем отладочные вкладки внизу
    const btnMemTab = document.getElementById('btn-memory-tab');
    if (btnMemTab) btnMemTab.style.display = '';
    const btnDisTab = document.getElementById('btn-disasm-tab');
    if (btnDisTab) btnDisTab.style.display = '';

    // Показываем боковой дизассемблер слева от Monaco
    const sideDisasm = document.getElementById('side-disasm-panel');
    if (sideDisasm) sideDisasm.style.display = 'flex';
    const sideSplitter = document.getElementById('splitter-side-disasm');
    if (sideSplitter) sideSplitter.style.display = 'block';

    // Увеличиваем размер bottom-panel для memory view
    const bottomPanel = document.getElementById('bottom-panel');
    if (bottomPanel) bottomPanel.style.flexBasis = '365px';

    // Переключаем bottom-вкладку на memory
    switchBottomTab('memory');

    // Включаем debug view автоматически
    enableDebugView();

    // Обновляем кнопку debug-mode
    updateDebugTabButton(true);

    // Показываем debug-панель в sidebar, скрываем outline
    toggleSidebarDebugView(true);

    // Пересчитываем layout редактора Monaco
    if (editor) editor.layout();

    // Запускаем периодическое обновление
    startDebugUpdateLoop();

    // Сразу обновляем (с защитой от ошибок)
    try {
      updateDebugPanel();
      updateMemoryPanel();
    } catch (err) {
      console.error('[BKStudio Debug] Ошибка initial update:', err);
      const regsEl = document.getElementById('debug-registers');
      if (regsEl) regsEl.innerHTML = '<div class="debug-loading">Ошибка инициализации: ' + escapeHtml(err.message) + '</div>';
    }

    logToConsole('🔧 Режим отладки включён. Данные эмулятора обновляются автоматически.', 'info');
  }

  /**
   * Выключить режим отладки эмулятора
   */
  function disableDebugMode() {
    if (!debugModeActive) return;
    debugModeActive = false;
    prevRegisters = null;
    prevSystemRegisters = null;

    setPauseButtonActive(false);

    // Скрываем отладочные вкладки внизу
    const btnMemTab = document.getElementById('btn-memory-tab');
    if (btnMemTab) btnMemTab.style.display = 'none';
    const btnDisTab = document.getElementById('btn-disasm-tab');
    if (btnDisTab) btnDisTab.style.display = 'none';

    // Скрываем боковой дизассемблер
    const sideDisasm = document.getElementById('side-disasm-panel');
    if (sideDisasm) sideDisasm.style.display = 'none';
    const sideSplitter = document.getElementById('splitter-side-disasm');
    if (sideSplitter) sideSplitter.style.display = 'none';

    // Выключаем debug view в редакторе (убираем маркеры, сбрасываем glyph margin / line numbers)
    disableDebugView();

    // Останавливаем обновление
    stopDebugUpdateLoop();

    // Возвращаем sidebar в обычный режим
    toggleSidebarDebugView(false);

    // Возвращаем размер bottom-panel
    const bottomPanel = document.getElementById('bottom-panel');
    if (bottomPanel) bottomPanel.style.flexBasis = '245px';

    // Переключаемся на вкладку console
    updateDebugTabButton(false);
    switchBottomTab('console');

    // Пересчитываем layout редактора Monaco
    if (editor) editor.layout();

    logToConsole('🔧 Режим отладки выключен.', 'info');
  }

  /**
   * Переключить видимость sidebar секций между Outline и Debug
   */
  function toggleSidebarDebugView(showDebug) {
    const sidebar = document.getElementById('sidebar');
    const outlineSection = document.getElementById('outline-section');
    const debugPanel = document.getElementById('debug-panel');

    console.log('[BKStudio Debug] toggleSidebarDebugView(' + showDebug + ')');

    if (showDebug) {
      // Скрываем файлы, outline, горячие клавиши — показываем debug-panel
      const fileHeader = document.getElementById('file-header');
      const fileList = document.getElementById('file-list');
      const hotkeysSection = document.getElementById('hotkeys-section');
      const hotkeysHeader = document.getElementById('hotkeys-header');
      const hotkeysContent = document.getElementById('hotkeys-content');

      if (fileHeader) fileHeader.style.display = 'none';
      if (fileList) fileList.style.display = 'none';
      if (hotkeysSection) hotkeysSection.style.display = 'none';
      if (hotkeysHeader) hotkeysHeader.style.display = 'none';
      if (hotkeysContent) hotkeysContent.style.display = 'none';

      if (outlineSection) {
        outlineSection.style.display = 'none';
        console.log('[BKStudio Debug] Outline скрыт');
      }
      if (debugPanel) {
        debugPanel.style.display = 'flex';
        console.log('[BKStudio Debug] Debug-panel показан');
      }
    } else {
      // Показываем файлы, outline, горячие клавиши — скрываем debug-panel
      const fileHeader = document.getElementById('file-header');
      const fileList = document.getElementById('file-list');
      const hotkeysSection = document.getElementById('hotkeys-section');
      const hotkeysHeader = document.getElementById('hotkeys-header');
      const hotkeysContent = document.getElementById('hotkeys-content');

      if (fileHeader) fileHeader.style.display = '';
      if (fileList) fileList.style.display = '';
      if (hotkeysSection) hotkeysSection.style.display = '';
      if (hotkeysHeader) hotkeysHeader.style.display = '';
      if (hotkeysContent) hotkeysContent.style.display = '';

      if (outlineSection) {
        outlineSection.style.display = '';
        console.log('[BKStudio Debug] Outline показан');
      }
      if (debugPanel) {
        debugPanel.style.display = 'none';
        console.log('[BKStudio Debug] Debug-panel скрыт');
      }
    }

    // Проверяем что sidebar виден
    if (sidebar) {
      const rect = sidebar.getBoundingClientRect();
      console.log('[BKStudio Debug] Sidebar rect:', rect);
    }
  }

  /**
   * Переключить режим отладки
   */
  function toggleDebugMode() {
    if (debugModeActive) {
      disableDebugMode();
    } else {
      enableDebugMode();
    }
  }

  /**
   * Обновить кнопку режима отладки
   */
  function updateDebugTabButton(active) {
    const btn = document.getElementById('btn-debug-mode');
    if (!btn) return;
    if (active) {
      btn.textContent = 'Режим отладки [Выключить]';
      btn.classList.add('active');
      btn.style.color = 'var(--accent-amber)';
    } else {
      btn.textContent = 'Режим отладки';
      btn.classList.remove('active');
      btn.style.color = '';
    }
  }

  /**
   * Запустить цикл периодического обновления данных отладки
   */
  function startDebugUpdateLoop() {
    stopDebugUpdateLoop();
    debugUpdateInterval = setInterval(() => {
      if (debugModeActive) {
        updateDebugPanel();
        updateMemoryPanel();
        if (debugView.active) {
          updateCurrentLine();
          updateDisassemblerPanel();
        }
      }
    }, 500); // Обновление каждые 500 мс
  }

  /**
   * Остановить цикл обновления
   */
  function stopDebugUpdateLoop() {
    if (debugUpdateInterval) {
      clearInterval(debugUpdateInterval);
      debugUpdateInterval = null;
    }
  }

  /**
   * Обновить панель отладки (регистры + системные регистры + стек)
   */
  async function updateDebugPanel() {
    if (!debugModeActive || !emulatorBridge) return;

    // 1. Синхронизируем состояние паузы
    try {
      const status = await emulatorBridge.debug('getStatus');
      if (status && typeof status.running === 'boolean') {
        setPauseButtonActive(!status.running);
      }
    } catch (_) {}

    // 2. Получаем регистры процессора
    try {
      const regs = await emulatorBridge.debug('getRegisters');
      renderRegisters(regs);
      prevRegisters = JSON.parse(JSON.stringify(regs)); // сохраняем копию
    } catch (err) {
      console.warn('[BKStudio Debug] Ошибка получения регистров:', err);
      const regsEl = document.getElementById('debug-registers');
      if (regsEl) regsEl.innerHTML = '<div class="debug-loading">Ошибка: ' + escapeHtml(err.message) + '</div>';
    }

    // 3. Получаем системные регистры (176650..177716)
    try {
      const sysRegs = await emulatorBridge.debug('getSystemRegisters');
      renderSystemRegisters(sysRegs);
      prevSystemRegisters = sysRegs;
    } catch (err) {
      console.warn('[BKStudio Debug] Ошибка получения системных регистров:', err);
      renderSystemRegisters(null);
    }

    // 4. Получаем стек (8 строк)
    try {
      const stackData = await emulatorBridge.debug('Stack', 8);
      renderStack(stackData);
    } catch (err) {
      console.warn('[BKStudio Debug] Ошибка получения стека:', err);
      const stackEl = document.getElementById('debug-stack');
      if (stackEl) stackEl.textContent = 'Ошибка стека: ' + err.message;
    }
  }

  /**
   * Отрисовать регистры CPU с подсветкой и old→new
   */
  function renderRegisters(regs) {
    const el = document.getElementById('debug-registers');
    if (!el) return;

    if (!regs || typeof regs !== 'object') {
      el.innerHTML = '<div class="debug-loading">Нет данных регистров</div>';
      return;
    }

    const prev = prevRegisters;

    let html = '';

    // 1. Регистры R0-R5 (обычные)
    const generalRegs = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
    for (const name of generalRegs) {
      if (!(name in regs)) continue;
      const value = regs[name];
      const oldValue = prev && prev[name] !== undefined ? prev[name] : null;
      html += renderRegisterRow(name, value, oldValue, false, name.toUpperCase());
    }

    // 2. R6(SP) и R7(PC) — со спец-названием и подсказками
    if ('sp' in regs) {
      const value = regs.sp;
      const oldValue = prev && prev.sp !== undefined ? prev.sp : null;
      html += renderRegisterRow('sp', value, oldValue, true, 'R6(SP)', 'Stack Pointer, указатель стека');
    }
    if ('pc' in regs) {
      const value = regs.pc;
      const oldValue = prev && prev.pc !== undefined ? prev.pc : null;
      html += renderRegisterRow('pc', value, oldValue, true, 'R7(PC)', 'Program Counter, программный счётчик');
    }

    // 3. PSW в конце
    if ('psw' in regs) {
      const pswStr = String(regs.psw);
      html += renderPSWRow('psw', pswStr, false, prev ? prev.psw : null);
    }

    // cycles (если есть)
    if ('cycles' in regs) {
      html += '<div class="debug-register-row" style="opacity: 0.5;">';
      html += '<span class="debug-register-name" style="color: var(--text-muted);">Cyc</span>';
      html += '<span class="debug-register-value" style="color: var(--text-muted);">' + formatNumber(regs.cycles, 7) + '</span>';
      html += '</div>';
    }

    el.innerHTML = html;
  }

  /**
   * Отрисовать строку обычного регистра
   * @param {string} name - имя регистра (r0, sp, pc и т.д.)
   * @param {number} newValue - новое значение
   * @param {number|null} oldValue - предыдущее значение
   * @param {boolean} isImportant - важный регистр (подсветка)
   * @param {string} [displayName] - отображаемое имя (опционально)
   * @param {string} [tooltip] - подсказка при наведении (опционально)
   */
  function renderRegisterRow(name, newValue, oldValue, isImportant, displayName, tooltip) {
    const nameDisplay = displayName || name.toUpperCase();
    const newFormatted = formatNumber(newValue);
    const oldFormatted = oldValue !== null ? formatNumber(oldValue) : null;

    // Заголовок для tooltip
    const titleAttr = tooltip ? ' title="' + escapeHtml(tooltip) + '"' : '';

    let valueHtml;
    if (oldValue !== null && oldValue !== newValue) {
      // Показываем old → new (изменённое значение)
      valueHtml = '<span class="debug-register-old">' + oldFormatted + '</span>' +
                  '<span class="debug-register-arrow"> → </span>' +
                  '<span class="debug-register-new">' + newFormatted + '</span>';
    } else {
      valueHtml = newFormatted;
    }

    return '<div class="debug-register-row">' +
      '<span class="debug-register-name' + (isImportant ? ' highlight' : '') + '"' + titleAttr + '>' + nameDisplay + '</span>' +
      '<span class="debug-register-value' + (isImportant ? ' highlight' : '') + '">' + valueHtml + '</span>' +
      '</div>';
  }

  /**
   * Отрисовать строку PSW с флагами N Z V C
   */
  function renderPSWRow(name, pswStr, isImportant, oldPswStr) {
    // Парсим строку PSW, например "N Z V C" или "NZVC"
    const flags = parsePSWFlags(pswStr);
    const hasChanges = oldPswStr && oldPswStr !== pswStr;

    let html = '<div class="debug-register-row">';
    html += '<span class="debug-register-name' + (isImportant ? ' highlight' : '') + '">PSW</span>';
    html += '<span class="debug-register-value debug-register-psw">';

    for (const flag of PSW_FLAGS) {
      const isSet = flags[flag];
      const oldIsSet = hasChanges ? (oldPswStr && oldPswStr.indexOf(flag) !== -1) : null;

      if (oldIsSet !== null && isSet !== oldIsSet) {
        // Флаг изменился
        html += '<span class="psw-flag ' + (isSet ? 'set' : 'unset') + '" style="background: ' + (isSet ? 'var(--accent-red)' : 'var(--accent-amber)') + ';"></span>';
      } else {
        html += '<span class="psw-flag ' + (isSet ? 'set' : 'unset') + '"></span>';
      }
      html += '<span class="psw-flag-name">' + flag + '</span>';
    }

    html += '</span>';

    // Полная строка PSW
    html += '<span class="debug-register-value" style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">' + escapeHtml(pswStr) + '</span>';

    if (hasChanges && oldPswStr) {
      html += '<span class="debug-register-arrow"> ← </span>';
      html += '<span class="debug-register-old" style="font-size: 10px;">' + escapeHtml(oldPswStr) + '</span>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Разобрать флаги PSW из строки
   */
  function parsePSWFlags(pswStr) {
    const result = { N: false, Z: false, V: false, C: false };
    if (!pswStr) return result;
    for (const flag of PSW_FLAGS) {
      if (pswStr.indexOf(flag) !== -1) {
        result[flag] = true;
      }
    }
    return result;
  }

  // Значения системных регистров по умолчанию (согласно 06-системные-регистры.md)
  const DEFAULT_SYSTEM_REGISTERS = [
    { addr: 0o176650, name: 'Блок ИРПС', write: 0, read: 0 },
    { addr: 0o177660, name: 'Состояние клавиатуры', write: 0o100, read: 0o100 },
    { addr: 0o177662, name: 'Данные клавиатуры', write: 0, read: 0 },
    { addr: 0o177664, name: 'Скроллинг', write: 0o1330, read: 0o1330 },
    { addr: 0o177706, name: 'Таймер: начальное значение', write: 0o1024, read: 0o1024 },
    { addr: 0o177710, name: 'Таймер: счётчик', write: 0, read: 0o377 },
    { addr: 0o177712, name: 'Таймер: управление', write: 0o124, read: 0o177524 },
    { addr: 0o177714, name: 'Порт УВВ', write: 0, read: 0 },
    { addr: 0o177716, name: 'Внешние устройства', write: 0, read: 0o100300 }
  ];

  let prevSystemRegisters = null;

  /**
   * Отрисовать таблицу системных регистров (176650..177716)
   * Колонки: Адрес, Назначение, Запись, Чтение
   * @param {Array<{addr:number,name:string,write:number,read:number}>|null} sysRegs
   */
  function renderSystemRegisters(sysRegs) {
    const el = document.getElementById('debug-sysregs');
    if (!el) return;

    const list = (Array.isArray(sysRegs) && sysRegs.length > 0) ? sysRegs : DEFAULT_SYSTEM_REGISTERS;

    let html = '<table class="debug-sysregs-table">';
    html += '<thead><tr>';
    html += '<th class="sysreg-col-addr">Адрес</th>';
    html += '<th class="sysreg-col-name">Назначение</th>';
    html += '<th class="sysreg-col-write">Запись</th>';
    html += '<th class="sysreg-col-read">Чтение</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    for (let i = 0; i < list.length; i++) {
      const reg = list[i];
      const octAddr = ('000000' + (reg.addr & 0xFFFF).toString(8)).slice(-6);
      const writeStr = formatNumber(reg.write);
      const readStr = formatNumber(reg.read);
      const tooltip = `Адрес: ${octAddr} (8-рич), Назначение: ${reg.name}`;

      html += `<tr title="${escapeHtml(tooltip)}">`;
      html += `<td class="sysreg-col-addr">${octAddr}</td>`;
      html += `<td class="sysreg-col-name" title="${escapeHtml(reg.name)}">${escapeHtml(reg.name)}</td>`;
      html += `<td class="sysreg-col-write">${writeStr}</td>`;
      html += `<td class="sysreg-col-read">${readStr}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  /**
   * Отрисовать стек
   */
  function renderStack(stackData) {
    const el = document.getElementById('debug-stack');
    if (!el) return;

    if (!Array.isArray(stackData) || stackData.length === 0) {
      el.textContent = 'Нет данных стека';
      return;
    }

    // Определяем SP
    let spEntry = null;
    for (const entry of stackData) {
      if (entry.isSP) {
        spEntry = entry;
        break;
      }
    }

    // Находим индекс SP для разделения newer/older
    const spIndex = stackData.findIndex(e => e.isSP);

    let html = '';

    // Стрелка "newer"
    if (spIndex > 0) {
      html += '<div class="stack-line"><span class="stack-arrow">↑ newer</span></div>';
    }

    for (let i = 0; i < stackData.length; i++) {
      const entry = stackData[i];
      const isSP = entry.isSP;

      // Разделитель над SP
      if (i === spIndex) {
        html += '<div class="stack-line" style="border-top: 1px solid var(--border-color); padding-top: 4px;"></div>';
      }

      html += '<div class="stack-line' + (isSP ? ' sp-line' : '') + '">';
      html += '<span class="stack-address">' + formatAddress(entry.address) + '</span>';
      html += '<span class="stack-value">' + formatNumber(entry.value) + '</span>';

      if (isSP) {
        html += '<span class="stack-sp-marker">← SP</span>';
      }

      html += '</div>';

      // Разделитель под SP
      if (i === spIndex && i < stackData.length - 1) {
        html += '<div class="stack-line" style="border-bottom: 1px solid var(--border-color); padding-bottom: 4px;"></div>';
      }
    }

    // Стрелка "older"
    if (spIndex < stackData.length - 1) {
      html += '<div class="stack-line"><span class="stack-arrow">↓ older</span></div>';
    }

    el.innerHTML = html;
  }

  /**
   * Экранировать HTML
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // =====================================================================
  // Debug View — дизассемблер и breakpoints
  // =====================================================================
  let debugView = {
    active: false,
    breakpointDecorations: [],
    currentLineDecoration: null,
    breakpoints: new Set(),  // Set<number> — набор адресов точек останова
    disasmBaseAddress: 0o1000, // текущий адрес начала дизассемблирования
    lastDisasmPC: -1          // последний PC для которого обновляли дизассемблер
  };

  /**
   * Включить debug view (автоматически при входе в режим отладки)
   */
  function enableDebugView() {
    if (!editor || typeof monaco === 'undefined') return;

    // Активируем режим
    debugView.active = true;

    // Включаем glyph margin и широкие номера строк с адресами LST
    editor.updateOptions({
      glyphMargin: true,
      lineNumbers: getLineNumberDisplay,
      lineNumbersMinChars: 10
    });

    // Настраиваем события панелей дизассемблера
    setupDisasmPanelEvents();
    setupSideDisasmEvents();

    // Обновляем текущую строку
    updateCurrentLine();

    // Обновляем точки останова
    updateBreakpointDecorations();

    // Немедленный первый рендер дизассемблера
    updateDisassemblerPanel();

    console.log('[BKStudio Debug View] Включён');
  }

  /**
   * Выключить дизассемблер
   */
  function disableDebugView() {
    if (!editor) return;

    // Деактивируем режим
    debugView.active = false;
    debugView.lastDisasmPC = -1;

    // Убираем декорации из Monaco Editor
    if (debugView.breakpointDecorations.length > 0) {
      editor.deltaDecorations(debugView.breakpointDecorations, []);
      debugView.breakpointDecorations = [];
    }
    if (debugView.currentLineDecoration && debugView.currentLineDecoration.length > 0) {
      editor.deltaDecorations(debugView.currentLineDecoration, []);
      debugView.currentLineDecoration = null;
    }

    editor.updateOptions({
      glyphMargin: false,
      lineNumbers: 'on',
      lineNumbersMinChars: 0
    });

    // Очищаем панели дизассемблера
    const disasmContent = document.getElementById('disasm-content');
    if (disasmContent) disasmContent.innerHTML = '';
    const sideDisasmContent = document.getElementById('side-disasm-content');
    if (sideDisasmContent) sideDisasmContent.innerHTML = '';

    console.log('[BKStudio Debug View] Выключен');
  }

  /**
   * Обновить подсветку текущей строки (PC) в Monaco Editor по карте lstAddressMap
   */
  async function updateCurrentLine() {
    if (!debugView.active || !editor) return;

    try {
      const pc = await emulatorBridge.debug('getPC');

      // Ищем строку исходника по адресу через карту листинга
      const targetLine = lstAddressMap.get(pc);
      if (targetLine && targetLine > 0) {
        highlightCurrentLine(targetLine);
      } else {
        // Если нет листинга — убираем подсветку
        if (debugView.currentLineDecoration && debugView.currentLineDecoration.length > 0) {
          editor.deltaDecorations(debugView.currentLineDecoration, []);
          debugView.currentLineDecoration = null;
        }
      }
    } catch (e) {
      // Эмулятор не готов
    }
  }

  /**
   * Подсветить текущую строку (PC)
   */
  function highlightCurrentLine(lineNumber) {
    if (!editor) return;

    // Убираем старую декорацию
    if (debugView.currentLineDecoration && debugView.currentLineDecoration.length > 0) {
      editor.deltaDecorations(debugView.currentLineDecoration, []);
    }

    // Создаём новую декорацию (жёлтая полоса слева)
    const newDecorations = editor.deltaDecorations(debugView.currentLineDecoration || [], [{
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: 'debug-current-line',
        glyphMarginClassName: 'debug-current-glyph'
      }
    }]);

    debugView.currentLineDecoration = newDecorations;

    // Прокручиваем к строке
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber: lineNumber, column: 1 });
    editor.focus();
  }

  /**
   * Добавить/удалить точку останова по клику на glyph margin
   * Использует lstLineToAddress для трансляции строки исходника → адрес
   */
  function toggleBreakpointAtLine(lineNumber) {
    if (!editor) return;

    // Сначала пробуем найти адрес через карту листинга
    let address = lstLineToAddress.get(lineNumber);

    // Если карты нет — пробуем распарсить строку листинга напрямую
    if (address === undefined) {
      const model = editor.getModel();
      if (!model) return;
      const lineContent = model.getLineContent(lineNumber);
      // Поддержка формата листинга BKTurbo8: "001000 012700 ..."
      const octalMatch = lineContent.match(/^\s*(0[0-7]{5,6})\s/);
      if (!octalMatch) {
        // Нет адреса в этой строке — breakpoint не ставим
        return;
      }
      address = parseInt(octalMatch[1], 8);
    }

    if (debugView.breakpoints.has(address)) {
      // Удаляем точку останова
      debugView.breakpoints.delete(address);
      emulatorBridge.debug('clearBreakpoint', address).catch(() => {});
    } else {
      // Добавляем точку останова
      debugView.breakpoints.add(address);
      emulatorBridge.debug('setBreakpoint', address).catch(() => {});
    }

    // Синхронизируем визуальное состояние точек останова во всех представлениях
    syncBreakpointVisuals();
  }

  /**
   * Синхронизировать отображение точек останова в Monaco и в панелях дизассемблера
   */
  function syncBreakpointVisuals() {
    updateBreakpointDecorations();
    document.querySelectorAll('.disasm-row').forEach(r => {
      const a = parseInt(r.dataset.addr, 10);
      const isBp = debugView.breakpoints.has(a);
      r.classList.toggle('has-breakpoint', isBp);
      const dot = r.querySelector('.disasm-bp-dot');
      if (dot) {
        dot.style.background = isBp ? 'var(--accent-red)' : '';
        dot.style.boxShadow = isBp ? '0 0 5px rgba(255,77,79,0.7)' : '';
      }
    });
  }

  /**
   * Обновить декорации точек останова в glyph margin Monaco Editor
   * Использует lstLineToAddress для поиска строк по адресам breakpoints
   */
  function updateBreakpointDecorations() {
    if (!editor || typeof monaco === 'undefined') return;

    // Убираем старые декорации
    if (debugView.breakpointDecorations.length > 0) {
      editor.deltaDecorations(debugView.breakpointDecorations, []);
    }
    debugView.breakpointDecorations = [];

    if (debugView.breakpoints.size === 0) return;

    const decorations = [];

    // Ставим декорации по карте lstLineToAddress → адрес → breakpoints
    for (const [lineNum, addr] of lstLineToAddress) {
      if (debugView.breakpoints.has(addr)) {
        const addrOct = ('000000' + addr.toString(8)).slice(-6);
        decorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'breakpoint-glyph',
            glyphMarginHoverMessage: { value: `**Breakpoint** @ 0${addrOct} (${addr})` }
          }
        });
      }
    }

    if (decorations.length > 0) {
      debugView.breakpointDecorations = editor.deltaDecorations([], decorations);
    }
  }

  // =====================================================================
  // Карта адресов листинга — строится после каждой компиляции
  // =====================================================================

  /**
   * Разобрать листинг компилятора и построить карты:
   *   lstAddressMap:    Map<address, lineNumber>  (адрес → строка исходника)
   *   lstLineToAddress: Map<lineNumber, address>  (строка → адрес)
   *
   * Поддерживаются форматы BKTurbo8, MACRO-11 и PDPy11.
   * @param {string} lstText — текст листинга (.LST)
   */
  function buildLstAddressMap(lstText) {
    lstAddressMap = new Map();
    lstLineToAddress = new Map();

    if (!lstText || typeof lstText !== 'string') return;

    const lines = lstText.split(/\r?\n/);

    for (const line of lines) {
      // Формат BKTurbo8: "001000 012700 000400    MOV #400,R0   ; file.asm:5:"
      // Формат MACRO-11: "001000  012700           MOV  #400,R0"
      // Строка содержит номер строки исходника в конце: "; file:NN:"
      const bkMatch = line.match(/^\s*([0-7]{6})\s+[0-7]{6}.*?;\s*\S+:(\d+):/)
                   || line.match(/^\s*([0-7]{6})\s+[0-7]{6}.*?;\s*(\d+):/)
                   || line.match(/^\s*([0-7]{6})\s+[0-7]{6}/);

      if (bkMatch) {
        const addr = parseInt(bkMatch[1], 8);
        // Если есть номер строки исходника — используем его
        if (bkMatch[2]) {
          const srcLine = parseInt(bkMatch[2], 10);
          if (!isNaN(addr) && !isNaN(srcLine) && srcLine > 0) {
            if (!lstAddressMap.has(addr)) {
              lstAddressMap.set(addr, srcLine);
            }
            if (!lstLineToAddress.has(srcLine)) {
              lstLineToAddress.set(srcLine, addr);
            }
          }
          continue;
        }
      }

      // Формат PDPy11: "     5  001000  012700 000400    MOV #400,R0"
      //                 ^lineN  ^addr   ^words  ^mnem
      const pdpyMatch = line.match(/^\s+(\d+)\s+([0-7]{6})\s/);
      if (pdpyMatch) {
        const srcLine = parseInt(pdpyMatch[1], 10);
        const addr = parseInt(pdpyMatch[2], 8);
        if (!isNaN(srcLine) && !isNaN(addr) && srcLine > 0) {
          if (!lstAddressMap.has(addr)) {
            lstAddressMap.set(addr, srcLine);
          }
          if (!lstLineToAddress.has(srcLine)) {
            lstLineToAddress.set(srcLine, addr);
          }
        }
      }
    }

    console.log(`[BKStudio Debug] Карта адресов листинга: ${lstAddressMap.size} записей`);
  }

  // =====================================================================
  // Дизассемблер — панель (нижняя вкладка и боковая панель)
  // =====================================================================

  /**
   * Обновить панели дизассемблера (запрашивает данные у эмулятора)
   */
  async function updateDisassemblerPanel() {
    if (!debugView.active || !debugModeActive) return;
    const disasmPanel = document.getElementById('disasm-panel');
    const sidePanel = document.getElementById('side-disasm-panel');

    const isBottomVisible = disasmPanel && disasmPanel.style.display !== 'none';
    const isSideVisible = sidePanel && sidePanel.style.display !== 'none';
    if (!isBottomVisible && !isSideVisible) return;

    try {
      const pc = await emulatorBridge.debug('getPC');

      // Определяем адрес начала дизассемблирования
      const followPcEl = document.getElementById('disasm-follow-pc');
      const sideFollowPcEl = document.getElementById('side-disasm-follow-pc');
      const followPC = Boolean((followPcEl && followPcEl.checked) || (sideFollowPcEl && sideFollowPcEl.checked));

      let baseAddr = debugView.disasmBaseAddress;
      if (followPC) {
        // Начинаем чуть выше PC (4 инструкции назад при шаге 2 байта)
        baseAddr = Math.max(0, pc - 8);
        debugView.disasmBaseAddress = baseAddr;
      }

      // Если PC не изменился и панели уже отрисованы — не запрашиваем снова
      if (pc === debugView.lastDisasmPC && followPC) return;
      debugView.lastDisasmPC = pc;

      // Запрашиваем дизассемблирование у эмулятора
      const instructions = await emulatorBridge.debug('disassemble', baseAddr, 32);
      if (isBottomVisible) renderDisassemblerPanel(instructions, pc);
      if (isSideVisible) renderSideDisassemblerPanel(instructions, pc);
    } catch (e) {
      // Эмулятор не готов
    }
  }

  /**
   * Отрисовать нижнюю панель дизассемблера
   * @param {Array<{address:number, hex:string[], text:string}>|null} instructions — инструкции
   * @param {number|null} pc — текущий PC
   */
  function renderDisassemblerPanel(instructions, pc) {
    const el = document.getElementById('disasm-content');
    if (!el) return;

    if (!instructions || instructions.length === 0) {
      return;
    }

    let html = '';

    for (const instr of instructions) {
      const addr = instr.address;
      const addrOct = ('000000' + addr.toString(8)).slice(-6);
      const isCurrent = (pc !== null && addr === pc);
      const isBp = debugView.breakpoints.has(addr);

      let rowClass = 'disasm-row';
      if (isCurrent) rowClass += ' is-current';
      if (isBp) rowClass += ' has-breakpoint';

      // Hex опкоды
      const hexStr = (instr.hex || []).join(' ');

      // Мнемоника с подсветкой (первое слово — опкод, остальное — аргументы)
      const text = escapeHtml(instr.text || '???');
      const spaceIdx = instr.text ? instr.text.search(/\s/) : -1;
      let mnemHtml;
      if (spaceIdx > 0) {
        const op = escapeHtml(instr.text.substring(0, spaceIdx));
        const args = escapeHtml(instr.text.substring(spaceIdx));
        mnemHtml = `<span class="disasm-op">${op}</span><span class="disasm-arg">${args}</span>`;
      } else {
        mnemHtml = `<span class="disasm-op">${text}</span>`;
      }

      html += `<div class="${rowClass}" data-addr="${addr}">`;
      html += `<span class="disasm-bp-dot" title="Нажмите для breakpoint @ 0${addrOct}"></span>`;
      html += `<span class="disasm-pc-arrow">${isCurrent ? '▶' : ' '}</span>`;
      html += `<span class="disasm-addr">0${addrOct}</span>`;
      html += `<span class="disasm-hex">${escapeHtml(hexStr)}</span>`;
      html += `<span class="disasm-mnem">${mnemHtml}</span>`;
      html += '</div>';
    }

    el.innerHTML = html;

    // Вешаем обработчики кликов на строки
    el.querySelectorAll('.disasm-row').forEach(row => {
      row.onclick = (e) => {
        const addr = parseInt(row.dataset.addr, 10);
        if (isNaN(addr)) return;

        // Клик по маркеру точки останова:
        if (e.target.classList.contains('disasm-bp-dot')) {
          if (debugView.breakpoints.has(addr)) {
            debugView.breakpoints.delete(addr);
            emulatorBridge.debug('clearBreakpoint', addr).catch(() => {});
          } else {
            debugView.breakpoints.add(addr);
            emulatorBridge.debug('setBreakpoint', addr).catch(() => {});
          }
          syncBreakpointVisuals();
          return;
        }

        // Клик по строке: если есть соответствие в .LST, переходим к строке в редакторе
        const lineNum = lstAddressMap.get(addr);
        if (lineNum && editor) {
          editor.revealLineInCenter(lineNum);
          editor.setPosition({ lineNumber: lineNum, column: 1 });
          editor.focus();
        } else {
          // Иначе переключаем breakpoint
          if (debugView.breakpoints.has(addr)) {
            debugView.breakpoints.delete(addr);
            emulatorBridge.debug('clearBreakpoint', addr).catch(() => {});
          } else {
            debugView.breakpoints.add(addr);
            emulatorBridge.debug('setBreakpoint', addr).catch(() => {});
          }
          syncBreakpointVisuals();
        }
      };
    });

    // Прокрутка к текущей строке PC
    if (pc !== null) {
      const currentRow = el.querySelector('.disasm-row.is-current');
      if (currentRow) {
        currentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  /**
   * Отрисовать боковую панель дизассемблера (слева от редактора Monaco)
   * @param {Array<{address:number, hex:string[], text:string}>|null} instructions — инструкции
   * @param {number|null} pc — текущий PC
   */
  function renderSideDisassemblerPanel(instructions, pc) {
    const el = document.getElementById('side-disasm-content');
    if (!el) return;

    if (!instructions || instructions.length === 0) {
      return;
    }

    let html = '';

    for (const instr of instructions) {
      const addr = instr.address;
      const addrOct = ('000000' + addr.toString(8)).slice(-6);
      const isCurrent = (pc !== null && addr === pc);
      const isBp = debugView.breakpoints.has(addr);

      let rowClass = 'disasm-row';
      if (isCurrent) rowClass += ' is-current';
      if (isBp) rowClass += ' has-breakpoint';

      const hexStr = (instr.hex || []).join(' ');
      const text = escapeHtml(instr.text || '???');
      const spaceIdx = instr.text ? instr.text.search(/\s/) : -1;
      let mnemHtml;
      if (spaceIdx > 0) {
        const op = escapeHtml(instr.text.substring(0, spaceIdx));
        const args = escapeHtml(instr.text.substring(spaceIdx));
        mnemHtml = `<span class="disasm-op">${op}</span><span class="disasm-arg">${args}</span>`;
      } else {
        mnemHtml = `<span class="disasm-op">${text}</span>`;
      }

      html += `<div class="${rowClass}" data-addr="${addr}" title="Клик: к строке исходника. Клик по кружку: breakpoint">`;
      html += `<span class="disasm-bp-dot" title="Точка останова @ 0${addrOct}"></span>`;
      html += `<span class="disasm-pc-arrow">${isCurrent ? '▶' : ' '}</span>`;
      html += `<span class="disasm-addr">0${addrOct}</span>`;
      html += `<span class="disasm-hex" style="width: 75px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(hexStr)}</span>`;
      html += `<span class="disasm-mnem">${mnemHtml}</span>`;
      html += '</div>';
    }

    el.innerHTML = html;

    // Вешаем обработчики кликов на строки
    el.querySelectorAll('.disasm-row').forEach(row => {
      row.onclick = (e) => {
        const addr = parseInt(row.dataset.addr, 10);
        if (isNaN(addr)) return;

        // Если клик по точке останова:
        if (e.target.classList.contains('disasm-bp-dot')) {
          if (debugView.breakpoints.has(addr)) {
            debugView.breakpoints.delete(addr);
            emulatorBridge.debug('clearBreakpoint', addr).catch(() => {});
          } else {
            debugView.breakpoints.add(addr);
            emulatorBridge.debug('setBreakpoint', addr).catch(() => {});
          }
          syncBreakpointVisuals();
          return;
        }

        // Переход к строке исходника в Monaco Editor
        const lineNum = lstAddressMap.get(addr);
        if (lineNum && editor) {
          editor.revealLineInCenter(lineNum);
          editor.setPosition({ lineNumber: lineNum, column: 1 });
          editor.focus();
        } else {
          // Иначе переключаем точку останова
          if (debugView.breakpoints.has(addr)) {
            debugView.breakpoints.delete(addr);
            emulatorBridge.debug('clearBreakpoint', addr).catch(() => {});
          } else {
            debugView.breakpoints.add(addr);
            emulatorBridge.debug('setBreakpoint', addr).catch(() => {});
          }
          syncBreakpointVisuals();
        }
      };
    });

    if (pc !== null) {
      const currentRow = el.querySelector('.disasm-row.is-current');
      if (currentRow) {
        currentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  /**
   * Синхронизировать состояние чекбоксов "Следить за PC"
   * @param {boolean} checked
   */
  function syncFollowPC(checked) {
    const followPcEl = document.getElementById('disasm-follow-pc');
    const sideFollowPcEl = document.getElementById('side-disasm-follow-pc');
    if (followPcEl && followPcEl.checked !== checked) {
      followPcEl.checked = checked;
    }
    if (sideFollowPcEl && sideFollowPcEl.checked !== checked) {
      sideFollowPcEl.checked = checked;
    }
    if (checked) {
      debugView.lastDisasmPC = -1;
      updateDisassemblerPanel();
    }
  }

  /**
   * Инициализировать события бокового дизассемблера
   */
  function setupSideDisasmEvents() {
    const closeBtn = document.getElementById('side-disasm-close-btn');
    const sidePanel = document.getElementById('side-disasm-panel');
    const splitter = document.getElementById('splitter-side-disasm');
    const goBtn = document.getElementById('side-disasm-go-btn');
    const addrInput = document.getElementById('side-disasm-addr-input');
    const followPcEl = document.getElementById('side-disasm-follow-pc');

    if (closeBtn && !closeBtn._bound) {
      closeBtn._bound = true;
      closeBtn.onclick = () => {
        if (sidePanel) sidePanel.style.display = 'none';
        if (splitter) splitter.style.display = 'none';
        if (editor) editor.layout();
      };
    }

    if (followPcEl && !followPcEl._bound) {
      followPcEl._bound = true;
      followPcEl.addEventListener('change', () => {
        syncFollowPC(followPcEl.checked);
      });
    }

    if (goBtn && addrInput && !goBtn._bound) {
      goBtn._bound = true;
      goBtn.onclick = async () => {
        const addr = parseInt(addrInput.value.trim(), 8);
        if (isNaN(addr) || addr < 0 || addr > 0xFFFF) return;
        debugView.disasmBaseAddress = addr;
        debugView.lastDisasmPC = -1;
        syncFollowPC(false);
        try {
          const instructions = await emulatorBridge.debug('disassemble', addr, 32);
          const pc = await emulatorBridge.debug('getPC');
          renderDisassemblerPanel(instructions, pc);
          renderSideDisassemblerPanel(instructions, pc);
        } catch (e) {}
      };
      addrInput.onkeydown = (e) => {
        if (e.key === 'Enter') goBtn.click();
      };
    }

    // Сплиттер для изменения ширины бокового дизассемблера
    if (splitter && sidePanel && !splitter._bound) {
      splitter._bound = true;
      let isDragging = false;
      splitter.onmousedown = (e) => {
        isDragging = true;
        splitter.classList.add('active');
        document.body.style.cursor = 'col-resize';
      };
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const rect = sidePanel.getBoundingClientRect();
        const newWidth = Math.max(180, Math.min(600, e.clientX - rect.left));
        sidePanel.style.width = newWidth + 'px';
        if (editor) editor.layout();
      });
      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          splitter.classList.remove('active');
          document.body.style.cursor = '';
          if (editor) editor.layout();
        }
      });
    }
  }

  /**
   * Инициализировать события нижней панели дизассемблера (вызывается один раз при enableDebugView)
   */
  function setupDisasmPanelEvents() {
    const goBtn = document.getElementById('disasm-go-btn');
    const addrInput = document.getElementById('disasm-addr-input');
    const followPcEl = document.getElementById('disasm-follow-pc');

    if (followPcEl && !followPcEl._bound) {
      followPcEl._bound = true;
      followPcEl.addEventListener('change', () => {
        syncFollowPC(followPcEl.checked);
      });
    }

    if (goBtn && addrInput && !goBtn._bound) {
      goBtn._bound = true;
      goBtn.onclick = async () => {
        const addr = parseInt(addrInput.value.trim(), 8);
        if (isNaN(addr) || addr < 0 || addr > 0xFFFF) return;
        debugView.disasmBaseAddress = addr;
        debugView.lastDisasmPC = -1; // сброс кэша
        syncFollowPC(false);
        try {
          const instructions = await emulatorBridge.debug('disassemble', addr, 32);
          const pc = await emulatorBridge.debug('getPC');
          renderDisassemblerPanel(instructions, pc);
          renderSideDisassemblerPanel(instructions, pc);
        } catch (e) {}
      };

      addrInput.onkeydown = (e) => {
        if (e.key === 'Enter') goBtn.click();
      };
    }
  }

  // =====================================================================
  // Формат чисел (OCT/DEC/BIN)
  // =====================================================================
  let numFormat = 'oct'; // 'oct', 'dec', 'bin'

  /**
   * Отформатировать адрес — всегда восьмеричный (стандарт разработки БК)
   * @param {number} value — адрес
   * @returns {string}
   */
  function formatAddress(value) {
    if (value === null || value === undefined) return '------';
    return ('000000' + (Math.floor(value) & 0xFFFF).toString(8)).slice(-6);
  }

  /**
   * Отформатировать байт в зависимости от текущего формата
   * @param {number} value — байт (обрезается до 8 бит)
   * @returns {string}
   */
  function formatByte(value) {
    if (value === null || value === undefined) return '--';
    const v = Math.floor(value) & 0xFF;
    if (numFormat === 'oct') {
      return ('00' + v.toString(8)).slice(-2);
    } else if (numFormat === 'dec') {
      return ('000' + v.toString(10)).slice(-3);
    } else if (numFormat === 'bin') {
      // Разделяем по 4 бит: 1111 1111
      const bin = ('00000000' + v.toString(2)).slice(-8);
      return bin.slice(0, 4) + ' ' + bin.slice(4);
    }
    return ('00' + v.toString(8)).slice(-2);
  }

  /**
   * Отформатировать значение в зависимости от текущего формата
   * @param {number} value — значение (обрезается до 16 бит)
   * @returns {string}
   */
  function formatNumber(value) {
    if (value === null || value === undefined) return '------';
    const v = Math.floor(value) & 0xFFFF;

    if (numFormat === 'oct') {
      return ('000000' + v.toString(8)).slice(-6);
    } else if (numFormat === 'dec') {
      return ('00000' + v.toString(10)).slice(-5);
    } else if (numFormat === 'bin') {
      // Разделяем по 4 бит пробелом
      const bin = ('0000000000000000' + v.toString(2)).slice(-16);
      return bin.slice(0, 4) + ' ' + bin.slice(4, 8) + ' ' + bin.slice(8, 12) + ' ' + bin.slice(12);
    }
    return ('000000' + v.toString(8)).slice(-6);
  }

  // =====================================================================
  // Memory View — просмотр памяти
  // =====================================================================
  let memViewer = {
    baseAddress: 0o1000,
    manualAddress: 0o1000,
    followMode: 'pc',
    lastPC: null,
    lastSP: null,
    lastHash: ''
  };

  /**
   * Обновить панель памяти
   */
  async function updateMemoryPanel() {
    if (!debugModeActive) return;
    const memPanel = document.getElementById('memory-panel');
    if (!memPanel || memPanel.style.display === 'none') return;

    try {
      const regs = await emulatorBridge.debug('getRegisters');
      const pc = regs.pc;
      const sp = regs.sp;

      if (memViewer.followMode === 'pc' && pc !== memViewer.lastPC) {
        memViewer.baseAddress = (pc & 0xFFFC) - 32;
      } else if (memViewer.followMode === 'sp' && sp !== memViewer.lastSP) {
        memViewer.baseAddress = (sp & 0xFFFC) - 16;
      }
      memViewer.lastPC = pc;
      memViewer.lastSP = sp;

      renderMemorySimple(memViewer.baseAddress, pc, sp);
      updateMemoryAddressInput(memViewer.baseAddress);
    } catch (err) {
      // Эмулятор ещё не готов — ждём
    }
  }

  /**
   * Отрисовать hex-редактор памяти (WORD режим)
   */
  async function renderMemorySimple(baseAddr, pcAddr, spAddr) {
    const el = document.getElementById('memory-content');
    if (!el) return;

    const totalRows = 16;
    const wordsPerRow = 4;
    const totalWords = totalRows * wordsPerRow; // 64 слова

    try {
      // Читаем память БК блоком
      const memory = await emulatorBridge.debug('readMemory', baseAddr, totalWords);
      if (!memory || memory.length === 0) return;

      let html = '';

      for (let row = 0; row < totalRows; row++) {
        const rowAddr = (baseAddr + row * wordsPerRow) & 0xFFFF;

        let rowClass = 'memory-row';
        if (pcAddr !== null && rowAddr === (pcAddr & 0xFFFC)) {
          rowClass += ' pc-row';
        }
        if (spAddr !== null && (rowAddr === spAddr || (rowAddr + 1) === spAddr)) {
          rowClass += ' sp-row';
        }

        html += '<div class="' + rowClass + '">';
        html += '<span class="mem-row-addr">0' + formatAddress(rowAddr) + '</span>';

        let dataCells = '';
        let asciiChars = '';

        // WORD режим — 4 слова в строке
        for (let col = 0; col < wordsPerRow; col++) {
          const idx = row * wordsPerRow + col;
          const word = (memory[idx] || 0) & 0xFFFF;
          dataCells += formatNumber(word) + '  ';

          // ASCII из слова
          const high = (word >> 8) & 0xFF;
          const low = word & 0xFF;
          asciiChars += toAsciiChar(high);
          asciiChars += toAsciiChar(low);
        }

        html += '<span class="mem-row-data">' + dataCells.trimEnd() + '</span>';
        html += '<span class="mem-row-ascii">' + asciiChars + '</span>';
        html += '</div>';
      }

      el.innerHTML = html;
    } catch (e) {
      // Эмулятор ещё не готов
    }
  }

  /**
   * Преобразовать байт в ASCII-представление
   */
  function toAsciiChar(byte) {
    if (byte >= 32 && byte <= 126) {
      return String.fromCharCode(byte);
    } else if (byte === 10) {
      return '.';
    } else if (byte === 13) {
      return '.';
    } else if (byte === 9) {
      return '.';
    } else {
      return '.';
    }
  }

  /**
   * Обновить поле адреса в toolbar
   */
  function updateMemoryAddressInput(addr) {
    const input = document.getElementById('mem-address-input');
    if (!input) return;
    // Если пользователь держит фокус в поле и редактирует его, не перезаписываем значение
    if (document.activeElement === input) return;
    input.value = formatAddress(addr);
  }

  /**
   * Установить адрес просмотра памяти
   */
  function setMemoryAddress(addr) {
    memViewer.baseAddress = addr;
    memViewer.followMode = 'manual';
    memViewer.manualAddress = addr;
    updateFollowButtons();
    renderMemorySimple(addr, memViewer.lastPC, memViewer.lastSP);
    const input = document.getElementById('mem-address-input');
    if (input) input.value = formatAddress(addr);
  }

  /**
   * Обновить состояние кнопок Follow
   */
  function updateFollowButtons() {
    const btnPc = document.getElementById('btn-follow-pc');
    const btnSp = document.getElementById('btn-follow-sp');
    const btnManual = document.getElementById('btn-follow-manual');

    if (btnPc) btnPc.classList.toggle('active', memViewer.followMode === 'pc');
    if (btnSp) btnSp.classList.toggle('active', memViewer.followMode === 'sp');
    if (btnManual) btnManual.classList.toggle('active', memViewer.followMode === 'manual');
  }

  function switchBottomTab(tabName) {
    document.querySelectorAll('.bottom-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });

    const consoleEl = document.getElementById('console-output');
    const listingEl = document.getElementById('listing-output');
    const debugOutputEl = document.getElementById('debug-output-panel');
    const memoryEl = document.getElementById('memory-panel');
    const disasmEl = document.getElementById('disasm-panel');

    // Скрываем все панели
    if (consoleEl) consoleEl.style.display = 'none';
    if (listingEl) listingEl.style.display = 'none';
    if (debugOutputEl) debugOutputEl.style.display = 'none';
    if (memoryEl) memoryEl.style.display = 'none';
    if (disasmEl) disasmEl.style.display = 'none';

    if (tabName === 'console') {
      if (consoleEl) consoleEl.style.display = 'block';
    } else if (tabName === 'listing') {
      if (listingEl) listingEl.style.display = 'block';
    } else if (tabName === 'debug') {
      if (debugOutputEl) debugOutputEl.style.display = 'block';
    } else if (tabName === 'memory') {
      if (memoryEl) memoryEl.style.display = 'flex';
    } else if (tabName === 'disasm') {
      if (disasmEl) disasmEl.style.display = 'flex';
      // При переключении на вкладку — немедленно обновляем дизассемблер
      if (debugView.active) {
        debugView.lastDisasmPC = -1; // сброс кэша для принудительного обновления
        updateDisassemblerPanel();
      }
    }
  }

  /**
   * Интерактивный ресайз панелей мышью
   */
  function setupSplitters() {
    // 1. Горизонтальный разделитель сайдбара
    const splitterSidebar = document.getElementById('splitter-sidebar');
    const sidebar = document.getElementById('sidebar');

    if (splitterSidebar && sidebar) {
      let isDragging = false;
      splitterSidebar.onmousedown = (e) => {
        isDragging = true;
        splitterSidebar.classList.add('active');
        document.body.style.cursor = 'col-resize';
      };

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const newWidth = Math.max(160, Math.min(450, e.clientX));
        sidebar.style.width = newWidth + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          splitterSidebar.classList.remove('active');
          document.body.style.cursor = '';
        }
      });
    }

    // 2. Горизонтальный разделитель эмулятора
    // Панель эмулятора зафиксирована (Pixel Perfect 512×384) — дрэг отключён
    const splitterEmu = document.getElementById('splitter-emu');
    if (splitterEmu) {
        // Скрываем сплиттер: ширина панели эмулятора фиксирована в CSS
        splitterEmu.style.cursor = 'default';
        splitterEmu.style.pointerEvents = 'none';
        splitterEmu.style.background = 'transparent';
    }

    // 3. Вертикальный разделитель консоли
    const splitterBottom = document.getElementById('splitter-bottom');
    const bottomPanel = document.getElementById('bottom-panel');

    if (splitterBottom && bottomPanel) {
      let isDragging = false;
      splitterBottom.onmousedown = (e) => {
        isDragging = true;
        splitterBottom.classList.add('active');
        document.body.style.cursor = 'row-resize';
      };

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const newHeight = Math.max(36, Math.min(500, window.innerHeight - e.clientY - 28));
        bottomPanel.style.height = newHeight + 'px';
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          splitterBottom.classList.remove('active');
          document.body.style.cursor = '';
        }
      });
    }
  }

  global.loadProjectFromZipBuffer = loadProjectFromZipBuffer;
  global.loadProjectFromZipUrl = loadProjectFromZipUrl;
  global.compileProject = compileProject;
  global.compileAndRun = compileAndRun;
  global.compileOnly = compileOnly;
  global.detectCompilerFromSources = detectCompilerFromSources;

  // Запуск при готовности DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})(typeof window !== 'undefined' ? window : this);
