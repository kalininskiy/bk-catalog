#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-graphics-png.js
 *
 * Чистые юнит-тесты без UI. Браузерные IIFE-модули загружаются в общий
 * vm-контекст; canvas/ImageData/createImageBitmap подменяются фейками,
 * поэтому код можно запускать прямо из Node:
 *
 *   node js/tests/bk-graphics-png.test.js
 *
 * Покрыто:
 *   - разбор hex-цветов и поиск ближайшего цвета палитры;
 *   - квантование RGBA в индексы палитры + информация о преобразовании;
 *   - экспорт: индексы → палитра → RGBA → PNG (Blob);
 *   - импорт: PNG → RGBA → ближайший цвет палитры;
 *   - round-trip: модель → PNG → модель (все пиксели сохранены);
 *   - исходный файл при импорте не изменяется;
 *   - обработка ошибок.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Фейковое окружение браузера (canvas 2D / ImageData / createImageBitmap)
// ---------------------------------------------------------------------------

// Фейковый Blob: хранит ImageData вместо реального PNG
class FakeBlob {
    constructor(imageData, type) {
        this._imageData = imageData;
        this.type = type;
        this.size = imageData ? imageData.data.length : 0;
    }
}

// Фейковый canvas: putImageData / getImageData / drawImage / toBlob
class FakeCanvas {
    constructor() {
        this.width = 0;
        this.height = 0;
        this._imageData = null;
    }
    getContext(kind) {
        if (kind !== '2d') {
            return null;
        }
        const canvas = this;
        return {
            putImageData(imageData, x, y) {
                canvas._imageData = imageData;
            },
            getImageData(x, y, w, h) {
                return canvas._imageData;
            },
            drawImage(bitmap, x, y) {
                canvas._imageData = {
                    data: bitmap.data,
                    width: bitmap.width,
                    height: bitmap.height
                };
            }
        };
    }
    toBlob(cb, type) {
        cb(new FakeBlob(this._imageData, type));
    }
}

const sandbox = {
    console: console,
    document: {
        createElement(tag) {
            return new FakeCanvas();
        }
    },
    ImageData: class {
        constructor(rgba, width, height) {
            this.data = rgba;
            this.width = width;
            this.height = height;
        }
    },
    createImageBitmap: (blob) => Promise.resolve({
        width: blob._imageData.width,
        height: blob._imageData.height,
        data: blob._imageData.data,
        close() {}
    })
};
vm.createContext(sandbox);

function loadModule(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
}

loadModule('bk-graphics-modes.js');
loadModule('bk-graphics-model.js');
loadModule('bk-graphics-png.js');

const {
    exportToPng,
    importFromPng,
    imageToRgba,
    quantizeImage,
    findNearestColorIndex,
    formatConversionInfo,
    hexToRgb
} = sandbox.BKGraphicsPng;
const BKGraphicsModel = sandbox.BKGraphicsModel;

// Палитра BK-0011M (черный, синий, зеленый, красный)
const PALETTE = ['#000000', '#0000FF', '#00FF00', '#FF0000'];

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

// ---------------------------------------------------------------------------
// 1. Разбор hex-цветов
// ---------------------------------------------------------------------------
assertEqual(hexToRgb('#FF0000'), { r: 255, g: 0, b: 0 }, 'hexToRgb: #FF0000');
assertEqual(hexToRgb('00ff00'), { r: 0, g: 255, b: 0 }, 'hexToRgb: без #');
assertEqual(hexToRgb('#000000'), { r: 0, g: 0, b: 0 }, 'hexToRgb: #000000');
throws(() => hexToRgb('#GGG000'), 'hexToRgb: не-hex → ошибка');
throws(() => hexToRgb('12345'), 'hexToRgb: короткая строка → ошибка');

// ---------------------------------------------------------------------------
// 2. Поиск ближайшего цвета палитры
// ---------------------------------------------------------------------------
assertEqual(findNearestColorIndex(255, 0, 0, PALETTE), 3, 'nearest: красный точно');
assertEqual(findNearestColorIndex(0, 0, 200, PALETTE), 1, 'nearest: (0,0,200) → синий');
assertEqual(findNearestColorIndex(200, 0, 0, PALETTE), 3, 'nearest: (200,0,0) → красный');
assertEqual(findNearestColorIndex(100, 100, 100, PALETTE), 0, 'nearest: серый → черный');
assertEqual(findNearestColorIndex(255, 128, 0, PALETTE), 3, 'nearest: оранжевый → красный');

// ---------------------------------------------------------------------------
// 3. Квантование RGBA и информация о преобразовании
// ---------------------------------------------------------------------------
// 2x1: красный (в палитре) + оранжевый #FF8800 (вне палитры → ближайший красный)
const rgba = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 136, 0, 255
]);
const q = quantizeImage(rgba, 2, 1, PALETTE);
assertEqual(q.pixels, [3, 3], 'quantize: красный → 3, оранжевый → 3 (ближайший)');
assertEqual(q.info.sourceColors, 2, 'info: 2 цвета на входе');
assertEqual(q.info.inPaletteColors, 1, 'info: 1 цвет в палитре');
assertEqual(q.info.convertedColors, 1, 'info: 1 цвет вне палитры');
assertEqual(q.info.convertedPixels, 1, 'info: 1 пиксель переведен');
check('info.colors: оранжевый → #FF0000',
    q.info.colors.find((c) => c.hex === '#FF8800').mappedHex === '#FF0000');

const text = formatConversionInfo(q.info);
check('formatConversionInfo: количество цветов', text.indexOf('Цвета в PNG: 2') !== -1);
check('formatConversionInfo: строка перевода', text.indexOf('#FF8800 (1 пикс.) → #FF0000') !== -1);

// Все цвета в палитре — конвертация не нужна
const rgbaOk = new Uint8ClampedArray([
    0, 0, 0, 255,
    0, 0, 255, 255,
    0, 255, 0, 255,
    255, 0, 0, 255
]);
const qOk = quantizeImage(rgbaOk, 2, 2, PALETTE);
assertEqual(qOk.pixels, [0, 1, 2, 3], 'quantize: все 4 цвета палитры точно');
assertEqual(qOk.info.convertedColors, 0, 'info: конвертация не потребовалась');
check('formatConversionInfo: без конвертации',
    formatConversionInfo(qOk.info).indexOf('конвертация не потребовалась') !== -1);

throws(() => quantizeImage(new Uint8Array([1, 2, 3]), 2, 1, PALETTE),
    'quantize: недостаточно RGBA-данных → ошибка');

// ---------------------------------------------------------------------------
// 4. Экспорт: индексы → палитра → RGBA
// ---------------------------------------------------------------------------
const rgbaOut = imageToRgba({ width: 2, height: 1, pixels: [1, 2] }, PALETTE);
assertEqual(Array.from(rgbaOut), [0, 0, 255, 255, 0, 255, 0, 255],
    'imageToRgba: индексы 1,2 → синий, зеленый');
throws(() => imageToRgba({ width: 2, height: 1, pixels: [7, 0] }, PALETTE),
    'imageToRgba: индекс вне палитры → ошибка');
throws(() => imageToRgba({ width: 2, height: 1, pixels: [0] }, PALETTE),
    'imageToRgba: короткий массив пикселей → ошибка');

// ---------------------------------------------------------------------------
// 5. Экспорт в PNG (Blob) через canvas
// ---------------------------------------------------------------------------
const model = BKGraphicsModel.create({ mode: 'BK0011M_COLOR', width: 8, height: 2, paletteIndex: 0 });
model.fill(0);
model.setPixel(0, 0, 3);
model.setPixel(1, 0, 2);
model.setPixel(2, 0, 1);
model.setPixel(3, 1, 3);

exportToPng(model, model.palette).then((blob) => {
    check('exportToPng: возвращает Blob типа image/png', blob instanceof FakeBlob && blob.type === 'image/png');
    check('exportToPng: размеры canvas', blob._imageData.width === 8 && blob._imageData.height === 2);
    check('exportToPng: пиксель (0,0) красный',
        blob._imageData.data[0] === 255 && blob._imageData.data[1] === 0 && blob._imageData.data[2] === 0);
    check('exportToPng: альфа везде 255',
        Array.from(blob._imageData.data).filter((v, i) => i % 4 === 3).every((v) => v === 255));

    // -----------------------------------------------------------------------
    // 6. Импорт PNG → индексы палитры (round-trip)
    // -----------------------------------------------------------------------
    return importFromPng(blob, model.palette).then((imported) => {
        assertEqual(imported.pixels, model.pixels, 'round-trip: все пиксели восстановлены');
        assertEqual(imported.width, 8, 'round-trip: ширина');
        assertEqual(imported.height, 2, 'round-trip: высота');
        assertEqual(imported.info.convertedColors, 0, 'round-trip: конвертация не потребовалась');

        // ---------------------------------------------------------------------
        // 7. Импорт PNG с цветами вне палитры
        // ---------------------------------------------------------------------
        const srcData = new Uint8ClampedArray([
            255, 136, 0, 255,   // #FF8800 оранжевый (вне палитры)
            51, 204, 51, 255,   // #33CC33 (вне палитры)
            255, 0, 0, 255,     // красный (в палитре)
            0, 0, 0, 255        // черный (в палитре)
        ]);
        const srcBlob = new FakeBlob({ data: srcData, width: 2, height: 2 }, 'image/png');
        return importFromPng(srcBlob, PALETTE).then((res) => {
            assertEqual(res.pixels, [3, 2, 3, 0], 'вне палитры: оранжевый→красный, #33CC33→зеленый');
            assertEqual(res.info.sourceColors, 4, 'вне палитры: 4 цвета на входе');
            assertEqual(res.info.convertedColors, 2, 'вне палитры: 2 цвета вне палитры');
            assertEqual(res.info.convertedPixels, 2, 'вне палитры: 2 пикселя переведено');
            const infoText = formatConversionInfo(res.info);
            check('вне палитры: info содержит #FF8800 → #FF0000',
                infoText.indexOf('#FF8800 (1 пикс.) → #FF0000') !== -1);
            check('вне палитры: info содержит #33CC33 → #00FF00',
                infoText.indexOf('#33CC33 (1 пикс.) → #00FF00') !== -1);
            // Исходный файл не изменен
            check('вне палитры: исходный файл не изменен',
                Array.from(srcBlob._imageData.data).join(',') === '255,136,0,255,51,204,51,255,255,0,0,255,0,0,0,255');

            // -----------------------------------------------------------------
            // 8. Обработка ошибок
            // ---------------------------------------------------------------------
            return importFromPng(srcBlob, null).then(
                () => {
                    check('importFromPng: без палитры → ошибка', false);
                },
                () => {
                    check('importFromPng: без палитры → ошибка', true);
                }
            );
        });
    }).then(runFinalChecks);
}).catch((e) => {
    console.error(e);
    process.exit(1);
});

// ---------------------------------------------------------------------------
// 8. Ошибки экспорта (синхронные) + итог
// ---------------------------------------------------------------------------
function runFinalChecks() {
    throws(() => exportToPng({ width: 2, height: 1, pixels: [9, 0] }, PALETTE),
        'exportToPng: индекс вне палитры → ошибка');
    throws(() => exportToPng({ width: 2, height: 1, pixels: [0, 0] }),
        'exportToPng: палитра не задана → ошибка');

    console.log('\nПройдено: ' + passed + ', упало: ' + failed);
    if (failed > 0) {
        process.exit(1);
    }
}
