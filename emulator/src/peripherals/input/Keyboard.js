/**
 * BK-0010/0011 Keyboard Controller
 * 
 * Emulates the keyboard hardware interface at addresses 177660-177662 (octal).
 * 
 * Memory Map (octal addresses):
 * - 177660 (65456): Status register (read/write)
 * - 177662 (65458): Data register (read-only)
 * 
 * Status Register (177660):
 * - Bit 6 (0x40): Interrupt enable (write)
 * - Bit 7 (0x80): Key ready flag (read)
 * 
 * Data Register (177662):
 * - Bits 0-6: Character code (0-127)
 * - Bit 7: Extended character flag (128-255)
 * 
 * Interrupt Vectors:
 * - 060 (48 decimal): Normal character (0-127)
 * - 0274 (188 decimal): Extended character (128-255)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
Keyboard = function()
{
  // ============================================================================
  // KEYBOARD STATE
  // ============================================================================
  
  /**
   * Current key character code
   * 8-bit value: 0-127 (normal), 128-255 (extended with bit 7 set)
   */
  var /*short*/keycode = 0;
  
  /**
   * Status register value
   * - Bit 6 (0x40): Interrupt enable
   * - Bit 7 (0x80): Key ready flag
   * Initial value: 64 (0x40) = interrupt enabled, no key ready
   */
  var /*short*/status = 64;
  
  /**
   * Key down flag
   * True if a key is currently pressed
   */
  var /*boolean*/keyDown = false;

  // ============================================================================
  // QBUS DEVICE INTERFACE
  // ============================================================================
  
  /**
   * Returns base address of keyboard in memory map
   * @returns {number} 65456 (177660 octal) - keyboard status register
   */
  /*int*/this.getBaseAddress = function()
  {
    return 65456;  // 177660 octal
  }

  /**
   * Returns number of 16-bit words occupied by keyboard
   * @returns {number} 2 words (status and data registers)
   */
  /*int*/this.getNumWords = function()
  {
    return 2;
  }

  // ============================================================================
  // MEMORY ACCESS FUNCTIONS
  // ============================================================================
  
  /**
   * Reads 16-bit word from keyboard register
   * @param {number} addr - Memory address to read from
   * @param {QBusReadDTO} result - Object to store the read value
   * @returns {boolean} True if address is valid keyboard register
   */
  /*boolean*/this.readWord = function(/*int*/addr, /*QBusReadDTO*/ result)
  {
    // ---- STATUS REGISTER (177660) ----
    if (addr == 65456) {
      result.value = status;
      return true;
    }
    
    // ---- DATA REGISTER (177662) ----
    // Reading data clears the key ready flag (bit 7)
    status &= 0xFF7F;
    result.value = /*(short)*/(keycode & 0x7F);  // Return only lower 7 bits
    return true;
  }

  /**
   * Writes byte as word to keyboard register
   * @param {number} addr - Memory address to write to
   * @param {number} data - Byte value to write
   * @returns {boolean} True if write successful
   */
  /*boolean*/this.writeByteAsWord = function(/*int*/addr, /*short*/data)
  {
    return this.writeWord(addr, data);
  }

  /**
   * Writes 16-bit word to keyboard register
   * Only status register is writable (to set interrupt enable bit)
   * @param {number} addr - Memory address to write to
   * @param {number} data - Word value to write
   * @returns {boolean} True if write successful
   */
  /*boolean*/this.writeWord = function(/*int*/addr, /*short*/data)
  {
    // ---- STATUS REGISTER (177660) ----
    // Only bit 6 (interrupt enable) can be written
    if (addr == 65456)
    {
      status = /*(short)*/((status & 0xFFBF) | (data & 0x40));
      return true;
    }
    
    return false;  // Data register is read-only
  }

  // ============================================================================
  // INTERRUPT HANDLING
  // ============================================================================
  
  /**
   * Checks if keyboard has pending interrupt
   * Interrupt occurs when:
   * - Bit 6 (interrupt enable) = 1
   * - Bit 7 (key ready) = 1
   * 
   * @returns {boolean} True if interrupt pending
   */
  /*boolean*/this.gotInterrupt = function()
  {
    // Check if both interrupt enable (0x40) and key ready (0x80) are set
    return ((status & 0xC0) >>> 0 == 128);
  }

  /**
   * Returns interrupt vector for keyboard
   * Vector depends on character type:
   * - Normal characters (0-127): vector 060 (48 decimal)
   * - Extended characters (128-255): vector 0274 (188 decimal)
   * 
   * Clears key ready flag when vector is read
   * @returns {number} Interrupt vector
   */
  /*byte*/this.interruptVector = function()
  {
    status &= 0xFF7F;  // Clear key ready flag (bit 7)
    
    // Return vector based on bit 7 of keycode
    return /*(byte)*/(((keycode & 0x80) != 0) ? 188 : 48);
  }

  // ============================================================================
  // KEYBOARD CONTROL FUNCTIONS
  // ============================================================================
  
  /**
   * Resets keyboard to initial state
   * Behavior depends on whether key is currently held down
   */
  /*void*/this.reset = function()
  {
    if (!keyDown)
    {
      // No key pressed: clear everything
      keycode = 0;
      status = 64;  // 0x40: interrupt enable, no key ready
    }
    else
    {
      // Key still pressed: set both flags
      status = 192;  // 0xC0: interrupt enable + key ready
    }
  }

  /**
   * Registers a key press
   * Sets key code and ready flag
   * @param {number} key - Character code (0-255)
   */
  /*void*/this.punch = function(/*byte*/key)
  {
    keycode = /*(short)*/(key & 0xFF) >>> 0;
    status |= 0x80;  // Set key ready flag (bit 7)
    keyDown = true;
  }

  /**
   * Sets key down state
   * @param {boolean} isDown - True if key is pressed
   */
  /*void*/this.setKeyDown = function(/*boolean*/isDown)
  {
    keyDown = isDown;
  }

  /**
   * Gets key down state
   * @returns {boolean} True if key is currently pressed
   */
  /*boolean*/this.getKeyDown = function() {
    return keyDown;
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return this;  // Return public interface
}
