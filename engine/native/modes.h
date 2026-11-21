// THE PC'S SCREEN MODE, as the Rust side sees it (SPEC-screens.md; the rules are in src/fit.rs).
//
// A "mode" is a size in pixels and a number of refreshes a second that the monitor can be put into. These calls
// read the main screen's modes and, for FIT THE PC TO THIS SCREEN, change it for a while and give it back.
//
// The change is always the TEMPORARY kind: nothing is written to Windows' settings, so if the engine dies Windows
// puts the old mode back by itself. None of the two calls that change anything is reached unless `serve` was
// started with `--allow-fit`, and never when the engine is pretending its modes for a check.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DbeMode {
  int32_t width, height;  // pixels
  int32_t hz;             // refreshes a second
} DbeMode;

// The main screen's mode now. Returns 0 when read. It only reads.
int32_t dbe_mode_now(DbeMode* mode);

// Every mode the main screen offers at full colour (32 bits a pixel), each size and rate once. Fills at most
// `most` and returns how many. It only reads.
int32_t dbe_modes(DbeMode* out, int32_t most);

// Asks Windows whether the main screen WOULD take this mode, without changing anything. Returns Windows' own
// answer: 0 it would; anything else is its reason for refusing (src/fit.rs has the words).
int32_t dbe_mode_would_take(const DbeMode* mode);

// Puts the main screen into this mode for now (temporary: Windows' settings are not touched, and Windows undoes
// it by itself if this program ends). Returns Windows' own answer, 0 when done.
int32_t dbe_mode_set_for_now(const DbeMode* mode);

// Gives the main screen back the mode in Windows' settings (what it had before any temporary change).
// Returns Windows' own answer, 0 when done.
int32_t dbe_mode_give_back(void);

#ifdef __cplusplus
}
#endif
