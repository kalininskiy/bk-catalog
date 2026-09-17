/**
 * Программируемый таймер процессора К1801ВМ1 / БК-0010 / БК-0011М
 * 
 * Точная эталонная эмуляция системного таймера процессора К1801ВМ1 по адресам
 * 177706-177712 (восьмеричные), соответствующая аппаратной реализации и эталонному
 * коду эмулятора Gid (reference/BKemuv4/BK/devemu/CPU.cpp, строки 224-326 и 970-1005).
 * 
 * Карта регистров (восьмеричные адреса):
 * - 177706 (65478): Регистр предела счета TVE_LIMIT (чтение/запись)
 * - 177710 (65480): Регистр текущего значения TVE_VAL (только чтение)
 * - 177712 (65482): Регистр управления таймером TVE_CSR (чтение/запись)
 * 
 * Разряды регистра управления (TVE_CSR, 177712):
 * - Бит 0 (0x01): SP - источник тактов (0 = f_cpu/128, 1 = внешний nSP; на БК не подключен, пауза)
 * - Бит 1 (0x02): CAP - автоперезагрузка (0 = загрузка из start, 1 = свободный счет 0..65535..0)
 * - Бит 2 (0x04): MON - разрешение фиксации переполнения (1 = взводить бит 7 FL)
 * - Бит 3 (0x08): OS - однократный пуск (1 = остановка таймера по достижении 0)
 * - Бит 4 (0x10): RUN - пуск таймера (1 = счет разрешен, 0 = остановлен)
 * - Бит 5 (0x20): D16 - делитель на 16 (0 = выкл, 1 = вкл)
 * - Бит 6 (0x40): D4 - делитель на 4 (0 = выкл, 1 = вкл)
 * - Бит 7 (0x80): FL - флаг переполнения (1 = было переполнение; сброс программной записью 0)
 * - Биты 8-15: всегда читаются как 1 (0xFF, константа 0177400)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
CPUTimer = function()
{
    var self = this;
    
    // ============================================================================
    // РЕГИСТРЫ ТАЙМЕРА
    // ============================================================================
    
    /**
     * Регистр предела счета TVE_LIMIT (177706)
     * Значение, загружаемое в счетчик при запуске или перезагрузке
     */
    var /*short*/start = 0;
    
    /**
     * Регистр текущего значения TVE_VAL (177710)
     * Счетчик обратного отсчета, доступен только для чтения
     */
    var /*short*/count = 65535;
    
    /**
     * Регистр управления TVE_CSR (177712)
     * Старший байт всегда читается как 0xFF (константа 0177400)
     */
    var /*short*/config = 65280; // 0xFF00 (177400 восьмеричный)
    
    /**
     * Внутренний счетчик предделителя частоты (m_nTVE_Cnt)
     */
    var tveCnt = 0;
    
    /**
     * Текущий коэффициент предделителя: 1, 4, 16 или 64 (m_nTVE_Divider)
     */
    var tveDivider = 1;
    
    /**
     * Внутренний триггер запроса прерывания / первого срабатывания (m_bTimerRq)
     * Реализует аппаратную аномалию К1801ВМ1: флаг FL устанавливается только
     * после ВТОРОГО перехода через ноль после системного сброса.
     */
    var timerRq = false;
    
    /**
     * Счетчик тактов CPU на момент последнего обновления таймера
     */
    self.cycles = 0;

    // ============================================================================
    // ИНТЕРФЕЙС УСТРОЙСТВА QBUS
    // ============================================================================
    
    /**
     * Базовый адрес таймера в карте памяти
     * @returns {number} 65478 (177706 восьмеричный)
     */
    /*int*/this.getBaseAddress = function()
    {
        return 65478;  // 177706 octal
    };

    /**
     * Число 16-битных слов, занимаемых регистрами таймера
     * @returns {number} 3 слова (start, count, config)
     */
    /*int*/this.getNumWords = function()
    {
        return 3;
    };

    /**
     * Проверка отложенного прерывания от таймера
     * На БК-0010/БК-0011М прерывание от таймера аппаратно заблокировано
     * @returns {boolean} Всегда false
     */
    /*boolean*/this.gotInterrupt = function()
    {
        return false;
    };

    /**
     * Вектор прерывания таймера
     * @returns {number} Всегда 0
     */
    /*byte*/this.interruptVector = function()
    {
        return 0;
    };

    // ============================================================================
    // ФУНКЦИИ ДОСТУПА К ПАМЯТИ (QBUS)
    // ============================================================================
    
    /**
     * Чтение 16-битного слова из регистра таймера
     * @param {number} addr - Адрес памяти (выравнивается по четному адресу)
     * @param {QBusReadDTO} result - Объект для сохранения прочитанного значения
     * @returns {boolean} true если адрес принадлежит таймеру, false иначе
     */
    /*boolean*/this.readWord = function(/*int*/addr, /*QBusReadDTO*/ result)
    {
        self.updateTimer();

        var regAddr = (addr & ~1) >>> 0;
        switch (regAddr)
        {
        case 65478:  // 177706 восьмеричный - регистр предела счета TVE_LIMIT
            result.value = start & 0xFFFF;
            return true;
            
        case 65480:  // 177710 восьмеричный - текущее значение счетчика TVE_VAL (только чтение)
            result.value = count & 0xFFFF;
            return true;
            
        case 65482:  // 177712 восьмеричный - регистр управления TVE_CSR
            result.value = config & 0xFFFF;
            return true;
        }
        
        return false;
    };

    /**
     * Побайтовая запись в регистры таймера
     * @param {number} addr - Адрес памяти
     * @param {number} data - Значение байта или упакованное слово из BKSystem
     * @returns {boolean} true если адрес принадлежит таймеру
     */
    /*boolean*/this.writeByteAsWord = function(/*int*/addr, /*short*/data)
    {
        self.updateTimer();

        var isOdd = (addr & 1) !== 0;
        var byteVal = isOdd
            ? (((data & 0xFF00) !== 0) ? ((data >>> 8) & 0xFF) : (data & 0xFF))
            : (data & 0xFF);

        var regAddr = (addr & ~1) >>> 0;
        switch (regAddr)
        {
        case 65478:  // 177706 - TVE_LIMIT
            if (isOdd) {
                start = ((start & 0x00FF) | (byteVal << 8)) & 0xFFFF;
            } else {
                start = ((start & 0xFF00) | byteVal) & 0xFFFF;
            }
            return true;

        case 65480:  // 177710 - TVE_VAL (только чтение, запись игнорируется)
            return true;

        case 65482:  // 177712 - TVE_CSR
            // Маска записи регистра 177712 — 0377 (младший байт).
            // Запись в нечетный байт не может изменить биты 8-15 (они всегда 1),
            // но инициирует перезагрузку регистра согласно логике процессора.
            var newCfg = isOdd
                ? config
                : ((config & 0xFF00) | byteVal);
            setCSR(newCfg);
            return true;
        }

        return false;
    };

    /**
     * Запись 16-битного слова в регистр таймера
     * @param {number} addr - Адрес памяти
     * @param {number} data - 16-битное слово для записи
     * @returns {boolean} true если адрес принадлежит таймеру, false иначе
     */
    /*boolean*/this.writeWord = function(/*int*/addr, /*short*/data)
    {
        self.updateTimer();
        
        var regAddr = (addr & ~1) >>> 0;
        switch (regAddr)
        {
        case 65478:  // 177706 - TVE_LIMIT (регистр предела счета)
            start = data & 0xFFFF;
            return true;
            
        case 65480:  // 177710 - TVE_VAL (только чтение, запись игнорируется)
            return true;
            
        case 65482:  // 177712 - TVE_CSR (регистр управления)
            setCSR(data);
            return true;
        }
        
        return false;
    };

    // ============================================================================
    // СБРОС ТАЙМЕРА
    // ============================================================================
    
    /**
     * Сброс таймера в начальное состояние (CCPU::ResetTimer)
     */
    /*void*/this.reset = function()
    {
        start = 0;
        count = 65535;
        config = 65280;  // 177400 восьмеричный (старший байт = 0xFF)
        tveCnt = 0;
        tveDivider = 1;
        timerRq = false;
        self.cycles = (typeof cpu !== 'undefined' && cpu) ? cpu.Cycles : 0;
    };

    // ============================================================================
    // ВНУТРЕННИЕ ФУНКЦИИ
    // ============================================================================
    
    /**
     * Запись в регистр управления TVE_CSR (177712)
     * Реализует CCPU::SetSysRegs(0177712, ...) из reference/BKemuv4/BK/devemu/CPU.cpp:970-1005:
     * 1. Проверяет условие взвода запроса при count == 0
     * 2. Сбрасывает фазу предделителя (m_nTVE_Cnt = 0)
     * 3. Устанавливает коэффициент предделителя (1, 4, 16, 64)
     * 4. Фиксирует старшие биты 8-15 в 1 (0xFF)
     * 5. Безусловно копирует значение TVE_LIMIT (177706) в TVE_COUNT (177710)
     * 
     * @param {number} data - Новое значение регистра управления
     */
    function /*void*/setCSR(/*short*/data)
    {
        // Проверка условия tve_zero (CPU.cpp:973-978)
        var tve_zero = (count === 0) && !((data & 0x02) !== 0);
        if (((data & 0x04) !== 0) && tve_zero) {
            timerRq = true;
        }

        // Сброс счетчика предделителя
        tveCnt = 0;

        // Расчет предделителя по битам D4 (0x40) и D16 (0x20)
        switch (data & (0x40 | 0x20)) {
            case 0:
                tveDivider = 1;
                break;
            case 0x20: // TVE_D16 (бит 5) - делитель на 16
                tveDivider = 16;
                break;
            case 0x40: // TVE_D4 (бит 6) - делитель на 4
                tveDivider = 4;
                break;
            case 0x60: // TVE_D4 | TVE_D16 - делитель на 64
                tveDivider = 64;
                break;
        }

        // Старшие биты 8-15 не используются и всегда равны 1 (0177400)
        config = ((data & 0xFF) | 0xFF00) & 0xFFFF;

        // По эталону Gid (CPU.cpp:1003): любая запись в регистр управления сразу копирует start в count
        count = start & 0xFFFF;
    }
    
    /**
     * Потактовая обработка одного 128-тактового тика таймера
     * В точности соответствует CCPU::TimerProcess() (CPU.cpp:274-326)
     */
    function timerProcess()
    {
        // Бит 0 (TVE_SP): если счётчик остановлен (внешний тактовый вход nSP)
        if ((config & 0x01) !== 0) {
            return;
        }

        // Бит 4 (TVE_RUN): если счётчик запущен
        if ((config & 0x10) !== 0) {
            if (++tveCnt >= tveDivider) {
                tveCnt = 0;

                // Уменьшаем текущее значение таймера на 1
                count = (count - 1) & 0xFFFF;
                if (count === 0) {
                    if ((config & 0x02) !== 0) { // TVE_CAP: режим WRAPAROUND
                        // Непрерывный счёт без перезагрузки счётчика
                    } else {
                        // Если не режим WRAPAROUND, то значение счётчика перезагружаем
                        count = start & 0xFFFF; // Загрузим в счётчик начальное значение

                        if ((config & 0x04) !== 0) { // TVE_MON: разрешение установки сигнала "конец счёта"
                            if (timerRq) {
                                config |= 0x80; // TVE_FL: устанавливаем флаг окончания счета
                            } else {
                                timerRq = true; // Иначе устанавливаем запрос на прерывание
                            }
                        }

                        if ((config & 0x08) !== 0) { // TVE_OS: установлен режим одновибратора
                            config &= ~0x10; // Сбрасываем бит RUN (остановка)
                        }
                    }
                }
            }
        }
    }

    // ============================================================================
    // ЛОГИКА ОБНОВЛЕНИЯ ТАЙМЕРА
    // ============================================================================

    /**
     * Обновление состояния таймера на основе прошедших тактов CPU
     * Вызывается перед каждым обращением к регистрам таймера
     */
    /*void*/this.updateTimer = function()
    {
        if (typeof cpu === 'undefined' || !cpu) {
            return;
        }

        var elapsed = cpu.Cycles - self.cycles;
        if (elapsed < 128) {
            return;
        }

        var steps = (elapsed / 128) | 0;
        self.cycles += steps * 128;

        // Если таймер не считает (SP=1 или RUN=0), шаги не изменяют регистры
        if ((config & 0x01) !== 0 || (config & 0x10) === 0) {
            return;
        }

        for (var i = 0; i < steps; i++) {
            timerProcess();
            // Если таймер остановился по TVE_OS, оставшиеся шаги не нужны
            if ((config & 0x10) === 0) {
                break;
            }
        }
    };

    /**
     * Сохранить состояние таймера
     * @returns {Object} Состояние регистров таймера
     */
    this.getState = function() {
        return {
            start: start,
            count: count,
            config: config,
            tveCnt: tveCnt,
            tveDivider: tveDivider,
            period: 128 * tveDivider,
            timerRq: timerRq,
            cycles: self.cycles
        };
    };

    /**
     * Восстановить состояние таймера
     * @param {Object} state - Объект состояния из getState()
     */
    this.setState = function(state) {
        if (!state) return;
        start = (state.start !== undefined) ? state.start & 0xFFFF : 0;
        count = (state.count !== undefined) ? state.count & 0xFFFF : 65535;
        config = (state.config !== undefined) ? state.config & 0xFFFF : 65280;
        tveCnt = (state.tveCnt !== undefined) ? state.tveCnt : 0;
        if (state.tveDivider !== undefined) {
            tveDivider = state.tveDivider;
        } else if (state.period !== undefined) {
            tveDivider = Math.max(1, (state.period / 128) | 0);
        } else {
            tveDivider = 1;
        }
        timerRq = (state.timerRq !== undefined) ? !!state.timerRq : false;
        self.cycles = (state.cycles !== undefined) ? state.cycles : 0;
    };
    
    // ============================================================================
    // КОНСТРУКТОР
    // ============================================================================
    
    return self;
};
