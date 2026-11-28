//! THE ROUTER PORT (SPEC-screens.md, "Away from home with no setup"; Luke, 2026-11-28: "Yes, automatically"). With
//! `--router-port` the engine asks the home router, by itself, to send ONE port from outside to this PC: the UDP port
//! its video leaves from, and nothing else (never its web port). A viewer on a hard network (a phone hotspot, a
//! campus) can then reach the PC directly, where the usual trick of both sides sending at once does not get through.
//!
//! The rules it keeps:
//! - The port is asked for one hour at a time and asked for again every twenty minutes. It is given back when the
//!   engine stops. If the engine is killed, the router closes it by itself within the hour.
//! - On any doubt nothing is opened, and the reason is said on the console: no router answered, it refused, it would
//!   only open a port with no time limit, its own outside address is not a public one, or that address is not the one
//!   the outside world sees this PC at (stun.rs).
//! - Nothing here can break the other ways in: it only ever adds one more address a viewer is told to try.
//!
//! The router is asked in the standard way home routers offer for this (UPnP, "Internet Gateway Device"): a question
//! shouted on the home network to find it, its description read, then three small requests to it. Written from the
//! UPnP documents on Rust's standard library; no crate, and nothing copied from elsewhere.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream, UdpSocket};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// How long the router is asked to keep the port: it closes it by itself after this if nobody asks again.
pub const LEASE_SECONDS: u32 = 3600;
/// What the router's own list of opened ports calls ours.
const NAME: &str = "DEBASER engine video";
/// The services a router may offer port opening under, most usual first.
const SERVICES: [&str; 3] = ["urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANPPPConnection:1"];
/// How long one step of talking to the router may take. It is on the home network: it answers in milliseconds.
const PATIENCE: Duration = Duration::from_millis(1500);
/// No answer from a router is ever longer than this.
const LONGEST_ANSWER: usize = 256 * 1024;

/// How often things are done. One set for the real engine; the tests use a much faster one.
pub struct Pace {
    /// An open port is asked for again this often (well inside the hour).
    pub renew: Duration,
    /// After a refusal, or with no router found, the next try.
    pub retry: Duration,
    /// How often the keeper looks up from its waiting (to stop, or to notice a new outside address).
    pub tick: Duration,
}

pub const PACE: Pace = Pace { renew: Duration::from_secs(20 * 60), retry: Duration::from_secs(10 * 60), tick: Duration::from_millis(200) };

/// Where a router takes its requests.
#[derive(Clone, Debug, PartialEq)]
pub struct Gateway {
    pub control: SocketAddrV4,
    pub path: String,
    pub service: String,
}

/// How the router port stands.
#[derive(Clone, Debug, PartialEq)]
pub enum Standing {
    /// Not asked yet (or the engine is stopping).
    NotAsked,
    /// `outside` on the router leads to `inside` on this PC.
    Open { outside: SocketAddrV4, inside: SocketAddrV4, gateway: Gateway, note: Option<String> },
    /// Nothing is open, and why, in words for the console and the viewer's settings.
    NotGiven { why: String },
    /// The router opened the port with no time limit although an hour was asked for, which the engine never keeps.
    /// `left` is that opening while the router has not yet taken it back: it is asked to, again and again, before
    /// anything else. Such a router is not asked for a port again while the engine runs.
    Unlimited { left: Option<(Gateway, u16)>, why: String },
}

/// What a router said instead of yes.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    /// It did not answer at all.
    Silent(String),
    /// It answered no. `code` is UPnP's own error number when it gave one.
    Said { http: u16, code: Option<u32>, words: String },
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::Silent(why) => write!(f, "it did not answer ({why})"),
            Refusal::Said { http, code: Some(code), words } => write!(f, "its answer: UPnP error {code} {words} (HTTP {http})"),
            Refusal::Said { http, code: None, .. } => write!(f, "its answer: HTTP {http}"),
        }
    }
}

/// The value of a "Name: value" line, whatever the name's letter case (HTTP headers, and a router's answer to the
/// shouted question, which has the same shape).
fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().filter_map(|line| line.split_once(':')).find(|(n, _)| n.trim().eq_ignore_ascii_case(name)).map(|(_, value)| value.trim())
}

/// What is between `<name>` and `</name>`, the first time it appears.
fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{name}>"))? + start;
    Some(xml[start..end].trim())
}

/// "http://192.168.0.1:49153/some/path" as an address and a path. Only a numbered IPv4 address: a router on the
/// home network is never looked up by name.
pub fn http_address(url: &str) -> Option<(SocketAddrV4, String)> {
    let rest = url.trim().strip_prefix("http://")?;
    let (host, path) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, "/"),
    };
    let address = if host.contains(':') { host.parse::<SocketAddrV4>().ok()? } else { SocketAddrV4::new(host.parse::<Ipv4Addr>().ok()?, 80) };
    Some((address, path.to_string()))
}

/// An address the whole internet can reach: not a home-network one, not one a provider shares between customers
/// (100.64 to 100.127), not this PC itself, not a special one.
pub fn is_public(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    let shared_by_provider = o[0] == 100 && (64..128).contains(&o[1]);
    !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || ip.is_multicast() || shared_by_provider || o[0] == 0 || o[0] >= 240)
}

/// Where a router's description is, from its answer to the shouted question. Only when the answer points at the
/// device that sent it, and that device is on a home network: no answer can send the engine anywhere else.
pub fn location_of(answer: &str, from: Ipv4Addr) -> Option<String> {
    if !(answer.starts_with("HTTP/1.1 200") || answer.starts_with("HTTP/1.0 200")) {
        return None;
    }
    let location = header(answer, "location")?;
    let (address, _) = http_address(location)?;
    (*address.ip() == from && from.is_private()).then(|| location.to_string())
}

/// Where the router takes port requests, from its description. None when it offers no port opening.
pub fn gateway_in(description: &str, location: &str) -> Option<Gateway> {
    // The requests go to the device that described itself (`location`, already checked to be the home-network device
    // that answered), never to another one its description names: a base address elsewhere is not followed.
    let (described_at, _) = http_address(location)?;
    let base_address = match tag(description, "URLBase").filter(|b| !b.is_empty()) {
        Some(base) => {
            let (named, _) = http_address(base)?;
            if named.ip() != described_at.ip() {
                return None;
            }
            named
        }
        None => described_at,
    };
    for wanted in SERVICES {
        let mut rest = description;
        while let Some(start) = rest.find("<service>") {
            let block = &rest[start..];
            let end = block.find("</service>").unwrap_or(block.len());
            let service = &block[..end];
            if tag(service, "serviceType") == Some(wanted) {
                let control = tag(service, "controlURL")?;
                let (address, path) = if control.starts_with("http://") {
                    http_address(control)?
                } else if control.starts_with('/') {
                    (base_address, control.to_string())
                } else {
                    (base_address, format!("/{control}"))
                };
                if address.ip() != described_at.ip() {
                    return None;
                }
                return Some(Gateway { control: address, path, service: wanted.to_string() });
            }
            rest = &block[end..];
        }
    }
    None
}

/// Shouts the question on the home network `from` is on (SSDP), and returns where the first router that answers
/// keeps its description. Sent to everyone on that network and, in case Windows sends that by another network card,
/// straight to the address a home router usually has.
pub fn search(from: Ipv4Addr) -> Option<String> {
    let socket = UdpSocket::bind((from, 0)).ok()?;
    socket.set_read_timeout(Some(Duration::from_millis(250))).ok()?;
    let o = from.octets();
    let everyone = SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 1900);
    let likely = SocketAddrV4::new(Ipv4Addr::new(o[0], o[1], o[2], 1), 1900);
    for wanted in SERVICES {
        let question = format!("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: {wanted}\r\n\r\n");
        let _ = socket.send_to(question.as_bytes(), everyone);
        let _ = socket.send_to(question.as_bytes(), likely);
    }
    let began = Instant::now();
    let mut buf = [0u8; 2048];
    while began.elapsed() < Duration::from_millis(2500) {
        if let Ok((length, SocketAddr::V4(source))) = socket.recv_from(&mut buf) {
            let text = String::from_utf8_lossy(&buf[..length]);
            if let Some(location) = location_of(&text, *source.ip()) {
                return Some(location);
            }
        }
    }
    None
}

/// The first router that answers on any of this PC's home networks.
pub fn find_on(own: &[Ipv4Addr]) -> Option<String> {
    own.iter().copied().filter(|a| a.is_private()).find_map(search)
}

struct Answer {
    status: u16,
    body: String,
    /// The address of ours the router was reached from: the one it must send the port to.
    local: SocketAddrV4,
}

fn position(all: &[u8], wanted: &[u8]) -> Option<usize> {
    all.windows(wanted.len()).position(|w| w == wanted)
}

/// Whether a whole answer has arrived: its headers, and as much body as they announce. An answer that does not say
/// how long it is ends when the router closes the line.
fn whole(all: &[u8]) -> bool {
    let Some(end) = position(all, b"\r\n\r\n") else { return false };
    let head = String::from_utf8_lossy(&all[..end]);
    match header(&head, "content-length").and_then(|v| v.parse::<usize>().ok()) {
        Some(length) => all.len() >= end + 4 + length,
        None => false,
    }
}

/// A body sent in pieces ("chunked"), put back together.
fn unchunked(mut body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(line_end) = position(body, b"\r\n") {
        let size_text = String::from_utf8_lossy(&body[..line_end]);
        let Ok(size) = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16) else { break };
        let start = line_end + 2;
        if size == 0 || body.len() < start + size {
            break;
        }
        out.extend_from_slice(&body[start..start + size]);
        body = body.get(start + size + 2..).unwrap_or(&[]);
    }
    out
}

/// One request to the router and its answer. A new connection each time, closed after.
fn exchange(to: SocketAddrV4, request: &str) -> io::Result<Answer> {
    let mut stream = TcpStream::connect_timeout(&SocketAddr::V4(to), PATIENCE)?;
    stream.set_read_timeout(Some(PATIENCE))?;
    stream.set_write_timeout(Some(PATIENCE))?;
    let local = match stream.local_addr()? {
        SocketAddr::V4(local) => local,
        SocketAddr::V6(_) => return Err(io::Error::new(io::ErrorKind::Other, "not an IPv4 connection")),
    };
    stream.write_all(request.as_bytes())?;
    let mut all = Vec::new();
    let mut buf = [0u8; 4096];
    let began = Instant::now();
    while !whole(&all) && all.len() < LONGEST_ANSWER && began.elapsed() < PATIENCE * 3 {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => all.extend_from_slice(&buf[..n]),
            Err(why) if all.is_empty() => return Err(why),
            Err(_) => break,
        }
    }
    let bad = |what: &str| io::Error::new(io::ErrorKind::InvalidData, what.to_string());
    if all.is_empty() {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "it closed the line without answering"));
    }
    let end = position(&all, b"\r\n\r\n").ok_or_else(|| bad("its answer was not HTTP"))?;
    let head = String::from_utf8_lossy(&all[..end]).to_string();
    let status = head.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok()).ok_or_else(|| bad("its answer was not HTTP"))?;
    let in_pieces = header(&head, "transfer-encoding").is_some_and(|v| v.eq_ignore_ascii_case("chunked"));
    let body = if in_pieces { unchunked(&all[end + 4..]) } else { all[end + 4..].to_vec() };
    Ok(Answer { status, body: String::from_utf8_lossy(&body).to_string(), local })
}

/// One action asked of the router (SOAP: a small XML letter in an HTTP POST).
fn ask(gateway: &Gateway, action: &str, args: &[(&str, String)]) -> Result<Answer, Refusal> {
    let service = &gateway.service;
    let mut inner = String::new();
    for (name, value) in args {
        inner.push_str(&format!("<{name}>{value}</{name}>"));
    }
    let letter = format!(
        "<?xml version=\"1.0\"?>\r\n<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:{action} xmlns:u=\"{service}\">{inner}</u:{action}></s:Body></s:Envelope>\r\n"
    );
    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: text/xml; charset=\"utf-8\"\r\nSOAPAction: \"{service}#{action}\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{letter}",
        gateway.path,
        gateway.control,
        letter.len()
    );
    match exchange(gateway.control, &request) {
        Err(why) => Err(Refusal::Silent(why.to_string())),
        Ok(answer) if answer.status == 200 => Ok(answer),
        Ok(answer) => Err(Refusal::Said {
            http: answer.status,
            code: tag(&answer.body, "errorCode").and_then(|c| c.parse().ok()),
            words: tag(&answer.body, "errorDescription").unwrap_or("").to_string(),
        }),
    }
}

/// The three things every request about one port names: anyone outside, the outside port, UDP.
fn the_port(port: u16) -> Vec<(&'static str, String)> {
    vec![("NewRemoteHost", String::new()), ("NewExternalPort", port.to_string()), ("NewProtocol", "UDP".to_string())]
}

/// Gives the port back to the router.
pub fn give_back(gateway: &Gateway, port: u16) -> Result<(), Refusal> {
    ask(gateway, "DeletePortMapping", &the_port(port)).map(|_| ())
}

/// One try at the port. `location` is where the router's description is; `port` is the engine's video port (asked
/// for under the same number outside); `seen_outside` is the address the outside world sees this PC at.
pub fn open(location: &str, port: u16, seen_outside: Ipv4Addr) -> Standing {
    let not_given = |why: String| Standing::NotGiven { why };
    let Some((described_at, path)) = http_address(location) else {
        return not_given("the router's description has no usable address".to_string());
    };
    let description = match exchange(described_at, &format!("GET {path} HTTP/1.1\r\nHost: {described_at}\r\nConnection: close\r\n\r\n")) {
        Ok(answer) if answer.status == 200 => answer.body,
        Ok(answer) => return not_given(format!("the router's description could not be read (HTTP {})", answer.status)),
        Err(why) => return not_given(format!("the router's description could not be read ({why})")),
    };
    let Some(gateway) = gateway_in(&description, location) else {
        return not_given("the router does not offer to open ports (nothing for it in its description)".to_string());
    };
    let (router_says, inside) = match ask(&gateway, "GetExternalIPAddress", &[]) {
        Ok(answer) => match tag(&answer.body, "NewExternalIPAddress").and_then(|ip| ip.parse::<Ipv4Addr>().ok()) {
            Some(ip) => (ip, SocketAddrV4::new(*answer.local.ip(), port)),
            None => return not_given("the router did not say what its outside address is".to_string()),
        },
        Err(refusal) => return not_given(format!("the router would not say what its outside address is: {refusal}")),
    };
    if !is_public(router_says) {
        return not_given(format!(
            "the router's own outside address ({}.x.x.x) is not a public one: another router, or the provider's address sharing, is in front of it, so a port opened here would lead nowhere",
            router_says.octets()[0]
        ));
    }
    if router_says != seen_outside {
        return not_given("the router's outside address is not the one the outside world sees this PC at, so a port opened here would lead nowhere".to_string());
    }
    let mut wish = the_port(port);
    wish.extend([
        ("NewInternalPort", port.to_string()),
        ("NewInternalClient", inside.ip().to_string()),
        ("NewEnabled", "1".to_string()),
        ("NewPortMappingDescription", NAME.to_string()),
        ("NewLeaseDuration", LEASE_SECONDS.to_string()),
    ]);
    if let Err(refusal) = ask(&gateway, "AddPortMapping", &wish) {
        return not_given(match &refusal {
            Refusal::Said { code: Some(725), .. } => format!("the router only opens ports with no time limit, and none was taken ({refusal})"),
            Refusal::Said { code: Some(718), .. } => format!("outside port {port} is already taken on the router ({refusal})"),
            _ => format!("the router refused ({refusal})"),
        });
    }
    // Read it back: a router that took the port but dropped the time limit is treated as a refusal, and the port is
    // given straight back. One that will not say (the Virgin Hub 5 cuts the line on some questions) is believed,
    // since by the rules a router that cannot keep a time limit must refuse it.
    let mut note = None;
    match ask(&gateway, "GetSpecificPortMappingEntry", &the_port(port)) {
        Ok(answer) => {
            let client = tag(&answer.body, "NewInternalClient").and_then(|c| c.parse::<Ipv4Addr>().ok());
            if client.is_some_and(|c| c != *inside.ip()) {
                return not_given(format!("the router says outside port {port} leads to another device, so it was left alone"));
            }
            if tag(&answer.body, "NewLeaseDuration").and_then(|l| l.parse::<u32>().ok()) == Some(0) {
                let said = "the router opened the port with no time limit although an hour was asked for";
                return match give_back(&gateway, port) {
                    Ok(()) => Standing::Unlimited { left: None, why: format!("{said}; it was given straight back, and this router is not asked again while the engine runs") },
                    Err(refusal) => Standing::Unlimited {
                        left: Some((gateway, port)),
                        why: format!("{said}, and would not take it back ({refusal}): outside port {port} is still open on the router, which is asked to close it until it does"),
                    },
                };
            }
        }
        Err(refusal) => note = Some(format!("the router would not say how long it holds it: {refusal}")),
    }
    Standing::Open { outside: SocketAddrV4::new(router_says, port), inside, gateway, note }
}

/// The router port as the rest of the engine sees it.
pub struct Port {
    standing: Mutex<Standing>,
}

impl Port {
    pub fn new() -> Port {
        Port { standing: Mutex::new(Standing::NotAsked) }
    }

    /// For the engine's own tests (serve.rs): a port that stands as said, with no router asked.
    #[cfg(test)]
    pub fn standing_as(standing: Standing) -> Port {
        Port { standing: Mutex::new(standing) }
    }

    /// The outside address viewers are told to try, while the port is open.
    pub fn outside(&self) -> Option<SocketAddrV4> {
        match &*self.standing.lock().unwrap() {
            Standing::Open { outside, .. } => Some(*outside),
            _ => None,
        }
    }

    /// For the settings a viewer reads: `{"state": "open" | "not given" | "not asked", "outsidePort", "why"}`.
    pub fn json(&self) -> String {
        match &*self.standing.lock().unwrap() {
            Standing::NotAsked => "{\"state\": \"not asked\", \"outsidePort\": null, \"why\": null}".to_string(),
            Standing::Open { outside, .. } => format!("{{\"state\": \"open\", \"outsidePort\": {}, \"why\": null}}", outside.port()),
            Standing::NotGiven { why } | Standing::Unlimited { why, .. } => format!("{{\"state\": \"not given\", \"outsidePort\": null, \"why\": {}}}", crate::settings::quoted(why)),
        }
    }
}

/// For the console.
fn spoken(standing: &Standing) -> String {
    match standing {
        Standing::NotAsked => "not asked".to_string(),
        Standing::Open { outside, inside, note, .. } => format!(
            "OPEN: outside port {} on the router leads to this PC's video ({inside}), for an hour at a time, asked for again every 20 minutes{}",
            outside.port(),
            note.as_ref().map_or(String::new(), |n| format!(" ({n})"))
        ),
        Standing::NotGiven { why } => format!("NOT OPENED: {why}"),
        Standing::Unlimited { left: None, why } => format!("NOT OPENED: {why}"),
        Standing::Unlimited { left: Some(_), why } => format!("NOT KEPT, AND STILL OPEN ON THE ROUTER: {why}"),
    }
}

/// Asks the router once more to close a port it opened with no time limit. True when it is gone (taken back now, or
/// the router says it has no such opening any more).
fn taken_back(gateway: &Gateway, port: u16) -> bool {
    matches!(give_back(gateway, port), Ok(()) | Err(Refusal::Said { code: Some(714), .. }))
}

/// The keeper: runs until `stopping`, on its own thread. It waits until the outside world has said what this PC's
/// address is (`seen_outside`, from stun.rs), finds the router (`find`), asks for the port, asks again as `pace`
/// says, starts over when the outside address changes, and gives the port back at the end.
pub fn keep(port: &Port, video_port: u16, pace: &Pace, find: &dyn Fn() -> Option<String>, seen_outside: &dyn Fn() -> Option<Ipv4Addr>, stopping: &dyn Fn() -> bool) {
    let mut due = Instant::now();
    let mut location: Option<String> = None;
    while !stopping() {
        let seen = seen_outside();
        let moved = match (&*port.standing.lock().unwrap(), seen) {
            (Standing::Open { outside, .. }, Some(seen)) => *outside.ip() != seen,
            _ => false,
        };
        let Some(seen) = seen else {
            thread::sleep(pace.tick);
            continue;
        };
        if Instant::now() < due && !moved {
            thread::sleep(pace.tick);
            continue;
        }
        // A router that opened the port with no time limit is asked for nothing more: only, while that opening is
        // still there, to close it.
        let unlimited = match &*port.standing.lock().unwrap() {
            Standing::Unlimited { left, .. } => Some(left.clone()),
            _ => None,
        };
        if let Some(left) = unlimited {
            if let Some((gateway, left_port)) = left {
                if taken_back(&gateway, left_port) {
                    let next = Standing::Unlimited {
                        left: None,
                        why: "the router opened the port with no time limit although an hour was asked for; it has now taken it back, and is not asked again while the engine runs".to_string(),
                    };
                    println!("  router port: {}", spoken(&next));
                    *port.standing.lock().unwrap() = next;
                }
            }
            due = Instant::now() + pace.retry;
            continue;
        }
        if location.is_none() {
            location = find();
            // The search takes seconds: an engine that began stopping meanwhile opens nothing on its way out.
            if stopping() {
                break;
            }
        }
        let next = match &location {
            Some(location) => open(location, video_port, seen),
            None => Standing::NotGiven { why: "no router on the home network answered (its automatic port opening, UPnP, is off, or it has none)".to_string() },
        };
        let before = std::mem::replace(&mut *port.standing.lock().unwrap(), next.clone());
        if next != before {
            println!("  router port: {}", spoken(&next));
        }
        // Refused where it was open before: whatever is left of the old opening is given back, not left to run out,
        // and the port is asked for afresh once, straight away (a router that will not renew an opening it still
        // holds takes it again once it is gone). A second refusal waits like any other.
        let mut again_soon = false;
        if let (Standing::Open { outside, gateway, .. }, Standing::NotGiven { .. }) = (&before, &next) {
            let _ = give_back(gateway, outside.port());
            again_soon = true;
        }
        if matches!(next, Standing::NotGiven { .. }) {
            // The router is looked for afresh next time: it may have been restarted, or swapped.
            location = None;
        }
        due = Instant::now()
            + if matches!(next, Standing::Open { .. }) {
                pace.renew
            } else if again_soon {
                pace.tick
            } else {
                pace.retry
            };
    }
    let last = std::mem::replace(&mut *port.standing.lock().unwrap(), Standing::NotAsked);
    match last {
        Standing::Open { outside, gateway, .. } => match give_back(&gateway, outside.port()) {
            Ok(()) => println!("  router port: outside port {} given back to the router", outside.port()),
            Err(refusal) => println!("  router port: outside port {} could NOT be given back ({refusal}); the router closes it by itself within the hour", outside.port()),
        },
        Standing::Unlimited { left: Some((gateway, left_port)), .. } => {
            if taken_back(&gateway, left_port) {
                println!("  router port: outside port {left_port}, which the router had opened with no time limit, is closed");
            } else {
                println!("  router port: OUTSIDE PORT {left_port} IS STILL OPEN ON THE ROUTER, with no time limit, and the router will not close it: it has to be removed on the router's own page");
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// The Virgin Media Hub 5's own answer to the shouted question (2026-11-28; its identifying numbers replaced).
    const HUB_ANSWER: &str = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nDATE: Sat, 28 Nov 2026 07:25:15 GMT\r\nEXT:\r\nLOCATION: http://192.168.0.1:49153/IGDdevicedesc_brlan0.xml\r\nOPT: \"http://schemas.upnp.org/upnp/1/0/\"; ns=01\r\n01-NLS: 00000000-0000-0000-0000-000000000000\r\nSERVER: Linux/5.15.144-prod-24.2-pd UPnP/1.0 Portable-SDK-for-UPnP-devices/1.6.22\r\nX-User-Agent: redsonic\r\nST: urn:schemas-upnp-org:service:WANIPConnection:1\r\nUSN: uuid:00000000-0000-0000-0000-000000000000::urn:schemas-upnp-org:service:WANIPConnection:1\r\n\r\n";

    /// The Hub 5's own description, shortened to its three services (the nesting and spacing are the Hub's).
    const HUB_DESCRIPTION: &str = "<?xml version=\"1.0\"?>\n<root xmlns=\"urn:schemas-upnp-org:device-1-0\">\n<specVersion>\n<major>1</major>\n<minor>0</minor>\n</specVersion>\n<device>\n<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>\n<friendlyName>Sagemcom F3896LG</friendlyName>\n<serviceList>\n<service>\n<serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType>\n<serviceId>urn:upnp-org:serviceId:L3Forwarding1</serviceId>\n<SCPDURL>/Layer3ForwardingSCPD.xml</SCPDURL>\n<controlURL>/upnp/control/Layer3Forwarding</controlURL>\n<eventSubURL>/upnp/event/Layer3Forwarding</eventSubURL>\n</service>\n</serviceList>\n<deviceList>\n<device>\n<deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>\n<serviceList>\n<service>\n<serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType>\n<serviceId>urn:upnp-org:serviceId:WANCommonIFC1</serviceId>\n<SCPDURL>/WANCommonInterfaceConfigSCPD.xml</SCPDURL>\n<controlURL>/upnp/control/WANCommonInterfaceConfig0</controlURL>\n<eventSubURL>/upnp/event/WANCommonInterfaceConfig0</eventSubURL>\n</service>\n</serviceList>\n<deviceList>\n    <device>\n        <deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>\n        <serviceList>\n       <service>\n           <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>\n           <serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>\n           <SCPDURL>/WANIPConnectionServiceSCPD.xml</SCPDURL>\n           <controlURL>/upnp/control/WANIPConnection0</controlURL>\n           <eventSubURL>/upnp/event/WANIPConnection0</eventSubURL>\n       </service>\n        </serviceList>\n    </device>\n</deviceList>\n</device>\n</deviceList>\n<presentationURL>http://192.168.0.1/</presentationURL></device>\n</root>\n";

    const WAN: &str = "urn:schemas-upnp-org:service:WANIPConnection:1";

    /// A pretend router on this PC itself, which answers as the Hub 5 does. Nothing here reaches a real one.
    #[derive(Default)]
    struct HubState {
        /// What it says its outside address is.
        outside: String,
        /// It refuses to open a port, with this UPnP error.
        refuses: Option<(u32, &'static str)>,
        /// It refuses (718) to open a port it still holds, even for the same device.
        refuses_while_held: bool,
        /// It opens the port but for this long, whatever was asked (0: with no time limit).
        lease_given: Option<u32>,
        /// It cuts the line when asked about one opened port (the Hub 5 does, for a port nobody has).
        silent_on_read: bool,
        /// It refuses this many requests to close a port before it does as asked.
        keeps_for: usize,
        /// Its description offers no port opening.
        no_service: bool,
        /// The one port it has open: outside port, the device it leads to, that device's port, seconds.
        opened: Option<(u16, String, u16, u32)>,
        /// Every action asked of it, with the letter that asked.
        heard: Vec<(String, String)>,
    }

    struct Hub {
        location: String,
        state: Arc<Mutex<HubState>>,
    }

    impl Hub {
        fn heard(&self, action: &str) -> Vec<String> {
            self.state.lock().unwrap().heard.iter().filter(|(a, _)| a == action).map(|(_, letter)| letter.clone()).collect()
        }

        fn opened(&self) -> Option<(u16, String, u16, u32)> {
            self.state.lock().unwrap().opened.clone()
        }
    }

    fn enveloped(inner: &str) -> String {
        format!("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>\n{inner}\n</s:Body> </s:Envelope>")
    }

    fn says(status: &str, body: &str) -> Option<String> {
        Some(format!(
            "HTTP/1.1 {status}\r\nCONTENT-LENGTH: {}\r\nCONTENT-TYPE: text/xml; charset=\"utf-8\"\r\nEXT:\r\nSERVER: Linux/5.15.144-prod-24.2-pd UPnP/1.0 Portable-SDK-for-UPnP-devices/1.6.22\r\nX-User-Agent: redsonic\r\n\r\n{body}",
            body.len()
        ))
    }

    fn fault(code: u32, words: &str) -> Option<String> {
        says(
            "500 Internal Server Error",
            &enveloped(&format!(
                "<s:Fault>\n<faultcode>s:Client</faultcode>\n<faultstring>UPnPError</faultstring>\n<detail>\n<UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\">\n<errorCode>{code}</errorCode>\n<errorDescription>{words}</errorDescription>\n</UPnPError>\n</detail>\n</s:Fault>"
            )),
        )
    }

    /// The pretend router's answer to one request; None is the line cut with nothing said.
    fn hub_says(state: &Mutex<HubState>, request: &str) -> Option<String> {
        let mut hub = state.lock().unwrap();
        if request.starts_with("GET ") {
            let description = if hub.no_service { HUB_DESCRIPTION.replace("WANIPConnection:1", "SomethingElse:1") } else { HUB_DESCRIPTION.to_string() };
            return says("200 OK", &description);
        }
        let (head, letter) = request.split_once("\r\n\r\n")?;
        let action = header(head, "soapaction")?.trim_matches('"').split_once('#')?.1.to_string();
        hub.heard.push((action.clone(), letter.to_string()));
        let port = tag(letter, "NewExternalPort").and_then(|p| p.parse::<u16>().ok());
        match action.as_str() {
            "GetExternalIPAddress" => says(
                "200 OK",
                &enveloped(&format!("<u:GetExternalIPAddressResponse xmlns:u=\"{WAN}\">\n<NewExternalIPAddress>{}</NewExternalIPAddress>\n</u:GetExternalIPAddressResponse>", hub.outside)),
            ),
            "AddPortMapping" => {
                if let Some((code, words)) = hub.refuses {
                    return fault(code, words);
                }
                if hub.refuses_while_held && hub.opened.is_some() {
                    return fault(718, "ConflictInMappingEntry");
                }
                let asked = tag(letter, "NewLeaseDuration")?.parse::<u32>().ok()?;
                hub.opened = Some((port?, tag(letter, "NewInternalClient")?.to_string(), tag(letter, "NewInternalPort")?.parse().ok()?, hub.lease_given.unwrap_or(asked)));
                says("200 OK", &enveloped(&format!("<u:AddPortMappingResponse xmlns:u=\"{WAN}\">\n</u:AddPortMappingResponse>")))
            }
            "GetSpecificPortMappingEntry" => {
                if hub.silent_on_read {
                    return None;
                }
                match &hub.opened {
                    Some((outside, client, inside, lease)) if Some(*outside) == port => says(
                        "200 OK",
                        &enveloped(&format!(
                            "<u:GetSpecificPortMappingEntryResponse xmlns:u=\"{WAN}\">\n<NewInternalPort>{inside}</NewInternalPort>\n<NewInternalClient>{client}</NewInternalClient>\n<NewEnabled>1</NewEnabled>\n<NewPortMappingDescription>DEBASER engine video</NewPortMappingDescription>\n<NewLeaseDuration>{lease}</NewLeaseDuration>\n</u:GetSpecificPortMappingEntryResponse>"
                        )),
                    ),
                    _ => fault(714, "NoSuchEntryInArray"),
                }
            }
            "DeletePortMapping" => {
                if hub.keeps_for > 0 {
                    hub.keeps_for -= 1;
                    return fault(501, "Action Failed");
                }
                if hub.opened.as_ref().is_some_and(|(outside, ..)| Some(*outside) == port) {
                    hub.opened = None;
                    says("200 OK", &enveloped(&format!("<u:DeletePortMappingResponse xmlns:u=\"{WAN}\">\n</u:DeletePortMappingResponse>")))
                } else {
                    fault(714, "NoSuchEntryInArray")
                }
            }
            _ => None,
        }
    }

    fn a_hub(set: impl FnOnce(&mut HubState)) -> Hub {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut state = HubState { outside: "203.0.113.7".to_string(), ..HubState::default() };
        set(&mut state);
        let state = Arc::new(Mutex::new(state));
        let theirs = state.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                // A whole request: its headers, and as much letter as they announce (none for a GET).
                let mut all = Vec::new();
                let mut buf = [0u8; 4096];
                loop {
                    if let Some(end) = position(&all, b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&all[..end]).to_string();
                        let length = header(&head, "content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                        if all.len() >= end + 4 + length {
                            break;
                        }
                    }
                    match stream.read(&mut buf) {
                        Ok(n) if n > 0 => all.extend_from_slice(&buf[..n]),
                        _ => break,
                    }
                }
                if let Some(answer) = hub_says(&theirs, &String::from_utf8_lossy(&all)) {
                    let _ = stream.write_all(answer.as_bytes());
                }
                // Dropped here: the line is closed, answered or not.
            }
        });
        Hub { location: format!("http://127.0.0.1:{port}/IGDdevicedesc_brlan0.xml"), state }
    }

    const SEEN: Ipv4Addr = Ipv4Addr::new(203, 0, 113, 7);

    fn why_not(standing: &Standing) -> String {
        match standing {
            Standing::NotGiven { why } | Standing::Unlimited { left: None, why } => why.clone(),
            other => panic!("a port was not to be opened here, but: {other:?}"),
        }
    }

    #[test]
    fn the_real_hubs_own_words_are_read() {
        let hub = Ipv4Addr::new(192, 168, 0, 1);
        let location = location_of(HUB_ANSWER, hub).expect("where its description is");
        assert_eq!(location, "http://192.168.0.1:49153/IGDdevicedesc_brlan0.xml");
        // An answer that points somewhere other than the device that sent it, or comes from outside the home, is not followed.
        assert_eq!(location_of(HUB_ANSWER, Ipv4Addr::new(192, 168, 0, 66)), None);
        assert_eq!(location_of(&HUB_ANSWER.replace("192.168.0.1", "81.2.69.142"), Ipv4Addr::new(81, 2, 69, 142)), None);
        assert_eq!(location_of("NOTIFY * HTTP/1.1\r\nLOCATION: http://192.168.0.1:49153/x.xml\r\n\r\n", hub), None);
        let gateway = gateway_in(HUB_DESCRIPTION, &location).expect("where it takes port requests");
        assert_eq!(gateway, Gateway { control: "192.168.0.1:49153".parse().unwrap(), path: "/upnp/control/WANIPConnection0".to_string(), service: WAN.to_string() });
        assert_eq!(gateway_in(&HUB_DESCRIPTION.replace("WANIPConnection:1", "SomethingElse:1"), &location), None);
        // A description that sends the requests to another device is not followed either.
        assert_eq!(gateway_in(&HUB_DESCRIPTION.replace("/upnp/control/WANIPConnection0", "http://192.168.0.66:80/control"), &location), None);
        // Nor one that names a base address elsewhere for its requests (another device, or somewhere on the internet).
        let based_at = |base: &str| HUB_DESCRIPTION.replace("<specVersion>", &format!("<URLBase>{base}</URLBase>\n<specVersion>"));
        assert_eq!(gateway_in(&based_at("http://8.8.8.8:80/"), &location), None);
        assert_eq!(gateway_in(&based_at("http://192.168.0.66:49153/"), &location), None);
        assert_eq!(gateway_in(&based_at("http://192.168.0.1:5000/"), &location).map(|g| g.control), Some("192.168.0.1:5000".parse().unwrap()), "its own address, another port: followed");
        // An older router answers the shouted question as HTTP/1.0.
        assert!(location_of(&HUB_ANSWER.replace("HTTP/1.1 200", "HTTP/1.0 200"), hub).is_some());

        assert_eq!(http_address("http://192.168.0.1/"), Some(("192.168.0.1:80".parse().unwrap(), "/".to_string())));
        assert_eq!(http_address("http://192.168.0.1:5000"), Some(("192.168.0.1:5000".parse().unwrap(), "/".to_string())));
        assert_eq!(http_address("http://router.home/desc.xml"), None, "never looked up by name");
        assert_eq!(http_address("https://192.168.0.1/"), None);

        for public in ["203.0.113.7", "92.40.1.2", "8.8.8.8"] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
        for not in ["192.168.0.1", "10.0.0.1", "172.16.4.4", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.1.1", "0.0.0.0", "255.255.255.255", "224.0.0.1"] {
            assert!(!is_public(not.parse().unwrap()), "{not}");
        }
        assert_eq!(unchunked(b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"), b"hello world");
    }

    #[test]
    fn a_port_is_asked_for_an_hour_and_given_back() {
        let hub = a_hub(|_| {});
        let standing = open(&hub.location, 5000, SEEN);
        let Standing::Open { outside, inside, gateway, note } = &standing else { panic!("not opened: {standing:?}") };
        assert_eq!(*outside, "203.0.113.7:5000".parse().unwrap());
        assert_eq!(*inside, "127.0.0.1:5000".parse().unwrap());
        assert_eq!(*note, None);
        // What the router was asked: this one UDP port, to this PC, for an hour.
        let asked = hub.heard("AddPortMapping");
        assert_eq!(asked.len(), 1);
        for said in ["<NewRemoteHost></NewRemoteHost>", "<NewExternalPort>5000</NewExternalPort>", "<NewProtocol>UDP</NewProtocol>", "<NewInternalPort>5000</NewInternalPort>", "<NewInternalClient>127.0.0.1</NewInternalClient>", "<NewEnabled>1</NewEnabled>", "<NewLeaseDuration>3600</NewLeaseDuration>"] {
            assert!(asked[0].contains(said), "{said} in {}", asked[0]);
        }
        assert_eq!(hub.opened(), Some((5000, "127.0.0.1".to_string(), 5000, 3600)));
        // Given back: the router has nothing open any more.
        assert_eq!(give_back(gateway, outside.port()), Ok(()));
        assert_eq!(hub.opened(), None);
        assert!(hub.heard("DeletePortMapping")[0].contains("<NewExternalPort>5000</NewExternalPort>"));
    }

    #[test]
    fn on_any_doubt_nothing_is_opened() {
        // The router's own outside address is a home-network one, or one a provider shares: a port there leads nowhere.
        for (outside, seen) in [("192.168.1.5", "192.168.1.5"), ("100.70.0.1", "100.70.0.1"), ("10.0.0.2", "203.0.113.7")] {
            let hub = a_hub(|h| h.outside = outside.to_string());
            assert!(why_not(&open(&hub.location, 5000, seen.parse().unwrap())).contains("not a public one"), "{outside}");
            assert!(hub.heard("AddPortMapping").is_empty(), "{outside}: the router was not even asked");
        }
        // The outside world sees this PC at another address than the router's.
        let hub = a_hub(|_| {});
        assert!(why_not(&open(&hub.location, 5000, Ipv4Addr::new(198, 51, 100, 4))).contains("not the one the outside world sees"));
        assert!(hub.heard("AddPortMapping").is_empty());
        // It only opens ports with no time limit (UPnP error 725): none is taken.
        let hub = a_hub(|h| h.refuses = Some((725, "OnlyPermanentLeasesSupported")));
        let why = why_not(&open(&hub.location, 5000, SEEN));
        assert!(why.contains("no time limit") && why.contains("725 OnlyPermanentLeasesSupported"), "{why}");
        assert_eq!(hub.opened(), None);
        assert!(hub.heard("AddPortMapping").iter().all(|letter| letter.contains("<NewLeaseDuration>3600</NewLeaseDuration>")), "never asked for with no time limit");
        // The outside port is taken by something else (718), or it just says no.
        let hub = a_hub(|h| h.refuses = Some((718, "ConflictInMappingEntry")));
        assert!(why_not(&open(&hub.location, 5000, SEEN)).contains("already taken"));
        let hub = a_hub(|h| h.refuses = Some((606, "Action not authorized")));
        assert!(why_not(&open(&hub.location, 5000, SEEN)).contains("606 Action not authorized"));
        // It says yes but drops the time limit: the port is given straight back.
        let hub = a_hub(|h| h.lease_given = Some(0));
        assert!(why_not(&open(&hub.location, 5000, SEEN)).contains("given straight back"));
        assert_eq!(hub.opened(), None);
        assert_eq!(hub.heard("DeletePortMapping").len(), 1);
        // It offers no port opening at all; or nothing is there.
        let hub = a_hub(|h| h.no_service = true);
        assert!(why_not(&open(&hub.location, 5000, SEEN)).contains("does not offer"));
        let nobody = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap().port();
        assert!(why_not(&open(&format!("http://127.0.0.1:{nobody}/desc.xml"), 5000, SEEN)).contains("could not be read"));
    }

    #[test]
    fn a_router_that_will_not_say_how_long_is_believed() {
        // The Hub 5 cuts the line on some questions. It said yes to an hour, so the port stands, and the console says so.
        let hub = a_hub(|h| h.silent_on_read = true);
        let standing = open(&hub.location, 5000, SEEN);
        let Standing::Open { note, .. } = &standing else { panic!("not opened: {standing:?}") };
        assert!(note.as_ref().is_some_and(|n| n.contains("would not say how long")), "{note:?}");
        assert_eq!(hub.opened().map(|o| o.3), Some(3600));
    }

    #[test]
    fn the_keeper_waits_asks_again_and_gives_back_at_the_end() {
        let hub = a_hub(|_| {});
        let port = Arc::new(Port::new());
        let stop = Arc::new(AtomicBool::new(false));
        let seen: Arc<Mutex<Option<Ipv4Addr>>> = Arc::new(Mutex::new(None));
        let keeper = {
            let (port, stop, seen, location) = (port.clone(), stop.clone(), seen.clone(), hub.location.clone());
            thread::spawn(move || {
                let pace = Pace { renew: Duration::from_millis(40), retry: Duration::from_millis(40), tick: Duration::from_millis(5) };
                keep(&port, 5000, &pace, &|| Some(location.clone()), &|| *seen.lock().unwrap(), &|| stop.load(Ordering::SeqCst));
            })
        };
        // Until the outside world has said what this PC's address is, the router is asked nothing.
        thread::sleep(Duration::from_millis(120));
        assert!(hub.state.lock().unwrap().heard.is_empty());
        assert_eq!(port.outside(), None);
        assert!(port.json().contains("\"not asked\""));
        // Then it asks, and asks again as its pace says.
        *seen.lock().unwrap() = Some(SEEN);
        let began = Instant::now();
        while hub.heard("AddPortMapping").len() < 3 && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(hub.heard("AddPortMapping").len() >= 3, "asked for again and again");
        assert_eq!(port.outside(), Some("203.0.113.7:5000".parse().unwrap()));
        assert_eq!(port.json(), "{\"state\": \"open\", \"outsidePort\": 5000, \"why\": null}");
        assert!(hub.heard("DeletePortMapping").is_empty(), "not given back while the engine runs");
        // The engine stops: the port is given back before the keeper ends.
        stop.store(true, Ordering::SeqCst);
        keeper.join().unwrap();
        assert_eq!(hub.opened(), None);
        assert_eq!(hub.heard("DeletePortMapping").len(), 1);
        assert_eq!(port.outside(), None);
    }

    #[test]
    fn a_port_opened_with_no_time_limit_is_closed_however_long_it_takes_and_never_asked_for_again() {
        // The router ignores the hour it was asked for, and refuses the first three requests to close what it opened.
        let hub = a_hub(|h| {
            h.lease_given = Some(0);
            h.keeps_for = 3;
        });
        let port = Arc::new(Port::new());
        let stop = Arc::new(AtomicBool::new(false));
        let keeper = {
            let (port, stop, location) = (port.clone(), stop.clone(), hub.location.clone());
            thread::spawn(move || {
                let pace = Pace { renew: Duration::from_millis(40), retry: Duration::from_millis(40), tick: Duration::from_millis(5) };
                keep(&port, 5000, &pace, &|| Some(location.clone()), &|| Some(SEEN), &|| stop.load(Ordering::SeqCst));
            })
        };
        // It is asked to close it until it does; viewers are never told the address meanwhile.
        let began = Instant::now();
        let mut ever_offered = false;
        while (hub.heard("DeletePortMapping").len() < 4 || hub.opened().is_some()) && began.elapsed() < Duration::from_secs(10) {
            ever_offered |= port.outside().is_some();
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(hub.opened(), None, "the opening with no time limit is gone from the router");
        assert_eq!(hub.heard("DeletePortMapping").len(), 4, "three refusals, then taken back");
        assert!(!ever_offered);
        // And that router is not asked for a port again while the engine runs.
        thread::sleep(Duration::from_millis(300));
        assert_eq!(hub.heard("AddPortMapping").len(), 1);
        assert_eq!(hub.heard("DeletePortMapping").len(), 4);
        assert!(port.json().contains("\"not given\"") && port.json().contains("no time limit"), "{}", port.json());
        stop.store(true, Ordering::SeqCst);
        keeper.join().unwrap();
        assert_eq!(hub.heard("DeletePortMapping").len(), 4, "nothing left to close at the end");

        // An engine that stops while the router still holds it asks once more on its way out.
        let hub = a_hub(|h| {
            h.lease_given = Some(0);
            h.keeps_for = 1;
        });
        let standing = open(&hub.location, 5000, SEEN);
        assert!(matches!(&standing, Standing::Unlimited { left: Some((_, 5000)), .. }), "{standing:?}");
        assert!(hub.opened().is_some());
        let port = Port::standing_as(standing);
        keep(&port, 5000, &PACE, &|| None::<String>, &|| Some(SEEN), &|| true);
        assert_eq!(hub.opened(), None);
    }

    #[test]
    fn a_refusal_after_it_was_open_closes_what_was_left() {
        let hub = a_hub(|_| {});
        let port = Arc::new(Port::new());
        let stop = Arc::new(AtomicBool::new(false));
        let keeper = {
            let (port, stop, location) = (port.clone(), stop.clone(), hub.location.clone());
            thread::spawn(move || {
                let pace = Pace { renew: Duration::from_millis(40), retry: Duration::from_millis(40), tick: Duration::from_millis(5) };
                keep(&port, 5000, &pace, &|| Some(location.clone()), &|| Some(SEEN), &|| stop.load(Ordering::SeqCst));
            })
        };
        let began = Instant::now();
        while port.outside().is_none() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(port.outside().is_some());
        // The router starts saying no (a new setting on it, say): viewers are no longer told the address, and the
        // old opening is not left to run out by itself.
        hub.state.lock().unwrap().refuses = Some((606, "Action not authorized"));
        let began = Instant::now();
        while port.outside().is_some() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(port.outside(), None);
        assert!(port.json().contains("\"not given\"") && port.json().contains("606"));
        let began = Instant::now();
        while hub.opened().is_some() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(hub.opened(), None);
        // The router says yes again: the port comes back by itself, nothing restarted.
        hub.state.lock().unwrap().refuses = None;
        let began = Instant::now();
        while port.outside().is_none() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(port.outside(), Some("203.0.113.7:5000".parse().unwrap()));
        stop.store(true, Ordering::SeqCst);
        keeper.join().unwrap();
        assert_eq!(hub.opened(), None, "and given back at the end");
    }

    #[test]
    fn a_router_that_will_not_renew_what_it_still_holds_is_asked_afresh() {
        // Some routers answer "already taken" (718) when asked again for a port they still hold, even for the same
        // PC. The keeper gives the old opening back and takes it anew at once, so the port is never shut for long.
        let hub = a_hub(|_| {});
        let port = Arc::new(Port::new());
        let stop = Arc::new(AtomicBool::new(false));
        let keeper = {
            let (port, stop, location) = (port.clone(), stop.clone(), hub.location.clone());
            thread::spawn(move || {
                // A long wait after a refusal: only the "afresh, at once" try can bring the port back in time.
                let pace = Pace { renew: Duration::from_millis(40), retry: Duration::from_secs(600), tick: Duration::from_millis(5) };
                keep(&port, 5000, &pace, &|| Some(location.clone()), &|| Some(SEEN), &|| stop.load(Ordering::SeqCst));
            })
        };
        let began = Instant::now();
        while port.outside().is_none() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(port.outside().is_some());
        hub.state.lock().unwrap().refuses_while_held = true;
        // It is refused, given back, and taken again: at least two more openings, each after a giving back.
        let began = Instant::now();
        while hub.heard("DeletePortMapping").len() < 2 && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(hub.heard("DeletePortMapping").len() >= 2, "the old opening is given back each time");
        let began = Instant::now();
        while port.outside().is_none() && began.elapsed() < Duration::from_secs(10) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(port.outside().is_some(), "and the port is open again without waiting out the long retry");
        stop.store(true, Ordering::SeqCst);
        keeper.join().unwrap();
        assert_eq!(hub.opened(), None);
    }
}
