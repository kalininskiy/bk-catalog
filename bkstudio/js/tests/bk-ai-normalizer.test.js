#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля js/bk-ai-normalizer.js
 *
 * Проверяет:
 *   - Нормализацию текстовых ответов: { type: "text", text: "..." };
 *   - Нормализацию вызовов инструментов: { type: "tool_call", name: "...", arguments: {...} };
 *   - Нормализацию ошибок: { type: "error", error: {...} };
 *   - Парсинг ответов OpenAI / Ollama / llama.cpp / Gemini;
 *   - Парсинг ответов Anthropic Messages API (text blocks, tool_use blocks);
 *   - Единый формат streaming-чанков: { type: "text", delta: "...", text: "..." };
 *   - Интеграцию с BKAIManager: вызовы chat() возвращают нормализованный объект;
 *   - Независимость UI от конкретного провайдера (UI работает только со структурами BKAIManager).
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

// Создание изолированного контекста
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

// 1. Загрузка нормализатора
const normalizerCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf8');
vm.runInContext(normalizerCode, sandbox, { filename: 'bk-ai-normalizer.js' });

// 2. Загрузка менеджера
const mgrCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf8');
vm.runInContext(mgrCode, sandbox, { filename: 'bk-ai-manager.js' });

// 3. Загрузка провайдеров
const openAiCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf8');
vm.runInContext(openAiCode, sandbox, { filename: 'openai-compatible.js' });

const anthropicCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'anthropic.js'), 'utf8');
vm.runInContext(anthropicCode, sandbox, { filename: 'anthropic.js' });

const Normalizer = sandbox.BKAINormalizer;
const bkAI = sandbox.bkAI;

// 1. Проверка экспорта
check('Экспорт класса BKAINormalizer', typeof Normalizer === 'function');
check('Экспорт глобального синглтона bkAINormalizer', typeof sandbox.bkAINormalizer === 'function' || typeof sandbox.bkAINormalizer === 'object');

// 2. Проверка базовых методов создания типов
const textItem = Normalizer.createText('MOV R0, R1');
check('createText: тип "text"', textItem.type === 'text');
check('createText: поле text', textItem.text === 'MOV R0, R1');

const toolItem = Normalizer.createToolCall('compile_asm', { target: 'bk0010' });
check('createToolCall: тип "tool_call"', toolItem.type === 'tool_call');
check('createToolCall: поле name', toolItem.name === 'compile_asm');
check('createToolCall: поле arguments (объект)', toolItem.arguments && toolItem.arguments.target === 'bk0010');

const toolJsonItem = Normalizer.createToolCall('read_memory', '{"addr": "040000", "length": 16}');
check('createToolCall: распарсил JSON строку arguments',
    toolJsonItem.arguments && toolJsonItem.arguments.addr === '040000' && toolJsonItem.arguments.length === 16);

const errorItem = Normalizer.createError(new Error('Connection timeout'));
check('createError: тип "error"', errorItem.type === 'error');
check('createError: поле message из Error', errorItem.error && errorItem.error.message === 'Connection timeout');

const errorStrItem = Normalizer.createError('Invalid API key');
check('createError: поле message из строки', errorStrItem.error && errorStrItem.error.message === 'Invalid API key');

// 3. Нормализация ответа OpenAI-compatible (обычный текст)
const openAiRawText = {
    choices: [
        {
            message: {
                role: 'assistant',
                content: 'В БК-0010 экран занимает адреса с 040000 по 077777.'
            }
        }
    ]
};
const normOpenAiText = Normalizer.normalizeResponse(openAiRawText);
check('OpenAI ответ нормализован к типу "text"', normOpenAiText.type === 'text');
check('OpenAI текст извлечен корректно', normOpenAiText.text === 'В БК-0010 экран занимает адреса с 040000 по 077777.');

// 4. Нормализация ответа OpenAI с tool_calls
const openAiRawTools = {
    choices: [
        {
            message: {
                role: 'assistant',
                content: 'Вызываю ассемблирование файла.',
                tool_calls: [
                    {
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'assemble_file',
                            arguments: '{"filename":"main.mac","format":"bin"}'
                        }
                    }
                ]
            }
        }
    ]
};
const normOpenAiTools = Normalizer.normalizeResponse(openAiRawTools);
check('OpenAI tool_call нормализован к типу "tool_call"', normOpenAiTools.type === 'tool_call');
check('OpenAI tool_call: name', normOpenAiTools.name === 'assemble_file');
check('OpenAI tool_call: arguments',
    normOpenAiTools.arguments && normOpenAiTools.arguments.filename === 'main.mac' && normOpenAiTools.arguments.format === 'bin');
check('OpenAI tool_call: содержит items с text и tool_call',
    Array.isArray(normOpenAiTools.items) && normOpenAiTools.items.length === 2);

// 5. Нормализация ответа Anthropic Claude (текстовые блоки)
const anthropicRawText = {
    id: 'msg_01X',
    type: 'message',
    role: 'assistant',
    content: [
        {
            type: 'text',
            text: 'Команда CLR очищает операнд в PDP-11.'
        }
    ]
};
const normAnthropicText = Normalizer.normalizeResponse(anthropicRawText);
check('Anthropic ответ нормализован к типу "text"', normAnthropicText.type === 'text');
check('Anthropic текст извлечен корректно', normAnthropicText.text === 'Команда CLR очищает операнд в PDP-11.');

// 6. Нормализация ответа Anthropic Claude с tool_use
const anthropicRawTools = {
    id: 'msg_02Y',
    type: 'message',
    role: 'assistant',
    content: [
        {
            type: 'text',
            text: 'Проверяю регистры...'
        },
        {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'get_registers',
            input: { cpu: '1801BM1' }
        }
    ]
};
const normAnthropicTools = Normalizer.normalizeResponse(anthropicRawTools);
check('Anthropic tool_use нормализован к типу "tool_call"', normAnthropicTools.type === 'tool_call');
check('Anthropic tool_use: name', normAnthropicTools.name === 'get_registers');
check('Anthropic tool_use: arguments',
    normAnthropicTools.arguments && normAnthropicTools.arguments.cpu === '1801BM1');

// 7. Нормализация серверной ошибки
const rawServerError = {
    error: {
        message: 'Model is overloaded',
        code: 'rate_limit_exceeded'
    }
};
const normError = Normalizer.normalizeResponse(rawServerError);
check('Серверная ошибка нормализована к типу "error"', normError.type === 'error');
check('Текст ошибки извлечен', normError.error && normError.error.message === 'Model is overloaded');

// 8. Нормализация стриминг-чанков
const chunk1 = Normalizer.normalizeStreamChunk('MOV ', 'MOV ');
check('Стриминг токен: тип "text"', chunk1.type === 'text');
check('Стриминг токен: delta', chunk1.delta === 'MOV ');
check('Стриминг токен: text (накопленный)', chunk1.text === 'MOV ');
check('Стриминг токен: строковое приведение .toString()', String(chunk1) === 'MOV ');

const chunkTool = Normalizer.normalizeStreamChunk({
    type: 'tool_call',
    name: 'write_byte',
    arguments: { val: 0o223 }
});
check('Стриминг tool_call: тип "tool_call"', chunkTool.type === 'tool_call');
check('Стриминг tool_call: name', chunkTool.name === 'write_byte');

async function runIntegrationTests() {
    // 9. Сквозная проверка через BKAIManager (OpenAI-compatible)
    bkAI.applyProfile('ollama');
    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content: 'NOP ; Пустая операция' } }]
        })
    });

    const openAiManagerRes = await bkAI.chat({ prompt: 'Команда NOP' });
    check('bkAI.chat() с OpenAI-compatible возвращает нормализованный объект type "text"',
        openAiManagerRes.type === 'text');
    check('Текст ответа корректен', openAiManagerRes.text === 'NOP ; Пустая операция');

    // 10. Сквозная проверка через BKAIManager (Anthropic)
    bkAI.applyProfile('anthropic');
    bkAI.setConfig({ apiKey: 'sk-ant-test' });

    mockFetchHandler = (url, opts) => ({
        ok: true,
        status: 200,
        json: async () => ({
            content: [{ type: 'text', text: 'BR LOOP ; Безусловный переход' }],
            role: 'assistant'
        })
    });

    const anthropicManagerRes = await bkAI.chat({ prompt: 'Команда BR' });
    check('bkAI.chat() с Anthropic возвращает нормализованный объект type "text"',
        anthropicManagerRes.type === 'text');
    check('Текст ответа Claude корректен', anthropicManagerRes.text === 'BR LOOP ; Безусловный переход');

    // 11. Сквозная проверка потокового режима через BKAIManager
    const receivedNormalizedChunks = [];
    mockFetchHandler = (url, opts) => {
        const sseChunks = [
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SOB "}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"R1, LOOP"}}\n\n'
        ];
        let idx = 0;
        const encoder = new (typeof TextEncoder !== 'undefined' ? TextEncoder : require('util').TextEncoder)();
        return {
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: async () => {
                        if (idx < sseChunks.length) {
                            return { done: false, value: encoder.encode(sseChunks[idx++]) };
                        }
                        return { done: true, value: undefined };
                    },
                    releaseLock: () => {}
                })
            }
        };
    };

    const streamChatRes = await bkAI.chat({
        prompt: 'Команда цикла БК',
        stream: true,
        onChunk: (chunk) => {
            receivedNormalizedChunks.push(chunk);
        }
    });

    check('Потоковые чанки имеют единый формат type "text"',
        receivedNormalizedChunks.every(c => c.type === 'text'));
    check('Потоковые чанки содержат delta',
        receivedNormalizedChunks[0].delta === 'SOB ' && receivedNormalizedChunks[1].delta === 'R1, LOOP');
    check('Итоговый ответ потока нормализован к type "text"', streamChatRes.type === 'text');
    check('Итоговый текст склеен полностью', streamChatRes.text === 'SOB R1, LOOP');

    console.log(`\nИтог тестов BKAINormalizer: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runIntegrationTests().catch(err => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
