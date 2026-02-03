/**
 * BK-0010 Debugger (Step Debugger)
 * 
 * Interactive debugging interface for the BK-0010 emulator.
 * Features:
 * - Step-by-step execution (F7)
 * - Step over subroutines (F8)
 * - Run/Stop (F10/F11)
 * - Breakpoint support
 * - Disassembly view (showing instructions around PC)
 * - Register display (R0-R5, SP, PC, PSW)
 * - Stack view
 * - I/O port monitoring
 * - Memory dump
 * 
 * Note: This debugger was developed to test the emulator and supports
 * basic step-debugging functionality.
 */
DBG = function() {

  var self = this;

  // ============================================================================
  // DEBUGGER STATE
  // ============================================================================
  
  /**
   * Debugger active flag
   * When true, emulation is paused and debugger UI is visible
   */
  this.active = false;

  /**
   * Breakpoint address
   * Execution stops when PC reaches this address
   */
  this.bp = 0;
  
  /**
   * Step command flag
   * 1 = execute one instruction and stop
   */
  this.step = 0;

  /**
   * Redraw flag
   * When true, debugger UI needs to be updated
   */
  var fdraw = true;

  /**
   * Container DOM element for debugger UI
   */
  var O = null;

  /**
   * Reference to CPU being debugged
   */
  this.Processor = cpu;

  /**
   * Memory view starting address
   * Used for memory dump display
   */
  var mem_addr_s = 0;

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
  /**
   * Masks address to 16-bit range
   * @param {number} a - Address to mask
   * @returns {number} 16-bit address (0-65535)
   */
  function ADDRESS(a) {
    return (a & 0xFFFF) >>> 0;
  }

  /**
   * Formats number as 6-digit octal string
   * @param {number} n - Number to format
   * @returns {string} Zero-padded octal string
   */
  function OCT(n) {
    return ("000000" + n.toString(8)).substr(-6);
  }

  /**
   * Formats number as 4-digit hexadecimal string
   * @param {number} n - Number to format
   * @returns {string} Zero-padded hex string
   */
  function HEX(n) {
    return ("0000" + n.toString(16)).substr(-4);
  }

  /**
   * Gets instruction length in words
   * @param {number} addr - Address of instruction
   * @returns {number} Length in words (1-3)
   */
  function OpLen(addr) {
    var L = Disasm.opmem_length(base, addr);
    return (L == 0 ? 1 : L);  // Default to 1 for unknown opcodes
  }


  // ============================================================================
  // BREAKPOINT HANDLING
  // ============================================================================
  
  /**
   * Checks if execution should stop at current PC
   * Called from main emulation loop (see BK_MAIN.js)
   * @returns {boolean} True if should stop (debugger active or breakpoint hit)
   */
  this.breakpoints = function() {
    // Already in debug mode
    if (dbg.active) return true;
    
    // Check if PC matches breakpoint address
    var pc = cpu.regs[7];
    if (pc == dbg.bp) return true;
    
    // Optional: Add custom breakpoints here
    // Example:
    // if (parseInt("100000", 8) == pc) {
    //   dbg.show();
    //   return true;
    // }
    
    return false;  // Continue execution
  }

  // ============================================================================
  // DEBUGGER INITIALIZATION
  // ============================================================================
  
  /**
   * Initializes debugger UI in specified container
   * Creates HTML interface with control buttons and display panels
   * @param {string} div_id - ID of container DOM element
   */
  this.init = function(div_id) {
    O = GE(div_id);
    
    if (O != null) {
      // Build debugger UI HTML
      var s = '<table height="340"><tr><td width="260"><table><tr><td>' +
        '<input type="button" class="dbg0" id="dbg_run" value="Run F10,stop F11" title="Run continue" onclick="dbg.Run()"><br>' +
        '<input type="button" class="dbg0" id="dbg_step" value="Step F7" title="Step" onclick="dbg.Step()">' +
        '<input type="button" class="dbg0" id="dbg_over" value="StepOver F8" title="Over" onclick="dbg.StepOver()">' +
        '<br><div class="dbg0" style="display:inline;"> BP:</div>' +
        '<input type="text" id="dbg_AddrBP" class="dbg0" value="" size="7" onchange="dbg.setBreakPoint()">' +
        '</td></tr><tr><td><div id="dbg_asm" class="dbg0"></div></td></tr></table></td>' +
        '<td width="180"><div id="dbg_regs" class="dbg0"></div></td>' +
        '<td width="90"><div id="dbg_stack" class="dbg0"></div></td>' +
        '<td width="150"><div id="dbg_ports" class="dbg0"></div></td>' +
        '<td width="150"><input type="text" id="dbg_AddrMem" class="dbg0" value="100000" size="7" onchange="dbg.MemRdrw()"> ' +
        '<div id="dbg_mem" class="dbg0"></div></td></tr></table>';
      
      O.innerHTML = s;
    }
  }

  // ============================================================================
  // UI CONTROL FUNCTIONS
  // ============================================================================

  /**
   * Shows debugger window and pauses execution
   * Triggers UI redraw
   */
  this.show = function() {
    if (O != null) {
      O.style.visibility = 'visible';
      fdraw = true;
      self.active = true;
      self.redraw();
    }
  }

  /**
   * Hides debugger window and resumes execution
   */
  this.close = function() {
    if (O != null) {
      O.style.visibility = 'hidden';
      fdraw = true;
      self.active = false;
    }
  }

  /**
   * Resumes execution (Run button handler)
   * Closes debugger and continues emulation
   */
  this.Run = function() {
    self.close();
  }

  /**
   * Executes one instruction and stops (Step button / F7)
   * Sets breakpoint at current PC and sets step flag
   */
  this.Step = function() {
    var pc = cpu.regs[7];
    self.bp = pc;
    self.step = 1;
    self.active = false;
    fdraw = true;
  }

  /**
   * Steps over current instruction (Step Over button / F8)
   * Sets breakpoint after current instruction (skips subroutines)
   */
  this.StepOver = function() {
    var pc = cpu.regs[7];
    var L = OpLen(pc);  // Get instruction length
    self.bp = ADDRESS(pc + (L << 1));  // Breakpoint after instruction
    self.active = false;
    fdraw = true;
  }

  /**
   * Sets breakpoint from input field
   * Reads octal address from BP input and validates it
   */
  this.setBreakPoint = function() {
    var addr = parseInt(GE("dbg_AddrBP").value, 8);  // Parse octal
    addr = ADDRESS(addr & 0xFFFE);  // Align to word boundary
    GE("dbg_AddrBP").value = OCT(addr, 6);
    self.bp = addr;
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  /**
   * Redraws debugger UI
   * Updates all panels: disassembly, registers, stack, ports, memory
   * Called periodically (every ~400ms) when debugger is active
   */
  this.redraw = function() {
    if (self.active) {
      
      if (fdraw) {
        
        // ---- DISASSEMBLY PANEL ----
        // Shows instructions around current PC
        var Addr = cpu.regs[7];  // Current PC
        
        var ok = 0, at = 0, a, L, w, s, d = [], T, addr, g;
        
        // Try to find PC in instruction stream (up to 2 attempts)
        for (T = 0; (!ok) && (T < 2); T++) {
          
          addr = ADDRESS(Addr - 80 + T);  // Start address (slightly before PC)
          
          // Disassemble up to 100 instructions
          for (a = 0; a < 100 && (!ok || a < at + 12); a++) {
            
            L = OpLen(addr);  // Get instruction length
            
            var InstrTxt = Disasm.disasm(base, addr, false);  // Disassemble
            
            g = (addr == Addr);  // Is this the current PC?
            if (g) {
              ok = 1;
              at = a;  // Remember position
            }
            
            // Format instruction line
            s = '';
            if (g) s += '<font color="blue"><b>';  // Highlight current instruction
            s += OCT(addr) + ': ' + InstrTxt;
            if (g) s += '</b></font>';
            s += '</br>';
            d[a] = s;
            
            addr = ADDRESS(addr + (L << 1));  // Next instruction
          }
        }
        
        // Display instructions centered around PC
        s = '<div style="overflow-y: scroll; height:220px; width:300px">';
        if (at > 0) {
          for (a = at - 8; a < at + 9; a++) {  // Show 8 before, PC, 8 after
            s += d[a];
          }
        }
        GE("dbg_asm").innerHTML = s;

        // ---- REGISTERS PANEL ----
        // Shows all CPU registers and PSW flags
        s = 'Cpu <br>';
        for (a = 0; a < 8; a++) {
          w = cpu.regs[a];
          s += (a == 6 ? 'SP' : (a == 7 ? 'PC' : 'R' + a)) + ' ' + OCT(w) + ' ' + HEX(w) + '<br>';
        }
        s += '<font color="red">PSW ' + cpu.pswstr() + '</font>';
        GE("dbg_regs").innerHTML = s;
        
        // ---- STACK PANEL ----
        // Shows stack contents around current SP
        s = 'Stack:' + '<br>';
        
        Addr = cpu.regs[6];  // SP (Stack Pointer)
        addr = ADDRESS(Addr - 14);  // Show 7 words before SP
        
        for (a = 0; a < 14; a++) {
          w = (base.readWORD(addr) & 0xFFFF) >>> 0;
          g = (addr == Addr);  // Is this current SP?
          if (g) s += '<font color="green"><b>';  // Highlight current SP
          s += OCT(w);
          if (g) s += '</b></font>';
          s += '<br>';
          addr = ADDRESS(addr + 2);
        }
        GE("dbg_stack").innerHTML = s;
        
        // ---- I/O PORTS PANEL ----
        // Shows important hardware registers
        s = 'Ports:' + '<br>';
        s += s_port('177660:');  // Keyboard status
        s += s_port('177662:');  // Keyboard data
        s += s_port('177664:');  // Scroll register
        s += s_port('177700:');  // System register
        s += s_port('177702:');  // Memory bank select
        s += s_port('177704:');  // Tape/sound
        s += s_port('177706:');  // Timer start value
        s += s_port('177710:');  // Timer counter
        s += s_port('177712:');  // Timer config
        s += s_port('177714:');  // Parallel port
        s += s_port('177716:');  // Serial port
        GE("dbg_ports").innerHTML = s;
        
        // ---- MEMORY DUMP PANEL ----
        self.MemRdrw();
        
        // Update screen
        base.DRAW();
        fdraw = false;
      }
      
      // Schedule next redraw
      setTimeout('dbg.redraw()', 399);  // ~400ms interval
    }
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Formats I/O port value for display
   * @param {string} name - Port name in octal (e.g., "177700:")
   * @returns {string} Formatted HTML line with port address and value
   */
  function s_port(name) {
    var w = parseInt(name.substr(0, 6), 8);  // Parse octal address
    return (name + ' ' + OCT(base.readWORD(w)) + '<br>');
  }

  /**
   * Redraws memory dump panel
   * Shows memory contents starting from address in input field
   */
  this.MemRdrw = function() {
    var s, addr, w = 0, a, d = 0;
    
    s = '<div style="overflow-y: scroll; height:220px; width:140px">';
    addr = parseInt(GE("dbg_AddrMem").value, 8);  // Get start address (octal)
    
    // Display ~500 words of memory
    for (a = 0; a < 1000; a += d) {
      addr &= 65535;  // Wrap address
      d = 2;  // Read words (2 bytes)
      
      w = (base.readWORD(addr) & 0xFFFF) >>> 0;
      var q = OCT(w);
      
      // Format: address value
      s += OCT(addr) + ' ' + (d == 1 ? q.substr(3) : q) + ' <br>';
      addr = ADDRESS(addr + d);
    }
    
    s += '</div>';
    GE("dbg_mem").innerHTML = s;
  }

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================
  
  return this;  // Return public interface
}
