//! CONTROL (SPEC-screens.md, phase 2): a viewer's mouse, keys and wheel driving this PC.
//!
//! Off unless `serve` was started with `--allow-control`. Then ONE viewer at a time may hold control: the first to
//! ask keeps it until it lets go, its connection closes, it falls silent for three seconds, a League match starts,
//! the engine stops, or someone at the PC presses Ctrl+Alt+Shift+End. However control ends, every key and button
//! still held down is let go first, so nothing is ever left stuck.
//!
//! Control is refused outright while `League of Legends.exe` is running: the game's anti-cheat rejects input that
//! does not come from a real device, and the owner's account is not to be put at risk.
//!
//! # The messages (this is the one place they are written down; web/viewer.html follows it)
//!
//! Two WebRTC data channels, both opened by the page. Every message is a few bytes; numbers of more than one byte
//! are little-endian.
//!
//! `keys` (reliable, in order), page to PC:
//! - `01`                         TAKE: "I want control".
//! - `02`                         RELEASE: "I am letting go".
//! - `03`                         STILL HERE: sent about once a second while holding control, so that a viewer
//!                                whose mouse is simply at rest is not taken for one that has gone.
//! - `04`                         ALL UP: let go of every key and button I am holding (the tab lost focus).
//! - `10 down code...`            KEY: `down` 1 or 0, then the key's name as the browser gives it
//!                                (`KeyboardEvent.code`: "KeyA", "ShiftRight", "ArrowLeft"...), plain text.
//! - `11 button down has x x y y` BUTTON: 0 left, 1 right, 2 middle, 3 back, 4 forward; `down` 1 or 0. When `has`
//!                                is 1 the place of the click follows (as in POINTER below) and the pointer is put
//!                                there first: movement travels on the other channel and may arrive later.
//! - `12 dx dx dy dy has x x y y` WHEEL: two signed 16-bit turns, 120 to a notch; `dy` positive is away from the
//!                                hand (up), `dx` positive is to the right. The place follows as for BUTTON.
//! - `13 present`                 CONTROLLER: `present` 1 = this device has a game controller connected, so a
//!                                pretend Xbox 360 controller is plugged into the PC; 0 = it has gone, unplug it.
//!                                Sent after control is given, and whenever a controller comes or goes.
//! - `30 on`                      SOUND: `on` 1 = this viewer wants the PC's sound, 0 = it does not. This one is
//!                                not about control at all (any viewer may listen, holding control or not); it is
//!                                read in serve.rs and listed here so that every message is in one place.
//!
//! `pointer` (unreliable, unordered, never resent: a newer position replaces an older one), page to PC:
//! - `20 x x y y`                 POINTER AT: where the pointer is on the PICTURE, each as 0 to 65535 from the
//!                                left/top edge to the right/bottom edge. The PC turns that into a place in the
//!                                piece of its screen that is being sent.
//! - `21 dx dx dy dy`             POINTER BY: signed 16-bit movement since the last one (GAME mode).
//! - `22 n n b b lt rt lx lx ly ly rx rx ry ry`
//!                                CONTROLLER STATE, the whole of it every time: `n` counts up by one per message
//!                                (an older one that arrives late is dropped); `b` the buttons, as the bits in
//!                                `pad_bits` below; `lt` `rt` the triggers, 0 to 255; then the two sticks, signed
//!                                16-bit, right and UP positive. Sent when anything changed, and once a second
//!                                whether or not it did, so a lost message cannot leave a button held.
//!
//! `keys`, PC to page:
//! - `80 what`                    what the PC says about control; the numbers are in `said` below.
//! - `81 shown`                   THE PC'S POINTER: 1 it is showing, 0 it is hidden (games hide it). (pointer.rs)
//! - `82 n n w w h h x x y y how pixels...`
//!                                THE PC'S POINTER SHAPE: its number (goes up with each new shape), width, height
//!                                and hot spot, then its pixels as `how` says (pointer.rs has the three ways).
//! - `83 what`                    the pretend controller on the PC: 0 not plugged in, 1 plugged in, 2 the PC has
//!                                no controller driver, 3 the driver refused. The words are in `/settings`
//!                                ("controllerWhy").
//! - `84 what`                    SOUND, in answer to `30`: 0 off, 1 on its way, 2 this PC is not sending sound.
//!
//! Messages from a viewer that does not hold control are ignored (a TAKE is answered).

use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::native::Region;

extern "C" {
    fn dbe_put_pointer_at(share_x: f64, share_y: f64) -> i32;
    fn dbe_put_pointer_by(dx: i32, dy: i32) -> i32;
    fn dbe_put_button(button: i32, down: i32) -> i32;
    fn dbe_put_wheel(dx: i32, dy: i32) -> i32;
    fn dbe_put_key(scan: i32, extended: i32, virtual_key: i32, down: i32) -> i32;
    fn dbe_put_all_up() -> i32;
    fn dbe_pointer_where(x: *mut i32, y: *mut i32) -> i32;
    fn dbe_guard_begin() -> i32;
    fn dbe_guard_end();
    fn dbe_guard_cut() -> i32;
    fn dbe_strip_seen(seen: *mut StripSeen);
    fn dbe_cut_off_key_free() -> i32;
    fn dbe_post_cut_off_to(process: u32) -> i32;
    fn dbe_pads_seen(seen: *mut PadSeen) -> i32;
}

/// One of the four places Windows keeps game controllers in, as another program sees it (native/control.h).
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct PadSeen {
    pub connected: i32,
    pub changes: i32,
    pub buttons: i32,
    pub left_trigger: i32,
    pub right_trigger: i32,
    pub left_x: i32,
    pub left_y: i32,
    pub right_x: i32,
    pub right_y: i32,
}

/// What can be seen of the strip from another program (native/control.h).
#[repr(C)]
pub struct StripSeen {
    pub present: i32,
    pub visible: i32,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub topmost: i32,
    pub click_through: i32,
    pub no_activate: i32,
    pub in_front: i32,
    pub text: [u16; 160],
}

const TAKE: u8 = 0x01;
const RELEASE: u8 = 0x02;
const STILL_HERE: u8 = 0x03;
const ALL_UP: u8 = 0x04;
const KEY: u8 = 0x10;
const BUTTON: u8 = 0x11;
const WHEEL: u8 = 0x12;
const PAD: u8 = 0x13;
const POINTER_AT: u8 = 0x20;
const POINTER_BY: u8 = 0x21;
const PAD_STATE: u8 = 0x22;
/// The first byte of what the PC says about the pretend controller.
pub const PAD_SAYS: u8 = 0x83;
/// The first byte of what the PC says back.
pub const STATE: u8 = 0x80;

/// What the PC says about control (the second byte of a `80` message).
pub mod said {
    pub const YOURS: u8 = 1;
    pub const ANOTHER_DEVICE: u8 = 2;
    pub const NOT_ALLOWED: u8 = 3;
    pub const LEAGUE_MATCH: u8 = 4;
    pub const NO_CUT_OFF_KEY: u8 = 5;
    pub const ENDED_RELEASED: u8 = 10;
    pub const ENDED_SILENT: u8 = 11;
    pub const ENDED_CUT_OFF: u8 = 12;
    pub const ENDED_LEAGUE_MATCH: u8 = 13;
    pub const ENDED_STOPPING: u8 = 14;
}

/// What the PC says about the pretend controller (the second byte of an `83` message).
pub mod pad_said {
    pub const NOT_PLUGGED_IN: u8 = 0;
    pub const PLUGGED_IN: u8 = 1;
    pub const NO_DRIVER: u8 = 2;
    pub const DRIVER_REFUSED: u8 = 3;
}

/// The buttons of an Xbox 360 controller, as Windows numbers them (XInput's own bits). The page sends these.
pub mod pad_bits {
    pub const NAMES: [(u16, &str); 15] = [
        (0x0001, "UP"),
        (0x0002, "DOWN"),
        (0x0004, "LEFT"),
        (0x0008, "RIGHT"),
        (0x0010, "START"),
        (0x0020, "BACK"),
        (0x0040, "LEFT STICK"),
        (0x0080, "RIGHT STICK"),
        (0x0100, "LB"),
        (0x0200, "RB"),
        (0x0400, "GUIDE"),
        (0x1000, "A"),
        (0x2000, "B"),
        (0x4000, "X"),
        (0x8000, "Y"),
    ];
}

/// Everything a controller is doing at one moment: buttons, the two triggers, the two sticks.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct PadState {
    pub buttons: u16,
    pub left_trigger: u8,
    pub right_trigger: u8,
    pub left_x: i16,
    pub left_y: i16,
    pub right_x: i16,
    pub right_y: i16,
}

impl PadState {
    fn json(&self) -> String {
        let pressed: Vec<&str> = pad_bits::NAMES.iter().filter(|(bit, _)| self.buttons & bit != 0).map(|(_, name)| *name).collect();
        format!(
            "\"what\": \"pad\", \"buttons\": {}, \"pressed\": \"{}\", \"leftTrigger\": {}, \"rightTrigger\": {}, \"leftX\": {}, \"leftY\": {}, \"rightX\": {}, \"rightY\": {}",
            self.buttons,
            pressed.join(" "),
            self.left_trigger,
            self.right_trigger,
            self.left_x,
            self.left_y,
            self.right_x,
            self.right_y
        )
    }
}

/// How the pretend controller on the PC stands: whether it is plugged in, and why not when it could not be.
#[derive(Clone, Default, Debug)]
pub struct PadReport {
    pub plugged: bool,
    pub why_not: Option<String>,
    /// The driver is not there at all (as against being there and refusing).
    pub no_driver: bool,
}

/// What the thread that owns the pretend controller is told to do.
enum PadOrder {
    Plug,
    State(PadState),
    Unplug,
}

/// The pretend controller's own thread. Talking to the driver can take a moment (plugging in waits for Windows
/// to make the device ready), and nothing else is to wait for that, so the driver is only ever spoken to here.
/// When the orders stop coming (the engine is ending) the controller is unplugged. If the engine dies outright,
/// the driver unplugs it by itself: a pretend controller only lives as long as the program that plugged it in.
fn pad_thread(orders: mpsc::Receiver<PadOrder>, report: Arc<Mutex<PadReport>>) {
    use vigem_client::{Client, Error, TargetId, XButtons, XGamepad, Xbox360Wired};
    type Pad = Xbox360Wired<Client>;
    // Puts one state into the pretend controller. The driver refuses a state when Windows has not yet come back
    // for the one before (measured here, 2026-11-21: Windows' "no more items", error 259, on a state sent 20 ms
    // after another). A refused state must not be lost (it may be the letting go of a button), so it is offered
    // again every millisecond until it is taken, for at most `patience`. Returns whether it was taken.
    fn put(pad: &mut Pad, state: PadState, patience: Duration) -> bool {
        let wanted = XGamepad { buttons: XButtons(state.buttons), left_trigger: state.left_trigger, right_trigger: state.right_trigger, thumb_lx: state.left_x, thumb_ly: state.left_y, thumb_rx: state.right_x, thumb_ry: state.right_y };
        let began = Instant::now();
        loop {
            if pad.update(&wanted).is_ok() {
                return true;
            }
            if began.elapsed() >= patience {
                return false;
            }
            thread::sleep(Duration::from_millis(1));
        }
    }
    let mut target: Option<Pad> = None;
    // A state the driver would not take in time: offered again before anything else is done.
    let mut owed: Option<PadState> = None;
    let unplug = |target: &mut Option<Pad>| {
        if let Some(mut plugged) = target.take() {
            // Everything let go first, then out.
            put(&mut plugged, PadState::default(), Duration::from_millis(50));
            let _ = plugged.unplug();
            println!("  CONTROLLER: the pretend Xbox 360 controller is unplugged");
        }
    };
    loop {
        // With a state still owed to the driver, an order is only waited for briefly.
        let order = if owed.is_some() {
            match orders.recv_timeout(Duration::from_millis(2)) {
                Ok(order) => Some(order),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match orders.recv() {
                Ok(order) => Some(order),
                Err(_) => break,
            }
        };
        match order {
            None => {
                if let (Some(pad), Some(state)) = (target.as_mut(), owed) {
                    if put(pad, state, Duration::from_millis(20)) {
                        owed = None;
                    }
                }
            }
            Some(PadOrder::Plug) => {
                if target.is_some() {
                    continue;
                }
                owed = None;
                let plugged = Client::connect().and_then(|client| {
                    let mut pad = Xbox360Wired::new(client, TargetId::XBOX360_WIRED);
                    pad.plugin()?;
                    pad.wait_ready()?;
                    Ok(pad)
                });
                let mut report = report.lock().unwrap();
                match plugged {
                    Ok(mut pad) => {
                        // It must start with nothing pressed and both sticks at rest. The driver does not start it
                        // that way: a new controller first reports a made-up state of the driver's own, with both
                        // sticks a little off centre (about a tenth of the way: measured here, 2026-11-21), and the
                        // driver takes a first report of "nothing at all" as no change and passes nothing on. A game
                        // with a small dead zone would see that as a stick held slightly over. So one stick is moved
                        // by the smallest amount there is (1 part in 32,767, far below anything a game notices; no
                        // button or trigger is touched) and put back, which makes the driver pass on a true rest state.
                        let nudged = put(&mut pad, PadState { left_x: 1, ..PadState::default() }, Duration::from_millis(500));
                        let rested = put(&mut pad, PadState::default(), Duration::from_millis(500));
                        if !(nudged && rested) {
                            println!("  CONTROLLER: the driver would not take the pretend controller's first rest state; it is set again with the first real one");
                        }
                        target = Some(pad);
                        *report = PadReport { plugged: true, why_not: None, no_driver: false };
                        println!("  CONTROLLER: a pretend Xbox 360 controller is plugged into this PC (the viewer's own controller drives it)");
                    }
                    Err(why) => {
                        let no_driver = matches!(why, Error::BusNotFound);
                        let words = match why {
                            Error::BusNotFound => "THE PC HAS NO CONTROLLER DRIVER (ViGEmBus is not installed on it)".to_string(),
                            Error::BusVersionMismatch => "THE PC'S CONTROLLER DRIVER IS A VERSION THIS ENGINE CANNOT TALK TO".to_string(),
                            Error::NoFreeSlot => "THE PC'S CONTROLLER DRIVER HAS NO FREE PLACE FOR ANOTHER CONTROLLER".to_string(),
                            other => format!("THE PC'S CONTROLLER DRIVER REFUSED ({other})"),
                        };
                        println!("  CONTROLLER: no pretend controller. {words}");
                        *report = PadReport { plugged: false, why_not: Some(words), no_driver };
                    }
                }
            }
            Some(PadOrder::State(state)) => {
                if let Some(pad) = target.as_mut() {
                    // States go in in the order they came: one that is still owed goes first (a quick press and
                    // release are two states, and both must reach the game).
                    if let Some(before) = owed.take() {
                        put(pad, before, Duration::from_millis(20));
                    }
                    if !put(pad, state, Duration::from_millis(20)) {
                        owed = Some(state);
                    }
                }
            }
            Some(PadOrder::Unplug) => {
                owed = None;
                unplug(&mut target);
                report.lock().unwrap().plugged = false;
            }
        }
    }
    unplug(&mut target);
    report.lock().unwrap().plugged = false;
}

/// A viewer that holds control and has said nothing at all for this long has gone.
pub const SILENCE: Duration = Duration::from_secs(3);
/// The dry-run record keeps this many of the newest actions.
const LOG_LIMIT: usize = 5000;
pub const BLOCKED_BY_MATCH: &str = "NOT DURING A LEAGUE MATCH";

/// Which of the two channels a message came on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lane {
    Keys,
    Pointer,
}

/// Why control ended.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ended {
    Released,
    ConnectionClosed,
    Silent,
    CutOff,
    LeagueMatch,
    Stopping,
}

impl Ended {
    fn words(self) -> &'static str {
        match self {
            Ended::Released => "the viewer let go",
            Ended::ConnectionClosed => "the viewer's connection closed",
            Ended::Silent => "the viewer went silent for 3 seconds",
            Ended::CutOff => "Ctrl+Alt+Shift+End was pressed on this PC",
            Ended::LeagueMatch => "a League match started",
            Ended::Stopping => "the engine is stopping",
        }
    }

    /// What the viewer that held control is told.
    pub fn says(self) -> u8 {
        match self {
            Ended::Released | Ended::ConnectionClosed => said::ENDED_RELEASED,
            Ended::Silent => said::ENDED_SILENT,
            Ended::CutOff => said::ENDED_CUT_OFF,
            Ended::LeagueMatch => said::ENDED_LEAGUE_MATCH,
            Ended::Stopping => said::ENDED_STOPPING,
        }
    }
}

/// How a key is named to Windows.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    /// By its hardware scan code; `true` for the keys that carry the E0 "extended" mark.
    Scan(u8, bool),
    /// By Windows' own key number. Only Pause, whose scan code cannot be sent the plain way.
    Virtual(u16),
}

use Key::{Scan, Virtual};

/// The browser's name for each physical key (the UI Events `code` values) and the scan code a PC keyboard sends
/// for it (PS/2 set 1, the numbering Windows uses). Typed out from those two published tables.
const KEYS: &[(&str, Key)] = &[
    // The letter block, as laid out on a US keyboard (the names are positions, not letters).
    ("KeyA", Scan(0x1E, false)), ("KeyB", Scan(0x30, false)), ("KeyC", Scan(0x2E, false)), ("KeyD", Scan(0x20, false)),
    ("KeyE", Scan(0x12, false)), ("KeyF", Scan(0x21, false)), ("KeyG", Scan(0x22, false)), ("KeyH", Scan(0x23, false)),
    ("KeyI", Scan(0x17, false)), ("KeyJ", Scan(0x24, false)), ("KeyK", Scan(0x25, false)), ("KeyL", Scan(0x26, false)),
    ("KeyM", Scan(0x32, false)), ("KeyN", Scan(0x31, false)), ("KeyO", Scan(0x18, false)), ("KeyP", Scan(0x19, false)),
    ("KeyQ", Scan(0x10, false)), ("KeyR", Scan(0x13, false)), ("KeyS", Scan(0x1F, false)), ("KeyT", Scan(0x14, false)),
    ("KeyU", Scan(0x16, false)), ("KeyV", Scan(0x2F, false)), ("KeyW", Scan(0x11, false)), ("KeyX", Scan(0x2D, false)),
    ("KeyY", Scan(0x15, false)), ("KeyZ", Scan(0x2C, false)),
    // The digit row.
    ("Digit1", Scan(0x02, false)), ("Digit2", Scan(0x03, false)), ("Digit3", Scan(0x04, false)), ("Digit4", Scan(0x05, false)),
    ("Digit5", Scan(0x06, false)), ("Digit6", Scan(0x07, false)), ("Digit7", Scan(0x08, false)), ("Digit8", Scan(0x09, false)),
    ("Digit9", Scan(0x0A, false)), ("Digit0", Scan(0x0B, false)),
    // Punctuation.
    ("Minus", Scan(0x0C, false)), ("Equal", Scan(0x0D, false)), ("BracketLeft", Scan(0x1A, false)), ("BracketRight", Scan(0x1B, false)),
    ("Backslash", Scan(0x2B, false)), ("Semicolon", Scan(0x27, false)), ("Quote", Scan(0x28, false)), ("Backquote", Scan(0x29, false)),
    ("Comma", Scan(0x33, false)), ("Period", Scan(0x34, false)), ("Slash", Scan(0x35, false)),
    ("IntlBackslash", Scan(0x56, false)), ("IntlRo", Scan(0x73, false)), ("IntlYen", Scan(0x7D, false)),
    // The keys around the letters.
    ("Space", Scan(0x39, false)), ("Enter", Scan(0x1C, false)), ("Tab", Scan(0x0F, false)), ("Escape", Scan(0x01, false)),
    ("Backspace", Scan(0x0E, false)), ("CapsLock", Scan(0x3A, false)),
    // Function keys.
    ("F1", Scan(0x3B, false)), ("F2", Scan(0x3C, false)), ("F3", Scan(0x3D, false)), ("F4", Scan(0x3E, false)),
    ("F5", Scan(0x3F, false)), ("F6", Scan(0x40, false)), ("F7", Scan(0x41, false)), ("F8", Scan(0x42, false)),
    ("F9", Scan(0x43, false)), ("F10", Scan(0x44, false)), ("F11", Scan(0x57, false)), ("F12", Scan(0x58, false)),
    ("F13", Scan(0x64, false)), ("F14", Scan(0x65, false)), ("F15", Scan(0x66, false)), ("F16", Scan(0x67, false)),
    ("F17", Scan(0x68, false)), ("F18", Scan(0x69, false)), ("F19", Scan(0x6A, false)), ("F20", Scan(0x6B, false)),
    ("F21", Scan(0x6C, false)), ("F22", Scan(0x6D, false)), ("F23", Scan(0x6E, false)), ("F24", Scan(0x76, false)),
    // Modifiers, left and right.
    ("ShiftLeft", Scan(0x2A, false)), ("ShiftRight", Scan(0x36, false)), ("ControlLeft", Scan(0x1D, false)), ("ControlRight", Scan(0x1D, true)),
    ("AltLeft", Scan(0x38, false)), ("AltRight", Scan(0x38, true)), ("MetaLeft", Scan(0x5B, true)), ("MetaRight", Scan(0x5C, true)),
    ("ContextMenu", Scan(0x5D, true)),
    // Arrows and the navigation block: all carry the extended mark (it is what tells them from the numpad).
    ("ArrowUp", Scan(0x48, true)), ("ArrowLeft", Scan(0x4B, true)), ("ArrowRight", Scan(0x4D, true)), ("ArrowDown", Scan(0x50, true)),
    ("Insert", Scan(0x52, true)), ("Delete", Scan(0x53, true)), ("Home", Scan(0x47, true)), ("End", Scan(0x4F, true)),
    ("PageUp", Scan(0x49, true)), ("PageDown", Scan(0x51, true)),
    // The numpad.
    ("NumLock", Scan(0x45, false)), ("NumpadDivide", Scan(0x35, true)), ("NumpadMultiply", Scan(0x37, false)),
    ("NumpadSubtract", Scan(0x4A, false)), ("NumpadAdd", Scan(0x4E, false)), ("NumpadEnter", Scan(0x1C, true)),
    ("NumpadDecimal", Scan(0x53, false)), ("NumpadEqual", Scan(0x59, false)), ("NumpadComma", Scan(0x7E, false)),
    ("Numpad0", Scan(0x52, false)), ("Numpad1", Scan(0x4F, false)), ("Numpad2", Scan(0x50, false)), ("Numpad3", Scan(0x51, false)),
    ("Numpad4", Scan(0x4B, false)), ("Numpad5", Scan(0x4C, false)), ("Numpad6", Scan(0x4D, false)), ("Numpad7", Scan(0x47, false)),
    ("Numpad8", Scan(0x48, false)), ("Numpad9", Scan(0x49, false)),
    // The three above the navigation block. Pause's real scan code is a six-byte one-off that cannot be sent as a
    // plain scan code, so it is named by Windows' own key number (0x13) instead.
    ("PrintScreen", Scan(0x37, true)), ("ScrollLock", Scan(0x46, false)), ("Pause", Virtual(0x13)),
];

/// The key a browser's `code` names, when it is one this engine knows.
pub fn key_named(code: &str) -> Option<(&'static str, Key)> {
    KEYS.iter().find(|(name, _)| *name == code).copied()
}

const BUTTON_NAMES: [&str; 5] = ["left", "right", "middle", "back", "forward"];

/// The state of CONTROL: whether it is allowed, who holds it, and what they are holding down.
pub struct Control {
    /// `--allow-control` was given. Without it nothing here ever does anything.
    pub allowed: bool,
    /// `--control-dry-run`: every action is written to the record instead of being put into Windows.
    pub dry_run: bool,
    holder: Option<u64>,
    heard: Instant,
    held_keys: Vec<(&'static str, Key)>,
    held_buttons: [bool; 5],
    /// The piece of the screen being sent (a place on the picture is a place in this), and the screen's size.
    region: Region,
    screen: (i32, i32),
    log: VecDeque<String>,
    logged: u64,
    /// Keys the page named that this engine does not know: ignored, and counted.
    pub unknown_keys: u64,
    /// Actions Windows would not take (it refuses when an administrator's window is in front).
    pub refused_by_windows: u64,
    pub actions: u64,
    /// CONTROLLER. The holder has said it has a controller, so a pretend one is (being) plugged into the PC.
    pad_wanted: bool,
    /// The last state put into the pretend controller, and the number of the last state message taken.
    pad_state: PadState,
    pad_number: Option<u16>,
    /// The way to the thread that owns the real pretend controller, once one has been asked for (never in a dry run).
    pad_orders: Option<mpsc::Sender<PadOrder>>,
    pad_worker: Option<thread::JoinHandle<()>>,
    /// How the pretend controller stands; the pad thread writes it (in a dry run, this code does).
    pad_report: Arc<Mutex<PadReport>>,
    /// What the holder was last told about it (an `83` message), so it is only told of changes.
    pad_told: Option<u8>,
}

impl Control {
    pub fn new(allowed: bool, dry_run: bool, region: Region, screen: (i32, i32)) -> Control {
        Control {
            allowed,
            dry_run,
            holder: None,
            heard: Instant::now(),
            held_keys: Vec::new(),
            held_buttons: [false; 5],
            region,
            screen,
            log: VecDeque::new(),
            logged: 0,
            unknown_keys: 0,
            refused_by_windows: 0,
            actions: 0,
            pad_wanted: false,
            pad_state: PadState::default(),
            pad_number: None,
            pad_orders: None,
            pad_worker: None,
            pad_report: Arc::new(Mutex::new(PadReport::default())),
            pad_told: None,
        }
    }

    /// How the pretend controller stands, for `/settings`.
    pub fn pad_report(&self) -> PadReport {
        self.pad_report.lock().unwrap().clone()
    }

    fn pad_order(&mut self, order: PadOrder) {
        if self.dry_run {
            return;
        }
        if self.pad_orders.is_none() {
            let (orders, taken) = mpsc::channel();
            let report = self.pad_report.clone();
            self.pad_worker = Some(thread::spawn(move || pad_thread(taken, report)));
            self.pad_orders = Some(orders);
        }
        if let Some(orders) = &self.pad_orders {
            let _ = orders.send(order);
        }
    }

    /// The holder's device has a controller: a pretend Xbox 360 controller is plugged into the PC.
    fn pad_plug(&mut self) {
        if self.pad_wanted {
            return;
        }
        self.pad_wanted = true;
        self.pad_state = PadState::default();
        self.pad_number = None;
        self.note("\"what\": \"controller\", \"event\": \"plugged in\"".to_string());
        if self.dry_run {
            *self.pad_report.lock().unwrap() = PadReport { plugged: true, why_not: None, no_driver: false };
        }
        self.pad_order(PadOrder::Plug);
    }

    /// The pretend controller goes: everything on it is let go first (a neutral state), then it is unplugged.
    fn pad_unplug(&mut self) {
        if !self.pad_wanted {
            return;
        }
        self.pad_wanted = false;
        self.pad_state = PadState::default();
        self.pad_number = None;
        self.note(PadState::default().json());
        self.pad_order(PadOrder::State(PadState::default()));
        self.note("\"what\": \"controller\", \"event\": \"unplugged\"".to_string());
        if self.dry_run {
            self.pad_report.lock().unwrap().plugged = false;
        }
        self.pad_order(PadOrder::Unplug);
    }

    /// One whole state from the holder's controller. An older one that arrives after a newer one is dropped, and
    /// so is one that changes nothing (the once-a-second repeat).
    fn pad_takes(&mut self, number: u16, state: PadState) {
        if !self.pad_wanted {
            return;
        }
        if let Some(last) = self.pad_number {
            // Numbers wrap round at 65536: "newer" means up to half-way ahead.
            let ahead = number.wrapping_sub(last);
            if ahead == 0 || ahead >= 0x8000 {
                return;
            }
        }
        self.pad_number = Some(number);
        if state == self.pad_state {
            return;
        }
        self.pad_state = state;
        self.note(state.json());
        self.actions += 1;
        self.pad_order(PadOrder::State(state));
    }

    /// Looked at many times a second: has how the pretend controller stands changed since the holder was last
    /// told? Returns the holder and what to tell it (the second byte of an `83` message).
    pub fn pad_news(&mut self) -> Option<(u64, u8)> {
        let viewer = self.holder?;
        let report = self.pad_report.lock().unwrap().clone();
        let what = if report.plugged {
            pad_said::PLUGGED_IN
        } else if !self.pad_wanted {
            pad_said::NOT_PLUGGED_IN
        } else if report.why_not.is_some() {
            if report.no_driver { pad_said::NO_DRIVER } else { pad_said::DRIVER_REFUSED }
        } else {
            // Asked for and not there yet: Windows is still making the device ready.
            return None;
        };
        if self.pad_told == Some(what) {
            return None;
        }
        self.pad_told = Some(what);
        Some((viewer, what))
    }

    /// The engine is stopping: the pretend controller's thread is told there is nothing more, and is waited for
    /// (a second at most) while it unplugs.
    pub fn pad_finish(&mut self) {
        self.pad_orders = None;
        if let Some(worker) = self.pad_worker.take() {
            let began = Instant::now();
            while !worker.is_finished() && began.elapsed() < Duration::from_secs(1) {
                thread::sleep(Duration::from_millis(5));
            }
        }
    }

    /// Told whenever what is being sent changes, so a place on the picture lands on the right place on the screen.
    pub fn sending(&mut self, region: Region, screen: (i32, i32)) {
        self.region = region;
        self.screen = screen;
    }

    #[cfg(test)]
    pub fn holder(&self) -> Option<u64> {
        self.holder
    }

    /// For `/settings`: "off", "free", "yours" or "another device", as it is for the viewer asking.
    pub fn standing(&self, viewer: Option<u64>) -> &'static str {
        match (self.allowed, self.holder) {
            (false, _) => "off",
            (true, None) => "free",
            (true, held) if held == viewer => "yours",
            (true, _) => "another device",
        }
    }

    fn note(&mut self, entry: String) {
        self.logged += 1;
        if self.dry_run {
            if self.log.len() >= LOG_LIMIT {
                self.log.pop_front();
            }
            self.log.push_back(format!("{{\"n\": {}, {}}}", self.logged, entry));
        }
    }

    /// The dry-run record, for `GET /control-log`: every action that would have been put into Windows, oldest
    /// first, newest last.
    pub fn log_json(&self) -> String {
        format!(
            "{{\"dryRun\": {}, \"holder\": {}, \"unknownKeys\": {}, \"kept\": {}, \"everLogged\": {}, \"entries\": [\n{}\n]}}",
            self.dry_run,
            self.holder.map_or("null".to_string(), |id| id.to_string()),
            self.unknown_keys,
            self.log.len(),
            self.logged,
            self.log.iter().cloned().collect::<Vec<_>>().join(",\n")
        )
    }

    fn count(&mut self, taken: i32) {
        self.actions += 1;
        if taken <= 0 {
            self.refused_by_windows += 1;
        }
    }

    /// A place on the picture (0 to 65535 each way) as a pixel of the screen, inside the piece being sent.
    fn place(&self, x: u16, y: u16) -> (i32, i32) {
        let along = |share: u16, start: i32, length: i32| start + ((share as i64 * length as i64) / 65535).clamp(0, (length - 1).max(0) as i64) as i32;
        (along(x, self.region.x, self.region.width), along(y, self.region.y, self.region.height))
    }

    fn pointer_at(&mut self, x: u16, y: u16) {
        let (px, py) = self.place(x, y);
        self.note(format!("\"what\": \"pointer\", \"x\": {px}, \"y\": {py}"));
        if !self.dry_run {
            // The middle of that pixel, as a share of the whole screen.
            let taken = unsafe { dbe_put_pointer_at((px as f64 + 0.5) / self.screen.0.max(1) as f64, (py as f64 + 0.5) / self.screen.1.max(1) as f64) };
            self.count(taken);
        }
    }

    fn pointer_by(&mut self, dx: i32, dy: i32) {
        self.note(format!("\"what\": \"move\", \"dx\": {dx}, \"dy\": {dy}"));
        if !self.dry_run {
            let taken = unsafe { dbe_put_pointer_by(dx, dy) };
            self.count(taken);
        }
    }

    fn button(&mut self, button: usize, down: bool) {
        self.held_buttons[button] = down;
        self.note(format!("\"what\": \"button\", \"button\": \"{}\", \"down\": {down}", BUTTON_NAMES[button]));
        if !self.dry_run {
            let taken = unsafe { dbe_put_button(button as i32, down as i32) };
            self.count(taken);
        }
    }

    fn wheel(&mut self, dx: i32, dy: i32) {
        self.note(format!("\"what\": \"wheel\", \"dx\": {dx}, \"dy\": {dy}"));
        if !self.dry_run {
            let taken = unsafe { dbe_put_wheel(dx, dy) };
            self.count(taken);
        }
    }

    fn key(&mut self, name: &'static str, key: Key, down: bool) {
        // A key held down repeats: each repeat is passed on, but it is one key to let go of.
        if down {
            if !self.held_keys.iter().any(|(held, _)| *held == name) {
                self.held_keys.push((name, key));
            }
        } else {
            self.held_keys.retain(|(held, _)| *held != name);
        }
        let (scan, extended, virtual_key) = match key {
            Scan(scan, extended) => (scan as i32, extended, 0),
            Virtual(number) => (0, false, number as i32),
        };
        self.note(format!("\"what\": \"key\", \"code\": \"{name}\", \"scan\": {scan}, \"extended\": {extended}, \"virtualKey\": {virtual_key}, \"down\": {down}"));
        if !self.dry_run {
            let taken = unsafe { dbe_put_key(scan, extended as i32, virtual_key, down as i32) };
            self.count(taken);
        }
    }

    /// Lets go of everything still held: keys last-pressed first, then buttons.
    fn all_up(&mut self) {
        while let Some((name, key)) = self.held_keys.last().copied() {
            self.key(name, key, false);
        }
        for button in 0..self.held_buttons.len() {
            if self.held_buttons[button] {
                self.button(button, false);
            }
        }
    }

    /// One message from a viewer. Returns what to say back to that viewer, when there is something to say.
    pub fn message(&mut self, viewer: u64, lane: Lane, data: &[u8], now: Instant, match_running: bool) -> Option<u8> {
        let kind = *data.first()?;
        if !self.allowed {
            return (lane == Lane::Keys && kind == TAKE).then_some(said::NOT_ALLOWED);
        }
        if lane == Lane::Keys && kind == TAKE {
            return Some(self.take(viewer, now, match_running));
        }
        if self.holder != Some(viewer) {
            return None;
        }
        self.heard = now;
        let word = |at: usize| data.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
        match (lane, kind) {
            (Lane::Keys, RELEASE) => {
                self.end(Ended::Released);
                return Some(said::ENDED_RELEASED);
            }
            (Lane::Keys, STILL_HERE) => {}
            (Lane::Keys, ALL_UP) => self.all_up(),
            (Lane::Keys, KEY) => {
                let down = data.get(1).copied()? != 0;
                match std::str::from_utf8(&data[2..]).ok().and_then(key_named) {
                    Some((name, key)) => self.key(name, key, down),
                    None => self.unknown_keys += 1,
                }
            }
            (Lane::Keys, BUTTON) => {
                let button = data.get(1).copied()? as usize;
                let down = data.get(2).copied()? != 0;
                if button < BUTTON_NAMES.len() {
                    if data.get(3).copied() == Some(1) {
                        self.pointer_at(word(4)?, word(6)?);
                    }
                    self.button(button, down);
                }
            }
            (Lane::Keys, WHEEL) => {
                let (dx, dy) = (word(1)? as i16 as i32, word(3)? as i16 as i32);
                if data.get(5).copied() == Some(1) {
                    self.pointer_at(word(6)?, word(8)?);
                }
                self.wheel(dx, dy);
            }
            (Lane::Keys, PAD) => {
                if data.get(1).copied()? != 0 {
                    // A new attempt: whatever went wrong last time is forgotten.
                    if !self.pad_wanted {
                        let mut report = self.pad_report.lock().unwrap();
                        report.why_not = None;
                        report.no_driver = false;
                    }
                    self.pad_plug();
                } else {
                    self.pad_unplug();
                }
            }
            (Lane::Pointer, POINTER_AT) => self.pointer_at(word(1)?, word(3)?),
            (Lane::Pointer, POINTER_BY) => self.pointer_by(word(1)? as i16 as i32, word(3)? as i16 as i32),
            (Lane::Pointer, PAD_STATE) => {
                let state = PadState {
                    buttons: word(3)?,
                    left_trigger: data.get(5).copied()?,
                    right_trigger: data.get(6).copied()?,
                    left_x: word(7)? as i16,
                    left_y: word(9)? as i16,
                    right_x: word(11)? as i16,
                    right_y: word(13)? as i16,
                };
                self.pad_takes(word(1)?, state);
            }
            _ => {}
        }
        None
    }

    fn take(&mut self, viewer: u64, now: Instant, match_running: bool) -> u8 {
        if match_running {
            self.note(format!("\"what\": \"refused\", \"viewer\": {viewer}, \"why\": \"{BLOCKED_BY_MATCH}\""));
            return said::LEAGUE_MATCH;
        }
        match self.holder {
            Some(held) if held == viewer => {
                self.heard = now;
                return said::YOURS;
            }
            Some(_) => {
                self.note(format!("\"what\": \"refused\", \"viewer\": {viewer}, \"why\": \"another device has control\""));
                return said::ANOTHER_DEVICE;
            }
            None => {}
        }
        // The cut-off key and the strip come up first. Without the cut-off there is no control.
        if !self.dry_run && unsafe { dbe_guard_begin() } != 0 {
            unsafe { dbe_guard_end() };
            println!("  viewer {viewer} was REFUSED control: Ctrl+Alt+Shift+End could not be set up as the cut-off key (another program owns it)");
            return said::NO_CUT_OFF_KEY;
        }
        self.holder = Some(viewer);
        self.heard = now;
        self.pad_told = None;
        self.note(format!("\"what\": \"taken\", \"viewer\": {viewer}"));
        println!("  viewer {viewer} took CONTROL of this PC{}", if self.dry_run { " (dry run: nothing reaches Windows)" } else { " (Ctrl+Alt+Shift+End on this PC stops it)" });
        said::YOURS
    }

    /// Ends control, for whatever reason: everything held is let go, the pretend controller (when there is one) is
    /// set to "nothing pressed" and unplugged, the strip and the cut-off key go away.
    /// Returns the viewer that held it.
    pub fn end(&mut self, why: Ended) -> Option<u64> {
        let viewer = self.holder?;
        self.all_up();
        self.pad_unplug();
        if !self.dry_run {
            unsafe { dbe_guard_end() };
        }
        self.holder = None;
        self.pad_told = None;
        self.note(format!("\"what\": \"ended\", \"viewer\": {viewer}, \"why\": \"{}\"", why.words()));
        println!("  CONTROL ended: {}", why.words());
        Some(viewer)
    }

    /// Looked at many times a second: has anything happened that ends control? `alive` says whether a viewer's
    /// connection and its keys channel are still there. Returns the viewer to tell, and what to tell it.
    pub fn watch(&mut self, now: Instant, match_running: bool, alive: impl Fn(u64) -> bool) -> Option<(u64, u8)> {
        let viewer = self.holder?;
        let why = if match_running {
            Ended::LeagueMatch
        } else if !self.dry_run && unsafe { dbe_guard_cut() } != 0 {
            Ended::CutOff
        } else if !alive(viewer) {
            Ended::ConnectionClosed
        } else if now.saturating_duration_since(self.heard) > SILENCE {
            Ended::Silent
        } else {
            return None;
        };
        self.end(why);
        Some((viewer, why.says()))
    }
}

/// The last resort: lets go of everything the native side knows it pressed. For when the engine is failing and
/// the ordinary way (`Control::end`) cannot be relied on. Harmless when nothing is held.
pub fn emergency_all_up() {
    unsafe { dbe_put_all_up() };
}

/// Where the real pointer is, in Windows' own measure.
pub fn pointer_where() -> Option<(i32, i32)> {
    let (mut x, mut y) = (0, 0);
    (unsafe { dbe_pointer_where(&mut x, &mut y) } == 0).then_some((x, y))
}

/// `debaser-engine pointer-where [--cut-off [--of <process number>]]`: the check's eyes on the PC. It prints, as one line of JSON, where
/// the real pointer is, what can be seen of the control strip from outside the engine, whether the cut-off
/// key is free, and the game controllers Windows itself reports (so a pretend one can be seen to come and go). With `--cut-off` it also tells a running engine's guard that the cut-off key was pressed (by
/// posting the message Windows would send; no key is pressed). It never moves or presses anything.
pub fn pointer_where_command(args: &[String]) -> std::process::ExitCode {
    let mut seen = StripSeen { present: 0, visible: 0, left: 0, top: 0, right: 0, bottom: 0, topmost: 0, click_through: 0, no_activate: 0, in_front: 0, text: [0; 160] };
    unsafe { dbe_strip_seen(&mut seen) };
    let key_free = unsafe { dbe_cut_off_key_free() } != 0;
    // `--of` names the one engine to tell (by its process number), so a check can never tell another engine on
    // the same PC. Without it, whichever guard is found first is told.
    let of: u32 = args.iter().position(|a| a == "--of").and_then(|at| args.get(at + 1)).and_then(|number| number.parse().ok()).unwrap_or(0);
    let posted = args.iter().any(|a| a == "--cut-off") && unsafe { dbe_post_cut_off_to(of) } != 0;
    let text: String = String::from_utf16_lossy(&seen.text[..seen.text.iter().position(|c| *c == 0).unwrap_or(seen.text.len())]);
    let (x, y) = pointer_where().unwrap_or((-1, -1));
    let strip = if seen.present != 0 {
        format!(
            "{{\"visible\": {}, \"left\": {}, \"top\": {}, \"right\": {}, \"bottom\": {}, \"topmost\": {}, \"clickThrough\": {}, \"neverActivated\": {}, \"hasTheKeyboard\": {}, \"text\": {}}}",
            seen.visible != 0,
            seen.left,
            seen.top,
            seen.right,
            seen.bottom,
            seen.topmost != 0,
            seen.click_through != 0,
            seen.no_activate != 0,
            seen.in_front != 0,
            crate::settings::quoted(&text)
        )
    } else {
        "null".to_string()
    };
    let mut seen_pads = [PadSeen::default(); 4];
    let connected = unsafe { dbe_pads_seen(seen_pads.as_mut_ptr()) };
    let pads = if connected < 0 {
        "null".to_string()
    } else {
        let each: Vec<String> = seen_pads
            .iter()
            .enumerate()
            .filter(|(_, pad)| pad.connected != 0)
            .map(|(place, pad)| {
                format!(
                    "{{\"place\": {place}, \"changes\": {}, \"buttons\": {}, \"leftTrigger\": {}, \"rightTrigger\": {}, \"leftX\": {}, \"leftY\": {}, \"rightX\": {}, \"rightY\": {}}}",
                    pad.changes, pad.buttons, pad.left_trigger, pad.right_trigger, pad.left_x, pad.left_y, pad.right_x, pad.right_y
                )
            })
            .collect();
        format!("[{}]", each.join(", "))
    };
    println!("{{\"x\": {x}, \"y\": {y}, \"strip\": {strip}, \"cutOffKeyFree\": {key_free}, \"cutOffPosted\": {posted}, \"controllers\": {pads}}}");
    std::process::ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dry() -> Control {
        // The 16:9 middle of a 3440x1440 screen.
        Control::new(true, true, Region { x: 440, y: 0, width: 2560, height: 1440 }, (3440, 1440))
    }

    fn key(down: u8, code: &str) -> Vec<u8> {
        let mut m = vec![KEY, down];
        m.extend_from_slice(code.as_bytes());
        m
    }

    #[test]
    fn the_key_table() {
        assert_eq!(key_named("KeyA"), Some(("KeyA", Scan(0x1E, false))));
        assert_eq!(key_named("Digit1"), Some(("Digit1", Scan(0x02, false))));
        assert_eq!(key_named("ShiftLeft").unwrap().1, Scan(0x2A, false));
        assert_eq!(key_named("ShiftRight").unwrap().1, Scan(0x36, false));
        assert_eq!(key_named("Enter").unwrap().1, Scan(0x1C, false));
        assert_eq!(key_named("NumpadEnter").unwrap().1, Scan(0x1C, true));
        assert_eq!(key_named("ArrowLeft").unwrap().1, Scan(0x4B, true));
        assert_eq!(key_named("Numpad4").unwrap().1, Scan(0x4B, false));
        assert_eq!(key_named("F5").unwrap().1, Scan(0x3F, false));
        assert_eq!(key_named("ControlRight").unwrap().1, Scan(0x1D, true));
        assert_eq!(key_named("Pause").unwrap().1, Virtual(0x13));
        assert_eq!(key_named("NoSuchKey"), None);
        // No name twice, and no two keys that Windows could not tell apart.
        for (i, (name, key)) in KEYS.iter().enumerate() {
            for (other, other_key) in &KEYS[i + 1..] {
                assert_ne!(name, other);
                assert_ne!(key, other_key, "{name} and {other}");
            }
        }
    }

    #[test]
    fn one_holder_and_everything_let_go() {
        let mut c = dry();
        let now = Instant::now();
        // Nothing from a viewer that has not taken control does anything.
        assert_eq!(c.message(1, Lane::Keys, &key(1, "KeyA"), now, false), None);
        assert_eq!(c.logged, 0);
        assert_eq!(c.message(1, Lane::Keys, &[TAKE], now, false), Some(said::YOURS));
        assert_eq!(c.message(2, Lane::Keys, &[TAKE], now, false), Some(said::ANOTHER_DEVICE));
        assert_eq!(c.standing(Some(1)), "yours");
        assert_eq!(c.standing(Some(2)), "another device");
        c.message(1, Lane::Keys, &key(1, "ShiftLeft"), now, false);
        c.message(1, Lane::Keys, &key(1, "KeyA"), now, false);
        c.message(1, Lane::Keys, &key(1, "KeyA"), now, false); // a repeat
        c.message(1, Lane::Keys, &key(1, "Wibble"), now, false);
        c.message(1, Lane::Keys, &[BUTTON, 0, 1, 0, 0, 0, 0, 0], now, false);
        assert_eq!(c.unknown_keys, 1);
        assert_eq!(c.message(1, Lane::Keys, &[RELEASE], now, false), Some(said::ENDED_RELEASED));
        assert_eq!(c.standing(Some(1)), "free");
        let log = c.log_json();
        // Let go in the order: last key pressed first, then the button.
        let a_up = log.find("\"code\": \"KeyA\", \"scan\": 30, \"extended\": false, \"virtualKey\": 0, \"down\": false").expect("A up");
        let shift_up = log.find("\"code\": \"ShiftLeft\", \"scan\": 42, \"extended\": false, \"virtualKey\": 0, \"down\": false").expect("Shift up");
        let button_up = log.find("\"button\": \"left\", \"down\": false").expect("button up");
        assert!(a_up < shift_up && shift_up < button_up);
        assert_eq!(c.message(2, Lane::Keys, &[TAKE], now, false), Some(said::YOURS));
    }

    #[test]
    fn places_on_the_picture_are_places_on_the_screen() {
        let mut c = dry();
        let now = Instant::now();
        c.message(1, Lane::Keys, &[TAKE], now, false);
        assert_eq!(c.place(0, 0), (440, 0));
        assert_eq!(c.place(65535, 65535), (440 + 2559, 1439));
        assert_eq!(c.place(32768, 32768), (440 + 1280, 720));
        c.sending(Region { x: 0, y: 0, width: 3440, height: 1440 }, (3440, 1440));
        assert_eq!(c.place(32768, 0), (1720, 0));
        c.message(1, Lane::Pointer, &[POINTER_BY, 0xFE, 0xFF, 0x03, 0x00], now, false);
        assert!(c.log_json().contains("\"what\": \"move\", \"dx\": -2, \"dy\": 3"));
    }

    fn pad(number: u16, buttons: u16, lt: u8, rt: u8, sticks: [i16; 4]) -> Vec<u8> {
        let mut m = vec![PAD_STATE];
        m.extend_from_slice(&number.to_le_bytes());
        m.extend_from_slice(&buttons.to_le_bytes());
        m.push(lt);
        m.push(rt);
        for stick in sticks {
            m.extend_from_slice(&stick.to_le_bytes());
        }
        m
    }

    #[test]
    fn the_pretend_controller_follows_control() {
        let now = Instant::now();
        let mut c = dry();
        // Nothing from a viewer that does not hold control.
        c.message(1, Lane::Keys, &[PAD, 1], now, false);
        c.message(1, Lane::Pointer, &pad(1, 0x1000, 0, 0, [0; 4]), now, false);
        assert_eq!(c.logged, 0);
        assert!(!c.pad_report().plugged);
        c.message(1, Lane::Keys, &[TAKE], now, false);
        // A state before the controller is plugged in is ignored too.
        c.message(1, Lane::Pointer, &pad(1, 0x1000, 0, 0, [0; 4]), now, false);
        assert!(!c.log_json().contains("\"what\": \"pad\""));
        assert_eq!(c.pad_news(), Some((1, pad_said::NOT_PLUGGED_IN)));
        c.message(1, Lane::Keys, &[PAD, 1], now, false);
        assert!(c.pad_report().plugged);
        assert_eq!(c.pad_news(), Some((1, pad_said::PLUGGED_IN)));
        assert_eq!(c.pad_news(), None);
        // A and RB, the right trigger half-way, the left stick up and to the left.
        c.message(1, Lane::Pointer, &pad(5, 0x1200, 0, 128, [-32768, 32767, 0, 0]), now, false);
        assert!(c.log_json().contains("\"what\": \"pad\", \"buttons\": 4608, \"pressed\": \"RB A\", \"leftTrigger\": 0, \"rightTrigger\": 128, \"leftX\": -32768, \"leftY\": 32767, \"rightX\": 0, \"rightY\": 0"));
        let before = c.logged;
        // The same state again (the once-a-second repeat), and an older state arriving late: neither does anything.
        c.message(1, Lane::Pointer, &pad(6, 0x1200, 0, 128, [-32768, 32767, 0, 0]), now, false);
        c.message(1, Lane::Pointer, &pad(4, 0x8000, 0, 0, [0; 4]), now, false);
        assert_eq!(c.logged, before);
        // Numbers wrap round.
        let mut wrapped = dry();
        wrapped.message(1, Lane::Keys, &[TAKE], now, false);
        wrapped.message(1, Lane::Keys, &[PAD, 1], now, false);
        wrapped.message(1, Lane::Pointer, &pad(65535, 0x1000, 0, 0, [0; 4]), now, false);
        wrapped.message(1, Lane::Pointer, &pad(0, 0x2000, 0, 0, [0; 4]), now, false);
        assert!(wrapped.log_json().contains("\"pressed\": \"B\""));
        // However control ends: a neutral state, then unplugged, then "ended".
        c.message(1, Lane::Keys, &[RELEASE], now, false);
        let log = c.log_json();
        let neutral = log.rfind("\"what\": \"pad\", \"buttons\": 0, \"pressed\": \"\", \"leftTrigger\": 0, \"rightTrigger\": 0, \"leftX\": 0, \"leftY\": 0").expect("neutral");
        let unplugged = log.find("\"event\": \"unplugged\"").expect("unplugged");
        let ended = log.find("\"what\": \"ended\"").expect("ended");
        assert!(neutral < unplugged && unplugged < ended);
        assert!(!c.pad_report().plugged);
        // The controller going away on the viewer's device unplugs it while control carries on.
        let mut gone = dry();
        gone.message(3, Lane::Keys, &[TAKE], now, false);
        gone.message(3, Lane::Keys, &[PAD, 1], now, false);
        gone.message(3, Lane::Keys, &[PAD, 0], now, false);
        assert!(gone.log_json().contains("\"event\": \"unplugged\""));
        assert_eq!(gone.holder(), Some(3));
        // A match starting, silence and a closed connection all unplug it.
        for (later, match_running, alive) in [(4, false, true), (0, true, true), (0, false, false)] {
            let mut c = dry();
            c.message(7, Lane::Keys, &[TAKE], now, false);
            c.message(7, Lane::Keys, &[PAD, 1], now, false);
            c.message(7, Lane::Pointer, &pad(1, 0x4000, 255, 0, [0; 4]), now, false);
            assert!(c.watch(now + Duration::from_secs(later), match_running, |_| alive).is_some());
            let log = c.log_json();
            assert!(log.contains("\"pressed\": \"X\"") && log.contains("\"event\": \"unplugged\""), "{log}");
            assert!(!c.pad_report().plugged);
        }
        // During a match nothing is plugged in, because nobody is given control.
        let mut c = dry();
        c.message(1, Lane::Keys, &[TAKE], now, true);
        c.message(1, Lane::Keys, &[PAD, 1], now, true);
        assert!(!c.log_json().contains("plugged in"));
    }

    #[test]
    fn silence_a_match_and_a_closed_connection_end_it() {
        let now = Instant::now();
        for (later, match_running, alive, says) in [(4, false, true, said::ENDED_SILENT), (0, true, true, said::ENDED_LEAGUE_MATCH), (0, false, false, said::ENDED_RELEASED)] {
            let mut c = dry();
            c.message(7, Lane::Keys, &[TAKE], now, false);
            c.message(7, Lane::Keys, &key(1, "KeyW"), now, false);
            assert_eq!(c.watch(now + Duration::from_secs(1), false, |_| true), None);
            assert_eq!(c.watch(now + Duration::from_secs(later), match_running, |_| alive), Some((7, says)));
            assert!(c.log_json().contains("\"code\": \"KeyW\", \"scan\": 17, \"extended\": false, \"virtualKey\": 0, \"down\": false"));
            assert_eq!(c.holder(), None);
        }
        // During a match nobody is given control at all.
        let mut c = dry();
        assert_eq!(c.message(1, Lane::Keys, &[TAKE], now, true), Some(said::LEAGUE_MATCH));
        assert_eq!(c.holder(), None);
        // And without --allow-control nothing is.
        let mut off = Control::new(false, true, Region::default(), (1920, 1080));
        assert_eq!(off.message(1, Lane::Keys, &[TAKE], now, false), Some(said::NOT_ALLOWED));
        assert_eq!(off.standing(Some(1)), "off");
    }
}
