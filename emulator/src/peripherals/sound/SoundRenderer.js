/**
 * BK-0010/0011 Sound Renderer
 * 
 * Manages audio output using Web Audio API.
 * Supports three audio sources:
 * 1. Speaker bit (tape/speaker output via system register)
 * 2. Covox (8-bit DAC for digital audio)
 * 3. AY-3-8910 sound chip (3-channel PSG)
 * 
 * Audio Pipeline:
 * 1. CPU generates audio samples synchronized with CPU cycles
 * 2. Samples are accumulated in buffer (B)
 * 3. Web Audio API pulls samples via onaudioprocess callback
 * 4. Samples are mixed and output at 48kHz
 * 
 * Features:
 * - Adaptive sample rate synchronization
 * - Buffer management with overflow protection
 * - Smooth audio output with interpolation
 * - Support for mono (1 channel) or stereo (3 channels)
 * - Dynamic speed adjustment based on emulation speed
 * 
 * Sample Format:
 * - Float32 samples in range [-1.0, 1.0]
 * - Sample rate: ~48kHz (48010 Hz)
 * - Buffer size: 4096 samples per callback
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
SoundRenderer = function()
{
  var self = this;
  
  // ============================================================================
  // CONFIGURATION FLAGS
  // ============================================================================
  
  /**
   * Allow automatic buffer clearing
   * When true, buffer is cleared during silence to prevent overflow
   */
  this.allowClear = true;

  // ============================================================================
  // TIMING AND SYNCHRONIZATION
  // ============================================================================
  
  /**
   * CPU cycles per audio sample
   * Calculated as: (CPU_frequency / sample_rate) × 4096
   * Used to synchronize audio with CPU timing
   */
  var /*int*/xCPS = 0;
  
  /**
   * Reference to AY-3-8910 synthesizer
   * null if not available
   */
  var synth = null;
  
  /**
   * ScriptProcessorNode for Web Audio API
   * Handles audio buffer processing
   */
  var P = null;
  
  // ============================================================================
  // AUDIO BUFFER
  // ============================================================================
  
  /**
   * Audio sample buffer
   * Format: mono (float) or 3-channel (array of 3 floats)
   */
  var B = [];
  
  /**
   * Current playback position in buffer
   * Index of next sample to be played
   */
  var Bpos = 0;
  
  /**
   * Buffer underrun flag/counter
   * >0 when buffer is empty and last sample should be repeated
   */
  var Bz = 0;
  
  /**
   * Buffer clear request counter
   * 0 = no clear, 1 = clear when empty, 2 = clear on silence
   */
  var Bclr = 0;
  
  /**
   * Speed adjustment counter
   * Incremented on each sample, triggers buffer clear at threshold
   */
  var adjspd = 0;

  // ============================================================================
  // SAMPLE ACCUMULATION
  // ============================================================================
  
  /**
   * Offset within current sample period
   * Tracks partial sample accumulation (0 to xCPS)
   */
  var /*int*/ofs = 0;
  
  /**
   * Accumulated sample value
   * Builds up sample value over CPU cycles
   */
  var /*int*/xAcc = 0;
  
  /**
   * Current combined audio value
   * Sum of bitVal + covoxVal + synthVal
   */
  var /*int*/val = -16;
  
  /**
   * AY-3-8910 synthesizer output value
   * Can be mono (float) or 3-channel (array)
   */
  var /*int*/synthVal = 0;
  
  /**
   * Covox DAC output value
   * 8-bit signed value (-128 to +127)
   */
  var /*int*/covoxVal = 0;
  
  /**
   * Speaker bit output value
   * -16 (off) or +16 (on)
   */
  var /*int*/bitVal = -16;
  
  /**
   * Number of audio channels
   * 1 = mono (speaker/covox), 3 = stereo (AY-3-8910 separate channels)
   */
  var Chan = 1;
  
  // ============================================================================
  // WEB AUDIO CONTEXT
  // ============================================================================
  
  /**
   * Web Audio API context
   * null until audio is initialized
   */
  var context = null;
  
  // ============================================================================
  // PUBLIC STATE
  // ============================================================================
  
  /**
   * Sound enabled flag
   * true = audio output enabled, false = audio muted
   */
  self.On = false;
  
  /**
   * Covox mode flag
   * true when Covox DAC is active
   */
  self.covox = false;
  
  /**
   * CPU cycle counter
   * Last CPU cycle count when audio was updated
   */
  self.cycles = 0;
  
  /**
   * Initial pause counter
   * Delays audio output on startup to let buffer fill
   */
  self.initpause = 0;
  
  // ============================================================================
  // INITIALIZATION FUNCTIONS
  // ============================================================================
  
  /**
   * Sets AY-3-8910 synthesizer reference
   * @param {Object} S - AY8910 synthesizer object
   */
  this.setSynth = function(S) {
    synth = S;
  }
  
  /**
   * Enables or disables sound output
   * Initializes Web Audio API on first enable
   * @param {boolean} on - True to enable sound, false to disable
   */
  this.setSound = function(on) {
    self.On = on;
    
    // ---- INITIALIZE WEB AUDIO API ----
    if (on && context == null) {
      // Try different AudioContext names (browser compatibility)
      var A = (window.AudioContext || window.webkitAudioContext ||
        window.WebkitAudioContext);
      
      if (A == null) {
        soundOn = 0;  // Browser doesn't support Web Audio API
        return;
      }
      
      context = new A();
      
      // Check for ScriptProcessorNode support
      if (typeof(context.createScriptProcessor) == "undefined") {
        context = null;
        soundOn = 0;
        return;
      }
      
      // Create audio processor node
      // Parameters: bufferSize (4096), inputChannels (3), outputChannels (3)
      // 
      // NOTE: ScriptProcessorNode is deprecated and will be removed in future browsers.
      // TODO: Migrate to AudioWorkletNode for better performance and future compatibility.
      // See: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode
      // Migration requires creating a separate AudioWorklet processor file.
      P = context.createScriptProcessor(4096, 3, 3);
      if (P != null) {
        P.onaudioprocess = onAudio;  // Set callback
      }
    }

    // ---- CONNECT/DISCONNECT AUDIO OUTPUT ----
    if (context != null && P != null) {
      if (on) {
        P.connect(context.destination);  // Start audio output
      }
      else {
        P.disconnect();  // Stop audio output
        clear2();        // Clear buffers
      }
    }
  }
  
  /**
   * Clears audio buffers and resets state
   * Internal version - always clears immediately
   */
  function clear2() {
    if (!self.initpause) {
      B = [];        // Clear sample buffer
      Bpos = 0;      // Reset playback position
      Bz = 0;        // Clear underrun flag
    }
    adjustSpeed();   // Recalculate timing
    adjspd = 0;      // Reset speed adjustment counter
    ofs = 0;         // Reset sample offset
    xAcc = 0;        // CRITICAL: Clear accumulated sample value
    Bclr = 0;        // Clear clear request
    
    // Reset val only if smoothing sources active, or if speaker is off
    // In speaker-only mode with active bit, keep val = bitVal for accumulation
    if (synth.On || self.covox || bitVal == -16) {
      val = 0;
    }
  }

  /**
   * Requests buffer clear
   * Two modes:
   * - Immediate clear (a=true)
   * - Deferred clear (a=false): waits for silence, then clears
   * 
   * @param {boolean} a - True for immediate clear, false for deferred
   */
  this.clear = function(a) {
    if (a) {
      clear2();  // Immediate clear
    }
    else {
      if (self.allowClear) {
        Bclr++;  // Request deferred clear (1=on empty, 2=on silence)
      }
      else {
        // Buffer overflow protection: remove old samples
        if (B.length & 0x100000) {  // If buffer is very large (~1M samples)
          var r = Bpos - 10240;
          if (r > 0) {
            B.splice(0, r);  // Remove played samples
            Bpos -= r;
          }
        }
      }
    }
  }
  // ============================================================================
  // AUDIO CALLBACK (Web Audio API)
  // ============================================================================
  
  /**
   * Audio processing callback (ScriptProcessorNode onaudioprocess)
   * Called by Web Audio API ~every 23.2ms (4096 samples / 48kHz ≈ 85ms)
   * Fills output buffer with samples from internal buffer
   * 
   * Process:
   * 1. Check if in initial pause (output silence)
   * 2. Copy samples from buffer B to output
   * 3. Handle buffer underrun (repeat last sample)
   * 4. Handle deferred clear requests
   * 5. Fill remaining output with zeros
   * 
   * @param {Object} e - Audio processing event with outputBuffer property
   */
  function onAudio(e) {
    var p = Bpos;                    // Playback position
    var O, O2;                       // Output channel buffers
    var c12 = (Chan == 1);           // True if mono (1 channel)
    
    // ---- PROCESS EACH CHANNEL ----
    for (var C = 0; C < Chan; C++) {
      
      // Get output buffer for this channel
      O = e.outputBuffer.getChannelData(C);
      
      // For mono: copy channel 0 to channel 1 (left = right)
      if (c12) {
        O2 = e.outputBuffer.getChannelData(1);
      }
      
      var j = 0;                     // Output buffer position
      var Sz = O.length;             // Output buffer size (4096)
      var L = B.length;              // Internal buffer length
      
      // ---- INITIAL PAUSE MODE ----
      if (self.initpause)
      {
        self.initpause--;
        
        // Output silence during pause
        while (j < Sz) {
          if (c12) O2[j] = 0;
          O[j++] = 0;
        }
      }
      // ---- NORMAL PLAYBACK MODE ----
      else
      {
        p = Bpos;
        
        // ---- COPY SAMPLES FROM BUFFER ----
        if (c12) {
          // Mono mode: copy same sample to both channels
          while (j < Sz && p < L) {
            O2[j] = B[p];            // Right channel
            O[j++] = B[p++];         // Left channel
          }
        }
        else {
          // 3-channel mode: separate channels (AY-3-8910)
          while (j < Sz && p < L) {
            O[j++] = B[p++][C];
          }
        }
        
        // ---- CHECK FOR BUFFER UNDERRUN ----
        if (j > 0) {
          Bz = 0;  // Reset underrun flag
          
          // If output not filled and buffer not empty, mark underrun
          if (j < Sz && p > 1) {
            Bz = 1;
          }
        }

        // ---- HANDLE BUFFER UNDERRUN (repeat last sample) ----
        var last = (p == 0 ? 0 : (Chan == 1 ? B[p - 1] : B[p - 1][C]));
        
        if (Bz) {
          // Emulator too slow, repeat last sample to avoid clicks
          while (j < Sz) {
            if (c12) O2[j] = last;
            O[j++] = last;
          }
        }
        
        // ---- HANDLE DEFERRED CLEAR (only on last channel) ----
        if (C == (Chan - 1)) {
          if (Bclr) {
            switch (Bclr) {
            case 1:  // Clear if buffer empty
              if (j < Sz) clear2();
              break;
            case 2:  // Clear if last sample is silence
              if (last == 0) clear2();
              break;
            }
          }
        }
        
        // ---- FILL REMAINING OUTPUT WITH SILENCE ----
        while (j < Sz) {
          if (c12) O2[j] = 0;
          O[j++] = 0;
        }
      }
    }  // End for each channel
    
    Bpos = p;  // Update playback position
  }
  
  // ============================================================================
  // TIMING ADJUSTMENT
  // ============================================================================
  
  /**
   * Adjusts sample rate based on emulation speed
   * Calculates xCPS (CPU cycles per sample × 4096)
   * 
   * Formula:
   * - cycles_per_second = CPU frequency or actual performance
   * - cycles_per_sample = cycles_per_second / sample_rate
   * - xCPS = cycles_per_sample × 4096 (for fixed-point math)
   * 
   * @param {boolean} c - True = use target speed, False = use actual speed
   */
  function adjustSpeed(c) {
    var S = BK_speed;
    
    // Determine speed: target (configured) or actual (measured)
    var spd = (c ? (S.mhz ? S.mhz : S.cyc * S.fps) : S.avgCycles);
    
    // Calculate CPU cycles per audio sample
    // Sample rate: 48010 Hz (slightly above 48kHz for better sync)
    var C = (spd / 48010) | 0;
    
    // Store as fixed-point value (multiply by 4096 for precision)
    xCPS = (C * 4096);
  }
  
  /**
   * Adjusts speed using constant (target) speed
   * Public interface for speed adjustment
   */
  this.adjConstSpeed = function() {
    adjustSpeed(true);
  };
  
  // ============================================================================
  // SAMPLE GENERATION
  // ============================================================================

  /**
   * Updates audio based on elapsed CPU cycles
   * Called frequently during emulation to generate audio samples
   * 
   * Process:
   * 1. Calculate elapsed CPU cycles
   * 2. Convert cycles to audio samples (fixed-point math)
   * 3. Accumulate partial samples
   * 4. Generate complete samples when threshold reached
   * 5. Clear inactive audio sources
   * 
   * Algorithm uses fixed-point arithmetic:
   * - All values scaled by 4096 for precision
   * - xStep = elapsed_cycles × 4096
   * - xCPS = cycles_per_sample × 4096
   * - When xStep >= xCPS, generate one sample
   */
  /*void*/this.updateTimer = function()
  {
    var /*long*/cy = cpu.Cycles;                           // Current CPU cycle count
    var /*int*/xStep = /*(int)*/(cy - self.cycles) * 4096; // Elapsed cycles (scaled)
    var /*int*/xRem = xCPS - ofs;                          // Cycles remaining in current sample
    
    // ---- CASE 1: NOT ENOUGH CYCLES FOR COMPLETE SAMPLE ----
    if (xStep < xRem)
    {
      xAcc += val * xStep;   // Accumulate partial sample
      ofs += xStep;          // Update offset
    }
    // ---- CASE 2: ENOUGH CYCLES FOR ONE OR MORE SAMPLES ----
    else
    {
      // Complete current sample
      xAcc += val * xRem;
      cSum(xAcc);            // Output accumulated sample
      xStep -= xRem;
      ofs = 0;
      xAcc = 0;
      
      // Generate additional complete samples
      while (xStep >= xCPS) {
        cSum(val * xCPS);    // Output full sample
        xStep -= xCPS;
      }
      
      // Start accumulating next sample
      xAcc = (val * xStep);
      ofs = xStep;
      
      // Periodic buffer clear check (every ~50000 samples ≈ 1 second)
      if (!self.initpause && (++adjspd) > 50000) {
        // Only clear if audio is silent (prevents clicks/pops)
        // Check multiple conditions for silence:
        // 1. Smoothed sources (synth/covox): val near zero
        // 2. Speaker bit: bitVal at default (off) position
        var isSilent = (Math.abs(val) < 2) || (bitVal == -16 && !synth.On && !self.covox);
        
        if (isSilent) {
          self.clear();
        }
        adjspd = 0;  // Reset counter anyway to prevent overflow
      }
    }

    self.cycles = cy;  // Update last cycle count
    
    // ---- CLEAR INACTIVE AUDIO SOURCES ----
    if (!self.covox) covoxVal = 0;     // Covox off
    if (!synth.On) synthVal = 0;       // Synthesizer off
    if (!self.On) bitVal = -16;        // Speaker off
    
    // CRITICAL FIX: Clear residual val when all sources are off or only speaker is on
    // This prevents "ghost" clicks after smoothed sound stops
    if (!synth.On && !self.covox && bitVal == -16) {
      // All sources off - clear residual
      val = 0;
    }
    else if (!synth.On && !self.covox && bitVal != -16) {
      // Only speaker is on - ensure val matches bitVal (no residuals from smoothing)
      val = bitVal;
    }
  }

  /**
   * Completes and outputs one audio sample
   * Mixes audio sources and adds sample to buffer
   * 
   * Audio Sources (priority order):
   * 1. AY-3-8910 synthesizer (if enabled)
   *    - Mixed mode: single channel combined output
   *    - Separate mode: 3 independent channels
   * 2. Covox DAC (if enabled)
   *    - 8-bit digital audio
   *    - Smoothed to reduce clicks
   * 3. Speaker bit (fallback)
   *    - Simple on/off tape output
   * 
   * Smoothing:
   * - Limits value changes to ±32 per sample
   * - Prevents clicks and pops
   * 
   * Channel Switching:
   * - Mono (1 channel): speaker, covox, or mixed AY
   * - Stereo (3 channels): separate AY channels
   * - Clears buffer when switching modes
   * 
   * @param {number} A - Accumulated sample value
   */
  function cSum(A) {
    var g, c;

    // ---- AUDIO SOURCE SELECTION ----
    
    if (synth.On) {
      // AY-3-8910 synthesizer is active
      synthVal = synth.nextSample();  // Get next sample (mono or 3-channel)
      
      if (synth.mixed) {
        // Mixed mode: combine with other sources (speaker/covox)
        // Target value includes all active sources
        var targetVal = synthVal + bitVal + covoxVal;
        c = targetVal - val;
        
        // Smooth value change (limit to ±32 per sample)
        val += (c > 32 ? 32 : (c < -32 ? -32 : c));
        
        // Aggressively zero out very small residual values to prevent clicks
        if (Math.abs(val) < 0.5) {
          val = 0;
        }
        
        g = val;
      }
      else {
        // Separate channels mode: AY only, ignore other sources
        g = synthVal;
        synthVal = 0;
        val = 0;
      }
    }
    else if (self.covox) {
      // Covox DAC is active (phase 2)
      // Target value includes covox + speaker bit
      var targetVal = covoxVal + bitVal;
      c = targetVal - val;
      
      // Smooth value change (limit to ±32 per sample)
      val += (c > 32 ? 32 : (c < -32 ? -32 : c));
      
      // Aggressively zero out very small residual values to prevent clicks
      if (Math.abs(val) < 0.5) {
        val = 0;
      }
      
      g = val;
    }
    else {
      // Speaker bit only
      g = (A / xCPS);  // Convert accumulated value to sample
      
      // NOTE: val is managed by updateTimer() in speaker-only mode
      // Don't reset it here - it's set correctly in updateBit()
    }

    // ---- CHANNEL MODE SWITCHING ----
    var q = Chan;
    
    // Determine channel count: 1 (mono) or 3 (stereo)
    Chan = (synth.On && !synth.mixed ? 3 : 1);
    
    // Clear buffer if channel count changed (with safety check)
    if (Chan != q) {
      // Only clear if buffer is small or audio is near silence
      // This prevents clicks during channel switching
      if (B.length < 100 || Math.abs(val) < 2) {
        clear2();
      } else {
        // Force clear on next cycle when it's safer
        Bclr = 1;
      }
    }
    
    // ---- ADD SAMPLE TO BUFFER ----
    // Note: Float values should be in range [-1.0, 1.0]
    // Current implementation uses larger range, but works
    B.push(g);
  }
  
  // ============================================================================
  // AUDIO SOURCE UPDATE FUNCTIONS
  // ============================================================================
  
  /**
   * Updates speaker bit output
   * Called when system register bit 6 (177716) changes
   * 
   * Speaker bit produces simple on/off audio:
   * - Used for tape loading/saving
   * - Used for simple beeps and clicks
   * - Combined with covox and synth when mixed
   * 
   * @param {number} maskedVal - Masked bit value (0 or non-zero)
   */
  /*void*/this.updateBit = function(/*int*/maskedVal) {
    self.updateTimer();  // Generate samples up to current time
    
    // Convert bit to audio value
    bitVal = ((maskedVal == 0) ? -16/*Off*/ : 16/*On*/);
    
    // Update val for accumulation in updateTimer()
    // In speaker-only mode, val is used for accumulation (xAcc += val * xStep)
    // In synth/covox modes, val is managed by smoothing in cSum()
    if (!synth.On && !self.covox) {
      // Speaker-only mode: set val directly
      val = bitVal;
    }
    // In synth/covox modes, val will be updated by cSum() smoothing
  }

  /**
   * Updates Covox DAC output
   * Called when Covox register is written (port 177714/177716)
   * 
   * Covox is an 8-bit DAC that allows:
   * - Digital audio playback
   * - Sample playback
   * - Music playback (digitized)
   * 
   * Value Processing (Phase 1):
   * 1. Extract 8-bit value (0-255)
   * 2. Convert to signed (-128 to +127)
   * 3. Scale by /2 to blend better with other sources
   * 
   * @param {number} value - 8-bit DAC value (0-255)
   */
  /*void*/this.updateCovox = function(/*int*/value) {
    self.updateTimer();  // Generate samples up to current time
    
    var v = value & 255;  // Mask to 8 bits
    
    // Convert unsigned (0-255) to signed (-128 to +127)
    // Then scale by /2 for better mixing
    covoxVal = (v & 128 ? v - 256 : v) / 2;  // Phase 1: update value
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  adjustSpeed();  // Initialize timing on creation
  
  return self;    // Return public interface
}
