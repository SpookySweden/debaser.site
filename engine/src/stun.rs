//! STUN (RFC 5389), the one question: "what address and port does this socket have from outside?" (SPEC-screens.md,
//! 2026-11-22, Luke: "relay for anywhere"). Asked of a public STUN server (Cloudflare's, free and keyless) from the
//! engine's own video socket, so the answer is the door the home router opened for that socket. The engine then
//! offers that address to a browser outside the home, and both sides send connection checks at once, which is how
//! two devices behind ordinary home routers reach each other directly. Asking again every 20 seconds keeps the door
//! open and notices a new outside address.
//!
//! Written from the RFC; nothing copied from elsewhere.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

pub const DEFAULT_SERVER: &str = "stun.cloudflare.com:3478";
const MAGIC_COOKIE: u32 = 0x2112_A442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const MAPPED_ADDRESS: u16 = 0x0001;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;

/// A fresh transaction number: twelve bytes nobody else can guess (they tie an answer to our question).
pub fn new_transaction() -> [u8; 12] {
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let mut out = [0u8; 12];
    for (i, chunk) in out.chunks_mut(8).enumerate() {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(COUNT.fetch_add(1, Ordering::Relaxed));
        h.write_u128(Instant::now().elapsed().as_nanos() ^ (i as u128));
        let bytes = h.finish().to_be_bytes();
        chunk.copy_from_slice(&bytes[..chunk.len()]);
    }
    out
}

/// The binding request: a 20-byte header with no attributes.
pub fn request(transaction: &[u8; 12]) -> [u8; 20] {
    let mut out = [0u8; 20];
    out[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    // Length 0: no attributes.
    out[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    out[8..20].copy_from_slice(transaction);
    out
}

/// The address in a binding success answer to OUR question (`transaction`); None for anything else (another
/// packet, an ICE check, an answer to an older question).
pub fn mapped_address(packet: &[u8], transaction: &[u8; 12]) -> Option<SocketAddr> {
    if packet.len() < 20 || u16::from_be_bytes([packet[0], packet[1]]) != BINDING_SUCCESS {
        return None;
    }
    if u32::from_be_bytes([packet[4], packet[5], packet[6], packet[7]]) != MAGIC_COOKIE || &packet[8..20] != transaction {
        return None;
    }
    let length = u16::from_be_bytes([packet[2], packet[3]]) as usize;
    let end = (20 + length).min(packet.len());
    let mut at = 20;
    let mut plain = None;
    while at + 4 <= end {
        let kind = u16::from_be_bytes([packet[at], packet[at + 1]]);
        let size = u16::from_be_bytes([packet[at + 2], packet[at + 3]]) as usize;
        let value = packet.get(at + 4..at + 4 + size)?;
        // IPv4 only (family 1): the engine's video socket is IPv4.
        if value.len() >= 8 && value[1] == 0x01 {
            let port = u16::from_be_bytes([value[2], value[3]]);
            let ip = u32::from_be_bytes([value[4], value[5], value[6], value[7]]);
            if kind == XOR_MAPPED_ADDRESS {
                let port = port ^ (MAGIC_COOKIE >> 16) as u16;
                let ip = ip ^ MAGIC_COOKIE;
                return Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::from(ip)), port));
            }
            if kind == MAPPED_ADDRESS {
                plain = Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::from(ip)), port));
            }
        }
        at += 4 + size.div_ceil(4) * 4;
    }
    plain
}

/// The STUN server's IPv4 address, looked up by name.
pub fn server(name: &str) -> Option<SocketAddr> {
    name.to_socket_addrs().ok()?.find(|a| a.is_ipv4())
}

/// What the engine knows and has asked.
pub struct Stun {
    pub server: Option<SocketAddr>,
    pub transaction: [u8; 12],
    pub asked_at: Option<Instant>,
    /// This engine's video socket as the outside world sees it: offered to browsers as a "server reflexive" address.
    pub outside: Option<SocketAddr>,
}

impl Stun {
    pub fn new() -> Self {
        Stun { server: None, transaction: new_transaction(), asked_at: None, outside: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_xor_mapped_address() {
        let t = [7u8; 12];
        let mut answer = vec![0x01, 0x01, 0x00, 0x0c];
        answer.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        answer.extend_from_slice(&t);
        // XOR-MAPPED-ADDRESS, 8 bytes: family 1, port 54321, 203.0.113.9.
        answer.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01]);
        answer.extend_from_slice(&(54321u16 ^ 0x2112).to_be_bytes());
        answer.extend_from_slice(&(u32::from(Ipv4Addr::new(203, 0, 113, 9)) ^ MAGIC_COOKIE).to_be_bytes());
        assert_eq!(mapped_address(&answer, &t), Some("203.0.113.9:54321".parse().unwrap()));
        assert_eq!(mapped_address(&answer, &[8u8; 12]), None, "an answer to another question");
        assert_eq!(request(&t)[0..2], [0x00, 0x01]);
    }
}
