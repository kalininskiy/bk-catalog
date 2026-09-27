#!/usr/bin/env node
/**
 * BKStudio - Интеграционный тест нового ASCII Matrix Graphics API с реальной LLM (llama.cpp)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const JS_DIR = path.join(__dirname, '..');

// Песочница VM
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => { for (const k in storage) delete storage[k]; }
};

const mockProjectFiles = {
    'main.asm': '; BK-0010 Game\nSTART:\n  NOP\n  HALT\n'
};

function nodeHttpFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = http.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const bodyBuf = Buffer.concat(chunks);
                const bodyText = bodyBuf.toString('utf-8');
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: {
                        get: (k) => res.headers[k.toLowerCase()]
                    },
                    json: async () => JSON.parse(bodyText),
                    text: async () => bodyText
                });
            });
        });

        req.on('error', err => reject(err));

        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                const abortErr = new Error('AbortError');
                abortErr.name = 'AbortError';
                req.destroy(abortErr);
            });
        }

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    AbortController: AbortController,
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    Promise: Promise,
    Error: Error,
    ArrayBuffer: ArrayBuffer,
    Uint8Array: Uint8Array,
    fetch: nodeHttpFetch,
    require: require,
    process: process,
    __dirname: JS_DIR
};
sandbox.window = sandbox;
sandbox.global = sandbox;

// Mock BKProjectManager
sandbox.bkProject = {
    files: mockProjectFiles,
    activeFileName: 'main.asm',
    getAllFiles: () => Object.assign({}, mockProjectFiles),
    getFileContent: (p) => mockProjectFiles[p] || '',
    setFileContent: (p, c) => { mockProjectFiles[p] = c; return true; },
    writeFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    createFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    addArtifactFile: (p, c) => { mockProjectFiles[p] = c; return true; }
};

// Mock BKGraphicsEditor
sandbox.BKGraphicsEditor = {
    open: function () { return true; },
    insertInclude: function (asmPath) {
        mockProjectFiles['main.asm'] += `\n.INCLUDE "${asmPath}"\n`;
    }
};

const context = vm.createContext(sandbox);

function loadModule(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
}

// Загрузка модулей
loadModule('bk-graphics-modes.js');
loadModule('bk-graphics-model.js');
loadModule('bk-graphics-codec.js');
loadModule('bk-graphics-export.js');
loadModule('bk-graphics-ai-api.js');
loadModule('bk-ai-normalizer.js');
loadModule('bk-ai-context.js');
loadModule('bk-ai-providers/openai-compatible.js');
loadModule('bk-ai-manager.js');
loadModule('bk-ai-tools.js');
loadModule('bk-ai-agent.js');

async function runLiveTests() {
    console.log('=============================================================');
    console.log('  ИНТЕГРАЦИОННЫЙ ТЕСТ ASCII MATRIX GRAPHICS API С ЖИВОЙ LLM');
    console.log('=============================================================\n');

    const bkAI = context.bkAI;
    const agent = context.bkAIAgent;
    const gfxApi = context.bkGraphicsAI;

    bkAI.setConfig({
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8080/v1',
        model: 'Qwen3.6-35B-A3B-UDT-Q4_K_XL_MTP',
        apiKey: 'llama',
        maxTokens: 65536
    });

    agent.defaultMaxIterations = 15;
    agent.autoApproveAll = true;

    const metrics = {};

    function setupTracker(testName) {
        const calls = [];
        return {
            name: testName,
            calls,
            onStep: ({ iteration, maxIterations }) => {
                console.log(`  [Шаг ${iteration}/${maxIterations}] Запрос к LLM...`);
            },
            onThought: (thought, iteration) => {
                const preview = String(thought).replace(/\s+/g, ' ').slice(0, 140);
                console.log(`  💭 [Мысли ${iteration}]: ${preview}...`);
            },
            onToolCall: (tc) => {
                const argsStr = JSON.stringify(tc.arguments);
                const item = {
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                    argsSize: argsStr.length,
                    result: null,
                    resultSize: 0
                };
                calls.push(item);
                const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 80) + '...' : argsStr;
                console.log(`  🛠️ [Tool Call #${calls.length}] ${tc.name}(${argsPreview}) [args: ${argsStr.length} chars]`);
            },
            onToolResult: (tr) => {
                const last = calls[calls.length - 1];
                if (last) {
                    last.result = tr.result;
                    const resStr = JSON.stringify(tr.result);
                    last.resultSize = resStr.length;
                    const resPreview = resStr.length > 80 ? resStr.slice(0, 80) + '...' : resStr;
                    console.log(`     ↳ Результат: ${resPreview} [result: ${resStr.length} chars]`);
                }
            }
        };
    }

    // =========================================================================
    // ТЕСТ 1: Создание спрайта 16x16: космический корабль
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 1: Создание спрайта 16×16 (космический корабль)');
    console.log('-------------------------------------------------------------');
    console.log('Требования: 16x16, прозрачный фон (.), корпус синий (B), двигатель зеленый (G), симметричный.');

    const t1Tracker = setupTracker('Тест 1: Создание корабля 16x16');
    const prompt1 = `Создай спрайт 16×16 в режиме BK0010_COLOR с именем "SHIP":
- космический корабль;
- прозрачный фон (".");
- корпус синий ("B");
- двигатель зелёный ("G");
- симметричная форма.
После создания заполни спрайт через graphics.set с помощью ASCII Matrix.`;

    const res1 = await agent.run({
        prompt: prompt1,
        autoApproveAll: true,
        maxIterations: 10,
        onStep: t1Tracker.onStep,
        onThought: t1Tracker.onThought,
        onToolCall: t1Tracker.onToolCall,
        onToolResult: t1Tracker.onToolResult
    });

    const modelT1 = gfxApi.getModel('SHIP') || gfxApi.getActiveModel();
    let matrixT1 = '';
    if (modelT1) {
        matrixT1 = gfxApi.pixelsToMatrix(modelT1.pixels, modelT1.width, modelT1.height, modelT1.mode);
        console.log('\n[Полученная матрица 16x16 (SHIP)]:\n' + matrixT1);
    }

    metrics['Тест 1'] = {
        tracker: t1Tracker,
        res: res1,
        matrix: matrixT1,
        model: modelT1
    };

    // =========================================================================
    // ТЕСТ 2: Изменение двигателя на красный через graphics.get_region и graphics.patch
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 2: Изменение двигателя на красный (get_region + patch)');
    console.log('-------------------------------------------------------------');
    console.log('Требования: прочитать область двигателя через graphics.get_region, изменить зеленый G на красный R через graphics.patch. Не использовать pixel-level tools.');

    const t2Tracker = setupTracker('Тест 2: Замена двигателя на красный');
    const prompt2 = `В существующем спрайте "SHIP" измени только двигатель: сделай его красным ("R") вместо зелёного ("G").
Для этого:
1. Вызови graphics.get_region для области двигателя в нижней части корабля.
2. Проанализируй полученную матрицу.
3. Примени graphics.patch для замены зелёных пикселей на красные ("R").
Не используй попиксельные инструменты и не вызывай graphics.get после patch!`;

    const res2 = await agent.run({
        prompt: prompt2,
        autoApproveAll: true,
        maxIterations: 10,
        onStep: t2Tracker.onStep,
        onThought: t2Tracker.onThought,
        onToolCall: t2Tracker.onToolCall,
        onToolResult: t2Tracker.onToolResult
    });

    let matrixT2 = '';
    if (modelT1) {
        matrixT2 = gfxApi.pixelsToMatrix(modelT1.pixels, modelT1.width, modelT1.height, modelT1.mode);
        console.log('\n[Матрица 16x16 после patch]:\n' + matrixT2);
    }

    metrics['Тест 2'] = {
        tracker: t2Tracker,
        res: res2,
        matrix: matrixT2
    };

    // =========================================================================
    // ТЕСТ 3: Создание второго варианта корабля зеркальным способом
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 3: Создание зеркального варианта корабля');
    console.log('-------------------------------------------------------------');
    console.log('Требования: создать второй вариант корабля зеркальным способом, ЕСЛИ соответствующий tool уже существует. Если такого tool нет — не создавать новый tool.');

    const t3Tracker = setupTracker('Тест 3: Зеркальный вариант');
    const prompt3 = `Создай второй вариант корабля с именем "SHIP_MIRROR" зеркальным способом, если в доступных инструментах graphics.* уже существует соответствующий инструмент для отражения. Если такого инструмента нет — используй только существующие инструменты graphics.create и graphics.set (или скопируй через graphics.create с copyFrom) и объясни это. Не пытайся вызывать несуществующие инструменты!`;

    const res3 = await agent.run({
        prompt: prompt3,
        autoApproveAll: true,
        maxIterations: 10,
        onStep: t3Tracker.onStep,
        onThought: t3Tracker.onThought,
        onToolCall: t3Tracker.onToolCall,
        onToolResult: t3Tracker.onToolResult
    });

    metrics['Тест 3'] = {
        tracker: t3Tracker,
        res: res3
    };

    // =========================================================================
    // ТЕСТ 4: Создание изображения 64x64 с простой заставкой
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 4: Создание изображения 64×64 с простой заставкой');
    console.log('-------------------------------------------------------------');
    console.log('Требования: 64x64, простая заставка. Не передавать в tools числовые массивы пикселей.');

    const t4Tracker = setupTracker('Тест 4: Заставка 64x64');
    const prompt4 = `Создай изображение 64×64 в режиме BK0010_COLOR с простой заставкой "LOGO":
- рамка вокруг экрана;
- простая надпись или эмблема по центру;
- используй graphics.create и graphics.set (или graphics.fill + graphics.patch);
- НЕ передавай числовые массивы пикселей — только ASCII Matrix!`;

    const res4 = await agent.run({
        prompt: prompt4,
        autoApproveAll: true,
        maxIterations: 10,
        onStep: t4Tracker.onStep,
        onThought: t4Tracker.onThought,
        onToolCall: t4Tracker.onToolCall,
        onToolResult: t4Tracker.onToolResult
    });

    metrics['Тест 4'] = {
        tracker: t4Tracker,
        res: res4
    };

    // =========================================================================
    // ИТОГОВЫЙ ОТЧЁТ И АНАЛИЗ МЕТРИК
    // =========================================================================
    console.log('\n=============================================================');
    console.log('                ИТОГОВЫЙ АНАЛИЗ МЕТРИК ТЕСТОВ');
    console.log('=============================================================\n');

    for (const [tName, data] of Object.entries(metrics)) {
        const tr = data.tracker;
        console.log(`\n### ${tName}`);
        console.log(`- Количество tool calls: ${tr.calls.length}`);
        console.log(`- Вызванные tools: ${tr.calls.map(c => c.name).join(', ') || 'нет'}`);

        let totalArgsSize = 0;
        let totalResSize = 0;
        let getCount = 0;
        let getRegionCount = 0;
        let oldPixelToolCalls = [];
        let clearCalls = [];

        tr.calls.forEach((c, idx) => {
            totalArgsSize += c.argsSize;
            totalResSize += c.resultSize;
            if (c.name === 'graphics.get') getCount++;
            if (c.name === 'graphics.get_region') getRegionCount++;
            if (['graphics.set_pixel', 'graphics.set_pixels', 'graphics.rotate90', 'graphics.resize'].includes(c.name)) {
                oldPixelToolCalls.push(c.name);
            }
            if (c.name === 'graphics.clear') clearCalls.push(c.name);

            console.log(`  * Tool #${idx + 1} [${c.name}]: args = ${c.argsSize} chars, result = ${c.resultSize} chars`);
        });

        console.log(`- Суммарный размер arguments: ${totalArgsSize} chars`);
        console.log(`- Суммарный размер results: ${totalResSize} chars`);
        console.log(`- Повторные get: ${getCount > 1 ? `ДА (${getCount} раз)` : 'НЕТ'}`);
        console.log(`- Использование get_region: ${getRegionCount} раз`);
        console.log(`- Попытки вызвать старые pixel tools: ${oldPixelToolCalls.length > 0 ? oldPixelToolCalls.join(', ') : 'НЕТ'}`);
        console.log(`- Повторные clear: ${clearCalls.length > 0 ? clearCalls.length : 'НЕТ'}`);
        console.log(`- Итоговый статус агента: ${data.res.stoppedReason} (${data.res.iterations} итераций)`);
        console.log(`- Ответ модели: ${data.res.text.slice(0, 180)}...`);
    }

    console.log('\n--- Все тесты успешно завершены ---');
}

runLiveTests().catch(err => {
    console.error('Ошибка при выполнении живых тестов:', err);
    process.exit(1);
});
