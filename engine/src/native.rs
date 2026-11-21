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
    region_x: i32,
    region_y: i32,
    region_width: i32,
    region_height: i32,
    pretend_still: i32,
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
    region_x: i32,
    region_y: i32,
    region_width: i32,
    region_height: i32,
    scaled: i32,
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
struct DbePointer {
    shape_count: u32,
    kind: i32,
    width: i32,
    height: i32,
    pitch: i32,
    hot_x: i32,
    hot_y: i32,
    data: *const u8,
    size: i32,
    visible: i32,
}

#[repr(C)]
struct DbeSession {
    _private: [u8; 0],
}

extern "C" {
    fn dbe_open(options: *const DbeOptions, info: *mut DbeInfo, error: *mut c_char, error_len: i32) -> *mut DbeSession;
    fn dbe_next_frame(session: *mut DbeSession, wait_ms: i32, force_keyframe: i32, frame: *mut DbeFrame) -> i32;
    fn dbe_next_frame_if_changed(session: *mut DbeSession, wait_ms: i32, frame: *mut DbeFrame) -> i32;
    fn dbe_local_ipv4(addresses: *mut u32, most: i32) -> i32;
    fn dbe_pointer(session: *mut DbeSession, pointer: *mut DbePointer);
    fn dbe_last_error(session: *mut DbeSession) -> *const c_char;
    fn dbe_now() -> i64;
    fn dbe_close(session: *mut DbeSession);
    fn dbe_screen(width: *mut i32, height: *mut i32, hz: *mut i32) -> i32;
    fn dbe_process_running(name: *const u16) -> i32;
}

/// The switches kept after the fair comparisons in BENCH.md (2026-11-20): graphics priority (1), the encoder's
/// event mode (4), one-pass encoding (8), and the fresh-frame rule (16: wait a sliver for the screen's next frame
/// instead of taking one that has been sitting), and the piece rule (32: a change elsewhere on the screen is not a
/// frame of the piece being sent). The fine timer (2) changed nothing and is left off.
/// 64 is the still-screen rule, which lives in serve.rs: on a screen that is not changing, the gaps between
/// repeats grow (the first when it always came, then 100 ms, 200 ms, then every 500 ms) instead of a repeat
/// every frame's time.
pub const DEFAULT_TWEAKS: i32 = 125;

/// A piece of the screen, in screen pixels. A `width` or `height` of 0 means the whole screen.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// What to grab and how to encode it. `width`/`height` are the picture that is sent (0 = the region's own size).
/// The same size as the region: the piece is copied as it is. Smaller: the card shrinks the region to it.
pub struct Options {
    pub region: Region,
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
    /// For bench/still-check.cjs only: after the first picture, behave as if the screen never changed again.
    pub pretend_still: bool,
}

/// What the session found when it opened.
pub struct Info {
    pub screen_width: i32,
    pub screen_height: i32,
    pub screen_hz: i32,
    pub encode_width: i32,
    pub encode_height: i32,
    /// The piece of the screen really taken.
    pub region: Region,
    /// The piece is shrunk to the picture's size on the card (false: copied as it is).
    pub scaled: bool,
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

/// The PC's own mouse pointer as Windows last described it to a session: how many shapes it has handed over so
/// far (0 = none yet), and whether the pointer is showing (None = Windows has not said).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PointerHeard {
    pub shape_count: u32,
    pub visible: Option<bool>,
}

/// A pointer shape exactly as Windows hands it over (pointer.rs turns it into plain pixels).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RawPointerShape {
    /// Windows' three kinds: 1 one-bit, 2 colour, 4 colour with a mask byte.
    pub kind: i32,
    pub width: i32,
    /// As Windows gives it: for the one-bit kind, double the pointer's own height.
    pub height: i32,
    /// Bytes in one row of `data`.
    pub pitch: i32,
    pub hot_x: i32,
    pub hot_y: i32,
    pub data: Vec<u8>,
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
            pretend_still: o.pretend_still as i32,
            region_x: o.region.x,
            region_y: o.region.y,
            region_width: o.region.width,
            region_height: o.region.height,
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
                region: Region { x: info.region_x, y: info.region_y, width: info.region_width, height: info.region_height },
                scaled: info.scaled != 0,
                header_api: info.header_api,
                driver_api: info.driver_api,
                ticks_per_second: info.ticks_per_second.max(1),
            },
        })
    }

    /// Waits up to `wait_ms` for the screen to change, then encodes it (or the last picture again).
    /// The borrow on `self` keeps the frame's bytes from outliving the next call.
    pub fn next_frame(&mut self, wait_ms: i32, force_keyframe: bool) -> Result<Frame<'_>, String> {
        self.take(wait_ms, force_keyframe, false)
    }

    /// Waits up to `wait_ms` for the screen to change. When it does, that frame is encoded and returned. When it
    /// does not, nothing is encoded at all and the answer is None: the screen is still.
    pub fn next_frame_if_changed(&mut self, wait_ms: i32) -> Result<Option<Frame<'_>>, String> {
        let frame = self.take(wait_ms, false, true)?;
        Ok((!frame.data.is_empty()).then_some(frame))
    }

    fn pointer_raw(&self) -> DbePointer {
        let mut p = DbePointer { shape_count: 0, kind: 0, width: 0, height: 0, pitch: 0, hot_x: 0, hot_y: 0, data: std::ptr::null(), size: 0, visible: -1 };
        // The native side only fills in what the frame calls already read.
        unsafe { dbe_pointer(self.raw, &mut p) };
        p
    }

    /// What Windows last said about the PC's own pointer. Cheap: nothing is asked of Windows here.
    pub fn pointer_heard(&self) -> PointerHeard {
        let p = self.pointer_raw();
        PointerHeard { shape_count: p.shape_count, visible: match p.visible { 1 => Some(true), 0 => Some(false), _ => None } }
    }

    /// A copy of the newest pointer shape Windows handed over, when it has handed one over.
    pub fn pointer_shape(&self) -> Option<RawPointerShape> {
        let p = self.pointer_raw();
        if p.shape_count == 0 || p.data.is_null() || p.size <= 0 {
            return None;
        }
        // `size` bytes at `data` are good until the next call on the session, and are copied before then.
        let data = unsafe { std::slice::from_raw_parts(p.data, p.size as usize) }.to_vec();
        Some(RawPointerShape { kind: p.kind, width: p.width, height: p.height, pitch: p.pitch, hot_x: p.hot_x, hot_y: p.hot_y, data })
    }

    fn take(&mut self, wait_ms: i32, force_keyframe: bool, only_if_changed: bool) -> Result<Frame<'_>, String> {
        let mut f = DbeFrame { data: std::ptr::null(), size: 0, keyframe: 0, fresh: 0, present_time: 0, acquired_time: 0, encoded_time: 0, copy_ms: 0.0, encode_ms: 0.0 };
        let failed = unsafe {
            if only_if_changed {
                dbe_next_frame_if_changed(self.raw, wait_ms, &mut f)
            } else {
                dbe_next_frame(self.raw, wait_ms, force_keyframe as i32, &mut f)
            }
        };
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

/// The main screen's width, height and refresh rate (Hz, 0 when Windows does not say), without opening anything.
/// It only reads Windows' current display mode.
pub fn screen() -> Option<(i32, i32, i32)> {
    let (mut width, mut height, mut hz) = (0, 0, 0);
    let failed = unsafe { dbe_screen(&mut width, &mut height, &mut hz) };
    (failed == 0 && width > 0 && height > 0).then_some((width, height, hz))
}

/// This PC's own IPv4 addresses on network cards that are up. Only read from Windows' list: nothing is opened.
pub fn local_ipv4() -> Vec<std::net::Ipv4Addr> {
    let mut numbers = [0u32; 64];
    let count = unsafe { dbe_local_ipv4(numbers.as_mut_ptr(), numbers.len() as i32) }.clamp(0, numbers.len() as i32) as usize;
    numbers[..count].iter().map(|n| std::net::Ipv4Addr::from(*n)).collect()
}

/// Whether a program with this file name (any letter case) is running now. None when Windows would not say.
pub fn process_running(name: &str) -> Option<bool> {
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    // The native side reads the zero-ended name and keeps nothing.
    match unsafe { dbe_process_running(wide.as_ptr()) } {
        1 => Some(true),
        0 => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_screen_is_found_without_opening_anything() {
        let (width, height, _hz) = screen().expect("a main screen");
        assert!(width >= 640 && height >= 480, "{width}x{height}");
    }

    #[test]
    fn this_pcs_own_addresses_are_listed() {
        // Every PC has at least its loopback address, and the list holds no "no address at all".
        let all = local_ipv4();
        assert!(all.iter().any(|a| a.is_loopback()), "{all:?}");
        assert!(all.iter().all(|a| !a.is_unspecified()), "{all:?}");
    }

    #[test]
    fn running_programs_are_found_by_file_name() {
        // This test is itself a running program, so its own file name must be found, in any letter case.
        let me = std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(process_running(&me), Some(true));
        assert_eq!(process_running(&me.to_uppercase()), Some(true));
        assert_eq!(process_running("no such program here 7f3a.exe"), Some(false));
    }
}
