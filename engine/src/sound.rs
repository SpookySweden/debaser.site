//! SOUND (SPEC-screens.md): what the PC is playing, sent to viewers who ask for it.
//!
//! Three pieces, all used by the sound thread in serve.rs:
//! - `Loopback`: a copy of everything Windows is sending to the default playback device (native/sound.cpp). On
//!   this Windows 10 one program cannot be left out, so it is the whole PC's sound.
//! - `Encoder`: Opus, the codec every browser plays, set for low delay. The `unsafe-libopus` crate is the Opus
//!   project's own library turned from C into Rust by a tool, so it builds with cargo alone.
//! - `Tone`: a steady test tone, for bench/sound-check.cjs only (the PC may be silent when the check runs).
//!
//! Sound travels as 48,000 samples a second, left and right, in frames of 10 ms (480 samples each side). 10 ms
//! and not 5: Windows itself hands the PC's sound over in 10 ms pieces, so shorter frames would only double the
//! number of packets without anything arriving sooner.
//!
//! Nothing here runs while no viewer has asked for sound: the copy is not open and nothing is encoded.

use std::os::raw::c_char;

/// Samples a second, each side.
pub const RATE: u32 = 48_000;
/// Samples in one frame, each side (10 ms).
pub const FRAME: usize = 480;
/// What the encoder is asked to spend: enough for music and game sound in stereo.
pub const BITRATE: i32 = 128_000;

#[repr(C)]
struct DbeSound {
    _private: [u8; 0],
}

extern "C" {
    fn dbe_sound_open(error: *mut c_char, error_len: i32) -> *mut DbeSound;
    fn dbe_sound_read(sound: *mut DbeSound, out: *mut f32, most_frames: i32, wait_ms: i32) -> i32;
    fn dbe_sound_error(sound: *mut DbeSound) -> *const c_char;
    fn dbe_sound_close(sound: *mut DbeSound);
}

/// The copy of what the PC is playing. It stays on the thread that opened it (it holds a raw pointer, so Rust
/// will not let it be moved to another).
pub struct Loopback {
    raw: *mut DbeSound,
}

impl Loopback {
    /// Opens the default playback device's loopback, or says why it could not.
    pub fn open() -> Result<Loopback, String> {
        let mut error = [0 as c_char; 256];
        // The native side writes at most `error.len()` bytes of reason.
        let raw = unsafe { dbe_sound_open(error.as_mut_ptr(), error.len() as i32) };
        if raw.is_null() {
            let message: Vec<u8> = error.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
            return Err(String::from_utf8_lossy(&message).into_owned());
        }
        Ok(Loopback { raw })
    }

    /// Takes the sound that has arrived, waiting up to `wait_ms` when none has. `out` is filled with left and
    /// right samples in turn; the answer is how many frames (pairs) were written. 0 means nothing came in time:
    /// with nothing playing on the PC, Windows hands over nothing at all.
    pub fn read(&mut self, out: &mut [f32], wait_ms: i32) -> Result<usize, String> {
        // `out` has room for `out.len() / 2` frames, and the native side writes no more than that.
        let got = unsafe { dbe_sound_read(self.raw, out.as_mut_ptr(), (out.len() / 2) as i32, wait_ms) };
        if got < 0 {
            // The reason is a zero-ended text inside the sound, good until the next call on it.
            let why = unsafe { std::ffi::CStr::from_ptr(dbe_sound_error(self.raw)) };
            return Err(why.to_string_lossy().into_owned());
        }
        Ok(got as usize)
    }
}

impl Drop for Loopback {
    fn drop(&mut self) {
        unsafe { dbe_sound_close(self.raw) };
    }
}

/// The Opus encoder: 48 kHz, stereo, and of Opus's three ways of working the one with the least delay (no
/// look-ahead beyond 2.5 ms).
pub struct Encoder {
    raw: *mut unsafe_libopus::OpusEncoder,
}

impl Encoder {
    pub fn new() -> Result<Encoder, String> {
        let mut error = 0i32;
        let raw = unsafe { unsafe_libopus::opus_encoder_create(RATE as i32, 2, unsafe_libopus::OPUS_APPLICATION_RESTRICTED_LOWDELAY, &mut error) };
        if raw.is_null() || error != unsafe_libopus::OPUS_OK {
            return Err(format!("The Opus encoder would not start (its error {error})"));
        }
        // The bitrate; a varying one, so that silence costs a few bytes a frame and not the full rate; and a
        // middling effort, which is what keeps the encoder to a small share of one processor core.
        unsafe {
            unsafe_libopus::opus_encoder_ctl!(raw, unsafe_libopus::OPUS_SET_BITRATE_REQUEST, BITRATE);
            unsafe_libopus::opus_encoder_ctl!(raw, unsafe_libopus::OPUS_SET_VBR_REQUEST, 1);
            unsafe_libopus::opus_encoder_ctl!(raw, unsafe_libopus::OPUS_SET_COMPLEXITY_REQUEST, 5);
        }
        Ok(Encoder { raw })
    }

    /// Encodes one frame: `FRAME` left and right samples in turn (so `FRAME * 2` numbers). Returns how many bytes
    /// of `out` the packet takes.
    pub fn encode(&mut self, frame: &[f32], out: &mut [u8]) -> Result<usize, String> {
        assert_eq!(frame.len(), FRAME * 2, "one frame is {FRAME} samples each side");
        // The encoder reads exactly FRAME * 2 floats and writes at most `out.len()` bytes.
        let wrote = unsafe { unsafe_libopus::opus_encode_float(self.raw, frame.as_ptr(), FRAME as i32, out.as_mut_ptr(), out.len() as i32) };
        if wrote < 0 {
            return Err(format!("The Opus encoder failed on a frame (its error {wrote})"));
        }
        Ok(wrote as usize)
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe { unsafe_libopus::opus_encoder_destroy(self.raw) };
    }
}

/// For bench/sound-check.cjs only (`DEBASER_PRETEND_TONE=1`): a steady 440 Hz tone at a quarter of full volume,
/// in place of the PC's own sound.
pub struct Tone {
    turn: f64,
}

impl Tone {
    pub fn new() -> Tone {
        Tone { turn: 0.0 }
    }

    /// Adds one frame of the tone to `to`.
    pub fn frame(&mut self, to: &mut Vec<f32>) {
        for _ in 0..FRAME {
            let value = (self.turn * std::f64::consts::TAU).sin() as f32 * 0.25;
            to.push(value);
            to.push(value);
            self.turn = (self.turn + 440.0 / RATE as f64).fract();
        }
    }
}

/// The loudest sample in a stretch of sound (0 = digital silence).
pub fn loudest(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |most, sample| most.max(sample.abs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_encoder_makes_opus_packets_and_silence_is_small() {
        let mut encoder = Encoder::new().expect("an Opus encoder");
        let mut tone = Tone::new();
        let mut out = [0u8; 1500];
        let (mut loud_bytes, mut quiet_bytes) = (0, 0);
        // The first frames of each are left out: the encoder is still settling.
        for n in 0..50 {
            let mut frame = Vec::new();
            tone.frame(&mut frame);
            assert!(loudest(&frame) > 0.2 && loudest(&frame) <= 0.25);
            let size = encoder.encode(&frame, &mut out).expect("a packet");
            assert!(size > 0);
            // The first byte of an Opus packet says how it was made. Its top five bits here must name one of the
            // low-delay (CELT) full-band 10 ms layouts, numbers 28 to 31; bit 2 says stereo.
            assert_eq!(out[0] >> 3, 30, "packet {n} was made as layout {}", out[0] >> 3);
            assert_eq!(out[0] & 4, 4, "packet {n} is not stereo");
            if n >= 10 {
                loud_bytes += size;
            }
        }
        // Silence only becomes small once it is exactly nothing, and Opus first runs its input through a filter
        // that rings on for about half a second after a sound stops. So two seconds of it, and the last forty counted.
        for n in 0..200 {
            let size = encoder.encode(&[0.0; FRAME * 2], &mut out).expect("a packet");
            if n >= 160 {
                quiet_bytes += size;
            }
        }
        assert!(quiet_bytes * 10 < loud_bytes, "silence took {quiet_bytes} bytes against {loud_bytes} for a tone");
    }

    #[test]
    fn loudness() {
        assert_eq!(loudest(&[0.0, 0.0]), 0.0);
        assert_eq!(loudest(&[0.1, -0.5, 0.25]), 0.5);
    }
}
