#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-graphics-ai-api.js и инструментов graphics.*
 *
 * Проверяет:
 *   1. Создать 16x16 (graphics.create);
 *   2. Поставить несколько пикселей (graphics.set_pixel);
 *   3. Заполнить область (graphics.fill / graphics.set_pixels);
 *   4. Получить изображение (graphics.get / graphics.get_info / graphics.get_region);
 *   5. Экспортировать ASM (graphics.export_asm);
 *   6. Экспортировать MAC (graphics.export_mac);
 *   7. Сохранить ресурс в проект (graphics.add_to_project);
 *   8. Открыть его существующим графическим редактором (openInEditor);
 *   9. Дополнительные операции: resize, rotate90, clear, export_bin, export_dat, export_bks, save_state;
 *   10. Интеграцию с BKAIToolRegistry (tools.execute('graphics.*'));
 *   11. Валидацию границ и безопасность (отсутствие eval, защита от переполнения памяти).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

// Создаем песочницу VM
const sandbox = {
    console: console,
    ArrayBuffer: ArrayBuffer,
    Uint8Array: Uint8Array,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
};
sandbox.window = sandbox;
sandbox.global = sandbox;

// Mock BKProjectManager
const mockProjectFiles = {};
let activeFileName = 'main.asm';
sandbox.bkProject = {
    files: mockProjectFiles,
    activeFileName: activeFileName,
    getAllFiles: () => Object.assign({}, mockProjectFiles),
    getFileContent: (p) => mockProjectFiles[p] || '',
    setFileContent: (p, c) => { mockProjectFiles[p] = c; return true; },
    writeFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    createFile: (p, c) => { mockProjectFiles[p] = c; return true; },
    addArtifactFile: (p, c) => { mockProjectFiles[p] = c; return true; }
};
mockProjectFiles['main.asm'] = '; Main program\nSTART: NOP\nHALT\n';

// Mock BKGraphicsEditor
let editorOpenedModel = null;
sandbox.BKGraphicsEditor = {
    open: function (opts) {
        editorOpenedModel = (opts && opts.model) ? opts.model : null;
        return editorOpenedModel;
    },
    insertInclude: function (asmPath) {
        const cur = mockProjectFiles['main.asm'] || '';
        mockProjectFiles['main.asm'] = cur + '\n.INCLUDE "' + asmPath + '"\n';
    }
};

vm.createContext(sandbox);

function loadModule(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
}

// Загрузка графических модулей
loadModule('bk-graphics-modes.js');
loadModule('bk-graphics-model.js');
loadModule('bk-graphics-codec.js');
loadModule('bk-graphics-export.js');
loadModule('bk-graphics-ai-api.js');
loadModule('bk-ai-tools.js');
loadModule('bk-ai-agent.js');

let passed = 0;
let failed = 0;

function check(name, condition) {
    if (condition) {
        passed++;
        console.log('PASS: ' + name);
    } else {
        failed++;
        console.error('FAIL: ' + name);
    }
}

async function runTests() {
    console.log('=== Запуск тестов BKStudio Graphics AI API (js/bk-graphics-ai-api.js) ===\n');

    const api = sandbox.bkGraphicsAI;
    const tools = sandbox.bkAITools;

    // 0. Базовая инициализация
    check('Класс BKGraphicsAIApi доступен', typeof sandbox.BKGraphicsAIApi === 'function');
    check('Синглтон bkGraphicsAI создан', typeof api === 'object' && api !== null);
    check('Синглтон bkAITools создан', typeof tools === 'object' && tools !== null);

    // 1. Создать 16x16
    const createRes = api.create({
        mode: 'BK0010_COLOR',
        width: 16,
        height: 16,
        name: 'SPRITE_PLAYER'
    });
    check('graphics.create: успешное создание', createRes.success === true);
    check('graphics.create: ширина 16', createRes.width === 16);
    check('graphics.create: высота 16', createRes.height === 16);
    check('graphics.create: режим BK0010_COLOR', createRes.mode === 'BK0010_COLOR');
    check('graphics.create: 4 цвета', createRes.colors === 4);
    check('graphics.create: имя SPRITE_PLAYER', createRes.name === 'SPRITE_PLAYER');

    // 2. Поставить несколько пикселей (graphics.set_pixel)
    const p1 = api.setPixel({ x: 0, y: 0, colorIndex: 1 });
    const p2 = api.setPixel({ x: 5, y: 5, colorIndex: 2 });
    const p3 = api.setPixel({ x: 15, y: 15, colorIndex: 3 });

    check('set_pixel: пиксель (0,0) установлен в цвет 1', p1.success === true && p1.colorIndex === 1);
    check('set_pixel: пиксель (5,5) установлен в цвет 2', p2.success === true && p2.colorIndex === 2);
    check('set_pixel: пиксель (15,15) установлен в цвет 3', p3.success === true && p3.colorIndex === 3);

    // Проверка считывания пикселей из модели
    const activeModel = api._activeModel;
    check('Модель сохранила пиксель (0,0)', activeModel.getPixel(0, 0) === 1);
    check('Модель сохранила пиксель (5,5)', activeModel.getPixel(5, 5) === 2);
    check('Модель сохранила пиксель (15,15)', activeModel.getPixel(15, 15) === 3);

    // 3. Заполнить область (graphics.fill и graphics.set_pixels)
    // Заливка прямоугольника 4x4 цветом 2 в позиции (2, 2)
    const fillRes = api.fill({
        x: 2,
        y: 2,
        width: 4,
        height: 4,
        colorIndex: 2
    });
    check('graphics.fill: область успешно залита', fillRes.success === true && fillRes.filledCount === 16);
    check('Пиксель внутри залитой области (3,3) равен 2', activeModel.getPixel(3, 3) === 2);
    check('Пиксель вне залитой области (0,0) остался 1', activeModel.getPixel(0, 0) === 1);

    // Установка блока через set_pixels (2D массив)
    const block = [
        [3, 3],
        [3, 3]
    ];
    const setPixelsRes = api.setPixels({
        x: 8,
        y: 8,
        width: 2,
        height: 2,
        pixels: block
    });
    check('graphics.set_pixels: блок 2x2 записан', setPixelsRes.success === true && setPixelsRes.count === 4);
    check('Пиксель блока (8,8) равен 3', activeModel.getPixel(8, 8) === 3);
    check('Пиксель блока (9,9) равен 3', activeModel.getPixel(9, 9) === 3);

    // 4. Получить изображение / область (graphics.get, get_info, get_region)
    const getRes = api.get();
    check('graphics.get: возвращает имя и размеры', getRes.success === true && getRes.width === 16 && getRes.name === 'SPRITE_PLAYER');
    check('graphics.get: возвращает ASCII Matrix', typeof getRes.matrix === 'string' && getRes.matrix.includes('RR'));
    check('graphics.get: НЕ возвращает массив пикселей', getRes.pixels === undefined);

    const infoRes = api.getInfo();
    check('graphics.get_info: расчет байт строки и общего объема', infoRes.bytesPerRow === 4 && infoRes.totalBytes === 64);
    check('graphics.get_info: НЕ возвращает массив пикселей', infoRes.pixels === undefined);

    const regionRes = api.getRegion({ x: 8, y: 8, width: 2, height: 2 });
    check('graphics.get_region: возвращает ASCII matrix 2x2', regionRes.success === true && regionRes.matrix === 'RR\nRR');
    check('graphics.get_region: НЕ возвращает массив pixels', regionRes.pixels === undefined);

    // 5. Экспортировать ASM (graphics.export_asm)
    const asmRes = api.exportAsm({ symbol: 'SPRITE_HERO', radix: 8 });
    check('graphics.export_asm: успешный экспорт', asmRes.success === true);
    check('graphics.export_asm: содержит метку SPRITE_HERO:', asmRes.text.includes('SPRITE_HERO:'));
    check('graphics.export_asm: содержит директиву .BYTE', asmRes.text.includes('.BYTE'));
    check('graphics.export_asm: содержит комментарий с размером', asmRes.text.includes('; Размер: 16x16'));

    // 6. Экспортировать MAC (graphics.export_mac)
    const macRes = api.exportMac({ symbol: 'SPRITE_HERO' });
    check('graphics.export_mac: успешный экспорт .MAC', macRes.success === true && macRes.text.includes('SPRITE_HERO:'));

    // 7. Сохранить ресурс в проект (graphics.add_to_project)
    const addProjRes = api.addToProject({
        name: 'player_sprite',
        folder: 'sprites',
        format: 'ASM',
        insertInclude: true
    });
    check('graphics.add_to_project: файл добавлен в проект', addProjRes.success === true);
    check('graphics.add_to_project: правильный путь sprites/player_sprite.asm', addProjRes.path === 'sprites/player_sprite.asm');
    check('graphics.add_to_project: файл существует в mockProject', typeof mockProjectFiles['sprites/player_sprite.asm'] === 'string');
    check('graphics.add_to_project: вставил .INCLUDE в main.asm', mockProjectFiles['main.asm'].includes('.INCLUDE "sprites/player_sprite.asm"'));

    // 8. Открыть его существующим графическим редактором (openInEditor)
    const openRes = api.openInEditor();
    check('graphics.openInEditor: успешно вызван', openRes.success === true);
    check('BKGraphicsEditor.open получил активную модель', editorOpenedModel === activeModel);

    // 9. Дополнительные операции:
    // resize
    api.resize({ width: 32, height: 32 });
    check('graphics.resize: размеры изменены на 32x32', activeModel.width === 32 && activeModel.height === 32);
    check('graphics.resize: сохранены пиксели (8,8)', activeModel.getPixel(8, 8) === 3);

    // rotate90
    api.rotate90();
    check('graphics.rotate90: выполнил поворот', activeModel.width === 32 && activeModel.height === 32);

    // clear
    api.clear({ colorIndex: 0 });
    check('graphics.clear: очистил все пиксели в 0', activeModel.getPixel(8, 8) === 0);

    // Экспорт экрана 256x256 (BIN, DAT, BKS)
    api.create({ mode: 'BK0011M_COLOR', width: 256, height: 256, paletteIndex: 5, name: 'SCREEN' });
    api.setPixel({ x: 10, y: 10, colorIndex: 2 });

    const binRes = api.exportBin();
    check('graphics.export_bin: длина 16388 байт', binRes.byteLength === 16388);
    check('graphics.export_bin: заголовок адреса 040000', binRes.bytes[0] === 0x00 && binRes.bytes[1] === 0x40);

    const datRes = api.exportDat();
    check('graphics.export_dat: длина 16384 байт', datRes.byteLength === 16384);

    const bksRes = api.exportBks();
    check('graphics.export_bks: длина 16389 байт', bksRes.byteLength === 16389);
    check('graphics.export_bks: байт палитры равен 5', bksRes.bytes[16388] === 5);

    // export_png
    const pngRes = api.exportPng({ name: 'test_screen', folder: 'gfx', saveToProject: true });
    check('graphics.export_png: успешно вызван', pngRes.success === true && pngRes.format === 'PNG');
    check('graphics.export_png: путь к файлу gfx/test_screen.png', pngRes.path === 'gfx/test_screen.png');
    check('graphics.export_png: сигнатура PNG', pngRes.bytes[0] === 0x89 && pngRes.bytes[1] === 0x50 && pngRes.bytes[2] === 0x4E && pngRes.bytes[3] === 0x47);
    check('graphics.export_png: файл сохранен в mockProject', mockProjectFiles['gfx/test_screen.png'] instanceof Uint8Array);

    // export_png с масштабированием
    const pngScaledRes = api.exportPng({ name: 'test_screen', scale: 2, saveToProject: false });
    check('graphics.export_png: масштабирование 2x удваивает размеры', pngScaledRes.width === 512 && pngScaledRes.height === 512);

    // save_state
    const stateRes = api.saveState({ name: 'test_screen', folder: 'gfx', saveToProject: true });
    check('graphics.save_state: содержит сериализацию модели', stateRes.success === true && stateRes.state.width === 256 && stateRes.state.paletteIndex === 5);
    check('graphics.save_state: формат BKGfxState', stateRes.format === 'BKGfxState' && stateRes.state.format === 'BKGfxState');
    check('graphics.save_state: содержит структуру model', typeof stateRes.state.model === 'object' && stateRes.state.model.width === 256);
    check('graphics.save_state: файл сохранен в mockProject', typeof mockProjectFiles['gfx/test_screen.BKGfxState'] === 'string');
    const parsedState = JSON.parse(mockProjectFiles['gfx/test_screen.BKGfxState']);
    check('graphics.save_state: распарсенный JSON валиден', parsedState.format === 'BKGfxState' && parsedState.version === 1);

    // addToProject с форматами PNG и STATE
    const addPngRes = api.addToProject({ name: 'icon', folder: 'gfx', format: 'PNG' });
    check('graphics.add_to_project: формат PNG', addPngRes.success === true && addPngRes.format === 'PNG');
    check('graphics.add_to_project: файл gfx/icon.png создан', mockProjectFiles['gfx/icon.png'] instanceof Uint8Array);

    const addStateRes = api.addToProject({ name: 'icon', folder: 'gfx', format: 'STATE' });
    check('graphics.add_to_project: формат STATE', addStateRes.success === true && addStateRes.format === 'STATE');
    check('graphics.add_to_project: файл gfx/icon.BKGfxState создан', typeof mockProjectFiles['gfx/icon.BKGfxState'] === 'string');

    // addToProject с одновременным сохранением savePng и saveState
    const addComboRes = api.addToProject({ name: 'combo_sprite', folder: 'sprites', format: 'ASM', savePng: true, saveState: true });
    check('graphics.add_to_project: combo сохранил ASM', typeof mockProjectFiles['sprites/combo_sprite.asm'] === 'string');
    check('graphics.add_to_project: combo сохранил PNG рядом', mockProjectFiles['sprites/combo_sprite.png'] instanceof Uint8Array);
    check('graphics.add_to_project: combo сохранил BKGfxState рядом', typeof mockProjectFiles['sprites/combo_sprite.BKGfxState'] === 'string');

    // 10. Интеграция с BKAIToolRegistry (минимальный согласованный набор из 15 инструментов)
    const expectedGfxTools = [
        'graphics.create',
        'graphics.get',
        'graphics.get_region',
        'graphics.set',
        'graphics.patch',
        'graphics.fill',
        'graphics.info',
        'graphics.export_asm',
        'graphics.export_mac',
        'graphics.export_bin',
        'graphics.export_dat',
        'graphics.export_bks',
        'graphics.export_png',
        'graphics.save_state',
        'graphics.add_to_project'
    ];

    for (const toolName of expectedGfxTools) {
        check(`BKAIToolRegistry содержит инструмент ${toolName}`, tools.has(toolName));
    }

    // Проверка точного количества зарегистрированных graphics.* инструментов
    const registeredGfxTools = tools.list().filter(t => t.name.startsWith('graphics.'));
    check('BKAIToolRegistry содержит ровно 15 инструментов graphics.*', registeredGfxTools.length === 15);
    check('BKAIToolRegistry поддерживает псевдоним graphics.save_png', tools.has('graphics.save_png'));

    // Проверка, что устаревшие низкоуровневые и избыточные инструменты скрыты от LLM
    check('graphics.set_pixel скрыт от LLM в registry', !tools.has('graphics.set_pixel'));
    check('graphics.set_pixels скрыт от LLM в registry', !tools.has('graphics.set_pixels'));
    check('graphics.clear скрыт от LLM в registry', !tools.has('graphics.clear'));
    check('graphics.resize скрыт от LLM в registry', !tools.has('graphics.resize'));
    check('graphics.rotate90 скрыт от LLM в registry', !tools.has('graphics.rotate90'));
    check('graphics.get_info скрыт от LLM в registry (заменен на graphics.info)', !tools.has('graphics.get_info'));

    // Проверка вызова через tools.execute
    const toolExecRes = await tools.execute('graphics.create', {
        mode: 'BK0010_COLOR',
        width: 32,
        height: 32,
        name: 'TOOL_SPRITE'
    });
    check('tools.execute("graphics.create") завершился успешно', toolExecRes.success === true && toolExecRes.name === 'TOOL_SPRITE');

    const toolSetRes = await tools.execute('graphics.set', {
        matrix: 'KKRR\nKKRR'
    });
    check('tools.execute("graphics.set") выполнил установку ASCII-матрицы', toolSetRes.success === true && toolSetRes.width === 4 && toolSetRes.height === 2);
    check('tools.execute("graphics.set") НЕ возвращает пиксели', toolSetRes.pixels === undefined && toolSetRes.matrix === undefined);
    check('tools.execute("graphics.set") возвращает message с форматом OK/WxH/changed', toolSetRes.message.includes('OK\n4x2\nchanged:'));

    const toolPatchRes = await tools.execute('graphics.patch', {
        x: 2,
        y: 2,
        matrix: 'GG\nGG'
    });
    check('tools.execute("graphics.patch") выполнил наложение патча', toolPatchRes.success === true && toolPatchRes.width === 2 && toolPatchRes.height === 2);
    check('tools.execute("graphics.patch") НЕ возвращает пиксели', toolPatchRes.pixels === undefined && toolPatchRes.matrix === undefined);
    check('tools.execute("graphics.patch") возвращает message с форматом OK/patched WxH at x,y/changed', toolPatchRes.message === 'OK\npatched 2x2 at 2,2\nchanged: 4 pixels');

    const toolAsmRes = await tools.execute('graphics.export_asm', { symbol: 'SPRITE_TEST' });
    check('tools.execute("graphics.export_asm") сгенерировал asm-код', toolAsmRes.success === true && toolAsmRes.preview.includes('SPRITE_TEST:'));

    // 11. Безопасность и классификация опасных инструментов
    const agent = new sandbox.BKAIAgent();

    // Чтение и генерация в памяти - БЕЗ подтверждения
    check('graphics.info НЕ требует подтверждения', agent.requiresConfirmation('graphics.info') === false);
    check('graphics.get_region НЕ требует подтверждения', agent.requiresConfirmation('graphics.get_region') === false);
    check('graphics.export_asm НЕ требует подтверждения', agent.requiresConfirmation('graphics.export_asm') === false);
    check('graphics.export_mac НЕ требует подтверждения', agent.requiresConfirmation('graphics.export_mac') === false);
    check('graphics.export_bin НЕ требует подтверждения', agent.requiresConfirmation('graphics.export_bin') === false);
    check('graphics.export_dat НЕ требует подтверждения', agent.requiresConfirmation('graphics.export_dat') === false);
    check('graphics.export_bks НЕ требует подтверждения', agent.requiresConfirmation('graphics.export_bks') === false);

    // Модификация изображения - ТРЕБУЕТ подтверждения
    check('graphics.create требует подтверждения', agent.requiresConfirmation('graphics.create') === true);
    check('graphics.set требует подтверждения', agent.requiresConfirmation('graphics.set') === true);
    check('graphics.patch требует подтверждения', agent.requiresConfirmation('graphics.patch') === true);
    check('graphics.fill требует подтверждения', agent.requiresConfirmation('graphics.fill') === true);

    // Запись в проект / состояние - ТРЕБУЕТ подтверждения
    check('graphics.save_state требует подтверждения', agent.requiresConfirmation('graphics.save_state') === true);
    check('graphics.export_png требует подтверждения', agent.requiresConfirmation('graphics.export_png') === true);
    check('graphics.save_png требует подтверждения', agent.requiresConfirmation('graphics.save_png') === true);
    check('graphics.add_to_project требует подтверждения', agent.requiresConfirmation('graphics.add_to_project') === true);

    // Вызовы через реестр инструментов tools.execute
    const toolPngRes = await tools.execute('graphics.export_png', { name: 'tool_pic', folder: 'gfx' });
    check('tools.execute(graphics.export_png) успешен', toolPngRes.success === true && toolPngRes.format === 'PNG');
    check('tools.execute(graphics.export_png) сохранил файл в mockProject', mockProjectFiles['gfx/tool_pic.png'] instanceof Uint8Array);

    const toolSavePngRes = await tools.execute('graphics.save_png', { name: 'tool_alias', folder: 'gfx' });
    check('tools.execute(graphics.save_png) через псевдоним успешен', toolSavePngRes.success === true && toolSavePngRes.format === 'PNG');
    check('tools.execute(graphics.save_png) сохранил файл в mockProject', mockProjectFiles['gfx/tool_alias.png'] instanceof Uint8Array);

    const toolStateRes = await tools.execute('graphics.save_state', { name: 'tool_pic', folder: 'gfx' });
    check('tools.execute(graphics.save_state) успешен', toolStateRes.success === true && toolStateRes.format === 'BKGfxState');
    check('tools.execute(graphics.save_state) сохранил файл в mockProject', typeof mockProjectFiles['gfx/tool_pic.BKGfxState'] === 'string');

    // Защита от переполнения контекста при запросе слишком большого региона
    let overflowCaught = false;
    try {
        api.getRegion({ x: 0, y: 0, width: 256, height: 256 });
    } catch (e) {
        overflowCaught = true;
    }
    check('getRegion отклоняет области больше лимита (защита от переполнения токенов)', overflowCaught === true);

    // Защита от некорректных координат
    let boundsCaught = false;
    try {
        api.setPixel({ x: 999, y: 999, colorIndex: 1 });
    } catch (e) {
        boundsCaught = true;
    }
    check('setPixel валидирует границы координат', boundsCaught === true);

    // 12. Полный агентный цикл (Agent Loop):
    // user → LLM → create → result → LLM → set_pixels → result → LLM → get_info → result → LLM → export_asm → result → LLM → final response
    console.log('\n--- Тестирование реального агентного цикла (Agent Loop) с инструментами graphics.* ---');

    let agentStep = 0;
    const executedToolCalls = [];
    const confirmedTools = [];

    sandbox.bkAI = {
        getConfig: () => ({ maxTokens: 4096 }),
        chat: async (params) => {
            agentStep++;
            if (agentStep === 1) {
                // Шаг 1: LLM решает создать цветной спрайт 16x16
                return {
                    type: 'text',
                    text: 'Создаю цветной спрайт 16x16 для главного героя.',
                    toolCalls: [
                        {
                            id: 'call_1',
                            name: 'graphics.create',
                            arguments: { mode: 'BK0010_COLOR', width: 16, height: 16, name: 'HERO_LOOP' }
                        }
                    ]
                };
            } else if (agentStep === 2) {
                // Шаг 2: LLM рисует блок пикселей через graphics.set
                return {
                    type: 'text',
                    text: 'Теперь рисую пиксели спрайта через ASCII Matrix.',
                    toolCalls: [
                        {
                            id: 'call_2',
                            name: 'graphics.set',
                            arguments: {
                                x: 0,
                                y: 0,
                                matrix: 'BGR\nGRB'
                            }
                        }
                    ]
                };
            } else if (agentStep === 3) {
                // Шаг 3: LLM запрашивает информацию об изображении
                return {
                    type: 'text',
                    text: 'Проверяю геометрию и объем памяти спрайта.',
                    toolCalls: [
                        {
                            id: 'call_3',
                            name: 'graphics.info',
                            arguments: {}
                        }
                    ]
                };
            } else if (agentStep === 4) {
                // Шаг 4: LLM экспортирует спрайт в ассемблер
                return {
                    type: 'text',
                    text: 'Экспортирую спрайт в ассемблерный формат .ASM.',
                    toolCalls: [
                        {
                            id: 'call_4',
                            name: 'graphics.export_asm',
                            arguments: { symbol: 'HERO_SPRITE', radix: 8 }
                        }
                    ]
                };
            } else {
                // Шаг 5: Финальный ответ пользователю
                return {
                    type: 'text',
                    text: 'Спрайт HERO_LOOP 16x16 успешно создан, пиксели нарисованы, объем 64 байта проверен, и ассемблерный код сгенерирован под метку HERO_SPRITE.'
                };
            }
        }
    };

    const loopAgent = new sandbox.BKAIAgent();
    let loopStepsObserved = 0;

    const agentResult = await loopAgent.run({
        prompt: 'Создай цветной спрайт героя 16x16, нарисуй его, проверь размер и экспортируй в ассемблер.',
        onStep: ({ iteration }) => { loopStepsObserved = iteration; },
        onToolCall: (tc) => {
            executedToolCalls.push(tc);
        },
        onRequestConfirmation: async (tc) => {
            confirmedTools.push(tc.name);
            return true; // подтверждаем выполнение
        }
    });

    check('Agent Loop: выполнено 5 шагов диалога с LLM', agentResult.iterations === 5);
    check('Agent Loop: выполнено 4 вызова инструментов', agentResult.toolCallsCount === 4);
    check('Agent Loop: шаг 1 вызвал graphics.create', executedToolCalls[0] && executedToolCalls[0].name === 'graphics.create');
    check('Agent Loop: шаг 2 вызвал graphics.set', executedToolCalls[1] && executedToolCalls[1].name === 'graphics.set');
    check('Agent Loop: шаг 3 вызвал graphics.info', executedToolCalls[2] && executedToolCalls[2].name === 'graphics.info');
    check('Agent Loop: шаг 4 вызвал graphics.export_asm', executedToolCalls[3] && executedToolCalls[3].name === 'graphics.export_asm');

    check('Agent Loop: подтверждение запрошено для graphics.create', confirmedTools.includes('graphics.create'));
    check('Agent Loop: подтверждение запрошено для graphics.set', confirmedTools.includes('graphics.set'));
    check('Agent Loop: подтверждение НЕ запрашивалось для graphics.info', !confirmedTools.includes('graphics.info'));
    check('Agent Loop: подтверждение НЕ запрашивалось для graphics.export_asm', !confirmedTools.includes('graphics.export_asm'));

    check('Agent Loop: модель сформировала итоговый ответ пользователю', agentResult.text.includes('HERO_LOOP 16x16 успешно создан'));

    // Проверяем состояние модели после работы агента
    // =========================================================================
    // Тестирование ASCII Matrix API (matrixToPixels, pixelsToMatrix, validateMatrix)
    // =========================================================================
    console.log('\n--- Тестирование ASCII Matrix API ---');

    // 1. 4x4 matrix -> pixels -> matrix
    const matrix4x4 = [
        'KKBG',
        'RKBK',
        'GRKK',
        'BGRK'
    ].join('\n');
    const pixels4x4 = api.matrixToPixels(matrix4x4, 'BK0010_COLOR');
    check('ASCII 4x4: длина массива 16', pixels4x4.length === 16);
    check('ASCII 4x4: пиксели совпадают с индексами',
        pixels4x4[0] === 0 && pixels4x4[1] === 0 && pixels4x4[2] === 1 && pixels4x4[3] === 2 &&
        pixels4x4[4] === 3 && pixels4x4[5] === 0 && pixels4x4[6] === 1 && pixels4x4[7] === 0
    );
    const restored4x4 = api.pixelsToMatrix(pixels4x4, 4, 4, 'BK0010_COLOR');
    check('ASCII 4x4: pixelsToMatrix восстанавливает исходную матрицу', restored4x4 === matrix4x4);

    // 2. 16x16 matrix (все символы допустимых цветов, фон K)
    const matrix16x16 = [
        'KKKKKKKKKKKKKKKK',
        'KKKKBBKKKKBBKKKK',
        'KKKBBBBKKBBBBKKK',
        'KKKBBBBKKBBBBKKK',
        'KKKKBBBBBBBBKKKK',
        'KKKKKGGGGGGKKKKK',
        'KKKKGGGGGGGGKKKK',
        'KKKGGGGGGGGGGKKK',
        'KKKGGGGGGGGGGKKK',
        'KKKKGGGGGGGGKKKK',
        'KKKKKGGGGGGKKKKK',
        'KKKKKKGGGGKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK'
    ].join('\n');
    const pixels16x16 = api.matrixToPixels(matrix16x16, 'BK0010_COLOR');
    check('ASCII 16x16: длина массива 256', pixels16x16.length === 256);
    check('ASCII 16x16: width и height в массиве', pixels16x16.width === 16 && pixels16x16.height === 16);
    const restored16x16 = api.pixelsToMatrix(pixels16x16, 16, 16, 'BK0010_COLOR');
    check('ASCII 16x16: обратное преобразование идентично', restored16x16 === matrix16x16);

    // 3. точка '.' запрещена
    const dotMatrix = '....\n....';
    const dotVal = api.validateMatrix(dotMatrix, 4, 2, 'BK0010_COLOR');
    check('ASCII точка запрещена: validateMatrix возвращает valid: false', dotVal.valid === false);
    check('ASCII точка запрещена: сообщение об ошибке', dotVal.error.includes("'.' (transparent) is not supported"));

    // 4. все поддерживаемые цвета (BK0010_COLOR: K, B, G, R и BK0010_MONO: K, W)
    const allColorsColor = 'KBGR';
    const allColorPixels = api.matrixToPixels(allColorsColor, 'BK0010_COLOR');
    check('ASCII цвета: BK0010_COLOR K=0, B=1, G=2, R=3',
        allColorPixels[0] === 0 && allColorPixels[1] === 1 && allColorPixels[2] === 2 && allColorPixels[3] === 3
    );

    const allColorsMono = 'KW';
    const allMonoPixels = api.matrixToPixels(allColorsMono, 'BK0010_MONO');
    check('ASCII цвета: BK0010_MONO K=0, W=1',
        allMonoPixels[0] === 0 && allMonoPixels[1] === 1
    );
    const restoredMono = api.pixelsToMatrix(allMonoPixels, 2, 1, 'BK0010_MONO');
    check('ASCII цвета: BK0010_MONO обратное преобразование KW', restoredMono === 'KW');

    // 5. неправильная ширина
    const invalidWidthMatrix = [
        'KKKK',
        'KKK',
        'KKKK'
    ].join('\n');
    const widthCheck = api.validateMatrix(invalidWidthMatrix, 4, 3, 'BK0010_COLOR');
    check('ASCII ошибка ширины: валидация возвращает false', widthCheck.valid === false);
    check('ASCII ошибка ширины: корректное сообщение об ошибке', widthCheck.error === 'ERROR: row 2 must contain exactly 4 characters (found 3)');

    let widthThrew = false;
    try {
        api.matrixToPixels(invalidWidthMatrix, 'BK0010_COLOR', { width: 4, height: 3 });
    } catch (e) {
        widthThrew = true;
        check('ASCII ошибка ширины: matrixToPixels выбрасывает исключение с текстом', e.message.includes('ERROR: row 2 must contain exactly 4 characters'));
    }
    check('ASCII ошибка ширины: исключение сработало', widthThrew);

    // 6. неправильное количество строк
    const invalidRowsMatrix = [
        'KKKK',
        'KKKK'
    ].join('\n');
    const rowsCheck = api.validateMatrix(invalidRowsMatrix, 4, 3, 'BK0010_COLOR');
    check('ASCII ошибка строк: валидация возвращает false', rowsCheck.valid === false);
    check('ASCII ошибка строк: сообщение ожидалось 3 строки, получено 2', rowsCheck.error === 'ERROR: expected 3 rows, received 2');

    // 7. неизвестный символ
    const unknownCharMatrix = [
        'KKXK',
        'KKKK'
    ].join('\n');
    const unknownCheck = api.validateMatrix(unknownCharMatrix, 4, 2, 'BK0010_COLOR');
    check('ASCII неизвестный символ: валидация возвращает false', unknownCheck.valid === false);
    check('ASCII неизвестный символ: сообщение об ошибке', unknownCheck.error === "ERROR_INVALID_CHARACTER: unsupported character 'X'");

    // 8. несовместимый цвет для режима
    const incompatibleColorMatrix = [
        'KKRK',
        'KKKK'
    ].join('\n');
    const incompCheck = api.validateMatrix(incompatibleColorMatrix, 4, 2, 'BK0010_MONO');
    check('ASCII несовместимый цвет: валидация возвращает false', incompCheck.valid === false);
    check('ASCII несовместимый цвет: сообщение с указанием режима', incompCheck.error === "ERROR_INVALID_COLOR: unsupported color 'R' for mode BK0010_MONO");

    // =========================================================================
    // Тестирование graphics.set: создание, атомарность и поведение
    // =========================================================================
    console.log('\n--- Тестирование инструмента graphics.set ---');

    // Тест создания 16x16 изображения прямо через graphics.set
    const set16x16Res = api.set({
        name: 'SPRITE_16x16_ATOMIC',
        matrix: matrix16x16
    });
    check('graphics.set: успешный вызов', set16x16Res.success === true);
    check('graphics.set: размер 16x16 определен из матрицы', set16x16Res.width === 16 && set16x16Res.height === 16);
    check('graphics.set: количество измененных пикселей 256', set16x16Res.changed === 256);
    check('graphics.set: точный текст message', set16x16Res.message === 'OK\n16x16\nchanged: 256 pixels');
    check('graphics.set: НЕ возвращает массив pixels', set16x16Res.pixels === undefined);
    check('graphics.set: НЕ возвращает matrix в результате', set16x16Res.matrix === undefined);

    // Проверяем, что созданная модель содержит правильные данные
    const atomicModel = api.getModel('SPRITE_16x16_ATOMIC');
    check('Модель SPRITE_16x16_ATOMIC создана в памяти', atomicModel !== null);
    check('Модель имеет размеры 16x16', atomicModel.width === 16 && atomicModel.height === 16);
    check('Пиксель (4, 1) равен B (индекс 1)', atomicModel.getPixel(4, 1) === 1);
    check('Пиксель (5, 5) равен G (индекс 2)', atomicModel.getPixel(5, 5) === 2);
    check('Пиксель (6, 12) равен K (индекс 0)', atomicModel.getPixel(6, 12) === 0);

    // Тест атомарности: если matrix невалидна, BKGraphicsModel НЕ изменяется
    const pixelsBeforeBad = Array.from(atomicModel.pixels);

    let atomicityErrorCaught = false;
    try {
        // Передаем некорректную матрицу: содержит неизвестный символ 'Z'
        api.set({
            name: 'SPRITE_16x16_ATOMIC',
            x: 0,
            y: 0,
            matrix: 'KKZZKK\nKKKKKK'
        });
    } catch (e) {
        atomicityErrorCaught = true;
    }
    check('Атомарность: невалидная матрица (символ Z) вызвала ошибку', atomicityErrorCaught === true);

    // Проверяем, что пиксели модели ПОЛНОСТЬЮ совпадают с состоянием до вызова
    const pixelsAfterBad = Array.from(atomicModel.pixels);
    const arePixelsIdentical = pixelsBeforeBad.every((val, idx) => val === pixelsAfterBad[idx]);
    check('Атомарность: пиксели BKGraphicsModel не изменились после ошибки валидации', arePixelsIdentical === true);

    // Тест атомарности: выход за границы изображения
    let boundsErrorCaught = false;
    try {
        api.set({
            name: 'SPRITE_16x16_ATOMIC',
            x: 10,
            y: 10,
            matrix: [
                'BBBBBBBB',
                'BBBBBBBB'
            ].join('\n')
        });
    } catch (e) {
        boundsErrorCaught = true;
    }
    check('Атомарность: выход за границы (x=10 + w=8 > 16) вызвал ошибку', boundsErrorCaught === true);

    const pixelsAfterBounds = Array.from(atomicModel.pixels);
    const arePixelsStillIdentical = pixelsBeforeBad.every((val, idx) => val === pixelsAfterBounds[idx]);
    check('Атомарность: пиксели BKGraphicsModel не изменились после ошибки границ', arePixelsStillIdentical === true);

    // =========================================================================
    // Тестирование graphics.patch: наложение 8x4 на 16x16, проверка границ и изоляции пикселей
    // =========================================================================
    console.log('\n--- Тестирование инструмента graphics.patch ---');

    // 1. Создаем чистое изображение 16x16
    api.create({
        name: 'PATCH_TARGET_16x16',
        mode: 'BK0010_COLOR',
        width: 16,
        height: 16
    });
    const patchModel = api.getModel('PATCH_TARGET_16x16');
    check('Создано тестовое изображение 16x16 для patch', patchModel !== null && patchModel.width === 16 && patchModel.height === 16);

    // 2. Снимок пикселей до наложения патча (все 0)
    const pixelsBeforePatch = Array.from(patchModel.pixels);
    check('Изображение изначально заполнено нулями', pixelsBeforePatch.every(p => p === 0));

    // 3. Вызываем patch: x=4, y=4, матрица 8x4 (только допустимые цвета)
    const patchMatrix8x4 = [
        'KKRRKKRR',
        'KRRRRRRR',
        'KRRRRRRR',
        'KKRRKKRR'
    ].join('\n');

    const patchRes = api.patch({
        name: 'PATCH_TARGET_16x16',
        x: 4,
        y: 4,
        matrix: patchMatrix8x4
    });

    check('graphics.patch: успешный вызов', patchRes.success === true);
    check('graphics.patch: координаты x=4, y=4', patchRes.x === 4 && patchRes.y === 4);
    check('graphics.patch: размер 8x4 определен из матрицы', patchRes.width === 8 && patchRes.height === 4);
    check('graphics.patch: изменилось 32 пикселя', patchRes.changed === 32);
    check('graphics.patch: точный текст сообщения', patchRes.message === 'OK\npatched 8x4 at 4,4\nchanged: 32 pixels');
    check('graphics.patch: НЕ возвращает массив pixels', patchRes.pixels === undefined);
    check('graphics.patch: НЕ возвращает matrix в результате', patchRes.matrix === undefined);

    // 4. Проверяем, что внутри области патча пиксели установлены корректно
    // Строка 0 (y=4): 'KKRRKKRR' -> c=0..1: 0, c=2..3: 3, c=4..5: 0, c=6..7: 3
    check('Патч: пиксель (4,4) установлен в K (0)', patchModel.getPixel(4, 4) === 0);
    check('Патч: пиксель (5,4) установлен в K (0)', patchModel.getPixel(5, 4) === 0);
    check('Патч: пиксель (6,4) установлен в R (3)', patchModel.getPixel(6, 4) === 3);
    check('Патч: пиксель (7,4) установлен в R (3)', patchModel.getPixel(7, 4) === 3);
    check('Патч: пиксель (11,4) установлен в R (3)', patchModel.getPixel(11, 4) === 3);

    // Строка 1 (y=5): 'KRRRRRRR' -> c=0: 0, c=1..7: 3
    check('Патч: пиксель (4,5) установлен в K (0)', patchModel.getPixel(4, 5) === 0);
    check('Патч: пиксель (5,5) установлен в R (3)', patchModel.getPixel(5, 5) === 3);
    check('Патч: пиксель (11,5) установлен в R (3)', patchModel.getPixel(11, 5) === 3);

    // 5. КРИТИЧЕСКАЯ ПРОВЕРКА: Проверить, что остальные пиксели изображения не изменились!
    let outsideModified = false;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const isInsidePatch = (x >= 4 && x < 12 && y >= 4 && y < 8);
            if (!isInsidePatch) {
                if (patchModel.getPixel(x, y) !== 0) {
                    outsideModified = true;
                }
            }
        }
    }
    check('Остальные пиксели изображения (вне области 8x4 at 4,4) не изменились', outsideModified === false);

    // 6. Проверка выхода за границы (не обрезать автоматически, точный текст ошибки)
    let patchBoundsError = null;
    const pixelsBeforeOut = Array.from(patchModel.pixels);
    try {
        api.patch({
            name: 'PATCH_TARGET_16x16',
            x: 12,
            y: 14,
            matrix: patchMatrix8x4
        });
    } catch (e) {
        patchBoundsError = e.message;
    }
    check('graphics.patch: выход за границы (x=12, y=14) вызвал ошибку', patchBoundsError !== null);
    check('graphics.patch: точный текст ошибки выхода за границы', patchBoundsError === 'ERROR: patch 8x4 at (12,14) exceeds image 16x16');

    // Проверяем, что модель не была частично повреждена при ошибке выхода за границы
    const pixelsAfterOut = Array.from(patchModel.pixels);
    const unchangedAfterBounds = pixelsBeforeOut.every((v, i) => v === pixelsAfterOut[i]);
    check('Атомарность patch: модель не изменилась при выходе за границы', unchangedAfterBounds === true);

    // 7. Проверка валидации невалидной матрицы (неизвестный символ)
    let patchSyntaxError = null;
    try {
        api.patch({
            name: 'PATCH_TARGET_16x16',
            x: 0,
            y: 0,
            matrix: 'KKZZ\nKKKK'
        });
    } catch (e) {
        patchSyntaxError = e.message;
    }
    check('graphics.patch: невалидный символ вызвал ошибку', patchSyntaxError !== null);
    const pixelsAfterSyntax = Array.from(patchModel.pixels);
    const unchangedAfterSyntax = pixelsBeforeOut.every((v, i) => v === pixelsAfterSyntax[i]);
    check('Атомарность patch: модель не изменилась при невалидной матрице', unchangedAfterSyntax === true);

    // 8. Проверка ограничений на патологически большие матрицы (AI API limits)
    console.log('\n--- Тестирование ограничений AI API (защита от переполнения токенов) ---');

    // 8a. Превышение максимального количества символов (> 150000)
    const hugeCharsMatrix = 'K'.repeat(150001);
    const hugeCharsCheck = api.validateMatrix(hugeCharsMatrix);
    check('AI API: превышение 150000 символов отклоняется', hugeCharsCheck.valid === false);
    check('AI API: текст ошибки превышения символов', hugeCharsCheck.error.includes('exceeds maximum limit (150000 characters)'));

    // 8b. Превышение максимальной ширины (> 512 колонок)
    const wideMatrix = 'K'.repeat(513);
    const wideCheck = api.validateMatrix(wideMatrix);
    check('AI API: ширина 513 колонок отклоняется', wideCheck.valid === false);
    check('AI API: текст ошибки превышения ширины', wideCheck.error.includes('exceeds maximum limit (512 columns)'));

    // 8c. Превышение максимальной высоты (> 256 строк)
    const tallMatrix = new Array(257).fill('KKKK').join('\n');
    const tallCheck = api.validateMatrix(tallMatrix);
    check('AI API: высота 257 строк отклоняется', tallCheck.valid === false);
    check('AI API: текст ошибки превышения высоты', tallCheck.error.includes('exceeds maximum limit (256 rows)'));

    // 8d. Допустимость полного экрана БК 256x256
    const bk256Line = 'K'.repeat(256);
    const bk256Matrix = new Array(256).fill(bk256Line).join('\n');
    const bk256Check = api.validateMatrix(bk256Matrix, 256, 256, 'BK0010_COLOR');
    check('AI API: полный экран БК 256x256 валидируется успешно', bk256Check.valid === true);
    check('AI API: 256x256 width=256, height=256', bk256Check.width === 256 && bk256Check.height === 256);

    // 8e. Превышение лимита patch (> 128x128)
    const largePatchMatrix = new Array(130).fill('K'.repeat(130)).join('\n');
    let largePatchError = null;
    try {
        api.patch({
            name: 'PATCH_TARGET_16x16',
            x: 0,
            y: 0,
            matrix: largePatchMatrix
        });
    } catch (e) {
        largePatchError = e.message;
    }
    check('AI API: patch 130x130 превышает лимит 128x128', largePatchError !== null);
    check('AI API: сообщение ошибки patch лимита', largePatchError && largePatchError.includes('exceed maximum patch limit (128x128)'));

    // =========================================================================
    // ТЕСТЫ ЭТАПА 4 (A, B, C, D, E)
    // =========================================================================
    console.log('\n=== Запуск целевых тестов ЭТАПА 4 (A, B, C, D, E) ===');

    // ТЕСТ A — повторный create
    console.log('--- Тест A: повторный create ---');
    const shipCreateRes = api.create({ name: 'SHIP', width: 16, height: 16, mode: 'BK0010_COLOR' });
    check('Тест A: create SHIP 16x16 -> success', shipCreateRes.success === true && shipCreateRes.name === 'SHIP');

    const shipSetRes = api.set({
        name: 'SHIP',
        matrix: [
            'KKKKRRRRRRRRKKKK',
            'KKKRRRRRRRRRRKKK',
            'KKRRRRRRRRRRRRKK',
            'KRRRRRRRRRRRRRRK',
            'KRRRRRRRRRRRRRRK',
            'KKRRRRRRRRRRRRKK',
            'KKKRRRRRRRRRRKKK',
            'KKKKRRRRRRRRKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK',
            'KKKKKKKKKKKKKKKK'
        ].join('\n')
    });
    check('Тест A: set SHIP -> success', shipSetRes.success === true);

    const shipBeforeSecondCreate = api.get({ name: 'SHIP' });

    let secondCreateError = null;
    try {
        api.create({ name: 'SHIP', width: 16, height: 16, mode: 'BK0010_COLOR' });
    } catch (e) {
        secondCreateError = e.message;
    }
    check('Тест A: second create -> ERROR_ALREADY_EXISTS',
        secondCreateError !== null && secondCreateError.includes('ERROR_ALREADY_EXISTS: graphics "SHIP" already exists. Use graphics.set to replace its contents.')
    );

    const shipAfterSecondCreate = api.get({ name: 'SHIP' });
    check('Тест A: get SHIP возвращает исходное изображение без изменений',
        shipAfterSecondCreate.matrix === shipBeforeSecondCreate.matrix &&
        shipAfterSecondCreate.width === shipBeforeSecondCreate.width &&
        shipAfterSecondCreate.height === shipBeforeSecondCreate.height &&
        shipAfterSecondCreate.mode === shipBeforeSecondCreate.mode
    );

    // ТЕСТ B — copyFrom
    console.log('--- Тест B: copyFrom ---');
    const copyRes = api.create({
        name: 'SHIP_COPY',
        width: 16,
        height: 16,
        mode: 'BK0010_COLOR',
        copyFrom: 'SHIP'
    });
    check('Тест B: create SHIP_COPY copyFrom=SHIP -> success', copyRes.success === true && copyRes.name === 'SHIP_COPY');

    const originalGet = api.get({ name: 'SHIP' });
    const copyGet = api.get({ name: 'SHIP_COPY' });
    check('Тест B: get SHIP_COPY возвращает полную копию исходного изображения', copyGet.matrix === originalGet.matrix);

    // Ошибка при copyFrom несуществующего объекта
    let badCopyError = null;
    try {
        api.create({
            name: 'BAD_COPY',
            width: 16,
            height: 16,
            mode: 'BK0010_COLOR',
            copyFrom: 'NON_EXISTENT_SOURCE'
        });
    } catch (e) {
        badCopyError = e.message;
    }
    check('Тест B: copyFrom несуществующего объекта возвращает ошибку ERROR_NOT_FOUND',
        badCopyError !== null && badCopyError.includes('ERROR_NOT_FOUND')
    );
    check('Тест B: пустой объект BAD_COPY не был создан', api.getModel('BAD_COPY') === null);

    // ТЕСТ C — K вместо точки
    console.log('--- Тест C: K вместо точки ---');
    const testCMatrix = [
        'KKKK',
        'KRRK',
        'KRRK',
        'KKKK'
    ].join('\n');

    const testCPixels = api.matrixToPixels(testCMatrix, 'BK0010_COLOR');
    check('Тест C: matrixToPixels K -> pixel index 0',
        testCPixels[0] === 0 && testCPixels[1] === 0 && testCPixels[2] === 0 && testCPixels[3] === 0 &&
        testCPixels[4] === 0 && testCPixels[5] === 3 && testCPixels[6] === 3 && testCPixels[7] === 0
    );

    const testCRestored = api.pixelsToMatrix(testCPixels, 4, 4, 'BK0010_COLOR');
    check('Тест C: pixelsToMatrix pixel index 0 -> K', testCRestored === testCMatrix);

    api.create({ name: 'TEST_C_IMAGE', width: 4, height: 4, mode: 'BK0010_COLOR' });
    api.set({ name: 'TEST_C_IMAGE', matrix: testCMatrix });
    const testCGet = api.get({ name: 'TEST_C_IMAGE' });
    check('Тест C: graphics.get() возвращает матрицу с K и без точек', testCGet.matrix === testCMatrix && !testCGet.matrix.includes('.'));

    // ТЕСТ D — точка должна быть запрещена
    console.log('--- Тест D: точка должна быть запрещена ---');
    const testDDotMatrix = [
        '....',
        '.KK.',
        '.KK.',
        '....'
    ].join('\n');

    const testDVal = api.validateMatrix(testDDotMatrix, 4, 4, 'BK0010_COLOR');
    check('Тест D: validateMatrix бракует точку с ERROR_INVALID_CHARACTER',
        testDVal.valid === false && testDVal.error.includes("ERROR_INVALID_CHARACTER: '.' (transparent) is not supported")
    );

    const testCBeforeD = api.get({ name: 'TEST_C_IMAGE' });
    let testDSetError = null;
    try {
        api.set({ name: 'TEST_C_IMAGE', matrix: testDDotMatrix });
    } catch (e) {
        testDSetError = e.message;
    }
    check('Тест D: graphics.set с точкой выбрасывает ошибку', testDSetError !== null && testDSetError.includes('ERROR_INVALID_CHARACTER'));
    const testCAfterD = api.get({ name: 'TEST_C_IMAGE' });
    check('Тест D: матрица с точкой не изменила изображение (атомарность)', testCAfterD.matrix === testCBeforeD.matrix);

    // ТЕСТ E — регион
    console.log('--- Тест E: регион ---');
    api.create({ name: 'TEST_E_IMAGE', width: 16, height: 16, mode: 'BK0010_COLOR' });
    const testEMatrix = [
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKRRRRGGGGKKKK',
        'KKKKRRRRGGGGKKKK',
        'KKKKBBBBKKKKKKKK',
        'KKKKBBBBKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK',
        'KKKKKKKKKKKKKKKK'
    ].join('\n');
    api.set({ name: 'TEST_E_IMAGE', matrix: testEMatrix });

    const testERegionRes = api.getRegion({ name: 'TEST_E_IMAGE', x: 2, y: 2, width: 10, height: 6 });
    check('Тест E: graphics.get_region вернул матрицу', typeof testERegionRes.matrix === 'string');
    check('Тест E: результат get_region НИКОГДА не содержит точки "."', !testERegionRes.matrix.includes('.'));

    const allowedCharsRegex = /^[KRGBYCMW\n]+$/;
    check('Тест E: результат get_region содержит только допустимые цветовые символы (K, R, G, B)',
        allowedCharsRegex.test(testERegionRes.matrix)
    );

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});

