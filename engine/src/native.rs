//! The Rust side of the native core (native/core.h): one screen being grabbed and encoded on the graphics card.
//!
//! A `Session` stays on the thread that opened it: the graphics-priority switch raises that thread, and the card's
//! drawing context belongs to it. (It holds a raw pointer, so Rust will not let it be moved to another thread.)

use std::os::raw::c_char;

#[repr(C)]
struct DbeOptions {
    encode_width: i32,
    encode_height: i32,
    fps: i32,
    bitrate_kbps: i32,
    hevc: i32,
    intra_refresh: i32,
    preset: i32,
    tweaks: i32,
    skip_pointer_only: i32,
}

#[repr(C)]
#[derive(Default)]
struct DbeInfo {
    screen_width: i32,
    screen_height: i32,
    screen_hz: i32,
    encode_width: i32,
    encode_height: i32,
    header_api: u32,
    driver_api: u32,
    ticks_per_second: i64,
}

#[repr(C)]
struct DbeFrame {
    data: *const u8,
    size: i32,
    keyframe: i32,
    fresh: i32,
    present_time: i64,
    acquired_time: i64,
    encoded_time: i64,
    copy_ms: f64,
    encode_ms: f64,
}

#[repr(C)]
struct DbeSession {
    _private: [u8; 0],
}

extern "C" {
    fn dbe_open(options: *const DbeOptions, info: *mut DbeInfo, error: *mut c_char, error_len: i32) -> *mut DbeSession;
    fn dbe_next_frame(session: *mut DbeSession, wait_ms: i32, force_keyframe: i32, frame: *mut DbeFrame) -> i32;
    fn dbe_last_error(session: *mut DbeSession) -> *const c_char;
    fn dbe_now() -> i64;
    fn dbe_close(session: *mut DbeSession);
}

/// The switches kept after the fair comparisons in BENCH.md (2026-11-20): graphics priority (1), the encoder's
/// event mode (4) and one-pass encoding (8). The fine timer (2) changed nothing and is left off.
pub const DEFAULT_TWEAKS: i32 = 13;

/// What to grab and how to encode it. `width`/`height` 0 mean the whole screen; smaller cuts a piece from its middle.
pub struct Options {
    pub width: i32,
    pub height: i32,
    pub fps: i32,
    pub bitrate_kbps: i32,
    pub hevc: bool,
    pub intra_refresh: bool,
    pub preset: i32,
    pub tweaks: i32,
    /// The mouse pointer moving over an unchanged picture does not end a wait for a frame. On for the live stream;
    /// off for the bench, which has always counted such a moment as a (repeated) frame.
    pub skip_pointer_only: bool,
}

/// What the session found when it opened.
pub struct Info {
    pub screen_width: i32,
    pub screen_height: i32,
    pub screen_hz: i32,
    pub encode_width: i32,
    pub encode_height: i32,
    pub header_api: u32,
    pub driver_api: u32,
    /// How many ticks of Windows' fine clock make a second: the unit of every `*_time` below and of `now()`.
    pub ticks_per_second: i64,
}

/// One encoded frame. `data` is lent by the encoder and is only good until the next frame is asked for.
pub struct Frame<'a> {
    /// The frame as Annex-B bytes (start codes between its parts).
    pub data: &'a [u8],
    /// A full picture: a viewer can start from it.
    pub keyframe: bool,
    /// The screen really changed. When false nothing new came in time and the last picture was encoded again.
    pub fresh: bool,
    /// When Windows showed the frame (0 for a repeat).
    pub present_time: i64,
    /// When Windows handed the frame over, or the wait ran out.
    pub acquired_time: i64,
    /// When the encoded frame was in memory.
    pub encoded_time: i64,
    pub copy_ms: f64,
    pub encode_ms: f64,
}

pub struct Session {
    raw: *mut DbeSession,
    pub info: Info,
}

fn text(bytes: &[c_char]) -> String {
    let message: Vec<u8> = bytes.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&message).into_owned()
}

impl Session {
    /// Opens the main screen and the encoder, or says why it could not.
    pub fn open(o: &Options) -> Result<Session, String> {
        let options = DbeOptions {
            encode_width: o.width,
            encode_height: o.height,
            fps: o.fps,
            bitrate_kbps: o.bitrate_kbps,
            hevc: o.hevc as i32,
            intra_refresh: o.intra_refresh as i32,
            preset: o.preset,
            tweaks: o.tweaks,
            skip_pointer_only: o.skip_pointer_only as i32,
        };
        let mut info = DbeInfo::default();
        let mut error = [0 as c_char; 512];
        // The native side writes at most `error.len()` bytes of reason, and fills `info` before it returns.
        let raw = unsafe { dbe_open(&options, &mut info, error.as_mut_ptr(), error.len() as i32) };
        if raw.is_null() {
            return Err(text(&error));
        }
        Ok(Session {
            raw,
            info: Info {
                screen_width: info.screen_width,
                screen_height: info.screen_height,
                screen_hz: info.screen_hz,
                encode_width: info.encode_width,
                encode_height: info.encode_height,
                header_api: info.header_api,
                driver_api: info.driver_api,
                ticks_per_second: info.ticks_per_second.max(1),
            },
        })
    }

    /// Waits up to `wait_ms` for the screen to change, then encodes it (or the last picture again).
    /// The borrow on `self` keeps the frame's bytes from outliving the next call.
    pub fn next_frame(&mut self, wait_ms: i32, force_keyframe: bool) -> Result<Frame<'_>, String> {
        let mut f = DbeFrame { data: std::ptr::null(), size: 0, keyframe: 0, fresh: 0, present_time: 0, acquired_time: 0, encoded_time: 0, copy_ms: 0.0, encode_ms: 0.0 };
        let failed = unsafe { dbe_next_frame(self.raw, wait_ms, force_keyframe as i32, &mut f) };
        if failed != 0 {
            // The reason is a zero-ended text inside the session, good until the next call on it.
            let why = unsafe { std::ffi::CStr::from_ptr(dbe_last_error(self.raw)) };
            return Err(why.to_string_lossy().into_owned());
        }
        let data: &[u8] = if f.data.is_null() || f.size <= 0 {
            &[]
        } else {
            // The encoder lends `size` bytes at `data` until the next call, which `&mut self` rules out meanwhile.
            unsafe { std::slice::from_raw_parts(f.data, f.size as usize) }
        };
        Ok(Frame {
            data,
            keyframe: f.keyframe != 0,
            fresh: f.fresh != 0,
            present_time: f.present_time,
            acquired_time: f.acquired_time,
            encoded_time: f.encoded_time,
            copy_ms: f.copy_ms,
            encode_ms: f.encode_ms,
        })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        unsafe { dbe_close(self.raw) };
    }
}

/// Windows' fine clock now, in the same ticks as a frame's times.
pub fn now() -> i64 {
    unsafe { dbe_now() }
}
