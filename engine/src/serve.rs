//! `serve`: the live screen, encoded on the graphics card, sent to a web browser over WebRTC (SPEC-screens.md).
//!
//! Three threads share the work:
//! - this one grabs and encodes (the native session must stay on the thread that opened it) and hands each
//!   finished frame straight to the network itself, so a frame never waits for another thread to wake up;
//! - one listens on the UDP socket for what viewers send back (the handshake, "I lost a packet", "send a full
//!   picture") and keeps each connection's clock running;
//! - one answers the web requests: the viewer page, the "hello" (the browser's offer in, our answer out), and the
//!   stream's settings (read, and asked for).
//!
//! A fourth, tiny one looks once a second for a League match on the PC, which caps what the stream may cost.
//! A fifth carries SOUND (sound.rs): it does nothing at all until a viewer asks for the PC's sound, and stops
//! again when the last one that asked has gone.
//!
//! FIT (fit.rs) is the one thing here that changes the PC itself: with `--allow-fit`, while a viewer wants it,
//! the PC's own screen is put into a mode of the viewer's shape. This thread carries that out too, between
//! closing the screen share and opening it again on the screen as it then is.
//!
//! Besides the picture, three smaller things travel on the same connection: CONTROL (control.rs: a viewer's mouse,
//! keys and game controller), the PC's own pointer shape (pointer.rs), and the sound.
//!
//! Settings (settings.rs) can change while the stream runs. This thread works out what should be sent from what
//! was asked and what the PC allows; when that differs from what is being sent, it closes the native session and
//! opens it again with the new piece of screen, size, rate and bitrate. The WebRTC connections stay up: viewers
//! just get a full picture in the new size.
//!
//! WebRTC is the `str0m` crate, which does no networking or timing of its own: it is told the time and handed
//! packets, and it says what to send. Its one rule is kept everywhere here: after anything is done to a
//! connection, everything it wants to send is drained before the next thing is done to it (`pump`).
//!
//! Not done yet, on purpose: nothing watches the line and adjusts the bitrate to it; it is whatever was asked for.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::format::Codec;
use str0m::media::{Frequency, MediaKind, MediaTime, Mid, Pt, Writer};
use str0m::net::{Protocol, Receive};
use str0m::rtp::Extension;
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

use crate::control::{self, Control, Lane};
use crate::fit::Fit;
use crate::native;
use crate::pointer;
use crate::settings::{self, Asked, Limits, Plan, Shape};
use crate::sound;
use crate::{json, line, stats};

pub const USAGE: &str = "[--shape native] [--lines 1080] [--fps 60] [--bitrate 20000] [--max-lines N] [--max-fps N] [--max-bitrate 50000] [--width W --height H] [--allow-control [--control-dry-run]] [--allow-fit] [--no-sound] [--preset 1] [--tweaks 125] [--intra-refresh] [--port 8478] [--udp-port 0] [--lan] [--internet [--router-port]] [--trust-host name]... [--listen 127.0.0.1] [--token text] [--seconds N]";

const VIEWER_PAGE: &str = include_str!("../web/viewer.html");

/// More than this many browsers at once are refused: every one costs the PC's upload a full copy.
const MAX_VIEWERS: usize = 4;
/// A "hello" that no browser follows up with a connection is dropped after this long.
const HELLO_PATIENCE: Duration = Duration::from_secs(15);
/// A viewer that has sent nothing back for this long is treated as not watching: nothing is sent to it, and with
/// nobody else watching the encoder rests. A watching browser reports back several times a second. The viewer is
/// kept, and picks up again from a full picture if it speaks; str0m itself lets it go after about 15 s of silence.
const QUIET_AFTER: Duration = Duration::from_secs(3);
/// A browser that keeps asking for a full picture gets at most one per this long.
const KEYFRAME_SPACING: Duration = Duration::from_millis(250);

/// Set by Ctrl+C (and by closing the console window): the loops see it and stop tidily.
static STOP: AtomicBool = AtomicBool::new(false);
/// Set when `serve` has finished stopping (and has let go of any keys a viewer was holding down).
static STOPPED: AtomicBool = AtomicBool::new(false);

extern "system" {
    fn SetConsoleCtrlHandler(handler: Option<unsafe extern "system" fn(u32) -> i32>, add: i32) -> i32;
}

unsafe extern "system" fn on_console_event(kind: u32) -> i32 {
    STOP.store(true, Ordering::SeqCst);
    // Ctrl+C (0) and Ctrl+Break (1) let the program finish in its own time. Closing the console window, logging
    // off and shutting down do not: Windows ends the program the moment this returns. So for those it waits here
    // (a few seconds at most) until the stopping is done, which is what lets go of any keys a viewer holds.
    if kind > 1 {
        let began = Instant::now();
        while !STOPPED.load(Ordering::SeqCst) && began.elapsed() < Duration::from_secs(4) {
            thread::sleep(Duration::from_millis(10));
        }
    }
    1
}

struct Args {
    /// `--width`/`--height`: start as a piece of this size cut from the middle and sent as it is (0 = not given).
    /// The measuring runs use it; without it the stream starts as `--shape` and `--lines` say.
    width: i32,
    height: i32,
    shape: Shape,
    lines: i32,
    fps: i32,
    bitrate: i32,
    /// The most a viewer can ask this PC for. None = the screen's own height and refresh rate.
    max_lines: Option<i32>,
    max_fps: Option<i32>,
    max_bitrate: i32,
    preset: i32,
    tweaks: i32,
    intra: bool,
    /// `--allow-control`: a viewer may take this PC's mouse and keys. Never without it.
    allow_control: bool,
    /// `--control-dry-run`, for bench/control-check.cjs only: what a viewer does is written to a record that
    /// `GET /control-log` shows, and NOTHING is put into Windows.
    control_dry_run: bool,
    /// `--allow-fit`: a viewer may have this PC's own screen changed to its screen's shape for as long as it is
    /// connected (fit.rs). Never without it.
    allow_fit: bool,
    /// `--no-sound`: the PC's sound is never sent, whoever asks.
    no_sound: bool,
    port: u16,
    udp_port: u16,
    /// `--lan`: the VIDEO may also travel to devices on the home network (the web address stays as `--listen`
    /// says, on this PC only by default).
    lan: bool,
    /// `--internet`: also reachable from outside the home: the video socket's outside address is learnt from a public
    /// STUN server (stun.rs) and offered to browsers, and the engine sends connection checks of its own (full ICE)
    /// so both sides open the way through their routers. Implies `--lan`.
    internet: bool,
    /// `--router-port`: the home router is asked, by the engine itself, to send the video port from outside to this
    /// PC (portmap.rs), so a viewer on a hard network (a phone hotspot) gets through. Only with `--internet`.
    router_port: bool,
    /// `--trust-host`: names besides this PC's own that a request may be addressed to, when it arrives from this
    /// PC itself (the website's own server passing a visitor's request on).
    trust_hosts: Vec<String>,
    listen: IpAddr,
    token: Option<String>,
    seconds: Option<u64>,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args {
        width: 0,
        height: 0,
        // Before any viewer asks: the whole of the PC's screen, made no taller than `lines`.
        shape: Shape::Native,
        lines: 1080,
        fps: 60,
        bitrate: 20000,
        max_lines: None,
        max_fps: None,
        max_bitrate: 50000,
        preset: 1,
        tweaks: native::DEFAULT_TWEAKS,
        intra: false,
        allow_control: false,
        control_dry_run: false,
        allow_fit: false,
        no_sound: false,
        port: 8478,
        udp_port: 0,
        lan: false,
        internet: false,
        router_port: false,
        trust_hosts: Vec::new(),
        listen: IpAddr::V4(Ipv4Addr::LOCALHOST),
        token: None,
        seconds: None,
    };
    let mut i = 0;
    while i < args.len() {
        let key = args[i].as_str();
        let mut value = || -> Result<String, String> {
            i += 1;
            args.get(i).cloned().ok_or_else(|| format!("{key} needs a value"))
        };
        match key {
            "--width" => a.width = value()?.parse().map_err(|_| "--width is a number")?,
            "--height" => a.height = value()?.parse().map_err(|_| "--height is a number")?,
            "--shape" => {
                let name = value()?;
                a.shape = Shape::parse(&name).filter(|shape| *shape != Shape::Match).ok_or("--shape is one of native, 16:9, 16:10, 21:9, 4:3 (a viewer asks for \"match\" itself, with its own screen's size)")?;
            }
            "--lines" => {
                let text = value()?;
                a.lines = if text == "native" { 0 } else { text.parse().ok().filter(|n| settings::LINES_CHOICES.contains(n)).ok_or("--lines is one of 720, 1080, 1440, native")? };
            }
            "--fps" => a.fps = value()?.parse().map_err(|_| "--fps is a number")?,
            "--bitrate" => a.bitrate = value()?.parse().map_err(|_| "--bitrate is a number (kbit/s)")?,
            "--max-lines" => a.max_lines = Some(value()?.parse().ok().filter(|n| *n >= 360).ok_or("--max-lines is a number, 360 or more")?),
            "--max-fps" => a.max_fps = Some(value()?.parse().ok().filter(|n| *n >= 1).ok_or("--max-fps is a number, 1 or more")?),
            "--max-bitrate" => a.max_bitrate = value()?.parse().ok().filter(|n| *n >= 1000).ok_or("--max-bitrate is a number (kbit/s), 1000 or more")?,
            "--preset" => a.preset = value()?.parse().map_err(|_| "--preset is 1 to 7")?,
            "--tweaks" => a.tweaks = value()?.parse().map_err(|_| "--tweaks is a number")?,
            "--port" => a.port = value()?.parse().map_err(|_| "--port is a number from 1 to 65535")?,
            "--udp-port" => a.udp_port = value()?.parse().map_err(|_| "--udp-port is a number from 0 (any) to 65535")?,
            "--lan" => a.lan = true,
            "--internet" => {
                a.internet = true;
                a.lan = true;
            }
            "--router-port" => a.router_port = true,
            "--trust-host" => {
                let name = value()?.to_ascii_lowercase();
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
                    return Err("--trust-host takes a plain host name, such as debaser.site".into());
                }
                a.trust_hosts.push(name);
            }
            "--listen" => a.listen = value()?.parse().map_err(|_| "--listen is an IPv4 address, such as 127.0.0.1 or 0.0.0.0")?,
            "--token" => a.token = Some(value()?),
            "--seconds" => a.seconds = Some(value()?.parse().map_err(|_| "--seconds is a number")?),
            "--intra-refresh" => a.intra = true,
            "--allow-control" => a.allow_control = true,
            "--control-dry-run" => a.control_dry_run = true,
            "--allow-fit" => a.allow_fit = true,
            "--no-sound" => a.no_sound = true,
            other => return Err(format!("unknown option {other}")),
        }
        i += 1;
    }
    if a.fps < 1 || a.fps > 240 {
        return Err("--fps must be between 1 and 240".into());
    }
    if (a.width > 0) != (a.height > 0) || a.width < 0 || a.height < 0 {
        return Err("--width and --height go together (a piece of that size cut from the middle of the screen)".into());
    }
    if a.control_dry_run && !a.allow_control {
        return Err("--control-dry-run goes with --allow-control (it records what control would do instead of doing it)".into());
    }
    if a.router_port && !a.internet {
        return Err("--router-port goes with --internet (the port is only asked for once the outside world has said what this PC's address is)".into());
    }
    if a.port == 0 {
        return Err("--port must be between 1 and 65535".into());
    }
    if !a.listen.is_ipv4() {
        return Err("--listen takes an IPv4 address (IPv6 is not handled yet)".into());
    }
    if let Some(token) = &a.token {
        // The token travels in the page's address, so it is kept to characters that need no escaping there.
        let plain = token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if token.len() < 8 || !plain {
            return Err("--token must be at least 8 characters, letters, digits, - and _ only".into());
        }
    }
    // This is a stream of the whole desktop. Beyond this PC itself it is never served without a password.
    if !a.listen.is_loopback() && a.token.is_none() {
        return Err(format!("--listen {} would show this screen to other devices: it is only allowed together with --token <text>", a.listen));
    }
    Ok(a)
}

/// What is really being sent, as the native session reported it when it opened.
#[derive(Clone, Copy)]
struct Sending {
    region: native::Region,
    width: i32,
    height: i32,
    scaled: bool,
    fps: i32,
    bitrate_kbps: i32,
}

/// What the last full second of sending measured.
#[derive(Clone, Copy)]
struct Measured {
    frames_per_second: f64,
    new_frames_per_second: f64,
    kbit_per_second: f64,
    /// The middle time from Windows showing a frame to its being encoded; None when the screen was still.
    shown_to_encoded_ms: Option<f64>,
}

/// The stream's settings and state, shared between the web requests and the thread that encodes.
struct Stream {
    asked: Asked,
    /// How many requests have been taken in, and how many of them the encoding thread has acted on.
    asks: u64,
    acted_on: u64,
    /// The PC's own limits (`--max-lines`, `--max-fps`, `--max-bitrate`).
    host_limits: Limits,
    /// A League match is running on the PC (or the check is pretending one is): the match cap is in force.
    capped: bool,
    /// The cap state the encoding thread last acted on. While it differs from `capped`, a change is on its way.
    acted_capped: bool,
    /// The screen: width, height, refresh rate.
    screen: (i32, i32, i32),
    sending: Option<Sending>,
    /// Why the last change could not be made, when the encoder would not take it.
    refused: Option<String>,
    measured: Option<Measured>,
}

impl Stream {
    /// The limits in force now.
    fn limits(&self) -> Limits {
        if self.capped { self.host_limits.within(settings::MATCH_CAP) } else { self.host_limits }
    }

    fn plan(&self) -> Plan {
        settings::plan(&self.asked, &self.limits(), self.screen.0, self.screen.1)
    }
}

/// One browser watching.
struct Viewer {
    id: u64,
    rtc: Rtc,
    /// The video line agreed in the "hello" (its label in the session description).
    mid: Option<Mid>,
    /// The payload number agreed for H.264, picked at the first frame.
    pt: Option<Pt>,
    /// The handshake is finished: frames can go out.
    connected: bool,
    /// It has been sent a full picture, so the frames after it make sense to it.
    started: bool,
    since: Instant,
    /// When anything last arrived from its browser.
    last_heard: Instant,
    /// Where its packets last came from: when that is one of this PC's own addresses, the viewer is on this PC itself
    /// (said in the settings as `thisMachine`, since a browser hides its own address from its page).
    last_source: Option<SocketAddr>,
    /// When str0m next wants to be told the time.
    next_timeout: Instant,
    /// The two channels control travels on (control.rs), once the page has opened them.
    keys: Option<ChannelId>,
    pointer: Option<ChannelId>,
    /// SOUND: the sound line agreed in the "hello" (when the page offered one), the payload number agreed for
    /// Opus, and whether this viewer has asked for the PC's sound.
    audio_mid: Option<Mid>,
    audio_pt: Option<Pt>,
    wants_sound: bool,
    /// FIT: this viewer wants the PC's own screen changed to its screen's shape; its screen's width and height.
    wants_fit: Option<(i32, i32)>,
    /// The PC's pointer: the number of the last shape this viewer was sent, and whether it was last told the
    /// pointer is showing.
    shape_told: u16,
    shown_told: Option<bool>,
}

/// How SOUND stands, for `/settings` and the console.
#[derive(Default)]
struct SoundState {
    /// Viewers that have asked for sound and are watching.
    listeners: usize,
    /// The copy of the PC's sound is open and being encoded.
    capturing: bool,
    /// What the last second held: Some(true) sound, Some(false) silence, None nothing listened to yet.
    heard: Option<bool>,
    packets_sent: u64,
    /// Why the PC's sound could not be opened, when it could not.
    problem: Option<String>,
}

/// Where this PC's own addresses come from: Windows' list (`native::local_ipv4`), or a test's pretend one.
type OwnAddresses = Box<dyn Fn() -> Vec<Ipv4Addr> + Send + Sync>;

/// The addresses browsers are told to send video to, and what has been worked out from them. They are NOT settled
/// once at start: the gaming PC's engine starts at sign-in, which can be before its Wi-Fi has an address, and a
/// network can drop, come back or change its address later. So they are read again at every viewer's hello.
struct Reach {
    /// All on the one socket (`video_addresses`).
    offered: Vec<SocketAddr>,
    /// For a socket on every address: which of ours a sender's packets arrive at, remembered per sender.
    routes: HashMap<IpAddr, IpAddr>,
}

struct Shared {
    viewers: Mutex<Vec<Viewer>>,
    socket: UdpSocket,
    /// The video socket's port, and `--lan`: with `listen`, what the offered addresses are worked out from.
    udp_port: u16,
    lan: bool,
    own_addresses: OwnAddresses,
    /// Locked after `viewers` when both are, and never for long.
    reach: Mutex<Reach>,
    /// `--internet`: on, and what STUN has said (stun.rs). Locked on its own, never for long.
    internet: bool,
    stun: Mutex<crate::stun::Stun>,
    /// `--router-port`: how the port asked of the home router stands (portmap.rs). None when the engine was not
    /// told to ask: then the router is never spoken to at all.
    port: Option<Arc<crate::portmap::Port>>,
    /// A viewer needs a full picture: the next frame is forced to be one.
    want_keyframe: AtomicBool,
    keyframe_requests: AtomicU64,
    viewers_ever: AtomicU64,
    token: Option<String>,
    listen: IpAddr,
    trust_hosts: Vec<String>,
    stream: Mutex<Stream>,
    /// CONTROL (control.rs). When both are wanted, `viewers` is locked before this, never the other way round.
    control: Mutex<Control>,
    /// A League match is running on the PC (or the check pretends one is): kept here as well as in `stream` so
    /// the control path can read it without waiting for anything.
    match_running: AtomicBool,
    /// The PC's own pointer, as viewers are to be told of it (pointer.rs). Locked last, and never for long.
    pointer: Mutex<pointer::News>,
    /// For bench/pointer-check.cjs only: the file whose one word names a pretended pointer (pointer.rs).
    pretend_pointer: Option<std::path::PathBuf>,
    /// SOUND: false with `--no-sound`. And how it stands.
    sound_allowed: bool,
    sound: Mutex<SoundState>,
    /// For bench/sound-check.cjs only (`DEBASER_PRETEND_TONE=1`): a steady tone is sent in place of the PC's sound.
    pretend_tone: bool,
    /// FIT (fit.rs): the PC's own screen and whether it has been changed for a viewer. Never held while another
    /// of these locks is asked for.
    fit: Mutex<Fit>,
}

impl Shared {
    /// The addresses as they were last read.
    fn offered(&self) -> Vec<SocketAddr> {
        self.reach.lock().unwrap().offered.clone()
    }

    /// The addresses as they are now, asked of the PC afresh. When they differ from the last reading that is said
    /// on the console, and what was worked out from the old ones is forgotten.
    fn read_offered(&self) -> Vec<SocketAddr> {
        let now = video_addresses(self.listen, self.lan, &(self.own_addresses)(), self.udp_port);
        let mut reach = self.reach.lock().unwrap();
        if reach.offered != now {
            println!("  video leaves from {} (this PC's addresses have changed)", spoken(&now));
            reach.offered.clone_from(&now);
            reach.routes.clear();
        }
        now
    }

    /// Which of our addresses a packet from `source` arrived at. With one address there is no question. With the
    /// socket on every address, Windows does not say, so it is worked out: this PC itself reaches us on 127.0.0.1,
    /// and anyone else on the address Windows would use to send back to them.
    fn arrived_at(&self, source: SocketAddr) -> SocketAddr {
        let mut reach = self.reach.lock().unwrap();
        let Reach { offered, routes } = &mut *reach;
        if offered.len() == 1 {
            return offered[0];
        }
        let port = self.udp_port;
        if source.ip().is_loopback() {
            return SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        }
        let ours = *routes.entry(source.ip()).or_insert_with(|| {
            // "Connecting" a UDP socket sends nothing: it only makes Windows choose the address it would send from.
            let found = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).and_then(|probe| {
                probe.connect(source)?;
                probe.local_addr()
            });
            match found {
                Ok(local) if offered.iter().any(|c| c.ip() == local.ip()) => local.ip(),
                _ => offered.iter().map(|c| c.ip()).find(|ip| !ip.is_loopback()).unwrap_or(offered[0].ip()),
            }
        });
        SocketAddr::new(ours, port)
    }
}

impl Viewer {
    /// Connected, and heard from lately: frames go to it.
    fn watching(&self, now: Instant) -> bool {
        self.connected && self.rtc.is_alive() && now.saturating_duration_since(self.last_heard) < QUIET_AFTER
    }
}

/// Says something about control to a viewer, on its keys channel.
fn say(v: &mut Viewer, what: u8) {
    say_as(v, control::STATE, what);
}

/// Says one of the PC's two-byte messages to a viewer, on its keys channel (control.rs lists them).
fn say_as(v: &mut Viewer, kind: u8, what: u8) {
    if let Some(id) = v.keys {
        if let Some(mut channel) = v.rtc.channel(id) {
            let _ = channel.write(true, &[kind, what]);
        }
    }
}

/// The first byte of the page's "I want the PC's sound" / "I do not" (control.rs lists it with the rest), and
/// of the PC's answer.
const SOUND_ASKED: u8 = 0x30;
const SOUND_SAYS: u8 = 0x84;

/// Sends a viewer whatever it has not yet been told about the PC's pointer: the newest shape, and whether the
/// pointer is showing. Returns whether anything was written (the caller then runs the connection forward).
fn tell_pointer(v: &mut Viewer, news: &pointer::News) -> bool {
    let Some(id) = v.keys else { return false };
    let Some(mut channel) = v.rtc.channel(id) else { return false };
    let mut wrote = false;
    if let Some(message) = &news.message {
        // A write that is not taken (the channel is still opening, or is full) is simply tried again next time.
        if v.shape_told != news.number && matches!(channel.write(true, message), Ok(true)) {
            v.shape_told = news.number;
            wrote = true;
        }
    }
    if let Some(shown) = news.shown {
        if v.shown_told != Some(shown) && matches!(channel.write(true, &pointer::shown_message(shown)), Ok(true)) {
            v.shown_told = Some(shown);
            wrote = true;
        }
    }
    wrote
}

/// Tells every viewer that is behind about the PC's pointer, now.
fn tell_everyone_pointer(shared: &Shared) {
    let mut viewers = shared.viewers.lock().unwrap();
    let news = shared.pointer.lock().unwrap();
    let now = Instant::now();
    for v in viewers.iter_mut() {
        if v.rtc.is_alive() && tell_pointer(v, &news) {
            pump(v, shared, now);
        }
    }
}

fn on_event(v: &mut Viewer, shared: &Shared, event: Event) {
    match event {
        // The page opens two channels for control and names them (control.rs has the messages).
        Event::ChannelOpen(id, label) => match label.as_str() {
            "keys" => v.keys = Some(id),
            "pointer" => v.pointer = Some(id),
            _ => {}
        },
        Event::ChannelData(data) => {
            let lane = if Some(data.id) == v.keys {
                Lane::Keys
            } else if Some(data.id) == v.pointer {
                Lane::Pointer
            } else {
                return;
            };
            // SOUND on or off is not about control: any viewer may listen, whoever holds control.
            if lane == Lane::Keys && data.data.first() == Some(&SOUND_ASKED) {
                let wanted = data.data.get(1) == Some(&1);
                v.wants_sound = wanted && shared.sound_allowed && v.audio_mid.is_some();
                say_as(v, SOUND_SAYS, if !wanted { 0 } else if v.wants_sound { 1 } else { 2 });
                println!("  viewer {} {}", v.id, if v.wants_sound { "asked for the PC's sound" } else if wanted { "asked for sound, which this PC is not sending" } else { "turned the sound off" });
                return;
            }
            // Acted on here and now, on whichever thread the packet arrived: an input never waits for a frame.
            let answer = shared.control.lock().unwrap().message(v.id, lane, &data.data, Instant::now(), shared.match_running.load(Ordering::SeqCst));
            if let Some(what) = answer {
                say(v, what);
            }
        }
        Event::ChannelClose(id) => {
            // A holder whose keys channel has gone is noticed by the network thread's watch, a moment later.
            if v.keys == Some(id) {
                v.keys = None;
            }
            if v.pointer == Some(id) {
                v.pointer = None;
            }
        }
        Event::Connected => {
            v.connected = true;
            shared.want_keyframe.store(true, Ordering::SeqCst);
            println!("  viewer {} connected {} ms after its hello", v.id, v.since.elapsed().as_millis());
        }
        Event::IceConnectionStateChange(IceConnectionState::Disconnected) => v.rtc.disconnect(),
        Event::MediaAdded(media) => {
            if media.kind == MediaKind::Video && v.mid.is_none() {
                v.mid = Some(media.mid);
            }
            if media.kind == MediaKind::Audio && v.audio_mid.is_none() {
                v.audio_mid = Some(media.mid);
            }
        }
        // The browser lost its place (a packet never came, or it has just joined) and asks for a full picture.
        Event::KeyframeRequest(_) => {
            shared.keyframe_requests.fetch_add(1, Ordering::Relaxed);
            shared.want_keyframe.store(true, Ordering::SeqCst);
        }
        _ => {}
    }
}

/// Runs one connection forward: sends everything it has ready, and tells it the time when it asked to be told.
/// Every change to a connection (a packet in, a frame written) is followed by this, as str0m requires.
fn pump(v: &mut Viewer, shared: &Shared, now: Instant) {
    // A few rounds are enough: telling the time can make more to send, which can ask for the time again.
    for _ in 0..8 {
        loop {
            match v.rtc.poll_output() {
                Ok(Output::Timeout(at)) => {
                    v.next_timeout = at;
                    break;
                }
                Ok(Output::Transmit(packet)) => {
                    // A failed send is a lost packet, which the browser asks for again like any other.
                    let _ = shared.socket.send_to(&packet.contents, packet.destination);
                }
                Ok(Output::Event(event)) => on_event(v, shared, event),
                Err(why) => {
                    eprintln!("  viewer {} dropped: {why}", v.id);
                    v.rtc.disconnect();
                    return;
                }
            }
        }
        if !v.rtc.is_alive() || v.next_timeout > now {
            return;
        }
        if let Err(why) = v.rtc.handle_input(Input::Timeout(now)) {
            eprintln!("  viewer {} dropped: {why}", v.id);
            v.rtc.disconnect();
            return;
        }
    }
}

/// The thread that listens: whatever arrives on the socket goes to the connection it belongs to.
/// --internet: asks the STUN server for the video socket's outside address when it is due: every 20 seconds once
/// known (which also keeps the router's door open), every 2 seconds until then. The name is looked up again when
/// it could not be.
fn ask_stun(shared: &Shared) {
    let mut stun = shared.stun.lock().unwrap();
    let now = Instant::now();
    let every = if stun.outside.is_some() { Duration::from_secs(20) } else { Duration::from_secs(2) };
    if stun.asked_at.is_some_and(|at| now.duration_since(at) < every) {
        return;
    }
    stun.asked_at = Some(now);
    if stun.server.is_none() {
        stun.server = crate::stun::server(crate::stun::DEFAULT_SERVER);
    }
    if let Some(server) = stun.server {
        stun.transaction = crate::stun::new_transaction();
        let _ = shared.socket.send_to(&crate::stun::request(&stun.transaction), server);
    }
}

/// --internet: whether a packet is the STUN server's answer to our question; if so its address is kept.
fn heard_stun(shared: &Shared, packet: &[u8]) -> bool {
    let mut stun = shared.stun.lock().unwrap();
    match crate::stun::mapped_address(packet, &stun.transaction) {
        Some(outside) => {
            if stun.outside != Some(outside) {
                println!("  outside address (STUN): {outside}");
            }
            stun.outside = Some(outside);
            true
        }
        None => false,
    }
}

fn network_loop(shared: Arc<Shared>) {
    let mut buf = vec![0u8; 2000];
    // For bench/pointer-check.cjs only: the pretended pointer's word, looked at ten times a second.
    let mut pretended = String::new();
    let mut pretend_looked = Instant::now();
    while !STOP.load(Ordering::SeqCst) {
        if let Some(file) = &shared.pretend_pointer {
            if pretend_looked.elapsed() >= Duration::from_millis(100) {
                pretend_looked = Instant::now();
                let word = std::fs::read_to_string(file).unwrap_or_default().trim().to_string();
                if word != pretended {
                    if let Some((shape, shown)) = pointer::pretend(&word) {
                        let mut news = shared.pointer.lock().unwrap();
                        if let Some(shape) = shape {
                            news.take_shape(&shape);
                        }
                        news.shown = Some(shown);
                        println!("  the PC's pointer (pretended, for the check): \"{word}\", shape number {}, {}x{}, {}", news.number, news.size.0, news.size.1, if shown { "showing" } else { "hidden" });
                    }
                    pretended = word;
                }
            }
        }
        if shared.internet {
            ask_stun(&shared);
        }
        // Sleep on the socket until a packet comes or a connection wants the time, and never longer than 10 ms
        // (a frame written by the other thread can bring a connection's next deadline forward).
        let mut wait = Duration::from_millis(10);
        {
            let now = Instant::now();
            let viewers = shared.viewers.lock().unwrap();
            for v in viewers.iter() {
                wait = wait.min(v.next_timeout.saturating_duration_since(now));
            }
        }
        let _ = shared.socket.set_read_timeout(Some(wait.max(Duration::from_millis(1))));
        let got = shared.socket.recv_from(&mut buf);
        let now = Instant::now();

        let mut viewers = shared.viewers.lock().unwrap();
        match got {
            Ok((length, source)) if shared.internet && heard_stun(&shared, &buf[..length]) => {
                let _ = source;
            }
            Ok((length, source)) => {
                let destination = shared.arrived_at(source);
                // Anything that is not WebRTC traffic fails to parse here and is ignored.
                if let Ok(contents) = buf[..length].try_into() {
                    let input = Input::Receive(now, Receive { proto: Protocol::Udp, source, destination, contents });
                    if let Some(v) = viewers.iter_mut().find(|v| v.rtc.is_alive() && v.rtc.accepts(&input)) {
                        // A viewer that had gone quiet is back: it needs a full picture to pick up from.
                        if v.connected && !v.watching(now) {
                            println!("  viewer {} is back", v.id);
                            shared.want_keyframe.store(true, Ordering::SeqCst);
                        }
                        v.last_heard = now;
                        v.last_source = Some(source);
                        if let Err(why) = v.rtc.handle_input(input) {
                            eprintln!("  viewer {} dropped: {why}", v.id);
                            v.rtc.disconnect();
                        }
                        pump(v, &shared, now);
                    }
                }
            }
            // The wait ran out (Windows says TimedOut, others WouldBlock). Windows also reports here that an
            // earlier packet reached a closed port (ConnectionReset): a viewer that left, noticed below.
            Err(why) if matches!(why.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::ConnectionReset) => {}
            Err(_) => thread::sleep(Duration::from_millis(1)),
        }

        for v in viewers.iter_mut() {
            if v.rtc.is_alive() && !v.connected && now.duration_since(v.since) > HELLO_PATIENCE {
                v.rtc.disconnect();
            }
            if v.rtc.is_alive() {
                pump(v, &shared, now);
            }
        }
        // CONTROL: has anything happened that ends it (a match starting, the cut-off key on the PC, the holder
        // gone or silent)? Whoever held it is told, and everything they held down has already been let go.
        let (ended, pad_news) = {
            let mut control = shared.control.lock().unwrap();
            let ended = control.watch(now, shared.match_running.load(Ordering::SeqCst), |id| viewers.iter().any(|v| v.id == id && v.rtc.is_alive() && v.keys.is_some()));
            // CONTROLLER: whoever holds control is told when the pretend controller is plugged in, or why not.
            (ended, control.pad_news())
        };
        if let Some((id, what)) = ended {
            if let Some(v) = viewers.iter_mut().find(|v| v.id == id && v.rtc.is_alive()) {
                say(v, what);
                pump(v, &shared, now);
            }
        }
        if let Some((id, what)) = pad_news {
            if let Some(v) = viewers.iter_mut().find(|v| v.id == id && v.rtc.is_alive()) {
                say_as(v, control::PAD_SAYS, what);
                pump(v, &shared, now);
            }
        }
        // The PC's pointer: a viewer whose channel has just opened, or that missed a shape, is brought up to date.
        {
            let news = shared.pointer.lock().unwrap();
            for v in viewers.iter_mut() {
                if v.rtc.is_alive() && tell_pointer(v, &news) {
                    pump(v, &shared, now);
                }
            }
        }
        viewers.retain(|v| {
            if !v.rtc.is_alive() {
                println!("  viewer {} gone", v.id);
            }
            v.rtc.is_alive()
        });
    }
}

/// The profile written in an H.264 stream's own header (66 baseline, 77 main, 100 high), read from a full picture.
fn h264_profile(annex_b: &[u8]) -> Option<u8> {
    let mut i = 0;
    while i + 4 < annex_b.len() {
        if annex_b[i] == 0 && annex_b[i + 1] == 0 && annex_b[i + 2] == 1 {
            // The byte after a start code says what kind of part follows; kind 7 is the header that carries the profile.
            if annex_b[i + 3] & 0x1f == 7 {
                return Some(annex_b[i + 4]);
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    None
}

/// Which agreed payload number to send H.264 under: one that allows frames split across packets
/// (packetization-mode 1), preferring the one whose profile matches what the encoder really makes.
fn choose_pt(writer: &Writer, profile: Option<u8>) -> Option<Pt> {
    let mut fallback = None;
    for params in writer.payload_params() {
        let spec = params.spec();
        if spec.codec != Codec::H264 || spec.format.packetization_mode != Some(1) {
            continue;
        }
        if let (Some(wanted), Some(id)) = (profile, spec.format.profile_level_id) {
            if (id >> 16) as u8 == wanted {
                return Some(params.pt());
            }
        }
        fallback.get_or_insert(params.pt());
    }
    fallback
}

/// Hands one encoded frame to every connected viewer and pushes its packets out of the socket before returning.
/// Returns how many viewers it went to.
fn send_frame(shared: &Shared, data: &Arc<[u8]>, keyframe: bool, profile: Option<u8>, rtp_time: u64, captured: Instant) -> usize {
    let mut viewers = shared.viewers.lock().unwrap();
    let now = Instant::now();
    let mut sent = 0;
    for v in viewers.iter_mut() {
        if !v.watching(now) {
            // Gone quiet (a closed tab, a dropped line): it has missed frames, so it starts again from a full picture.
            if v.connected && v.started {
                println!("  viewer {} has gone quiet: nothing is sent to it until it is heard from", v.id);
                v.started = false;
            }
            continue;
        }
        let Some(mid) = v.mid else { continue };
        // A viewer can only start from a full picture; one was asked for when it connected.
        if !v.started && !keyframe {
            continue;
        }
        let Some(writer) = v.rtc.writer(mid) else { continue };
        let pt = match v.pt.or_else(|| choose_pt(&writer, profile)) {
            Some(pt) => pt,
            None => {
                eprintln!("  viewer {} dropped: its browser did not agree to H.264 in split packets", v.id);
                v.rtc.disconnect();
                continue;
            }
        };
        v.pt = Some(pt);
        // "Show this the moment it is decoded": the playout-delay marker, least and most both zero, on every frame.
        let written = writer.playout_delay(MediaTime::ZERO, MediaTime::ZERO).write(pt, captured, MediaTime::from_90khz(rtp_time), data.clone());
        if let Err(why) = written {
            eprintln!("  viewer {} dropped: {why}", v.id);
            v.rtc.disconnect();
            continue;
        }
        if !v.started {
            println!("  viewer {} starts from a full picture, {} ms after its hello", v.id, v.since.elapsed().as_millis());
        }
        v.started = true;
        sent += 1;
        // str0m cuts the frame into packets when it is next told the time, so `pump` tells it now.
        pump(v, shared, now);
    }
    sent
}

/// Hands one Opus packet (10 ms of sound) to every viewer that asked for sound. Returns how many it went to.
fn send_sound(shared: &Shared, packet: &Arc<[u8]>, samples_before: u64) -> usize {
    let mut viewers = shared.viewers.lock().unwrap();
    let now = Instant::now();
    let mut sent = 0;
    for v in viewers.iter_mut() {
        if !v.wants_sound || !v.watching(now) {
            continue;
        }
        let Some(mid) = v.audio_mid else { continue };
        let Some(writer) = v.rtc.writer(mid) else { continue };
        let pt = match v.audio_pt.or_else(|| writer.payload_params().find(|params| params.spec().codec == Codec::Opus).map(|params| params.pt())) {
            Some(pt) => pt,
            None => {
                // Its browser did not agree to Opus (every browser does): it simply gets no sound.
                v.wants_sound = false;
                continue;
            }
        };
        v.audio_pt = Some(pt);
        // Sound's place in time is counted in samples, 48,000 to the second.
        if writer.write(pt, now, MediaTime::new(samples_before, Frequency::FORTY_EIGHT_KHZ), packet.clone()).is_err() {
            v.wants_sound = false;
            continue;
        }
        sent += 1;
        pump(v, shared, now);
    }
    sent
}

/// Where the sound thread's sound comes from.
enum SoundSource {
    ThePc(sound::Loopback),
    Tone(sound::Tone),
}

/// The thread that carries SOUND. While nobody has asked for it, it only looks, twenty times a second, whether
/// anybody has: the copy of the PC's sound is not open and nothing is encoded. When a viewer asks, the copy is
/// opened and each 10 ms of it is encoded and sent, until the last viewer that asked has gone.
///
/// While the PC is playing something, Windows itself sets the beat: it signals as each 10 ms arrives. When the PC
/// plays nothing, Windows hands over nothing at all, and silence is sent in its place on a 10 ms beat of our own
/// (a few bytes a packet), so that the viewer's browser keeps a steady, short queue and real sound, when it
/// comes back, is played at once.
fn sound_loop(shared: Arc<Shared>) {
    let beat = Duration::from_millis(10);
    let frame = sound::FRAME * 2;
    let mut source: Option<SoundSource> = None;
    let mut encoder: Option<sound::Encoder> = None;
    let mut waiting: Vec<f32> = Vec::new();
    let mut taken = vec![0f32; frame * 20];
    let mut packet = [0u8; 1500];
    // Sound's place in time, counted in samples. It follows the real clock: when nothing is sent for a while
    // (nobody listening, or the moment it takes to notice the PC has gone quiet) the count skips ahead by the time
    // that passed, so the viewer's browser sees a pause as a pause and not as packets arriving late.
    let mut samples_sent = 0u64;
    let mut last_packet: Option<Instant> = None;
    let mut last_arrival = Instant::now();
    // The PC is silent: when the next frame of silence is due.
    let mut quiet_due: Option<Instant> = None;
    let mut tone_due = Instant::now();
    let mut failed_at: Option<Instant> = None;
    let mut second_began = Instant::now();
    let mut second_loudest = 0f32;

    while !STOP.load(Ordering::SeqCst) {
        let listeners = {
            let now = Instant::now();
            shared.viewers.lock().unwrap().iter().filter(|v| v.wants_sound && v.audio_mid.is_some() && v.watching(now)).count()
        };
        shared.sound.lock().unwrap().listeners = listeners;
        if listeners == 0 {
            if source.is_some() {
                source = None;
                encoder = None;
                waiting.clear();
                let mut state = shared.sound.lock().unwrap();
                state.capturing = false;
                state.heard = None;
                println!("  SOUND: nobody is listening now: the copy of the PC's sound is closed");
            }
            thread::sleep(Duration::from_millis(50));
            continue;
        }

        if source.is_none() {
            // After a failure (no playback device, say) it is tried again once a second, not in a tight loop.
            if failed_at.is_some_and(|at| at.elapsed() < Duration::from_secs(1)) {
                thread::sleep(Duration::from_millis(50));
                continue;
            }
            let opened = if shared.pretend_tone { Ok(SoundSource::Tone(sound::Tone::new())) } else { sound::Loopback::open().map(SoundSource::ThePc) };
            match opened.and_then(|opened| sound::Encoder::new().map(|encoder| (opened, encoder))) {
                Ok((opened, made)) => {
                    println!(
                        "  SOUND: {listeners} viewer(s) asked for it: sending {} as Opus, 48 kHz stereo, 10 ms frames, about {} kbit/s",
                        if shared.pretend_tone { "a TEST TONE (pretended, for the check)" } else { "everything this PC is playing" },
                        sound::BITRATE / 1000
                    );
                    source = Some(opened);
                    encoder = Some(made);
                    failed_at = None;
                    let now = Instant::now();
                    if let Some(last) = last_packet {
                        samples_sent += (now.duration_since(last).as_millis() as u64 / 10) * sound::FRAME as u64;
                    }
                    last_arrival = now;
                    quiet_due = None;
                    tone_due = now;
                    second_began = now;
                    second_loudest = 0.0;
                    let mut state = shared.sound.lock().unwrap();
                    state.capturing = true;
                    state.problem = None;
                }
                Err(why) => {
                    let mut state = shared.sound.lock().unwrap();
                    if state.problem.as_deref() != Some(why.as_str()) {
                        println!("  SOUND: could not be sent. {why}");
                    }
                    state.problem = Some(why);
                    failed_at = Some(Instant::now());
                    continue;
                }
            }
        }

        // Gather what there is to send.
        let mut gone: Option<String> = None;
        match source.as_mut().expect("opened above") {
            SoundSource::Tone(tone) => {
                let now = Instant::now();
                if tone_due > now {
                    thread::sleep(tone_due - now);
                }
                tone.frame(&mut waiting);
                tone_due += beat;
                if tone_due + Duration::from_millis(100) < Instant::now() {
                    tone_due = Instant::now();
                }
            }
            SoundSource::ThePc(loopback) => match loopback.read(&mut taken, if quiet_due.is_some() { 0 } else { 15 }) {
                Err(why) => gone = Some(why),
                Ok(0) => {
                    let now = Instant::now();
                    // Nothing for 25 ms: the PC has gone quiet. Silence takes over from now, one frame every 10 ms.
                    // (The few frames' time that passed while finding that out is not sent afterwards: a burst
                    // of packets would only lengthen the queue the viewer's browser keeps.)
                    if quiet_due.is_none() && now.duration_since(last_arrival) >= Duration::from_millis(25) {
                        quiet_due = Some(now);
                        // The frames' time that went by unsent (all but the one about to be sent).
                        samples_sent += (now.duration_since(last_arrival).as_millis() as u64 / 10).saturating_sub(1) * sound::FRAME as u64;
                    }
                    if let Some(mut due) = quiet_due {
                        if due > now {
                            thread::sleep(due - now);
                        }
                        // The frame that is due (two, at most, when this thread was held up a moment; if it was held
                        // up for longer the beat simply starts again from now).
                        let now = Instant::now();
                        let mut owed = 0;
                        while due <= now && owed < 2 {
                            // A part-frame of real sound left over is finished off with silence first.
                            let fill = frame - waiting.len() % frame;
                            waiting.resize(waiting.len() + fill, 0.0);
                            due += beat;
                            owed += 1;
                        }
                        quiet_due = Some(if due <= now { now + beat } else { due });
                    }
                }
                Ok(frames) => {
                    waiting.extend_from_slice(&taken[..frames * 2]);
                    last_arrival = Instant::now();
                    quiet_due = None;
                }
            },
        }
        if let Some(why) = gone {
            // The playback device went away (unplugged, or Windows switched to another): opened again shortly.
            println!("  SOUND: the playback device changed ({why}): opening it again");
            source = None;
            encoder = None;
            waiting.clear();
            failed_at = Some(Instant::now());
            shared.sound.lock().unwrap().capturing = false;
            continue;
        }

        // Encode and send every whole frame.
        let mut packets = 0u64;
        while waiting.len() >= frame {
            second_loudest = second_loudest.max(sound::loudest(&waiting[..frame]));
            match encoder.as_mut().expect("made with the source").encode(&waiting[..frame], &mut packet) {
                Ok(size) => {
                    let data: Arc<[u8]> = Arc::from(&packet[..size]);
                    if send_sound(&shared, &data, samples_sent) > 0 {
                        packets += 1;
                    }
                }
                Err(why) => eprintln!("  SOUND: {why}"),
            }
            samples_sent += sound::FRAME as u64;
            last_packet = Some(Instant::now());
            waiting.drain(..frame);
        }
        let mut state = shared.sound.lock().unwrap();
        state.packets_sent += packets;
        if second_began.elapsed() >= Duration::from_secs(1) {
            // Anything above the faintest whisper counts as sound.
            state.heard = Some(second_loudest > 0.0005);
            second_loudest = 0.0;
            second_began = Instant::now();
        }
    }
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    respond_with(stream, status, content_type, "", body);
}

/// The same, with more header lines (each ending in a line break) of the caller's own.
fn respond_with(stream: &mut TcpStream, status: &str, content_type: &str, more: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n{more}Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn refuse(stream: &mut TcpStream, status: &str, why: &str) {
    respond(stream, status, "text/plain; charset=utf-8", why.as_bytes());
}

/// Compares two texts without stopping at the first difference, so the time taken says nothing about the token.
fn same_text(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut different = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        different |= (a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0)) as usize;
    }
    different == 0
}

/// The browser's offer in, our answer out; the new connection joins the list for the network thread to run.
/// The viewer's number comes back too, so the page can say who it is when it asks about control.
fn hello(shared: &Shared, offer_text: &str) -> Result<(String, u64), (&'static str, String)> {
    let offer = SdpOffer::from_sdp_string(offer_text).map_err(|why| ("400 Bad Request", format!("That is not a WebRTC offer: {why}")))?;
    let now = Instant::now();
    let mut rtc = Rtc::builder()
        // At home we only answer: the browser finds us at the addresses below. With --internet the engine also sends
        // checks of its own (full ICE), which is what opens the way through both routers.
        .set_ice_lite(!shared.internet)
        // H.264 only, since that is what the encoder makes; and Opus for the PC's sound (no doubled-up packets:
        // a lost one is 10 ms of sound, which the browser covers over).
        .clear_codecs()
        .enable_h264(true)
        .enable_opus(true, false)
        // Lets each frame carry "show this at once" (http://www.webrtc.org/experiments/rtp-hdrext/playout-delay).
        .set_extension(5, Extension::PlayoutDelay)
        .set_stats_interval(None)
        .build(now);
    // Read afresh for every hello: this PC's addresses can have changed since the engine started (`Reach`).
    let offered = shared.read_offered();
    for address in &offered {
        let candidate = Candidate::host(*address, "udp").map_err(|why| ("500 Internal Server Error", format!("Bad local address {address}: {why}")))?;
        rtc.add_local_candidate(candidate);
    }
    // --internet: the socket's outside address too, on the home-network address it belongs to.
    if shared.internet {
        let outside = shared.stun.lock().unwrap().outside;
        let base = offered.iter().copied().find(|c| c.is_ipv4() && !c.ip().is_loopback());
        if let (Some(outside), Some(base)) = (outside, base) {
            if let Ok(candidate) = Candidate::server_reflexive(outside, base, "udp") {
                rtc.add_local_candidate(candidate);
            }
        }
        // --router-port: and the port the router has opened for us, when that is another address than the one
        // above (a router may show the socket to the outside under a different port than the one it opened).
        let opened = shared.port.as_ref().and_then(|port| port.outside()).map(SocketAddr::V4);
        if let (Some(opened), Some(base)) = (opened, base) {
            if Some(opened) != outside {
                if let Ok(candidate) = Candidate::server_reflexive(opened, base, "udp") {
                    rtc.add_local_candidate(candidate);
                }
            }
        }
    }
    let answer = rtc.sdp_api().accept_offer(offer).map_err(|why| ("400 Bad Request", format!("The offer could not be accepted: {why}")))?;

    let mut viewers = shared.viewers.lock().unwrap();
    if viewers.len() >= MAX_VIEWERS {
        return Err(("503 Service Unavailable", format!("{MAX_VIEWERS} viewers are already watching")));
    }
    let id = shared.viewers_ever.fetch_add(1, Ordering::Relaxed) + 1;
    viewers.push(Viewer {
        id,
        rtc,
        mid: None,
        pt: None,
        connected: false,
        started: false,
        since: now,
        last_heard: now,
        last_source: None,
        next_timeout: now,
        keys: None,
        pointer: None,
        audio_mid: None,
        audio_pt: None,
        wants_sound: false,
        wants_fit: None,
        shape_told: 0,
        shown_told: None,
    });
    Ok((answer.to_sdp_string(), id))
}

/// One web request: the page, or the "hello". Anything else is refused.
fn handle_request(mut stream: TcpStream, shared: &Shared) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    // Read up to the blank line that ends the headers.
    let mut data = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break at;
        }
        if data.len() > 16 * 1024 {
            return refuse(&mut stream, "431 Request Header Fields Too Large", "Headers too large");
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => data.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&data[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let method = first.next().unwrap_or("");
    let target = first.next().unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    // Which viewer is asking, when the page says (the number its hello was answered with). It only decides
    // whether "control" reads "yours" or "another device": it opens nothing.
    let viewer: Option<u64> = query.split('&').find_map(|pair| pair.strip_prefix("viewer=")).and_then(|number| number.parse().ok());
    let mut content_length = 0usize;
    let mut content_type = String::new();
    let mut host = String::new();
    for header in lines {
        let Some((name, value)) = header.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => content_length = value.parse().unwrap_or(usize::MAX),
            "content-type" => content_type = value.to_ascii_lowercase(),
            "host" => host = value.to_ascii_lowercase(),
            _ => {}
        }
    }

    match &shared.token {
        // With a token set, every request must carry it.
        Some(token) => {
            let given = query.split('&').find_map(|pair| pair.strip_prefix("token=")).unwrap_or("");
            if !same_text(given, token) {
                return refuse(&mut stream, "403 Forbidden", "Missing or wrong token");
            }
        }
        // Without one we are on this PC only. The address the browser thinks it is talking to must then be this
        // PC's own, or another website could point its own name at 127.0.0.1 and read the stream through it.
        None => {
            let from_this_pc = stream.peer_addr().is_ok_and(|peer| peer.ip().is_loopback());
            if !host_is_ours(&host, shared.listen, &shared.trust_hosts, from_this_pc) {
                return refuse(&mut stream, "403 Forbidden", "This page is only served under this PC's own address");
            }
        }
    }

    // The body of a request that has one, when it is no longer than `most`.
    let body_of = |stream: &mut TcpStream, most: usize| -> Option<Vec<u8>> {
        if content_length == 0 || content_length > most {
            refuse(stream, "413 Payload Too Large", &format!("The body must be between 1 byte and {most} bytes"));
            return None;
        }
        let mut body = data[head_end + 4..].to_vec();
        let mut chunk = [0u8; 4096];
        while body.len() < content_length {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => return None,
                Ok(n) => body.extend_from_slice(&chunk[..n]),
            }
        }
        body.truncate(content_length);
        Some(body)
    };

    match (method, path) {
        ("GET", "/") => respond(&mut stream, "200 OK", "text/html; charset=utf-8", VIEWER_PAGE.as_bytes()),
        ("POST", "/offer") => {
            // Asking for this content type makes a browser check with us before another website's page may send
            // an offer at all, and we never say yes to that check.
            if !content_type.starts_with("application/sdp") {
                return refuse(&mut stream, "415 Unsupported Media Type", "Send the offer as application/sdp");
            }
            let Some(body) = body_of(&mut stream, 64 * 1024) else { return };
            match hello(shared, &String::from_utf8_lossy(&body)) {
                Ok((answer, id)) => respond_with(&mut stream, "201 Created", "application/sdp", &format!("Debaser-Viewer: {id}\r\n"), answer.as_bytes()),
                Err((status, why)) => refuse(&mut stream, status, &why),
            }
        }
        ("GET", "/settings") => respond(&mut stream, "200 OK", "application/json", settings_json(shared, viewer).as_bytes()),
        // The dry-run record of what control would have done: only with --allow-control --control-dry-run.
        ("GET", "/control-log") => {
            let control = shared.control.lock().unwrap();
            if !control.allowed || !control.dry_run {
                drop(control);
                return refuse(&mut stream, "403 Forbidden", "The record of control only exists with --allow-control --control-dry-run");
            }
            let body = control.log_json();
            drop(control);
            respond(&mut stream, "200 OK", "application/json", body.as_bytes());
        }
        ("POST", "/settings") => {
            // The same guard as the offer: this content type cannot be sent from another website's page unasked.
            if !content_type.starts_with("application/json") {
                return refuse(&mut stream, "415 Unsupported Media Type", "Send the settings as application/json");
            }
            let Some(body) = body_of(&mut stream, 4 * 1024) else { return };
            let taken = settings::parse_flat(&String::from_utf8_lossy(&body)).and_then(|mut pairs| {
                // "pcScreen" is not one of the stream's settings: it is this one viewer's wish for the PC's own
                // screen (fit.rs). It is taken out and noted against the viewer before the rest is read.
                take_fit_wish(shared, viewer, &mut pairs)?;
                let mut stream_state = shared.stream.lock().unwrap();
                let next = settings::take_request(&stream_state.asked, &pairs)?;
                stream_state.asked = next;
                stream_state.asks += 1;
                Ok(stream_state.asks)
            });
            let mine = match taken {
                Ok(mine) => mine,
                Err(why) => return refuse(&mut stream, "400 Bad Request", &why),
            };
            // The encoding thread makes the change (it owns the encoder). The answer waits for it, so that it
            // says what is really being sent and not what was hoped for. (If it takes too long the answer goes
            // anyway, and says the change has not been made yet.)
            let asked_at = Instant::now();
            while shared.stream.lock().unwrap().acted_on < mine && asked_at.elapsed() < Duration::from_secs(5) && !STOP.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
            respond(&mut stream, "200 OK", "application/json", settings_json(shared, viewer).as_bytes());
        }
        (_, "/") | (_, "/offer") | (_, "/settings") | (_, "/control-log") => refuse(&mut stream, "405 Method Not Allowed", "GET / for the page, POST /offer for the hello, GET or POST /settings, GET /control-log"),
        _ => refuse(&mut stream, "404 Not Found", "Nothing here"),
    }
}

/// Takes "pcScreen" out of a settings request, when it is there, and notes the wish against the viewer that sent
/// it: "fit" (with viewWidth and viewHeight: change the PC's own screen to my screen's shape while I am
/// connected) or "own" (I no longer want that). A PC that does not allow it notes nothing; `/settings` says why.
fn take_fit_wish(shared: &Shared, viewer: Option<u64>, pairs: &mut Vec<(String, settings::Value)>) -> Result<(), String> {
    let Some(at) = pairs.iter().position(|(name, _)| name == "pcScreen") else { return Ok(()) };
    let (_, value) = pairs.remove(at);
    let fit_wanted = match &value {
        settings::Value::Text(text) if text == "fit" => true,
        settings::Value::Text(text) if text == "own" => false,
        _ => return Err("\"pcScreen\" is \"fit\" or \"own\"".into()),
    };
    let side = |name: &str| pairs.iter().find(|(key, _)| key == name).and_then(|(_, value)| match value {
        settings::Value::Number(n) if n.fract() == 0.0 && *n >= 1.0 && *n <= 16384.0 => Some(*n as i32),
        _ => None,
    });
    let wish = if fit_wanted {
        match (side("viewWidth"), side("viewHeight")) {
            (Some(width), Some(height)) => Some((width, height)),
            _ => return Err("\"pcScreen\": \"fit\" needs viewWidth and viewHeight (the viewer's screen in real pixels)".into()),
        }
    } else {
        None
    };
    let Some(id) = viewer else { return Err("\"pcScreen\" needs the viewer's number in the address (?viewer=...), as its hello was answered".into()) };
    let allowed = shared.fit.lock().unwrap().allowed;
    let mut viewers = shared.viewers.lock().unwrap();
    let Some(v) = viewers.iter_mut().find(|v| v.id == id && v.rtc.is_alive()) else { return Err(format!("no viewer {id} is connected")) };
    let before = v.wants_fit;
    v.wants_fit = if allowed { wish } else { None };
    if v.wants_fit != before {
        match v.wants_fit {
            Some((width, height)) => println!("  viewer {id} asked for this PC's screen to be fitted to its own ({width}x{height})"),
            None => println!("  viewer {id} no longer wants this PC's screen fitted to its own"),
        }
    }
    Ok(())
}

/// The stream's settings as the viewer page reads them: what was asked, what is really being sent, what the last
/// second measured, the screen, the limits in force and the PC's own, and whether a cap is on and why.
/// "applied" is false for the moment between a change being due (asked for, or a cap coming on or lifting) and the
/// encoding thread having made it: until then "sending" is still the old picture.
/// "control" is how control stands for the viewer asking: "off" (the PC was not started with --allow-control),
/// "free", "yours" or "another device"; "controlWhy" says why it cannot be taken when it cannot.
/// "controller" is the pretend game controller on the PC: "off" (no control at all), "none" or "plugged in";
/// "controllerWhy" is the PC's reason when one was asked for and could not be plugged in.
/// "sound" is how sound stands: whether this PC sends it at all, how many viewers are listening, whether the PC's
/// sound is being read now, what the last second of it held ("sound" or "silence"), and why not when it failed.
/// "pointer" is the PC's own pointer: whether it is showing, and the number and size of its newest shape.
/// "pcScreen" is FIT (fit.rs): whether this PC allows its own screen to be changed, its own mode and the mode it
/// is in now, whether it is fitted, how many viewers want that and whether the one asking does, and why not.
fn settings_json(shared: &Shared, viewer: Option<u64>) -> String {
    let watching = {
        let now = Instant::now();
        shared.viewers.lock().unwrap().iter().filter(|v| v.watching(now)).count()
    };
    let (control_stands, control_allowed, control_dry_run, pad) = {
        let control = shared.control.lock().unwrap();
        (control.standing(viewer), control.allowed, control.dry_run, control.pad_report())
    };
    let controller_json = format!(
        "\"controller\": \"{}\", \"controllerWhy\": {}",
        if !control_allowed { "off" } else if pad.plugged { "plugged in" } else { "none" },
        pad.why_not.as_deref().map_or("null".to_string(), settings::quoted)
    );
    let sound_json = {
        let state = shared.sound.lock().unwrap();
        format!(
            "\"sound\": {{\"allowed\": {}, \"listeners\": {}, \"capturing\": {}, \"source\": {}, \"heard\": {}, \"packetsSent\": {}, \"problem\": {}}}",
            shared.sound_allowed,
            state.listeners,
            state.capturing,
            settings::quoted(if shared.pretend_tone { "a test tone" } else { "everything the PC is playing" }),
            match state.heard {
                Some(true) => "\"sound\"",
                Some(false) => "\"silence\"",
                None => "null",
            },
            state.packets_sent,
            state.problem.as_deref().map_or("null".to_string(), settings::quoted)
        )
    };
    // Whether the asking viewer is on this PC itself: its packets come from this PC's loopback or one of its own
    // addresses. Null until it has sent any (or when no viewer number was given).
    let this_machine_json = {
        let source = viewer.and_then(|id| shared.viewers.lock().unwrap().iter().find(|v| v.id == id).and_then(|v| v.last_source));
        let offered = shared.offered();
        let ours = |ip: IpAddr| ip.is_loopback() || offered.iter().any(|c| c.ip() == ip);
        format!("\"thisMachine\": {}", source.map_or("null".to_string(), |s| ours(s.ip()).to_string()))
    };
    // --router-port: how the port asked of the home router stands; null when this engine never asks for one.
    let router_port_json = format!("\"routerPort\": {}", shared.port.as_ref().map_or("null".to_string(), |port| port.json()));
    let fit_json = {
        let yours = viewer.is_some_and(|id| shared.viewers.lock().unwrap().iter().any(|v| v.id == id && v.wants_fit.is_some()));
        format!("\"pcScreen\": {}", shared.fit.lock().unwrap().json(yours))
    };
    let pointer_json = {
        let news = shared.pointer.lock().unwrap();
        format!(
            "\"pointer\": {{\"shown\": {}, \"shape\": {}, \"width\": {}, \"height\": {}}}",
            news.shown.map_or("null".to_string(), |shown| shown.to_string()),
            news.number,
            news.size.0,
            news.size.1
        )
    };
    let control_why = if !control_allowed {
        settings::quoted("THIS PC IS NOT ALLOWING CONTROL")
    } else if shared.match_running.load(Ordering::SeqCst) {
        settings::quoted(control::BLOCKED_BY_MATCH)
    } else {
        "null".to_string()
    };
    let stream = shared.stream.lock().unwrap();
    let number_or_null = |n: i32| if n > 0 { n.to_string() } else { "null".to_string() };
    let limits_json = |l: Limits| format!("{{\"maxLines\": {}, \"maxFps\": {}, \"maxBitrateKbps\": {}}}", l.max_lines, l.max_fps, l.max_bitrate_kbps);
    let asked = &stream.asked;
    let asked_json = format!(
        "{{\"shape\": {}, \"viewWidth\": {}, \"viewHeight\": {}, \"lines\": {}, \"fps\": {}, \"viewHz\": {}, \"bitrateKbps\": {}}}",
        settings::quoted(asked.shape.name()),
        number_or_null(asked.view_width),
        number_or_null(asked.view_height),
        if asked.lines > 0 { asked.lines.to_string() } else { "\"native\"".to_string() },
        if asked.fps_auto { "\"auto\"".to_string() } else { asked.fps.to_string() },
        number_or_null(asked.view_hz),
        asked.bitrate_kbps
    );
    let sending_json = match &stream.sending {
        Some(s) => format!(
            "{{\"x\": {}, \"y\": {}, \"regionWidth\": {}, \"regionHeight\": {}, \"width\": {}, \"height\": {}, \"scaled\": {}, \"fps\": {}, \"bitrateKbps\": {}, \"codec\": \"H.264\"}}",
            s.region.x, s.region.y, s.region.width, s.region.height, s.width, s.height, s.scaled, s.fps, s.bitrate_kbps
        ),
        None => "null".to_string(),
    };
    let measured_json = match &stream.measured {
        Some(m) => format!(
            "{{\"framesPerSecond\": {:.1}, \"newFramesPerSecond\": {:.1}, \"kbitPerSecond\": {:.0}, \"shownToEncodedMs\": {}}}",
            m.frames_per_second,
            m.new_frames_per_second,
            m.kbit_per_second,
            m.shown_to_encoded_ms.map_or("null".to_string(), |ms| format!("{ms:.2}"))
        ),
        None => "null".to_string(),
    };
    format!(
        "{{\"asked\": {}, \"sending\": {}, \"measured\": {}, \"screen\": {{\"width\": {}, \"height\": {}, \"hz\": {}}}, \"limits\": {}, \"hostLimits\": {}, \"cap\": {}, \"capWhy\": {}, \"applied\": {}, \"refused\": {}, \"viewers\": {}, \"control\": \"{}\", \"controlWhy\": {}, \"controlDryRun\": {}, {}, {}, {}, {}, {}, {}}}",
        asked_json,
        sending_json,
        measured_json,
        stream.screen.0,
        stream.screen.1,
        stream.screen.2,
        limits_json(stream.limits()),
        limits_json(stream.host_limits),
        if stream.capped { settings::quoted(settings::MATCH_CAP_NAME) } else { "null".to_string() },
        if stream.capped { settings::quoted(&format!("{} is running on the PC", settings::MATCH_PROCESS)) } else { "null".to_string() },
        stream.acted_on >= stream.asks && stream.acted_capped == stream.capped,
        stream.refused.as_deref().map_or("null".to_string(), settings::quoted),
        watching,
        control_stands,
        control_why,
        control_dry_run,
        controller_json,
        sound_json,
        pointer_json,
        fit_json,
        this_machine_json,
        router_port_json
    )
}

/// Whether a request's `Host` (the name the browser thinks it is talking to) is one this engine answers to when no
/// token is set. This PC's own names always are: "localhost", a loopback address, the address listened on. A name
/// given with `--trust-host` is too, but only when the request arrived from this PC itself: that is the website's
/// own server passing a visitor's request on. Anything else is refused, or another website could point a name of
/// its own at 127.0.0.1 and read the stream through a visitor's browser.
fn host_is_ours(host: &str, listen: IpAddr, trusted: &[String], from_this_pc: bool) -> bool {
    let host = host.trim().to_ascii_lowercase();
    // The port, when there is one, is not part of the name.
    let name = match host.rsplit_once(':') {
        Some((name, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => name,
        _ => host.as_str(),
    };
    if name.is_empty() {
        return false;
    }
    name == "localhost" || name.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback() || ip == listen) || (from_this_pc && trusted.iter().any(|trusted| trusted == name))
}

/// Where the video socket is opened: on every IPv4 address with `--lan` (or when the web address is), otherwise
/// only where the web address is.
fn video_socket_address(listen: IpAddr, lan: bool) -> IpAddr {
    if lan || listen.is_unspecified() { IpAddr::V4(Ipv4Addr::UNSPECIFIED) } else { listen }
}

/// The addresses a browser is told it can reach the video at. Without `--lan`: the one address listened on.
/// With it: this PC itself (127.0.0.1) first, then each of the PC's own addresses that is a home-network one.
/// "Home network" means the three private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x): an address the wider
/// internet can reach is never offered, whatever cards the PC has.
fn video_addresses(listen: IpAddr, lan: bool, own: &[Ipv4Addr], port: u16) -> Vec<SocketAddr> {
    if !lan && !listen.is_unspecified() {
        return vec![SocketAddr::new(listen, port)];
    }
    let mut offered = vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)];
    for address in own {
        let offer = SocketAddr::new(IpAddr::V4(*address), port);
        if address.is_private() && !offered.contains(&offer) {
            offered.push(offer);
        }
    }
    offered
}

/// Those addresses as the console says them.
fn spoken(addresses: &[SocketAddr]) -> String {
    addresses.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(" and ")
}

/// The most a viewer can ask this PC for, with the screen as it now is.
fn host_limits_for(a: &Args, screen: (i32, i32, i32)) -> Limits {
    Limits { max_lines: a.max_lines.unwrap_or(screen.1).min(screen.1), max_fps: a.max_fps.unwrap_or(screen.2).min(screen.2), max_bitrate_kbps: a.max_bitrate }
}

/// Opens the native session that carries out a plan. `patient`: the PC's screen has just changed mode (FIT), and
/// Windows can take a few seconds before it will share the screen again, so a refusal is tried again for longer.
fn open_session(a: &Args, plan: &Plan, patient: bool) -> Result<native::Session, String> {
    let options = native::Options {
        region: plan.region,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        bitrate_kbps: plan.bitrate_kbps,
        hevc: false,
        intra_refresh: a.intra,
        preset: a.preset,
        tweaks: a.tweaks,
        skip_pointer_only: true,
        // For bench/still-check.cjs only: `DEBASER_PRETEND_STILL=1` in the environment makes the engine behave as
        // if the screen stopped changing after the first picture, so the still-screen rule can be proved on a PC
        // whose screen is busy.
        pretend_still: std::env::var("DEBASER_PRETEND_STILL").is_ok_and(|value| value == "1"),
    };
    // Windows can take a moment to let go of a screen share that was only just closed, so a refusal is tried again.
    let mut last = String::new();
    for attempt in 0..if patient { 50 } else { 4 } {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(100));
        }
        match native::Session::open(&options) {
            Ok(session) => return Ok(session),
            Err(why) => last = why,
        }
    }
    Err(last)
}

/// What an open session is really sending (the native side may have trimmed the plan to fit the screen).
fn sending_of(info: &native::Info, plan: &Plan) -> Sending {
    Sending { region: info.region, width: info.encode_width, height: info.encode_height, scaled: info.scaled, fps: plan.fps, bitrate_kbps: plan.bitrate_kbps }
}

/// The same in words, for the console.
fn describe(s: &Sending, screen: (i32, i32, i32)) -> String {
    let piece = if s.region.width + 1 >= screen.0 && s.region.height + 1 >= screen.1 { "the whole screen".to_string() } else { format!("the middle {}x{} of the screen", s.region.width, s.region.height) };
    format!("{}x{} at up to {} fps, {} kbit/s: {}, {}", s.width, s.height, s.fps, s.bitrate_kbps, piece, if s.scaled { "shrunk on the card" } else { "as it is" })
}

/// For bench/settings-check.cjs only, so the cap can be proved without a game being started: how the engine may
/// be told to behave as if a League match were running. `DEBASER_PRETEND_MATCH=1` in the environment: always.
/// `DEBASER_PRETEND_MATCH_FILE=<path>`: for as long as a file exists at that path (the check makes and removes
/// it, to see the cap come on and lift while a stream runs).
struct Pretend {
    always: bool,
    while_file: Option<std::path::PathBuf>,
}

impl Pretend {
    fn from_environment() -> Pretend {
        Pretend {
            always: std::env::var("DEBASER_PRETEND_MATCH").is_ok_and(|value| value == "1"),
            while_file: std::env::var_os("DEBASER_PRETEND_MATCH_FILE").filter(|path| !path.is_empty()).map(std::path::PathBuf::from),
        }
    }

    fn asked_for(&self) -> bool {
        self.always || self.while_file.is_some()
    }

    fn now(&self) -> bool {
        self.always || self.while_file.as_ref().is_some_and(|path| path.exists())
    }
}

/// Whether the match cap applies: a League match is running on the PC (or the check is pretending one is).
fn match_running(pretend: &Pretend) -> bool {
    pretend.now() || native::process_running(settings::MATCH_PROCESS) == Some(true)
}

pub fn serve(args: &[String]) -> ExitCode {
    let a = match parse(args) {
        Ok(a) => a,
        Err(why) => {
            eprintln!("{why}");
            eprintln!("debaser-engine serve {USAGE}");
            return ExitCode::from(2);
        }
    };

    // The web side first, so a port that is taken is said before the screen is touched.
    let listener = match TcpListener::bind((a.listen, a.port)) {
        Ok(listener) => listener,
        Err(why) => {
            eprintln!("NOT SERVING. Could not listen on {}:{} ({why})", a.listen, a.port);
            return ExitCode::from(2);
        }
    };
    // One UDP socket carries every viewer. It follows `--listen` (on this PC only by default), unless `--lan`
    // opens it to the home network while the web address stays where it is.
    let video_at = video_socket_address(a.listen, a.lan);
    let socket = match UdpSocket::bind((video_at, a.udp_port)) {
        Ok(socket) => socket,
        Err(why) => {
            eprintln!("NOT SERVING. Could not open the video socket on {}:{} ({why})", video_at, a.udp_port);
            return ExitCode::from(2);
        }
    };
    let udp_port = socket.local_addr().map(|address| address.port()).unwrap_or(a.udp_port);
    // The addresses a browser is told it can reach us at, as they are now; read again at every hello (`Reach`).
    let own_addresses: OwnAddresses = Box::new(native::local_ipv4);
    let offered = video_addresses(a.listen, a.lan, &own_addresses(), udp_port);

    // The screen as it is now (only read: the engine never changes the PC's display mode), the PC's limits, and
    // how the stream starts before any viewer has asked for anything.
    let Some((screen_width, screen_height, screen_hz)) = native::screen() else {
        eprintln!("NOT SERVING. No main screen found");
        return ExitCode::from(2);
    };
    let screen_hz = if screen_hz > 0 { screen_hz } else { 60 };
    // FIT: the mode found now is "the PC's own". (For bench/fit-check.cjs the screen and its modes can be
    // pretended; the engine then carries on as if the screen had the pretended size.)
    let fit = match Fit::start(a.allow_fit, (screen_width, screen_height, screen_hz)) {
        Ok(fit) => fit,
        Err(why) => {
            eprintln!("NOT SERVING. {why}");
            return ExitCode::from(2);
        }
    };
    let fit_pretended = fit.pretended();
    let (screen_width, screen_height, screen_hz) = fit.pretended_screen().map_or((screen_width, screen_height, screen_hz), |mode| (mode.width, mode.height, mode.hz));
    let host_limits = host_limits_for(&a, (screen_width, screen_height, screen_hz));
    let cut = a.width > 0;
    let asked = Asked {
        shape: if cut { Shape::Cut } else { a.shape },
        view_width: 0,
        view_height: 0,
        cut_width: a.width,
        cut_height: a.height,
        lines: if cut { 0 } else { a.lines },
        fps: a.fps,
        fps_auto: false,
        view_hz: 0,
        bitrate_kbps: a.bitrate,
    };
    let pretend = Pretend::from_environment();
    let pretending = pretend.asked_for();
    let capped_at_start = match_running(&pretend);
    let mut stream = Stream { asked, asks: 0, acted_on: 0, host_limits, capped: capped_at_start, acted_capped: capped_at_start, screen: (screen_width, screen_height, screen_hz), sending: None, refused: None, measured: None };

    let mut current = stream.plan();
    let mut session = match open_session(&a, &current, false) {
        Ok(session) => Some(session),
        Err(why) => {
            eprintln!("NOT SERVING. {why}");
            return ExitCode::from(2);
        }
    };
    let ticks_per_second = session.as_ref().map_or(1, |s| s.info.ticks_per_second);
    let first = sending_of(&session.as_ref().expect("just opened").info, &current);
    stream.sending = Some(first);
    let mut current_capped = stream.capped;
    let mut current_screen = stream.screen;

    // The encryption WebRTC requires comes from Windows itself (str0m's "wincrypto").
    str0m::crypto::from_feature_flags().install_process_default();
    unsafe { SetConsoleCtrlHandler(Some(on_console_event), 1) };

    let shared = Arc::new(Shared {
        viewers: Mutex::new(Vec::new()),
        socket,
        udp_port,
        lan: a.lan,
        own_addresses,
        reach: Mutex::new(Reach { offered, routes: HashMap::new() }),
        want_keyframe: AtomicBool::new(false),
        keyframe_requests: AtomicU64::new(0),
        viewers_ever: AtomicU64::new(0),
        token: a.token.clone(),
        listen: a.listen,
        trust_hosts: a.trust_hosts.clone(),
        internet: a.internet,
        stun: Mutex::new(crate::stun::Stun::new()),
        port: a.router_port.then(|| Arc::new(crate::portmap::Port::new())),
        stream: Mutex::new(stream),
        control: Mutex::new(Control::new(a.allow_control, a.control_dry_run, first.region, (screen_width, screen_height))),
        match_running: AtomicBool::new(capped_at_start),
        pointer: Mutex::new(pointer::News::default()),
        pretend_pointer: std::env::var_os("DEBASER_PRETEND_POINTER_FILE").filter(|path| !path.is_empty()).map(std::path::PathBuf::from),
        sound_allowed: !a.no_sound,
        sound: Mutex::new(SoundState::default()),
        pretend_tone: std::env::var("DEBASER_PRETEND_TONE").is_ok_and(|value| value == "1"),
        fit: Mutex::new(fit),
    });
    if a.allow_control && !a.control_dry_run {
        // If the engine itself fails, whatever a viewer was holding down is let go before it goes.
        let before = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            control::emergency_all_up();
            before(info);
        }));
    }
    {
        let shared = shared.clone();
        thread::spawn(move || network_loop(shared));
    }
    {
        let shared = shared.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let shared = shared.clone();
                thread::spawn(move || handle_request(stream, &shared));
            }
        });
    }
    if shared.sound_allowed {
        let shared = shared.clone();
        thread::spawn(move || sound_loop(shared));
    }
    // --router-port: the keeper of the router port (portmap.rs). It asks nothing of the router until the outside
    // world has said what this PC's address is, and gives the port back when the engine stops (waited for below).
    let port_keeper = shared.port.clone().map(|port| {
        let shared = shared.clone();
        thread::spawn(move || {
            let find = || crate::portmap::find_on(&(shared.own_addresses)());
            let seen_outside = || match shared.stun.lock().unwrap().outside {
                Some(SocketAddr::V4(outside)) => Some(*outside.ip()),
                _ => None,
            };
            let stopping = || STOP.load(Ordering::SeqCst);
            crate::portmap::keep(&port, shared.udp_port, &crate::portmap::PACE, &find, &seen_outside, &stopping);
        })
    });
    {
        // Looking through the list of running programs takes a few milliseconds, so it has a thread of its own
        // and never holds a frame up.
        let shared = shared.clone();
        thread::spawn(move || {
            while !STOP.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_secs(1));
                let running = match_running(&pretend);
                shared.stream.lock().unwrap().capped = running;
                shared.match_running.store(running, Ordering::SeqCst);
            }
        });
    }

    println!();
    println!("DEBASER ENGINE :: serve");
    println!("  screen {}x{} at {} Hz; H.264, preset P{}{}, tweaks {}", screen_width, screen_height, screen_hz, a.preset, if a.intra { ", gradual repair on" } else { "" }, a.tweaks);
    println!("  now sending {} (as started)", describe(&first, current_screen));
    println!("  a viewer may ask for up to {} lines, {} fps, {} kbit/s", host_limits.max_lines, host_limits.max_fps, host_limits.max_bitrate_kbps);
    if current_capped {
        println!(
            "  {} is running{}: the {} cap is on ({} lines, {} fps, {} kbit/s at most)",
            settings::MATCH_PROCESS,
            if pretending { " (pretended, for the check)" } else { "" },
            settings::MATCH_CAP_NAME,
            settings::MATCH_CAP.max_lines,
            settings::MATCH_CAP.max_fps,
            settings::MATCH_CAP.max_bitrate_kbps
        );
    }
    let offered = shared.offered();
    let shown_host = if a.listen.is_unspecified() { offered.last().map_or("127.0.0.1".to_string(), |c| c.ip().to_string()) } else { a.listen.to_string() };
    println!("  open http://{}:{}/{} in Chrome or Edge", shown_host, a.port, if a.token.is_some() { "?token=<your token>" } else { "" });
    println!("  video leaves from {}", spoken(&offered));
    if !a.listen.is_loopback() {
        println!("  OPEN TO OTHER DEVICES on {}: anyone with the token sees this whole screen", a.listen);
    }
    if a.control_dry_run {
        println!("  CONTROL: DRY RUN. What a viewer does is only written down (GET /control-log); nothing reaches Windows.");
    } else if a.allow_control {
        println!("  CONTROL IS ALLOWED: one viewer at a time may use this PC's mouse and keys. Ctrl+Alt+Shift+End on this PC stops it.");
        println!("  It is refused while {} is running.", settings::MATCH_PROCESS);
    }
    println!("  SOUND: {}", if a.no_sound { "never sent (--no-sound)" } else { "sent to a viewer that asks for it (everything this PC is playing); not read at all until one does" });
    if shared.pretend_tone {
        println!("  SOUND IS PRETENDED, for the check: a steady test tone in place of the PC's sound (DEBASER_PRETEND_TONE=1)");
    }
    if a.allow_fit {
        println!("  FIT IS ALLOWED: while a viewer wants it, this PC's own screen is changed to that viewer's shape, and changed back when it leaves.");
        println!("  Ctrl+Alt+Shift+End on this PC puts it back. It is never changed while {} is running.", settings::MATCH_PROCESS);
    }
    if fit_pretended {
        println!("  THIS PC'S SCREEN AND ITS MODES ARE PRETENDED, for the check (DEBASER_PRETEND_MODES): no display call is ever made");
    }
    if shared.pretend_pointer.is_some() {
        println!("  THE PC'S POINTER IS PRETENDED, for the check (DEBASER_PRETEND_POINTER_FILE): the real one is ignored");
    }
    if a.internet {
        println!("  --internet: also reachable from outside the home: the outside address is asked of {} (no key), and both sides open the way through their routers", crate::stun::DEFAULT_SERVER);
    }
    if a.router_port {
        println!("  --router-port: the home router will be asked to send outside port {udp_port} (UDP) to this PC's video, an hour at a time; given back when the engine stops");
    }
    if a.lan {
        println!("  --lan: the VIDEO can reach devices on the home network; the web address is still {} only", a.listen);
    }
    if !a.trust_hosts.is_empty() {
        println!("  also answering to {} when the request comes from this PC itself", a.trust_hosts.join(", "));
    }
    println!("  waiting for a viewer (Ctrl+C stops)");

    let started = Instant::now();
    let mut interval = (ticks_per_second / current.fps as i64).max(1);
    let mut wait_ms = (1000 / current.fps).max(1);
    let ms = |from: i64, to: i64| (to - from) as f64 * 1000.0 / ticks_per_second as f64;

    // Whole-run numbers for the summary, and the same for the second being printed.
    let mut all_shown: Vec<f64> = Vec::new();
    let mut all_handed: Vec<f64> = Vec::new();
    let mut all_encode: Vec<f64> = Vec::new();
    let (mut frames_sent, mut fresh_sent, mut keyframes_sent, mut bytes_sent) = (0u64, 0u64, 0u64, 0u64);
    let mut second_shown: Vec<f64> = Vec::new();
    let mut second_handed: Vec<f64> = Vec::new();
    let (mut second_frames, mut second_fresh, mut second_bytes) = (0u64, 0u64, 0u64);
    // The still-screen rule: repeats sent since the screen last changed, when the last frame of either kind was
    // taken, and how many repeats the rule has spared this second.
    let resting_rule = a.tweaks & 64 != 0;
    let mut repeats_in_a_row = 0u32;
    let mut last_frame_at = 0i64;
    let mut second_spared = 0u64;
    let mut second_started = Instant::now();
    let mut sending_time = Duration::ZERO;

    let mut idle = true;
    let mut next_due = 0i64;
    let mut time_base: Option<i64> = None;
    let mut last_rtp = 0u64;
    let mut last_keyframe: Option<Instant> = None;
    let mut profile: Option<u8> = None;
    let mut failure: Option<String> = None;
    // Settings: the request count last acted on, a plan the encoder refused (not tried again until something new
    // is asked), how many times what is sent has changed, and when the screen share last had to be restarted.
    let mut asks_seen = 0u64;
    let mut refused_plan: Option<Plan> = None;
    let mut changes = 0u64;
    let mut last_restart: Option<Instant> = None;
    // The PC's pointer: how many shapes the open session had handed over when last looked at (a newly opened
    // session starts again from none).
    let mut shapes_seen = 0u32;
    // FIT: when this engine last changed the PC's screen itself. For a while after, Windows may withdraw the
    // screen share more than once, and that is not taken for the share breaking for good.
    let mut own_switch: Option<Instant> = None;

    loop {
        if STOP.load(Ordering::SeqCst) || a.seconds.is_some_and(|s| started.elapsed() >= Duration::from_secs(s)) {
            break;
        }

        // How many requests had been taken in before anything below was looked at: those are the ones this turn
        // of the loop deals with (one that arrives while it runs is dealt with on the next).
        let asks = shared.stream.lock().unwrap().asks;

        // FIT (fit.rs): is the PC's own screen to be changed for a viewer, or given back? Looked at every turn,
        // watched or not, so that the PC gets its own screen back when the last viewer that wanted the fit has gone.
        {
            let wishes = || {
                let now = Instant::now();
                let viewers = shared.viewers.lock().unwrap();
                let wanting: Vec<(i32, i32)> = viewers.iter().filter(|v| v.rtc.is_alive() && v.watching(now)).filter_map(|v| v.wants_fit).collect();
                // The viewer that has been connected longest decides the shape.
                (wanting.first().copied(), wanting.len())
            };
            let match_now = shared.match_running.load(Ordering::SeqCst);
            let (mut wanted_shape, mut wanted_by) = wishes();
            if shared.fit.lock().unwrap().cut_off_pressed() {
                // Put back from the PC's own keyboard: every viewer's wish is forgotten, or it would be fitted again at once.
                for v in shared.viewers.lock().unwrap().iter_mut() {
                    v.wants_fit = None;
                }
                (wanted_shape, wanted_by) = (None, 0);
            }
            let mut fit = shared.fit.lock().unwrap();
            if let Some(step) = fit.decide(wanted_shape, wanted_by, match_now) {
                // The screen share is closed before the change (Windows withdraws it at a change of mode anyway),
                // and opened again further down, on the screen as it then is.
                session = None;
                let mode = fit.carry_out(step);
                drop(fit);
                own_switch = Some(Instant::now());
                let mut stream = shared.stream.lock().unwrap();
                stream.screen = (mode.width, mode.height, if mode.hz > 0 { mode.hz } else { stream.screen.2 });
                stream.host_limits = host_limits_for(&a, stream.screen);
            }
        }
        let after_own_switch = own_switch.is_some_and(|at| at.elapsed() < Duration::from_secs(10));

        // What should be sent now, from what was asked and what the PC allows. When that is not what is being
        // sent, the native session is closed and opened again as the new plan says. Its first frame is a full
        // picture in the new size, and the viewers' connections carry on.
        let (wanted, capped_now, screen_now) = {
            let stream = shared.stream.lock().unwrap();
            (stream.plan(), stream.capped, stream.screen)
        };
        if asks != asks_seen {
            refused_plan = None;
        }
        if session.is_none() || (wanted != current && refused_plan != Some(wanted)) {
            let why = if capped_now != current_capped {
                if capped_now { format!("{} is running: the {} cap is on", settings::MATCH_PROCESS, settings::MATCH_CAP_NAME) } else { format!("the {} cap is lifted", settings::MATCH_CAP_NAME) }
            } else if screen_now != current_screen {
                "the PC's screen changed".to_string()
            } else {
                "a viewer asked".to_string()
            };
            let began = Instant::now();
            // The old session lets go of the screen and the encoder before the new one asks for them.
            session = None;
            match open_session(&a, &wanted, after_own_switch) {
                Ok(opened) => {
                    let now_sending = sending_of(&opened.info, &wanted);
                    session = Some(opened);
                    shapes_seen = 0;
                    current = wanted;
                    changes += 1;
                    interval = (ticks_per_second / current.fps as i64).max(1);
                    wait_ms = (1000 / current.fps).max(1);
                    println!("  now sending {} ({why}; the change took {} ms)", describe(&now_sending, screen_now), began.elapsed().as_millis());
                    shared.control.lock().unwrap().sending(now_sending.region, (screen_now.0, screen_now.1));
                    let mut stream = shared.stream.lock().unwrap();
                    stream.sending = Some(now_sending);
                    stream.refused = None;
                }
                Err(why_not) => {
                    println!("  could NOT change to {}x{} at {} fps, {} kbit/s ({why}): {why_not}. Staying as it was.", wanted.width, wanted.height, wanted.fps, wanted.bitrate_kbps);
                    refused_plan = Some(wanted);
                    match open_session(&a, &current, after_own_switch) {
                        Ok(opened) => {
                            session = Some(opened);
                            shapes_seen = 0;
                        }
                        Err(why) => {
                            failure = Some(format!("After a refused change the stream could not be opened again as it was: {why}"));
                            break;
                        }
                    }
                    shared.stream.lock().unwrap().refused = Some(why_not);
                }
            }
            next_due = 0;
        }
        if asks != asks_seen || capped_now != current_capped {
            // Whatever was due has now been dealt with, and the settings routes may say so.
            let mut stream = shared.stream.lock().unwrap();
            stream.acted_on = asks;
            stream.acted_capped = capped_now;
        }
        asks_seen = asks;
        current_capped = capped_now;
        current_screen = screen_now;

        // Nobody watching: nothing is grabbed or encoded, so the graphics card is left alone.
        let watching = {
            let now = Instant::now();
            shared.viewers.lock().unwrap().iter().filter(|v| v.watching(now)).count()
        };
        if watching == 0 {
            if !idle {
                println!("  waiting for a viewer");
                shared.stream.lock().unwrap().measured = None;
            }
            idle = true;
            thread::sleep(Duration::from_millis(20));
            second_started = Instant::now();
            continue;
        }

        // The PC's own pointer: when Windows has handed over a new shape, or the pointer has been hidden or shown,
        // the viewers are told (the frame calls below are what hear it from Windows; this only passes it on).
        if shared.pretend_pointer.is_none() {
            if let Some(open) = session.as_ref() {
                let heard = open.pointer_heard();
                let mut news = shared.pointer.lock().unwrap();
                let mut changed = false;
                if heard.shape_count != shapes_seen {
                    shapes_seen = heard.shape_count;
                    if let Some(shape) = open.pointer_shape() {
                        changed |= news.take_shape(&shape);
                    }
                }
                if heard.visible.is_some() && heard.visible != news.shown {
                    news.shown = heard.visible;
                    changed = true;
                }
                drop(news);
                if changed {
                    tell_everyone_pointer(&shared);
                }
            }
        }

        // No faster than the frames a second asked for (give or take 5%), however fast the screen changes: after
        // a new frame, the next is not looked for until almost one frame's time has passed. "Almost", so that when
        // the screen changes at about that rate itself we are already waiting when its next frame arrives and take
        // it at once; a strict beat of our own would leave every frame sitting for up to a whole frame's time
        // first. A screen that changes faster than that gives up its newest picture each time, which is then up to
        // one of its own frames old.
        let before = native::now();
        if before < next_due {
            thread::sleep(Duration::from_secs_f64((next_due - before) as f64 / ticks_per_second as f64));
        }

        // A full picture when a viewer joins or asks for one, but not a burst of them.
        let mut force = idle;
        if shared.want_keyframe.load(Ordering::SeqCst) && last_keyframe.is_none_or(|at| at.elapsed() >= KEYFRAME_SPACING) {
            force = true;
        }
        if force {
            shared.want_keyframe.store(false, Ordering::SeqCst);
        }

        // The still-screen rule (switch 64). While the screen is not changing there is nothing new to send, and a
        // repeat every frame's time (about 32 a second, measured) is waste. So the gaps between repeats grow. The
        // first repeat comes exactly when it always did, the rest after a frame plus one frame's time of waiting
        // (which makes sure the last real frame is followed up quickly: a viewer only learns that its last packets
        // were lost when something comes after them; and a screen that is merely changing slower than the rate
        // asked for is not given repeats it never used to get). Then 100 ms, 200 ms, and from then on every 500 ms.
        // The waiting is all done inside Windows' own "next frame" call, a frame's time at a go, so a real change
        // is taken the moment it shows and a viewer asking for a full picture is answered within one such look.
        let rest = if a.tweaks & 16 != 0 { interval - (ticks_per_second * 3 / 1000).min(interval / 5) } else { interval * 95 / 100 };
        let taken = {
            let session = session.as_mut().expect("a session is open whenever frames are asked for");
            if !resting_rule {
                session.next_frame(wait_ms, force).map(Some)
            } else if force {
                session.next_frame(0, true).map(Some)
            } else {
                let gap = match repeats_in_a_row {
                    0 => rest + interval,
                    1 => ticks_per_second / 10,
                    2 => ticks_per_second / 5,
                    _ => ticks_per_second / 2,
                };
                let left_ms = (last_frame_at + gap - native::now()) * 1000 / ticks_per_second;
                if idle || left_ms <= 0 {
                    session.next_frame(0, false).map(Some)
                } else {
                    let look_ms = left_ms.min(wait_ms as i64) as i32;
                    let looked = session.next_frame_if_changed(look_ms);
                    // A full look that found nothing is one repeat the old way would have sent.
                    if matches!(looked, Ok(None)) && look_ms >= wait_ms {
                        second_spared += 1;
                    }
                    looked
                }
            }
        };
        let frame = match taken {
            Ok(Some(frame)) => frame,
            Ok(None) => continue,
            Err(why) => {
                // The screen share broke for good (the PC's screen changed size, say). The screen is looked at
                // afresh and the stream started again on it, once; a second break straight after ends the run.
                // (Not in the seconds after this engine changed the PC's mode itself, for FIT: Windows may then
                // withdraw the share more than once while the new mode settles, and each time it is started again.)
                if last_restart.is_some_and(|at| at.elapsed() < Duration::from_secs(2)) && !after_own_switch {
                    failure = Some(why);
                    break;
                }
                last_restart = Some(Instant::now());
                println!("  the screen share broke ({why}): starting it again");
                session = None;
                // The screen as it now is. (When the check is pretending the screen, that is the pretended one.)
                let pretended_screen = shared.fit.lock().unwrap().pretended_screen();
                let screen_as_it_is = match pretended_screen {
                    Some(mode) => Some((mode.width, mode.height, mode.hz)),
                    None => native::screen(),
                };
                let plan_again = {
                    let mut stream = shared.stream.lock().unwrap();
                    if let Some((width, height, hz)) = screen_as_it_is {
                        stream.screen = (width, height, if hz > 0 { hz } else { stream.screen.2 });
                        stream.host_limits = host_limits_for(&a, stream.screen);
                    }
                    current_screen = stream.screen;
                    stream.plan()
                };
                match open_session(&a, &plan_again, after_own_switch) {
                    Ok(opened) => {
                        let now_sending = sending_of(&opened.info, &plan_again);
                        session = Some(opened);
                        shapes_seen = 0;
                        current = plan_again;
                        changes += 1;
                        interval = (ticks_per_second / current.fps as i64).max(1);
                        wait_ms = (1000 / current.fps).max(1);
                        next_due = 0;
                        println!("  now sending {} (the screen share was started again)", describe(&now_sending, current_screen));
                        shared.control.lock().unwrap().sending(now_sending.region, (current_screen.0, current_screen.1));
                        shared.stream.lock().unwrap().sending = Some(now_sending);
                        continue;
                    }
                    Err(why_not) => {
                        failure = Some(why_not);
                        break;
                    }
                }
            }
        };
        // After a repeat nothing is held back: the next real change is taken the moment it shows, so a still screen
        // answers a key press at once. (The wait inside `next_frame` already spaces repeats out.)
        //
        // With the fresh-frame rule on (switch 16; BENCH.md, 2026-11-20), the rest ends 3 ms before the next frame's
        // time (a fifth of a frame's time when that is shorter), not just before it: Windows' sleeps overrun by a
        // millisecond or so, and waking late means the screen's next frame is already waiting and already stale.
        // Waking early, the engine then waits inside Windows' own "next frame" call, which returns the moment the
        // frame is shown. Measured: 5.4 ms from shown to encoded against 8.0 ms, the frames a second unchanged.
        next_due = if frame.fresh { frame.acquired_time + rest } else { 0 };
        repeats_in_a_row = if frame.fresh { 0 } else { repeats_in_a_row + 1 };
        last_frame_at = frame.acquired_time;
        if frame.keyframe {
            last_keyframe = Some(Instant::now());
            if profile.is_none() {
                profile = h264_profile(frame.data);
            }
        }

        // The frame's place in time is when Windows showed it (for a repeat: when the wait for a new one ran out),
        // on the 90,000-a-second clock video uses. It only ever goes forward.
        let captured_at = if frame.fresh { frame.present_time } else { frame.acquired_time };
        let base = *time_base.get_or_insert(captured_at);
        let rtp_time = (((captured_at - base).max(0) as i128 * 90_000 / ticks_per_second as i128) as u64).max(last_rtp + 1);
        last_rtp = rtp_time;
        let age = Duration::from_secs_f64((native::now() - captured_at).max(0) as f64 / ticks_per_second as f64);
        let captured = Instant::now().checked_sub(age).unwrap_or_else(Instant::now);

        let (keyframe, fresh, present_time, encoded_time, encode_ms, size) = (frame.keyframe, frame.fresh, frame.present_time, frame.encoded_time, frame.encode_ms, frame.data.len() as u64);
        let data: Arc<[u8]> = Arc::from(frame.data);
        let went_to = send_frame(&shared, &data, keyframe, profile, rtp_time, captured);
        let handed = native::now();

        if went_to > 0 {
            frames_sent += 1;
            second_frames += 1;
            bytes_sent += size;
            second_bytes += size;
            if keyframe {
                keyframes_sent += 1;
            }
            // The first frame after a pause may show a picture Windows drew long ago: left out of the timings.
            if fresh && !idle {
                fresh_sent += 1;
                second_fresh += 1;
                let shown = ms(present_time, encoded_time);
                all_shown.push(shown);
                second_shown.push(shown);
                all_encode.push(encode_ms);
            }
            if !idle {
                let handing = ms(encoded_time, handed);
                all_handed.push(handing);
                second_handed.push(handing);
            }
        }
        idle = false;

        if second_started.elapsed() >= Duration::from_secs(1) {
            let took = second_started.elapsed();
            sending_time += took;
            let part = |values: &[f64]| match stats(values) {
                Some(s) => format!("middle {:>5.2} ms, worst 5% {:>5.2} ms", s.p50, s.p95),
                None => "no frames".to_string(),
            };
            let kbit_per_second = second_bytes as f64 * 8.0 / 1000.0 / took.as_secs_f64();
            println!(
                "  {:>4} s  {:>3} frames sent ({} new)   shown -> encoded {}   encoded -> network {}   {:>6.0} kbit/s{}",
                started.elapsed().as_secs(),
                second_frames,
                second_fresh,
                part(&second_shown),
                part(&second_handed),
                kbit_per_second,
                if second_spared > 0 { format!("   still screen: about {} repeats spared", second_spared) } else { String::new() }
            );
            // The same second, for the viewers' settings panels.
            shared.stream.lock().unwrap().measured = Some(Measured {
                frames_per_second: second_frames as f64 / took.as_secs_f64(),
                new_frames_per_second: second_fresh as f64 / took.as_secs_f64(),
                kbit_per_second,
                shown_to_encoded_ms: stats(&second_shown).map(|s| s.p50),
            });
            second_shown.clear();
            second_handed.clear();
            (second_frames, second_fresh, second_bytes) = (0, 0, 0);
            second_spared = 0;
            second_started = Instant::now();
        }
    }
    if !idle {
        sending_time += second_started.elapsed();
    }
    drop(session);
    // FIT: the PC gets its own screen back before anything else is done about stopping.
    shared.fit.lock().unwrap().stop();

    let s_shown = stats(&all_shown);
    let s_handed = stats(&all_handed);
    let s_encode = stats(&all_encode);
    let kbps = if sending_time.as_secs_f64() > 0.0 { bytes_sent as f64 * 8.0 / 1000.0 / sending_time.as_secs_f64() } else { 0.0 };
    let viewers = shared.viewers_ever.load(Ordering::Relaxed);
    let requests = shared.keyframe_requests.load(Ordering::Relaxed);
    println!();
    println!("DEBASER ENGINE :: serve :: summary");
    if let Some(why) = &failure {
        println!("  STOPPED EARLY. {why}");
    }
    println!("  ran {:.1} s; {} viewer(s) said hello; {} frames sent ({} from real changes on screen, the rest repeats)", started.elapsed().as_secs_f64(), viewers, frames_sent, fresh_sent);
    println!("  full pictures sent {}; times a browser asked for one {}; times what is sent was changed {}", keyframes_sent, requests, changes);
    println!("{}", line("encode, changed frames only", &s_encode));
    println!("{}", line("Windows showed it -> encoded", &s_shown));
    println!("{}", line("encoded -> handed to the network", &s_handed));
    println!("  {:.0} kbit/s of video on average while sending (asked for {} at the end); nothing adjusts the bitrate to the line yet", kbps, current.bitrate_kbps);
    println!(
        "  json: {{\"kind\": \"serve\", \"encode\": \"{}x{}\", \"fps\": {}, \"bitrateKbps\": {}, \"tweaks\": {}, \"seconds\": {:.1}, \"viewers\": {}, \"framesSent\": {}, \"freshFrames\": {}, \"keyframesSent\": {}, \"keyframeRequests\": {}, \"settingsChanges\": {}, \"sentKbps\": {:.0}, {}, {}, {}}}",
        current.width,
        current.height,
        current.fps,
        current.bitrate_kbps,
        a.tweaks,
        started.elapsed().as_secs_f64(),
        viewers,
        frames_sent,
        fresh_sent,
        keyframes_sent,
        requests,
        changes,
        kbps,
        json("encodeChangedOnly", &s_encode),
        json("presentToEncoded", &s_shown),
        json("encodedToNetwork", &s_handed)
    );

    // CONTROL ends with the engine: everything a viewer was holding down is let go, and the viewer is told.
    {
        let mut viewers = shared.viewers.lock().unwrap();
        let ended = shared.control.lock().unwrap().end(control::Ended::Stopping);
        if let Some(id) = ended {
            if let Some(v) = viewers.iter_mut().find(|v| v.id == id && v.rtc.is_alive()) {
                say(v, control::Ended::Stopping.says());
                pump(v, &shared, Instant::now());
            }
        }
    }
    // The pretend controller, when one was ever plugged in, is unplugged before the engine goes.
    shared.control.lock().unwrap().pad_finish();
    if a.allow_control && !a.control_dry_run {
        control::emergency_all_up();
    }
    // Say goodbye to whoever is still watching, so their browser stops at once instead of timing out.
    STOP.store(true, Ordering::SeqCst);
    {
        let mut viewers = shared.viewers.lock().unwrap();
        let now = Instant::now();
        for v in viewers.iter_mut() {
            if v.rtc.is_alive() && v.rtc.close().is_ok() {
                pump(v, &shared, now);
            }
        }
    }
    // The router port is given back before the engine goes: the keeper does it once it sees the engine stopping.
    // It is waited for two and a half seconds at most, so a router that is slow to answer never holds up the rest of
    // the goodbye (Windows gives a closing program about four seconds). An engine that goes before the router has
    // been told leaves the port to the router, which closes it by itself within the hour.
    if let Some(keeper) = port_keeper {
        let began = Instant::now();
        while !keeper.is_finished() && began.elapsed() < Duration::from_millis(2500) {
            thread::sleep(Duration::from_millis(20));
        }
        if keeper.is_finished() {
            let _ = keeper.join();
        } else {
            println!("  router port: the router was not told in time that the engine is stopping; a port it holds for this PC runs out by itself within the hour");
        }
    }
    STOPPED.store(true, Ordering::SeqCst);
    if failure.is_some() {
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v4(a: u8, b: u8, c: u8, d: u8) -> Ipv4Addr {
        Ipv4Addr::new(a, b, c, d)
    }

    #[test]
    fn only_home_network_addresses_are_offered_for_video() {
        let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
        // Without --lan nothing changes: the one address listened on, and the socket only there.
        assert_eq!(video_socket_address(loopback, false), loopback);
        assert_eq!(video_addresses(loopback, false, &[v4(192, 168, 1, 20)], 5000), vec!["127.0.0.1:5000".parse().unwrap()]);
        // With --lan the socket is on every address, and what is offered is this PC itself and its private
        // addresses: never a public one, a link-local one, or the same one twice.
        assert_eq!(video_socket_address(loopback, true), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        let own = [v4(127, 0, 0, 1), v4(192, 168, 1, 20), v4(81, 2, 69, 142), v4(10, 8, 0, 3), v4(169, 254, 7, 7), v4(172, 16, 5, 5), v4(172, 32, 0, 1), v4(100, 64, 0, 9), v4(192, 168, 1, 20)];
        let offered: Vec<String> = video_addresses(loopback, true, &own, 5000).iter().map(|a| a.to_string()).collect();
        assert_eq!(offered, ["127.0.0.1:5000", "192.168.1.20:5000", "10.8.0.3:5000", "172.16.5.5:5000"]);
        // A PC with no network still offers itself.
        assert_eq!(video_addresses(loopback, true, &[], 5000), vec!["127.0.0.1:5000".parse().unwrap()]);
    }

    /// An engine started as the gaming PC's is (`--lan --listen 0.0.0.0`), on a PC whose own addresses are whatever
    /// `pc` holds at the moment they are asked for. Nothing of the screen, the mouse or the sound is touched.
    fn an_engine_on(pc: Arc<Mutex<Vec<Ipv4Addr>>>) -> Shared {
        let asked_of = pc.clone();
        let own_addresses: OwnAddresses = Box::new(move || asked_of.lock().unwrap().clone());
        let listen = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
        let offered = video_addresses(listen, true, &own_addresses(), 5000);
        let screen = (1920, 1080, 60);
        let host_limits = Limits { max_lines: 1080, max_fps: 60, max_bitrate_kbps: 20000 };
        let asked = Asked { shape: Shape::Native, view_width: 0, view_height: 0, cut_width: 0, cut_height: 0, lines: 1080, fps: 60, fps_auto: false, view_hz: 0, bitrate_kbps: 20000 };
        let region = native::Region { x: 0, y: 0, width: screen.0, height: screen.1 };
        Shared {
            viewers: Mutex::new(Vec::new()),
            socket: UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap(),
            udp_port: 5000,
            lan: true,
            own_addresses,
            reach: Mutex::new(Reach { offered, routes: HashMap::new() }),
            want_keyframe: AtomicBool::new(false),
            keyframe_requests: AtomicU64::new(0),
            viewers_ever: AtomicU64::new(0),
            token: None,
            listen,
            trust_hosts: Vec::new(),
            internet: false,
            stun: Mutex::new(crate::stun::Stun::new()),
            port: None,
            stream: Mutex::new(Stream { asked, asks: 0, acted_on: 0, host_limits, capped: false, acted_capped: false, screen, sending: None, refused: None, measured: None }),
            control: Mutex::new(Control::new(false, false, region, (screen.0, screen.1))),
            match_running: AtomicBool::new(false),
            pointer: Mutex::new(pointer::News::default()),
            pretend_pointer: None,
            sound_allowed: false,
            sound: Mutex::new(SoundState::default()),
            pretend_tone: false,
            fit: Mutex::new(Fit::start(false, screen).unwrap()),
        }
    }

    /// A browser's hello to the engine, and the addresses its answer tells that browser to send to.
    fn told_to_send_to(engine: &Shared) -> Vec<String> {
        let mut browser = Rtc::builder().build(Instant::now());
        let mut change = browser.sdp_api();
        change.add_media(MediaKind::Video, str0m::media::Direction::RecvOnly, None, None, None);
        let (offer, _waiting) = change.apply().expect("an offer");
        engine.viewers.lock().unwrap().clear(); // only so many may watch at once, and these never connect
        let (answer, _viewer) = hello(engine, &offer.to_sdp_string()).expect("an answer");
        // "a=candidate:<name> 1 udp <priority> <address> <port> typ host"
        let mut told: Vec<String> = answer.lines().filter(|l| l.starts_with("a=candidate:")).filter_map(|l| l.split_whitespace().nth(4)).map(str::to_string).collect();
        told.sort();
        told.dedup();
        told
    }

    #[test]
    fn a_hello_is_answered_with_the_addresses_the_pc_has_now() {
        str0m::crypto::from_feature_flags().install_process_default();
        // The gaming PC's case (2026-11-28): the engine starts at sign-in, before the Wi-Fi has its address.
        let pc = Arc::new(Mutex::new(vec![v4(127, 0, 0, 1)]));
        let engine = an_engine_on(pc.clone());
        assert_eq!(told_to_send_to(&engine), ["127.0.0.1"]);
        // The Wi-Fi comes up: the very next hello says so, with nothing restarted, and packets from the home
        // network are taken as arriving there.
        *pc.lock().unwrap() = vec![v4(127, 0, 0, 1), v4(192, 168, 0, 30)];
        assert_eq!(told_to_send_to(&engine), ["127.0.0.1", "192.168.0.30"]);
        let laptop: SocketAddr = "192.168.0.200:50000".parse().unwrap();
        assert_eq!(engine.arrived_at(laptop), "192.168.0.30:5000".parse().unwrap());
        // The address changes: the old one is no longer offered, nor remembered for anyone.
        *pc.lock().unwrap() = vec![v4(127, 0, 0, 1), v4(192, 168, 0, 77)];
        assert_eq!(told_to_send_to(&engine), ["127.0.0.1", "192.168.0.77"]);
        assert_eq!(engine.arrived_at(laptop), "192.168.0.77:5000".parse().unwrap());
        // The network goes away altogether: only this PC itself is left.
        *pc.lock().unwrap() = vec![v4(127, 0, 0, 1)];
        assert_eq!(told_to_send_to(&engine), ["127.0.0.1"]);
    }

    /// Away from home, layer 1 (SPEC-screens.md, "Away from home with no setup", 2026-11-28). A browser on a hard
    /// network (a phone hotspot, a campus) reaches the engine from an address it never announced, because its
    /// router hands out a new one for every place it sends to. The engine lets it in on the connection's own
    /// password alone and answers to where the packets really came from. So the engine never turns such a viewer
    /// away: once its packets can arrive at all (the router port, portmap.rs), it connects.
    #[test]
    fn a_viewer_from_an_address_it_never_announced_connects() {
        str0m::crypto::from_feature_flags().install_process_default();
        // An engine as --internet runs it (it sends connection checks of its own), listening for real, on this PC only.
        let mut engine = an_engine_on(Arc::new(Mutex::new(vec![v4(127, 0, 0, 1)])));
        engine.udp_port = engine.socket.local_addr().unwrap().port();
        engine.internet = true;
        // Its outside-address question goes to a socket of ours that never answers, not out to the internet.
        let nobody = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        engine.stun.lock().unwrap().server = Some(nobody.local_addr().unwrap());
        let engine = Arc::new(engine);
        {
            let engine = engine.clone();
            thread::spawn(move || network_loop(engine));
        }
        let engine_at = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), engine.udp_port);

        // The browser says it is at 192.0.2.5:1111 (all it knows of itself). Its packets really leave from
        // somewhere else, and what comes back there is handed to it as if it had arrived where it thinks it is:
        // what a router in between does.
        let believed: SocketAddr = "192.0.2.5:1111".parse().unwrap();
        let real = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        real.set_read_timeout(Some(Duration::from_millis(5))).unwrap();
        let really_at = real.local_addr().unwrap();
        assert_ne!(really_at, believed);
        let mut browser = Rtc::builder().build(Instant::now());
        browser.add_local_candidate(Candidate::host(believed, "udp").unwrap());
        let mut change = browser.sdp_api();
        change.add_media(MediaKind::Video, str0m::media::Direction::RecvOnly, None, None, None);
        let (offer, waiting) = change.apply().expect("an offer");
        let offer = offer.to_sdp_string();
        assert!(offer.contains("192.0.2.5 1111") && !offer.contains(&really_at.port().to_string()), "the engine is only told the address the browser believes it has");
        let (answer, viewer) = hello(&engine, &offer).expect("an answer");
        browser.sdp_api().accept_answer(waiting, str0m::change::SdpAnswer::from_sdp_string(&answer).expect("the engine's answer")).expect("the answer taken");

        let mut buf = vec![0u8; 2000];
        let began = Instant::now();
        let mut connected = false;
        while !connected && began.elapsed() < Duration::from_secs(10) {
            loop {
                match browser.poll_output().expect("the browser's side") {
                    Output::Timeout(_) => break,
                    Output::Transmit(packet) => {
                        if packet.destination == engine_at {
                            let _ = real.send_to(&packet.contents, engine_at);
                        }
                    }
                    Output::Event(Event::IceConnectionStateChange(IceConnectionState::Connected | IceConnectionState::Completed)) => connected = true,
                    Output::Event(_) => {}
                }
            }
            if let Ok((length, source)) = real.recv_from(&mut buf) {
                if let Ok(contents) = buf[..length].try_into() {
                    let arrived = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source, destination: believed, contents });
                    browser.handle_input(arrived).expect("a packet from the engine");
                }
            }
            browser.handle_input(Input::Timeout(Instant::now())).expect("the time");
        }
        assert!(connected, "the engine never answered a browser whose packets came from an address it had not announced");
        // And the engine knows where that viewer really is.
        let seen = engine.viewers.lock().unwrap().iter().find(|v| v.id == viewer).and_then(|v| v.last_source);
        assert_eq!(seen, Some(really_at));
    }

    /// A browser's hello, and every address and port its answer tells that browser to try, with the kind of each
    /// ("host": the PC's own; "srflx": one a router shows to the outside).
    fn told_in_full(engine: &Shared) -> Vec<String> {
        let mut browser = Rtc::builder().build(Instant::now());
        let mut change = browser.sdp_api();
        change.add_media(MediaKind::Video, str0m::media::Direction::RecvOnly, None, None, None);
        let (offer, _waiting) = change.apply().expect("an offer");
        engine.viewers.lock().unwrap().clear();
        let (answer, _viewer) = hello(engine, &offer.to_sdp_string()).expect("an answer");
        // "a=candidate:<name> 1 udp <priority> <address> <port> typ <kind> ..."
        let mut told: Vec<String> = answer
            .lines()
            .filter(|l| l.starts_with("a=candidate:"))
            .filter_map(|l| {
                let parts: Vec<&str> = l.split_whitespace().collect();
                Some(format!("{}:{} {}", parts.get(4)?, parts.get(5)?, parts.get(7)?))
            })
            .collect();
        told.sort();
        told
    }

    /// Away from home, layer 2: the port the router opened is one more address a browser is told to try, and the
    /// settings say how it stands. An engine not told to ask says nothing of it and offers nothing more.
    #[test]
    fn the_router_port_is_offered_while_it_is_open_and_said_in_the_settings() {
        use crate::portmap::{Gateway, Port, Standing};
        str0m::crypto::from_feature_flags().install_process_default();
        let hub = Gateway { control: "192.168.0.1:49153".parse().unwrap(), path: "/upnp/control/WANIPConnection0".to_string(), service: "urn:schemas-upnp-org:service:WANIPConnection:1".to_string() };
        let open_at = |outside: &str| Standing::Open { outside: outside.parse().unwrap(), inside: "192.168.0.30:5000".parse().unwrap(), gateway: hub.clone(), note: None };
        let an_engine = |port: Option<Standing>, stun_says: &str| {
            let mut engine = an_engine_on(Arc::new(Mutex::new(vec![v4(127, 0, 0, 1), v4(192, 168, 0, 30)])));
            engine.internet = true;
            engine.stun.lock().unwrap().outside = Some(stun_says.parse().unwrap());
            engine.port = port.map(|standing| Arc::new(Port::standing_as(standing)));
            engine
        };
        let at_home = ["127.0.0.1:5000 host", "192.168.0.30:5000 host"];

        // Never told to ask (SERVER's own engine, every test engine): as before, and the settings say null.
        let engine = an_engine(None, "203.0.113.7:40001");
        assert_eq!(told_in_full(&engine), [at_home[0], at_home[1], "203.0.113.7:40001 srflx"]);
        assert!(settings_json(&engine, None).contains("\"routerPort\": null"));

        // Asked and refused: nothing more is offered, and the settings carry the router's own answer.
        let engine = an_engine(Some(Standing::NotGiven { why: "the router refused (its answer: UPnP error 606 Action not authorized (HTTP 500))".to_string() }), "203.0.113.7:40001");
        assert_eq!(told_in_full(&engine), [at_home[0], at_home[1], "203.0.113.7:40001 srflx"]);
        let said = settings_json(&engine, None);
        assert!(said.contains("\"routerPort\": {\"state\": \"not given\", \"outsidePort\": null, \"why\": \"the router refused (its answer: UPnP error 606"), "{said}");

        // Open, under another port than the one the outside world saw the socket at: both are offered.
        let engine = an_engine(Some(open_at("203.0.113.7:5000")), "203.0.113.7:40001");
        assert_eq!(told_in_full(&engine), [at_home[0], at_home[1], "203.0.113.7:40001 srflx", "203.0.113.7:5000 srflx"]);
        assert!(settings_json(&engine, None).contains("\"routerPort\": {\"state\": \"open\", \"outsidePort\": 5000, \"why\": null}"));

        // Open under the very port the outside world already saw (the usual case): offered once, not twice.
        let engine = an_engine(Some(open_at("203.0.113.7:5000")), "203.0.113.7:5000");
        assert_eq!(told_in_full(&engine), [at_home[0], at_home[1], "203.0.113.7:5000 srflx"]);

        // The flag is only taken together with --internet.
        let args = |words: &[&str]| parse(&words.iter().map(|w| w.to_string()).collect::<Vec<_>>());
        assert!(args(&["--router-port"]).is_err_and(|why| why.contains("--internet")));
        assert!(args(&["--internet", "--router-port", "--listen", "0.0.0.0", "--token", "abcdefgh"]).is_ok_and(|a| a.router_port && a.internet && a.lan));
        assert!(args(&["--internet", "--listen", "0.0.0.0", "--token", "abcdefgh"]).is_ok_and(|a| !a.router_port));
    }

    #[test]
    fn the_host_guard() {
        let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let none: [String; 0] = [];
        let site = ["debaser.site".to_string()];
        // This PC's own names, with or without a port, in any letter case.
        for ours in ["127.0.0.1:8478", "127.0.0.1", "localhost:8478", "LOCALHOST", "127.0.0.2:1"] {
            assert!(host_is_ours(ours, loopback, &none, true), "{ours}");
            assert!(host_is_ours(ours, loopback, &none, false), "{ours}");
        }
        // Anything else is refused: another site's name, an address that is not this PC's, nothing at all.
        for theirs in ["evil.example:8478", "debaser.site", "192.168.1.20:8478", "", "localhost.evil.example", "127.0.0.1.evil.example:80"] {
            assert!(!host_is_ours(theirs, loopback, &none, true), "{theirs}");
        }
        // A trusted name is answered only when the request came from this PC itself.
        assert!(host_is_ours("debaser.site", loopback, &site, true));
        assert!(host_is_ours("Debaser.Site:443", loopback, &site, true));
        assert!(!host_is_ours("debaser.site", loopback, &site, false));
        assert!(!host_is_ours("evil.debaser.site", loopback, &site, true));
        assert!(!host_is_ours("debaser.site.evil.example", loopback, &site, true));
        // The address listened on is one of this PC's own names too.
        let lan = IpAddr::V4(v4(192, 168, 1, 20));
        assert!(host_is_ours("192.168.1.20:8478", lan, &none, false));
        assert!(!host_is_ours("192.168.1.21:8478", lan, &none, false));
    }
}
