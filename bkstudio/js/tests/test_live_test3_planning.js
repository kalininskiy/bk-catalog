/**
 * Live LLM Test: Planning without Error Correction (TEST3 64x64)
 *
 * Проверяем:
 * 1. Координатную геометрию модели
 * 2. Декомпозицию изображения
 * 3. Использование graphics.fill
 * 4. Завершение задачи и проверку через get_region
 * 5. Отсутствие лишних итераций на исправление матриц
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

// Создаем песочницу
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
    'main.asm': '; BK-0010 Project\n.BIN_OFFSET 1000\nSTART:  NOP\n        RET\n'
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
    console.log('  ЖИВОЙ ТЕСТ С ЛОКАЛЬНОЙ LLM: TEST3 64x64 (ПЛАНИРОВАНИЕ FILL)');
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

    const prompt = `Создай TEST3 размером 64×64 в режиме BK0010_COLOR.

Сделай симметричный узор из прямоугольников:

чёрный фон;
синяя рамка толщиной 2 пикселя;
зелёный прямоугольник 24×16 в центре;
красный прямоугольник 8×8 внутри него;
четыре жёлтых квадрата 4×4 по углам центральной области.

Используй graphics.fill для всех прямоугольных областей.
В конце проверь результат через graphics.get_region.`;

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
            console.log(`  🛠️ [Tool Call #${toolCalls.length}] ${tc.name}: ${argsStr}`);
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

    // Проверяем созданный графический объект TEST3 в памяти
    console.log('\n--- Проверка объекта TEST3 в BKGraphicsAI ---');
    try {
        const info = gfxApi.getInfo({ name: 'TEST3' });
        console.log(`Модель найдена: ${info.name}, размер: ${info.width}x${info.height}, режим: ${info.modeName}`);

        // Анализ пикселей
        const regionCenter = gfxApi.getRegion({ name: 'TEST3', x: 28, y: 28, width: 8, height: 8 });
        console.log('\nЦентр 8x8 (должен быть красный "R"):');
        console.log(regionCenter.matrix);

        const regionTopLeftBorder = gfxApi.getRegion({ name: 'TEST3', x: 0, y: 0, width: 8, height: 4 });
        console.log('\nВерхний левый угол рамки (должен содержать синий "B"):');
        console.log(regionTopLeftBorder.matrix);
    } catch (e) {
        console.log('Ошибка при получении объекта TEST3:', e.message);
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
