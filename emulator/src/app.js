/**
 * Эмулятор советского 16-битного компьютера семейства Электроника БК-0010/БК-0011М
 * Soviet 16-bit computer family "Elektronika BK-0010/BK-0011M" emulator
 * 
 * BK-0010/0011M Emulator Application
 * Main application file
 * 
 * This file contains:
 * - Emulator object (singleton pattern for main entry point)
 * - Main emulation loop (FPS management and CPU execution)
 * - File loading handlers (ROM, BIN, COD, disk images)
 * - Keyboard event handlers (physical and on-screen keyboard)
 * - UI event handlers and update loop
 * - User interface functions (boot menu, settings, controls)
 * - Fullscreen mode management
 * - Initialization code
 * 
 * Architecture:
 * - Uses singleton pattern for Emulator object
 * - Event-driven architecture for user input
 * - Periodic UI updates (every 3 seconds)
 * - Frame-based main loop with configurable FPS
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

// =====================================================
// Emulator - Main Entry Point (Singleton)
// =====================================================

var Emulator = (function() {
    
    // Private state
    var _initialized = false;
    var _components = {};
    
    // Public API
    var self = {
        // Core components (initialized later)
        base: null,
        cpu: null,
        dbg: null,
        bkkeys: null,
        keymap: null,
        joyMapper: null,
        fdc: null,
        
        // UI state
        soundOn: 0,
        overJoystick: 0,
        fullScreen: 0,
        touchButtons: true,
        
        // Runtime state
        autokeys: [],
        loadDsk: [],
        
        // Constants reference
        CONST: null
    };
    
    /**
     * Initialize the emulator
     */
    self.init = function() {
        if (_initialized) {
            console.warn('Emulator already initialized');
            return;
        }
        
        // Store constants reference
        self.CONST = BK_CONSTANTS;
        
        // Create core components
        self.dbg = new DBG();
        self.base = new BaseBK001x();
        self.cpu = new K1801VM1();
        self.bkkeys = new BKkeys();
        self.keymap = new KeyMapper();
        self.joyMapper = new JoystickMapper();
        self.fdc = new FDDController();
        
        // IMPORTANT: Set global references BEFORE cpu.reset()
        // because cpu_K1801VM1.js uses global 'base' variable
        base = self.base;
        cpu = self.cpu;
        dbg = self.dbg;
        bkkeys = self.bkkeys;
        keymap = self.keymap;
        joyMapper = self.joyMapper;
        fdc = self.fdc;
        
        // Setup keyboard event handlers
        document.onkeypress = keyact;
        document.onkeydown = keyact;
        document.onkeyup = keyact;
        
        // Reset CPU (now safe - global 'base' is set)
        self.cpu.reset();
        
        _initialized = true;
        console.log('Emulator initialized');
    };
    
    /**
     * Check if emulator is initialized
     */
    self.isInitialized = function() {
        return _initialized;
    };
    
    /**
     * Get component by name
     */
    self.getComponent = function(name) {
        return _components[name] || self[name];
    };
    
    return self;
})();

// =====================================================
// Global Variables (for backwards compatibility)
// Will be removed in future refactoring phases
// =====================================================

// Core emulator components (exposed globally for compatibility with existing code)
var base, cpu, dbg, bkkeys, keymap, joyMapper, fdc;

// UI state variables
var soundOn = 0;           // Sound enabled/disabled flag
var overJoystick = 0;      // Joystick mode enabled/disabled flag
var FullScreen = 0;        // Fullscreen mode state
var BK_autokeys = [];      // Auto-key sequence queue
var LOADDSK = [];          // Disk images loading queue
var Touch_Buttons = true;  // Touch interface buttons visibility

// On-screen keyboard state
var kbhnt = {
    cur: true,  // Current visibility state
    on: '<img src="content/bk_kb.png" width="960" height="380">',  // Keyboard image HTML
    off: ''     // Empty (hidden) state
};

// =====================================================
// Utility Functions
// =====================================================

/**
 * Get element by ID (shorthand helper)
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} DOM element
 */
function GE(id) {
    return document.getElementById(id);
}

/**
 * Get current window dimensions
 * @returns {{width: number, height: number}} Window dimensions
 */
function winWiHi() {
    return {
        width: window.innerWidth || 
               document.documentElement.clientWidth || 
               document.body.clientWidth,
        height: window.innerHeight || 
                document.documentElement.clientHeight || 
                document.body.clientHeight
    };
}

// Store initial window dimensions
var WindoW = winWiHi();

// =====================================================
// BK Auto-keys (for tape loading simulation)
// =====================================================

// Auto-key sequences for tape loading
var TAPE_SEQUENCES = {
    BINARY: [109, 111, 10, 109, 10, 109, 10, 115, 10, 115, 10], // "mo\nm\nm\ns\ns\n"
    BASIC: [99, 108, 111, 97, 100, 34, 109, 34, 44, 114, 10]     // "cload\"m\",r\n"
};

/**
 * Process auto-key sequence for tape loading
 * @param {boolean} pop - If true, remove first key from queue
 */
function BKautokeys(pop) {
    var keyQueue = BK_autokeys;
    
    if (pop) {
        keyQueue.shift();
    } else if (keyQueue.length && keyQueue[0]) {
        pushKey(keyQueue[0]);
        keyQueue[0] = 0;
    }
}

/**
 * Start tape loading sequence
 * @param {number} tapeType - 1 for BIN binary, 2 for COD basic text
 */
function BK_starttape(tapeType) {
    switch (tapeType) {
        case 1: // BIN binary file
            BK_autokeys = TAPE_SEQUENCES.BINARY.slice(); // Copy array
            break;
        case 2: // COD basic text for interpreter
            BK_autokeys = TAPE_SEQUENCES.BASIC.slice(); // Copy array
            break;
    }
}

// =====================================================
// Main Loop
// =====================================================

// Constants for timing
var INIT_RETRY_DELAY = 999;  // ms to wait before retrying initialization
var FRAME_DELAY_CALC = 1000; // ms divisor for FPS calculation

/**
 * Initialize FPS counter and start main emulation loop
 * Waits for drawing system to be ready before starting
 */
function FPSinit() {
    if (base.DRAW()) {
        FPSloop();
        BK_speed.initTicker();
    } else {
        // Drawing not ready yet, retry later
        setTimeout(FPSinit, INIT_RETRY_DELAY);
    }
}

// Event mask flags for special keys
var EVENT_NMI = 1;           // Bit 0: NMI (Non-Maskable Interrupt)
var EVENT_CYCLE_VIDEO = 2;   // Bit 1: Cycle video modes
var EVENT_RESET = 4;         // Bit 2: Reset CPU
var SPACE_KEY_CODE = 32;     // Space key interrupts auto-keys

/**
 * Check if debugger should break
 * @returns {boolean} True if should break
 */
function shouldDebuggerBreak() {
    return dbg.bp && (dbg.step || dbg.breakpoints());
}

/**
 * Check if waiting for disk to be loaded
 * @returns {boolean} True if waiting for disk
 */
function isWaitingForDisk() {
    return base.dsks && fdc.drives.length === 0;
}

/**
 * Process keyboard input and events
 */
function processKeyboardInput() {
    var key = keymap.pollKey();
    
    // Space key cancels auto-key sequence
    if (key === SPACE_KEY_CODE && BK_autokeys.length) {
        BK_autokeys = [];
    }
    
    // Send key to emulator
    if (key > -1) {
        base.keyboard_punch(key);
    } else {
        base.keyboard_setKeyDown(keymap.pollKeyHold());
    }
    
    return keymap.pollEvents();
}

/**
 * Process special keyboard events (NMI, video mode, reset)
 * @param {number} eventMask - Bitmask of events
 */
function processSpecialEvents(eventMask) {
    if (eventMask & EVENT_NMI) {
        cpu.nmi();
    }
    if (eventMask & EVENT_CYCLE_VIDEO) {
        base.cycleVideomodes();
    }
    if (eventMask & EVENT_RESET) {
        cpu.reset();
    }
}

/**
 * Execute CPU instructions for one frame
 */
function executeCPUFrame() {
    var targetCycles = cpu.Cycles + BK_speed.cyc;
    
    while (cpu.Cycles < targetCycles) {
        cpu.exec_insn();
        
        // Check for debugger breakpoint
        if (shouldDebuggerBreak()) {
            dbg.bp = 0;
            dbg.step = 0;
            dbg.show();
            break;
        }
        
        // Handle tape loading if prepared
        if (base.FakeTape.prep) {
            base.TapeBinLoader();
        }
    }
}

/**
 * Main emulation loop - processes one frame of emulation
 * @param {boolean} onetime - If true, run only once without scheduling next iteration
 */
function FPSloop(onetime) {
    // Skip if debugger is active
    if (!dbg.active) {
        // Run if one-time mode or animation not active
        if (onetime || !BK_speed.anim) {
            // Check if not waiting for disk
            if (!isWaitingForDisk()) {
                // Execute CPU instructions
                executeCPUFrame();
                
                // Process audio
                base.sound_push();
                
                // Update speed counter
                BK_speed.count();
                
                // Prevent cycle counter overflow
                base.minimizeCycles();
                
                // Handle keyboard input
                var eventMask = processKeyboardInput();
                
                // Process special events (NMI, video mode, reset)
                processSpecialEvents(eventMask);
                
                // Update joystick state
                base.joystick_setState(joyMapper.getJoystickState());
                
                // Process auto-keys if no special events
                if (eventMask <= 0) {
                    BKautokeys(0);
                }
                
                // Process interrupts
                base.irq();
                
                // Update display
                base.updCanvas();
            }
        }
    }
    
    // Schedule next frame
    if (!onetime) {
        var frameDelay = (FRAME_DELAY_CALC / BK_speed.fps) | 0;
        setTimeout(FPSloop, frameDelay);
    }
}

// =====================================================
// File Loading Handlers
// =====================================================

// File type constants
var FILE_EXT = {
    ROM: ".ROM",
    BIN: ".BIN",
    COD: ".COD",
    IMG: ".IMG",
    BKD: ".BKD"
};

// Tape loading delay (ms) — минимальная пауза после reset, чтобы БК успел перейти в режим ввода
var TAPE_START_DELAY = 4000;

/**
 * Check if filename has specific extension
 * @param {string} filename - Filename to check
 * @param {string} extension - Extension to look for
 * @returns {boolean} True if file has extension
 */
function hasExtension(filename, extension) {
    return filename.toUpperCase().indexOf(extension) > 0;
}

/**
 * Prepare tape loading
 * @param {string} filename - Tape filename
 * @param {Array} bytes - Tape data
 */
function prepareTapeLoad(filename, bytes) {
    var tape = base.FakeTape;
    tape.prep = true;
    tape.filename = filename;
    tape.bytes = bytes;
}

/**
 * Handle ROM file loading
 * @param {string} filename - ROM filename
 * @param {Array} bytes - ROM data
 */
function handleROMFile(filename, bytes) {
    base.loadROM(filename, bytes);
}

/**
 * Handle BIN binary file loading
 * @param {string} filename - BIN filename
 * @param {Array} bytes - BIN data
 */
function handleBINFile(filename, bytes) {
    cpu.reset();
    prepareTapeLoad(filename, bytes);
    setTimeout(function() {
        BK_starttape(1); // Binary tape type
    }, TAPE_START_DELAY);
}

/**
 * Handle COD BASIC text file loading
 * @param {string} filename - COD filename
 * @param {Array} bytes - COD data
 */
function handleCODFile(filename, bytes) {
    prepareTapeLoad(filename, bytes);
    setTimeout(function() {
        BK_starttape(2); // BASIC tape type
    }, TAPE_START_DELAY);
}

/**
 * Handle disk image file loading
 * @param {string} filename - Disk image filename
 * @param {Array} bytes - Disk image data
 */
function handleDiskFile(filename, bytes) {
    var isFirstDrive = (fdc.drives.length === 0);
    
    // Enable FDD if not already enabled
    if (!base.dsks) {
        base.setFDD11Model();
    }
    
    // Add disk to drive
    fdc.addDisk(filename, bytes);
    
    // Reset if this is the first drive
    if (isFirstDrive) {
        cpu.reset();
    }
    
    // Load next disk if queued
    if (LOADDSK.length > 1) {
        LOADDSK = LOADDSK.slice(1);
        GoDisks();
    }
}

/**
 * Main file loading callback
 * Called by Gbin when file is loaded
 * @param {string} filename - Loaded filename
 * @param {Array} bytes - File data
 */
Gbin.onGot = function(filename, bytes) {
    if (hasExtension(filename, FILE_EXT.ROM)) {
        handleROMFile(filename, bytes);
    }
    
    if (hasExtension(filename, FILE_EXT.BIN)) {
        handleBINFile(filename, bytes);
    }
    
    if (hasExtension(filename, FILE_EXT.COD)) {
        handleCODFile(filename, bytes);
    }
    
    if (hasExtension(filename, FILE_EXT.IMG) || hasExtension(filename, FILE_EXT.BKD)) {
        handleDiskFile(filename, bytes);
    }
};

// =====================================================
// Keyboard Event Handler
// =====================================================

// Keyboard key codes
var KEY_CODES = {
    F7: 118,      // Debug: Step
    F8: 119,      // Debug: Step Over
    F10: 121,     // Debug: Run
    F11: 122,     // Debug: Show/Hide
    ENTER: 13,    // Fullscreen toggle
    L: 76         // Cheat: Lives finder
};

/**
 * Handle debugger keyboard shortcuts
 * @param {KeyboardEvent} e - Keyboard event
 * @returns {boolean} True if debug key was handled
 */
function handleDebugKeys(e) {
    if (e.type !== "keydown") {
        return false;
    }
    
    var handled = false;
    
    if (e.keyCode === KEY_CODES.F10 && dbg.active) {
        dbg.Run();
        handled = true;
    }
    
    if (e.keyCode === KEY_CODES.F7 && dbg.active) {
        dbg.Step();
        handled = true;
    }
    
    if (e.keyCode === KEY_CODES.F8 && dbg.active) {
        dbg.StepOver();
        handled = true;
    }
    
    if (e.keyCode === KEY_CODES.F11 && !dbg.active) {
        dbg.show();
        handled = true;
    }
    
    return handled;
}

/**
 * Handle cheat and special function keys
 * @param {KeyboardEvent} e - Keyboard event
 */
function handleSpecialKeys(e) {
    if (e.type !== "keydown") {
        return;
    }
    
    // Ctrl+L: Lives finder cheat
    if (e.keyCode === KEY_CODES.L && e.ctrlKey) {
        cheatings.livesfinder();
    }
    
    // Ctrl/Alt+Enter: Toggle fullscreen
    if (e.keyCode === KEY_CODES.ENTER && (e.altKey || e.ctrlKey)) {
        FullScreen = 1;
    }
}

/**
 * Main keyboard event handler
 * @param {KeyboardEvent} e - Keyboard event
 */
function keyact(e) {
    // Try to handle debug keys first
    var debugKeyHandled = handleDebugKeys(e);
    
    if (!debugKeyHandled) {
        // Apply joystick mode substitution if enabled
        if (overJoystick) {
            e.keyCode = e.which = joyMapper.keysubstit(e.keyCode || e.which);
        }
        
        // Pass key events to key mapper
        if (e.type === "keydown") {
            keymap.keyHit(e);
        }
        if (e.type === "keyup") {
            keymap.keyRelease(e);
        }
        
        // Handle special keys (cheats, fullscreen)
        handleSpecialKeys(e);
    }
    
    // Prevent default browser action for emulator keys
    if (!dbg.active || debugKeyHandled) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// =====================================================
// Key Push/Pop Functions (для симуляции нажатий клавиш)
// =====================================================

// Special key codes
var NMI_KEY_CODE = 1000;       // Pseudo-key for triggering NMI
var ENTER_KEY_CODE = 10;       // Enter key code
var KEY_PRESS_DURATION = 450;  // Duration to hold key (ms)
var AUTO_KEY_DELAY = 200;      // Delay before processing next auto-key (ms)

/**
 * Simulate key press (used by touch interface and auto-keys)
 * @param {number} keyCode - BK key code to press
 * @param {boolean} hold - If true, don't auto-release (for touch mode)
 */
function pushKey(keyCode, hold) {
    // Special code for NMI trigger
    if (keyCode === NMI_KEY_CODE) {
        cpu.nmi();
        return;
    }
    
    // Handle joystick mode key substitution
    if (overJoystick && keyCode !== ENTER_KEY_CODE) {
        // Create synthetic keyboard event
        EVENT.type = "keydown";
        EVENT.keyCode = EVENT.which = joyMapper.bk2asc(keyCode);
        EVENT.location = 3;
        keyact(EVENT);
    } else {
        // Normal key press
        keymap.key_byCodeHit(keyCode);
    }
    
    // Auto-release key after delay (unless hold is requested)
    if (!hold) {
        setTimeout(function() { 
            popKey(keyCode); 
        }, KEY_PRESS_DURATION);
    }
}

/**
 * Simulate key release
 * @param {number} keyCode - BK key code to release
 */
function popKey(keyCode) {
    // Handle joystick mode key release
    if (overJoystick && keyCode !== ENTER_KEY_CODE) {
        // Create synthetic keyboard event
        EVENT.type = "keyup";
        EVENT.keyCode = EVENT.which = joyMapper.bk2asc(keyCode);
        EVENT.location = 3;
        keyact(EVENT);
    } else {
        // Normal key release
        keymap.key_byCodeRelease(keyCode);
        
        // Process next auto-key after delay
        setTimeout(function() { 
            BKautokeys(1); 
        }, AUTO_KEY_DELAY);
    }
}

// =====================================================
// User Interface Functions
// =====================================================

// UI element IDs
var UI_ELEMENTS = {
    KEYBOARD_BTN: "kbrd",
    KEYBOARD_IMG: "kbimage",
    PC_ADDR: "PCaddr",
    CANVAS: "BK_canvas",
    OPTIONS: "options",
    DROP_FILE: "dropfile",
    DEBUG_DIV: "debug_div",
    USERBOOT: "userboot"
};

// URL parameters
var URL_PARAMS = {
    GAME: 'game=',
    URL: 'URL='
};

var GAME_LOAD_DELAY = 2000;  // Delay before auto-loading game from URL (ms)

/**
 * Check if all required UI elements are loaded
 * @returns {boolean} True if all elements are ready
 */
function areUIElementsReady() {
    var requiredElements = [
        UI_ELEMENTS.KEYBOARD_BTN,
        UI_ELEMENTS.KEYBOARD_IMG,
        UI_ELEMENTS.PC_ADDR,
        UI_ELEMENTS.CANVAS,
        UI_ELEMENTS.OPTIONS,
        UI_ELEMENTS.DROP_FILE,
        UI_ELEMENTS.DEBUG_DIV
    ];
    
    for (var i = 0; i < requiredElements.length; i++) {
        if (GE(requiredElements[i]) === null) {
            return false;
        }
    }
    
    return true;
}

/**
 * Setup keyboard image event listener
 */
function setupKeyboardListener() {
    var keyboardImg = GE(UI_ELEMENTS.KEYBOARD_IMG);
    var eventType = TOUCH_ ? "touchstart" : "mousedown";
    keyboardImg.addEventListener(eventType, kbPressed, false);
}

/**
 * Check and handle URL parameters
 */
function handleURLParameters() {
    // Auto-load game if specified in URL
    var gameParamIndex = href.indexOf(URL_PARAMS.GAME);
    if (gameParamIndex > 0) {
        var gameName = href.substr(gameParamIndex + URL_PARAMS.GAME.length);
        setTimeout(function() {
            userGames(gameName);
        }, GAME_LOAD_DELAY);
    }
    
    // Check for URL parameter to load file directly
    // This is handled by Gbin.autoInit() in BinaryLoader.js
    Gbin.autoInit();
    
    // Hide userboot selector if URL parameter is present
    var urlParamIndex = href.indexOf(URL_PARAMS.URL);
    if (urlParamIndex > 0) {
        var userbootElement = GE(UI_ELEMENTS.USERBOOT);
        if (userbootElement) {
            userbootElement.style.visibility = 'hidden';
        }
    }
}

/**
 * Adaptive sizing for #dropfile: ensure whole emulator block fits vertically in viewport.
 * Uses actual position on page and approximates extra height above canvas.
 */
function resizeDropfile() {
    var drop = GE(UI_ELEMENTS.DROP_FILE);
    if (!drop) return;
    
    // Reset to CSS-defined max-width before recalculating
    drop.style.maxWidth = "";
    
    var rect = drop.getBoundingClientRect();
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    
    // Available vertical space from top of dropfile to bottom of viewport, with small bottom margin
    var bottomMargin = 16;
    var availableHeight = viewportHeight - rect.top - bottomMargin;
    if (availableHeight <= 0) return;
    
    // Approximate extra vertical size inside container (text, paddings, borders)
    var extra = 80;
    var maxCanvasHeight = availableHeight - extra;
    if (maxCanvasHeight <= 0) return;
    
    // For 4:3 aspect: width = height * 4/3
    var widthByHeight = maxCanvasHeight * 4 / 3;
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    var widthByViewport = viewportWidth * 0.95;
    
    var newMaxWidth = Math.min(1600, widthByHeight, widthByViewport);
    if (newMaxWidth > 0) {
        drop.style.maxWidth = newMaxWidth + "px";
    }
}

/**
 * Initialize emulator UI after page loads
 * Called when page loads, retries if elements not ready
 */
function loaded() {
    // Check if all required UI elements are loaded
    if (!areUIElementsReady()) {
        setTimeout(loaded, INIT_RETRY_DELAY);
        return;
    }
    
    // Initialize debug window
    dbg.init(UI_ELEMENTS.DEBUG_DIV);
    
    // Start main emulation loop
    FPSinit();
    
    // Initialize UI components
    touchLoads();
    kbShow();
    userColor();
    initVolumeSlider();
    
    // Setup event listeners
    setupKeyboardListener();
    setupFullscreenListeners();
    resizeDropfile();
    window.addEventListener('resize', resizeDropfile);

    // Handle URL parameters (auto-load games, etc.)
    handleURLParameters();
}

/**
 * User boot selection handler
 * Processes selections from the boot menu dropdown
 */
function userBoot() {
    var selectedValue = GE("userboot").value;
    
    // Clear any pending auto-keys
    BK_autokeys = [];
    
    switch (selectedValue) {
        // System modes
        case "B10":
            base.setBASIC10Model();
            cpu.reset();
            break;
            
        case "F10":
            base.setFOCAL10Model();
            cpu.reset();
            break;
            
        case "base10":
            base.setBase10Model();
            cpu.reset();
            break;
            
        // Disk drive modes
        case "FDD10":
            startdisks(0, [], 1);  // BK-0010 with FDD
            break;
            
        case "FDD11":
            startdisks(1, [], 1);  // BK-0011M with FDD
            break;
            
        // System controls
        case "FScr":
            openFullscreen();
            break;
            
        case "RST":
            cpu.reset();
            break;
            
        case "RLD":
            // Reload page without parameters
            document.location.href = href.split('?')[0];
            break;
            
        // Games and software from disks - BK-0010
        case "Alx0A330":
            startdisks(0, ["ALEXSOFT.zip"], 1);
            break;
            
        case "NORDBK":
            startdisks(0, ["NORDBK10.zip"], 1);
            break;
            
        case "POP":
            startdisks(0, ["PRINCE.zip"], 1);
            break;
            
        // Games and software from disks - BK-0011M
        case "Alx1A330":
            startdisks(1, ["ALEXSOFT.zip"], 1);
            break;
            
        case "CSIMir":
            startdisks(1, ["CSIMIR.zip"], 1);
            sColor(9);  // Switch to color mode after 9 seconds
            break;
            
        case "MPage":
            startdisks(1, ["MPAGE1.zip", "MPAGE2.zip"], 1);
            sColor(9);
            break;
            
        case "AODOS":
            startdisks(1, ["AODOS.zip"], 1);
            break;
            
        case "MKDOS":
            startdisks(1, ["MKDOS.zip"], 1);
            break;
            
        case "Robcop":
            startdisks(1, ["ROBOCOP.zip"], 1);
            break;
            
        case "Revolt":
            startdisks(1, ["MK317.zip", "REVOLT.zip"], 1);
            break;
            
        case "MiCo":
            startdisks(1, ["MK317.zip", "MIAMI.zip"], 1);
            break;
            
        case "Mega":
            startdisks(1, ["TDR.zip"], 1);
            sColor(3);  // Switch to color mode after 3 seconds
            break;
            
        case "MzRz":
            startdisks(1, ["MZRLSE.zip"], 1);
            sColor(3);
            break;
            
        case "Insl":
            startdisks(1, ["INSULT.zip"], 1);
            sColor(3);
            break;
            
        case "BKMna":
            startdisks(1, ["BKMANIA97.zip", "BKMANIA96.zip"], 1);
            break;
            
        case "RayDreams":
            startdisks(1, ["raydreams.zip"], 1);
            break;
            
        case "AOMD2":
            startdisks(1, ["ALEXSOFT.zip", "AOMEDIA2.zip"], 1);
            break;
            
        case "AOMD3":
            startdisks(1, ["ALEXSOFT.zip", "AOMEDIA3.zip"], 1);
            break;
            
        // Special cases
        case "Covox":
            userGames("covox.zip");
            soundOn = 1;
            GE("soundcard").value = "cvx";
            break;
            
        case "aDSK0":
            // Add empty disk
            if (base.dsks) {
                fdc.addDisk("empty.bkd", []);
            }
            break;
            
        case "DBG":
            dbg.show();
            break;
            
        case "Cheat":
            cheatings.cheathelp();
            break;
    }
}

/**
 * Start BK with disk drives
 * @param {boolean} isBK11M - True for BK-0011M, false for BK-0010
 * @param {Array<string>} diskFiles - Array of disk image filenames to load
 * @param {boolean} shouldReset - True to reset CPU after setup
 */
function startdisks(isBK11M, diskFiles, shouldReset) {
    // Set appropriate model with FDD support
    if (isBK11M) {
        base.setFDD11Model();
    } else {
        base.setFDD10Model();
    }
    
    // Load disk images if provided
    if (diskFiles.length > 0) {
        // Shutdown existing drives if any
        if (base.dsks) {
            fdc.shutdown();
        }
        
        // Queue disks for loading
        LOADDSK = diskFiles;
        GoDisks();
    }
    
    // Clear fake tape state
    var tape = base.FakeTape;
    tape.prep = false;
    tape.filename = "";
    tape.bytes = [];
    
    // Reset CPU if requested
    if (shouldReset) {
        cpu.reset();
    }
}

/**
 * Switch to color video mode after delay
 * @param {number} delaySec - Delay in seconds before switching
 */
function sColor(delaySec) {
    var COLOR_MODE = 2;
    setTimeout(function() { 
        base.setVideoMode(COLOR_MODE); 
    }, delaySec * 1000);
}

/**
 * Handle user color mode selection
 */
function userColor() {
    var selectedMode = GE("usercolor").value;
    
    var VIDEO_MODES = {
        "WB": 0,   // White/Black (monochrome)
        "GR4": 1,  // 4-color grayscale
        "COL": 2   // Color
    };
    
    var mode = VIDEO_MODES[selectedMode];
    if (mode !== undefined) {
        base.setVideoMode(mode);
    }
}

/**
 * Handle user speed selection
 */
function userSpeed() {
    var speed = BK_speed;
    var MHz = 1000000;
    var selectedSpeed = GE("userspeed").value;
    
    // Speed presets mapping
    var speedPresets = {
        // Real MHz modes
        "4MHz": function() { speed.MHz(4 * MHz, 0); },
        "an4MHz": function() { speed.MHz(4 * MHz, 1); },
        "3MHz": function() { speed.MHz(3 * MHz, 0); },
        "an3MHz": function() { speed.MHz(3 * MHz, 1); },
        
        // Custom presets with cycles and FPS
        "C4M": function() { speed.set(240000, 20); },
        "C3M": function() { speed.set(180000, 20); },
        "CS1": function() { speed.set(240000, 10); },
        "CS2": function() { speed.set(120000, 10); },
        "CS3": function() { speed.set(64000, 60); },
        "CS4": function() { speed.set(24000, 30); },
        "CS5": function() { speed.set(24000, 10); },
        "CF1": function() { speed.set(300000, 20); },
        "CF2": function() { speed.set(460000, 30); },
        "CF3": function() { speed.set(200000, 80); },
        "CF4": function() { speed.set(200000, 160); },
        "C50K4": function() { speed.set(50000, 250); },
        "C100K4": function() { speed.set(100000, 250); },
        "C200K4": function() { speed.set(200000, 250); },
        "C500K4": function() { speed.set(500000, 250); }
    };
    
    var preset = speedPresets[selectedSpeed];
    if (preset) {
        preset();
    }
    
    // Clear sound buffer after speed change
    base.soundClear();
}

/**
 * Load game from tape (BIN/COD file)
 * @param {string} filename - Optional filename, otherwise gets from dropdown
 */
function userGames(filename) {
    base.setBASIC10Model();
    cpu.reset();
    sColor(0);  // Switch to color immediately
    
    var file = filename || GE("usergames").value;
    if (file.length > 0) {
        Gbin.getUrl("files/" + file);
    }
}

/**
 * Start loading next disk from queue
 */
function GoDisks() {
    if (LOADDSK.length > 0) {
        Gbin.getUrl("files/" + LOADDSK[0]);
    }
}

/**
 * Handle user game selection from second dropdown (BK-0011M games)
 */
function userGM2() {
    var selectedFile = GE("usergm2").value;
    if (selectedFile !== "*") {
        startdisks(1, [selectedFile], 1);
    }
}

/**
 * Handle user BASIC program selection
 */
function userBasic() {
    var selectedFile = GE("userbasic").value;
    if (selectedFile !== "*") {
        Gbin.getUrl("files/" + selectedFile);
        sColor(0);  // Switch to color immediately
        cpu.reset();
    }
}

/**
 * Read memory dump as array of 16-bit words
 * @returns {Array<number>} Array of 16-bit words from entire memory (64K)
 */
function read16dump() {
    var dump = [];
    var MAX_ADDRESS = 0x10000;  // 64K address space
    var WORD_SIZE = 2;           // 16-bit = 2 bytes
    
    for (var addr = 0; addr < MAX_ADDRESS; addr += WORD_SIZE) {
        dump.push(base.readWORD(addr));
    }
    
    return dump;
}

// =====================================================
// UI Update Loop (runs every 3 seconds)
// =====================================================

// Fullscreen states
var FULLSCREEN_STATES = {
    OFF: 0,
    ACTIVATING: 1,
    ACTIVE: 2
};

// Z-index values for layering
var Z_INDEX = {
    CANVAS_FULLSCREEN: 8888,
    DEBUG_WINDOW: 9000
};

// Sound guess flags
var SOUND_FLAGS = {
    AY8910: 2,
    COVOX: 4
};

// Native canvas resolution (BK-0010 display)
var CANVAS_NATIVE_WIDTH = 512;
var CANVAS_NATIVE_HEIGHT = 256;

/**
 * Apply fullscreen layout: вычисляем максимально возможный прямоугольник 4:3,
 * вписываем его в окно и задаём эти размеры канвасу. Контейнер #dropfile сам по себе fullscreen.
 */
function applyFullscreenLayout() {
    WindoW = winWiHi();
    var w = WindoW.width;
    var h = WindoW.height;
    var displayW, displayH;
    var SAFE_MARGIN = 30;

    if (w / h >= 4 / 3) {
        // Ограничение по высоте, ширину подгоняем под 4:3
        displayH = Math.max(0, h - SAFE_MARGIN);
        displayW = Math.floor(h * 4 / 3);
    } else {
        // Ограничение по ширине, высоту подгоняем под 4:3
        displayW = Math.max(0, w - SAFE_MARGIN);
        displayH = Math.floor(displayW * 3 / 4);
    }

    var canvas = GE(UI_ELEMENTS.CANVAS);
    if (canvas) {
        canvas.style.width = displayW + "px";
        canvas.style.height = displayH + "px";
        canvas.style.maxWidth = "none";
        canvas.style.maxHeight = "none";
        canvas.style.margin = "auto";
    }

    FullScreen = FULLSCREEN_STATES.ACTIVE;
}

/**
 * Restore normal (non-fullscreen) layout: убираем принудительные размеры,
 * дальше размер контролируется обычным CSS.
 */
function restoreNormalLayout() {
    var canvas = GE(UI_ELEMENTS.CANVAS);
    if (canvas) {
        canvas.style.width = "";
        canvas.style.height = "";
        canvas.style.maxWidth = "";
        canvas.style.maxHeight = "";
        canvas.style.margin = "";
    }
    FullScreen = FULLSCREEN_STATES.OFF;
}

/**
 * Update fullscreen mode if needed (called from periodic UI loop; layout is driven by fullscreenchange).
 */
function updateFullscreenMode() {
    if (FullScreen === FULLSCREEN_STATES.ACTIVATING) {
        var el = getFullscreenElement();
        if (el) applyFullscreenLayout();
        else FullScreen = FULLSCREEN_STATES.OFF;
    }
}

/**
 * Keep debug window on top if active
 */
function updateDebugWindowZIndex() {
    if (dbg.active) {
        var debugDiv = GE(UI_ELEMENTS.DEBUG_DIV);
        if (debugDiv !== null) {
            debugDiv.style.zIndex = Z_INDEX.DEBUG_WINDOW;
        }
    }
}

/**
 * Update color mode selector to match current mode
 */
function updateColorModeSelector() {
    var colorSelect = GE("usercolor");
    if (colorSelect === null) return;
    
    var currentMode = base.getVideoMode();
    var modeNames = ["WB", "GR4", "COL"];
    var modeName = modeNames[currentMode] || "COL";
    
    if (modeName !== colorSelect.value) {
        colorSelect.value = modeName;
    }
}

/**
 * Update joystick checkbox state
 */
function updateJoystickCheckbox() {
    var joystickCheckbox = GE("overjoyst");
    if (joystickCheckbox !== null) {
        overJoystick = joystickCheckbox.checked ? 1 : 0;
    }
}

/**
 * Update sound on/off checkbox
 */
function updateSoundCheckbox() {
    var soundCheckbox = GE("soundonoff");
    if (soundCheckbox === null) return;
    
    var shouldBeOn = (soundOn === 1);
    if (soundCheckbox.value !== shouldBeOn) {
        soundCheckbox.checked = shouldBeOn;
        snd();
    }
}

/**
 * Determine sound card type based on sound guess
 * @param {number} soundGuess - Sound detection flags
 * @returns {string} Sound card identifier
 */
function determineSoundCard(soundGuess) {
    if (soundGuess & SOUND_FLAGS.COVOX) {
        return "cvx";
    }
    if (soundGuess & SOUND_FLAGS.AY8910) {
        return "8910c3";
    }
    return "spk";
}

/**
 * Update sound card selector and settings
 */
function updateSoundCardSelector() {
    var soundCard = GE("soundcard");
    if (soundCard === null) return;
    
    // Handle sound off state
    if (!soundOn) {
        soundCard.value = "none";
        snd();
    } else if (soundCard.value === "none") {
        // Auto-detect sound card
        var soundGuess = base.getSoundGuess();
        soundCard.value = determineSoundCard(soundGuess);
    }
    
    // Configure sound system based on selected card
    var cardType = soundCard.value;
    var isAY8910 = (cardType.substr(0, 4) === "8910");
    var hasPSG = cardType.indexOf("ps") > 0;
    var hasMixer = cardType.indexOf("mx") > 0;
    var isCovox = (cardType === "cvx");
    
    base.sounds(isAY8910, hasMixer, hasPSG, isCovox);
    soundCard.disabled = (soundOn === 0);
    
    // Auto-correct to channel 3 if PSG is used
    if (hasPSG) {
        setTimeout(snd3cn, 1000);
    }
}

/**
 * Update PC (Program Counter) address display
 */
function updatePCDisplay() {
    var pcDisplay = GE(UI_ELEMENTS.PC_ADDR);
    if (pcDisplay === null) return;
    
    var PC_REGISTER = 7;
    var pc = cpu.regs[PC_REGISTER].toString(8);  // Octal format
    var paddedPC = ("000000").substr(pc.length) + pc;
    pcDisplay.innerHTML = "PC:" + paddedPC;
}

/**
 * Build HTML for files loaded display
 * @returns {string} HTML string
 */
function buildFilesLoadedHTML() {
    var html = "";
    
    // HTML templates
    var fileStyle = '<FONT COLOR="brown"><b><u>';
    var downloadLink = '<div title="To download" onclick="download(';
    var downloadLinkMid = ')" style="display:inline;cursor:pointer">';
    var downloadLinkEnd = '</div><a id="DOWNLOAD';
    var styleEnd = '"></a></u></b></FONT> ';
    
    // Show tape file if loaded
    var tapeFilename = base.FakeTape.filename;
    if (tapeFilename.length > 0) {
        html += tapeFilename + "  ";
    }
    
    // Show disk files if loaded
    if (base.dsks) {
        for (var driveIndex in fdc.drives) {
            var drive = fdc.drives[driveIndex];
            html += fileStyle + downloadLink + driveIndex + downloadLinkMid + 
                    "[" + drive.diskId + "]" + downloadLinkEnd + driveIndex + 
                    styleEnd + drive.imageName + "  ";
        }
    }
    
    return html;
}

/**
 * Update files loaded display
 */
function updateFilesLoadedDisplay() {
    var filesDisplay = GE("filesloaded");
    if (filesDisplay === null) return;
    
    var html = buildFilesLoadedHTML();
    if (html.length > 0) {
        filesDisplay.innerHTML = html;
    }
}

/**
 * Setup fullscreen checkbox layout.
 * Canvas/dropfile sizes are adaptive (CSS); no fixed dimensions in normal mode.
 */
function setupFullscreenCheckbox() {
    var touchCheckbox = GE("TCFL");
    touchCheckbox.innerHTML = '<input type="checkbox" class="Ckbx" ' +
        'title="Включить полноэкранный режим" onclick="openFullscreen();">FullScreen<br>';
}

/**
 * Update touch buttons checkbox and layout
 */
function updateTouchButtonsCheckbox() {
    var touchCheckbox = GE("toucheson");
    if (touchCheckbox === null) return;
    
    touchCheckbox.checked = Touch_Buttons;
    
    var fullscreenContainer = GE("TCFL");
    
    // Setup fullscreen checkbox if touch buttons are off and not already setup
    if (!Touch_Buttons && fullscreenContainer.innerHTML.indexOf("FullScreen") < 0) {
        setupFullscreenCheckbox();
    }
    
    touchShow(Touch_Buttons);
}

/**
 * Main UI update loop - runs every 3 seconds
 * Updates various UI elements to reflect emulator state
 */
function userLoop3sec() {
    // Check if emulator is initialized
    if (!Emulator.isInitialized() || !dbg || !base || !cpu) {
        return;
    }
    
    // Update UI components
    updateFullscreenMode();
    updateDebugWindowZIndex();
    updateColorModeSelector();
    updateJoystickCheckbox();
    updateSoundCheckbox();
    updateSoundCardSelector();
    updatePCDisplay();
    updateFilesLoadedDisplay();
    updateTouchButtonsCheckbox();
}

// Start UI update loop (will be started after initialization)
var _uiUpdateInterval = null;

// =====================================================
// Sound Functions
// =====================================================

/**
 * Reset sound system (called when sound settings change)
 */
function snd() {
    base.soundClear();
}

/** Storage key for volume preference */
var VOLUME_STORAGE_KEY = 'bk-emulator-volume';

/** Default volume when none saved (first run): 0.15 */
var DEFAULT_VOLUME = 0.15;

/**
 * Slider position (0..1) -> volume (0..1).
 * First 80% of slider: 0..0.20 (step ~0.01), last 20%: 0.21..1.
 */
function positionToVolume(pos) {
    pos = Math.max(0, Math.min(1, pos));
    if (pos <= 0.8) return (pos / 0.8) * 0.20;
    return 0.21 + ((pos - 0.8) / 0.2) * (1 - 0.21);
}

/**
 * Volume (0..1) -> slider position (0..1).
 */
function volumeToPosition(vol) {
    vol = Math.max(0, Math.min(1, vol));
    if (vol <= 0.20) return (vol / 0.20) * 0.8;
    return 0.8 + ((vol - 0.21) / (1 - 0.21)) * 0.2;
}

/**
 * Set emulator volume from the volume slider (id="volume").
 * Saves actual volume to localStorage. Call from slider oninput/onchange.
 */
function setVolumeFromSlider() {
    var el = GE('volume');
    if (!el || typeof base === 'undefined') return;
    var pos = parseFloat(el.value, 10);
    if (isNaN(pos)) pos = volumeToPosition(DEFAULT_VOLUME);
    pos = Math.max(0, Math.min(1, pos));
    var vol = positionToVolume(pos);
    base.setVolume(vol);
    try { localStorage.setItem(VOLUME_STORAGE_KEY, String(vol)); } catch (e) {}
}

/**
 * Initialize volume slider: restore saved volume (or default 0.15) and attach handler.
 */
function initVolumeSlider() {
    var el = GE('volume');
    if (!el || typeof base === 'undefined') return;
    var vol = DEFAULT_VOLUME;
    var saved = null;
    try { saved = localStorage.getItem(VOLUME_STORAGE_KEY); } catch (e) {}
    if (saved !== null) {
        var v = parseFloat(saved, 10);
        if (!isNaN(v) && v >= 0 && v <= 1) vol = v;
    }
    el.value = volumeToPosition(vol);
    base.setVolume(vol);
    el.addEventListener('input', setVolumeFromSlider);
    el.addEventListener('change', setVolumeFromSlider);
}

/**
 * Force sound card selection to AY-8910 channel 3
 * Used for auto-correction when PSG mode is detected
 */
function snd3cn() {
    var soundCard = GE("soundcard");
    if (soundCard) {
        soundCard.value = "8910c3";
    }
}

// =====================================================
// Keyboard Functions (On-screen keyboard image)
// =====================================================

// Keyboard image offsets for coordinate calculation
var KEYBOARD_OFFSET = {
    X: 9,
    Y: 105
};

// Visual feedback for key press
var KEY_PRESS_VISUAL = {
    OFFSET_X: 12,
    OFFSET_Y: 32,
    SYMBOL: '&#9773',  // Hand pointing symbol
    DURATION: 300      // ms
};

/**
 * Toggle on-screen keyboard visibility
 */
function kbShow() {
    var keyboardButton = GE("kbrd");
    var keyboardImage = GE("kbimage");
    var hint = kbhnt;
    
    // Toggle visibility state
    hint.cur = !hint.cur;
    
    // Update button text
    keyboardButton.value = (hint.cur ? "Hide" : "Show") + " keyboard";
    
    // Update keyboard image visibility
    keyboardImage.innerHTML = (hint.cur ? hint.on : hint.off);
}

/**
 * Get X coordinate from event (handles both mouse and touch events)
 * @param {Event} event - Mouse or touch event
 * @returns {number} X coordinate
 */
function getEventX(event) {
    return (typeof(event.clientX) === "undefined") ? event.pageX : event.clientX;
}

/**
 * Get Y coordinate from event (handles both mouse and touch events)
 * @param {Event} event - Mouse or touch event
 * @returns {number} Y coordinate
 */
function getEventY(event) {
    return (typeof(event.clientY) === "undefined") ? event.pageY : event.clientY;
}

/**
 * Extract coordinates from touch event
 * @param {TouchEvent} e - Touch event
 * @returns {{X: number, Y: number}} Coordinates
 */
function getTouchCoordinates(e) {
    var coords = { X: 0, Y: 0 };
    
    // Try to get touch from event.touches
    var touch = event.touches[0];
    if (typeof(touch) !== "undefined") {
        coords.X = getEventX(touch);
        coords.Y = getEventY(touch);
        return coords;
    }
    
    // Try originalEvent.touches (for jQuery events)
    if (e.originalEvent && e.originalEvent.touches[0]) {
        touch = e.originalEvent.touches[0];
        coords.X = getEventX(touch);
        coords.Y = getEventY(touch);
        return coords;
    }
    
    // Fallback to event itself
    coords.X = getEventX(e);
    coords.Y = getEventY(e);
    return coords;
}

/**
 * Extract coordinates from mouse event
 * @param {MouseEvent} e - Mouse event
 * @returns {{X: number, Y: number}} Coordinates
 */
function getMouseCoordinates(e) {
    return {
        X: getEventX(e),
        Y: getEventY(e)
    };
}

/**
 * Check if event is a touch event
 * @param {string} eventType - Event type
 * @returns {boolean} True if touch event
 */
function isTouchEvent(eventType) {
    return eventType === 'touchstart' || eventType === 'touchmove' ||
           eventType === 'touchend' || eventType === 'touchcancel';
}

/**
 * Check if event is a mouse event
 * @param {string} eventType - Event type
 * @returns {boolean} True if mouse event
 */
function isMouseEvent(eventType) {
    return eventType === 'mousedown' || eventType === 'mouseup' ||
           eventType === 'mousemove' || eventType === 'mouseover' ||
           eventType === 'mouseout' || eventType === 'mouseenter' ||
           eventType === 'mouseleave';
}

/**
 * Show visual feedback for key press
 * @param {{X: number, Y: number}} coords - Coordinates for visual feedback
 */
function showKeyPressVisual(coords) {
    var visualElement = GE("kbvprsd");
    visualElement.style.left = parseInt(coords.X - KEY_PRESS_VISUAL.OFFSET_X) + "px";
    visualElement.style.top = parseInt(coords.Y - KEY_PRESS_VISUAL.OFFSET_Y) + "px";
    visualElement.innerHTML = KEY_PRESS_VISUAL.SYMBOL;
    
    setTimeout(clearKeyPressVisual, KEY_PRESS_VISUAL.DURATION);
}

/**
 * Clear visual feedback for key press
 */
function clearKeyPressVisual() {
    var visualElement = GE("kbvprsd");
    if (visualElement) {
        visualElement.innerHTML = "";
    }
}

/**
 * Handle keyboard image press/click
 * Determines which key was pressed on the on-screen keyboard
 * @param {Event} e - Mouse or touch event
 */
function kbPressed(e) {
    var coords = { X: 0, Y: 0 };
    
    // Extract coordinates based on event type
    if (isTouchEvent(e.type)) {
        coords = getTouchCoordinates(e);
    } else if (isMouseEvent(e.type)) {
        coords = getMouseCoordinates(e);
    }
    
    // Adjust coordinates relative to keyboard image
    var keyboardRect = GE("kbimage").getBoundingClientRect();
    coords.X -= (keyboardRect.left - KEYBOARD_OFFSET.X);
    coords.Y -= (keyboardRect.top - KEYBOARD_OFFSET.Y);
    
    // Send key press to emulator and show visual feedback
    if (bkkeys.kbpressed(coords)) {
        showKeyPressVisual(coords);
    }
}

/**
 * Legacy alias for clearKeyPressVisual
 * @deprecated Use clearKeyPressVisual instead
 */
function clrKbv() {
    clearKeyPressVisual();
}

// =====================================================
// Download Function (Disk Image Download)
// =====================================================

var DOWNLOAD_PREFIX = "nw_";  // Prefix for downloaded disk images

/**
 * Download disk image from emulator
 * Creates a blob from disk data and triggers download
 * @param {number} driveIndex - Index of the drive to download
 */
function download(driveIndex) {
    var downloadLink = GE("DOWNLOAD" + driveIndex);
    var disk = fdc.drives[driveIndex];
    
    // Get disk data resized to standard format (819200 bytes)
    var diskData = disk.reSized819200();
    
    // Create blob for download
    var blob = new Blob([diskData], { type: "text/plain" });
    
    // Setup download link
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = DOWNLOAD_PREFIX + disk.imageName;
    
    // Trigger download
    downloadLink.click();
}

// =====================================================
// Fullscreen Functions (Cross-browser fullscreen API)
// =====================================================

/**
 * Enter fullscreen mode: в fullscreen переводится контейнер #dropfile,
 * внутри которого находится только экран БК. Соотношение 4:3 задаётся CSS.
 */
function openFullscreen() {
    var dropfile = GE(UI_ELEMENTS.DROP_FILE);
    if (!dropfile) return;
    var el = dropfile;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
    else FullScreen = FULLSCREEN_STATES.OFF;
}

/**
 * Exit fullscreen mode
 * Uses cross-browser compatible fullscreen API
 */
function closeFullscreen() {
    var doc = document;
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
    // restoreNormalLayout() is called from fullscreenchange handler
}

/**
 * Get current fullscreen element (cross-browser).
 * @returns {Element|null}
 */
function getFullscreenElement() {
    var d = document;
    return d.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement || null;
}

/**
 * Setup fullscreen change listener: apply or restore layout when entering/leaving fullscreen.
 */
function setupFullscreenListeners() {
    var events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    function onFullscreenChange() {
        var el = getFullscreenElement();
        if (el) {
            FullScreen = FULLSCREEN_STATES.ACTIVATING;
            applyFullscreenLayout();
        } else {
            restoreNormalLayout();
        }
    }
    for (var i = 0; i < events.length; i++) {
        document.addEventListener(events[i], onFullscreenChange, false);
    }
}

// =====================================================
// Initialization
// =====================================================

// Store current page URL for later use (game loading, parameter parsing)
var href = document.location.href;

// =====================================================
// Early Initialization (executed immediately)
// =====================================================

// UI update interval (ms)
var UI_UPDATE_INTERVAL = 3000;

/**
 * Immediately Invoked Function Expression (IIFE)
 * Initializes emulator core components before page fully loads
 */
(function initializeEmulator() {
    // Initialize Emulator object and set up global references
    Emulator.init();
    
    // Start periodic UI update loop (updates every 3 seconds)
    _uiUpdateInterval = setInterval(userLoop3sec, UI_UPDATE_INTERVAL);
    
    console.log('BK Emulator core initialized successfully');
})();
