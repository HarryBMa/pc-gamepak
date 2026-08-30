// PC GamePak — Tauri 2.0 backend
//
// One binary, two modes, chosen by the arguments it was started with:
//
//   pc-gamepak --drive <path>    the popup, opened on insert
//   pc-gamepak --create          the create-cartridge wizard
//
// Exactly one window is built, so the wizard costs nothing when a cartridge is
// inserted and the popup costs nothing while making one.
//
// Launcher commands:
//   drive_path()                             -> String
//   parse_cartridge(drive_path)              -> CartridgeInfo (cover included)
//   launch_game(executable, drive_path)      -> ()
//   eject_drive(drive_path)                  -> ()
//   cartridge_health(drive_path)             -> Health
//   read_cartridge_for_edit(drive_path)      -> Editable
//   update_cartridge(request)                -> UpdateResult
//   open_wizard_settings()                   -> ()  (opens/focuses the
//                                               wizard, straight to Settings)
//
// Wizard commands:
//   list_games()                             -> GameList { games, problems } (Playnite + Steam)
//   get_settings()                           -> Settings
//   set_settings(settings)                   -> Settings
//   suggest_collection_name(titles)          -> String
//   pick_cover_image()                       -> PickedCover | null
//   pick_game_folder()                       -> PickedGameFolder | null
//   host_platform()                          -> "windows" | "linux" | …
//   tuning_plan(drive_path, tweaks, applying) -> Vec<String>  (the commands)
//   apply_tuning(drive_path, tweaks, applying) -> Vec<String>  (what was done)
//   game_cover(library, id)                  -> String (data URI)
//   list_target_drives()                     -> Vec<TargetDrive>
//   format_plan(drive_path)                  -> FormatPlan
//   executable_choices(playnite_id?, source_dir?, title?) -> Vec<Candidate>
//   steam_registration(drive_path)           -> bool
//   unregister_from_steam(drive_path)        -> bool
//   create_cartridge(request)                -> CartridgeResult,
//                                               emitting cartridge://progress
//
// There is deliberately no command that takes a path to read. An earlier
// read_image_as_data_uri(path) let the webview turn any file on the system into
// a data URI; the cover is now read here, from a path this file derives and
// confines to the cartridge itself.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// All of the real work lives in gamepak-core, which has no UI dependency and
// so can be tested without a webview. This file is the Tauri shell around it.
use gamepak_core::cartridge::{self, CartridgeInfo};
use gamepak_core::{create, drives, edit, format, health, settings, sgdb, tuning};

use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

// --------------------------------------------------------------------------
// Tauri commands
// --------------------------------------------------------------------------

/// Parse the cartridge at `drive_path` and return metadata.
#[tauri::command]
fn parse_cartridge(drive_path: String) -> Result<CartridgeInfo, String> {
    cartridge::read_cartridge_info(&drive_path)
}

/// The cartridge this window was started for.
///
/// The frontend asks for this rather than reading a query string: the window is
/// declared in tauri.conf.json and loads `index.html` with no parameters, so
/// there is nothing in the URL to read.
#[tauri::command]
fn drive_path() -> String {
    cartridge::drive_from_args(std::env::args().skip(1))
}

/// Launch the game.
/// `executable` can be a URI (steam://, heroic://, ...) or a path relative
/// to `drive_path`.
#[tauri::command]
fn launch_game(executable: String, drive_path: String) -> Result<(), String> {
    if executable.is_empty() {
        return Err("No executable configured for this cartridge".into());
    }

    let known_schemes = [
        "steam://",
        "heroic://",
        "gog://",
        "epic://",
        "playnite://",
        "lutris://",
        "http://",
        "https://",
    ];
    let is_uri = known_schemes
        .iter()
        .any(|s| executable.to_lowercase().starts_with(s));

    if is_uri {
        open_uri(&executable)
    } else {
        let full_path = PathBuf::from(&drive_path).join(&executable);
        if !full_path.exists() {
            return Err(format!("Executable not found: {}", full_path.display()));
        }
        #[cfg(target_os = "windows")]
        {
            Command::new(&full_path)
                .current_dir(full_path.parent().unwrap_or(Path::new(".")))
                .spawn()
                .map_err(|e| format!("Failed to launch {}: {e}", full_path.display()))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("bash")
                .arg(&full_path)
                .current_dir(full_path.parent().unwrap_or(Path::new(".")))
                .spawn()
                .map_err(|e| format!("Failed to launch {}: {e}", full_path.display()))?;
        }
        Ok(())
    }
}

fn open_uri(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "", uri])
            .spawn()
            .map_err(|e| format!("Failed to open URI {uri}: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("Failed to open URI {uri}: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("Failed to open URI {uri}: {e}"))?;
        Ok(())
    }
}

/// Can this cartridge be ejected, or is it a tag standing in for one?
///
/// The launcher hides the button when the answer is no. `eject_drive` asks the
/// same question again rather than trusting it: a command is reachable whatever
/// the interface chose to show.
#[tauri::command]
fn can_eject(drive_path: String) -> bool {
    drives::is_ejectable(std::path::Path::new(&drive_path))
}

/// Safely eject the cartridge drive.
#[tauri::command]
fn eject_drive(drive_path: String) -> Result<(), String> {
    if !drives::is_ejectable(std::path::Path::new(&drive_path)) {
        return Err(
            "This cartridge is not on a removable drive, so there is nothing to eject.".to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        eject_windows(&drive_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        eject_linux(&drive_path)
    }
}

#[cfg(target_os = "windows")]
fn eject_windows(drive_path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{FSCTL_DISMOUNT_VOLUME, FSCTL_LOCK_VOLUME};
    use windows_sys::Win32::System::IO::DeviceIoControl;

    // A drive just plugged in, or a window just closed on it, often still has
    // Explorer's thumbnail cache or Defender's on-arrival scan holding a
    // handle for a moment — long enough for the first lock to fail and short
    // enough that pressing Eject again immediately succeeds. Retried here
    // instead of surfacing that as a real failure.
    const ATTEMPTS: u32 = 6;
    const RETRY_DELAY: Duration = Duration::from_millis(250);

    let letter = drive_path.trim_end_matches('\\').trim_end_matches('/');
    let volume_path = format!("\\\\.\\{letter}");

    let wide: Vec<u16> = OsStr::new(&volume_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(RETRY_DELAY);
        }

        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                0,
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            continue;
        }

        let mut bytes_returned: u32 = 0;

        let locked = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_LOCK_VOLUME,
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                0,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };

        if locked == 0 {
            unsafe { CloseHandle(handle) };
            continue;
        }

        let dismounted = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_DISMOUNT_VOLUME,
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                0,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };

        unsafe { CloseHandle(handle) };

        if dismounted != 0 {
            return Ok(());
        }
    }

    eject_windows_mountvol(drive_path)
}

#[cfg(target_os = "windows")]
fn eject_windows_mountvol(drive_path: &str) -> Result<(), String> {
    use std::time::Duration;

    const ATTEMPTS: u32 = 3;
    const RETRY_DELAY: Duration = Duration::from_millis(300);

    let letter = drive_path.trim_end_matches('\\').trim_end_matches('/');
    let mut last_code = None;

    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(RETRY_DELAY);
        }

        let status = Command::new("mountvol")
            .args([letter, "/P"])
            .status()
            .map_err(|e| format!("mountvol failed: {e}"))?;

        if status.success() {
            return Ok(());
        }
        last_code = status.code();
    }

    Err(format!(
        "mountvol /P returned exit code {last_code:?}"
    ))
}

#[cfg(not(target_os = "windows"))]
fn eject_linux(drive_path: &str) -> Result<(), String> {
    let findmnt = Command::new("findmnt")
        .args(["-n", "-o", "SOURCE", drive_path])
        .output()
        .map_err(|e| format!("findmnt failed: {e}"))?;

    let device = String::from_utf8_lossy(&findmnt.stdout).trim().to_string();

    if device.is_empty() {
        return Err(format!("Cannot find block device for {drive_path}"));
    }

    let unmount = Command::new("udisksctl")
        .args(["unmount", "-b", &device, "--no-user-interaction"])
        .status()
        .map_err(|e| format!("udisksctl unmount failed: {e}"))?;

    if !unmount.success() {
        let _ = Command::new("umount").arg(&device).status();
    }

    let parent = get_parent_device(&device);
    let _ = Command::new("udisksctl")
        .args(["power-off", "-b", &parent, "--no-user-interaction"])
        .status();

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn get_parent_device(partition: &str) -> String {
    let out = Command::new("lsblk")
        .args(["-no", "PKNAME", partition])
        .output();
    if let Ok(o) = out {
        let parent_name = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !parent_name.is_empty() {
            return format!("/dev/{parent_name}");
        }
    }
    partition.to_string()
}

// --------------------------------------------------------------------------
// Wizard commands
// --------------------------------------------------------------------------

/// Everything installed, from Playnite where available and Steam otherwise.
///
/// `playnite_root` lets the wizard pass a user-supplied Playnite data directory
/// when auto-discovery failed. If absent, the usual lookup is used.
#[tauri::command]
fn list_games(playnite_root: Option<String>) -> Result<create::GameList, String> {
    create::list_games(playnite_root.as_deref())
}

#[tauri::command]
fn game_cover(library: create::Library, id: String) -> String {
    create::game_cover(library, &id)
}

/// What the user has switched on. Read on open, so the wizard can hide what is
/// off — though the backend refuses either way.
#[tauri::command]
fn get_settings() -> settings::Settings {
    settings::load()
}

/// Store the settings and hand back what was stored, so the window and the file
/// cannot drift apart.
#[tauri::command]
fn set_settings(settings: settings::Settings) -> Result<settings::Settings, String> {
    settings::save(&settings)?;
    Ok(settings)
}

/// How well this cartridge is actually connected.
///
/// Read on demand rather than at startup: on Windows it asks PowerShell, and
/// the launcher opening half a second slower is worse than the details sheet
/// filling in half a second late.
#[tauri::command]
async fn cartridge_health(drive_path: String) -> health::Health {
    tauri::async_runtime::spawn_blocking(move || health::inspect(&drive_path))
        .await
        .unwrap_or_default()
}

/// Read a cartridge that already exists, so its metadata can be changed without
/// writing the whole thing again.
#[tauri::command]
fn read_cartridge_for_edit(drive_path: String) -> Result<edit::Editable, String> {
    edit::read(&drive_path)
}

/// Rewrite a cartridge's metadata. Copies nothing, deletes no game.
#[tauri::command]
fn update_cartridge(request: edit::UpdateRequest) -> Result<edit::UpdateResult, String> {
    edit::update(&request)
}

/// Which OS the wizard is running on, so it can offer only what exists here.
#[tauri::command]
fn host_platform() -> &'static str {
    std::env::consts::OS
}

/// Which tweaks the window is asking about, by name.
fn parse_tweaks(names: &[String]) -> Result<Vec<tuning::Tweak>, String> {
    names
        .iter()
        .map(|name| match name.as_str() {
            "defender" => Ok(tuning::Tweak::DefenderExclusion),
            "indexing" => Ok(tuning::Tweak::SearchIndexing),
            other => Err(format!("{other} is not a setting this tool changes")),
        })
        .collect()
}

/// The exact commands a tuning run would execute.
///
/// Shown before anything happens: this is elevated and it touches malware
/// scanning, so the user reads the commands first.
#[tauri::command]
fn tuning_plan(
    drive_path: String,
    tweaks: Vec<String>,
    applying: bool,
) -> Result<Vec<String>, String> {
    tuning::plan(&drive_path, &parse_tweaks(&tweaks)?, applying)
}

/// Apply or undo the Windows tuning. Each step elevates on its own.
#[tauri::command]
async fn apply_tuning(
    drive_path: String,
    tweaks: Vec<String>,
    applying: bool,
) -> Result<Vec<String>, String> {
    let parsed = parse_tweaks(&tweaks)?;
    tauri::async_runtime::spawn_blocking(move || tuning::apply(&drive_path, &parsed, applying))
        .await
        .map_err(|e| format!("the tuning thread failed: {e}"))?
}

/// A picture the user chose for a collection's artwork.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedCover {
    /// Handed back with the create request, so the file is copied from here.
    path: String,
    /// The picture itself, for the wizard's preview. Empty when it is too big
    /// to inline; the build then refuses it with a proper message.
    preview: String,
}

/// Ask for artwork through the desktop's own file dialog.
///
/// The window never names a path: it gets one back only after the user has
/// pointed at a file themselves. This is also the offline way to give a
/// collection its own art, with no SteamGridDB lookup involved.
#[tauri::command]
async fn pick_cover_image(window: tauri::WebviewWindow) -> Option<PickedCover> {
    let file = window
        .dialog()
        .file()
        .set_title("Choose collection artwork")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp", "bmp"])
        .blocking_pick_file()?;

    let path = file.into_path().ok()?;
    Some(PickedCover {
        preview: sgdb::read_as_data_uri(&path).unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
    })
}

/// What the picker came back with, and what is inside it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedGameFolder {
    path: String,
    /// Folder name, offered as the title so it does not have to be typed.
    name: String,
    size_bytes: u64,
    /// What Play could start, best guess first. Empty when nothing here looks
    /// like a program, which is worth showing before the copy rather than after.
    choices: Vec<gamepak_core::portable::Candidate>,
}

/// Ask for a game's folder through the desktop's own file dialog.
///
/// The counterpart to picking a game from the list: a game that no launcher
/// knows about still lives in a folder, and a folder is all the copy needs. As
/// with the cover picker, the window never names a path — it gets one back only
/// after the user has pointed at it.
#[tauri::command]
async fn pick_game_folder(window: tauri::WebviewWindow) -> Result<Option<PickedGameFolder>, String> {
    let Some(folder) = window
        .dialog()
        .file()
        .set_title("Choose the game's folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|e| format!("That folder cannot be read: {e}"))?;

    // Checked here, not merely in the picker: the same rules apply however the
    // path arrived.
    let dir = create::check_source_dir(&path.to_string_lossy())?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(Some(PickedGameFolder {
        size_bytes: gamepak_core::portable::tree_size_of(&dir),
        choices: gamepak_core::portable::find_executables(&dir, &name, None),
        path: dir.to_string_lossy().into_owned(),
        name,
    }))
}

/// A name for a cartridge carrying several games, worked out from what they are
/// called. The wizard offers it; the user can always type their own.
#[tauri::command]
fn suggest_collection_name(titles: Vec<String>) -> String {
    create::suggest_collection_name(&titles)
}

#[tauri::command]
fn sgdb_search_games(query: String) -> Result<Vec<sgdb::SteamGridGame>, String> {
    sgdb::search_games(&query)
}

#[tauri::command]
fn sgdb_get_artwork(
    game_id: u32,
    art_type: sgdb::ArtworkType,
) -> Result<Vec<sgdb::Artwork>, String> {
    sgdb::get_artwork(game_id, art_type)
}

#[tauri::command]
fn sgdb_download_artwork(
    url: String,
    cache_key: String,
    game_key: Option<String>,
) -> Result<sgdb::CachedArtwork, String> {
    let path = sgdb::download_artwork(&url, &cache_key)?;
    if let Some(key) = game_key.filter(|k| !k.trim().is_empty()) {
        sgdb::remember_last_used(&key, &path)?;
    }
    sgdb::read_as_data_uri(&path)
        .map(|data_uri| sgdb::CachedArtwork {
            path: path.to_string_lossy().into_owned(),
            data_uri,
        })
        .ok_or_else(|| "SteamGridDB saved the image, but it could not be previewed.".to_string())
}

#[tauri::command]
fn sgdb_last_used_artwork(game_key: String) -> Option<sgdb::CachedArtwork> {
    sgdb::last_used_artwork_data_uri(&game_key)
}

#[tauri::command]
fn list_target_drives() -> Vec<drives::TargetDrive> {
    create::target_drives()
}

/// What formatting a drive would destroy, for the confirmation step.
#[tauri::command]
fn format_plan(drive_path: String) -> Result<format::FormatPlan, String> {
    create::format_plan(&drive_path)
}

/// What Play could start, for a game whose folder is about to be copied.
///
/// Ranked best-first; the window offers the top one and lets the user change it.
#[tauri::command]
fn executable_choices(
    playnite_id: Option<String>,
    source_dir: Option<String>,
    title: Option<String>,
) -> Result<Vec<gamepak_core::portable::Candidate>, String> {
    // A folder the user chose is the more specific answer, so it wins.
    if let Some(dir) = source_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        return create::executable_choices_in(dir, title.as_deref().unwrap_or_default());
    }
    match playnite_id.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(id) => create::executable_choices(id),
        None => Err("No game folder to look in.".to_string()),
    }
}

/// Whether the drive is currently a registered Steam library folder.
#[tauri::command]
fn steam_registration(drive_path: String) -> bool {
    create::steam_registration(&drive_path)
}

/// Remove the cartridge from Steam's library list.
#[tauri::command]
fn unregister_from_steam(drive_path: String) -> Result<bool, String> {
    create::unregister_from_steam(&drive_path)
}

/// Build the cartridge, streaming progress to the window.
///
/// Copying a game is minutes of work, so it runs on a blocking thread and emits
/// `cartridge://progress` instead of leaving the window frozen.
#[tauri::command]
async fn create_cartridge(
    window: tauri::WebviewWindow,
    request: create::CartridgeRequest,
) -> Result<create::CartridgeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create::create_cartridge(&request, &mut |progress| {
            let _ = window.emit("cartridge://progress", progress);
        })
    })
    .await
    .map_err(|e| format!("the build thread failed: {e}"))?
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

/// The launcher popup's own way into the wizard, alongside the tray menu's.
///
/// The popup is a cartridge's home, not a settings surface, so this jumps
/// straight past cartridge creation to Settings — the same place the tray
/// menu's "Open settings" lands.
#[tauri::command]
fn open_wizard_settings(app: tauri::AppHandle) {
    spawn_open_wizard(app, true);
}

/// Build the wizard from a thread that is not the event loop's.
///
/// A command handler and a tray-menu handler both run on the main thread, and
/// building a webview window there does not work: the native window is created,
/// centred and sized, and then its webview never finishes initialising — so
/// `on_page_load` never fires, create.js never runs, and the window sits
/// invisible forever. Nothing is deadlocked, which is what makes it confusing;
/// the message pump answers, the launcher redraws, and the only symptom is that
/// Settings and the tray's wizard entries appear to do nothing at all.
///
/// Creating it from another thread leaves the event loop free to service the
/// creation it has been asked for. `setup` is the exception that shows the rule:
/// it runs before the event loop starts, so it can and does call open_wizard
/// directly.
fn spawn_open_wizard(app: tauri::AppHandle, open_settings: bool) {
    std::thread::spawn(move || {
        if let Err(error) = open_wizard(&app, open_settings) {
            eprintln!("could not open the wizard: {error}");
        }
    });
}

/// Put the launcher away while the wizard is up, and bring it back after.
///
/// The popup is always_on_top, because a cartridge going in has to land over
/// whatever is already running. That makes it the one window a wizard opened
/// from its own Settings link cannot appear in front of: the wizard is there,
/// focused and taking input, with the popup sitting on top of the part you
/// clicked to get it. Hiding it is not decoration — it is the difference
/// between the Settings link working and appearing not to.
///
/// A no-op when the app was started with --create, which has no popup at all.
fn hide_launcher(app: &tauri::AppHandle) {
    if let Some(launcher) = app.get_webview_window("main") {
        let _ = launcher.hide();
    }
}

fn show_launcher(app: &tauri::AppHandle) {
    if let Some(launcher) = app.get_webview_window("main") {
        let _ = launcher.show();
        let _ = launcher.set_focus();
    }
}

fn open_wizard(app: &tauri::AppHandle, open_settings: bool) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("create") {
        window.show()?;
        window.set_focus()?;
        hide_launcher(app);
        if open_settings {
            window.emit("open-settings", ())?;
        }
        return Ok(());
    }

    // Resizable, unlike the popup: 880x660 is logical pixels, so at 150% or
    // 200% desktop scaling the wizard is taller than the screen it opens on and
    // a fixed window leaves the title bar and the game list off the edge with
    // no way back. The minimum keeps both columns usable.
    let wizard = WebviewWindowBuilder::new(app, "create", WebviewUrl::App("create.html".into()))
        .title("Create cartridge")
        .inner_size(880.0, 660.0)
        .min_inner_size(720.0, 520.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .center()
        .visible(false)
        // Built hidden and shown here, once the page has loaded.
        //
        // This used to be the frontend's job. It is not a job the frontend can
        // be trusted with: create.js shows the window at the end of its startup,
        // so any await in there that never settles leaves a window that exists,
        // has size and position, and is permanently invisible — which from the
        // outside is indistinguishable from the app having frozen. Page load is
        // a signal this side already has, and it does not depend on the wizard
        // finishing its library scan.
        .on_page_load(move |window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let _ = window.show();
            let _ = window.set_focus();
            hide_launcher(window.app_handle());
            if open_settings {
                let _ = window.emit("open-settings", ());
            }
        })
        .build()?;

    // The popup comes back when the wizard goes away, whichever way it goes:
    // create.js closes the window, so this is a destroy rather than a hide.
    // Registered on the window rather than inside on_page_load, so a wizard
    // that never finishes loading still gives the launcher back when it is
    // closed.
    let handle = app.clone();
    wizard.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. }
        ) {
            show_launcher(&handle);
        }
    });

    Ok(())
}

fn main() {
    // Both windows start hidden; the frontend shows itself once it has drawn,
    // so the user never sees an empty frame.
    let wizard = std::env::args().skip(1).any(|arg| arg == "--create");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            drive_path,
            parse_cartridge,
            launch_game,
            eject_drive,
            can_eject,
            list_games,
            game_cover,
            get_settings,
            set_settings,
            suggest_collection_name,
            pick_cover_image,
            pick_game_folder,
            cartridge_health,
            read_cartridge_for_edit,
            update_cartridge,
            host_platform,
            tuning_plan,
            apply_tuning,
            sgdb_search_games,
            sgdb_get_artwork,
            sgdb_download_artwork,
            sgdb_last_used_artwork,
            list_target_drives,
            format_plan,
            executable_choices,
            steam_registration,
            unregister_from_steam,
            create_cartridge,
            open_wizard_settings,
        ])
        .setup(move |app| {
            let wizard_item = MenuItem::with_id(app, "open-wizard", "Open wizard", true, None::<&str>)?;
            let open_settings = MenuItem::with_id(app, "open-settings", "Open settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&wizard_item, &open_settings, &quit])?;

            TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/32x32.png"))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open-wizard" => spawn_open_wizard(app.clone(), false),
                    "open-settings" => spawn_open_wizard(app.clone(), true),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            if wizard {
                // The same door the tray and the launcher's Settings link use,
                // rather than a second builder that had drifted to a fixed size
                // the resizing comment in open_wizard explicitly argues against.
                open_wizard(app.handle(), false)?;
            } else {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("PC GamePak")
                    .inner_size(420.0, 560.0)
                    .resizable(false)
                    .decorations(false)
                    .transparent(true)
                    // The popup has to land on top of whatever is running.
                    .always_on_top(true)
                    .center()
                    .visible(false)
                    .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
