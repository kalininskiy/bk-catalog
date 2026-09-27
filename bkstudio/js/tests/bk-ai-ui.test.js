#!/usr/bin/env node
/**
 * BKStudio - Тесты интерфейса AI-панели (js/bk-ai-ui.js)
 *
 * Проверяет:
 *   - Создание класса BKAIPanel и глобального объекта window.bkAIUI;
 *   - Переключение вкладок [Эмулятор] / [AI Ассистент];
 *   - Выбор провайдера/профиля и синхронизацию с window.bkAI;
 *   - Выбор и изменение модели (model);
 *   - Изменение базового URL (baseUrl);
 *   - Ввод и сохранение API ключа (apiKey);
 *   - Проверку соединения через bkAI.testConnection();
 *   - Быстрые действия: Объясни (Explain), Исправь (Fix), Создай (Generate);
 *   - Очистку истории сообщений;
 *   - Отправку запроса и стриминг ответа (onChunk);
 *   - Остановку генерации по кнопке "Стоп" (AbortController);
 *   - Изоляцию: UI обращается ТОЛЬКО к window.bkAI (без прямых вызовов fetch к OpenAI/Anthropic).
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

// Создаем легковесный DOM Mock для тестирования
class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(cls) { this.classes.add(cls); }
    remove(cls) { this.classes.delete(cls); }
    contains(cls) { return this.classes.has(cls); }
    toggle(cls, force) {
        if (force === undefined) {
            if (this.classes.has(cls)) this.classes.delete(cls);
            else this.classes.add(cls);
        } else if (force) {
            this.classes.add(cls);
        } else {
            this.classes.delete(cls);
        }
    }
}

class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.classList = new MockClassList();
        this.attributes = {};
        this.listeners = {};
        this.value = '';
        this.textContent = '';
        this._innerHTML = '';
        this.disabled = false;
    }

    get innerHTML() {
        return this._innerHTML || '';
    }
    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        if (!html) return;
        const tagRegex = /<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tagName = match[1];
            const attrs = match[2];
            const inner = match[3];
            const el = new MockElement(tagName);
            const classMatch = attrs.match(/class=["']([^"']+)["']/i);
            if (classMatch) {
                el.className = classMatch[1];
            }
            if (inner.includes('<')) {
                el.innerHTML = inner;
            } else {
                el.textContent = inner;
            }
            this.appendChild(el);
        }
    }

    get className() {
        return Array.from(this.classList.classes).join(' ');
    }
    set className(val) {
        this.classList.classes.clear();
        if (val) {
            val.trim().split(/\s+/).forEach(c => this.classList.add(c));
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    querySelector(selector) {
        // Простой поиск по классу
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            for (const child of this.children) {
                if (child.classList && child.classList.contains(cls)) return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
        }
        return null;
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    dispatchEvent(event) {
        const handlers = this.listeners[event.type] || [];
        for (const h of handlers) {
            h(event);
        }
    }

    click() {
        this.dispatchEvent({ type: 'click', target: this });
    }

    change() {
        this.dispatchEvent({ type: 'change', target: this });
    }

    focus() {}
    setSelectionRange() {}
}

const elementsById = {};
function getOrCreateElement(id, tagName = 'div') {
    if (!elementsById[id]) {
        elementsById[id] = new MockElement(tagName, id);
    }
    return elementsById[id];
}

const fakeDocument = {
    readyState: 'complete',
    getElementById: (id) => elementsById[id] || null,
    createElement: (tag) => new MockElement(tag),
    addEventListener: () => {}
};

// Подготавливаем элементы DOM согласно index.html
const idsToCreate = [
    ['tab-btn-emulator', 'button'],
    ['tab-btn-ai', 'button'],
    ['emulator-view', 'div'],
    ['ai-view', 'div'],
    ['emulator-header-actions', 'div'],
    ['btn-ai-assistant', 'button'],
    ['ai-profile-select', 'select'],
    ['ai-model-input', 'input'],
    ['ai-baseurl-input', 'input'],
    ['ai-apikey-input', 'input'],
    ['ai-btn-toggle-settings', 'button'],
    ['ai-settings-drawer', 'div'],
    ['ai-btn-test-connection', 'button'],
    ['ai-connection-status', 'span'],
    ['ai-action-explain', 'button'],
    ['ai-action-fix', 'button'],
    ['ai-action-fix-build', 'button'],
    ['ai-action-generate', 'button'],
    ['ai-btn-clear', 'button'],
    ['ai-messages', 'div'],
    ['ai-prompt-input', 'textarea'],
    ['ai-btn-send', 'button'],
    ['ai-btn-stop', 'button'],
    ['ai-mode-chat', 'button'],
    ['ai-mode-agent', 'button'],
    ['ai-step-indicator', 'div'],
    ['ai-auto-approve-badge', 'button'],
    ['ai-auto-approve-session', 'input'],
    ['ai-max-iterations-input', 'input'],
    ['ai-maxtokens-input', 'input']
];

for (const [id, tag] of idsToCreate) {
    getOrCreateElement(id, tag);
}

// Mock localStorage
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => {
        for (const k in storage) delete storage[k];
    }
};

// Подготовка песочницы VM
const sandbox = {
    console: console,
    document: fakeDocument,
    localStorage: fakeLocalStorage,
    AbortController: AbortController,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    fetch: () => {
        throw new Error('fetch не должен вызываться из UI напрямую!');
    }
};
sandbox.window = sandbox;
sandbox.global = sandbox;

const context = vm.createContext(sandbox);

// Загружаем зависимости BKAI
const codeNormalizer = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf-8');
const codeContext = fs.readFileSync(path.join(JS_DIR, 'bk-ai-context.js'), 'utf-8');
const codeManager = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf-8');
const codeOpenAI = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'openai-compatible.js'), 'utf-8');
const codeAnthropic = fs.readFileSync(path.join(JS_DIR, 'bk-ai-providers', 'anthropic.js'), 'utf-8');
const codeTools = fs.readFileSync(path.join(JS_DIR, 'bk-ai-tools.js'), 'utf-8');
const codeAgent = fs.readFileSync(path.join(JS_DIR, 'bk-ai-agent.js'), 'utf-8');
const codeUI = fs.readFileSync(path.join(JS_DIR, 'bk-ai-ui.js'), 'utf-8');

vm.runInContext(codeNormalizer, context);
vm.runInContext(codeContext, context);
vm.runInContext(codeManager, context);
vm.runInContext(codeOpenAI, context);
vm.runInContext(codeAnthropic, context);
vm.runInContext(codeTools, context);
vm.runInContext(codeAgent, context);

// Добавим фейковый контекст IDE в BKAIContext для тестирования действий
context.bkProject = {
    activeFileName: 'test.asm',
    getActiveFile: () => ({ name: 'test.asm', path: 'test.asm', content: 'START:\n  MOV #100, R0\n  EMT 14\n  HALT' }),
    getFileContent: (path) => 'START:\n  MOV #100, R0\n  EMT 14\n  HALT',
    listFiles: () => [{ name: 'test.asm', path: 'test.asm', size: 40 }]
};

context.editor = {
    getValue: () => 'START:\n  MOV #100, R0\n  EMT 14\n  HALT',
    getSelection: () => null,
    getModel: () => null
};

// Загружаем UI
vm.runInContext(codeUI, context);

async function runTests() {
    console.log('=== Запуск тестов UI BKStudio AI (js/bk-ai-ui.js) ===\n');

    // 1. Проверка инициализации
    check('Класс BKAIPanel объявлен', typeof context.BKAIPanel === 'function');
    check('Синглтон window.bkAIUI создан', typeof context.bkAIUI === 'object' && context.bkAIUI !== null);
    check('window.bkAI доступен', typeof context.bkAI === 'object' && context.bkAI !== null);

    // 2. Переключение вкладок
    const tabEmu = elementsById['tab-btn-emulator'];
    const tabAI = elementsById['tab-btn-ai'];
    const viewEmu = elementsById['emulator-view'];
    const viewAI = elementsById['ai-view'];
    const btnTopAI = elementsById['btn-ai-assistant'];

    tabAI.click();
    check('Клик по вкладке AI делает её активной', tabAI.classList.contains('active'));
    check('Клик по вкладке AI скрывает эмулятор', viewEmu.style.display === 'none');
    check('Клик по вкладке AI отображает AI-панель', viewAI.style.display === 'flex');

    tabEmu.click();
    check('Клик по вкладке Эмулятора восстанавливает эмулятор', viewEmu.style.display === 'flex');
    check('Клик по вкладке Эмулятора скрывает AI-панель', viewAI.style.display === 'none');

    btnTopAI.click();
    check('Кнопка в верхнем тулбаре переключает на AI-панель', viewAI.style.display === 'flex');

    // 3. Выбор провайдера / профиля
    const profileSelect = elementsById['ai-profile-select'];
    check('Список профилей заполнен опциями', profileSelect.children.length >= 6);

    profileSelect.value = 'anthropic';
    profileSelect.change();
    let curCfg = context.bkAI.getConfig();
    check('Выбор профиля Anthropic обновил provider в bkAI', curCfg.provider === 'anthropic');
    check('Выбор профиля Anthropic обновил baseUrl в bkAI', curCfg.baseUrl.includes('anthropic.com'));

    profileSelect.value = 'ollama';
    profileSelect.change();
    curCfg = context.bkAI.getConfig();
    check('Выбор профиля Ollama обновил baseUrl на 11434', curCfg.baseUrl === 'http://127.0.0.1:11434/v1');

    // 4. Редактирование модели, baseUrl и apiKey
    const modelInput = elementsById['ai-model-input'];
    const baseUrlInput = elementsById['ai-baseurl-input'];
    const apiKeyInput = elementsById['ai-apikey-input'];

    modelInput.value = 'llama3:8b';
    modelInput.change();
    check('Изменение поля модели сохранено в bkAI', context.bkAI.getConfig().model === 'llama3:8b');

    baseUrlInput.value = 'http://192.168.1.100:11434/v1';
    baseUrlInput.change();
    check('Изменение поля baseUrl сохранено в bkAI', context.bkAI.getConfig().baseUrl === 'http://192.168.1.100:11434/v1');

    apiKeyInput.value = 'test-secret-key-123';
    apiKeyInput.change();
    check('Изменение поля apiKey сохранено в bkAI', context.bkAI.getConfig().apiKey === 'test-secret-key-123');

    // 5. Проверка соединения (testConnection)
    const btnTest = elementsById['ai-btn-test-connection'];
    const statusConn = elementsById['ai-connection-status'];

    // Замокаем bkAI.testConnection()
    let testConnCalled = false;
    context.bkAI.testConnection = async () => {
        testConnCalled = true;
        return { success: true, message: 'OK' };
    };

    btnTest.click();
    await new Promise((r) => setTimeout(r, 10));
    check('Кнопка "Проверить связь" вызывает bkAI.testConnection()', testConnCalled);
    check('Статус отображает успешное подключение', statusConn.textContent.includes('успешно'));

    // 6. Быстрое действие "Создай (Generate)"
    const promptInput = elementsById['ai-prompt-input'];
    const btnGenerate = elementsById['ai-action-generate'];
    btnGenerate.click();
    check('Кнопка "Создай" вставляет шаблон промпта в поле ввода', promptInput.value.includes('Напиши подпрограмму'));

    // 7. Быстрое действие "Объясни (Explain)" и стриминг
    const btnExplain = elementsById['ai-action-explain'];
    let lastChatOptions = null;

    context.bkAI.chat = async (options) => {
        lastChatOptions = options;
        if (options.stream && options.onChunk) {
            options.onChunk({ delta: 'Подпрограмма ' });
            options.onChunk({ delta: 'выполняет команду ' });
            options.onChunk({ delta: '`EMT 14`.' });
        }
        return { text: 'Подпрограмма выполняет команду `EMT 14`.' };
    };

    btnExplain.click();
    await new Promise((r) => setTimeout(r, 20));

    check('Кнопка "Объясни" вызвала bkAI.chat()', lastChatOptions !== null);
    check('Промпт объяснения содержит код текущего файла', lastChatOptions.messages[0].content.includes('MOV #100, R0'));
    check('История сообщений содержит запрос пользователя', context.bkAIUI.history.some((m) => m.role === 'user'));
    check('История сообщений содержит ответ ассистента', context.bkAIUI.history.some((m) => m.role === 'assistant'));

    // 8. Быстрое действие "Исправь (Fix)"
    const btnFix = elementsById['ai-action-fix'];
    lastChatOptions = null;
    btnFix.click();
    await new Promise((r) => setTimeout(r, 20));

    check('Кнопка "Исправь" вызвала bkAI.chat()', lastChatOptions !== null);
    const lastMsg = lastChatOptions.messages[lastChatOptions.messages.length - 1];
    check('Промпт содержит указание исправить ошибки', lastMsg && lastMsg.content.includes('Найди и исправь ошибки'));

    // 9. Очистка истории
    const btnClear = elementsById['ai-btn-clear'];
    btnClear.click();
    check('Кнопка очистки обнуляет массив history', context.bkAIUI.history.length === 0);

    // 10. Остановка генерации (Stop)
    const btnStop = elementsById['ai-btn-stop'];
    let abortFired = false;

    context.bkAI.chat = async (options) => {
        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                abortFired = true;
            });
        }
        // Долгая асинхронная пауза для симуляции стриминга
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 500);
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    const err = new Error('AbortError');
                    err.name = 'AbortError';
                    reject(err);
                });
            }
        });
        return { text: 'Завершено' };
    };

    promptInput.value = 'Бесконечный вывод';
    const sendPromise = context.bkAIUI.sendMessage();
    check('После отправки запрос переходит в состояние загрузки', context.bkAIUI.isLoading === true);

    btnStop.click();
    try {
        await sendPromise;
    } catch (_) {}

    check('Кнопка "Стоп" прерывает AbortSignal запроса', abortFired === true);
    check('После остановки флаг isLoading сброшен в false', context.bkAIUI.isLoading === false);

    // 11. Переключение режимов: Чат и Агент
    const btnModeChat = elementsById['ai-mode-chat'];
    const btnModeAgent = elementsById['ai-mode-agent'];
    const maxIterInput = elementsById['ai-max-iterations-input'];

    check('По умолчанию активен режим chat', context.bkAIUI.mode === 'chat');

    btnModeAgent.click();
    check('Клик по кнопке "Агент" переключает режим в agent', context.bkAIUI.mode === 'agent');
    check('В режиме agent плейсхолдер ориентирован на задачи', promptInput.placeholder.includes('задачу для агента'));

    maxIterInput.value = '15';
    maxIterInput.change();
    check('Изменение лимита шагов обновляет maxIterations', context.bkAIUI.maxIterations === 15);

    // 12. Выполнение запроса в режиме Агента с отображением карточки инструмента
    let agentToolCalled = false;
    let agentRound = 0;
    context.bkAI.chat = async () => {
        agentRound++;
        if (agentRound === 1) {
            agentToolCalled = true;
            return {
                type: 'text',
                text: 'Изучаю файл...',
                toolCalls: [
                    { id: 'agent_tc_1', name: 'project.read_file', arguments: { path: 'test.asm' } }
                ]
            };
        }
        return {
            type: 'text',
            text: 'Агент завершил задачу: файл test.asm проверен.'
        };
    };

    promptInput.value = 'Проверь код в test.asm';
    await context.bkAIUI.sendMessage();

    check('В режиме Агента был вызван инструмент', agentToolCalled === true);
    check('История содержит финальный ответ агента', context.bkAIUI.history.some(m => m.content.includes('Агент завершил задачу')));

    btnModeChat.click();
    check('Клик по кнопке "Чат" возвращает режим chat', context.bkAIUI.mode === 'chat');

    // 13. Быстрое действие: "Исправь ошибку сборки" (кнопка ai-action-fix-build)
    const btnActionFixBuild = elementsById['ai-action-fix-build'];
    check('Кнопка "Исправь ошибку сборки" найдена в DOM', Boolean(btnActionFixBuild));

    let fixBuildCalled = false;
    context.bkAI.runFixBuildScenario = async () => {
        fixBuildCalled = true;
        return {
            success: true,
            text: 'Ошибка сборки устранена.'
        };
    };

    btnActionFixBuild.click();
    // Даем микротаске завершиться
    await new Promise(r => setTimeout(r, 10));

    check('Нажатие на кнопку "Исправь сборку" переключает режим в agent', context.bkAIUI.mode === 'agent');
    check('Вызван метод runFixBuildScenario через bkAI', fixBuildCalled === true);

    // 14. Режим "Разрешать всё (в этой сессии)" (autoApproveSession)
    const approveCheckbox = elementsById['ai-auto-approve-session'];
    const approveBadge = elementsById['ai-auto-approve-badge'];

    check('По умолчанию autoApproveSession в UI равен false', context.bkAIUI.autoApproveSession === false);
    check('Бейдж авто-разрешения по умолчанию скрыт', !approveBadge.style.display || approveBadge.style.display === 'none');

    // Включение через чекбокс
    approveCheckbox.checked = true;
    approveCheckbox.change();
    check('Изменение чекбокса включает autoApproveSession', context.bkAIUI.autoApproveSession === true);
    check('Бейдж авто-разрешения отображается', approveBadge.style.display === 'inline-flex');

    // Отключение кликом по бейджу
    approveBadge.click();
    check('Клик по бейджу отключает autoApproveSession', context.bkAIUI.autoApproveSession === false);
    check('Чекбокс снимается при отключении', approveCheckbox.checked === false);
    check('Бейдж скрывается после отключения', approveBadge.style.display === 'none');

    // Проверка кнопки "Разрешать всё (в этой сессии)" в диалоге подтверждения
    const fakeToolCall = { id: 'tc_test_confirm', name: 'project.write_file', arguments: { path: 'test.asm' } };
    const confirmPromise = context.bkAIUI.requestToolConfirmation(fakeToolCall);
    const confirmBox = elementsById['ai-messages'].children.find(el => el.className === 'ai-confirm-box');
    check('Окно подтверждения создано', Boolean(confirmBox));

    const btnConfirmAll = confirmBox.querySelector('.ai-btn-confirm-all');
    check('Кнопка "Разрешать всё (в этой сессии)" присутствует в окне', Boolean(btnConfirmAll));

    btnConfirmAll.click();
    const approvedResult = await confirmPromise;
    check('Клик по "Разрешать всё" подтверждает текущее действие', approvedResult === true);
    check('Клик по "Разрешать всё" активирует autoApproveSession', context.bkAIUI.autoApproveSession === true);
    check('Последующий вызов requestToolConfirmation завершается сразу true', await context.bkAIUI.requestToolConfirmation(fakeToolCall) === true);

    // Сброс состояния для чистоты
    context.bkAIUI.setAutoApproveSession(false);

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
