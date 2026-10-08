#!/usr/bin/env node
/**
 * BKStudio - Сквозной тест AI-агента (js/bk-ai-agent.js) с провайдером Anthropic
 *
 * Проверяет:
 *   - Агент не сокращает историю для провайдера Anthropic (keepFullAgentHistory);
 *   - После многих шагов в запрос попадают все ходы с исходными thinking-блоками и подписями;
 *   - Сообщения строго чередуются (user / assistant), tool_result ссылаются на свои tool_use;
 *   - Для провайдеров без keepFullAgentHistory история по-прежнему сокращается.
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

const fakeStorage = {};
const fakeLocalStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(fakeStorage, k) ? fakeStorage[k] : null),
    setItem: (k, v) => { fakeStorage[k] = String(v); },
    removeItem: (k) => { delete fakeStorage[k]; },
    clear: () => { for (const k in fakeStorage) delete fakeStorage[k]; }
};

const mockProject = {
    files: { 'main.asm': 'START:\n  MOV #100, R0\n  HALT' },
    activeFileName: 'main.asm',
    settings: { platform: 'BK-0010', startAddress: '1000' },
    getAllFiles() { return Object.assign({}, this.files); },
    getFileContent(name) { return this.files[name] || ''; },
    setFileContent(name, content) { this.files[name] = content; }
};

let interceptedRequests = [];
let mockFetchHandler = null;

function fakeFetch(url, options) {
    // Загрузка системного промпта и навыков BKStudio (ai/*.md)
    if (!String(url).endsWith('/messages')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => 'System prompt' });
    }
    interceptedRequests.push({ url: String(url), options: options || {} });
    return Promise.resolve(mockFetchHandler(String(url), options || {}));
}

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    bkProject: mockProject,
    AbortController: AbortController,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    TextDecoder: TextDecoder,
    fetch: fakeFetch
};
sandbox.window = sandbox;
sandbox.global = sandbox;
const context = vm.createContext(sandbox);

for (const file of [
    'bk-ai-normalizer.js',
    'bk-ai-context.js',
    'bk-ai-manager.js',
    path.join('bk-ai-providers', 'openai-compatible.js'),
    path.join('bk-ai-providers', 'anthropic.js'),
    'bk-ai-tools.js',
    'bk-ai-agent.js'
]) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf-8'), context, { filename: file });
}

const TOOL_STEPS = 6;

/** Ответ модели: thinking + tool_use на шагах 1..TOOL_STEPS, затем финальный текст */
function anthropicStepResponse(step) {
    const content = step <= TOOL_STEPS
        ? [
            { type: 'thinking', thinking: '', signature: `sig-${step}` },
            { type: 'text', text: `Шаг ${step}` },
            { type: 'tool_use', id: `toolu_${step}`, name: 'project__list_files', input: {} }
        ]
        : [{ type: 'text', text: 'Задача выполнена.' }];
    return {
        ok: true,
        status: 200,
        json: async () => ({
            id: `msg_${step}`,
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: content,
            stop_reason: step <= TOOL_STEPS ? 'tool_use' : 'end_turn'
        })
    };
}

async function runTests() {
    console.log('=== Тест AI-агента с провайдером Anthropic ===\n');

    const bkAI = context.bkAI;
    const agent = context.bkAIAgent;

    check('Провайдер Anthropic объявляет keepFullAgentHistory',
        context.bkAnthropicProvider.keepFullAgentHistory === true);
    check('OpenAI-compatible провайдер не объявляет keepFullAgentHistory',
        !context.bkOpenAICompatibleProvider.keepFullAgentHistory);

    // 1. Агент с Anthropic: полная история и thinking-блоки на каждом шаге
    bkAI.applyProfile('anthropic');
    bkAI.setConfig({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' });

    interceptedRequests = [];
    mockFetchHandler = () => anthropicStepResponse(interceptedRequests.length);

    const result = await agent.run({
        prompt: 'Посмотри файлы проекта',
        autoApproveAll: true,
        maxIterations: TOOL_STEPS + 2
    });

    check('Агент завершил задачу', result.stoppedReason === 'completed' && result.text === 'Задача выполнена.');
    check(`Выполнено ${TOOL_STEPS} вызовов инструментов`, result.toolCallsCount === TOOL_STEPS);
    check(`Отправлено ${TOOL_STEPS + 1} запросов`, interceptedRequests.length === TOOL_STEPS + 1);

    const lastBody = JSON.parse(interceptedRequests[interceptedRequests.length - 1].options.body);
    const msgs = lastBody.messages;

    check('Последний запрос содержит всю историю (задача + все шаги)', msgs.length === 1 + TOOL_STEPS * 2);
    check('Первое сообщение — исходная задача пользователя',
        msgs[0].role === 'user' && msgs[0].content === 'Посмотри файлы проекта');
    check('Сообщения строго чередуются user / assistant',
        msgs.every((m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')));

    const assistantTurns = msgs.filter(m => m.role === 'assistant');
    check('Каждый ход ассистента отправлен с исходным thinking-блоком и подписью',
        assistantTurns.length === TOOL_STEPS &&
        assistantTurns.every((m, i) => Array.isArray(m.content) &&
            m.content[0].type === 'thinking' && m.content[0].signature === `sig-${i + 1}`));
    check('Каждый tool_result ссылается на tool_use предыдущего хода',
        msgs.slice(2).filter(m => m.role === 'user').every((m, i) =>
            Array.isArray(m.content) && m.content[0].type === 'tool_result' &&
            m.content[0].tool_use_id === `toolu_${i + 1}`));

    // 2. Провайдер без keepFullAgentHistory: история сокращается, как и раньше
    const prunedCalls = [];
    const originalChat = bkAI.chat;
    bkAI.chat = async (opts) => {
        prunedCalls.push(opts.messages.length);
        const step = prunedCalls.length;
        if (step <= TOOL_STEPS) {
            return { text: '', toolCalls: [{ id: `call_${step}`, name: 'project.list_files', arguments: {} }] };
        }
        return { text: 'Готово.' };
    };
    bkAI.applyProfile('openai');

    await agent.run({ prompt: 'Посмотри файлы', autoApproveAll: true, maxIterations: TOOL_STEPS + 2 });
    bkAI.chat = originalChat;

    check('Для OpenAI-compatible провайдера история сокращается до 4 ходов',
        prunedCalls[prunedCalls.length - 1] === 1 + 4 * 2);

    console.log(`\nИтог: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Непредвиденная ошибка в runTests:', err);
    process.exit(1);
});
