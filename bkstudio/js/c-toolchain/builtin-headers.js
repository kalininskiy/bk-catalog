/**
 * Встроенные системные файлы компоновки БК (CRT0 и Linker Script)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy
 */

export const BUILTIN_HEADERS = {};

export const CRT0_SOURCE = `\t.text
\t.globl _main, ___main, _start, ___stack_top
_start:
\tmov pc, sp
\tsub $4, sp
\tmov $01330, r0
\tmov r0, @$0177664
\tmov\t$_start,@$04
\tjsr\tpc, _main
\thalt

___main:
\trts\tpc

\t.globl\t___mulhi3
\t.globl\t__mulhi3
___mulhi3:
__mulhi3:
\tmov\tr2, -(sp)
\tclr\tr2
\tmov\t04(sp), r0
\tmov\t06(sp), r1
\ttst\tr0
\tbeq\t2f
1:
\tclc
\tror\tr0
\tbcc\t3f
\tadd\tr1, r2
3:
\tasl\tr1
\ttst\tr0
\tbne\t1b
2:
\tmov\tr2, r0
\tmov\t(sp)+, r2
\trts\tpc
`;

export const LDSCRIPT_SOURCE = `OUTPUT_FORMAT("a.out-pdp11")
ENTRY(_start)

bss_start = 040;
bss_end = 0320;
load_address = 01000;
ram_size = 040000;

MEMORY
{
    BSS (rw)    : ORIGIN = bss_start, LENGTH = bss_end - bss_start
    RAM (rwx)   : ORIGIN = load_address, LENGTH = ram_size - load_address
}

SECTIONS
{
    .text load_address :
    {
        *(.text)
        *(.text.*)
        *(.rodata)
        *(.rodata.*)
        . = ALIGN(2);
        _etext = .;
    } > RAM

    .data :
    {
        *(.data)
        *(.data.*)
        . = ALIGN(2);
        _edata = .;
    } > RAM

    .bss bss_start : AT(ADDR(.data) + SIZEOF(.data))
    {
        *(.bss)
        *(.bss.*)
        *(COMMON)
        . = ALIGN(2);
        _ebss = .;
    } > BSS

    /DISCARD/ :
    {
        *(.comment)
        *(.note)
    }
}
`;
