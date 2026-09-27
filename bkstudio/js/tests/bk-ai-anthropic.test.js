#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля js/bk-ai-providers/anthropic.js
 *
 * Проверяет:
 *   - Создание класса AnthropicProvider и глобального экземпляра bkAnthropicProvider;
 *   - Регистрацию провайдера в BKAIManager ('anthropic', 'claude');
 *   - Заголовки Anthropic Messages API (x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access);
 *   - Формирование payload (вынесение system prompt в верхнеуровневый system, только user/assistant в messages);
 *   - Не-потоковый запрос к {baseUrl}/messages и нормализацию к формату BKAIManager;
 *   - Потоковую выдачу через SSE (content_block_delta, onChunk, message_stop);
 *   - Обработку ошибок API (401 invalid key, отсутствие apiKey, network errors);
 *   - getModels() и testConnection();
 *   - Интеграцию с BKAIManager и профилем 'anthropic';
 *   - Сосуществование двух провайдеров в архитектуре: OpenAI-compatible и Anthropic.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, ok) {
    if (ok) {
        console.log('PASS: ' + name);
        passed++;
    } else {
        console.error('FAIL: ' + name);
        failed++;
    }
}

// Создание изолированного контекста с fetch и Web API
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => {
        for (const k in storage) {
            delete storage[k];
        }
    }
};

let interceptedRequests = [];
let mockFetchHandler = null;

function fakeFetch(url, options) {
    interceptedRequests.push({ url: String(url), options: options || {} });
    if (typeof mockFetchHandler === 'function') {
        return Promise.resolve(mockFetchHandler(String(url), options || {}));
    }
    return Promise.reject(new Error('mockFetchHandler не задан'));
}

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Error: Error,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : require('util').TextDecoder,
    fetch: fakeFetch
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// 1. Загрузка bk-ai-manager.js
const mgrCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf8');
vm.runInContext(mgrCode, sandbox, { filename: 'bk-ai-manager.js' });

// 2. Загрузка bk-ai-providers/openai-compatible.js
const openAiCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf8');
vm.runInContext(openAiCode, sandbox, { filename: 'openai-compatible.js' });

// 3. Загрузка bk-ai-providers/anthropic.js
const anthropicCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'anthropic.js'), 'utf8');
vm.runInContext(anthropicCode, sandbox, { filename: 'anthropic.js' });

const bkAI = sandbox.bkAI;
const AnthropicProvider = sandbox.AnthropicProvider;
const anthropicProvider = sandbox.bkAnthropicProvider;
const openAiProvider = sandbox.bkOpenAICompatibleProvider;

// 1. Проверка инициализации
check('Экспорт класса AnthropicProvider', typeof AnthropicProvider === 'function');
check('Экспорт экземпляра bkAnthropicProvider', typeof anthropicProvider === 'object' && anthropicProvider !== null);
check('Экземпляр принадлежит AnthropicProvider', anthropicProvider instanceof AnthropicProvider);

// 2. Проверка регистрации двух провайдеров в архитектуре
check('BKAIManager зарегистрировал OpenAI-compatible provider',
    bkAI.getProvider('openai-compatible') === openAiProvider);
check('BKAIManager зарегистрировал Anthropic provider',
    bkAI.getProvider('anthropic') === anthropicProvider);
check('BKAIManager зарегистрировал алиас claude для Anthropic',
    bkAI.getProvider('claude') === anthropicProvider);
check('Оба провайдера сосуществуют и не конфликтуют',
    bkAI.getProvider('openai-compatible') !== bkAI.getProvider('anthropic'));

// 3. Проверка заголовков Anthropic Messages API
const headers = anthropicProvider.buildHeaders({ apiKey: 'sk-ant-api03-testkey' });
check('Заголовки содержат x-api-key', headers['x-api-key'] === 'sk-ant-api03-testkey');
check('Заголовки содержат anthropic-version 2023-06-01', headers['anthropic-version'] === '2023-06-01');
check('Заголовки содержат anthropic-dangerous-direct-browser-access: true для браузера',
    headers['anthropic-dangerous-direct-browser-access'] === 'true');
check('Заголовки НЕ содержат Authorization: Bearer', typeof headers['Authorization'] === 'undefined');

// 4. Проверка разделения system prompt и сообщений
const payloadPrep1 = anthropicProvider.preparePayloadMessages({
    systemPrompt: 'Ты эксперт по БК-0010',
    messages: [
        { role: 'system', content: 'Дополнительное правило' },
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Здравствуйте' },
        { role: 'user', content: 'Как запустить ассемблер?' }
    ]
});

check('System prompt корректно вынесен в поле system',
    payloadPrep1.system === 'Ты эксперт по БК-0010\n\nДополнительное правило');
check('В массиве messages нет сообщений с ролью system',
    payloadPrep1.messages.every(m => m.role === 'user' || m.role === 'assistant'));
check('Сообщений в messages ровно 3', payloadPrep1.messages.length === 3);

// 5. Вспомогательная функция для создания mock ReadableStream из строк
function createMockStream(chunks) {
    const encoder = new (typeof TextEncoder !== 'undefined' ? TextEncoder : require('util').TextEncoder)();
    let index = 0;
    return {
        getReader: () => ({
            read: async () => {
                if (index < chunks.length) {
                    const value = encoder.encode(chunks[index++]);
                    return { done: false, value };
                }
                return { done: true, value: undefined };
            },
            releaseLock: () => {}
        })
    };
}

async function runTests() {
    // 6. Проверка валидации отсутствия API-ключа
    let noKeyError = null;
    try {
        await anthropicProvider.chat({ prompt: 'test' }, { apiKey: '' });
    } catch (e) {
        noKeyError = e;
    }
    check('Chat без API-ключа отклоняется с понятной ошибкой',
        noKeyError && noKeyError.message.includes('Не указан API ключ для Anthropic'));

    // 7. Не-потоковый запрос (standard text response)
    interceptedRequests = [];
    mockFetchHandler = (url, opts) => {
        return {
            ok: true,
            status: 200,
            json: async () => ({
                id: 'msg_019481923',
                type: 'message',
                role: 'assistant',
                model: 'claude-3-5-sonnet-20241022',
                content: [
                    {
                        type: 'text',
                        text: 'Для БК-0010 команда останова — это HALT (код 000000).'
                    }
                ],
                stop_reason: 'end_turn',
                usage: { input_tokens: 15, output_tokens: 22 }
            })
        };
    };

    const nonStreamRes = await anthropicProvider.chat({
        prompt: 'Какая команда останова на БК-0010?',
        systemPrompt: 'Отвечай кратко',
        stream: false
    }, {
        apiKey: 'sk-ant-valid-key',
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.3,
        maxTokens: 500
    });

    check('Запрос отправлен на {baseUrl}/messages',
        interceptedRequests[0].url === 'https://api.anthropic.com/v1/messages');

    const sentBody = JSON.parse(interceptedRequests[0].options.body);
    check('В payload передан model', sentBody.model === 'claude-3-5-sonnet-20241022');
    check('В payload передан system', sentBody.system === 'Отвечай кратко');
    check('В payload передан max_tokens', sentBody.max_tokens === 500);
    check('В payload передан stream === false', sentBody.stream === false);

    check('Результат приведен к формату BKAIManager: text',
        nonStreamRes.text === 'Для БК-0010 команда останова — это HALT (код 000000).');
    check('Результат приведен к формату BKAIManager: message.role === "assistant"',
        nonStreamRes.message && nonStreamRes.message.role === 'assistant');
    check('Результат приведен к формату BKAIManager: message.content',
        nonStreamRes.message && nonStreamRes.message.content === nonStreamRes.text);
    check('Результат содержит streamed === false', nonStreamRes.streamed === false);

    // 8. Потоковый запрос через Anthropic SSE
    interceptedRequests = [];
    mockFetchHandler = (url, opts) => {
        const sseChunks = [
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant"}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"MOV "}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"#40000, "}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"R1"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ];
        return {
            ok: true,
            status: 200,
            body: createMockStream(sseChunks)
        };
    };

    const streamDeltas = [];
    const streamRes = await anthropicProvider.chat({
        prompt: 'Загрузить адрес видеопамяти БК в R1',
        stream: true,
        onChunk: (delta, accumulated) => {
            streamDeltas.push({ delta, accumulated });
        }
    }, {
        apiKey: 'sk-ant-valid-key'
    });

    check('Потоковый ответ Anthropic: streamed === true', streamRes.streamed === true);
    check('Потоковый ответ Anthropic: полный текст склеен', streamRes.text === 'MOV #40000, R1');
    check('Потоковый ответ Anthropic: вызовы onChunk зафиксированы', streamDeltas.length === 3);
    check('Потоковый ответ Anthropic: первый токен', streamDeltas[0].delta === 'MOV ');
    check('Потоковый ответ Anthropic: финальный accumulated', streamDeltas[2].accumulated === 'MOV #40000, R1');

    // 9. Обработка ошибок Anthropic API (401 authentication_error)
    mockFetchHandler = (url, opts) => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
            type: 'error',
            error: {
                type: 'authentication_error',
                message: 'invalid x-api-key provided'
            }
        })
    });

    let apiErr = null;
    try {
        await anthropicProvider.chat({ prompt: 'test' }, { apiKey: 'invalid-key' });
    } catch (e) {
        apiErr = e;
    }
    check('Ошибка API Anthropic выбрасывает исключение', apiErr !== null);
    check('Сообщение об ошибке содержит текст от Anthropic (invalid x-api-key)',
        apiErr && apiErr.message.includes('invalid x-api-key'));

    // 10. Проверка моделей и соединения
    const models = await anthropicProvider.getModels({ apiKey: 'sk-ant-test' });
    check('getModels() возвращает список моделей Claude', Array.isArray(models) && models.length >= 3);
    check('Модели содержат Claude 3.5 Sonnet', models.some(m => m.id.includes('claude-3-5-sonnet')));

    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({
            data: [{ id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' }]
        })
    });
    const connRes = await anthropicProvider.testConnection({ apiKey: 'sk-ant-valid' });
    check('testConnection() успешен при валидном ключе', connRes && connRes.success === true);

    // 11. Проверка сквозной интеграции через BKAIManager
    check('Профиль anthropic присутствует в BKAIManager', Boolean(bkAI.getProfile('anthropic')));

    bkAI.applyProfile('anthropic');
    const appliedCfg = bkAI.getConfig();
    check('applyProfile(anthropic) установил provider anthropic', appliedCfg.provider === 'anthropic');
    check('applyProfile(anthropic) установил baseUrl https://api.anthropic.com/v1',
        appliedCfg.baseUrl === 'https://api.anthropic.com/v1');

    bkAI.setConfig({
        apiKey: 'sk-ant-user-runtime-key',
        model: 'claude-3-5-haiku-20241022'
    });

    interceptedRequests = [];
    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        text: async () => 'System prompt',
        json: async () => ({
            content: [{ type: 'text', text: 'CLR R0 ; Очистить R0' }],
            role: 'assistant'
        })
    });

    const managerChatRes = await bkAI.chat({
        prompt: 'Очистить R0 на БК'
    });

    check('bkAI.chat() прозрачно вызывает AnthropicProvider',
        managerChatRes && managerChatRes.text === 'CLR R0 ; Очистить R0');
    const msgReq = interceptedRequests.find(r => r.url && r.url.includes('/messages')) || interceptedRequests[0];
    check('Запрос направлен на Anthropic Messages API с x-api-key',
        msgReq.url === 'https://api.anthropic.com/v1/messages' &&
        msgReq.options.headers['x-api-key'] === 'sk-ant-user-runtime-key');

    // Проверяем, что переключение обратно на OpenAI работает без проблем
    bkAI.applyProfile('openai');
    check('Переключение на OpenAI возвращает OpenAI-compatible provider',
        bkAI.getProvider(bkAI.getConfig().provider) === openAiProvider);

    console.log(`\nИтог тестов Anthropic провайдера: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Непредвиденная ошибка в runTests:', err);
    process.exit(1);
});
