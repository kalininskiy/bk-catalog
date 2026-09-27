/**
 * Тест загрузки MSTD Tests ROM в память БК-0010 в режиме FOCAL (F10)
 * Проверяет:
 * 1. Наличие tests10_data в SystemROMs.js и соответствие reference/bkemu-android/.../tests.rom
 * 2. Корректную адресацию тестов по восьмеричным адресам 160000..177577 в setFOCAL10Model
 * 3. Недоступность страницы 140000 в режиме Focal MSTD
 * 4. Корректное переключение между BASIC10 и FOCAL10
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0;
let failed = 0;

function check(desc, cond) {
    if (cond) {
        passed++;
        console.log('PASS: ' + desc);
    } else {
        failed++;
        console.error('FAIL: ' + desc);
    }
}

function runTests() {
    console.log('--- Тест MSTD Tests ROM в режиме F10 (FOCAL) ---');

    // 1. Проверяем SystemROMs.js
    const rootDir = path.resolve(__dirname, '../../../');
    const roms = require(path.join(rootDir, 'emulator/src/system/SystemROMs.js'));

    check('tests10_data экспортируется из SystemROMs.js', typeof roms.tests10_data !== 'undefined');
    check('tests10_data имеет длину 4032 слова (8064 байт)', roms.tests10_data && roms.tests10_data.length === 4032);

    // 2. Сверяем с исходным файлом tests.rom
    const rawTestsPath = path.join(rootDir, 'reference/bkemu-android/app/src/main/res/raw/tests.rom');
    const rawBuffer = fs.readFileSync(rawTestsPath);

    let matchAll = true;
    for (let i = 0; i < roms.tests10_data.length; i++) {
        const expectedWord = rawBuffer[i * 2] | (rawBuffer[i * 2 + 1] << 8);
        if (roms.tests10_data[i] !== expectedWord) {
            matchAll = false;
            break;
        }
    }
    check('tests10_data побайтово совпадает с reference tests.rom', matchAll);

    // 3. Загружаем и тестируем BaseBK001x
    global.window = { innerWidth: 512, innerHeight: 256, addEventListener: () => {} };
    global.document = {
        getElementById: () => ({
            getContext: () => ({
                getImageData: () => ({ data: [] }),
                createImageData: () => ({ data: [] }),
                putImageData: () => {}
            })
        })
    };

    const romsCode = fs.readFileSync(path.join(rootDir, 'emulator/src/system/SystemROMs.js'), 'utf8');
    vm.runInThisContext(romsCode);

    global.QBusReadDTO = function(val) { return { value: val }; };
    const mockPlugin = { getBaseAddress: () => 0o200000, getNumWords: () => 0, getKeyDown: () => false, getIO: () => 0 };
    global.CPUTimer = function() { return mockPlugin; };
    global.SystemRegs = function() { return mockPlugin; };
    global.TurboSound = function() { return mockPlugin; };
    global.Keyboard = function() { return mockPlugin; };
    global.Joystick = function() { return mockPlugin; };
    global.SoundRenderer = function() { return { setTapeSpeed: () => {}, setSynth: () => {} }; };
    global.AY8910 = function() { return mockPlugin; };
    global.Covox = function() { return mockPlugin; };
    global.FDDController = function() { return mockPlugin; };
    global.SmkMemoryManager = function() { return mockPlugin; };
    global.SmkIdeController = function() { return mockPlugin; };

    const bkSysCode = fs.readFileSync(path.join(rootDir, 'emulator/src/system/BKSystem.js'), 'utf8');
    vm.runInThisContext(bkSysCode);

    const base = new BaseBK001x();
    base.setFOCAL10Model();

    const dto = { value: 0 };

    // FOCAL @ 0o120000
    const okFocal = base.readWord(0o120000, dto);
    check('FOCAL по адресу 0o120000 читается', okFocal && dto.value === focal10_data[0]);

    // Недоступность 0o140000
    const ok140 = base.readWord(0o140000, dto);
    check('Страница 0o140000 в режиме Focal недоступна для чтения (Bus Error)', ok140 === false);

    // Первое слово тестов @ 0o160000 (должно быть 0o005037 / CLR)
    const ok160_start = base.readWord(0o160000, dto);
    check('Тесты по адресу 0o160000 читаются (первое слово 0o5037)', ok160_start && dto.value === 0o005037);

    // Второе слово @ 0o160002
    const ok160_word2 = base.readWord(0o160002, dto);
    check('Тесты по адресу 0o160002 читаются (слово 0o262)', ok160_word2 && dto.value === 0o000262);

    // Последнее слово тестов @ 0o177576 (слово перед портами ввода-вывода)
    const ok160_last = base.readWord(0o177576, dto);
    check('Тесты по адресу 0o177576 читаются корректно', ok160_last && dto.value === tests10_data[4031]);

    // Переключение в Бейсик и обратно
    base.setBASIC10Model();
    base.readWord(0o160000, dto);
    check('В режиме BASIC10 по адресу 0o160000 находится 3-я часть Бейсика', dto.value === basic10_data[8192]);

    base.setFOCAL10Model();
    base.readWord(0o160000, dto);
    check('После возврата в F10 по адресу 0o160000 снова тесты МСТД', dto.value === tests10_data[0]);

    console.log(`\nРезультаты: ${passed} пройдено, ${failed} провалено.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
