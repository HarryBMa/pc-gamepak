//! PC GamePak — Iced launcher (experimental).
//!
//! A second front-end on the same core as the Tauri launcher, to compare the
//! two. It is started the same way — `pc-gamepak-iced --drive <path>` — so the
//! watcher can open it instead of the Tauri launcher (set
//! `PC_GAMEPAK_LAUNCHER` to this executable), and everything it does is a call
//! into `gamepak-core`: reading the cartridge, starting the game, syncing
//! saves, ejecting. Nothing here decides anything a cartridge means.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod pad;

fn main() -> iced::Result {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // The elevated half of Eject: core re-runs *this* executable with
    // `--eject <letter>` when Windows needs administrator to take the volume.
    // It does its work and exits before any window is built.
    #[cfg(target_os = "windows")]
    if let Some(index) = args.iter().position(|arg| arg == "--eject") {
        let drive = args.get(index + 1).cloned().unwrap_or_default();
        std::process::exit(gamepak_core::eject::run_elevated(&drive) as i32);
    }

    let drive = gamepak_core::cartridge::drive_from_args(args.into_iter());

    iced::application(
        move || app::Launcher::new(drive.clone()),
        app::update,
        app::view,
    )
    .title(app::title)
    .subscription(app::subscription)
    .theme(app::theme)
    .window_size((960.0, 640.0))
    .run()
}
