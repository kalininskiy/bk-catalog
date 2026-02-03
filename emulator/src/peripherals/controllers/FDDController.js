/**
 * BK-0010/0011 Floppy Disk Controller
 * 
 * Emulates the floppy disk controller (FDC) hardware interface.
 * Manages up to 4 floppy drives (typically 2: A: and B:).
 * 
 * Memory Map (octal addresses):
 * - 177130 (65112): Control/Status register
 * - 177132 (65114): Data register
 * 
 * Control Register Bits:
 * - Bits 0-3:  Drive select (1=A, 2=B, 4=C, 8=D)
 * - Bits 2-3:  System configuration
 * - Bit 5:     Head select (0/1)
 * - Bit 6:     Step direction (0=minus, 1=plus)
 * - Bit 7:     Step pulse
 * - Bit 8:     Seek marker
 * - Bit 9:     Write marker
 * 
 * Status Register Bits:
 * - Bit 0:     Track 0 flag
 * - Bit 2:     Write protect
 * - Bit 7:     Data ready / Word changed
 * - Bit 14:    CRC marker / Special marker
 * - Bit 15:    Index marker
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
FDDController = function()
{
  var self = this;
  
  // ============================================================================
  // CONSTANTS
  // ============================================================================
  
  /**
   * Maximum number of floppy drives supported
   * Typically 2 (A: and B:), but controller supports up to 4
   */
  var DRIVES_MAX = 2;
  
  // ============================================================================
  // CONTROLLER STATE
  // ============================================================================
  
  /**
   * Array of FloppyDisk objects
   * Index 0 = A:, 1 = B:, 2 = C:, 3 = D:
   */
  var D = [];
  
  /**
   * Currently selected floppy drive
   * null if no drive selected or drive not present
   */
  var /*FloppyDisk*/ drive = null;
  
  /**
   * Control register value (177130)
   * Contains drive select, head select, and control bits
   */
  var /*short*/controlReg = 0;
  
  /**
   * Marker seeking mode flag
   * When true, controller is looking for index marker
   */
  var /*boolean*/seekingMarker = true;
  
  /**
   * Disk enabled flag
   * True when a valid drive is selected
   */
  var /*boolean*/diskEnabled = false;
  
  /**
   * Readable mode flag
   * Controls whether FDC registers can be read
   * Used for BK-0010/0011M mode switching
   */
  var /*boolean*/isReadable = true;
  
  /**
   * Public access to drives array
   */
  self.drives = D;

  // ============================================================================
  // QBUS DEVICE INTERFACE
  // ============================================================================
  
  /**
   * Returns base address of FDC in memory map
   * @returns {number} 65112 (177130 octal) - FDC control register
   */
  /*int*/this.getBaseAddress = function()
  {
    return 65112;  // 177130 octal
  }

  /**
   * Returns number of 16-bit words occupied by FDC
   * @returns {number} 2 words (control/status and data registers)
   */
  /*int*/this.getNumWords = function()
  {
    return 2;
  }

  /**
   * Checks if FDC has pending interrupt
   * Note: Interrupts are not currently implemented
   * @returns {boolean} Always false
   */
  /*boolean*/this.gotInterrupt = function()
  {
    return false;
  }

  /**
   * Returns interrupt vector for FDC
   * Note: Interrupts are not currently implemented
   * @returns {number} Always 0
   */
  /*byte*/this.interruptVector = function()
  {
    return 0;
  }

  // ============================================================================
  // MEMORY ACCESS FUNCTIONS
  // ============================================================================
  
  /**
   * Reads 16-bit word from FDC register
   * @param {number} addr - Memory address to read from
   * @param {QBusReadDTO} result - Object to store the read value
   * @returns {boolean} True if address is valid FDC register
   */
  /*boolean*/this.readWord = function(/*int*/addr, /*QBusReadDTO*/ result)
  {
    this.updateTimer();  // Update disk rotation state

    // Check if FDC is in readable mode
    if (!isReadable) {
      return false;
    }
    
    result.value = 0;
    var C = (addr & 0xFFFE) >>> 0;  // Align to word boundary
    var head = ((controlReg >>> /*HEAD*/5) & 1);  // Extract head select bit
    
    // ---- STATUS/CONTROL REGISTER (177130) ----
    if (C == 65112) {
      if (diskEnabled) {
        var /*int*/a = drive.getStatus(head);
        
        // Handle marker seeking
        if (seekingMarker) {
          if (!drive.isMarkerPos(head)) {
            a &= 0xFF7F;  // Clear data ready bit
          }
          else {
            seekingMarker = false;  // Marker found
          }
        }
        
        result.value = /*(short)*/a & 0xFFFF >>> 0;
      }
      return true;
    }
    
    // ---- DATA REGISTER (177132) ----
    if (C == 65114) {
      if (diskEnabled) {
        result.value = /*(short)*/drive.getData(head) & 0xFFFF >>> 0;
      }
      return true;
    }
    
    return false;  // Address not handled by FDC
  }

  /**
   * Resets FDC to initial state
   * Called on system reset
   */
  /*void*/this.reset = function()
  {
    controlReg = 0;
    seekingMarker = true;
    diskEnabled = false;
  }

  /**
   * Shuts down FDC and unmounts all disks
   * Flushes any pending writes before shutdown
   */
  /*void*/this.shutdown = function()
  {
    for (var j in D) {
      D[j].unmountImage();  // Unmount and save each disk
    }
    D = [];
    self.drives = D;
  }
  
  /**
   * Writes byte as word to FDC register
   * Handles byte writes by merging with current register value
   * @param {number} addr - Memory address to write to
   * @param {number} data - Byte value to write
   * @returns {boolean} True if write successful
   */
  /*boolean*/this.writeByteAsWord = function(/*int*/addr, /*short*/data)
  {
    var A = (addr & 0xFFFF) >>> 0;
    
    // Low byte of control register
    if (A == 65112) {
      return this.writeWord(65112, /*(short)*/(controlReg & 0xFF00 | data & 0xFF));
    }
    
    // High byte of control register
    if (A == 65113) {
      return this.writeWord(65112, /*(short)*/(controlReg & 0xFF | data & 0xFF00));
    }
    
    return this.writeWord(A, data);
  }

  /**
   * Writes 16-bit word to FDC register
   * @param {number} addr - Memory address to write to
   * @param {number} data - Word value to write
   * @returns {boolean} True if write successful
   */
  /*boolean*/this.writeWord = function(/*int*/addr, /*short*/data)
  {
    this.updateTimer();  // Update disk rotation state

    var C = (addr & 0xFFFE) >>> 0;
    
    // ---- CONTROL REGISTER (177130) ----
    if (C == 65112)
    {
      var /*int*/a = (controlReg ^ data) >>> 0;  // Changed bits

      // ---- DRIVE SELECT (bits 0-3) or HEAD SELECT (bit 5) changed ----
      if (a & 0x1F)
      {
        // Flush pending writes from previous drive
        if (diskEnabled) {
          drive.flush();
        }
        
        // ---- SELECT DRIVE BASED ON BITS 0-3 ----
        // Bit pattern determines which drive: 1=A, 2=B, 4=C, 8=D
        switch (data & 0xF)
        {
        case 0:  // No drive selected
          /* no new drive */
          break;
        case 1:  // Drive A:
        default:
          drive = D[0];
          break;
        case 2:  // Drive B:
        case 6:
        case 10:
        case 14:
          drive = D[1];
          break;
        case 4:  // Drive C:
        case 12:
          drive = D[2];
          break;
        case 8:  // Drive D:
          drive = D[3];
          break;
        }
        
        diskEnabled = (drive != null);
      }

      // ---- SYSTEM CONFIGURATION (bits 2-3) changed ----
      // Controls BK-0010 vs BK-0011M mode and BASIC mode
      if (a & 0xC) {
        base.remap = true;  // Prevent memory reload during mode switch
        
        switch (data & 0xC)
        {
        case 12:  // BASIC mode (BK-0010)
          base.setBASIC10Model();
          console.log("FDC: setBASIC10Model");
          isReadable = false;  // FDC not readable in BASIC mode
          break;
          
        case 8:  // Base BK-0010 mode
          base.setBase10Model();
          console.log("FDC: setBase10Model");
          isReadable = true;
          break;
          
        case 9:   // FDD mode (with floppy disk)
        case 10:
        case 11:
        default:
          // Choose BK-0010 or BK-0011M FDD mode
          if (base.isM()) {
            base.setFDD11Model();  // BK-0011M with FDD
            console.log("FDC: setFDD11Model");
          }
          else {
            base.setFDD10Model();  // BK-0010 with FDD
            console.log("FDC: setFDD10Model");
          }
          
          isReadable = true;
        }
        
        base.remap = false;  // Re-enable memory operations
      }

      // ---- HANDLE DISK OPERATIONS ----
      if (diskEnabled)
      {
        // ---- STEP MOTOR (bit 7: step pulse, bit 6: direction) ----
        if (((a & 0x80) != 0) && ((data & 0x80) != 0))
        {
          if (data & 0x40) {
            drive.stepPlus();   // Step to next track (outward)
          }
          else {
            drive.stepMinus();  // Step to previous track (inward)
          }
        }

        // ---- WRITE MARKER MODE (bit 9) ----
        if ((a & 0x200/*WRMARKER*/) != 0) {
          drive.setMarker((data & 0x200/*WRMARKER*/) != 0);
        }
      }
      
      // ---- SEEK MARKER (bit 8) ----
      if (data & 0x100) {
        seekingMarker = true;
      }
      
      controlReg = data;  // Update control register
    }
    // ---- DATA REGISTER (177132) ----
    else if (C == 65114) {
      seekingMarker = false;
      if (diskEnabled) {
        var head = (controlReg >>> /*HEAD*/5) & 1;
        drive.deferredWrite(head, data);  // Queue write operation
      }
    }
    else {
      return false;  // Address not handled by FDC
    }
    
    return true;
  }
  
  // ============================================================================
  // DISK MANAGEMENT FUNCTIONS
  // ============================================================================
  
  /**
   * Updates timer for all mounted disks
   * Advances disk rotation simulation
   */
  this.updateTimer = function() {
    for (var j in D) {
      D[j].updateTimer();
    }
  }
  
  /**
   * Adjusts cycle counters for all disks
   * Called when CPU cycle counter wraps or resets
   * @param {number} n - Number of cycles to subtract
   */
  this.mCyc = function(n) {
    for (var j in D) {
      D[j].cycles -= n;
    }
  }
  
  /**
   * Mounts all disk images
   * Loads tracks into memory
   */
  this.mountDisks = function() {
    for (var j in D) {
      D[j].mountImage();
    }
  }
  
  /**
   * Adds a disk to the controller
   * Disk letters: A:, B:, C:, D:
   * @param {string} name - Disk image filename
   * @param {Uint8Array} data - Disk image data
   * @returns {boolean} True if disk added successfully
   */
  this.addDisk = function(name, data) {
    var c = D.length;
    var ok = (c < DRIVES_MAX);
    
    if (ok) {
      // Create disk with letter (A:, B:, etc.)
      D[c] = new FloppyDisk(name, data, String.fromCharCode(65 + c) + ':');
      D[c].mountImage();
    }
    
    return ok;
  }
  
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return self;  // Return public interface
}
