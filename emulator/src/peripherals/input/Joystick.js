/**
 * BK-0010 Joystick Emulation via Keyboard
 * 
 * Emulates joystick input using NumPad keys (or arrow keys as fallback).
 * The joystick is mapped to the standard layout:
 * 
 * NumPad Layout:
 * - 7 8 9  (Up-Left, Up, Up-Right)
 * - 4 5 6  (Left, Center, Right)
 * - 1 2 3  (Down-Left, Down, Down-Right)
 * - 0      (Fire 1)
 * - +      (Fire 1 alternative)
 * - .      (Fire 2)
 * - Enter  (Fire 2 alternative)
 * 
 * Alternative Mapping (arrow keys + special keys):
 * - Arrow keys → Directional input
 * - Space → Fire 1
 * - Enter/Delete → Fire 2
 * 
 * This mapper:
 * 1. Translates arrow keys and special keys to NumPad codes
 * 2. Tracks key press/release states
 * 3. Converts key states to joystick state bits
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
JoystickMapper = function()
{
  var self = this;
  
  // ============================================================================
  // KEY STATE TRACKING
  // ============================================================================
  
  /**
   * Key down states for 13 buttons
   * Indices: 0-9 = NumPad 0-9, 10 = Dot/Fire2, 11 = Enter/Fire2, 12 = Plus/Fire1
   */
  var /*boolean[13]*/kD = [];

  // ============================================================================
  // KEY CODE TRANSLATION
  // ============================================================================
  
  /**
   * Translates alternative keys to NumPad codes
   * Handles two cases:
   * 1. Arrow keys, Space, Enter → NumPad equivalents
   * 2. NumPad keys when NumLock is ON (raw codes)
   * 
   * @param {number} code - HTML keycode
   * @returns {number} Translated NumPad keycode
   */
  this.keysubstit = function(code)
  {
    switch (code)
    {
    case 45:  // Insert → NumPad 0
      code = 96;
      break;
    case 35:  // End → NumPad 1
      code = 97;
      break;
    case 40:  // Arrow Down → NumPad 2
      code = 98;
      break;
    case 34:  // PageDown → NumPad 3
      code = 99;
      break;
    case 37:  // Arrow Left → NumPad 4
      code = 100;
      break;
    case 12:  // Clear (NumLock off, 5) → NumPad 5
      code = 101;
      break;
    case 39:  // Arrow Right → NumPad 6
      code = 102;
      break;
    case 36:  // Home → NumPad 7
      code = 103;
      break;
    case 38:  // Arrow Up → NumPad 8
      code = 104;
      break;
    case 33:  // PageUp → NumPad 9
      code = 105;
      break;
    case 32:  // Space → NumPad + (Fire 1)
      code = 107;
      break;
    case 46:  // Delete → NumPad . (Fire 2)
      code = 110;
      break;
    }
    return code;
  }
  
  /**
   * Translates BK-0010 character codes to NumPad codes
   * Used for virtual keyboard and programmatic input
   * @param {number} code - BK character code
   * @returns {number} NumPad keycode
   */
  this.bk2asc = function(code) {
    switch (code)
    {
    // BK cursor control codes → NumPad
    case 8:   // BK Left → NumPad 4
      code = 100;
      break;
    case 26:  // BK Up → NumPad 8
      code = 104;
      break;
    case 25:  // BK Right → NumPad 6
      code = 102;
      break;
    case 27:  // BK Down → NumPad 2
      code = 98;
      break;
    case 10:  // BK Enter → NumPad . (Fire 2)
      code = 110;
      break;
    case 32:  // BK Space → NumPad + (Fire 1)
      code = 107;
      break;
    }
    return self.keysubstit(code);
  }

  /**
   * Translates keyboard event to joystick input
   * Updates key down state for pressed/released keys
   * 
   * @param {KeyEvent} e - Keyboard event
   * @param {boolean} isDown - True if key pressed, false if released
   * @returns {boolean} True if key was handled as joystick input
   */
  /*boolean*/this.translateKey = function(/*KeyEvent*/ e, /*boolean*/isDown)
  {
    var /*int*/code = e.keyCode || e.which;

    // Check if should accept only NumPad keys or all keys
    if (!overJoystick || (code == 13))
    {
      // Browser doesn't support location property
      if (typeof(e.location) == "undefined") return false;
      
      // Only accept NumPad keys (location 3)
      if (e.location != 3) return false;
    }

    code = self.keysubstit(code);  // Translate to NumPad codes
    
    // ---- HANDLE NUMPAD KEYS ----
    switch (code)
    {
    // NumPad 0-9 (directional and fire)
    case 96:   // NumPad 0
    case 97:   // NumPad 1
    case 98:   // NumPad 2
    case 99:   // NumPad 3
    case 100:  // NumPad 4
    case 101:  // NumPad 5
    case 102:  // NumPad 6
    case 103:  // NumPad 7
    case 104:  // NumPad 8
    case 105:  // NumPad 9
      kD[(code - 96)] = isDown;
      return true;
      
    case 110:  // NumPad . (Fire 2)
      kD[10/*DOT*/] = isDown;
      return true;
      
    case 107:  // NumPad + (Fire 1)
      kD[12/*PLUS*/] = isDown;
      return true;
      
    case 13:   // Enter (Fire 2)
      kD[11/*ENTER*/] = isDown;
      return true;
    }

    return false;  // Key not handled
  }

  /**
   * Gets current joystick state as bit flags
   * Combines multiple key states into directional flags
   * 
   * State Bits:
   * - Bit 0 (0x01): UP    - Keys 7, 8, 9 (top row)
   * - Bit 1 (0x02): DOWN  - Keys 1, 2, 3, 5 (bottom row + center)
   * - Bit 2 (0x04): LEFT  - Keys 1, 4, 7 (left column)
   * - Bit 3 (0x08): RIGHT - Keys 3, 6, 9 (right column)
   * - Bit 4 (0x10): FIRE1 - Key 0 or + (NumPad 0 or Plus)
   * - Bit 5 (0x20): FIRE2 - Key . or Enter (NumPad Dot or Enter)
   * 
   * @returns {number} 6-bit state value
   */
  /*int*/this.getJoystickState = function() {
    var /*int*/state = 0;
    
    // UP: NumPad 7, 8, 9 (top row)
    if (kD[7] || kD[8] || kD[9]) {
      state |= 1;
    }
    
    // DOWN: NumPad 1, 2, 3, 5 (bottom row + center)
    if (kD[1] || kD[2] || kD[3] || kD[5]) {
      state |= 2;
    }
    
    // LEFT: NumPad 1, 4, 7 (left column)
    if (kD[1] || kD[4] || kD[7]) {
      state |= 4;
    }
    
    // RIGHT: NumPad 3, 6, 9 (right column)
    if (kD[3] || kD[6] || kD[9]) {
      state |= 8;
    }
    
    // FIRE1: NumPad 0 or +
    if (kD[0] || kD[12]) {
      state |= 16;
    }
    
    // FIRE2: NumPad . or Enter
    if (kD[10] || kD[11]) {
      state |= 32;
    }
    
    return state;
  }
  
  /**
   * Initializes key down states to false
   */
  function init()
  {
    for (var i = 0; i < 13; i++) {
      kD[i] = 0;
    }
  }
  
  init();  // Initialize on creation
  
  return this;
}

// ============================================================================
// JOYSTICK STATE READER
// ============================================================================

/**
 * Joystick State Reader
 * 
 * Converts joystick state bits to BK-0010 I/O port format.
 * This is read by the emulated BK system when accessing the joystick port.
 * 
 * BK-0010 Joystick I/O Format:
 * - Bit 0 (0x001): FIRE2
 * - Bit 1 (0x002): FIRE1
 * - Bit 4 (0x010): RIGHT
 * - Bit 5 (0x020): DOWN
 * - Bit 9 (0x200): LEFT
 * - Bit 10 (0x400): UP
 */
Joystick = function()
{
  var /*int*/state = 0;  // Current joystick state

  /**
   * Sets joystick state
   * Called by emulator to update joystick state
   * @param {number} newState - 6-bit state from JoystickMapper
   */
  /*void*/this.setState = function(/*int*/newState) {
    state = newState;
  }

  /**
   * Gets joystick state in BK-0010 I/O port format
   * Translates state bits to BK hardware format
   * @returns {number} I/O port value
   */
  /*short*/this.getIO = function()
  {
    var /*short*/acc = 0;
    
    // Map state bits to BK I/O port bits
    if (state & 0x1/*UP*/)    acc |= 0x400;  // Bit 10
    if (state & 0x2/*DOWN*/)  acc |= 0x20;   // Bit 5
    if (state & 0x4/*LEFT*/)  acc |= 0x200;  // Bit 9
    if (state & 0x8/*RIGHT*/) acc |= 0x10;   // Bit 4
    if (state & 0x10/*FIRE1*/) acc |= 0x2;   // Bit 1
    if (state & 0x20/*FIRE2*/) acc |= 0x1;   // Bit 0
    
    return acc;
  }
  
  return this;
}
