#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля js/bk-ai-context.js
 *
 * Проверяет:
 *   - Создание класса BKAIContext и синглтона bkAIContext;
 *   - getCurrentFile(): получение текущего активного файла (из BKProjectManager и Monaco);
 *   - getSelection(): получение выделенного фрагмента текста из редактора;
 *   - getProjectFiles(): получение списка файлов проекта (метаданные без раздувания контекста);
 *   - getFile(path): чтение содержимого указанного файла через существующий BKProjectManager;
 *   - getDiagnostics(): получение ошибок и предупреждений LSP / компилятора;
 *   - getProjectInfo(): получение платформы, компилятора, адреса запуска и статуса листинга;
 *   - getListing(): получение текущего ассемблерного листинга;
 *   - buildContext(): сборку компактного контекста по запросу без отправки всего проекта;
 *   - Использование существующего BKProjectManager без дублирования хранилища;
 *   - Доступность через bkAI.getContext().
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

// Создание изолированного контекста
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => {
        for (const k in storage) {
            delete storage[k];
        }
    }
};

// Mock для Monaco Editor
let mockEditorValue = 'START: MOV #40000, R1 ; Тестовый код';
let mockSelectionRange = null; // { startLineNumber: 1, endLineNumber: 1, startColumn: 8, endColumn: 20 }
let mockMarkers = [];

const fakeEditor = {
    getValue: () => mockEditorValue,
    setValue: (val) => { mockEditorValue = val; },
    getSelection: () => {
        if (!mockSelectionRange) {
            return {
                isEmpty: () => true,
                startLineNumber: 1,
                endLineNumber: 1,
                startColumn: 1,
                endColumn: 1
            };
        }
        return {
            isEmpty: () => false,
            startLineNumber: mockSelectionRange.startLineNumber,
            endLineNumber: mockSelectionRange.endLineNumber,
            startColumn: mockSelectionRange.startColumn,
            endColumn: mockSelectionRange.endColumn
        };
    },
    getModel: () => ({
        getValueInRange: (sel) => {
            if (!sel || (typeof sel.isEmpty === 'function' && sel.isEmpty())) return '';
            // Возвращаем подстроку для теста
            return 'MOV #40000, R1';
        }
    })
};

// Mock для monaco.editor
const fakeMonaco = {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
    editor: {
        getModelMarkers: () => mockMarkers
    }
};

// Mock для CompilerBridge
let mockCompilerName = 'bkturbo8';
const fakeCompilerBridge = {
    getCompiler: () => mockCompilerName,
    setCompiler: (c) => { mockCompilerName = c; }
};

// Mock DOM элементов
const fakeElements = {
    'platform-select': { value: 'BK-0010' },
    'address-input': { value: '1000' },
    'compiler-select': { value: 'bkturbo8' },
    'format-select': { value: 'bin' },
    'listing-output': { textContent: '001000 012701 040000 START: MOV #40000, R1\n' },
    'status-text': { textContent: 'Ошибок нет' }
};

const fakeDocument = {
    getElementById: (id) => (fakeElements[id] || null)
};

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    document: fakeDocument,
    monaco: fakeMonaco,
    editor: fakeEditor,
    compilerBridge: fakeCompilerBridge,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Error: Error
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// 1. Загрузка project-manager.js
const pmCode = fs.readFileSync(path.join(JS_DIR, 'project-manager.js'), 'utf8');
vm.runInContext(pmCode, sandbox, { filename: 'project-manager.js' });

// 2. Загрузка bk-ai-normalizer.js
const normCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-normalizer.js'), 'utf8');
vm.runInContext(normCode, sandbox, { filename: 'bk-ai-normalizer.js' });

// 3. Загрузка bk-ai-context.js
const ctxCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-context.js'), 'utf8');
vm.runInContext(ctxCode, sandbox, { filename: 'bk-ai-context.js' });

// 4. Загрузка bk-ai-manager.js
const mgrCode = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf8');
vm.runInContext(mgrCode, sandbox, { filename: 'bk-ai-manager.js' });

const BKAIContext = sandbox.BKAIContext;
const context = sandbox.bkAIContext;
const bkProject = sandbox.bkProject;
const bkAI = sandbox.bkAI;

// 1. Проверка экспорта
check('Экспорт класса BKAIContext', typeof BKAIContext === 'function');
check('Экспорт экземпляра bkAIContext', typeof context === 'object' && context !== null);
check('Экземпляр принадлежит BKAIContext', context instanceof BKAIContext);
check('bkAI.getContext() возвращает BKAIContext', bkAI.getContext() instanceof BKAIContext);

// Подготовка файлов в проекте
bkProject.createFile('subroutine.asm', 'SUBR: RTS PC\n');
bkProject.addArtifactFile('game.bin', new Uint8Array([0o00, 0o10, 0o40, 0o00, 0o00, 0o00]));

// 2. Проверка getCurrentFile()
const curFile = context.getCurrentFile();
check('getCurrentFile(): возвращает имя активного файла', curFile.name === 'subroutine.asm' || curFile.name === 'main.asm');
check('getCurrentFile(): возвращает содержимое из редактора при редактировании',
    curFile.content === mockEditorValue);
check('getCurrentFile(): определяет флаг isBinary === false для asm', curFile.isBinary === false);

// Проверка двоичного файла
bkProject.setActiveFile('game.bin');
sandbox.editor = null; // редактор закрыт для бинарника
const binFile = context.getCurrentFile();
check('getCurrentFile(): для .bin определяет isBinary === true', binFile.isBinary === true);
sandbox.editor = fakeEditor; // восстанавливаем редактор

// 3. Проверка getSelection()
// Когда ничего не выделено:
mockSelectionRange = null;
const emptySel = context.getSelection();
check('getSelection(): при отсутствии выделения hasSelection === false', emptySel.hasSelection === false);
check('getSelection(): при отсутствии выделения text пустой', emptySel.text === '');

// Когда выделен фрагмент:
mockSelectionRange = { startLineNumber: 1, endLineNumber: 1, startColumn: 8, endColumn: 22 };
const activeSel = context.getSelection();
check('getSelection(): при наличии выделения hasSelection === true', activeSel.hasSelection === true);
check('getSelection(): возвращает выделенный текст', activeSel.text === 'MOV #40000, R1');
check('getSelection(): возвращает номер начальной строки', activeSel.startLine === 1);

// 4. Проверка getProjectFiles() (метаданные без раздувания контекста LLM)
const projectFiles = context.getProjectFiles();
check('getProjectFiles(): возвращает массив файлов', Array.isArray(projectFiles) && projectFiles.length >= 2);
check('getProjectFiles(): файлы содержат метаданные name, path, size, isBinary',
    projectFiles.every(f => typeof f.name === 'string' && typeof f.size === 'number' && typeof f.isBinary === 'boolean'));

const binMeta = projectFiles.find(f => f.name === 'game.bin');
check('getProjectFiles(): game.bin помечен как isBinary === true', binMeta && binMeta.isBinary === true);

// 5. Проверка getFile(path) через существующий BKProjectManager
const subrFile = context.getFile('subroutine.asm');
check('getFile(): существующий файл exists === true', subrFile.exists === true);
check('getFile(): возвращает точное содержимое из BKProjectManager', subrFile.content === 'SUBR: RTS PC\n');

const nonExistFile = context.getFile('unknown_file.mac');
check('getFile(): несуществующий файл exists === false', nonExistFile.exists === false);
check('getFile(): несуществующий файл content === null', nonExistFile.content === null);

// 6. Проверка getPlatform(), getStartAddress(), getCompiler()
check('getPlatform(): возвращает платформу (BK-0010)', context.getPlatform() === 'BK-0010');
check('getStartAddress(): возвращает начальный адрес (1000)', context.getStartAddress() === '1000');
check('getCompiler(): возвращает текущий компилятор (bkturbo8)', context.getCompiler() === 'bkturbo8');

// Переключение компилятора
fakeCompilerBridge.setCompiler('macro11');
check('getCompiler(): обновляется при смене в CompilerBridge (macro11)', context.getCompiler() === 'macro11');

// 7. Проверка getDiagnostics()
mockMarkers = [
    {
        message: 'Неизвестная мнемоника MUV',
        severity: 8,
        startLineNumber: 12,
        startColumn: 1,
        endLineNumber: 12,
        endColumn: 4,
        source: 'PDP-11 LSP',
        resource: { path: '/main.asm' }
    }
];

const diags = context.getDiagnostics();
check('getDiagnostics(): возвращает массив диагностик', Array.isArray(diags) && diags.length === 1);
check('getDiagnostics(): распознает severityText "error"', diags[0].severityText === 'error');
check('getDiagnostics(): извлекает строку ошибки', diags[0].line === 12);
check('getDiagnostics(): извлекает текст сообщения', diags[0].message === 'Неизвестная мнемоника MUV');

// 8. Проверка getListing()
const lstText = context.getListing();
check('getListing(): возвращает строку листинга', typeof lstText === 'string' && lstText.includes('012701'));

// 9. Проверка getProjectInfo()
const pInfo = context.getProjectInfo();
check('getProjectInfo(): содержит platform', pInfo.platform === 'BK-0010');
check('getProjectInfo(): содержит compiler', pInfo.compiler === 'macro11');
check('getProjectInfo(): содержит startAddress', pInfo.startAddress === '1000');
check('getProjectInfo(): содержит filesCount', pInfo.filesCount >= 2);
check('getProjectInfo(): содержит hasListing === true', pInfo.hasListing === true);
check('getProjectInfo(): содержит hasDiagnostics === true', pInfo.hasDiagnostics === true);
check('getProjectInfo(): diagnosticsCount === 1', pInfo.diagnosticsCount === 1);

// 10. Проверка buildContext() — компактный контекст без автоматической отправки всего проекта
const promptCtx = context.buildContext({
    includeSelection: true,
    includeDiagnostics: true,
    includeListing: false // по умолчанию листинг не раздувает промпт
});

const promptStr = promptCtx.toPromptString();
check('buildContext(): формирует непустую строку промпта', typeof promptStr === 'string' && promptStr.length > 0);
check('buildContext(): включает платформу и компилятор',
    promptStr.includes('Platform=BK-0010') && promptStr.includes('Compiler=macro11'));
check('buildContext(): включает выделенный фрагмент кода', promptStr.includes('MOV #40000, R1'));
check('buildContext(): включает диагностическую ошибку', promptStr.includes('Неизвестная мнемоника MUV'));
check('buildContext(): по умолчанию НЕ включает полный листинг (компактность)',
    !promptStr.includes('Compiler Listing:'));

// Проверка включения листинга только по явному запросу
const promptCtxWithLst = context.buildContext({ includeListing: true });
check('buildContext({ includeListing: true }): включает листинг по запросу',
    promptCtxWithLst.toPromptString().includes('Compiler Listing:'));

console.log(`\nИтог тестов BKAIContext: Пройдено: ${passed}, упало: ${failed}`);
if (failed > 0) {
    process.exit(1);
}
