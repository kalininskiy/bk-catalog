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

  /**
   * Запуск приложения после загрузки DOM
   */
  async function initApp() {
    console.log('[BKStudio] Запуск среды разработки...');

    // 1. Инициализация моста к эмулятору
    emulatorBridge = new BKEmulatorBridge('emulator-frame');
    global.bkEmulator = emulatorBridge;
    global.emulatorBridge = emulatorBridge;

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
        lineNumbers: 'on',
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
   * Синхронизация UI элементов компилятора (селектора и бейджа)
   */
  function updateCompilerUI(compilerName) {
    const select = document.getElementById('compiler-select');
    const badge = document.getElementById('compiler-info-badge');
    if (select && select.value !== compilerName) {
      select.value = compilerName;
    }
    if (badge) {
      if (compilerName === 'macro11') {
        badge.textContent = 'Макроассемблер MACRO-11 (DEC) + pclink11 (WASM)';
      } else if (compilerName === 'pdpy11') {
        badge.textContent = 'Кросс-ассемблер PDPy11 (Python WASM)';
      } else {
        badge.textContent = 'Кросс-ассемблер BKTurbo8 (WASM)';
      }
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
   * Вывод сообщений в консоль
   */
  function logToConsole(text, type = 'stdout') {
    const consoleEl = document.getElementById('console-output');
    if (!consoleEl) return;

    const div = document.createElement('div');
    div.className = 'log-' + type;
    div.textContent = text;

    // Если это строка ошибки, делаем кликабельной для перехода к строке
    const match = text.match(/Line\s+(\d+)/i);
    if (match && editor) {
      const lineNum = parseInt(match[1], 10);
      div.title = `Нажмите для перехода к строке ${lineNum}`;
      div.onclick = () => {
        editor.revealLineInCenter(lineNum);
        editor.setPosition({ lineNumber: lineNum, column: 1 });
        editor.focus();
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
        switchBottomTab(tab);
      };
    });

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

  function switchBottomTab(tabName) {
    document.querySelectorAll('.bottom-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });

    const consoleEl = document.getElementById('console-output');
    const listingEl = document.getElementById('listing-output');

    if (tabName === 'console') {
      consoleEl.style.display = 'block';
      listingEl.style.display = 'none';
    } else if (tabName === 'listing') {
      consoleEl.style.display = 'none';
      listingEl.style.display = 'block';
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
