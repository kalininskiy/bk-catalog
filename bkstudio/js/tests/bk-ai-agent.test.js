#!/usr/bin/env node
/**
 * BKStudio - Тесты автономного AI-агента (js/bk-ai-agent.js)
 *
 * Проверяет:
 *   - Создание класса BKAIAgent и синглтона bkAIAgent;
 *   - Интеграцию с window.bkAI (getAgent(), runAgent());
 *   - Лимит итераций: начальное значение 10, остановка при достижении лимита;
 *   - Прозрачность: вызов каждого инструмента регистрируется через onToolCall и onToolResult;
 *   - Определение опасных инструментов (write_file, create_file, delete_file, emulator.run, reset);
 *   - Безопасные инструменты без подтверждения (read_file, get_diagnostics, get_registers и др.);
 *   - Механизм подтверждения пользователя (разрешение / отклонение опасного действия);
 *   - Остановку по AbortSignal;
 *   - Отсутствие вызовов eval() и безопасность среды.
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

// Песочница
const fakeStorage = {};
const fakeLocalStorage = {
    getItem: (k) => fakeStorage[k] || null,
    setItem: (k, v) => { fakeStorage[k] = String(v); },
    removeItem: (k) => { delete fakeStorage[k]; },
    clear: () => { for (const k in fakeStorage) delete fakeStorage[k]; }
};

class MockProjectManager {
    constructor() {
        this.files = {
            'main.asm': 'START:\n  MOV #100, R0\n  HALT'
        };
        this.activeFileName = 'main.asm';
        this.settings = { platform: 'BK-0010', startAddress: '1000' };
    }
    getAllFiles() { return Object.assign({}, this.files); }
    getFileContent(name) { return this.files[name] || ''; }
    setFileContent(name, content) { this.files[name] = content; }
    createFile(name, content = '') {
        if (this.files[name]) return false;
        this.files[name] = content;
        return true;
    }
    deleteFile(name) {
        if (!this.files[name]) return false;
        delete this.files[name];
        return true;
    }
}

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    bkProject: new MockProjectManager(),
    AbortController: AbortController,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
};
sandbox.window = sandbox;
sandbox.global = sandbox;

const context = vm.createContext(sandbox);

// Подключаем модули
const codeNormalizer = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf-8');
const codeContext = fs.readFileSync(path.join(JS_DIR, 'bk-ai-context.js'), 'utf-8');
const codeManager = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf-8');
const codeTools = fs.readFileSync(path.join(JS_DIR, 'bk-ai-tools.js'), 'utf-8');
const codeAgent = fs.readFileSync(path.join(JS_DIR, 'bk-ai-agent.js'), 'utf-8');

vm.runInContext(codeNormalizer, context);
vm.runInContext(codeContext, context);
vm.runInContext(codeManager, context);
vm.runInContext(codeTools, context);
vm.runInContext(codeAgent, context);

async function runTests() {
    console.log('=== Запуск тестов BKStudio Autonomous AI Agent (js/bk-ai-agent.js) ===\n');

    const agent = context.bkAIAgent;
    const bkAI = context.bkAI;

    // 1. Инициализация и доступность
    check('Класс BKAIAgent объявлен', typeof context.BKAIAgent === 'function');
    check('Синглтон window.bkAIAgent создан', typeof agent === 'object' && agent !== null);
    check('bkAI.getAgent() возвращает агента', bkAI.getAgent() === agent);
    check('bkAI.runAgent() доступна', typeof bkAI.runAgent === 'function');
    check('Начальный лимит итераций по умолчанию равен 10', agent.defaultMaxIterations === 10);

    // 2. Проверка опасных и безопасных действий
    check('project.write_file требует подтверждения', agent.requiresConfirmation('project.write_file') === true);
    check('project.create_file требует подтверждения', agent.requiresConfirmation('project.create_file') === true);
    check('project.delete_file требует подтверждения', agent.requiresConfirmation('project.delete_file') === true);
    check('emulator.run требует подтверждения', agent.requiresConfirmation('emulator.run') === true);
    check('emulator.reset требует подтверждения', agent.requiresConfirmation('emulator.reset') === true);

    check('project.read_file НЕ требует подтверждения', agent.requiresConfirmation('project.read_file') === false);
    check('project.list_files НЕ требует подтверждения', agent.requiresConfirmation('project.list_files') === false);
    check('build.get_diagnostics НЕ требует подтверждения', agent.requiresConfirmation('build.get_diagnostics') === false);
    check('build.get_listing НЕ требует подтверждения', agent.requiresConfirmation('build.get_listing') === false);
    check('debug.get_registers НЕ требует подтверждения', agent.requiresConfirmation('debug.get_registers') === false);

    // 3. Безопасность: отсутствие eval
    check('Код bk-ai-agent.js не содержит eval()', !codeAgent.includes('eval('));

    // 4. Простой запуск: модель сразу отвечает текстом без вызова инструментов
    bkAI.chat = async () => ({
        type: 'text',
        text: 'Код на PDP-11 корректен.'
    });

    const simpleRes = await agent.run({
        prompt: 'Проверь код'
    });
    check('Агент завершается на шаге 1 если инструменты не требуются', simpleRes.iterations === 1);
    check('Возвращен итоговый ответ', simpleRes.text === 'Код на PDP-11 корректен.');
    check('toolCallsCount равен 0', simpleRes.toolCallsCount === 0);

    // 5. Агентный цикл с безопасным инструментом:
    // Шаг 1: LLM вызывает project.read_file
    // Шаг 2: LLM получает содержимое файла и выдает итоговый ответ
    let stepCount = 0;
    const toolCallsObserved = [];
    const toolResultsObserved = [];

    let chatRound = 0;
    bkAI.chat = async (opts) => {
        chatRound++;
        if (chatRound === 1) {
            return {
                type: 'text',
                text: 'Сначала я прочитаю файл main.asm.',
                toolCalls: [
                    { id: 'c1', name: 'project.read_file', arguments: { path: 'main.asm' } }
                ]
            };
        }
        return {
            type: 'text',
            text: 'Я изучил файл: программа содержит инструкцию MOV #100, R0 и завершается по HALT.'
        };
    };

    const multiRes = await agent.run({
        prompt: 'Что делает программа в main.asm?',
        onStep: ({ iteration }) => { stepCount = iteration; },
        onToolCall: (tc) => { toolCallsObserved.push(tc); },
        onToolResult: (tr) => { toolResultsObserved.push(tr); }
    });

    check('Агент выполнил 2 шага (инструмент + финальный ответ)', multiRes.iterations === 2);
    check('onStep вызван для каждого шага', stepCount === 2);
    check('onToolCall зафиксировал project.read_file', toolCallsObserved.length === 1 && toolCallsObserved[0].name === 'project.read_file');
    check('requiresConfirmation для read_file равен false', toolCallsObserved[0].requiresConfirmation === false);
    check('onToolResult вернул содержимое файла', toolResultsObserved.length === 1 && toolResultsObserved[0].result.content.includes('MOV #100, R0'));
    check('Финальный ответ содержит анализ', multiRes.text.includes('MOV #100, R0'));

    // 6. Подтверждение опасного действия: случай ОТКЛОНЕНИЯ пользователем
    chatRound = 0;
    bkAI.chat = async () => {
        chatRound++;
        if (chatRound === 1) {
            return {
                type: 'text',
                text: 'Я перезапишу файл main.asm.',
                toolCalls: [
                    { id: 'c2', name: 'project.write_file', arguments: { path: 'main.asm', content: 'MALICIOUS_CODE' } }
                ]
            };
        }
        return {
            type: 'text',
            text: 'Пользователь отменил изменение, файл остался нетронутым.'
        };
    };

    let confirmationRequested = false;
    await agent.run({
        prompt: 'Замени код',
        onRequestConfirmation: async (tc) => {
            confirmationRequested = true;
            check('onRequestConfirmation вызван для опасного действия project.write_file', tc.name === 'project.write_file');
            return false; // Пользователь отклонил
        }
    });

    check('Запрос на подтверждение был вызван', confirmationRequested === true);
    check('Файл в проекте НЕ был изменен после отклонения', context.bkProject.getFileContent('main.asm').includes('MOV #100, R0'));

    // 7. Подтверждение опасного действия: случай РАЗРЕШЕНИЯ пользователем
    chatRound = 0;
    bkAI.chat = async () => {
        chatRound++;
        if (chatRound === 1) {
            return {
                type: 'text',
                text: 'Записываю исправленный код.',
                toolCalls: [
                    { id: 'c3', name: 'project.write_file', arguments: { path: 'main.asm', content: 'START:\n  NOP\n  HALT' } }
                ]
            };
        }
        return {
            type: 'text',
            text: 'Файл успешно обновлен.'
        };
    };

    await agent.run({
        prompt: 'Исправь код',
        onRequestConfirmation: async () => true // Пользователь подтвердил
    });

    check('После подтверждения файл в проекте успешно обновлен', context.bkProject.getFileContent('main.asm') === 'START:\n  NOP\n  HALT');

    // 8. Лимит итераций: остановка при достижении лимита
    // Симулируем бесконечный цикл вызовов инструментов моделью
    bkAI.chat = async () => ({
        type: 'text',
        text: 'Продолжаю бесконечный поиск...',
        toolCalls: [
            { id: 'loop', name: 'project.list_files', arguments: {} }
        ]
    });

    const limitRes = await agent.run({
        prompt: 'Ищи бесконечно',
        maxIterations: 4 // Лимит 4 шага
    });

    check('Агент остановился ровно на лимите шагов (4)', limitRes.iterations === 4);
    check('Причина остановки: iteration_limit', limitRes.stoppedReason === 'iteration_limit');
    check('Текст ответа сообщает о достижении лимита итераций', limitRes.text.includes('лимит итераций'));

    // 9. Остановка по AbortSignal
    const ac = new AbortController();
    ac.abort();

    let abortCaught = false;
    try {
        await agent.run({
            prompt: 'Срочный стоп',
            signal: ac.signal
        });
    } catch (err) {
        if (err.name === 'AbortError') {
            abortCaught = true;
        }
    }
    check('Агент прерывается при отмене сигнала AbortSignal', abortCaught === true);

    // 10. Готовый сценарий агента: "Исправь ошибку сборки" (runFixBuildScenario)
    check('Метод agent.runFixBuildScenario является функцией', typeof agent.runFixBuildScenario === 'function');
    check('Метод bkAI.runFixBuildScenario экспортирован в глобальный bkAI', typeof bkAI.runFixBuildScenario === 'function');

    // Настраиваем проект и компиляцию с ошибкой
    context.bkProject.setFileContent('main.asm', 'START:\n  INVALID_OPCODE\n  HALT');
    context.bkProject.setFileContent('other.asm', '; Другой файл проекта\n  RET');

    // Мок функций компиляции в sandbox
    let compileAttempts = 0;
    sandbox.compileProject = async () => {
        compileAttempts++;
        if (compileAttempts === 1) {
            // Первая сборка завершается с ошибкой
            return {
                success: false,
                errors: ['main.asm:2: Неизвестная команда INVALID_OPCODE']
            };
        }
        // Повторная сборка после исправления успешна
        return {
            success: true,
            loadAddress: 0o1000,
            programLength: 10,
            errors: []
        };
    };

    // Настраиваем диагностику
    sandbox.monacoMarkers = [
        { file: 'main.asm', line: 2, column: 3, message: 'Неизвестная команда INVALID_OPCODE', severity: 8 }
    ];

    let filesRead = [];
    let scenarioConfirmationAsked = false;
    let scenarioStep = 0;

    bkAI.chat = async (options) => {
        scenarioStep++;
        if (scenarioStep === 1) {
            // Шаг 1: получение информации о проекте
            return {
                type: 'text',
                text: 'Получаю настройки текущего проекта...',
                toolCalls: [
                    { id: 'sc_1', name: 'project.get_project_info', arguments: {} }
                ]
            };
        }
        if (scenarioStep === 2) {
            // Шаг 2: запуск компиляции
            return {
                type: 'text',
                text: 'Запускаю компиляцию проекта...',
                toolCalls: [
                    { id: 'sc_2', name: 'build.compile', arguments: {} }
                ]
            };
        }
        if (scenarioStep === 3) {
            // Шаг 3: получение диагностики ошибок
            return {
                type: 'text',
                text: 'Обнаружена ошибка компиляции. Запрашиваю точные диагностические сообщения...',
                toolCalls: [
                    { id: 'sc_3', name: 'build.get_diagnostics', arguments: {} }
                ]
            };
        }
        if (scenarioStep === 4) {
            // Шаг 4: читаем ТОЛЬКО проблемный файл main.asm
            return {
                type: 'text',
                text: 'Диагностика указывает на main.asm (строка 2). Читаю только проблемный файл...',
                toolCalls: [
                    { id: 'sc_4', name: 'project.read_file', arguments: { path: 'main.asm' } }
                ]
            };
        }
        if (scenarioStep === 5) {
            // Шаг 5: запись исправленного кода (требует подтверждения)
            return {
                type: 'text',
                text: 'Неверная мнемоника INVALID_OPCODE заменена на NOP. Записываю исправление в main.asm...',
                toolCalls: [
                    {
                        id: 'sc_5',
                        name: 'project.write_file',
                        arguments: {
                            path: 'main.asm',
                            content: 'START:\n  NOP\n  HALT'
                        }
                    }
                ]
            };
        }
        if (scenarioStep === 6) {
            // Шаг 6: повторная компиляция
            return {
                type: 'text',
                text: 'Файл обновлен. Повторно запускаю компиляцию для проверки...',
                toolCalls: [
                    { id: 'sc_6', name: 'build.compile', arguments: {} }
                ]
            };
        }
        // Шаг 7: финальный ответ пользователю с итогом
        return {
            type: 'text',
            text: 'Итог: Ошибка сборки успешно устранена! Неверная мнемоника в строке 2 main.asm заменена на NOP. Повторная компиляция прошла успешно (длина программы: 10 байт).'
        };
    };

    const scenarioResult = await agent.runFixBuildScenario({
        onToolCall: (tc) => {
            if (tc.name === 'project.read_file') {
                filesRead.push(tc.arguments.path);
            }
        },
        onRequestConfirmation: async (tc) => {
            if (tc.name === 'project.write_file') {
                scenarioConfirmationAsked = true;
            }
            return true; // Подтверждаем запись
        }
    });

    check('Сценарий завершился успешно', scenarioResult.success === true);
    check('Компиляция была вызвана как минимум дважды (исходная и контрольная)', compileAttempts >= 2);
    check('Было запрошено подтверждение пользователя перед записью файла', scenarioConfirmationAsked === true);
    check('Агент прочитал только проблемный файл main.asm (не весь проект)', filesRead.includes('main.asm') && !filesRead.includes('other.asm'));
    check('Файл main.asm в BKProjectManager был корректно обновлен', context.bkProject.getFileContent('main.asm').includes('NOP'));
    check('Итоговое сообщение содержит отчет об успешном устранении ошибки', scenarioResult.text.includes('устранена') && scenarioResult.text.includes('main.asm'));

    // 10. Тест: Извлечение XML-style тегов <tool_call>
    const xmlCalls = agent.extractToolCalls({
        text: 'План действий:\n<tool_call>{"name": "project.list_files", "arguments": {"includeArtifacts": false}}</tool_call>'
    });
    check('extractToolCalls извлекает вызовы из тегов <tool_call>', xmlCalls.length === 1 && xmlCalls[0].name === 'project.list_files');
    check('extractToolCalls парсит аргументы из <tool_call>', xmlCalls[0].arguments.includeArtifacts === false);

    // 11. Тест: Автоматическое продолжение агента при обрыве ответа из-за finish_reason: 'length'
    let truncationChatCalls = 0;
    bkAI.chat = async (options) => {
        truncationChatCalls++;
        if (truncationChatCalls === 1) {
            // Имитируем обрыв ответа на середине фразы из-за лимита токенов max_tokens
            return {
                type: 'text',
                text: 'Вижу три ошибки в программе. Исправляю программу:',
                finishReason: 'length',
                raw: { choices: [{ finish_reason: 'length' }] }
            };
        }
        if (truncationChatCalls === 2) {
            // Модель после подсказки продолжить сразу вызывает инструмент
            return {
                type: 'tool_call',
                toolCalls: [
                    { id: 'trunc_tool', name: 'project.list_files', arguments: {} }
                ]
            };
        }
        // Финальный ответ
        return {
            type: 'text',
            text: 'Программа успешно исправлена и проверена!'
        };
    };

    let truncationPromptNoticed = false;
    const truncationResult = await agent.run({
        prompt: 'Исправь ошибки в программе',
        maxIterations: 5,
        onThought: (thought) => {
            if (thought.includes('Ответ модели был прерван') || thought.includes('max_tokens')) {
                truncationPromptNoticed = true;
            }
        }
    });

    check('Агент не завершился на шаге с finish_reason: length', truncationChatCalls >= 3);
    check('Агент уведомил пользователя об обрыве токенов', truncationPromptNoticed === true);
    check('Агент успешно завершил задачу после автопродолжения', truncationResult.success === true && truncationResult.stoppedReason === 'completed');

    // 13. Режим "Разрешать всё (в этой сессии)" (autoApproveAll)
    const autoAgent = new context.BKAIAgent();
    check('По умолчанию autoApproveAll равен false', autoAgent.isAutoApproveAll() === false);
    check('project.write_file требует подтверждения при autoApproveAll = false', autoAgent.requiresConfirmation('project.write_file') === true);

    autoAgent.setAutoApproveAll(true);
    check('setAutoApproveAll(true) включает флаг', autoAgent.isAutoApproveAll() === true);
    check('requiresConfirmation возвращает false при активном autoApproveAll', autoAgent.requiresConfirmation('project.write_file') === false);

    let confirmPromptCalled = false;

    context.bkAI.chat = async ({ messages }) => {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user' && !messages.some(m => m.role === 'tool')) {
            return {
                type: 'text',
                text: 'Записываю файл без запроса подтверждения',
                toolCalls: [
                    { id: 'auto_tc_1', name: 'project.write_file', arguments: { path: 'main.asm', content: 'AUTO_APPROVED_CODE' } }
                ]
            };
        }
        return {
            type: 'text',
            text: 'Файл успешно записан автоматически.'
        };
    };

    const autoResult = await autoAgent.run({
        prompt: 'Запиши main.asm',
        maxIterations: 5,
        onRequestConfirmation: async () => {
            confirmPromptCalled = true;
            return false;
        }
    });

    check('onRequestConfirmation НЕ вызывается при autoApproveAll = true', confirmPromptCalled === false);
    check('Файл был записан напрямую в проект', context.bkProject.getFileContent('main.asm') === 'AUTO_APPROVED_CODE');
    check('Агент успешно завершил работу при авто-разрешении', autoResult.success === true);

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
