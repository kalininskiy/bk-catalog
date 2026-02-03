/**
 * BK-0010 Key Mapper
 * 
 * Manages keyboard input and translates HTML keyboard events to BK-0010 character codes.
 * 
 * Features:
 * - Language switching (Russian/Latin) via Ctrl keys
 * - CapsLock handling
 * - Modifier keys (Shift, Alt, Ctrl) processing
 * - Special function keys (video mode, reset)
 * - Key repeat and release tracking
 * - Integration with joystick input
 * 
 * Modifier Combinations:
 * - Alt: Sets bit 7 (128) for extended characters
 * - Ctrl: Sets bit 6 (64) for control characters
 * - Alt+Ctrl: Inverts character code (255-code)
 * - Shift/CapsLock: Uppercase letters and shifted symbols
 * 
 * Special Keys:
 * - Left Ctrl: Switch to Russian (РУС)
 * - Right Ctrl: Switch to Latin (ЛАТ)
 * - CapsLock: Toggle caps lock
 * - Pause/Esc: STOP signal
 * - F3: Video mode toggle
 * - F12: Reset
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
KeyMapper = function()
{
  var self = this;
  
  // ============================================================================
  // KEY MAPPER STATE
  // ============================================================================
  
  /**
   * Special event flags
   * Bit 0 (0x1): STOP event (Pause/Esc)
   * Bit 1 (0x2): Video mode toggle (F3)
   * Bit 2 (0x4): Reset (F12)
   */
  var /*int*/nextEvent = 0;
  
  /**
   * Next key code to be processed
   * -1 if no key pending
   */
  var /*int*/nextKey = -1;
  
  /**
   * Last HTML keycode pressed
   * Used to match key releases
   */
  var /*int*/lastKey = -1;
  
  /**
   * Key pressed flag
   * True when a key is currently held down
   */
  var /*boolean*/pressedKey = false;
  
  /**
   * CapsLock state
   * True when caps lock is active
   */
  var /*boolean*/capsLocked = false;
  
  /**
   * Russian layout flag
   * True for Russian (РУС), false for Latin (ЛАТ)
   */
  var rus = false;
  
  // ============================================================================
  // LAYOUT CONTROL FUNCTIONS
  // ============================================================================

  /**
   * Switches to Russian layout (РУС)
   */
  this.setRus = function() {
    pushKey(14);  // Send RUS command to BK
    rus = true;
  }
  
  /**
   * Switches to Latin layout (ЛАТ)
   */
  this.setLat = function() {
    pushKey(15);  // Send LAT command to BK
    rus = false;
  }
  
  /**
   * Checks if Russian layout is active
   * @returns {boolean} True if Russian layout
   */
  this.isRus = function() {
    return rus;
  }
  
  /**
   * Gets CapsLock state
   * @returns {boolean} True if caps lock is on
   */
  this.getCaps = function() {
    return capsLocked;
  }
  
  /**
   * Toggles CapsLock state
   */
  this.Capsed = function() {
    capsLocked = !capsLocked;
  }
  
  // ============================================================================
  // KEY TRANSLATION
  // ============================================================================
  
  /**
   * Translates HTML keyboard event to BK character code
   * Handles modifiers, special keys, and layout switching
   * 
   * @param {KeyEvent} e - Keyboard event
   * @returns {number} BK character code, or -1 if not mapped
   */
  function /*int*/translateKey(/*KeyEvent*/ e) {
    var /*int*/key = e.keyCode || e.which;

    // ---- HANDLE MODIFIER AND SPECIAL KEYS ----
    switch (key)
    {
    case 16:  // Shift - don't process directly
      return -1;
      
    case 17:  // Ctrl - use for layout switching
      if (e.location == 1) self.setRus();  // Left Ctrl = РУС
      if (e.location == 2) self.setLat();  // Right Ctrl = ЛАТ
      return -1;
      
    case 18:  // Alt - don't process directly
      return -1;
      
    case 20:  // CapsLock
      self.Capsed();
      return -1;
      
    case 19:  // Pause/Break
    case 27:  // Esc
      nextEvent/*STOP*/ |= 1;
      return key;
    }
    
    // ---- TRANSLATE KEY USING BK KEYMAP ----
    var Ob = bkkeys.getMappedKey(key, e.shiftKey || capsLocked, e.altKey, rus);
    key = Ob.code;  // Get BK character code
    
    if (key < 0) return -1;  // Key not mapped
    
    // ---- APPLY MODIFIER BITS ----
    // AR2 mode keys don't get modifier bits
    if (!Ob.isAp2)
    {
      var a = e.altKey;
      var c = e.ctrlKey;
      
      // Alt+Ctrl: Invert character (for graphics characters)
      if (a && c) {
        key = (255 - key) & 0xFF >>> 0;
      }
      else {
        // Alt: Set bit 7 (extended characters, AR2)
        if (a) key |= 128;
        
        // Ctrl: Set bit 6 (control characters)
        if (c) key |= 64;
      }
    }
    
    // ---- HANDLE SPECIAL FUNCTION KEYS ----
    switch (key)
    {
    case 1002:  // F3: Video mode toggle
      nextEvent/*VIDEO MODE*/ |= 2;
      break;
      
    case 1004:  // F12: Reset
      nextEvent/*RESET*/ |= 4;
      break;
    }
    
    return key;
  }
  
  // ============================================================================
  // PROGRAMMATIC KEY INPUT
  // ============================================================================
  
  /**
   * Simulates key press by BK character code
   * Used for virtual keyboard and programmatic input
   * @param {number} n - BK character code
   */
  this.key_byCodeHit = function(n)
  {
    nextKey = n;
    lastKey = n;
    pressedKey = true;
  }
  
  /**
   * Simulates key release by BK character code
   * @param {number} n - BK character code
   */
  this.key_byCodeRelease = function(n) {
    if ((n >= 0) && (n == lastKey))
    {
      nextKey = -1;
      lastKey = -1;
      pressedKey = false;
    }
  }

  // ============================================================================
  // KEYBOARD EVENT HANDLERS
  // ============================================================================
  
  /**
   * Handles key press event
   * Checks joystick mapping first, then keyboard mapping
   * @param {KeyEvent} e - Keyboard event
   */
  /*void*/this.keyHit = function(/*KeyEvent*/e)
  {
    var k = e.keyCode || e.which;

    // Try joystick mapper first
    if (joyMapper.translateKey(e, true)) {
      return;  // Key handled as joystick input
    }
    
    // Translate to BK character code
    var /*int*/key = translateKey(e);
     
    // Register key press (avoid repeat for same key)
    if ((key >= 0) && (k != lastKey))
    {
      nextKey = key;
      lastKey = k;
      pressedKey = true;
    }
  }

  /**
   * Handles key release event
   * Clears key state if released key matches last pressed key
   * @param {KeyEvent} e - Keyboard event
   */
  /*void*/this.keyRelease = function(/*KeyEvent*/ e) {
    var /*int*/key = e.keyCode || e.which;

    // Clear key state if this was the last pressed key
    if ((key >= 0) && (key == lastKey))
    {
      nextKey = -1;
      lastKey = -1;
      pressedKey = false;
    }

    // Update joystick state
    joyMapper.translateKey(e, false);
  }

  // ============================================================================
  // POLLING FUNCTIONS
  // ============================================================================
  
  /**
   * Polls for next key press
   * Returns and clears pending key
   * @returns {number} BK character code, or -1 if no key
   */
  /*int*/this.pollKey = function() {
    if (!pressedKey) {
      return -1;
    }
    pressedKey = false;
    return nextKey;
  }

  /**
   * Checks if key is currently held down
   * @returns {boolean} True if key is pressed
   */
  /*boolean*/this.pollKeyHold = function() {
    return (nextKey != -1);
  }

  /**
   * Polls for special events (STOP, video mode, reset)
   * Returns and clears pending events
   * @returns {number} Event flags (bits 0-2)
   */
  /*int*/this.pollEvents = function() {
    var /*int*/a = nextEvent;
    nextEvent = 0;
    return a;
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return self;  // Return public interface
}
