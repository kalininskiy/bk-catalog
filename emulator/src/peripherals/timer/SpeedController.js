/**
 * BK-0010 Speed Controller and Performance Monitor
 * 
 * Manages emulation speed, timing, and performance adjustments.
 * Responsibilities:
 * - CPU cycle counting and frequency control (3MHz or 4MHz modes)
 * - Frame rate management and synchronization
 * - Automatic performance correction to maintain target speed
 * - Real-time performance monitoring and display
 * - Animation frame-based timing (60Hz ticker)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
BKspeed = function()
{
  var self = this;
  
  // ============================================================================
  // CONSTANTS
  // ============================================================================
  
  var M = 1000000;        // 1 Million (for MHz calculations)
  var N = 30;             // Cycle adjustment step (±30 cycles per correction)
  var K = (M * 3) / 2;    // Maximum deviation threshold (1.5M cycles)
  var Q = 2000;           // Minimum error threshold for correction (2000 cycles)
  
  // ============================================================================
  // EMULATION SPEED SETTINGS
  // ============================================================================
  
  /**
   * Target CPU frequency in Hz
   * User configurable: 4MHz (default) or 3MHz (original BK-0010)
   */
  self.mhz = 4 * M;
  
  /**
   * Target frames (loops) per second
   * Typically 20 FPS, or 10 FPS in animation mode
   */
  self.fps = 20;

  /**
   * CPU cycles to execute per loop iteration
   * Automatically calculated based on MHz and FPS (200,000 at 4MHz / 20 FPS)
   */
  self.cyc = (self.mhz / self.fps) | 0;
  
  /**
   * Animation-based timing mode flag
   * 0 = timer-based, non-zero = requestAnimationFrame-based
   */
  self.anim = 0;
  
  // ============================================================================
  // PERFORMANCE MONITORING
  // ============================================================================
  
  /**
   * Ticker counter for 60Hz pulse
   * Counts from 0 to 60, used with requestAnimationFrame
   */
  self.tck = 0;
  
  /**
   * Actual CPU cycles executed in current second
   * Accumulated during execution, reset every second
   */
  self.realCycles = 0;
  
  /**
   * Average cycles per second (for sound generation)
   * Updated every second with actual performance
   */
  self.avgCycles = 4 * M;
  
  /**
   * requestAnimationFrame support flag
   * true if browser supports modern animation timing
   */
  self.AFr = false;
  
  /**
   * Last timestamp for performance measurement
   * Used to calculate elapsed time
   */
  self.lastNow = 0;
  
  // ============================================================================
  // INTERNAL FUNCTIONS
  // ============================================================================
  
  /**
   * Clears performance counters
   * Resets ticker and cycle counters to initial state
   */
  function clr() {
    self.tck = 0;                              // Reset 60Hz ticker
    self.realCycles = 0;                       // Reset actual cycle counter
    self.avgCycles = (self.cyc * self.fps) | 0; // Set expected cycles per second
    self.lastNow = 0;
  }
  
  // ============================================================================
  // PUBLIC API - SPEED CONFIGURATION
  // ============================================================================
  
  /**
   * Sets manual speed configuration (fixed cycles per loop)
   * Used for custom timing, disables automatic MHz adjustment
   * @param {number} c - Cycles to execute per loop
   * @param {number} n - Number of loops (frames) per second
   */
  this.set = function(c, n) {
    self.cyc = c;      // Set cycles per loop
    self.fps = n;      // Set loops per second
    
    self.mhz = 0;      // Disable automatic MHz-based adjustment
    self.anim = 0;     // Disable animation frame timing
    
    clr();             // Reset counters
    base.sound_clear_allow(false); // Disable sound buffering optimization
  }
	
  /**
   * Configures emulation to target specific CPU frequency
   * Enables automatic speed adjustment to maintain target MHz
   * @param {number} n - Target frequency in Hz (e.g., 3000000 for 3MHz, 4000000 for 4MHz)
   * @param {number} anim - Animation mode: 0=timer-based, non-zero=requestAnimationFrame-based
   */
  this.MHz = function(n, anim) {
    self.mhz = n;                    // Set target frequency
    self.fps = 20;                   // Default: ~20 loops per second
    self.cyc = (n / self.fps) | 0;   // Calculate initial cycles per loop (divide by fps)
    self.anim = anim;                // Set timing mode
    
    // Animation frame mode adjustments
    if (anim) {
      self.fps = 10;                 // Use 10 FPS for animation mode
      self.cyc *= 100 / 62;          // Adjust cycles for 60Hz animation frame timing
    }
    
    clr();                           // Reset counters
    base.sound_clear_allow(true);    // Enable sound buffering optimization
  }
	
  /**
   * Counts executed CPU cycles
   * Called after each emulation loop to track actual performance
   */
  this.count = function() {
    self.realCycles += self.cyc;     // Accumulate executed cycles
  }

  /**
   * Adjusts emulation speed to match target frequency
   * Called periodically to analyze performance and update display
   */
  this.adjust = function() {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var elapsedSec = (self.lastNow > 0) ? (now - self.lastNow) / 1000 : 1.0;
    self.lastNow = now;
    if (elapsedSec < 0.2) return;
    
    var actualFreq = Math.round(self.realCycles / elapsedSec);
    self.avgCycles = actualFreq;
    self.realCycles = 0;
    
    // ---- UPDATE DISPLAY ----
    var q = GE("MHZshow");
    if (q != null) {
      q.innerHTML = '' + (actualFreq / M).toFixed(1) + 'Mhz';
    }
  }
  
  /**
   * Initializes ticker system
   * Sets up requestAnimationFrame-based 60Hz timing if available
   */
  this.initTicker = function() {
    self.AFr = (window.requestAnimationFrame != null);  // Check browser support
    if (self.AFr) {
      pulse60tcks();                 // Start 60Hz pulse loop
    }
  }

  return self;                       // Return public interface
}

// ============================================================================
// ANIMATION FRAME TICKER (60Hz)
// ============================================================================

/**
 * Precision 60Hz pulse using requestAnimationFrame
 * Provides smooth timing synchronized with browser's refresh rate
 * Handles:
 * - 60-tick counter (1 second cycle)
 * - Performance adjustment every 60 ticks (once per second)
 * - Animation mode emulation loop triggering (every 6 ticks = 10 FPS)
 */
function pulse60tcks() {
  
  // Increment ticker (0-59)
  if ((++BK_speed.tck) >= 60) {
    BK_speed.adjust();               // Adjust speed once per second
    BK_speed.tck = 0;                // Reset ticker
  }
  
  // In animation mode, run emulation loop every 6 ticks (10 FPS)
  if (BK_speed.anim && (BK_speed.tck % 6 == 0)) {
    FPSloop(1);
  }
  
  // Schedule next frame (maintains ~60 FPS)
  window.requestAnimationFrame(pulse60tcks);
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

/**
 * Global speed controller instance
 * Used throughout the emulator for timing and performance monitoring
 */
var BK_speed = new BKspeed();
