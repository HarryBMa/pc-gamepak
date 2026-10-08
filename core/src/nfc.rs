//! NFC card identifiers and their host-side GamePak registry.

use std::collections::HashSet;
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

const NDEF_HEX_LIMIT: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GamePakId(String);

impl GamePakId {
    pub fn parse(value: &str) -> Result<Self, String> {
        let Some(suffix) = value.strip_prefix("gp_") else {
            return Err("GamePak ID must start with gp_".into());
        };
        if suffix.is_empty()
            || suffix.len() > 64
            || !suffix.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_".contains(&byte)
            })
        {
            return Err("GamePak ID must use lowercase letters, digits, _ or - after gp_".into());
        }
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub fn id_from_ndef_hex(encoded: &str) -> Result<GamePakId, String> {
    if encoded.is_empty() || encoded.len() > NDEF_HEX_LIMIT || !encoded.len().is_multiple_of(2) {
        return Err(
            "NDEF transport must be non-empty, even-length hex (max 8192 characters)".into(),
        );
    }
    let mut message = Vec::with_capacity(encoded.len() / 2);
    let (pairs, remainder) = encoded.as_bytes().as_chunks::<2>();
    debug_assert!(remainder.is_empty());
    for pair in pairs {
        let high =
            hex_value(pair[0]).ok_or_else(|| "NDEF transport is not hexadecimal".to_string())?;
        let low =
            hex_value(pair[1]).ok_or_else(|| "NDEF transport is not hexadecimal".to_string())?;
        message.push((high << 4) | low);
    }
    id_from_ndef(&message)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub fn id_from_ndef(message: &[u8]) -> Result<GamePakId, String> {
    let mut cursor = 0usize;
    let mut first = true;
    while cursor < message.len() {
        let header = take_byte(message, &mut cursor)?;
        let begin = header & 0x80 != 0;
        let end = header & 0x40 != 0;
        let chunked = header & 0x20 != 0;
        let short = header & 0x10 != 0;
        let has_id = header & 0x08 != 0;
        if begin != first || chunked {
            return Err(
                "NDEF record boundaries are invalid or chunked records are unsupported".into(),
            );
        }
        first = false;
        let type_len = take_byte(message, &mut cursor)? as usize;
        let payload_len = if short {
            take_byte(message, &mut cursor)? as usize
        } else {
            take_u32(message, &mut cursor)? as usize
        };
        let id_len = if has_id {
            take_byte(message, &mut cursor)? as usize
        } else {
            0
        };
        let record_type = take_bytes(message, &mut cursor, type_len)?;
        take_bytes(message, &mut cursor, id_len)?;
        let payload = take_bytes(message, &mut cursor, payload_len)?;
        if header & 0x07 == 0x01 && record_type == b"U" {
            if let Some((&prefix, body)) = payload.split_first() {
                if prefix == 0 {
                    let uri = std::str::from_utf8(body)
                        .map_err(|_| "NDEF URI is not valid UTF-8".to_string())?;
                    let gamepak_id = if let Some(id) = uri.strip_prefix("gamepak://") {
                        Some(id)
                    } else if uri
                        .get(..10)
                        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("gamepak://"))
                    {
                        Some(&uri[10..])
                    } else {
                        None
                    };
                    if let Some(id) = gamepak_id {
                        if id.contains(['/', '?', '#']) {
                            return Err("GamePak URI must contain only a GamePak ID".into());
                        }
                        if !end || cursor != message.len() {
                            return Err("GamePak URI must be the only NDEF record".into());
                        }
                        return GamePakId::parse(id);
                    }
                }
            }
        }
        if end {
            if cursor != message.len() {
                return Err("NDEF message has trailing bytes".into());
            }
            return Err("NDEF message has no GamePak URI record".into());
        }
    }
    Err("NDEF message is incomplete".into())
}

fn take_byte(message: &[u8], cursor: &mut usize) -> Result<u8, String> {
    let byte = *message
        .get(*cursor)
        .ok_or_else(|| "NDEF record is truncated".to_string())?;
    *cursor += 1;
    Ok(byte)
}

fn take_u32(message: &[u8], cursor: &mut usize) -> Result<u32, String> {
    let bytes = take_bytes(message, cursor, 4)?;
    Ok(u32::from_be_bytes(bytes.try_into().expect("four bytes")))
}

fn take_bytes<'a>(
    message: &'a [u8],
    cursor: &mut usize,
    length: usize,
) -> Result<&'a [u8], String> {
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "NDEF record length overflow".to_string())?;
    let bytes = message
        .get(*cursor..end)
        .ok_or_else(|| "NDEF record is truncated".to_string())?;
    *cursor = end;
    Ok(bytes)
}

#[derive(Debug, Deserialize)]
struct Registry {
    #[serde(default)]
    gamepaks: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    path: PathBuf,
    #[serde(default)]
    host: Option<Host>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Host {
    wake_on_lan: Option<String>,
    ready_address: Option<String>,
}

pub fn registry_path() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
            .join("PC-GamePak")
            .join("gamepaks.json")
    }
    #[cfg(not(windows))]
    {
        let state_home = std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state"))
            })
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        state_home.join("pc-gamepak").join("gamepaks.json")
    }
}

fn entries(registry: &Path) -> Result<Vec<Entry>, String> {
    let bytes = std::fs::read(registry).map_err(|error| {
        format!(
            "could not read GamePak registry {}: {error}",
            registry.display()
        )
    })?;
    let parsed: Registry = serde_json::from_slice(&bytes)
        .map_err(|error| format!("could not parse GamePak registry: {error}"))?;
    let mut ids = HashSet::new();
    for entry in &parsed.gamepaks {
        let id = GamePakId::parse(&entry.id)?;
        if !ids.insert(id) {
            return Err(format!("duplicate GamePak ID in registry: {}", entry.id));
        }
    }
    Ok(parsed.gamepaks)
}

pub fn resolve_from(registry: &Path, id: &GamePakId) -> Result<PathBuf, String> {
    let entry = entries(registry)?
        .into_iter()
        .find(|entry| entry.id == id.as_str())
        .ok_or_else(|| format!("GamePak {} is not registered on this host", id.as_str()))?;
    let candidate = if entry.path.is_absolute() {
        entry.path
    } else {
        registry
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(entry.path)
    };
    let path = candidate.canonicalize().map_err(|error| {
        format!(
            "registered GamePak path {} is unavailable: {error}",
            candidate.display()
        )
    })?;
    if !path.is_dir()
        || !(path.join("cartridge.conf").is_file() || path.join("autorun.inf").is_file())
    {
        return Err(format!(
            "registered GamePak {} has no cartridge manifest",
            id.as_str()
        ));
    }
    Ok(path)
}

pub fn prepare_host(registry: &Path, id: &GamePakId) -> Result<(), String> {
    let entry = entries(registry)?
        .into_iter()
        .find(|entry| entry.id == id.as_str())
        .ok_or_else(|| format!("GamePak {} is not registered on this host", id.as_str()))?;
    let Some(host) = entry.host else {
        return Ok(());
    };
    let (Some(mac), Some(address)) = (host.wake_on_lan, host.ready_address) else {
        return Err("host registry entries must provide both wakeOnLan and readyAddress".into());
    };
    let address: SocketAddr = address
        .parse()
        .map_err(|_| format!("invalid host readiness address: {address}"))?;
    let packet = magic_packet(&mac)?;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| error.to_string())?;
    socket
        .set_broadcast(true)
        .map_err(|error| error.to_string())?;
    socket
        .send_to(&packet, "255.255.255.255:9")
        .map_err(|error| format!("could not send Wake-on-LAN packet: {error}"))?;
    wait_until_ready(address)
}

fn magic_packet(mac: &str) -> Result<[u8; 102], String> {
    let bytes = mac
        .split([':', '-'])
        .map(|part| {
            if part.len() != 2 {
                return Err("Wake-on-LAN address must contain six hex byte pairs".to_string());
            }
            u8::from_str_radix(part, 16)
                .map_err(|_| "Wake-on-LAN address must contain six hex byte pairs".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if bytes.len() != 6 {
        return Err("Wake-on-LAN address must contain six hex byte pairs".into());
    }
    let mut packet = [0xff; 102];
    let (chunks, remainder) = packet[6..].as_chunks_mut::<6>();
    debug_assert!(remainder.is_empty());
    for chunk in chunks {
        chunk.copy_from_slice(&bytes);
    }
    Ok(packet)
}

fn wait_until_ready(address: SocketAddr) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(90) {
        if TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(format!(
        "GamePak host at {address} did not become ready within 90 seconds"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uri_ndef(uri: &[u8]) -> Vec<u8> {
        let mut message = vec![0xd1, 0x01, (uri.len() + 1) as u8, b'U', 0];
        message.extend_from_slice(uri);
        message
    }

    #[test]
    fn parses_gamepak_uri_from_ndef() {
        let id = id_from_ndef(&uri_ndef(b"gamepak://gp_stardew-valley")).unwrap();
        assert_eq!(id.as_str(), "gp_stardew-valley");
    }

    #[test]
    fn rejects_invalid_identifiers_and_uris() {
        assert!(GamePakId::parse("gp_").is_err());
        assert!(GamePakId::parse("gp_Upper").is_err());
        assert!(id_from_ndef(&uri_ndef(b"gamepak://gp_demo/path")).is_err());
    }

    #[test]
    fn decodes_hex_transport() {
        let message = uri_ndef(b"gamepak://gp_demo");
        let encoded = message
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(id_from_ndef_hex(&encoded).unwrap().as_str(), "gp_demo");
        assert!(id_from_ndef_hex("xyz").is_err());
    }

    #[test]
    fn magic_packet_contains_the_repeated_mac() {
        let packet = magic_packet("00:11:22:33:44:55").unwrap();
        assert_eq!(&packet[..6], &[0xff; 6]);
        let (chunks, remainder) = packet[6..].as_chunks::<6>();
        assert!(remainder.is_empty());
        assert!(chunks
            .iter()
            .all(|part| *part == [0x00, 0x11, 0x22, 0x33, 0x44, 0x55]));
    }

    #[test]
    fn resolves_a_registered_gamepak_directory() {
        let scratch = crate::testutil::Scratch::new("nfc-registry");
        let root = scratch.path().join("games/demo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("cartridge.conf"), "title=Demo\n").unwrap();
        let registry = scratch.path().join("gamepaks.json");
        std::fs::write(
            &registry,
            r#"{"gamepaks":[{"id":"gp_demo","path":"games/demo"}]}"#,
        )
        .unwrap();
        let id = GamePakId::parse("gp_demo").unwrap();
        assert_eq!(
            resolve_from(&registry, &id).unwrap(),
            root.canonicalize().unwrap()
        );
    }
}
