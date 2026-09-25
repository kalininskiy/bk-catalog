#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-graphics-export.js
 *
 * Чистые юнит-тесты без UI. Браузерные IIFE-модули загружаются в общий
 * vm-контекст, поэтому код можно запускать прямо из Node:
 *
 *   node js/tests/bk-graphics-export.test.js
 *
 * Покрыто:
 *   - форматирование значений (восьмеричная, десятичная, двоичная);
 *   - экспорт .ASM: имя символа, размер, BYTE в строке, комментарии;
 *   - экспорт .MAC: идентичен .ASM (без обёртки .MACRO/.ENDM);
 *   - эталонный пример 0o223 из спецификации;
 *   - целостность данных: экспортированные байты = результат codec.encode;
 *   - обработка ошибок в настройках.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

// Общий контекст: браузерные IIFE-модули пишут API в глобальную область
const sandbox = { console: console };
vm.createContext(sandbox);

function loadModule(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
}

loadModule('bk-graphics-modes.js');
loadModule('bk-graphics-model.js');
loadModule('bk-graphics-codec.js');
loadModule('bk-graphics-export.js');

const { exportToAsm, exportToMac, formatByteValue } = sandbox.BKGraphicsExport;
const BKGraphicsCodec = sandbox.BKGraphicsCodec;

// ---------------------------------------------------------------------------
// Простейший фреймворк утверждений
// ---------------------------------------------------------------------------
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

function assertEqual(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        check(name, true);
    } else {
        failed++;
        console.error('FAIL: ' + name +
            '\n  expected ' + e +
            '\n  actual   ' + a);
    }
}

function throws(fn, name) {
    try {
        fn();
        check(name + ' (ожидалась ошибка)', false);
    } catch (e) {
        check(name, true);
    }
}

// Для читаемости ожидаемых строк в тестах — переводы '\n'
const NL = { newLine: '\n' };

// ---------------------------------------------------------------------------
// 1. Форматирование значений
// ---------------------------------------------------------------------------
assertEqual(formatByteValue(0o223, 8), '223', 'восьмеричная: 0o223 → 223');
assertEqual(formatByteValue(0, 8), '000', 'восьмеричная: 0 → 000');
assertEqual(formatByteValue(255, 8), '377', 'восьмеричная: 255 → 377');
assertEqual(formatByteValue(147, 10), '147D', 'десятичная: 147 → 147D');
assertEqual(formatByteValue(0, 10), '0D', 'десятичная: 0 → 0D');
assertEqual(formatByteValue(147, 2), '10010011B', 'двоичная: 147 → 10010011B');
assertEqual(formatByteValue(0, 2), '00000000B', 'двоичная: 0 → 00000000B');
assertEqual(formatByteValue(255, 2), '11111111B', 'двоичная: 255 → 11111111B');
throws(() => formatByteValue(1, 16), 'formatByteValue: система 16 недопустима → ошибка');
throws(() => formatByteValue(1, 7), 'formatByteValue: система 7 недопустима → ошибка');

// ---------------------------------------------------------------------------
// 2. Эталонный пример: MOVB #223 → ч/б 1 1 0 0 1 0 0 1
// ---------------------------------------------------------------------------
const monoImage = {
    mode: 'BK0010_MONO',
    width: 8,
    height: 1,
    pixels: [1, 1, 0, 0, 1, 0, 0, 1]
};
assertEqual(
    exportToAsm(monoImage, Object.assign({ symbol: 'PLAYER' }, NL)),
    '; Размер: 8x1\nPLAYER:\n    .BYTE 223',
    'asm: эталонный пример PLAYER (0o223)'
);
assertEqual(
    exportToAsm(monoImage, Object.assign({ symbol: 'PLAYER', sizeComment: false }, NL)),
    'PLAYER:\n    .BYTE 223',
    'asm: sizeComment=false убирает комментарий с размером'
);
assertEqual(
    exportToAsm(monoImage, Object.assign({ symbol: 'PLAYER', radix: 10 }, NL)),
    '; Размер: 8x1\nPLAYER:\n    .BYTE 147D',
    'asm: десятичная система'
);
assertEqual(
    exportToAsm(monoImage, Object.assign({ symbol: 'PLAYER', radix: 2 }, NL)),
    '; Размер: 8x1\nPLAYER:\n    .BYTE 10010011B',
    'asm: двоичная система'
);

// Цвет: 0o223 = красный, чёрный, синий, зелёный
const colorImage = {
    mode: 'BK0011M_COLOR',
    width: 4,
    height: 1,
    pixels: [3, 0, 1, 2]
};
assertEqual(
    exportToAsm(colorImage, Object.assign({ symbol: 'SPRITE' }, NL)),
    '; Размер: 4x1\nSPRITE:\n    .BYTE 223',
    'asm: цветной эталон (красный, чёрный, синий, зелёный)'
);

// ---------------------------------------------------------------------------
// 3. Количество BYTE в строке
// ---------------------------------------------------------------------------
const wideImage = {
    mode: 'BK0010_MONO',
    width: 16,
    height: 2,
    pixels: new Array(32).fill(1)
};
assertEqual(
    exportToAsm(wideImage, Object.assign({ symbol: 'BG', bytesPerLine: 2 }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377,377\n    .BYTE 377,377',
    'asm: bytesPerLine=2 разбивает строку на части'
);
assertEqual(
    exportToAsm(wideImage, Object.assign({ symbol: 'BG', bytesPerLine: 1 }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377\n    .BYTE 377\n    .BYTE 377\n    .BYTE 377',
    'asm: bytesPerLine=1 — по одному байту в строке'
);
assertEqual(
    exportToAsm(wideImage, Object.assign({ symbol: 'BG', bytesPerLine: 16 }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377,377\n    .BYTE 377,377',
    'asm: bytesPerLine больше строки — по одной строке на строку изображения'
);

// ---------------------------------------------------------------------------
// 4. Комментарии с координатами строк
// ---------------------------------------------------------------------------
assertEqual(
    exportToAsm(wideImage, Object.assign({ symbol: 'BG', bytesPerLine: 2, lineComments: true }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377,377 ; строка y=0\n    .BYTE 377,377 ; строка y=1',
    'asm: lineComments добавляет координаты строк'
);
// Комментарий — только на первой .BYTE строки изображения
assertEqual(
    exportToAsm(wideImage, Object.assign({ symbol: 'BG', bytesPerLine: 1, lineComments: true }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377 ; строка y=0\n    .BYTE 377\n    .BYTE 377 ; строка y=1\n    .BYTE 377',
    'asm: lineComments — один комментарий на строку изображения'
);

// ---------------------------------------------------------------------------
// 5. Пример из задания: 32x32
// ---------------------------------------------------------------------------
const bigImage = {
    mode: 'BK0010_MONO',
    width: 32,
    height: 32,
    pixels: new Array(32 * 32).fill(0)
};
const bigText = exportToAsm(bigImage, Object.assign({ symbol: 'PLAYER' }, NL));
check('asm 32x32: комментарий с размером', bigText.startsWith('; Размер: 32x32\n'));
check('asm 32x32: метка PLAYER:', bigText.indexOf('\nPLAYER:\n') !== -1);
check('asm 32x32: 32 строки .BYTE по 4 байта',
    bigText.split('\n').filter((l) => l.indexOf('.BYTE ') === 4).length === 32);

// ---------------------------------------------------------------------------
// 6. Экспорт .MAC (идентичен .ASM, без обёртки .MACRO/.ENDM)
// ---------------------------------------------------------------------------
assertEqual(
    exportToMac(monoImage, Object.assign({ symbol: 'PLAYER' }, NL)),
    '; Размер: 8x1\nPLAYER:\n    .BYTE 223',
    'mac: чистый блок данных (без .MACRO/.ENDM)'
);
assertEqual(
    exportToMac(wideImage, Object.assign({ symbol: 'BG', lineComments: true }, NL)),
    '; Размер: 16x2\nBG:\n    .BYTE 377,377 ; строка y=0\n    .BYTE 377,377 ; строка y=1',
    'mac: комментарии строк работают'
);

// ---------------------------------------------------------------------------
// 7. Целостность данных: экспортированные байты = результат codec.encode
// ---------------------------------------------------------------------------
function parseExportedBytes(text) {
    const values = [];
    const re = /\.BYTE\s+([^\r\n;]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        m[1].split(',').forEach((tok) => {
            const t = tok.trim();
            if (t.endsWith('B')) {
                values.push(parseInt(t.slice(0, -1), 2));
            } else if (t.endsWith('D')) {
                values.push(parseInt(t.slice(0, -1), 10));
            } else {
                values.push(parseInt(t, 8));
            }
        });
    }
    return values;
}

// Случайные пиксели: ч/б 512x256 и цвет 256x256
function pseudoRandom(count, max) {
    const out = new Array(count);
    let seed = 54321;
    for (let i = 0; i < count; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out[i] = seed % max;
    }
    return out;
}

const fullMono = {
    mode: 'BK0010_MONO',
    width: 512,
    height: 256,
    pixels: pseudoRandom(512 * 256, 2)
};
const fullColor = {
    mode: 'BK0011M_COLOR',
    width: 256,
    height: 256,
    pixels: pseudoRandom(256 * 256, 4)
};

check('целостность: ч/б 512x256 — байты из экспорта совпадают с codec.encode',
    JSON.stringify(parseExportedBytes(
        exportToAsm(fullMono, { symbol: 'SCREEN', bytesPerLine: 16, radix: 10 })
    )) === JSON.stringify(Array.from(BKGraphicsCodec.encode(fullMono))));
check('целостность: цвет 256x256 — байты из экспорта совпадают с codec.encode',
    JSON.stringify(parseExportedBytes(
        exportToMac(fullColor, { symbol: 'SCREEN', bytesPerLine: 32, radix: 2 })
    )) === JSON.stringify(Array.from(BKGraphicsCodec.encode(fullColor))));

// ---------------------------------------------------------------------------
// 8. Работа с экземпляром BKGraphicsModel
// ---------------------------------------------------------------------------
const BKGraphicsModel = sandbox.BKGraphicsModel;
const model = BKGraphicsModel.create({ mode: 'BK0011M_COLOR', width: 8, height: 2, paletteIndex: 0 });
model.fill(0);
model.setPixel(0, 0, 3);
model.setPixel(1, 0, 0);
model.setPixel(2, 0, 1);
model.setPixel(3, 0, 2);
assertEqual(
    exportToAsm(model, Object.assign({ symbol: 'FACE' }, NL)),
    '; Размер: 8x2\nFACE:\n    .BYTE 223,000\n    .BYTE 000,000',
    'model: экспорт BKGraphicsModel'
);

// ---------------------------------------------------------------------------
// 9. Обработка ошибок в настройках
// ---------------------------------------------------------------------------
throws(() => exportToAsm(monoImage, { symbol: '', newLine: '\n' }), 'пустое имя символа → ошибка');
throws(() => exportToAsm(monoImage, { bytesPerLine: 0, newLine: '\n' }), 'bytesPerLine=0 → ошибка');
throws(() => exportToAsm(monoImage, { bytesPerLine: 1.5, newLine: '\n' }), 'bytesPerLine дробное → ошибка');
throws(() => exportToAsm(monoImage, { radix: 16, newLine: '\n' }), 'radix=16 недопустим → ошибка');
throws(() => exportToMac(monoImage, { radix: 7, newLine: '\n' }), 'radix=7 недопустим → ошибка');

// ---------------------------------------------------------------------------
// Итог
// ---------------------------------------------------------------------------
console.log('\nПройдено: ' + passed + ', упало: ' + failed);
if (failed > 0) {
    process.exit(1);
}
