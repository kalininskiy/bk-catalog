/**
 * BKStudio - OpenAI-Compatible AI Provider
 *
 * Универсальный провайдер для любых OpenAI-совместимых API серверов и сервисов:
 *   - OpenAI API (ChatGPT)
 *   - Ollama (http://localhost:11434/v1)
 *   - LM Studio (http://localhost:1234/v1)
 *   - llama.cpp server (http://localhost:8080/v1)
 *   - OpenRouter (https://openrouter.ai/api/v1)
 *   - LocalAI, vLLM, Text Generation WebUI, Mistral API, DeepSeek API, Groq и др.
 *
 * Поддерживает:
 *   - POST {baseUrl}/chat/completions (model, messages, max_tokens, stream)
 *   - Обычный (блокирующий) текстовый ответ
 *   - Потоковую передачу (SSE streaming) чанками в реальном времени
 *   - Работу как с API key, так и без него (для локальных серверов)
 *   - Пользовательский baseUrl любой структуры
 *   - Обработку HTTP-ошибок и сетевых сбоев
 *   - Получение списка моделей (GET {baseUrl}/models)
 *   - Проверку соединения (testConnection)
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Класс OpenAI-совместимого провайдера AI.
   */
  class OpenAIApiProvider {
    /**
     * @param {Object} [options]
     * @param {string} [options.name] - Имя провайдера (по умолчанию 'openai-compatible')
     */
    constructor(options = {}) {
      this.name = options.name || 'openai-compatible';
    }

    /**
     * Нормализует базовый URL сервера.
     * @param {string} [baseUrl]
     * @returns {string} URL без замыкающего слэша.
     */
    resolveBaseUrl(baseUrl) {
      let url = String(baseUrl || '').trim().replace(/\/+$/, '');
      if (!url) {
        return 'https://api.openai.com/v1';
      }
      if (url.endsWith('/chat/completions')) {
        url = url.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
      }

      // Если указан хост без пути (например, http://localhost:11434 или http://127.0.0.1:8080)
      // автоматически добавляем /v1, так как OpenAI-совместимые API серверов обычно лежат в /v1
      try {
        const parsed = new URL(url);
        if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
          url = `${parsed.origin}/v1`;
        }
      } catch (_) {
        if (/^https?:\/\/[^\/]+$/.test(url)) {
          url = `${url}/v1`;
        }
      }

      return url;
    }

    /**
     * Формирует заголовки HTTP-запроса.
     * Добавляет Authorization только если передан apiKey.
     * @param {Object} config
     * @param {Object} [extraHeaders]
     * @returns {Object}
     */
    buildHeaders(config, extraHeaders = {}) {
      const headers = Object.assign({
        'Content-Type': 'application/json'
      }, extraHeaders);

      const apiKey = config && config.apiKey ? String(config.apiKey).trim() : '';
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      return headers;
    }

    /**
     * Нормализует массив сообщений для запроса к chat/completions.
     * @param {Object} options
     * @returns {Array<{role: string, content: string}>}
     */
    normalizeMessages(options) {
      if (Array.isArray(options.messages) && options.messages.length > 0) {
        return options.messages.map(m => {
          const item = {
            role: String(m.role || 'user'),
            content: m.content !== undefined && m.content !== null ? String(m.content) : ''
          };
          if (m.tool_calls && Array.isArray(m.tool_calls)) {
            item.tool_calls = m.tool_calls;
          }
          if (m.tool_call_id) {
            item.tool_call_id = String(m.tool_call_id);
          }
          if (m.name) {
            item.name = String(m.name);
          }
          return item;
        });
      }

      const messages = [];
      if (options.systemPrompt && typeof options.systemPrompt === 'string') {
        messages.push({
          role: 'system',
          content: options.systemPrompt
        });
      }

      if (options.prompt && typeof options.prompt === 'string') {
        messages.push({
          role: 'user',
          content: options.prompt
        });
      }

      if (messages.length === 0) {
        throw new Error('Запрос должен содержать массив messages или поле prompt');
      }

      return messages;
    }

    /**
     * Отправляет запрос к {baseUrl}/chat/completions.
     * Поддерживает как стандартный ответ, так и streaming через SSE.
     *
     * @param {Object} options
     * @param {Array} [options.messages] - Массив сообщений.
     * @param {string} [options.prompt] - Пользовательский запрос (если messages не передан).
     * @param {string} [options.systemPrompt] - Системный промпт.
     * @param {string} [options.model] - Переопределение модели.
     * @param {number} [options.max_tokens] - Максимальное число токенов.
     * @param {number} [options.maxTokens] - Алиас для max_tokens.
     * @param {boolean} [options.stream] - Включить streaming.
     * @param {Function} [options.onChunk] - Callback (chunkText, fullAccumulatedText) при стриминге.
     * @param {Function} [options.onToken] - Алиас для onChunk.
     * @param {AbortSignal} [options.signal] - Сигнал отмены.
     * @param {Object} config - Текущая конфигурация (из BKAIManager.getConfig()).
     * @returns {Promise<{text: string, message: Object, raw?: Object, streamed: boolean}>}
     */
    async chat(options, config) {
      if (!options || typeof options !== 'object') {
        throw new Error('Параметры options должны быть объектом');
      }
      config = config || {};

      const baseUrl = this.resolveBaseUrl(config.baseUrl);
      const url = `${baseUrl}/chat/completions`;
      const messages = this.normalizeMessages(options);

      const model = options.model || config.model || 'default';

      const maxTokens = typeof options.max_tokens === 'number'
        ? options.max_tokens
        : (typeof options.maxTokens === 'number'
          ? options.maxTokens
          : (typeof config.maxTokens === 'number' ? config.maxTokens : 65536));

      const isStream = Boolean(
        options.stream ||
        typeof options.onChunk === 'function' ||
        typeof options.onToken === 'function'
      );

      const requestPayload = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        stream: isStream
      };

      if (options.tools && Array.isArray(options.tools)) {
        requestPayload.tools = options.tools;
      }
      if (options.tool_choice !== undefined) {
        requestPayload.tool_choice = options.tool_choice;
      }
      if (options.stop !== undefined) {
        requestPayload.stop = options.stop;
      }
      if (options.top_p !== undefined) {
        requestPayload.top_p = options.top_p;
      }

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(config, options.headers),
          body: JSON.stringify(requestPayload),
          signal: options.signal
        });
      } catch (networkErr) {
        if (networkErr.name === 'AbortError') {
          throw networkErr;
        }
        const causeDetail = networkErr.cause ? ` (${networkErr.cause.code || networkErr.cause.message || networkErr.cause})` : '';
        console.error('[OpenAI Provider Network Error]:', networkErr.message, networkErr.cause || '');
        throw new Error(`Сетевая ошибка при обращении к AI-серверу (${url}): ${networkErr.message}${causeDetail}`);
      }

      if (!response.ok) {
        let errorDetails = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          if (errJson && errJson.error) {
            errorDetails = typeof errJson.error === 'string'
              ? errJson.error
              : (errJson.error.message || errorDetails);
          } else if (errJson && errJson.message) {
            errorDetails = errJson.message;
          }
        } catch (_) {
          try {
            const rawText = await response.text();
            if (rawText) {
              errorDetails += `: ${rawText.slice(0, 300)}`;
            }
          } catch (_) {}
        }
        throw new Error(`Ошибка AI-сервера: ${errorDetails}`);
      }

      // Не-потоковый режим
      if (!isStream) {
        const data = await response.json();
        const choice = data.choices && data.choices[0];
        const message = (choice && choice.message) || { role: 'assistant', content: '' };
        const content = message.content || '';
        const reasoning = message.reasoning_content || '';
        const finishReason = choice && (choice.finish_reason || choice.finishReason);

        return {
          text: content,
          reasoning: reasoning,
          message: message,
          finishReason: finishReason,
          raw: data,
          streamed: false
        };
      }

      // Потоковый режим (SSE streaming)
      return this._handleStreamResponse(response, options);
    }

    /**
     * Обрабатывает SSE-поток данных от сервера.
     * @private
     * @param {Response} response
     * @param {Object} options
     * @returns {Promise<{text: string, reasoning: string, message: Object, streamed: boolean}>}
     */
    async _handleStreamResponse(response, options) {
      if (!response.body || typeof response.body.getReader !== 'function') {
        // Fallback если ReadableStream недоступен
        const text = await response.text();
        return {
          text: text,
          reasoning: '',
          message: { role: 'assistant', content: text },
          streamed: false
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let accumulatedReasoning = '';
      let lastFinishReason = null;

      const onChunk = typeof options.onChunk === 'function'
        ? options.onChunk
        : (typeof options.onToken === 'function' ? options.onToken : null);

      const onReasoning = typeof options.onReasoning === 'function'
        ? options.onReasoning
        : null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Незавершенная часть строки

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith(':')) {
              continue; // Пустая строка или SSE heartbeat комментарий
            }

            if (line === 'data: [DONE]') {
              break;
            }

            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) {
                continue;
              }

              try {
                const parsed = JSON.parse(jsonStr);
                const choice = parsed.choices && parsed.choices[0];
                if (choice && (choice.finish_reason || choice.finishReason)) {
                  lastFinishReason = choice.finish_reason || choice.finishReason;
                }
                const delta = choice && choice.delta;
                const reasoningDelta = (delta && delta.reasoning_content) || '';
                const textDelta = (delta && delta.content) || '';

                if (reasoningDelta) {
                  accumulatedReasoning += reasoningDelta;
                  if (onReasoning) {
                    onReasoning(reasoningDelta, accumulatedReasoning);
                  }
                }

                if (textDelta) {
                  accumulatedText += textDelta;
                  if (onChunk) {
                    onChunk(textDelta, accumulatedText);
                  }
                }
              } catch (_) {
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
        reasoning: accumulatedReasoning,
        message: {
          role: 'assistant',
          content: accumulatedText,
          ...(accumulatedReasoning ? { reasoning_content: accumulatedReasoning } : {})
        },
        finishReason: lastFinishReason,
        streamed: true
      };
    }

    /**
     * Проверяет подключение к серверу.
     * Запрашивает {baseUrl}/models или выполняет тестовый probe к {baseUrl}/chat/completions.
     *
     * @param {Object} config
     * @returns {Promise<{success: boolean, message: string, modelsCount?: number}>}
     */
    async testConnection(config) {
      config = config || {};
      const baseUrl = this.resolveBaseUrl(config.baseUrl);
      const modelsUrl = `${baseUrl}/models`;

      try {
        const resp = await fetch(modelsUrl, {
          method: 'GET',
          headers: this.buildHeaders(config)
        });

        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          const list = data ? (Array.isArray(data) ? data : (data.data || data.models || [])) : [];
          return {
            success: true,
            message: 'Соединение успешно установлено',
            modelsCount: list.length
          };
        }

        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`Ошибка авторизации (HTTP ${resp.status}): проверьте API ключ`);
        }

        // Если эндпоинт /models не реализован на легковесном локальном сервере (404/405),
        // проверяем доступность через тестовый probe chat/completions
        if (resp.status === 404 || resp.status === 405) {
          const chatUrl = `${baseUrl}/chat/completions`;
          const chatResp = await fetch(chatUrl, {
            method: 'POST',
            headers: this.buildHeaders(config),
            body: JSON.stringify({
              model: config.model || 'test',
              messages: [{ role: 'user', content: 'test' }],
              max_tokens: 1
            })
          });

          if (chatResp.ok || chatResp.status === 400 || chatResp.status === 422) {
            return {
              success: true,
              message: 'Сервер доступен (эндпоинт chat/completions отвечает)'
            };
          }

          throw new Error(`Эндпоинт недоступен: HTTP ${chatResp.status} ${chatResp.statusText}`);
        }

        throw new Error(`Сервер вернул ошибку: HTTP ${resp.status} ${resp.statusText}`);
      } catch (err) {
        if (err.name === 'TypeError' || err.message.includes('fetch') || err.message.includes('ECONNREFUSED')) {
          throw new Error(`Не удалось подключиться к серверу ${baseUrl}. Проверьте адрес и запущен ли сервер.`);
        }
        throw err;
      }
    }

    /**
     * Запрашивает список доступных моделей с сервера {baseUrl}/models.
     *
     * @param {Object} config
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getModels(config) {
      config = config || {};
      const baseUrl = this.resolveBaseUrl(config.baseUrl);
      const modelsUrl = `${baseUrl}/models`;

      let resp;
      try {
        resp = await fetch(modelsUrl, {
          method: 'GET',
          headers: this.buildHeaders(config)
        });
      } catch (networkErr) {
        throw new Error(`Сетевая ошибка при запросе списка моделей (${modelsUrl}): ${networkErr.message}`);
      }

      if (!resp.ok) {
        let details = `HTTP ${resp.status} ${resp.statusText}`;
        try {
          const errJson = await resp.json();
          if (errJson && errJson.error) {
            details = typeof errJson.error === 'string'
              ? errJson.error
              : (errJson.error.message || details);
          }
        } catch (_) {}
        throw new Error(`Ошибка получения списка моделей: ${details}`);
      }

      const data = await resp.json();
      const list = Array.isArray(data) ? data : (data.data || data.models || []);

      return list.map(m => {
        if (typeof m === 'string') {
          return { id: m, name: m };
        }
        return {
          id: m.id || m.name || String(m),
          name: m.name || m.id || String(m)
        };
      });
    }
  }

  // Создание экземпляра провайдера и экспорт
  const providerInstance = new OpenAIApiProvider();
  global.OpenAIApiProvider = OpenAIApiProvider;
  global.bkOpenAICompatibleProvider = providerInstance;

  // Автоматическая регистрация в BKAIManager, если он уже загружен
  if (global.bkAI && typeof global.bkAI.registerProvider === 'function') {
    const aliases = [
      'openai-compatible',
      'openai',
      'gemini',
      'llamacpp',
      'llama.cpp',
      'ollama',
      'lmstudio',
      'openrouter',
      'custom'
    ];
    aliases.forEach(alias => global.bkAI.registerProvider(alias, providerInstance));
  }

})(typeof window !== 'undefined' ? window : this);
