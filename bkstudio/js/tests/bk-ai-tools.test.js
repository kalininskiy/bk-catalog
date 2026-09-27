#!/usr/bin/env node
/**
 * BKStudio - Тесты контролируемого Tool API для AI (js/bk-ai-tools.js)
 *
 * Проверяет:
 *   - Создание классов BKAITool, BKAIToolRegistry и глобального объекта window.bkAITools;
 *   - Интеграцию с window.bkAI (bkAI.getTools(), bkAI.executeTool());
 *   - Наличие у каждого инструмента имени, описания, JSON schema параметров и функции execute;
 *   - Экспорт схем в форматах OpenAI (type: "function") и Anthropic (input_schema);
 *   - Безопасность: отсутствие eval(), валидацию аргументов, изоляцию от DOM;
 *   - Инструменты project.* (list_files, read_file, write_file, create_file, delete_file, get_project_info);
 *   - Инструменты build.* (compile, get_listing, get_diagnostics);
 *   - Инструменты emulator.* (run, reset, getScreenShot);
 *   - Инструменты debug.* (get_registers, read_memory, disassemble, step, pause, continue, set_breakpoint, clear_breakpoint);
 *   - Обработку восьмеричных адресов PDP-11 (octal / decimal / hex).
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

// Создаем изолированное окружение
const fakeStorage = {};
const fakeLocalStorage = {
    getItem: (k) => fakeStorage[k] || null,
    setItem: (k, v) => { fakeStorage[k] = String(v); },
    removeItem: (k) => { delete fakeStorage[k]; },
    clear: () => { for (const k in fakeStorage) delete fakeStorage[k]; }
};

// Поддельный BKProjectManager
class MockProjectManager {
    constructor() {
        this.files = {
            'main.asm': 'START:\n  MOV #40000, R1\n  EMT 14\n  HALT',
            'sub.asm': 'SUB1:\n  RTS PC',
            'main.bin': new Uint8Array([0o000, 0o002, 0o100, 0o000, 0x01, 0x02]),
            'main.lst': '001000 012701 040000 START: MOV #40000, R1\n001006 104014        EMT 14\n001010 000000        HALT'
        };
        this.activeFileName = 'main.asm';
        this.settings = {
            platform: 'BK-0010',
            startAddress: '1000',
            format: 'bin'
        };
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
        if (Object.keys(this.files).length <= 1) return false;
        delete this.files[name];
        return true;
    }
    updateSetting(k, v) { this.settings[k] = v; }
}

// Поддельный Monaco Editor
let editorContent = 'START:\n  MOV #40000, R1\n  EMT 14\n  HALT';
const mockEditor = {
    getValue: () => editorContent,
    setValue: (val) => { editorContent = val; }
};

// Поддельный CompilerBridge
const mockCompilerBridge = {
    compiler: 'bkturbo8',
    getCompiler: function () { return this.compiler; },
    setCompiler: function (c) { this.compiler = c; },
    compileWithMacro11: async () => ({ success: true, loadAddress: 0o1000, binData: new Uint8Array(20) }),
    compileWithPdpy11: async () => ({ success: true, loadAddress: 0o1000, bin: new Uint8Array(20) })
};

// Поддельный CompilerService
const mockCompilerService = {
    compile: async () => ({ success: true, loadAddress: 0o1000, binData: new Uint8Array(20), errors: [] })
};

// Поддельный BKEmulatorBridge
const debugCalls = [];
const mockEmulatorBridge = {
    runs: [],
    resets: 0,
    setBoot: () => {},
    setPlatform: () => {},
    runBinary: function (filename, data, platform) {
        this.runs.push({ filename, data, platform });
        return true;
    },
    reset: function () {
        this.resets++;
    },
    debug: async function (method, ...args) {
        debugCalls.push({ method, args });
        if (method === 'getRegisters') {
            return { R0: 0, R1: 0o40000, R2: 0, R3: 0, R4: 0, R5: 0, SP: 0o1000, PC: 0o1002, PSW: 0 };
        }
        if (method === 'readMemory') {
            return [0o012701, 0o040000, 0o104014, 0o000000];
        }
        if (method === 'disassemble') {
            return ['001000: MOV #40000, R1', '001006: EMT 14', '001010: HALT'];
        }
        if (method === 'getScreenShot') {
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...';
        }
        if (method === 'getPC') return 0o1000;
        return { ok: true, method };
    }
};

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    bkProject: new MockProjectManager(),
    editor: mockEditor,
    compilerBridge: mockCompilerBridge,
    compilerService: mockCompilerService,
    emulatorBridge: mockEmulatorBridge,
    currentListingText: '001000 012701 040000 START: MOV #40000, R1\n001006 104014 EMT 14',
    monacoMarkers: [
        { file: 'main.asm', line: 2, column: 3, message: 'Тестовое предупреждение', severity: 2 }
    ]
};
sandbox.window = sandbox;
sandbox.global = sandbox;

const context = vm.createContext(sandbox);

// Подключаем модули BKAI
const codeNormalizer = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf-8');
const codeContext = fs.readFileSync(path.join(JS_DIR, 'bk-ai-context.js'), 'utf-8');
const codeManager = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf-8');
const codeTools = fs.readFileSync(path.join(JS_DIR, 'bk-ai-tools.js'), 'utf-8');

vm.runInContext(codeNormalizer, context);
vm.runInContext(codeContext, context);
vm.runInContext(codeManager, context);
vm.runInContext(codeTools, context);

async function runTests() {
    console.log('=== Запуск тестов BKStudio AI Controlled Tool API (js/bk-ai-tools.js) ===\n');

    const tools = context.bkAITools;
    const bkAI = context.bkAI;

    // 1. Инициализация и классы
    check('Класс BKAITool объявлен', typeof context.BKAITool === 'function');
    check('Класс BKAIToolRegistry объявлен', typeof context.BKAIToolRegistry === 'function');
    check('Глобальный объект window.bkAITools создан', typeof tools === 'object' && tools !== null);
    check('bkAI.getTools() возвращает реестр инструментов', bkAI.getTools() === tools);
    check('bkAI.executeTool() объявлена', typeof bkAI.executeTool === 'function');

    // 2. Список инструментов и их валидность
    const toolList = tools.list();
    check(`Зарегистрировано инструментов: ${toolList.length}`, toolList.length >= 15);

    const requiredNames = [
        'project.list_files',
        'project.read_file',
        'project.write_file',
        'project.create_file',
        'project.delete_file',
        'project.get_project_info',
        'build.compile',
        'build.get_listing',
        'build.get_diagnostics',
        'emulator.run',
        'emulator.reset',
        'emulator.getScreenShot',
        'debug.get_registers',
        'debug.read_memory',
        'debug.disassemble',
        'debug.step',
        'debug.pause',
        'debug.continue',
        'debug.set_breakpoint',
        'debug.clear_breakpoint'
    ];

    let allMetaOk = true;
    for (const name of requiredNames) {
        const t = tools.get(name);
        if (!t || !t.description || !t.parameters || typeof t.execute !== 'function') {
            allMetaOk = false;
            break;
        }
        if (t.parameters.type !== 'object') {
            allMetaOk = false;
            break;
        }
    }
    check('Все обязательные инструменты имеют имя, описание, JSON Schema параметров и функцию execute', allMetaOk);

    // 3. Форматы экспорта схем (OpenAI и Anthropic)
    const openaiSchemas = tools.getSchemas('openai');
    check('Схемы OpenAI: format type === "function"', openaiSchemas.every(s => s.type === 'function' && s.function && s.function.name));

    const anthropicSchemas = tools.getSchemas('anthropic');
    check('Схемы Anthropic: наличие input_schema', anthropicSchemas.every(s => s.name && s.input_schema && s.input_schema.type === 'object'));

    // 4. Безопасность
    const fakeExec = await tools.execute('non_existent_tool', {});
    check('Несуществующий инструмент безопасно возвращает ошибку success: false', fakeExec.success === false && fakeExec.error.includes('не найден'));

    const jsonParseErr = await tools.execute('project.list_files', '{ invalid-json');
    check('Некорректная JSON-строка аргументов возвращает ошибку success: false', jsonParseErr.success === false && jsonParseErr.error.includes('JSON'));

    // Исходный код js/bk-ai-tools.js не должен содержать eval()
    check('Код bk-ai-tools.js НЕ содержит вызовов eval()', !codeTools.includes('eval('));

    // 5. Тестирование project.*
    // 5.1 project.list_files
    const listRes = await tools.execute('project.list_files', {});
    check('project.list_files: возвращает success: true', listRes.success === true);
    check('project.list_files: находит main.asm и sub.asm', listRes.files.some(f => f.name === 'main.asm') && listRes.files.some(f => f.name === 'sub.asm'));
    check('project.list_files: определяет активный файл', listRes.activeFileName === 'main.asm');

    // 5.2 project.read_file (из Monaco Editor)
    const readActive = await tools.execute('project.read_file', { path: 'main.asm' });
    check('project.read_file: читает актуальное содержимое активного файла', readActive.success === true && readActive.content.includes('MOV #40000, R1'));

    // project.read_file (из файлов проекта)
    const readSub = await tools.execute('project.read_file', { path: 'sub.asm' });
    check('project.read_file: читает неактивный файл sub.asm', readSub.success === true && readSub.content === 'SUB1:\n  RTS PC');

    // project.read_file (несуществующий)
    const readMissing = await tools.execute('project.read_file', { path: 'ghost.asm' });
    check('project.read_file: ошибка для отсутствующего файла', readMissing.success === false && readMissing.error.includes('не найден'));

    // 5.3 project.write_file
    const writeRes = await tools.execute('project.write_file', { path: 'main.asm', content: 'START:\n  NOP\n  HALT' });
    check('project.write_file: успешная запись в файл', writeRes.success === true);
    check('project.write_file: обновил содержимое в Monaco Editor', editorContent === 'START:\n  NOP\n  HALT');
    check('project.write_file: обновил содержимое в bkProject', context.bkProject.getFileContent('main.asm') === 'START:\n  NOP\n  HALT');

    // 5.4 project.create_file
    const createRes = await tools.execute('project.create_file', { path: 'new_module.asm', content: '; New module' });
    check('project.create_file: файл успешно создан', createRes.success === true);
    check('project.create_file: файл появился в bkProject', context.bkProject.getFileContent('new_module.asm') === '; New module');

    // project.create_file повторно (дубликат)
    const createDup = await tools.execute('project.create_file', { path: 'new_module.asm' });
    check('project.create_file: дубликат отклонен с ошибкой', createDup.success === false);

    // 5.5 project.delete_file
    const delRes = await tools.execute('project.delete_file', { path: 'new_module.asm' });
    check('project.delete_file: файл удален', delRes.success === true);
    check('project.delete_file: файла больше нет в bkProject', !context.bkProject.files['new_module.asm']);

    // 5.6 project.get_project_info
    const infoRes = await tools.execute('project.get_project_info', {});
    check('project.get_project_info: платформа BK-0010', infoRes.platform === 'BK-0010');
    check('project.get_project_info: адрес 1000', infoRes.startAddress === '1000');

    // 6. Тестирование build.*
    // 6.1 build.compile
    const compileRes = await tools.execute('build.compile', { compiler: 'bkturbo8' });
    check('build.compile: сборка завершилась успехом', compileRes.success === true);
    check('build.compile: возвращен начальный адрес в 8-ричной форме', compileRes.loadAddress === '01000');

    // 6.2 build.get_listing
    const lstRes = await tools.execute('build.get_listing', {});
    check('build.get_listing: листинг получен', lstRes.hasListing === true && lstRes.listing.includes('001000'));

    const lstTrunc = await tools.execute('build.get_listing', { maxLines: 1 });
    check('build.get_listing: ограничение maxLines работает', lstTrunc.displayedLines === 1);

    // 6.3 build.get_diagnostics
    const diagRes = await tools.execute('build.get_diagnostics', {});
    check('build.get_diagnostics: получены маркеры ошибок/предупреждений', diagRes.count === 1 && diagRes.diagnostics[0].message.includes('Тестовое'));

    // 7. Тестирование emulator.*
    // 7.1 emulator.run
    const emuRunRes = await tools.execute('emulator.run', { filename: 'main.bin' });
    check('emulator.run: успешно отправил бинарный файл в эмулятор', emuRunRes.success === true);
    check('emulator.run: вызвал runBinary с правильным именем', mockEmulatorBridge.runs.some(r => r.filename === 'main.bin'));

    // 7.2 emulator.reset
    const prevResets = mockEmulatorBridge.resets;
    const emuResetRes = await tools.execute('emulator.reset', {});
    check('emulator.reset: вызвал сброс процессора виртуальной БК', emuResetRes.success === true && mockEmulatorBridge.resets === prevResets + 1);

    // 7.3 emulator.getScreenShot
    const snapRes = await tools.execute('emulator.getScreenShot', {});
    check('emulator.getScreenShot: вернул снимок экрана', snapRes.success === true && snapRes.hasData === true);

    // 8. Тестирование debug.*
    // 8.1 debug.get_registers
    const regsRes = await tools.execute('debug.get_registers', {});
    check('debug.get_registers: возвращены регистры R0-R5, SP, PC', regsRes.success === true && regsRes.registers && regsRes.registers.PC === 0o1002);

    // 8.2 debug.read_memory с парсингом восьмеричного адреса
    const memRes = await tools.execute('debug.read_memory', { address: '01000', length: 4 });
    check('debug.read_memory: чтение памяти выполнено', memRes.success === true);
    check('debug.read_memory: адрес отформатирован в восьмеричный', memRes.address === '01000');
    check('debug.read_memory: считано 4 слова', memRes.words.length === 4);

    // 8.3 debug.disassemble
    const disRes = await tools.execute('debug.disassemble', { address: '1000', count: 3 });
    check('debug.disassemble: дизассемблирование выполнено', disRes.success === true && disRes.instructions.length === 3);

    // 8.4 debug.step, pause, continue
    const stepRes = await tools.execute('debug.step', {});
    check('debug.step: вызвал метод step', stepRes.success === true);

    const pauseRes = await tools.execute('debug.pause', {});
    check('debug.pause: вызвал метод pause', pauseRes.success === true);

    const contRes = await tools.execute('debug.continue', {});
    check('debug.continue: вызвал метод continue', contRes.success === true);

    // 8.5 debug.set_breakpoint и debug.clear_breakpoint
    const bpSet = await tools.execute('debug.set_breakpoint', { address: '01006' });
    check('debug.set_breakpoint: установлена точка останова', bpSet.success === true && bpSet.address === '01006');

    const bpClear = await tools.execute('debug.clear_breakpoint', { address: '01006' });
    check('debug.clear_breakpoint: точка останова удалена', bpClear.success === true && bpClear.address === '01006');

    // 9. Вызов через window.bkAI.executeTool()
    const aiExecRes = await bkAI.executeTool('project.get_project_info', {});
    check('window.bkAI.executeTool() успешно проксирует вызов инструмента', aiExecRes.platform === 'BK-0010');

    console.log(`\nРезультаты: Пройдено: ${passed}, Ошибок: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error('Непредвиденная ошибка в тестах:', err);
    process.exit(1);
});
