//! `serve`: the live screen, encoded on the graphics card, sent to a web browser over WebRTC (SPEC-screens.md).
//!
//! Three threads share the work:
//! - this one grabs and encodes (the native session must stay on the thread that opened it) and hands each
//!   finished frame straight to the network itself, so a frame never waits for another thread to wake up;
//! - one listens on the UDP socket for what viewers send back (the handshake, "I lost a packet", "send a full
//!   picture") and keeps each connection's clock running;
//! - one answers the two web requests: the viewer page, and the "hello" (the browser's offer in, our answer out).
//!
//! WebRTC is the `str0m` crate, which does no networking or timing of its own: it is told the time and handed
//! packets, and it says what to send. Its one rule is kept everywhere here: after anything is done to a
//! connection, everything it wants to send is drained before the next thing is done to it (`pump`).
//!
//! Not done yet, on purpose: the bitrate is fixed (`--bitrate`), nothing watches the line and adjusts it.

use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::format::Codec;
use str0m::media::{MediaKind, MediaTime, Mid, Pt, Writer};
use str0m::net::{Protocol, Receive};
use str0m::rtp::Extension;
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc};

use crate::native;
use crate::{json, line, stats};

pub const USAGE: &str = "[--width 1920 --height 1080] [--fps 60] [--bitrate 20000] [--preset 1] [--tweaks 13] [--intra-refresh] [--port 8478] [--udp-port 0] [--listen 127.0.0.1] [--token text] [--seconds N]";

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

extern "system" {
    fn SetConsoleCtrlHandler(handler: Option<unsafe extern "system" fn(u32) -> i32>, add: i32) -> i32;
}

unsafe extern "system" fn on_console_event(_kind: u32) -> i32 {
    STOP.store(true, Ordering::SeqCst);
    1
}

struct Args {
    width: i32,
    height: i32,
    fps: i32,
    bitrate: i32,
    preset: i32,
    tweaks: i32,
    intra: bool,
    port: u16,
    udp_port: u16,
    listen: IpAddr,
    token: Option<String>,
    seconds: Option<u64>,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args {
        width: 1920,
        height: 1080,
        fps: 60,
        bitrate: 20000,
        preset: 1,
        tweaks: native::DEFAULT_TWEAKS,
        intra: false,
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
            "--fps" => a.fps = value()?.parse().map_err(|_| "--fps is a number")?,
            "--bitrate" => a.bitrate = value()?.parse().map_err(|_| "--bitrate is a number (kbit/s)")?,
            "--preset" => a.preset = value()?.parse().map_err(|_| "--preset is 1 to 7")?,
            "--tweaks" => a.tweaks = value()?.parse().map_err(|_| "--tweaks is a number")?,
            "--port" => a.port = value()?.parse().map_err(|_| "--port is a number from 1 to 65535")?,
            "--udp-port" => a.udp_port = value()?.parse().map_err(|_| "--udp-port is a number from 0 (any) to 65535")?,
            "--listen" => a.listen = value()?.parse().map_err(|_| "--listen is an IPv4 address, such as 127.0.0.1 or 0.0.0.0")?,
            "--token" => a.token = Some(value()?),
            "--seconds" => a.seconds = Some(value()?.parse().map_err(|_| "--seconds is a number")?),
            "--intra-refresh" => a.intra = true,
            other => return Err(format!("unknown option {other}")),
        }
        i += 1;
    }
    if a.fps < 1 || a.fps > 240 {
        return Err("--fps must be between 1 and 240".into());
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

fn on_event(v: &mut Viewer, shared: &Shared, event: Event) {
    match event {
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
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
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
fn hello(shared: &Shared, offer_text: &str) -> Result<String, (&'static str, String)> {
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
    viewers.push(Viewer { id, rtc, mid: None, pt: None, connected: false, started: false, since: now, last_heard: now, next_timeout: now });
    Ok(answer.to_sdp_string())
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

    match (method, path) {
        ("GET", "/") => respond(&mut stream, "200 OK", "text/html; charset=utf-8", VIEWER_PAGE.as_bytes()),
        ("POST", "/offer") => {
            // Asking for this content type makes a browser check with us before another website's page may send
            // an offer at all, and we never say yes to that check.
            if !content_type.starts_with("application/sdp") {
                return refuse(&mut stream, "415 Unsupported Media Type", "Send the offer as application/sdp");
            }
            if content_length == 0 || content_length > 64 * 1024 {
                return refuse(&mut stream, "413 Payload Too Large", "An offer is between 1 byte and 64 KB");
            }
            let mut body = data[head_end + 4..].to_vec();
            while body.len() < content_length {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => body.extend_from_slice(&chunk[..n]),
                }
            }
            body.truncate(content_length);
            match hello(shared, &String::from_utf8_lossy(&body)) {
                Ok(answer) => respond(&mut stream, "201 Created", "application/sdp", answer.as_bytes()),
                Err((status, why)) => refuse(&mut stream, status, &why),
            }
        }
        (_, "/") | (_, "/offer") => refuse(&mut stream, "405 Method Not Allowed", "GET / for the page, POST /offer for the hello"),
        _ => refuse(&mut stream, "404 Not Found", "Nothing here"),
    }
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

    let mut session = match native::Session::open(&native::Options {
        width: a.width,
        height: a.height,
        fps: a.fps,
        bitrate_kbps: a.bitrate,
        hevc: false,
        intra_refresh: a.intra,
        preset: a.preset,
        tweaks: a.tweaks,
        skip_pointer_only: true,
    }) {
        Ok(session) => session,
        Err(why) => {
            eprintln!("NOT SERVING. {why}");
            return ExitCode::from(2);
        }
    };

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
    });
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

    let info = &session.info;
    let (encode_width, encode_height) = (info.encode_width, info.encode_height);
    let ticks_per_second = info.ticks_per_second;
    println!();
    println!("DEBASER ENGINE :: serve");
    println!(
        "  screen {}x{} at {} Hz; sending {}x{} H.264 at up to {} fps, {} kbit/s (fixed), preset P{}{}, tweaks {}",
        info.screen_width,
        info.screen_height,
        info.screen_hz,
        encode_width,
        encode_height,
        a.fps,
        a.bitrate,
        a.preset,
        if a.intra { ", gradual repair on" } else { "" },
        a.tweaks
    );
    let shown_host = if a.listen.is_unspecified() { shared.candidates.last().map_or("127.0.0.1".to_string(), |c| c.ip().to_string()) } else { a.listen.to_string() };
    println!("  open http://{}:{}/{} in Chrome or Edge", shown_host, a.port, if a.token.is_some() { "?token=<your token>" } else { "" });
    println!("  video leaves from {}", shared.candidates.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(" and "));
    if !a.listen.is_loopback() {
        println!("  OPEN TO OTHER DEVICES on {}: anyone with the token sees this whole screen", a.listen);
    }
    println!("  waiting for a viewer (Ctrl+C stops)");

    let started = Instant::now();
    let interval = (ticks_per_second / a.fps as i64).max(1);
    let wait_ms = (1000 / a.fps).max(1);
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

    loop {
        if STOP.load(Ordering::SeqCst) || a.seconds.is_some_and(|s| started.elapsed() >= Duration::from_secs(s)) {
            break;
        }
        // Nobody watching: nothing is grabbed or encoded, so the graphics card is left alone.
        let watching = {
            let now = Instant::now();
            shared.viewers.lock().unwrap().iter().filter(|v| v.watching(now)).count()
        };
        if watching == 0 {
            if !idle {
                println!("  waiting for a viewer");
            }
            idle = true;
            thread::sleep(Duration::from_millis(20));
            second_started = Instant::now();
            continue;
        }

        // No faster than `--fps` (give or take 5%), however fast the screen changes: after a new frame, the next
        // is not looked for until almost one frame's time has passed. "Almost", so that when the screen changes at
        // about `--fps` itself we are already waiting when its next frame arrives and take it at once; a strict
        // beat of our own would leave every frame sitting for up to a whole frame's time first. A screen that
        // changes faster than that gives up its newest picture each time, which is then up to one of its own
        // frames old.
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

        let frame = match session.next_frame(wait_ms, force) {
            Ok(frame) => frame,
            Err(why) => {
                failure = Some(why);
                break;
            }
        };
        // After a repeat nothing is held back: the next real change is taken the moment it shows, so a still screen
        // answers a key press at once. (The wait inside `next_frame` already spaces repeats out.)
        next_due = if frame.fresh { frame.acquired_time + interval * 95 / 100 } else { 0 };
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
            println!(
                "  {:>4} s  {:>3} frames sent ({} new)   shown -> encoded {}   encoded -> network {}   {:>6.0} kbit/s",
                started.elapsed().as_secs(),
                second_frames,
                second_fresh,
                part(&second_shown),
                part(&second_handed),
                second_bytes as f64 * 8.0 / 1000.0 / took.as_secs_f64()
            );
            second_shown.clear();
            second_handed.clear();
            (second_frames, second_fresh, second_bytes) = (0, 0, 0);
            second_started = Instant::now();
        }
    }
    if !idle {
        sending_time += second_started.elapsed();
    }

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
    println!("  full pictures sent {}; times a browser asked for one {}", keyframes_sent, requests);
    println!("{}", line("encode, changed frames only", &s_encode));
    println!("{}", line("Windows showed it -> encoded", &s_shown));
    println!("{}", line("encoded -> handed to the network", &s_handed));
    println!("  {:.0} kbit/s of video on average while sending (asked for {}); bitrate is fixed, nothing adjusts it to the line yet", kbps, a.bitrate);
    println!(
        "  json: {{\"kind\": \"serve\", \"encode\": \"{}x{}\", \"fps\": {}, \"bitrateKbps\": {}, \"tweaks\": {}, \"seconds\": {:.1}, \"viewers\": {}, \"framesSent\": {}, \"freshFrames\": {}, \"keyframesSent\": {}, \"keyframeRequests\": {}, \"sentKbps\": {:.0}, {}, {}, {}}}",
        encode_width,
        encode_height,
        a.fps,
        a.bitrate,
        a.tweaks,
        started.elapsed().as_secs_f64(),
        viewers,
        frames_sent,
        fresh_sent,
        keyframes_sent,
        requests,
        kbps,
        json("encodeChangedOnly", &s_encode),
        json("presentToEncoded", &s_shown),
        json("encodedToNetwork", &s_handed)
    );

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
    if failure.is_some() {
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}
