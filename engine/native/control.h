// CONTROL, as the Rust side sees it (SPEC-screens.md, phase 2): putting a viewer's mouse and keys into Windows,
// and the two things on the PC itself that keep that honest (the cut-off key and the strip across the screen).
//
// Everything here is plain Win32 (`SendInput`, `RegisterHotKey`, one ordinary window). No driver, nothing installed.
// None of it is called unless `serve` was started with `--allow-control`, and none of the "put in" calls are
// reached with `--control-dry-run`.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Each "put in" call returns how many events Windows took: 0 means Windows refused (it does that when the window
// in front belongs to a program running as administrator and the engine is not).

// Moves the real pointer to a place on the main screen, given as a share (0 to 1) of its width and height.
int32_t dbe_put_pointer_at(double share_x, double share_y);
// Moves the real pointer by this much from where it is (what a game that turns the camera with the mouse reads).
int32_t dbe_put_pointer_by(int32_t dx, int32_t dy);
// Presses (down 1) or lets go of (down 0) a mouse button: 0 left, 1 right, 2 middle, 3 back, 4 forward.
int32_t dbe_put_button(int32_t button, int32_t down);
// Turns the wheel: 120 is one notch. `dy` up (away from the hand) is positive, `dx` right is positive.
int32_t dbe_put_wheel(int32_t dx, int32_t dy);
// Presses or lets go of a key, named by its hardware scan code (`extended` 1 for the keys that have the E0 mark).
// When `virtual_key` is not 0 the key is named that way instead (only Pause needs it).
int32_t dbe_put_key(int32_t scan, int32_t extended, int32_t virtual_key, int32_t down);

// Lets go of every key and button that the calls above pressed and have not let go of. The Rust side lets go of
// things itself in the ordinary way; this is the last resort for when it cannot (the engine is failing), and it is
// harmless to call when nothing is held. Returns how many things were let go.
int32_t dbe_put_all_up(void);

// Where the real pointer is now, in Windows' own screen measure. Returns 0 when read.
int32_t dbe_pointer_where(int32_t* x, int32_t* y);

// The guard, on for as long as a viewer holds control:
//  - the cut-off key Ctrl+Alt+Shift+End, which ends control from the PC's own keyboard;
//  - a thin strip along the top of the PC's screen that says the PC is being controlled and names that key.
//    It is an ordinary window that stays on top, lets clicks through, never takes the keyboard, and is left out
//    of the picture that is streamed.
// Begin returns 0 when both are up, 1 when another program already owns that key (control must then be
// refused: there would be no cut-off), 2 when the guard could not be started.
int32_t dbe_guard_begin(void);
void dbe_guard_end(void);
// 1, once, after the cut-off key was pressed.
int32_t dbe_guard_cut(void);

// The same cut-off key held for a second reason: the PC's screen has been changed to a viewer's shape (FIT,
// src/fit.rs), and the key puts it back. No strip shows for this. Begin returns as dbe_guard_begin does; the key
// stays held while either control or fit needs it.
int32_t dbe_guard_fit_begin(void);
void dbe_guard_fit_end(void);
// 1, once, after the cut-off key was pressed while fit held it.
int32_t dbe_guard_fit_cut(void);

// For `debaser-engine pointer-where` (the check's eyes): what can be seen of the guard from another program.
typedef struct DbeStripSeen {
  int32_t present;        // a strip window exists
  int32_t visible;
  int32_t left, top, right, bottom;
  int32_t topmost;        // stays above other windows
  int32_t click_through;  // clicks pass to what is underneath
  int32_t no_activate;    // never takes the keyboard
  int32_t in_front;       // 1 if it is the window with the keyboard (it never should be)
  uint16_t text[160];     // what it says
} DbeStripSeen;
void dbe_strip_seen(DbeStripSeen* seen);
// 1 when Ctrl+Alt+Shift+End is not owned by any program right now (it is tried for and given straight back).
int32_t dbe_cut_off_key_free(void);
// Tells a running engine's guard that the cut-off key was pressed, without any key being pressed: the message
// Windows itself would send is posted to it. Returns 1 when there was a guard to tell.
int32_t dbe_post_cut_off(void);
// The same, but only to the guard of the program with this process number (0 = whichever is found first), so
// that a check can never tell another engine on the same PC.
int32_t dbe_post_cut_off_to(uint32_t process);

// For `debaser-engine pointer-where` too: the game controllers Windows itself reports (the four "XInput" places a
// game looks in), so the check can see the pretend controller appear and go, and that nothing on it is pressed.
// It only reads. Fills four entries and returns how many are connected, or -1 when this Windows has no XInput.
typedef struct DbePadSeen {
  int32_t connected;
  int32_t changes;                  // Windows' count of how many times this controller's state has changed
  int32_t buttons;                  // Windows' own button bits; 0 = nothing pressed
  int32_t left_trigger, right_trigger;
  int32_t left_x, left_y, right_x, right_y;
} DbePadSeen;
int32_t dbe_pads_seen(DbePadSeen seen[4]);

#ifdef __cplusplus
}
#endif
