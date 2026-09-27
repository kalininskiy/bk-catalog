#!/usr/bin/env node
/**
 * BKStudio - Живой тест создания заставки SPLASH2 64x64 с локальной LLM
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

async function runTest() {
    console.log('=============================================================');
    console.log('  ЖИВОЙ ТЕСТ С ЛОКАЛЬНОЙ LLM: SPLASH2 64x64');
    console.log('  Сервер: http://127.0.0.1:8080/v1');
    console.log('  Модель: Qwen3.6-35B-A3B-UDT-Q4_K_XL_MTP');
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

    const toolCalls = [];
    const toolResults = [];
    const errors = [];
    let iterationsCount = 0;

    const prompt = `Создай изображение \`SPLASH2\` размером 64×64 в режиме \`BK0010_COLOR\`.

Сделай простую симметричную заставку: фон, крупная рамка, центральный логотип и несколько цветных деталей.

Для больших одноцветных прямоугольных областей используй \`graphics.fill\`, а для небольших сложных деталей — \`graphics.patch\`.

После создания проверь несколько небольших областей через \`graphics.get_region\`.

Не нужно генерировать и передавать целиком матрицу 64×64.`;

    console.log('Запуск агента с промптом:\n' + prompt + '\n');
    const startTime = Date.now();

    const res = await agent.run({
        prompt: prompt,
        autoApproveAll: true,
        maxIterations: 15,
        onStep: ({ iteration, maxIterations }) => {
            iterationsCount = iteration;
            console.log(`\n  [Шаг ${iteration}/${maxIterations}] Запрос к LLM...`);
        },
        onThought: (thought, iteration) => {
            const preview = String(thought).replace(/\s+/g, ' ').slice(0, 180);
            console.log(`  💭 [Мысли ${iteration}]: ${preview}...`);
        },
        onToolCall: (tc) => {
            const argsStr = JSON.stringify(tc.arguments);
            const item = {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                argsSize: argsStr.length
            };
            toolCalls.push(item);
            const argsPreview = argsStr.length > 100 ? argsStr.slice(0, 100) + '...' : argsStr;
            console.log(`  🛠️ [Вызов #${toolCalls.length}] ${tc.name}(${argsPreview})`);
        },
        onToolResult: (tr) => {
            toolResults.push(tr);
            const resStr = JSON.stringify(tr.result);
            const isOk = tr.result && (tr.result.ok !== false && tr.result.success !== false);
            if (!isOk) {
                errors.push({ id: tr.id, result: tr.result });
            }
            const resPreview = resStr.length > 120 ? resStr.slice(0, 120) + '...' : resStr;
            console.log(`  📥 [Результат ${tr.id}] ok=${isOk}: ${resPreview}`);
        }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n=============================================================');
    console.log('  РЕЗУЛЬТАТЫ И АНАЛИЗ ВЫПОЛНЕНИЯ ТЕСТА');
    console.log('=============================================================');
    console.log(`Время выполнения: ${elapsed} сек.`);
    console.log(`Количество итераций: ${iterationsCount}`);
    console.log(`Успех завершения: ${res.success}`);
    console.log(`Причина остановки: ${res.stopReason || 'completed'}`);

    console.log('\nОтвет ассистента:');
    console.log(res.content || '(нет текстового ответа)');

    // Подсчет вызовов по инструментам
    const toolCounts = {};
    for (const tc of toolCalls) {
        toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
    }

    console.log('\nИспользованные инструменты и количество вызовов:');
    for (const [tName, count] of Object.entries(toolCounts)) {
        console.log(`  * ${tName}: ${count}`);
    }
    console.log(`  Всего вызовов tools: ${toolCalls.length}`);

    console.log('\nОшибки при вызовах инструментов:');
    if (errors.length === 0) {
        console.log('  Ошибок не зафиксировано (все вызовы завершились успешно).');
    } else {
        console.log(`  Зафиксировано ошибок: ${errors.length}`);
        for (const err of errors) {
            console.log(`    - [${err.id}]:`, JSON.stringify(err.result));
        }
    }

    // Проверка созданного изображения
    const model = gfxApi.getModel('SPLASH2') || gfxApi.getActiveModel();
    if (model) {
        console.log(`\nИзображение в модели:`);
        console.log(`  Имя: ${model.name}`);
        console.log(`  Размеры: ${model.width}x${model.height}`);
        console.log(`  Режим: ${model.mode}`);

        let nonZero = 0;
        for (let i = 0; i < model.pixels.length; i++) {
            if (model.pixels[i] !== 0) nonZero++;
        }
        console.log(`  Ненулевых пикселей: ${nonZero} из ${model.pixels.length} (${((nonZero / model.pixels.length) * 100).toFixed(1)}%)`);

        // Снимок центральной области 16x16
        const center = gfxApi.getRegion({ name: 'SPLASH2', x: 24, y: 24, width: 16, height: 16 });
        console.log('\n  Центральный фрагмент 16x16 (x=24, y=24):');
        console.log(center.matrix.split('\n').map(l => '    ' + l).join('\n'));

        // Снимок верхнего левого угла 16x16
        const corner = gfxApi.getRegion({ name: 'SPLASH2', x: 0, y: 0, width: 16, height: 16 });
        console.log('\n  Левый верхний угол (рамка) 16x16 (x=0, y=0):');
        console.log(corner.matrix.split('\n').map(l => '    ' + l).join('\n'));
    } else {
        console.log('\nПРЕДУПРЕЖДЕНИЕ: Модель SPLASH2 не найдена в gfxApi!');
    }
}

runTest().catch((err) => {
    console.error('Ошибка в тесте:', err);
    process.exit(1);
});
