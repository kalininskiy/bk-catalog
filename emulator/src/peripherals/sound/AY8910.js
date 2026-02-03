/**
 * AY-3-8910 Sound Chip Emulator
 * 
 * This emulates the AY-3-8910 Programmable Sound Generator (PSG) chip,
 * which has 3 tone channels, 1 noise generator, and envelope control.
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
AY8910 = function()
{
  var self = this;

  // ============================================================================
  // TIMING AND SAMPLING VARIABLES
  // ============================================================================
  
  var /*int*/xCps = 0;        // Cycles per sample (~62.5 for 2MHz chip / 32kHz audio)
  var /*int*/c32 = 0;         // xCps * 32 (used for normalization)
  var /*int*/xSubPos = 0;     // Sub-sample position counter (0-63)
  var /*int*/cy16 = 0;        // 16-cycle counter for tone/noise/envelope updates

  // ============================================================================
  // AY-3-8910 REGISTERS (16 registers, R0-R15)
  // ============================================================================
  
  var /*int[16]*/ayRegs = []; // AY chip registers (16 bytes)
  var /*int*/R = -1;          // Currently selected register index (-1 = none)
	
  // Volume lookup table: exponential curve for more natural sound
  var /*int[]*/vol = [ 0, 1, 2, 3, 5, 7, 11, 15, 22, 31, 45, 63, 90, 127, 180, 255 ];
	
  // ============================================================================
  // TONE GENERATORS (3 channels: A, B, C)
  // ============================================================================
  
  var /*int[3]*/tones = [0, 0, 0];          // Tone periods (from R0-R5)
  var /*int[3]*/toneCntrs = [0, 0, 0];      // Current tone counters
  var /*int[3]*/toneToggles = [0, 0, 0];    // Tone output state (0 or 1)
  
  // ============================================================================
  // ENVELOPE GENERATOR
  // ============================================================================
  
  var /*int*/ePeriod = 0;     // Envelope period (from R11-R12)
  var /*int*/eCntr = 0;       // Envelope counter
  var /*int*/e = 0;           // Current envelope value (0-15)
  var /*int*/ne = 0;          // Negative envelope flag (0 or 15 for XOR)
  var /*boolean*/st = false;  // Envelope stopped flag
  
  // ============================================================================
  // NOISE GENERATOR
  // ============================================================================
  
  var /*int*/nSR = 65535;     // 17-bit noise shift register (LFSR)
  var /*int*/nPeriod = 0;     // Noise period (from R6)
  var /*int*/nCntr = 0;       // Noise counter

  // ============================================================================
  // OUTPUT MIXING
  // ============================================================================
  
  var mix = 0;                // Mixed output of all 3 channels (when mixed=true)
  
  self.mixed = true;          // Mixing mode: true=mono (faster), false=3 channels (slower)
  
  var U = [0, 0, 0];          // Unmixed channel values (when mixed=false)
  
  self.On = false;            // Chip power state
  
  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  function init()
  {
    // Set timing: 2MHz chip frequency / 32kHz sample rate / 16-cycle divider
    // Results in ~4000, meaning ~62.5 chip cycles per audio sample
    xCps = 4000;
    c32 = xCps * 32;
    
    // Initialize all 16 AY registers to 0
    for (var i = 0; i < 16; i++) {
      ayRegs[i] = 0;
    }
  }

  // ============================================================================
  // NOISE GENERATOR
  // ============================================================================
  
  /**
   * Updates the 17-bit Linear Feedback Shift Register (LFSR) for noise generation
   * Uses taps at bits 0 and 3 (polynomial x^17 + x^3 + 1)
   */
  function /*void*/updateNoise() {
    if (nSR & 1) {
      nSR ^= 0x12000;  // XOR with tap pattern (bits 12 and 17)
    }
    nSR >>>= 1;        // Shift right (unsigned)
  }

  // ============================================================================
  // MAIN EMULATION CYCLE
  // ============================================================================
  
  /**
   * Processes one chip cycle
   * Updates tone generators, noise, envelope, and mixes output every 16 cycles
   */
  function /*void*/nextCycle()
  {
    // Update every 16 chip cycles (divider for tone/noise/envelope)
    if ((++cy16) >= 16) {
      cy16 = 0;
      
      // ---- UPDATE TONE GENERATORS (3 channels) ----
      for (var i = 0; i < 3; ++i)
      {
        var /*int*/a = toneCntrs[i] - 1;
        if (a <= 0) {
          a = tones[i];           // Reload counter with period
          toneToggles[i] ^= 1;    // Toggle output (square wave)
        }
        toneCntrs[i] = a;
      }

      // ---- UPDATE NOISE GENERATOR ----
      if ((--nCntr) <= 0) {
        nCntr = nPeriod;          // Reload noise counter
        updateNoise();            // Advance LFSR
      }

      // ---- UPDATE ENVELOPE GENERATOR ----
      if ((--eCntr) <= 0) {
        eCntr = ePeriod;          // Reload envelope counter
        
        if (!st) {                // If envelope not stopped
          e = (++e) & 0xF;        // Increment envelope step (0-15)
          
          if (e == 0) {           // Envelope cycle complete
            var /*int*/shape = ayRegs[13];  // R13: envelope shape control

            // Bit 3 (0x08): Continue (0=one-shot, 1=repeat)
            if ((shape & 8) == 0) {
              st = true;          // Stop envelope (one-shot mode)
              ne = 0;
            } else {
              // Bit 1 (0x02): Alternate direction each cycle
              if (shape & 2) ne = (ne ^ 15) >>> 0;
              
              // Bit 0 (0x01): Hold after first cycle
              if (shape & 1) {
                st = true;        // Stop and hold
                ne = (ne ^ 15) >>> 0;
              }
            }
          }
        }
      }
      
      // ---- RESET OUTPUT ACCUMULATORS ----
      if (self.mixed) {
        mix = 0;                  // Reset mixed mono output
      } else {
        U[0] = 0;                 // Reset individual channel outputs
        U[1] = 0;
        U[2] = 0;
      }

      // ---- MIX CHANNELS ----
      for (var c = 0; c < 3; ++c) {
        
        var isOn = 1;             // Assume channel is on
        
        // Check tone enable (R7 bits 0-2): 0=enabled, 1=disabled
        if ((ayRegs[7] & (1 << c)) == 0) {
          isOn = toneToggles[c];  // Use tone generator output
        }

        // Check noise enable (R7 bits 3-5): 0=enabled, 1=disabled
        // AND with noise output (bit 0 of LFSR)
        if (((ayRegs[7] & (8 << c)) == 0) && 
            ((nSR & 1) == 0)) {
          isOn = 0;               // Mute if noise is low
        }

        if (isOn) {
          // Get amplitude for this channel (R8-R10)
          var amp = ayRegs[(8 + c)];

          // Bit 4 (0x10): use envelope instead of fixed amplitude
          if ((amp & 0x10) != 0) {
            amp = e ^ ne;         // Apply envelope with inversion
          }
          
          // Look up volume from exponential table
          var v = vol[(amp & 15) >>> 0];
          
          // Add to output
          if (self.mixed) {
            mix += v;             // Mix to mono
          } else {
            U[c] += v;            // Keep channels separate
          }
        }
      }
    }
  }
  
  // ============================================================================
  // SAMPLE GENERATION (MIXED MODE)
  // ============================================================================
  
  /**
   * Generates next mixed (mono) audio sample
   * Uses sub-sample interpolation for smooth output
   * @returns {number} Audio sample value (-64 to +64)
   */
  function nextMixed()
  {
    var /*int*/step = 64 - xSubPos;    // Cycles until next sub-sample boundary
    var /*int*/Rem = xCps - step;      // Remaining cycles after boundary
    
    var a = (mix * step);              // Accumulate: start with partial step

    // Process full 64-cycle chunks
    while (Rem >= 64) {
      a += (mix << 6);                 // Add full cycle (* 64)
      Rem -= 64;
      nextCycle();                     // Advance chip state
    }

    xSubPos = Rem;                     // Save remaining fractional cycles

    return F(a + (mix * Rem));         // Finalize with partial step
  }
  
  /**
   * Finalizes audio sample value
   * Normalizes and converts to signed range
   * @param {number} v - Accumulated value
   * @returns {number} Signed audio sample (-64 to +64)
   */
  function F(v) {
    v /= c32;                          // Normalize by (xCps * 32)
    if (v > 64) v -= 128;              // Convert unsigned to signed range
    return v;
  }
      
  // ============================================================================
  // PUBLIC API - SAMPLE GENERATION
  // ============================================================================
  
  /**
   * Generates next audio sample(s)
   * @returns {number|Array} Mono sample if mixed=true, or [chA, chB, chC] if mixed=false
   */
  /*int*/this.nextSample = function()
  {
    if (self.mixed) {
      return nextMixed();                // Return single mixed value
    }
    
    // Generate separate channel outputs
    var /*int*/step = 64 - xSubPos;      // Cycles until next sub-sample boundary
    var /*int*/Rem = xCps - step;        // Remaining cycles after boundary

    // Accumulate each channel separately
    var a = (U[0] * step);
    var b = (U[1] * step);
    var c = (U[2] * step);

    // Process full 64-cycle chunks
    while (Rem >= 64) {
      a += (U[0] << 6);                  // Channel A (* 64)
      b += (U[1] << 6);                  // Channel B (* 64)
      c += (U[2] << 6);                  // Channel C (* 64)
      Rem -= 64;
      nextCycle();                       // Advance chip state
    }

    xSubPos = Rem;                       // Save remaining fractional cycles
    
    // Return array of 3 channel values
    return [
      F(a + (U[0] * Rem)),               // Channel A
      F(b + (U[1] * Rem)),               // Channel B
      F(c + (U[2] * Rem))                // Channel C
    ];
  }

  // ============================================================================
  // PUBLIC API - REGISTER I/O
  // ============================================================================
  
  /**
   * Selects AY register for subsequent read/write
   * @param {number} reg - Register index (0-15)
   */
  /*void*/this.setRegIndex = function(/*int*/reg) {
    R = reg;
  }

  /**
   * Writes data to currently selected AY register
   * AY-3-8910 Register Map:
   *   R0-R1:  Channel A tone period (12-bit)
   *   R2-R3:  Channel B tone period (12-bit)
   *   R4-R5:  Channel C tone period (12-bit)
   *   R6:     Noise period (5-bit)
   *   R7:     Mixer control (I/O enable, noise enable, tone enable)
   *   R8-R10: Channel A, B, C amplitude (4-bit) / envelope enable
   *   R11-R12: Envelope period (16-bit)
   *   R13:    Envelope shape
   *   R14-R15: I/O ports (not implemented here)
   * 
   * @param {number} data - Byte value to write
   */
  /*void*/this.writeReg = function(/*byte*/data)
  {
    if ((R >= 0) && (R < 16)) {
      ayRegs[R] = data;
      
      // R0-R5: Tone periods (12-bit values across 2 registers per channel)
      if ((R >= 0) && (R <= 5))
      {
        for (var i = 0; i < 3; ++i) {
          var j = i << 1;  // Channel offset: 0, 2, 4
          tones[i] = ((ayRegs[j] | (ayRegs[j + 1] << 8)) & 0xFFF);
        }
      }
      
      // R11-R12: Envelope period (16-bit value)
      else if ((R == 12) || (R == 11)) {
        ePeriod = (ayRegs[11] | (ayRegs[12] << 8));
      }
      
      // R6: Noise period (5-bit value, doubled internally)
      else if (R == 6) {
        data &= 0x1F;           // Mask to 5 bits
        nPeriod = (data * 2);   // Internal doubling
      }
      
      // R13: Envelope shape - reset envelope to start
      else if (R == 13)
      {
        e = 0;                  // Reset envelope position
        // Bit 2 (0x04): Attack (0=down, 1=up)
        ne = ((data & 4) ? 0 : 15);
        st = false;             // Envelope running
        eCntr = ePeriod;        // Reload counter
      }
    }
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  init();              // Initialize chip on creation
  
  return self;         // Return public interface
}
