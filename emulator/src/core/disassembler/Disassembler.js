/**
 * PDP-11/BK-0010 Disassembler
 * 
 * Converts binary machine code into human-readable assembly language.
 * Supports full PDP-11 instruction set used by BK-0010 computer.
 * 
 * Template placeholders:
 * - $d: destination operand
 * - $s: source operand
 * - $r: register operand
 * - $e: register (extended form)
 * - $b: branch offset (relative address)
 * - $o: SOB offset (backward branch)
 * - $m: MARK operand
 * - $t: trap/EMT operand
 * - $c: condition codes (N, Z, V, C flags)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
Disasm = {

  /**
   * CPU reference (set externally)
   */
  cpu: null,
  
  // ============================================================================
  // INSTRUCTION TEMPLATES
  // ============================================================================
  
  /**
   * Assembly instruction templates
   * Index corresponds to opcode type decoded by CPU
   * Placeholders ($d, $s, etc.) are replaced with actual operands during disassembly
   */
  /*String[]*/asmTpl: [
    // Special/invalid opcodes
    "Unknown",                    // 0: Unknown instruction
    "???",                        // 1: Invalid opcode
    "Dummy",                      // 2: Dummy placeholder
    
    // No-operand instructions
    "HALT",                       // 3: Halt CPU
    "WAIT",                       // 4: Wait for interrupt
    "RTI",                        // 5: Return from interrupt
    "BPT",                        // 6: Breakpoint trap
    "IOT",                        // 7: I/O trap
    "RESET",                      // 8: Reset external devices
    "RTT",                        // 9: Return from interrupt (trace)
    "START",                      // 10: Start (BK-specific)
    "S(TEP)",                     // 11: Step (BK-specific)
    
    // Single-operand instructions
    "JMP $d",                     // 12: Jump
    "RTS $r",                     // 13: Return from subroutine
    "SE$c",                       // 14: Set condition codes
    "CL$c",                       // 15: Clear condition codes
    "SWAB $d",                    // 16: Swap bytes
    
    // Branch instructions (conditional)
    "BR $b",                      // 17: Branch (unconditional)
    "BNE $b",                     // 18: Branch if Not Equal (Z=0)
    "BEQ $b",                     // 19: Branch if Equal (Z=1)
    "BGE $b",                     // 20: Branch if Greater or Equal (N xor V = 0)
    "BLT $b",                     // 21: Branch if Less Than (N xor V = 1)
    "BGT $b",                     // 22: Branch if Greater Than
    "BLE $b",                     // 23: Branch if Less or Equal
    
    // Two-operand and special instructions
    "JSR $e,$d",                  // 24: Jump to subroutine
    "CLR $d",                     // 25: Clear (word)
    "COM $d",                     // 26: Complement (word)
    "INC $d",                     // 27: Increment (word)
    "DEC $d",                     // 28: Decrement (word)
    "NEG $d",                     // 29: Negate (word)
    "ADC $d",                     // 30: Add carry (word)
    "SBC $d",                     // 31: Subtract carry (word)
    "TST $d",                     // 32: Test (word)
    "ROR $d",                     // 33: Rotate right (word)
    "ROL $d",                     // 34: Rotate left (word)
    "ASR $d",                     // 35: Arithmetic shift right (word)
    "ASL $d",                     // 36: Arithmetic shift left (word)
    "MARK $m",                    // 37: Mark stack
    "SXT $d",                     // 38: Sign extend
    
    // Two-operand instructions (word)
    "MOV $s,$d",                  // 39: Move (word)
    "CMP $s,$d",                  // 40: Compare (word)
    "BIT $s,$d",                  // 41: Bit test (word)
    "BIC $s,$d",                  // 42: Bit clear (word)
    "BIS $s,$d",                  // 43: Bit set (word)
    "ADD $s,$d",                  // 44: Add (word)
    "XOR $e,$d",                  // 45: Exclusive OR
    "SOB $e,$o",                  // 46: Subtract One and Branch
    
    // Additional branch instructions
    "BPL $b",                     // 47: Branch if Plus (N=0)
    "BMI $b",                     // 48: Branch if Minus (N=1)
    "BHI $b",                     // 49: Branch if Higher (C=0 and Z=0)
    "BLOS $b",                    // 50: Branch if Lower or Same (C=1 or Z=1)
    "BVC $b",                     // 51: Branch if oVerflow Clear (V=0)
    "BVS $b",                     // 52: Branch if oVerflow Set (V=1)
    "BCC $b",                     // 53: Branch if Carry Clear (C=0)
    "BCS $b",                     // 54: Branch if Carry Set (C=1)
    
    // Trap instructions
    "EMT $t",                     // 55: Emulator trap
    "TRAP $t",                    // 56: Trap
    
    // Single-operand instructions (byte)
    "CLRB $d",                    // 57: Clear (byte)
    "COMB $d",                    // 58: Complement (byte)
    "INCB $d",                    // 59: Increment (byte)
    "DECB $d",                    // 60: Decrement (byte)
    "NEGB $d",                    // 61: Negate (byte)
    "ADCB $d",                    // 62: Add carry (byte)
    "SBCB $d",                    // 63: Subtract carry (byte)
    "TSTB $d",                    // 64: Test (byte)
    "RORB $d",                    // 65: Rotate right (byte)
    "ROLB $d",                    // 66: Rotate left (byte)
    "ASRB $d",                    // 67: Arithmetic shift right (byte)
    "ASLB $d",                    // 68: Arithmetic shift left (byte)
    "MTPS $d",                    // 69: Move to processor status
    "MFPS $d",                    // 70: Move from processor status
    
    // Two-operand instructions (byte)
    "MOVB $s,$d",                 // 71: Move (byte)
    "CMPB $s,$d",                 // 72: Compare (byte)
    "BITB $s,$d",                 // 73: Bit test (byte)
    "BICB $s,$d",                 // 74: Bit clear (byte)
    "BISB $s,$d",                 // 75: Bit set (byte)
    "SUB $s,$d"                   // 76: Subtract (word)
  ],

  // ============================================================================
  // REGISTER NAMES
  // ============================================================================
  
  /**
   * PDP-11 register names
   * Indices 0-7 correspond to register numbers in instructions
   */
  /*String[]*/regnames: ["R0", "R1", "R2", "R3", "R4", "R5", "SP", "PC"],

  // ============================================================================
  // DISASSEMBLY FUNCTION
  // ============================================================================
  
  /**
   * Disassembles a single instruction at given address
   * @param {QBusProxy} mem - Memory interface for reading instruction bytes
   * @param {number} addr - Address of instruction to disassemble
   * @param {boolean} full - If true, include address and hex dump; if false, only mnemonic
   * @returns {string} Disassembled instruction text
   */
  /*String*/disasm: function(/*QBusProxy*/ mem, /*short*/addr, /*boolean*/full)
  {
    var /*StringBuilder*/ sb = "";
    var /*int*/immWordsNum = 0;           // Count of immediate operand words
    var /*short[]*/immWords = [0, 0];     // Storage for immediate operand values
    var /*QBusReadDTO*/ dto = new QBusReadDTO(-1);
    var A = this.asmTpl;

    // ---- PRINT ADDRESS (if full mode) ----
    if (full) {
      sb += addr.toString(8) + ": ";      // Address in octal
    }

    // ---- READ INSTRUCTION WORD ----
    if (!(mem.readWord(addr, dto))) {
      sb += "--- Unreadable memory location ---";
      return sb.toString(8);
    }
    var /*short*/insn = dto.value;

    // ---- PRINT INSTRUCTION HEX (if full mode) ----
    if (full) {
      sb += insn.toString(8) + "  ";      // Instruction in octal
    }

    // ---- DECODE INSTRUCTION ----
    var /*int*/op = cpu.get_opdec(insn & 0xFFFF);

    // ---- PROCESS TEMPLATE STRING ----
    // Parse template character by character, replacing placeholders with operands
    for (var /*int*/i = 0; i < A[op].length; ++i)
    {
      var /*char*/ c = A[op].charAt(i);

      // Copy literal characters, process placeholders ($x)
      if (c != '$') {
        sb += c;
      }
      else {
        // Get placeholder type
        c = A[op].charAt(++i);
        
        switch (c)
        {
        // ---- DESTINATION/SOURCE OPERAND ----
        case 'd':
        case 's':
          // Extract addressing mode (6 bits)
          // Bit layout: [deferred][mode][register]
          var /*int*/mode = ((c == 's') ? insn >>> 6 : insn >>> 0) & 0x3F;

          // Check for deferred (indirect) addressing: @ prefix
          if ((mode & 0x8) != 0)
          {
            sb += '@';
            mode -= 0x8;
          }
          
          var /*short*/imm;
          
          // ---- SPECIAL MODES: IMMEDIATE AND RELATIVE ----
          // Mode 23 (27 octal): #immediate - PC with autoincrement
          // Mode 55 (67 octal): relative - PC with index
          if ((mode == 23) || (mode == 55)) {
            if (mode == 23) {
              sb += '#';  // Immediate operand prefix
            }
            
            // Read immediate/offset word
            immWords[(immWordsNum++)] = -1;
            if (!(mem.readWord(/*(short)*/(addr + immWordsNum * 2) & 0xFFFF >>> 0, dto))) {
              sb += "(Immediate operand unreadable)";
            }
            else {
              imm = immWords[(immWordsNum - 1)] = dto.value;
              
              // For relative mode (67), calculate absolute address
              if (mode == 55) {
                imm = /*(short)*/(imm + addr + immWordsNum * 2 + 2) & 0xFFFF >>> 0;
              }
              
              sb += imm.toString(8);  // Print in octal
            }
          }
          // ---- REGISTER ADDRESSING MODES ----
          else
          {
            var /*String*/left, right;
            
            // Decode addressing mode bits [5:3]
            switch (mode & 0x38)
            {
            case 16:  // Mode 2: (Rn)+ - Register deferred with autoincrement
              left = "(";
              right = ")+";
              break;
              
            case 32:  // Mode 4: -(Rn) - Autodecrement register deferred
              left = "-(";
              right = ")";
              break;
              
            case 48:  // Mode 6: X(Rn) - Index (offset + register)
              left = "(";
              right = ")";
              
              // Read index/offset word
              immWords[(immWordsNum++)] = -1;
              if (!(mem.readWord(/*(short)*/(addr + immWordsNum * 2) & 0xFFFF >>> 0, dto))) {
                sb += "(Immediate operand unreadable)";
              }
              else {
                imm = immWords[(immWordsNum - 1)] = dto.value;
                sb += imm.toString(8);  // Print offset before register
              }
              break;
              
            default:  // Mode 0: Rn - Register direct
              left = "";
              right = "";
            }

            // Print register name with mode decorators
            sb += left + this.regnames[(mode & 0x7)] + right;
          }
          break;
        // ---- REGISTER OPERAND (bits 0-2) ----
        case 'r':
          sb += this.regnames[(insn & 0x7)];
          break;
          
        // ---- CONDITION CODE FLAGS ----
        case 'c':
          // Special case: if no flags set, it's a NOP
          if ((insn & 0xF) == 0) {
            sb = sb.substr(0, sb.length - 2) + "NOP";
          }
          else {
            // Print each flag that's set (N, Z, V, C)
            if ((insn & 0x8) != 0)
              sb += 'N';  // Negative
            if ((insn & 0x4) != 0)
              sb += 'Z';  // Zero
            if ((insn & 0x2) != 0)
              sb += 'V';  // Overflow
            if ((insn & 0x1) != 0)
              sb += 'C';  // Carry
          }
          break;
          
        // ---- BRANCH OFFSET (8-bit signed, relative to PC) ----
        case 'b':
          var v = insn & 0xFF >>> 0;
          if (v & 128) v -= 256;  // Convert to signed byte
          sb += (addr + 2 + (/*(byte)*/v * 2)).toString(8);
          break;
          
        // ---- SOB OFFSET (6-bit, backward branch) ----
        case 'o':
          sb += (addr + 2 - ((insn & 0x3F) * 2)).toString(8);
          break;
          
        // ---- EXTENDED REGISTER (bits 6-8) ----
        case 'e':
          sb += this.regnames[(insn >>> 6 & 0x7)];
          break;
          
        // ---- MARK OPERAND (6-bit immediate) ----
        case 'm':
          sb += (insn & 0x3F).toString(8);
          break;
          
        // ---- TRAP/EMT OPERAND (8-bit immediate) ----
        case 't':
          sb += (insn & 0xFF).toString(8);
          break;
          
        // ---- UNUSED PLACEHOLDERS ----
        case 'f':
        case 'g':
        case 'h':
        case 'i':
        case 'j':
        case 'k':
        case 'l':
        case 'n':
        case 'p':
        case 'q':
        default:
          sb += "(Unknown operand var '" + c + "' )";
        }
      }
    }

    // ---- PRINT IMMEDIATE OPERANDS (if full mode) ----
    if (full) {
      sb += ('\n');

      // Print each immediate word with its address
      for (i = 0; i < immWordsNum; ++i) {
        sb += ((addr + i * 2 + 2) & 0xFFFF >>> 0).toString(8) + ": " +
          immWords[i].toString(8) + '\n';
      }
    }

    return sb;
  },

  // ============================================================================
  // INSTRUCTION LENGTH CALCULATOR
  // ============================================================================
  
  /**
   * Calculates instruction length in words (16-bit units)
   * Used for stepping through code and calculating jump addresses
   * @param {QBusProxy} mem - Memory interface for reading instruction
   * @param {number} addr - Address of instruction
   * @returns {number} Length in words (1-3), or 0 if unreadable/invalid
   */
  /*int*/opmem_length: function(/*QBusProxy*/ mem, /*short*/addr)
  {
    var /*QBusReadDTO*/ dto = new QBusReadDTO(-1);
    var A = this.asmTpl;

    // ---- READ INSTRUCTION WORD ----
    if (!(mem.readWord(addr, dto))) {
      return 0;  // Unreadable memory
    }
    var /*short*/insn = dto.value;

    // ---- DECODE INSTRUCTION ----
    var /*int*/op = cpu.get_opdec(insn & 0xFFFF);

    // Invalid or special opcodes have no defined length
    if (op < 3) {
      return 0;
    }
    
    var /*int*/len = 1;  // Base instruction word

    // ---- COUNT ADDITIONAL WORDS ----
    // Parse template to find operands that require immediate/index words
    for (var /*int*/i = 0; i < A[op].length; ++i)
    {
      var /*char*/ c = A[op].charAt(i);

      if (c != '$')
        continue;  // Skip non-placeholder characters
        
      c = A[op].charAt(++i);
      
      switch (c)
      {
      case 'd':  // Destination operand
      case 's':  // Source operand
        // Extract addressing mode
        var /*int*/mode = ((c == 's') ? insn >>> 6 : insn) & 0x3F;

        // Modes that require an immediate word:
        // 23 (27 octal): immediate #n
        // 31 (37 octal): absolute @#n
        if ((mode == 23) || (mode == 31)) {
          ++len;
        } else {
          mode &= 56;  // Extract mode bits [5:3]
          
          // Modes that require an index/offset word:
          // 48 (60 octal): index X(Rn)
          // 56 (70 octal): index deferred @X(Rn)
          if ((mode == 48) || (mode == 56)) {
            ++len;
          }
        }
      }
    }

    return len;  // Total instruction length in words
  }
};

// End of Disasm module
