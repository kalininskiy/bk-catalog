/**
 * BK-0010/0011M Emulator Constants
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

"use strict";

// =====================================================
// QBus Read Data Transfer Object
// Used for passing read results from memory/peripherals
// =====================================================
var QBusReadDTO = function(v) {
    // Support calling without 'new' keyword
    if (!(this instanceof QBusReadDTO)) {
        return new QBusReadDTO(v);
    }
    this.value = v;
    return this;
};

var BK_CONSTANTS = (function() {
    
    // =====================================================
    // I/O Ports (addresses in decimal, octal in comments)
    // =====================================================
    var PORTS = {
        // Keyboard ports
        KEYBOARD_STATUS:    65456,  // 0o177660
        KEYBOARD_DATA:      65458,  // 0o177662
        
        // System registers
        SCROLL_REG:         65460,  // 0o177664
        PALETTE_REG:        65458,  // 0o177662 (BK-11M only)
        
        // System control
        SYS_REG_A:          65472,  // 0o177700
        SYS_REG_B:          65474,  // 0o177702
        SYS_REG_C:          65476,  // 0o177704
        
        // Timer ports
        TIMER_START:        65478,  // 0o177706
        TIMER_COUNT:        65480,  // 0o177710
        TIMER_CONFIG:       65482,  // 0o177712
        
        // I/O ports (joystick, sound, etc.)
        IO_WRITE_REG:       65484,  // 0o177714
        IO_READ_REG:        65486,  // 0o177716
        
        // FDD Controller
        FDD_STATUS:         65112,  // 0o177130
        FDD_DATA:           65114   // 0o177132
    };
    
    // =====================================================
    // Memory Map
    // =====================================================
    var MEMORY = {
        // RAM regions
        RAM_START:          0,
        RAM_SIZE:           32768,      // 32KB for BK-0010
        
        // Video memory
        VIDEO_START:        0o40000,    // 16384 decimal
        VIDEO_SIZE:         16384,      // 16KB
        
        // ROM regions (mapped addresses in memory array)
        MONITOR_ROM:        65536,      // Monitor ROM base in memory array
        BASIC_ROM:          69632,      // Basic ROM (0o120000 logical)
        BOS_ROM:            81920,      // BK-11M BOS
        EXT_ROM:            86016,      // BK-11M Extended
        BASIC11_P2:         90112,      // BK-11M Basic part 2
        BASIC11_P1:         94208,      // BK-11M Basic part 1
        DISK_ROM:           102400,     // Disk controller ROM (0o160000 logical)
        
        // Logical addresses
        ADDR_100000:        0o100000,   // 32768 - Monitor start
        ADDR_120000:        0o120000,   // 40960 - Basic/Focal start
        ADDR_160000:        0o160000,   // 57344 - Disk ROM start
        
        // Page size
        PAGE_SIZE:          4096,       // 4KB pages
        PAGE_SHIFT:         13          // Bits to shift for page number
    };
    
    // =====================================================
    // Video Constants
    // =====================================================
    var VIDEO = {
        // Canvas dimensions
        CANVAS_WIDTH:       512,
        CANVAS_HEIGHT:      256,
        
        // Display dimensions  
        DISPLAY_WIDTH:      660,
        DISPLAY_HEIGHT:     480,
        
        // Video modes
        MODE_BW:            0,          // Black & White
        MODE_GRAY4:         1,          // 4 grayscale colors
        MODE_COLOR16:       2,          // 16 colors
        
        // Buffer sizes
        FRAMEBUFFER_SIZE:   131072,     // 512 * 256
        
        // Video memory base addresses
        VIDEO_BASE_11M:     57344,      // 0o160000
        VIDEO_BASE_10:      8192        // 0o20000
    };
    
    // =====================================================
    // CPU Constants
    // =====================================================
    var CPU = {
        // PSW flags
        FLAG_C:             0x01,       // Carry
        FLAG_V:             0x02,       // Overflow
        FLAG_Z:             0x04,       // Zero
        FLAG_N:             0x08,       // Negative
        FLAG_T:             0x10,       // Trace
        FLAG_I:             0x80,       // Interrupt disable
        FLAG_NZVC:          0x0F,       // All condition flags
        
        // Register indices
        REG_R0:             0,
        REG_R1:             1,
        REG_R2:             2,
        REG_R3:             3,
        REG_R4:             4,
        REG_R5:             5,
        REG_SP:             6,
        REG_PC:             7,
        
        // Trap vectors
        TRAP_BUS_ERROR:     4,
        TRAP_ILLEGAL:       8,
        TRAP_BPT:           12,
        TRAP_IOT:           16,
        TRAP_EMT:           24,
        TRAP_TRAP:          28,
        TRAP_KEYBOARD:      48,         // 0o60
        TRAP_IRQ:           64,         // 0o100
        TRAP_KEYBOARD_AR2:  188,        // 0o274
        
        // Timing
        DEFAULT_PSW:        224,        // 0o340 - default PSW value
        TIMER_PERIOD:       128         // CPU cycles per timer tick
    };
    
    // =====================================================
    // Sound Constants
    // =====================================================
    var SOUND = {
        // Sample rate
        SAMPLE_RATE:        48000,
        
        // Buffer sizes
        BUFFER_SIZE:        4096,
        MAX_BUFFER_SIZE:    1048576,    // 1MB max
        
        // AY-8910 constants
        AY_NUM_REGS:        16,
        AY_CYCLES_PER_SAMPLE: 4000,
        
        // Volume table for AY-8910
        AY_VOLUME_TABLE: [
            0, 1, 2, 3, 5, 7, 11, 15,
            22, 31, 45, 63, 90, 127, 180, 255
        ]
    };
    
    // =====================================================
    // FDD Constants
    // =====================================================
    var FDD = {
        // Disk geometry
        TRACK_SIZE:         10240,      // Bytes per track (image)
        RAW_TRACK_SIZE:     6250,       // Words per raw track
        SECTORS_PER_TRACK:  10,
        HEADS:              2,
        MAX_TRACKS:         82,
        
        // Disk image size
        STANDARD_SIZE:      819200,     // 800KB standard disk
        
        // Timing
        ROTATION_PERIOD:    256,        // CPU cycles per word rotation
        
        // Status bits
        STATUS_TRACK0:      0x0001,
        STATUS_READONLY:    0x0004,
        STATUS_INDEX:       0x8000,
        STATUS_MARKER:      0x0080,
        STATUS_CRC:         0x4000,
        
        // Control register bits
        CTRL_HEAD:          0x0020,     // Head select bit (bit 5)
        CTRL_STEP:          0x0080,     // Step pulse
        CTRL_DIR:           0x0040,     // Step direction
        CTRL_MARKER:        0x0200,     // Write marker mode
        CTRL_SEEK_MARKER:   0x0100,     // Seek marker mode
        
        // Max drives
        MAX_DRIVES:         2
    };
    
    // =====================================================
    // Keyboard Constants
    // =====================================================
    var KEYBOARD = {
        // Special key codes
        KEY_STOP:           1000,       // Stop/NMI
        KEY_VIDEO_MODE:     1002,       // Cycle video modes
        KEY_RESET:          1004,       // Reset
        
        // BK key codes
        KEY_BS:             24,         // Backspace
        KEY_TAB:            137,        // Tab
        KEY_ENTER:          10,         // Enter/VVOD
        KEY_LEFT:           8,
        KEY_UP:             26,
        KEY_RIGHT:          25,
        KEY_DOWN:           27,
        KEY_SPACE:          32,
        KEY_RUS:            14,
        KEY_LAT:            15,
        
        // Status bits
        STATUS_READY:       0x80,
        STATUS_INT_ENABLE:  0x40
    };
    
    // =====================================================
    // Speed/Timing Constants
    // =====================================================
    var SPEED = {
        // Clock frequencies
        MHZ_3:              3000000,
        MHZ_4:              4000000,
        
        // Default cycles per frame
        DEFAULT_CPS:        250000,     // Cycles per second target
        DEFAULT_FPS:        20,         // Frames per second
        
        // Animation frame rate
        ANIM_FPS:           60
    };
    
    // =====================================================
    // Color Palettes
    // =====================================================
    var COLORS = {
        // Monochrome colors [R, G, B]
        MONO: [
            [0, 0, 0],          // Black
            [60, 60, 60],       // Dark gray
            [250, 250, 250],    // White
            [130, 130, 130]     // Light gray
        ],
        
        // Named colors for 16-color mode
        BLACK:      [0, 0, 0],
        BLUE:       [0, 0, 255],
        GREEN:      [0, 255, 0],
        RED:        [255, 0, 0],
        YELLOW:     [255, 255, 0],
        MAGENTA:    [255, 0, 255],
        CYAN:       [0, 255, 255],
        WHITE:      [255, 255, 255],
        DARK_RED:   [139, 0, 0],
        RED_BROWN:  [128, 64, 0],
        SALAD:      [85, 171, 85],
        LIGHT_GREEN:[128, 255, 128],
        VIOLET:     [238, 130, 238],
        VIOLET_BLUE:[138, 43, 226]
    };
    
    // =====================================================
    // UI Constants
    // =====================================================
    var UI = {
        // Touch button positions
        TOUCH_BUTTONS: {
            ESC:    { x: 690, y: 10, w: 90, h: 90, code: 1000 },
            ENTER:  { x: 790, y: 10, w: 180, h: 90, code: 10 },
            LEFT:   { x: 680, y: 130, w: 100, h: 220, code: 8 },
            UP:     { x: 786, y: 116, w: 100, h: 110, code: 26 },
            DOWN:   { x: 786, y: 240, w: 100, h: 110, code: 27 },
            RIGHT:  { x: 892, y: 130, w: 100, h: 220, code: 25 },
            DELETE: { x: 932, y: 386, w: 60, h: 60, code: 46 },
            SPACE:  { x: 680, y: 386, w: 240, h: 90, code: 32 }
        },
        
        // Update intervals
        UI_UPDATE_INTERVAL: 3000        // 3 seconds
    };
    
    // =====================================================
    // Export public API
    // =====================================================
    return {
        PORTS: PORTS,
        MEMORY: MEMORY,
        VIDEO: VIDEO,
        CPU: CPU,
        SOUND: SOUND,
        FDD: FDD,
        KEYBOARD: KEYBOARD,
        SPEED: SPEED,
        COLORS: COLORS,
        UI: UI,
        
        // Helper function to convert octal string to decimal
        oct: function(str) {
            return parseInt(str, 8);
        },
        
        // Helper to format number as octal string
        toOct: function(num, width) {
            width = width || 6;
            var s = num.toString(8);
            while (s.length < width) s = '0' + s;
            return s;
        },
        
        // Helper to format number as hex string
        toHex: function(num, width) {
            width = width || 4;
            var s = num.toString(16).toUpperCase();
            while (s.length < width) s = '0' + s;
            return s;
        }
    };
})();

// For backwards compatibility, also expose as window property
if (typeof window !== 'undefined') {
    window.BK_CONSTANTS = BK_CONSTANTS;
}
