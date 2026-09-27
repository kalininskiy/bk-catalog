#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля js/bk-ai-providers/openai-compatible.js
 *
 * Проверяет:
 *   - Создание класса OpenAIApiProvider и глобального экземпляра bkOpenAICompatibleProvider;
 *   - Нормализацию baseUrl (удаление завершающих слешей, обработка /chat/completions);
 *   - Формирование заголовков (наличие Bearer при ключе, отсутствие Authorization при пустом ключе);
 *   - Отправку не-потокового запроса POST {baseUrl}/chat/completions (model, messages, temperature, max_tokens, stream: false);
 *   - Потоковую выдачу ответа (SSE stream: data-чанги, onChunk callback, [DONE]);
 *   - Обработку HTTP ошибок (401, 404, 500 с JSON сообщением сервера);
 *   - Работу без API ключа (для локальных серверов llama.cpp / Ollama / LM Studio);
 *   - Получение списка моделей getModels() и проверку соединения testConnection();
 *   - Интеграцию с BKAIManager (bkAI.chat, bkAI.testConnection, bkAI.getModels).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');

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
const provCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf8');
vm.runInContext(provCode, sandbox, { filename: 'openai-compatible.js' });

const bkAI = sandbox.bkAI;
const OpenAIApiProvider = sandbox.OpenAIApiProvider;
const provider = sandbox.bkOpenAICompatibleProvider;

// 1. Проверка инициализации и глобальных переменных
check('Экспорт класса OpenAIApiProvider', typeof OpenAIApiProvider === 'function');
check('Экспорт экземпляра bkOpenAICompatibleProvider', typeof provider === 'object' && provider !== null);
check('Экземпляр принадлежит OpenAIApiProvider', provider instanceof OpenAIApiProvider);

// 2. Проверка регистрации провайдера в BKAIManager
check('bkAI зарегистрировал провайдер openai-compatible', bkAI.getProvider('openai-compatible') === provider);
check('bkAI зарегистрировал алиас openai', bkAI.getProvider('openai') === provider);
check('bkAI зарегистрировал алиас ollama', bkAI.getProvider('ollama') === provider);
check('bkAI зарегистрировал алиас lmstudio', bkAI.getProvider('lmstudio') === provider);
check('bkAI зарегистрировал алиас llamacpp', bkAI.getProvider('llamacpp') === provider);
check('bkAI зарегистрировал алиас openrouter', bkAI.getProvider('openrouter') === provider);

// 3. Проверка нормализации baseUrl
check('resolveBaseUrl по умолчанию возвращает https://api.openai.com/v1',
    provider.resolveBaseUrl('') === 'https://api.openai.com/v1');
check('resolveBaseUrl удаляет завершающий слэш',
    provider.resolveBaseUrl('http://localhost:11434/v1/') === 'http://localhost:11434/v1');
check('resolveBaseUrl удаляет /chat/completions если указан пользователем',
    provider.resolveBaseUrl('http://localhost:1234/v1/chat/completions') === 'http://localhost:1234/v1');
check('resolveBaseUrl добавляет /v1 если порт указан без пути (кроме стандартных)',
    provider.resolveBaseUrl('http://localhost:11434') === 'http://localhost:11434/v1');

// 4. Проверка заголовков: работа с API-ключом и без него
const headersWithKey = provider.buildHeaders({ apiKey: 'sk-test-secret' });
check('Заголовки содержат Authorization при наличии apiKey',
    headersWithKey['Authorization'] === 'Bearer sk-test-secret');

const headersNoKey = provider.buildHeaders({ apiKey: '' });
check('Заголовки НЕ содержат Authorization при пустом apiKey (важно для Ollama/llama.cpp)',
    typeof headersNoKey['Authorization'] === 'undefined');

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
            }
        })
    };
}

async function runTests() {
    // 6. Тест: Не-потоковый запрос (standard text response)
    interceptedRequests = [];
    mockFetchHandler = (url, opts) => {
        const body = JSON.parse(opts.body);
        return {
            ok: true,
            status: 200,
            json: async () => ({
                id: 'chatcmpl-test-1',
                choices: [
                    {
                        index: 0,
                        message: {
                            role: 'assistant',
                            content: 'MOV R0, R1 ; БК-0010 ассемблер ответ'
                        },
                        finish_reason: 'stop'
                    }
                ]
            })
        };
    };

    const nonStreamRes = await provider.chat({
        messages: [{ role: 'user', content: 'Как скопировать регистр на БК?' }],
        stream: false
    }, {
        baseUrl: 'http://localhost:8080/v1',
        apiKey: '',
        model: 'qwen2.5-coder',
        temperature: 0.2,
        maxTokens: 512
    });

    check('Не-потоковый ответ: текст извлечен корректно',
        nonStreamRes.text === 'MOV R0, R1 ; БК-0010 ассемблер ответ');
    check('Не-потоковый ответ: флаг streamed === false', nonStreamRes.streamed === false);
    check('Запрос отправлен на {baseUrl}/chat/completions',
        interceptedRequests[0].url === 'http://localhost:8080/v1/chat/completions');

    const sentPayload = JSON.parse(interceptedRequests[0].options.body);
    check('В запросе передан model', sentPayload.model === 'qwen2.5-coder');
    check('В запросе передан messages', Array.isArray(sentPayload.messages) && sentPayload.messages.length === 1);
    check('В запросе передан temperature', sentPayload.temperature === 0.2);
    check('В запросе передан max_tokens', sentPayload.max_tokens === 512);
    check('В запросе stream === false', sentPayload.stream === false);

    // 7. Тест: Потоковый запрос (Streaming response через SSE)
    interceptedRequests = [];
    mockFetchHandler = (url, opts) => {
        const chunks = [
            'data: {"choices":[{"delta":{"content":"MOV"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" R0,"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" R2"}}]}\n\n',
            'data: [DONE]\n\n'
        ];
        return {
            ok: true,
            status: 200,
            body: createMockStream(chunks)
        };
    };

    const receivedDeltas = [];
    const streamRes = await provider.chat({
        prompt: 'Скопировать R0 в R2',
        stream: true,
        onChunk: (delta, accumulated) => {
            receivedDeltas.push({ delta, accumulated });
        }
    }, {
        baseUrl: 'http://localhost:11434/v1',
        model: 'llama3:latest'
    });

    check('Потоковый ответ: флаг streamed === true', streamRes.streamed === true);
    check('Потоковый ответ: итоговый текст склеен полностью', streamRes.text === 'MOV R0, R2');
    check('Потоковый ответ: вызван onChunk для каждого токена', receivedDeltas.length === 3);
    check('Потоковый ответ: первый чанк', receivedDeltas[0].delta === 'MOV' && receivedDeltas[0].accumulated === 'MOV');
    check('Потоковый ответ: финальный accumulated', receivedDeltas[2].accumulated === 'MOV R0, R2');

    // 8. Тест: Обработка ошибок HTTP (401 Unauthorized с JSON сообщением)
    mockFetchHandler = (url, opts) => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
            error: {
                message: 'Incorrect API key provided: sk-invalid'
            }
        })
    });

    let httpError = null;
    try {
        await provider.chat({ messages: [{ role: 'user', content: 'test' }] }, {
            apiKey: 'sk-invalid'
        });
    } catch (e) {
        httpError = e;
    }
    check('Обработка HTTP ошибки: исключение выброшено', httpError !== null);
    check('Обработка HTTP ошибки: сообщение сервера включено',
        httpError && httpError.message.indexOf('Incorrect API key provided') !== -1);

    // 9. Тест: getModels()
    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({
            data: [
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: 'gpt-3.5-turbo' }
            ]
        })
    });

    const models = await provider.getModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
    check('getModels() возвращает список моделей', Array.isArray(models) && models.length === 2);
    check('getModels() нормализует id и name', models[0].id === 'gpt-4o' && models[1].name === 'gpt-3.5-turbo');

    // 10. Тест: testConnection()
    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'local-model' }] })
    });

    const testConnRes = await provider.testConnection({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: ''
    });
    check('testConnection() успешен для локального Ollama без ключа', testConnRes.success === true);

    // 11. Тест: Делегирование через bkAI (BKAIManager -> OpenAIApiProvider)
    bkAI.setConfig({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'codellama',
        temperature: 0.1,
        maxTokens: 1024
    });

    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/models')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    data: [{ id: 'codellama:latest', name: 'CodeLlama' }]
                })
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () => 'Mock System Prompt',
            json: async () => ({
                choices: [{ message: { role: 'assistant', content: 'HALT ; Стоп' } }]
            })
        };
    };

    const managerChatRes = await bkAI.chat({
        messages: [{ role: 'user', content: 'Команда останова БК' }]
    });
    check('bkAI.chat() успешно делегирует вызов провайдеру',
        managerChatRes && managerChatRes.text === 'HALT ; Стоп');

    const managerModels = await bkAI.getModels();
    check('bkAI.getModels() возвращает модели через провайдер',
        Array.isArray(managerModels) && managerModels.length === 1);

    const managerConn = await bkAI.testConnection();
    check('bkAI.testConnection() возвращает результат проверки через провайдер',
        managerConn && managerConn.success === true);

    // 12. Проверка списка готовых профилей
    const profiles = bkAI.getProfiles();
    check('getProfiles() возвращает массив профилей', Array.isArray(profiles) && profiles.length >= 5);

    const profMap = {};
    profiles.forEach(p => { profMap[p.id] = p; });

    check('Профиль OpenAI присутствует', Boolean(profMap['openai']));
    check('Профиль OpenAI: baseUrl = https://api.openai.com/v1',
        profMap['openai'] && profMap['openai'].baseUrl === 'https://api.openai.com/v1');

    check('Профиль Gemini присутствует', Boolean(profMap['gemini']));
    check('Профиль Gemini: baseUrl = https://generativelanguage.googleapis.com/v1beta/openai/',
        profMap['gemini'] && profMap['gemini'].baseUrl === 'https://generativelanguage.googleapis.com/v1beta/openai/');

    check('Профиль llama.cpp присутствует', Boolean(profMap['llamacpp']));
    check('Профиль llama.cpp: baseUrl = http://127.0.0.1:8080/v1',
        profMap['llamacpp'] && profMap['llamacpp'].baseUrl === 'http://127.0.0.1:8080/v1');

    check('Профиль Ollama присутствует', Boolean(profMap['ollama']));
    check('Профиль Ollama: baseUrl = http://127.0.0.1:11434/v1',
        profMap['ollama'] && profMap['ollama'].baseUrl === 'http://127.0.0.1:11434/v1');

    check('Профиль LM Studio присутствует', Boolean(profMap['lmstudio']));
    check('Профиль LM Studio: baseUrl = http://127.0.0.1:1234/v1',
        profMap['lmstudio'] && profMap['lmstudio'].baseUrl === 'http://127.0.0.1:1234/v1');

    // 13. Проверка, что все профили используют OpenAI-compatible provider
    profiles.forEach(p => {
        check(`Профиль ${p.name} использует OpenAI-compatible provider`,
            bkAI.getProvider(p.id) === provider);
    });

    // 14. Проверка отсутствия зашитых API-ключей в исходниках и профилях
    profiles.forEach(p => {
        check(`Профиль ${p.name} не содержит зашитого API ключа`, !p.apiKey);
    });
    check('Конфигурация по умолчанию не содержит зашитого API ключа', !bkAI.resetConfig().apiKey);

    // 15. Проверка применения профиля Gemini и настройки пользователем (baseUrl, apiKey, model)
    bkAI.applyProfile('gemini');
    check('После applyProfile(gemini) baseUrl установлен',
        bkAI.getConfig().baseUrl === 'https://generativelanguage.googleapis.com/v1beta/openai/');

    bkAI.setConfig({
        apiKey: 'AIzaSyTestUserKey123',
        model: 'gemini-1.5-flash'
    });
    const geminiCfg = bkAI.getConfig();
    check('Пользователь может изменить apiKey', geminiCfg.apiKey === 'AIzaSyTestUserKey123');
    check('Пользователь может изменить model', geminiCfg.model === 'gemini-1.5-flash');

    // Пользователь может изменить baseUrl профиля
    bkAI.setConfig({
        baseUrl: 'https://my-proxy.company.internal/v1beta/openai/'
    });
    check('Пользователь может изменить baseUrl',
        bkAI.getConfig().baseUrl === 'https://my-proxy.company.internal/v1beta/openai/');

    // 16. Запрос с Gemini через OpenAI-совместимый эндпоинт
    interceptedRequests = [];
    mockFetchHandler = (url, opts) => {
        return {
            ok: true,
            status: 200,
            text: async () => 'Mock System Prompt',
            json: async () => ({
                choices: [{ message: { role: 'assistant', content: 'MOV R0, -(SP)' } }]
            })
        };
    };

    const geminiChatRes = await bkAI.chat({ prompt: 'Как положить R0 в стек БК?' });
    check('Gemini запрос выполнен через chat/completions',
        interceptedRequests[0].url === 'https://my-proxy.company.internal/v1beta/openai/chat/completions');
    check('Gemini запрос содержит Authorization c пользовательским ключом',
        interceptedRequests[0].options.headers['Authorization'] === 'Bearer AIzaSyTestUserKey123');
    check('Gemini ответ корректно получен', geminiChatRes && geminiChatRes.text === 'MOV R0, -(SP)');

    // 17. Проверка применения профиля llama.cpp и локальных серверов
    bkAI.applyProfile('llamacpp');
    check('Профиль llama.cpp устанавливает baseUrl http://127.0.0.1:8080/v1',
        bkAI.getConfig().baseUrl === 'http://127.0.0.1:8080/v1');

    bkAI.applyProfile('lmstudio');
    check('Профиль LM Studio устанавливает baseUrl http://127.0.0.1:1234/v1',
        bkAI.getConfig().baseUrl === 'http://127.0.0.1:1234/v1');

    console.log(`\nИтог тестов провайдера и профилей: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Непредвиденная ошибка в runTests:', err);
    process.exit(1);
});
