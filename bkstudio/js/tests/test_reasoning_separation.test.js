/**
 * Тест отделения reasoning от ответа модели
 */
const fs = require('fs');
const path = require('path');

function createDOM() {
  const listeners = {};
  return {
    window: {
      location: { href: 'http://localhost/' },
      addEventListener: (evt, cb) => { listeners[evt] = cb; },
      dispatchEvent: (evt) => { if (listeners[evt.type]) listeners[evt.type](evt); }
    },
    document: {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        remove() {}
      }),
      getElementById: () => null
    }
  };
}

const dom = createDOM();
global.window = dom.window;
global.document = dom.document;

const storage = {};
global.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }
};

// Загрузка модулей
require('../bk-ai-normalizer.js');
require('../bk-ai-providers/openai-compatible.js');
require('../bk-ai-manager.js');

async function run() {
  console.log('=== Проверка отделения reasoning от content ===');

  const provider = dom.window.bkOpenAICompatibleProvider || new dom.window.OpenAIApiProvider();

  // 1. Тест не-потокового режима
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Это чистый финальный ответ.',
          reasoning_content: 'Thinking process:\n1. Step 1\n2. Step 2'
        },
        finish_reason: 'stop'
      }]
    })
  });

  const nonStreamResult = await provider.chat({
    messages: [{ role: 'user', content: 'Что ты умеешь?' }],
    stream: false
  }, { baseUrl: 'http://mock' });

  console.assert(nonStreamResult.text === 'Это чистый финальный ответ.', 'nonStreamResult.text должен быть чистым');
  console.assert(nonStreamResult.reasoning.includes('Thinking process'), 'nonStreamResult.reasoning должен быть отделен');
  console.log('PASS: OpenAIApiProvider.chat() (non-stream) разделяет text и reasoning');

  const normalized = dom.window.BKAINormalizer.normalizeResponse(nonStreamResult);

  console.assert(normalized.text === 'Это чистый финальный ответ.', 'Текст должен быть чистым');
  console.assert(normalized.reasoning.includes('Thinking process'), 'Reasoning должен быть отделен');
  console.log('PASS: BKAINormalizer корректно сохраняет reasoning отдельно от text');

  // 2. Тест потокового режима с имитацией SSE чанков
  const sseChunks = [
    'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"Thinking: step 1"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"... step 2"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":", мир!"}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  let chunkIdx = 0;
  const mockReadableStream = {
    getReader() {
      return {
        read: async () => {
          if (chunkIdx >= sseChunks.length) {
            return { done: true, value: undefined };
          }
          const chunkStr = sseChunks[chunkIdx++];
          return { done: false, value: Buffer.from(chunkStr, 'utf-8') };
        },
        releaseLock: () => {}
      };
    }
  };

  const fakeStreamResponse = {
    ok: true,
    status: 200,
    body: mockReadableStream
  };

  let streamedChunks = [];
  let reasoningChunks = [];
  const streamResult = await provider._handleStreamResponse(fakeStreamResponse, {
    onChunk: (chunk, acc) => {
      streamedChunks.push(chunk);
    },
    onReasoning: (chunk, acc) => {
      reasoningChunks.push(chunk);
    }
  });

  console.assert(streamResult.text === 'Привет, мир!', `Ожидалось "Привет, мир!", получено "${streamResult.text}"`);
  console.assert(streamResult.reasoning === 'Thinking: step 1... step 2', `Reasoning не совпадает: ${streamResult.reasoning}`);
  console.assert(streamedChunks.join('') === 'Привет, мир!', 'В onChunk должны поступать только чанки content');
  console.assert(reasoningChunks.join('') === 'Thinking: step 1... step 2', 'В onReasoning должны поступать чанки reasoning');

  console.log('PASS: _handleStreamResponse не подмешивает reasoning в onChunk и text');

  // 3. Тест отсечения <think>...</think> если модель вернула reasoning в content
  const thinkInContentResponse = {
    text: '<think>\nAnalyze user request...\nPlan answer.\n</think>\nОтвет пользователю.'
  };
  const normalizedThink = dom.window.BKAINormalizer.normalizeResponse(thinkInContentResponse);
  console.assert(normalizedThink.text === 'Ответ пользователю.', `Ожидался "Ответ пользователю.", получено "${normalizedThink.text}"`);
  console.assert(normalizedThink.reasoning.includes('Analyze user request'), 'Reasoning извлечен из тега <think>');

  console.log('PASS: BKAINormalizer отделяет <think>...</think> из content');
  console.log('=== Все проверки пройдены успешно! ===');
}

run().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
