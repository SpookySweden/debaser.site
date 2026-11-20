// The engine's native core, as the Rust side sees it (SPEC-screens.md).
//
// One "session" is one screen being grabbed and encoded. Open it, ask it for frames one at a time, close it.
// Everything on one session must be called from the thread that opened it: the graphics-priority switch raises
// that thread, and the card's drawing context belongs to it.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DbeOptions {
  int32_t encode_width;   // the width of the picture that is sent; 0 = the region's own width
  int32_t encode_height;  // its height; 0 = the region's own. Never larger than the region: nothing is blown up here
  int32_t fps;            // the rate the encoder is told to expect (it sizes each frame's share of the bitrate)
  int32_t bitrate_kbps;
  int32_t hevc;           // 0 = H.264, 1 = HEVC
  int32_t intra_refresh;  // 1 = gradual repair on (no full pictures after the first)
  int32_t preset;         // 1 (fastest) to 7
  int32_t tweaks;         // switches to try, added together: 1 graphics priority, 2 fine timer, 4 event mode, 8 one pass
  int32_t skip_pointer_only;  // 1 = the mouse pointer moving over an unchanged picture does not end a wait for
                              // a frame (the live stream); 0 = it does, as the bench has always counted it
  // The piece of the screen that is sent, in screen pixels. A width or height of 0 = the whole screen.
  // When the region and the picture are the same size the piece is copied as it is (the fastest way). When the
  // picture is smaller, the card's video unit shrinks the region to it on the way to the encoder.
  int32_t region_x, region_y, region_width, region_height;
} DbeOptions;

typedef struct DbeInfo {
  int32_t screen_width, screen_height, screen_hz;
  int32_t encode_width, encode_height;
  uint32_t header_api, driver_api;  // NVIDIA's encoder interface: the engine's header, and the driver's
  int64_t ticks_per_second;         // how many ticks of Windows' fine clock make a second (for the times below)
  int32_t region_x, region_y, region_width, region_height;  // the piece of the screen really taken
  int32_t scaled;                   // 1 = the region is shrunk to the picture's size; 0 = copied as it is
} DbeInfo;

typedef struct DbeFrame {
  const uint8_t* data;   // the encoded frame, Annex-B (start codes); valid until the next call on this session
  int32_t size;          // its length in bytes
  int32_t keyframe;      // 1 = a full picture (a viewer can start from it)
  int32_t fresh;         // 1 = the screen really changed; 0 = nothing new came in time, the last picture again
  int64_t present_time;  // when Windows showed the frame, on Windows' fine clock; 0 for a repeat
  int64_t acquired_time; // when Windows handed the frame over (or the wait ran out)
  int64_t encoded_time;  // when the encoded frame was in memory
  double copy_ms;        // taking the frame and copying it on the graphics card
  double encode_ms;      // handing it to the encoder until the finished frame is in memory
} DbeFrame;

typedef struct DbeSession DbeSession;

// Opens the main screen and the encoder. Returns null on failure, with the reason in `error`.
DbeSession* dbe_open(const DbeOptions* options, DbeInfo* info, char* error, int32_t error_len);

// Waits up to `wait_ms` for the screen to change, then encodes: the new frame, or the last picture again when
// nothing changed in time. `force_keyframe` 1 asks for a full picture (the first frame always is one).
// Returns 0 and fills `frame`, or 1 on failure (the reason is in dbe_last_error).
int32_t dbe_next_frame(DbeSession* session, int32_t wait_ms, int32_t force_keyframe, DbeFrame* frame);

// Why the last call on this session failed.
const char* dbe_last_error(DbeSession* session);

// Windows' fine clock now, in the same ticks as the frame times.
int64_t dbe_now(void);

// The main screen's size and refresh rate, without opening anything. Returns 0 when found.
// It only reads Windows' current display mode; it never changes it.
int32_t dbe_screen(int32_t* width, int32_t* height, int32_t* hz);

// Whether a program with this file name (such as L"League of Legends.exe", any letter case) is running now:
// 1 yes, 0 no, -1 could not look. Safe to call from any thread.
int32_t dbe_process_running(const wchar_t* name);

void dbe_close(DbeSession* session);

#ifdef __cplusplus
}
#endif
