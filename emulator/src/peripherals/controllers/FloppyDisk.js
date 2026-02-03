/**
 * BK-0010/0011 Floppy Disk Emulator
 * 
 * Emulates a 5.25" floppy disk drive with the following characteristics:
 * - 80 tracks (cylinders)
 * - 2 heads (sides)
 * - 10 sectors per track
 * - 256 bytes per sector
 * - Total capacity: 800 KB (819,200 bytes)
 * 
 * Disk Format:
 * - Image track size: 10,240 bytes (2 heads × 10 sectors × 512 bytes)
 * - Raw track size: 6,250 words (includes gaps, markers, CRC)
 * - Each head: 3,125 words
 * 
 * Track Structure (per sector):
 * - Gap: 0x4E4E (21 words)
 * - Address marker: 0x1A1A1, 0x1A1FE (6+2 words)
 * - Cylinder/head/sector/size (3 words)
 * - CRC (1 word with bit 17 set)
 * - Gap: 0x4E4E (22 words)
 * - Data marker: 0x1A1A1, 0x1A1FB (6+2 words)
 * - Data: 256 bytes (256 words)
 * - CRC (1 word with bit 17 set)
 * 
 * Rotation Speed:
 * - 5 rotations per second (300 RPM)
 * - 3MHz BK-0010: 192 cycles/word
 * - 4MHz BK-0011M: 256 cycles/word
 * 
 * @param {string} diskName - Disk image filename
 * @param {Uint8Array} diskData - Disk image data (up to 819,200 bytes)
 * @param {string} diskId - Drive letter (A:, B:, C:, or D:)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
FloppyDisk = function(diskName, diskData, diskId)
{
  var self = this;
  
  // ============================================================================
  // CONSTANTS - DISK GEOMETRY
  // ============================================================================
  
  var T = 10240;  // Image track size in bytes (80 tracks total)
  var R = 6250;   // Raw track size in words (both heads)
  var W = R / 2;  // Raw track size per head (3125 words)
  
  /**
   * Disk rotation period in CPU cycles per word
   * - BK-0010 (3MHz): 192 cycles/word (5 rotations/sec)
   * - BK-0011M (4MHz): 256 cycles/word (5 rotations/sec)
   * 
   * Calculation: CPU_MHz / (5 rotations/sec × W words) ≈ 192-256
   */
  var /*long*/period = 256;

  // ============================================================================
  // TRACK BUFFERS
  // ============================================================================
  
  /**
   * Raw track data (includes gaps, markers, CRC)
   * Format: 16-bit words with marker bits (bits 16-17)
   * - Bit 16: Address/data marker
   * - Bit 17: CRC marker
   * Two arrays: [0] = head 0, [1] = head 1
   */
  var /*int[W]*/rawTrack = [[], []];
  
  /**
   * Image track data (pure sector data, no gaps/markers)
   * Format: 8-bit bytes, 10240 bytes per track
   * Contains data for both heads
   */
  var /*byte[T]*/imageTrack = [];

  // ============================================================================
  // DISK STATE
  // ============================================================================
  
  var /*int*/track = 0;                  // Current track (0-79)
  var /*int*/P = 0;                      // Current position in track (0-3124)
  var /*boolean*/trackDirty = false;     // Track has been modified
  var /*boolean*/wordChanged = false;    // Current word position has changed
  var /*boolean*/isWriting = false;      // Write operation in progress
  var /*boolean*/writingMarker = false;  // Writing marker (not data)
  var /*boolean*/gotWrite = false;       // Write data pending
  var /*int*/writeData = 0;              // Data to write
  var /*int*/lastHead = 0;               // Last head used for writing
  var /*boolean*/verbose = false;        // Debug logging flag

  /**
   * Read-only flag
   * When true, disk cannot be modified
   */
  self.readOnly = false;
  
  /**
   * CPU cycle counter
   * Used to synchronize disk rotation with CPU
   */
  self.cycles = 0;
  
  /**
   * Drive letter (A:, B:, C:, or D:)
   */
  self.diskId = diskId;
  
  /**
   * Disk image filename
   */
  self.imageName = diskName;
  
  /**
   * Disk image data (Uint8Array)
   * Maximum size: 819,200 bytes (80 tracks × 10,240 bytes)
   */
  self.imageFile = diskData;

  // ============================================================================
  // DEBUG CONTROL
  // ============================================================================
  
  /**
   * Enables/disables verbose debug logging
   * @param {boolean} to - True to enable logging
   */
  this.setVerbose = function(to) {
    verbose = to;
  }
  
  // ============================================================================
  // TRACK FORMATTING FUNCTIONS
  // ============================================================================
  
  /**
   * Writes address marker to raw track
   * Address markers identify the start of sector headers or data blocks
   * 
   * Format:
   * - 6 words of 0x0000 (sync gap)
   * - 1 word of 0x1A1A1 (marker sync)
   * - 1 word of 0x1A1xx (marker type)
   * 
   * @param {number} head - Head number (0 or 1)
   * @param {number} k - Starting position in raw track
   * @param {number} type - Marker type (0xFE=address, 0xFB=data)
   * @returns {number} New position after marker
   */
  function /*int*/writeAM(head, /*int*/k, /*int*/type)
  {
    // Write sync gap (6 zeros)
    for (var i = 0; i < 6; i++) {
      rawTrack[head][k++] = 0;
    }

    // Write marker sync pattern
    rawTrack[head][k++] = 0x1A1A1;
    
    // Write marker type (with bit 16 set)
    rawTrack[head][k++] = (0x1A100 | type);

    return k;
  }

  /**
   * Converts image track to raw track format
   * Generates complete track with gaps, markers, headers, data, and CRC
   * 
   * Track Layout (10 sectors per side):
   * - Gap (21 words of 0x4E4E)
   * - Address marker (8 words)
   * - Cylinder/head/sector/size (3 words)
   * - CRC (1 word: 0x2FFFF)
   * - Gap (22 words of 0x4E4E)
   * - Data marker (8 words)
   * - Data (256 words)
   * - CRC (1 word: 0x2FFFF)
   * = 304 words per sector × 10 sectors = 3040 words
   * + remaining gap fills to 3125 words per head
   */
  function /*void*/Image2raw() {
    var i, S, k, a, j;
    
    // ---- FILL TRACK WITH GAP PATTERN ----
    for (i = 0; i < W; i++) {
      rawTrack[0][i] = 0x4E4E;  // Head 0
      rawTrack[1][i] = 0x4E4E;  // Head 1
    }
    
    // ---- FORMAT 10 SECTORS ----
    for (var /*int*/sector = 0; sector < 10; ++sector)
    {
      S = sector * 304;  // Sector start position (304 words per sector)
      
      for (var /*int*/head = 0; head < 2; ++head)
      {
        // ---- WRITE ADDRESS MARKER (SECTOR HEADER) ----
        /*int*/k = 21 + S;  // Skip initial gap
        k = writeAM(head, k, 254);  // 0xFE = address marker
        
        // Write cylinder/head
        /*int*/a = head + (track << 8);
        rawTrack[head][k++] = a;
        
        // Write sector number (1-10) and size (2 = 512 bytes)
        a = ((sector + 1) << 8) | 2;
        rawTrack[head][k++] = a;
        
        // Write CRC (bit 17 set)
        rawTrack[head][k++] = 0x2FFFF;
        
        // ---- WRITE DATA MARKER AND DATA ----
        /*int*/j = (sector + (head * 10)) * 512;  // Offset in image track
        
        k = 43 + S;  // Skip gap between header and data
        k = writeAM(head, k, 251);  // 0xFB = data marker
        
        // Copy 256 bytes (512 bytes per sector)
        for (i = 0; i < 256; i++)
        {
          a = (imageTrack[j++] & 0xFF) << 8;  // High byte
          a |= imageTrack[j++] & 0xFF;        // Low byte
          rawTrack[head][k++] = a;
        }
        
        // Write CRC (bit 17 set)
        rawTrack[head][k++] = 0x2FFFF;
      }
    }
  }

  /**
   * Converts raw track to image track format
   * Extracts pure sector data from raw track (removes gaps, markers, CRC)
   * 
   * State Machine:
   * - State 0: Looking for address marker (0x1A1FE)
   * - State 1: Reading sector header (cylinder, head, sector, size)
   * - State 2: Looking for data marker (0x1A1FB or 0x1A1F8)
   * - State 3: Reading sector data (256 words)
   * 
   * Validates:
   * - Cylinder matches current track
   * - Head matches (0 or 1)
   * - Sector number is valid (1-10)
   * - Sector size is 2 (512 bytes)
   * - CRC is present after data
   */
  function /*void*/Raw2image() {
    var /*int*/sector = 0;
    var /*int*/word = 0;
    var /*int*/state = 0;
    var /*boolean*/r = false;  // Error already reported

    if (verbose) console.log("FDD: Analysing raw track " + track);
    
    // ---- PROCESS BOTH HEADS ----
    for (var /*int*/head = 0; head < 2; ++head) {
      if (verbose) console.log("Head " + head);
      state = 0;
      
      // ---- SCAN RAW TRACK ----
      for (var /*int*/k = 0; k < W; ++k) {
        var /*int*/data = rawTrack[head][k];

        switch (state)
        {
        // ---- STATE 0: LOOK FOR ADDRESS MARKER ----
        case 0:
          // Check for address marker: 0xA1FE with bit 16 set
          if ((data & 0x10000) && ((data & 0xFFFF) == 41470)) {
            state = 1;
            word = 0;
            if (verbose) console.log("Found sector address marker");
          }
          break;
          
        // ---- STATE 1: READ SECTOR HEADER ----
        case 1:
          ++word;
          switch (word)
          {
          case 1:  // Word 1: Cylinder and head
            if ((data & 0xFFFF) != ((track << 8) | head)) {
              if (verbose) {
                console.log("Invalid cylinder/head");
              } else if (!r) {
                r = true;
                console.log("Broken write at track " + track);
              }
              state = 0;
            }
            break;
            
          case 2:  // Word 2: Sector number and size
            if ((data & 0xFF) != 2) {  // Size must be 2 (512 bytes)
              if (verbose) {
                console.log("Invalid sector size");
              } else if (!r) {
                r = true;
                console.log("Broken write at track " + track);
              }
              state = 0;
            }
            else {
              sector = (data & 0xFFFF) >>> 8;
              if ((sector < 1) || (sector > 10)) {
                if (verbose) {
                  console.log("Invalid sector number");
                } else if (!r) {
                  r = true;
                  console.log("Broken write at track " + track);
                }
                state = 0;
              }
            }
            break;
            
          case 3:  // Word 3: CRC
            if ((data & 0x20000) != 0) {  // Bit 17 = CRC marker
              if (verbose) console.log("Found sector " + sector);
              state = 2;  // Move to data marker search
            }
            break;
            
          default:
            state = 0;
          }
          break;
        // ---- STATE 2: LOOK FOR DATA MARKER ----
        case 2:
          if (data & 0x10000) {  // Marker bit set
            data &= 0xFFFF;
            
            // Check for address marker (another sector header)
            if (data == 41470)  // 0xA1FE
            {
              state = 1;
              word = 0;
              if (verbose) console.log("Found sector address marker");
            }
            // Check for data markers
            else {
              if ((data == 41467) || (data == 41464)) {  // 0xA1FB or 0xA1F8
                state = 3;
                word = 0;
                if (verbose) console.log("Found sector data marker");
              }
            }
          }
          break;
          
        // ---- STATE 3: READ SECTOR DATA ----
        case 3:
          if ((word++) >= 256)  // All 256 words read
          {
            // Check for CRC after data
            if (!(data & 0x20000)) {  // Bit 17 = CRC marker
              state = 0;
              if (verbose) console.log("No CRC");
            }
            else
            {
              // ---- COPY DATA TO IMAGE TRACK ----
              var /*int*/w = 512 * (sector - 1 + (head * 10));  // Offset in image
              var /*int*/m = k - 256;  // Back up to start of data
              
              for (var /*int*/i = 0; i < 256; ++i) {
                var /*int*/a = rawTrack[head][m++] & 0xFFFF;
                imageTrack[w++] = /*(byte)*/(a >>> 8) & 0xFF;  // High byte
                imageTrack[w++] = /*(byte)*/a & 0xFF;           // Low byte
              }
              
              state = 0;
              if (verbose) console.log("Sector converted");
            }
          }
          break;
          
        default:
          state = 0;
        }
      }
    }
  }

  // ============================================================================
  // TRACK SAVE/LOAD FUNCTIONS
  // ============================================================================
  
  /**
   * Saves current track to disk image
   * Converts raw track back to image format and writes to image file
   * Only saves if track is dirty (modified) and not read-only
   */
  function /*void*/saveTrack()
  {
    if (!self.readOnly && trackDirty) {
      // Convert raw track to image format
      Raw2image();
      
      var /*long*/k = track * T;      // Track offset in image
      var a = self.imageFile;
      var j = a.length;
      var i = 0;
      
      // Extend image file if necessary
      while (j < k) {
        a[j++] = 0;
      }
      
      // Copy track data to image file
      while (i < T) {
        a[k++] = imageTrack[i++];
      }
    }
    
    trackDirty = false;
  }

  /**
   * Loads track from disk image
   * Reads track data and converts to raw format
   */
  function /*void*/loadTrack()
  {
    var /*long*/k = track * T;      // Track offset in image
    var a = self.imageFile;
    var l = Math.min(k + T, a.length) - k;  // Bytes available
    var i = 0;
    
    // Copy track data from image file
    while (i < l) {
      imageTrack[i++] = a[k++];
    }
    
    // Fill remainder with zeros
    while (i < T) {
      imageTrack[i++] = 0;
    }

    // Convert to raw track format
    Image2raw();
    trackDirty = false;
    
    if (verbose) console.log("FDD: selected track " + track);
  }

  /**
   * Unmounts disk image
   * Saves current track if dirty, resets cycle counter
   */
  this.unmountImage = function()
  {
    saveTrack();    // Save any pending changes
    self.cycles = 0;
  }

  /**
   * Mounts disk image
   * Initializes cycle counter and loads current track
   */
  this.mountImage = function() {
    self.unmountImage();  // Unmount first (save old track)

    self.cycles = cpu.Cycles;  // Sync with CPU
    
    loadTrack();  // Load track 0
    console.log("FDD: image mounted");
  }

  // ============================================================================
  // TRACK STEPPING FUNCTIONS
  // ============================================================================
  
  /**
   * Steps head to next track (outward movement)
   * Saves current track before moving
   * Maximum track: 82 (allows stepping beyond 79 for calibration)
   */
  /*void*/this.stepPlus = function()
  {
    if (track < 82) {
      saveTrack();
      track++;
      loadTrack();
    }
  }

  /**
   * Steps head to previous track (inward movement)
   * Saves current track before moving
   * Minimum track: 0
   */
  /*void*/this.stepMinus = function()
  {
    if (track > 0) {
      saveTrack();
      track--;
      loadTrack();
    }
  }

  // ============================================================================
  // DATA READ/WRITE FUNCTIONS
  // ============================================================================
  
  /**
   * Returns drive status word
   * Status bits:
   * - Bit 0:  Track 0 (head is at track 0)
   * - Bit 2:  Write protect (disk is read-only)
   * - Bit 7:  Data ready / Word changed
   * - Bit 14: CRC marker / Special marker
   * - Bit 15: Index marker (near end of track)
   * 
   * @param {number} head - Head number (0 or 1)
   * @returns {number} Status word
   */
  /*int*/this.getStatus = function(/*int*/head)
  {
    var a = 0;

    // Bit 2: Write protect
    if (self.readOnly) a |= 4;

    // Bit 0: Track 0
    a |= ((track == 0) ? 1 : 0);

    // Bit 15: Index marker (near end of track ~3110/3125)
    if (P >= 3110/*~W*/) a |= 32768;

    // Bits 7 and 14: Data ready and marker flags
    if (isWriting)
    {
      if (!gotWrite) a |= 128;              // Bit 7: Ready for data
      if (wordChanged && !gotWrite) a |= 16384;  // Bit 14: Word changed
    }
    else
    {
      if (wordChanged) a |= 128;            // Bit 7: New word available
      if ((rawTrack[head][P] & 0x20000) != 0) a |= 16384;  // Bit 14: CRC marker
    }
    
    if (verbose) console.log("FDD: reading status word " + a +
      " at track position " + P);
    
    return a;
  }
  
  /**
   * Returns current data word from track
   * Clears word changed flag
   * @param {number} head - Head number (0 or 1)
   * @returns {number} Data word
   */
  /*int*/this.getData = function(/*int*/head) {
    wordChanged = false;

    if (verbose) console.log("FDD: reading data word at track position " + P);

    return rawTrack[head][P];
  }
  
  /**
   * Checks if current position has an address/data marker
   * @param {number} head - Head number (0 or 1)
   * @returns {boolean} True if marker present (bit 16 set)
   */
  /*boolean*/this.isMarkerPos = function(/*int*/head) {
    if (verbose) console.log("FDD: Scanning for marker at track position " + P);

    return ((rawTrack[head][P] & 0x10000) != 0);
  }

  /**
   * Sets marker writing mode
   * When true, bit 16 is set on written words (address/data markers)
   * @param {boolean} isMarker - True to write markers, false for data
   */
  /*void*/this.setMarker = function(/*boolean*/isMarker) {
    writingMarker = isMarker;
    if (verbose)
      console.log("FDD: writing marker mode set to (" + isMarker + ")");
  }

  /**
   * Queues data for deferred write
   * Write happens on next disk rotation update
   * @param {number} head - Head number (0 or 1)
   * @param {number} data - Word to write (bytes swapped for BK format)
   */
  /*void*/this.deferredWrite = function(/*int*/head, /*int*/data)
  {
    data = (data & 0xFFFF) >>> 0;
    isWriting = true;
    gotWrite = true;
    writeData = ((data & 0xFF) << 8) | ((data >>> 8) & 0xFF);  // Swap bytes
    wordChanged = false;
    lastHead = head;
    trackDirty = true;
    
    if (verbose) console.log("FDD: writing data word " + data);
  }

  // ============================================================================
  // WRITE STATE MACHINE
  // ============================================================================
  
  /**
   * Updates write operation state
   * Called each time disk position advances during write
   * 
   * Write Sequence:
   * 1. Write data word (from deferredWrite)
   * 2. Write CRC word (0x2FFFF)
   * 3. End write operation
   */
  function /*void*/updateWriteState()
  {
    // ---- STEP 1: WRITE DATA WORD ----
    if (gotWrite)
    {
      if (!self.readOnly) {
        if (verbose) console.log("FDD: physically writing data word " +
          writeData + " at track position " + P);
        
        // Write data with optional marker bit
        rawTrack[lastHead][P] = (writeData | (writingMarker ? 0x10000 : 0));
      }
      gotWrite = false;
      wordChanged = false;
      return;
    }

    // ---- STEP 2: WRITE CRC WORD ----
    if (!wordChanged) {
      if (!self.readOnly) {
        if (verbose)
          console.log("FDD: physically writing CRC at track position " + P);
        
        // Write CRC with marker bits (bit 17 = CRC, optional bit 16 = marker)
        rawTrack[lastHead][P] = (0x2FFFF/*getCRC()*/ | (writingMarker ? 0x10000 : 0));
      }
      wordChanged = true;
    }
    // ---- STEP 3: END WRITE ----
    else {
      isWriting = false;
    }
  }

  // ============================================================================
  // DISK ROTATION SIMULATION
  // ============================================================================
  
  /**
   * Updates disk rotation based on elapsed CPU cycles
   * Advances track position and handles read/write operations
   * 
   * Rotation: 5 revolutions per second
   * Position wraps at W (3125 words per head)
   */
  this.updateTimer = function() {
    var d = (cpu.Cycles - self.cycles);  // Elapsed cycles

    // Not enough cycles for one word yet
    if (d < period) {
      return;
    }
    
    var /*long*/c = (d / period) | 0;  // Number of words to advance

    self.cycles += c * period;  // Consume cycles
    
    // ---- ADVANCE ONE POSITION ----
    if ((++P) >= W) P = 0;  // Wrap at end of track
    
    if (isWriting) {
      updateWriteState();
    } else {
      wordChanged = true;
    }

    // ---- ADVANCE REMAINING POSITIONS ----
    if ((--c) > 0)
    {
      // Advance one more position
      if ((++P) >= W) P = 0;
      if (isWriting) updateWriteState();
      
      // Skip ahead (disk rotates at constant speed)
      P += (c - 1);
      P %= W;
    }
  }

  /**
   * Flushes pending writes
   * Saves track if dirty (modified)
   */
  /*void*/this.flush = function() {
    if (!self.readOnly && trackDirty) {
      saveTrack();
    }
  }
  
  // ============================================================================
  // IMAGE SIZE NORMALIZATION
  // ============================================================================
  
  /**
   * Normalizes disk image to standard size (819,200 bytes)
   * 
   * Handles:
   * - Images larger than 819,200 bytes (truncates if possible)
   * - Images smaller than 819,200 bytes (pads with zeros)
   * - Already correctly sized images (returns copy)
   * 
   * Truncation rules:
   * - Only truncates if extra bytes are padding (0, 255, or last byte repeated)
   * - If extra data is significant, preserves full image
   * 
   * @returns {Uint8Array} Normalized disk image
   */
  this.reSized819200 = function() {
    saveTrack();  // Save current track first
    
    var A;
    var L = 819200;                 // Standard disk size (80 tracks × 10240 bytes)
    var a = self.imageFile;
    var l = a.length;
    var i, c, q;
    var trunc = true;
    
    // ---- IMAGE LARGER THAN STANDARD SIZE ----
    if (l > L) {
      c = a[L - 1];  // Last byte of standard size
      
      // Check if extra bytes are just padding
      for (i = L; i < l && trunc; i++) {
        q = a[i];
        if (q != 0 && q != 255 && q != c) {
          trunc = false;  // Found significant data, don't truncate
        }
      }
      
      // Can truncate (only padding found)
      if (trunc) {
        A = new Uint8Array(L);
        for (i = 0; i < L; i++) {
          A[i] = a[i];
        }
        return A;
      }
      
      // Cannot truncate (has significant data), preserve full image
      A = new Uint8Array(l);
      for (i = 0; i < l; i++) {
        A[i] = a[i];
      }
      return A;
    }

    // ---- IMAGE SMALLER THAN OR EQUAL TO STANDARD SIZE ----
    A = new Uint8Array(L);
    
    // Copy existing data
    for (i = 0; i < l; i++) {
      A[i] = a[i];
    }
    
    // Pad with zeros
    while (i < L) {
      A[i++] = 0;
    }
    
    return A;
  }

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return self;  // Return public interface
}
