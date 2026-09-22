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
     * @param {number} [count=14] — сколько слов показать (SP примерно по центру)
     * @returns {Array<{address:number,value:number,isSP:boolean}>}
     */
    Stack: function(count) {
        ensureEmulatorReady();
        var n = parseCount(count, 14, 512);
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
     * Состояние отладчика (дополнительно к списку, удобно для UI)
     * @returns {{running:boolean,pc:number,sp:number,breakpoints:number[]}}
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
        return {
            running: !dbg.active,
            pc: cpu.regs[7] & 0xFFFF,
            sp: cpu.regs[6] & 0xFFFF,
            breakpoints: bps
        };
    },

    // =====================================================================
    // Память
    // =====================================================================

    /**
     * Прочитать память
     * @param {number|string} address — начальный адрес слова
     * @param {number} [length=1] — количество слов
     * @returns {number[]} Массив 16-битных слов
     */
    readMemory: function(address, length) {
        ensureEmulatorReady();
        var addr = parseAddress(address);
        var len = parseCount(length, 1, 32768);
        var words = new Array(len);
        for (var i = 0; i < len; i++) {
            words[i] = base.readWORD((addr + i) & 0xFFFF) & 0xFFFF;
        }
        return words;
    },

    /**
     * Записать в память
     * @param {number|string} address — начальный адрес слова
     * @param {number[]} data — массив 16-битных слов
     * @returns {{address:number,written:number}}
     */
    writeMemory: function(address, data) {
        ensureEmulatorReady();
        var addr = parseAddress(address);
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
            base.writeWord((addr + i) & 0xFFFF, w & 0xFFFF);
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
        dbg.bp = cpu.regs[7] & 0xFFFF;
        dbg.step = 1;
        dbg.active = false;
        return { stepped: true, pc: dbg.bp };
    },

    /**
     * Продолжить исполнение до точки останова или паузы
     * @returns {{running:boolean}}
     */
    continue: function() {
        ensureEmulatorReady();
        dbg.active = false;
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
        // ОЗУ эмулятора: страницы 0–6 (слова 0..0xDFFF = 0o000000–0o165777),
        // страница 7 (0xE000 и выше) — ROM и I/O-порты, чистить нельзя
        for (var a = 0; a < 0xE000; a++) {
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
            'getStatus'
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
