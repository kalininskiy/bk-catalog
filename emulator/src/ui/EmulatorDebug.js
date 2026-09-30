/**
 * EmulatorDebug — программный JSON API отладки эмулятора
 *
 * Предназначен для интеграции с BKStudio и MCP-сервером. 
 * 
 * Все функции принимают и возвращают JSON-сериализуемые значения.
 *
 * Протокол:
 *   - прямой вызов:        emulatorDebug.getRegisters(), emulatorDebug.step() и т.д.
 *   - через postMessage:   BKStudio шлёт {type:'DEBUG_CALL', id, method, params},
 *                          эмулятор отвечает {type:'DEBUG_RESPONSE', id, ok, result|error}
 *   - универсальный вызов: emulatorDebug.invoke(method, params) -> {ok, result|error}
 *
 * Формат адресов:
 *   - число — десятичный адрес слова (0..65535)
 *   - строка — "0x..." (hex), "0o..." (восьмеричный) или десятичные цифры
 *
 * Единицы памяти: 16-битные слова
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

/**
 * Проверить готовность эмулятора (cpu/base/dbg инициализированы)
 * @throws {Error} Если эмулятор ещё не запущен
 */
function ensureEmulatorReady() {
    if (typeof cpu === 'undefined' || !cpu ||
        typeof base === 'undefined' || !base ||
        typeof dbg === 'undefined' || !dbg) {
        throw new Error('Эмулятор ещё не инициализирован');
    }
}

/**
 * Разобрать адрес в виде числа или строки
 * @param {number|string} value — число (десятичное) или строка ("0x1234", "0o100000", "1234")
 * @returns {number} Адрес слова 0..65535
 */
function parseAddress(value) {
    var n;
    if (typeof value === 'number' && isFinite(value)) {
        n = value;
    } else if (typeof value === 'string') {
        var s = value.trim();
        if (/^0x/i.test(s)) {
            n = parseInt(s, 16);
        } else if (/^0o/i.test(s)) {
            n = parseInt(s.slice(2), 8);
        } else if (/^0b/i.test(s)) {
            n = parseInt(s.slice(2), 2);
        } else {
            n = parseInt(s, 10);
        }
        if (!isFinite(n)) {
            throw new Error('Некорректный адрес: ' + value);
        }
    } else {
        throw new Error('Некорректный адрес: ' + value);
    }
    n = Math.floor(n);
    if (n < 0 || n > 0xFFFF) {
        throw new Error('Адрес вне диапазона 0..65535: ' + value);
    }
    return n;
}

/**
 * Разобрать положительное целое с ограничением
 * @param {*} value — число
 * @param {number} def — значение по умолчанию
 * @param {number} max — максимальное значение
 * @returns {number}
 */
function parseCount(value, def, max) {
    var n = (typeof value === 'number' && isFinite(value) && value > 0) ? Math.floor(value) : def;
    return Math.min(n, max);
}

/**
 * Глобальный объект отладочного API эмулятора
 */
emulatorDebug = {

    // =====================================================================
    // Состояние процессора
    // =====================================================================

    /**
     * Получить все регистры CPU
     * @returns {{r0:number,r1:number,r2:number,r3:number,r4:number,r5:number,sp:number,pc:number,psw:string,cycles:number}}
     */
    getRegisters: function() {
        ensureEmulatorReady();
        var r = cpu.regs;
        return {
            r0: r[0] & 0xFFFF,
            r1: r[1] & 0xFFFF,
            r2: r[2] & 0xFFFF,
            r3: r[3] & 0xFFFF,
            r4: r[4] & 0xFFFF,
            r5: r[5] & 0xFFFF,
            sp: r[6] & 0xFFFF,
            pc: r[7] & 0xFFFF,
            psw: cpu.pswstr(),
            cycles: cpu.Cycles
        };
    },

    /**
     * Получить текущий PC (адрес следующей инструкции)
     * @returns {number} Адрес слова
     */
    getPC: function() {
        ensureEmulatorReady();
        return cpu.regs[7] & 0xFFFF;
    },

    /**
     * Получить текущий SP (указатель стека)
     * @returns {number} Адрес слова
     */
    getSP: function() {
        ensureEmulatorReady();
        return cpu.regs[6] & 0xFFFF;
    },

    /**
     * Получить содержимое стека (слова вокруг SP)
     * @param {number} [count=8] — сколько слов показать (SP примерно по центру)
     * @returns {Array<{address:number,value:number,isSP:boolean}>}
     */
    Stack: function(count) {
        ensureEmulatorReady();
        var n = parseCount(count, 8, 512);
        var sp = cpu.regs[6] & 0xFFFF;
        var start = (sp - ((n - 1) >> 1) * 2) & 0xFFFF;
        var out = [];
        for (var i = 0; i < n; i++) {
            var a = (start + i * 2) & 0xFFFF;
            out.push({ address: a, value: base.readWORD(a) & 0xFFFF, isSP: a === sp });
        }
        return out;
    },

    /**
     * Состояние отладчика (дополнительно к списку, удобно для UI и MCP)
     * @returns {{running:boolean,pc:number,sp:number,psw:string,cycles:number,breakpoints:number[],platform:object,tape:object}}
     */
    getStatus: function() {
        ensureEmulatorReady();
        var bps = [];
        if (dbg.breakpoints_set) {
            for (var a in dbg.breakpoints_set) {
                if (dbg.breakpoints_set[a]) bps.push(parseInt(a, 10));
            }
        }
        bps.sort(function(x, y) { return x - y; });
        var is11M = !!(base.isM && base.isM());
        return {
            running: !dbg.active,
            pc: cpu.regs[7] & 0xFFFF,
            sp: cpu.regs[6] & 0xFFFF,
            psw: cpu.pswstr ? cpu.pswstr() : '',
            cycles: cpu.Cycles,
            breakpoints: bps,
            platform: {
                model: is11M ? 'BK0011M' : 'BK0010',
                fdd: !!base.dsks,
                smk512: !!base.isSMK512
            },
            tape: {
                loading: !!(base.FakeTape && base.FakeTape.prep),
                filename: (base.FakeTape && base.FakeTape.filename) || ''
            }
        };
    },

    // =====================================================================
    // Память
    // =====================================================================

    /**
     * Прочитать память (16-битные слова)
     * @param {number|string} address — начальный адрес слова (байт-адрес четный)
     * @param {number} [length=1] — количество слов
     * @returns {number[]} Массив 16-битных слов
     */
    readMemory: function(address, length) {
        ensureEmulatorReady();
        var addr = parseAddress(address) & 0xFFFE;
        var len = parseCount(length, 1, 32768);
        var words = new Array(len);
        for (var i = 0; i < len; i++) {
            words[i] = base.readWORD((addr + i * 2) & 0xFFFF) & 0xFFFF;
        }
        return words;
    },

    /**
     * Записать в память (16-битные слова)
     * @param {number|string} address — начальный адрес слова (байт-адрес четный)
     * @param {number[]} data — массив 16-битных слов
     * @returns {{address:number,written:number}}
     */
    writeMemory: function(address, data) {
        ensureEmulatorReady();
        var addr = parseAddress(address) & 0xFFFE;
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('data должен быть непустым массивом 16-битных слов');
        }
        if (data.length > 32768) {
            throw new Error('Слишком много слов (максимум 32768)');
        }
        for (var i = 0; i < data.length; i++) {
            var w = data[i];
            if (typeof w !== 'number' || !isFinite(w)) {
                throw new Error('Слово №' + i + ' не является числом: ' + w);
            }
            base.writeWord((addr + i * 2) & 0xFFFF, w & 0xFFFF);
        }
        return { address: addr, written: data.length };
    },

    // =====================================================================
    // Разбор кода
    // =====================================================================

    /**
     * Разобрать (disassemble) инструкции по адресу
     * @param {number|string} address — начальный адрес слова
     * @param {number} [count=16] — количество инструкций (максимум 256)
     * @returns {Array<{address:number,hex:string[],text:string}>}
     */
    disassemble: function(address, count) {
        ensureEmulatorReady();
        var a = parseAddress(address);
        var n = parseCount(count, 16, 256);
        var out = [];
        for (var i = 0; i < n; i++) {
            var L = Disasm.opmem_length(base, a);
            if (L < 1) L = 1;
            var text = Disasm.disasm(base, a, false);
            var hex = [];
            for (var j = 0; j < L; j++) {
                var w = base.readWORD((a + j * 2) & 0xFFFF) & 0xFFFF;
                hex.push(('0000' + w.toString(16)).slice(-4));
            }
            out.push({ address: a, hex: hex, text: text });
            a = (a + (L << 1)) & 0xFFFF;
        }
        return out;
    },

    // =====================================================================
    // Управление исполнением
    // =====================================================================

    /**
     * Выполнить одну инструкцию и остановиться
     * (работает и из состояния паузы, и во время исполнения)
     * @returns {{stepped:boolean,pc:number}}
     */
    step: function() {
        ensureEmulatorReady();
        if (typeof dbg !== 'undefined' && dbg) {
            dbg.suppressUI = true;
            dbg.bp = cpu.regs[7] & 0xFFFF;
            dbg.step = 1;
            dbg.active = false;
        }
        return { stepped: true, pc: cpu.regs[7] & 0xFFFF };
    },

    /**
     * Продолжить исполнение до точки останова или паузы
     * @returns {{running:boolean}}
     */
    continue: function() {
        ensureEmulatorReady();
        if (typeof dbg !== 'undefined' && dbg) {
            dbg.suppressUI = true;
            dbg.active = false;
        }
        return { running: true };
    },

    /**
     * Поставить исполнение на паузу
     * @returns {{paused:boolean,pc:number}}
     */
    pause: function() {
        ensureEmulatorReady();
        dbg.active = true;
        return { paused: true, pc: cpu.regs[7] & 0xFFFF };
    },

    /**
     * Сбросить процессор и периферию (точки останова сохраняются)
     * @returns {{reset:boolean,pc:number}}
     */
    reset: function() {
        ensureEmulatorReady();
        dbg.step = 0;
        dbg.bp = 0;
        cpu.reset();
        return { reset: true, pc: cpu.regs[7] & 0xFFFF };
    },

    /**
     * Полный сброс: процессор + очистка ОЗУ (000000–165777) + снятие точек останова
     * @returns {{reset:boolean,cleared:boolean,pc:number}}
     */
    resetAndClear: function() {
        ensureEmulatorReady();
        dbg.step = 0;
        dbg.bp = 0;
        if (dbg.clearBreakpoints) dbg.clearBreakpoints();
        cpu.reset();
        // ОЗУ эмулятора: страницы 0–6 (слова 0..0xDFFF = 0o000000–0o157777),
        // страница 7 (0xE000 и выше) — ROM и I/O-порты, чистить нельзя.
        // Шаг 2 байта на слово (четные адреса):
        for (var a = 0; a < 0xE000; a += 2) {
            base.writeWord(a, 0);
        }
        return { reset: true, cleared: true, pc: cpu.regs[7] & 0xFFFF };
    },

    // =====================================================================
    // Точки останова
    // =====================================================================

    /**
     * Установить точку останова по адресу
     * @param {number|string} address — адрес слова
     * @returns {{breakpoints:number[]}} Текущий список точек останова
     */
    setBreakpoint: function(address) {
        ensureEmulatorReady();
        var a = parseAddress(address);
        dbg.addBreakpoint(a);
        return { breakpoints: this.getStatus().breakpoints };
    },

    /**
     * Снять точку останова по адресу (без аргумента — снять все)
     * @param {number|string} [address] — адрес слова
     * @returns {{breakpoints:number[]}} Текущий список точек останова
     */
    clearBreakpoint: function(address) {
        ensureEmulatorReady();
        if (address === undefined || address === null) {
            dbg.clearBreakpoints();
        } else {
            dbg.removeBreakpoint(parseAddress(address));
        }
        return { breakpoints: this.getStatus().breakpoints };
    },

    // =====================================================================
    // Экран
    // =====================================================================

    /**
     * Сделать скриншот видеобуфера
     * @returns {{width:number,height:number,format:string,dataUrl:string}} PNG data-URL
     */
    getScreenShot: function() {
        var canvas = document.getElementById('BK_canvas');
        if (!canvas) {
            throw new Error('Канвас BK_canvas не найден');
        }
        return {
            width: canvas.width,
            height: canvas.height,
            format: 'png',
            dataUrl: canvas.toDataURL('image/png')
        };
    },

    // =====================================================================
    // Системные регистры
    // =====================================================================

    /**
     * Получить системные регистры (176650..177716) со значениями записи и чтения
     * @returns {Array<{addr:number,name:string,write:number,read:number}>}
     */
    getSystemRegisters: function() {
        ensureEmulatorReady();
        if (base && typeof base.getSystemRegisters === 'function') {
            return base.getSystemRegisters();
        }
        return [];
    },

    // =====================================================================
    // Быстрая загрузка и смена конфигурации
    // =====================================================================

    /**
     * Прямая загрузка BIN файла в память (без ожидания эмуляции кассеты)
     * @param {Array|Uint8Array|string} data — массив байтов или base64 строка
     * @param {number|string} [startAddress] — начальный адрес запуска
     * @param {boolean} [autoRun=true] — запускать ли программу сразу
     * @returns {{loaded:boolean,address:number,length:number,startPC:number,autoRun:boolean}}
     */
    directLoadBIN: function(data, startAddress, autoRun) {
        ensureEmulatorReady();
        var bytes = data;
        if (typeof data === 'string') {
            try {
                var binaryString = atob(data);
                bytes = new Uint8Array(binaryString.length);
                for (var i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
            } catch (e) {
                throw new Error('Не удалось декодировать Base64 данные: ' + e.message);
            }
        }
        var startAddr = (startAddress !== undefined && startAddress !== null)
            ? parseAddress(startAddress)
            : undefined;
        var shouldRun = (autoRun !== undefined) ? !!autoRun : true;
        return base.directLoadBIN(bytes, startAddr, shouldRun);
    },

    /**
     * Установить конфигурацию платформы БК
     * @param {string} mode — 'B10'|'F10'|'B11'|'base10'|'FDD10'|'FDD11'|'SMK10'|'SMK11'
     * @returns {{platform:string,model:string}}
     */
    setPlatform: function(mode) {
        ensureEmulatorReady();
        if (typeof mode !== 'string') {
            throw new Error('Параметр mode должен быть строкой');
        }
        var targetMode = mode.trim();
        if (targetMode === 'БК0010' || targetMode === 'BK0010') targetMode = 'B10';
        else if (targetMode === 'БК0011М' || targetMode === 'BK0011M' || targetMode === 'BK11M') targetMode = 'B11';

        base.configurePlatform(targetMode);
        cpu.reset();

        var userboot = document.getElementById('userboot');
        if (userboot) {
            userboot.value = targetMode;
            try {
                localStorage.setItem('bk_userboot', targetMode);
            } catch (e) {}
        }
        return {
            platform: targetMode,
            model: (base.isM && base.isM()) ? 'BK0011M' : 'BK0010'
        };
    },

    // =====================================================================
    // Клавиатура и джойстик (ввод)
    // =====================================================================

    _resolveKeyCode: function(key) {
        if (typeof key === 'number') {
            return key & 0xFF;
        }
        if (typeof key === 'string') {
            var k = key.trim();
            var NAMED_KEYS = {
                'space': 32, 'sp': 32, 'пробел': 32,
                'enter': 10, 'return': 10, 'ввод': 10,
                'backspace': 8, 'bs': 8, 'забой': 8,
                'tab': 9, 'таб': 9,
                'escape': 27, 'esc': 27, 'стоп': 27, 'stop': 27,
                'arrowleft': 8, 'left': 8, 'влево': 8,
                'arrowright': 25, 'right': 25, 'вправо': 25,
                'arrowup': 26, 'up': 26, 'вверх': 26,
                'arrowdown': 27, 'down': 27, 'вниз': 27,
                'clear': 12, 'сброс': 12,
                'rus': 14, 'рус': 14,
                'lat': 15, 'лат': 15
            };
            var lower = k.toLowerCase();
            if (NAMED_KEYS[lower] !== undefined) {
                return NAMED_KEYS[lower];
            }
            if (k.length === 1) {
                return k.charCodeAt(0) & 0xFF;
            }
            var num = parseInt(k, 10);
            if (!isNaN(num)) return num & 0xFF;
        }
        return 32;
    },

    keyPress: function(key, durationMs) {
        ensureEmulatorReady();
        var code = this._resolveKeyCode(key);
        var dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : 100;

        base.keyboard_punch(code);
        base.keyboard_setKeyDown(true);

        setTimeout(function() {
            if (base && typeof base.keyboard_setKeyDown === 'function') {
                base.keyboard_setKeyDown(false);
            }
        }, dur);

        return {
            pressed: true,
            key: code,
            name: String(key)
        };
    },

    keyType: function(text, delayMs) {
        ensureEmulatorReady();
        if (typeof text !== 'string') {
            throw new Error('Параметр text должен быть строкой');
        }
        var delay = (typeof delayMs === 'number' && delayMs > 0) ? delayMs : 50;
        var chars = text.split('');
        var self = this;

        chars.forEach(function(ch, idx) {
            setTimeout(function() {
                var code = self._resolveKeyCode(ch);
                base.keyboard_punch(code);
                base.keyboard_setKeyDown(true);
                setTimeout(function() {
                    base.keyboard_setKeyDown(false);
                }, Math.min(30, delay / 2));
            }, idx * delay);
        });

        return {
            typed: true,
            length: text.length
        };
    },

    joystickSet: function(state) {
        ensureEmulatorReady();
        var mask = 0;
        if (typeof state === 'number') {
            mask = state & 0xFFFF;
        } else if (state && typeof state === 'object') {
            if (state.up) mask |= 0x0001;
            if (state.right) mask |= 0x0002;
            if (state.down) mask |= 0x0004;
            if (state.left) mask |= 0x0008;
            if (state.fire || state.fire1 || state.buttonA) mask |= 0x0020;
            if (state.altFire || state.fire2 || state.buttonB) mask |= 0x0040;
        }

        if (base && typeof base.joystick_setState === 'function') {
            base.joystick_setState(mask);
        }

        return {
            state: mask,
            up: !!(mask & 0x0001),
            right: !!(mask & 0x0002),
            down: !!(mask & 0x0004),
            left: !!(mask & 0x0008),
            fire: !!(mask & 0x0020),
            altFire: !!(mask & 0x0040)
        };
    },

    // =====================================================================
    // Диспетчер вызовов (JSON-RPC)
    // =====================================================================

    /**
     * Вызвать метод по имени (для postMessage / MCP)
     * @param {string} method — имя метода
     * @param {Array} [params] — позиционные аргументы
     * @returns {{ok:boolean,result?:*,error?:string}}
     */
    invoke: function(method, params) {
        var PUBLIC_METHODS = [
            'getRegisters', 'Stack', 'readMemory', 'writeMemory',
            'getPC', 'getSP', 'disassemble',
            'step', 'continue', 'pause', 'reset', 'resetAndClear',
            'setBreakpoint', 'clearBreakpoint', 'getScreenShot',
            'getStatus', 'getSystemRegisters',
            'directLoadBIN', 'setPlatform',
            'keyPress', 'keyType', 'joystickSet'
        ];
        try {
            if (typeof method !== 'string' || PUBLIC_METHODS.indexOf(method) === -1) {
                return { ok: false, error: 'Неизвестный метод: ' + method };
            }
            var fn = emulatorDebug[method];
            var args = Array.isArray(params) ? params : [];
            var result = fn.apply(emulatorDebug, args);
            return { ok: true, result: result };
        } catch (err) {
            return { ok: false, error: (err && err.message) ? err.message : String(err) };
        }
    }
};
