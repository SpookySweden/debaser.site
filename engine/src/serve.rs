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
use str0m::media::{MediaKind, MediaTime, Mid, Pt, Writer};
use str0m::net::{Protocol, Receive};
use str0m::rtp::Extension;
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

use crate::control::{self, Control, Lane};
use crate::native;
use crate::settings::{self, Asked, Limits, Plan, Shape};
use crate::{json, line, stats};

pub const USAGE: &str = "[--shape 16:9] [--lines 1080] [--fps 60] [--bitrate 20000] [--max-lines N] [--max-fps N] [--max-bitrate 50000] [--width W --height H] [--allow-control [--control-dry-run]] [--preset 1] [--tweaks 61] [--intra-refresh] [--port 8478] [--udp-port 0] [--listen 127.0.0.1] [--token text] [--seconds N]";

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
    port: u16,
    udp_port: u16,
    listen: IpAddr,
    token: Option<String>,
    seconds: Option<u64>,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args {
        width: 0,
        height: 0,
        shape: Shape::Wide16x9,
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
        port: 8478,
        udp_port: 0,
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
            "--listen" => a.listen = value()?.parse().map_err(|_| "--listen is an IPv4 address, such as 127.0.0.1 or 0.0.0.0")?,
            "--token" => a.token = Some(value()?),
            "--seconds" => a.seconds = Some(value()?.parse().map_err(|_| "--seconds is a number")?),
            "--intra-refresh" => a.intra = true,
            "--allow-control" => a.allow_control = true,
            "--control-dry-run" => a.control_dry_run = true,
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
    /// When str0m next wants to be told the time.
    next_timeout: Instant,
    /// The two channels control travels on (control.rs), once the page has opened them.
    keys: Option<ChannelId>,
    pointer: Option<ChannelId>,
}

struct Shared {
    viewers: Mutex<Vec<Viewer>>,
    socket: UdpSocket,
    /// The addresses browsers are told to send to (all on the one socket).
    candidates: Vec<SocketAddr>,
    /// For a socket on every address: which of ours a sender's packets arrive at, remembered per sender.
    routes: Mutex<HashMap<IpAddr, IpAddr>>,
    /// A viewer needs a full picture: the next frame is forced to be one.
    want_keyframe: AtomicBool,
    keyframe_requests: AtomicU64,
    viewers_ever: AtomicU64,
    token: Option<String>,
    listen: IpAddr,
    stream: Mutex<Stream>,
    /// CONTROL (control.rs). When both are wanted, `viewers` is locked before this, never the other way round.
    control: Mutex<Control>,
    /// A League match is running on the PC (or the check pretends one is): kept here as well as in `stream` so
    /// the control path can read it without waiting for anything.
    match_running: AtomicBool,
}

impl Shared {
    /// Which of our addresses a packet from `source` arrived at. With one address there is no question. With the
    /// socket on every address, Windows does not say, so it is worked out: this PC itself reaches us on 127.0.0.1,
    /// and anyone else on the address Windows would use to send back to them.
    fn arrived_at(&self, source: SocketAddr) -> SocketAddr {
        if self.candidates.len() == 1 {
            return self.candidates[0];
        }
        let port = self.candidates[0].port();
        if source.ip().is_loopback() {
            return SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        }
        let mut routes = self.routes.lock().unwrap();
        let ours = *routes.entry(source.ip()).or_insert_with(|| {
            // "Connecting" a UDP socket sends nothing: it only makes Windows choose the address it would send from.
            let found = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).and_then(|probe| {
                probe.connect(source)?;
                probe.local_addr()
            });
            match found {
                Ok(local) if self.candidates.iter().any(|c| c.ip() == local.ip()) => local.ip(),
                _ => self.candidates.iter().map(|c| c.ip()).find(|ip| !ip.is_loopback()).unwrap_or(self.candidates[0].ip()),
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
    if let Some(id) = v.keys {
        if let Some(mut channel) = v.rtc.channel(id) {
            let _ = channel.write(true, &[control::STATE, what]);
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
fn network_loop(shared: Arc<Shared>) {
    let mut buf = vec![0u8; 2000];
    while !STOP.load(Ordering::SeqCst) {
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
        let ended = shared.control.lock().unwrap().watch(now, shared.match_running.load(Ordering::SeqCst), |id| viewers.iter().any(|v| v.id == id && v.rtc.is_alive() && v.keys.is_some()));
        if let Some((id, what)) = ended {
            if let Some(v) = viewers.iter_mut().find(|v| v.id == id && v.rtc.is_alive()) {
                say(v, what);
                pump(v, &shared, now);
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
        // We only ever answer: the browser finds us at the addresses below, we never go looking for it.
        .set_ice_lite(true)
        // H.264 only, since that is what the encoder makes.
        .clear_codecs()
        .enable_h264(true)
        // Lets each frame carry "show this at once" (http://www.webrtc.org/experiments/rtp-hdrext/playout-delay).
        .set_extension(5, Extension::PlayoutDelay)
        .set_stats_interval(None)
        .build(now);
    for address in &shared.candidates {
        let candidate = Candidate::host(*address, "udp").map_err(|why| ("500 Internal Server Error", format!("Bad local address {address}: {why}")))?;
        rtc.add_local_candidate(candidate);
    }
    let answer = rtc.sdp_api().accept_offer(offer).map_err(|why| ("400 Bad Request", format!("The offer could not be accepted: {why}")))?;

    let mut viewers = shared.viewers.lock().unwrap();
    if viewers.len() >= MAX_VIEWERS {
        return Err(("503 Service Unavailable", format!("{MAX_VIEWERS} viewers are already watching")));
    }
    let id = shared.viewers_ever.fetch_add(1, Ordering::Relaxed) + 1;
    viewers.push(Viewer { id, rtc, mid: None, pt: None, connected: false, started: false, since: now, last_heard: now, next_timeout: now, keys: None, pointer: None });
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
            let name = host.rsplit_once(':').map_or(host.as_str(), |(name, _port)| name);
            let ours = name == "localhost" || name.parse::<IpAddr>().map_or(false, |ip| ip.is_loopback() || ip == shared.listen);
            if !ours {
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
            let taken = settings::parse_flat(&String::from_utf8_lossy(&body)).and_then(|pairs| {
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

/// The stream's settings as the viewer page reads them: what was asked, what is really being sent, what the last
/// second measured, the screen, the limits in force and the PC's own, and whether a cap is on and why.
/// "applied" is false for the moment between a change being due (asked for, or a cap coming on or lifting) and the
/// encoding thread having made it: until then "sending" is still the old picture.
/// "control" is how control stands for the viewer asking: "off" (the PC was not started with --allow-control),
/// "free", "yours" or "another device"; "controlWhy" says why it cannot be taken when it cannot.
fn settings_json(shared: &Shared, viewer: Option<u64>) -> String {
    let watching = {
        let now = Instant::now();
        shared.viewers.lock().unwrap().iter().filter(|v| v.watching(now)).count()
    };
    let (control_stands, control_allowed, control_dry_run) = {
        let control = shared.control.lock().unwrap();
        (control.standing(viewer), control.allowed, control.dry_run)
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
        "{{\"shape\": {}, \"viewWidth\": {}, \"viewHeight\": {}, \"lines\": {}, \"fps\": {}, \"bitrateKbps\": {}}}",
        settings::quoted(asked.shape.name()),
        number_or_null(asked.view_width),
        number_or_null(asked.view_height),
        if asked.lines > 0 { asked.lines.to_string() } else { "\"native\"".to_string() },
        asked.fps,
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
        "{{\"asked\": {}, \"sending\": {}, \"measured\": {}, \"screen\": {{\"width\": {}, \"height\": {}, \"hz\": {}}}, \"limits\": {}, \"hostLimits\": {}, \"cap\": {}, \"capWhy\": {}, \"applied\": {}, \"refused\": {}, \"viewers\": {}, \"control\": \"{}\", \"controlWhy\": {}, \"controlDryRun\": {}}}",
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
        control_dry_run
    )
}

/// This PC's address on the home network: the one Windows would use to reach the wider world. Nothing is sent to
/// find it ("connecting" a UDP socket only picks the route). None when the PC has no network.
fn lan_address() -> Option<Ipv4Addr> {
    let probe = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // 192.0.2.1 is an address reserved for examples: nobody is there, and nothing is sent to it anyway.
    probe.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match probe.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local() => Some(ip),
        _ => None,
    }
}

/// Opens the native session that carries out a plan.
fn open_session(a: &Args, plan: &Plan) -> Result<native::Session, String> {
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
    };
    // Windows can take a moment to let go of a screen share that was only just closed, so a refusal is tried again.
    let mut last = String::new();
    for attempt in 0..4 {
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
    // One UDP socket carries every viewer. It follows `--listen`: on this PC only by default.
    let socket = match UdpSocket::bind((a.listen, a.udp_port)) {
        Ok(socket) => socket,
        Err(why) => {
            eprintln!("NOT SERVING. Could not open the video socket on {}:{} ({why})", a.listen, a.udp_port);
            return ExitCode::from(2);
        }
    };
    let udp_port = socket.local_addr().map(|address| address.port()).unwrap_or(a.udp_port);
    // The addresses a browser is told it can reach us at.
    let mut candidates = Vec::new();
    if a.listen.is_unspecified() {
        candidates.push(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), udp_port));
        if let Some(lan) = lan_address() {
            candidates.push(SocketAddr::new(IpAddr::V4(lan), udp_port));
        }
    } else {
        candidates.push(SocketAddr::new(a.listen, udp_port));
    }

    // The screen as it is now (only read: the engine never changes the PC's display mode), the PC's limits, and
    // how the stream starts before any viewer has asked for anything.
    let Some((screen_width, screen_height, screen_hz)) = native::screen() else {
        eprintln!("NOT SERVING. No main screen found");
        return ExitCode::from(2);
    };
    let screen_hz = if screen_hz > 0 { screen_hz } else { 60 };
    let host_limits = Limits {
        max_lines: a.max_lines.unwrap_or(screen_height).min(screen_height),
        max_fps: a.max_fps.unwrap_or(screen_hz).min(screen_hz),
        max_bitrate_kbps: a.max_bitrate,
    };
    let cut = a.width > 0;
    let asked = Asked {
        shape: if cut { Shape::Cut } else { a.shape },
        view_width: 0,
        view_height: 0,
        cut_width: a.width,
        cut_height: a.height,
        lines: if cut { 0 } else { a.lines },
        fps: a.fps,
        bitrate_kbps: a.bitrate,
    };
    let pretend = Pretend::from_environment();
    let pretending = pretend.asked_for();
    let capped_at_start = match_running(&pretend);
    let mut stream = Stream { asked, asks: 0, acted_on: 0, host_limits, capped: capped_at_start, acted_capped: capped_at_start, screen: (screen_width, screen_height, screen_hz), sending: None, refused: None, measured: None };

    let mut current = stream.plan();
    let mut session = match open_session(&a, &current) {
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
        candidates,
        routes: Mutex::new(HashMap::new()),
        want_keyframe: AtomicBool::new(false),
        keyframe_requests: AtomicU64::new(0),
        viewers_ever: AtomicU64::new(0),
        token: a.token.clone(),
        listen: a.listen,
        stream: Mutex::new(stream),
        control: Mutex::new(Control::new(a.allow_control, a.control_dry_run, first.region, (screen_width, screen_height))),
        match_running: AtomicBool::new(capped_at_start),
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
    let shown_host = if a.listen.is_unspecified() { shared.candidates.last().map_or("127.0.0.1".to_string(), |c| c.ip().to_string()) } else { a.listen.to_string() };
    println!("  open http://{}:{}/{} in Chrome or Edge", shown_host, a.port, if a.token.is_some() { "?token=<your token>" } else { "" });
    println!("  video leaves from {}", shared.candidates.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" and "));
    if !a.listen.is_loopback() {
        println!("  OPEN TO OTHER DEVICES on {}: anyone with the token sees this whole screen", a.listen);
    }
    if a.control_dry_run {
        println!("  CONTROL: DRY RUN. What a viewer does is only written down (GET /control-log); nothing reaches Windows.");
    } else if a.allow_control {
        println!("  CONTROL IS ALLOWED: one viewer at a time may use this PC's mouse and keys. Ctrl+Alt+Shift+End on this PC stops it.");
        println!("  It is refused while {} is running.", settings::MATCH_PROCESS);
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

    loop {
        if STOP.load(Ordering::SeqCst) || a.seconds.is_some_and(|s| started.elapsed() >= Duration::from_secs(s)) {
            break;
        }

        // What should be sent now, from what was asked and what the PC allows. When that is not what is being
        // sent, the native session is closed and opened again as the new plan says. Its first frame is a full
        // picture in the new size, and the viewers' connections carry on.
        let (wanted, asks, capped_now, screen_now) = {
            let stream = shared.stream.lock().unwrap();
            (stream.plan(), stream.asks, stream.capped, stream.screen)
        };
        if asks != asks_seen {
            refused_plan = None;
        }
        if wanted != current && refused_plan != Some(wanted) {
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
            match open_session(&a, &wanted) {
                Ok(opened) => {
                    let now_sending = sending_of(&opened.info, &wanted);
                    session = Some(opened);
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
                    match open_session(&a, &current) {
                        Ok(opened) => session = Some(opened),
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

        let frame = match session.as_mut().expect("a session is open whenever frames are asked for").next_frame(wait_ms, force) {
            Ok(frame) => frame,
            Err(why) => {
                // The screen share broke for good (the PC's screen changed size, say). The screen is looked at
                // afresh and the stream started again on it, once; a second break straight after ends the run.
                if last_restart.is_some_and(|at| at.elapsed() < Duration::from_secs(2)) {
                    failure = Some(why);
                    break;
                }
                last_restart = Some(Instant::now());
                println!("  the screen share broke ({why}): starting it again");
                session = None;
                let plan_again = {
                    let mut stream = shared.stream.lock().unwrap();
                    if let Some((width, height, hz)) = native::screen() {
                        stream.screen = (width, height, if hz > 0 { hz } else { stream.screen.2 });
                    }
                    current_screen = stream.screen;
                    stream.plan()
                };
                match open_session(&a, &plan_again) {
                    Ok(opened) => {
                        let now_sending = sending_of(&opened.info, &plan_again);
                        session = Some(opened);
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
        let rest = if a.tweaks & 16 != 0 { interval - (ticks_per_second * 3 / 1000).min(interval / 5) } else { interval * 95 / 100 };
        next_due = if frame.fresh { frame.acquired_time + rest } else { 0 };
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
                "  {:>4} s  {:>3} frames sent ({} new)   shown -> encoded {}   encoded -> network {}   {:>6.0} kbit/s",
                started.elapsed().as_secs(),
                second_frames,
                second_fresh,
                part(&second_shown),
                part(&second_handed),
                kbit_per_second
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
            second_started = Instant::now();
        }
    }
    if !idle {
        sending_time += second_started.elapsed();
    }
    drop(session);

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
    STOPPED.store(true, Ordering::SeqCst);
    if failure.is_some() {
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}
