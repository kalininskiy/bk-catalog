/**
 * BK-0010/0011 Programmable Timer (K1801VP1-037)
 * 
 * Emulates the hardware timer peripheral at addresses 177706-177712 (octal).
 * The timer provides countdown functionality with configurable period and modes.
 * 
 * Memory Map (octal addresses):
 * - 177706 (65478): Start value register (read/write)
 * - 177710 (65480): Current counter register (read-only)
 * - 177712 (65482): Configuration register (read/write)
 * 
 * Configuration Register Bits:
 * - Bit 0 (0x01): Reload - when set, counter reloads from start value
 * - Bit 1 (0x02): Count direction (0=down, 1=hold)
 * - Bit 2 (0x04): Interrupt enable
 * - Bit 3 (0x08): Stop counter on overflow
 * - Bit 4 (0x10): Counter enable
 * - Bit 5 (0x20): Speed divider /16
 * - Bit 6 (0x40): Speed divider /4
 * - Bit 7 (0x80): Overflow flag
 * - Bits 8-15: Always 0xFF
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
CPUTimer = function()
{
  var self = this;
  
  // ============================================================================
  // TIMER REGISTERS
  // ============================================================================
  
  /**
   * Start value register (177706)
   * Initial value loaded into counter when timer starts or reloads
   */
  var /*short*/start;
  
  /**
   * Current counter value (177710)
   * Counts down from start value, read-only
   */
  var /*short*/count;
  
  /**
   * Configuration register (177712)
   * Controls timer operation mode, speed, and flags
   */
  var /*short*/config;
  
  // ============================================================================
  // TIMING CONSTANTS
  // ============================================================================
  
  /**
   * Timer period in CPU cycles per timer tick
   * 
   * Calculation for 3MHz BK-0010:
   * - It takes 2.812 seconds to count from 0 to 0xFFFF (65535)
   * - (3,000,000 cycles/sec * 2.812 sec) / 65536 ticks = 128.625 cycles/tick
   * - Rounded to 128 cycles per tick
   * 
   * Can be modified by dividers (bits 5-6 of config):
   * - Base: 128 cycles/tick
   * - /4:   512 cycles/tick (bit 6 set)
   * - /16:  2048 cycles/tick (bit 5 set)
   * - /64:  8192 cycles/tick (both bits set)
   */
  var /*long*/period = 128;
  
  /**
   * Last CPU cycle count when timer was updated
   * Used to calculate elapsed cycles for timer updates
   */
  self.cycles = 0;

  // ============================================================================
  // QBUS DEVICE INTERFACE
  // ============================================================================
  
  /**
   * Returns base address of timer in memory map
   * @returns {number} 65478 (177706 octal) - start of timer registers
   */
  /*int*/this.getBaseAddress = function()
  {
    return 65478;  // 177706 octal
  }

  /**
   * Returns number of 16-bit words occupied by timer registers
   * @returns {number} 3 words (start, count, config)
   */
  /*int*/this.getNumWords = function()
  {
    return 3;
  }

  /**
   * Checks if timer has pending interrupt
   * Note: Timer interrupts are not currently implemented in this emulator
   * @returns {boolean} Always false
   */
  /*boolean*/this.gotInterrupt = function()
  {
    return false;
  }

  /**
   * Returns interrupt vector for timer
   * Note: Timer interrupts are not currently implemented in this emulator
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
   * Reads 16-bit word from timer register
   * @param {number} addr - Memory address to read from
   * @param {QBusReadDTO} result - Object to store the read value
   * @returns {boolean} True if address is valid timer register, false otherwise
   */
  /*boolean*/this.readWord = function(/*int*/addr, /*QBusReadDTO*/ result)
  {
    self.updateTimer();  // Update timer state before reading

    switch (addr)
    {
    case 65478:  // 177706 octal - Start value register
      result.value = start;
      return true;
      
    case 65480:  // 177710 octal - Current counter value (read-only)
      result.value = count;
      return true;
      
    case 65482:  // 177712 octal - Configuration register
      result.value = config;
      return true;
      
    case 65479:  // Odd byte addresses (not used)
    case 65481:
      // Fall through to return false
    }
    
    return false;  // Address not handled by timer
  }

  /**
   * Writes byte as word to timer register
   * Required by QBus interface for byte operations
   * @param {number} addr - Memory address to write to
   * @param {number} data - Byte value to write
   * @returns {boolean} Always true (accepts but doesn't process byte writes)
   */
  /*boolean*/this.writeByteAsWord = function(/*int*/addr, /*short*/data)
  {
    self.updateTimer();  // Update timer state
    return true;         // Accept write but don't modify registers
  }

  /**
   * Writes 16-bit word to timer register
   * @param {number} addr - Memory address to write to
   * @param {number} data - Word value to write
   * @returns {boolean} True if address is valid timer register, false otherwise
   */
  /*boolean*/this.writeWord = function(/*int*/addr, /*short*/data)
  {
    self.updateTimer();  // Update timer state before writing
    
    switch (addr) {
    case 65478:  // 177706 octal - Start value register
      start = data & 0xFFFF >>> 0;  // Store 16-bit start value
      return true;
      
    case 65480:  // 177710 octal - Current counter (read-only, ignore writes)
      return true;
      
    case 65482:  // 177712 octal - Configuration register
      setConfig(data);  // Update configuration and reset timer
      return true;
      
    case 65479:  // Odd byte addresses (not used)
    case 65481:
      // Fall through to return false
    }
    
    return false;  // Address not handled by timer
  }

  // ============================================================================
  // RESET FUNCTION
  // ============================================================================
  
  /**
   * Resets timer to initial state
   * Called on system reset or emulator initialization
   */
  /*void*/this.reset = function()
  {
    start = 4608;      // 11000 octal - default start value
    count = 65535;     // 177777 octal - maximum counter value
    config = 65280;    // 177400 octal - default config (upper byte = 0xFF)
    self.cycles = 0;   // Reset cycle counter
  }

  // ============================================================================
  // INTERNAL FUNCTIONS
  // ============================================================================
  
  /**
   * Updates timer configuration and calculates period
   * Called when configuration register is written
   * @param {number} data - New configuration value
   */
  function /*void*/setConfig(/*short*/data) {
    var /*int*/a = 128;  // Base period: 128 CPU cycles per tick

    // ---- CALCULATE PERIOD WITH DIVIDERS ----
    // Bit 6 (0x40): Divide by 4
    if ((data & 0x40) != 0) {
      a *= 4;  // Period becomes 512 cycles/tick
    }
    
    // Bit 5 (0x20): Divide by 16
    if ((data & 0x20) != 0) {
      a *= 16;  // Period becomes 2048 cycles/tick (or 8192 if both set)
    }
    
    period = a;  // Set new period

    // ---- RESET COUNTER ----
    count = start;  // Reload counter from start value

    // ---- UPDATE CONFIG REGISTER ----
    // Upper byte (bits 8-15) is always 0xFF
    config = /*(short)*/(data | 0xFF00);
  }
  
  // ============================================================================
  // TIMER UPDATE LOGIC
  // ============================================================================

  /**
   * Updates timer counter based on elapsed CPU cycles
   * Called before every register read/write to keep timer synchronized
   * 
   * Timer Logic:
   * 1. Calculate elapsed cycles since last update
   * 2. Convert cycles to timer ticks (divide by period)
   * 3. Handle reload mode (bit 0)
   * 4. Check if counter is enabled (bit 4)
   * 5. Handle counter overflow and modes
   * 6. Update counter value
   */
  /*void*/this.updateTimer = function()
  {
    // ---- CALCULATE ELAPSED CYCLES ----
    var d = (cpu.Cycles - self.cycles);  // Cycles since last update

    // Not enough cycles for even one tick
    if (d < period) {
      return;
    }
    
    // Calculate number of timer ticks
    var /*long*/c = (d / period) | 0;

    // Update cycle counter (consume the cycles used)
    self.cycles += c * period;

    // ---- CHECK RELOAD MODE (bit 0) ----
    // If reload bit is set, just reset counter to start value
    if ((config & 0x1) != 0)
    {
      count = start;
      return;
    }

    // ---- CHECK IF COUNTER IS ENABLED (bit 4) ----
    // If counter enable bit is clear, don't count
    if ((config & 0x10) == 0) {
      return;
    }
    
    // ---- HANDLE COUNTER OVERFLOW ----
    if (c >= (count & 0xFFFF))
    {
      // Set overflow flag (bit 7) if interrupt enable (bit 2) is set
      if ((config & 0x4) != 0)
      {
        config |= /*(short)*/0x80;  // Set overflow flag
      }
      
      // Check count direction (bit 1): 0=down, 1=hold
      if ((config & 0x2) == 0)
      {
        // Check stop-on-overflow mode (bit 3)
        if ((config & 0x8) != 0)
        {
          config &= /*(short)*/0xFFEF;  // Clear counter enable bit (bit 4)
          count = start;                 // Reset to start value
          return;
        }

        // Handle wraparound for continuous counting
        if (start == 0) {
          // If start is 0, just subtract ticks
          count = /*(short)(int)*/(count - c) & 0xFFFF >>> 0;
        } else {
          // Calculate position in repeating cycle
          count = /*(short)(int)*/((start - (c - count)) % start) & 0xFFFF >>> 0;
        }
        
        return;
      }
    }
    
    // ---- NORMAL COUNTDOWN ----
    // Subtract ticks from counter
    count = /*(short)(int)*/(count - c) & 0xFFFF >>> 0;
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return self;  // Return public interface
}
