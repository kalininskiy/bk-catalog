/**
 * BKStudio - AI Response Normalizer
 *
 * Приводит ответы различных LLM-провайдеров (OpenAI, Anthropic Claude, Gemini,
 * llama.cpp, Ollama, LM Studio и др.) к единому внутреннему формату BKStudio.
 *
 * Минимальные типы нормализованных объектов:
 *   1. Текстовый ответ:
 *      {
 *        type: "text",
 *        text: "..."
 *      }
 *   2. Вызов инструмента (Tool / Function calling):
 *      {
 *        type: "tool_call",
 *        name: "...",
 *        arguments: { ... }
 *      }
 *   3. Ошибка:
 *      {
 *        type: "error",
 *        error: {
 *          message: "...",
 *          code?: "...",
 *          status?: number
 *        }
 *      }
 *
 * Для потоковой передачи (streaming) нормализатор также формирует единый формат
 * чанков: { type: "text", delta: "...", text: "..." } или { type: "tool_call", ... }.
 *
 * UI и BKAIManager работают только с нормализованным представлением
 * и не знают специфики API отдельных сервисов.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Класс нормализатора AI-ответов
   */
  class BKAINormalizer {
    /**
     * Создает нормализованный текстовый объект.
     * @param {string} text - Содержимое текста
     * @param {Object} [extra] - Дополнительные метаданные
     * @returns {{type: "text", text: string}}
     */
    static createText(text, extra = {}) {
      return Object.assign({
        type: 'text',
        text: String(text || '')
      }, extra);
    }

    /**
     * Создает нормализованный объект вызова инструмента.
     * @param {string} name - Имя функции / инструмента
     * @param {Object|string} args - Аргументы инструмента (объект или JSON-строка)
     * @param {Object} [extra] - Дополнительные метаданные (id и др.)
     * @returns {{type: "tool_call", name: string, arguments: Object}}
     */
    static createToolCall(name, args, extra = {}) {
      let parsedArgs = args;
      if (typeof args === 'string') {
        try {
          parsedArgs = JSON.parse(args);
        } catch (_) {
          // Попытка восстановить незавершенный JSON (если строка была обрезана лимитом токенов)
          let repaired = false;
          const trimmed = args.trim();
          if (trimmed.startsWith('{')) {
            const candidates = [
              trimmed + '"}',
              trimmed + '"} }',
              trimmed + '}',
              trimmed + '"}'
            ];
            for (const cand of candidates) {
              try {
                parsedArgs = JSON.parse(cand);
                parsedArgs._truncated = true;
                repaired = true;
                break;
              } catch (_) {}
            }
          }
          if (!repaired) {
            parsedArgs = { raw: args, _truncated: true };
          }
        }
      }
      if (!parsedArgs || typeof parsedArgs !== 'object') {
        parsedArgs = {};
      }

      return Object.assign({
        type: 'tool_call',
        name: String(name || '').trim(),
        arguments: parsedArgs
      }, extra);
    }

    /**
     * Создает нормализованный объект ошибки.
     * @param {Error|Object|string} error - Ошибка
     * @param {Object} [extra] - Дополнительные метаданные
     * @returns {{type: "error", error: {message: string, code?: string, status?: number}}}
     */
    static createError(error, extra = {}) {
      let errObj = {};

      if (error instanceof Error) {
        errObj.message = error.message;
        if (error.name) errObj.name = error.name;
        if (error.status) errObj.status = error.status;
        if (error.code) errObj.code = error.code;
      } else if (typeof error === 'string') {
        errObj.message = error;
      } else if (error && typeof error === 'object') {
        errObj.message = error.message || error.error || error.description || 'Неизвестная ошибка AI';
        if (error.code) errObj.code = error.code;
        if (error.status) errObj.status = error.status;
        if (error.type) errObj.errorType = error.type;
      } else {
        errObj.message = 'Неизвестная ошибка AI';
      }

      return Object.assign({
        type: 'error',
        error: errObj
      }, extra);
    }

    /**
     * Создает нормализованный чанк для потоковой передачи.
     * @param {string|Object} delta - Дельта токена или объект чанка
     * @param {string} [accumulatedText] - Накопленный текст ответа
     * @param {Object} [extra] - Дополнительные параметры
     * @returns {Object} Нормализованный объект чанка
     */
    static createStreamChunk(delta, accumulatedText = '', extra = {}) {
      // Если передана строка (обычный токен)
      if (typeof delta === 'string') {
        const chunkObj = Object.assign({
          type: 'text',
          delta: delta,
          text: accumulatedText
        }, extra);

        // Удобный строковый вывод для обратной совместимости
        chunkObj.toString = function () {
          return this.delta;
        };

        return chunkObj;
      }

      // Если передан готовый объект чанка с ошибкой
      if (delta && delta.type === 'error') {
        return this.createError(delta.error, extra);
      }

      // Если передан чанк вызова инструмента
      if (delta && (delta.type === 'tool_call' || delta.tool_call)) {
        const tc = delta.tool_call || delta;
        return this.createToolCall(tc.name, tc.arguments, Object.assign({
          delta: tc.argumentsDelta || '',
          accumulated: accumulatedText
        }, extra));
      }

      // Если передан чанк текста в объекте
      const textDelta = delta && (delta.delta !== undefined ? delta.delta : (delta.text || ''));
      const chunkObj = Object.assign({
        type: 'text',
        delta: String(textDelta),
        text: accumulatedText
      }, extra);

      chunkObj.toString = function () {
        return this.delta;
      };

      return chunkObj;
    }

    /**
     * Приводит произвольный ответ любого провайдера к единому формату BKStudio.
     *
     * @param {Object|string} response - Результат выполнения chat() от провайдера
     * @param {Object} [rawSource] - Сырые данные ответа (опционально)
     * @returns {{
     *   type: "text" | "tool_call" | "error",
     *   text?: string,
     *   name?: string,
     *   arguments?: Object,
     *   items?: Array<Object>,
     *   toolCalls?: Array<Object>,
     *   error?: Object,
     *   raw?: Object,
     *   streamed?: boolean
     * }}
     */
    static normalizeResponse(response, rawSource = null) {
      if (!response && response !== '') {
        return this.createError('Пустой ответ от AI-провайдера');
      }

      // Если передан Error
      if (response instanceof Error) {
        return this.createError(response);
      }

      // Если ответ уже содержит признак ошибки
      if (response.error) {
        return this.createError(response.error, { raw: rawSource || response.raw });
      }

      // Если передана обычная строка
      if (typeof response === 'string') {
        return this.createText(response, {
          items: [this.createText(response)],
          raw: rawSource,
          streamed: false
        });
      }

      // Если ответ уже приведен к формату BKStudio
      if (response.type === 'text' && typeof response.text === 'string' && !response.tool_calls) {
        if (!response.items) {
          response.items = [this.createText(response.text)];
        }
        return response;
      }
      if (response.type === 'tool_call' && response.name) {
        if (!response.items) {
          response.items = [this.createToolCall(response.name, response.arguments)];
        }
        return response;
      }
      if (response.type === 'error' && response.error) {
        return response;
      }

      const items = [];
      const toolCalls = [];
      let fullText = '';
      const raw = rawSource || response.raw || response;
      const isStreamed = Boolean(response.streamed);

      // 1. Извлечение tool_calls в формате OpenAI (message.tool_calls или choices[0].message.tool_calls)
      const openAiToolCalls = (response.message && response.message.tool_calls) ||
        (raw && raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.tool_calls);

      if (Array.isArray(openAiToolCalls) && openAiToolCalls.length > 0) {
        for (const tc of openAiToolCalls) {
          const fn = tc.function || tc;
          const toolCallItem = this.createToolCall(fn.name, fn.arguments, {
            id: tc.id || ''
          });
          toolCalls.push(toolCallItem);
          items.push(toolCallItem);
        }
      }

      // 2. Извлечение tool_use в формате Anthropic (content: [{ type: 'tool_use', name, input }])
      const anthropicContent = (raw && Array.isArray(raw.content)) ? raw.content : null;
      if (anthropicContent) {
        for (const block of anthropicContent) {
          if (block && block.type === 'tool_use') {
            const toolCallItem = this.createToolCall(block.name, block.input, {
              id: block.id || ''
            });
            toolCalls.push(toolCallItem);
            items.push(toolCallItem);
          }
        }
      }

      // 3. Извлечение текста и reasoning
      let reasoning = '';
      if (typeof response.reasoning === 'string' && response.reasoning) {
        reasoning = response.reasoning;
      } else if (response.message && typeof response.message.reasoning_content === 'string') {
        reasoning = response.message.reasoning_content;
      } else if (raw && raw.choices && raw.choices[0] && raw.choices[0].message && typeof raw.choices[0].message.reasoning_content === 'string') {
        reasoning = raw.choices[0].message.reasoning_content;
      }

      if (typeof response.text === 'string' && response.text) {
        fullText = response.text;
      } else if (response.message && typeof response.message.content === 'string') {
        fullText = response.message.content;
      } else if (raw && raw.choices && raw.choices[0] && raw.choices[0].message && typeof raw.choices[0].message.content === 'string') {
        fullText = raw.choices[0].message.content;
      } else if (anthropicContent) {
        fullText = anthropicContent
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('');
      }

      // Отделяем <think>...</think> если reasoning пришел внутри текста ответа
      if (fullText && fullText.includes('<think>')) {
        const thinkMatch = fullText.match(/^<think>([\s\S]*?)<\/think>\s*/i);
        if (thinkMatch) {
          if (!reasoning) {
            reasoning = thinkMatch[1].trim();
          }
          fullText = fullText.slice(thinkMatch[0].length);
        }
      }

      if (fullText) {
        items.unshift(this.createText(fullText));
      }

      const choice = raw && raw.choices && raw.choices[0];
      const finishReason = response.finishReason || (choice && (choice.finish_reason || choice.finishReason)) || (raw && raw.stop_reason) || null;

      // Формирование итогового нормализованного объекта
      if (toolCalls.length > 0 && !fullText) {
        // Ответ представляет собой исключительно вызов инструмента
        const primary = toolCalls[0];
        return Object.assign({}, primary, {
          items: items,
          toolCalls: toolCalls,
          text: '',
          reasoning: reasoning || '',
          finishReason: finishReason,
          raw: raw,
          streamed: isStreamed
        });
      }

      if (toolCalls.length > 0 && fullText) {
        // Ответ содержит и пояснительный текст, и вызов инструмента
        return {
          type: 'tool_call',
          name: toolCalls[0].name,
          arguments: toolCalls[0].arguments,
          text: fullText,
          reasoning: reasoning || '',
          items: items,
          toolCalls: toolCalls,
          finishReason: finishReason,
          raw: raw,
          streamed: isStreamed
        };
      }

      // Обычный текстовый ответ
      return this.createText(fullText, {
        reasoning: reasoning || '',
        items: items.length > 0 ? items : [this.createText(fullText)],
        finishReason: finishReason,
        raw: raw,
        streamed: isStreamed
      });
    }

    /**
     * Нормализует чанк стриминга к единому формату.
     * @param {string|Object} delta - Дельта токена или объект
     * @param {string} [accumulatedText] - Полный накопленный текст
     * @returns {Object}
     */
    static normalizeStreamChunk(delta, accumulatedText = '') {
      return this.createStreamChunk(delta, accumulatedText);
    }
  }

  // Экспорт класса и глобального синглтона
  const normalizerInstance = new BKAINormalizer();
  global.BKAINormalizer = BKAINormalizer;
  global.bkAINormalizer = BKAINormalizer;

})(typeof window !== 'undefined' ? window : this);
