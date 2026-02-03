/**
 * BaseBK001x - Base class for BK-0010/BK-0011M emulator
 * 
 * Базовый класс эмулятора советских компьютеров БК-0010/БК-0011М
 * 
 * Responsibilities:
 * - Memory management (RAM, ROM, memory mapping)
 * - Video output (display rendering, video modes, palettes)
 * - Sound synthesis (speaker, AY-8910, Covox)
 * - Input handling (keyboard, joystick)
 * - I/O operations (ports, registers)
 * - Tape emulation (BIN file loader)
 * - Floppy disk controller interface
 * 
 * Memory layout:
 * - 0x00000-0x0FFFF: RAM (64KB)
 * - 0x10000-0x13FFF: Monitor ROM (16KB) @100000
 * - 0x14000-0x19FFF: BASIC ROM (24KB) @120000
 * - 0x1E000-0x1EFFF: Disk ROM (4KB) @160000
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
BaseBK001x = function()
{
  var self = this;
  
  // =====================================================
  // Constants
  // =====================================================
  
  // Memory sizes
  var MEMORY_SIZE = 106496;        // Total memory array size (64KB RAM + ROMs)
  var RAM_SIZE = 65536;            // 64KB RAM
  var MEMORY_MAP_PAGES = 8;        // Number of memory mapping pages
  var PAGE_SIZE = 4096;            // 4KB per memory page
  
  // Memory addresses (octal notation used in original BK)
  var ADDR_MONITOR_ROM = 65536;    // 0x10000 = @100000 (octal)
  var ADDR_BASIC_ROM = 69632;      // 0x11000 = @120000 (octal)
  var ADDR_BK11M_OS = 81920;       // 0x14000 = BK-11M OS ROM
  var ADDR_BK11M_EXT = 86016;      // 0x15000 = BK-11M extension
  var ADDR_BK11M_BASIC1 = 90112;   // 0x16000 = BK-11M BASIC part 2
  var ADDR_BK11M_BASIC0 = 94208;   // 0x17000 = BK-11M BASIC part 1
  var ADDR_DISK_ROM = 102400;      // 0x19000 = @160000 (octal)
  
  // ROM sizes
  var MONITOR_ROM_SIZE = 8192;     // 8KB
  var BASIC_ROM_SIZE = 24576;      // 24KB
  var DISK_ROM_SIZE = 4096;        // 4KB
  var BASIC10_SKIP = -64;          // Skip bytes for BASIC 10
  
  // Video modes
  var VIDEO_MODE_BW = 0;           // Black & White
  var VIDEO_MODE_GRAY4 = 1;        // 4 grayscale colors
  var VIDEO_MODE_COLOR16 = 2;      // 16 colors
  
  // Tape speed
  var DEFAULT_TAPE_SPEED = 272;
  
  // =====================================================
  // Memory and Memory Mapping
  // =====================================================
  
  var memory = new Array(MEMORY_SIZE);           // Main memory array
  
  var mmap = new Array(MEMORY_MAP_PAGES);        // Memory mapping table
  var mmap_readable = new Array(MEMORY_MAP_PAGES);   // Read permissions
  var mmap_writeable = new Array(MEMORY_MAP_PAGES);  // Write permissions
  var rom160length = 0;                          // Length of ROM at 160000
  
  // =====================================================
  // Registers
  // =====================================================
  
  var syswritereg = 0;             // System write register
  var iowritereg = 0;              // I/O write register
  var ioreadreg = 0;               // I/O read register
  
  var scrollReg = 0;               // Scroll register
  var scrollPos = 0;               // Scroll position
  var paletteReg = 0;              // Palette register
  
  // =====================================================
  // Video State
  // =====================================================
  
  var videoMode = VIDEO_MODE_BW;   // Current video mode
  var is11M = false;               // True if BK-0011M model

  // =====================================================
  // Hardware Components
  // =====================================================
  
  var timer = new CPUTimer();      // CPU timer
  var keyboard = new Keyboard();   // Keyboard controller
  var sregs = new SystemRegs();    // System registers
  var joystick = new Joystick();   // Joystick controller
  var plugins = [];                // Plugin devices array
  
  // =====================================================
  // Sound Components
  // =====================================================
  
  var srend = new SoundRenderer(); // Sound renderer
  var synth = new AY8910();        // AY-8910 sound chip emulator
  
  // Sound detection flags
  var SOUND_NONE = 0;
  var SOUND_SPEAKER = 1;
  var SOUND_AY8910_OR_COVOX = 2;
  
  var synth_guess = SOUND_NONE;    // Detected sound hardware
  var tapeDelay = 0;               // Tape loading delay
  var lastTape = 0;                // Last tape operation time
  var TAPE_SPEED = DEFAULT_TAPE_SPEED;  // Tape read speed
  
  // Covox (DAC) settings
  var covoxEnabled = false;        // Covox DAC enabled
  var covoxSmart = false;          // Smart Covox mode
  var covoxByte = false;           // Byte-wide Covox mode
  
  // =====================================================
  // Color Palettes
  // =====================================================
  
  // Monochrome/grayscale palette (4 colors)
  var monoColorRGB = [
    [0, 0, 0],       // Black
    [60, 60, 60],    // Dark gray
    [250, 250, 250], // White
    [130, 130, 130]  // Light gray
  ];
  
  // Define base colors (RGB triplets)
  var Black = [0, 0, 0];
  var Blue = [0, 0, 255];
  var Green = [0, 255, 0];
  var Red = [255, 0, 0];
  var Yellow = [255, 255, 0];
  var Magenta = [255, 0, 255];
  var Cyan = [0, 255, 255];
  var White = [255, 255, 255];
  var DarkRed = [139, 0, 0];
  var RedBrown = [128, 64, 0];
  var Salad = [85, 171, 85];
  var LightGreen = [128, 255, 128];
  var Violet = [238, 130, 238];
  var VioletBlue = [138, 43, 226];
  
  // Full color palette (16 palettes × 4 colors each)
  var fullColorRGB = [
    // Palette 0: Basic colors
    Black, Blue, Green, Red,
    // Palette 1: Bright colors
    Black, Yellow, Magenta, Red,
    // Palette 2: Cyan tones
    Black, Cyan, Blue, Magenta,
    // Palette 3: Green-Yellow tones
    Black, Green, Cyan, Yellow,
    // Palette 4: Magenta-White tones
    Black, Magenta, Cyan, White,
    // Palette 5: White tones
    Black, White, White, White,
    // Palette 6: Red-Brown tones
    Black, DarkRed, RedBrown, Red,
    // Palette 7: Green-Yellow tones
    Black, Salad, LightGreen, Yellow,
    // Palette 8: Violet tones
    Black, Violet, VioletBlue, Magenta,
    // Palette 9: Mixed tones
    Black, LightGreen, VioletBlue, RedBrown,
    // Palette 10: Violet-Red tones
    Black, Salad, Violet, DarkRed,
    // Palette 11: Cyan-Red tones
    Black, Cyan, Yellow, Red,
    // Palette 12: RGB
    Black, Red, Green, Cyan,
    // Palette 13: Cyan-White tones
    Black, Cyan, Yellow, White,
    // Palette 14: Yellow-Green-White tones
    Black, Yellow, Green, White,
    // Palette 15: Cyan-Green-White tones
    Black, Cyan, Green, White
  ];
  
  var modePaletteMaps = [];        // Precalculated palette maps for rendering
  var readDTO = QBusReadDTO(-1);   // Q-Bus read data transfer object
  
  var HDret = { data: 0 };         // Hardware device return data
  
  // =====================================================
  // Canvas and Rendering Variables
  // =====================================================
  
  var CS;          // Canvas context
  var CX;          // Canvas X size
  var gDATA;       // Graphics data array
  var Px = [];     // Pixel buffer
  var Bf = [];     // Buffer
  
  var Cmap;        // Current color map
  var Base;        // Video memory base address
  var Limit;       // Video memory limit
  
  // =====================================================
  // Public Properties
  // =====================================================
  
  /**
   * Fake tape emulation state
   * Used for loading BIN files as if from magnetic tape
   */
  this.FakeTape = {
    prep: false,      // True when tape is ready to load
    filename: "",     // Loaded tape filename
    bytes: []         // Tape data bytes
  };
  
  /**
   * Disk drives enabled flag
   * True when FDD (floppy disk drive) is enabled
   */
  this.dsks = false;
  
  /**
   * Memory remap flag
   * Used for alternative memory mapping schemes
   */
  this.remap = false;
  
  // =====================================================
  // Public Methods - System Info
  // =====================================================
  
  /**
   * Check if current model is BK-0011M
   * @returns {boolean} True if BK-0011M, false if BK-0010
   */
  this.isM = function() {
    return is11M;
  };
  
  // =====================================================
  // Public Methods - Cycle Management
  // =====================================================
  
  /**
   * Minimize cycle counters to prevent overflow
   * Subtracts a fixed amount from all cycle counters while maintaining relative timing
   */
  this.minimizeCycles = function() {
    var CYCLE_REDUCTION = 1000;  // Amount to subtract from counters
    
    // Update all timer values first
    timer.updateTimer();
    if (srend.On) {
      srend.updateTimer();
    }
    if (self.dsks) {
      fdc.updateTimer();
    }
    
    // Calculate reduction amount
    var reduction = cpu.Cycles - CYCLE_REDUCTION;
    
    // Apply reduction to all components
    cpu.Cycles -= reduction;
    timer.cycles -= reduction;
    
    if (srend.On) {
      srend.cycles -= reduction;
    }
    
    if (self.dsks) {
      fdc.mCyc(reduction);
    }
  };
  
  // =====================================================
  // Private Methods - ROM Loading
  // =====================================================
  
  /**
   * Load data into memory at specified address
   * @param {number} addr - Target memory address
   * @param {Array} romArray - ROM data array to load
   * @param {number} skip - Number of bytes to skip at start of array
   */
  function loadtomem(addr, romArray, skip) {
    var targetAddr = addr;
    var dataLength = romArray.length + skip;
    var sourceIndex = 0;
    
    while (sourceIndex < dataLength) {
      memory[targetAddr++] = romArray[sourceIndex++];
    }
  }
  
  /**
   * Load ROM at address 120000 (octal)
   * Used for BASIC, FOCAL, and MSTD ROMs
   * @param {Array} romData - ROM data to load
   */
  function load120000(romData) {
    loadtomem(ADDR_BASIC_ROM, romData, 0);
  }
  
  /**
   * Load ROM at address 160000 (octal)
   * Used for 4KB disk controller ROM
   * @param {Array} romData - ROM data to load
   */
  function load160000(romData) {
    loadtomem(ADDR_DISK_ROM, romData, 0);
  }
  
  /**
   * Load ROM at address 000000 (octal)
   * WARNING: Can overwrite RAM!
   * @param {Array} romData - ROM data to load
   */
  function load000000(romData) {
    loadtomem(0, romData, 0);
  }
  
  // =====================================================
  // Public Methods - ROM Loading
  // =====================================================
  
  /**
   * Load disk controller ROM
   * @param {Array} romData - Disk ROM data
   */
  this.loadDisksRom = function(romData) {
    load160000(romData);
  };
  
  // =====================================================
  // Initialization
  // =====================================================
  
  /**
   * Initialize emulator base system
   * Sets up palette maps, plugins, and screen definitions
   */
  function init() {
    var i, j;
    var PALETTE_ENTRIES = 256;
    var BITS_PER_ENTRY = 8;
    var COLOR_PALETTES = 16;
    var COLORS_PER_PALETTE = 4;
    
    // Initialize black & white palette map (mode 0)
    // Each byte represents 8 pixels (1 bit per pixel)
    for (i = 0; i < PALETTE_ENTRIES; i++) {
      for (j = 0; j < BITS_PER_ENTRY; j++) {
        var index = (i << 3) + j;
        var pixelBit = (i >>> j) & 1;
        modePaletteMaps[index] = pixelBit ? [255, 255, 255] : [0, 0, 0];
      }
    }
    
    // Fill grayscale palette map (mode 1)
    fillMPMEntry(1, monoColorRGB, 0);
    
    // Fill all 16 color palette maps (modes 2-17)
    for (i = 0; i < COLOR_PALETTES; i++) {
      fillMPMEntry(2 + i, fullColorRGB, i * COLORS_PER_PALETTE);
    }
    
    // Register hardware plugins
    plugins.push(timer);
    plugins.push(keyboard);
    plugins.push(sregs);
    
    // Initialize screen definitions
    scrdefs();
  }
  
  /**
   * Initialize memory and load ROM files
   * Sets up memory mapping and loads all system ROMs
   */
  function memLoads0() {
    if (self.remap) {
      return;  // Skip if remapping is enabled
    }
    
    var i;
    var WRITABLE_PAGES = 4;           // First 4 pages are RAM (writable)
    var TOTAL_PAGES = 8;              // Total 8 pages in memory map
    
    // Setup memory mapping
    // Pages 0-3: RAM (readable & writable)
    // Pages 4-7: ROM (readable only)
    for (i = 0; i < TOTAL_PAGES; i++) {
      mmap_writeable[i] = (i < WRITABLE_PAGES);
      mmap_readable[i] = true;
      
      // Calculate base address for each page
      // Pages 0-3: 0x0000, 0x1000, 0x2000, 0x3000
      // Pages 4-7: 0x10000, 0x11000, 0x12000, 0x13000
      var baseOffset = (i > 3) ? RAM_SIZE : 0;
      var pageOffset = PAGE_SIZE * (i % 4);
      mmap[i] = baseOffset + pageOffset;
    }
    
    // Fill first 16KB of RAM with test pattern
    // This creates a recognizable pattern in memory for testing
    var RAM_INIT_SIZE = 16384;        // 16KB
    var PATTERN_CYCLE = 256;
    var PATTERN_RESET = 192;
    
    var value = 0;
    var flag = PATTERN_CYCLE;
    
    for (i = 0; i < RAM_INIT_SIZE; i++, flag--) {
      memory[i] = value;
      value = 0xFFFF - value;  // Invert pattern
      
      if (flag === PATTERN_RESET) {
        value = 0xFFFF - value;  // Re-invert
        flag = PATTERN_CYCLE;     // Reset counter
      }
    }
    
    // Load ROM files into mapped memory
    // All ROMs are loaded into extended memory area (above 64KB)
    
    // BK-0010 ROMs
    loadtomem(ADDR_MONITOR_ROM, monit10_data, 0);          // Monitor 8KB
    loadtomem(ADDR_BASIC_ROM, basic10_data, BASIC10_SKIP); // BASIC 24KB
    
    // BK-0011M ROMs
    loadtomem(ADDR_BK11M_OS, b11mbos_data, 0);    // OS 8KB
    loadtomem(ADDR_BK11M_EXT, b11mext_data, 0);   // Extension 8KB
    loadtomem(ADDR_BK11M_BASIC1, bas11m1_data, 0); // BASIC part 2, 8KB
    loadtomem(ADDR_BK11M_BASIC0, bas11m0_data, 0); // BASIC part 1, 16KB
    
    // Disk controller ROM (shared by BK-0010 and BK-0011M)
    loadtomem(ADDR_DISK_ROM, disk326_data, 0);    // Disk ROM 4KB
  }
  
  /**
   * Update internal memory values
   * Re-reads and re-writes first 32KB of memory
   * Used to refresh internal state after memory mapping changes
   */
  this.updinternals = function() {
    var WORDS_TO_UPDATE = 0x8000;  // 32KB in words
    var WORD_SIZE = 2;
    
    for (var i = 0, addr = 0; i < WORDS_TO_UPDATE; i++, addr += WORD_SIZE) {
      this.readWord(addr, readDTO);
      this.writeWord(addr, readDTO.value);
    }
  };
  
  /**
   * Fill palette map entry for a video mode
   * Precalculates color values for fast rendering
   * 
   * @param {number} modeOffset - Mode number offset (0=BW, 1=gray, 2+=color)
   * @param {Array} colorMap - Color palette array (RGB triplets)
   * @param {number} paletteOffset - Offset into color map
   */
  function fillMPMEntry(modeOffset, colorMap, paletteOffset) {
    var i, j, k;
    var BYTES_PER_MODE = 256;
    var PIXELS_PER_BYTE = 8;
    var BITS_PER_PIXEL = 2;
    var PIXELS_PAIR = 2;
    
    // Calculate base offset in mode palette maps array
    var baseOffset = modeOffset << 11;  // × 2048
    
    // Process all 256 possible byte values
    for (i = 0; i < BYTES_PER_MODE; i++) {
      // Process pixel pairs (4 pairs per byte in 2-bit mode)
      for (j = 0; j < PIXELS_PER_BYTE; j += BITS_PER_PIXEL) {
        // Extract 2-bit color index
        var colorIndex = ((i >>> j) & 0x3) + paletteOffset;
        var color = colorMap[colorIndex];
        
        // Store color for pixel pair (for performance)
        for (k = 0; k < PIXELS_PAIR; k++) {
          modePaletteMaps[baseOffset++] = color;
        }
      }
    }
  }
  
  /**
   * Set video display mode
   * @param {number} mode - Video mode:
   *   0 = Black & White (1-bit per pixel)
   *   1 = Grayscale (4 gray levels, 2-bit per pixel)
   *   2+ = Color (16 palettes, 2-bit per pixel)
   */
  this.setVideoMode = function(mode) {
    videoMode = mode;
    scrdefs();  // Recalculate screen definitions
  };
  /**
   * Get current video mode
   * @returns {number} Current video mode (0=BW, 1=gray, 2+=color)
   */
  this.getVideoMode = function() {
    return videoMode;
  };
  
  // =====================================================
  // Public Methods - BK Model Configuration
  // =====================================================
  
  /**
   * Set base BK-0010 model (minimal configuration)
   * Monitor ROM only, no BASIC
   */
  this.setBase10Model = function() {
    memLoads0();
    is11M = false;
    
    var m = mmap;
    var r = mmap_readable;
    var w = mmap_writeable;
    
    // Setup memory mapping for base BK-0010
    m[2] = 8192;   // Page 2: 0x2000
    m[3] = 12288;  // Page 3: 0x3000
    m[4] = 65536;  // Page 4: Monitor ROM start
    
    // Only monitor ROM is readable, other ROM pages disabled
    r[4] = true;
    r[5] = false;
    r[6] = false;
    r[7] = false;
    
    // All ROM pages are not writable
    w[4] = false;
    w[5] = false;
    w[6] = false;
    w[7] = false;
    
    scrdefs();
    rom160length = 8064;  // ROM size for @160000
  };
  
  /**
   * Setup standard BK-0010 model with BASIC
   * Common initialization for BASIC and FOCAL models
   */
  function set10Model() {
    memLoads0();
    is11M = false;
    
    var m = mmap;
    var r = mmap_readable;
    var w = mmap_writeable;
    
    // Setup memory mapping for BK-0010 with BASIC
    m[2] = 8192;   // Page 2: 0x2000
    m[3] = 12288;  // Page 3: 0x3000
    m[4] = 65536;  // Page 4: Monitor ROM (0x10000)
    m[5] = 69632;  // Page 5: BASIC ROM part 1 (0x11000)
    m[6] = 73728;  // Page 6: BASIC ROM part 2 (0x12000)
    m[7] = 77824;  // Page 7: BASIC ROM part 3 (0x13000)
    
    // All ROM pages are readable
    r[4] = true;
    r[5] = true;
    r[6] = true;
    r[7] = true;
    
    // All ROM pages are not writable
    w[4] = false;
    w[5] = false;
    w[6] = false;
    w[7] = false;
    
    scrdefs();
    rom160length = 8064;
  }
  
  /**
   * Set BK-0010 model with BASIC interpreter
   */
  this.setBASIC10Model = function() {
    set10Model();
  };
  
  /**
   * Set BK-0010 model with FOCAL language
   * FOCAL ROM replaces BASIC ROM
   */
  this.setFOCAL10Model = function() {
    set10Model();
    load120000(focal10_data);  // Load FOCAL instead of BASIC
  };
  
  /**
   * Set BK-0010 model with floppy disk drive
   * Includes disk controller ROM and writeable buffer pages
   */
  this.setFDD10Model = function() {
    memLoads0();
    is11M = false;
    
    var m = mmap;
    var r = mmap_readable;
    var w = mmap_writeable;
    
    // Setup memory mapping for BK-0010 with FDD
    m[2] = 8192;    // Page 2: 0x2000
    m[3] = 12288;   // Page 3: 0x3000
    m[4] = 65536;   // Page 4: Monitor ROM
    m[5] = 16384;   // Page 5: Disk buffer 1 (0x4000)
    m[6] = 20480;   // Page 6: Disk buffer 2 (0x5000)
    m[7] = 102400;  // Page 7: Disk ROM (0x19000)
    
    // All pages are readable
    r[4] = true;
    r[5] = true;
    r[6] = true;
    r[7] = true;
    
    // ROM pages not writable, but disk buffers are
    w[4] = false;   // Monitor ROM - read only
    w[5] = true;    // Disk buffer 1 - writable
    w[6] = true;    // Disk buffer 2 - writable
    w[7] = false;   // Disk ROM - read only
    
    rom160length = 4096;  // Disk ROM is 4KB
    scrdefs();
    self.addFloppies();   // Enable floppy disk support
  };
  
  /**
   * Setup standard BK-0011M model
   * Common initialization for BK-0011M configurations
   */
  function set11Model() {
    memLoads0();
    is11M = true;
    
    var m = mmap;
    var r = mmap_readable;
    var w = mmap_writeable;
    
    // Setup memory mapping for BK-0011M
    m[2] = 8192;    // Page 2: 0x2000
    m[3] = 12288;   // Page 3: 0x3000
    m[4] = 90112;   // Page 4: BASIC part 2 (0x16000)
    m[5] = 86016;   // Page 5: Extension ROM (0x15000)
    m[6] = 81920;   // Page 6: OS ROM (0x14000)
    m[7] = 102400;  // Page 7: Disk ROM (0x19000)
    
    // All ROM pages are readable
    r[4] = true;
    r[5] = true;
    r[6] = true;
    r[7] = true;
    
    // All ROM pages are not writable
    w[4] = false;
    w[5] = false;
    w[6] = false;
    w[7] = false;
    
    rom160length = 4096;
    scrdefs();
  }
  
  /**
   * Set BK-0011M model with floppy disk drive
   * Enables floppy disk support on BK-0011M
   */
  this.setFDD11Model = function() {
    set11Model();
    self.addFloppies();   // Enable floppy disk support
  };
  
  // =====================================================
  // I/O Port Addresses (octal notation in comments)
  // =====================================================
  
  var PORT_IO_STATUS = 65484;      // @177660 - I/O status register
  var PORT_SYSTEM_REG = 65486;     // @177662 - System register
  var PORT_SCROLL = 65460;         // @177664 - Scroll register
  var PORT_PALETTE = 65458;        // @177662 - Palette register (BK-11M only)
  
  // Memory page constants
  var ROM_PAGE = 7;                // Page 7 is ROM area
  var PAGE_SIZE_BITS = 13;         // 8KB pages (2^13)
  var PAGE_MASK = 0x1FFF;          // Mask for offset within page
  var ADDR_MASK = 65535;           // 16-bit address mask
  var WORD_ALIGN_MASK = 0xFFFE;    // Align to word boundary
  
  // System register flags
  var SYSREG_TAPE_BIT = 32;        // Tape signal bit
  var SYSREG_KEY_BIT = 64;         // Keyboard bit
  var SYSREG_BK11M_BITS = 49280;   // BK-11M specific bits
  var SYSREG_BK10_BITS = 32912;    // BK-0010 specific bits
  
  var ROM_BASE_ADDR = 57344;       // Base address for ROM check
  
  // =====================================================
  // Public Methods - Memory Access
  // =====================================================
  
  /**
   * Read 16-bit word from memory or I/O port
   * 
   * @param {number} addr - Address to read from (16-bit)
   * @param {QBusReadDTO} result - Result object to store value
   * @returns {boolean} True if read succeeded
   */
  this.readWord = function(addr, result) {
    var ia = addr & ADDR_MASK;                          // Internal address (16-bit)
    var page = ia >>> PAGE_SIZE_BITS;                   // Calculate page number (0-7)
    var pageOffset = (ia & PAGE_MASK) >>> 1;            // Offset within page (in words)
    var mappedAddr = mmap[page] + pageOffset;           // Physical memory address
    
    // Read from regular memory (pages 0-6)
    if (page < ROM_PAGE) {
      if (mmap_readable[page]) {
        result.value = memory[mappedAddr] & 0xFFFF >>> 0;
        return true;
      }
      return true;  // Page not readable, return without error
    }
    
    // Check if any plugin device handles this address
    for (var pli in plugins) {
      var plugin = plugins[pli];
      var baseAddr = plugin.getBaseAddress();
      
      if (baseAddr <= ia) {
        var wordOffset = (ia - baseAddr) >>> 1;
        if (wordOffset < plugin.getNumWords()) {
          return plugin.readWord(addr, result);
        }
      }
    }
    
    // Read from ROM page (if readable)
    if (mmap_readable[ROM_PAGE] && (ia < ROM_BASE_ADDR + rom160length)) {
      result.value = memory[mappedAddr] & 0xFFFF >>> 0;
      return true;
    }
    
    // Handle I/O ports (word-aligned addresses)
    var portAddr = (ia & WORD_ALIGN_MASK) >>> 0;
    
    // I/O status register (joystick input)
    if (portAddr === PORT_IO_STATUS) {
      result.value = (ioreadreg | joystick.getIO()) & 0xFFFF >>> 0;
      return true;
    }
    
    // System status register (tape, keyboard, model bits)
    if (portAddr === PORT_SYSTEM_REG) {
      var tape = SYSREG_TAPE_BIT;
      var keyBit = keyboard.getKeyDown() ? 0 : SYSREG_KEY_BIT;
      var modelBits = is11M ? SYSREG_BK11M_BITS : SYSREG_BK10_BITS;
      
      result.value = tape | keyBit | modelBits;
      return true;
    }
    
    // Scroll register
    if (portAddr === PORT_SCROLL) {
      result.value = scrollReg;
      return true;
    }
    
    return false;  // Address not handled
  };

  /**
   * Read 16-bit word from memory (simplified version)
   * Helper method that returns value directly instead of using DTO
   * 
   * @param {number} addr - Address to read from
   * @returns {number} Word value at address
   */
  this.readWORD = function(addr) {
    var dto = QBusReadDTO(-1);
    this.readWord(addr, dto);
    return dto.value;
  };
  
  /**
   * Write byte to memory as word (PDP-11 byte write emulation)
   * 
   * On PDP-11, byte writes actually write the full word with one byte modified.
   * - Even addresses (bit 0 = 0): write to low byte
   * - Odd addresses (bit 0 = 1): write to high byte
   * 
   * @param {number} addr - Address to write to
   * @param {number} data - Data to write (byte value)
   * @returns {boolean} True if write succeeded
   */
  this.writeByteAsWord = function(addr, data) {
    var ia = addr & ADDR_MASK;
    var page = ia >>> PAGE_SIZE_BITS;
    var pageOffset = (ia & PAGE_MASK) >>> 1;
    var mappedAddr = mmap[page] + pageOffset;
    
    // Determine which byte to modify based on address LSB
    var isEvenAddr = ((ia & 1) === 0);
    var oldWord = memory[mappedAddr];
    var newWord;
    
    if (isEvenAddr) {
      // Even address: modify low byte
      newWord = (oldWord & 0xFF00) | (data & 0xFF);
    } else {
      // Odd address: modify high byte
      newWord = (oldWord & 0xFF) | (data & 0xFF00);
    }
    
    // Update pixel if this is video memory
    updatepixel(mappedAddr, newWord);
    
    // Write to regular memory pages (0-6)
    if (page < ROM_PAGE) {
      if (mmap_writeable[page]) {
        memory[mappedAddr] = newWord;
        return true;
      }
      return false;  // Page not writable
    }
    
    // Handle I/O ports (word-aligned)
    var portAddr = (ia & WORD_ALIGN_MASK) >>> 0;
    
    // Palette register (BK-11M only)
    if (is11M && (portAddr === PORT_PALETTE)) {
      if (isEvenAddr) {
        paletteReg = (paletteReg & 0xFF00) | (data & 0xFF);
      } else {
        paletteReg = (paletteReg & 0xFF) | (data & 0xFF00);
      }
      
      scrdefs();  // Recalculate screen with new palette
      return true;
    }

    for (var /*QBusSlave*/ pli in plugins) {
      var plugin = plugins[pli];    
      var base = plugin.getBaseAddress();
      if (base <= ia) {
        if ((ia-base)/2 < plugin.getNumWords())
        {
          return plugin.writeByteAsWord(addr, data);
        }
      }
    }

    if ((mmap_writeable[7] != 0) && (ia < 57344 + rom160length))
    {
      memory[mappedAddr] = newWord;
      return true;
    }
    
    // I/O write register (sound output port)
    if (portAddr === PORT_IO_STATUS) {
      if (isEvenAddr) {
        // Low byte write - handle sound devices
        synth_guess |= SOUND_AY8910_OR_COVOX;
        
        if (srend.On) {
          srend.updateTimer();
          
          // Handle Covox DAC output
          if (covoxEnabled) {
            if (covoxSmart) {
              // Smart mode: check for significant changes
              var COVOX_CHANGE_THRESHOLD = 8;
              var change = ((iowritereg ^ data) & 0xFF) >>> 0;
              
              if (change !== COVOX_CHANGE_THRESHOLD && covoxByte) {
                srend.updateCovox(data);
              }
              covoxByte = true;
            } else {
              // Direct mode: always update
              srend.updateCovox(data);
            }
          }
          
          // Handle AY-8910 sound chip
          if (synth.On) {
            // Invert data for AY-8910 (hardware quirk)
            var invertedData = ((data ^ 255) & 255) >>> 0;
            synth.writeReg(invertedData);
          }
        }
        
        iowritereg = (iowritereg & 0xFF00) | (data & 0xFF);
      } else {
        // High byte write
        iowritereg = (iowritereg & 0xFF) | (data & 0xFF00);
      }
      return true;
    }
    
    // System register (speaker bit, etc.)
    var SPEAKER_BIT = 0x40;
    
    if (ia === 65486) {
      // Low byte of system register
      syswritereg = (syswritereg & 0xFF00) | (data & 0xFF);
      
      if (srend.On) {
        srend.updateBit(data & SPEAKER_BIT);
      }
      synth_guess |= SOUND_SPEAKER;
      return true;
    }
    
    if (ia === 65487) {
      // High byte of system register
      syswritereg = (syswritereg & 0xFF) | (data & 0xFF00);
      return true;
    }
    
    // Scroll register
    if (portAddr === PORT_SCROLL) {
      scrollReg = (scrollReg & 0xFF00) | (data & 0xFF);
      scrdefs();  // Recalculate screen with new scroll value
      return true;
    }
    
    return false;  // Address not handled
  };
  
  /**
   * Write single byte to memory
   * Converts byte write to word write with proper masking
   * 
   * @param {number} addr - Address to write to
   * @param {number} data - Byte value to write
   * @returns {boolean} True if write succeeded
   */
  this.writeByte = function(addr, data) {
    var byteValue = data & 0xFF >>> 0;
    var isOddAddr = (addr & 1);
    
    // Convert to word write:
    // - Even address: write byte to low 8 bits, set high 8 bits to 0xFF
    // - Odd address: write byte to high 8 bits, set low 8 bits to 0xFF
    var wordData = isOddAddr ? ((byteValue << 8) | 0xFF) : (byteValue | 0xFF00);
    
    return this.writeByteAsWord(addr, wordData);
  };
  
  /**
   * Read single byte from memory
   * Reads word and extracts appropriate byte based on address
   * 
   * @param {number} addr - Address to read from
   * @param {QBusReadDTO} result - Result object to store value
   * @returns {boolean} True if read succeeded
   */
  this.readByte = function(addr, result) {
    var success = this.readWord(addr, result);
    
    // Extract appropriate byte based on address LSB
    if (addr & 1) {
      // Odd address: use high byte
      result.value = (result.value >>> 8);
    }
    
    // Mask to byte value
    result.value = (result.value & 0xFF);
    
    return success;
  };

  /**
   * Write 16-bit word to memory or I/O port
   * 
   * @param {number} addr - Address to write to (word-aligned recommended)
   * @param {number} data - Word value to write
   * @returns {boolean} True if write succeeded
   */
  this.writeWord = function(addr, data) {
    var ia = addr & ADDR_MASK;
    var page = ia >>> PAGE_SIZE_BITS;
    var pageOffset = (ia & PAGE_MASK) >>> 1;
    var mappedAddr = mmap[page] + pageOffset;
    var wordData = data & 0xFFFF >>> 0;
    
    // Update pixel if this is video memory
    updatepixel(mappedAddr, wordData);
    
    // Write to regular memory pages (0-6)
    if (page < ROM_PAGE) {
      if (mmap_writeable[page]) {
        memory[mappedAddr] = wordData;
        return true;
      }
      return false;  // Page not writable
    }
    
    // Handle I/O ports (word-aligned)
    var portAddr = (ia & WORD_ALIGN_MASK) >>> 0;
    
    // Palette register (BK-11M only)
    if (is11M && (portAddr === PORT_PALETTE)) {
      paletteReg = wordData;
      scrdefs();  // Recalculate screen with new palette
      return true;
    }
    
    // Check if any plugin device handles this address
    for (var pli in plugins) {
      var plugin = plugins[pli];
      var baseAddr = plugin.getBaseAddress();
      
      if (baseAddr <= ia) {
        var wordOffset = (ia - baseAddr) >>> 1;
        if (wordOffset < plugin.getNumWords()) {
          return plugin.writeWord(addr, wordData);
        }
      }
    }
    
    // Write to ROM page 7 (if writable - rare, but allowed)
    if (mmap_writeable[ROM_PAGE] && (ia < ROM_BASE_ADDR + rom160length)) {
      memory[mappedAddr] = wordData;
      return true;
    }
    
    // I/O write register (sound output)
    if (portAddr === PORT_IO_STATUS)
    {
      if (srend.On) {
        srend.updateTimer();
        
        // Handle Covox DAC
        if (covoxEnabled) {
          if (covoxSmart) {
            var WORD_CHANGE_THRESHOLD = 8;
            var change = ((iowritereg ^ wordData) & 0xFFFF) >>> 0;
            
            if (change !== WORD_CHANGE_THRESHOLD && !covoxByte) {
              srend.updateCovox(wordData);
            }
            covoxByte = false;
          } else {
            srend.updateCovox(wordData);
          }
        }
        
        // Handle AY-8910 sound chip (set register index)
        if (synth.On) {
          var invertedData = ((wordData ^ 255) & 255) >>> 0;
          synth.setRegIndex(invertedData);
        }
      }
      
      iowritereg = wordData;
      return true;
    }
    
    // System register (with memory bank switching for BK-11M)
    if (portAddr === PORT_SYSTEM_REG)
    {
      var BANK_SWITCH_BIT = 0x800;  // Bit 11 enables bank switching
      var BANK_SELECT_MASK = 0x1B;  // Bank selection bits
      
      // BK-11M memory bank switching
      if (is11M && ((wordData & BANK_SWITCH_BIT) !== 0)) {
        var w = mmap_writeable;
        var r = mmap_readable;
        var m = mmap;
        
        var bankSelect = wordData & BANK_SELECT_MASK;
        
        if (bankSelect) {
          // ROM banks selected
          w[4] = false;
          w[5] = false;
          
          if (bankSelect & 1) {
            // BASIC part 1
            r[4] = true;
            r[5] = true;
            m[4] = 94208;  // BASIC part 1, page 1
            m[5] = 98304;  // BASIC part 1, page 2
          } else if (bankSelect & 2) {
            // BASIC part 2 + Extension
            r[4] = true;
            r[5] = true;
            m[4] = 90112;  // BASIC part 2
            m[5] = 86016;  // Extension ROM
          } else {
            // No ROM selected
            r[4] = false;
            r[5] = false;
          }
        } else {
          // RAM banks selected (writable)
          w[4] = true;
          w[5] = true;
          r[4] = true;
          r[5] = true;
          
          // Calculate bank address from bits 8-10
          var bank45 = (wordData >>> 8) & 7;
          bank45 = ((bank45 ^ 6) >>> 0) << PAGE_SIZE_BITS;
          m[4] = bank45;
          m[5] = bank45 + PAGE_SIZE;
        }
        
        // Calculate pages 2-3 address from bits 12-14
        var bank23 = (wordData >>> 12) & 7;
        bank23 = ((bank23 ^ 6) >>> 0) << PAGE_SIZE_BITS;
        m[2] = bank23;
        m[3] = bank23 + PAGE_SIZE;
      } else {
        // Normal system register write (BK-0010 or no banking)
        syswritereg = wordData;
        
        if (srend.On) {
          var SPEAKER_BIT = 0x40;
          srend.updateBit(wordData & SPEAKER_BIT);
        }
      }
      
      return true;
    }
    
    // Scroll register
    var SCROLL_MASK = 0x2FF;  // 10-bit scroll value
    
    if (portAddr === PORT_SCROLL) {
      scrollReg = wordData & SCROLL_MASK;
      scrdefs();  // Recalculate screen with new scroll
      return true;
    }
    
    return false;  // Address not handled
  };

  // =====================================================
  // Public Methods - Q-Bus Interface
  // =====================================================
  
  /**
   * Get base address for Q-Bus device
   * @returns {number} Base address (0 for this device)
   */
  this.getBaseAddress = function() {
    return 0;
  };
  
  /**
   * Get number of words in Q-Bus device address space
   * @returns {number} Number of words (0 for this device)
   */
  this.getNumWords = function() {
    return 0;
  };
  
  // =====================================================
  // Public Methods - Interrupts
  // =====================================================
  
  /**
   * Check if any plugin device has pending interrupt
   * @returns {boolean} True if interrupt is pending
   */
  this.gotInterrupt = function() {
    for (var pli in plugins) {
      var plugin = plugins[pli];
      if (plugin.gotInterrupt()) return true;
    }
    return false;
  }

  /**
   * Get interrupt vector from plugin device
   * @returns {number} Interrupt vector number, or -1 if none
   */
  this.interruptVector = function() {
    for (var pli in plugins) {
      var plugin = plugins[pli];
      if (plugin.gotInterrupt()) {
        return plugin.interruptVector();
      }
    }
    return -1;  // No interrupt
  };
  
  /**
   * Reset all plugin devices and sound system
   */
  this.reset = function() {
    // Reset all plugin devices
    for (var pli in plugins) {
      var plugin = plugins[pli];
      plugin.reset();
    }
    
    // Clear sound renderer
    srend.clear(1);
  };
  
  /**
   * Process IRQ (Interrupt Request)
   * On BK-11M, triggers CPU interrupt if timer is enabled
   */
  this.irq = function() {
    if (is11M && timerEnabled()) {
      cpu.irq();
    }
  };
  
  /**
   * Check if timer interrupts are enabled
   * Timer is controlled by bit 14 of palette register on BK-11M
   * @returns {boolean} True if timer enabled
   */
  function timerEnabled() {
    var TIMER_ENABLE_BIT = 0x4000;  // Bit 14
    return ((paletteReg & TIMER_ENABLE_BIT) === 0);  // Active low
  }
  
  // =====================================================
  // Public Methods - Sound Configuration
  // =====================================================
  
  // Covox modes
  var COVOX_OFF = 0;
  var COVOX_DIRECT = 1;
  var COVOX_SMART = 2;
  
  /**
   * Set Covox DAC mode
   * @param {number} mode - Covox mode:
   *   0 = Off
   *   1 = Direct mode (always update)
   *   2 = Smart mode (filter small changes)
   */
  this.setCovoxMode = function(mode) {
    switch (mode) {
      case COVOX_OFF:
        covoxSmart = false;
        covoxEnabled = false;
        break;
        
      case COVOX_SMART:
        covoxSmart = true;
        covoxEnabled = true;
        break;
        
      case COVOX_DIRECT:
      default:
        covoxSmart = false;
        covoxEnabled = true;
        break;
    }
    
    // Update sound renderer
    srend.covox = covoxEnabled;
  };

  // =====================================================
  // Display Rendering Functions
  // =====================================================
  
  var PIXELS_PER_WORD = 16;      // 16 pixels per memory word
  var PIXELS_PER_BYTE = 8;       // 8 pixels per byte
  var BYTES_PER_PIXEL = 4;       // RGBA format
  var ALPHA_CHANNEL = 255;       // Fully opaque
  
  /**
   * Update pixel data in canvas buffer when memory changes
   * Converts word value to 16 pixels using current palette
   * 
   * @param {number} memAddr - Memory address that changed
   * @param {number} wordValue - New word value
   */
  function updatepixel(memAddr, wordValue) {
    // Check if graphics data is initialized and this address has pixels
    if (gDATA === null || typeof(Px[memAddr]) === "undefined") {
      return;
    }
    
    var pixelBuffer = [];
    var bufIndex = 0;
    
    // Process low byte (8 pixels)
    var lowByte = wordValue & 0xFF;
    var paletteOffset = Cmap + (lowByte << 3);  // × 8
    
    for (var q = 0; q < PIXELS_PER_BYTE; q++) {
      pixelBuffer[bufIndex++] = modePaletteMaps[paletteOffset++];
    }
    
    // Process high byte (8 pixels)
    var highByte = wordValue >>> 8;
    paletteOffset = Cmap + (highByte << 3);  // × 8
    
    for (q = 0; q < PIXELS_PER_BYTE; q++) {
      pixelBuffer[bufIndex++] = modePaletteMaps[paletteOffset++];
    }
    
    // Write pixels to canvas data (RGBA format)
    var canvasOffset = Px[memAddr] * BYTES_PER_PIXEL;
    
    for (var i = 0; i < PIXELS_PER_WORD; i++, canvasOffset += BYTES_PER_PIXEL) {
      var color = pixelBuffer[i];
      gDATA.data[canvasOffset] = color[0];      // Red
      gDATA.data[canvasOffset + 1] = color[1];  // Green
      gDATA.data[canvasOffset + 2] = color[2];  // Blue
      gDATA.data[canvasOffset + 3] = ALPHA_CHANNEL;  // Alpha
    }
  }

  /**
   * Update canvas with current graphics data
   * Pushes image data to HTML5 canvas
   */
  this.updCanvas = function() {
    CX.putImageData(gDATA, 0, 0);
  };
  
  /**
   * Cycle through video modes (BW → Gray → Color → BW...)
   * Triggered by special key combination
   */
  this.cycleVideomodes = function() {
    var VIDEO_MODES_COUNT = 3;
    videoMode = (videoMode + 1) % VIDEO_MODES_COUNT;
    scrdefs();
  };
  
  // Screen constants
  var SCREEN_WIDTH = 512;        // Canvas width in pixels
  var SCREEN_HEIGHT = 256;       // Canvas height in pixels
  var SCREEN_PIXELS = 131072;    // Total pixels (512×256)
  var SCROLL_OFFSET = 40;        // Scroll adjustment
  var SCROLL_WRAP = 0xFF;        // Scroll wrap mask
  var PIXELS_PER_LINE = 32;      // Words per scan line
  
  /**
   * Calculate screen parameters based on current video mode
   * Sets up palette map, video base address, limits, and scroll position
   */
  function scrdefs() {
    // Calculate color map offset based on model and mode
    if (!is11M) {
      // BK-0010: simple mode selection
      Cmap = videoMode << 11;  // × 2048
    } else {
      // BK-0011M: uses palette register
      if (videoMode === 0) {
        Cmap = 0;  // Black & white mode
      } else {
        // Color/gray mode: extract palette from palette register
        var paletteIndex = (paletteReg >>> 8) & 0xF;
        Cmap = (2 + paletteIndex) << 11;  // × 2048
      }
    }
    
    // Calculate video memory base address
    var ALT_BASE_BIT = 0x8000;  // Bit 15 selects alternate base
    var DEFAULT_BASE = 8192;    // Normal video base
    var ALT_BASE = 57344;       // Alternate video base (BK-11M)
    
    if (is11M && ((paletteReg & ALT_BASE_BIT) === 0)) {
      Base = ALT_BASE;
    } else {
      Base = DEFAULT_BASE;
    }
    
    // Calculate screen limit (64 or 256 lines)
    var LIMIT_BIT = 0x200;  // Bit 9 selects 256-line mode
    var LINES_64 = 64;
    var LINES_256 = 256;
    
    var lines = ((scrollReg & LIMIT_BIT) === 0) ? LINES_64 : LINES_256;
    Limit = lines << 5;  // × 32 (words per line)
    
    // Calculate scroll position
    scrollPos = ((scrollReg + SCROLL_OFFSET) & SCROLL_WRAP) * PIXELS_PER_LINE;
    
    // Redraw screen with new parameters
    self.DRAW();
  }
  
  var VIDEO_MEMORY_WRAP = 8191;  // Video memory wrap mask (8KB)
  var BLACK_COLOR = [0, 0, 0];   // Black pixel color
  
  /**
   * Copy framebuffer from BK video memory to pixel buffer
   * Handles scrolling and converts memory words to RGB pixels
   */
  function copyFramebufferFast() {
    var srcOffset = scrollPos;
    var dstOffset = 0;
    var wordsRemaining = Limit;
    
    // Clear pixel mapping arrays
    Px = [];  // Maps memory address to pixel position
    Bf = [];  // Pixel buffer (RGB values)
    
    // Copy visible portion of screen
    while (wordsRemaining > 0) {
      wordsRemaining--;
      
      // Calculate memory address with base and wrapping
      var memAddr = Base + srcOffset;
      srcOffset++;
      srcOffset &= VIDEO_MEMORY_WRAP;  // Wrap within 8KB
      
      // Map this memory address to current pixel position
      Px[memAddr] = dstOffset;
      
      // Get word value from memory
      var wordValue = memory[memAddr] & 0xFFFF;
      
      // Convert low byte to 8 pixels
      var lowByte = wordValue & 0xFF;
      var paletteOffset = Cmap + (lowByte << 3);
      
      for (var q = 0; q < PIXELS_PER_BYTE; q++) {
        Bf[dstOffset++] = modePaletteMaps[paletteOffset++];
      }
      
      // Convert high byte to 8 pixels
      var highByte = wordValue >>> 8;
      paletteOffset = Cmap + (highByte << 3);
      
      for (q = 0; q < PIXELS_PER_BYTE; q++) {
        Bf[dstOffset++] = modePaletteMaps[paletteOffset++];
      }
    }
    
    // Fill remaining pixels with black (if screen is smaller than 256 lines)
    while (dstOffset < SCREEN_PIXELS) {
      var memAddr = Base + srcOffset;
      srcOffset++;
      srcOffset &= VIDEO_MEMORY_WRAP;
      
      Px[memAddr] = dstOffset;
      Bf[dstOffset++] = BLACK_COLOR;
    }
  }
  
  /**
   * Draw entire screen from BK video memory to canvas
   * Main rendering function - converts BK video memory to HTML5 canvas
   * 
   * @returns {number} 1 if successful, 0 if canvas not ready
   */
  this.DRAW = function() {
    // Get canvas element
    CS = document.getElementById("BK_canvas");
    if (CS === null) {
      return 0;  // Canvas not ready
    }
    
    // Copy BK framebuffer to pixel buffer
    copyFramebufferFast();
    
    // Get canvas context and create image data
    // Use willReadFrequently: true for better performance when frequently reading pixels
    CX = CS.getContext('2d', { willReadFrequently: true });
    gDATA = CX.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Copy pixel buffer to canvas image data (RGBA format)
    for (var pixelIndex = 0, byteIndex = 0; pixelIndex < SCREEN_PIXELS; pixelIndex++, byteIndex += BYTES_PER_PIXEL) {
      var color = Bf[pixelIndex];
      gDATA.data[byteIndex] = color[0];      // Red
      gDATA.data[byteIndex + 1] = color[1];  // Green
      gDATA.data[byteIndex + 2] = color[2];  // Blue
      gDATA.data[byteIndex + 3] = ALPHA_CHANNEL;  // Alpha
    }
    
    // Update canvas with new image data
    this.updCanvas();
    return 1;  // Success
  };
  
  // =====================================================
  // Fake Tape Emulation
  // Simulates loading from magnetic tape (only BIN files)
  // =====================================================
  
  /**
   * Fast BIN file loader for BK-0010
   * Bypasses monitor ROM routines for faster loading
   */
  this.LoadBinFast = function() {
    var r = cpu.regs;
    
    // Setup CPU registers for fast load
    r[0] = 32;      // R0
    r[1] = 208;     // R1 - load address pointer
    r[2] = 65535;   // R2 - 0xFFFF
    r[3] = 33242;   // R3
    r[4] = 77;      // R4
    r[5] = 39998;   // R5 - tape routine address
    r[6] = 502;     // R6 - stack pointer
    r[7] = 39998;   // R7 - program counter
    
    cpu.setPSW(136);  // Set processor status word
    
    // Write load parameters to memory
    self.writeWord(208, 3);   // Load command
    self.writeWord(210, 0);   // Start address
    
    // Execute tape loader
    self.TapeBinLoader();
    
    // Set PC to entry point from vector
    r[7] = this.readWORD(180);
  };
  
  this.TapeBinLoader = function() {
	
	// if should read tape
    if(cpu.regs[7] != (is11M ? 55692 : 39998)) return;

    var i,r = cpu.regs;
    var /*short*/ p = is11M ? r[0] : r[1];
    var /*QBusReadDTO*/ dto = new QBusReadDTO(-1); 
    var d = this.FakeTape.bytes;
    
    this.writeByte(/*(short)*/(is11M ? 42 : p+1), /*(byte)*/4);
    
    if (!this.readByte(p, dto)) return;
    var oper = dto.value&0xFF>>>0;
    if (oper == (is11M ? 1 : 3))
    {
      if (!this.readWord(/*(short)*/(p+2), dto)) return;
      var /*short*/ addr = dto.value;
      if (addr == 0)
        {
          addr = /*(short)*/(d[0]|(d[1]<<8))&0xFFFF>>>0;
        }
	
      console.log("Reading file "+this.FakeTape.filename+
	" at address "+addr.toString(8)+"\n");
	
      var /*short*/ size = /*(short)*/(d[2]|(d[3]<<8))&0xFFFF>>>0;
        
      for (i=0; i<size; i++) {
          this.writeByte(/*(short)*/(addr+i), /*(byte)*/d[4+i]);
        }
 
      if (is11M)
        {
          this.writeWord(/*(short)*/(p+24), addr);
          this.writeWord(/*(short)*/(p+26), size);
        }
      else
        {
          this.writeWord(/*(short)*/(p+22), addr);
          this.writeWord(/*(short)*/(p+24), size);
          this.writeWord(180, addr);
          this.writeWord(182, size);
        }
        
      var b,fill = false;
      for (i=0; i<16; i++)
        {
          if (!this.readByte(/*(short)*/(p+6+i), dto)) return;
          b = /*(byte)*/dto.value&0xFF>>>0;
          if (fill || (b==0))
          {
            fill = true;b = 32;
          }
          this.writeByte(/*(short)*/(p+(is11M ? 28 : 26)+i), b);
        }
        
        this.writeByte(/*(short)*/(p+1),0);
	
        this.readWord(r[6], dto);
	r[7] = dto.value&0xFFFF>>>0;
	r[6] = (r[6]+2)&0xFFFF>>>0;
	
	this.FakeTape.prep = false;
      
    }
  }
  
  // =====================================================
  // Public Methods - ROM Loading from Files
  // =====================================================
  
  // ROM size thresholds for auto-detection
  var ROM_SIZE_4KB = 5000;   // Disk controller ROM (< 5KB)
  var ROM_SIZE_8KB = 9000;   // BASIC/FOCAL ROM (< 9KB)
  
  /**
   * Load ROM file and auto-detect type by size
   * Can load BASIC, FOCAL, disk controller, or custom ROMs
   * 
   * @param {string} name - ROM filename (for identification)
   * @param {Array} data - ROM data bytes
   */
  this.loadROM = function(name, data) {
    var dataLength = data.length;
    
    // Convert byte array to 16-bit word array (little-endian)
    var wordCount = dataLength >> 1;  // Divide by 2
    var wordArray = new Uint16Array(wordCount);
    var byteIndex = 0;
    
    for (var i in wordArray) {
      var lowByte = data[byteIndex++];
      var highByte = data[byteIndex++];
      wordArray[i] = lowByte + (highByte << 8);
    }
    
    // Auto-detect ROM type by size and load accordingly
    if (dataLength < ROM_SIZE_4KB) {
      // Small ROM (< 5KB): Disk controller ROM
      // Setup BK-0011M and load at @160000
      set11Model();
      load160000(wordArray);
    }
    else if (dataLength < ROM_SIZE_8KB) {
      // Medium ROM (5-9KB): BASIC or FOCAL
      // Setup BK-0010 and load at @120000
      set10Model();
      load120000(wordArray);
    }
    else {
      // Large ROM (> 9KB): Custom ROM
      // Setup BK-0011M and load at @000000 (can overwrite RAM!)
      set11Model();
      load000000(wordArray);
    }
  };
  
  // =====================================================
  // Public Methods - Floppy Disk Drive Support
  // =====================================================
  
  // Jump instruction addresses for BK-0010 disk driver patch
  var DISK_PATCH_ADDR1 = 40960;   // @120000 (octal) - JMP instruction location
  var DISK_PATCH_ADDR2 = 40962;   // @120002 (octal) - Jump target address
  var JMP_OPCODE = 95;            // PDP-11 JMP @#addr instruction opcode
  var DISK_DRIVER_ADDR = 57344;   // @160000 (octal) - Disk driver entry point
  
  /**
   * Enable floppy disk drive support
   * Adds FDC (Floppy Disk Controller) to the system
   * For BK-0010, patches monitor ROM to jump to disk driver
   */
  this.addFloppies = function() {
    if (!self.dsks) {
      // First time: add FDC plugin and enable disks
      plugins.push(fdc);
      self.dsks = true;
    } else {
      // Already enabled: just mount/remount disks
      fdc.mountDisks();
    }
    
    // BK-0010 specific: patch monitor ROM to call disk driver
    // Writes "JMP @#160000" instruction at @120000
    if (!is11M && !self.remap) {
      self.writeWord(DISK_PATCH_ADDR1, JMP_OPCODE);      // JMP opcode
      self.writeWord(DISK_PATCH_ADDR2, DISK_DRIVER_ADDR); // Target address
    }
  };
  
  // =====================================================
  // Public Methods - Input Devices (Keyboard, Joystick)
  // =====================================================
  
  /**
   * Simulate key press on BK keyboard
   * @param {number} key - BK key code
   */
  this.keyboard_punch = function(key) {
    keyboard.punch(key);
  };
  
  /**
   * Set keyboard key down state
   * @param {boolean} isDown - True if key is pressed
   */
  this.keyboard_setKeyDown = function(isDown) {
    keyboard.setKeyDown(isDown);
  };
  
  /**
   * Set joystick state
   * @param {number} state - Joystick state bits
   */
  this.joystick_setState = function(state) {
    joystick.setState(state);
  };
  
  // =====================================================
  // Public Methods - Sound System Control
  // =====================================================
  
  var SYNTH_PAUSE_VALUE = 3333;  // Pause value for AY-8910
  
  /**
   * Update sound renderer state
   * Synchronizes with global soundOn variable from UI
   */
  this.sound_push = function() {
    // Check if sound state changed in UI
    if (srend.On !== (soundOn === 1)) {
      srend.setSound(soundOn);
    }
  };
  
  /**
   * Clear sound buffer and adjust speed
   */
  this.soundClear = function() {
    srend.clear(1);
    srend.adjConstSpeed();
  };
  
  /**
   * Configure sound system components
   * 
   * @param {boolean} synthOn - Enable AY-8910 synthesizer
   * @param {boolean} synthMix - Mix AY-8910 with speaker
   * @param {boolean} synthPaused - Pause AY-8910 initially
   * @param {boolean} covoxOn - Enable Covox DAC
   */
  this.sounds = function(synthOn, synthMix, synthPaused, covoxOn) {
    // Enable sound if any device is active
    if (synthOn || covoxOn) {
      soundOn = 1;
      self.sound_push();
    }
    
    // Configure AY-8910 synthesizer
    synth.On = synthOn;
    synth.mixed = synthMix;
    
    // Set initial pause state
    if (synthPaused) {
      srend.initpause = SYNTH_PAUSE_VALUE;
    } else if (!soundOn || !synthOn || covoxOn) {
      srend.initpause = 0;
    }
    
    // Configure Covox DAC
    self.setCovoxMode(covoxOn ? COVOX_DIRECT : COVOX_OFF);
  };
  
  /**
   * Allow or prevent sound buffer clearing
   * @param {boolean} allow - True to allow clearing
   */
  this.sound_clear_allow = function(allow) {
    srend.allowClear = allow;
  };
  
  /**
   * Get detected sound hardware type
   * @returns {number} Sound hardware flags (0=none, 1=speaker, 2=AY8910/Covox)
   */
  this.getSoundGuess = function() {
    return synth_guess;
  };
  
  // =====================================================
  // Constructor Initialization
  // =====================================================
  
  // Initialize palette maps and plugins
  init();
  
  // Load all ROM images into memory
  memLoads0();
  
  // Configure initial sound settings
  self.setCovoxMode(COVOX_OFF);  // Covox off by default (can sound like drill in WebAudio)
  
  // Set default BK model to BK-0010 with BASIC
  self.setBASIC10Model();
  
  // Connect AY-8910 synthesizer to sound renderer
  srend.setSynth(synth);
  
  return this;
};
