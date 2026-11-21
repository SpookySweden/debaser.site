// SOUND, as the Rust side sees it (SPEC-screens.md): what the PC is playing, read back from Windows.
//
// Windows calls this a "loopback": a copy of everything being sent to the default playback device (the speakers or
// headphones Windows is using now). On this Windows 10 one program cannot be left out of it, so it is the whole
// PC's sound. Nothing is recorded from a microphone, nothing is saved, and nothing here changes what the PC plays.
//
// One "sound" is opened, read from, and closed, all on ONE thread (Windows' sound interfaces belong to the thread
// that opened them).
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DbeSound DbeSound;

// Opens the loopback of the default playback device, as 48,000 samples a second, two channels (left, right),
// each sample a 32-bit float from -1 to 1. Returns null on failure, with the reason in `error`.
DbeSound* dbe_sound_open(char* error, int32_t error_len);

// Takes the sound that has arrived since the last call. When none is waiting it waits up to `wait_ms` for
// Windows to say some has come (Windows signals it; nothing is polled). Writes at most `most_frames` frames to
// `out` (a frame is one left and one right sample, so `out` holds `most_frames * 2` floats) and returns how many
// frames it wrote. 0 means nothing came in time, which is what a silent PC looks like: with nothing playing,
// Windows hands over nothing at all. -1 means the device is gone (unplugged, or Windows switched to another):
// close this and open again.
int32_t dbe_sound_read(DbeSound* sound, float* out, int32_t most_frames, int32_t wait_ms);

// Why the last call on this sound failed.
const char* dbe_sound_error(DbeSound* sound);

void dbe_sound_close(DbeSound* sound);

#ifdef __cplusplus
}
#endif
