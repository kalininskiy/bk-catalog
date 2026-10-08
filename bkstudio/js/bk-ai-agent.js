/**
 * BKStudio - Autonomous AI Agent Engine
 *
 * Реализует агентный цикл (Agent Loop) для автономного решения задач в BKStudio:
 *   user → LLM → tool call → BKStudio tool → result → LLM → ... → final answer
 *
 * Архитектура и ограничения безопасности:
 *   - Лимит итераций: начальное значение 10 (настраиваемо).
 *   - Остановка при достижении лимита.
 *   - Прозрачность: каждый tool call виден пользователю.
 *   - Подтверждение опасных действий:
 *       * project.write_file
 *       * project.create_file
 *       * project.delete_file
 *       * emulator.run
 *       * emulator.reset
 *     (чтение файлов, листинги и diagnostics выполняются без запроса подтверждения).
 *   - Полное отсутствие вызовов eval и произвольного выполнения JavaScript.
 *   - Использование исключительно существующих API через window.bkAITools / window.bkAI.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /**
   * Набор действий, требующих обязательного подтверждения пользователем перед выполнением
   */
  const DANGEROUS_TOOLS = Object.freeze(new Set([
    'project.write_file',
    'project.create_file',
    'project.delete_file',
    'emulator.run',
    'emulator.reset',
    'graphics.create',
    'graphics.set',
    'graphics.patch',
    'graphics.fill',
    'graphics.save_state',
    'graphics.export_png',
    'graphics.save_png',
    'graphics.add_to_project'
  ]));

  /**
   * Системный промпт для автономного агента BKStudio
   */
  const AGENT_SYSTEM_PROMPT = `Ты — автономный ИИ-ассистент и инженер в среде BKStudio для советских 16-битных компьютеров Электроника БК-0010/БК-0011М и архитектуры DEC PDP-11.

Твоя цель — решать задачи пользователя, последовательно используя доступные инструменты BKStudio:
1. Анализируй структуру проекта: используй 'project.list_files' и 'project.read_file'.
2. Проверяй ошибки компилятора и LSP с помощью 'build.get_diagnostics'.
3. Вноси аккуратные исправления в код через 'project.write_file'.
4. Собирай проект через 'build.compile' и анализируй машинный код через 'build.get_listing'.
5. Запускай и проверяй программу в эмуляторе через 'emulator.run', контролируй регистры ('debug.get_registers') и память ('debug.read_memory').
6. Работай с графикой и спрайтами БК через инструменты 'graphics.*':
   - Создавай графику через 'graphics.create' (указывай mode, width, height, name; для копии другого спрайта используй copyFrom).
   - Рисуй элементы и спрайты через 'graphics.set' (передавай компактную ASCII-матрицу 'matrix'), а заливку через 'graphics.fill'.
   - Получай информацию и фрагменты через 'graphics.info' (или 'graphics.get_info'), 'graphics.get' и 'graphics.get_region'.
   - Экспортируй через 'graphics.export_asm', 'graphics.export_mac', 'graphics.export_bin'. Для спрайт-шитов используй параметр spriteGrid.
   - Сохраняй в проект через 'graphics.add_to_project'.
   - ОБЯЗАТЕЛЬНО сохраняй в проект визуальный файл .PNG через 'graphics.export_png' (или параметр savePng: true в graphics.add_to_project), чтобы человек мог сразу увидеть изображение своими глазами.
   - ОБЯЗАТЕЛЬНО сохраняй в проект состояние редактора .BKGfxState через 'graphics.save_state' (или параметр saveState: true в graphics.add_to_project), чтобы человек мог открыть и доработать графику в графическом редакторе BKStudio.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
- ГРАФИКА И СПРАЙТЫ:
  * НИКОГДА не генерируй директивы .BYTE вручную в обычном тексте!
  * Сначала мысленно определи структуру изображения и декомпозируй его (фон → крупные блоки → детали).
  * Для больших однородных прямоугольных областей ВСЕГДА используй 'graphics.fill' (не создавай под них матрицы).
  * Для небольших сложных, пиксельных или многоцветных деталей используй 'graphics.patch'.
  * Перед 'graphics.patch' убедись, что:
    - ширина всех строк матрицы СТРОГО одинаковая;
    - область целиком находится внутри изображения (x + width <= imageWidth, y + height <= imageHeight).
  * Рисование через ASCII-матрицы ('graphics.set' / 'graphics.patch'):
    'K' = черный (фон, индекс 0)
    'B' = синий (индекс 1)
    'G' = зеленый (индекс 2)
    'R' = красный (индекс 3)
    'W' = белый (для BK0010_MONO)
    Символ '.' ЗАПРЕЩЁН. Учитывай фактическую палитру режима, не используй недоступные цвета.
  * Для симметричных объектов рассчитывай одну половину и отражай её логически при расчёте координат.
  * Не создавай повторно уже существующий объект (graphics.create вернёт ошибку, если имя занято).
  * После завершения основной структуры проверь ключевые области через 'graphics.get_region'. Не запрашивай всё изображение после каждой мелкой операции.
  * Если операция завершилась ошибкой, проанализируй причину и исправь вызов, не повторяй те же параметры.
  * ОБЯЗАТЕЛЬНО сохраняй результаты в проект через 'graphics.add_to_project' с savePng: true и saveState: true.
- ЭКОНОМИЯ ТОКЕНОВ И ЗАЩИТА ОТ ОБРЫВА:
  * Будь лаконичен в рассуждениях. Не пиши длинных вступлений и описаний.
  * НИКОГДА не выводи полный исходный код или листинг программы в обычном тексте ответа, если собираешься записать его в файл! Сразу вызывай инструмент 'project.write_file' или 'graphics.add_to_project' с полным текстом кода.
- ОБЯЗАТЕЛЬНОСТЬ ИСПОЛЬЗОВАНИЯ ИНСТРУМЕНТОВ:
  * Если пользователь просит создать графику, спрайт, заставку, изменить код — ОБЯЗАТЕЛЬНО вызывай соответствующий инструмент, а не просто приводи код в markdown-блоках.
- Действуй пошагово: один или несколько вызовов инструментов за раз.
- Когда результат получен или задача выполнена, предоставь пользователю краткий и понятный итоговый ответ БЕЗ дальнейших вызовов инструментов:
  * что создано или изменено;
  * какие graphics tools использованы;
  * были ли ошибки;
  * выполнена ли проверка результата.
- Не пытайся придумывать несуществующие инструменты.
- Пиши комментарии и пояснения на русском языке.`;

  /**
   * Класс автономного AI-агента
   */
  class BKAIAgent {
    /**
     * @param {Object} [options]
     * @param {number} [options.defaultMaxIterations=50] - Лимит шагов по умолчанию
     * @param {Set<string>} [options.dangerousTools] - Набор опасных инструментов
     */
    constructor(options = {}) {
      this.defaultMaxIterations = typeof options.defaultMaxIterations === 'number' && options.defaultMaxIterations > 0
        ? options.defaultMaxIterations
        : 10;

      this.dangerousTools = new Set(options.dangerousTools || DANGEROUS_TOOLS);
      this.autoApproveAll = Boolean(options.autoApproveAll);
    }

    /**
     * Проверяет, требует ли данный инструмент подтверждения пользователя
     * @param {string} toolName
     * @returns {boolean}
     */
    requiresConfirmation(toolName) {
      if (this.autoApproveAll) {
        return false;
      }
      return this.dangerousTools.has(String(toolName || '').trim());
    }

    /**
     * Включает или выключает автоматическое подтверждение опасных действий (для сессии)
     * @param {boolean} enabled
     */
    setAutoApproveAll(enabled) {
      this.autoApproveAll = Boolean(enabled);
    }

    /**
     * Возвращает статус автоматического подтверждения в текущей сессии
     * @returns {boolean}
     */
    isAutoApproveAll() {
      return Boolean(this.autoApproveAll);
    }

    /**
     * Извлекает вызовы инструментов из нормализованного ответа AI или текста
     * @param {Object} response
     * @returns {Array<{id: string, name: string, arguments: Object}>}
     */
    extractToolCalls(response) {
      const calls = [];

      // 1. Из нормализованного свойства toolCalls
      if (response && Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          calls.push({
            id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: tc.name,
            arguments: tc.arguments || {}
          });
        }
        return calls;
      }

      // 2. Если ответ имеет тип tool_call
      if (response && response.type === 'tool_call' && response.name) {
        calls.push({
          id: response.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: response.name,
          arguments: response.arguments || {}
        });
        return calls;
      }

      const text = (response && typeof response.text === 'string') ? response.text : '';
      if (!text) {
        return calls;
      }

      // 3. XML-style теги вызовов: <tool_call>{"name": "...", "arguments": {...}}</tool_call> (Qwen, Mistral, Hermes, llama.cpp)
      const xmlToolCallRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
      let xmlMatch;
      while ((xmlMatch = xmlToolCallRegex.exec(text)) !== null) {
        const body = xmlMatch[1].trim();
        if (body) {
          try {
            const parsed = JSON.parse(body);
            const toolName = parsed.name || parsed.tool || parsed.action;
            if (toolName) {
              calls.push({
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: String(toolName).trim(),
                arguments: parsed.arguments || parsed.parameters || parsed.params || parsed.input || {}
              });
            }
          } catch (_) {
            // Попытка восстановления обрезанного JSON при обрыве токенов
            try {
              const repaired = body + '"}';
              const parsed = JSON.parse(repaired);
              const toolName = parsed.name || parsed.tool;
              if (toolName) {
                calls.push({
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: String(toolName).trim(),
                  arguments: parsed.arguments || {}
                });
              }
            } catch (_) {}
          }
        }
      }

      if (calls.length > 0) {
        return calls;
      }

      // 4. Fallback для моделей, возвращающих JSON-вызов в markdown: ```json {"tool": "...", "arguments": {...}} ```
      const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
      let match;
      while ((match = jsonBlockRegex.exec(text)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          const toolName = parsed.tool || parsed.name || parsed.action;
          if (toolName && typeof toolName === 'string' && (parsed.arguments !== undefined || parsed.params !== undefined || parsed.input !== undefined)) {
            calls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: toolName.trim(),
              arguments: parsed.arguments || parsed.params || parsed.input || {}
            });
          }
        } catch (_) {}
      }

      return calls;
    }

    /**
     * Ограничивает глубину истории сообщений для защиты от переполнения контекста LLM.
     * Сохраняет исходный запрос пользователя (и начальный контекст), а также последние N полных витков диалога (assistant + tool results).
     * Гарантирует строгую валидность цепочки сообщений по спецификации OpenAI.
     *
     * @param {Array<Object>} messages
     * @param {number} [maxTurns=4]
     * @returns {Array<Object>}
     */
    _pruneMessages(messages, maxTurns = 4) {
      if (!Array.isArray(messages) || messages.length <= 8) {
        return messages;
      }

      // Находим первое сообщение пользователя (исходная задача)
      const firstUserIdx = messages.findIndex(m => m && m.role === 'user');
      const prefix = firstUserIdx >= 0 ? messages.slice(0, firstUserIdx + 1) : [messages[0]];

      // Находим все индексы assistant сообщений, у которых есть tool_calls
      const turnStartIndices = [];
      for (let i = prefix.length; i < messages.length; i++) {
        const m = messages[i];
        if (m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          turnStartIndices.push(i);
        }
      }

      // Если количество витков не превышает maxTurns, возвращаем историю целиком
      if (turnStartIndices.length <= maxTurns) {
        return messages;
      }

      // Берем срез, начиная с (totalTurns - maxTurns)-го витка
      const cutoffIdx = turnStartIndices[turnStartIndices.length - maxTurns];
      const recentMessages = messages.slice(cutoffIdx);

      return [...prefix, ...recentMessages];
    }

    /**
     * Запускает агентный цикл
     *
     * @param {Object} params
     * @param {string} params.prompt - Запрос пользователя
     * @param {Array} [params.history] - Предыдущая история диалога
     * @param {number} [params.maxIterations] - Максимальное число шагов (по умолчанию 10)
     * @param {AbortSignal} [params.signal] - Сигнал отмены
     * @param {Function} [params.onStep] - Callback ({ iteration, maxIterations })
     * @param {Function} [params.onThought] - Callback (thoughtText, iteration)
     * @param {Function} [params.onToolCall] - Callback ({ id, name, arguments, requiresConfirmation, iteration })
     * @param {Function} [params.onRequestConfirmation] - async Callback ({ id, name, arguments }) -> boolean
     * @param {Function} [params.onToolResult] - Callback ({ id, name, result, success, iteration })
     * @param {Function} [params.onFinalAnswer] - Callback (finalText, stats)
     * @returns {Promise<{success: boolean, text: string, iterations: number, toolCallsCount: number, stoppedReason: string}>}
     */
    async run(params = {}) {
      const prompt = String(params.prompt || '').trim();
      if (!prompt) {
        throw new Error('Не указан текст запроса (prompt) для агента.');
      }

      const config = (global.bkAI && typeof global.bkAI.getConfig === 'function') ? global.bkAI.getConfig() : {};

      // Провайдеры с большим контекстом (Anthropic) получают полную историю без сокращения
      const activeProvider = (global.bkAI && typeof global.bkAI.getProvider === 'function')
        ? global.bkAI.getProvider(config.provider)
        : null;
      const keepFullHistory = Boolean(activeProvider && activeProvider.keepFullAgentHistory);

      const agentMaxTokens = (typeof params.maxTokens === 'number' && params.maxTokens > 0)
        ? params.maxTokens
        : Math.max(config.maxTokens || 4096, 4096);

      const autoApprove = (params.autoApproveAll !== undefined)
        ? Boolean(params.autoApproveAll)
        : this.autoApproveAll;

      const maxIterations = (typeof params.maxIterations === 'number' && params.maxIterations > 0)
        ? params.maxIterations
        : this.defaultMaxIterations;

      const signal = params.signal || null;
      const onStep = typeof params.onStep === 'function' ? params.onStep : () => {};
      const onThought = typeof params.onThought === 'function' ? params.onThought : () => {};
      const onToolCall = typeof params.onToolCall === 'function' ? params.onToolCall : () => {};
      const onRequestConfirmation = typeof params.onRequestConfirmation === 'function' ? params.onRequestConfirmation : null;
      const onToolResult = typeof params.onToolResult === 'function' ? params.onToolResult : () => {};
      const onFinalAnswer = typeof params.onFinalAnswer === 'function' ? params.onFinalAnswer : () => {};

      // Подготовка сообщений
      const messages = [];
      if (Array.isArray(params.history)) {
        for (const h of params.history) {
          if (h && h.role && h.content) {
            messages.push({ role: h.role, content: h.content });
          }
        }
      }
      messages.push({ role: 'user', content: prompt });

      // Получаем инструменты из реестра
      const toolRegistry = global.bkAITools || (global.bkAI && global.bkAI.getTools && global.bkAI.getTools());
      const tools = toolRegistry ? toolRegistry.getSchemas('openai') : [];

      let iteration = 0;
      let totalToolCalls = 0;
      let finalText = '';
      let stoppedReason = 'iteration_limit';

      while (iteration < maxIterations) {
        if (signal && signal.aborted) {
          const abortErr = new Error('Выполнение агента остановлено пользователем.');
          abortErr.name = 'AbortError';
          throw abortErr;
        }

        iteration++;
        onStep({ iteration, maxIterations });

        // Отправляем запрос к LLM через единый фасад window.bkAI
        if (!global.bkAI) {
          throw new Error('BKAIManager (window.bkAI) не инициализирован.');
        }

        let response;
        try {
          const callMessages = keepFullHistory ? messages : this._pruneMessages(messages, 4);
          response = await global.bkAI.chat({
            messages: callMessages,
            systemPrompt: AGENT_SYSTEM_PROMPT,
            tools: tools,
            maxTokens: agentMaxTokens,
            max_tokens: agentMaxTokens,
            stream: false, // в агентном цикле шаги выполняются детерминированными квантами
            signal: signal
          });
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          throw new Error(`Ошибка AI на шаге ${iteration}: ${err.message}`);
        }

        const textContent = (response && response.text) ? response.text : '';
        const reasoningContent = (response && response.reasoning) ? response.reasoning : '';
        const toolCalls = this.extractToolCalls(response);
        const choice = response && response.raw && response.raw.choices && response.raw.choices[0];
        const finishReason = (response && response.finishReason) ||
          (choice && (choice.finish_reason || choice.finishReason)) ||
          (response && response.raw && response.raw.stop_reason) || null;
        const isTruncated = finishReason === 'length' || finishReason === 'max_tokens';

        // Если модель вывела промежуточный текст или размышления
        if ((textContent || reasoningContent) && toolCalls.length > 0) {
          onThought(reasoningContent || textContent, iteration);
        }

        // Если генерация была прервана лимитом токенов и вызовы инструментов не успели сформироваться
        if (isTruncated && toolCalls.length === 0) {
          const warningNote = `\n\n[⚠️ Ответ модели был прерван сервером из-за лимита токенов (max_tokens: ${agentMaxTokens}). Агент автоматически запрашивает продолжение без потери контекста...]`;
          onThought((textContent || '') + warningNote, iteration);

          messages.push({
            role: 'assistant',
            content: textContent || ''
          });
          messages.push({
            role: 'user',
            content: 'Твой предыдущий ответ был прерван на полуслове из-за исчерпания лимита токенов (max_tokens). Пожалуйста, сразу выполни необходимое действие через инструмент (например, project.write_file или build.compile), без повторения текста и без длинных предисловий.'
          });

          continue; // Переходим к следующей итерации для немедленного продолжения
        }

        // Если вызовов инструментов нет — мы получили финальный ответ!
        if (toolCalls.length === 0) {
          finalText = textContent || 'Задача выполнена.';
          stoppedReason = 'completed';
          break;
        }

        // Добавляем ответ модели в историю диалога
        messages.push({
          role: 'assistant',
          content: textContent || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });

        // Последовательно выполняем все запрошенные моделью инструменты
        for (const tc of toolCalls) {
          if (signal && signal.aborted) {
            const abortErr = new Error('Выполнение агента остановлено пользователем.');
            abortErr.name = 'AbortError';
            throw abortErr;
          }

          totalToolCalls++;
          const isDangerous = this.requiresConfirmation(tc.name) && !autoApprove;

          onToolCall({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            requiresConfirmation: isDangerous,
            iteration: iteration
          });

          let proceed = true;
          // Если действие требует подтверждения и задан обработчик подтверждения
          if (isDangerous && onRequestConfirmation) {
            try {
              proceed = await onRequestConfirmation({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                iteration: iteration
              });
            } catch (_) {
              proceed = false;
            }
          }

          let toolExecutionResult;
          if (tc.arguments && tc.arguments._truncated) {
            toolExecutionResult = {
              success: false,
              error: `Вызов инструмента "${tc.name}" был обрезан сервером из-за лимита токенов (max_tokens: ${agentMaxTokens}). Увеличьте лимит токенов в настройках AI BKStudio.`
            };
          } else if (!proceed) {
            toolExecutionResult = {
              success: false,
              error: `Действие "${tc.name}" отклонено пользователем.`
            };
          } else {
            // Выполняем инструмент строго через реестр инструментов BKStudio
            if (toolRegistry) {
              toolExecutionResult = await toolRegistry.execute(tc.name, tc.arguments);
            } else if (global.bkAI && typeof global.bkAI.executeTool === 'function') {
              toolExecutionResult = await global.bkAI.executeTool(tc.name, tc.arguments);
            } else {
              toolExecutionResult = {
                success: false,
                error: 'Реестр инструментов BKStudio недоступен.'
              };
            }
          }

          onToolResult({
            id: tc.id,
            name: tc.name,
            result: toolExecutionResult,
            success: Boolean(toolExecutionResult && toolExecutionResult.success !== false),
            iteration: iteration
          });

          // Передаем результат выполнения инструмента обратно в диалог
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(toolExecutionResult)
          });
        }
      }

      // Если цикл завершился из-за достижения лимита
      if (stoppedReason === 'iteration_limit') {
        finalText = `Достигнут установленный лимит итераций агента (${maxIterations}). Выполнение приостановлено для предотвращения зацикливания. Выполненных вызовов инструментов: ${totalToolCalls}.`;
      }

      const summary = {
        success: true,
        text: finalText,
        iterations: iteration,
        toolCallsCount: totalToolCalls,
        stoppedReason: stoppedReason
      };

      onFinalAnswer(finalText, summary);
      return summary;
    }

    /**
     * Готовый сценарий агента: "Исправь ошибку сборки."
     *
     * Шаги сценария:
     *   1. Получить текущий проект и настройки;
     *   2. Выполнить сборку (build.compile);
     *   3. Получить ошибки компиляции (build.get_diagnostics);
     *   4. Прочитать ТОЛЬКО проблемный файл (project.read_file), не читая весь проект;
     *   5. Определить проблемный участок и сформировать исправление;
     *   6. Запросить подтверждение пользователя перед записью;
     *   7. После подтверждения изменить файл через BKProjectManager (project.write_file);
     *   8. Повторно запустить сборку (build.compile);
     *   9. Проверить результат сборки;
     *   10. Сообщить пользователю итог.
     *
     * @param {Object} [params] - Параметры запуска (signal, onStep, onToolCall, onRequestConfirmation, onToolResult, onFinalAnswer)
     * @returns {Promise<Object>}
     */
    async runFixBuildScenario(params = {}) {
      let initialInfo = '';
      const ctx = global.bkAI && typeof global.bkAI.getContext === 'function' ? global.bkAI.getContext() : null;
      let targetFile = '';

      if (ctx) {
        const cur = ctx.getCurrentFile();
        if (cur && cur.name) targetFile = cur.name;
        const diags = ctx.getDiagnostics();
        if (diags && diags.length > 0) {
          initialInfo = `Обнаружены следующие ошибки в среде разработки:\n` +
            diags.map(d => `- [${d.file || targetFile}:${d.line || 1}:${d.column || 1}] ${d.message}`).join('\n');
        }
      }

      let prompt = `СЦЕНАРИЙ: Исправь ошибку сборки.
Выполни следующие шаги:
1. Получи информацию о текущем проекте и его настройках с помощью 'project.get_project_info'.
2. Выполни компиляцию проекта с помощью 'build.compile'.
3. Если компиляция завершилась с ошибками, запроси диагностику ошибок с помощью 'build.get_diagnostics'.
4. Используй diagnostics для определения необходимого файла. Не читай весь проект целиком! Прочитай ТОЛЬКО проблемный файл с помощью 'project.read_file'.
5. Определи проблемный участок кода (строку с ошибкой, неверную мнемонику PDP-11, отсутствующую метку или синтаксическую ошибку).
6. Предложи исправление кода.
7. Запиши исправленный файл через BKProjectManager с помощью 'project.write_file' (действие требует подтверждения пользователя).
8. Снова выполни компиляцию проекта с помощью 'build.compile'.
9. Проверь результат повторной сборки (исчезли ли ошибки).
10. Сообщи пользователю понятный итог: какая ошибка была, как она исправлена и каков результат сборки.`;

      if (initialInfo) {
        prompt += `\n\nТекущие данные диагностики:\n${initialInfo}`;
      } else if (targetFile) {
        prompt += `\n\nАктивный файл проекта: ${targetFile}`;
      }

      return this.run(Object.assign({}, params, {
        prompt: prompt,
        maxIterations: params.maxIterations || this.defaultMaxIterations
      }));
    }
  }

  // Создаем синглтон агента
  const agentInstance = new BKAIAgent();

  global.BKAIAgent = BKAIAgent;
  global.bkAIAgent = agentInstance;

  // Экспорт в window.bkAI
  if (global.bkAI) {
    global.bkAI.getAgent = function () {
      return agentInstance;
    };
    global.bkAI.runAgent = function (params) {
      return agentInstance.run(params);
    };
    global.bkAI.runFixBuildScenario = function (params) {
      return agentInstance.runFixBuildScenario(params);
    };
  }

})(typeof window !== 'undefined' ? window : this);
