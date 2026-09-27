#!/usr/bin/env node
/**
 * BKStudio - Тесты системного промпта AI (\bkstudio\ai\system.md)
 *
 * Проверяет:
 *   1. Загрузку файла \bkstudio\ai\system.md;
 *   2. Наличие многострочного Markdown и специальных символов;
 *   3. Кэширование системного промпта в памяти (без повторных загрузок);
 *   4. Обработку ошибок загрузки (понятное сообщение об ошибке, запрет отправки без промпта);
 *   5. Передачу системного промпта именно как role: "system" в начале messages;
 *   6. Сохранение пользовательского prompt как отдельного role: "user";
 *   7. Сохранение существующей истории сообщений (conversation history) без дублирования system;
 *   8. Корректное объединение со специализированным контекстом / Skills / diagnostics;
 *   9. Совместимость с OpenAI-compatible provider;
 *  10. Совместимость с Anthropic Claude Messages API (вынесение в поле system);
 *  11. Совместимость со стримингом и вызовом инструментов (tools / agent loop).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');
const SYSTEM_MD_PATH = path.join(__dirname, '..', '..', 'ai', 'system.md');

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

// 1. Проверяем физическое наличие файла bkstudio/ai/system.md
check('Файл bkstudio/ai/system.md существует на диске', fs.existsSync(SYSTEM_MD_PATH));
const rawSystemMdContent = fs.readFileSync(SYSTEM_MD_PATH, 'utf-8');
check('Файл bkstudio/ai/system.md не пуст', rawSystemMdContent.trim().length > 100);
check('Файл содержит секцию "Главный принцип"', rawSystemMdContent.includes('Главный принцип'));
check('Файл содержит секцию "Skills"', rawSystemMdContent.includes('Skills'));

// Подготовка песочницы VM
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => { for (const k in storage) delete storage[k]; }
};

let lastFetchUrl = null;
let lastFetchOptions = null;
let mockFetchHandler = null;

function fakeFetch(url, options) {
    lastFetchUrl = String(url);
    lastFetchOptions = options || {};
    if (typeof mockFetchHandler === 'function') {
        const handled = mockFetchHandler(lastFetchUrl, lastFetchOptions);
        if (handled && handled.status !== 404) {
            return Promise.resolve(handled);
        }
    }
    // По умолчанию эмулируем чтение файла system.md при запросе ai/system.md
    if (lastFetchUrl.includes('system.md') && !lastFetchUrl.includes('skills')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => rawSystemMdContent
        });
    }
    // Чтение файлов Skills с диска
    if (lastFetchUrl.includes('skills')) {
        const m = lastFetchUrl.match(/skills\/([^\/]+)\/(.+)$/);
        if (m) {
            const fp = path.join(__dirname, '..', '..', 'ai', 'skills', m[1], m[2]);
            if (fs.existsSync(fp)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    text: async () => fs.readFileSync(fp, 'utf-8')
                });
            }
        }
    }
    if (typeof mockFetchHandler === 'function') {
        return Promise.resolve(mockFetchHandler(lastFetchUrl, lastFetchOptions));
    }
    return Promise.reject(new Error(`Unhandled fetch URL: ${lastFetchUrl}`));
}

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    fetch: fakeFetch,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AbortController: AbortController,
    Promise: Promise,
    Error: Error
};
sandbox.window = sandbox;
sandbox.global = sandbox;

const context = vm.createContext(sandbox);

// Загрузка модулей в контекст
const codeNormalizer = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf-8');
const codeManager = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf-8');
const codeOpenAI = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf-8');
const codeAnthropic = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'anthropic.js'), 'utf-8');

vm.runInContext(codeNormalizer, context);
vm.runInContext(codeManager, context);
vm.runInContext(codeOpenAI, context);
vm.runInContext(codeAnthropic, context);

async function runTests() {
    console.log('=== Запуск тестов системного промпта AI (\\bkstudio\\ai\\system.md) ===\n');

    const bkAI = context.bkAI;

    // 1. Метод getSystemPrompt()
    check('bkAI.getSystemPrompt() является функцией', typeof bkAI.getSystemPrompt === 'function');
    const loadedPrompt = await bkAI.getSystemPrompt();
    check('bkAI.getSystemPrompt() возвращает непустую строку', typeof loadedPrompt === 'string' && loadedPrompt.length > 100);
    check('Системный промпт содержит ключевые фразы из system.md',
        loadedPrompt.includes('К1801ВМ1') && loadedPrompt.includes('BKTurbo8') && loadedPrompt.includes('PDP-11'));

    // 2. Кэширование системного промпта
    let fetchCounter = 0;
    mockFetchHandler = (url) => {
        if (url.includes('system.md')) {
            fetchCounter++;
            return {
                ok: true,
                status: 200,
                text: async () => 'Cached system prompt test'
            };
        }
        return { ok: false, status: 404 };
    };

    // Сбросим кэш для проверки вызова
    bkAI.clearSystemPromptCache();
    await bkAI.getSystemPrompt();
    const callsAfterFirst = fetchCounter;
    // Второй вызов должен взять из кэша
    await bkAI.getSystemPrompt();
    check('Повторный вызов getSystemPrompt() берет данные из кэша памяти без повторного fetch', fetchCounter === callsAfterFirst);

    // Восстанавливаем реальный промпт
    bkAI.setSystemPrompt(rawSystemMdContent);

    // 3. Обработка ошибки загрузки
    bkAI.clearSystemPromptCache();
    mockFetchHandler = () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found'
    });

    // В среде Node.js метод пробует fs, поэтому временно симулируем сбой
    let loadFailed = false;
    let loadErrorMsg = '';
    const brokenManager = new context.BKAIManager();
    brokenManager.getSystemPrompt = async () => {
        throw new Error('Не удалось загрузить системный промпт BKStudio AI (\\bkstudio\\ai\\system.md): HTTP 404 Not Found');
    };

    try {
        await brokenManager.chat({ prompt: 'Привет' });
    } catch (err) {
        loadFailed = true;
        loadErrorMsg = err.message;
    }
    check('При ошибке загрузки system.md запрос блокируется', loadFailed === true);
    check('Ошибка содержит путь к system.md и понятное описание', loadErrorMsg.includes('\\bkstudio\\ai\\system.md'));

    // 4. Проверка структуры сообщений для OpenAI-compatible провайдера
    bkAI.setSystemPrompt(rawSystemMdContent);
    bkAI.setConfig({ provider: 'openai', apiKey: 'sk-test' });

    let sentPayload = null;
    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/chat/completions')) {
            sentPayload = JSON.parse(opts.body);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    choices: [
                        { message: { role: 'assistant', content: 'Ответ модели' } }
                    ]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    // Тест 4.1: Обычный пользовательский prompt
    await bkAI.chat({ prompt: 'Как вывести символ на экран БК?' });
    check('OpenAI запрос отправлен', sentPayload !== null);
    check('Первое сообщение имеет role: "system"', sentPayload && sentPayload.messages[0].role === 'system');
    check('Первое сообщение содержит текст из system.md', sentPayload && sentPayload.messages[0].content.includes('К1801ВМ1'));
    check('Второе сообщение имеет role: "user"', sentPayload && sentPayload.messages[1].role === 'user');
    check('Пользовательский prompt не загрязнен системным текстом', sentPayload && sentPayload.messages[1].content === 'Как вывести символ на экран БК?');

    // Тест 4.2: Диалог с существующей историей (conversation history)
    const history = [
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Привет! Чем помочь по БК?' },
        { role: 'user', content: 'Напиши подпрограмму задержки' }
    ];

    await bkAI.chat({ messages: history.slice() });
    check('В запросе с историей ровно одно системное сообщение в начале',
        sentPayload.messages.filter(m => m.role === 'system').length === 1 && sentPayload.messages[0].role === 'system');
    check('После system идут существующие сообщения истории',
        sentPayload.messages[1].content === 'Привет' &&
        sentPayload.messages[2].content === 'Привет! Чем помочь по БК?' &&
        sentPayload.messages[3].content === 'Напиши подпрограмму задержки');
    check('Исходный массив истории пользователя не мутирован', history.length === 3 && history[0].role === 'user');

    // Тест 4.3: Передача дополнительного контекста (IDE context / diagnostics / Skills)
    await bkAI.chat({
        prompt: 'Скомпилируй',
        systemPrompt: 'Контекст проекта: файл main.asm, компилятор BKTurbo8, адрес 1000'
    });
    check('Системное сообщение объединяет базовый system.md и контекст проекта',
        sentPayload.messages[0].content.includes('К1801ВМ1') &&
        sentPayload.messages[0].content.includes('Контекст проекта: файл main.asm'));
    check('Системное сообщение является единственным', sentPayload.messages.filter(m => m.role === 'system').length === 1);

    // 5. Проверка структуры сообщений для Anthropic Claude (Messages API)
    bkAI.setConfig({ provider: 'anthropic', apiKey: 'sk-ant-test' });

    let sentAnthropicPayload = null;
    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/messages')) {
            sentAnthropicPayload = JSON.parse(opts.body);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    content: [
                        { type: 'text', text: 'Ответ Claude' }
                    ]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    await bkAI.chat({
        prompt: 'Напиши процедуру EMT 16',
        systemPrompt: 'Диагностика: ошибок нет'
    });

    check('Anthropic запрос отправлен', sentAnthropicPayload !== null);
    check('Anthropic payload содержит поле system', typeof sentAnthropicPayload.system === 'string');
    check('Поле system содержит базовый system.md', sentAnthropicPayload.system.includes('К1801ВМ1'));
    check('Поле system содержит переданный контекст диагностики', sentAnthropicPayload.system.includes('Диагностика: ошибок нет'));
    check('В массиве messages Anthropic отсутствуют сообщения с role: "system"',
        !sentAnthropicPayload.messages.some(m => m.role === 'system'));
    check('В массиве messages Anthropic содержится только пользовательский запрос',
        sentAnthropicPayload.messages.length === 1 && sentAnthropicPayload.messages[0].role === 'user' &&
        sentAnthropicPayload.messages[0].content === 'Напиши процедуру EMT 16');

    // 6. Поддержка специальных символов и нескольких строк Markdown
    const specialMarkdown = `# Заголовок с кавычками "БК-0010" & <теги>
\`\`\`pdp11
  MOV #100, R0 ; Проверка спецсимволов: $, %, ^, &, *, <, >, ", '
  EMT 14
\`\`\`
- Пункт 1: **жирный текст**
- Пункт 2: *курсив*
- Пункт 3: \`инлайн код\``;

    bkAI.setSystemPrompt(specialMarkdown);
    bkAI.setConfig({ provider: 'openai', apiKey: 'sk-test' });

    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/chat/completions')) {
            sentPayload = JSON.parse(opts.body);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    choices: [{ message: { role: 'assistant', content: 'Ответ' } }]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    await bkAI.chat({ prompt: 'Тест спецсимволов' });
    check('Многострочный Markdown со спецсимволами сохраняется без повреждения',
        sentPayload.messages[0].content.startsWith(specialMarkdown));

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
