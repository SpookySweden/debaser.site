//! THROUGH THE SITE: the slowest way to watch, for a network where nothing direct gets through (SPEC-screens.md,
//! "Away from home with no setup"; Luke, 2026-11-28: "okay but make sure it doesnt cost and look into it", then
//! "Build, capped, 20 GB (Recommended)").
//!
//! Here the viewer is not a browser sending packets to this PC. It is ONE plain line held by the site's own gateway
//! on SERVER (`scripts/host/screens-site-gateway.cjs`), which passes everything on to the browser inside the site's
//! ordinary connection. The gateway asks this engine's web address `GET /site` (with the engine's key, like every
//! other request) and `Upgrade: debaser-site`; the engine answers `101` with the viewer's number, and from then on
//! both ends send messages on that line:
//!
//!   4 bytes: how long the rest is; 1 byte: what it is; then its contents.
//!
//!   From the engine:  1  a frame            8 bytes: its place in time, 90,000 to the second; then H.264 as encoded
//!                     2  a full picture     the same
//!                     3  sound              8 bytes: its place in time, 48,000 to the second; then one Opus packet
//!                     4  the PC's words     exactly what a browser gets on WebRTC's "keys" channel (control.rs,
//!                                           pointer.rs: control's state, the controller, sound, the pointer)
//!   To the engine:    16 the page's bytes for "keys"       exactly what a browser writes on that channel
//!                     17 the page's bytes for "pointer"    the same
//!                     18 "send a full picture"             (nothing more)
//!                     19 "the viewer is still watching"    (nothing more; the gateway sends it twice a second for
//!                                                          as long as it keeps hearing from the browser)
//!
//! A line is never a queue. A plain line delivers everything in order however late, so what may wait is kept short:
//! a few frames at most. When more than that is waiting, all of the picture still waiting is thrown away, and the
//! viewer starts again from the next full picture (which is asked for at once). Sound that cannot leave now is
//! skipped. So a slow line shows as a skip, never as a picture that falls further and further behind.
//!
//! This file knows nothing of control, sound or the pointer: it carries bytes. `serve.rs` joins it to the rest.

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const FRAME: u8 = 1;
pub const FULL_PICTURE: u8 = 2;
pub const SOUND: u8 = 3;
pub const SAYS: u8 = 4;
pub const KEYS: u8 = 16;
pub const POINTER: u8 = 17;
pub const FULL_PICTURE_PLEASE: u8 = 18;
pub const STILL_WATCHING: u8 = 19;

/// How many may watch this way at once (the gateway holds one line for each).
pub const MAX_LINES: usize = 2;
/// The longest message the gateway may send: control's messages are a few bytes each.
const MOST_FROM_THE_GATEWAY: usize = 64 * 1024;
/// How much of the picture may wait to leave: this many frames, or this many bytes, and no more.
const WAITING_FRAMES: usize = 3;
const WAITING_BYTES: usize = 256 * 1024;
/// How much sound may wait: a tenth of a second.
const WAITING_SOUND: usize = 10;
/// The PC's words are a few bytes each and never skipped; a line with this many waiting is not being read at all.
const WAITING_WORDS: usize = 256;
/// A viewer is watching while "still watching" keeps coming (twice a second); after this long without, it is not.
const WATCHING_FOR: Duration = Duration::from_millis(1500);
/// A line that has said nothing at all for this long has gone (SERVER lost its power, say). Longer than the ten
/// seconds the gateway itself gives a silent browser before it closes the line and says why.
const SILENCE: Duration = Duration::from_secs(15);

/// One message for the line, its contents given in parts so nothing is copied twice.
pub fn message(kind: u8, parts: &[&[u8]]) -> Vec<u8> {
    let length: usize = 1 + parts.iter().map(|part| part.len()).sum::<usize>();
    let mut out = Vec::with_capacity(4 + length);
    out.extend_from_slice(&(length as u32).to_be_bytes());
    out.push(kind);
    for part in parts {
        out.extend_from_slice(part);
    }
    out
}

/// Takes the line's bytes as they come and gives back the whole messages in them; what is left over waits for the
/// next bytes.
#[derive(Default)]
pub struct Reader {
    waiting: Vec<u8>,
}

impl Reader {
    /// The whole messages now in hand: what each is, and its contents. An error when the bytes cannot be the
    /// gateway's (a message longer than it ever sends): the line is then closed.
    pub fn take(&mut self, bytes: &[u8]) -> Result<Vec<(u8, Vec<u8>)>, String> {
        self.waiting.extend_from_slice(bytes);
        let mut whole = Vec::new();
        let mut at = 0usize;
        loop {
            if self.waiting.len() - at < 4 {
                break;
            }
            let length = u32::from_be_bytes([self.waiting[at], self.waiting[at + 1], self.waiting[at + 2], self.waiting[at + 3]]) as usize;
            if length < 1 || length > MOST_FROM_THE_GATEWAY {
                return Err(format!("a message of {length} bytes is not one the site's gateway sends"));
            }
            if self.waiting.len() - at < 4 + length {
                break;
            }
            whole.push((self.waiting[at + 4], self.waiting[at + 5..at + 4 + length].to_vec()));
            at += 4 + length;
        }
        self.waiting.drain(..at);
        Ok(whole)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum What {
    Picture,
    Sound,
    Words,
}

/// What is waiting to leave for one viewer.
struct Outbox {
    waiting: VecDeque<(What, Vec<u8>)>,
    pictures: usize,
    picture_bytes: usize,
    sounds: usize,
    words: usize,
    /// It has been handed a full picture, so the frames after it make sense to it.
    started: bool,
    closed: bool,
}

/// What a viewer has said and been told.
struct State {
    last_beat: Instant,
    wants_sound: bool,
    /// The PC's pointer: the number of the last shape it was sent, and whether it was last told the pointer shows.
    shape_told: u16,
    shown_told: Option<bool>,
}

/// What became of a frame offered to a viewer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Offered {
    /// It waits to leave, behind at most a few others.
    Queued,
    /// Not sent: the viewer is not watching, or is waiting for a full picture.
    Skipped,
    /// Not sent, and the line had just fallen behind: what was waiting has been thrown away, and a full picture is
    /// to be asked for.
    FellBehind,
}

/// One viewer watching through the site: the line the gateway holds for it.
pub struct Line {
    pub id: u64,
    outbox: Mutex<Outbox>,
    ready: Condvar,
    state: Mutex<State>,
}

impl Line {
    fn new(id: u64, now: Instant) -> Line {
        Line {
            id,
            outbox: Mutex::new(Outbox { waiting: VecDeque::new(), pictures: 0, picture_bytes: 0, sounds: 0, words: 0, started: false, closed: false }),
            ready: Condvar::new(),
            state: Mutex::new(State { last_beat: now, wants_sound: false, shape_told: 0, shown_told: None }),
        }
    }

    pub fn closed(&self) -> bool {
        let out = self.outbox.lock().unwrap();
        out.closed
    }

    /// Ends the line: nothing more is taken for it, and what was waiting is dropped.
    pub fn close(&self) {
        {
            let mut out = self.outbox.lock().unwrap();
            out.closed = true;
            out.waiting.clear();
        }
        self.ready.notify_all();
    }

    /// "The viewer is still watching", from the gateway. Returns whether it had gone quiet before this (it then
    /// needs a full picture to pick up from).
    pub fn beat(&self, now: Instant) -> bool {
        let mut state = self.state.lock().unwrap();
        let back = now.saturating_duration_since(state.last_beat) >= WATCHING_FOR;
        state.last_beat = now;
        back
    }

    /// The line is open and its browser was heard from lately: frames go to it.
    pub fn watching(&self, now: Instant) -> bool {
        if self.closed() {
            return false;
        }
        let state = self.state.lock().unwrap();
        now.saturating_duration_since(state.last_beat) < WATCHING_FOR
    }

    pub fn want_sound(&self, wanted: bool) {
        let mut state = self.state.lock().unwrap();
        state.wants_sound = wanted;
    }

    /// It asked for the PC's sound and is watching.
    pub fn listening(&self, now: Instant) -> bool {
        let wanted = {
            let state = self.state.lock().unwrap();
            state.wants_sound
        };
        wanted && self.watching(now)
    }

    /// One encoded frame, on its way to this viewer or not (the rule at the top of this file).
    pub fn frame(&self, data: &[u8], keyframe: bool, time: u64, now: Instant) -> Offered {
        let watching = self.watching(now);
        let mut out = self.outbox.lock().unwrap();
        if out.closed {
            return Offered::Skipped;
        }
        if !watching {
            // Gone quiet (a closed tab, a dropped line): it has missed frames, so it starts again from a full picture.
            out.started = false;
            return Offered::Skipped;
        }
        let mut fell_behind = false;
        if out.pictures >= WAITING_FRAMES || out.picture_bytes > WAITING_BYTES {
            out.waiting.retain(|(what, _)| *what != What::Picture);
            out.pictures = 0;
            out.picture_bytes = 0;
            fell_behind = out.started;
            out.started = false;
        }
        // A viewer can only start from a full picture.
        if !out.started && !keyframe {
            return if fell_behind { Offered::FellBehind } else { Offered::Skipped };
        }
        out.started = true;
        let bytes = message(if keyframe { FULL_PICTURE } else { FRAME }, &[&time.to_be_bytes()[..], data]);
        out.pictures += 1;
        out.picture_bytes += bytes.len();
        out.waiting.push_back((What::Picture, bytes));
        drop(out);
        self.ready.notify_one();
        Offered::Queued
    }

    /// One Opus packet (10 ms of sound), when this viewer asked for sound. Returns whether it was taken.
    pub fn sound(&self, packet: &[u8], samples_before: u64, now: Instant) -> bool {
        if !self.listening(now) {
            return false;
        }
        let mut out = self.outbox.lock().unwrap();
        // Sound that cannot leave now is sound nobody needs later.
        if out.closed || out.sounds >= WAITING_SOUND {
            return false;
        }
        out.sounds += 1;
        out.waiting.push_back((What::Sound, message(SOUND, &[&samples_before.to_be_bytes()[..], packet])));
        drop(out);
        self.ready.notify_one();
        true
    }

    /// One of the PC's messages to the viewer's page, exactly as a browser would get it on "keys". Never skipped;
    /// a line with a great many of them waiting is not being read, and is closed.
    pub fn say(&self, words: &[u8]) -> bool {
        let mut out = self.outbox.lock().unwrap();
        if out.closed {
            return false;
        }
        if out.words >= WAITING_WORDS {
            out.closed = true;
            out.waiting.clear();
            drop(out);
            self.ready.notify_all();
            return false;
        }
        out.words += 1;
        out.waiting.push_back((What::Words, message(SAYS, &[words])));
        drop(out);
        self.ready.notify_one();
        true
    }

    /// Sends whatever this viewer has not yet been told about the PC's pointer: the newest shape (its number and
    /// ready-made message), and whether the pointer is showing (and the ready-made message for that).
    pub fn tell_pointer(&self, number: u16, shape: Option<&[u8]>, shown: Option<(bool, [u8; 2])>) {
        let (shape_told, shown_told) = {
            let state = self.state.lock().unwrap();
            (state.shape_told, state.shown_told)
        };
        if let Some(shape) = shape {
            if shape_told != number && self.say(shape) {
                let mut state = self.state.lock().unwrap();
                state.shape_told = number;
            }
        }
        if let Some((is_shown, words)) = shown {
            if shown_told != Some(is_shown) && self.say(&words) {
                let mut state = self.state.lock().unwrap();
                state.shown_told = Some(is_shown);
            }
        }
    }

    /// The sending thread's wait: the next thing to put on the line, or None once the line has closed.
    fn next(&self) -> Option<Vec<u8>> {
        let mut out = self.outbox.lock().unwrap();
        loop {
            if out.closed {
                return None;
            }
            if let Some((what, bytes)) = out.waiting.pop_front() {
                match what {
                    What::Picture => {
                        out.pictures = out.pictures.saturating_sub(1);
                        out.picture_bytes = out.picture_bytes.saturating_sub(bytes.len());
                    }
                    What::Sound => out.sounds = out.sounds.saturating_sub(1),
                    What::Words => out.words = out.words.saturating_sub(1),
                }
                return Some(bytes);
            }
            let (again, _) = self.ready.wait_timeout(out, Duration::from_millis(250)).unwrap();
            out = again;
        }
    }

    /// For the tests: what each waiting message is, in order.
    #[cfg(test)]
    fn waiting(&self) -> Vec<u8> {
        let out = self.outbox.lock().unwrap();
        out.waiting.iter().map(|(_, bytes)| bytes[4]).collect()
    }
}

/// Every viewer watching through the site. Its lock is held only to read or change the list; the one thing asked
/// for while it is held is a line's own "has it closed" (when a new viewer joins), and a line never asks for the list.
#[derive(Default)]
pub struct Lines {
    lines: Mutex<Vec<Arc<Line>>>,
}

impl Lines {
    fn all(&self) -> Vec<Arc<Line>> {
        let lines = self.lines.lock().unwrap();
        lines.clone()
    }

    /// A new viewer, numbered by the caller; None when as many as may watch this way already are.
    pub fn join(&self, id: u64, now: Instant) -> Option<Arc<Line>> {
        let mut lines = self.lines.lock().unwrap();
        lines.retain(|line| !line.closed());
        if lines.len() >= MAX_LINES {
            return None;
        }
        let line = Arc::new(Line::new(id, now));
        lines.push(line.clone());
        Some(line)
    }

    pub fn leave(&self, id: u64) {
        let mut lines = self.lines.lock().unwrap();
        lines.retain(|line| line.id != id);
    }

    /// How many lines are open, watched just now or not: while there is one, the picture is held to this way's cap.
    pub fn connected(&self) -> usize {
        self.all().iter().filter(|line| !line.closed()).count()
    }

    pub fn watching(&self, now: Instant) -> usize {
        self.all().iter().filter(|line| line.watching(now)).count()
    }

    pub fn listeners(&self, now: Instant) -> usize {
        self.all().iter().filter(|line| line.listening(now)).count()
    }

    pub fn alive(&self, id: u64) -> bool {
        self.all().iter().any(|line| line.id == id && !line.closed())
    }

    /// Hands one encoded frame to every viewer watching this way. Returns how many it went to, and whether a full
    /// picture is to be asked for (a line had fallen behind).
    pub fn frame(&self, data: &[u8], keyframe: bool, time: u64, now: Instant) -> (usize, bool) {
        let mut went_to = 0;
        let mut want_full = false;
        for line in self.all() {
            match line.frame(data, keyframe, time, now) {
                Offered::Queued => went_to += 1,
                Offered::Skipped => {}
                Offered::FellBehind => {
                    println!("  viewer {} (through the site) fell behind: what was waiting is dropped, and it starts again from a full picture", line.id);
                    want_full = true;
                }
            }
        }
        (went_to, want_full)
    }

    /// Hands one Opus packet to every viewer this way that asked for sound. Returns how many took it.
    pub fn sound(&self, packet: &[u8], samples_before: u64, now: Instant) -> usize {
        self.all().iter().filter(|line| line.sound(packet, samples_before, now)).count()
    }

    /// Says something to one viewer, if it is watching this way. Returns whether it was.
    pub fn say(&self, id: u64, words: &[u8]) -> bool {
        self.all().iter().any(|line| line.id == id && line.say(words))
    }

    pub fn tell_pointer(&self, number: u16, shape: Option<&[u8]>, shown: Option<(bool, [u8; 2])>) {
        for line in self.all() {
            line.tell_pointer(number, shape, shown);
        }
    }
}

/// Runs one line from the moment the request for it has been let in until it ends: says `hello` (the `101` answer),
/// then sends whatever is handed to `line` and passes each message from the gateway to `heard`. `leftover` is
/// whatever arrived behind the request itself. Returns why it ended, for the console.
pub fn run(mut stream: TcpStream, hello: &str, leftover: &[u8], line: &Arc<Line>, stopping: &dyn Fn() -> bool, heard: &mut dyn FnMut(u8, &[u8])) -> &'static str {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    if stream.write_all(hello.as_bytes()).is_err() {
        line.close();
        return "the site's gateway had already gone";
    }
    let mut writing = match stream.try_clone() {
        Ok(writing) => writing,
        Err(_) => {
            line.close();
            return "the line could not be opened both ways";
        }
    };
    let writer = {
        let line = line.clone();
        thread::spawn(move || {
            while let Some(bytes) = line.next() {
                if writing.write_all(&bytes).is_err() {
                    break;
                }
            }
            line.close();
            let _ = writing.shutdown(Shutdown::Both);
        })
    };

    let mut reader = Reader::default();
    let mut chunk = [0u8; 4096];
    let mut input: Vec<u8> = leftover.to_vec();
    let mut last_heard = Instant::now();
    let mut why = "the site's gateway closed the line";
    loop {
        if !input.is_empty() {
            match reader.take(&input) {
                Ok(messages) => {
                    for (kind, contents) in &messages {
                        heard(*kind, contents.as_slice());
                    }
                }
                Err(_) => {
                    why = "the line carried something that is not the site's gateway's";
                    break;
                }
            }
            input.clear();
            last_heard = Instant::now();
        }
        if stopping() {
            why = "the engine is stopping";
            break;
        }
        if line.closed() {
            why = "the line broke, or was not being read";
            break;
        }
        if last_heard.elapsed() > SILENCE {
            why = "the site's gateway went silent";
            break;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => input.extend_from_slice(&chunk[..n]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => {
                why = "the line broke";
                break;
            }
        }
    }
    line.close();
    let _ = stream.shutdown(Shutdown::Both);
    let _ = writer.join();
    why
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn a_message_is_read_back_whole_however_the_bytes_arrive() {
        let a = message(FULL_PICTURE, &[&9000u64.to_be_bytes()[..], &b"picture"[..]]);
        assert_eq!(&a[..5], &[0, 0, 0, 16, 2]);
        assert_eq!(&a[5..13], &9000u64.to_be_bytes());
        assert_eq!(&a[13..], b"picture");
        let b = message(STILL_WATCHING, &[]);
        assert_eq!(b, [0, 0, 0, 1, 19]);
        let all = [a.clone(), b.clone(), message(KEYS, &[&[1u8, 2, 3][..]])].concat();
        let mut reader = Reader::default();
        let mut got = Vec::new();
        for piece in all.chunks(3) {
            got.extend(reader.take(piece).expect("the gateway's own bytes"));
        }
        assert_eq!(got, vec![(FULL_PICTURE, a[5..].to_vec()), (STILL_WATCHING, Vec::new()), (KEYS, vec![1, 2, 3])]);
        // A length the gateway never sends: not the gateway. So is a length of nothing.
        assert!(Reader::default().take(&(5u32 * 1024 * 1024).to_be_bytes()).is_err());
        assert!(Reader::default().take(&[0, 0, 0, 0]).is_err());
    }

    #[test]
    fn a_viewer_starts_from_a_full_picture() {
        let now = Instant::now();
        let line = Line::new(7, now);
        assert_eq!(line.frame(b"delta", false, 1, now), Offered::Skipped);
        assert_eq!(line.waiting(), Vec::<u8>::new());
        assert_eq!(line.frame(b"full", true, 2, now), Offered::Queued);
        assert_eq!(line.frame(b"delta", false, 3, now), Offered::Queued);
        assert_eq!(line.waiting(), vec![FULL_PICTURE, FRAME]);
        let first = line.next().expect("the full picture");
        assert_eq!(&first[5..13], &2u64.to_be_bytes());
        assert_eq!(&first[13..], b"full");
        assert_eq!(line.next().expect("the frame after it")[4], FRAME);
    }

    #[test]
    fn a_line_that_falls_behind_drops_what_waits_and_starts_again_from_a_full_picture() {
        let now = Instant::now();
        let line = Line::new(7, now);
        assert!(line.say(&[0x80, 0]));
        assert_eq!(line.frame(b"full", true, 1, now), Offered::Queued);
        assert_eq!(line.frame(b"a", false, 2, now), Offered::Queued);
        assert_eq!(line.frame(b"b", false, 3, now), Offered::Queued);
        // Nothing is reading: three frames wait. The fourth is not added behind them: all the picture waiting goes.
        assert_eq!(line.frame(b"c", false, 4, now), Offered::FellBehind);
        assert_eq!(line.waiting(), vec![SAYS], "the PC's words are never dropped");
        // It is asked for once, not at every frame; ordinary frames are skipped until the full picture comes.
        assert_eq!(line.frame(b"d", false, 5, now), Offered::Skipped);
        assert_eq!(line.frame(b"full", true, 6, now), Offered::Queued);
        assert_eq!(line.frame(b"e", false, 7, now), Offered::Queued);
        assert_eq!(line.waiting(), vec![SAYS, FULL_PICTURE, FRAME]);
        // Too many bytes waiting counts the same as too many frames.
        let wide = Line::new(8, now);
        let big = vec![0u8; WAITING_BYTES + 1];
        assert_eq!(wide.frame(&big, true, 1, now), Offered::Queued);
        assert_eq!(wide.frame(b"a", false, 2, now), Offered::FellBehind);
        assert_eq!(wide.waiting(), Vec::<u8>::new());
        // A full picture arriving at that very moment is taken at once, in place of what was waiting.
        let lucky = Line::new(9, now);
        assert_eq!(lucky.frame(&big, true, 1, now), Offered::Queued);
        assert_eq!(lucky.frame(b"full", true, 2, now), Offered::Queued);
        assert_eq!(lucky.waiting(), vec![FULL_PICTURE]);
        assert_eq!(&lucky.next().expect("the new full picture")[13..], b"full");
    }

    #[test]
    fn a_viewer_gone_quiet_is_sent_nothing_and_starts_again_when_it_is_back() {
        let began = Instant::now();
        let line = Line::new(7, began);
        assert!(line.watching(began));
        assert_eq!(line.frame(b"full", true, 1, began), Offered::Queued);
        // Still watching while the gateway keeps saying so.
        let later = began + Duration::from_millis(1000);
        assert!(!line.beat(later), "it had not gone quiet");
        assert!(line.watching(later + Duration::from_millis(1400)));
        // Two seconds with nothing: not watching. Not even a full picture is put on its line.
        let quiet = later + Duration::from_millis(2000);
        assert!(!line.watching(quiet));
        assert_eq!(line.frame(b"full", true, 2, quiet), Offered::Skipped);
        assert_eq!(line.waiting(), vec![FULL_PICTURE], "only the one from before");
        // Back: the caller is told it had gone quiet (and asks for a full picture), and it starts from that.
        assert!(line.beat(quiet), "it had gone quiet");
        assert_eq!(line.frame(b"delta", false, 3, quiet), Offered::Skipped);
        assert_eq!(line.frame(b"full", true, 4, quiet), Offered::Queued);
    }

    #[test]
    fn sound_goes_only_to_those_who_asked_and_never_piles_up() {
        let now = Instant::now();
        let line = Line::new(7, now);
        assert!(!line.sound(b"opus", 480, now), "not asked for");
        line.want_sound(true);
        assert!(line.listening(now));
        for n in 0..WAITING_SOUND {
            assert!(line.sound(b"opus", 480 * n as u64, now));
        }
        assert!(!line.sound(b"opus", 9999, now), "a tenth of a second is waiting: this packet is skipped, not kept");
        let first = line.next().expect("sound");
        assert_eq!(first[4], SOUND);
        assert_eq!(&first[5..13], &0u64.to_be_bytes());
        assert_eq!(&first[13..], b"opus");
        assert!(line.sound(b"opus", 9999, now), "room again");
        line.want_sound(false);
        assert!(!line.sound(b"opus", 9999, now));
        // Not watching: no sound either.
        line.want_sound(true);
        assert!(!line.sound(b"opus", 9999, now + Duration::from_secs(3)));
    }

    #[test]
    fn the_pointer_is_told_once() {
        let now = Instant::now();
        let line = Line::new(7, now);
        line.tell_pointer(0, None, None);
        assert_eq!(line.waiting(), Vec::<u8>::new(), "nothing known yet: nothing said");
        line.tell_pointer(1, Some(&b"shape one"[..]), Some((true, [0x82, 1])));
        line.tell_pointer(1, Some(&b"shape one"[..]), Some((true, [0x82, 1])));
        assert_eq!(line.waiting(), vec![SAYS, SAYS], "the shape and that it shows, once each");
        line.tell_pointer(2, Some(&b"shape two"[..]), Some((true, [0x82, 1])));
        line.tell_pointer(2, Some(&b"shape two"[..]), Some((false, [0x82, 0])));
        assert_eq!(line.waiting().len(), 4, "a new shape, then hidden");
        assert_eq!(&line.next().expect("the first shape")[5..], b"shape one");
    }

    #[test]
    fn only_so_many_watch_this_way_at_once() {
        let now = Instant::now();
        let lines = Lines::default();
        let first = lines.join(1, now).expect("the first");
        let _second = lines.join(2, now).expect("the second");
        assert!(lines.join(3, now).is_none());
        assert_eq!((lines.connected(), lines.watching(now), lines.listeners(now)), (2, 2, 0));
        assert!(lines.alive(1) && !lines.alive(3));
        // A full picture goes to both; one that has closed makes room.
        assert_eq!(lines.frame(b"full", true, 1, now), (2, false));
        first.close();
        assert_eq!(lines.connected(), 1);
        assert!(!lines.alive(1));
        assert!(lines.join(3, now).is_some());
        lines.leave(2);
        assert_eq!(lines.connected(), 1);
        assert!(lines.say(3, &[0x80, 1]) && !lines.say(2, &[0x80, 1]));
        lines.leave(3);
        assert_eq!(lines.connected(), 0);
    }

    /// The whole line over a real connection on this PC: the hello, messages both ways, and its end.
    #[test]
    fn a_line_runs_both_ways_until_the_gateway_closes_it() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port on this PC");
        let address = listener.local_addr().unwrap();
        let lines = Arc::new(Lines::default());
        let line = lines.join(5, Instant::now()).expect("a line");
        let heard_all: Arc<Mutex<Vec<(u8, Vec<u8>)>>> = Arc::new(Mutex::new(Vec::new()));
        let engine_end = {
            let line = line.clone();
            let heard_all = heard_all.clone();
            thread::spawn(move || {
                let (stream, _) = listener.accept().expect("the gateway");
                let stopping = || false;
                let mut heard = |kind: u8, contents: &[u8]| heard_all.lock().unwrap().push((kind, contents.to_vec()));
                // Two bytes of the gateway's first message arrived behind its request.
                run(stream, "HELLO\r\n\r\n", &[0, 0], &line, &stopping, &mut heard)
            })
        };
        let mut gateway = TcpStream::connect(address).expect("the engine");
        gateway.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut hello = [0u8; 9];
        gateway.read_exact(&mut hello).expect("the hello");
        assert_eq!(&hello, b"HELLO\r\n\r\n");
        // The rest of that first message (the page's bytes for "keys"), then two more.
        gateway.write_all(&[0, 3, KEYS, 0x30, 1]).unwrap();
        gateway.write_all(&message(STILL_WATCHING, &[])).unwrap();
        gateway.write_all(&message(POINTER, &[&[9u8, 8, 7][..]])).unwrap();
        // The engine's side: a full picture and the PC's words.
        assert_eq!(line.frame(b"full", true, 4500, Instant::now()), Offered::Queued);
        assert!(line.say(&[0x84, 1]));
        let mut read_one = || {
            let mut length = [0u8; 4];
            gateway.read_exact(&mut length).expect("a message's length");
            let mut rest = vec![0u8; u32::from_be_bytes(length) as usize];
            gateway.read_exact(&mut rest).expect("the message");
            rest
        };
        let picture = read_one();
        assert_eq!((picture[0], &picture[1..9], &picture[9..]), (FULL_PICTURE, &4500u64.to_be_bytes()[..], &b"full"[..]));
        assert_eq!(read_one(), vec![SAYS, 0x84, 1]);
        let began = Instant::now();
        while heard_all.lock().unwrap().len() < 3 && began.elapsed() < Duration::from_secs(5) {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(*heard_all.lock().unwrap(), vec![(KEYS, vec![0x30, 1]), (STILL_WATCHING, Vec::new()), (POINTER, vec![9, 8, 7])]);
        // The gateway closes: the line ends, and is no longer one of those watching.
        drop(gateway);
        assert_eq!(engine_end.join().expect("the line's thread"), "the site's gateway closed the line");
        assert!(line.closed());
        assert_eq!(lines.connected(), 0);
    }
}
