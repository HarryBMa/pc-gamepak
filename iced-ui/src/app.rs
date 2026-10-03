//! The launcher: state, update and view.
//!
//! Domain state is core's own types (`CartridgeInfo`, `GameEntry`); what lives
//! here is only what the window needs on top — which game is picked, what the
//! last action came to, whether the debug panel is open. Every piece of work is
//! a core call run off the UI thread, and every failure is a state the view
//! draws, never a panic.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use gamepak_core::cartridge::{self, CartridgeInfo};
use gamepak_core::{busy, drives, eject, launch, saves, settings, shaders, stats};
use iced::widget::{button, column, container, image, row, scrollable, text, Space};
use iced::{event, keyboard, Alignment, Element, Length, Subscription, Task, Theme};

use crate::pad::{self, Pad};

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

pub struct Launcher {
    drive: String,
    cartridge: Cartridge,
    selected: usize,
    action: Action,
    /// Whether the drive's root was there at the last check.
    present: bool,
    ejectable: bool,
    debug: bool,
    pad: Option<String>,
    log: Vec<String>,
    close_at: Option<Instant>,
}

enum Cartridge {
    Loading,
    /// No cartridge to show, and why: never started with one, removed, or it
    /// would not read.
    Missing(String),
    Ready(Box<CartridgeInfo>),
}

#[derive(Debug, Clone, PartialEq)]
enum Action {
    Idle,
    Launching(String),
    Launched(String),
    LaunchFailed(String),
    Ejecting,
    /// Something is still using the drive; the player chooses.
    InUse(String),
    Ejected(String),
    EjectFailed(String),
}

/// One game as the view draws it: a collection's `[game]`, or the single game
/// a plain cartridge is.
struct Game<'a> {
    title: &'a str,
    executable: &'a str,
    cover_path: &'a str,
}

impl Launcher {
    pub fn new(drive: String) -> (Self, Task<Message>) {
        let mut launcher = Self {
            present: !drive.is_empty() && Path::new(&drive).exists(),
            ejectable: !drive.is_empty() && drives::is_ejectable(Path::new(&drive)),
            drive,
            cartridge: Cartridge::Loading,
            selected: 0,
            action: Action::Idle,
            debug: false,
            pad: None,
            log: Vec::new(),
            close_at: None,
        };
        let task = launcher.load();
        (launcher, task)
    }

    fn load(&mut self) -> Task<Message> {
        if self.drive.is_empty() {
            self.cartridge = Cartridge::Missing(
                "Started without a cartridge. Run with --drive <path>, or let the watcher open it."
                    .into(),
            );
            return Task::none();
        }
        self.cartridge = Cartridge::Loading;
        self.note(format!("reading {}", self.drive));
        let drive = self.drive.clone();
        Task::perform(
            off_thread(move || cartridge::read_cartridge_info(&drive)),
            |result| Message::Loaded(result.and_then(|inner| inner.map(Box::new))),
        )
    }

    fn games(&self) -> Vec<Game<'_>> {
        let Cartridge::Ready(info) = &self.cartridge else {
            return Vec::new();
        };
        if info.games.is_empty() {
            vec![Game {
                title: &info.title,
                executable: &info.executable,
                cover_path: &info.cover_path,
            }]
        } else {
            info.games
                .iter()
                .map(|game| Game {
                    title: &game.title,
                    executable: &game.executable,
                    cover_path: &game.cover_path,
                })
                .collect()
        }
    }

    fn note(&mut self, line: String) {
        self.log.push(line);
        if self.log.len() > 40 {
            self.log.remove(0);
        }
    }

    fn busy(&self) -> bool {
        matches!(self.action, Action::Launching(_) | Action::Ejecting)
    }
}

// --------------------------------------------------------------------------
// Messages and update
// --------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum Message {
    Loaded(Result<Box<CartridgeInfo>, String>),
    Synced(Vec<String>),
    Select(usize),
    Move(i32),
    Play,
    Launched(Result<String, String>),
    Eject,
    ForceEject,
    KeepMounted,
    Ejected(Result<String, String>),
    Tick,
    Refresh,
    ToggleDebug,
    Back,
    Pad(Pad),
}

pub fn update(state: &mut Launcher, message: Message) -> Task<Message> {
    match message {
        Message::Loaded(Ok(info)) => {
            let count = info.games.len().max(1);
            state.note(format!("read \"{}\", {count} game(s)", info.title));
            state.cartridge = Cartridge::Ready(info);
            state.selected = state.selected.min(count - 1);
            // What the Tauri launcher does on insert: bring saves and shader
            // caches in off the cartridge, if they are wanted.
            let drive = state.drive.clone();
            return Task::perform(off_thread(move || insert_sync(&drive)), |notes| {
                Message::Synced(notes.unwrap_or_else(|e| vec![e]))
            });
        }
        Message::Loaded(Err(why)) => {
            state.note(format!("read failed: {why}"));
            state.cartridge = Cartridge::Missing(why);
        }
        Message::Synced(notes) => {
            for line in notes {
                state.note(line);
            }
        }
        Message::Select(index) => {
            if index < state.games().len() {
                state.selected = index;
            }
        }
        Message::Move(step) => {
            let count = state.games().len() as i32;
            if count > 0 {
                state.selected = (state.selected as i32 + step).rem_euclid(count) as usize;
            }
        }
        Message::Play => return play(state),
        Message::Launched(Ok(note)) => {
            state.note(format!("launched: {note}"));
            state.action = Action::Launched(note);
        }
        Message::Launched(Err(why)) => {
            state.note(format!("launch failed: {why}"));
            state.action = Action::LaunchFailed(why);
        }
        Message::Eject => return eject(state, false),
        Message::ForceEject => return eject(state, true),
        Message::KeepMounted => state.action = Action::Idle,
        Message::Ejected(Ok(message)) => {
            state.note(format!("ejected: {message}"));
            state.action = Action::Ejected(message);
            // Long enough to read "Safe to remove" from across the room.
            state.close_at = Some(Instant::now() + Duration::from_secs(3));
        }
        Message::Ejected(Err(why)) => {
            state.note(format!("eject failed: {why}"));
            state.action = if why.starts_with("Still in use: ") {
                Action::InUse(why.trim_start_matches("Still in use: ").to_string())
            } else {
                Action::EjectFailed(why)
            };
        }
        Message::Tick => {
            if state.close_at.is_some_and(|at| Instant::now() >= at) {
                return iced::exit();
            }
            // The drive leaving, or coming back, is noticed here. Not a second
            // watcher — the watcher closes a launcher it opened when its drive
            // goes — just this window checking its own root once a second, so
            // one started by hand does not sit on a cartridge that has gone.
            if state.drive.is_empty() || matches!(state.action, Action::Ejected(_)) {
                return Task::none();
            }
            let present = Path::new(&state.drive).exists();
            if present != state.present {
                state.present = present;
                if present {
                    state.note("drive came back".into());
                    state.action = Action::Idle;
                    return state.load();
                }
                state.note("drive went away".into());
                state.cartridge = Cartridge::Missing("The cartridge was removed.".into());
            }
        }
        Message::Refresh => return state.load(),
        Message::ToggleDebug => state.debug = !state.debug,
        Message::Back => {
            if matches!(state.action, Action::InUse(_)) {
                state.action = Action::Idle;
            } else if state.debug {
                state.debug = false;
            } else {
                return iced::exit();
            }
        }
        Message::Pad(event) => {
            return match event {
                Pad::Connected(name) => {
                    state.note(format!("pad: {name}"));
                    state.pad = Some(name);
                    Task::none()
                }
                Pad::Disconnected => {
                    state.pad = None;
                    Task::none()
                }
                Pad::Move(step) => update(state, Message::Move(step)),
                Pad::Confirm => update(
                    state,
                    if matches!(state.action, Action::InUse(_)) {
                        Message::ForceEject
                    } else {
                        Message::Play
                    },
                ),
                Pad::Back => update(state, Message::Back),
                Pad::Eject => update(state, Message::Eject),
                Pad::Debug => update(state, Message::ToggleDebug),
            };
        }
    }
    Task::none()
}

fn play(state: &mut Launcher) -> Task<Message> {
    if state.busy() {
        return Task::none();
    }
    let Some(game) = state.games().into_iter().nth(state.selected) else {
        return Task::none();
    };
    let (drive, executable, title) = (
        state.drive.clone(),
        game.executable.to_string(),
        game.title.to_string(),
    );
    state.action = Action::Launching(title.clone());
    state.note(format!("play {title}: {executable}"));
    Task::perform(
        off_thread(move || {
            let quiet = |_: String| {};
            match launch::start(&drive, &executable, &quiet)? {
                launch::Started::Handed => {
                    Ok(format!("{title} handed to {}", integration(&executable)))
                }
                launch::Started::Carried(mut child) => {
                    // Reaped here so it does not linger as a zombie on Linux.
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    Ok(format!("{title} started from the cartridge"))
                }
            }
        }),
        |result| Message::Launched(result.and_then(|inner| inner)),
    )
}

fn eject(state: &mut Launcher, force: bool) -> Task<Message> {
    if state.busy() || !state.ejectable {
        return Task::none();
    }
    state.action = Action::Ejecting;
    let drive = state.drive.clone();
    Task::perform(off_thread(move || eject_now(&drive, force)), |result| {
        Message::Ejected(result.and_then(|inner| inner))
    })
}

/// Eject the way the Tauri launcher does: refuse while anything is using the
/// volume unless forced, settle the cartridge's files, then take it away.
fn eject_now(drive: &str, force: bool) -> Result<String, String> {
    let root = Path::new(drive);
    let mut message = "Safe to remove".to_string();
    if force {
        let stopped = busy::stop_all(root);
        if !stopped.survived.is_empty() {
            return Err(format!(
                "{} process(es) would not close, so the cartridge was left mounted.",
                stopped.survived.len()
            ));
        }
        if !stopped.killed.is_empty() {
            message = format!("Safe to remove ({} forced to close)", stopped.killed.len());
        }
    } else {
        let holders = busy::holders(root).excluding(&[std::process::id()]);
        if !holders.is_empty() {
            return Err(format!("Still in use: {}", holders.summary(3)));
        }
    }
    eject::settle(drive, &|_| {});
    eject::eject(drive)?;
    Ok(message)
}

/// What the Tauri launcher does on insert, from core.
fn insert_sync(drive: &str) -> Vec<String> {
    let root = Path::new(drive);
    let mut notes = Vec::new();
    if settings::load().save_sync {
        for result in saves::attach_all(root) {
            match result {
                Ok(done) => notes.push(format!("saves: {} {:?}", done.label, done.direction)),
                Err(why) => notes.push(format!("saves: {why}")),
            }
        }
    }
    if shaders::wanted(root) {
        let pulled = shaders::pull_all(root)
            .into_iter()
            .filter(Result::is_ok)
            .count();
        notes.push(format!("shaders: {pulled} cache(s) brought in"));
    }
    notes
}

/// Which launcher a URI hands the game to, in words.
fn integration(executable: &str) -> &'static str {
    let lower = executable.to_lowercase();
    match lower.split("://").next().unwrap_or("") {
        "steam" => "Steam",
        "playnite" => "Playnite",
        "heroic" => "Heroic",
        "gog" => "GOG Galaxy",
        "epic" => "Epic",
        "lutris" => "Lutris",
        "http" | "https" => "the browser",
        _ if launch::is_uri(executable) => "another launcher",
        _ => "the cartridge",
    }
}

/// Run blocking core work on a thread of its own and hand back its result,
/// so the window keeps drawing while a drive is read or ejected.
fn off_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> impl std::future::Future<Output = Result<T, String>> {
    let (sender, receiver) = iced::futures::channel::oneshot::channel();
    std::thread::spawn(move || {
        let _ = sender.send(work());
    });
    async move {
        receiver
            .await
            .map_err(|_| "the worker thread stopped".to_string())
    }
}

// --------------------------------------------------------------------------
// Subscriptions
// --------------------------------------------------------------------------

pub fn subscription(_state: &Launcher) -> Subscription<Message> {
    Subscription::batch([
        event::listen_with(|event, status, _window| match event {
            iced::Event::Keyboard(keyboard::Event::KeyPressed { key, .. })
                if status == event::Status::Ignored =>
            {
                on_key(key)
            }
            _ => None,
        }),
        iced::time::every(Duration::from_secs(1)).map(|_| Message::Tick),
        pad::subscription().map(Message::Pad),
    ])
}

fn on_key(key: keyboard::Key) -> Option<Message> {
    use keyboard::key::Named;
    match key {
        keyboard::Key::Named(Named::Enter | Named::Space) => Some(Message::Play),
        keyboard::Key::Named(Named::ArrowUp | Named::ArrowLeft) => Some(Message::Move(-1)),
        keyboard::Key::Named(Named::ArrowDown | Named::ArrowRight) => Some(Message::Move(1)),
        keyboard::Key::Named(Named::Escape) => Some(Message::Back),
        keyboard::Key::Named(Named::F12) => Some(Message::ToggleDebug),
        keyboard::Key::Named(Named::F5) => Some(Message::Refresh),
        keyboard::Key::Character(c) => match c.as_str() {
            "e" | "E" => Some(Message::Eject),
            "d" | "D" => Some(Message::ToggleDebug),
            "r" | "R" => Some(Message::Refresh),
            digit => digit
                .parse::<usize>()
                .ok()
                .filter(|n| (1..=9).contains(n))
                .map(|n| Message::Select(n - 1)),
        },
        _ => None,
    }
}

// --------------------------------------------------------------------------
// View
// --------------------------------------------------------------------------

pub fn title(state: &Launcher) -> String {
    match &state.cartridge {
        Cartridge::Ready(info) => format!("{} — PC GamePak (Iced)", info.title),
        _ => "PC GamePak (Iced)".into(),
    }
}

pub fn theme(_state: &Launcher) -> Theme {
    Theme::Dark
}

pub fn view(state: &Launcher) -> Element<'_, Message> {
    let header = row![
        text("PC GAMEPAK").size(18),
        Space::new().width(Length::Fill),
        text(if state.drive.is_empty() {
            "no drive".to_string()
        } else {
            state.drive.clone()
        })
        .size(14),
        text("   F12 debug").size(12),
    ]
    .align_y(Alignment::Center)
    .padding([12, 20]);

    let body: Element<'_, Message> = match &state.cartridge {
        Cartridge::Loading => centered(column![text("Reading cartridge…").size(22)]),
        Cartridge::Missing(why) => centered(
            column![
                text("No cartridge").size(28),
                text(why.clone()).size(15),
                button("Retry (R)").on_press(Message::Refresh),
            ]
            .spacing(14)
            .align_x(Alignment::Center),
        ),
        Cartridge::Ready(info) => ready(state, info),
    };

    let mut layout = row![column![header, body].width(Length::Fill)];
    if state.debug {
        layout = layout.push(debug_panel(state));
    }
    layout.into()
}

fn centered<'a>(content: impl Into<Element<'a, Message>>) -> Element<'a, Message> {
    container(content)
        .width(Length::Fill)
        .height(Length::Fill)
        .center_x(Length::Fill)
        .center_y(Length::Fill)
        .into()
}

fn ready<'a>(state: &'a Launcher, info: &'a CartridgeInfo) -> Element<'a, Message> {
    let games = state.games();
    let game = &games[state.selected.min(games.len() - 1)];

    // The library: every game on the cartridge, the picked one filled.
    let mut list = column![text(info.title.clone()).size(15)].spacing(6);
    for (index, entry) in games.iter().enumerate() {
        let label = format!("{}  {}", index + 1, entry.title);
        let mut item = button(text(label).size(15))
            .width(Length::Fill)
            .on_press(Message::Select(index));
        item = item.style(if index == state.selected {
            button::primary
        } else {
            button::secondary
        });
        list = list.push(item);
    }
    let library = container(scrollable(list)).width(240).padding([0, 16]);

    // The picked game: art, title, where it launches, what the drive knows.
    let art: Element<'_, Message> = {
        let path = PathBuf::from(if game.cover_path.is_empty() {
            &info.cover_path
        } else {
            game.cover_path
        });
        if path.is_file() {
            image(image::Handle::from_path(path)).height(300).into()
        } else {
            container(text("No artwork").size(14))
                .width(200)
                .height(300)
                .center_x(200)
                .center_y(300)
                .style(container::bordered_box)
                .into()
        }
    };
    let played = stats::for_game(Path::new(&state.drive), game.executable);
    let mut facts = vec![format!("Launches through {}", integration(game.executable))];
    if played.seconds >= 60 {
        facts.push(format!(
            "{} h {} min played",
            played.seconds / 3600,
            played.seconds % 3600 / 60
        ));
    }
    if played.launches > 0 {
        facts.push(format!("{} launch(es)", played.launches));
    }
    let detail = column![
        art,
        text(game.title.to_string()).size(28),
        text(facts.join(" · ")).size(14),
    ]
    .spacing(10)
    .align_x(Alignment::Center);

    let play = button(text("A  PLAY").size(18))
        .padding([12, 36])
        .on_press_maybe((!state.busy() && !game.executable.is_empty()).then_some(Message::Play));
    let eject = button(text("X  EJECT").size(18))
        .padding([12, 28])
        .style(button::secondary)
        .on_press_maybe((!state.busy() && state.ejectable).then_some(Message::Eject));
    let mut controls = row![play].spacing(16).align_y(Alignment::Center);
    if state.ejectable {
        controls = controls.push(eject);
    }

    let status: Element<'_, Message> = match &state.action {
        Action::Idle => text(if game.executable.is_empty() {
            "No executable set in cartridge.conf, so there is nothing to play."
        } else {
            "Enter / A to play · arrows / d-pad to choose · E / X to eject · Esc / B to close"
        })
        .size(13)
        .into(),
        Action::Launching(title) => text(format!("Starting {title}…")).size(14).into(),
        Action::Launched(note) => text(note.clone()).size(14).into(),
        Action::LaunchFailed(why) => text(format!("Could not start the game: {why}"))
            .size(14)
            .into(),
        Action::Ejecting => text("Ejecting…").size(14).into(),
        Action::Ejected(message) => text(message.to_uppercase()).size(22).into(),
        Action::EjectFailed(why) => text(format!("Could not eject: {why}")).size(14).into(),
        Action::InUse(who) => row![
            text(format!("Still in use: {who}")).size(14),
            button("Force quit and eject (A)").on_press(Message::ForceEject),
            button("Keep mounted (B)")
                .style(button::secondary)
                .on_press(Message::KeepMounted),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .into(),
    };

    column![
        row![
            library,
            container(detail).width(Length::Fill).center_x(Length::Fill)
        ]
        .height(Length::Fill),
        container(
            column![controls, status]
                .spacing(12)
                .align_x(Alignment::Center)
        )
        .width(Length::Fill)
        .center_x(Length::Fill)
        .padding(20),
    ]
    .into()
}

fn debug_panel(state: &Launcher) -> Element<'_, Message> {
    let prefs = settings::load();
    let (games, selected, executable) = {
        let games = state.games();
        let game = games.get(state.selected);
        (
            games.len(),
            game.map(|g| g.title.to_string()).unwrap_or_default(),
            game.map(|g| g.executable.to_string()).unwrap_or_default(),
        )
    };
    let cartridge = match &state.cartridge {
        Cartridge::Loading => "loading".to_string(),
        Cartridge::Missing(why) => format!("missing ({why})"),
        Cartridge::Ready(_) => "connected".to_string(),
    };
    let lines = [
        "Watcher: separate process (not queried)".to_string(),
        format!("GamePak: {cartridge}"),
        format!(
            "Drive: {}",
            if state.drive.is_empty() {
                "—"
            } else {
                &state.drive
            }
        ),
        format!("Present: {}  Ejectable: {}", state.present, state.ejectable),
        format!("Games: {games}"),
        format!("Selected: {selected}"),
        format!("Executable: {executable}"),
        format!("Integration: {}", integration(&executable)),
        format!("Launcher: {:?}", state.action),
        format!("Pad: {}", state.pad.as_deref().unwrap_or("none")),
        format!("Save sync: {}", prefs.save_sync),
        format!("Playtime tracking: {} (Tauri only)", prefs.track_playtime),
    ];
    let mut log = column![].spacing(2);
    for line in state.log.iter().rev() {
        log = log.push(text(line.clone()).size(11));
    }
    container(
        column![
            text("DEBUG").size(14),
            column(lines.into_iter().map(|line| text(line).size(12).into())).spacing(3),
            text("Events").size(13),
            scrollable(log).height(Length::Fill),
        ]
        .spacing(10),
    )
    .width(300)
    .height(Length::Fill)
    .padding(14)
    .style(container::bordered_box)
    .into()
}
