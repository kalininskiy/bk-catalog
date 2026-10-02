/**
 * BKStudio - C/C23 Language Support & Language Server Provider
 *
 * Full-featured Language Server Protocol (LSP) intelligence for C in Monaco Editor:
 * - C23 / GNU C Monarch Syntax Highlighting & Tokenization
 * - Outline / Document Symbols (Functions, Structs, Enums, Macros, Variables)
 * - Go to Definition & Declaration (Local & Cross-file navigation)
 * - Find References across all project files
 * - Rich Hover Tooltips with Signatures, Doxygen Docs & BK-0010/0011M Hardware Specs
 * - Smart Completion with C23 keywords, BK Runtime APIs, Project Symbols & Struct Members (., ->)
 * - Signature Help with active parameter highlighting
 * - Symbol Rename (F2) across project files
 * - Real-time Diagnostics (syntax errors, unbalanced brackets, missing semicolons, undeclared calls)
 *
 * 100% Vanilla JavaScript - Zero NPM dependencies.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  // =========================================================================
  // 1. БАЗА ЗНАНИЙ СИ И АППАРАТУРЫ БК-0010 / БК-0011М ДЛЯ HOVER & AUTOCOMPLETE
  // =========================================================================

  const C_TYPES_INFO = {
    'uint8_t': { size: '1 байт (8 бит)', range: '0 .. 255', desc: 'Беззнаковое 8-битное целое число (unsigned char)' },
    'int8_t': { size: '1 байт (8 бит)', range: '-128 .. 127', desc: 'Знаковое 8-битное целое число (signed char)' },
    'uint16_t': { size: '2 байта (16 бит, слово PDP-11)', range: '0 .. 65535 (0177777)', desc: 'Беззнаковое 16-битное целое слово процессора КР1801ВМ1' },
    'int16_t': { size: '2 байта (16 бит, слово PDP-11)', range: '-32768 .. 32767', desc: 'Знаковое 16-битное целое слово процессора КР1801ВМ1' },
    'uint32_t': { size: '4 байта (32 бит, 2 слова PDP-11)', range: '0 .. 4294967295', desc: 'Беззнаковое 32-битное целое число (unsigned long)' },
    'int32_t': { size: '4 байта (32 бит, 2 слова PDP-11)', range: '-2147483648 .. 2147483647', desc: 'Знаковое 32-битное целое число (long int)' },
    'size_t': { size: '2 байта (16 бит)', range: '0 .. 65535', desc: 'Тип размера объекта памяти (unsigned int на 16-битном PDP-11)' },
    'intptr_t': { size: '2 байта (16 бит)', range: '-32768 .. 32767', desc: 'Знаковый целочисленный тип, вмещающий указатель PDP-11' },
    'uintptr_t': { size: '2 байта (16 бит)', range: '0 .. 65535', desc: 'Беззнаковый целочисленный тип, вмещающий указатель PDP-11' },
    'bool': { size: '1 байт (C23 / stdbool.h)', range: 'true (1) или false (0)', desc: 'Логический булев тип' },
    'nullptr_t': { size: '2 байта (C23)', range: 'nullptr', desc: 'Тип константы нулевого указателя nullptr в стандарте C23' }
  };

  const C23_KEYWORDS_INFO = {
    'constexpr': 'Спецификатор константного выражения времени компиляции (C23). Заменяет `#define` типизированными константами.',
    'typeof': 'Оператор вывода типа выражения (C23 / GNU extension). Например: `typeof(x) y = x;`',
    'typeof_unqual': 'Оператор вывода неквалифицированного типа (без const/volatile) выражения (C23).',
    'nullptr': 'Встроенная константа нулевого указателя (C23). Безопасная типобезопасная альтернатива макросу NULL (0).',
    'static_assert': 'Проверка условий на этапе компиляции: `static_assert(sizeof(int) == 2, "PDP-11 16-bit");` (C23).',
    'alignas': 'Спецификатор выравнивания типа или переменной в памяти: `alignas(2) uint8_t buf[64];` (C23).',
    'alignof': 'Оператор получения необходимого выравнивания типа в байтах (C23).',
    'bool': 'Встроенный логический тип данных языка C23 (`true` / `false`).',
    'true': 'Логическая истина (1) стандарта C23.',
    'false': 'Логическая ложь (0) стандарта C23.',
    'thread_local': 'Спецификатор потоко-локальной памяти стандарта C23.'
  };

  const BK_HARDWARE_INFO = {
    // 1. Распределение памяти (enum MEMORY из memory.h)
    'MEM_SYSTEM': {
      title: 'MEM_SYSTEM (0000000 / 0x0000)',
      desc: 'Системные переменные БК-0010 (область 0000000..0000277).'
    },
    'MEM_STACK': {
      title: 'MEM_STACK (0000300 / 0x00C0)',
      desc: 'Аппаратный стек процессора К1801ВМ1 на БК-0010 (0000300..0000777).'
    },
    'MEM_USER': {
      title: 'MEM_USER (0001000 / 0x0200)',
      desc: 'Базовый адрес ОЗУ пользователя БК-0010. Стандартный адрес загрузки исполняемых программ (`.text load_address = 01000`).'
    },
    'MEM_VIDEO': {
      title: 'MEM_VIDEO (0040000 / 0x4000)',
      desc: 'Начальный адрес ОЗУ экрана БК-0010/0011М в адресном пространстве процессора.\n- Размер: 16 КБ (8192 слова / 16384 байта, 0040000..0077777)\n- Разрешение: 512×256 (ч/б) или 256×256 (4 цвета)\n- В одной строке: 64 байта (32 слова)'
    },
    'MEM_EXTMEM': {
      title: 'MEM_EXTMEM (0070000 / 0x7000)',
      desc: 'ОЗУ экрана в режиме расширенной памяти БК-0010.'
    },
    'MEM_ROM_MON': {
      title: 'MEM_ROM_MON (0100000 / 0x8000)',
      desc: 'Базовый адрес ПЗУ системного Монитора БК-0010 и системных драйверов EMT.'
    },
    'MEM_ROM_1': {
      title: 'MEM_ROM_1 (0120000 / 0xA000)',
      desc: '1-е съёмное ПЗУ "Бейсик" (или Фокал) БК-0010.'
    },
    'MEM_ROM_2': {
      title: 'MEM_ROM_2 (0140000 / 0xC000)',
      desc: '2-е съёмное ПЗУ "Бейсик" БК-0010.'
    },
    'MEM_ROM_3': {
      title: 'MEM_ROM_3 (0160000 / 0xE000)',
      desc: '3-е съёмное ПЗУ "Бейсик" (или тесты МСТД) БК-0010.'
    },
    'MEM_REGS': {
      title: 'MEM_REGS (0177600 / 0xFF80)',
      desc: 'Область адресов системных регистров ввода-вывода БК-0010 (0177600..0177777).'
    },
    'MEM_END': {
      title: 'MEM_END (0177777 / 0xFFFF)',
      desc: 'Верхняя граница адресного пространства процессора БК-0010.'
    },

    // 2. Вектора прерываний (enum VECTORS из memory.h)
    'VEC_STOP': {
      title: 'VEC_STOP (000004)',
      desc: 'Вектор исключения по нажатию клавиши «СТОП» или зависанию шины (таймаут обращения).'
    },
    'VEC_RES_CPU_INSTR': {
      title: 'VEC_RES_CPU_INSTR (000010)',
      desc: 'Вектор прерывания по резервной инструкции процессора К1801ВМ1.'
    },
    'VEC_T_BIT': {
      title: 'VEC_T_BIT (000014)',
      desc: 'Вектор прерывания по Т-разряду (пошаговая трассировка отладчика).'
    },
    'VEC_IOT': {
      title: 'VEC_IOT (000020)',
      desc: 'Вектор прерывания по инструкции IOT (ввод-вывод).'
    },
    'VEC_POWER_FAIL': {
      title: 'VEC_POWER_FAIL (000024)',
      desc: 'Вектор исключения при аварии сетевого питания (Power Fail).'
    },
    'VEC_EMT': {
      title: 'VEC_EMT (000030)',
      desc: 'Вектор системных вызовов Монитора по инструкции EMT (Emulator Trap).'
    },
    'VEC_TRAP': {
      title: 'VEC_TRAP (000034)',
      desc: 'Вектор прерывания по инструкции TRAP.'
    },
    'VEC_KEYBOARD': {
      title: 'VEC_KEYBOARD (000060)',
      desc: 'Вектор аппаратного прерывания от контроллера клавиатуры БК.'
    },
    'VEC_IRQ2': {
      title: 'VEC_IRQ2 (000100)',
      desc: 'Вектор внешнего прерывания по линии IRQ2 (системный таймер 50 Гц / внешние устройства).'
    },
    'VEC_KEY_LOW_REG': {
      title: 'VEC_KEY_LOW_REG (000274)',
      desc: 'Вектор прерывания клавиатуры (код нижнего регистра).'
    },

    // 3. Системные ячейки памяти (enum SYSTEM из memory.h)
    'SYS_COLOR': {
      title: 'SYS_COLOR (040 / 0x20)',
      desc: 'Флаг цветного режима экрана (32 символа в строке) в ССД.'
    },
    'SYS_SCR_INVERSE': {
      title: 'SYS_SCR_INVERSE (041)',
      desc: 'Флаг инверсии экрана (фона) в ССД.'
    },
    'SYS_EXT_MEMORY': {
      title: 'SYS_EXT_MEMORY (042)',
      desc: 'Флаг режима расширенной памяти в ССД.'
    },
    'SYS_RUS': {
      title: 'SYS_RUS (043)',
      desc: 'Флаг регистра «РУС» клавиатуры в ССД.'
    },
    'SYS_UNDERLINE': {
      title: 'SYS_UNDERLINE (044)',
      desc: 'Флаг подчёркивания символов в ССД.'
    },
    'SYS_SYM_INVERSE': {
      title: 'SYS_SYM_INVERSE (045)',
      desc: 'Флаг инверсии отображения символов в ССД.'
    },
    'SYS_IND_SU': {
      title: 'SYS_IND_SU (046)',
      desc: 'Флаг индикации символов управления (ИНД СУ) в ССД.'
    },
    'SYS_BLOCK_RED': {
      title: 'SYS_BLOCK_RED (047)',
      desc: 'Флаг блокировки редактирования в ССД.'
    },
    'SYS_GRAPH': {
      title: 'SYS_GRAPH (050)',
      desc: 'Флаг режима текстовой графики «ГРАФ» в ССД.'
    },
    'SYS_ZAP': {
      title: 'SYS_ZAP (051)',
      desc: 'Флаг записи в режиме «ГРАФ» («ЗАП») в ССД.'
    },
    'SYS_STIR': {
      title: 'SYS_STIR (052)',
      desc: 'Флаг стирания в режиме «ГРАФ» («СТИР») в ССД.'
    },
    'SYS_S_LINE_32': {
      title: 'SYS_S_LINE_32 (053)',
      desc: 'Флаг «32 символа в служебной строке» в ССД.'
    },
    'SYS_S_LINE_UND': {
      title: 'SYS_S_LINE_UND (054)',
      desc: 'Флаг подчёркивания символов в служебной строке в ССД.'
    },
    'SYS_S_LINE_INV': {
      title: 'SYS_S_LINE_INV (055)',
      desc: 'Флаг инверсии символов в служебной строке в ССД.'
    },
    'SYS_CURSOR_OFF': {
      title: 'SYS_CURSOR_OFF (056)',
      desc: 'Флаг гашения курсора экрана в ССД.'
    },
    'SYS_LAST_KEY': {
      title: 'SYS_LAST_KEY (0104 / 0x44)',
      desc: 'Системная ячейка: код последнего введённого с клавиатуры символа.'
    },
    'SYS_LAST_KEY_FLAG': {
      title: 'SYS_LAST_KEY_FLAG (0105 / 0x45)',
      desc: 'Системная ячейка: признак записи кода последнего введённого символа.'
    },
    'SYS_KEY_REPEAT_RATE': {
      title: 'SYS_KEY_REPEAT_RATE (0106 / 0x46)',
      desc: 'Системная ячейка: количество повторов цикла SOB при автоповторе «ПОВТ».'
    },
    'SYS_PAR_INTERF_SHADOW': {
      title: 'SYS_PAR_INTERF_SHADOW (0256 / 0xAE)',
      desc: 'Теневая копия регистра параллельного интерфейса в ОЗУ.'
    },
    'SYS_EMT_36_PARAMS': {
      title: 'SYS_EMT_36_PARAMS (0320 / 0xD0)',
      desc: 'Стандартный адрес структуры параметров EMT 36 для работы с магнитофоном (struct EMT_36_PARAMS).'
    },

    // 4. Системные регистры (enum REGISTERS из memory.h)
    'REG_IRPS': {
      title: 'REG_IRPS (0176560 / 0xFAB0)',
      desc: 'Регистр последовательного интерфейса ИРПС (ТЛГ/UART).'
    },
    'REG_KEY_STATE': {
      title: 'REG_KEY_STATE (0177660 / 0xFFB0)',
      desc: 'Регистр состояния клавиатуры БК-0010.\n- Бит 7 (STATE): флаг наличия нажатой клавиши\n- Бит 6 (INT_MASK): маска прерывания (вектор 060)'
    },
    'REG_KEY_DATA': {
      title: 'REG_KEY_DATA (0177662 / 0xFFB2)',
      desc: 'Регистр данных клавиатуры БК (код нажатой клавиши в КОИ-7 / КОИ-8).'
    },
    'REG_V_SCROLL': {
      title: 'REG_V_SCROLL (0177664 / 0xFFB4)',
      desc: 'Регистр вертикального смещения (скроллинга) и адреса экранного ОЗУ БК.\n- Биты 0..7: адрес экранного ОЗУ (исходное 0330)\n- Бит 9: режим расширенной памяти'
    },
    'REG_TVE_LIMIT': {
      title: 'REG_TVE_LIMIT (0177706 / 0xFFC6)',
      desc: 'Регистр значения перезагрузки и предела встроенного таймера БК.'
    },
    'REG_TVE_COUNT': {
      title: 'REG_TVE_COUNT (0177710 / 0xFFC8)',
      desc: 'Регистр счётчика встроенного таймера БК (только чтение).'
    },
    'REG_TVE_CSR': {
      title: 'REG_TVE_CSR (0177712 / 0xFFCA)',
      desc: 'Регистр управления встроенным системным таймером БК.\n- Биты: RUN, OS, CAP, SP, D16, D4, MON, FL'
    },
    'REG_PAR_INTERF': {
      title: 'REG_PAR_INTERF (0177714 / 0xFFCC)',
      desc: 'Регистр параллельного интерфейса / игрового манипулятора (джойстика):\n- Бит 0: UP, Бит 1: RIGHT, Бит 2: DOWN, Бит 3: LEFT\n- Бит 4: кнопка A, Бит 5: LEFT BUTTON, Бит 6: RIGHT BUTTON, Бит 7: кнопка B'
    },
    'REG_EXT_DEV': {
      title: 'REG_EXT_DEV (0177716 / 0xFFCE)',
      desc: 'Регистр системных внешних устройств БК:\n- Бит 6: пьезодинамик / магнитофон\n- Бит 7: мотор магнитофона'
    },

    // 5. Биты регистров и таймера
    'KEY_STATE_INT_MASK': { title: 'KEY_STATE_INT_MASK (6)', desc: 'Бит маски аппаратного прерывания от клавиатуры (вектор 060).' },
    'KEY_STATE_STATE':    { title: 'KEY_STATE_STATE (7)', desc: 'Бит флага готовности кода нажатой клавиши в регистре 0177660.' },
    'V_SCROLL_EXT_MEMORY':{ title: 'V_SCROLL_EXT_MEMORY (9)', desc: 'Бит режима расширенной памяти в регистре скроллинга 0177664.' },
    'TVE_CSR_SP':         { title: 'TVE_CSR_SP (0)', desc: 'Выбор тактирования счетчика по спаду на входе nSP.' },
    'TVE_CSR_CAP':        { title: 'TVE_CSR_CAP (1)', desc: 'Режим захвата значения счетчика таймера.' },
    'TVE_CSR_MON':        { title: 'TVE_CSR_MON (2)', desc: 'Разрешить мониторинг события таймера.' },
    'TVE_CSR_OS':         { title: 'TVE_CSR_OS (3)', desc: 'Однократный режим счета таймера (one-shot).' },
    'TVE_CSR_RUN':        { title: 'TVE_CSR_RUN (4)', desc: 'Запуск счета таймера (1 = счет разрешен).' },
    'TVE_CSR_D16':        { title: 'TVE_CSR_D16 (5)', desc: 'Делитель частоты таймера на 16.' },
    'TVE_CSR_D4':         { title: 'TVE_CSR_D4 (6)', desc: 'Делитель частоты таймера на 4.' },
    'TVE_CSR_FL':         { title: 'TVE_CSR_FL (7)', desc: 'Флаг события (переполнения/останова) таймера.' },
    'TMR_FREQ':           { title: 'TMR_FREQ (23438)', desc: 'Базовая частота таймера БК (3 МГц / 128 = 23437.5 Гц).' },

    // 6. Биты манипулятора / джойстика (enum PAR_INTERF_BITS)
    'PAR_INTERF_UP':           { title: 'PAR_INTERF_UP (0)', desc: 'Бит направления «Вверх» игрового джойстика.' },
    'PAR_INTERF_RIGHT':        { title: 'PAR_INTERF_RIGHT (1)', desc: 'Бит направления «Вправо» игрового джойстика.' },
    'PAR_INTERF_DOWN':         { title: 'PAR_INTERF_DOWN (2)', desc: 'Бит направления «Вниз» игрового джойстика.' },
    'PAR_INTERF_LEFT':         { title: 'PAR_INTERF_LEFT (3)', desc: 'Бит направления «Влево» игрового джойстика.' },
    'PAR_INTERF_A':            { title: 'PAR_INTERF_A (4)', desc: 'Бит кнопки A игрового джойстика.' },
    'PAR_INTERF_LEFT_BUTTON':  { title: 'PAR_INTERF_LEFT_BUTTON (5)', desc: 'Бит левой кнопки игрового манипулятора.' },
    'PAR_INTERF_RIGHT_BUTTON': { title: 'PAR_INTERF_RIGHT_BUTTON (6)', desc: 'Бит правой кнопки игрового манипулятора.' },
    'PAR_INTERF_B':            { title: 'PAR_INTERF_B (7)', desc: 'Бит кнопки B игрового джойстика.' },

    // 7. Биты внешних устройств (enum EXT_DEV_BITS)
    'EXT_DEV_LINE':       { title: 'EXT_DEV_LINE (4)', desc: 'Передача/приём информации на/с линии ТЛГ.' },
    'EXT_DEV_LINE_RDY':   { title: 'EXT_DEV_LINE_RDY (5)', desc: 'Передача/приём сигнала готовности линии ТЛГ.' },
    'EXT_DEV_MAG_KEY':    { title: 'EXT_DEV_MAG_KEY (6)', desc: 'Запись на магнитофон и сигнал на пьезодинамик (звук).' },
    'EXT_DEV_MOTOR_RDY':  { title: 'EXT_DEV_MOTOR_RDY (7)', desc: 'Включение мотора магнитофона / чтение готовности линии.' },
    'EXT_DEV_RESET_VECT': { title: 'EXT_DEV_RESET_VECT (8)', desc: 'Адрес пуска процессора при включении питания.' },

    // 8. Константы экрана (enum SCREEN из memory.h)
    'SCREEN_WORD_WIDTH':      { title: 'SCREEN_WORD_WIDTH (32)', desc: 'Ширина экрана в 16-битных словах (32 слова в строке).' },
    'SCREEN_BYTE_WIDTH':      { title: 'SCREEN_BYTE_WIDTH (64)', desc: 'Ширина экрана в байтах (64 байта в строке растра).' },
    'SCREEN_PIX_HEIGHT':      { title: 'SCREEN_PIX_HEIGHT (256)', desc: 'Высота экрана в пикселях (256 растровых строк).' },
    'SCREEN_CLR_PX_PER_Byte': { title: 'SCREEN_CLR_PX_PER_Byte (4)', desc: 'Количество пикселей в байте в цветном 4-цветном режиме.' },
    'SCREEN_CLR_PX_PER_WORD': { title: 'SCREEN_CLR_PX_PER_WORD (8)', desc: 'Количество пикселей в слове в цветном режиме.' },
    'SCREEN_CLR_PIX_WIDTH':   { title: 'SCREEN_CLR_PIX_WIDTH (256)', desc: 'Ширина цветного экрана в пикселях (256×256).' },
    'SCREEN_BW_PX_PER_BYTE':  { title: 'SCREEN_BW_PX_PER_BYTE (8)', desc: 'Количество пикселей в байте в чёрно-белом режиме.' },
    'SCREEN_BW_PX_PER_WORD':  { title: 'SCREEN_BW_PX_PER_WORD (16)', desc: 'Количество пикселей в слове в чёрно-белом режиме.' },
    'SCREEN_BW_PIX_WIDTH':    { title: 'SCREEN_BW_PIX_WIDTH (512)', desc: 'Ширина чёрно-белого экрана в пикселях (512×256).' },

    // 9. Биты слова состояния процессора ССП (enum PSW_BITS из tools.h)
    'PSW_C':     { title: 'PSW_C (0)', desc: 'Флаг переноса C (Carry).' },
    'PSW_V':     { title: 'PSW_V (1)', desc: 'Флаг арифметического переполнения V (Overflow).' },
    'PSW_Z':     { title: 'PSW_Z (2)', desc: 'Флаг нулевого результата Z (Zero).' },
    'PSW_N':     { title: 'PSW_N (3)', desc: 'Флаг отрицательного результата N (Negative).' },
    'PSW_T':     { title: 'PSW_T (4)', desc: 'Флаг ловушки пошаговой отладки T (Trap).' },
    'PSW_I':     { title: 'PSW_I (7)', desc: 'Маска внешних прерываний IRQ.' },
    'PSW_PA0':   { title: 'PSW_PA0 (8)', desc: 'Младший бит номера процессора в системе.' },
    'PSW_PA1':   { title: 'PSW_PA1 (9)', desc: 'Старший бит номера процессора в системе.' },
    'PSW_PSW10': { title: 'PSW_PSW10 (10)', desc: 'Модификатор исключения зависания шины.' },
    'PSW_PSW11': { title: 'PSW_PSW11 (11)', desc: 'Модификатор исключения зависания шины.' },

    // 10. Магнитофон EMT 36 (enum EMT_36_command, EMT_36_response)
    'EMT_36_RECORDER_STOP':  { title: 'EMT_36_RECORDER_STOP (0)', desc: 'Команда магнитофона: Останов двигателя.' },
    'EMT_36_RECORDER_START': { title: 'EMT_36_RECORDER_START (1)', desc: 'Команда магнитофона: Пуск двигателя.' },
    'EMT_36_FILE_WRITE':     { title: 'EMT_36_FILE_WRITE (2)', desc: 'Команда магнитофона: Запись файла на ленту.' },
    'EMT_36_FILE_READ':      { title: 'EMT_36_FILE_READ (3)', desc: 'Команда магнитофона: Чтение файла с ленты.' },
    'EMT_36_FICT_READ':      { title: 'EMT_36_FICT_READ (4)', desc: 'Команда магнитофона: Фиктивное чтение массива.' },
    'EMT_36_OK':             { title: 'EMT_36_OK (0)', desc: 'Ответ магнитофона: Успешное завершение операции.' },
    'EMT_36_INCORRECT_NAME': { title: 'EMT_36_INCORRECT_NAME (1)', desc: 'Ответ магнитофона: Имя файла не совпадает.' },
    'EMT_36_CRC_ERROR':      { title: 'EMT_36_CRC_ERROR (2)', desc: 'Ответ магнитофона: Ошибка контрольной суммы CRC.' },
    'EMT_36_STOP':           { title: 'EMT_36_STOP (3)', desc: 'Ответ магнитофона: Останов по команде оператора.' },

    // 11. Скорости ИРПС/ТЛГ EMT 40 (enum EMT_40_speeds)
    'EMT_40_SPEED_9600': { title: 'EMT_40_SPEED_9600 (0)', desc: 'Скорость обмена 9600 бод (по умолчанию).' },
    'EMT_40_SPEED_4800': { title: 'EMT_40_SPEED_4800 (1)', desc: 'Скорость обмена 4800 бод.' },
    'EMT_40_SPEED_2400': { title: 'EMT_40_SPEED_2400 (2)', desc: 'Скорость обмена 2400 бод.' },
    'EMT_40_SPEED_1200': { title: 'EMT_40_SPEED_1200 (3)', desc: 'Скорость обмена 1200 бод.' },
    'EMT_40_SPEED_600':  { title: 'EMT_40_SPEED_600 (4)', desc: 'Скорость обмена 600 бод.' },
    'EMT_40_SPEED_300':  { title: 'EMT_40_SPEED_300 (5)', desc: 'Скорость обмена 300 бод.' },
    'EMT_40_SPEED_150':  { title: 'EMT_40_SPEED_150 (6)', desc: 'Скорость обмена 150 бод.' },
    'EMT_40_SPEED_75':   { title: 'EMT_40_SPEED_75 (7)', desc: 'Скорость обмена 75 бод.' },
    'EMT_40_SPEED_50':   { title: 'EMT_40_SPEED_50 (8)', desc: 'Скорость обмена 50 бод.' },

    // 12. Целочисленные пределы stdint.h
    'INT8_MIN':   { title: 'INT8_MIN (-128)', desc: 'Минимальное значение для int8_t.' },
    'INT8_MAX':   { title: 'INT8_MAX (127)', desc: 'Максимальное значение для int8_t.' },
    'UINT8_MAX':  { title: 'UINT8_MAX (255)', desc: 'Максимальное значение для uint8_t.' },
    'INT16_MIN':  { title: 'INT16_MIN (-32768)', desc: 'Минимальное значение для int16_t.' },
    'INT16_MAX':  { title: 'INT16_MAX (32767)', desc: 'Максимальное значение для int16_t.' },
    'UINT16_MAX': { title: 'UINT16_MAX (65535)', desc: 'Максимальное значение для uint16_t.' },
    'INT32_MIN':  { title: 'INT32_MIN (-2147483648)', desc: 'Минимальное значение для int32_t.' },
    'INT32_MAX':  { title: 'INT32_MAX (2147483647)', desc: 'Максимальное значение для int32_t.' },
    'UINT32_MAX': { title: 'UINT32_MAX (4294967295U)', desc: 'Максимальное значение для uint32_t.' }
  };

  const BK_RUNTIME_FUNCTIONS = {
    'delay_ms': {
      sig: 'void delay_ms(uint16_t time)',
      desc: 'Приостанавливает выполнение программы на заданное время в миллисекундах (`tools.h` / `tools.c`).',
      params: ['time - время паузы в миллисекундах']
    },
    'rand': {
      sig: 'uint16_t rand(void)',
      desc: 'Быстрый 16-битный генератор псевдослучайных чисел Xorshift LFSR с максимальным периодом (`tools.h` / `tools.c`).',
      params: []
    },
    'clr_words': {
      sig: 'void clr_words(void *ptr, uint16_t words)',
      desc: 'Высокоскоростная очистка блока памяти из N 16-битных слов нулями через инструкцию `clr (ptr)+` / `sob` (`tools.h`).',
      params: ['ptr - указатель на начало блока', 'words - число 16-битных слов']
    },
    'abs16': {
      sig: 'uint16_t abs16(const int16_t x)',
      desc: 'Возвращает модуль (абсолютное значение) 16-битного знакового целого (`tools.h`).',
      params: ['x - 16-битное число']
    },
    'SWAB': {
      sig: 'uint16_t SWAB(uint16_t word)',
      desc: 'Аппаратный обмен младшего и старшего байтов в слове (инструкция PDP-11 `swab`) (`tools.h`).',
      params: ['word - 16-битное слово']
    },
    'HALT': {
      sig: 'void HALT(void)',
      desc: 'Останов программы и переход в пультовой режим/Монитор (инструкция PDP-11 `halt`) (`tools.h`).',
      params: []
    },
    'TRAP': {
      sig: 'void TRAP(const uint8_t trap_no)',
      desc: 'Вызов аппаратного исключения TRAP с заданным номером (инструкция PDP-11 `trap`) (`tools.h`).',
      params: ['trap_no - номер ловушки TRAP']
    },
    'get_PSW': {
      sig: 'uint16_t get_PSW(void)',
      desc: 'Чтение слова состояния процессора (ССП) инструкцией `mfps` (`tools.h`).',
      params: []
    },
    'set_PSW': {
      sig: 'void set_PSW(uint16_t psw)',
      desc: 'Установка слова состояния процессора (ССП) инструкцией `mtps` (`tools.h`).',
      params: ['psw - новое значение регистра ССП']
    },
    'zx0_decompress': {
      sig: 'void zx0_decompress(const uint8_t *src, uint8_t *dst)',
      desc: 'Быстрая распаковка сжатого потока данных алгоритма ZX0 v2.2 в память (`dzx0.s` / C ABI).',
      params: ['src - указатель на сжатые данные ZX0', 'dst - буфер распаковки / окно истории']
    },
    'memset': {
      sig: 'void *memset(void *dst, int val, size_t count)',
      desc: 'Стандартное быстрое заполнение блока памяти байтом (`memory.h` / `memory.s`).',
      params: ['dst - целевой указатель', 'val - значение байта', 'count - длина в байтах']
    },
    'paint_brick': {
      sig: 'void paint_brick(uint16_t x_graph, uint16_t y_graph, uint16_t x_width, uint16_t y_width, uint8_t color)',
      desc: 'Быстрое рисование прямоугольника цветным байтовым шаблоном в экранное ОЗУ (`main.c`).',
      params: ['x_graph - позиция X в байтах (0..63)', 'y_graph - строка Y (0..255)', 'x_width - ширина в байтах', 'y_width - высота в строках', 'color - цвет в виде байта 4 пикселей']
    },
    'print_str': {
      sig: 'void print_str(const char *str)',
      desc: 'Последовательный вывод нуль-терминированной строки на экран через EMT 16 (`main.c`).',
      params: ['str - указатель на строку символов']
    },
    'any_key_or_button_pressed': {
      sig: 'bool any_key_or_button_pressed(void)',
      desc: 'Неблокирующая проверка нажатия любой клавиши клавиатуры или кнопки манипулятора (`main.c`).',
      params: []
    },
    'init_display': {
      sig: 'void init_display(void)',
      desc: 'Инициализация дисплея БК: цветной режим (32 символа в строке), зелёный текст, погашенный курсор (`main.c`).',
      params: []
    }
  };

  const EMT_SYSTEM_CALLS = {
    'EMT_4': { sig: 'void EMT_4(void)', desc: 'Инициализация драйвера клавиатуры БК (сброс флагов, режим ввода кодов).' },
    'EMT_6': { sig: 'char EMT_6(void)', desc: 'Чтение кода символа с клавиатуры БК с ожиданием.' },
    'EMT_10': { sig: 'void EMT_10(char *ptr, uint16_t len_delim)', desc: 'Ввод строки символов с клавиатуры в буфер.' },
    'EMT_12': { sig: 'void EMT_12(uint8_t key_num, char *ptr)', desc: 'Программирование функциональных клавиш АР2 строкой ptr (или сброс при NULL).' },
    'EMT_14': { sig: 'void EMT_14(void)', desc: 'Инициализация системных драйверов Монитора БК, сброс портов и очистка экрана.' },
    'EMT_16': { sig: 'void EMT_16(char c)', desc: 'Вывод символа или управляющего кода на дисплей (0233: цвет 32 симв, 0232: курсор, 007: сигнал BELL).' },
    'EMT_20': { sig: 'void EMT_20(const char *ptr)', desc: 'Вывод нуль-терминированной строки символов на экран БК.' },
    'EMT_20_l': { sig: 'void EMT_20_l(const char *ptr, uint16_t len_delim)', desc: 'Вывод строки символов до заданной длины или символа-ограничителя.' },
    'EMT_22': { sig: 'void EMT_22(char c, uint8_t pos)', desc: 'Запись символа в указанную позицию служебной строки дисплея.' },
    'EMT_24': { sig: 'void EMT_24(uint8_t x, uint8_t y)', desc: 'Установка символьного/графического курсора в координаты (X, Y).' },
    'EMT_26': { sig: 'void EMT_26(uint8_t *x, uint8_t *y)', desc: 'Съём (получение) текущих координат курсора экрана.' },
    'EMT_30': { sig: 'void EMT_30(uint8_t w_e, uint8_t x, uint8_t y)', desc: 'Формирование/стирание графической точки (пикселя) через Монитор БК.' },
    'EMT_32': { sig: 'void EMT_32(uint8_t w_e, uint8_t x, uint8_t y)', desc: 'Рисование/стирание графического вектора (линии) в координаты (X, Y).' },
    'EMT_34': { sig: 'union SSD EMT_34(void)', desc: 'Чтение слова состояния дисплея (ССД) БК.' },
    'EMT_36': { sig: 'void EMT_36(const char *ptr)', desc: 'Передача управления драйверу магнитофона (чтение/запись файлов).' },
    'EMT_40': { sig: 'void EMT_40(enum EMT_40_speeds speed)', desc: 'Установка скорости обмена по каналу ТЛГ/ИРПС (9600..50 бод).' },
    'EMT_42': { sig: 'void EMT_42(uint8_t byte)', desc: 'Передача одного байта в последовательную линию ТЛГ.' },
    'EMT_44': { sig: 'uint8_t EMT_44(void)', desc: 'Приём одного байта из последовательной линии ТЛГ.' },
    'EMT_46': { sig: 'void EMT_46(const uint8_t *ptr, uint16_t len)', desc: 'Передача массива байт заданной длины по линии ТЛГ.' },
    'EMT_50': { sig: 'void EMT_50(uint8_t *ptr, uint16_t len)', desc: 'Приём массива байт заданной длины из линии ТЛГ.' }
  };

  // =========================================================================
  // 2. C PARSER & SYMBOL EXTRACTOR (ЧИСТЫЙ РЕГУЛЯРНЫЙ / СИНТАКСИЧЕСКИЙ АНАЛИЗАТОР)
  // =========================================================================

  /**
   * Извлекает из исходного текста C-файла структуру символов:
   * функции, переменные, структуры, объединения, перечисления, макросы, include-директивы.
   */
  function parseCSymbols(content, filename = 'active.c') {
    const result = {
      filename: filename,
      functions: [],
      structures: [],
      enums: [],
      typedefs: [],
      macros: [],
      variables: [],
      includes: [],
      allSymbolsMap: new Map()
    };

    if (!content || typeof content !== 'string') return result;

    const lines = content.split(/\r?\n/);

    // 1. Поиск #include директив
    const incRegex = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm;
    let mInc;
    while ((mInc = incRegex.exec(content)) !== null) {
      result.includes.push({
        full: mInc[0],
        quote: mInc[1],
        path: mInc[2],
        isSystem: mInc[1] === '<'
      });
    }

    // 2. Поиск #define макросов
    const defRegex = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?\s*(.*)$/;
    lines.forEach((line, idx) => {
      const mDef = line.match(defRegex);
      if (mDef) {
        const name = mDef[1];
        const params = mDef[2] ? mDef[2].split(',').map(s => s.trim()) : null;
        const val = mDef[3] ? mDef[3].trim() : '';
        const item = {
          name: name,
          kind: 'macro',
          params: params,
          value: val,
          line: idx + 1,
          filename: filename,
          detail: params ? `#define ${name}(${params.join(', ')})` : `#define ${name} ${val}`
        };
        result.macros.push(item);
        result.allSymbolsMap.set(name, item);
      }
    });

    // 3. Поиск enum и их констант
    const enumBlockRegex = /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Za-z0-9_]+))?\s*\{([^}]*)\}/gs;
    let mEnum;
    while ((mEnum = enumBlockRegex.exec(content)) !== null) {
      const enumName = mEnum[1];
      const baseType = mEnum[2] || 'int';
      const body = mEnum[3];
      const startIdx = mEnum.index;
      const lineNo = content.substring(0, startIdx).split(/\r?\n/).length;

      const enumItem = {
        name: enumName,
        kind: 'enum',
        baseType: baseType,
        line: lineNo,
        filename: filename,
        constants: [],
        detail: `enum ${enumName}`
      };

      // Парсим константы внутри enum
      const constLines = body.split(',');
      constLines.forEach(cStr => {
        const clean = cStr.replace(/\/\*.*?\*\//gs, '').replace(/\/\/.*$/gm, '').trim();
        const mConst = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/);
        if (mConst) {
          const cName = mConst[1];
          const cVal = mConst[2] ? mConst[2].trim() : null;
          const cItem = {
            name: cName,
            kind: 'enum_member',
            parentEnum: enumName,
            value: cVal,
            line: lineNo,
            filename: filename,
            detail: cVal ? `${cName} = ${cVal}` : cName
          };
          enumItem.constants.push(cItem);
          result.allSymbolsMap.set(cName, cItem);
        }
      });

      result.enums.push(enumItem);
      result.allSymbolsMap.set(enumName, enumItem);
    }

    // 4. Поиск struct и union с полями
    const structBlockRegex = /\b(struct|union)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/gs;
    let mStruct;
    while ((mStruct = structBlockRegex.exec(content)) !== null) {
      const kind = mStruct[1]; // struct или union
      const structName = mStruct[2];
      const body = mStruct[3];
      const startIdx = mStruct.index;
      const lineNo = content.substring(0, startIdx).split(/\r?\n/).length;

      const structItem = {
        name: structName,
        kind: kind,
        line: lineNo,
        filename: filename,
        fields: [],
        detail: `${kind} ${structName}`
      };

      // Парсим поля структуры
      const fieldLines = body.split(';');
      fieldLines.forEach(fStr => {
        const clean = fStr.replace(/\/\*.*?\*\//gs, '').replace(/\/\/.*$/gm, '').trim();
        if (!clean) return;
        const mField = clean.match(/^(?:volatile\s+)?([A-Za-z0-9_*\s]+?)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\[.*?\])?(?:\s*:\s*\d+)?$/);
        if (mField) {
          const fType = mField[1].trim();
          const fName = mField[2].trim();
          structItem.fields.push({
            name: fName,
            type: fType,
            parent: structName
          });
        }
      });

      result.structures.push(structItem);
      result.allSymbolsMap.set(structName, structItem);
    }

    // 5. Поиск функций (объявления и реализации)
    // Шаблон ловит сигнатуры вида: static inline void my_func(int a, char *b) {
    const funcRegex = /^[ \t]*(?:(static|inline|extern|volatile)\s+)*([A-Za-z_][A-Za-z0-9_*\s]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:\{|;)/gm;
    let mFunc;
    while ((mFunc = funcRegex.exec(content)) !== null) {
      const fullMatch = mFunc[0];
      const returnType = (mFunc[2] || '').trim();
      const funcName = mFunc[3];
      const rawParams = mFunc[4];
      const isDefinition = fullMatch.endsWith('{');
      const startIdx = mFunc.index;
      const lineNo = content.substring(0, startIdx).split(/\r?\n/).length;

      // Исключаем ключевые слова языка C, которые могут случайно совпасть с синтаксисом вызова
      if (['if', 'while', 'for', 'switch', 'return', 'sizeof', 'typeof'].includes(funcName)) {
        continue;
      }

      // Парсим параметры функции
      const params = [];
      if (rawParams && rawParams.trim() !== 'void' && rawParams.trim() !== '') {
        const pTokens = rawParams.split(',');
        pTokens.forEach(p => {
          const pClean = p.replace(/\/\*.*?\*\//gs, '').trim();
          if (pClean) {
            const pMatch = pClean.match(/(?:const\s+)?([A-Za-z0-9_*\s]+?)\s*([A-Za-z_][A-Za-z0-9_]*)?$/);
            if (pMatch) {
              params.push({
                type: (pMatch[1] || '').trim(),
                name: (pMatch[2] || '').trim(),
                raw: pClean
              });
            } else {
              params.push({ raw: pClean, name: pClean, type: '' });
            }
          }
        });
      }

      // Извлекаем Doxygen-комментарий непосредственно перед функцией
      let docComment = '';
      const beforeContent = content.substring(0, startIdx);
      const linesBefore = beforeContent.split(/\r?\n/);
      let checkLineIdx = linesBefore.length - 2;
      const commentAccum = [];
      while (checkLineIdx >= 0) {
        const l = linesBefore[checkLineIdx].trim();
        if (l.endsWith('*/') || l.startsWith('*') || l.startsWith('/**') || l.startsWith('//')) {
          commentAccum.unshift(l);
          if (l.startsWith('/**') || l.startsWith('/*')) break;
          checkLineIdx--;
        } else if (l === '') {
          checkLineIdx--;
        } else {
          break;
        }
      }
      if (commentAccum.length > 0) {
        docComment = commentAccum.join('\n');
      }

      const funcItem = {
        name: funcName,
        kind: 'function',
        returnType: returnType,
        params: params,
        rawParams: rawParams ? rawParams.replace(/\s+/g, ' ').trim() : '',
        isDefinition: isDefinition,
        line: lineNo,
        filename: filename,
        doc: docComment,
        signature: `${returnType} ${funcName}(${rawParams ? rawParams.replace(/\s+/g, ' ').trim() : 'void'})`
      };

      result.functions.push(funcItem);
      // Если функция уже была объявлена прототипом, заменяем её реализацией
      if (!result.allSymbolsMap.has(funcName) || isDefinition) {
        result.allSymbolsMap.set(funcName, funcItem);
      }
    }

    return result;
  }

  // =========================================================================
  // 3. МЕЖФАЙЛОВЫЙ ИНДЕКСАТОР ПРОЕКТА BKSTUDIO (CROSS-FILE INDEXER)
  // =========================================================================

  /**
   * Сканирует все открытые и встроенные файлы проекта и строит глобальный индекс символов
   */
  function buildProjectIndex() {
    const projectIndex = {
      files: new Map(),
      allSymbols: new Map()
    };

    // 1. Добавляем встроенные библиотеки и рантайм БК
    Object.keys(BK_RUNTIME_FUNCTIONS).forEach(k => {
      projectIndex.allSymbols.set(k, {
        name: k,
        kind: 'builtin_function',
        info: BK_RUNTIME_FUNCTIONS[k],
        filename: '<bk/runtime.h>'
      });
    });

    Object.keys(EMT_SYSTEM_CALLS).forEach(k => {
      projectIndex.allSymbols.set(k, {
        name: k,
        kind: 'builtin_emt',
        info: EMT_SYSTEM_CALLS[k],
        filename: '<emt.h>'
      });
    });

    Object.keys(BK_HARDWARE_INFO).forEach(k => {
      projectIndex.allSymbols.set(k, {
        name: k,
        kind: 'builtin_hardware',
        info: BK_HARDWARE_INFO[k],
        filename: '<bk_mmap.h>'
      });
    });

    Object.keys(C_TYPES_INFO).forEach(k => {
      projectIndex.allSymbols.set(k, {
        name: k,
        kind: 'builtin_type',
        info: C_TYPES_INFO[k],
        filename: '<stdint.h>'
      });
    });

    // 2. Сканируем файлы из текущего активного проекта bkProject
    if (global.bkProject && typeof global.bkProject.getAllFiles === 'function') {
      const files = global.bkProject.getAllFiles();
      Object.keys(files).forEach(fname => {
        const ext = fname.slice(fname.lastIndexOf('.')).toLowerCase();
        if (ext === '.c' || ext === '.h') {
          const parsed = parseCSymbols(files[fname], fname);
          projectIndex.files.set(fname, parsed);
          parsed.allSymbolsMap.forEach((val, symName) => {
            projectIndex.allSymbols.set(symName, val);
          });
        }
      });
    }

    return projectIndex;
  }

  /**
   * Маскирует однострочные/многострочные комментарии и строковые литералы пробелами,
   * сохраняя при этом в точности длину строки, переносы и номера колонок для маркеров.
   */
  function maskCommentsAndStrings(sourceText) {
    if (!sourceText || typeof sourceText !== 'string') return '';
    let result = '';
    let inBlockComment = false;
    let inLineComment = false;
    let inString = false;
    let inChar = false;
    let escape = false;

    for (let i = 0; i < sourceText.length; i++) {
      const ch = sourceText[i];
      const nextCh = i + 1 < sourceText.length ? sourceText[i + 1] : '';

      if (ch === '\n') {
        inLineComment = false;
        inString = false;
        inChar = false;
        escape = false;
        result += '\n';
        continue;
      }
      if (ch === '\r') {
        result += '\r';
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && nextCh === '/') {
          inBlockComment = false;
          result += '  ';
          i++;
        } else {
          result += ' ';
        }
        continue;
      }

      if (inLineComment) {
        result += ' ';
        continue;
      }

      if (inString) {
        if (!escape && ch === '"') {
          inString = false;
          result += ' ';
        } else {
          escape = (ch === '\\' && !escape);
          result += ' ';
        }
        continue;
      }

      if (inChar) {
        if (!escape && ch === "'") {
          inChar = false;
          result += ' ';
        } else {
          escape = (ch === '\\' && !escape);
          result += ' ';
        }
        continue;
      }

      // Начало однострочного комментария //
      if (ch === '/' && nextCh === '/') {
        inLineComment = true;
        result += '  ';
        i++;
        continue;
      }

      // Начало блочного комментария /*
      if (ch === '/' && nextCh === '*') {
        inBlockComment = true;
        result += '  ';
        i++;
        continue;
      }

      // Начало строкового литерала "..."
      if (ch === '"') {
        inString = true;
        escape = false;
        result += ' ';
        continue;
      }

      // Начало символьного литерала '...'
      if (ch === "'") {
        inChar = true;
        escape = false;
        result += ' ';
        continue;
      }

      result += ch;
    }

    return result;
  }

  // =========================================================================
  // 4. ДИАГНОСТИКА СИНТАКСИСА И СТАТИЧЕСКИЙ АНАЛИЗ (C-LSP DIAGNOSTICS)
  // =========================================================================

  /**
   * Выполняет мгновенный анализ синтаксиса и выдает маркеры ошибок для Monaco
   */
  function analyzeCSyntax(model) {
    if (!model) return [];
    const text = model.getValue();
    const lines = text.split(/\r?\n/);
    const markers = [];
    const index = buildProjectIndex();

    // 1. Проверка парности скобок: {}, (), []
    const bracketStack = [];
    let inBlockComment = false;

    lines.forEach((line, lineIdx) => {
      let inString = false;
      let inChar = false;
      let escape = false;

      for (let colIdx = 0; colIdx < line.length; colIdx++) {
        const ch = line[colIdx];
        const nextCh = colIdx + 1 < line.length ? line[colIdx + 1] : '';

        // Пропуск блочных комментариев /* ... */
        if (inBlockComment) {
          if (ch === '*' && nextCh === '/') {
            inBlockComment = false;
            colIdx++;
          }
          continue;
        }

        // Пропуск однострочных комментариев //
        if (!inString && !inChar && ch === '/' && nextCh === '/') {
          break; // остаток строки - комментарий
        }

        // Начало блочного комментария
        if (!inString && !inChar && ch === '/' && nextCh === '*') {
          inBlockComment = true;
          colIdx++;
          continue;
        }

        // Строковые литералы "..."
        if (!inChar && ch === '"' && !escape) {
          inString = !inString;
          continue;
        }

        // Символьные литералы '...'
        if (!inString && ch === "'" && !escape) {
          inChar = !inChar;
          continue;
        }

        if (inString || inChar) {
          escape = (ch === '\\' && !escape);
          continue;
        }

        // Отслеживание скобок
        if (ch === '{' || ch === '(' || ch === '[') {
          bracketStack.push({ ch, line: lineIdx + 1, col: colIdx + 1 });
        } else if (ch === '}' || ch === ')' || ch === ']') {
          if (bracketStack.length === 0) {
            markers.push({
              severity: 8, // monaco.MarkerSeverity.Error
              message: `Непарная закрывающая скобка '${ch}'`,
              startLineNumber: lineIdx + 1,
              startColumn: colIdx + 1,
              endLineNumber: lineIdx + 1,
              endColumn: colIdx + 2
            });
          } else {
            const top = bracketStack.pop();
            const pairMatch = (top.ch === '{' && ch === '}') ||
                              (top.ch === '(' && ch === ')') ||
                              (top.ch === '[' && ch === ']');
            if (!pairMatch) {
              markers.push({
                severity: 8, // Error
                message: `Несоответствие скобок: открыта '${top.ch}' (строка ${top.line}), но встречена '${ch}'`,
                startLineNumber: lineIdx + 1,
                startColumn: colIdx + 1,
                endLineNumber: lineIdx + 1,
                endColumn: colIdx + 2
              });
            }
          }
        }
      }

      // Незакрытая строка в пределах одной строки
      if (inString && !line.endsWith('\\')) {
        markers.push({
          severity: 8,
          message: 'Незакрытый строковый литерал (пропущена закрывающая кавычка ")',
          startLineNumber: lineIdx + 1,
          startColumn: 1,
          endLineNumber: lineIdx + 1,
          endColumn: line.length + 1
        });
      }
    });

    // Оставшиеся незакрытые скобки в стеке
    bracketStack.forEach(b => {
      markers.push({
        severity: 8,
        message: `Незакрытая скобка '${b.ch}'`,
        startLineNumber: b.line,
        startColumn: b.col,
        endLineNumber: b.line,
        endColumn: b.col + 1
      });
    });

    // 2. Семантическая проверка вызовов функций (вызов неопределенных функций)
    const activeFileName = (global.bkProject && global.bkProject.activeFileName) || 'main.c';
    const parsedActive = parseCSymbols(text, activeFileName);

    // Собираем множество всех известных функций, макросов, констант и типов
    const knownFunctions = new Set();
    Object.keys(BK_RUNTIME_FUNCTIONS).forEach(f => knownFunctions.add(f));
    Object.keys(EMT_SYSTEM_CALLS).forEach(f => knownFunctions.add(f));
    Object.keys(BK_HARDWARE_INFO).forEach(h => knownFunctions.add(h));
    parsedActive.functions.forEach(f => knownFunctions.add(f.name));
    parsedActive.macros.forEach(m => knownFunctions.add(m.name));
    parsedActive.enums.forEach(e => {
      knownFunctions.add(e.name);
      e.constants.forEach(c => knownFunctions.add(c.name));
    });
    parsedActive.structures.forEach(s => knownFunctions.add(s.name));
    parsedActive.variables.forEach(v => knownFunctions.add(v.name));

    index.allSymbols.forEach((item, name) => {
      knownFunctions.add(name);
    });

    // Известные функции стандартной библиотеки GCC
    ['printf', 'sprintf', 'snprintf', 'puts', 'putchar', 'getchar', 'malloc', 'free', 'exit', 'abort', '__builtin_memset', '__builtin_memcpy'].forEach(f => knownFunctions.add(f));

    // Ключевые слова, типы C23 и конструкции языка, которые не являются функциями
    const C_KEYWORDS_AND_TYPES = new Set([
      'if', 'while', 'for', 'switch', 'return', 'sizeof', 'typeof', 'alignas', 'alignof',
      'static_assert', '_Static_assert', '_Generic', 'case', 'default', 'goto', 'break', 'continue',
      'do', 'asm', '__asm__', '__attribute__', '__typeof__', '__typeof', 'volatile', 'const',
      'constexpr', 'inline', 'restrict', 'auto', 'register', 'static', 'extern', 'typedef',
      'struct', 'union', 'enum',
      'int', 'char', 'short', 'long', 'float', 'double', 'void', 'unsigned', 'signed', 'bool',
      '_Bool', '_Complex', '_Atomic',
      'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t',
      'size_t', 'ssize_t', 'intptr_t', 'uintptr_t', 'ptrdiff_t', 'nullptr_t'
    ]);

    // Маскируем комментарии и строки пробелами, чтобы текст комментариев (например // ... X (в байтах))
    // никогда не принимался за вызов функции, при этом номера строк и колонок сохраняются строго 1-в-1.
    const maskedText = maskCommentsAndStrings(text);
    const maskedLines = maskedText.split(/\r?\n/);

    // Сканируем вызовы функций в очищенном коде вида: foo(...)
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    maskedLines.forEach((mLine, lineIdx) => {
      // Игнорируем препроцессор (#...)
      const trimmed = mLine.trim();
      if (trimmed.startsWith('#')) return;

      let m;
      while ((m = callRegex.exec(mLine)) !== null) {
        const calledName = m[1];
        const colStart = m.index + 1;
        const colEnd = colStart + calledName.length;

        // Исключаем ключевые слова и типы C
        if (C_KEYWORDS_AND_TYPES.has(calledName)) {
          continue;
        }

        // Проверяем контекст перед именем:
        // Если перед именем стоит доступ к члену (например . или ->), пропускаем
        const prefix = mLine.substring(0, m.index).trim();
        if (/[.\->]\s*$/.test(prefix)) {
          continue;
        }

        // Если перед именем стоит спецификатор объявления типа (например void, int, static inline),
        // это заголовок объявления или определения функции, а не вызов
        if (/\b(void|int|char|short|long|float|double|bool|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|ssize_t|auto|inline|static|extern)\s*[*&]?\s*$/.test(prefix)) {
          continue;
        }

        // Если функция не найдена ни в проекте, ни в заголовках, ни в рантайме БК
        if (!knownFunctions.has(calledName)) {
          markers.push({
            severity: 4, // monaco.MarkerSeverity.Warning
            message: `Неявное объявление или неизвестная функция: '${calledName}' (отсутствует заголовочный файл или прототип)`,
            startLineNumber: lineIdx + 1,
            startColumn: colStart,
            endLineNumber: lineIdx + 1,
            endColumn: colEnd
          });
        }
      }
    });

    return markers;
  }

  // =========================================================================
  // 5. РЕГИСТРАЦИЯ ПРОВАЙДЕРОВ MONACO EDITOR ДЛЯ ЯЗЫКА 'C'
  // =========================================================================

  /**
   * Главная функция инициализации поддержки языка C в Monaco Editor
   */
  function registerCLanguage(monaco) {
    if (!monaco) return;

    const langId = 'c';

    // 1. Конфигурация языка: комментарии, автозакрытие скобок, отступы
    monaco.languages.setLanguageConfiguration(langId, {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ],
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g
    });

    // 2. Первоклассная Monarch подсветка C23 & GNU C с поддержкой БК-специфики
    monaco.languages.setMonarchTokensProvider(langId, {
      defaultToken: '',
      tokenPostfix: '.c',

      keywords: [
        'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
        'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
        'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
        'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
        'unsigned', 'void', 'volatile', 'while',
        // C23 ключевые слова
        'constexpr', 'nullptr', 'bool', 'true', 'false', 'typeof', 'typeof_unqual',
        'alignas', 'alignof', 'static_assert', 'thread_local',
        // Расширения GNU C
        '__asm__', '__volatile__', 'asm', '__attribute__', '__typeof__'
      ],

      types: [
        'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t',
        'int64_t', 'uint64_t', 'size_t', 'ssize_t', 'intptr_t', 'uintptr_t',
        'ptrdiff_t', 'nullptr_t'
      ],

      bkConstants: [
        'MEM_SYSTEM', 'MEM_STACK', 'MEM_USER', 'MEM_VIDEO', 'MEM_EXTMEM',
        'MEM_ROM_MON', 'MEM_ROM_1', 'MEM_ROM_2', 'MEM_ROM_3', 'MEM_REGS', 'MEM_END',
        'VEC_STOP', 'VEC_RES_CPU_INSTR', 'VEC_T_BIT', 'VEC_IOT', 'VEC_POWER_FAIL',
        'VEC_EMT', 'VEC_TRAP', 'VEC_KEYBOARD', 'VEC_IRQ2', 'VEC_KEY_LOW_REG',
        'SYS_COLOR', 'SYS_SCR_INVERSE', 'SYS_EXT_MEMORY', 'SYS_RUS', 'SYS_UNDERLINE',
        'SYS_SYM_INVERSE', 'SYS_IND_SU', 'SYS_BLOCK_RED', 'SYS_GRAPH', 'SYS_ZAP',
        'SYS_STIR', 'SYS_S_LINE_32', 'SYS_S_LINE_UND', 'SYS_S_LINE_INV', 'SYS_CURSOR_OFF',
        'SYS_LAST_KEY', 'SYS_LAST_KEY_FLAG', 'SYS_KEY_REPEAT_RATE', 'SYS_PAR_INTERF_SHADOW', 'SYS_EMT_36_PARAMS',
        'REG_IRPS', 'REG_KEY_STATE', 'REG_KEY_DATA', 'REG_V_SCROLL',
        'REG_TVE_LIMIT', 'REG_TVE_COUNT', 'REG_TVE_CSR', 'REG_PAR_INTERF', 'REG_EXT_DEV',
        'KEY_STATE_INT_MASK', 'KEY_STATE_STATE', 'V_SCROLL_EXT_MEMORY',
        'TVE_CSR_SP', 'TVE_CSR_CAP', 'TVE_CSR_MON', 'TVE_CSR_OS', 'TVE_CSR_RUN', 'TVE_CSR_D16', 'TVE_CSR_D4', 'TVE_CSR_FL', 'TMR_FREQ',
        'PAR_INTERF_UP', 'PAR_INTERF_RIGHT', 'PAR_INTERF_DOWN', 'PAR_INTERF_LEFT',
        'PAR_INTERF_A', 'PAR_INTERF_LEFT_BUTTON', 'PAR_INTERF_RIGHT_BUTTON', 'PAR_INTERF_B',
        'EXT_DEV_LINE', 'EXT_DEV_LINE_RDY', 'EXT_DEV_MAG_KEY', 'EXT_DEV_MOTOR_RDY', 'EXT_DEV_RESET_VECT',
        'SCREEN_WORD_WIDTH', 'SCREEN_BYTE_WIDTH', 'SCREEN_PIX_HEIGHT',
        'SCREEN_CLR_PX_PER_Byte', 'SCREEN_CLR_PX_PER_WORD', 'SCREEN_CLR_PIX_WIDTH',
        'SCREEN_BW_PX_PER_BYTE', 'SCREEN_BW_PX_PER_WORD', 'SCREEN_BW_PIX_WIDTH',
        'PSW_C', 'PSW_V', 'PSW_Z', 'PSW_N', 'PSW_T', 'PSW_I', 'PSW_PA0', 'PSW_PA1', 'PSW_PSW10', 'PSW_PSW11',
        'EMT_36_RECORDER_STOP', 'EMT_36_RECORDER_START', 'EMT_36_FILE_WRITE', 'EMT_36_FILE_READ', 'EMT_36_FICT_READ',
        'EMT_36_OK', 'EMT_36_INCORRECT_NAME', 'EMT_36_CRC_ERROR', 'EMT_36_STOP',
        'EMT_40_SPEED_9600', 'EMT_40_SPEED_4800', 'EMT_40_SPEED_2400', 'EMT_40_SPEED_1200', 'EMT_40_SPEED_600', 'EMT_40_SPEED_300', 'EMT_40_SPEED_150', 'EMT_40_SPEED_75', 'EMT_40_SPEED_50',
        'INT8_MIN', 'INT8_MAX', 'UINT8_MAX', 'INT16_MIN', 'INT16_MAX', 'UINT16_MAX', 'INT32_MIN', 'INT32_MAX', 'UINT32_MAX'
      ],

      tokenizer: {
        root: [
          // Препроцессор
          [/^\s*#\s*[a-zA-Z_]\w*/, 'keyword.directive'],

          // Комментарии
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],

          // Строки и символы
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],

          // Шестнадцатеричные, двоичные и восьмеричные числа
          [/0[xX][0-9a-fA-F]+\b/, 'number.hex'],
          [/0[bB][01]+\b/, 'number.binary'],
          [/0[0-7]+\b/, 'number.octal'],
          [/\d+\.?\d*([eE][\-+]?\d+)?/, 'number'],

          // Идентификаторы и сопоставление с ключевыми словами
          [/[a-zA-Z_]\w*/, {
            cases: {
              '@keywords': 'keyword',
              '@types': 'type',
              '@bkConstants': 'variable.register',
              '@default': 'identifier'
            }
          }],

          // Разделители и операторы
          [/[{}()\[\]]/, 'delimiter.bracket'],
          [/[;,.]/, 'delimiter'],
          [/->/, 'delimiter'],
          [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
        ],

        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ]
      }
    });

    // 3. Hover Provider: карточки сигнатур, Doxygen docs и аппаратура БК
    monaco.languages.registerHoverProvider(langId, {
      provideHover: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word || !word.word) return null;

        const token = word.word;
        const lineContent = model.getLineContent(position.lineNumber);
        const index = buildProjectIndex();

        // А. Встроенные функции рантайма БК
        if (BK_RUNTIME_FUNCTIONS[token]) {
          const fn = BK_RUNTIME_FUNCTIONS[token];
          const contents = [
            { value: `### Функция БК: \`${fn.sig}\`` },
            { value: fn.desc }
          ];
          if (fn.params && fn.params.length > 0) {
            contents.push({ value: `**Параметры:**\n${fn.params.map(p => `- \`${p}\``).join('\n')}` });
          }
          contents.push({ value: `*Встроенный рантайм BKStudio для PDP-11 / КР1801ВМ1*` });
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: contents
          };
        }

        // Б. Системные вызовы EMT
        if (EMT_SYSTEM_CALLS[token]) {
          const emt = EMT_SYSTEM_CALLS[token];
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `### Системный вызов Монитора БК: \`${emt.sig}\`` },
              { value: emt.desc },
              { value: `*Прерывание EMT 030 системного ПЗУ БК-0010/0011М*` }
            ]
          };
        }

        // В. Аппаратные регистры и константы БК
        if (BK_HARDWARE_INFO[token]) {
          const hw = BK_HARDWARE_INFO[token];
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `### Аппаратура БК: \`${hw.title}\`` },
              { value: hw.desc }
            ]
          };
        }

        // Г. Стандартные типы данных
        if (C_TYPES_INFO[token]) {
          const t = C_TYPES_INFO[token];
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `### Тип данных: \`${token}\`` },
              { value: `- **Размер:** ${t.size}\n- **Диапазон:** \`${t.range}\`` },
              { value: t.desc }
            ]
          };
        }

        // Д. C23 ключевые слова
        if (C23_KEYWORDS_INFO[token]) {
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `### Ключевое слово C23: \`${token}\`` },
              { value: C23_KEYWORDS_INFO[token] },
              { value: `*Стандарт GNU C23 (GCC 14.2.0)*` }
            ]
          };
        }

        // Е. Пользовательские символы проекта (функции, структуры, макросы)
        const sym = index.allSymbols.get(token);
        if (sym) {
          if (sym.kind === 'function') {
            const contents = [
              { value: `### Функция: \`${sym.signature}\`` }
            ];
            if (sym.doc) {
              contents.push({ value: `\`\`\`c\n${sym.doc}\n\`\`\`` });
            }
            contents.push({ value: `*Определена в: \`${sym.filename}:${sym.line}\`*` });
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: contents
            };
          } else if (sym.kind === 'macro') {
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [
                { value: `### Макрос препроцессора: \`${sym.name}\`` },
                { value: `\`\`\`c\n${sym.detail}\n\`\`\`` },
                { value: `*Файл: \`${sym.filename}:${sym.line}\`*` }
              ]
            };
          } else if (sym.kind === 'struct' || sym.kind === 'union') {
            const fieldList = sym.fields.map(f => `  ${f.type} ${f.name};`).join('\n');
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [
                { value: `### ${sym.kind.toUpperCase()}: \`${sym.name}\`` },
                { value: `\`\`\`c\n${sym.kind} ${sym.name} {\n${fieldList}\n};\n\`\`\`` },
                { value: `*Определена в: \`${sym.filename}:${sym.line}\`*` }
              ]
            };
          } else if (sym.kind === 'enum') {
            const constList = sym.constants.map(c => `  ${c.name}${c.value ? ' = ' + c.value : ''},`).join('\n');
            return {
              range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
              contents: [
                { value: `### ENUM: \`${sym.name}\`` },
                { value: `\`\`\`c\nenum ${sym.name} {\n${constList}\n};\n\`\`\`` },
                { value: `*Определено в: \`${sym.filename}:${sym.line}\`*` }
              ]
            };
          }
        }

        return null;
      }
    });

    // 4. Definition Provider: Go to Definition (F12 / Ctrl+Click)
    monaco.languages.registerDefinitionProvider(langId, {
      provideDefinition: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const target = word.word;
        const lineContent = model.getLineContent(position.lineNumber);

        // Проверка перехода по #include "file.h"
        const incMatch = lineContent.match(/#\s*include\s*["<]([^">]+)[">]/);
        if (incMatch) {
          const incTarget = incMatch[1];
          if (global.bkProject && typeof global.bkProject.openFile === 'function') {
            const files = global.bkProject.getAllFiles();
            if (files[incTarget]) {
              global.bkProject.openFile(incTarget);
              return null;
            }
          }
        }

        const index = buildProjectIndex();
        const sym = index.allSymbols.get(target);

        if (sym && sym.filename && sym.line) {
          // Если символ в текущем открытом файле
          const activeFileName = (global.bkProject && global.bkProject.activeFileName) || '';
          if (sym.filename === activeFileName) {
            return {
              uri: model.uri,
              range: new monaco.Range(sym.line, 1, sym.line, target.length + 1)
            };
          }

          // Если символ в другом файле проекта - переключаем файл в редакторе
          if (global.bkProject && typeof global.bkProject.openFile === 'function') {
            const files = global.bkProject.getAllFiles();
            if (files[sym.filename]) {
              global.bkProject.openFile(sym.filename);
              setTimeout(() => {
                if (global.editor) {
                  global.editor.revealLineInCenter(sym.line);
                  global.editor.setPosition({ lineNumber: sym.line, column: 1 });
                  global.editor.focus();
                }
              }, 100);
              return null;
            }
          }
        }

        // Локальный поиск по текущему файлу регулярным выражением
        const text = model.getValue();
        const lines = text.split(/\r?\n/);
        const defRegex = new RegExp(`\\b${target}\\b`);

        for (let i = 0; i < lines.length; i++) {
          if (i + 1 === position.lineNumber) continue; // не переходить на себя
          const line = lines[i];
          if (defRegex.test(line) && (line.includes('{') || line.includes('#define') || line.includes('struct') || line.includes('enum'))) {
            return {
              uri: model.uri,
              range: new monaco.Range(i + 1, 1, i + 1, line.length + 1)
            };
          }
        }

        return null;
      }
    });

    // 5. Document Symbols Provider: Outline / Дерево символов
    monaco.languages.registerDocumentSymbolProvider(langId, {
      provideDocumentSymbols: function (model) {
        const text = model.getValue();
        const parsed = parseCSymbols(text, model.uri.path || 'active.c');
        const symbols = [];

        // Функции
        parsed.functions.forEach(fn => {
          symbols.push({
            name: fn.name,
            detail: fn.signature,
            kind: monaco.languages.SymbolKind.Function,
            range: new monaco.Range(fn.line, 1, fn.line, fn.signature.length + 1),
            selectionRange: new monaco.Range(fn.line, 1, fn.line, fn.name.length + 1)
          });
        });

        // Структуры и объединения
        parsed.structures.forEach(st => {
          symbols.push({
            name: st.name,
            detail: `${st.kind} (${st.fields.length} полей)`,
            kind: monaco.languages.SymbolKind.Struct,
            range: new monaco.Range(st.line, 1, st.line, st.name.length + 1),
            selectionRange: new monaco.Range(st.line, 1, st.line, st.name.length + 1)
          });
        });

        // Перечисления
        parsed.enums.forEach(en => {
          symbols.push({
            name: en.name,
            detail: `enum (${en.constants.length} значений)`,
            kind: monaco.languages.SymbolKind.Enum,
            range: new monaco.Range(en.line, 1, en.line, en.name.length + 1),
            selectionRange: new monaco.Range(en.line, 1, en.line, en.name.length + 1)
          });
        });

        // Макросы
        parsed.macros.forEach(mc => {
          symbols.push({
            name: mc.name,
            detail: mc.detail,
            kind: monaco.languages.SymbolKind.Constant,
            range: new monaco.Range(mc.line, 1, mc.line, mc.name.length + 1),
            selectionRange: new monaco.Range(mc.line, 1, mc.line, mc.name.length + 1)
          });
        });

        return symbols;
      }
    });

    // 6. Completion Provider: автодополнение ключевых слов, рантайма и членов структур
    monaco.languages.registerCompletionItemProvider(langId, {
      triggerCharacters: ['.', '>', '#', ':', ' '],

      provideCompletionItems: function (model, position) {
        const text = model.getValue();
        const lineContent = model.getLineContent(position.lineNumber);
        const prefix = lineContent.substring(0, position.column - 1);
        const word = model.getWordUntilPosition(position);

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [];

        // А. Дополнение членов структур после "." или "->"
        const memberMatch = prefix.match(/([a-zA-Z_]\w*)(?:\.|\->)$/);
        if (memberMatch) {
          const varName = memberMatch[1];
          const index = buildProjectIndex();

          // Ищем тип переменной varName в текущем файле
          const varTypeRegex = new RegExp(`(?:struct\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s+(?:\\*\\s*)?${varName}\\b`);
          const vMatch = text.match(varTypeRegex);
          const typeName = vMatch ? vMatch[1] : varName;

          // Ищем структуру по имени типа
          const structSym = index.allSymbols.get(typeName);
          if (structSym && (structSym.kind === 'struct' || structSym.kind === 'union') && structSym.fields) {
            structSym.fields.forEach(f => {
              suggestions.push({
                label: f.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${f.type} (поле ${structSym.name})`,
                insertText: f.name,
                range: range
              });
            });
            return { suggestions: suggestions };
          }
        }

        // Б. Препроцессорные сниппеты после "#"
        if (prefix.trim().startsWith('#')) {
          [
            { label: 'include "tools.h"', insertText: 'include "tools.h"', detail: 'Утилиты, ССП, задержки, ГСЧ и инструкции PDP-11' },
            { label: 'include "memory.h"', insertText: 'include "memory.h"', detail: 'Карта памяти, регистры, векторы и константы экрана БК' },
            { label: 'include "emt.h"', insertText: 'include "emt.h"', detail: 'Системные вызовы Монитора БК (EMT 4..50)' },
            { label: 'include "stdint.h"', insertText: 'include "stdint.h"', detail: 'Стандартные целочисленные типы и пределы' },
            { label: 'define', insertText: 'define ${1:NAME} ${2:VALUE}', detail: 'Определение макроса' },
            { label: 'pragma once', insertText: 'pragma once', detail: 'Однократное включение заголовка' },
            { label: 'ifdef', insertText: 'ifdef ${1:MACRO}\n$0\n#endif', detail: 'Условная компиляция #ifdef' },
            { label: 'ifndef', insertText: 'ifndef ${1:MACRO}\n$0\n#endif', detail: 'Условная компиляция #ifndef' }
          ].forEach(sn => {
            suggestions.push({
              label: sn.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: sn.detail,
              insertText: sn.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: range
            });
          });
          return { suggestions: suggestions };
        }

        // В. Сниппеты конструкций C23
        const SNIPPETS = [
          {
            label: 'main',
            detail: 'Точка входа main(void) для БК-0010',
            insertText: 'int main(void)\n{\n\t$0\n\treturn 0;\n}'
          },
          {
            label: 'for',
            detail: 'Цикл for со счетчиком uint16_t',
            insertText: 'for (uint16_t ${1:i} = 0; ${1:i} < ${2:count}; ++${1:i})\n{\n\t$0\n}'
          },
          {
            label: 'while',
            detail: 'Цикл while',
            insertText: 'while (${1:condition})\n{\n\t$0\n}'
          },
          {
            label: 'struct',
            detail: 'Определение структуры',
            insertText: 'struct ${1:Name}\n{\n\t${2:uint16_t field};\n};'
          },
          {
            label: 'constexpr',
            detail: 'Константа времени компиляции C23',
            insertText: 'constexpr ${1:uint16_t} ${2:NAME} = ${3:VALUE};'
          }
        ];

        SNIPPETS.forEach(sn => {
          suggestions.push({
            label: sn.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: sn.detail,
            insertText: sn.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          });
        });

        // Г. Функции рантайма БК
        Object.keys(BK_RUNTIME_FUNCTIONS).forEach(fnName => {
          const fn = BK_RUNTIME_FUNCTIONS[fnName];
          suggestions.push({
            label: fnName,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: fn.sig,
            documentation: fn.desc,
            insertText: fnName + '($0)',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          });
        });

        // Д. Системные вызовы EMT
        Object.keys(EMT_SYSTEM_CALLS).forEach(emtName => {
          const emt = EMT_SYSTEM_CALLS[emtName];
          suggestions.push({
            label: emtName,
            kind: monaco.languages.CompletionItemKind.Method,
            detail: emt.sig,
            documentation: emt.desc,
            insertText: emtName + '($0)',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range
          });
        });

        // Е. Аппаратные константы БК
        Object.keys(BK_HARDWARE_INFO).forEach(hw => {
          suggestions.push({
            label: hw,
            kind: monaco.languages.CompletionItemKind.Constant,
            detail: BK_HARDWARE_INFO[hw].title,
            documentation: BK_HARDWARE_INFO[hw].desc,
            insertText: hw,
            range: range
          });
        });

        // Ж. Стандартные типы C23
        Object.keys(C_TYPES_INFO).forEach(tName => {
          suggestions.push({
            label: tName,
            kind: monaco.languages.CompletionItemKind.TypeParameter,
            detail: C_TYPES_INFO[tName].size,
            documentation: C_TYPES_INFO[tName].desc,
            insertText: tName,
            range: range
          });
        });

        // З. Символы проекта (функции, структуры, макросы из других файлов)
        const projIndex = buildProjectIndex();
        projIndex.allSymbols.forEach((sym, sName) => {
          if (sym.kind === 'function') {
            suggestions.push({
              label: sName,
              kind: monaco.languages.CompletionItemKind.Function,
              detail: sym.signature || `Функция из ${sym.filename}`,
              insertText: sName + '($0)',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: range
            });
          } else if (sym.kind === 'macro') {
            suggestions.push({
              label: sName,
              kind: monaco.languages.CompletionItemKind.Constant,
              detail: sym.detail,
              insertText: sName,
              range: range
            });
          } else if (sym.kind === 'enum_member') {
            suggestions.push({
              label: sName,
              kind: monaco.languages.CompletionItemKind.EnumMember,
              detail: `Константа ${sym.parentEnum}`,
              insertText: sName,
              range: range
            });
          }
        });

        return { suggestions: suggestions };
      }
    });

    // 7. Signature Help Provider: подсказка параметров при вводе foo(arg1, arg2)
    monaco.languages.registerSignatureHelpProvider(langId, {
      signatureHelpTriggerCharacters: ['(', ','],

      provideSignatureHelp: function (model, position) {
        const lineContent = model.getLineContent(position.lineNumber);
        const prefix = lineContent.substring(0, position.column - 1);

        // Ищем имя вызываемой функции и текущий индекс аргумента по запятым
        const lastOpenParen = prefix.lastIndexOf('(');
        if (lastOpenParen === -1) return null;

        const sub = prefix.substring(0, lastOpenParen);
        const m = sub.match(/([a-zA-Z_]\w*)\s*$/);
        if (!m) return null;

        const funcName = m[1];
        const argStr = prefix.substring(lastOpenParen + 1);
        const activeParam = (argStr.match(/,/g) || []).length;

        const index = buildProjectIndex();
        let sigInfo = null;

        if (BK_RUNTIME_FUNCTIONS[funcName]) {
          const fn = BK_RUNTIME_FUNCTIONS[funcName];
          sigInfo = {
            label: fn.sig,
            documentation: fn.desc,
            parameters: (fn.params || []).map(p => ({ label: p, documentation: p }))
          };
        } else if (EMT_SYSTEM_CALLS[funcName]) {
          const emt = EMT_SYSTEM_CALLS[funcName];
          sigInfo = {
            label: emt.sig,
            documentation: emt.desc,
            parameters: []
          };
        } else {
          const sym = index.allSymbols.get(funcName);
          if (sym && sym.kind === 'function') {
            sigInfo = {
              label: sym.signature,
              documentation: sym.doc || `Функция ${funcName}`,
              parameters: (sym.params || []).map(p => ({ label: p.raw, documentation: p.type }))
            };
          }
        }

        if (!sigInfo) return null;

        return {
          value: {
            signatures: [sigInfo],
            activeSignature: 0,
            activeParameter: Math.min(activeParam, Math.max(0, sigInfo.parameters.length - 1))
          },
          dispose: () => {}
        };
      }
    });

    // 8. References Provider: Find References (Shift+F12)
    monaco.languages.registerReferenceProvider(langId, {
      provideReferences: function (model, position, context) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const target = word.word;
        const locations = [];
        const index = buildProjectIndex();

        // Поиск по всем файлам проекта
        index.files.forEach((parsedFile, fname) => {
          const files = global.bkProject.getAllFiles();
          const content = files[fname] || '';
          const lines = content.split(/\r?\n/);
          const regex = new RegExp(`\\b${target}\\b`, 'g');

          lines.forEach((line, lineIdx) => {
            let m;
            while ((m = regex.exec(line)) !== null) {
              locations.push({
                uri: model.uri,
                range: new monaco.Range(lineIdx + 1, m.index + 1, lineIdx + 1, m.index + 1 + target.length)
              });
            }
          });
        });

        return locations;
      }
    });

    // 9. Rename Provider: Безопасное переименование идентификатора (F2)
    monaco.languages.registerRenameProvider(langId, {
      provideRenameEdits: function (model, position, newName) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const oldName = word.word;
        if (!/^[a-zA-Z_]\w*$/.test(newName)) {
          throw new Error('Некорректный C-идентификатор: ' + newName);
        }

        const edits = [];
        const text = model.getValue();
        const lines = text.split(/\r?\n/);
        const regex = new RegExp(`\\b${oldName}\\b`, 'g');

        lines.forEach((line, lineIdx) => {
          let m;
          while ((m = regex.exec(line)) !== null) {
            edits.push({
              resource: model.uri,
              versionId: model.getVersionId(),
              textEdit: {
                range: new monaco.Range(lineIdx + 1, m.index + 1, lineIdx + 1, m.index + 1 + oldName.length),
                text: newName
              }
            });
          }
        });

        return { edits: edits };
      }
    });

    console.log('[BKStudio] Высокоуровневый C/C23 Language Server зарегистрирован для Monaco Editor.');
  }

  // =========================================================================
  // 6. ОБНОВЛЕНИЕ БОКОВОЙ ПАНЕЛИ OUTLINE В BKSTUDIO UI ДЛЯ C-ФАЙЛОВ
  // =========================================================================

  /**
   * Заполняет левую панель Outline (дерево меток/символов) для открытого C-файла
   */
  function updateCOutlineView(model) {
    const outlineList = document.getElementById('outline-list');
    const countEl = document.getElementById('outline-count');
    if (!outlineList || !model) return;

    const text = model.getValue();
    const activeFileName = (global.bkProject && global.bkProject.activeFileName) || 'main.c';
    const parsed = parseCSymbols(text, activeFileName);

    const items = [];

    parsed.functions.forEach(fn => {
      items.push({
        name: fn.name + '()',
        line: fn.line,
        icon: '⚡',
        color: '#00ff66',
        detail: fn.signature
      });
    });

    parsed.structures.forEach(st => {
      items.push({
        name: `${st.kind} ${st.name}`,
        line: st.line,
        icon: '🔷',
        color: '#00e5ff',
        detail: `${st.fields.length} полей`
      });
    });

    parsed.enums.forEach(en => {
      items.push({
        name: `enum ${en.name}`,
        line: en.line,
        icon: '🔹',
        color: '#ffe066',
        detail: `${en.constants.length} констант`
      });
    });

    parsed.macros.forEach(mc => {
      items.push({
        name: mc.name,
        line: mc.line,
        icon: '📌',
        color: '#ffa657',
        detail: mc.detail
      });
    });

    items.sort((a, b) => a.line - b.line);

    if (countEl) countEl.textContent = items.length;

    if (items.length === 0) {
      outlineList.innerHTML = '<li class="outline-empty" style="padding: 8px 12px; font-size: 11px; color: var(--text-muted);">Символы C (функции, структуры) не найдены</li>';
      return;
    }

    outlineList.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'file-item outline-item';
      li.title = `${item.detail} (строка ${item.line})`;
      li.innerHTML = `
        <span style="font-size: 11px;">${item.icon}</span>
        <span style="font-weight: 600; color: var(--text-primary); font-family: var(--font-mono); font-size: 12px;">${item.name}</span>
        <span style="margin-left: auto; font-size: 10px; color: var(--text-secondary); font-family: var(--font-mono);">:${item.line}</span>
      `;
      li.onclick = () => {
        if (global.editor) {
          global.editor.revealLineInCenter(item.line);
          global.editor.setPosition({ lineNumber: item.line, column: 1 });
          global.editor.focus();
        }
      };
      outlineList.appendChild(li);
    });
  }

  // Экспорт публичных функций в глобальную область видимости
  global.registerCLanguage = registerCLanguage;
  global.analyzeCSyntax = analyzeCSyntax;
  global.updateCOutlineView = updateCOutlineView;
  global.parseCSymbols = parseCSymbols;

})(typeof window !== 'undefined' ? window : this);
