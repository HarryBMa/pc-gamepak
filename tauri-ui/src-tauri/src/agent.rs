//! `pc-gamepak --host-agent`: the gaming PC's half of priming.
//!
//! Listens on the LAN for signed requests from a client's launcher (see
//! [`gamepak_core::remote`]) and answers them from this PC's own GamePak
//! registry:
//!
//! * **prime** starts the GamePak the way `--trigger` would here, except that
//!   a cartridge is played headless (`--drive <path> --play 0`) instead of
//!   opening the window at READY. So the game is running, its hours are being
//!   counted and its saves come off the cartridge, before anyone has pressed
//!   Play on the couch. Nothing is streamed: that is Moonlight's, on Play.
//! * **status** says whether it is still running.
//! * **stop** closes it the way Eject's "close and eject" does — asked first,
//!   forced only if it will not go — and waits for the headless player to
//!   push the saves back.
//!
//! No window, and nothing else is listened for. The key is in
//! `host-agent.key` beside the registry; every request is checked against it
//! before this module sees it.

use std::collections::HashMap;
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use gamepak_core::gamepak::{self, Action, GamePakAction, GamePakId};
use gamepak_core::remote::{self, Reply, State};
use gamepak_core::{busy, cartridge, play, playtrack, steam};

/// A cartridge game this agent started and is watching.
struct Running {
    player: Child,
    root: PathBuf,
    executable: String,
    title: String,
    cover: String,
}

struct Agent {
    registry: PathBuf,
    running: HashMap<String, Running>,
}

/// `--host-agent [--port N]`: serve until the process is ended.
pub fn run(args: &[String]) -> i32 {
    let port = args
        .iter()
        .position(|arg| arg == "--port")
        .and_then(|at| args.get(at + 1))
        .and_then(|value| value.parse::<u16>().ok())
        .or_else(|| {
            std::env::var("PC_GAMEPAK_AGENT_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
        })
        .unwrap_or(remote::DEFAULT_PORT);

    let key_path = remote::key_path();
    let key = match remote::load_or_create_key(&key_path) {
        Ok(key) => key,
        Err(why) => {
            log(&format!("host agent: {why}"));
            return 1;
        }
    };
    if args.iter().any(|arg| arg == "--print-key") {
        println!("{}", key.to_hex());
        return 0;
    }

    let listener = match TcpListener::bind(("0.0.0.0", port)) {
        Ok(listener) => listener,
        Err(why) => {
            log(&format!(
                "host agent: could not listen on port {port}: {why}"
            ));
            return 1;
        }
    };
    log(&format!(
        "host agent listening on port {port}; key in {}",
        key_path.display()
    ));

    let mut agent = Agent {
        registry: gamepak::registry_path(),
        running: HashMap::new(),
    };
    remote::serve(listener, &key, &mut agent);
    0
}

impl remote::Host for Agent {
    fn prime(&mut self, id: &GamePakId) -> Reply {
        if let Some(running) = self.running.get_mut(id.as_str()) {
            if matches!(running.player.try_wait(), Ok(None)) {
                log(&format!("prime {}: already running", id.as_str()));
                return running_reply(running);
            }
        }
        self.running.remove(id.as_str());

        let pak = match gamepak::lookup_from(&self.registry, id) {
            Ok(pak) => pak,
            Err(why) => return Reply::refused(why),
        };
        // Wake-on-LAN and readiness are for a host this PC would reach out
        // to; on the host itself there is nothing to wake.
        match pak.action {
            Action::Cartridge { path } => match self.start_cartridge(id, path) {
                Ok(reply) => reply,
                Err(why) => Reply::refused(why),
            },
            Action::Remote { .. } => Reply::refused(
                "that GamePak is remote here too; register the game itself on the host",
            ),
            action => match action.execute() {
                Ok(()) => {
                    log(&format!("prime {}: started", id.as_str()));
                    Reply {
                        ok: true,
                        state: Some(State::Running),
                        title: pak.title,
                        ..Reply::default()
                    }
                }
                Err(why) => Reply::refused(why),
            },
        }
    }

    fn status(&mut self, id: &GamePakId) -> Reply {
        let alive = self
            .running
            .get_mut(id.as_str())
            .is_some_and(|running| matches!(running.player.try_wait(), Ok(None)));
        let state = if alive {
            State::Running
        } else {
            State::Stopped
        };
        Reply {
            ok: true,
            state: Some(state),
            ..Reply::default()
        }
    }

    fn stop(&mut self, id: &GamePakId) -> Reply {
        let Some(mut running) = self.running.remove(id.as_str()) else {
            // Nothing this agent started. Saying it is stopped is the truth as
            // far as the agent can tell, and a Stop that errors after a game
            // ended by itself would be a confusing Eject.
            return Reply {
                ok: true,
                state: Some(State::Stopped),
                ..Reply::default()
            };
        };

        let dirs = playtrack::watch_dirs(
            &running.root,
            &running.executable,
            steam::steam_root().as_deref(),
        );
        let mut survived = Vec::new();
        for dir in &dirs {
            let stopped = busy::stop_all_within(dir, 15);
            survived.extend(stopped.survived);
        }

        // The headless player notices the game has gone, pushes the saves and
        // closes the session. Give it the time that takes.
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(60) {
            if !matches!(running.player.try_wait(), Ok(None)) {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        log(&format!(
            "stop {}: closed in {:.0?}{}",
            id.as_str(),
            started.elapsed(),
            if survived.is_empty() {
                String::new()
            } else {
                format!(", {} would not close", survived.len())
            }
        ));
        if survived.is_empty() {
            Reply {
                ok: true,
                state: Some(State::Stopped),
                ..Reply::default()
            }
        } else {
            Reply::refused(format!(
                "{} process(es) of {} would not close on the host",
                survived.len(),
                running.title
            ))
        }
    }
}

impl Agent {
    fn start_cartridge(&mut self, id: &GamePakId, path: PathBuf) -> Result<Reply, String> {
        let drive = path.to_string_lossy().into_owned();
        let info = cartridge::read_cartridge_info(&drive)?;
        // A collection's first game. Picking one of several from the couch
        // would need the client's rail, which it does not have yet.
        let pick = play::pick(&info, 0)?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let player = Command::new(exe)
            .args(["--drive", &drive, "--play", "0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start the game: {e}"))?;
        log(&format!(
            "prime {}: playing {} from {drive}",
            id.as_str(),
            pick.title
        ));
        let running = Running {
            player,
            root: path,
            executable: pick.executable,
            title: pick.title,
            cover: info.cover,
        };
        let reply = running_reply(&running);
        self.running.insert(id.as_str().to_string(), running);
        Ok(reply)
    }
}

fn running_reply(running: &Running) -> Reply {
    Reply {
        ok: true,
        state: Some(State::Running),
        title: Some(running.title.clone()),
        cover: (!running.cover.is_empty()).then(|| running.cover.clone()),
        ..Reply::default()
    }
}

/// The agent has no window and, built for Windows, no console either, so it
/// keeps its own log beside its key.
fn log(line: &str) {
    eprintln!("{line}");
    let path = remote::key_path().with_file_name("host-agent.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "[{}] {line}", remote::now_unix());
    }
}
