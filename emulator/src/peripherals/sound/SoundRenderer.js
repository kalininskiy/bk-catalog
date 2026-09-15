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
  
  /**
   * GainNode for volume control (0 = mute, 1 = full)
   * Inserted between P and context.destination
   */
  var gainNode = null;
  
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

  /**
   * Флаг наполнения подушки буфера
   * true = ожидание накопления минимального запаса перед стартом воспроизведения
   */
  var isBuffering = true;

  /**
   * Параметры управления задержкой аудио (Low-Latency Audio Buffering)
   * TARGET_CUSHION (~106 мс при 48 кГц) обеспечивает достаточный запас для 50 FPS (20 мс кадры)
   * MAX_BACKLOG (~500 мс) — порог отсечения залежавшегося хвоста только при долгой неактивности вкладки
   */
  var TARGET_CUSHION = 5120;
  var MAX_BACKLOG = 24000;
  var baseXcps = 0;

  /**
   * Состояние фильтра DC-блокера спикера (AC-coupling)
   */
  var spkDcIn = 0;
  var spkDcOut = 0;

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
   * Output volume 0..1 (used when GainNode is created)
   */
  self.volume = 1;
  
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
    if (synth && synth.setSampleRate && context && context.sampleRate) {
      synth.setSampleRate(context.sampleRate);
    }
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

      // Передаем фактическую частоту дискретизации в AY-3-8910
      if (synth && synth.setSampleRate) {
        synth.setSampleRate(context.sampleRate);
      }
      
      // Check for ScriptProcessorNode support
      if (typeof(context.createScriptProcessor) == "undefined") {
        context = null;
        soundOn = 0;
        return;
      }
      
      // Создаем аудиопроцессор с размером буфера 2048 для минимальной задержки (~42.6 мс)
      P = context.createScriptProcessor(2048, 3, 3);
      if (P != null) {
        P.onaudioprocess = onAudio;  // Устанавливаем обработчик
      }
      // Узел громкости
      gainNode = context.createGain();
      gainNode.gain.value = 1.0;
      gainNode.connect(context.destination);

      // Разблокировка AudioContext при первом клике или нажатии клавиши
      var unlockAudio = function() {
        if (context && context.state === 'suspended') {
          context.resume().then(function() {
            if (B.length > TARGET_CUSHION) {
              Bpos = B.length - TARGET_CUSHION;
            }
          });
        }
      };
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        ['click', 'keydown', 'touchstart', 'pointerdown'].forEach(function(evt) {
          window.addEventListener(evt, unlockAudio, { passive: true, once: false });
        });
      }
    }

    // ---- CONNECT/DISCONNECT AUDIO OUTPUT ----
    if (context != null && P != null && gainNode != null) {
      if (on) {
        P.connect(gainNode);  // Output via gainNode (volume)
      }
      else {
        P.disconnect();  // Stop audio output
        clear2();        // Clear buffers
      }
    }
  }

  /**
   * Sets output volume (0 = mute, 1 = full).
   * Applied immediately; used by UI volume slider.
   * @param {number} vol - Volume in range 0..1
   */
  this.setVolume = function(vol) {
    var v = Math.max(0, Math.min(1, Number(vol)));
    self.volume = v;
    if (gainNode != null) {
      gainNode.gain.value = 1.0;
    }
  };

  /**
   * Returns current volume (0..1).
   * @returns {number}
   */
  this.getVolume = function() {
    return typeof self.volume === 'number' ? self.volume : 1;
  };
  
  /**
   * Clears audio buffers and resets state
   * Internal version - always clears immediately
   */
  function clear2() {
    if (!self.initpause) {
      B = [];        // Clear sample buffer
      Bpos = 0;      // Reset playback position
      Bz = 0;        // Clear underrun flag
      isBuffering = true; // Сброс в режим накопления подушки
    }
    adjustSpeed(true); // Recalculate timing
    adjspd = 0;      // Reset speed adjustment counter
    ofs = 0;         // Reset sample offset
    xAcc = 0;        // CRITICAL: Clear accumulated sample value
    Bclr = 0;        // Clear clear request
    spkDcIn = 0;     // Сброс DC-блокера спикера
    spkDcOut = 0;
    
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
    var vol = typeof self.volume === 'number' ? self.volume : 1;
    var masterScale = (vol / 32.0);  // Нормализация в диапазон [-1.0, 1.0] с учетом громкости
    var Sz = e.outputBuffer.length;  // Output buffer size (4096)
    
    // ---- INITIAL PAUSE MODE ----
    if (self.initpause)
    {
      self.initpause--;
      for (var C = 0; C < Chan; C++) {
        O = e.outputBuffer.getChannelData(C);
        for (var k = 0; k < Sz; k++) O[k] = 0;
      }
      return;
    }

    // ---- ПРОВЕРКА И ОГРАНИЧЕНИЕ ЗАДЕРЖКИ (LOW-LATENCY) ----
    var available = B.length - Bpos;
    
    // Аварийный сброс залежавшегося хвоста (только при гигантской паузе или неактивности вкладки > 500 мс)
    if (available > MAX_BACKLOG) {
      Bpos = B.length - TARGET_CUSHION;
      available = TARGET_CUSHION;
    }

    // ---- ПРОВЕРКА НАЛИЧИЯ ПОДУШКИ БУФЕРА (защита от underrun) ----
    if (isBuffering) {
      if (available < TARGET_CUSHION) {
        // Накапливаем подушку предбуферизации — отдаем тишину
        for (var C = 0; C < Chan; C++) {
          O = e.outputBuffer.getChannelData(C);
          for (var k = 0; k < Sz; k++) O[k] = 0;
        }
        return;
      }
      isBuffering = false; // Подушка набрана, начинаем воспроизведение
    }

    // ---- ПЛАВНАЯ ПОДСТРОЙКА СКОРОСТИ ГЕНЕРАЦИИ (PLL) ДЛЯ УДЕРЖАНИЯ МИНИМАЛЬНОЙ ЗАДЕРЖКИ ----
    // Корректирует xCPS в пределах ±1.0%, удерживая размер очереди около TARGET_CUSHION
    // без микро-прореживания сэмплов, без щелчков и без искажения формы волны
    if (!isBuffering && baseXcps > 0) {
      var diff = available - TARGET_CUSHION;
      if (diff > 800) {
        // Очередь чуть выше целевой: процессор производит на 1% меньше сэмплов
        xCPS = Math.round(baseXcps * 1.01);
      } else if (diff < -800) {
        // Очередь чуть ниже целевой: процессор производит на 1% больше сэмплов
        xCPS = Math.round(baseXcps * 0.99);
      } else {
        xCPS = baseXcps;
      }
    }
    
    // ---- ВОСПРОИЗВЕДЕНИЕ СЭМПЛОВ ----
    for (var C = 0; C < Chan; C++) {
      O = e.outputBuffer.getChannelData(C);
      if (c12) O2 = e.outputBuffer.getChannelData(1);
      
      var j = 0;
      var L = B.length;
      p = Bpos;
      
      if (c12) {
        // Моно-режим: один сэмпл в оба канала (Left = Right)
        while (j < Sz && p < L) {
          var smp = B[p++] * masterScale;
          O2[j] = smp;
          O[j++] = smp;
        }
      }
      else {
        // 3-канальный режим (AY-3-8910)
        while (j < Sz && p < L) {
          O[j++] = B[p++][C] * masterScale;
        }
      }
      
      // ---- ОБРАБОТКА НЕШТАТНОГО ОПУСТОШЕНИЯ БУФЕРА ----
      if (j < Sz) {
        Bz = 1;
        var last = (p > 0 ? (c12 ? B[p - 1] : B[p - 1][C]) * masterScale : 0);
        // Плавное экспоненциальное затухание вместо зависания постоянного DC-уровня (щелчка)
        while (j < Sz) {
          last *= 0.92;
          if (Math.abs(last) < 0.0001) last = 0;
          if (c12) O2[j] = last;
          O[j++] = last;
        }
        // Входим в режим накопления подушки, только если буфер действительно исчерпан
        if (B.length - p < 512) {
          isBuffering = true;
        }
      } else {
        Bz = 0;
      }
    }  // End for each channel
    
    Bpos = p;  // Update playback position

    // Очистка уже воспроизведенных сэмплов во избежание разрастания массива B
    if (Bpos > 8192) {
      B.splice(0, Bpos);
      Bpos = 0;
    }
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
    
    // Всегда используем номинальную тактовую частоту CPU (4 МГц или 3 МГц)
    var spd = (S.mhz ? S.mhz : (S.cyc * S.fps));
    
    // Динамическая частота дискретизации аудио (из реального AudioContext)
    var sr = (context && context.sampleRate) ? context.sampleRate : 48000;
    
    // Точный расчет с фиксированной точкой (масштабирование на 4096)
    // xCPS = такты CPU на один аудиосэмпл * 4096
    baseXcps = Math.round((spd / sr) * 4096);
    xCPS = baseXcps;
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
      adjspd = 0;
    }

    self.cycles = cy;  // Update last cycle count
    
    // ---- CLEAR INACTIVE AUDIO SOURCES ----
    if (!self.covox) covoxVal = 0;     // Covox off
    if (!synth.On) synthVal = 0;       // Synthesizer off
    if (!self.On) bitVal = -16;        // Speaker off
    
    // В режиме спикера уровень val всегда строго соответствует bitVal
    // Никакого принудительного обнуления на границах кадров!
    if (!synth.On && !self.covox) {
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
        // Режим моно-микса: чистый выход AY + импульсы спикера (AC-coupled) + Covox
        var rawSpk = (bitVal === 16 ? 16 : -16);
        var spkOut = rawSpk - spkDcIn + 0.995 * spkDcOut;
        spkDcIn = rawSpk;
        spkDcOut = spkOut;
        if (Math.abs(spkOut) < 0.01) spkOut = 0;
        
        var cov = self.covox ? covoxVal : 0;
        g = synthVal + spkOut + cov;
        val = g;
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
      var rawSpk = (A / xCPS);  // Convert accumulated value to sample
      // DC-блокер (AC-coupling): устраняет постоянное смещение в паузах, сохраняет 100% меандра
      var spkOut = rawSpk - spkDcIn + 0.995 * spkDcOut;
      spkDcIn = rawSpk;
      spkDcOut = spkOut;
      if (Math.abs(spkOut) < 0.01) spkOut = 0;
      g = spkOut;
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
    // Во время предварительной загрузки (когда AudioContext еще suspended браузером),
    // сбрасываем накопление свыше TARGET_CUSHION, чтобы игра не стартовала с задержкой
    if (context && context.state === 'suspended' && B.length > TARGET_CUSHION) {
      B = [];
      Bpos = 0;
      isBuffering = true;
    }
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

  /**
   * Сохранить состояние звукового рендерера
   * Буфер сэмплов не сохраняется — пересчитается после восстановления
   * @returns {Object} Состояние звуковой подсистемы
   */
  this.getState = function() {
    return {
      On: self.On,
      covox: self.covox,
      cycles: self.cycles,
      initpause: self.initpause,
      bitVal: bitVal,
      covoxVal: covoxVal,
      val: val,
      ofs: ofs,
      xAcc: xAcc,
      Chan: Chan,
      spkDcIn: spkDcIn,
      spkDcOut: spkDcOut
    };
  };

  /**
   * Восстановить состояние звукового рендерера
   * @param {Object} state - Объект состояния из getState()
   */
  this.setState = function(state) {
    if (!state) return;
    self.On = !!state.On;
    self.covox = !!state.covox;
    self.cycles = (state.cycles !== undefined) ? state.cycles : 0;
    self.initpause = (state.initpause !== undefined) ? state.initpause : 0;
    bitVal = (state.bitVal !== undefined) ? state.bitVal : -16;
    covoxVal = (state.covoxVal !== undefined) ? state.covoxVal : 0;
    val = (state.val !== undefined) ? state.val : 0;
    ofs = (state.ofs !== undefined) ? state.ofs : 0;
    xAcc = (state.xAcc !== undefined) ? state.xAcc : 0;
    Chan = (state.Chan !== undefined) ? state.Chan : 1;
    spkDcIn = (state.spkDcIn !== undefined) ? state.spkDcIn : 0;
    spkDcOut = (state.spkDcOut !== undefined) ? state.spkDcOut : 0;
    clear2();
  };
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  adjustSpeed(true);  // Initialize timing on creation
  
  return self;    // Return public interface
}
