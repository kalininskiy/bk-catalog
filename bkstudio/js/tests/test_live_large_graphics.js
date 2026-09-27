#!/usr/bin/env node
/**
 * BKStudio - Интеграционный тест AI-агента с большой графикой 256x256 (ASCII Matrix API)
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
    'main.asm': '; BK-0010 Space Game\nSTART:\n  NOP\n  HALT\n'
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

// Загрузка модулей BKStudio
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

async function runLargeGraphicsTest() {
    console.log('=============================================================');
    console.log('  ТЕСТ РАБОТЫ AI С БОЛЬШОЙ ГРАФИКОЙ 256×256 (ASCII MATRIX API)');
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
    let maxResultSize = 0;
    let failedCallsCount = 0;

    const prompt = `Создай заставку для БК-0010 размером 256×256.
Тема: космический корабль летит через космос.
Требования к выполнению:
1. Создай холст 256×256 через graphics.create (режим BK0010_COLOR, имя "SPACE_SPLASH").
2. Работай регионально через небольшие разумные патчи (graphics.patch):
   - нарисуй звезды/планету на фоне небольшим патчем;
   - нарисуй космический корабль по центру или в полете (патч 16x16 или 24x24: корпус синий B, двигатель красный R);
   - нарисуй след от двигателей или надпись.
3. Не передавай числовые массивы пикселей, не используй попиксельные инструменты.
4. Не вызывай graphics.get для всей картинки 256x256 без необходимости — используй graphics.info или прицельный graphics.get_region при проверке.
5. После завершения рисования экспортируй заставку (graphics.export_bin или graphics.export_asm) и добавь ресурс в проект через graphics.add_to_project.
6. Заверши ответ кратким отчетом.`;

    console.log('Запуск агентного цикла с задачей создания заставки 256×256...');
    const startTime = Date.now();

    const res = await agent.run({
        prompt: prompt,
        autoApproveAll: true,
        maxIterations: 15,
        onStep: ({ iteration, maxIterations }) => {
            console.log(`\n  [Шаг ${iteration}/${maxIterations}] Запрос к LLM...`);
        },
        onThought: (thought, iteration) => {
            const preview = String(thought).replace(/\s+/g, ' ').slice(0, 160);
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
                resultSize: 0,
                success: true
            };
            toolCalls.push(item);
            const argsPreview = argsStr.length > 90 ? argsStr.slice(0, 90) + '...' : argsStr;
            console.log(`  🛠️ [Tool Call #${toolCalls.length}] ${tc.name}(${argsPreview}) [args: ${argsStr.length} chars]`);
        },
        onToolResult: (tr) => {
            const last = toolCalls[toolCalls.length - 1];
            if (last) {
                last.result = tr.result;
                const resStr = JSON.stringify(tr.result);
                last.resultSize = resStr.length;
                if (last.resultSize > maxResultSize) {
                    maxResultSize = last.resultSize;
                }
                if (tr.result && tr.result.success === false) {
                    last.success = false;
                    failedCallsCount++;
                }
                const resPreview = resStr.length > 90 ? resStr.slice(0, 90) + '...' : resStr;
                console.log(`     ↳ Результат: ${resPreview} [result: ${resStr.length} chars, success: ${last.success}]`);
            }
        }
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // =========================================================================
    // АНАЛИЗ МЕТРИК И ОТЧЕТ
    // =========================================================================
    console.log('\n=============================================================');
    console.log('       ОТЧЁТ: ТЕСТ AI С БОЛЬШОЙ ГРАФИКОЙ 256×256');
    console.log('=============================================================\n');

    let totalArgsSize = 0;
    let totalResSize = 0;
    let getRegionCount = 0;
    let patchCount = 0;
    let getCount = 0;
    let createCount = 0;
    let exportCount = 0;
    let addToProjectCount = 0;
    let oldPixelToolCalls = 0;

    toolCalls.forEach((c, idx) => {
        totalArgsSize += c.argsSize;
        totalResSize += c.resultSize;
        if (c.name === 'graphics.get_region') getRegionCount++;
        if (c.name === 'graphics.patch') patchCount++;
        if (c.name === 'graphics.get') getCount++;
        if (c.name === 'graphics.create') createCount++;
        if (c.name.startsWith('graphics.export_')) exportCount++;
        if (c.name === 'graphics.add_to_project') addToProjectCount++;
        if (['graphics.set_pixel', 'graphics.set_pixels', 'graphics.clear', 'graphics.resize'].includes(c.name)) {
            oldPixelToolCalls++;
        }
    });

    console.log(`Время выполнения: ${elapsed} сек.`);
    console.log(`Итоговый статус: ${res.stoppedReason} (${res.iterations} итераций)`);
    console.log(`Количество tool calls: ${toolCalls.length}`);
    console.log(`Вызовы инструментов по типам:`);
    console.log(`  - graphics.create: ${createCount}`);
    console.log(`  - graphics.patch: ${patchCount}`);
    console.log(`  - graphics.get_region: ${getRegionCount}`);
    console.log(`  - graphics.get (полное чтение): ${getCount}`);
    console.log(`  - graphics.export_*: ${exportCount}`);
    console.log(`  - graphics.add_to_project: ${addToProjectCount}`);
    console.log(`  - попытки старых pixel tools: ${oldPixelToolCalls}`);
    console.log(`\nОбъемы данных:`);
    console.log(`  - Общий объём arguments: ${totalArgsSize} символов (~${Math.round(totalArgsSize / 4)} токенов)`);
    console.log(`  - Общий объём tool results: ${totalResSize} символов (~${Math.round(totalResSize / 4)} токенов)`);
    console.log(`  - Максимальный размер одного tool result: ${maxResultSize} символов`);
    console.log(`  - Неудачные вызовы: ${failedCallsCount}`);

    // Проверка состояния графической модели
    const model = gfxApi.getModel('SPACE_SPLASH') || gfxApi.getActiveModel();
    if (model) {
        console.log(`\nГрафическая модель в памяти:`);
        console.log(`  - Имя: ${model.name || 'активная'}`);
        console.log(`  - Размеры: ${model.width}×${model.height}`);
        console.log(`  - Режим: ${model.mode}`);
        const nonZero = model.pixels.filter(p => p > 0).length;
        console.log(`  - Нарисованных ненулевых пикселей: ${nonZero}`);
    }

    console.log(`\nФайлы проекта после теста:`);
    for (const [fname, fcontent] of Object.entries(mockProjectFiles)) {
        console.log(`  * ${fname} (${fcontent.length} байт)`);
    }

    console.log(`\nФинальный ответ AI:\n${res.text}`);
}

runLargeGraphicsTest().catch(err => {
    console.error('Ошибка в тесте большой графики:', err);
    process.exit(1);
});
