/**
 * BKStudio - AI Assistant UI Controller
 *
 * Управляет интерфейсом AI-панели в правой колонке BKStudio.
 * Использует ТОЛЬКО window.bkAI (и window.bkAI.getContext()).
 * Не выполняет прямых вызовов к сторонним API.
 *
 * Возможности:
 *   - Выбор провайдера / профиля (OpenAI, Anthropic, Gemini, llama.cpp, Ollama, LM Studio);
 *   - Выбор и ввод модели;
 *   - Редактирование baseUrl;
 *   - Ввод и сохранение API key;
 *   - Отправка запросов со стримингом ответа (SSE);
 *   - Остановка генерации (AbortController);
 *   - Очистка истории сообщений;
 *   - Быстрые действия: Объясни (Explain), Исправь (Fix), Создай (Generate).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class BKAIPanel {
    constructor() {
      /** @type {Array<{role: string, content: string}>} История диалога */
      this.history = [];

      /** @type {AbortController|null} Контроллер для прерывания текущего запроса */
      this.abortController = null;

      /** @type {boolean} Флаг активного запроса */
      this.isLoading = false;

      /** @type {"chat"|"agent"} Текущий режим работы */
      this.mode = 'chat';

      /** @type {number} Лимит итераций агента */
      this.maxIterations = 50;

      /** @type {boolean} Флаг разрешения всех опасных действий в текущей сессии */
      this.autoApproveSession = false;

      this.init();
    }

    /**
     * Инициализация панели после загрузки DOM
     */
    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this._bind());
      } else {
        this._bind();
      }
    }

    /**
     * Привязка DOM-элементов и обработчиков
     * @private
     */
    _bind() {
      // Кнопки переключения вкладок в заголовке правой панели
      this.btnTabEmu = document.getElementById('tab-btn-emulator');
      this.btnTabAI = document.getElementById('tab-btn-ai');
      this.viewEmu = document.getElementById('emulator-view');
      this.viewAI = document.getElementById('ai-view');
      this.emuHeaderActions = document.getElementById('emulator-header-actions');
      this.btnTopAI = document.getElementById('btn-ai-assistant');

      // Переключатель режима Чат / Агент
      this.btnModeChat = document.getElementById('ai-mode-chat');
      this.btnModeAgent = document.getElementById('ai-mode-agent');
      this.stepIndicator = document.getElementById('ai-step-indicator');
      this.autoApproveBadge = document.getElementById('ai-auto-approve-badge');
      this.maxIterationsInput = document.getElementById('ai-max-iterations-input');
      this.maxTokensInput = document.getElementById('ai-maxtokens-input');
      this.autoApproveCheckbox = document.getElementById('ai-auto-approve-session');

      // Элементы конфигурации AI
      this.profileSelect = document.getElementById('ai-profile-select');
      this.modelInput = document.getElementById('ai-model-input');
      this.baseUrlInput = document.getElementById('ai-baseurl-input');
      this.apiKeyInput = document.getElementById('ai-apikey-input');
      this.btnToggleSettings = document.getElementById('ai-btn-toggle-settings');
      this.settingsDrawer = document.getElementById('ai-settings-drawer');
      this.btnTestConn = document.getElementById('ai-btn-test-connection');
      this.statusConn = document.getElementById('ai-connection-status');

      // Быстрые действия
      this.btnActionExplain = document.getElementById('ai-action-explain');
      this.btnActionFix = document.getElementById('ai-action-fix');
      this.btnActionFixBuild = document.getElementById('ai-action-fix-build');
      this.btnActionGenerate = document.getElementById('ai-action-generate');
      this.btnClearHistory = document.getElementById('ai-btn-clear');

      // Чат и ввод
      this.messagesContainer = document.getElementById('ai-messages');
      this.promptInput = document.getElementById('ai-prompt-input');
      this.btnSend = document.getElementById('ai-btn-send');
      this.btnStop = document.getElementById('ai-btn-stop');

      if (!this.viewAI || !this.promptInput) {
        return; // Элементы еще не в DOM
      }

      this._setupTabs();
      this._populateProfiles();
      this._syncFromConfig();
      this._setupEvents();

      // Подписка на изменение конфигурации в bkAI
      if (global.bkAI && typeof global.bkAI.onChange === 'function') {
        global.bkAI.onChange(() => this._syncFromConfig());
      }
    }

    /**
     * Настройка переключения вкладок [Эмулятор] / [AI Ассистент]
     * @private
     */
    _setupTabs() {
      const showEmu = () => {
        if (this.btnTabEmu) this.btnTabEmu.classList.add('active');
        if (this.btnTabAI) this.btnTabAI.classList.remove('active');
        if (this.viewEmu) this.viewEmu.style.display = 'flex';
        if (this.viewAI) this.viewAI.style.display = 'none';
        if (this.emuHeaderActions) this.emuHeaderActions.style.display = 'flex';
      };

      const showAI = () => {
        if (this.btnTabAI) this.btnTabAI.classList.add('active');
        if (this.btnTabEmu) this.btnTabEmu.classList.remove('active');
        if (this.viewEmu) this.viewEmu.style.display = 'none';
        if (this.viewAI) this.viewAI.style.display = 'flex';
        if (this.emuHeaderActions) this.emuHeaderActions.style.display = 'none';
        if (this.promptInput) this.promptInput.focus();
      };

      if (this.btnTabEmu) this.btnTabEmu.addEventListener('click', showEmu);
      if (this.btnTabAI) this.btnTabAI.addEventListener('click', showAI);
      if (this.btnTopAI) this.btnTopAI.addEventListener('click', showAI);
    }

    /**
     * Заполнение списка профилей из bkAI
     * @private
     */
    _populateProfiles() {
      if (!this.profileSelect || !global.bkAI) return;
      const profiles = (typeof global.bkAI.getProfiles === 'function') ? global.bkAI.getProfiles() : [];

      this.profileSelect.innerHTML = '';
      for (const p of profiles) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        this.profileSelect.appendChild(opt);
      }
    }

    /**
     * Синхронизация полей UI из текущей конфигурации bkAI
     * @private
     */
    _syncFromConfig() {
      if (!global.bkAI) return;
      const cfg = global.bkAI.getConfig();

      if (this.profileSelect) {
        this.profileSelect.value = cfg.profile || cfg.provider || 'openai';
      }
      if (this.modelInput) {
        this.modelInput.value = cfg.model || '';
      }
      if (this.baseUrlInput) {
        this.baseUrlInput.value = cfg.baseUrl || '';
      }
      if (this.apiKeyInput) {
        this.apiKeyInput.value = cfg.apiKey || '';
      }
      if (this.maxIterationsInput) {
        this.maxIterationsInput.value = this.maxIterations;
      }
      if (this.maxTokensInput) {
        this.maxTokensInput.value = cfg.maxTokens || 4096;
      }
      if (this.autoApproveCheckbox) {
        this.autoApproveCheckbox.checked = this.autoApproveSession;
      }
    }

    /**
     * Включает или выключает автоматическое подтверждение опасных действий в текущей сессии
     * @param {boolean} enabled
     */
    setAutoApproveSession(enabled) {
      this.autoApproveSession = Boolean(enabled);

      if (this.autoApproveCheckbox) {
        this.autoApproveCheckbox.checked = this.autoApproveSession;
      }
      if (this.autoApproveBadge) {
        this.autoApproveBadge.style.display = this.autoApproveSession ? 'inline-flex' : 'none';
      }

      const agent = (global.bkAI && typeof global.bkAI.getAgent === 'function')
        ? global.bkAI.getAgent()
        : (global.bkAIAgent || null);
      if (agent && typeof agent.setAutoApproveAll === 'function') {
        agent.setAutoApproveAll(this.autoApproveSession);
      }
    }

    /**
     * Привязка событий элементов управления
     * @private
     */
    _setupEvents() {
      // Авто-разрешение действий в сессии (чекбокс в настройках)
      if (this.autoApproveCheckbox) {
        this.autoApproveCheckbox.addEventListener('change', () => {
          this.setAutoApproveSession(this.autoApproveCheckbox.checked);
        });
      }

      // Клик по бейджу в заголовке отключает авто-разрешение
      if (this.autoApproveBadge) {
        this.autoApproveBadge.addEventListener('click', () => {
          this.setAutoApproveSession(false);
        });
      }

      // Смена профиля
      if (this.profileSelect) {
        this.profileSelect.addEventListener('change', () => {
          const profileId = this.profileSelect.value;
          if (global.bkAI && typeof global.bkAI.applyProfile === 'function') {
            global.bkAI.applyProfile(profileId);
            this._syncFromConfig();
          }
        });
      }

      // Изменение модели
      if (this.modelInput) {
        this.modelInput.addEventListener('change', () => {
          if (global.bkAI) {
            global.bkAI.setConfig({ model: this.modelInput.value.trim() });
          }
        });
      }

      // Изменение baseUrl
      if (this.baseUrlInput) {
        this.baseUrlInput.addEventListener('change', () => {
          if (global.bkAI) {
            global.bkAI.setConfig({ baseUrl: this.baseUrlInput.value.trim() });
          }
        });
      }

      // Изменение apiKey
      if (this.apiKeyInput) {
        this.apiKeyInput.addEventListener('change', () => {
          if (global.bkAI) {
            global.bkAI.setConfig({ apiKey: this.apiKeyInput.value.trim() });
          }
        });
      }

      // Изменение maxTokens
      if (this.maxTokensInput) {
        this.maxTokensInput.addEventListener('change', () => {
          const val = parseInt(this.maxTokensInput.value, 10);
          if (global.bkAI && !isNaN(val) && val > 0) {
            global.bkAI.setConfig({ maxTokens: val });
          }
        });
      }

      // Изменение maxIterations
      if (this.maxIterationsInput) {
        this.maxIterationsInput.addEventListener('change', () => {
          const val = parseInt(this.maxIterationsInput.value, 10);
          if (!isNaN(val) && val > 0) {
            this.maxIterations = val;
          }
        });
      }

      // Раскрытие / скрытие секции настроек
      if (this.btnToggleSettings && this.settingsDrawer) {
        this.btnToggleSettings.addEventListener('click', () => {
          const isOpen = this.settingsDrawer.style.display !== 'none';
          this.settingsDrawer.style.display = isOpen ? 'none' : 'flex';
          this.btnToggleSettings.classList.toggle('active', !isOpen);
        });
      }

      // Проверка соединения (Test Connection)
      if (this.btnTestConn) {
        this.btnTestConn.addEventListener('click', () => this.testConnection());
      }

      // Быстрые действия
      if (this.btnActionExplain) {
        this.btnActionExplain.addEventListener('click', () => this.actionExplain());
      }
      if (this.btnActionFix) {
        this.btnActionFix.addEventListener('click', () => this.actionFix());
      }
      if (this.btnActionFixBuild) {
        this.btnActionFixBuild.addEventListener('click', () => this.actionFixBuild());
      }
      if (this.btnActionGenerate) {
        this.btnActionGenerate.addEventListener('click', () => this.actionGenerate());
      }

      // Очистка истории
      if (this.btnClearHistory) {
        this.btnClearHistory.addEventListener('click', () => this.clearHistory());
      }

      // Отправка запроса по кнопке
      if (this.btnSend) {
        this.btnSend.addEventListener('click', () => this.sendMessage());
      }

      // Остановка запроса
      if (this.btnStop) {
        this.btnStop.addEventListener('click', () => this.stopGeneration());
      }

      // Переключение режимов: Чат / Агент
      if (this.btnModeChat) {
        this.btnModeChat.addEventListener('click', () => this.setMode('chat'));
      }
      if (this.btnModeAgent) {
        this.btnModeAgent.addEventListener('click', () => this.setMode('agent'));
      }
      if (this.maxIterationsInput) {
        this.maxIterationsInput.addEventListener('change', () => {
          const val = parseInt(this.maxIterationsInput.value, 50);
          if (!isNaN(val) && val > 0 && val <= 100) {
            this.maxIterations = val;
          }
        });
      }

      // Горячие клавиши в поле ввода: Ctrl+Enter для отправки
      if (this.promptInput) {
        this.promptInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.sendMessage();
          }
        });
      }
    }

    /**
     * Переключает режим работы между обычным диалогом (chat) и автономным агентом (agent)
     * @param {"chat"|"agent"} mode
     */
    setMode(mode) {
      this.mode = mode === 'agent' ? 'agent' : 'chat';
      if (this.btnModeChat) this.btnModeChat.classList.toggle('active', this.mode === 'chat');
      if (this.btnModeAgent) this.btnModeAgent.classList.toggle('active', this.mode === 'agent');
      if (this.promptInput) {
        this.promptInput.placeholder = this.mode === 'agent'
          ? 'Опишите задачу для агента (например: "Проверь main.asm, собери и запусти в эмуляторе")...'
          : 'Задайте вопрос или опишите задачу для БК-0010 (Ctrl+Enter для отправки)...';
      }
    }

    /**
     * Проверяет подключение к провайдеру через bkAI.testConnection()
     */
    async testConnection() {
      if (!global.bkAI || !this.statusConn) return;

      this.statusConn.textContent = 'Проверка...';
      this.statusConn.style.color = 'var(--text-secondary)';

      try {
        const res = await global.bkAI.testConnection();
        if (res && res.success) {
          this.statusConn.textContent = '✓ Соединение успешно';
          this.statusConn.style.color = 'var(--accent-green)';
        } else {
          this.statusConn.textContent = 'Не удалось подключиться';
          this.statusConn.style.color = 'var(--accent-red)';
        }
      } catch (err) {
        this.statusConn.textContent = `✕ ${err.message || 'Ошибка'}`;
        this.statusConn.style.color = 'var(--accent-red)';
      }
    }

    /**
     * Быстрое действие: Объясни (Explain)
     */
    actionExplain() {
      const ctx = global.bkAI && typeof global.bkAI.getContext === 'function' ? global.bkAI.getContext() : null;
      let code = '';
      let targetDesc = 'текущий файл';

      if (ctx) {
        const sel = ctx.getSelection();
        if (sel && sel.hasSelection && sel.text) {
          code = sel.text;
          targetDesc = `выделенный фрагмент (строки ${sel.startLine}-${sel.endLine})`;
        } else {
          const curFile = ctx.getCurrentFile();
          code = curFile.content;
          targetDesc = `файл ${curFile.name}`;
        }
      }

      if (!code || code.trim().length === 0) {
        this.appendMessage('error', 'В редакторе нет кода для объяснения.');
        return;
      }

      const prompt = `Объясни подробно следующий код для Электроника БК-0010 (${targetDesc}):\n\`\`\`pdp11\n${code}\n\`\`\``;
      this.sendMessage(prompt);
    }

    /**
     * Быстрое действие: Исправь (Fix)
     */
    actionFix() {
      const ctx = global.bkAI && typeof global.bkAI.getContext === 'function' ? global.bkAI.getContext() : null;
      let code = '';
      let errorInfo = '';

      if (ctx) {
        const curFile = ctx.getCurrentFile();
        code = curFile.content;

        const diags = ctx.getDiagnostics();
        if (diags && diags.length > 0) {
          errorInfo = 'Ошибки компилятора / LSP:\n' + diags.map(d => `- строка ${d.line || '?'}: ${d.message}`).join('\n');
        }
      }

      if (!code || code.trim().length === 0) {
        this.appendMessage('error', 'В редакторе нет кода для исправления.');
        return;
      }

      let prompt = `Найди и исправь ошибки в этом коде для Электроника БК:\n\`\`\`pdp11\n${code}\n\`\`\``;
      if (errorInfo) {
        prompt += `\n\n${errorInfo}`;
      }

      this.sendMessage(prompt);
    }

    /**
     * Быстрое действие: Исправь ошибку сборки (готовй автономный сценарий агента)
     */
    async actionFixBuild() {
      this.setMode('agent');

      const userNotice = '🔧 **Сценарий:** Исправь ошибку сборки.\nАгент проверит сборку, найдет ошибку, прочитает только проблемный файл, предложит исправление, запишет изменения после подтверждения и повторно пересоберет проект.';
      this.appendMessage('user', userNotice);
      this.history.push({ role: 'user', content: 'Исправь ошибку сборки.' });

      this.abortController = new AbortController();
      this._setLoadingState(true);

      if (this.stepIndicator) {
        this.stepIndicator.style.display = 'inline-block';
        this.stepIndicator.textContent = `Шаг 1 из ${this.maxIterations}`;
      }

      const agent = (global.bkAI && typeof global.bkAI.getAgent === 'function')
        ? global.bkAI.getAgent()
        : (global.bkAIAgent || (typeof BKAIAgent !== 'undefined' ? new BKAIAgent() : null));

      const runFn = (global.bkAI && typeof global.bkAI.runFixBuildScenario === 'function')
        ? (p) => global.bkAI.runFixBuildScenario(p)
        : (agent && typeof agent.runFixBuildScenario === 'function' ? (p) => agent.runFixBuildScenario(p) : null);

      if (!runFn) {
        this.appendMessage('error', 'Агентный модуль BKAIAgent не инициализирован.');
        this._setLoadingState(false);
        if (this.stepIndicator) this.stepIndicator.style.display = 'none';
        return;
      }

      try {
        await runFn({
          history: this.history.slice(0, -1),
          maxIterations: this.maxIterations,
          signal: this.abortController.signal,

          onStep: ({ iteration, maxIterations }) => {
            if (this.stepIndicator) {
              this.stepIndicator.textContent = `Шаг ${iteration} из ${maxIterations}`;
            }
          },

          onThought: (thoughtText) => {
            if (!thoughtText || !thoughtText.trim()) return;
            const bubble = this.createMessageBubble('assistant');
            const content = bubble.querySelector('.ai-message-content');
            this._renderMarkdown(content, thoughtText, false);
            this._scrollToBottom();
          },

          onToolCall: (tc) => {
            this.createToolCallCard(tc);
          },

          onRequestConfirmation: async (tc) => {
            return this.requestToolConfirmation(tc);
          },

          onToolResult: (res) => {
            this.updateToolCallResult(res);
          },

          onFinalAnswer: (answerText) => {
            const finalBubble = this.createMessageBubble('assistant');
            const content = finalBubble.querySelector('.ai-message-content');
            this._renderMarkdown(content, answerText, false);
            this.history.push({ role: 'assistant', content: answerText });
            this._scrollToBottom();
          }
        });

      } catch (err) {
        if (err.name === 'AbortError') {
          this.appendMessage('assistant', '[Выполнение сценария остановлено пользователем]');
        } else {
          this.appendMessage('error', err.message || 'Ошибка выполнения сценария');
        }
      } finally {
        this.abortController = null;
        this._setLoadingState(false);
        if (this.stepIndicator) {
          this.stepIndicator.style.display = 'none';
        }
        this._scrollToBottom();
      }
    }

    /**
     * Быстрое действие: Создай (Generate)
     */
    actionGenerate() {
      if (!this.promptInput) return;
      this.promptInput.value = 'Напиши подпрограмму на ассемблере PDP-11 для БК-0010: ';
      this.promptInput.focus();
      this.promptInput.setSelectionRange(this.promptInput.value.length, this.promptInput.value.length);
    }

    /**
     * Очищает историю диалога
     */
    clearHistory() {
      this.history = [];
      if (this.messagesContainer) {
        this.messagesContainer.innerHTML = `
          <div class="ai-empty-state">
            <div class="ai-empty-icon">🤖</div>
            <div class="ai-empty-title">AI-Ассистент BKStudio</div>
            <div class="ai-empty-desc">
              Задайте вопрос по архитектуре PDP-11, регистрам БК-0010/11М,
              вызовам EMT или нажмите одну из кнопок быстрых действий выше.
            </div>
          </div>
        `;
      }
    }

    /**
     * Останавливает текущий запрос
     */
    stopGeneration() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      this._setLoadingState(false);
    }

    /**
     * Отправляет сообщение в AI (делегирует в Чат или Агент в зависимости от выбранного режима)
     * @param {string} [explicitPrompt] - Пользовательский промпт (если вызван из быстрых действий)
     */
    async sendMessage(explicitPrompt = null) {
      if (this.isLoading) return;
      if (!global.bkAI) {
        this.appendMessage('error', 'BKAIManager не инициализирован.');
        return;
      }

      const text = explicitPrompt || (this.promptInput ? this.promptInput.value.trim() : '');
      if (!text) return;

      if (!explicitPrompt && this.promptInput) {
        this.promptInput.value = '';
      }

      // Удаляем пустое состояние при первом сообщении
      const emptyState = this.messagesContainer ? this.messagesContainer.querySelector('.ai-empty-state') : null;
      if (emptyState) {
        emptyState.remove();
      }

      if (this.mode === 'agent') {
        return this.sendAgentMessage(text);
      }
      return this.sendChatMessage(text);
    }

    /**
     * Режим ЧАТ: прямой потоковый диалог с LLM (user → LLM → text)
     * @param {string} text
     */
    async sendChatMessage(text) {
      // Добавляем сообщение пользователя в UI и историю
      this.appendMessage('user', text);
      this.history.push({ role: 'user', content: text });

      // Собираем компактный контекст IDE через bkAI.getContext()
      let systemPrompt = 'Ты опытный эксперт по советским 16-битным компьютерам Электроника БК-0010/БК-0011М и ассемблеру DEC PDP-11.';
      const ctx = typeof global.bkAI.getContext === 'function' ? global.bkAI.getContext() : null;
      if (ctx && typeof ctx.buildContext === 'function') {
        const envContext = ctx.buildContext({
          includeSelection: false,
          includeDiagnostics: true,
          includeListing: false
        });
        systemPrompt += '\n\n' + envContext.toPromptString();
      }

      // Создаем блок ответа ассистента в UI для стриминга
      const assistantBubble = this.createMessageBubble('assistant');
      const contentEl = assistantBubble.querySelector('.ai-message-content');
      const cursor = document.createElement('span');
      cursor.className = 'ai-streaming-cursor';
      contentEl.appendChild(cursor);

      this.abortController = new AbortController();
      this._setLoadingState(true);

      let accumulatedText = '';

      try {
        const response = await global.bkAI.chat({
          messages: this.history.slice(),
          systemPrompt: systemPrompt,
          stream: true,
          signal: this.abortController.signal,
          onChunk: (chunk) => {
            const token = (chunk && typeof chunk === 'object' && chunk.delta !== undefined)
              ? chunk.delta
              : String(chunk || '');

            accumulatedText += token;
            this._renderMarkdown(contentEl, accumulatedText, true);
            this._scrollToBottom();
          }
        });

        // Завершение стриминга: убираем курсор и рендерим итоговый текст
        cursor.remove();
        const finalText = (response && response.text) ? response.text : accumulatedText;
        this._renderMarkdown(contentEl, finalText, false);
        this.history.push({ role: 'assistant', content: finalText });

      } catch (err) {
        cursor.remove();
        if (err.name === 'AbortError') {
          contentEl.innerHTML += '<div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">[Генерация остановлена пользователем]</div>';
        } else {
          this.appendMessage('error', err.message || 'Ошибка при запросе к AI');
        }
      } finally {
        this.abortController = null;
        this._setLoadingState(false);
        this._scrollToBottom();
      }
    }

    /**
     * Режим АГЕНТ: автономный цикл решения задач (user → LLM → tool call → tool → result → LLM → ... → final answer)
     * @param {string} text
     */
    async sendAgentMessage(text) {
      // Добавляем сообщение пользователя в UI и историю
      this.appendMessage('user', text);
      this.history.push({ role: 'user', content: text });

      this.abortController = new AbortController();
      this._setLoadingState(true);

      if (this.stepIndicator) {
        this.stepIndicator.style.display = 'inline-block';
        this.stepIndicator.textContent = `Шаг 1 из ${this.maxIterations}`;
      }

      const agent = (global.bkAI && typeof global.bkAI.getAgent === 'function')
        ? global.bkAI.getAgent()
        : (global.bkAIAgent || (typeof BKAIAgent !== 'undefined' ? new BKAIAgent() : null));

      if (!agent) {
        this.appendMessage('error', 'Агентный модуль BKAIAgent не инициализирован.');
        this._setLoadingState(false);
        if (this.stepIndicator) this.stepIndicator.style.display = 'none';
        return;
      }

      try {
        await agent.run({
          prompt: text,
          history: this.history.slice(0, -1),
          maxIterations: this.maxIterations,
          autoApproveAll: this.autoApproveSession,
          signal: this.abortController.signal,

          onStep: ({ iteration, maxIterations }) => {
            if (this.stepIndicator) {
              this.stepIndicator.textContent = `Шаг ${iteration} из ${maxIterations}`;
            }
          },

          onThought: (thoughtText) => {
            if (!thoughtText || !thoughtText.trim()) return;
            const bubble = this.createMessageBubble('assistant');
            const content = bubble.querySelector('.ai-message-content');
            this._renderMarkdown(content, thoughtText, false);
            this._scrollToBottom();
          },

          onToolCall: (tc) => {
            this.createToolCallCard(tc);
          },

          onRequestConfirmation: async (tc) => {
            return this.requestToolConfirmation(tc);
          },

          onToolResult: (res) => {
            this.updateToolCallResult(res);
          },

          onFinalAnswer: (answerText) => {
            const finalBubble = this.createMessageBubble('assistant');
            const content = finalBubble.querySelector('.ai-message-content');
            this._renderMarkdown(content, answerText, false);
            this.history.push({ role: 'assistant', content: answerText });
            this._scrollToBottom();
          }
        });

      } catch (err) {
        if (err.name === 'AbortError') {
          this.appendMessage('assistant', '[Выполнение агента остановлено пользователем]');
        } else {
          this.appendMessage('error', err.message || 'Ошибка выполнения агента');
        }
      } finally {
        this.abortController = null;
        this._setLoadingState(false);
        if (this.stepIndicator) {
          this.stepIndicator.style.display = 'none';
        }
        this._scrollToBottom();
      }
    }

    /**
     * Создает карточку вызова инструмента в списке сообщений
     * @param {Object} tc
     * @returns {HTMLElement}
     */
    createToolCallCard(tc) {
      const card = document.createElement('div');
      card.id = `tool-call-${tc.id}`;
      card.className = `ai-tool-card ${tc.requiresConfirmation ? 'dangerous' : ''}`;

      const header = document.createElement('div');
      header.className = 'ai-tool-header';

      const title = document.createElement('div');
      title.className = 'ai-tool-title';
      title.innerHTML = `<span>🔧</span> <span>${tc.name}</span>`;

      if (tc.requiresConfirmation && !this.autoApproveSession) {
        const badge = document.createElement('span');
        badge.className = 'ai-tool-badge dangerous';
        badge.textContent = 'Требует подтверждения';
        title.appendChild(badge);
      } else if (tc.requiresConfirmation && this.autoApproveSession) {
        const badge = document.createElement('span');
        badge.className = 'ai-tool-badge auto-approved';
        badge.textContent = '⚡ Авто-разрешено';
        title.appendChild(badge);
      }

      const status = document.createElement('div');
      status.className = 'ai-tool-status running';
      status.textContent = (tc.requiresConfirmation && !this.autoApproveSession)
        ? 'Ожидание решения...'
        : (this.autoApproveSession ? 'Выполняется... (авто)' : 'Выполняется...');

      header.appendChild(title);
      header.appendChild(status);

      const body = document.createElement('div');
      body.className = 'ai-tool-body';

      const argsTitle = document.createElement('div');
      argsTitle.className = 'ai-tool-section-title';
      argsTitle.textContent = 'Аргументы:';

      const argsPre = document.createElement('pre');
      argsPre.className = 'ai-tool-code-preview';
      argsPre.textContent = JSON.stringify(tc.arguments || {}, null, 2);

      body.appendChild(argsTitle);
      body.appendChild(argsPre);

      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'flex' : 'none';
      });

      card.appendChild(header);
      card.appendChild(body);

      if (this.messagesContainer) {
        this.messagesContainer.appendChild(card);
        this._scrollToBottom();
      }

      return card;
    }

    /**
     * Показывает диалог подтверждения перед опасным действием агента
     * @param {Object} tc
     * @returns {Promise<boolean>}
     */
    requestToolConfirmation(tc) {
      if (this.autoApproveSession) {
        const card = document.getElementById(`tool-call-${tc.id}`);
        const status = card ? card.querySelector('.ai-tool-status') : null;
        if (status) {
          status.textContent = 'Выполняется... (авто-разрешено)';
          status.className = 'ai-tool-status running';
        }
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        const card = document.getElementById(`tool-call-${tc.id}`);
        const confirmBox = document.createElement('div');
        confirmBox.className = 'ai-confirm-box';

        confirmBox.innerHTML = `
          <div class="ai-confirm-title">
            <span>⚠️</span>
            <span>Подтвердите действие: <code>${tc.name}</code></span>
          </div>
          <div style="font-size: 10.5px; color: var(--text-secondary);">
            Это действие изменяет проект или запускает код в эмуляторе.
          </div>
          <div class="ai-confirm-actions">
            <button class="ai-btn-confirm" title="Разрешить только это действие">✓ Разрешить</button>
            <button class="ai-btn-confirm-all" title="Разрешать все опасные действия в этой сессии без повторных запросов">⚡ Разрешать всё (в этой сессии)</button>
            <button class="ai-btn-reject" title="Отклонить выполнение действия">✕ Отклонить</button>
          </div>
        `;

        const btnConfirm = confirmBox.querySelector('.ai-btn-confirm');
        const btnConfirmAll = confirmBox.querySelector('.ai-btn-confirm-all');
        const btnReject = confirmBox.querySelector('.ai-btn-reject');

        const onAction = (approved, approveAll = false) => {
          if (approveAll) {
            this.setAutoApproveSession(true);
          }
          confirmBox.remove();
          const status = card ? card.querySelector('.ai-tool-status') : null;
          if (status) {
            status.textContent = approved
              ? (approveAll ? 'Выполняется... (сессия разрешена)' : 'Выполняется...')
              : 'Отклонено пользователем';
            status.className = approved ? 'ai-tool-status running' : 'ai-tool-status rejected';
          }
          resolve(approved);
        };

        if (btnConfirm) btnConfirm.addEventListener('click', () => onAction(true, false));
        if (btnConfirmAll) btnConfirmAll.addEventListener('click', () => onAction(true, true));
        if (btnReject) btnReject.addEventListener('click', () => onAction(false, false));

        if (card) {
          const body = card.querySelector('.ai-tool-body');
          if (body) {
            // Размещаем блок подтверждения на самом верху тела карточки для мгновенной видимости
            body.insertBefore(confirmBox, body.firstChild);
          } else {
            card.appendChild(confirmBox);
          }
        } else if (this.messagesContainer) {
          this.messagesContainer.appendChild(confirmBox);
        }

        this._scrollToBottom();

        // Гарантируем видимость кнопок подтверждения после перерасчета геометрии браузером
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            this._scrollToBottom();
            if (confirmBox && typeof confirmBox.scrollIntoView === 'function') {
              confirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 30);
        }
      });
    }

    /**
     * Отображает результат выполнения инструмента на карточке
     * @param {Object} res
     */
    updateToolCallResult(res) {
      const card = document.getElementById(`tool-call-${res.id}`);
      if (!card) return;

      const status = card.querySelector('.ai-tool-status');
      if (status) {
        if (res.success) {
          status.textContent = '✓ Выполнено';
          status.className = 'ai-tool-status success';
        } else {
          status.textContent = '✕ Отклонено / Ошибка';
          status.className = 'ai-tool-status error';
        }
      }

      const body = card.querySelector('.ai-tool-body');
      if (body) {
        const resTitle = document.createElement('div');
        resTitle.className = 'ai-tool-section-title';
        resTitle.style.marginTop = '4px';
        resTitle.textContent = 'Результат:';

        const resPre = document.createElement('pre');
        resPre.className = 'ai-tool-code-preview';
        resPre.style.maxHeight = '100px';

        const textRes = (res.result && typeof res.result === 'object')
          ? JSON.stringify(res.result, null, 2)
          : String(res.result || '');
        resPre.textContent = textRes.length > 500 ? textRes.slice(0, 500) + '... [обрезано]' : textRes;

        body.appendChild(resTitle);
        body.appendChild(resPre);
      }
      this._scrollToBottom();
    }

    /**
     * Переключает состояние интерфейса при загрузке
     * @private
     * @param {boolean} loading
     */
    _setLoadingState(loading) {
      this.isLoading = loading;
      if (this.btnSend) this.btnSend.style.display = loading ? 'none' : 'flex';
      if (this.btnStop) this.btnStop.style.display = loading ? 'flex' : 'none';
      if (this.promptInput) this.promptInput.disabled = loading;
    }

    /**
     * Создает DOM-элемент пузыря сообщения
     * @param {"user"|"assistant"|"error"} role
     * @param {string} [initialText=""]
     * @returns {HTMLElement}
     */
    createMessageBubble(role, initialText = '') {
      const bubble = document.createElement('div');
      bubble.className = `ai-message ${role}`;

      const header = document.createElement('div');
      header.className = 'ai-message-header';
      header.textContent = role === 'user' ? 'Вы' : (role === 'error' ? 'Ошибка' : 'AI-Ассистент');

      const content = document.createElement('div');
      content.className = 'ai-message-content';

      if (initialText) {
        if (role === 'error') {
          content.textContent = initialText;
        } else {
          this._renderMarkdown(content, initialText, false);
        }
      }

      bubble.appendChild(header);
      bubble.appendChild(content);

      if (this.messagesContainer) {
        this.messagesContainer.appendChild(bubble);
        this._scrollToBottom();
      }

      return bubble;
    }

    /**
     * Добавляет сообщение в контейнер
     * @param {"user"|"assistant"|"error"} role
     * @param {string} text
     */
    appendMessage(role, text) {
      return this.createMessageBubble(role, text);
    }

    /**
     * Простой безопасный рендерер Markdown (код, блоки, жирный текст)
     * @private
     * @param {HTMLElement} element
     * @param {string} rawText
     * @param {boolean} isStreaming
     */
    _renderMarkdown(element, rawText, isStreaming) {
      if (!rawText) {
        element.innerHTML = isStreaming ? '<span class="ai-streaming-cursor"></span>' : '';
        return;
      }

      // Экранирование HTML
      const escaped = rawText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Блоки кода ```lang ... ```
      const withCodeBlocks = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
      });

      // Инлайн-код `...`
      const withInlineCode = withCodeBlocks.replace(/`([^`]+)`/g, '<code>$1</code>');

      // Жирный шрифт **...**
      const withBold = withInlineCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

      // Переводы строк
      const withBreaks = withBold.replace(/\n/g, '<br>');

      element.innerHTML = withBreaks + (isStreaming ? '<span class="ai-streaming-cursor"></span>' : '');
    }

    /**
     * Прокрутка списка сообщений вниз
     * @private
     */
    _scrollToBottom() {
      if (this.messagesContainer) {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            if (this.messagesContainer) {
              this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }
          });
        }
      }
    }
  }

  // Экспорт синглтона в глобальную область
  const aiUIInstance = new BKAIPanel();
  global.BKAIPanel = BKAIPanel;
  global.bkAIUI = aiUIInstance;

})(typeof window !== 'undefined' ? window : this);
