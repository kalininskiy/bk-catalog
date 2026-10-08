/**
 * BKStudio - Anthropic Claude AI Provider
 *
 * Отдельный native-провайдер для Anthropic Claude с использованием Anthropic Messages API.
 * Поддерживает:
 *   - API key (заголовок x-api-key);
 *   - model (claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 и др.);
 *   - system prompt (выносится в отдельное верхнеуровневое поле "system" Messages API);
 *   - messages (роли user и assistant);
 *   - tool use: перевод инструментов, tool_calls и tool-результатов из формата OpenAI
 *     в блоки tool_use / tool_result Anthropic (с сохранением thinking-блоков между шагами агента);
 *   - streaming (SSE-поток с типами content_block_delta, message_delta, [message_stop]);
 *   - обработку ошибок API (401, 400, 429, 500 и json.error.message);
 *   - приведение результата к единому внутреннему формату BKAIManager.
 *
 * UI и BKAIManager не знают деталей реализации Anthropic API.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /** Базовый URL Anthropic API по умолчанию */
  const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

  /** Версия Anthropic API */
  const ANTHROPIC_VERSION = '2023-06-01';

  /** Модель по умолчанию */
  const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

  /** Список известных моделей Anthropic для fallback */
  const KNOWN_CLAUDE_MODELS = Object.freeze([
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' }
  ]);

  /** Максимальное число ходов ассистента, исходные блоки которых хранятся для повторной отправки */
  const TOOL_TURN_CACHE_LIMIT = 64;

  /**
   * Приводит имя инструмента к формату Anthropic (^[a-zA-Z0-9_-]+$).
   * Имена инструментов BKStudio содержат точки (project.write_file), которые API не принимает.
   * @param {string} name
   * @returns {string}
   */
  function toSafeToolName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '__');
  }

  /**
   * Разбирает аргументы вызова инструмента (строка JSON или объект) в объект input.
   * @param {string|Object} args
   * @returns {Object}
   */
  function parseToolInput(args) {
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      return args;
    }
    if (typeof args === 'string' && args.trim()) {
      try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (_) {}
    }
    return {};
  }

  /**
   * Проверяет, является ли блок блоком рассуждений (thinking / redacted_thinking).
   * @param {Object} block
   * @returns {boolean}
   */
  function isThinkingBlock(block) {
    return Boolean(block) && (block.type === 'thinking' || block.type === 'redacted_thinking');
  }

  /**
   * Быстрый некриптографический хэш строки (FNV-1a, 32 бит) с длиной строки.
   * @param {string} str
   * @returns {string}
   */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${str.length}:${h.toString(16)}`;
  }

  /**
   * Приводит content сообщения к строке.
   * @param {*} content
   * @returns {string}
   */
  function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(c => (c && c.text) || '').join('');
    if (content === null || content === undefined) return '';
    return typeof content === 'object' ? JSON.stringify(content) : String(content);
  }

  /**
   * Класс нативного провайдера Anthropic Claude
   */
  class AnthropicProvider {
    /**
     * @param {Object} [options]
     * @param {string} [options.name] - Имя провайдера (по умолчанию 'anthropic')
     */
    constructor(options = {}) {
      this.name = options.name || 'anthropic';

      /**
       * Агент не сокращает историю для этого провайдера: контекст моделей Claude достаточно велик,
       * а сокращение меняет контекст ходов и делает их thinking-блоки недействительными.
       * @type {boolean}
       */
      this.keepFullAgentHistory = true;

      /**
       * Исходные content-блоки ответов с tool_use (включая thinking с подписью), по id вызова.
       * Anthropic требует возвращать ход ассистента без изменений при отправке tool_result,
       * а агент хранит только текст и tool_calls в формате OpenAI.
       * @type {Map<string, Array<Object>>}
       */
      this._toolTurnCache = new Map();
    }

    /**
     * Переводит описания инструментов (OpenAI, стандартный формат реестра или Anthropic)
     * в формат Anthropic Messages API: { name, description, input_schema }.
     *
     * @param {Array<Object>} tools
     * @returns {{ tools: Array<Object>, nameMap: Object<string, string> }} nameMap: безопасное имя -> исходное
     */
    convertTools(tools) {
      const result = [];
      const nameMap = {};
      if (!Array.isArray(tools)) {
        return { tools: result, nameMap: nameMap };
      }

      for (const t of tools) {
        if (!t || typeof t !== 'object') continue;

        // Встроенные инструменты Anthropic (bash_20250124, web_search_... и т.п.) передаем как есть
        if (typeof t.type === 'string' && t.type !== 'function' && t.type !== 'custom') {
          result.push(t);
          continue;
        }

        const fn = (t.type === 'function' && t.function) ? t.function : t;
        if (!fn.name) continue;

        const originalName = String(fn.name);
        const safeName = toSafeToolName(originalName);
        nameMap[safeName] = originalName;

        const schema = fn.input_schema || fn.parameters;
        const tool = {
          name: safeName,
          input_schema: (schema && typeof schema === 'object')
            ? schema
            : { type: 'object', properties: {} }
        };
        if (fn.description) {
          tool.description = String(fn.description);
        }
        result.push(tool);
      }

      return { tools: result, nameMap: nameMap };
    }

    /**
     * Переводит tool_choice из формата OpenAI в формат Anthropic.
     * Принудительный выбор (any / tool) современные модели Claude отклоняют с ошибкой 400,
     * поэтому 'required' и выбор конкретной функции сводятся к 'auto'.
     *
     * @param {string|Object} toolChoice
     * @returns {Object|undefined}
     */
    convertToolChoice(toolChoice) {
      if (toolChoice === undefined || toolChoice === null) {
        return undefined;
      }
      if (typeof toolChoice === 'string') {
        return toolChoice === 'none' ? { type: 'none' } : { type: 'auto' };
      }
      if (typeof toolChoice === 'object') {
        if (toolChoice.type === 'none') return { type: 'none' };
        if (toolChoice.type === 'auto' && !toolChoice.function) {
          return toolChoice;
        }
      }
      return { type: 'auto' };
    }

    /**
     * Запоминает исходные content-блоки хода ассистента для каждого tool_use в нем.
     * @private
     * @param {Array<Object>} content
     */
    _rememberToolTurn(content, prefixHash) {
      if (!Array.isArray(content)) return;
      const entry = {
        blocks: content.map(b => Object.assign({}, b)),
        // Отпечаток контекста (model, system, tools, messages), в котором ход был создан
        prefixHash: prefixHash
      };
      for (const block of entry.blocks) {
        if (block && block.type === 'tool_use' && block.id) {
          this._toolTurnCache.delete(block.id);
          this._toolTurnCache.set(block.id, entry);
        }
      }
      while (this._toolTurnCache.size > TOOL_TURN_CACHE_LIMIT) {
        this._toolTurnCache.delete(this._toolTurnCache.keys().next().value);
      }
    }

    /**
     * Вычисляет отпечаток контекста, предшествующего сообщению с индексом count:
     * модель, system, набор инструментов и все сообщения до него.
     * Подпись thinking-блока Anthropic привязана именно к этому контексту.
     *
     * @private
     * @param {Object} payload
     * @param {number} count
     * @returns {string}
     */
    _prefixHash(payload, count) {
      const tools = Array.isArray(payload.tools)
        ? payload.tools.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
        : [];
      return hashString(JSON.stringify([
        payload.model,
        payload.system || '',
        tools,
        payload.messages.slice(0, count)
      ]));
    }

    /**
     * Убирает thinking-блоки из ходов ассистента, контекст которых изменился с момента создания
     * (агент сократил историю, сменилась модель, system или инструменты).
     * Такие блоки API отклоняет с ошибкой "The block is bound to a different conversation".
     * Удаление блока делает недействительными и все последующие — они удаляются по цепочке,
     * так как их контекст включал удаленный блок.
     *
     * @private
     * @param {Object} payload
     */
    _dropUnboundThinking(payload) {
      payload.messages.forEach((m, i) => {
        if (m.role !== 'assistant' || !Array.isArray(m.content) || !m.content.some(isThinkingBlock)) {
          return;
        }
        const toolUse = m.content.find(b => b.type === 'tool_use' && b.id);
        const entry = toolUse ? this._toolTurnCache.get(toolUse.id) : null;
        if (!entry || entry.prefixHash !== this._prefixHash(payload, i)) {
          m.content = m.content.filter(b => !isThinkingBlock(b));
        }
      });
    }

    /**
     * Убирает все thinking-блоки из истории (восстановление после ошибки подписи).
     * @private
     * @param {Object} payload
     * @returns {boolean} true, если хотя бы один блок был удален
     */
    _stripAllThinking(payload) {
      let stripped = false;
      for (const m of payload.messages) {
        if (m.role === 'assistant' && Array.isArray(m.content) && m.content.some(isThinkingBlock)) {
          m.content = m.content.filter(b => !isThinkingBlock(b));
          stripped = true;
        }
      }
      return stripped;
    }

    /**
     * Отправляет POST-запрос к {baseUrl}/messages.
     * @private
     * @returns {Promise<Response>}
     */
    async _postMessages(url, headers, payload, signal) {
      try {
        return await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: signal
        });
      } catch (networkErr) {
        if (networkErr.name === 'AbortError') {
          throw networkErr;
        }
        throw new Error(`Сетевая ошибка при обращении к Anthropic API (${url}): ${networkErr.message}`);
      }
    }

    /**
     * Извлекает текст ошибки из HTTP-ответа Anthropic API.
     * @private
     * @param {Response} response
     * @returns {Promise<string>}
     */
    async _readErrorDetails(response) {
      let errorDetails = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) {
          errorDetails = typeof errJson.error === 'string'
            ? errJson.error
            : (errJson.error.message || errJson.error.type || errorDetails);
        } else if (errJson && errJson.message) {
          errorDetails = errJson.message;
        }
      } catch (_) {
        try {
          const rawText = typeof response.text === 'function' ? await response.text() : '';
          if (rawText) {
            errorDetails += `: ${rawText.slice(0, 300)}`;
          }
        } catch (_) {}
      }
      return errorDetails;
    }

    /**
     * Формирует content-блоки хода ассистента с tool_calls (формат OpenAI).
     * Если исходный ответ API сохранен в кэше, возвращает его без изменений
     * (thinking-блоки с подписью обязательны для продолжения цикла инструментов).
     *
     * @private
     * @param {Object} m - Сообщение ассистента с tool_calls
     * @returns {Array<Object>}
     */
    _buildAssistantToolBlocks(m) {
      const calls = m.tool_calls.filter(tc => tc && tc.id);
      const cached = calls.length > 0 ? this._toolTurnCache.get(String(calls[0].id)) : null;
      if (cached) {
        const cachedIds = cached.blocks.filter(b => b.type === 'tool_use').map(b => b.id);
        const sameCalls = cachedIds.length === calls.length &&
          calls.every(tc => cachedIds.includes(String(tc.id)));
        if (sameCalls) {
          return cached.blocks.map(b => Object.assign({}, b));
        }
      }

      const blocks = [];
      const text = contentToText(m.content);
      if (text.trim()) {
        blocks.push({ type: 'text', text: text });
      }
      for (const tc of m.tool_calls) {
        if (!tc) continue;
        const fn = tc.function || tc;
        blocks.push({
          type: 'tool_use',
          id: String(tc.id || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
          name: toSafeToolName(fn.name),
          input: parseToolInput(fn.arguments !== undefined ? fn.arguments : fn.input)
        });
      }
      return blocks;
    }

    /**
     * Нормализует базовый URL Anthropic API.
     * @param {string} [baseUrl]
     * @returns {string} URL без замыкающего слэша.
     */
    resolveBaseUrl(baseUrl) {
      let url = String(baseUrl || '').trim().replace(/\/+$/, '');
      if (!url) {
        return DEFAULT_ANTHROPIC_BASE_URL;
      }
      if (url.endsWith('/messages')) {
        url = url.slice(0, -'/messages'.length).replace(/\/+$/, '');
      }
      return url;
    }

    /**
     * Формирует заголовки HTTP-запроса к Anthropic Messages API.
     * Включает x-api-key, anthropic-version и флаг для прямого браузерного доступа.
     *
     * @param {Object} config
     * @param {Object} [extraHeaders]
     * @returns {Object}
     */
    buildHeaders(config, extraHeaders = {}) {
      const headers = Object.assign({
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        // Обязательный заголовок для выполнения запросов напрямую из браузера
        'anthropic-dangerous-direct-browser-access': 'true'
      }, extraHeaders);

      const apiKey = config && config.apiKey ? String(config.apiKey).trim() : '';
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      return headers;
    }

    /**
     * Нормализует сообщения и извлекает system prompt.
     * В Anthropic Messages API:
     * - системный промпт передается в верхнеуровневом параметре "system" (а не внутри messages);
     * - массив "messages" может содержать только роли "user" и "assistant";
     * - tool_calls ассистента становятся блоками tool_use, а сообщения с ролью "tool" —
     *   блоками tool_result внутри одного сообщения "user";
     * - соседние сообщения с одинаковой ролью объединяются.
     *
     * @param {Object} options
     * @returns {{ system: string, messages: Array<{role: string, content: string|Array<Object>}> }}
     */
    preparePayloadMessages(options) {
      let systemPrompt = '';
      if (options.systemPrompt && typeof options.systemPrompt === 'string') {
        systemPrompt = options.systemPrompt.trim();
      }

      const rawMessages = Array.isArray(options.messages) ? options.messages : [];
      const messages = [];

      const pushMessage = (role, content) => {
        const last = messages[messages.length - 1];
        if (!last || last.role !== role) {
          messages.push({ role: role, content: content });
          return;
        }
        // Объединяем с предыдущим сообщением той же роли
        const toBlocks = (c) => (typeof c === 'string' ? (c ? [{ type: 'text', text: c }] : []) : c);
        if (typeof last.content === 'string' && typeof content === 'string') {
          last.content = last.content && content ? `${last.content}\n\n${content}` : (last.content || content);
        } else {
          const merged = toBlocks(last.content).concat(toBlocks(content));
          // tool_result должны идти в начале сообщения пользователя
          last.content = merged.filter(b => b.type === 'tool_result')
            .concat(merged.filter(b => b.type !== 'tool_result'));
        }
      };

      for (const m of rawMessages) {
        if (!m) continue;
        const role = String(m.role || 'user').toLowerCase().trim();

        if (role === 'system') {
          // Выделяем системное сообщение в поле system
          const content = contentToText(m.content);
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${content}` : content;
        } else if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          pushMessage('assistant', this._buildAssistantToolBlocks(m));
        } else if (role === 'tool' && m.tool_call_id) {
          pushMessage('user', [{
            type: 'tool_result',
            tool_use_id: String(m.tool_call_id),
            content: contentToText(m.content)
          }]);
        } else {
          // Пустые текстовые сообщения API отклоняет
          const content = contentToText(m.content);
          if (content) {
            pushMessage(role === 'assistant' ? 'assistant' : 'user', content);
          }
        }
      }

      // Если массив messages пуст, но передан options.prompt
      if (messages.length === 0 && options.prompt && typeof options.prompt === 'string') {
        messages.push({ role: 'user', content: options.prompt });
      }

      // Anthropic требует, чтобы messages не был пустым
      if (messages.length === 0) {
        messages.push({ role: 'user', content: '' });
      }

      return {
        system: systemPrompt,
        messages: messages
      };
    }

    /**
     * Отправляет запрос к Anthropic Messages API.
     * Приводит результат к внутреннему формату BKAIManager.
     *
     * @param {Object} options - Параметры запроса (messages, prompt, systemPrompt, stream, onChunk).
     * @param {Object} config - Настройки провайдера (baseUrl, apiKey, model, maxTokens).
     * @returns {Promise<{text: string, message: Object, raw?: Object, streamed: boolean}>}
     */
    async chat(options, config) {
      options = options || {};
      config = config || {};

      const apiKey = config.apiKey ? String(config.apiKey).trim() : '';
      if (!apiKey) {
        throw new Error('Не указан API ключ для Anthropic Claude. Укажите ключ в настройках AI.');
      }

      const baseUrl = this.resolveBaseUrl(config.baseUrl);
      const url = `${baseUrl}/messages`;

      const { system, messages } = this.preparePayloadMessages(options);

      const isStream = options.stream === true || (options.stream !== false && typeof options.onChunk === 'function');
      const model = config.model || options.model || DEFAULT_CLAUDE_MODEL;
      const maxTokens = (typeof config.maxTokens === 'number' && config.maxTokens > 0)
        ? config.maxTokens
        : (typeof options.maxTokens === 'number' ? options.maxTokens : 2048);

      const payload = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        stream: isStream
      };

      if (system) {
        payload.system = system;
      }

      let toolNameMap = {};
      if (Array.isArray(options.tools) && options.tools.length > 0) {
        const converted = this.convertTools(options.tools);
        toolNameMap = converted.nameMap;
        if (converted.tools.length > 0) {
          payload.tools = converted.tools;
        }
      }
      if (payload.tools && options.tool_choice !== undefined) {
        const toolChoice = this.convertToolChoice(options.tool_choice);
        if (toolChoice) {
          payload.tool_choice = toolChoice;
        }
      }

      // Убираем thinking-блоки, чей исходный контекст изменился (например, агент сократил историю)
      this._dropUnboundThinking(payload);

      const headers = this.buildHeaders(config);

      let response = await this._postMessages(url, headers, payload, options.signal);

      // Обработка ошибок HTTP
      if (!response.ok) {
        let errorDetails = await this._readErrorDetails(response);

        // Подпись thinking-блока не совпала с контекстом: убираем все thinking-блоки и повторяем запрос один раз
        if (response.status === 400 && /thinking/i.test(errorDetails) && this._stripAllThinking(payload)) {
          console.warn('[AnthropicProvider] Thinking-блоки истории отклонены API, повтор запроса без них:', errorDetails);
          response = await this._postMessages(url, headers, payload, options.signal);
          if (!response.ok) {
            errorDetails = await this._readErrorDetails(response);
          }
        }

        if (!response.ok) {
          throw new Error(`Ошибка Anthropic API: ${errorDetails}`);
        }
      }

      // Обычный (не-потоковый) ответ
      if (!isStream) {
        const data = await response.json();

        if (data && Array.isArray(data.content)) {
          // Сохраняем ход с tool_use в исходном виде (имена в формате API) для следующего запроса
          if (data.content.some(b => b && b.type === 'tool_use')) {
            this._rememberToolTurn(data.content, this._prefixHash(payload, payload.messages.length));
          }
          // Возвращаем исходные имена инструментов BKStudio (build__compile -> build.compile)
          data.content = data.content.map(b => (
            b && b.type === 'tool_use' && toolNameMap[b.name]
              ? Object.assign({}, b, { name: toolNameMap[b.name] })
              : b
          ));
        }

        // В Anthropic content — это массив блоков [{ type: 'text', text: '...' }]
        let textContent = '';
        if (Array.isArray(data.content)) {
          textContent = data.content
            .filter(block => block.type === 'text')
            .map(block => block.text || '')
            .join('');
        }

        const message = {
          role: data.role || 'assistant',
          content: textContent
        };

        return {
          text: textContent,
          message: message,
          raw: data,
          streamed: false
        };
      }

      // Потоковый ответ (SSE)
      return this._handleStreamResponse(response, options);
    }

    /**
     * Обрабатывает SSE-поток Anthropic Messages API.
     * Парсит события content_block_delta, накапливает текст и уведомляет onChunk.
     *
     * @private
     * @param {Response} response
     * @param {Object} options
     * @returns {Promise<{text: string, message: Object, streamed: boolean}>}
     */
    async _handleStreamResponse(response, options) {
      if (!response.body || typeof response.body.getReader !== 'function') {
        const text = typeof response.text === 'function' ? await response.text() : '';
        return {
          text: text,
          message: { role: 'assistant', content: text },
          streamed: false
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      const onChunk = typeof options.onChunk === 'function'
        ? options.onChunk
        : (typeof options.onToken === 'function' ? options.onToken : null);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // Обработка ошибок в потоке: event: error
            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;

              try {
                const parsed = JSON.parse(jsonStr);

                if (parsed.type === 'error' && parsed.error) {
                  const errMsg = parsed.error.message || parsed.error.type || 'Неизвестная ошибка потока';
                  throw new Error(`Ошибка потока Anthropic: ${errMsg}`);
                }

                // В Anthropic текст чанка содержится в delta.text
                // события content_block_delta
                let chunkText = '';
                if (parsed.type === 'content_block_delta' && parsed.delta) {
                  if (parsed.delta.type === 'text_delta' && typeof parsed.delta.text === 'string') {
                    chunkText = parsed.delta.text;
                  }
                }

                if (chunkText) {
                  accumulatedText += chunkText;
                  if (onChunk) {
                    onChunk(chunkText, accumulatedText);
                  }
                }
              } catch (parseErr) {
                if (parseErr.message && parseErr.message.startsWith('Ошибка потока Anthropic:')) {
                  throw parseErr;
                }
                // Игнорируем неполные пакеты
              }
            }
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {}
      }

      return {
        text: accumulatedText,
        message: { role: 'assistant', content: accumulatedText },
        streamed: true
      };
    }

    /**
     * Проверяет подключение к Anthropic API.
     *
     * @param {Object} config
     * @returns {Promise<{success: boolean, message: string, modelsCount?: number}>}
     */
    async testConnection(config) {
      config = config || {};
      const apiKey = config.apiKey ? String(config.apiKey).trim() : '';
      if (!apiKey) {
        throw new Error('Не указан API ключ для Anthropic Claude');
      }

      const baseUrl = this.resolveBaseUrl(config.baseUrl);

      // Сначала пытаемся запросить эндпоинт моделей {baseUrl}/models
      const modelsUrl = `${baseUrl}/models`;
      try {
        const resp = await fetch(modelsUrl, {
          method: 'GET',
          headers: this.buildHeaders(config)
        });

        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          const list = data && Array.isArray(data.data) ? data.data : KNOWN_CLAUDE_MODELS;
          return {
            success: true,
            message: 'Соединение с Anthropic API успешно установлено',
            modelsCount: list.length
          };
        }

        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`Ошибка авторизации Anthropic (HTTP ${resp.status}): неверный API ключ`);
        }
      } catch (checkErr) {
        if (checkErr.message && checkErr.message.includes('Ошибка авторизации')) {
          throw checkErr;
        }
      }

      // Если /models не поддерживается на прокси, отправляем минимальный тестовый запрос к /messages
      const msgUrl = `${baseUrl}/messages`;
      let msgResp;
      try {
        msgResp = await fetch(msgUrl, {
          method: 'POST',
          headers: this.buildHeaders(config),
          body: JSON.stringify({
            model: config.model || DEFAULT_CLAUDE_MODEL,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          })
        });
      } catch (netErr) {
        throw new Error(`Сетевая ошибка при проверке Anthropic API (${msgUrl}): ${netErr.message}`);
      }

      if (msgResp.ok || msgResp.status === 400) {
        // 400 с валидным ответом означает успешную авторизацию и доступность сервера
        if (msgResp.ok) {
          return {
            success: true,
            message: 'Соединение с Anthropic API успешно установлено'
          };
        }
        const errJson = await msgResp.json().catch(() => null);
        if (errJson && errJson.error && errJson.error.type !== 'authentication_error') {
          return {
            success: true,
            message: 'Сервер Anthropic доступен и авторизован'
          };
        }
      }

      if (msgResp.status === 401 || msgResp.status === 403) {
        throw new Error('Ошибка авторизации Anthropic: неверный API ключ');
      }

      let errDetails = `HTTP ${msgResp.status} ${msgResp.statusText}`;
      try {
        const errData = await msgResp.json();
        if (errData && errData.error && errData.error.message) {
          errDetails = errData.error.message;
        }
      } catch (_) {}

      throw new Error(`Ошибка соединения с Anthropic: ${errDetails}`);
    }

    /**
     * Возвращает список моделей Anthropic Claude.
     * Запрашивает {baseUrl}/models или возвращает актуальный список моделей.
     *
     * @param {Object} config
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getModels(config) {
      config = config || {};
      const baseUrl = this.resolveBaseUrl(config.baseUrl);
      const modelsUrl = `${baseUrl}/models`;

      try {
        const resp = await fetch(modelsUrl, {
          method: 'GET',
          headers: this.buildHeaders(config)
        });

        if (resp.ok) {
          const data = await resp.json();
          const list = Array.isArray(data) ? data : (data.data || []);
          if (list.length > 0) {
            return list.map(m => ({
              id: m.id || m.name || String(m),
              name: m.display_name || m.name || m.id || String(m)
            }));
          }
        }
      } catch (_) {
        // Fallback к известному списку моделей при отсутствии эндпоинта /models
      }

      return KNOWN_CLAUDE_MODELS.map(m => Object.assign({}, m));
    }
  }

  // Создание экземпляра провайдера и экспорт
  const providerInstance = new AnthropicProvider();
  global.AnthropicProvider = AnthropicProvider;
  global.bkAnthropicProvider = providerInstance;

  // Автоматическая регистрация в BKAIManager, если он уже загружен
  if (global.bkAI && typeof global.bkAI.registerProvider === 'function') {
    global.bkAI.registerProvider('anthropic', providerInstance);
    global.bkAI.registerProvider('claude', providerInstance);
  }

})(typeof window !== 'undefined' ? window : this);
