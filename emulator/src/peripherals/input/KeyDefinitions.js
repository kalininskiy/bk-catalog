/**
 * BK-0010 Keyboard Handler
 * 
 * Manages keyboard input mapping between modern HTML keycodes and BK-0010 character codes.
 * Supports:
 * - Latin and Russian (Cyrillic) layouts
 * - Shift modifier for uppercase/special characters
 * - AR2 (АР2) mode for additional special characters
 * - Virtual on-screen keyboard with touch support
 * - Function keys (F1-F12) for system commands
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
BKkeys = function()
{
  var self = this;
 
  // ============================================================================
  // KEY MAPPING DATA STRUCTURES
  // ============================================================================
  
  /**
   * Main keyboard mapping: HTML keycode -> BK-0010 character codes
   * Each entry contains codes for different states:
   * - Latin lowercase/uppercase
   * - Russian (Cyrillic) lowercase/uppercase  
   * - AR2 mode (special characters)
   */
  this.keymap = [];
  
  /**
   * Virtual keyboard layout data
   * Array of rectangular regions for on-screen keyboard
   */
  this.vkb = [];
  
  /**
   * AR2 (АР2) mode counter
   * When >0, next keypress produces special character
   * Used for symbols like @, #, $, etc.
   */
  var AP2 = false;
 
  // ============================================================================
  // KEY MAPPING HELPER FUNCTIONS
  // ============================================================================
  
  /**
   * Gets or creates key mapping entry for given HTML keycode
   * @param {number} cd - HTML keycode
   * @returns {Object} Key mapping object with all layout variants
   */
  function d(cd)
  {
    if (typeof(self.keymap[cd]) == "undefined") {
      self.keymap[cd] = {
        bk_lat_lcase: 0,    // Latin lowercase
        bk_lat_ucase: 0,    // Latin uppercase (with Shift)
        bk_rus_lcase: 0,    // Russian lowercase
        bk_rus_ucase: 0,    // Russian uppercase (with Shift)
        bk_ap2: 0           // AR2 mode code (АР2 + key)
      };
    }
    return self.keymap[cd];
  }
  
  /**
   * Maps Latin character: lowercase and uppercase (Shift)
   * @param {number} cd - HTML keycode
   * @param {number} L - BK code for lowercase
   * @param {number} U - BK code for uppercase (with Shift)
   */
  function lat(cd, L, U)
  {
    var O = d(cd);
    O.bk_lat_lcase = L;
    O.bk_lat_ucase = U;
  }
  
  /**
   * Maps Latin character that's same in both cases
   * @param {number} cd - HTML keycode
   * @param {number} bk - BK code (same for lowercase and uppercase)
   */
  function lats(cd, bk) {
    lat(cd, bk, bk);
  }

  /**
   * Maps Russian (Cyrillic) character: lowercase and uppercase (Shift)
   * @param {number} cd - HTML keycode
   * @param {number} L - BK code for lowercase
   * @param {number} U - BK code for uppercase (with Shift)
   */
  function rus(cd, L, U)
  {
    var O = d(cd);
    O.bk_rus_lcase = L;
    O.bk_rus_ucase = U;
  }

  /**
   * Maps Latin character with AR2 (АР2) special character support
   * @param {number} cd - HTML keycode
   * @param {number} L - BK code for lowercase
   * @param {number} U - BK code for uppercase (with Shift)
   * @param {number} ap2 - BK code when AR2 mode is active
   */
  function latap2(cd, L, U, ap2)
  {
    var O = d(cd);
    lat(cd, L, U);
    O.bk_ap2 = ap2;
  }
 
  // ============================================================================
  // KEYBOARD MAPPING INITIALIZATION
  // ============================================================================
  
  function init()
  {
    // ---- CYRILLIC (RUSSIAN) LAYOUT MAPPING ----
    // Maps QWERTY keys to ЙЦУКЕН (Russian) layout for BK-0010
    // Each element: HTML keycode for the QWERTY position
    var m = [
      190/*ю*/, 70/*а*/, 188/*б*/, 87/*ц*/, 76/*д*/,
      84/*е*/,  65/*ф*/, 85/*г*/, 219/*х*/, 66/*и*/, 81/*й*/, 82/*к*/,
      75/*л*/,  86/*м*/, 89/*н*/, 74/*о*/,  71/*п*/, 90/*я*/, 72/*р*/,
      67/*с*/,  78/*т*/, 69/*у*/, 186/*ж*/, 68/*в*/,
      77/*ь*/,  83/*ы*/, 80/*з*/, 73/*ш*/, 222/*э*/, 79/*щ*/, 88/*ч*/, 221/*ъ*/, 192/*ё*/
    ];
    
    // ---- CONTROL KEYS ----
    lat(8/*Backspace*/, 24/*BS*/, 19/*VS <=|*/);
    lat(9/*Tab*/, 137/*TAB*/, 20/*TAB8*/);
    lats(13/*Enter*/, 10/*VVOD*/);
    
    // Special modifier keys (not mapped):
    // 16=Shift, 17=Ctrl, 18=Alt, 20=CapsLock
    
    // Note: 19=Pause/Break, 27=ESC could map to STOP in future
    
    lats(32/*Space*/, 32/*PROBEL*/);
    
    // Navigation keys (not mapped):
    // 33=PgUp, 34=PgDn, 35=End, 36=Home
    
    // ---- ARROW KEYS (BK-0010 cursor control) ----
    lats(37/*Left*/,  8);
    lats(38/*Up*/,    26);
    lats(39/*Right*/, 25);
    lats(40/*Down*/,  27);
  
    // Other special keys (not mapped):
    // 44=PrntScrn, 45=Insert, 46=Delete
    // 91=WIN Key Start, 93=WIN Menu
    // 144=NumLock, 145=ScrollLock
    
    // ---- PUNCTUATION MARKS ----
    latap2(188, 44/*,*/, 60/*<*/, 156);          // Comma, Less than, AR2
    latap2(190, 46/*.*/, 62/*>*/, 158);          // Period, Greater than, AR2
    latap2(191, 47/*/*/, 63/*?*/, 159);          // Slash, Question, AR2
    lat(192, 96/*`*/, 126/*~*/);                 // Backtick, Tilde
    lat(219, 91/*[*/, 123/*{*/);                 // Left bracket, Left brace
    lat(220, 92/*\*/, 124/*|*/);                 // Backslash, Pipe
    lat(221, 93/*]*/, 125/*}*/);                 // Right bracket, Right brace
    lat(222, 39/*'*/, 34/*"*/);                  // Quote, Double quote

    latap2(186, 59/*;*/, 58/*:*/, 155);          // Semicolon, Colon, AR2
    lat(187, 61/*=*/, 43/*+*/);                  // Equal, Plus
    latap2(189, 45/*-*/, 95/*_*/, 157);          // Minus, Underscore, AR2
    
    // ---- FIREFOX BROWSER COMPATIBILITY ----
    // Firefox uses different keycodes for some punctuation
    if (navigator.userAgent.indexOf("Firefox") >= 0) {
      latap2(59, 59/*;*/, 58/*:*/, 155);         // Semicolon (Firefox)
      lat(61, 61/*=*/, 43/*+*/);                 // Equal (Firefox)
      latap2(173, 45/*-*/, 95/*_*/, 157);        // Minus (Firefox)
    }
  
    // ---- NUMBER ROW (with Shift symbols and AR2 mode) ----
    // AR2 mode provides access to special symbols like @, #, $, etc.
    latap2(49, 49/*1*/, 33/*!*/, 177);           // 1, !, AR2
    latap2(50, 50/*2*/, 64/*@*/, 178);           // 2, @, AR2
    latap2(51, 51/*3*/, 35/*#*/, 179);           // 3, #, AR2
    latap2(52, 52/*4*/, 36/*$*/, 180);           // 4, $, AR2
    latap2(53, 53/*5*/, 37/*%*/, 181);           // 5, %, AR2
    latap2(54, 54/*6*/, 94/*^*/, 182);           // 6, ^, AR2
    latap2(55, 55/*7*/, 38/*&*/, 183);           // 7, &, AR2
    latap2(56, 56/*8*/, 42/***/, 184);           // 8, *, AR2
    latap2(57, 57/*9*/, 40/*(*/, 185);           // 9, (, AR2
    latap2(48, 48/*0*/, 41/*)*/, 186);           // 0, ), AR2
    
    // ---- FUNCTION KEYS (F1-F12) ----
    // Map to BK-0010 system functions
    lat(112/*F1*/, 129/*ПОВТ*/, 14/*РУС*/);                // Repeat / Switch to Russian
    lat(113/*F2*/, 3/*КТ*/, 15/*ЛАТ*/);                    // KT / Switch to Latin
    lat(114/*F3*/, 153/*=|=>*/, 1002/*Video modes*/);      // Graphics mode toggle
    lats(115/*F4*/, 22/*|<=*/);                            // Cursor left (block)
    lats(116/*F5*/, 23/*|=>*/);                            // Cursor right (block)
    lats(117/*F6*/, 130/*ИНД СУ*/);                        // Index down
    lats(118/*F7*/, 132/*БЛОК РЕД*/);                      // Block edit mode
    lats(119/*F8*/, 144/*ШАГ*/);                           // Step mode (debugger)
    lats(120/*F9*/, 12/*СБР*/);                            // Reset
    lat(121/*F10*/, 155/*32,64*/, 157/*inverted*/);        // Screen mode / Invert colors
    lats(122/*F11*/, 0);                                   // Not mapped
    lats(123/*F12*/, 1004/*Reset*/);                       // System reset
    
    // ---- AUTOMATIC LETTER MAPPING ----
    var i;
    
    // Latin letters A-Z (keycodes 65-90)
    // Lowercase: a-z (ASCII 97-122), Uppercase: A-Z (ASCII 65-90)
    for (i = 65; i < 91; i++) {
      lat(i, i + 32, i);
    }
    
    // Cyrillic letters (Russian ЙЦУКЕН layout on QWERTY keyboard)
    // Maps to BK character codes: 64-95 (lowercase), 96-127 (uppercase)
    // Note: BK-0010 doesn't have 'ё' in standard charset (32 letters, not 33)
    for (i = 0; i < 32; i++) {
      rus(m[i], 64 + i, 96 + i);
    }
  }

  // ============================================================================
  // PUBLIC API - KEY TRANSLATION
  // ============================================================================
  
  /**
   * Translates HTML key event to BK-0010 character code
   * @param {number} key - HTML keycode
   * @param {boolean} shift - Shift key pressed
   * @param {boolean} alt - Alt key pressed (activates AR2 mode)
   * @param {boolean} rus - Russian layout active
   * @returns {Object|number} Object with {code, isAp2} or -1 if not mapped
   */
  this.getMappedKey = function(key, shift, alt, rus) {
    
    // Check if this key is mapped
    if (typeof(self.keymap[key]) == "undefined") {
      return -1;  // Key not mapped
    }
    
    var o = self.keymap[key];
    var Ob = { code: 0, isAp2: false };
    
    // AR2 mode has priority (Alt + key for special characters)
    if (alt && o.bk_ap2) {
      Ob.code = o.bk_ap2;      // Use AR2 code
      Ob.isAp2 = true;
    }
    else
    {
      // If no Russian mapping exists for this key, force Latin
      if (!(o.bk_rus_ucase | o.bk_rus_lcase)) {
        rus = false;
      }
      
      // Select appropriate code based on layout and shift state
      Ob.code = (rus 
        ? (shift ? o.bk_rus_ucase : o.bk_rus_lcase)   // Russian
        : (shift ? o.bk_lat_ucase : o.bk_lat_lcase)   // Latin
      );
    }
    
    return Ob;
  }
 
  // ============================================================================
  // VIRTUAL ON-SCREEN KEYBOARD
  // ============================================================================
  
  /**
   * Initializes virtual keyboard layout data
   * Creates rectangular button regions for on-screen keyboard rendering
   * Layout matches physical BK-0010 keyboard image
   */
  function vkbinit() {
    
    // ---- POSITION DATA ----
    // Encoded array: pairs of [deltaX, deltaY] to define key rectangles
    // Negative values indicate row transitions
    // This data was carefully measured from BK-0010 keyboard image
    var P = [
      6,10,88,64,5,-63,86,63,5,-65,86,63,9,-63,84,62,7,
      -63,86,63,10,-64,82,65,8,-66,83,63,13,-63,80,65,10,-65,97,63,13,
      -63,95,62,-947,5,57,58,5,-62,56,64,5,-61,57,61,4,-62,57,61,6,
      -60,56,61,4,-62,58,62,6,-64,55,64,5,-64,57,63,6,-63,52,64,9,
      -64,57,63,5,-62,55,60,8,-60,54,61,8,-64,51,63,9,-62,55,61,8,
      -63,83,66,-947,0,84,62,8,-64,56,62,4,-59,56,61,7,-62,57,60,5,
      -62,57,61,6,-60,54,59,6,-59,56,58,6,-60,56,61,5,-61,57,60,5,
      -59,56,61,5,-61,54,59,9,-60,55,60,8,-61,51,58,11,-57,50,58,11,
      -59,52,57,-947,5,100,64,7,-63,56,61,6,-61,53,63,8,-62,58,61,4,
      -62,56,60,6,-60,54,60,7,-60,55,61,7,-60,57,59,4,-61,55,60,7,
      -60,55,61,7,-61,53,62,8,-62,56,62,5,-61,54,59,9,-60,97,58,
      -943,5,67,55,6,-56,60,59,2,-59,60,59,3,-60,57,60,5,-58,58,58,4,
      -59,56,57,5,-57,56,58,5,-57,58,56,4,-56,57,54,4,-55,57,56,5,
      -58,56,59,8,-58,69,61,-764,-2,118,61,5,-59,71,58,4,-57,444,
      59,4,-62,117,59,5,-115,56,116,7,-121,56,61,-59,0,60,61,1,-117,58,116
    ];
    
    // ---- KEY ASSIGNMENTS ----
    // Arrays mapping virtual keyboard buttons to HTML keycodes
    
    // G: Lowercase Latin keys (QWERTY layout)
    var G = [
      186,49,50,51,52,53,54,55,56,57,48,189,186,74,
      67,85,75,69,78,71,219,221,90,72,221,191,70,89,87,65,
      80,82,79,76,68,86,220,190,81,54,83,77,73,84,88,66,50,188
    ];
    
    // g: Indices of keys that require Shift to be held (lowercase)
    var g = [23, 37, 57, 64];
    
    // F: Uppercase Latin / Special character keys
    var F = [187,49,222,51,52,53,55,222,57,48,219,187,56,191,190,188];
    
    // f: Indices of keys that require Shift to be held (uppercase)
    var f = [11,12,13,14,15,16,17,19,20,21,23,38,52,65];
    
    // H: Special function keys (Tab, arrows, etc.)
    var H = [9,24,25,39,53,68,70,71,72,73];
    
    // h: Corresponding BK codes for special keys
    var h = [27,8,9,8,13,32,37,38,40,39];
    
    // R: Russian (Cyrillic) ЙЦУКЕН layout keys
    var R = [
      81,87,69,82,84,89,85,73,79,80,219,221,
      65,83,68,70,71,72,74,75,76,186,222,90,88,67,86,66,78,77,188,190
    ];
    
    // ---- BUILD KEYBOARD LAYOUT ----
    var X = 9, Y = 105;       // Starting position (pixels)
    var c = 0;                // Toggle flag for key/gap
    var x, y, i, k;
    var a = self.vkb;
    
    // Parse position data to create rectangular regions
    for (i = 0; i < 296; c ^= 1) {
      x = X;
      y = Y;
      X += P[i++];
      Y += P[i++];
      
      // Every other iteration creates a key button
      if (c) {
        a.push({
          all: 0,           // Keycode (all modes)
          lo: 0,            // Lowercase Latin keycode
          lo_sh: 0,         // Lowercase requires Shift flag
          hi: 0,            // Uppercase/Special keycode
          hi_sh: 0,         // Uppercase requires Shift flag
          ru: 0,            // Russian keycode
          X0: x - 4,        // Left edge
          Y0: y,            // Top edge
          X2: X,            // Right edge
          Y2: Y             // Bottom edge
        });
      }
    }
    
    // ---- ASSIGN KEY FUNCTIONS ----
    
    // Function keys F1-F9
    for (i = 0; i < 9; i++) {
      a[i].all = 112 + i;
    }
    
    // Lowercase Latin keys
    for (i = 0, k = 11; i < 48; ) {
      a[k++].lo = G[i++];
      k += ((i == 13 || i == 26) ? 2 : ((i == 38) ? 3 : 0));
    }
    
    // Mark keys that need Shift (lowercase)
    for (i = 0; i < 4; ) {
      a[g[i++]].lo_sh = 1;
    }
    
    // Uppercase / Special character keys
    for (i = 0, k = 11; i < 17; ) {
      a[k++].hi = F[i++];
      k += ((i == 13) ? 14 : ((i == 14) ? 13 : ((i == 15) ? 12 : 0)));
    }
    
    // Mark keys that need Shift (uppercase)
    for (i = 0; i < 14; ) {
      a[f[i++]].hi_sh = 1;
    }
    
    // Special function keys
    for (i = 0; i < 10; i++) {
      a[H[i]].all = h[i];
    }
    
    // Russian (Cyrillic) keys
    for (i = 0, k = 26; i < 32; i++) {
      a[k++].ru = R[i];
      k += ((i == 11) ? 3 : ((i == 22) ? 4 : 0));
    }
  }
 
  // ============================================================================
  // PUBLIC API - VIRTUAL KEYBOARD INTERACTION
  // ============================================================================
  
  /**
   * Handles virtual keyboard button press (mouse or touch)
   * Detects which key was pressed based on coordinates
   * @param {Object} U - Input coordinates {X, Y}
   * @returns {number} BK character code (0 if no key pressed)
   */
  this.kbpressed = function(U) {
    var a = self.vkb;
    var b = self.keymap;
    var g, o = null;
    var p, cd = 0, i;
    var Caps = keymap.getCaps();
    
    // Decrement AR2 mode counter if active
    if (AP2) AP2--;
    
    // ---- FIND WHICH KEY WAS PRESSED ----
    for (i = 0; i < a.length; i++) {
      g = a[i];
      a[i].i = i;  // Store index for reference
      
      // Check if coordinates are within this key's rectangle
      if (U.X >= g.X0 && U.Y >= g.Y0 && U.X <= g.X2 && U.Y <= g.Y2) {
        o = a[i];
      }
    }
    
    // ---- PROCESS KEY PRESS ----
    if (o != null) {
      // Center coordinates on the pressed key (for visual feedback)
      U.X = (o.X0 + o.X2) / 2;
      U.Y = (o.Y0 + o.Y2) / 2;
      
      // ---- SPECIAL SYSTEM KEYS ----
      if (o.i == 9) {                            // NMI button (interrupt)
        cpu.nmi();
        return 1;
      }
      
      if (o.i == 10 || o.i == 54 || o.i == 55) { // Caps Lock keys
        keymap.Capsed();
        return 1;
      }
      
      if (o.i == 66) {                           // Switch to Russian
        keymap.setRus();
        return 1;
      }
      
      if (o.i == 69) {                           // Switch to Latin
        keymap.setLat();
        return 1;
      }
      
      if (o.i == 67) {                           // AR2 mode activation
        AP2 = 2;
        return 1;
      }
      
      // ---- DETERMINE CHARACTER CODE ----
      // Try different key modes in priority order
      
      // 1. Universal keys (work in all modes)
      if (!cd && o.all) {
        p = b[o.all];
        cd = (Caps ? p.bk_lat_ucase : p.bk_lat_lcase);
      }
      
      // 2. Uppercase/special characters (with Caps Lock)
      if (!cd && Caps && o.hi) {
        p = b[o.hi];
        cd = (o.hi_sh ? p.bk_lat_ucase : p.bk_lat_lcase);
      }
      
      // 3. Russian (Cyrillic) mode
      if (!cd && keymap.isRus() && o.ru) {
        p = b[o.ru];
        cd = (Caps ? p.bk_rus_ucase : p.bk_rus_lcase);
      }
      
      // 4. Lowercase Latin (default)
      if (!cd && o.lo) {
        p = b[o.lo];
        cd = (o.lo_sh ? p.bk_lat_ucase : p.bk_lat_lcase);
        
        // Apply Caps Lock to letters
        if (cd > 96 && cd < 123 && Caps) {
          cd -= 32;  // Convert lowercase to uppercase
        }
        
        // Apply AR2 mode to numbers
        if (cd > 47 && cd < 58 && AP2 && p.bk_ap2) {
          cd = p.bk_ap2;
        }
      }

      // ---- SEND KEY TO EMULATOR ----
      if (cd) {
        pushKey(cd);
      }
    }
    
    return cd;
  }
 
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  init();              // Initialize keyboard mappings
  vkbinit();           // Initialize virtual keyboard layout
  
  return this;         // Return public interface
}
