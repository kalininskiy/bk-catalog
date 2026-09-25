#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-graphics-editor.js
 *
 * Smoke-тесты UI-модуля: браузерные IIFE-модули (modes, model, codec,
 * editor) загружаются в общий vm-контекст; DOM подменяется минимальным
 * фейком, поэтому код можно запускать прямо из Node:
 *
 *   node js/tests/bk-graphics-editor.test.js
 *
 * Покрыто:
 *   - открытие/закрытие редактора, создание модели по умолчанию;
 *   - рисование карандашом (pointerdown/move/up), история;
 *   - undo / redo (кнопки и клавиатура Ctrl+Z / Ctrl+Y);
 *   - заливка (flood fill), линия, прямоугольник;
 *   - выбор цвета через образцы палитры;
 *   - переворот по горизонтали, поворот на 90°, очистка;
 *   - смена режима (обрезка индексов цветов), применение размера;
 *   - информация о размере данных;
 *   - повторное открытие восстанавливает состояние;
 *   - файловые операции: New, Open PNG, Save PNG, Export ASM/MAC, Add to project.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Фейковый DOM: минимально необходимый набор для bk-graphics-editor.js
// ---------------------------------------------------------------------------

/** Фейковый 2D-контекст холста: все методы — no-op. */
function makeCtx(el) {
    const target = {};
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) {
                return t[prop];
            }
            if (prop === 'getImageData') {
                return function (x, y, w, h) {
                    return new FakeImageData(w, h);
                };
            }
            return function () {};
        },
        set(t, prop, value) {
            t[prop] = value;
            return true;
        }
    });
}

/** Фейковый DOM-элемент. */
function makeEl(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        children: [],
        dataset: {},
        style: {},
        listeners: {},
        value: '',
        checked: false,
        disabled: false,
        title: '',
        max: '',
        width: 0,
        height: 0,
        _innerHTML: '',
        _memo: {}
    };
    const classes = new Set();
    el.classList = {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, force) {
            if (force === undefined) {
                if (classes.has(c)) { classes.delete(c); } else { classes.add(c); }
            } else if (force) {
                classes.add(c);
            } else {
                classes.delete(c);
            }
        },
        contains(c) { return classes.has(c); }
    };
    Object.defineProperty(el, 'innerHTML', {
        get() { return el._innerHTML; },
        set(v) { el._innerHTML = String(v); el.children = []; }
    });
    el.addEventListener = (type, fn) => {
        (el.listeners[type] = el.listeners[type] || []).push(fn);
    };
    el.removeEventListener = () => {};
    el.appendChild = (child) => { el.children.push(child); return child; };
    el.removeChild = (child) => {
        const i = el.children.indexOf(child);
        if (i >= 0) {
            el.children.splice(i, 1);
        }
        return child;
    };
    el.querySelector = (sel) => {
        if (!el._memo[sel]) {
            el._memo[sel] = makeEl('div');
        }
        return el._memo[sel];
    };
    el.querySelectorAll = (sel) => {
        if (sel === '.bk-g-tool') {
            if (!el._tools) {
                el._tools = ['pencil', 'erase', 'fill', 'line', 'rect', 'select', 'copy', 'paste'].map((t) => {
                    const b = makeEl('button');
                    b.dataset.tool = t;
                    return b;
                });
            }
            return el._tools;
        }
        return [];
    };
    el.toBlob = (cb) => cb(new Blob(['fake-png-bytes'], { type: 'image/png' }));
    el.setPointerCapture = () => {};
    el.releasePointerCapture = () => {};
    el.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: el.width + 2,
        height: el.height + 2
    });
    el.getContext = () => makeCtx(el);
    el.focus = () => {};
    el.click = () => {
        (el.listeners.click || []).forEach((fn) => fn({ type: 'click', target: el }));
    };
    el.__fire = (type, ev) => {
        (el.listeners[type] || []).forEach((fn) => fn(ev));
    };
    return el;
}

/** Фейковый ImageData. */
class FakeImageData {
    constructor(w, h) {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
    }
}

// ---------------------------------------------------------------------------
// Сборка vm-контекста
// ---------------------------------------------------------------------------

const btnGraphics = makeEl('button');
const documentStub = {
    readyState: 'complete',
    body: makeEl('body'),
    activeElement: makeEl('div'),
    _keyHandlers: [],
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => (id === 'btn-graphics' ? btnGraphics : null),
    addEventListener: (type, fn) => {
        if (type === 'keydown') {
            documentStub._keyHandlers.push(fn);
        }
    },
    querySelector: () => null
};

// Фейковый localStorage для Project Manager
const storageData = {};
const uiLog = { alerts: [], prompts: [], confirms: [] };
let urlCounter = 0;

const sandbox = {
    console: console,
    document: documentStub,
    ImageData: FakeImageData,
    Blob: Blob,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null),
        setItem: (k, v) => { storageData[k] = String(v); },
        removeItem: (k) => { delete storageData[k]; }
    },
    alert: (msg) => { uiLog.alerts.push(String(msg)); },
    prompt: (msg, def) => { uiLog.prompts.push(msg); return 'test-graphics.asm'; },
    confirm: (msg) => { uiLog.confirms.push(msg); return true; },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URL: {
        createObjectURL: () => 'blob:fake-' + (++urlCounter),
        revokeObjectURL: () => {}
    },
    createImageBitmap: () => Promise.resolve({ width: 8, height: 4, close() {} })
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
}

load('bk-graphics-modes.js');
load('bk-graphics-model.js');
load('bk-graphics-codec.js');
load('bk-graphics-png.js');
load('bk-graphics-export.js');
load('project-manager.js');
load('bk-graphics-editor.js');

// ---------------------------------------------------------------------------
// Хелперы тестов
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name, ok) {
    if (ok) {
        passed++;
        console.log('PASS: ' + name);
    } else {
        failed++;
        console.error('FAIL: ' + name);
    }
}

function assertEqual(actual, expected, name) {
    check(name, JSON.stringify(actual) === JSON.stringify(expected));
}

const E = sandbox.BKGraphicsEditor;

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

check('модуль экспортирует BKGraphicsEditor', !!E &&
    typeof E.open === 'function' && typeof E.close === 'function' &&
    typeof E.isOpen === 'function' && typeof E.getModel === 'function');

// Кнопка «Графика» в шапке запускает редактор
btnGraphics.click();
check('кнопка «Графика» открывает редактор', E.isOpen());

let model = E.getModel();
check('создана модель по умолчанию', !!model);
assertEqual([model.mode, model.width, model.height], ['BK0011M_COLOR', 256, 256],
    'режим по умолчанию BK0011M_COLOR 256×256');

const overlay = documentStub.body.children[0];
const canvas = overlay.querySelector('#bk-g-canvas');
const tools = overlay.querySelectorAll('.bk-g-tool');

/** Событие указателя в координатах пикселя (центр пикселя). */
function ptr(type, px, py) {
    const m = E.getModel();
    const ev = {
        type: type,
        button: 0,
        clientX: 1 + (px + 0.5) * (canvas.width / m.width),
        clientY: 1 + (py + 0.5) * (canvas.height / m.height),
        pointerId: 1,
        preventDefault() {},
        stopPropagation() {}
    };
    canvas.__fire(type, ev);
}

/** Нажать клавишу (обработчик на document). */
function key(extra) {
    const h = documentStub._keyHandlers[0];
    h(Object.assign({
        key: '',
        code: '',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {}
    }, extra));
}

// --- Карандаш: штрих из трёх пикселей -------------------------------------

ptr('pointerdown', 5, 5);
ptr('pointermove', 6, 5);
ptr('pointermove', 7, 5);
ptr('pointerup', 7, 5);
check('карандаш рисует линию из 3 пикселей',
    model.getPixel(5, 5) === 1 && model.getPixel(6, 5) === 1 && model.getPixel(7, 5) === 1);

// --- Undo / Redo (кнопки) --------------------------------------------------

const undoBtn = overlay.querySelector('#bk-g-undo');
const redoBtn = overlay.querySelector('#bk-g-redo');

undoBtn.click();
check('undo стирает штрих', model.getPixel(5, 5) === 0 && model.getPixel(7, 5) === 0);
redoBtn.click();
check('redo возвращает штрих', model.getPixel(5, 5) === 1 && model.getPixel(7, 5) === 1);

// --- Заливка ----------------------------------------------------------------

tools[2].click(); // fill
ptr('pointerdown', 10, 10);
ptr('pointerup', 10, 10);
check('заливка заливает всю чёрную область', model.getPixel(0, 0) === 1 && model.getPixel(200, 200) === 1);
undoBtn.click();
check('undo отменяет заливку', model.getPixel(0, 0) === 0);

// --- Линия (диагональ) ------------------------------------------------------

tools[3].click(); // line
ptr('pointerdown', 0, 0);
ptr('pointermove', 4, 4);
ptr('pointerup', 4, 4);
check('линия Брезенхема: диагональ 0,0 → 4,4',
    model.getPixel(0, 0) === 1 && model.getPixel(2, 2) === 1 && model.getPixel(4, 4) === 1);

// --- Прямоугольник (рамка) ---------------------------------------------------

tools[4].click(); // rect
ptr('pointerdown', 2, 2);
ptr('pointermove', 3, 3);
ptr('pointerup', 3, 3);
check('прямоугольник: рамка 2×2',
    model.getPixel(3, 2) === 1 && model.getPixel(2, 3) === 1 && model.getPixel(3, 3) === 1);

// --- Выбор цвета: красный (индекс 3) ----------------------------------------

tools[0].click(); // pencil
const colors = overlay.querySelector('#bk-g-colors');
check('создано 4 образца цвета', colors.children.length === 4);
colors.children[3].click();
ptr('pointerdown', 20, 20);
ptr('pointerup', 20, 20);
check('выбран цвет 3 (красный)', model.getPixel(20, 20) === 3);

// --- Переворот по горизонтали -------------------------------------------------

overlay.querySelector('#bk-g-flip-h').click();
check('flipH: пиксель (20,20) → (235,20)', model.getPixel(235, 20) === 3 && model.getPixel(20, 20) === 0);

// --- Поворот на 90° -----------------------------------------------------------

overlay.querySelector('#bk-g-rotate').click();
check('rotate90: пиксель (235,20) → (235,235)', model.getPixel(235, 235) === 3);

// --- Очистка -------------------------------------------------------------------

overlay.querySelector('#bk-g-clear').click();
check('очистка стирает изображение',
    model.getPixel(0, 0) === 0 && model.getPixel(235, 235) === 0);

// --- Клавиатура: Ctrl+Z / Ctrl+Y -------------------------------------------------

key({ key: 'z', code: 'KeyZ', ctrlKey: true });
check('Ctrl+Z отменяет очистку', model.getPixel(235, 235) === 3);
key({ key: 'y', code: 'KeyY', ctrlKey: true });
check('Ctrl+Y возвращает очистку', model.getPixel(235, 235) === 0);

// --- Смена режима: BK0010_COLOR → MONO, обрезка индексов ------------------------

// нарисуем красный пиксель и переключим в монохром
tools[0].click();
colors.children[3].click();
ptr('pointerdown', 0, 0);
ptr('pointerup', 0, 0);
check('красный пиксель (индекс 3) нарисован', model.getPixel(0, 0) === 3);

const modeSel = overlay.querySelector('#bk-g-mode');
modeSel.value = 'BK0010_MONO';
(modeSel.listeners.change || []).forEach((fn) => fn({}));
model = E.getModel();
check('смена режима на BK0010_MONO', model.mode === 'BK0010_MONO');
check('индексы обрезаны до 0..1', model.getPixel(0, 0) === 1);
check('палитра монохрома', model.palette.length === 2);

// --- Применение размера -----------------------------------------------------------

const wInp = overlay.querySelector('#bk-g-width');
const hInp = overlay.querySelector('#bk-g-height');
wInp.value = '128';
hInp.value = '64';
overlay.querySelector('#bk-g-apply-size').click();
check('применение размера 128×64', model.width === 128 && model.height === 64);

const bytesInfo = overlay.querySelector('#bk-g-bytes-info');
assertEqual(bytesInfo.textContent, '1024 байт (1 КБайт)', 'размер данных MONO 128×64 = 1024 байт');

const sizeInfo = overlay.querySelector('#bk-g-size-info');
assertEqual(sizeInfo.textContent, '128 × 64 px', 'информация о размере');

// --- Выделение, копирование, вставка ----------------------------------------

// Нарисуем несколько белых пикселей (индекс 1 в монохромном режиме)
tools[0].click(); // pencil
colors.children[1].click(); // белый (индекс 1)
ptr('pointerdown', 18, 18);
ptr('pointerup', 18, 18);
ptr('pointerdown', 19, 19);
ptr('pointerup', 19, 19);
ptr('pointerdown', 20, 20);
ptr('pointerup', 20, 20);
check('нарисованы пиксели (18,18), (19,19), (20,20)',
    model.getPixel(18, 18) === 1 && model.getPixel(19, 19) === 1 && model.getPixel(20, 20) === 1);

// Выделение области 18,18 → 22,22 (5x5)
tools[5].click(); // select
ptr('pointerdown', 18, 18);
ptr('pointermove', 22, 22);
ptr('pointerup', 22, 22);

// Копирование (Ctrl+C)
key({ key: 'c', code: 'KeyC', ctrlKey: true });

// Вставка (Ctrl+V) в позицию мыши: верхний левый угол буфера в (40,40)
ptr('pointermove', 40, 40);
key({ key: 'v', code: 'KeyV', ctrlKey: true });

check('вставка: пиксель (40,40) из буфера', model.getPixel(40, 40) === 1);
check('вставка: пиксель (41,41) из буфера', model.getPixel(41, 41) === 1);
check('вставка: пиксель (42,42) из буфера', model.getPixel(42, 42) === 1);
check('вставка: пиксель (40,41) — из буфера (чёрный)', model.getPixel(40, 41) === 0);
check('вставка: исходные пиксели сохранены', model.getPixel(18, 18) === 1);

// --- Закрытие и повторное открытие -------------------------------------------------

key({ key: 'Escape', code: 'Escape' });
check('Esc закрывает редактор', !E.isOpen());

E.open();
check('повторное открытие восстанавливает состояние',
    E.isOpen() && E.getModel().width === 128 && E.getModel().mode === 'BK0010_MONO');

E.close();
check('close() закрывает редактор', !E.isOpen());

// --- Файловые операции: New / Export / Project / PNG -------------------------

E.open();
const wNew = overlay.querySelector('#bk-g-width');
const hNew = overlay.querySelector('#bk-g-height');
wNew.value = '32';
hNew.value = '16';
overlay.querySelector('#bk-g-new').click();
// Диалог выбора режима: выбираем «Графика»
check('New: диалог выбора режима открыт',
    overlay.querySelector('#bk-g-mode-dialog').style.display === 'flex');
overlay.querySelector('#bk-g-mode-graphics').click();
model = E.getModel();
check('New: новое изображение 32×16', model.width === 32 && model.height === 16);
check('New: пиксели очищены', model.pixels.every((v) => v === 0));
check('New: диалог закрыт',
    overlay.querySelector('#bk-g-mode-dialog').style.display === 'none');

// --- Режим «Спрайты»: создание листа ----------------------------------------
overlay.querySelector('#bk-g-new').click();
overlay.querySelector('#bk-g-mode-sprites').click();
model = E.getModel();
// 8 спрайтов 16x16 → сетка 4x2 → лист 64x32
check('Спрайты: лист 64x32 (8 спрайтов 16x16)',
    model.width === 64 && model.height === 32);
check('Спрайты: пиксели очищены', model.pixels.every((v) => v === 0));
// Рисуем пиксель в первом фрейме (0,0)
ptr('pointerdown', 0, 0);
ptr('pointerup', 0, 0);
check('Спрайты: пиксель в фрейме 1', model.getPixel(0, 0) === 1);
// Экспорт спрайтов: метки PLAYER_FRAME1..PLAYER_FRAME8
const spriteAsm = E.exportAsm();
check('Спрайты: экспорт содержит IMAGE_FRAME1',
    spriteAsm.indexOf('IMAGE_FRAME1:') !== -1);
check('Спрайты: экспорт содержит IMAGE_FRAME8',
    spriteAsm.indexOf('IMAGE_FRAME8:') !== -1);
check('Спрайты: экспорт содержит комментарий о количестве',
    spriteAsm.indexOf('Спрайтов: 8') !== -1);

// Возвращаемся в режим «Графика» для дальнейших тестов
overlay.querySelector('#bk-g-new').click();
overlay.querySelector('#bk-g-mode-graphics').click();
model = E.getModel();
wNew.value = '32';
hNew.value = '16';
overlay.querySelector('#bk-g-new').click();
overlay.querySelector('#bk-g-mode-graphics').click();
model = E.getModel();
check('Возврат в «Графика»: новое изображение 32×16',
    model.width === 32 && model.height === 16);

const asmText = E.exportAsm();
check('exportAsm: текст .ASM содержит IMAGE',
    typeof asmText === 'string' && asmText.indexOf('IMAGE') !== -1);
const macText = E.exportMac();
check('exportMac: текст .MAC содержит IMAGE',
    typeof macText === 'string' && macText.indexOf('IMAGE') !== -1);

// --- Добавление в проект: диалог + INCLUDE -----------------------------
sandbox.bkProject.addArtifactFile('main.asm', '; main\n');

E.addToProject();
const projDialog = overlay.querySelector('#bk-g-project-dialog');
const projName = overlay.querySelector('#bk-g-proj-name');
const projFolder = overlay.querySelector('#bk-g-proj-folder');
const projFormat = overlay.querySelector('#bk-g-proj-format');
const projPng = overlay.querySelector('#bk-g-proj-png');
check('addToProject: диалог открыт', projDialog.style.display === 'flex');
check('addToProject: значения по умолчанию (image/gfx/MAC/PNG)',
    projName.value === 'image' && projFolder.value === 'gfx' &&
    projFormat.value === 'MAC' && projPng.checked === true);

// Esc закрывает диалог, а не редактор
key({ key: 'Escape', code: 'Escape' });
check('Esc: диалог закрыт, редактор остался открыт',
    projDialog.style.display === 'none' && E.isOpen());

// Заполняем поля и жмём «Добавить» (асинхронно: экспорт PNG)
E.addToProject();
projName.value = 'player';
projFolder.value = 'gfx';
projFormat.value = 'MAC';
projPng.checked = true;
overlay.querySelector('#bk-g-proj-ok').click();

function finish() {
    console.log('\nПройдено: ' + passed + ', упало: ' + failed);
    if (failed > 0) {
        process.exit(1);
    }
}

// Open PNG: фейковый createImageBitmap 8×4 (всё чёрное → индекс 0)
E.importPng({ name: 'fake.png' }).then(function () {
    model = E.getModel();
    check('Open PNG: изображение 8×4 загружено', model.width === 8 && model.height === 4);
    check('Open PNG: пиксели квантованы (все 0)', model.pixels.every((v) => v === 0));
    // Save PNG: фейковый canvas.toBlob → скачивание без ошибок
    return E.savePng();
}).then(function () {
    check('Save PNG: PNG сформирован без ошибок', true);
    // К этому моменту микрозасадка диалога «Добавить в проект» уже отработала
    check('Добавить в проект: создан файл gfx/player.mac',
        typeof sandbox.bkProject.files['gfx/player.mac'] === 'string' &&
        sandbox.bkProject.files['gfx/player.mac'].indexOf('PLAYER') !== -1);
    check('Добавить в проект: PNG gfx/player.png (двоичный файл)',
        ArrayBuffer.isView(sandbox.bkProject.files['gfx/player.png']));
    check('INCLUDE: директива вставлена в текущий файл',
        sandbox.bkProject.files['main.asm'].indexOf('.INCLUDE "gfx/player.mac"') !== -1);
    check('Добавить в проект: диалог закрыт', projDialog.style.display === 'none');
    finish();
}).catch(function (err) {
    check('PNG: ошибка — ' + err.message, false);
    finish();
});
