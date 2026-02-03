/**
 * Touch/Mobile Keyboard Interface
 * 
 * Provides on-screen keyboard buttons for touch devices and mobile browsers.
 * 
 * Features:
 * - Touch event handling (touchstart, touchmove, touchend)
 * - Mouse event fallback for desktop browsers
 * - Auto-repeat key lifting (releases keys after timeout)
 * - Visual button feedback
 * 
 * Button Layout:
 * - Esc (top left)
 * - Enter (top middle)
 * - Arrow keys (Left, Up, Down, Right) in center
 * - Delete (bottom right)
 * - Space (bottom center, wide)
 * 
 * Note: This module is primarily for mobile devices and tablets.
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */

// ============================================================================
// DEVICE DETECTION
// ============================================================================

/**
 * Touch support detection
 * True if browser supports touch events
 */
TOUCH_ = ('ontouchstart' in document.documentElement);

/**
 * Mobile device detection
 * True if user agent indicates mobile device
 */
MOBILE_ = (navigator.userAgent.match(/Android|BlackBerry|iPhone|iPad|iPod|Opera Mini|IEMobile/i));

// ============================================================================
// DUMMY EVENT OBJECT
// ============================================================================

/**
 * Dummy keyboard event for simulating key presses
 * Used when touch/click generates keyboard input
 */
var EVENT = {
  type: "",
  keyCode: 0,
  which: 0,
  location: 0,
  preventDefault: function() {},
  stopPropagation: function() {}
};

// ============================================================================
// BUTTON CONFIGURATION
// ============================================================================

/**
 * Array of button key codes
 * Stores BK character codes for all touch buttons
 */
KBUT_ = [];

/**
 * Defines on-screen keyboard button layout
 * Creates HTML for touch/mouse buttons
 * 
 * Button positions are absolute (pixels):
 * - Esc: (690, 10), 90×90
 * - Enter: (790, 10), 180×90
 * - Left: (680, 130), 100×220
 * - Up: (786, 116), 100×110
 * - Down: (786, 240), 100×110
 * - Right: (892, 130), 100×220
 * - Delete: (932, 386), 60×60
 * - Space: (680, 386), 240×90
 */
function AddKeyButtons()
{
  addKey("Esc",    0, 1000, 690, 10,  90,  90);   // Escape
  addKey("Enter",  0, 10,   790, 10,  180, 90);   // Enter
  
  addKey("Left",   0, 8,    680, 130, 100, 220);  // Arrow Left
  addKey("Up",     0, 26,   786, 116, 100, 110);  // Arrow Up
  addKey("Down",   0, 27,   786, 240, 100, 110);  // Arrow Down
  addKey("Right",  0, 25,   892, 130, 100, 220);  // Arrow Right
  
  addKey("Delete", 0, 46,   932, 386, 60,  60);   // Delete
  addKey("Space",  0, 32,   680, 386, 240, 90);   // Space (wide)
}

// ============================================================================
// KEY AUTO-RELEASE SYSTEM
// ============================================================================

/**
 * Key lifter array
 * Tracks keys that need auto-release after timeout
 * Each entry: { i: counter, c: key code }
 */
KBF_ = [];

/**
 * Automatic key release timer
 * Releases keys after ~120ms (6 iterations × 20ms)
 * Prevents keys from getting stuck
 */
function keyLifter()
{
  var i, o;
  
  // Check each pressed key
  for (i in KBF_)
  {
    o = KBF_[i];
    o.i++;  // Increment counter
    
    // Release key after 6 iterations (~120ms)
    if (o.i >= 6)
    {
      popKey(o.c);
      KBF_.splice(i, 1);
    }
  }
  
  // Schedule next check
  setTimeout('keyLifter()', 20);
}

/**
 * Pushes key for touch/mouse input
 * Adds key to auto-release list or resets counter if already pressed
 * @param {number} c - BK character code
 */
function touchpushKey(c)
{
  var i, o, y = 1;  // y=1: new key, y=0: already pressed
  
  // Check if key is already pressed
  for (i in KBF_)
  {
    o = KBF_[i];
    if (o.c == c) {
      y = 0;
      break;
    }
  }
  
  if (y)
  {
    // New key press
    pushKey(c, 1);  // Push with hold flag (do not auto-release)
    KBF_.push({ i: 0, c: c });
  }
  else
  {
    // Key already pressed, reset counter
    o.i = 0;
  }
}

/**
 * Releases key immediately
 * Removes key from auto-release list
 * @param {number} c - BK character code
 */
function touchpopKey(c)
{
  var i, o;
  
  // Find and release key
  for (i in KBF_)
  {
    o = KBF_[i];
    if (o.c == c)
    {
      popKey(o.c);
      KBF_.splice(i, 1);
    }
  }
}

// ============================================================================
// BUTTON CREATION
// ============================================================================

/**
 * Creates on-screen keyboard button
 * Writes HTML for button image with absolute positioning
 * 
 * @param {string} n - Button name (e.g., "Esc", "Enter")
 * @param {number} f - Image filename override (0 to use name)
 * @param {number} c - BK character code
 * @param {number} x - X position (pixels)
 * @param {number} y - Y position (pixels)
 * @param {number} w - Width (pixels)
 * @param {number} h - Height (pixels)
 */
function addKey(n, f, c, x, y, w, h)
{
  // Build HTML for button
  var s = '<div class="disSel" style="position:absolute; left:' + x + 'px;top:' + y + 'px;' +
    'visibility:hidden"><img id="kButt' + c + '" src="' +
    (document.location.href.substr(0, 4) == "http" ? '/keybimgs/' : './keybimgs/') +
    (f ? f : n) + '.png" width="' + w + '" height="' + h + '" alt="' + n + '" >' +
    '</div>';
  
  KBUT_.push(c);  // Register button code
  document.write(s);  // Write HTML to page
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Dummy event handler
 * Prevents default behavior and stops propagation
 * Used for touchmove to prevent scrolling
 * @param {Event} e - Event object
 * @returns {boolean} Always false
 */
function DummyEv(e) {
  e.stopPropagation();
  e.preventDefault();
  return false;
}

/**
 * Initializes touch/mouse event listeners for buttons
 * Waits for all button images to load before attaching events
 */
function touchLoads()
{
  var O, i, f = 0;
  
  // Check if all buttons are loaded
  for (i in KBUT_) {
    if (GE("kButt" + KBUT_[i]) == null) {
      f = 1;  // Button not loaded yet
    }
  }

  // Wait for buttons to load
  if (f) {
    setTimeout('touchLoads()', 999);
  }
  else
  {
    // Attach event listeners to all buttons
    for (i in KBUT_)
    {
      O = GE("kButt" + KBUT_[i]);
      
      if (TOUCH_)
      {
        // Touch device: use touch events
        O.addEventListener("touchstart", TouchClick, false);
        O.addEventListener("touchmove", DummyEv, false);   // Prevent scroll
        O.addEventListener("touchend", TouchUp, false);
      }
      else
      {
        // Desktop: use mouse events
        O.addEventListener("mousedown", TouchClick, false);
      }
      
      O.style.zIndex = 5555;  // Ensure buttons are on top
    }
  }
}

/**
 * Shows or hides on-screen keyboard buttons
 * @param {boolean} to - True to show, false to hide
 */
function touchShow(to)
{
  for (var i in KBUT_)
  {
    var O = GE("kButt" + KBUT_[i]);
    O.style.visibility = (to ? "visible" : "hidden");
  }
}

/**
 * Handles button press (touch/click)
 * @param {Event} e - Touch or mouse event
 */
function TouchClick(e)
{
  e.stopPropagation();
  e.preventDefault();
  
  var t = e.target;
  if (!t) t = e.currentTarget;
  
  // Extract key code from button ID (format: "kButt123")
  touchpushKey(parseInt(t.id.substr(5)));
}

/**
 * Handles button release (touch end)
 * @param {Event} e - Touch event
 */
function TouchUp(e)
{
  e.stopPropagation();
  e.preventDefault();
  
  var t = e.target;
  if (!t) t = e.currentTarget;
  
  // Extract key code from button ID (format: "kButt123")
  touchpopKey(parseInt(t.id.substr(5)));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Start key lifter for mouse events (desktop)
 * Touch events use TouchUp for explicit release
 */
if (!TOUCH_) {
  keyLifter();
}

// Note: AddKeyButtons() is called from HTML if needed
// Uncomment below to add buttons programmatically:
// AddKeyButtons();
