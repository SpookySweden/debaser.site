// The engine's native core, as the Rust side sees it (SPEC-screens.md).
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DbeBenchOptions {
  int32_t encode_width;   // 0 = the screen's own width; smaller = a piece cut from the middle of the screen
  int32_t encode_height;  // 0 = the screen's own height
  int32_t fps;            // the rate asked of the encoder, and how long to wait for a new frame
  int32_t bitrate_kbps;
  int32_t frames;         // how many frames to encode
  int32_t hevc;           // 0 = H.264, 1 = HEVC
  int32_t intra_refresh;  // 1 = gradual repair on (no full pictures after the first)
  int32_t preset;         // 1 (fastest) to 7
  int32_t tweaks;         // switches to try, added together: 1 graphics priority, 2 fine timer, 4 event mode, 8 one pass
  const char* dump_path;  // write the encoded stream here (may be null)
} DbeBenchOptions;

typedef struct DbeBenchResult {
  int32_t ok;
  char error[512];
  int32_t screen_width, screen_height, screen_hz;
  int32_t encode_width, encode_height;
  uint32_t header_api, driver_api;
  int32_t encoded;     // frames encoded
  int32_t fresh;       // frames that came from a real change on screen
  // One value per frame, filled up to `frames`. Memory is the caller's.
  double* copy_ms;                // taking the frame and copying it on the graphics card
  double* encode_ms;              // handing it to the encoder until the finished frame is in memory
  double* present_to_encoded_ms;  // from Windows showing the frame to the encoded frame in memory; -1 for a repeat
  int32_t* bytes;                 // size of each encoded frame
} DbeBenchResult;

// Grabs the main screen and encodes it; fills `result`. Returns 0 when it ran.
int32_t dbe_bench_encode(const DbeBenchOptions* options, DbeBenchResult* result);

#ifdef __cplusplus
}
#endif
