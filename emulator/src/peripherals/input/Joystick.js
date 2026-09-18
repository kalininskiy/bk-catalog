/**
 * BK-0010/BK-0011M Joystick and Gamepad Subsystem
 * 
 * Implements:
 * 1. Hardware port 177714 (0177714 octal / 65484 decimal) input register
 *    - Joy 1 (lower byte, bits 0-7): Up, Right, Down, Left, A, Fire, AltFire, B
 *    - Joy 2 (upper byte, bits 8-15): Up, Right, Down, Left, Start, A, B, Select
 * 2. Modern HTML5 Web Gamepad API integration (W3C standard)
 *    - D-Pad and analog stick processing with deadzone
 *    - Dual-gamepad support
 * 3. BK Keyboard mapping for games lacking native joystick support
 *    - Straight arrows: Left (8), Right (25), Up (26), Down (27)
 *    - Diagonal arrows: Up-Left (28), Up-Right (29), Down-Right (30), Down-Left (31)
 *    - Actions: Space (32), Enter (10)
 *    - Continuous hold (SYSREG 177716 bit 6) and auto-repeat for EMT 6 input
 *    - Collision-free per-frame key dispatching queue
 * 4. Keyboard NumPad emulation fallback
 * 
 * Reference:
 * - Documentation: 14-разъёмы-и-периферия.md, lines 632-838
 * - Gid emulator: reference/BKemuv4/BK/devemu/Config.cpp, lines 1228-1318
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

// ============================================================================
// JOYSTICK BIT MASK CONSTANTS (PORT 177714)
// ============================================================================

/**
 * Standard BK-0010/0011 Joystick 1 bit masks (lower byte)
 */
var BK_JOY1_UP      = 0x0001; // 000001 octal: Вверх
var BK_JOY1_RIGHT   = 0x0002; // 000002 octal: Вправо
var BK_JOY1_DOWN    = 0x0004; // 000004 octal: Вниз
var BK_JOY1_LEFT    = 0x0008; // 000010 octal: Влево
var BK_JOY1_A       = 0x0010; // 000020 octal: Кнопка A (КЛ1)
var BK_JOY1_FIRE    = 0x0020; // 000040 octal: Основной огонь (КЛ2 / левая кнопка)
var BK_JOY1_ALTFIRE = 0x0040; // 000100 octal: Дополнительный огонь (правая кнопка)
var BK_JOY1_B       = 0x0080; // 000200 octal: Кнопка B

/**
 * Standard BK-0010/0011 Joystick 2 bit masks (upper byte)
 */
var BK_JOY2_UP      = 0x0100; // 000400 octal: Вверх 2
var BK_JOY2_RIGHT   = 0x0200; // 001000 octal: Вправо 2
var BK_JOY2_DOWN    = 0x0400; // 002000 octal: Вниз 2
var BK_JOY2_LEFT    = 0x0800; // 004000 octal: Влево 2
var BK_JOY2_START   = 0x1000; // 010000 octal: Start 2
var BK_JOY2_A       = 0x2000; // 020000 octal: A 2
var BK_JOY2_B       = 0x4000; // 040000 octal: B 2
var BK_JOY2_SELECT  = 0x8000; // 100000 octal: Select 2

/**
 * BK-0010 Keyboard Character Codes for Cursor and Action Keys
 */
var BK_KEY_LEFT     = 8;  // 010 octal: ←
var BK_KEY_RIGHT    = 25; // 031 octal: →
var BK_KEY_UP       = 26; // 032 octal: ↑
var BK_KEY_DOWN     = 27; // 033 octal: ↓
var BK_KEY_UP_LEFT  = 28; // 034 octal: ↖ (СУ/Э)
var BK_KEY_UP_RIGHT = 29; // 035 octal: ↗ (СУ/Ш)
var BK_KEY_DN_RIGHT = 30; // 036 octal: ↘ (СУ/Ч)
var BK_KEY_DN_LEFT  = 31; // 037 octal: ↙ (СУ/Ъ)
var BK_KEY_SPACE    = 32; // 040 octal: ПРОБЕЛ (Fire)
var BK_KEY_ENTER    = 10; // 012 octal: ВВОД (Start / Fire 2)

// ============================================================================
// JOYSTICK STATE READER (HARDWARE PORT 177714)
// ============================================================================

/**
 * Joystick State Controller
 * Manages the 16-bit register value read from port 177714.
 */
var Joystick = function()
{
  var state = 0; // 16-bit I/O port state

  /**
   * Sets joystick state bits
   * @param {number} joy1OrFullWord - Lower byte or complete 16-bit word
   * @param {number} [joy2Byte] - Optional upper byte for Joystick 2
   */
  this.setState = function(joy1OrFullWord, joy2Byte) {
    if (typeof joy2Byte === 'number') {
      state = ((joy1OrFullWord & 0xFF) | ((joy2Byte & 0xFF) << 8)) & 0xFFFF;
    } else {
      state = (joy1OrFullWord || 0) & 0xFFFF;
    }
  };

  /**
   * Reads joystick state in BK-0010 I/O port format (port 177714)
   * @returns {number} 16-bit word
   */
  this.getIO = function() {
    return state;
  };

  return this;
};

if (typeof window !== 'undefined') {
  window.Joystick = Joystick;
}

// ============================================================================
// KEYBOARD NUMPAD JOYSTICK MAPPER (FALLBACK)
// ============================================================================

/**
 * BK-0010 Joystick Emulation via Keyboard NumPad
 */
var JoystickMapper = function()
{
  var self = this;
  var kD = [];

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
  };

  this.bk2asc = function(code) {
    switch (code)
    {
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
  };

  this.translateKey = function(e, isDown)
  {
    var code = e.keyCode || e.which;

    if (!overJoystick || (code == 13))
    {
      if (typeof(e.location) == "undefined") return false;
      if (e.location != 3) return false;
    }

    code = self.keysubstit(code);
    
    switch (code)
    {
    case 96:
    case 97:
    case 98:
    case 99:
    case 100:
    case 101:
    case 102:
    case 103:
    case 104:
    case 105:
      kD[(code - 96)] = isDown;
      return true;
      
    case 110:  // NumPad . (Fire 2 / AltFire)
      kD[10] = isDown;
      return true;
      
    case 107:  // NumPad + (Fire 1 / Main Fire)
      kD[12] = isDown;
      return true;
      
    case 13:   // Enter
      kD[11] = isDown;
      return true;
    }

    return false;
  };

  /**
   * Returns standard BK port 177714 bitmask from NumPad keys
   */
  this.getJoystickState = function() {
    var state = 0;
    
    // UP (000001): NumPad 7, 8, 9
    if (kD[7] || kD[8] || kD[9]) {
      state |= BK_JOY1_UP;
    }
    
    // RIGHT (000002): NumPad 3, 6, 9
    if (kD[3] || kD[6] || kD[9]) {
      state |= BK_JOY1_RIGHT;
    }

    // DOWN (000004): NumPad 1, 2, 3, 5
    if (kD[1] || kD[2] || kD[3] || kD[5]) {
      state |= BK_JOY1_DOWN;
    }
    
    // LEFT (000010): NumPad 1, 4, 7
    if (kD[1] || kD[4] || kD[7]) {
      state |= BK_JOY1_LEFT;
    }
    
    // FIRE 1 (000040): NumPad 0 or +
    if (kD[0] || kD[12]) {
      state |= BK_JOY1_FIRE;
    }
    
    // FIRE 2 (000100): NumPad . or Enter
    if (kD[10] || kD[11]) {
      state |= BK_JOY1_ALTFIRE;
    }
    
    return state;
  };

  function init()
  {
    for (var i = 0; i < 13; i++) {
      kD[i] = 0;
    }
  }
  
  init();
  return this;
};

// ============================================================================
// MODERN HTML5 GAMEPAD CONTROLLER
// ============================================================================

/**
 * GamepadHandler
 * Manages modern HTML5 Gamepad API integration for BK-0010/0011M.
 */
var GamepadHandler = function()
{
  var self = this;

  // Operating modes
  this.MODE_OFF = 0;       // Gamepad disabled
  this.MODE_PORT = 1;      // Hardware port 177714 only
  this.MODE_KEYBOARD = 2;  // Keyboard mapping only (arrows + diagonals + space)
  this.MODE_BOTH = 3;      // Hardware port + Keyboard mapping (recommended)

  this.mode = this.MODE_BOTH;       // Default mode: both port and keyboard
  this.useDiagonals = true;         // Map diagonal directions to BK codes 28-31
  this.deadzone = 0.35;             // Analog stick deadzone threshold
  this.autoRepeatDelay = 250;       // Auto-repeat start delay (ms)
  this.autoRepeatRate = 60;         // Auto-repeat frequency (ms)

  // Tracking state for keyboard emulation
  var activeDirectionCode = -1;
  var directionPressTime = 0;
  var lastRepeatTime = 0;
  var activeFirePressed = false;
  var activeEnterPressed = false;

  // Micro-queue for collision-free key delivery
  var keyQueue = [];
  var keySentThisFrame = false;

  // Hardware port mask
  var port177714Mask = 0;

  // Connected gamepads list
  var connectedList = [];
  this.onStatusChange = null; // Callback: function(status)

  /**
   * Initializes gamepad connection listeners
   */
  function initListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('gamepadconnected', function(e) {
      updateConnectedList();
      if (typeof self.onStatusChange === 'function') {
        self.onStatusChange(self.getStatus());
      }
    });

    window.addEventListener('gamepaddisconnected', function(e) {
      updateConnectedList();
      if (typeof self.onStatusChange === 'function') {
        self.onStatusChange(self.getStatus());
      }
    });
  }

  /**
   * Updates list of actively connected gamepads
   */
  function updateConnectedList() {
    connectedList = [];
    var pads = getRawGamepads();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        connectedList.push({
          index: pads[i].index,
          id: pads[i].id || ('Gamepad ' + (i + 1))
        });
      }
    }
  }

  /**
   * Cross-browser getGamepads
   */
  function getRawGamepads() {
    if (typeof navigator === 'undefined') return [];
    if (navigator.getGamepads) {
      return navigator.getGamepads();
    }
    if (navigator.webkitGetGamepads) {
      return navigator.webkitGetGamepads();
    }
    return [];
  }

  /**
   * Safe key dispatcher: hits key immediately if free this frame, or enqueues for next frame
   */
  function sendKeyHit(keymap, code) {
    if (!keymap) return;
    if (!keySentThisFrame) {
      keymap.key_byCodeHit(code);
      keySentThisFrame = true;
    } else {
      if (keyQueue.indexOf(code) === -1) {
        keyQueue.push(code);
      }
    }
  }

  /**
   * Returns current connection status
   * @returns {Object} { connected: boolean, count: number, name: string }
   */
  this.getStatus = function() {
    updateConnectedList();
    var count = connectedList.length;
    var name = count > 0 ? connectedList[0].id : '';
    return {
      connected: count > 0,
      count: count,
      name: name
    };
  };

  /**
   * Sets operating mode
   * @param {number} newMode - MODE_OFF, MODE_PORT, MODE_KEYBOARD, MODE_BOTH
   * @param {Object} [keymap] - Optional keymap reference for releasing keys
   */
  this.setMode = function(newMode, keymap) {
    self.mode = parseInt(newMode, 10);
    if (self.mode === self.MODE_OFF || self.mode === self.MODE_PORT) {
      self.releaseAllKeys(keymap);
    }
  };

  /**
   * Releases all currently held virtual keys
   * @param {Object} [keymap]
   */
  this.releaseAllKeys = function(keymap) {
    keyQueue = [];
    keySentThisFrame = false;
    if (keymap) {
      if (activeDirectionCode !== -1) {
        keymap.key_byCodeRelease(activeDirectionCode);
        activeDirectionCode = -1;
      }
      if (activeFirePressed) {
        keymap.key_byCodeRelease(BK_KEY_SPACE);
        activeFirePressed = false;
      }
      if (activeEnterPressed) {
        keymap.key_byCodeRelease(BK_KEY_ENTER);
        activeEnterPressed = false;
      }
    }
    directionPressTime = 0;
    lastRepeatTime = 0;
  };

  /**
   * Polls connected gamepads and updates port mask and keyboard emulation.
   * Call once per frame inside emulator main loop (FPSloop).
   * 
   * @param {Object} keymap - Reference to KeyMapper instance
   * @param {Object} base - Reference to BKSystem instance
   * @returns {number} 16-bit word for port 177714
   */
  this.poll = function(keymap, base) {
    if (self.mode === self.MODE_OFF) {
      port177714Mask = 0;
      return 0;
    }

    keySentThisFrame = false;

    // Process queued key from previous frame
    if (keyQueue.length > 0 && keymap) {
      var nextCode = keyQueue.shift();
      keymap.key_byCodeHit(nextCode);
      keySentThisFrame = true;
    }

    var pads = getRawGamepads();
    var pad0 = null;
    var pad1 = null;

    // Find first two connected gamepads
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        if (!pad0) {
          pad0 = pads[i];
        } else if (!pad1) {
          pad1 = pads[i];
          break;
        }
      }
    }

    var joy1Mask = 0;
    var joy2Mask = 0;
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // ---- PROCESS JOYSTICK 1 (PAD 0) ----
    if (pad0) {
      var buttons = pad0.buttons || [];
      var axes = pad0.axes || [];

      // D-Pad buttons (Standard Gamepad Mapping)
      var dpadUp = buttons[12] && buttons[12].pressed;
      var dpadDown = buttons[13] && buttons[13].pressed;
      var dpadLeft = buttons[14] && buttons[14].pressed;
      var dpadRight = buttons[15] && buttons[15].pressed;

      // Analog Left Stick
      var stickX = axes[0] || 0;
      var stickY = axes[1] || 0;
      var stickUp = stickY < -self.deadzone;
      var stickDown = stickY > self.deadzone;
      var stickLeft = stickX < -self.deadzone;
      var stickRight = stickX > self.deadzone;

      // Combined directional inputs
      var isUp = dpadUp || stickUp;
      var isDown = dpadDown || stickDown;
      var isLeft = dpadLeft || stickLeft;
      var isRight = dpadRight || stickRight;

      // Mutual exclusivity for opposite axes
      if (isUp && isDown) { isUp = false; isDown = false; }
      if (isLeft && isRight) { isLeft = false; isRight = false; }

      // Action buttons
      var btnA = buttons[0] && buttons[0].pressed;       // A / Cross
      var btnB = buttons[1] && buttons[1].pressed;       // B / Circle
      var btnX = buttons[2] && buttons[2].pressed;       // X / Square
      var btnY = buttons[3] && buttons[3].pressed;       // Y / Triangle
      var btnL1 = buttons[4] && buttons[4].pressed;      // L1 / LB
      var btnR1 = buttons[5] && buttons[5].pressed;      // R1 / RB
      var btnSelect = buttons[8] && buttons[8].pressed;  // Select / Back
      var btnStart = buttons[9] && buttons[9].pressed;   // Start / Menu

      // Build hardware port mask for Joy 1
      if (isUp)    joy1Mask |= BK_JOY1_UP;
      if (isRight) joy1Mask |= BK_JOY1_RIGHT;
      if (isDown)  joy1Mask |= BK_JOY1_DOWN;
      if (isLeft)  joy1Mask |= BK_JOY1_LEFT;
      if (btnX || btnL1) joy1Mask |= BK_JOY1_A;
      if (btnA || btnR1) joy1Mask |= BK_JOY1_FIRE;
      if (btnB) joy1Mask |= BK_JOY1_ALTFIRE;
      if (btnY) joy1Mask |= BK_JOY1_B;

      // Keyboard mapping (for games that do not read port 177714)
      if ((self.mode === self.MODE_KEYBOARD || self.mode === self.MODE_BOTH) && keymap && base) {
        var targetDirCode = -1;

        // Resolve 8 directions
        if (isUp && isLeft) {
          targetDirCode = self.useDiagonals ? BK_KEY_UP_LEFT : BK_KEY_UP;
        } else if (isUp && isRight) {
          targetDirCode = self.useDiagonals ? BK_KEY_UP_RIGHT : BK_KEY_UP;
        } else if (isDown && isLeft) {
          targetDirCode = self.useDiagonals ? BK_KEY_DN_LEFT : BK_KEY_DOWN;
        } else if (isDown && isRight) {
          targetDirCode = self.useDiagonals ? BK_KEY_DN_RIGHT : BK_KEY_DOWN;
        } else if (isUp) {
          targetDirCode = BK_KEY_UP;
        } else if (isDown) {
          targetDirCode = BK_KEY_DOWN;
        } else if (isLeft) {
          targetDirCode = BK_KEY_LEFT;
        } else if (isRight) {
          targetDirCode = BK_KEY_RIGHT;
        }

        // Handle direction key state transitions
        if (targetDirCode !== activeDirectionCode) {
          if (activeDirectionCode !== -1) {
            keymap.key_byCodeRelease(activeDirectionCode);
          }
          if (targetDirCode !== -1) {
            sendKeyHit(keymap, targetDirCode);
            directionPressTime = now;
            lastRepeatTime = now;
          } else {
            directionPressTime = 0;
            lastRepeatTime = 0;
          }
          activeDirectionCode = targetDirCode;
        } else if (activeDirectionCode !== -1) {
          // Same direction is continuously held down
          base.keyboard_setKeyDown(true);

          // Auto-repeat generation for EMT 6 input
          if ((now - directionPressTime) > self.autoRepeatDelay && (now - lastRepeatTime) > self.autoRepeatRate) {
            base.keyboard_punch(activeDirectionCode);
            lastRepeatTime = now;
          }
        }

        // Handle Fire (Space)
        var fireRequested = (btnA || btnX || btnR1);
        if (fireRequested !== activeFirePressed) {
          if (fireRequested) {
            sendKeyHit(keymap, BK_KEY_SPACE);
          } else {
            keymap.key_byCodeRelease(BK_KEY_SPACE);
          }
          activeFirePressed = fireRequested;
        } else if (activeFirePressed) {
          base.keyboard_setKeyDown(true);
        }

        // Handle Enter / Start
        var enterRequested = (btnStart || btnB);
        if (enterRequested !== activeEnterPressed) {
          if (enterRequested) {
            sendKeyHit(keymap, BK_KEY_ENTER);
          } else {
            keymap.key_byCodeRelease(BK_KEY_ENTER);
          }
          activeEnterPressed = enterRequested;
        } else if (activeEnterPressed) {
          base.keyboard_setKeyDown(true);
        }
      }
    } else {
      // Pad 0 disconnected or released
      if (self.mode === self.MODE_KEYBOARD || self.mode === self.MODE_BOTH) {
        self.releaseAllKeys(keymap);
      }
    }

    // ---- PROCESS JOYSTICK 2 (PAD 1) ----
    if (pad1) {
      var b2 = pad1.buttons || [];
      var a2 = pad1.axes || [];

      var p2Up = (b2[12] && b2[12].pressed) || ((a2[1] || 0) < -self.deadzone);
      var p2Down = (b2[13] && b2[13].pressed) || ((a2[1] || 0) > self.deadzone);
      var p2Left = (b2[14] && b2[14].pressed) || ((a2[0] || 0) < -self.deadzone);
      var p2Right = (b2[15] && b2[15].pressed) || ((a2[0] || 0) > self.deadzone);

      if (p2Up && p2Down) { p2Up = false; p2Down = false; }
      if (p2Left && p2Right) { p2Left = false; p2Right = false; }

      var p2A = b2[0] && b2[0].pressed;
      var p2B = b2[1] && b2[1].pressed;
      var p2X = b2[2] && b2[2].pressed;
      var p2Y = b2[3] && b2[3].pressed;
      var p2Select = b2[8] && b2[8].pressed;
      var p2Start = b2[9] && b2[9].pressed;

      if (p2Up) joy2Mask |= BK_JOY1_UP;
      if (p2Right) joy2Mask |= BK_JOY1_RIGHT;
      if (p2Down) joy2Mask |= BK_JOY1_DOWN;
      if (p2Left) joy2Mask |= BK_JOY1_LEFT;
      if (p2Start) joy2Mask |= 0x10;
      if (p2A || p2X) joy2Mask |= 0x20;
      if (p2B || p2Y) joy2Mask |= 0x40;
      if (p2Select) joy2Mask |= 0x80;
    }

    // Combine Joy 1 and Joy 2 for port 177714
    if (self.mode === self.MODE_PORT || self.mode === self.MODE_BOTH) {
      port177714Mask = (joy1Mask & 0xFF) | ((joy2Mask & 0xFF) << 8);
    } else {
      port177714Mask = 0;
    }

    return port177714Mask;
  };

  initListeners();
  return this;
};

// Global browser window exports
if (typeof window !== 'undefined') {
  window.Joystick = Joystick;
  window.JoystickMapper = JoystickMapper;
  window.GamepadHandler = GamepadHandler;
  window.BK_JOY1_UP = BK_JOY1_UP;
  window.BK_JOY1_RIGHT = BK_JOY1_RIGHT;
  window.BK_JOY1_DOWN = BK_JOY1_DOWN;
  window.BK_JOY1_LEFT = BK_JOY1_LEFT;
  window.BK_JOY1_A = BK_JOY1_A;
  window.BK_JOY1_FIRE = BK_JOY1_FIRE;
  window.BK_JOY1_ALTFIRE = BK_JOY1_ALTFIRE;
  window.BK_JOY1_B = BK_JOY1_B;
}

// Node.js module exports for unit testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Joystick: Joystick,
    JoystickMapper: JoystickMapper,
    GamepadHandler: GamepadHandler,
    BK_JOY1_UP: BK_JOY1_UP,
    BK_JOY1_RIGHT: BK_JOY1_RIGHT,
    BK_JOY1_DOWN: BK_JOY1_DOWN,
    BK_JOY1_LEFT: BK_JOY1_LEFT,
    BK_JOY1_A: BK_JOY1_A,
    BK_JOY1_FIRE: BK_JOY1_FIRE,
    BK_JOY1_ALTFIRE: BK_JOY1_ALTFIRE,
    BK_JOY1_B: BK_JOY1_B,
    BK_KEY_LEFT: BK_KEY_LEFT,
    BK_KEY_RIGHT: BK_KEY_RIGHT,
    BK_KEY_UP: BK_KEY_UP,
    BK_KEY_DOWN: BK_KEY_DOWN,
    BK_KEY_UP_LEFT: BK_KEY_UP_LEFT,
    BK_KEY_UP_RIGHT: BK_KEY_UP_RIGHT,
    BK_KEY_DN_RIGHT: BK_KEY_DN_RIGHT,
    BK_KEY_DN_LEFT: BK_KEY_DN_LEFT,
    BK_KEY_SPACE: BK_KEY_SPACE,
    BK_KEY_ENTER: BK_KEY_ENTER
  };
}
