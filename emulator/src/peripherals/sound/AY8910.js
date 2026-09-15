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
  var /*int*/cy8 = 0;         // 8-cycle counter for tone generator updates (F_clock / 8)
  var /*int*/cy16 = 0;        // 16-cycle counter for noise and envelope updates (F_clock / 16)

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
  
  // Эталонная тактовая частота AY-3-8910 на БК (12 МГц / 7 ≈ 1.7734 МГц)
  var AY_CLOCK = 1773400;

  /**
   * Установка частоты дискретизации аудио (из AudioContext)
   * @param {number} sampleRate - Частота дискретизации (например, 48000 или 44100)
   */
  this.setSampleRate = function(sampleRate) {
    if (!sampleRate || sampleRate <= 0) sampleRate = 48000;
    xCps = Math.round((AY_CLOCK / sampleRate) * 64);
    c32 = xCps * 32;
  };

  function init()
  {
    self.setSampleRate(48000);
    
    // Initialize all 16 AY registers to 0
    for (var i = 0; i < 16; i++) {
      ayRegs[i] = 0;
    }

    dcIn = 0;
    dcOut = 0;
    dcInCh = [0, 0, 0];
    dcOutCh = [0, 0, 0];
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
    // Генераторы тона тактируются каждые 8 тактов чипа (F_clock / 8, эталон AY-3-8910)
    if ((++cy8) >= 8) {
      cy8 = 0;
      
      // ---- ОБНОВЛЕНИЕ ГЕНЕРАТОРОВ ТОНА (3 канала) ----
      for (var i = 0; i < 3; ++i)
      {
        var /*int*/a = toneCntrs[i] - 1;
        if (a <= 0) {
          a = tones[i];           // Перезагрузка периода
          toneToggles[i] ^= 1;    // Переключение меандра
        }
        toneCntrs[i] = a;
      }

      // Генераторы шума и огибающей тактируются каждые 16 тактов чипа (F_clock / 16)
      cy16 ^= 1;
      if (cy16 === 0) {
        // ---- ОБНОВЛЕНИЕ ГЕНЕРАТОРА ШУМА ----
        if ((--nCntr) <= 0) {
          nCntr = nPeriod;          // Перезагрузка счетчика шума
          updateNoise();            // Сдвиг LFSR
        }

        // ---- ОБНОВЛЕНИЕ ГЕНЕРАТОРА ОГИБАЮЩЕЙ ----
        if ((--eCntr) <= 0) {
          eCntr = ePeriod;          // Перезагрузка счетчика огибающей
          
          if (!st) {                // Если огибающая не остановлена
            e = (++e) & 0xF;        // Шаг огибающей (0-15)
            
            if (e == 0) {           // Завершение цикла огибающей
              var /*int*/shape = ayRegs[13];  // R13: форма огибающей

              // Бит 3 (0x08): продолжение (0=однократно, 1=циклично)
              if ((shape & 8) == 0) {
                st = true;          // Остановка
                ne = 0;
              } else {
                // Бит 1 (0x02): смена направления
                if (shape & 2) ne = (ne ^ 15) >>> 0;
                
                // Бит 0 (0x01): удержание после первого цикла
                if (shape & 1) {
                  st = true;        // Остановка и удержание
                  ne = (ne ^ 15) >>> 0;
                }
              }
            }
          }
        }
      }
      
      // ---- СБРОС И МИКШИРОВАНИЕ ВЫХОДОВ ----
      if (self.mixed) {
        mix = 0;                  // Сброс моно-аккумулятора
      } else {
        U[0] = 0;                 // Сброс раздельных каналов
        U[1] = 0;
        U[2] = 0;
      }

      // ---- MIX CHANNELS ----
      for (var c = 0; c < 3; ++c) {
        
        var isOn = 1;             // Флаг активности канала
        
        // Проверка разрешения тона (R7 биты 0-2): 0=вкл, 1=выкл
        if ((ayRegs[7] & (1 << c)) == 0) {
          isOn = toneToggles[c];  // Сигнал генератора тона
        }

        // Проверка разрешения шума (R7 биты 3-5): 0=вкл, 1=выкл
        if (((ayRegs[7] & (8 << c)) == 0) && 
            ((nSR & 1) == 0)) {
          isOn = 0;               // Заглушить, если бит шума 0
        }

        if (isOn) {
          // Амплитуда канала (R8-R10)
          var amp = ayRegs[(8 + c)];

          // Бит 4 (0x10): использовать огибающую вместо фиксированной громкости
          if ((amp & 0x10) != 0) {
            amp = e ^ ne;         // Огибающая с инверсией
          }
          
          // Логарифмическая громкость
          var v = vol[(amp & 15) >>> 0];
          
          // Добавление к выходу
          if (self.mixed) {
            mix += v;             // Моно-микс
          } else {
            U[c] += v;            // Раздельные каналы
          }
        }
      }
    }
  }
  
  // Фильтры подавления постоянной составляющей (DC-блокер / AC-coupling)
  var dcIn = 0;
  var dcOut = 0;
  var dcInCh = [0, 0, 0];
  var dcOutCh = [0, 0, 0];

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
   * Финализация значения аудиосэмпла (моно-микс)
   * Устраняет DC-смещение через фильтр высоких частот (AC-coupling)
   * Исключает переполнение и инверсию меандра при громкости >= 10
   * @param {number} v - Накопленное значение
   * @returns {number} Сбалансированный знаковый аудиосэмпл
   */
  function F(v) {
    var avgMix = v / xCps;
    var m = avgMix * (16 / 255);
    var out = m - dcIn + 0.995 * dcOut;
    dcIn = m;
    dcOut = out;
    if (Math.abs(out) < 0.005) out = 0;
    return out;
  }

  /**
   * Финализация для раздельных каналов A, B, C
   * @param {number} v - Накопленное значение канала
   * @param {number} ch - Индекс канала (0..2)
   * @returns {number}
   */
  function F_ch(v, ch) {
    var avgMix = v / xCps;
    var m = avgMix * (16 / 255);
    var out = m - dcInCh[ch] + 0.995 * dcOutCh[ch];
    dcInCh[ch] = m;
    dcOutCh[ch] = out;
    if (Math.abs(out) < 0.005) out = 0;
    return out;
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
      F_ch(a + (U[0] * Rem), 0),         // Channel A
      F_ch(b + (U[1] * Rem), 1),         // Channel B
      F_ch(c + (U[2] * Rem), 2)          // Channel C
    ];
  };

  // ============================================================================
  // PUBLIC API - REGISTER I/O
  // ============================================================================
  
  /**
   * Selects AY register for subsequent read/write
   * @param {number} reg - Register index (0-15)
   */
  /*void*/this.setRegIndex = function(/*int*/reg) {
    R = reg & 0x0F;
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

  /**
   * Сохранить состояние AY-8910
   * @returns {Object} Состояние регистров и генераторов
   */
  this.getState = function() {
    return {
      ayRegs: ayRegs.slice(),
      R: R,
      xSubPos: xSubPos,
      cy8: cy8,
      cy16: cy16,
      tones: tones.slice(),
      toneCntrs: toneCntrs.slice(),
      toneToggles: toneToggles.slice(),
      ePeriod: ePeriod,
      eCntr: eCntr,
      e: e,
      ne: ne,
      st: st,
      nSR: nSR,
      nPeriod: nPeriod,
      nCntr: nCntr,
      mix: mix,
      On: self.On,
      mixed: self.mixed,
      U: U.slice(),
      dcIn: dcIn,
      dcOut: dcOut,
      dcInCh: dcInCh.slice(),
      dcOutCh: dcOutCh.slice()
    };
  };

  /**
   * Восстановить состояние AY-8910
   * @param {Object} state - Объект состояния из getState()
   */
  this.setState = function(state) {
    if (!state) return;
    if (state.ayRegs && state.ayRegs.length === 16) {
      for (var i = 0; i < 16; i++) {
        ayRegs[i] = state.ayRegs[i] & 0xFF;
      }
    }
    R = (state.R !== undefined) ? state.R : -1;
    xSubPos = (state.xSubPos !== undefined) ? state.xSubPos : 0;
    cy8 = (state.cy8 !== undefined) ? state.cy8 : 0;
    cy16 = (state.cy16 !== undefined) ? state.cy16 : 0;
    if (state.tones) {
      for (i = 0; i < 3; i++) tones[i] = state.tones[i] || 0;
    }
    if (state.toneCntrs) {
      for (i = 0; i < 3; i++) toneCntrs[i] = state.toneCntrs[i] || 0;
    }
    if (state.toneToggles) {
      for (i = 0; i < 3; i++) toneToggles[i] = state.toneToggles[i] || 0;
    }
    ePeriod = (state.ePeriod !== undefined) ? state.ePeriod : 0;
    eCntr = (state.eCntr !== undefined) ? state.eCntr : 0;
    e = (state.e !== undefined) ? state.e : 0;
    ne = (state.ne !== undefined) ? state.ne : 0;
    st = !!state.st;
    nSR = (state.nSR !== undefined) ? state.nSR : 65535;
    nPeriod = (state.nPeriod !== undefined) ? state.nPeriod : 0;
    nCntr = (state.nCntr !== undefined) ? state.nCntr : 0;
    mix = (state.mix !== undefined) ? state.mix : 0;
    self.On = !!state.On;
    self.mixed = (state.mixed !== undefined) ? state.mixed : true;
    if (state.U) {
      for (i = 0; i < 3; i++) U[i] = state.U[i] || 0;
    }
    dcIn = (state.dcIn !== undefined) ? state.dcIn : 0;
    dcOut = (state.dcOut !== undefined) ? state.dcOut : 0;
    if (state.dcInCh) {
      for (i = 0; i < 3; i++) dcInCh[i] = state.dcInCh[i] || 0;
    }
    if (state.dcOutCh) {
      for (i = 0; i < 3; i++) dcOutCh[i] = state.dcOutCh[i] || 0;
    }
  };
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  init();              // Initialize chip on creation
  
  return self;         // Return public interface
}
