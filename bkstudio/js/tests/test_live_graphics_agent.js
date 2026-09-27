#!/usr/bin/env node
/**
 * BKStudio - Тестирование AI-агента как графического агента с живой моделью llama.cpp
 *
 * Сервер: http://127.0.0.1:8080/v1
 * Модель: Qwen3.6-35B-A3B-UDT-Q4_K_XL_MTP
 *
 * Проверяемые сценарии:
 *   Тест 1: Создание заставки STAR QUEST 256x256 для БК-0010 (create, draw, get_info, export);
 *   Тест 2: Спрайт-шит персонажа 16x16 на 8 кадров, экспорт в .ASM и добавление в проект;
 *   Тест 3: Чтение текущей графики и изменение только персонажа без повреждения фона;
 *   Тест 4: Создание копии текущего спрайта с другой палитрой без изменения оригинала.
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

const http = require('http');

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

// Загрузка всех необходимых модулей BKStudio
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

let passed = 0;
let failed = 0;

function check(name, ok) {
    if (ok) {
        console.log('✅ PASS: ' + name);
        passed++;
    } else {
        console.error('❌ FAIL: ' + name);
        failed++;
    }
}

async function runLiveTests() {
    console.log('=== Запуск тестов AI-агента как графического агента с llama.cpp ===\n');

    const bkAI = context.bkAI;
    const tools = context.bkAITools;
    const agent = context.bkAIAgent;
    const gfxApi = context.bkGraphicsAI;

    // Конфигурация согласно запросу пользователя
    bkAI.setConfig({
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8080/v1',
        model: 'Qwen3.6-35B-A3B-UDT-Q4_K_XL_MTP',
        apiKey: 'llama',
        maxTokens: 65536
    });

    agent.defaultMaxIterations = 50;
    agent.autoApproveAll = true;

    // =========================================================================
    // ТЕСТ 1: Создание заставки STAR QUEST 256x256 для БК-0010
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 1: Создание заставки для БК-0010 (STAR QUEST, 256x256)');
    console.log('-------------------------------------------------------------');

    const prompt1 = `Создай заставку для БК-0010.
Размер 256×256.
Чёрно-белая графика.
Тематика: космическая игра.
Название: STAR QUEST.
Сделай композицию читаемой на реальном экране БК.`;

    const toolCallsT1 = [];
    const t1Start = Date.now();

    const res1 = await agent.run({
        prompt: prompt1,
        autoApproveAll: true,
        maxIterations: 50,
        onStep: ({ iteration, maxIterations }) => {
            console.log(`  [Шаг ${iteration}/${maxIterations}] запрос к модели...`);
        },
        onThought: (thought, iteration) => {
            const preview = String(thought).replace(/\n/g, ' ').slice(0, 120);
            console.log(`  [Мысли ${iteration}]: ${preview}...`);
        },
        onToolCall: (tc) => {
            toolCallsT1.push(tc);
            console.log(`  🛠️ Инструмент: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}...)`);
        },
        onToolResult: (tr) => {
            const resPreview = JSON.stringify(tr.result).slice(0, 80);
            console.log(`     ↳ Результат: ${resPreview}...`);
        }
    });

    console.log(`\nТест 1 завершен за ${((Date.now() - t1Start) / 1000).toFixed(1)}с. Шагов: ${res1.iterations}, Инструментов: ${res1.toolCallsCount}`);

    check('Тест 1: Агент выполнил вызовы инструментов', res1.toolCallsCount > 0);
    const hasCreateT1 = toolCallsT1.some(tc => tc.name === 'graphics.create');
    check('Тест 1: Агент вызвал graphics.create', hasCreateT1);

    const hasDrawingT1 = toolCallsT1.some(tc => ['graphics.fill', 'graphics.set_pixel', 'graphics.set_pixels', 'graphics.clear'].includes(tc.name));
    check('Тест 1: Агент выполнил рисование через Graphics Tools', hasDrawingT1);

    const activeModelT1 = gfxApi.getActiveModel();
    check('Тест 1: Активная модель существует в памяти', Boolean(activeModelT1));
    if (activeModelT1) {
        check('Тест 1: Высота заставки 256', activeModelT1.height === 256);
        const nonZeroPixels = activeModelT1.pixels.filter(p => p > 0).length;
        check('Тест 1: Заставка содержит нарисованные пиксели (звезды/надпись)', nonZeroPixels > 0);
        console.log(`     (Нарисовано ненулевых пикселей: ${nonZeroPixels})`);
    }

    check('Тест 1: Агент НЕ выводил массив .BYTE вручную в текст ответа', !res1.text.includes('.BYTE 0') && !res1.text.includes('.byte 0'));

    // =========================================================================
    // ТЕСТ 2: Персонаж 16x16, 8 кадров анимации, sprite sheet, экспорт в .ASM
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 2: Создание персонажа 16×16, 8 кадров, sprite sheet, .ASM');
    console.log('-------------------------------------------------------------');

    const prompt2 = `Создай персонажа 16×16.
Сделай 8 кадров анимации.
Размести их в sprite sheet.
Экспортируй в .ASM.
Добавь ресурс в проект.`;

    const toolCallsT2 = [];
    const t2Start = Date.now();

    const res2 = await agent.run({
        prompt: prompt2,
        autoApproveAll: true,
        maxIterations: 50,
        onStep: ({ iteration, maxIterations }) => {
            console.log(`  [Шаг ${iteration}/${maxIterations}] запрос к модели...`);
        },
        onToolCall: (tc) => {
            toolCallsT2.push(tc);
            console.log(`  🛠️ Инструмент: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}...)`);
        },
        onToolResult: (tr) => {
            console.log(`     ↳ Результат: ${JSON.stringify(tr.result).slice(0, 80)}...`);
        }
    });

    console.log(`\nТест 2 завершен за ${((Date.now() - t2Start) / 1000).toFixed(1)}с. Шагов: ${res2.iterations}, Инструментов: ${res2.toolCallsCount}`);

    check('Тест 2: Агент вызвал graphics.create для спрайта', toolCallsT2.some(tc => tc.name === 'graphics.create'));
    check('Тест 2: Агент нарисовал кадры через set_pixels/set_pixel', toolCallsT2.some(tc => tc.name === 'graphics.set_pixels' || tc.name === 'graphics.set_pixel'));
    
    const hasExportAsm = toolCallsT2.some(tc => tc.name === 'graphics.export_asm' || tc.name === 'graphics.export_mac');
    const hasAddToProject = toolCallsT2.some(tc => tc.name === 'graphics.add_to_project');
    check('Тест 2: Агент экспортировал спрайты (export_asm или add_to_project)', hasExportAsm || hasAddToProject);
    check('Тест 2: Ресурс или код добавлен в проект', hasAddToProject || Object.keys(mockProjectFiles).length > 1);

    // =========================================================================
    // ТЕСТ 3: Чтение текущей графики и изменение только персонажа (фон не трогать)
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 3: Изменение только персонажа без изменения фона');
    console.log('-------------------------------------------------------------');

    // Подготавливаем фон (пиксель фона на позиции (0,0) и (15,15))
    const currentModelBeforeT3 = gfxApi.getActiveModel();
    if (currentModelBeforeT3) {
        currentModelBeforeT3.setPixel(0, 0, 1); // пиксель фона
        currentModelBeforeT3.setPixel(currentModelBeforeT3.width - 1, currentModelBeforeT3.height - 1, 2);
    }
    const bgPixel1 = currentModelBeforeT3 ? currentModelBeforeT3.getPixel(0, 0) : 1;
    const bgPixel2 = currentModelBeforeT3 ? currentModelBeforeT3.getPixel(currentModelBeforeT3.width - 1, currentModelBeforeT3.height - 1) : 2;

    const prompt3 = `Посмотри текущую графику.
Измени только персонажа.
Фон не трогай.`;

    const toolCallsT3 = [];
    const t3Start = Date.now();

    const res3 = await agent.run({
        prompt: prompt3,
        autoApproveAll: true,
        maxIterations: 50,
        onStep: ({ iteration, maxIterations }) => {
            console.log(`  [Шаг ${iteration}/${maxIterations}] запрос к модели...`);
        },
        onToolCall: (tc) => {
            toolCallsT3.push(tc);
            console.log(`  🛠️ Инструмент: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}...)`);
        },
        onToolResult: (tr) => {
            console.log(`     ↳ Результат: ${JSON.stringify(tr.result).slice(0, 80)}...`);
        }
    });

    console.log(`\nТест 3 завершен за ${((Date.now() - t3Start) / 1000).toFixed(1)}с.`);

    check('Тест 3: Агент запросил текущую графику (get_info или get_region или get)',
        toolCallsT3.some(tc => ['graphics.get_info', 'graphics.get_region', 'graphics.get'].includes(tc.name)));
    check('Тест 3: Агент выполнил точечное изменение пикселей',
        toolCallsT3.some(tc => ['graphics.set_pixels', 'graphics.set_pixel'].includes(tc.name)));
    check('Тест 3: Агент НЕ вызывал полную очистку clear/fill, чтобы не стереть фон',
        !toolCallsT3.some(tc => tc.name === 'graphics.clear'));

    if (currentModelBeforeT3) {
        check('Тест 3: Пиксель фона (0,0) остался нетронутым', currentModelBeforeT3.getPixel(0, 0) === bgPixel1);
    }

    // =========================================================================
    // ТЕСТ 4: Создание копии текущего спрайта с другой палитрой без изменения оригинала
    // =========================================================================
    console.log('\n-------------------------------------------------------------');
    console.log('▶ ТЕСТ 4: Копия текущего спрайта, смена палитры, второй вариант');
    console.log('-------------------------------------------------------------');

    const originalModelBeforeT4 = gfxApi.getActiveModel();
    const originalName = originalModelBeforeT4 ? originalModelBeforeT4.name : 'HERO';
    const originalPalette = originalModelBeforeT4 ? originalModelBeforeT4.paletteIndex : 0;
    const originalPixelsBackup = originalModelBeforeT4 ? originalModelBeforeT4.pixels.slice() : [];

    const prompt4 = `Сделай копию текущего спрайта,
измени палитру,
создай второй вариант.`;

    const toolCallsT4 = [];
    const t4Start = Date.now();

    const res4 = await agent.run({
        prompt: prompt4,
        autoApproveAll: true,
        maxIterations: 50,
        onStep: ({ iteration, maxIterations }) => {
            console.log(`  [Шаг ${iteration}/${maxIterations}] запрос к модели...`);
        },
        onToolCall: (tc) => {
            toolCallsT4.push(tc);
            console.log(`  🛠️ Инструмент: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 80)}...)`);
        },
        onToolResult: (tr) => {
            console.log(`     ↳ Результат: ${JSON.stringify(tr.result).slice(0, 80)}...`);
        }
    });

    console.log(`\nТест 4 завершен за ${((Date.now() - t4Start) / 1000).toFixed(1)}с.`);

    check('Тест 4: Агент вызвал создание нового изображения / варианта', toolCallsT4.some(tc => tc.name === 'graphics.create'));
    
    // Проверяем сохранность оригинальной модели
    const originalModelAfter = gfxApi.getModel(originalName);
    check('Тест 4: Оригинальная модель существует в реестре моделей', Boolean(originalModelAfter));
    if (originalModelAfter && originalPixelsBackup.length > 0) {
        let pixelsMatch = true;
        for (let i = 0; i < originalPixelsBackup.length; i++) {
            if (originalModelAfter.pixels[i] !== originalPixelsBackup[i]) {
                pixelsMatch = false;
                break;
            }
        }
        check('Тест 4: Пиксели оригинала полностью сохранены без изменений', pixelsMatch);
        check('Тест 4: Палитра оригинала не была перезаписана', originalModelAfter.paletteIndex === originalPalette);
    }

    console.log('\n=============================================================');
    console.log(`Все тесты завершены! Пройдено: ${passed}, Ошибок: ${failed}`);
    console.log('=============================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runLiveTests().catch((err) => {
    console.error('Критическая ошибка в тесте:', err);
    process.exit(1);
});
