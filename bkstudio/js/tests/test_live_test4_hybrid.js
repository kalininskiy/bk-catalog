/**
 * Live LLM Test: Intermediate Hybrid Test (TEST4 32x32)
 *
 * Комбинация graphics.fill (прямоугольные блоки) + graphics.patch (растровые детали, крылья, кабина)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const JS_DIR = path.resolve(__dirname, '..');

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
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Buffer: Buffer,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    RegExp: RegExp,
    Error: Error,
    Map: Map,
    Set: Set,
    Promise: Promise,
    ArrayBuffer: ArrayBuffer,
    Uint8Array: Uint8Array,
    fetch: nodeHttpFetch,
    require: require,
    process: process,
    __dirname: JS_DIR,
    AbortController: typeof AbortController !== 'undefined' ? AbortController : require('abort-controller')
};

const localStorageStore = {};
sandbox.localStorage = {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
};

sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.document = {
    createElement: () => ({ style: {}, appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [] }),
    getElementById: () => null,
    addEventListener: () => {}
};

const mockProjectFiles = {
    'main.asm': '; BK-0010 Project\n'
};

sandbox.bkProject = {
    hasProject: () => true,
    getFile: (p) => mockProjectFiles[p] !== undefined ? { content: mockProjectFiles[p] } : null,
    setFileContent: (p, c) => { mockProjectFiles[p] = c; return true; },
    writeFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    createFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    addArtifactFile: (p, c) => { mockProjectFiles[p] = c; return true; }
};

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
    console.log('  ЖИВОЙ ТЕСТ С ЛОКАЛЬНОЙ LLM: TEST4 32x32 (ГИБРИДНЫЙ FILL + PATCH)');
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

    const prompt = `Создай изображение TEST4 32×32 в BK0010_COLOR.

Чёрный фон.

Нарисуй простой космический корабль:

корпус должен быть симметричным;
центральная часть 8×12;
крылья должны расширяться к краям;
сверху небольшая кабина;
снизу два двигателя;
используй graphics.fill там, где подходят прямоугольники;
для остальных деталей используй graphics.patch;
после завершения проверь результат через graphics.get_region.`;

    console.log('Запрос пользователя:\n' + prompt + '\n');
    console.log('-------------------------------------------------------------');
    const startTime = Date.now();

    const res = await agent.run({
        prompt: prompt,
        autoApproveAll: true,
        maxIterations: 15,
        onStep: ({ iteration, maxIterations }) => {
            iterationsCount = iteration;
            console.log(`\n[Шаг ${iteration}/${maxIterations}] Запрос к LLM...`);
        },
        onThought: (thought, iteration) => {
            const preview = String(thought).replace(/\s+/g, ' ').slice(0, 200);
            console.log(`  💭 [Мысли]: ${preview}...`);
        },
        onToolCall: (tc) => {
            const argsStr = JSON.stringify(tc.arguments);
            const item = {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                iteration: iterationsCount
            };
            toolCalls.push(item);
            const preview = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr;
            console.log(`  🛠️ [Tool Call #${toolCalls.length}] ${tc.name}: ${preview}`);
        },
        onToolResult: (tr) => {
            toolResults.push(tr);
            const isOk = tr.result && (tr.result.ok !== false && tr.result.success !== false && !tr.result.error);
            if (!isOk) {
                errors.push({ id: tr.id, result: tr.result });
            }
            const resStr = JSON.stringify(tr.result);
            const preview = resStr.length > 120 ? resStr.slice(0, 120) + '...' : resStr;
            console.log(`  📥 [Tool Result] ${isOk ? 'OK' : 'ERROR'}: ${preview}`);
        }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n=============================================================');
    console.log('  АНАЛИЗ ВЫПОЛНЕНИЯ ТЕСТА');
    console.log('=============================================================');
    console.log(`Время выполнения: ${elapsed} сек.`);
    console.log(`Количество итераций: ${iterationsCount}`);
    console.log(`Всего вызовов инструментов: ${toolCalls.length}`);
    console.log(`Ошибок при вызовах: ${errors.length}`);
    console.log(`Успех агента: ${res.success}`);
    console.log(`Причина завершения: ${res.stopReason || 'completed'}`);

    console.log('\nИтоговый ответ модели:');
    console.log(res.text);

    // Проверяем созданный графический объект TEST4 в памяти
    console.log('\n--- Проверка объекта TEST4 в BKGraphicsAI ---');
    try {
        const info = gfxApi.getInfo({ name: 'TEST4' });
        console.log(`Модель: ${info.name}, размер: ${info.width}x${info.height}`);

        const regionFull = gfxApi.getRegion({ name: 'TEST4', x: 0, y: 0, width: 32, height: 32 });
        console.log('\nПолная матрица 32x32 TEST4:');
        const lines = regionFull.matrix.split('\n');
        lines.forEach((line, idx) => {
            const rowNum = String(idx).padStart(2, '0');
            console.log(`${rowNum}: ${line}`);
        });

        // Также покажем компактную область корабля (строки с ненулевыми символами)
        const shipRows = lines.filter(r => r.includes('B') || r.includes('G') || r.includes('R') || r.includes('W'));
        console.log(`\nСтрок содержащих корабль: ${shipRows.length} из 32`);
    } catch (e) {
        console.log('Ошибка при получении объекта TEST4:', e.message);
    }

    console.log('\n--- Список всех вызовов инструментов: ---');
    toolCalls.forEach((tc, idx) => {
        console.log(`  ${idx + 1}. [Шаг ${tc.iteration}] ${tc.name} ${JSON.stringify(tc.arguments)}`);
    });
}

runTest().catch(err => {
    console.error('Критическая ошибка теста:', err);
    process.exit(1);
});
