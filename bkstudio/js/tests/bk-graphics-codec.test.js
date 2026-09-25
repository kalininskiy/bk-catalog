#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-graphics-codec.js
 *
 * Чистые юнит-тесты без UI. Браузерные IIFE-модули загружаются в общий
 * vm-контекст, поэтому код можно запускать прямо из Node:
 *
 *   node js/tests/bk-graphics-codec.test.js
 *
 * Покрыто:
 *   - эталонные примеры из спецификации (байт 0o223 в ч/б и цветном режимах);
 *   - маски цвета (зелёный 0o125252, синий 0o052525);
 *   - размеры кодирования (полный экран 512x256 = 16 Кбайт);
 *   - round-trip encode → decode для каждого пикселя;
 *   - работа с экземпляром BKGraphicsModel;
 *   - ошибки при некорректных параметрах.
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

const {
    encode,
    decode,
    getBytesPerRow,
    getEncodedSize,
    getBitsPerPixel
} = sandbox.BKGraphicsCodec;
const BKGraphicsModel = sandbox.BKGraphicsModel;

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
        return false;
    } catch (e) {
        check(name, true);
        return true;
    }
}

/**
 * Детерминированный ГПСЧ (LCG) для воспроизводимых тестовых пикселей.
 * @param {number} count - количество значений.
 * @param {number} max - граница (не включая).
 * @returns {number[]}
 */
function pseudoRandom(count, max) {
    const out = new Array(count);
    let seed = 12345;
    for (let i = 0; i < count; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out[i] = seed % max;
    }
    return out;
}

// ---------------------------------------------------------------------------
// 1. Эталонные примеры из спецификации
// ---------------------------------------------------------------------------

// Ч/б: MOVB #223,... → разряды 1 1 0 0 1 0 0 1 (биты 0..7)
const monoBytes = encode({
    mode: 'BK0010_MONO',
    width: 8,
    height: 1,
    pixels: [1, 1, 0, 0, 1, 0, 0, 1]
});
assertEqual(monoBytes[0], 0o223, 'ч/б: пиксели [1,1,0,0,1,0,0,1] → байт 0o223');
assertEqual(
    decode(monoBytes, 8, 1, 'BK0010_MONO').pixels,
    [1, 1, 0, 0, 1, 0, 0, 1],
    'ч/б: decode(0o223) → [1,1,0,0,1,0,0,1]'
);

// Цвет: 0o223 = 0b10010011 → пары (1,1),(0,0),(1,0),(0,1) → 3,0,1,2
const colorBytes = encode({
    mode: 'BK0011M_COLOR',
    width: 4,
    height: 1,
    pixels: [3, 0, 1, 2]
});
assertEqual(colorBytes[0], 0o223, 'цвет: пиксели [3,0,1,2] → байт 0o223');
assertEqual(
    decode(colorBytes, 4, 1, 'BK0011M_COLOR').pixels,
    [3, 0, 1, 2],
    'цвет: decode(0o223) → [3,0,1,2] (красный, чёрный, синий, зелёный)'
);

// Маски цвета: зелёный 0o125252 (0xAAAA), синий 0o052525 (0x5555)
assertEqual(
    decode(new Uint8Array([0xAA]), 4, 1, 'BK0010_COLOR').pixels,
    [2, 2, 2, 2],
    'маска 0o125252 (0xAAAA) → все пиксели индекс 2 (зелёный)'
);
assertEqual(
    decode(new Uint8Array([0x55]), 4, 1, 'BK0010_COLOR').pixels,
    [1, 1, 1, 1],
    'маска 0o052525 (0x5555) → все пиксели индекс 1 (синий)'
);

// ---------------------------------------------------------------------------
// 2. Размеры кодирования
// ---------------------------------------------------------------------------
assertEqual(getBytesPerRow(512, 'BK0010_MONO'), 64, 'ч/б: 512 пикселя = 64 байта на строку');
assertEqual(getBytesPerRow(256, 'BK0011M_COLOR'), 64, 'цвет: 256 пикселей = 64 байта на строку');
assertEqual(getEncodedSize(512, 256, 'BK0010_MONO'), 16384, 'ч/б: полный экран 512x256 = 16 Кбайт');
assertEqual(getEncodedSize(256, 256, 'BK0011M_COLOR'), 16384, 'цвет: полный экран 256x256 = 16 Кбайт');
assertEqual(getEncodedSize(10, 1, 'BK0010_MONO'), 2, 'ч/б: 10 пикселей = 2 байта');
assertEqual(getEncodedSize(5, 1, 'BK0010_COLOR'), 2, 'цвет: 5 пикселей = 2 байта');
assertEqual(getBitsPerPixel('BK0010_MONO'), 1, 'BK0010_MONO = 1 бит/пиксель');
assertEqual(getBitsPerPixel('BK0011M_COLOR'), 2, 'BK0011M_COLOR = 2 бита/пиксель');

// ---------------------------------------------------------------------------
// 3. Round-trip: encode → decode восстанавливает каждый пиксель
// ---------------------------------------------------------------------------
function roundTrip(name, mode, width, height, maxIndex) {
    const pixels = pseudoRandom(width * height, maxIndex);
    const bytes = encode({ mode: mode, width: width, height: height, pixels: pixels });
    check(name + ': размер байтов', bytes.length === getEncodedSize(width, height, mode));
    const decoded = decode(bytes, width, height, mode);
    assertEqual(decoded.pixels, pixels, name + ': все пиксели восстановлены');
}

roundTrip('round-trip ч/б полный экран 512x256', 'BK0010_MONO', 512, 256, 2);
roundTrip('round-trip цвет полный экран 256x256', 'BK0011M_COLOR', 256, 256, 4);
roundTrip('round-trip ч/б 10x3 (некратная ширина)', 'BK0010_MONO', 10, 3, 2);
roundTrip('round-trip цвет 5x3 (некратная ширина)', 'BK0010_COLOR', 5, 3, 4);
roundTrip('round-trip цвет 3x2', 'BK0011M_COLOR', 3, 2, 4);
roundTrip('round-trip ч/б 1x1', 'BK0010_MONO', 1, 1, 2);
roundTrip('round-trip цвет 1x1', 'BK0010_COLOR', 1, 1, 4);
roundTrip('round-trip ч/б 128x64', 'BK0010_MONO', 128, 64, 2);
roundTrip('round-trip цвет 100x50', 'BK0011M_COLOR', 100, 50, 4);

// Round-trip через числовой режим (1/2 бита на пиксель)
const nrPixels = pseudoRandom(20, 4);
const nrBytes = encode({ mode: 2, width: 10, height: 2, pixels: nrPixels });
assertEqual(decode(nrBytes, 10, 2, 2).pixels, nrPixels, 'round-trip: режим как число (2 бита)');

// ---------------------------------------------------------------------------
// 4. Неиспользованные биты последнего байта строки — нули
// ---------------------------------------------------------------------------
const oddBytes = encode({
    mode: 'BK0010_MONO',
    width: 10,
    height: 1,
    pixels: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
});
assertEqual(oddBytes[0], 0xFF, 'некратная ширина: первый байт 0xFF');
assertEqual(oddBytes[1], 0x03, 'некратная ширина: остаток 2 бита в младших, старшие — 0');

// ---------------------------------------------------------------------------
// 5. Работа с экземпляром BKGraphicsModel
// ---------------------------------------------------------------------------
const model = BKGraphicsModel.create({ mode: 'BK0011M_COLOR', width: 8, height: 2, paletteIndex: 0 });
model.fill(0);
model.setPixel(0, 0, 1);
model.setPixel(1, 0, 2);
model.setPixel(2, 0, 3);
model.setPixel(7, 1, 1);
const modelBytes = encode(model);
assertEqual(modelBytes.length, 4, 'model: 8x2 цветных пикселей = 4 байта');
const modelDecoded = decode(modelBytes, 8, 2, model.mode);
assertEqual(modelDecoded.pixels, model.pixels, 'model: round-trip через BKGraphicsModel');

// ---------------------------------------------------------------------------
// 6. Обработка ошибок
// ---------------------------------------------------------------------------
throws(
    () => encode({ mode: 'BK0010_MONO', width: 2, height: 1, pixels: [1] }),
    'encode: неверная длина массива пикселей → ошибка'
);
throws(
    () => encode({ mode: 'BK0010_MONO', width: 1, height: 1, pixels: [5] }),
    'encode: недопустимый индекс цвета → ошибка'
);
throws(
    () => encode({ mode: 'BAD_MODE', width: 1, height: 1, pixels: [0] }),
    'encode: неизвестный режим → ошибка'
);
throws(
    () => decode(new Uint8Array([0]), 8, 2, 'BK0010_MONO'),
    'decode: недостаточно байтов → ошибка'
);

// ---------------------------------------------------------------------------
// Итог
// ---------------------------------------------------------------------------
console.log('\nПройдено: ' + passed + ', упало: ' + failed);
if (failed > 0) {
    process.exit(1);
}
