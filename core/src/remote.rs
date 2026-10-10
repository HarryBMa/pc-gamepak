//! Priming a game on another PC: start it on tap, stream it on Play, close it
//! on Eject.
//!
//! ```text
//! CLIENT (couch)                           HOST (gaming PC)
//! tap a card ── prime gp_id ─────────────▶ pc-gamepak --host-agent
//!                                            starts the game, no stream yet
//! Play ──────── moonlight stream ────────▶ Apollo / Sunshine streams it
//! Eject ─────── moonlight quit, stop ────▶ the game is closed, hours saved
//! ```
//!
//! This module is the wire between the two: one JSON line each way over TCP,
//! signed with a key the two sides share. The host's half runs what its own
//! GamePak registry says an ID means — exactly as `--trigger` would on that
//! PC — so nothing a client sends is ever executed as given. The client can
//! name an ID; the host decides what that ID is.
//!
//! # The key
//!
//! 32 random bytes, made once on the host by `pc-gamepak --host-agent` and
//! shown as 64 hex digits, which are copied into the client's registry entry.
//! Every request carries an HMAC-SHA256 of its fields under that key, the time
//! it was made, and a nonce: a request is refused if the MAC is wrong, if its
//! clock is more than [`MAX_SKEW_SECONDS`] off the host's, or if its nonce has
//! been seen. Somebody on the network who records a request cannot make it do
//! anything again, and somebody without the key cannot make one at all.
//!
//! What it does not do is hide anything: the requests are readable on the
//! LAN. They carry a GamePak ID and a verb, and the answers carry a title and
//! a cover, none of which is secret.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::gamepak::GamePakId;
use crate::verify::Sha256;

/// Where the agent listens unless told otherwise. Clear of Apollo's and
/// Sunshine's 47984–48010.
pub const DEFAULT_PORT: u16 = 47820;

/// How far apart the two clocks may be before a request is refused.
pub const MAX_SKEW_SECONDS: u64 = 120;

/// The drive path the launcher is given for a remote GamePak: not a drive,
/// but the commands that would read one recognise it and answer for the host.
pub const MARKER: &str = "gamepak-remote://";

/// A request line is a few hundred bytes; anything much longer is not one.
const MAX_REQUEST_BYTES: u64 = 4096;
/// A reply can carry a cover as a data URI, which the cartridge caps at 8 MB
/// before base64.
const MAX_REPLY_BYTES: u64 = 16 * 1024 * 1024;

// --------------------------------------------------------------------------
// The key
// --------------------------------------------------------------------------

/// The secret both sides hold.
#[derive(Clone, PartialEq, Eq)]
pub struct Key([u8; 32]);

impl std::fmt::Debug for Key {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key(…)")
    }
}

impl Key {
    pub fn generate() -> Result<Key, String> {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|e| format!("no randomness for a key: {e}"))?;
        Ok(Key(bytes))
    }

    pub fn from_hex(text: &str) -> Result<Key, String> {
        let text = text.trim();
        let bytes = decode_hex(text).filter(|b| b.len() == 32).ok_or_else(|| {
            "a GamePak host key is 64 hex digits, as `pc-gamepak --host-agent` prints it"
                .to_string()
        })?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(Key(key))
    }

    pub fn to_hex(&self) -> String {
        encode_hex(&self.0)
    }
}

/// The host's key file, beside its GamePak registry.
pub fn key_path() -> PathBuf {
    crate::gamepak::registry_path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default()
        .join("host-agent.key")
}

/// The host's key, made and saved the first time it is asked for.
pub fn load_or_create_key(path: &Path) -> Result<Key, String> {
    if let Ok(text) = std::fs::read_to_string(path) {
        return Key::from_hex(&text);
    }
    let key = Key::generate()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, key.to_hex())
        .map_err(|e| format!("could not save the host key to {}: {e}", path.display()))?;
    Ok(key)
}

/// HMAC-SHA256, RFC 2104, over the hasher [`crate::verify`] already carries.
fn hmac(key: &Key, message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    block[..32].copy_from_slice(&key.0);
    let mut inner = Sha256::new();
    inner.update(&block.map(|b| b ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(&block.map(|b| b ^ 0x5c));
    outer.update(&inner.digest());
    outer.digest()
}

// --------------------------------------------------------------------------
// The wire
// --------------------------------------------------------------------------

/// What a client can ask.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Op {
    /// Start the game, without a stream. Answers once it has been started.
    Prime,
    /// Is it still running?
    Status,
    /// Close it, letting it save first where it will.
    Stop,
}

impl Op {
    fn name(self) -> &'static str {
        match self {
            Op::Prime => "prime",
            Op::Status => "status",
            Op::Stop => "stop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub op: Op,
    pub gamepak: String,
    pub time: u64,
    pub nonce: String,
    pub mac: String,
}

impl Request {
    fn signed_part(op: Op, gamepak: &str, time: u64, nonce: &str) -> String {
        format!("pc-gamepak/1\n{}\n{gamepak}\n{time}\n{nonce}", op.name())
    }

    pub fn new(key: &Key, op: Op, gamepak: &GamePakId, time: u64) -> Result<Request, String> {
        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|e| format!("no randomness for a nonce: {e}"))?;
        let nonce = encode_hex(&nonce);
        let mac = encode_hex(&hmac(
            key,
            Self::signed_part(op, gamepak.as_str(), time, &nonce).as_bytes(),
        ));
        Ok(Request {
            op,
            gamepak: gamepak.as_str().to_string(),
            time,
            nonce,
            mac,
        })
    }
}

/// Where a primed game is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Started and still running, as far as the host can tell.
    Running,
    /// Not running: never started, ended by itself, or stopped.
    Stopped,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<State>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The cartridge's cover, as a `data:` URI, so the client can show it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
}

impl Reply {
    pub fn refused(why: impl Into<String>) -> Reply {
        Reply {
            ok: false,
            error: Some(why.into()),
            ..Reply::default()
        }
    }
}

// --------------------------------------------------------------------------
// The client's half
// --------------------------------------------------------------------------

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Ask the agent at `address` (`host:port`) to do `op` to `gamepak`.
///
/// `timeout` covers connecting and each read; a prime answers as soon as the
/// game has been started, not when it is on screen.
pub fn ask(
    address: &str,
    key: &Key,
    op: Op,
    gamepak: &GamePakId,
    timeout: Duration,
) -> Result<Reply, String> {
    let target = address
        .to_socket_addrs()
        .map_err(|e| format!("{address} is not a host and port: {e}"))?
        .next()
        .ok_or_else(|| format!("{address} did not resolve"))?;
    let mut stream = TcpStream::connect_timeout(&target, timeout)
        .map_err(|e| format!("could not reach the GamePak host at {address}: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();

    let request = Request::new(key, op, gamepak, now_unix())?;
    let mut line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|e| format!("could not send to {address}: {e}"))?;

    let mut answer = String::new();
    BufReader::new(stream.take(MAX_REPLY_BYTES))
        .read_line(&mut answer)
        .map_err(|e| format!("no answer from {address}: {e}"))?;
    let reply: Reply = serde_json::from_str(answer.trim())
        .map_err(|e| format!("{address} answered with something that is not a reply: {e}"))?;
    if reply.ok {
        Ok(reply)
    } else {
        Err(reply
            .error
            .unwrap_or_else(|| format!("the host at {address} refused")))
    }
}

/// A remote GamePak as this client's registry describes it.
#[derive(Debug, Clone)]
pub struct Remote {
    /// The ID on this client.
    pub id: GamePakId,
    /// The ID on the host.
    pub host_id: GamePakId,
    pub agent: String,
    pub key: Key,
    pub moonlight: String,
    pub app: String,
}

impl Remote {
    /// Look `id` up in the client's registry. An error unless it is a remote
    /// action.
    pub fn resolve(registry: &Path, id: &str) -> Result<Remote, String> {
        let id = GamePakId::parse(id.trim())?;
        let pak = crate::gamepak::lookup_from(registry, &id)?;
        let crate::gamepak::Action::Remote {
            agent,
            key,
            moonlight,
            app,
            host_id,
        } = pak.action
        else {
            return Err(format!("GamePak {} is not a remote game", id.as_str()));
        };
        // Handed to Moonlight as arguments, so never something it would read
        // as an option.
        if moonlight.trim().is_empty() || moonlight.starts_with('-') || app.starts_with('-') {
            return Err("a remote GamePak needs the host's Moonlight name and an app".into());
        }
        Ok(Remote {
            host_id: match host_id {
                Some(other) => GamePakId::parse(&other)?,
                None => id.clone(),
            },
            id,
            key: Key::from_hex(&key)?,
            agent,
            moonlight,
            app,
        })
    }

    /// The launcher's stand-in drive path for this GamePak.
    pub fn marker(&self) -> String {
        format!("{MARKER}{}", self.id.as_str())
    }

    /// Start the game on the host, without a stream.
    pub fn prime(&self) -> Result<Reply, String> {
        ask(
            &self.agent,
            &self.key,
            Op::Prime,
            &self.host_id,
            Duration::from_secs(30),
        )
    }

    pub fn status(&self) -> Result<Reply, String> {
        ask(
            &self.agent,
            &self.key,
            Op::Status,
            &self.host_id,
            Duration::from_secs(10),
        )
    }

    /// Close the game on the host. Long timeout: a game asked to close may
    /// take a while to save first.
    pub fn stop(&self) -> Result<Reply, String> {
        ask(
            &self.agent,
            &self.key,
            Op::Stop,
            &self.host_id,
            Duration::from_secs(90),
        )
    }

    /// Start streaming. Returns once Moonlight has been started.
    pub fn stream(&self) -> Result<std::process::Child, String> {
        std::process::Command::new(crate::gamepak::moonlight_program())
            .args(["stream", &self.moonlight, &self.app])
            .stdin(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start Moonlight: {e}"))
    }

    /// End the stream and the app session on the host, waiting up to 20
    /// seconds for Moonlight to say so. A host with no session is not an error.
    pub fn quit(&self) -> Result<(), String> {
        let mut child = std::process::Command::new(crate::gamepak::moonlight_program())
            .args(["quit", &self.moonlight])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start Moonlight: {e}"))?;
        let started = std::time::Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let _ = child.kill();
        Err("Moonlight did not finish quitting within 20 seconds".into())
    }
}

// --------------------------------------------------------------------------
// The host's half
// --------------------------------------------------------------------------

/// What the host does with a request that checked out. The agent in the
/// launcher implements this; the tests use a fake.
pub trait Host {
    fn prime(&mut self, id: &GamePakId) -> Reply;
    fn status(&mut self, id: &GamePakId) -> Reply;
    fn stop(&mut self, id: &GamePakId) -> Reply;
}

/// Nonces seen inside the skew window, so a recorded request cannot be sent
/// twice. Older ones are forgotten: their timestamps already refuse them.
#[derive(Default)]
pub struct Seen(HashMap<String, u64>);

/// Check a request: its MAC, its age, and that it is new. The ID it names on
/// success, or why it was refused.
pub fn check(request: &Request, key: &Key, now: u64, seen: &mut Seen) -> Result<GamePakId, String> {
    let expected = hmac(
        key,
        Request::signed_part(request.op, &request.gamepak, request.time, &request.nonce).as_bytes(),
    );
    let given = decode_hex(&request.mac).unwrap_or_default();
    if !same(&given, &expected) {
        return Err("not signed with this host's key: pair the client again".into());
    }
    if request.time.abs_diff(now) > MAX_SKEW_SECONDS {
        return Err(format!(
            "the two clocks are more than {MAX_SKEW_SECONDS} seconds apart; set both to network time"
        ));
    }
    seen.0.retain(|_, at| now.abs_diff(*at) <= MAX_SKEW_SECONDS);
    if seen.0.insert(request.nonce.clone(), request.time).is_some() {
        return Err("this request has been seen before".into());
    }
    GamePakId::parse(&request.gamepak)
}

/// Answer one connection.
pub fn handle(stream: TcpStream, key: &Key, seen: &mut Seen, host: &mut dyn Host) {
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_default();
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut line = String::new();
    let reply = match BufReader::new(stream.take(MAX_REQUEST_BYTES)).read_line(&mut line) {
        Err(e) => Reply::refused(format!("could not read the request: {e}")),
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Err(_) => Reply::refused("that is not a GamePak request"),
            Ok(request) => match check(&request, key, now_unix(), seen) {
                Err(why) => Reply::refused(why),
                Ok(id) => match request.op {
                    Op::Prime => host.prime(&id),
                    Op::Status => host.status(&id),
                    Op::Stop => host.stop(&id),
                },
            },
        },
    };
    if !reply.ok {
        eprintln!(
            "host agent: refused {peer}: {}",
            reply.error.as_deref().unwrap_or("")
        );
    }
    if let Ok(mut text) = serde_json::to_string(&reply) {
        text.push('\n');
        let _ = writer.write_all(text.as_bytes());
    }
}

/// Answer connections on `listener` for as long as the process lives, one at a
/// time: a prime is quick, and two clients priming the same PC at once is not
/// something to interleave.
pub fn serve(listener: TcpListener, key: &Key, host: &mut dyn Host) {
    let mut seen = Seen::default();
    for stream in listener.incoming().flatten() {
        handle(stream, key, &mut seen, host);
    }
}

// --------------------------------------------------------------------------
// Small things
// --------------------------------------------------------------------------

/// The GamePak ID a launcher marker names, or `None` for a real drive path.
pub fn marker_id(drive_path: &str) -> Option<&str> {
    drive_path.strip_prefix(MARKER)
}

/// Equal, without stopping at the first difference.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> Key {
        Key::from_hex(&"ab".repeat(32)).unwrap()
    }

    fn id() -> GamePakId {
        GamePakId::parse("gp_cyberpunk").unwrap()
    }

    #[test]
    fn hmac_matches_rfc_4231_and_python() {
        // RFC 4231 test case 2. Its key is "Jefe"; HMAC pads a short key with
        // zeroes, so the same key padded to our 32 bytes gives the same MAC.
        let mut jefe = [0u8; 32];
        jefe[..4].copy_from_slice(b"Jefe");
        assert_eq!(
            encode_hex(&hmac(&Key(jefe), b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // A full 32-byte key, checked against Python's hmac module.
        assert_eq!(
            encode_hex(&hmac(&key(), b"what do ya want for nothing?")),
            "54c2b20c16f56b8432c429fd77ef6d9568c6f5e69024a87e6c850a8fd6b78c58"
        );
    }

    #[test]
    fn a_key_round_trips_through_hex_and_bad_ones_are_refused() {
        let key = Key::generate().unwrap();
        assert_eq!(Key::from_hex(&key.to_hex()).unwrap(), key);
        assert!(Key::from_hex("abcd").is_err());
        assert!(Key::from_hex(&"zz".repeat(32)).is_err());
    }

    #[test]
    fn a_signed_request_is_accepted_once() {
        let now = 1_800_000_000;
        let request = Request::new(&key(), Op::Prime, &id(), now).unwrap();
        let mut seen = Seen::default();
        assert_eq!(check(&request, &key(), now, &mut seen).unwrap(), id());
        assert!(check(&request, &key(), now + 1, &mut seen)
            .unwrap_err()
            .contains("seen before"));
    }

    #[test]
    fn another_key_a_changed_field_or_an_old_request_is_refused() {
        let now = 1_800_000_000;
        let request = Request::new(&key(), Op::Prime, &id(), now).unwrap();
        let other = Key::from_hex(&"cd".repeat(32)).unwrap();
        assert!(check(&request, &other, now, &mut Seen::default()).is_err());

        let mut changed = request.clone();
        changed.op = Op::Stop;
        assert!(check(&changed, &key(), now, &mut Seen::default()).is_err());
        let mut renamed = request.clone();
        renamed.gamepak = "gp_other".into();
        assert!(check(&renamed, &key(), now, &mut Seen::default()).is_err());

        assert!(check(
            &request,
            &key(),
            now + MAX_SKEW_SECONDS + 1,
            &mut Seen::default()
        )
        .unwrap_err()
        .contains("clocks"));
    }

    #[test]
    fn markers_name_their_id_and_drives_do_not() {
        assert_eq!(marker_id("gamepak-remote://gp_x"), Some("gp_x"));
        assert_eq!(marker_id("E:\\"), None);
        assert_eq!(marker_id("/run/media/you/CART"), None);
    }

    #[test]
    fn a_remote_gamepak_resolves_from_the_client_registry() {
        let scratch = crate::testutil::Scratch::new("remote-registry");
        let registry = scratch.path().join("gamepaks.json");
        std::fs::write(
            &registry,
            format!(
                r#"{{"gamepaks":[
                  {{"id":"gp_cp","action":{{"type":"remote","agent":"10.0.0.5:47820",
                    "key":"{}","moonlight":"GAMING-PC","hostId":"gp_cyberpunk"}}}},
                  {{"id":"gp_bad","action":{{"type":"remote","agent":"10.0.0.5:47820",
                    "key":"{}","moonlight":"--help"}}}},
                  {{"id":"gp_steam","action":{{"type":"steam","appId":1}}}}
                ]}}"#,
                "ab".repeat(32),
                "ab".repeat(32)
            ),
        )
        .unwrap();
        let remote = Remote::resolve(&registry, "gp_cp").unwrap();
        assert_eq!(remote.host_id.as_str(), "gp_cyberpunk");
        assert_eq!(remote.app, "Desktop");
        assert_eq!(remote.marker(), "gamepak-remote://gp_cp");
        assert!(Remote::resolve(&registry, "gp_bad").is_err());
        assert!(Remote::resolve(&registry, "gp_steam").is_err());
        assert_eq!(
            crate::gamepak::trigger_from(&registry, "gp_cp").unwrap(),
            crate::gamepak::Outcome::OpenRemote(GamePakId::parse("gp_cp").unwrap())
        );
    }

    struct Fake(Vec<(Op, String)>);
    impl Host for Fake {
        fn prime(&mut self, id: &GamePakId) -> Reply {
            self.0.push((Op::Prime, id.as_str().into()));
            Reply {
                ok: true,
                state: Some(State::Running),
                title: Some("Cyberpunk 2077".into()),
                ..Reply::default()
            }
        }
        fn status(&mut self, id: &GamePakId) -> Reply {
            self.0.push((Op::Status, id.as_str().into()));
            Reply {
                ok: true,
                state: Some(State::Running),
                ..Reply::default()
            }
        }
        fn stop(&mut self, id: &GamePakId) -> Reply {
            self.0.push((Op::Stop, id.as_str().into()));
            Reply {
                ok: true,
                state: Some(State::Stopped),
                ..Reply::default()
            }
        }
    }

    #[test]
    fn a_client_and_a_host_talk_over_a_real_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let server = std::thread::spawn(move || {
            let mut host = Fake(Vec::new());
            let mut seen = Seen::default();
            for stream in listener.incoming().take(3).flatten() {
                handle(stream, &key(), &mut seen, &mut host);
            }
            host.0
        });

        let wait = Duration::from_secs(5);
        let primed = ask(&address, &key(), Op::Prime, &id(), wait).unwrap();
        assert_eq!(primed.title.as_deref(), Some("Cyberpunk 2077"));
        let stopped = ask(&address, &key(), Op::Stop, &id(), wait).unwrap();
        assert_eq!(stopped.state, Some(State::Stopped));
        let wrong = Key::from_hex(&"cd".repeat(32)).unwrap();
        let refused = ask(&address, &wrong, Op::Stop, &id(), wait).unwrap_err();
        assert!(refused.contains("pair the client again"), "{refused}");

        // The refused request never reached the host.
        let calls = server.join().unwrap();
        assert_eq!(
            calls,
            [
                (Op::Prime, "gp_cyberpunk".into()),
                (Op::Stop, "gp_cyberpunk".into())
            ]
        );
    }
}
