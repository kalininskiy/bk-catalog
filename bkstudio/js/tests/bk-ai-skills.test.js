#!/usr/bin/env node
/**
 * BKStudio - Тесты подключения Skills (bk0010code, bk0010emt)
 *
 * Проверяет:
 *   1. Наличие и валидность registry Skills (DEFAULT_SKILLS: bk0010code, bk0010emt);
 *   2. Возможность добавления и переключения активных Skills (реестр не зашит жестко);
 *   3. Загрузку одиночных Skills (bk0010emt) и модульных Skills со связанными документами (bk0010code);
 *   4. Кэширование содержимого Skills в оперативной памяти (без повторных fetch/fs чтений);
 *   5. Явную диагностику ошибок при недоступности Skill (запрет отправки без запрошенного Skill);
 *   6. Проверка 1: Структура messages в правильном порядке:
 *        system (system.md -> bk0010code -> bk0010emt -> project context)
 *        user (user request)
 *   7. Проверка 2: Реальное присутствие содержимого обоих Skills в запросе модели;
 *   8. Проверка 3: Skills не попадают в пользовательское сообщение как обычный текст;
 *   9. Проверка 4: При нескольких сообщениях истории диалога Skills не дублируются;
 *  10. Проверка 5: Совместимость с Agent и tool calling (не дублируется в истории агента);
 *  11. Проверка 6: Совместимость со стримингом (onChunk);
 *  12. Совместимость с Anthropic Claude Messages API (Skills выносятся в поле system).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');
const SKILLS_DIR = path.join(__dirname, '..', '..', 'ai', 'skills');
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

console.log('=== Запуск тестов BKStudio AI Skills (bk0010code, bk0010emt) ===\n');

// 0. Физическая проверка файлов на диске
check('Каталог ai/skills/bk0010code существует', fs.existsSync(path.join(SKILLS_DIR, 'bk0010code', 'SKILL.md')));
check('Каталог ai/skills/bk0010emt существует', fs.existsSync(path.join(SKILLS_DIR, 'bk0010emt', 'SKILL.md')));
check('Каталог ai/skills/bkgraphics существует', fs.existsSync(path.join(SKILLS_DIR, 'bkgraphics', 'SKILL.md')));
check('Файл bk0010code/SKILL.Addressing.md существует', fs.existsSync(path.join(SKILLS_DIR, 'bk0010code', 'SKILL.Addressing.md')));
check('Файл bk0010code/SKILL.Memory.md существует', fs.existsSync(path.join(SKILLS_DIR, 'bk0010code', 'SKILL.Memory.md')));

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
let fetchCount = 0;

const rawSystemMdContent = fs.readFileSync(SYSTEM_MD_PATH, 'utf-8');

function fakeFetch(url, options) {
    fetchCount++;
    lastFetchUrl = String(url);
    lastFetchOptions = options || {};

    if (typeof mockFetchHandler === 'function') {
        const handled = mockFetchHandler(lastFetchUrl, lastFetchOptions);
        if (handled && handled.status !== 404) {
            return Promise.resolve(handled);
        }
    }

    // Чтение system.md
    if (lastFetchUrl.includes('system.md') && !lastFetchUrl.includes('skills')) {
        return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => rawSystemMdContent
        });
    }

    // Чтение файлов Skills
    if (lastFetchUrl.includes('skills')) {
        const m = lastFetchUrl.match(/skills\/([^\/]+)\/(.+)$/);
        if (m) {
            const fp = path.join(SKILLS_DIR, m[1], m[2]);
            if (fs.existsSync(fp)) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    text: async () => fs.readFileSync(fp, 'utf-8')
                });
            }
        }
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
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
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    Promise: Promise,
    Error: Error
};
sandbox.window = sandbox;
sandbox.global = sandbox;

const context = vm.createContext(sandbox);

// Загрузка компонентов
const codeNormalizer = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf-8');
const codeManager = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf-8');
const codeOpenAI = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf-8');
const codeAnthropic = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'anthropic.js'), 'utf-8');

vm.runInContext(codeNormalizer, context);
vm.runInContext(codeOpenAI, context);
vm.runInContext(codeAnthropic, context);
vm.runInContext(codeManager, context);

async function runTests() {
    const bkAI = sandbox.bkAI;

    // 1. Registry API
    check('bkAI.getRegisteredSkills() возвращает массив', Array.isArray(bkAI.getRegisteredSkills()));
    check('Реестр содержит bk0010code', bkAI.getRegisteredSkills().includes('bk0010code'));
    check('Реестр содержит bk0010emt', bkAI.getRegisteredSkills().includes('bk0010emt'));
    check('Реестр содержит bkgraphics', bkAI.getRegisteredSkills().includes('bkgraphics'));
    check('По умолчанию активны скиллы bk0010code, bk0010emt и bkgraphics',
        bkAI.getEnabledSkills().includes('bk0010code') &&
        bkAI.getEnabledSkills().includes('bk0010emt') &&
        bkAI.getEnabledSkills().includes('bkgraphics'));

    // Регистрация нового скилла в реестре (на будущее)
    bkAI.registerSkill('bk0011sound');
    check('Новый Skill успешно регистрируется в реестре', bkAI.getRegisteredSkills().includes('bk0011sound'));
    check('Новый Skill не включается автоматически без явного включения', !bkAI.getEnabledSkills().includes('bk0011sound'));

    bkAI.enableSkill('bk0011sound');
    check('enableSkill активирует скилл', bkAI.getEnabledSkills().includes('bk0011sound'));
    bkAI.disableSkill('bk0011sound');
    check('disableSkill деактивирует скилл', !bkAI.getEnabledSkills().includes('bk0011sound'));

    // 2. Загрузка одиночного Skill (bk0010emt)
    const emtContent = await bkAI.loadSkill('bk0010emt');
    check('loadSkill("bk0010emt") возвращает непустой текст', typeof emtContent === 'string' && emtContent.length > 500);
    check('Содержимое bk0010emt содержит таблицу EMT-функций', emtContent.includes('EMT 16') && emtContent.includes('EMT 20'));

    // 3. Загрузка модульного Skill со связанными документами (bk0010code)
    const codeContent = await bkAI.loadSkill('bk0010code');
    check('loadSkill("bk0010code") загружает основной индекс', codeContent.includes('# Skill: bk0010code'));
    check('loadSkill("bk0010code") подгружает связанный документ SKILL.Addressing.md', codeContent.includes('SKILL.Addressing.md'));
    check('loadSkill("bk0010code") подгружает связанный документ SKILL.Memory.md', codeContent.includes('SKILL.Memory.md'));
    check('loadSkill("bk0010code") подгружает связанный документ SKILL.Optimization.md', codeContent.includes('SKILL.Optimization.md'));
    check('Содержит технические правила К1801ВМ1', codeContent.includes('К1801ВМ1') || codeContent.includes('177600'));

    // 3b. Загрузка специализированного Skill графики БК (bkgraphics)
    const gfxContent = await bkAI.loadSkill('bkgraphics');
    check('loadSkill("bkgraphics") возвращает непустой текст', typeof gfxContent === 'string' && gfxContent.length > 1000);
    check('bkgraphics описывает режимы BK0010_COLOR, BK0010_MONO и BK0011M_COLOR',
        gfxContent.includes('BK0010_COLOR') && gfxContent.includes('BK0010_MONO') && gfxContent.includes('BK0011M_COLOR'));
    check('bkgraphics описывает адрес видеопамяти 040000 и размер 16384 байта',
        gfxContent.includes('040000') && gfxContent.includes('16384'));
    check('bkgraphics описывает палитры БК-0011М и правило индексов цвета 0..3 (не RGB)',
        gfxContent.includes('палитр') && gfxContent.includes('RGB'));
    check('bkgraphics описывает стандартные размеры спрайтов (8x8, 16x16, 24x24, 32x32)',
        gfxContent.includes('16 × 16') || gfxContent.includes('16x16') || gfxContent.includes('8 × 8'));
    check('bkgraphics описывает форматы заставок (.BIN 16388, .DAT 16384, .BKS 16389)',
        gfxContent.includes('.BIN') && gfxContent.includes('16388') && gfxContent.includes('.BKS'));
    check('bkgraphics описывает практические эвристики («нарисуй заставку», «сделай спрайт»)',
        gfxContent.includes('нарисуй заставку') && gfxContent.includes('сделай спрайт'));
    check('bkgraphics НЕ содержит JavaScript кода реализации API (разделение ответственности)',
        !gfxContent.includes('class BKGraphicsAIApi') && !gfxContent.includes('window.bkGraphicsAI'));

    // 4. Кэширование в памяти
    const fetchCountBefore = fetchCount;
    const cachedCodeContent = await bkAI.loadSkill('bk0010code');
    check('Повторный вызов loadSkill использует кэш памяти без сетевых запросов',
        cachedCodeContent === codeContent && fetchCount === fetchCountBefore);

    // 5. Проверка 7: Явная ошибка при невозможности загрузить Skill
    let failedSkillCaught = false;
    let failedSkillError = '';
    try {
        await bkAI.loadSkill('nonexistent_skill_xyz');
    } catch (e) {
        failedSkillCaught = true;
        failedSkillError = e.message;
    }
    check('При отсутствии Skill выбрасывается явная ошибка', failedSkillCaught);
    check('Ошибка содержит имя отсутствующего Skill и путь',
        failedSkillError.includes('nonexistent_skill_xyz') && failedSkillError.includes('SKILL.md'));

    // 6. Проверка 1 & 2: Структура messages при обычном запросе AI
    let capturedPayload = null;
    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/chat/completions')) {
            capturedPayload = JSON.parse(opts.body);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    choices: [{ message: { role: 'assistant', content: 'Ответ модели' } }]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    bkAI.setConfig({ provider: 'openai', apiKey: 'sk-test' });

    const chatResponse = await bkAI.chat({
        prompt: 'Как вывести символ на экран в БК-0010?'
    });

    check('Запрос chat() завершился успехом', chatResponse && chatResponse.type === 'text');
    check('Исходящий payload содержит ровно 2 сообщения (system, user)', capturedPayload.messages.length === 2);

    const sysMsg = capturedPayload.messages[0];
    const userMsg = capturedPayload.messages[1];

    check('Первое сообщение имеет role: "system"', sysMsg.role === 'system');
    check('Второе сообщение имеет role: "user"', userMsg.role === 'user');

    // Проверка 1: Порядок контекста в system: system.md -> Skills -> project context
    const sysText = sysMsg.content;
    const systemMdIdx = sysText.indexOf('BKStudio AI Assistant');
    const skillsIdx = sysText.indexOf('Specialized Skills Knowledge Base');
    const bkCodeIdx = sysText.indexOf('Skill: bk0010code');
    const bkEmtIdx = sysText.indexOf('Skill: bk0010emt');
    const bkGfxIdx = sysText.indexOf('bkgraphics');

    check('system.md находится в начале системного промпта', systemMdIdx !== -1);
    check('Skills context расположен после system.md', skillsIdx > systemMdIdx);
    check('bk0010code включён в Skills context', bkCodeIdx > skillsIdx);
    check('bk0010emt включён в Skills context', bkEmtIdx > skillsIdx);
    check('bkgraphics включён в Skills context', bkGfxIdx > skillsIdx);

    // Проверка 2: Содержимое всех Skills действительно присутствует в запросе
    check('Содержимое bk0010code присутствует (таблица адресации и опкоды)',
        sysText.includes('SKILL.Addressing.md') && sysText.includes('Регистровый'));
    check('Содержимое bk0010emt присутствует (вызовы EMT)',
        sysText.includes('EMT 16') && sysText.includes('EMT 20'));
    check('Содержимое bkgraphics присутствует (режимы и видеопамять 040000)',
        sysText.includes('BK0010_COLOR') && sysText.includes('040000'));

    // Проверка 3: Skills не попадают в пользовательское сообщение
    check('Пользовательское сообщение содержит ТОЛЬКО запрос пользователя',
        userMsg.content === 'Как вывести символ на экран в БК-0010?');
    check('Пользовательское сообщение НЕ содержит текста Skills',
        !userMsg.content.includes('SKILL') && !userMsg.content.includes('EMT 16'));

    // 7. Проверка 4: При нескольких сообщениях диалога Skills не дублируются
    const multiTurnMessages = [
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Привет! Чем помочь по БК?' },
        { role: 'user', content: 'Расскажи про EMT 30' }
    ];

    await bkAI.chat({ messages: multiTurnMessages });

    check('В многошаговом диалоге первое сообщение — единственное system',
        capturedPayload.messages[0].role === 'system' &&
        capturedPayload.messages.filter(m => m.role === 'system').length === 1);

    const occurrencesOfSkillsHeader = (capturedPayload.messages[0].content.match(/# Specialized Skills Knowledge Base/g) || []).length;
    check('Skills контекст не дублируется внутри системного сообщения (ровно 1 раз)', occurrencesOfSkillsHeader === 1);

    check('Сообщения истории следуют за system в неизменном порядке',
        capturedPayload.messages.length === 4 &&
        capturedPayload.messages[1].content === 'Привет' &&
        capturedPayload.messages[2].content === 'Привет! Чем помочь по БК?' &&
        capturedPayload.messages[3].content === 'Расскажи про EMT 30');

    // 8. Проверка 5: Совместимость с Agent и tool calling
    const agentMessages = [
        { role: 'user', content: 'Проверь код' },
        {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'project.list_files', arguments: '{}' } }]
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"files":["main.asm"]}' }
    ];

    await bkAI.chat({
        messages: agentMessages,
        systemPrompt: 'Ты AI-агент, выполняющий задачу step-by-step.'
    });

    check('Запрос агента содержит system с system.md, Skills и инструкцией агента',
        capturedPayload.messages[0].role === 'system' &&
        capturedPayload.messages[0].content.includes('Specialized Skills Knowledge Base') &&
        capturedPayload.messages[0].content.includes('Ты AI-агент, выполняющий задачу step-by-step.'));

    check('В истории агента сохраняются роли assistant и tool без загрязнения текстом Skills',
        capturedPayload.messages[2].role === 'assistant' &&
        capturedPayload.messages[3].role === 'tool' &&
        !capturedPayload.messages[3].content.includes('SKILL'));

    // 9. Проверка 6: Совместимость со стримингом
    let streamedTokens = '';
    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/chat/completions')) {
            const sseStream = [
                'data: {"choices":[{"delta":{"content":"Первый "}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"второй токен"}}]}\n\n',
                'data: [DONE]\n\n'
            ].join('');

            return {
                ok: true,
                status: 200,
                headers: { get: () => 'text/event-stream' },
                text: async () => sseStream,
                body: {
                    getReader: () => {
                        const chunks = [
                            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Первый "}}]}\n\n'),
                            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"второй токен"}}]}\n\n'),
                            new TextEncoder().encode('data: [DONE]\n\n')
                        ];
                        let i = 0;
                        return {
                            read: async () => {
                                if (i < chunks.length) {
                                    return { done: false, value: chunks[i++] };
                                }
                                return { done: true, value: undefined };
                            }
                        };
                    }
                }
            };
        }
        return { ok: false, status: 404 };
    };

    const streamResult = await bkAI.chat({
        prompt: 'Стриминг тест',
        stream: true,
        onChunk: (chunk) => {
            const token = typeof chunk === 'object' ? chunk.delta : chunk;
            streamedTokens += token;
        }
    });

    check('Стриминг завершился успешно', streamResult && streamResult.type === 'text');
    check('Токены стриминга получены без искажений', streamedTokens === 'Первый второй токен');

    // 10. Проверка совместимости с Anthropic Claude Messages API
    let capturedAnthropicPayload = null;
    mockFetchHandler = (url, opts) => {
        if (url.endsWith('/messages')) {
            capturedAnthropicPayload = JSON.parse(opts.body);
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({
                    content: [{ type: 'text', text: 'Anthropic ответ' }]
                })
            };
        }
        return { ok: false, status: 404 };
    };

    bkAI.setConfig({ provider: 'anthropic', apiKey: 'sk-ant-test' });

    await bkAI.chat({ prompt: 'Команда MTPS на БК0010' });

    check('Anthropic запрос отправлен', capturedAnthropicPayload !== null);
    check('Anthropic payload содержит поле system со Skills',
        typeof capturedAnthropicPayload.system === 'string' &&
        capturedAnthropicPayload.system.includes('BKStudio AI Assistant') &&
        capturedAnthropicPayload.system.includes('Specialized Skills Knowledge Base') &&
        capturedAnthropicPayload.system.includes('Skill: bk0010code'));
    check('В массиве messages Anthropic нет role: "system"',
        !capturedAnthropicPayload.messages.some(m => m.role === 'system'));
    check('В массиве messages Anthropic только пользовательский запрос',
        capturedAnthropicPayload.messages.length === 1 &&
        capturedAnthropicPayload.messages[0].role === 'user');

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
