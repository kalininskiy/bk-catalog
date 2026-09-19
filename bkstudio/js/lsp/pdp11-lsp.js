/**
 * BKStudio - PDP-11 Language Support & LSP Module
 *
 * Based on pdp11-asm-lsp-server by Ivan "VDM" Kalininskiy
 * @link https://github.com/kalininskiy/pdp11-asm-lsp-server 
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function(global) {
  const DiagnosticSeverity = { Error: 1, Warning: 2, Information: 3, Hint: 4 };

  // --- instructions.js ---
  const exports_inst = {};
  (function(exports) {
"use strict";

exports.REGISTERS = exports.DIRECTIVES = exports.PDP11_INSTRUCTIONS = void 0;
/**
 * Массив режимов адресации
 */
const MEMORY_MODES = [
    "registerDeferred", // (Rn)    Register deferred
    "autoincrement", // (Rn)+   Autoincrement
    "autoincrementDeferred", // @(Rn)+  Autoincrement deferred
    "autodecrement", // -(Rn)   Autodecrement
    "autodecrementDeferred", // @-(Rn)  Autodecrement deferred
    "index", // X(Rn)   Index
    "indexDeferred", // @X(Rn)  Index deferred
    "absolute", // Absolute
    "symbol", // Symbolic
    "number", // Absolute number
];
/**
 * Предопределенные наборы разрешенных операндов для различных типов инструкций
 */
const ANY_DST = ["register", "immediate", ...MEMORY_MODES]; // Регистр может быть только источником, а не назначением в некоторых инструкциях, поэтому он не включается в ANY_SRC
const ANY_SRC = [...ANY_DST, "register", "immediate"]; // Источник может быть непосредственным значением, но назначение не может
const BRANCH_DST = ["symbol", "number"]; // Назначение для команд перехода должно быть меткой или числом
const JMP_DST = ["register", ...MEMORY_MODES]; // Назначение для команды JMP должно быть регистром или режимом адресации
/**
 * Таблица инструкций PDP-11 с их метаданными для валидации и предоставления информации в LSP-сервере
 */
exports.PDP11_INSTRUCTIONS = {
    MOV: {
        mnemonic: "MOV",
        description: "Move word source to destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    MOVB: {
        mnemonic: "MOVB",
        description: "Move byte source to destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    CMP: {
        mnemonic: "CMP",
        description: "Compare source and destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    CMPB: {
        mnemonic: "CMPB",
        description: "Compare byte source and destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    BIT: {
        mnemonic: "BIT",
        description: "Bit test",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BITB: {
        mnemonic: "BITB",
        description: "Bit test byte",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BIC: {
        mnemonic: "BIC",
        description: "Bit clear",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BICB: {
        mnemonic: "BICB",
        description: "Bit clear byte",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BIS: {
        mnemonic: "BIS",
        description: "Bit set",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BISB: {
        mnemonic: "BISB",
        description: "Bit set byte",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    ADD: {
        mnemonic: "ADD",
        description: "Add source to destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    SUB: {
        mnemonic: "SUB",
        description: "Subtract source from destination",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    MUL: {
        mnemonic: "MUL",
        description: "Multiply source by register pair",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ["register"],
        affects: ["N", "Z", "V", "C"],
        cycles: "20+",
    },
    DIV: {
        mnemonic: "DIV",
        description: "Divide register pair by source",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ["register"],
        affects: ["N", "Z", "V", "C"],
        cycles: "40+",
    },
    ASH: {
        mnemonic: "ASH",
        description: "Arithmetic shift register",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ["register"],
        affects: ["N", "Z", "V", "C"],
        cycles: "16+",
    },
    ASHC: {
        mnemonic: "ASHC",
        description: "Arithmetic shift register pair",
        operands: 2,
        allowedSrc: ANY_SRC,
        allowedDst: ["register"],
        affects: ["N", "Z", "V", "C"],
        cycles: "20+",
    },
    XOR: {
        mnemonic: "XOR",
        description: "Exclusive OR register with destination",
        operands: 2,
        allowedSrc: ["register"],
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "12+",
    },
    CLR: {
        mnemonic: "CLR",
        description: "Clear destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    CLRB: {
        mnemonic: "CLRB",
        description: "Clear destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    COM: {
        mnemonic: "COM",
        description: "Complement destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    COMB: {
        mnemonic: "COMB",
        description: "Complement destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    INC: {
        mnemonic: "INC",
        description: "Increment destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    INCB: {
        mnemonic: "INCB",
        description: "Increment destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    DEC: {
        mnemonic: "DEC",
        description: "Decrement destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    DECB: {
        mnemonic: "DECB",
        description: "Decrement destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    NEG: {
        mnemonic: "NEG",
        description: "Negate destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    NEGB: {
        mnemonic: "NEGB",
        description: "Negate destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ADC: {
        mnemonic: "ADC",
        description: "Add carry to destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ADCB: {
        mnemonic: "ADCB",
        description: "Add carry to destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    SBC: {
        mnemonic: "SBC",
        description: "Subtract carry from destination",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    SBCB: {
        mnemonic: "SBCB",
        description: "Subtract carry from destination byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    TST: {
        mnemonic: "TST",
        description: "Test destination",
        operands: 1,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    TSTB: {
        mnemonic: "TSTB",
        description: "Test destination byte",
        operands: 1,
        allowedDst: ANY_SRC,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ROR: {
        mnemonic: "ROR",
        description: "Rotate right through carry",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    RORB: {
        mnemonic: "RORB",
        description: "Rotate right byte through carry",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ROL: {
        mnemonic: "ROL",
        description: "Rotate left through carry",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ROLB: {
        mnemonic: "ROLB",
        description: "Rotate left byte through carry",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ASR: {
        mnemonic: "ASR",
        description: "Arithmetic shift right",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ASRB: {
        mnemonic: "ASRB",
        description: "Arithmetic shift right byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ASL: {
        mnemonic: "ASL",
        description: "Arithmetic shift left",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    ASLB: {
        mnemonic: "ASLB",
        description: "Arithmetic shift left byte",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V", "C"],
        cycles: "8+",
    },
    SWAB: {
        mnemonic: "SWAB",
        description: "Swap bytes in word",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    SXT: {
        mnemonic: "SXT",
        description: "Sign extend from N flag",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    JMP: {
        mnemonic: "JMP",
        description: "Jump to destination",
        operands: 1,
        allowedDst: JMP_DST,
        affects: [],
        cycles: "8+",
    },
    MARK: {
        mnemonic: "MARK",
        description: "Stack frame teardown",
        operands: 1,
        allowedDst: ["number", "symbol"],
        affects: [],
        cycles: "12",
    },
    MFPI: {
        mnemonic: "MFPI",
        description: "Move from previous instruction space",
        operands: 1,
        allowedDst: JMP_DST,
        affects: ["N", "Z", "V"],
        cycles: "16+",
    },
    MFPD: {
        mnemonic: "MFPD",
        description: "Move from previous data space",
        operands: 1,
        allowedDst: JMP_DST,
        affects: ["N", "Z", "V"],
        cycles: "16+",
    },
    MTPI: {
        mnemonic: "MTPI",
        description: "Move to previous instruction space",
        operands: 1,
        allowedDst: JMP_DST,
        affects: ["N", "Z", "V"],
        cycles: "16+",
    },
    MTPD: {
        mnemonic: "MTPD",
        description: "Move to previous data space",
        operands: 1,
        allowedDst: JMP_DST,
        affects: ["N", "Z", "V"],
        cycles: "16+",
    },
    MTPS: {
        mnemonic: "MTPS",
        description: "Move to processor status",
        operands: 1,
        allowedDst: ANY_SRC,
        affects: [],
        cycles: "8+",
    },
    MFPS: {
        mnemonic: "MFPS",
        description: "Move from processor status",
        operands: 1,
        allowedDst: ANY_DST,
        affects: ["N", "Z", "V"],
        cycles: "8+",
    },
    BR: {
        mnemonic: "BR",
        description: "Branch always",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BNE: {
        mnemonic: "BNE",
        description: "Branch if not equal",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BEQ: {
        mnemonic: "BEQ",
        description: "Branch if equal",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BGE: {
        mnemonic: "BGE",
        description: "Branch if greater or equal",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BLT: {
        mnemonic: "BLT",
        description: "Branch if less than",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BGT: {
        mnemonic: "BGT",
        description: "Branch if greater than",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BLE: {
        mnemonic: "BLE",
        description: "Branch if less or equal",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BPL: {
        mnemonic: "BPL",
        description: "Branch if plus",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BMI: {
        mnemonic: "BMI",
        description: "Branch if minus",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BHI: {
        mnemonic: "BHI",
        description: "Branch if higher",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BLOS: {
        mnemonic: "BLOS",
        description: "Branch if lower or same",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BVC: {
        mnemonic: "BVC",
        description: "Branch if overflow clear",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BVS: {
        mnemonic: "BVS",
        description: "Branch if overflow set",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BCC: {
        mnemonic: "BCC",
        description: "Branch if carry clear",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BCS: {
        mnemonic: "BCS",
        description: "Branch if carry set",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BHIS: {
        mnemonic: "BHIS",
        description: "Branch if higher or same",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    BLO: {
        mnemonic: "BLO",
        description: "Branch if lower",
        operands: 1,
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8",
    },
    JSR: {
        mnemonic: "JSR",
        description: "Jump to subroutine",
        operands: 2,
        allowedSrc: ["register"],
        allowedDst: MEMORY_MODES,
        affects: [],
        cycles: "12+",
    },
    RTS: {
        mnemonic: "RTS",
        description: "Return from subroutine",
        operands: 1,
        allowedDst: ["register"],
        affects: [],
        cycles: "10",
    },
    SOB: {
        mnemonic: "SOB",
        description: "Subtract one and branch",
        operands: 2,
        allowedSrc: ["register"],
        allowedDst: BRANCH_DST,
        affects: [],
        cycles: "8+",
    },
    EMT: {
        mnemonic: "EMT",
        description: "Emulator trap",
        operands: 1,
        allowedDst: ["number", "symbol"],
        affects: [],
        cycles: "48",
    },
    TRAP: {
        mnemonic: "TRAP",
        description: "Trap instruction",
        operands: 1,
        allowedDst: ["number", "symbol"],
        affects: [],
        cycles: "48",
    },
    HALT: {
        mnemonic: "HALT",
        description: "Stop processor",
        operands: 0,
        affects: [],
        cycles: "7",
    },
    WAIT: {
        mnemonic: "WAIT",
        description: "Wait for interrupt",
        operands: 0,
        affects: [],
        cycles: "7",
    },
    RTI: {
        mnemonic: "RTI",
        description: "Return from interrupt",
        operands: 0,
        affects: [],
        cycles: "20",
    },
    RTT: {
        mnemonic: "RTT",
        description: "Return from trap",
        operands: 0,
        affects: [],
        cycles: "20",
    },
    BPT: {
        mnemonic: "BPT",
        description: "Breakpoint trap",
        operands: 0,
        affects: [],
        cycles: "48",
    },
    IOT: {
        mnemonic: "IOT",
        description: "I/O trap",
        operands: 0,
        affects: [],
        cycles: "48",
    },
    RESET: {
        mnemonic: "RESET",
        description: "Reset external bus",
        operands: 0,
        affects: [],
        cycles: "8",
    },
    NOP: {
        mnemonic: "NOP",
        description: "No operation",
        operands: 0,
        affects: [],
        cycles: "8",
    },
    CLC: {
        mnemonic: "CLC",
        description: "Clear carry",
        operands: 0,
        affects: ["C"],
        cycles: "8",
    },
    CLV: {
        mnemonic: "CLV",
        description: "Clear overflow",
        operands: 0,
        affects: ["V"],
        cycles: "8",
    },
    CLZ: {
        mnemonic: "CLZ",
        description: "Clear zero",
        operands: 0,
        affects: ["Z"],
        cycles: "8",
    },
    CLN: {
        mnemonic: "CLN",
        description: "Clear negative",
        operands: 0,
        affects: ["N"],
        cycles: "8",
    },
    CCC: {
        mnemonic: "CCC",
        description: "Clear all condition codes",
        operands: 0,
        affects: ["N", "Z", "V", "C"],
        cycles: "8",
    },
    SEC: {
        mnemonic: "SEC",
        description: "Set carry",
        operands: 0,
        affects: ["C"],
        cycles: "8",
    },
    SEV: {
        mnemonic: "SEV",
        description: "Set overflow",
        operands: 0,
        affects: ["V"],
        cycles: "8",
    },
    SEZ: {
        mnemonic: "SEZ",
        description: "Set zero",
        operands: 0,
        affects: ["Z"],
        cycles: "8",
    },
    SEN: {
        mnemonic: "SEN",
        description: "Set negative",
        operands: 0,
        affects: ["N"],
        cycles: "8",
    },
    SCC: {
        mnemonic: "SCC",
        description: "Set all condition codes",
        operands: 0,
        affects: ["N", "Z", "V", "C"],
        cycles: "8",
    },
    CALL: {
        mnemonic: "CALL",
        description: "Call subroutine",
        operands: 1,
        allowedDst: JMP_DST,
        affects: [],
        cycles: "12+",
    },
    RET: {
        mnemonic: "RET",
        description: "Return from subroutine",
        operands: 0,
        affects: [],
        cycles: "10",
    },
    RETURN: {
        mnemonic: "RETURN",
        description: "Return from subroutine (RTS PC)",
        operands: 0,
        affects: [],
        cycles: "10",
    },
    PUSH: {
        mnemonic: "PUSH",
        description: "Push word onto stack (MOV src, -(SP))",
        operands: 1,
        allowedDst: ANY_SRC,
        affects: [],
        cycles: "8+",
    },
    PUSHB: {
        mnemonic: "PUSHB",
        description: "Push byte onto stack (MOVB src, -(SP))",
        operands: 1,
        allowedDst: ANY_SRC,
        affects: [],
        cycles: "8+",
    },
    POP: {
        mnemonic: "POP",
        description: "Pop word from stack (MOV (SP)+, dst)",
        operands: 1,
        allowedDst: ANY_DST,
        affects: [],
        cycles: "8+",
    },
    POPB: {
        mnemonic: "POPB",
        description: "Pop byte from stack (MOVB (SP)+, dst)",
        operands: 1,
        allowedDst: ANY_DST,
        affects: [],
        cycles: "8+",
    },
    HLT: {
        mnemonic: "HLT",
        description: "Halt processor (synonym of HALT)",
        operands: 0,
        affects: [],
        cycles: "12",
    },
    CALLR: {
        mnemonic: "CALLR",
        description: "Call subroutine relative",
        operands: 1,
        allowedDst: JMP_DST,
        affects: [],
        cycles: "12+",
    },
};
/**
 * Набор директив ассемблера для валидации и предоставления информации о них в LSP-сервере
 */
exports.DIRECTIVES = new Set([
    ".LA",
    ".LINK",
    ".WORD",
    ".BYTE",
    ".ORG",
    ".EVEN",
    ".PRINT",
    ".RAD50",
    ".RADIX",
    ".ADDR",
    ".FLT2",
    ".FLT4",
    ".INSERT",
    ".INCLUDE",
    ".ASCII",
    ".ASCIZ",
    ".BLKB",
    ".BLKW",
    ".MACRO",
    ".SCRIPT",
    ".ENDM",
    ".END",
    ".ENDS",
    "EQU",
    "=",
    ".TITLE",
    ".SBTTL",
    ".IDENT",
    ".PAGE",
    ".ENABL",
    ".DSABL",
    ".ASECT",
    ".CSECT",
    ".PSECT",
    "@INCLUDE",
    ".IF",
    ".ERROR",
    ".ENDC",
    ".REPT",
    ".ENDR",
    // Директивы PDPy11 с точкой
    ".REPEAT",
    ".EXTERN",
    ".DB",
    ".DW",
    ".DWORD",
    ".ODD",
    ".ALIGN",
    ".ONCE",
    ".CHARSET",
    ".ENCODING",
    ".INSERT_FILE",
    ".MAKE_BIN",
    ".MAKE_RAW",
    ".MAKE_WAV",
    ".MAKE_TURBO_WAV",
    ".MAKE_BK0010_ROM",
    // Метакоманды PDPy11 без точки
    "MAKE_BIN",
    "MAKE_RAW",
    "MAKE_WAV",
    "MAKE_TURBO_WAV",
    "MAKE_BK0010_ROM",
    "INSERT_FILE",
    "REPEAT",
    "EXTERN",
]);
/**
 * Набор регистров для валидации и предоставления информации о них в LSP-сервере
 */
exports.REGISTERS = new Set([
    "R0",
    "R1",
    "R2",
    "R3",
    "R4",
    "R5",
    "R6",
    "R7",
    "SP",
    "PC",
    "%0",
    "%1",
    "%2",
    "%3",
    "%4",
    "%5",
    "%6",
    "%7",
]);

  })(exports_inst);

  global.PDP11_INSTRUCTIONS = exports_inst.PDP11_INSTRUCTIONS;
  global.DIRECTIVES = exports_inst.DIRECTIVES;
  global.REGISTERS = exports_inst.REGISTERS;

  // --- tokenizer.js ---
  const exports_tok = {};
  (function(exports) {
"use strict";

exports.tokenizeLine = tokenizeLine;
/**
 * Токенизирует строку кода
 *
 * @param line Строка кода для токенизации
 * @returns Массив токенов
 */
function tokenizeLine(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (ch === ";") {
            tokens.push({ type: "comment", value: line.slice(i), start: i, end: line.length });
            break;
        }
        if (ch === ",") {
            tokens.push({ type: "comma", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === ":") {
            tokens.push({ type: "colon", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === "(") {
            tokens.push({ type: "lparen", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === ")") {
            tokens.push({ type: "rparen", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === "{") {
            tokens.push({ type: "lbrace", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === "}") {
            tokens.push({ type: "rbrace", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (/[#@+\-]/.test(ch)) {
            tokens.push({ type: "operator", value: ch, start: i, end: i + 1 });
            i++;
            continue;
        }
        if (ch === "\"") {
            const start = i;
            i++;
            while (i < line.length && line[i] !== "\"") {
                i++;
            }
            i = Math.min(i + 1, line.length);
            tokens.push({ type: "string", value: line.slice(start, i), start, end: i });
            continue;
        }
        if (/[.A-Za-z_]/.test(ch)) {
            const start = i;
            i++;
            while (i < line.length && /[A-Za-z0-9_.$]/.test(line[i])) {
                i++;
            }
            const value = line.slice(start, i);
            tokens.push({
                type: value.startsWith(".") ? "directive" : "identifier",
                value,
                start,
                end: i
            });
            continue;
        }
        if (/[0-9]/.test(ch)) {
            const start = i;
            i++;
            while (i < line.length && /[0-9]/.test(line[i])) {
                i++;
            }
            if (line[i] === ".") {
                i++;
            }
            tokens.push({ type: "number", value: line.slice(start, i), start, end: i });
            continue;
        }
        tokens.push({ type: "unknown", value: ch, start: i, end: i + 1 });
        i++;
    }
    return tokens;
}

  })(exports_tok);
  global.PDP11_TOKENIZER = exports_tok;

  // --- parser.js ---
  const exports_parser = {};
  (function(exports, vscode_languageserver_1, instructions_1) {
"use strict";

exports.parseProgram = parseProgram;


function range(line, start, end) {
    return { start: { line, character: start }, end: { line, character: end } };
}
const IDENTIFIER_RE = /^[A-Za-z_.$@?][A-Za-z0-9_.$@?]*$/;
const LOCAL_NUMERIC_RE = /^[0-9]+\$$/;
const NUMBER_RE = /^(?:[0-7]+|[0-9]+\.|0x[0-9a-fA-F]+)$/;
// Поддержка всех распространённых локальных меток (1:   1$:   10$:   .1:   @@1:  и т.д.)
const LABEL_RE = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+[$]?):/;
const EQU_RE = /^([A-Za-z_.$@?][A-Za-z0-9_.$@?]*|[0-9]+\$)\s+EQU\b(.*)$/i;
/**
 * Нормализует имя регистра
 *
 * @param reg Имя регистра
 * @returns Нормализованное имя регистра
 */
function normalizeRegister(reg) {
    const upper = reg.toUpperCase();
    if (upper.startsWith("%")) {
        const num = parseInt(upper.slice(1), 10);
        if (num >= 0 && num <= 7) {
            if (num === 6)
                return "SP";
            if (num === 7)
                return "PC";
            return `R${num}`;
        }
    }
    return upper;
}
/**
 * Проверяет, является ли текст символом
 *
 * @param text Текст для проверки
 * @returns
 */
function isSymbolToken(text) {
    return IDENTIFIER_RE.test(text) || LOCAL_NUMERIC_RE.test(text);
}
/**
 * Заменяет псевдонимы регистров на их реальные имена
 *
 * @param text Текст, в котором нужно заменить псевдонимы
 * @param registerAliases Карта псевдонимов регистров
 * @returns Текст с замененными псевдонимами
 */
function replaceAliases(text, registerAliases) {
    let result = text;
    for (const [alias, reg] of registerAliases) {
        // Replace whole words, case insensitive
        const regex = new RegExp(`\\b${alias}\\b`, "gi");
        result = result.replace(regex, reg);
    }
    return result;
}
/**
 * Парсит операнд и возвращает объект OperandNode
 *
 * @param text Текст операнда
 * @param line Номер строки
 * @param start Позиция начала операнда
 * @param registerAliases Карта псевдонимов регистров
 * @returns Объект OperandNode
 */
function parseOperand(text, line, start, registerAliases) {
    const trimmed = text.trim();
    const normalized = replaceAliases(trimmed, registerAliases);
    const upper = normalized.toUpperCase();
    const end = start + text.length;
    let kind = "unknown";
    let symbolName;
    let valueText;
    let register;
    const regPattern = "(R[0-7]|SP|PC|%[0-7])";
    // Распознавание строковых литералов в кавычках или с разделителями
    if (trimmed.length >= 2 && trimmed[0] === trimmed[trimmed.length - 1] && !/[a-zA-Z0-9<(\[\s]/.test(trimmed[0])) {
        return {
            text: trimmed,
            kind: "string",
            valueText: trimmed.slice(1, -1),
            range: { line, start, end }
        };
    }
    // Сначала проверяем специфические паттерны режимов адресации
    const extractValueReference = (value) => {
        const valueTrimmed = value.trim();
        valueText = valueTrimmed;
        if (isSymbolToken(valueTrimmed)) {
            symbolName = valueTrimmed;
        }
    };
    const absoluteMatch = trimmed.match(/^@#(.+)$/);
    if (absoluteMatch) {
        kind = "absolute";
        extractValueReference(absoluteMatch[1]);
    }
    else if (trimmed.startsWith("#")) {
        kind = "immediate";
        extractValueReference(trimmed.slice(1));
    }
    else if (trimmed.match(/^<[^>]+>$/)) {
        // Поддержка синтаксиса <выражение> для режима адресации
        kind = "absolute";
        extractValueReference(trimmed.slice(1, -1));
    }
    else if (trimmed.match(/^\[[^\]]+\]$/)) {
        // Поддержка синтаксиса [выражение] для режима адресации
        kind = "absolute";
        extractValueReference(trimmed.slice(1, -1));
    }
    else if (new RegExp(`^@-\\(${regPattern}\\)$`, "i").test(upper)) {
        kind = "autodecrementDeferred";
        register = normalizeRegister(upper.slice(3, -1));
    }
    else if (new RegExp(`^-\\(${regPattern}\\)$`, "i").test(upper)) {
        kind = "autodecrement";
        register = normalizeRegister(upper.slice(2, -1));
    }
    else if (new RegExp(`^@\\(${regPattern}\\)\\+$`, "i").test(upper)) {
        kind = "autoincrementDeferred";
        register = normalizeRegister(upper.slice(2, -2));
    }
    else if (new RegExp(`^\\(${regPattern}\\)\\+$`, "i").test(upper)) {
        kind = "autoincrement";
        register = normalizeRegister(upper.slice(1, -2));
    }
    else if (new RegExp(`^@\\(${regPattern}\\)$`, "i").test(upper)) {
        kind = "registerDeferred";
        register = normalizeRegister(upper.slice(2, -1));
    }
    else if (new RegExp(`^\\(${regPattern}\\)$`, "i").test(upper)) {
        kind = "registerDeferred";
        register = normalizeRegister(upper.slice(1, -1));
    }
    else {
        const indexDeferred = upper.match(new RegExp(`^@(.+)\\(${regPattern}\\)$`, "i"));
        if (indexDeferred) {
            kind = "indexDeferred";
            register = normalizeRegister(indexDeferred[2]);
            extractValueReference(indexDeferred[1]);
        }
        else {
            const index = upper.match(new RegExp(`^(.+)\\(${regPattern}\\)$`, "i"));
            if (index) {
                kind = "index";
                register = normalizeRegister(index[2]);
                extractValueReference(index[1]);
            }
            else if (instructions_1.REGISTERS.has(upper)) {
                kind = "register";
                register = normalizeRegister(upper);
            }
            else {
                // Поддержка любых выражений (индексные и косвенные)
                // Расширенная поддержка для символов с смещениями, локальных меток и других выражений
                // Сначала пробуем максимально общее выражение
                let match = trimmed.match(/^(@?#?)([A-Za-z0-9_.$@?][A-Za-z0-9_.$@?]*)(.*)$/i);
                if (match) {
                    const prefix = match[1];
                    const symbol = match[2];
                    const suffixAndOffsets = match[3].trim();
                    // Обработка операндов с префиксом
                    if (prefix === "@#") {
                        kind = "absolute";
                        symbolName = symbol;
                        valueText = suffixAndOffsets || undefined;
                        return {
                            text: trimmed,
                            kind,
                            symbolName,
                            valueText,
                            range: { line, start, end },
                        };
                    }
                    else if (prefix === "#") {
                        kind = "immediate";
                        // Поддержка символьных литералов (#'x) и масок (#^B...)
                        if (trimmed.match(/^#'(.*)$/)) {
                            valueText = trimmed.slice(2);
                        }
                        else if (trimmed.match(/^#\^[BOX]/i)) {
                            valueText = trimmed.slice(1);
                        }
                        else if (trimmed.match(/^\d+$/)) {
                            valueText = trimmed.slice(1);
                        }
                        else {
                            valueText = trimmed.slice(1);
                            symbolName = symbol;
                        }
                        return {
                            text: trimmed,
                            kind,
                            symbolName: symbol,
                            valueText,
                            range: { line, start, end },
                        };
                    }
                    else if (prefix === "@") {
                        // Проверяем регистр
                        const isRegisterName = new RegExp(`^${regPattern}$`, "i").test(symbol);
                        if (isRegisterName && !suffixAndOffsets) {
                            kind = "registerDeferred";
                            symbolName = undefined;
                            valueText = undefined;
                        }
                        else {
                            kind = "absolute";
                            symbolName = symbol;
                            valueText = suffixAndOffsets || undefined;
                        }
                        return {
                            text: trimmed,
                            kind,
                            symbolName,
                            valueText,
                            range: { line, start, end },
                        };
                    }
                    // Без префикса - это может быть символ, число, или регистр
                    if (instructions_1.REGISTERS.has(symbol.toUpperCase())) {
                        kind = "register";
                        register = normalizeRegister(symbol);
                    }
                    else if (NUMBER_RE.test(symbol)) {
                        // Это число в PDP-11 формате
                        kind = "number";
                        valueText = symbol;
                    }
                    else if (isSymbolToken(symbol)) {
                        // Это валидный символ (идентификатор или локальная метка)
                        kind = "symbol";
                        symbolName = symbol;
                        valueText = suffixAndOffsets || undefined;
                    }
                    else {
                        // Неизвестное выражение - оставляем как unknown
                        kind = "unknown";
                    }
                    return {
                        text: trimmed,
                        kind,
                        register,
                        symbolName,
                        valueText,
                        range: { line, start, end },
                    };
                }
                else if (isSymbolToken(normalized)) {
                    kind = "symbol";
                    symbolName = normalized;
                }
                else if (NUMBER_RE.test(normalized)) {
                    kind = "number";
                    valueText = normalized;
                }
            }
        }
    }
    return {
        text: trimmed,
        kind,
        register,
        symbolName,
        valueText,
        range: { line, start, end },
    };
}
/**
 * Разбивает строку с операндами на массив объектов, содержащих текст и позицию
 *
 * @param raw Строка с операндами
 * @returns Массив объектов, содержащих текст и позицию
 */
function splitOperands(raw, isStringDirective = false) {
    const result = [];
    let current = "";
    let parenDepth = 0; // Отслеживаем глубину круглых скобок ()
    let bracketDepth = 0; // Отслеживаем глубину квадратных скобок []
    let angleDepth = 0; // Отслеживаем глубину угловых скобок <>
    let braceDepth = 0; // Отслеживаем глубину фигурных скобок {}
    let inQuote = false;
    let quoteChar = null;
    let start = 0;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inQuote) {
            current += ch;
            if (ch === quoteChar) {
                inQuote = false;
                quoteChar = null;
            }
            continue;
        }
        if (current.trim().length === 0 && /\s/.test(ch)) {
            current += ch;
            continue;
        }
        if (ch === '"' || (isStringDirective && ch === "'")) {
            if (raw.indexOf(ch, i + 1) !== -1) {
                inQuote = true;
                quoteChar = ch;
                current += ch;
                continue;
            }
        }
        if (isStringDirective && current.trim().length === 0 && !/[a-zA-Z0-9<(\[\s,;:=]/.test(ch)) {
            if (raw.indexOf(ch, i + 1) !== -1) {
                inQuote = true;
                quoteChar = ch;
                current += ch;
                continue;
            }
        }
        if (ch === "(") {
            parenDepth++;
        }
        else if (ch === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
        }
        else if (ch === "[") {
            bracketDepth++;
        }
        else if (ch === "]") {
            bracketDepth = Math.max(0, bracketDepth - 1);
        }
        else if (ch === "<") {
            angleDepth++;
        }
        else if (ch === ">") {
            angleDepth = Math.max(0, angleDepth - 1);
        }
        else if (ch === "{") {
            braceDepth++;
        }
        else if (ch === "}") {
            braceDepth = Math.max(0, braceDepth - 1);
        }
        else if (ch === "," && parenDepth === 0 && bracketDepth === 0 && angleDepth === 0 && braceDepth === 0 && !inQuote) {
            result.push({ text: current, start });
            current = "";
            start = i + 1;
            continue;
        }
        current += ch;
    }
    if (current.trim().length > 0) {
        result.push({ text: current, start });
    }
    return result;
}
/**
 * Парсит программу на ассемблере PDP-11 из текста и возвращает структуру ProgramNode, содержащую массив операторов и диагностические сообщения
 *
 * @param text Текст программы на ассемблере PDP-11
 * @returns Структура ProgramNode
 */
function parseProgram(text) {
    const statements = [];
    const diagnostics = [];
    const lines = text.split(/\r?\n/);
    const knownMacros = new Set();
    const registerAliases = new Map();
    let inBlockComment = false; // Состояние для отслеживания многострочных комментариев /* ... */
    // Stack of open repetition/macro blocks (.MACRO or .REPT); top = last opened
    const blockStack = [];
    let inScript = false;
    let openScript;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const raw = lines[lineIndex];
        let codePart = raw;
        let comment = undefined;
        // Обработка строки с учётом состояния inBlockComment
        if (inBlockComment) {
            const blockEnd = raw.indexOf('*/');
            if (blockEnd !== -1) {
                // Комментарий заканчивается на этой строке
                comment = raw.slice(0, blockEnd + 2);
                codePart = raw.slice(blockEnd + 2);
                inBlockComment = false;
            }
            else {
                // Вся строка — часть многострочного комментария
                comment = raw;
                codePart = "";
            }
        }
        else {
            // Обычная строка (не внутри блочного комментария)
            // 1. Однострочный // 
            let pos = raw.indexOf('//');
            if (pos !== -1) {
                codePart = raw.slice(0, pos);
                comment = raw.slice(pos);
            }
            else {
                codePart = raw;
            }
            // 2. Начало блочного комментария /*
            pos = codePart.indexOf('/*');
            if (pos !== -1) {
                const blockEnd = codePart.indexOf('*/', pos + 2);
                if (blockEnd !== -1) {
                    // /* ... */ целиком на одной строке (inline)
                    if (comment)
                        comment += " " + codePart.slice(pos);
                    else
                        comment = codePart.slice(pos);
                    codePart = codePart.slice(0, pos);
                }
                else {
                    // Начало многострочного комментария
                    if (comment)
                        comment += " " + codePart.slice(pos);
                    else
                        comment = codePart.slice(pos);
                    codePart = codePart.slice(0, pos);
                    inBlockComment = true;
                }
            }
            // 3. Классический PDP-11 комментарий ;
            pos = codePart.indexOf(';');
            if (pos !== -1) {
                if (comment)
                    comment = codePart.slice(pos) + " " + (comment || "");
                else
                    comment = codePart.slice(pos);
                codePart = codePart.slice(0, pos);
            }
        }
        const code = codePart.trimEnd();
        const stmt = {
            line: lineIndex,
            operands: [],
            comment,
            raw,
            range: { line: lineIndex, start: 0, end: raw.length }
        };
        stmt.context = inScript ? "script" : "normal";
        let rest = code.trim();
        if (rest.length === 0) {
            statements.push(stmt);
            continue;
        }
        // 1. Поддержка одной или нескольких меток на одной строке
        const labels = [];
        let labelMatch;
        while ((labelMatch = rest.match(LABEL_RE))) {
            labels.push(labelMatch[1]);
            rest = rest.slice(labelMatch[0].length).trim();
            if (rest.length === 0) {
                // Все оставшиеся токены - это метки, сохраняем основную метку
                stmt.label = labels[0];
                // Для остальных меток создаём отдельные записи
                for (let i = 1; i < labels.length; i++) {
                    const labelStmt = {
                        line: lineIndex,
                        label: labels[i],
                        operands: [],
                        comment: undefined,
                        raw,
                        range: { line: lineIndex, start: 0, end: raw.length }
                    };
                    statements.push(labelStmt);
                }
                statements.push(stmt);
                continue;
            }
        }
        // Если были найдены метки, сохраняем первую и создаём записи для остальных
        if (labels.length > 0) {
            stmt.label = labels[0];
            for (let i = 1; i < labels.length; i++) {
                const labelStmt = {
                    line: lineIndex,
                    label: labels[i],
                    operands: [],
                    comment: undefined,
                    raw,
                    range: { line: lineIndex, start: 0, end: raw.length }
                };
                statements.push(labelStmt);
            }
        }
        // 2. Присваивание через = (например, symbol = 1234 или symbol = otherSymbol) + множественные на одной строке
        const assignRegex = /([A-Za-z_.$@?][A-Za-z0-9_.$@?]*)\s*=\s*([^=\s][^=]*?)(?=\s+[A-Za-z_.$@?][A-Za-z0-9_.$@?]*\s*=|\s*$)/gi;
        let assignMatch;
        let hasAnyAssignment = false;
        while ((assignMatch = assignRegex.exec(rest)) !== null) {
            const symbolName = assignMatch[1];
            const valueText = assignMatch[2].trim();
            const assignStmt = {
                ...stmt,
                label: symbolName,
                directive: "=",
                operands: valueText ? [parseOperand(valueText, lineIndex, 0, registerAliases)] : [],
                raw: rest
            };
            statements.push(assignStmt);
            hasAnyAssignment = true;
        }
        if (hasAnyAssignment) {
            continue; // все присваивания уже обработаны
        }
        // 3. EQU
        const equMatch = rest.match(EQU_RE);
        if (equMatch) {
            stmt.label = equMatch[1];
            stmt.directive = "EQU";
            const valueTail = equMatch[2].trim();
            if (valueTail.length > 0) {
                stmt.operands.push(parseOperand(valueTail, lineIndex, code.indexOf(valueTail), registerAliases));
            }
            else {
                diagnostics.push({
                    message: "EQU requires value",
                    severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                    range: range(lineIndex, 0, rest.length),
                });
            }
            statements.push(stmt);
            continue;
        }
        // 4. Check for register alias assignment: %0 = AX
        const aliasMatch = rest.match(/^(%[0-7])\s*=\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
        if (aliasMatch) {
            const reg = aliasMatch[1];
            const alias = aliasMatch[2].toUpperCase();
            registerAliases.set(alias, reg);
            statements.push(stmt); // Empty statement for alias
            continue;
        }

        // 5. Обработка строк с фигурными скобками { и } (для блоков .repeat)
        const trimmedRest = rest.trim();
        const hasOpenBrace = trimmedRest.includes("{");
        const hasCloseBrace = trimmedRest.includes("}");

        if (hasOpenBrace && hasCloseBrace) {
            // Однострочный блок: { ... } полностью на этой строке (например, .repeat 8 { rol r0 })
            // Не пушим в blockStack и не закрываем внешний блок
        } else if (hasOpenBrace) {
            // Открытие блока скобок на этой строке
            if (trimmedRest === "{" || trimmedRest.startsWith("{\t") || trimmedRest.startsWith("{ ")) {
                blockStack.push({ kind: "repeat_brace", name: ".REPEAT", startLine: lineIndex });
                const afterBrace = trimmedRest.slice(1).trim();
                if (!afterBrace) {
                    statements.push(stmt);
                    continue;
                }
                rest = afterBrace;
            }
        } else if (hasCloseBrace) {
            // Закрытие блока скобок
            if (blockStack.length > 0 && blockStack[blockStack.length - 1].kind === "repeat_brace") {
                blockStack.pop();
            }
            if (trimmedRest === "}") {
                statements.push(stmt);
                continue;
            }
            if (trimmedRest.endsWith("}")) {
                rest = trimmedRest.slice(0, -1).trim();
            }
        }

        const parts = rest.split(/\s+/, 2);
        const head = parts[0];
        const headUpper = head.toUpperCase();
        const tail = rest.slice(head.length).trim();
        const tailStart = code.indexOf(tail);
        if (headUpper === "EQU" && !stmt.label) {
            diagnostics.push({
                message: "EQU requires label before it",
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                range: range(lineIndex, 0, head.length),
            });
        }
        const PDPY11_NO_DOT_DIRECTIVES = new Set([
            "MAKE_BIN", "MAKE_RAW", "MAKE_WAV", "MAKE_TURBO_WAV", "MAKE_BK0010_ROM",
            "INSERT_FILE", "REPEAT", "EXTERN"
        ]);
        const isPdpyNoDot = PDPY11_NO_DOT_DIRECTIVES.has(headUpper);
        if (headUpper.startsWith(".") || headUpper === "EQU" || headUpper === "@INCLUDE" || isPdpyNoDot) {
            stmt.directive = headUpper;
            if (!instructions_1.DIRECTIVES.has(headUpper)) {
                diagnostics.push({
                    message: `Unknown directive '${head}'`,
                    severity: vscode_languageserver_1.DiagnosticSeverity.Warning,
                    range: range(lineIndex, 0, head.length),
                });
            }
            if (headUpper === ".REPEAT" || headUpper === "REPEAT") {
                stmt.directive = ".REPEAT";
                if (tail.includes("{") && !tail.includes("}")) {
                    blockStack.push({ kind: "repeat_brace", name: ".REPEAT", startLine: lineIndex });
                }
            }
            if (headUpper === ".EXTERN" || headUpper === "EXTERN") {
                stmt.directive = ".EXTERN";
                const extParts = tail.split(/[\s,]+/).filter(p => p.length > 0);
                for (const ep of extParts) {
                    stmt.operands.push({
                        text: ep,
                        kind: "symbol",
                        symbolName: ep,
                        valueText: ep,
                        range: {
                            line: lineIndex,
                            start: code.indexOf(tail),
                            end: code.indexOf(tail) + tail.length
                        }
                    });
                }
                statements.push(stmt);
                continue;
            }
            if (headUpper === ".INCLUDE" || headUpper === "@INCLUDE" ||
                headUpper === "INSERT_FILE" || headUpper === ".INSERT_FILE" ||
                headUpper === "MAKE_BIN" || headUpper === "MAKE_RAW" || headUpper === "MAKE_WAV" ||
                headUpper === "MAKE_TURBO_WAV" || headUpper === "MAKE_BK0010_ROM" ||
                headUpper === ".MAKE_BIN" || headUpper === ".MAKE_RAW" || headUpper === ".MAKE_WAV" ||
                headUpper === ".MAKE_TURBO_WAV" || headUpper === ".MAKE_BK0010_ROM") {
                if (headUpper === "@INCLUDE") stmt.directive = "@INCLUDE";
                const fileMatch = tail.match(/^(?:["']([^"']+)["']|(\S+))(?:\s*,\s*(?:["']([^"']+)["']|(\S+)))?/i);
                if (fileMatch) {
                    const arg1 = (fileMatch[1] || fileMatch[2] || '').trim();
                    if (arg1) {
                        stmt.operands.push({
                            text: arg1,
                            kind: "string",
                            valueText: arg1,
                            range: {
                                line: lineIndex,
                                start: code.indexOf(tail),
                                end: code.indexOf(tail) + tail.length
                            }
                        });
                    }
                    const arg2 = (fileMatch[3] || fileMatch[4] || '').trim();
                    if (arg2) {
                        stmt.operands.push({
                            text: arg2,
                            kind: "string",
                            valueText: arg2,
                            range: {
                                line: lineIndex,
                                start: code.indexOf(tail),
                                end: code.indexOf(tail) + tail.length
                            }
                        });
                    }
                }
                statements.push(stmt);
                continue;
            }
            if (headUpper === ".SCRIPT") {
                const scriptName = tail.split(/\s+/)[0];
                if (!scriptName) {
                    diagnostics.push({
                        message: ".SCRIPT requires a name",
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(lineIndex, 0, raw.length),
                    });
                }
                else {
                    inScript = true;
                    openScript = { name: scriptName, startLine: lineIndex };
                    stmt.directive = ".SCRIPT";
                    stmt.operands = [{
                            text: scriptName,
                            kind: "symbol",
                            symbolName: scriptName,
                            range: stmt.range,
                        }];
                }
                statements.push(stmt);
                continue;
            }
            if (headUpper === ".ENDS") {
                stmt.directive = ".ENDS";
                if (!inScript) {
                    diagnostics.push({
                        message: ".ENDS without matching .SCRIPT",
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(lineIndex, 0, head.length),
                    });
                }
                else {
                    inScript = false;
                    openScript = undefined;
                }
                statements.push(stmt);
                continue;
            }
            if (headUpper === ".MACRO") {
                const macroParts = tail.split(/\s+/).filter((p) => p.length > 0);
                if (macroParts.length === 0) {
                    diagnostics.push({
                        message: ".MACRO requires a macro name",
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(lineIndex, 0, raw.length),
                    });
                }
                else {
                    const macroName = macroParts[0];
                    knownMacros.add(macroName.toUpperCase());
                    blockStack.push({ kind: "macro", name: macroName, startLine: lineIndex });
                    stmt.macroDefinition = {
                        name: macroName,
                        parameters: macroParts.slice(1).map((p) => p.replace(/,$/, "")),
                        startLine: lineIndex,
                        endLine: lineIndex,
                    };
                }
            }
            else if (headUpper === ".REPT") {
                // .REPT opens a repetition block; closed by .ENDR or .ENDM
                blockStack.push({ kind: "rept", name: ".REPT", startLine: lineIndex });
            }
            else if (headUpper === ".ENDR") {
                // .ENDR closes the nearest open block (should be .REPT, but tolerate any)
                if (blockStack.length === 0) {
                    diagnostics.push({
                        message: ".ENDR without matching .REPT",
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(lineIndex, 0, head.length),
                    });
                }
                else {
                    const top = blockStack[blockStack.length - 1];
                    if (top.kind !== "rept") {
                        diagnostics.push({
                            message: ".ENDR closes a .REPT but found open .MACRO",
                            severity: vscode_languageserver_1.DiagnosticSeverity.Warning,
                            range: range(lineIndex, 0, head.length),
                        });
                    }
                    blockStack.pop();
                }
            }
            else if (headUpper === ".ENDM") {
                // .ENDM closes the nearest open block — either .MACRO or .REPT (MACRO-11 compatible)
                if (blockStack.length === 0) {
                    diagnostics.push({
                        message: ".ENDM without matching .MACRO or .REPT",
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(lineIndex, 0, head.length),
                    });
                }
                else {
                    const top = blockStack[blockStack.length - 1];
                    if (top.kind === "macro") {
                        stmt.macroDefinition = {
                            name: top.name,
                            parameters: [],
                            startLine: top.startLine,
                            endLine: lineIndex,
                        };
                    }
                    blockStack.pop();
                }
            }
        }
        else if (knownMacros.has(headUpper)) {
            stmt.macroInvocation = {
                name: head,
                arguments: [],
            };
        }
        else {
            stmt.opcode = headUpper;
        }
        if (tail.length > 0) {
            const isStringDirective = [
                ".ASCII", ".ASCIZ", ".RAD50", ".PACKED", ".TITLE", ".SBTTL", ".IDENT",
                "MAKE_BIN", "MAKE_RAW", "MAKE_WAV", "MAKE_TURBO_WAV", "MAKE_BK0010_ROM", "INSERT_FILE",
                ".MAKE_BIN", ".MAKE_RAW", ".MAKE_WAV", ".MAKE_TURBO_WAV", ".MAKE_BK0010_ROM", ".INSERT_FILE"
            ].includes(stmt.directive || "");
            for (const item of splitOperands(tail, isStringDirective)) {
                const operand = parseOperand(item.text, lineIndex, Math.max(0, tailStart) + item.start, registerAliases);
                stmt.operands.push(operand);
                if (stmt.macroInvocation) {
                    stmt.macroInvocation.arguments.push(operand);
                }
            }
        }
        statements.push(stmt);
    }
    for (const block of blockStack) {
        if (block.kind === "repeat_brace") {
            diagnostics.push({
                message: `Block '{' is not closed by '}'`,
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                range: range(block.startLine, 0, lines[block.startLine]?.length ?? 0),
            });
        } else {
            const directive = block.kind === "macro" ? ".MACRO" : ".REPT";
            diagnostics.push({
                message: `${directive} '${block.name}' is not terminated by .ENDM`,
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                range: range(block.startLine, 0, lines[block.startLine]?.length ?? 0),
            });
        }
    }
    if (openScript) {
        diagnostics.push({
            message: `.SCRIPT '${openScript.name}' is not terminated by .ENDS`,
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
            range: range(openScript.startLine, 0, lines[openScript.startLine]?.length ?? 0),
        });
    }
    return { statements, diagnostics };
}

  })(exports_parser, { DiagnosticSeverity }, exports_inst);
  global.PDP11_PARSER = exports_parser;

  // --- analyzer.js ---
  const exports_analyzer = {};
  (function(exports, vscode_languageserver_1, instructions_1) {
"use strict";

exports.analyzeProgram = analyzeProgram;


/**
 * Профили целевых платформ с их памятью и IO картой
 */
const TARGET_PROFILES = {
    "BK-0010": {
        name: "BK-0010",
        memoryMap: [
            { name: "RAM", start: 0o000000, end: 0o137777, kind: "RAM" },
            { name: "IO", start: 0o177400, end: 0o177777, kind: "IO" }
        ],
        ioMap: ["177560", "177564"]
    },
    "BK-0011M": {
        name: "BK-0011M",
        memoryMap: [
            { name: "RAM", start: 0o000000, end: 0o157777, kind: "RAM" },
            { name: "VideoRAM", start: 0o160000, end: 0o167777, kind: "VideoRAM" },
            { name: "IO", start: 0o177400, end: 0o177777, kind: "IO" }
        ],
        ioMap: ["177560", "177662"]
    },
    UKNC: {
        name: "UKNC",
        memoryMap: [
            { name: "RAM", start: 0o000000, end: 0o157777, kind: "RAM" },
            { name: "IO", start: 0o176000, end: 0o177777, kind: "IO" }
        ],
        ioMap: ["176640", "176646"]
    }
};
/**
 * Создает диапазон для диагностики
 *
 * @param line Номер строки
 * @param start Позиция начала
 * @param end Позиция окончания
 * @returns Объект диапазона
 */
function range(line, start, end) {
    return { start: { line, character: start }, end: { line, character: end } };
}
/**
 * Парсит число в формате PDP-11
 *
 * @param text Текст для парсинга
 * @returns Число или undefined
 */
function parsePdp11Number(text) {
    const clean = text.trim();
    if (/^[0-7]+$/.test(clean)) {
        return Number.parseInt(clean, 8);
    }
    if (/^[0-9]+\.$/.test(clean)) {
        return Number.parseInt(clean.slice(0, -1), 10);
    }
    if (/^0x[0-9a-f]+$/i.test(clean)) {
        return Number.parseInt(clean, 16);
    }
    return undefined;
}
/**
 * Нормализует ключ символа
 *
 * @param name Имя символа
 * @returns Нормализованное имя символа
 */
function normalizeSymbolKey(name) {
    return name.toUpperCase();
}
/**
 * Проверяет, является ли символ локальным
 *
 * @param name Имя символа
 * @returns true, если символ локальный, false в противном случае
 */
function isLocalSymbol(name) {
    return (name.startsWith(".") ||
        /^[0-9]+\$?$/.test(name) ||
        name.endsWith("$") ||
        name.startsWith("@@"));
}
/**
 * Создает отсканированное имя символа
 *
 * @param name Имя символа
 * @param scope Область видимости
 * @returns Отсканированное имя символа
 */
function makeScopedName(name, scope) {
    if (isLocalSymbol(name)) {
        return `${scope}::${normalizeSymbolKey(name)}`;
    }
    return normalizeSymbolKey(name);
}
/**
 * Извлекает кандидата на адрес
 *
 * @param op Операнд
 * @returns Кандидат на адрес или undefined
 */
function extractAddressCandidate(op) {
    if (op.kind === "immediate" || op.kind === "absolute" || op.kind === "number") {
        return op.valueText ?? op.text.replace(/^@?#/, "");
    }
    return undefined;
}
/**
 * Валидирует инструкцию
 *
 * @param meta Метаданные инструкции
 * @param line Номер строки
 * @param operandKinds Массив типов операндов
 * @returns Массив диагностики
 */
function validateInstruction(meta, line, operandKinds) {
    const diagnostics = [];
    // Специальные исключения для некоторых инструкций, которые могут принимать нестандартные операнды
    const opcode = meta.mnemonic;
    if (opcode === "DEC" || opcode === "INC" || opcode === "CLR" || opcode === "COM" || opcode === "NEG") {
        // Разрешаем immediate как destination для этих инструкций
        if (operandKinds.length === 1 && operandKinds[0] === "immediate") {
            return []; // считаем валидным
        }
    }
    if (operandKinds.length !== meta.operands) {
        diagnostics.push({
            message: `${meta.mnemonic} expects ${meta.operands} operand(s), got ${operandKinds.length}`,
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
            range: range(line, 0, meta.mnemonic.length)
        });
        return diagnostics;
    }
    if (meta.operands === 1 && meta.allowedDst && !meta.allowedDst.includes(operandKinds[0])) {
        diagnostics.push({
            message: `Invalid operand mode '${operandKinds[0]}' for ${meta.mnemonic}`,
            severity: vscode_languageserver_1.DiagnosticSeverity.Error,
            range: range(line, 0, meta.mnemonic.length)
        });
    }
    if (meta.operands === 2) {
        if (meta.allowedSrc && !meta.allowedSrc.includes(operandKinds[0])) {
            diagnostics.push({
                message: `Invalid source operand mode '${operandKinds[0]}' for ${meta.mnemonic}`,
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                range: range(line, 0, meta.mnemonic.length)
            });
        }
        if (meta.allowedDst && !meta.allowedDst.includes(operandKinds[1])) {
            diagnostics.push({
                message: `Invalid destination operand mode '${operandKinds[1]}' for ${meta.mnemonic}`,
                severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                range: range(line, 0, meta.mnemonic.length)
            });
        }
    }
    return diagnostics;
}
/**
 * Анализирует программу
 *
 * @param program Программа
 * @param uri URI файла
 * @param targetProfileName Имя целевого профиля
 * @param includeSymbols Карта символов из включённых файлов
 * @param includeMacros Карта макросов из включённых файлов
 * @returns Результат анализа
 */
function analyzeProgram(program, uri, targetProfileName, includeSymbols, includeMacros) {
    const symbols = new Map();
    const diagnostics = [...program.diagnostics];
    const target = TARGET_PROFILES[targetProfileName] ?? TARGET_PROFILES["BK-0010"];
    const macroSignatures = new Map(includeMacros || []);
    // Проверяем наличие INCLUDE директив
    const hasIncludeDirectives = program.statements.some(stmt => (stmt.directive?.toUpperCase() === ".INCLUDE" || stmt.directive?.toUpperCase() === "@INCLUDE"));
    let hasExternAll = false;
    // Добавляем встроенные символы (текущий адрес)
    symbols.set(".", {
        name: ".",
        displayName: ".",
        kind: "label",
        line: 0,
        uri
    });
    let currentScope = "__FILE__";
    for (const stmt of program.statements) {
        if (stmt.context === "script")
            continue;
        if (stmt.label && !isLocalSymbol(stmt.label)) {
            currentScope = normalizeSymbolKey(stmt.label);
        }
        if (stmt.label) {
            const key = makeScopedName(stmt.label, currentScope);
            symbols.set(key, {
                name: key,
                displayName: stmt.label,
                kind: "label",
                line: stmt.line,
                scope: currentScope,
                uri
            });
        }
        if ((stmt.directive === "EQU" || stmt.directive === "=") && stmt.label) {
            const key = makeScopedName(stmt.label, currentScope);
            symbols.set(key, {
                name: key,
                displayName: stmt.label,
                kind: "equ",
                line: stmt.line,
                scope: currentScope,
                valueText: stmt.operands[0]?.text,
                uri
            });
        }
        if (stmt.directive === ".MACRO" && stmt.macroDefinition) {
            const macroName = normalizeSymbolKey(stmt.macroDefinition.name);
            symbols.set(macroName, {
                name: macroName,
                displayName: stmt.macroDefinition.name,
                kind: "macro",
                line: stmt.line,
                uri
            });
            macroSignatures.set(macroName, stmt.macroDefinition.parameters.length);
        }
        if ((stmt.directive === ".EXTERN" || stmt.directive === "EXTERN") && stmt.operands) {
            for (const op of stmt.operands) {
                const sym = (op.symbolName || op.text || '').replace(/^@+/, '').trim();
                if (sym.toLowerCase() === 'all') {
                    hasExternAll = true;
                } else if (sym) {
                    const key = normalizeSymbolKey(sym);
                    symbols.set(key, {
                        name: key,
                        displayName: sym,
                        kind: "label",
                        line: stmt.line,
                        scope: "__FILE__",
                        uri
                    });
                }
            }
        }
    }
    let inMacroBody = false;
    currentScope = "__FILE__";
    for (const stmt of program.statements) {
        if (stmt.context === "script")
            continue;
        if (stmt.directive === ".MACRO") {
            inMacroBody = true;
        }
        else if (stmt.directive === ".ENDM") {
            inMacroBody = false;
            continue;
        }
        if (stmt.label && !isLocalSymbol(stmt.label)) {
            currentScope = normalizeSymbolKey(stmt.label);
        }
        if (stmt.opcode) {
            const maybeMacro = macroSignatures.get(normalizeSymbolKey(stmt.opcode));
            if (maybeMacro !== undefined) {
                if (stmt.operands.length !== maybeMacro) {
                    diagnostics.push({
                        message: `Macro '${stmt.opcode}' expects ${maybeMacro} argument(s), got ${stmt.operands.length}`,
                        severity: vscode_languageserver_1.DiagnosticSeverity.Error,
                        range: range(stmt.line, 0, stmt.opcode.length)
                    });
                }
            }
            else {
                const meta = instructions_1.PDP11_INSTRUCTIONS[stmt.opcode];
                if (!meta) {
                    diagnostics.push({
                        message: `Unknown instruction '${stmt.opcode}'`,
                        severity: vscode_languageserver_1.DiagnosticSeverity.Warning,
                        range: range(stmt.line, 0, stmt.opcode.length)
                    });
                }
                else {
                    diagnostics.push(...validateInstruction(meta, stmt.line, stmt.operands.map((o) => o.kind)));
                }
            }
        }
        if (stmt.directive && !instructions_1.DIRECTIVES.has(stmt.directive)) {
            diagnostics.push({
                message: `Unsupported directive '${stmt.directive}'`,
                severity: vscode_languageserver_1.DiagnosticSeverity.Warning,
                range: range(stmt.line, 0, stmt.directive.length)
            });
        }
        if (inMacroBody) {
            continue;
        }
        for (const op of stmt.operands) {
            if (op.symbolName) {
                // Пропускаем проверку для текущего адреса
                if (op.symbolName === ".") {
                    continue;
                }
                // Пропускаем скобки { и }
                if (op.symbolName === "{" || op.symbolName === "}" || op.text === "{" || op.text === "}") {
                    continue;
                }
                // Не показываем ошибку для имён файлов в INCLUDE директивах
                if (op.symbolName && (stmt.directive?.toUpperCase() === ".INCLUDE" || stmt.directive?.toUpperCase() === "@INCLUDE")) {
                    continue;
                }
                // Не показываем ошибку для имён в .script
                if (op.symbolName && stmt.directive?.toUpperCase() === ".SCRIPT") {
                    continue;
                }
                // Не показываем ошибку для строковых литералов
                if (op.kind === "string" || op.kind === "literal") {
                    continue;
                }
                // Не показываем ошибку для аргументов директив, которые не являются символами данных
                const NO_SYM_CHECK = [
                    ".TITLE", ".SBTTL", ".IDENT", ".PAGE", ".LIST", ".NLIST",
                    ".ENABL", ".DSABL", ".IF", ".ERROR", ".ASCII", ".ASCIZ", ".RAD50", ".PACKED", ".PRINT",
                    ".EXTERN", "EXTERN", ".CHARSET", ".ENCODING", ".ONCE",
                    "MAKE_BIN", "MAKE_RAW", "MAKE_WAV", "MAKE_TURBO_WAV", "MAKE_BK0010_ROM", "INSERT_FILE",
                    ".MAKE_BIN", ".MAKE_RAW", ".MAKE_WAV", ".MAKE_TURBO_WAV", ".MAKE_BK0010_ROM", ".INSERT_FILE",
                    ".REPEAT", "REPEAT"
                ];
                if (op.symbolName && NO_SYM_CHECK.includes(stmt.directive?.toUpperCase() || "")) {
                    continue;
                }
                if (hasExternAll) {
                    continue;
                }
                const rawSymbol = op.symbolName.replace(/^@+/, "");
                const isRegisterRef = /^(r[0-7]|sp|pc|%[0-7])$/i.test(rawSymbol);
                if (isRegisterRef) {
                    continue;
                }
                const symbolKey = makeScopedName(rawSymbol, currentScope);
                const globalKey = normalizeSymbolKey(rawSymbol);
                // Проверяем в символах текущего файла и во включённых файлах
                const foundInLocal = symbols.has(symbolKey) || symbols.has(globalKey);
                const foundInIncluded = includeSymbols && (includeSymbols.has(symbolKey) || includeSymbols.has(globalKey));
                if (!foundInLocal && !foundInIncluded) {
                    const severity = hasIncludeDirectives ? vscode_languageserver_1.DiagnosticSeverity.Information : vscode_languageserver_1.DiagnosticSeverity.Error;
                    diagnostics.push({
                        message: hasIncludeDirectives
                            // ? `Symbol '${op.symbolName}' may be defined in included module`
                            ? ``
                            : `Unresolved symbol '${op.symbolName}'`,
                        severity,
                        range: range(op.range.line, op.range.start, op.range.end)
                    });
                }
            }
            const candidate = extractAddressCandidate(op);
            if (candidate && stmt.directive === ".ORG") {
                const value = parsePdp11Number(candidate);
                if (value !== undefined) {
                    const inMap = target.memoryMap.some((m) => value >= m.start && value <= m.end);
                    if (!inMap) {
                        diagnostics.push({
                            message: `Address ${candidate} is outside memory map of ${target.name}`,
                            severity: vscode_languageserver_1.DiagnosticSeverity.Warning,
                            range: range(op.range.line, op.range.start, op.range.end)
                        });
                    }
                }
            }
        }
    }
    return { symbols, diagnostics, macros: macroSignatures };
}

  })(exports_analyzer, { DiagnosticSeverity }, exports_inst);
  global.PDP11_ANALYZER = exports_analyzer;

  global.PDP11_SNIPPETS = {
  "Startup Code": {
    "prefix": "pdp-hello",
    "body": [
      "\tEMT\t#14",
      "\tMOV\t#HELLO,R1",
      "\tCLR\tR2",
      "\tEMT\t20",
      "STOP:\tHALT",
      "HELLO:\t.ASCIZ \"Hello World!\"",
      "\t.END"
    ],
    "description": "Minimal startup sequence"
  },
  "Startup Code lowercase": {
    "prefix": "pdp-hello-lowercase",
    "body": [
      "\temt\t14",
      "\tmov\t#hello,r1",
      "\tclr\tr2",
      "\temt\t20",
      "STOP:\thalt",
      "HELLO:\t.ASCIZ \"Hello World!\"",
      "\t.end"
    ],
    "description": "Minimal startup sequence"
  },
  "Push Register": {
    "prefix": "pdp-pushr",
    "body": [
      "MOV\tR${1:0}, -(SP)",
      "",
      "MOV\t(SP)+, R${1:0}"
    ],
    "description": "Push one register to stack"
  },
  "Push Register lowercase": {
    "prefix": "pdp-pushr-lowercase",
    "body": [
      "mov\tR${1:0}, -(SP)",
      "",
      "mov\t(SP)+, R${1:0}"
    ],
    "description": "Push one register to stack"
  },
  "Push All Registers": {
    "prefix": "pdp-pushall",
    "body": [
      "MOV\tR0, -(SP)",
      "MOV\tR1, -(SP)",
      "MOV\tR2, -(SP)",
      "MOV\tR3, -(SP)",
      "MOV\tR4, -(SP)",
      "MOV\tR5, -(SP)",
      "${1}",
      "MOV\t(SP)+, R5",
      "MOV\t(SP)+, R4",
      "MOV\t(SP)+, R3",
      "MOV\t(SP)+, R2",
      "MOV\t(SP)+, R1",
      "MOV\t(SP)+, R0"
    ],
    "description": "Push common working registers"
  },
  "Push All Registers lowercase": {
    "prefix": "pdp-pushall-lowercase",
    "body": [
      "mov\tR0, -(SP)",
      "mov\tR1, -(SP)",
      "mov\tR2, -(SP)",
      "mov\tR3, -(SP)",
      "mov\tR4, -(SP)",
      "mov\tR5, -(SP)",
      "${1}",
      "mov\t(SP)+, R5",
      "mov\t(SP)+, R4",
      "mov\t(SP)+, R3",
      "mov\t(SP)+, R2",
      "mov\t(SP)+, R1",
      "mov\t(SP)+, R0"
    ],
    "description": "Push common working registers"
  },
  "Subroutine Template": {
    "prefix": "pdp-subr",
    "body": [
      "; subroutine ${1:SUBR_NAME}",
      "${1:SUBR_NAME}:",
      "\tMOV\tR5, -(SP)",
      "\tMOV\tSP, R5",
      "\t; body",
      "\tMOV\t(SP)+, R5",
      "\tRTS\tPC",
      "; end subroutine ${1:SUBR_NAME}"
    ],
    "description": "Subroutine with frame setup"
  },
  "Subroutine Template lowercase": {
    "prefix": "pdp-subr-lowercase",
    "body": [
      "; subroutine ${1:SUBR_NAME}",
      "${1:SUBR_NAME}:",
      "\tmov\tR5, -(SP)",
      "\tmov\tSP, R5",
      "\t; body",
      "\tmov\t(SP)+, R5",
      "\trts\tPC",
      "; end subroutine ${1:SUBR_NAME}"
    ],
    "description": "Subroutine with frame setup"
  },
  "EMT20 Template": {
    "prefix": "pdp-emt20",
    "body": [
      "MOV\t${1:#String}, R1",
      "CLR\tR2",
      "EMT\t20"
    ],
    "description": "EMT 20 call with string argument"
  },
  "EMT20 Template lowercase": {
    "prefix": "pdp-emt20-lowercase",
    "body": [
      "mov\t${1:#String}, R1",
      "clr\tR2",
      "emt\t20"
    ],
    "description": "EMT 20 call with string argument"
  },
  "SOB LOOP Template": {
    "prefix": "pdp-loop-sobr",
    "body": [
      "\tMOV\t$#{1:10}, R${2:0}",
      "${3:LOOP_LABEL}:",
      "\t; loop body",
      "\tSOB\tR${2:0}, ${3:LOOP_LABEL}"
    ],
    "description": "SOB loop template"
  },
  "SOB LOOP Template lowercase": {
    "prefix": "pdp-loop-sobr-lowercase",
    "body": [
      "\tmov\t#${1:10}, R${2:0}",
      "${3:LOOP_LABEL}:",
      "\t; loop body",
      "\tsob\tR${2:0}, ${3:LOOP_LABEL}"
    ],
    "description": "SOB loop template"
  },
  "Intercept vector 4 Template": {
    "prefix": "pdp-vec4",
    "body": [
      "\tMOV\t#161716, @#2",
      "\tMOV\t#2, @#4",
      "\t"
    ],
    "description": "Intercept vector 4 template"
  },
  "Intercept vector 4 Template lowercase": {
    "prefix": "pdp-vec4-lowercase",
    "body": [
      "\tmov\t#161716, @#2",
      "\tmov\t#2, @#4",
      "\t"
    ],
    "description": "Intercept vector 4 template"
  },
  "BK11 Stop block Template": {
    "prefix": "pdp-block-STOP",
    "body": [
      "\tMOV\t#10200, @#177716\t;block STOP key",
      "\t; programm body",
      "\tMOV\t#200, @#4\t\t;unblock STOP key"
    ],
    "description": "BK11 Stop block template"
  },
  "BK11 Stop block Template lowercase": {
    "prefix": "pdp-block-STOP-lowercase",
    "body": [
      "\tmov\t#10200, @#177716\t;block STOP key",
      "\t; programm body",
      "\tmov\t#200, @#4\t\t;unblock STOP key"
    ],
    "description": "BK11 Stop block template"
  }
}
;

  console.log('[BKStudio LSP] PDP-11 Language Support initialized.');
})(typeof window !== 'undefined' ? window : global);
