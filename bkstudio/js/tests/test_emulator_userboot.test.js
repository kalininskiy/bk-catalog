/**
 * Тест сохранения и восстановления опции userboot (платформы) в эмуляторе БК
 * при перезагрузке (btn-emu-reload, RLD, reload iframe).
 */
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

// ---------------------------------------------------------------------------
// Мок DOM и localStorage для эмулятора
// ---------------------------------------------------------------------------

const storage = {};
const mockLocalStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

class MockOption {
    constructor(val, text) {
        this.value = val;
        this.text = text;
    }
}

class MockSelect {
    constructor(id, options) {
        this.id = id;
        this.options = options.map(o => new MockOption(o.val, o.text));
        this.value = this.options[0].value;
        this.style = {};
    }
}

function runTests() {
    console.log('--- Тест сохранения userboot в эмуляторе БК ---');

    // Очищаем хранилище перед тестом
    mockLocalStorage.clear();

    const bootOptions = [
        { val: 'B10', text: 'BK0010 + Basic ROM' },
        { val: 'F10', text: 'BK0010 + Focal ROM' },
        { val: 'B11', text: 'BK0011M + Basic ROM' },
        { val: 'FDD10', text: 'BK0010 + FDD' },
        { val: 'FDD11', text: 'BK0011M + FDD' },
        { val: 'SMK10', text: 'BK0010 + SMK512 (HDD+FDD)' },
        { val: 'SMK11', text: 'BK0011M + SMK512 (HDD+FDD)' },
        { val: 'FScr', text: 'FullScreen Mode' },
        { val: 'RST', text: 'Reset restart (F12)' },
        { val: 'RLD', text: 'Reload clear all' },
        { val: 'DBG', text: 'Debug (F11)' }
    ];

    let userbootEl = new MockSelect('userboot', bootOptions);
    let currentModel = 'B10';
    let cpuResets = 0;

    const base = {
        setBASIC10Model: () => { currentModel = 'B10'; },
        setFOCAL10Model: () => { currentModel = 'F10'; },
        setBASIC11Model: () => { currentModel = 'B11'; },
        setSMK512Model: (is11) => { currentModel = is11 ? 'SMK11' : 'SMK10'; }
    };
    const cpu = {
        reset: () => { cpuResets++; }
    };

    function userBoot() {
        if (!userbootEl) return;
        const selectedValue = userbootEl.value;
        const isActionCommand = (
            selectedValue === 'FScr' ||
            selectedValue === 'RST' ||
            selectedValue === 'RLD' ||
            selectedValue === 'DBG' ||
            selectedValue === 'Cheat' ||
            selectedValue === 'aDSK0'
        );

        if (!isActionCommand) {
            try {
                mockLocalStorage.setItem('bk_userboot', selectedValue);
            } catch (e) {}
        } else if (selectedValue !== 'RLD') {
            try {
                const saved = mockLocalStorage.getItem('bk_userboot');
                if (saved) {
                    userbootEl.value = saved;
                }
            } catch (e) {}
        }

        switch (selectedValue) {
            case 'B10':
                base.setBASIC10Model();
                cpu.reset();
                break;
            case 'F10':
                base.setFOCAL10Model();
                cpu.reset();
                break;
            case 'B11':
                base.setBASIC11Model();
                cpu.reset();
                break;
            case 'SMK10':
                base.setSMK512Model(false);
                cpu.reset();
                break;
            case 'SMK11':
                base.setSMK512Model(true);
                cpu.reset();
                break;
            case 'FDD10':
                currentModel = 'FDD10';
                break;
            case 'FDD11':
                currentModel = 'FDD11';
                break;
            case 'RST':
                cpu.reset();
                break;
        }
    }

    function initUserBoot(searchParams) {
        if (!userbootEl) return;
        let targetBoot = null;
        if (searchParams && searchParams.get) {
            targetBoot = searchParams.get('boot') || searchParams.get('userboot');
        }
        if (!targetBoot) {
            try {
                targetBoot = mockLocalStorage.getItem('bk_userboot');
            } catch (e) {}
        }
        if (targetBoot) {
            let isValid = userbootEl.options.some(opt => opt.value === targetBoot);
            if (isValid) {
                userbootEl.value = targetBoot;
                if (targetBoot !== 'B10') {
                    userBoot();
                }
            }
        }
    }

    // 1. По умолчанию при отсутствии сохранённого значения: B10
    initUserBoot();
    check('По умолчанию userboot === B10', userbootEl.value === 'B10');
    check('Текущая модель B10', currentModel === 'B10');

    // 2. Пользователь выбирает BK0011M (B11) в выпадающем списке
    userbootEl.value = 'B11';
    userBoot();
    check('Выбранная платформа переключена на B11', currentModel === 'B11');
    check('Опция B11 сохранена в localStorage', mockLocalStorage.getItem('bk_userboot') === 'B11');

    // 3. Симуляция перезагрузки (кнопка btn-emu-reload / reload iframe)
    // Пересоздаём селект как при новой загрузке HTML
    userbootEl = new MockSelect('userboot', bootOptions);
    check('До initUserBoot в чистом HTML селект равен B10', userbootEl.value === 'B10');

    // Запускаем инициализацию эмулятора
    initUserBoot();
    check('После перезагрузки селект восстановил B11', userbootEl.value === 'B11');
    check('После перезагрузки модель восстановлена в B11', currentModel === 'B11');

    // 4. Пользователь выбирает режим с дисководом FDD11
    userbootEl.value = 'FDD11';
    userBoot();
    check('Опция FDD11 сохранена в localStorage', mockLocalStorage.getItem('bk_userboot') === 'FDD11');
    check('Текущий режим FDD11', currentModel === 'FDD11');

    // 5. Повторная перезагрузка эмулятора
    userbootEl = new MockSelect('userboot', bootOptions);
    initUserBoot();
    check('После повторной перезагрузки селект восстановил FDD11', userbootEl.value === 'FDD11');
    check('После повторной перезагрузки модель восстановлена в FDD11', currentModel === 'FDD11');

    // 6. Действие RST не должно стирать FDD11 из localStorage
    userbootEl.value = 'RST';
    userBoot();
    check('Команда RST не затёрла FDD11 в localStorage', mockLocalStorage.getItem('bk_userboot') === 'FDD11');
    check('Селект после RST вернулся к отображению сохранённого FDD11', userbootEl.value === 'FDD11');

    // 7. Поступление сообщения SET_PLATFORM из BKStudio (БК0011М -> B11)
    const is11M = true;
    userbootEl.value = is11M ? 'B11' : 'B10';
    mockLocalStorage.setItem('bk_userboot', userbootEl.value);
    userBoot();
    check('SET_PLATFORM из BKStudio сохранил B11 в localStorage', mockLocalStorage.getItem('bk_userboot') === 'B11');

    // 8. Перезагрузка после установки платформы из BKStudio
    userbootEl = new MockSelect('userboot', bootOptions);
    initUserBoot();
    check('После btn-emu-reload осталась платформа B11 из BKStudio', userbootEl.value === 'B11');
    check('Модель эмулятора B11', currentModel === 'B11');

    // 9. Переключение назад на БК0010 из BKStudio
    userbootEl.value = 'B10';
    mockLocalStorage.setItem('bk_userboot', 'B10');
    userBoot();
    check('SET_PLATFORM БК0010 сохранил B10 в localStorage', mockLocalStorage.getItem('bk_userboot') === 'B10');

    userbootEl = new MockSelect('userboot', bootOptions);
    initUserBoot();
    check('После перезагрузки осталась платформа B10', userbootEl.value === 'B10');

    console.log(`\nИтог: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
