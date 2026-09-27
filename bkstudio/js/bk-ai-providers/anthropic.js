/**
 * BKStudio - Anthropic Claude AI Provider
 *
 * Отдельный native-провайдер для Anthropic Claude с использованием Anthropic Messages API.
 * Поддерживает:
 *   - API key (заголовок x-api-key);
 *   - model (claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus и др.);
 *   - system prompt (выносится в отдельное верхнеуровневое поле "system" Messages API);
 *   - messages (роли user и assistant);
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
  const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-20241022';

  /** Список известных моделей Anthropic для fallback */
  const KNOWN_CLAUDE_MODELS = Object.freeze([
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
  ]);

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
     * - массив "messages" может содержать только роли "user" и "assistant".
     *
     * @param {Object} options
     * @returns {{ system: string, messages: Array<{role: string, content: string}> }}
     */
    preparePayloadMessages(options) {
      let systemPrompt = '';
      if (options.systemPrompt && typeof options.systemPrompt === 'string') {
        systemPrompt = options.systemPrompt.trim();
      }

      const rawMessages = Array.isArray(options.messages) ? options.messages : [];
      const messages = [];

      for (const m of rawMessages) {
        if (!m) continue;
        const role = String(m.role || 'user').toLowerCase().trim();
        const content = typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content) ? m.content.map(c => c.text || '').join('') : String(m.content || ''));

        if (role === 'system') {
          // Выделяем системное сообщение в поле system
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${content}` : content;
        } else if (role === 'assistant') {
          messages.push({ role: 'assistant', content: content });
        } else {
          messages.push({ role: 'user', content: content });
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
     * @param {Object} config - Настройки провайдера (baseUrl, apiKey, model, temperature, maxTokens).
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

      if (options.tools && Array.isArray(options.tools)) {
        payload.tools = options.tools;
      }
      if (options.tool_choice !== undefined) {
        payload.tool_choice = options.tool_choice;
      }

      if (typeof config.temperature === 'number' && !isNaN(config.temperature)) {
        payload.temperature = Math.max(0, Math.min(1, config.temperature));
      } else if (typeof options.temperature === 'number') {
        payload.temperature = Math.max(0, Math.min(1, options.temperature));
      }

      const headers = this.buildHeaders(config);

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          signal: options.signal
        });
      } catch (networkErr) {
        if (networkErr.name === 'AbortError') {
          throw networkErr;
        }
        throw new Error(`Сетевая ошибка при обращении к Anthropic API (${url}): ${networkErr.message}`);
      }

      // Обработка ошибок HTTP
      if (!response.ok) {
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
        throw new Error(`Ошибка Anthropic API: ${errorDetails}`);
      }

      // Обычный (не-потоковый) ответ
      if (!isStream) {
        const data = await response.json();
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
