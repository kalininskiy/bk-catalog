/**
 * BK-0010/0011 System Registers
 * 
 * Emulates read-only system identification registers.
 * These registers provide hardware configuration and model information.
 * 
 * Memory Map (octal addresses):
 * - 177660 (65472): System register 1 - Model identification
 * - 177662 (65474): System register 2 - Configuration bits
 * - 177664 (65476): System register 3 - Additional flags
 * 
 * Register Values:
 * - 177660: 0xFFCE (177716 octal) - BK-0010/0011 identification
 * - 177662: 0xFFFF (177777 octal) - All features enabled
 * - 177664: 0xFF20 (177440 octal) - System flags
 * 
 * These registers are typically read by system software to:
 * - Detect hardware model (BK-0010, BK-0010-01, BK-0011, BK-0011M)
 * - Check available peripherals
 * - Determine memory configuration
 * 
 * Note: Write operations are ignored (read-only registers).
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
SystemRegs = function()
{
  // ============================================================================
  // QBUS DEVICE INTERFACE
  // ============================================================================
  
  /**
   * Returns base address of system registers
   * @returns {number} 65472 (177660 octal) - first system register
   */
  /*int*/this.getBaseAddress = function()
  {
    return 65472;  // 177660 octal
  }

  /**
   * Returns number of 16-bit words occupied by system registers
   * @returns {number} 3 words (177660, 177662, 177664)
   */
  /*int*/this.getNumWords = function()
  {
    return 3;
  }

  /**
   * Checks if system registers have pending interrupt
   * Note: System registers don't generate interrupts
   * @returns {boolean} Always false
   */
  /*boolean*/this.gotInterrupt = function()
  {
    return false;
  }

  /**
   * Returns interrupt vector
   * Note: System registers don't generate interrupts
   * @returns {number} Always 0
   */
  /*byte*/this.interruptVector = function()
  {
    return 0;
  }

  // ============================================================================
  // MEMORY ACCESS FUNCTIONS
  // ============================================================================
  
  /**
   * Reads 16-bit word from system register
   * Returns fixed values that identify the system configuration
   * 
   * @param {number} addr - Memory address to read from
   * @param {QBusReadDTO} result - Object to store the read value
   * @returns {boolean} True if address is valid system register
   */
  /*boolean*/this.readWord = function(/*int*/addr, /*QBusReadDTO*/ result)
  {
    switch (addr) {
    case 65472:  // 177660 octal - System register 1
      // Model identification: BK-0010/0011
      // Bits indicate: base model, no FPU, standard memory layout
      result.value = 0xFFCE;  // 177716 octal
      return true;
      
    case 65474:  // 177662 octal - System register 2
      // Configuration flags: all features enabled
      // Indicates presence of: extended memory, I/O devices, etc.
      result.value = 0xFFFF;  // 177777 octal
      return true;
      
    case 65476:  // 177664 octal - System register 3
      // Additional system flags
      // Hardware options and peripheral status
      result.value = 0xFF20;  // 177440 octal
      return true;
      
    case 65473:  // Odd byte addresses (not used)
    case 65475:
      // Fall through to return false
    }
    
    return false;  // Address not handled
  }

  /**
   * Writes byte as word to system register
   * System registers are read-only, write is ignored
   * @param {number} addr - Memory address to write to
   * @param {number} data - Byte value to write
   * @returns {boolean} Always true (write accepted but ignored)
   */
  /*boolean*/this.writeByteAsWord = function(/*int*/addr, /*short*/data)
  {
    return true;  // Accept write but do nothing
  }

  /**
   * Writes 16-bit word to system register
   * System registers are read-only, write is ignored
   * @param {number} addr - Memory address to write to
   * @param {number} data - Word value to write
   * @returns {boolean} Always true (write accepted but ignored)
   */
  /*boolean*/this.writeWord = function(/*int*/addr, /*short*/data)
  {
    return true;  // Accept write but do nothing
  }

  /**
   * Resets system registers
   * No state to reset (registers are constant)
   */
  /*void*/this.reset = function()
  {
    // Nothing to reset - registers are read-only constants
  }
}
