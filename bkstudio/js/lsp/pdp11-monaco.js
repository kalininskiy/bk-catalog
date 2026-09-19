/**
 * BKStudio - Monaco Editor PDP-11 Language Provider
 *
 * Integrates Monarch Syntax Highlighting, Themes, Hover, Completion, Definition, and Symbols
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  const EMT_DESCRIPTIONS = {
    '4': { title: 'EMT 4 (04) — Останов программы (HALT)', text: 'Выход в системный монитор БК.' },
    '6': { title: 'EMT 6 (06) — Печать восьмеричного числа', text: 'Выводит 16-битное число из регистра R0 на экран в восьмеричном формате.' },
    '10': { title: 'EMT 10 (010) — Печать десятичного числа', text: 'Выводит 16-битное число из регистра R0 на экран в десятичном формате.' },
    '12': { title: 'EMT 12 (012) — Чтение точки экрана (Point)', text: 'Считывает цвет пикселя по координатам X=R1, Y=R2.' },
    '14': { title: 'EMT 14 (014) — Очистка экрана', text: 'Очищает экран и устанавливает курсор в левый верхний угол (позиция 0,0).' },
    '16': { title: 'EMT 16 (016) — Вывод символа на экран', text: 'Выводит символ из младшего байта R0 на экран в текущую позицию курсора. Обрабатывает управляющие символы (BS, LF, CR, звонок и др.).' },
    '20': { title: 'EMT 20 (020) — Вывод строки на экран', text: 'Выводит строку символов из памяти. R1 = адрес начала строки; R2 = 0 (признак конца строки байтом 0).' },
    '22': { title: 'EMT 22 (022) — Ввод символа с клавиатуры', text: 'Ожидает нажатия клавиши. Возвращает ASCII-код символа в младшем байте R0.' },
    '24': { title: 'EMT 24 (024) — Опрос клавиатуры без ожидания', text: 'Проверяет буфер клавиатуры. Если символ нажат — код в R0; если нет — R0 = 0.' },
    '26': { title: 'EMT 26 (026) — Звуковой сигнал (BEEP)', text: 'Генерирует короткий звуковой сигнал встроенным пьезодинамиком БК.' },
    '30': { title: 'EMT 30 (030) — Чтение системного таймера', text: 'Считывает текущее значение системного таймера БК в регистры R0 и R1.' },
    '32': { title: 'EMT 32 (032) — Задержка таймера', text: 'Останавливает выполнение программы на R0 тиков системного таймера.' },
    '36': { title: 'EMT 36 (036) — Работа с магнитофоном', text: 'Подпрограмма ввода/вывода данных на кассетную магнитную ленту БК.' },
    '40': { title: 'EMT 40 (040) — Последовательный интерфейс (ИРПС)', text: 'Приём и передача байта через последовательный порт ИРПС.' },
    '42': { title: 'EMT 42 (042) — Рисование точки на экране', text: 'Рисует пиксель с координатами X=R1, Y=R2 цветом R0.' },
    '44': { title: 'EMT 44 (044) — Рисование линии на экране', text: 'Рисует вектор (линию) от текущей точки до координат X=R1, Y=R2.' }
  };

  const REGISTER_DESCRIPTIONS = {
    'R0': 'R0 (Регистр общего назначения 0) / Аккумулятор / Возврат результатов функций',
    'R1': 'R1 (Регистр общего назначения 1) / Указатель адреса данных, строковый указатель',
    'R2': 'R2 (Регистр общего назначения 2) / Счетчик циклов, длина строки или буфера',
    'R3': 'R3 (Регистр общего назначения 3) / Регистр общего назначения',
    'R4': 'R4 (Регистр общего назначения 4) / Регистр общего назначения',
    'R5': 'R5 (Регистр общего назначения 5) / Указатель кадра стека (Frame Pointer)',
    'R6': 'R6 / SP (Stack Pointer) — Аппаратный указатель вершины стека PDP-11',
    'SP': 'SP (Stack Pointer, R6) — Аппаратный указатель вершины стека PDP-11',
    'R7': 'R7 / PC (Program Counter) — Счётчик адреса следующей команды процессора',
    'PC': 'PC (Program Counter, R7) — Счётчик адреса следующей команды процессора'
  };

  const DIRECTIVES_INFO = {
    'la': 'Load Address — Начальный адрес ассемблирования двоичного файла БК (синоним .ORG / .LINK)',
    'link': 'Установка стартового адреса загрузки для компоновщика',
    'word': 'Выделение и инициализация одного или нескольких 16-битных слов памяти',
    'byte': 'Выделение и инициализация одного или нескольких 8-битных байтов памяти',
    'org': 'Установка текущего адреса счетчика ассемблирования',
    'even': 'Выравнивание текущего адреса ассемблирования на четную границу слова',
    'asciz': 'Строка текста ASCII, завершающаяся нулевым байтом (C-style)',
    'ascii': 'Строка текста ASCII без завершающего нуля',
    'blkw': 'Резервирование блока слов (16 бит) заданной длины без инициализации',
    'blkb': 'Резервирование блока байтов (8 бит) заданной длины без инициализации',
    'rad50': 'Упаковка трех символов в одно 16-битное слово формата RADIX-50',
    'radix': 'Смена системы счисления по умолчанию (8, 10 или 16)',
    'title': 'Задание названия программы или модуля',
    'macro': 'Начало определения макрокоманды',
    'endm': 'Окончание определения макрокоманды',
    'end': 'Конец программы. В операнде можно указать точку входа (например, .END START)',
    'ends': 'Окончание блока встроенного ассемблерного скрипта вычислений',
    'script': 'Начало ассемблерного скрипта выражений в BKTurbo8',
    'equ': 'Присваивание символической константе числового значения',
    'include': 'Включение исходного текста из внешнего файла (.MAC / .ASM / .INC)',
    'insert': 'Прямая бинарная вставка содержимого файла по текущему адресу',
    'print': 'Вывод информационного сообщения или значения выражения при компиляции',
    'asect': 'Переключение в абсолютную секцию адресации памяти',
    'csect': 'Переключение в перемещаемую секцию программного кода',
    'globl': 'Объявление глобального символа для связывания модулей',
    'if': 'Условное ассемблирование: начало условного блока',
    'endc': 'Окончание блока условного ассемблирования .IF',
    'rept': 'Повторение блока исходного кода заданное количество раз',
    'endr': 'Окончание блока повторения .REPT',
    'enabl': 'Включение расширенных режимов транслятора',
    'dsabl': 'Отключение режимов транслятора',
    'addr': 'Размещение 16-битного адреса метки или выражения в памяти',
    'packed': 'Сжатие и упаковка блока данных для экономии памяти в BKTurbo8',
    'flt2': 'Размещение числа с плавающей запятой половинной точности (2 байта) в BKTurbo8',
    'flt4': 'Размещение числа с плавающей запятой одинарной точности (4 байта) в BKTurbo8',
    'sbttl': 'Задание подзаголовка программы в листинге транслятора',
    'ident': 'Идентификатор версии программы или модуля',
    'page': 'Переход на новую страницу при формировании листинга',
    'error': 'Генерация пользовательской ошибки ассемблирования',
    'list': 'Включение формирования листинга программы',
    'nlist': 'Отключение формирования листинга программы',
    'make_bin': 'Генерация исполняемого файла .BIN для БК: make_bin "output.bin"',
    'make_raw': 'Генерация сырого двоичного образа памяти без заголовка: make_raw "output.raw"',
    'make_wav': 'Генерация аудиофайла ленты WAV для БК (1200 бод): make_wav "output.wav", "file_name"',
    'make_turbo_wav': 'Генерация турбо-аудиофайла ленты WAV для БК: make_turbo_wav "output.wav", "file_name"',
    'make_bk0010_rom': 'Генерация ROM-образа ПЗУ БК-0010: make_bk0010_rom "output.bin"',
    'insert_file': 'Прямая бинарная вставка содержимого внешнего файла в память: insert_file "file.bin"',
    'repeat': 'Повторение блока кода заданное количество раз: .repeat <кол-во> { ... }',
    'extern': 'Объявление внешних символов модуля (.extern all или .extern sym1, sym2)',
    'db': 'Размещение 8-битного байта данных в памяти (синоним .BYTE)',
    'dw': 'Размещение 16-битного слова данных в памяти (синоним .WORD)',
    'dword': 'Размещение 32-битного двойного слова данных в памяти',
    'odd': 'Выравнивание текущего адреса счетчика на нечетную границу',
    'align': 'Выравнивание текущего адреса счетчика на границу N байт',
    'once': 'Однократная компиляция файла (аналог #pragma once)',
    'charset': 'Установка кодировки выходных строковых литералов (bk, koi8-r, cp866, utf-8)',
    'encoding': 'Установка кодировки выходных строковых литералов (синоним .CHARSET)',
    'psect': 'Объявление и переключение программной секции (.PSECT name, attr1, attr2...) в MACRO-11',
    'mcall': 'Вызов макрокоманд из макробиблиотеки (.MCALL macro1, macro2...) в MACRO-11',
    'irp': 'Повторение блока макроса для списка аргументов (.IRP sym, <arg1, arg2...>) в MACRO-11',
    'irpc': 'Повторение блока макроса для каждого символа строки (.IRPC sym, <string>) в MACRO-11',
    'iff': 'Условное ассемблирование: блок выполняется, если условие ложно (False) в MACRO-11',
    'ift': 'Условное ассемблирование: блок выполняется, если условие истинно (True) в MACRO-11',
    'iftf': 'Условное ассемблирование: блок выполняется в любом случае (True/False) в MACRO-11',
    'limit': 'Размещение предельных адресов программы (Transfer address и High limit) в памяти'
  };

  // Дублируем ключи с лидирующим нулем для надежного сопоставления
  Object.keys(EMT_DESCRIPTIONS).forEach(k => {
    EMT_DESCRIPTIONS['0' + k] = EMT_DESCRIPTIONS[k];
  });

  function getEmtInfo(arg) {
    if (!arg) return null;
    const s = String(arg).replace('#', '').trim();
    if (EMT_DESCRIPTIONS[s]) return EMT_DESCRIPTIONS[s];
    const clean = s.replace(/^0+/, '') || '0';
    if (EMT_DESCRIPTIONS[clean]) return EMT_DESCRIPTIONS[clean];
    const withZero = '0' + clean;
    if (EMT_DESCRIPTIONS[withZero]) return EMT_DESCRIPTIONS[withZero];
    try {
      const octVal = parseInt(s, 8);
      for (const [k, v] of Object.entries(EMT_DESCRIPTIONS)) {
        if (parseInt(k, 8) === octVal) return v;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Инициализация поддержки PDP-11 в Monaco Editor
   * @param {object} monaco 
   */
  function registerPdp11Language(monaco) {
    if (!monaco) return;

    const langId = 'pdp11-asm';

    // 1. Регистрируем идентификатор языка
    monaco.languages.register({
      id: langId,
      extensions: ['.asm', '.s', '.mac', '.inc'],
      aliases: ['PDP-11 Assembler', 'pdp11asm', 'bk-asm']
    });

    // 2. Настройки комментариев и автозакрытия
    monaco.languages.setLanguageConfiguration(langId, {
      comments: {
        lineComment: ';',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['(', ')'],
        ['[', ']'],
        ['{', '}']
      ],
      autoClosingPairs: [
        { open: '(', close: ')' },
        { open: '[', close: ']' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ],
      surroundingPairs: [
        { open: '(', close: ')' },
        { open: '[', close: ']' },
        { open: '{', close: '}' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ],
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g
    });

    // 3. Формируем списки ключевых слов в нижнем и верхнем регистре
    const rawInstructions = Object.keys(global.PDP11_INSTRUCTIONS || {
      MOV: 1, MOVB: 1, CMP: 1, CMPB: 1, BIT: 1, BITB: 1, BIC: 1, BICB: 1,
      BIS: 1, BISB: 1, ADD: 1, SUB: 1, JSR: 1, MUL: 1, DIV: 1, ASH: 1,
      ASHC: 1, XOR: 1, SOB: 1, CLR: 1, CLRB: 1, COM: 1, COMB: 1, INC: 1,
      INCB: 1, DEC: 1, DECB: 1, NEG: 1, NEGB: 1, ADC: 1, ADCB: 1, SBC: 1,
      SBCB: 1, TST: 1, TSTB: 1, ROR: 1, RORB: 1, ROL: 1, ROLB: 1, ASR: 1,
      ASRB: 1, ASL: 1, ASLB: 1, SXT: 1, SWAB: 1, BR: 1, BNE: 1, BEQ: 1,
      BGE: 1, BLT: 1, BGT: 1, BLE: 1, BPL: 1, BMI: 1, BHI: 1, BLOS: 1,
      BVC: 1, BVS: 1, BCC: 1, BCS: 1, BHIS: 1, BLO: 1, EMT: 1, TRAP: 1,
      BPT: 1, IOT: 1, RTI: 1, RTT: 1, RTS: 1, JMP: 1, WAIT: 1, RESET: 1,
      HALT: 1, HLT: 1, CALL: 1, CALLR: 1, RET: 1, RETURN: 1, PUSH: 1, POP: 1,
      NOP: 1, CLC: 1, CLV: 1, CLZ: 1, CLN: 1, CCC: 1, SEC: 1,
      SEV: 1, SEZ: 1, SEN: 1, SCC: 1
    });

    const instSet = new Set();
    rawInstructions.forEach(inst => {
      instSet.add(inst.toUpperCase());
      instSet.add(inst.toLowerCase());
    });
    const instructionsList = Array.from(instSet);

    const rawDirectives = [
      'la', 'link', 'word', 'byte', 'org', 'even', 'print', 'rad50', 'radix',
      'addr', 'flt2', 'flt4', 'insert', 'include', 'ascii', 'asciz', 'blkb',
      'blkw', 'macro', 'script', 'endm', 'end', 'ends', 'title', 'enabl',
      'asect', 'if', 'error', 'endc', 'rept', 'endr', 'equ',
      'make_bin', 'make_raw', 'make_wav', 'make_turbo_wav', 'make_bk0010_rom', 'insert_file',
      'repeat', 'extern', 'db', 'dw', 'dword', 'odd', 'align', 'once', 'charset', 'encoding'
    ];
    const dirSet = new Set();
    rawDirectives.forEach(d => {
      dirSet.add(d.toLowerCase());
      dirSet.add(d.toUpperCase());
    });
    const directivesList = Array.from(dirSet);

    const regSet = new Set([
      'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'SP', 'PC',
      'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'sp', 'pc',
      '%0', '%1', '%2', '%3', '%4', '%5', '%6', '%7'
    ]);
    const registersList = Array.from(regSet);

    // 4. Регистрация Monarch Tokenizer
    monaco.languages.setMonarchTokensProvider(langId, {
      defaultToken: '',
      ignoreCase: true,
      instructions: instructionsList,
      directives: directivesList,
      registers: registersList,

      tokenizer: {
        root: [
          // Комментарии
          [/;.*$/, 'comment'],
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],

          // Метки
          [/^[ \t]*([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$):/, 'type.identifier'],
          [/([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$):/, 'type.identifier'],

          // Строки в кавычках
          [/"([^"\\]|\\.)*"/, 'string'],
          [/'([^'\\]|\\.)*'/, 'string'],
          [/#"[^"\s]{1,2}/, 'string'],
          [/#'[^\s,]/, 'string'],

          // Директивы с точкой и @
          [/\.[A-Za-z_][A-Za-z0-9_]*/, 'keyword.directive'],
          [/\\@[A-Za-z_][A-Za-z0-9_]*/, 'keyword.directive'],
          [/\bequ\b/i, 'keyword.directive'],

          // Регистры с %
          [/%\d\b/, 'variable.register'],

          // Идентификаторы, инструкции, регистры
          [/[A-Za-z_][A-Za-z0-9_]*/, {
            cases: {
              '@instructions': 'keyword.instruction',
              '@registers': 'variable.register',
              '@directives': 'keyword.directive',
              '@default': 'identifier'
            }
          }],

          // Восьмеричные и другие числа
          [/#?[0-7]+\b/, 'number.octal'],
          [/#?[0-9]+\./, 'number'],
          [/0x[0-9a-fA-F]+\b/, 'number.hex'],
          [/#\d+\b/, 'number'],

          // Разделители и операторы адресации
          [/[,\(\)@#\+\-]/, 'delimiter']
        ],

        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ]
      }
    });

    // 5. Определение палитр тем
    registerThemes(monaco);

    // 6. Провайдер Hover (всплывающие карточки)
    const pdp11HoverProvider = {
      provideHover: function (model, position) {
        const lineText = model.getLineContent(position.lineNumber);
        const col = position.column; // 1-indexed

        // Извлекаем токен прямо под курсором с учётом точки, решетки, доллара и знака процента
        let start = col - 1;
        while (start > 0 && /[a-zA-Z0-9_.#$%]/.test(lineText[start - 1])) {
          start--;
        }
        let end = col - 1;
        while (end < lineText.length && /[a-zA-Z0-9_.#$%]/.test(lineText[end])) {
          end++;
        }

        let rawToken = lineText.substring(start, end).trim();
        if (!rawToken) {
          const w = model.getWordAtPosition(position);
          if (w && w.word) rawToken = w.word;
          else return null;
        }

        const tokenRange = new monaco.Range(position.lineNumber, start + 1, position.lineNumber, Math.max(end + 1, start + 2));
        const cleanToken = rawToken.replace(/[:]/g, '').trim();
        const upperToken = cleanToken.toUpperCase();
        const lowerToken = cleanToken.toLowerCase();

        // А. Проверка директив и команд ассемблера
        const PDPY11_COMMANDS = new Set([
          'make_bin', 'make_raw', 'make_wav', 'make_turbo_wav', 'make_bk0010_rom', 'insert_file'
        ]);
        const PDPY11_SPECIFIC = new Set([
          'make_bin', 'make_raw', 'make_wav', 'make_turbo_wav', 'make_bk0010_rom', 'insert_file',
          'repeat', 'extern', 'db', 'dw', 'dword', 'odd', 'align', 'once', 'charset', 'encoding'
        ]);
        const BKTURBO8_SPECIFIC = new Set([
          'script', 'ends', 'addr', 'flt2', 'flt4', 'insert', 'packed'
        ]);

        const dirKey = lowerToken.startsWith('.') ? lowerToken.slice(1) : (DIRECTIVES_INFO[lowerToken] ? lowerToken : null);
        if (dirKey && DIRECTIVES_INFO[dirKey]) {
          const isCommand = PDPY11_COMMANDS.has(dirKey);
          const hasDotInCode = rawToken.startsWith('.') || cleanToken.startsWith('.');

          let headerTitle = '';
          if (isCommand && !hasDotInCode) {
            headerTitle = `### Команда сборщика: \`${cleanToken.toUpperCase()}\``;
          } else if (hasDotInCode) {
            headerTitle = `### Директива ассемблера: \`.${dirKey.toUpperCase()}\``;
          } else if (isCommand) {
            headerTitle = `### Команда сборщика: \`${cleanToken.toUpperCase()}\``;
          } else {
            headerTitle = `### Директива ассемблера: \`${cleanToken.toUpperCase()}\``;
          }

          const MACRO11_SPECIFIC = new Set([
            'psect', 'mcall', 'irp', 'irpc', 'iff', 'ift', 'iftf', 'limit'
          ]);

          let footerText = '';
          if (PDPY11_SPECIFIC.has(dirKey)) {
            footerText = '*Команда / директива кросс-ассемблера PDPy11*';
          } else if (BKTURBO8_SPECIFIC.has(dirKey)) {
            footerText = '*Директива кросс-ассемблера BKTurbo8 для Электроники БК*';
          } else if (MACRO11_SPECIFIC.has(dirKey)) {
            footerText = '*Директива классического макроассемблера MACRO-11 (DEC PDP-11 / RT-11)*';
          } else {
            const activeCompiler = (typeof window !== 'undefined' && window.compilerBridge && typeof window.compilerBridge.getCompiler === 'function')
              ? window.compilerBridge.getCompiler()
              : 'bkturbo8';
            const compName = (activeCompiler === 'macro11') ? 'MACRO-11' : ((activeCompiler === 'pdpy11') ? 'PDPy11' : 'BKTurbo8');
            footerText = `*Директива ассемблера PDP-11 (поддерживается в ${compName})*`;
          }

          return {
            range: tokenRange,
            contents: [
              { value: headerTitle },
              { value: DIRECTIVES_INFO[dirKey] },
              { value: footerText }
            ]
          };
        }

        // Б. Проверка вызовов EMT и аргументов EMT
        // 1: Если курсор стоит на слове EMT
        if (upperToken === 'EMT') {
          const lineEmt = lineText.match(/EMT\s+(#?[0-7]+)/i);
          if (lineEmt) {
            const arg = lineEmt[1].replace('#', '');
            const info = getEmtInfo(arg);
            return {
              range: tokenRange,
              contents: [
                { value: `### Команда: \`EMT ${arg}\`` },
                { value: info ? info.text : `Системный вызов монитора БК с кодом 0${arg}` },
                { value: `**Код операции:** \`104000 + 0${arg}\` (восьмеричный)` }
              ]
            };
          } else {
            return {
              range: tokenRange,
              contents: [
                { value: `### Команда PDP-11: \`EMT\`` },
                { value: `**Emulator Trap** — вызов системной подпрограммы монитора БК-0010/0011М через вектор прерывания 030.` },
                { value: `*Основные вызовы:*\n- \`EMT 14\` — Очистка экрана\n- \`EMT 16\` — Вывод символа (R0)\n- \`EMT 20\` — Вывод строки (R1)\n- \`EMT 24\` — Опрос клавиатуры` }
              ]
            };
          }
        }

        // 2: Если курсор стоит на аргументе EMT (например, на 16 или #16 в строке EMT 16)
        const emtOnLine = lineText.match(/EMT\s+(#?[0-7]+)/i);
        if (emtOnLine) {
          const emtArg = emtOnLine[1].replace('#', '');
          const cleanNum = cleanToken.replace('#', '');
          if (cleanNum === emtArg || parseInt(cleanNum, 8) === parseInt(emtArg, 8)) {
            const info = getEmtInfo(emtArg);
            if (info) {
              return {
                range: tokenRange,
                contents: [
                  { value: `### ${info.title}` },
                  { value: info.text },
                  { value: `*Системный вызов монитора БК-0010 / БК-0011М (код 0${emtArg})*` }
                ]
              };
            }
          }
        }

        // В. Проверка инструкций PDP-11
        const inst = global.PDP11_INSTRUCTIONS && (global.PDP11_INSTRUCTIONS[upperToken] || global.PDP11_INSTRUCTIONS[cleanToken]);
        if (inst) {
          const contents = [
            { value: `### Команда PDP-11: \`${inst.mnemonic}\`` },
            { value: `**Назначение:** ${inst.description || 'Инструкция процессора К1801ВМ1'}` },
            { value: `- **Операндов:** \`${inst.operands}\`\n- **Такты:** \`${inst.cycles || '8+'}\`` }
          ];

          if (inst.affects && inst.affects.length > 0) {
            contents.push({ value: `**Влияние на флаги (NZVC):** \`${inst.affects.join(' ')}\`` });
          }

          if (inst.allowedSrc || inst.allowedDst) {
            const parts = [];
            if (inst.allowedSrc) parts.push(`Src: \`${inst.allowedSrc.join(', ')}\``);
            if (inst.allowedDst) parts.push(`Dst: \`${inst.allowedDst.join(', ')}\``);
            contents.push({ value: `**Адресация:** ${parts.join(' | ')}` });
          }

          return {
            range: tokenRange,
            contents: contents
          };
        }

        // Г. Проверка регистров
        let regKey = upperToken;
        if (regKey.startsWith('%')) {
          regKey = 'R' + regKey.slice(1);
        }
        if (REGISTER_DESCRIPTIONS[regKey]) {
          return {
            range: tokenRange,
            contents: [
              { value: `### Регистр PDP-11: \`${upperToken}\`` },
              { value: REGISTER_DESCRIPTIONS[regKey] }
            ]
          };
        }

        // Д. Проверка меток (через поиск в файле)
        const labelRegex = new RegExp(`^\\s*(${escapeRegExp(cleanToken)}):`, 'im');
        const lines = model.getValue().split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (labelRegex.test(lines[i])) {
            return {
              range: tokenRange,
              contents: [
                { value: `### Метка перехода: \`${cleanToken}\`` },
                { value: `Определена на **строке ${i + 1}**:\n\`\`\`pdp11asm\n${lines[i].trim()}\n\`\`\`` }
              ]
            };
          }
        }

        return null;
      }
    };
    monaco.languages.registerHoverProvider(langId, pdp11HoverProvider);
    global.pdp11HoverProvider = pdp11HoverProvider;

    // 7. Провайдер автодополнения (Completion)
    monaco.languages.registerCompletionItemProvider(langId, {
      provideCompletionItems: function (model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const suggestions = [];

        // Сниппеты
        if (global.PDP11_SNIPPETS) {
          for (const [title, snippet] of Object.entries(global.PDP11_SNIPPETS)) {
            suggestions.push({
              label: snippet.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              documentation: snippet.description || title,
              insertText: Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: range
            });
          }
        }

        // Инструкции PDP-11
        if (global.PDP11_INSTRUCTIONS) {
          for (const [mnem, info] of Object.entries(global.PDP11_INSTRUCTIONS)) {
            suggestions.push({
              label: mnem,
              kind: monaco.languages.CompletionItemKind.Keyword,
              detail: info.description,
              insertText: mnem + ' ',
              range: range
            });
          }
        }

        // Директивы ассемблера
        Object.keys(DIRECTIVES_INFO).forEach(d => {
          suggestions.push({
            label: '.' + d.toUpperCase(),
            kind: monaco.languages.CompletionItemKind.Class,
            detail: DIRECTIVES_INFO[d],
            insertText: '.' + d.toUpperCase() + ' ',
            range: range
          });
        });

        // Регистры
        ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'SP', 'PC'].forEach(reg => {
          suggestions.push({
            label: reg,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: REGISTER_DESCRIPTIONS[reg] || 'Регистр PDP-11',
            insertText: reg,
            range: range
          });
        });

        // Метки текущего документа
        try {
          const text = model.getValue();
          const lblRegex = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$):/gm;
          let m;
          const seen = new Set();
          while ((m = lblRegex.exec(text)) !== null) {
            const lbl = m[1];
            if (!seen.has(lbl)) {
              seen.add(lbl);
              suggestions.push({
                label: lbl,
                kind: monaco.languages.CompletionItemKind.Reference,
                detail: 'Метка перехода',
                insertText: lbl,
                range: range
              });
            }
          }
        } catch (e) {}

        return { suggestions: suggestions };
      }
    });

    // 8. Провайдер перехода к определению (Go to Definition F12 / Ctrl+Click)
    monaco.languages.registerDefinitionProvider(langId, {
      provideDefinition: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const target = word.word;
        const text = model.getValue();
        const lines = text.split(/\r?\n/);

        const escaped = escapeRegExp(target);
        const regex = new RegExp(`^\\s*(${escaped}):`, 'i');

        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(regex);
          if (match) {
            return {
              uri: model.uri,
              range: new monaco.Range(i + 1, 1, i + 1, match[1].length + 1)
            };
          }
        }

        return null;
      }
    });

    // 9. Провайдер DocumentSymbol (Дерево символов и меток)
    monaco.languages.registerDocumentSymbolProvider(langId, {
      provideDocumentSymbols: function (model) {
        const symbols = [];
        const lines = model.getValue().split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const m = line.match(/^\s*([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$):/);
          if (m) {
            symbols.push({
              name: m[1],
              detail: 'Строка ' + (i + 1),
              kind: monaco.languages.SymbolKind.Function,
              range: new monaco.Range(i + 1, 1, i + 1, line.length + 1),
              selectionRange: new monaco.Range(i + 1, 1, i + 1, m[1].length + 1)
            });
          }
        }

        return symbols;
      }
    });

    console.log('[BKStudio] Языковой модуль PDP-11 для Monaco Editor зарегистрирован.');
  }

  /**
   * Определение тем оформления Monaco Editor
   */
  function registerThemes(monaco) {
    // 1. Тема «Ретро CRT Зеленый люминофор» (по умолчанию)
    monaco.editor.defineTheme('bk-crt-green', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
        { token: 'keyword.instruction', foreground: '00ff66', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: '00e5ff', fontStyle: 'bold' },
        { token: 'variable.register', foreground: 'ffaa00', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'ffe066', fontStyle: 'bold' },
        { token: 'identifier', foreground: 'e6edf3' },
        { token: 'string', foreground: '79c0ff' },
        { token: 'number', foreground: 'ffa657' },
        { token: 'number.octal', foreground: 'ffa657' },
        { token: 'number.hex', foreground: 'ffa657' },
        { token: 'delimiter', foreground: '00e5ff' }
      ],
      colors: {
        'editor.background': '#0a0d12',
        'editor.foreground': '#e6edf3',
        'editorLineNumber.foreground': '#484f58',
        'editorLineNumber.activeForeground': '#00ff66',
        'editorCursor.foreground': '#00ff66',
        'editor.selectionBackground': '#183a24',
        'editor.lineHighlightBackground': '#111822',
        'editorIndentGuide.background': '#1f2937',
        'editorIndentGuide.activeBackground': '#374151'
      }
    });

    // 2. Тема «Ретро CRT Янтарный люминофор»
    monaco.editor.defineTheme('bk-crt-amber', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '706550', fontStyle: 'italic' },
        { token: 'keyword.instruction', foreground: 'ffaa00', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: 'ff7700', fontStyle: 'bold' },
        { token: 'variable.register', foreground: 'ffee55', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'ffffff', fontStyle: 'bold' },
        { token: 'identifier', foreground: 'ffd899' },
        { token: 'string', foreground: 'ffcc88' },
        { token: 'number', foreground: 'ff9933' },
        { token: 'number.octal', foreground: 'ff9933' },
        { token: 'number.hex', foreground: 'ff9933' },
        { token: 'delimiter', foreground: 'ffaa00' }
      ],
      colors: {
        'editor.background': '#100c08',
        'editor.foreground': '#ffd899',
        'editorLineNumber.foreground': '#5c4830',
        'editorLineNumber.activeForeground': '#ffaa00',
        'editorCursor.foreground': '#ffaa00',
        'editor.selectionBackground': '#3b2910',
        'editor.lineHighlightBackground': '#1c150c',
        'editorIndentGuide.background': '#2b2014',
        'editorIndentGuide.activeBackground': '#4d3920'
      }
    });

    // 3. Тема «VS Dark Modern»
    monaco.editor.defineTheme('vs-dark-modern', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'keyword.instruction', foreground: '569cd6', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: '4ec9b0' },
        { token: 'variable.register', foreground: '9cdcfe', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'dcdcaa', fontStyle: 'bold' },
        { token: 'identifier', foreground: 'd4d4d4' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'number.octal', foreground: 'b5cea8' },
        { token: 'delimiter', foreground: '808080' }
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editorCursor.foreground': '#aeafad',
        'editor.selectionBackground': '#264f78',
        'editor.lineHighlightBackground': '#282828'
      }
    });

    // 4. Тема «Monokai Retro»
    monaco.editor.defineTheme('monokai-retro', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
        { token: 'keyword.instruction', foreground: 'f92672', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: '66d9ef' },
        { token: 'variable.register', foreground: 'fd971f', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: 'a6e22e', fontStyle: 'bold' },
        { token: 'identifier', foreground: 'f8f8f2' },
        { token: 'string', foreground: 'e6db74' },
        { token: 'number', foreground: 'ae81ff' },
        { token: 'number.octal', foreground: 'ae81ff' },
        { token: 'delimiter', foreground: 'f8f8f2' }
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#f8f8f2',
        'editorLineNumber.foreground': '#90908a',
        'editorLineNumber.activeForeground': '#f8f8f2',
        'editorCursor.foreground': '#f8f8f0',
        'editor.selectionBackground': '#49483e',
        'editor.lineHighlightBackground': '#3e3d32'
      }
    });

    // 5. Тема «Светлая»
    monaco.editor.defineTheme('vs-light-theme', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'keyword.instruction', foreground: '0000ff', fontStyle: 'bold' },
        { token: 'keyword.directive', foreground: '0070c1' },
        { token: 'variable.register', foreground: '795e26', fontStyle: 'bold' },
        { token: 'type.identifier', foreground: '267f99', fontStyle: 'bold' },
        { token: 'identifier', foreground: '000000' },
        { token: 'string', foreground: 'a31515' },
        { token: 'number', foreground: '098658' },
        { token: 'number.octal', foreground: '098658' },
        { token: 'delimiter', foreground: '000000' }
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#000000',
        'editorLineNumber.foreground': '#237893',
        'editorLineNumber.activeForeground': '#0b216f',
        'editorCursor.foreground': '#000000',
        'editor.selectionBackground': '#add6ff',
        'editor.lineHighlightBackground': '#f5f5f5'
      }
    });
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  global.registerPdp11Language = registerPdp11Language;

})(typeof window !== 'undefined' ? window : this);
