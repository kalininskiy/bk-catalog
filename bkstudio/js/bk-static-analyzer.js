/**
 * BKStudio - BK Static Analyzer
 *
 * Статический анализ машинного кода PDP-11/К1801ВМ1
 * по .LST-листингам BKTurbo8 и DEC MACRO-11.
 *
 * Проверяет микрооптимизации, избыточные инструкции
 * и подозрительные конструкции машинного кода.
 *
 * Поддерживаемые форматы:
 *   - BKTurbo8 .LST
 *   - DEC MACRO-11 .LST
 *
 * PDPy11 пока не поддерживается.
 *
 * Original C# version by Никита Зимин (nzeemin) https://github.com/nzeemin
 * 
 * JavaScript version by Ivan "VDM" Kalininskiy (c) 2026
 */
(function (global) {
    'use strict';

    const VERSION = '1.0 ';

    /*
     * ----------------------------------------------------------------------
     * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
     * ----------------------------------------------------------------------
     */

    function toUint16(value) {
        return value & 0xFFFF;
    }

    function parseOctal(value) {
        if (typeof value !== 'string' || !/^[0-7]+$/.test(value)) {
            return null;
        }

        return parseInt(value, 8) & 0xFFFF;
    }

    function formatOctal(value, width = 6) {
        return (value & 0xFFFF).toString(8).padStart(width, '0');
    }

    function isOctalWordToken(token) {
        return /^[0-7]{6,7}$/.test(token);
    }

    function isOctalByteToken(token) {
        return /^[0-7]{3,4}$/.test(token);
    }

    /*
     * ----------------------------------------------------------------------
     * LST PARSER
     * ----------------------------------------------------------------------
     *
     * Ожидается классический вид строки:
     *
     *     line address: word word word    source
     *
     * Например:
     *
     *       12 010000: 012700 000001      MOV #1,R0
     *
     * Парсер намеренно не зависит от конкретных колонок.
     *
     * Анализируются только строки с 16-битными машинными словами.
     */

    class ListingLine {
        constructor() {
            this.number = 0;
            this.address = 0;
            this.words = [];
            this.line = '';
            this.source = '';
            this.isData = false;
            this.raw = '';
        }

        get opcode() {
            return this.words.length > 0 ? this.words[0] : null;
        }
    }

    function checkIsDataLine(source) {
        if (!source) {
            return false;
        }

        /*
         * Убираем метку перед двоеточием.
         */
        let text = source.replace(
            /^\s*(?:[A-Za-z_.$][A-Za-z0-9_.$]*\s*:)?\s*/,
            ''
        );

        /*
         * Берём первое слово после возможной метки.
         */
        const match = text.match(/^([.@A-Za-z_][A-Za-z0-9_.$]*)/);

        if (!match) {
            return false;
        }

        const statement = match[1].toUpperCase();

        return (
            statement === '.WORD' ||
            statement === '.BYTE' ||
            statement === '.BLKW' ||
            statement === '.BLKB'
        );
    }

    function parseListing(text) {
        if (typeof text !== 'string') {
            return {
                lines: [],
                format: 'unknown',
                parsedLines: 0,
                instructionLines: 0
            };
        }

        const lines = [];
        const sourceLines = text.split(/\r?\n/);

        for (const raw of sourceLines) {
            if (!raw || !raw.trim()) {
                continue;
            }

            /*
             * Общая первая часть:
             *
             *     source-line-number
             *     address
             *     optional colon
             *
             * Адрес может быть длиннее 6 цифр, для БК нас интересует только 16 бит.
             *
             */
            const prefix = raw.match(
                /^\s*(\d+)\s+([0-7]+):?\s+(.*)$/
            );

            if (!prefix) {
                continue;
            }

            const lineNumber = parseInt(prefix[1], 10);
            const address = parseOctal(prefix[2]);

            if (address === null) {
                continue;
            }

            let rest = prefix[3];

            /*
             * Выделяем подряд идущие машинные слова.
             *
             * Для анализа нам нужны именно 6-7-значные восьмеричные
             * значения, то есть 16-битные PDP-11 words.
             */
            const words = [];

            while (true) {
                const m = rest.match(/^\s*([0-7]{6,7})(?:\s+|$)/);

                if (!m) {
                    break;
                }

                const word = parseOctal(m[1]);

                if (word === null) {
                    break;
                }

                words.push(word);
                rest = rest.slice(m[0].length);

                /*
                 * Больше пяти слов в одной строке для анализа не требуется.
                 */
                if (words.length >= 5) {
                    break;
                }
            }

            /*
             * Если 16-битных слов нет, это может быть:
             *
             * - строка данных;
             * - строка без машинного кода;
             * - заголовок;
             * - другой участок listing.
             *
             * Такие строки сохраняем только если после адреса
             * действительно есть исходный текст.
             */
            const source = rest.trim();

            const item = new ListingLine();

            item.number = lineNumber;
            item.address = address;
            item.words = words;
            item.source = source;
            item.line = source;
            item.raw = raw;
            item.isData = checkIsDataLine(source);

            /*
             * Иногда после машинных слов остаётся только пустота.
             * Это нормально.
             */
            lines.push(item);
        }

        /*
         * Определяем наличие LST
         */
        const instructionLines = lines.filter(
            line => line.words.length > 0 && !line.isData
        ).length;

        let format = 'unknown';

        if (instructionLines > 0) {
            /*
             * Формат LST у BKTurbo8 и MACRO-11
             * достаточно близок для общего анализатора
             */
            format = 'pdp11-lst';
        }

        return {
            lines,
            format,
            parsedLines: lines.length,
            instructionLines
        };
    }

    /*
     * ----------------------------------------------------------------------
     * OPCODE HELPERS
     * ----------------------------------------------------------------------
     */

    function isOpcodeBR(opcode) {
        return opcode !== null &&
            (opcode & 0xFF00) === 0x0100;
    }

    function getOffsetForBROpcode(opcode) {
        const low = opcode & 0xFF;

        if (low < 0x80) {
            return (low * 2) + 2;
        }

        return -((0x100 - low) * 2) + 2;
    }

    function isValidOffsetForBR(offset) {
        return (
            offset + 2 <= 0x0100 &&
            offset + 2 >= -0x00FE
        );
    }

    function isOpcodeJMP(opcode) {
        /*
         * 000167 JMP
         */
        return opcode === 0x0077;
    }

    function isOpcodeRETURN(opcode) {
        /*
         * 000207 RETURN
         */
        return opcode === 0x0087;
    }

    function isOpcodeCLR(opcode) {
        /*
         * CLR / CLRB Rx
         */
        return (opcode & 0x7FF8) === 0x0A00;
    }

    function isOpcodeMOVimm(opcode) {
        /*
         * MOV / MOVB #n,Rx
         */
        return (opcode & 0x7FF8) === 0x15C0;
    }

    function isOpcodeTST(opcode) {
        /*
         * TST / TSTB Rx
         */
        return (opcode & 0x7FF8) === 0x0BC0;
    }

    function isOpcodeINC(opcode) {
        /*
         * INC / INCB Rx
         */
        return (opcode & 0x7FF8) === 0x0A80;
    }

    function isOpcodeDEC(opcode) {
        /*
         * DEC / DECB Rx
         */
        return (opcode & 0x7FF8) === 0x0AC0;
    }

    function isOpcodeADDimm(opcode) {
        /*
         * ADD #n,Rx
         */
        return (opcode & 0xFFF8) === 0x65C0;
    }

    function isOpcodeSUBimm(opcode) {
        /*
         * SUB #n,Rx
         */
        return (opcode & 0xFFF8) === 0xE5C0;
    }

    function isOpcodeBICimm(opcode) {
        /*
         * BIC / BICB #n,Rx
         */
        return (opcode & 0x7FF8) === 0x45C0;
    }

    function isOpcodeBISimm(opcode) {
        /*
         * BIS / BISB #n,Rx
         */
        return (opcode & 0x7FF8) === 0x55C0;
    }

    function setsFlagsOnSameRegister(opcode) {
        return (
            isOpcodeCLR(opcode) ||
            isOpcodeMOVimm(opcode) ||
            isOpcodeINC(opcode) ||
            isOpcodeDEC(opcode) ||
            isOpcodeADDimm(opcode) ||
            isOpcodeSUBimm(opcode) ||
            isOpcodeBICimm(opcode) ||
            isOpcodeBISimm(opcode)
        );
    }

    function isOpcodeCondition(opcode) {
        if (opcode === null) {
            return false;
        }

        const opcodehi = opcode & 0xFF00;

        return (
            opcodehi === 0x0200 || // BNE
            opcodehi === 0x0300 || // BEQ
            opcodehi === 0x8000 || // BPL
            opcodehi === 0x8100 || // BMI
            opcodehi === 0x8400 || // BVC
            opcodehi === 0x8500 || // BVS
            opcodehi === 0x8600 || // BCC/BHIS
            opcodehi === 0x8700 || // BCS/BLO
            opcodehi === 0x0400 || // BGE
            opcodehi === 0x0500 || // BLT
            opcodehi === 0x0600 || // BGT
            opcodehi === 0x0700 || // BLE
            opcodehi === 0x8200 || // BHI
            opcodehi === 0x8300    // BLOS
        );
    }

    /*
     * SOB Rx,dest:
     *
     * 6-битное смещение.
     * Переход назад.
     * Максимум 63 слова = 126 байт.
     *
     * Логика сохранена из исходного C# анализатора.
     */
    function isValidOffsetForSOB(sobAddress, destAddress) {
        let delta = destAddress - sobAddress;

        /*
         * Имитация 16-битного знакового вычитания C#:
         *
         * (short)(ushort)(dest - sob)
         */
        if (delta > 32767) {
            delta -= 65536;
        }

        if (delta < -32768) {
            delta += 65536;
        }

        return delta <= 2 && delta >= -124;
    }

    /*
     * ----------------------------------------------------------------------
     * DIAGNOSTIC
     * ----------------------------------------------------------------------
     */

    function createDiagnostic(
        rule,
        message,
        line,
        line2 = null,
        file = null
    ) {
        const startLine = line && line.number
            ? line.number
            : 1;

        const endLine = line2 && line2.number
            ? line2.number
            : startLine;

        return {
            rule,
            severity: 'Warning',
            message,

            file,

            line: startLine,
            column: 1,

            endLine,
            endColumn: 1,

            address: line
                ? line.address
                : null,

            related: line2
                ? {
                    line: line2.number,
                    address: line2.address
                }
                : null
        };
    }

    /*
     * ----------------------------------------------------------------------
     * ANALYZER
     * ----------------------------------------------------------------------
     */

    class BKStaticAnalyzer {

        constructor() {
            this.version = VERSION;
        }

        analyze(listingText, options = {}) {
            const parsed = parseListing(listingText);

            const file = options.file || null;

            const lines = parsed.lines;

            /*
             * Быстрый индекс:
             *
             * address -> listing line
             */
            const linesByAddress = new Map();

            for (const line of lines) {
                if (!linesByAddress.has(line.address)) {
                    linesByAddress.set(line.address, line);
                }
            }

            const diagnostics = [];

            /*
             * ------------------------------------------------------------------
             * ОСНОВНОЙ ПРОХОД
             * ------------------------------------------------------------------
             */

            for (let index = 0; index < lines.length; index++) {

                const line = lines[index];

                /*
                 * Не анализируем строки без машинного слова.
                 */
                if (!line.words.length) {
                    continue;
                }

                /*
                 * Не анализируем данные.
                 */
                if (line.isData) {
                    continue;
                }

                const opcode = toUint16(line.words[0]);

                const prevLine = index > 0
                    ? lines[index - 1]
                    : null;

                const prevOpcode =
                    prevLine && prevLine.words.length
                        ? toUint16(prevLine.words[0])
                        : null;

                /*
                 * ==============================================================
                 * RULE 1
                 * CALL followed by RETURN
                 * ==============================================================
                 */

                if (isOpcodeRETURN(opcode)) {

                    if (prevOpcode === 0x09F7) {
                        diagnostics.push(
                            createDiagnostic(
                                'CALL_RETURN',
                                'CALL / RETURN можно заменить на JMP',
                                prevLine,
                                line,
                                file
                            )
                        );

                        continue;
                    }
                }

                /*
                 * ==============================================================
                 * RULES 2-6: JMP
                 * ==============================================================
                 */

                else if (isOpcodeJMP(opcode)) {

                    /*
                     * JMP адресуется следующим после себя словом.
                     *
                     * Формула сохранена из исходного анализатора:
                     *
                     * destination = address + offset-word + 4
                     */
                    if (line.words.length >= 2) {

                        const destAddress = toUint16(
                            line.address +
                            line.words[1] +
                            4
                        );

                        const offset =
                            destAddress - line.address;

                        /*
                         * RULE 2
                         */
                        if (destAddress === line.address + 4) {

                            diagnostics.push(
                                createDiagnostic(
                                    'JMP_NEXT',
                                    'JMP указывает на адрес сразу за собой, можно удалить',
                                    line,
                                    null,
                                    file
                                )
                            );

                            continue;
                        }

                        /*
                         * RULE 3
                         */
                        if (isValidOffsetForBR(offset)) {

                            diagnostics.push(
                                createDiagnostic(
                                    'JMP_SHORT',
                                    'JMP на коротком расстоянии, можно заменить на BR',
                                    line,
                                    null,
                                    file
                                )
                            );

                            continue;
                        }

                        /*
                         * Ищем инструкцию назначения.
                         */
                        const destLine =
                            linesByAddress.get(destAddress);

                        if (destLine) {

                            const destOpcode =
                                destLine.words.length
                                    ? toUint16(destLine.words[0])
                                    : null;

                            /*
                             * RULE 4
                             *
                             * JMP -> BR
                             */
                            if (isOpcodeBR(destOpcode)) {

                                diagnostics.push(
                                    createDiagnostic(
                                        'JMP_TO_BR',
                                        'JMP указывает на BR, можно заменить на прямой JMP',
                                        line,
                                        destLine,
                                        file
                                    )
                                );

                                continue;
                            }

                            /*
                             * RULE 5
                             *
                             * JMP -> JMP
                             */
                            if (isOpcodeJMP(destOpcode)) {

                                diagnostics.push(
                                    createDiagnostic(
                                        'JMP_TO_JMP',
                                        'JMP указывает на JMP, можно заменить на прямой JMP',
                                        line,
                                        destLine,
                                        file
                                    )
                                );

                                continue;
                            }

                            /*
                             * RULE 6
                             *
                             * JMP -> RETURN
                             */
                            if (isOpcodeRETURN(destOpcode)) {

                                diagnostics.push(
                                    createDiagnostic(
                                        'JMP_TO_RETURN',
                                        'JMP указывает на RETURN, можно заменить на прямой RETURN',
                                        line,
                                        destLine,
                                        file
                                    )
                                );

                                continue;
                            }
                        }
                    }
                }

                /*
                 * ==============================================================
                 * RULES 7-11: BR
                 * ==============================================================
                 */

                else if (isOpcodeBR(opcode)) {

                    const offset =
                        getOffsetForBROpcode(opcode);

                    const destAddress =
                        toUint16(line.address + offset);

                    const destLine =
                        linesByAddress.get(destAddress);

                    /*
                     * RULE 7
                     */
                    if (destAddress === line.address + 2) {

                        diagnostics.push(
                            createDiagnostic(
                                'BR_NEXT',
                                'BR указывает на адрес сразу за собой, можно удалить',
                                line,
                                null,
                                file
                            )
                        );

                        continue;
                    }

                    if (destLine) {

                        const destOpcode =
                            destLine.words.length
                                ? toUint16(destLine.words[0])
                                : null;

                        /*
                         * RULE 8
                         *
                         * Bxx immediately followed by BR.
                         */
                        if (
                            prevOpcode !== null &&
                            isOpcodeCondition(prevOpcode) &&
                            (prevOpcode & 0x00FF) === 0x0001
                        ) {

                            diagnostics.push(
                                createDiagnostic(
                                    'CONDITION_SKIP_BR',
                                    'Условный переход Bxx перепрыгивает через BR, можно заменить на инверсию условия',
                                    prevLine,
                                    line,
                                    file
                                )
                            );

                            continue;
                        }

                        /*
                         * RULE 9
                         *
                         * BR -> BR
                         */
                        if (isOpcodeBR(destOpcode)) {

                            const destAddress2 =
                                toUint16(
                                    destLine.address +
                                    getOffsetForBROpcode(destOpcode)
                                );

                            const destOffset =
                                destAddress2 - line.address;

                            if (isValidOffsetForBR(destOffset)) {

                                diagnostics.push(
                                    createDiagnostic(
                                        'BR_TO_BR',
                                        'BR указывает на BR, можно заменить на прямой BR',
                                        line,
                                        destLine,
                                        file
                                    )
                                );

                                continue;
                            }
                        }

                        /*
                         * RULE 10
                         *
                         * BR -> JMP
                         */
                        if (isOpcodeJMP(destOpcode)) {

                            if (destLine.words.length >= 2) {

                                const destAddress2 =
                                    toUint16(
                                        destLine.address +
                                        destLine.words[1] +
                                        4
                                    );

                                const destOffset =
                                    destAddress2 - line.address;

                                if (isValidOffsetForBR(destOffset)) {

                                    diagnostics.push(
                                        createDiagnostic(
                                            'BR_TO_JMP',
                                            'BR указывает на JMP, можно заменить на прямой BR',
                                            line,
                                            destLine,
                                            file
                                        )
                                    );

                                    continue;
                                }
                            }
                        }

                        /*
                         * RULE 11
                         *
                         * BR -> RETURN
                         */
                        if (isOpcodeRETURN(destOpcode)) {

                            diagnostics.push(
                                createDiagnostic(
                                    'BR_TO_RETURN',
                                    'BR указывает на RETURN, можно заменить на прямой RETURN',
                                    line,
                                    destLine,
                                    file
                                )
                            );

                            continue;
                        }
                    }
                }

                /*
                 * ==============================================================
                 * RULES 12-16: CONDITIONAL BRANCHES
                 * ==============================================================
                 */

                else if (isOpcodeCondition(opcode)) {

                    const offset =
                        getOffsetForBROpcode(opcode);

                    /*
                     * RULE 12
                     *
                     * Bxx -> itself
                     */
                    if (offset === 0) {

                        diagnostics.push(
                            createDiagnostic(
                                'CONDITION_SELF',
                                'Условный переход Bxx указывает сам на себя (бесконечный цикл)',
                                line,
                                null,
                                file
                            )
                        );

                        continue;
                    }

                    /*
                     * RULE 13
                     *
                     * Bxx -> next instruction
                     */
                    if (offset === 2) {

                        diagnostics.push(
                            createDiagnostic(
                                'CONDITION_NEXT',
                                'Условный переход Bxx указывает на следующую команду (бесполезно)',
                                line,
                                null,
                                file
                            )
                        );

                        continue;
                    }

                    /*
                     * RULE 14
                     *
                     * Bxx -> BR
                     */
                    const destAddressCond =
                        toUint16(line.address + offset);

                    const destLineCond =
                        linesByAddress.get(destAddressCond);

                    if (
                        destLineCond &&
                        destLineCond.words.length &&
                        isOpcodeBR(destLineCond.words[0])
                    ) {

                        const destAddress2 =
                            toUint16(
                                destLineCond.address +
                                getOffsetForBROpcode(
                                    destLineCond.words[0]
                                )
                            );

                        const destOffset =
                            destAddress2 - line.address;

                        if (isValidOffsetForBR(destOffset)) {

                            diagnostics.push(
                                createDiagnostic(
                                    'CONDITION_TO_BR',
                                    'Условный переход Bxx указывает на BR, можно заменить на прямой Bxx',
                                    line,
                                    destLineCond,
                                    file
                                )
                            );

                            continue;
                        }
                    }

                    /*
                     * RULE 15
                     *
                     * INC Rx / BNE backward
                     */
                    if (
                        (opcode & 0xFF00) === 0x0200 &&
                        prevOpcode !== null &&
                        (prevOpcode & 0xFFF8) === 0x0A80 &&
                        prevLine &&
                        isValidOffsetForSOB(
                            prevLine.address,
                            toUint16(line.address + offset)
                        )
                    ) {

                        diagnostics.push(
                            createDiagnostic(
                                'INC_BNE_SOB',
                                'INC Rx + BNE можно заменить на SOB Rx',
                                prevLine,
                                line,
                                file
                            )
                        );

                        continue;
                    }

                    /*
                     * RULE 16
                     *
                     * DEC Rx / BNE backward
                     */
                    if (
                        (opcode & 0xFF00) === 0x0200 &&
                        prevOpcode !== null &&
                        (prevOpcode & 0xFFF8) === 0x0AC0 &&
                        prevLine &&
                        isValidOffsetForSOB(
                            prevLine.address,
                            toUint16(line.address + offset)
                        )
                    ) {

                        diagnostics.push(
                            createDiagnostic(
                                'DEC_BNE_SOB',
                                'DEC Rx + BNE можно заменить на SOB Rx',
                                prevLine,
                                line,
                                file
                            )
                        );

                        continue;
                    }
                }

                /*
                 * ==============================================================
                 * RULE 17
                 *
                 * CLR Rx / MOV #n,Rx
                 * ==============================================================
                 */

                if (
                    prevOpcode !== null &&
                    isOpcodeCLR(prevOpcode) &&
                    isOpcodeMOVimm(opcode) &&
                    (prevOpcode & 0x0007) ===
                    (opcode & 0x0007)
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'CLR_DEAD',
                            'CLR Rx / MOV #n,Rx — CLR лишний (значение перезаписывается), можно удалить',
                            prevLine,
                            line,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 18
                 *
                 * TST Rx after instruction that already set flags.
                 * ==============================================================
                 */

                if (
                    isOpcodeTST(opcode) &&
                    prevOpcode !== null &&
                    setsFlagsOnSameRegister(prevOpcode) &&
                    (prevOpcode & 0x0007) ===
                    (opcode & 0x0007)
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'REDUNDANT_TST',
                            'TST Rx избыточен, флаги уже установлены предыдущей командой, можно удалить',
                            prevLine,
                            line,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 19
                 *
                 * MOV/MOVB #0,Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0x07FF8) === 0x15C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'MOV_ZERO_REGISTER',
                            'MOV/MOVB #0,Rx можно заменить на CLR Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 20
                 *
                 * MOV/MOVB #0,addr
                 * ==============================================================
                 */

                if (
                    (opcode & 0x7FC0) === 0x15C0 &&
                    (opcode & 0x0038) !== 0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'MOV_ZERO_MEMORY',
                            'MOV/MOVB #0,addr можно заменить на CLR/CLRB addr',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 21
                 *
                 * CMP/CMPB #0,Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0x07FF8) === 0x25C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'CMP_ZERO',
                            'CMP/CMPB #0,Rx можно заменить на TST Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 22
                 *
                 * BIS/BISB #0,Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0x07FF8) === 0x55C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'BIS_ZERO',
                            'BIS/BISB #0,Rx ничего не делает, можно удалить',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 23
                 *
                 * ADD #0,Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0xFFF8) === 0x65C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'ADD_ZERO',
                            'ADD #0,Rx ничего не делает, можно удалить',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 24
                 *
                 * SUB #0,Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0xFFF8) === 0xE5C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'SUB_ZERO',
                            'SUB #0,Rx ничего не делает, можно удалить',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 25
                 *
                 * ADD #1,Rx -> INC Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0xFFF8) === 0x65C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 1
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'ADD_ONE',
                            'ADD #1,Rx можно заменить на INC Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 26
                 *
                 * SUB #1,Rx -> DEC Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0xFFF8) === 0xE5C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 1
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'SUB_ONE',
                            'SUB #1,Rx можно заменить на DEC Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 27
                 *
                 * MOVB addr,Rx / BIC #177400,Rx
                 * ==============================================================
                 */

                if (
                    prevOpcode !== null &&
                    (prevOpcode & 0xF038) === 0x9000 &&
                    (opcode & 0xFFF8) === 0x45C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0xFF00
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'MOVB_BIC_HIGH',
                            'MOVB addr,Rx / BIC #177400,Rx можно заменить на CLR Rx / BIS addr,Rx',
                            prevLine,
                            line,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * ==============================================================
                 * RULE 28
                 *
                 * BIC #000377,Rx -> CLRB Rx
                 * ==============================================================
                 */

                if (
                    (opcode & 0xFFF8) === 0x45C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0x00FF
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'BIC_LOW_BYTE',
                            'BIC #000377,Rx можно заменить на CLRB Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }

                /*
                 * Дополнительное правило из исходного C#:
                 * BIC #177777,Rx -> CLR Rx
                 *
                 */
                if (
                    (opcode & 0x07FF8) === 0x45C0 &&
                    line.words.length >= 2 &&
                    line.words[1] === 0xFFFF
                ) {

                    diagnostics.push(
                        createDiagnostic(
                            'BIC_ALL_BITS',
                            'BIC #177777,Rx можно заменить на CLR Rx',
                            line,
                            null,
                            file
                        )
                    );

                    continue;
                }
            }

            return {
                success: true,
                version: VERSION,
                format: parsed.format,

                parsedLines: parsed.parsedLines,
                instructionLines: parsed.instructionLines,

                warnings: diagnostics.length,

                diagnostics
            };
        }
    }

    /*
     * ----------------------------------------------------------------------
     * PUBLIC API
     * ----------------------------------------------------------------------
     */
    const analyzer = new BKStaticAnalyzer();

    global.BKStaticAnalyzer = BKStaticAnalyzer;

    global.BKStaticAnalyzerVersion = VERSION;

    global.bkStaticAnalyzer = analyzer;

    /*
     * BKStaticAnalyzer.analyzeListing(text)
     */
    global.BKStaticAnalyzerAPI = {
        version: VERSION,

        parseListing,

        analyzeListing(listingText, options = {}) {
            return analyzer.analyze(listingText, options);
        },

        formatOctal,

        isOpcodeBR,
        isOpcodeJMP,
        isOpcodeRETURN,
        isOpcodeCondition
    };

})(typeof window !== 'undefined' ? window : this);
