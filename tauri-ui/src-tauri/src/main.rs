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
//   focus_window()                           -> ()
//   list_skins()                             -> [(name, description)]
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
//   list_unmounted_volumes()                 -> Vec<UnmountedVolume>
//   mount_volume(volume)                     -> String (the new root)
//   format_plan(drive_path)                  -> FormatPlan
//   executable_choices(playnite_id?, source_dir?, title?) -> Vec<Candidate>
//   steam_registration(drive_path)           -> bool
//   holds_steam_games(drive_path)            -> bool
//   steam_registration_plan(drive_path)      -> Vec<String>
//   register_with_steam(drive_path)          -> bool
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
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_Parent, CM_Request_Device_EjectW, CR_SUCCESS,
};

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

/// Take the keyboard, not just the front of the screen.
///
/// The popup is `always_on_top` and is opened by the watcher, which is a
/// background process. Windows lets a background process show a window but not
/// take focus — the foreground lock is there to stop programs stealing your
/// typing — so the launcher landed in front of whatever you were doing while
/// your keystrokes carried on going to the window behind it.
///
/// That is worse than untidy for a controller. Chromium only reports gamepad
/// state to a focused document, so a pad would raise `gamepadconnected`,
/// light up the indicator, and then read as though every button were resting:
/// connected, visible, and completely dead.
#[tauri::command]
fn focus_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.set_focus();

    #[cfg(target_os = "windows")]
    {
        let target = window.clone();
        window
            .run_on_main_thread(move || take_foreground(&target))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Ask Windows for the foreground the way it will actually grant it.
///
/// `SetForegroundWindow` on its own is refused for a process that is not
/// already in front; it flashes the taskbar button instead. Three things are
/// tried in turn, because which of them works depends on what has the
/// foreground and how it got it:
///
/// 1. Attach to the input queue of the window that is currently in front. Two
///    threads sharing a focus state may hand it between themselves, which is
///    the long-standing way through the lock.
/// 2. `SwitchToThisWindow`, which is what Alt-Tab uses and is not bound by the
///    same rule.
/// 3. A synthetic Alt tap. The lock is lifted for the process that owns the
///    most recent input event, so producing one is enough — Alt on its own
///    presses nothing.
///
/// Each step is followed by asking whether it worked, so the noisier ones only
/// happen when the quiet one was not enough.
#[cfg(target_os = "windows")]
fn take_foreground(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::System::Threading::AttachThreadInput;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, SetFocus, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
        SwitchToThisWindow,
    };

    let Ok(handle) = window.hwnd() else {
        return;
    };
    let hwnd = handle.0 as isize;

    let ours = unsafe { GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) };
    let holds_it = || unsafe { GetForegroundWindow() } == hwnd;

    unsafe {
        BringWindowToTop(hwnd);

        let foreground = GetForegroundWindow();
        let theirs = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
        let attached = theirs != 0 && ours != 0 && theirs != ours;
        if attached {
            AttachThreadInput(theirs, ours, 1);
        }
        SetForegroundWindow(hwnd);
        SetFocus(hwnd);
        if attached {
            AttachThreadInput(theirs, ours, 0);
        }

        if holds_it() {
            return;
        }

        SwitchToThisWindow(hwnd, 1);
        if holds_it() {
            return;
        }

        // Alt down and straight back up. Nothing is typed by it; it exists so
        // that this process owns the last input event, which is one of the
        // conditions under which Windows allows the foreground to be taken.
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        SetForegroundWindow(hwnd);
        SetFocus(hwnd);
    }
}

/// Whether the window should write what it is doing to a log.
///
/// Off unless `PC_GAMEPAK_DEBUG` is set, and asked once at start-up rather than
/// per line, so a launcher nobody is debugging pays a single call for it.
#[tauri::command]
fn debug_logging() -> bool {
    std::env::var_os("PC_GAMEPAK_DEBUG").is_some_and(|value| value != "0")
}

/// Append one line to the launcher log.
///
/// The webview has no console anyone can reach in a release build — there are
/// no devtools, and a window that opens on insert and closes on eject is gone
/// before anything could be attached to it. So it writes next to the watcher's
/// log, which is where someone would already be looking.
#[tauri::command]
fn debug_log(line: String) {
    if !debug_logging() {
        return;
    }
    let Some(base) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };

    let path = PathBuf::from(base).join("PC-GamePak").join("launcher.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        // Truncated hard: this is a diagnostic, not somewhere for a cartridge's
        // title to be written at whatever length it happens to be.
        let line: String = line.chars().take(400).collect();
        let _ = writeln!(file, "{line}");
    }
}

/// The looks the launcher ships with, for the Settings list.
///
/// Sent as data rather than hardcoded in the window, so adding one means adding
/// a line to `skins.rs` and a stylesheet, and nothing else.
#[tauri::command]
fn list_skins() -> Vec<(String, String)> {
    gamepak_core::skins::all()
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

/// Eject the cartridge, elevating only if it turns out to be necessary.
///
/// Asking PnP nicely works on a plain USB stick and prompts for nothing, so it
/// is tried first and is usually the end of it. It cannot work on the hardware
/// this project is actually built around: an NVMe stick in a UAS enclosure
/// advertises no `CM_DEVCAP_EJECTSUPPORTED`, Explorer offers no Eject verb for
/// it, and the request comes back `PNP_VetoDevice` — the device saying it does
/// not do this — from the volume rather than from anything holding a file open.
///
/// So the fallback does the work by force, which needs administrator because
/// Windows calls these disks fixed and will not hand out write access to a
/// fixed volume otherwise. That is one UAC prompt, at the moment the user asked
/// for something that cannot be done without one, and none at all on hardware
/// that never needed it.
#[cfg(target_os = "windows")]
fn eject_windows(drive_path: &str) -> Result<(), String> {
    let letter = drive_path.trim_end_matches(['\\', '/']);

    match pnp_eject(letter) {
        Ok(()) => Ok(()),
        // The unelevated refusal is kept only to be shown if elevation is
        // declined: it is the honest reason the prompt appeared.
        Err(refusal) => elevated_eject(letter, &refusal),
    }
}

/// Re-run this executable elevated, with `--eject`, and wait for it.
///
/// `ShellExecuteExW` with `runas` rather than a PowerShell hop: the elevated
/// half is this same binary doing the same Win32 calls, so it can report what
/// happened as an exit code instead of a parsed console message.
#[cfg(target_os = "windows")]
fn elevated_eject(letter: &str, refusal: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, WaitForSingleObject, INFINITE,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let Ok(exe) = std::env::current_exe() else {
        return Err(refusal.to_string());
    };

    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    // Unquoted, and the letter rather than the root: `"G:\"` ends in a
    // backslash, which the Windows command line reads as escaping the quote
    // that closes it, so the elevated half was handed a mangled path and
    // reported a drive that was not there. A drive letter cannot contain a
    // space, so there is nothing for the quotes to have been protecting.
    let parameters = wide(&format!("--eject {letter}"));

    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.nShow = SW_HIDE;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
        return Err(if error == ERROR_CANCELLED {
            "Ejecting this cartridge needs administrator, and the prompt was dismissed.".to_string()
        } else {
            refusal.to_string()
        });
    }

    if info.hProcess == 0 {
        return Err(refusal.to_string());
    }

    let waited = unsafe { WaitForSingleObject(info.hProcess, INFINITE) };
    let mut code = EJECT_OTHER;
    if waited == WAIT_OBJECT_0 {
        unsafe { GetExitCodeProcess(info.hProcess, &mut code) };
    }
    unsafe { CloseHandle(info.hProcess) };

    match code {
        EJECT_OK => Ok(()),
        // Administrator was already granted, so `FSCTL_LOCK_VOLUME` refusing
        // means what it says: files are open on the volume. Not a rights
        // problem, and not one a Defender exclusion fixes — that was tried on
        // a cartridge that would not eject, and changed nothing.
        //
        // What holds it is whatever has read the cartridge since it arrived.
        // A drive only just plugged in ejects every time; the same drive
        // after a game has been played from it often will not, and does not
        // let go until it is replugged. So the second half of the message is
        // the thing that always works, rather than a second guess at who.
        EJECT_IN_USE => Err(format!(
            "{letter} is still in use. Close the game, Steam, or any folder open on it, \
             or replug the cartridge — one that has just arrived always ejects."
        )),
        EJECT_MISSING => Err(format!("{letter} is not there any more.")),
        _ => Err(refusal.to_string()),
    }
}

/// Exit codes the elevated half reports back through.
#[cfg(target_os = "windows")]
const EJECT_OK: u32 = 0;
#[cfg(target_os = "windows")]
const EJECT_IN_USE: u32 = 1;
#[cfg(target_os = "windows")]
const EJECT_MISSING: u32 = 2;
#[cfg(target_os = "windows")]
const EJECT_OTHER: u32 = 3;

/// The elevated half: flush the volume, dismount it, then stop the device.
///
/// Runs instead of the window when the executable is started with `--eject`.
/// Locking is what needed the rights: with them, the filesystem is flushed and
/// dismounted, and the drive is safe to unplug whether or not PnP will then
/// take the device away — which it still declines to do on an enclosure that
/// never claimed it could.
#[cfg(target_os = "windows")]
fn run_elevated_eject(drive_path: &str) -> u32 {
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{FSCTL_DISMOUNT_VOLUME, FSCTL_LOCK_VOLUME};
    use windows_sys::Win32::System::IO::DeviceIoControl;

    // Same three seconds the unelevated attempt used to allow: a cartridge
    // whose game has just been quit is released over a second or two.
    const ATTEMPTS: u32 = 12;
    const RETRY_DELAY: Duration = Duration::from_millis(250);

    let letter = drive_path.trim_end_matches(['\\', '/']);
    let path = wide(&format!("\\\\.\\{letter}"));

    let mut opened = false;

    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            std::thread::sleep(RETRY_DELAY);
        }

        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
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
        opened = true;

        let mut returned = 0u32;
        let locked = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_LOCK_VOLUME,
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                0,
                &mut returned,
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
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        // The lock is released with the handle. Held until after the dismount
        // so nothing can mount the volume back in between.
        unsafe { CloseHandle(handle) };

        if dismounted != 0 {
            // Now that no filesystem is mounted there is nothing left to veto,
            // so ask PnP again. It still refuses on an enclosure with no eject
            // support, and that is fine: the cartridge is already safe to pull.
            let _ = pnp_eject(letter);
            return EJECT_OK;
        }
    }

    if opened {
        EJECT_IN_USE
    } else {
        EJECT_MISSING
    }
}

/// Ask PnP to stop the device behind a drive letter.
///
/// The obvious implementation — lock the volume, dismount it — cannot work on
/// the hardware this is for. `FSCTL_LOCK_VOLUME` needs administrator on a
/// volume Windows considers fixed, and `GetDriveTypeW` calls an NVMe stick in a
/// USB enclosure fixed, exactly like the internal disk. So the lock came back
/// `ERROR_ACCESS_DENIED` every time, on a cartridge nothing was using, and
/// `mountvol /P` behind it needed the same rights and failed the same way.
///
/// `CM_Request_Device_Eject` is what the notification area's own eject calls.
/// It asks the PnP manager to stop the device rather than taking the volume by
/// force: the filesystem is flushed and dismounted on the way, no elevation is
/// involved, and the device is actually powered down at the end — which the
/// dismount never did, so "safe to remove" had been describing a drive that was
/// still spinning.
///
/// When something refuses, PnP says what: the veto names the application or
/// driver holding the device, which is a better answer than any guess made from
/// an error code.
#[cfg(target_os = "windows")]
fn pnp_eject(letter: &str) -> Result<(), String> {
    let disk = device_number(letter)
        .ok_or_else(|| format!("{letter} could not be identified as a disk."))?;
    let devinst = disk_devinst(disk)
        .ok_or_else(|| format!("Windows has no device for {letter} to eject."))?;

    // The parent first: for a USB enclosure that is the mass-storage device,
    // and stopping it is what "Safely Remove Hardware" stops. The disk itself
    // is the fallback for anything shaped differently — a card reader slot, or
    // a device that is its own parent as far as PnP is concerned.
    let mut parent = 0u32;
    let targets = if unsafe { CM_Get_Parent(&mut parent, devinst, 0) } == CR_SUCCESS {
        vec![parent, devinst]
    } else {
        vec![devinst]
    };

    let mut refusal = None;
    for target in targets {
        match request_eject(target) {
            Ok(()) => return Ok(()),
            Err(why) => refusal = refusal.or(Some(why)),
        }
    }

    Err(refusal.unwrap_or_else(|| format!("Windows would not eject {letter}.")))
}

/// Ask PnP to stop one device node.
#[cfg(target_os = "windows")]
fn request_eject(devinst: u32) -> Result<(), String> {
    // Aliased in upper case because they are matched on as patterns, and a
    // constant named in camel case there is read as a fresh binding that
    // matches everything — the lint that fires on it is warning about a match
    // arm that would silently swallow every other veto.
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        PNP_VetoDevice, PNP_VetoDriver, PNP_VetoOutstandingOpen, PNP_VetoPendingClose,
        PNP_VetoWindowsApp, PNP_VetoWindowsService,
    };
    const VETO_APP: i32 = PNP_VetoWindowsApp;
    const VETO_SERVICE: i32 = PNP_VetoWindowsService;
    const VETO_OPEN: i32 = PNP_VetoOutstandingOpen;
    const VETO_CLOSING: i32 = PNP_VetoPendingClose;
    const VETO_DEVICE: i32 = PNP_VetoDevice;
    const VETO_DRIVER: i32 = PNP_VetoDriver;

    let mut veto_type = 0;
    let mut veto_name = [0u16; 260];

    let result = unsafe {
        CM_Request_Device_EjectW(
            devinst,
            &mut veto_type,
            veto_name.as_mut_ptr(),
            veto_name.len() as u32,
            0,
        )
    };
    if result == CR_SUCCESS {
        return Ok(());
    }

    let end = veto_name
        .iter()
        .position(|c| *c == 0)
        .unwrap_or(veto_name.len());
    let name = String::from_utf16_lossy(&veto_name[..end]);
    let name = name.trim();

    // The veto name is a process name or a driver's, so it is worth printing
    // verbatim: "Steam is still using the cartridge" is the whole answer, where
    // an error number would send someone looking for a fault that is not there.
    Err(match veto_type {
        VETO_APP | VETO_SERVICE | VETO_OPEN if !name.is_empty() => {
            format!("{name} is still using the cartridge. Close it, then Eject.")
        }
        VETO_APP | VETO_SERVICE | VETO_OPEN => {
            "Something is still using the cartridge. Quit the game or Steam, then Eject."
                .to_string()
        }
        VETO_CLOSING => "The cartridge is still finishing up. Try Eject again.".to_string(),
        VETO_DEVICE | VETO_DRIVER if !name.is_empty() => {
            format!("{name} would not release the cartridge.")
        }
        _ => "Windows would not release the cartridge. Unplug it once the drive light settles."
            .to_string(),
    })
}

/// Which physical disk a drive letter sits on.
///
/// Opened with no access rights at all, which is enough for a query and is the
/// reason none of this prompts: asking for read or write on a fixed volume is
/// what needed administrator in the first place.
#[cfg(target_os = "windows")]
fn device_number(letter: &str) -> Option<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{
        IOCTL_STORAGE_GET_DEVICE_NUMBER, STORAGE_DEVICE_NUMBER,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    let path = wide(&format!("\\\\.\\{letter}"));
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut number: STORAGE_DEVICE_NUMBER = unsafe { std::mem::zeroed() };
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_GET_DEVICE_NUMBER,
            std::ptr::null(),
            0,
            &mut number as *mut _ as *mut std::ffi::c_void,
            std::mem::size_of::<STORAGE_DEVICE_NUMBER>() as u32,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    unsafe { CloseHandle(handle) };

    (ok != 0).then_some(number.DeviceNumber)
}

/// The device node for a physical disk, found by matching its number.
///
/// There is no call from a disk number to a device node, so this walks the disk
/// interfaces, opens each one and asks which disk it is — the same question
/// `device_number` asked of the volume, from the other end.
#[cfg(target_os = "windows")]
fn disk_devinst(disk: u32) -> Option<u32> {
    use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW,
        SetupDiGetDeviceInterfaceDetailW, DIGCF_DEVICEINTERFACE, DIGCF_PRESENT,
        SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W, SP_DEVINFO_DATA,
    };

    // Written out because windows-sys 0.52 does not export it. It is a fixed
    // interface class id — {53F56307-B6BF-11D0-94F2-00A0C91EFB8B}, the one
    // every disk registers — not a value that varies by machine or version.
    const GUID_DEVINTERFACE_DISK: windows_sys::core::GUID = windows_sys::core::GUID {
        data1: 0x53F5_6307,
        data2: 0xB6BF,
        data3: 0x11D0,
        data4: [0x94, 0xF2, 0x00, 0xA0, 0xC9, 0x1E, 0xFB, 0x8B],
    };
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{
        IOCTL_STORAGE_GET_DEVICE_NUMBER, STORAGE_DEVICE_NUMBER,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    let set = unsafe {
        SetupDiGetClassDevsW(
            &GUID_DEVINTERFACE_DISK,
            std::ptr::null(),
            0,
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        )
    };
    if set == INVALID_HANDLE_VALUE {
        return None;
    }

    let mut found = None;

    for index in 0.. {
        let mut interface: SP_DEVICE_INTERFACE_DATA = unsafe { std::mem::zeroed() };
        interface.cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;

        if unsafe {
            SetupDiEnumDeviceInterfaces(
                set,
                std::ptr::null(),
                &GUID_DEVINTERFACE_DISK,
                index,
                &mut interface,
            )
        } == 0
        {
            break;
        }

        // The detail struct is variable length: a fixed head and the device
        // path running off the end of it. `cbSize` describes the head only,
        // which is why it is not the size of the buffer being passed.
        let mut buffer = [0u8; 1024];
        let detail = buffer.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
        unsafe {
            (*detail).cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
        }

        let mut info: SP_DEVINFO_DATA = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SP_DEVINFO_DATA>() as u32;

        if unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                set,
                // Read, not written: the interface identifies which detail to
                // fetch, and `info` on the end is the out-parameter.
                &interface,
                detail,
                buffer.len() as u32,
                std::ptr::null_mut(),
                &mut info,
            )
        } == 0
        {
            continue;
        }

        let handle = unsafe {
            CreateFileW(
                (*detail).DevicePath.as_ptr(),
                0,
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

        let mut number: STORAGE_DEVICE_NUMBER = unsafe { std::mem::zeroed() };
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_GET_DEVICE_NUMBER,
                std::ptr::null(),
                0,
                &mut number as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<STORAGE_DEVICE_NUMBER>() as u32,
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        unsafe { CloseHandle(handle) };

        if ok != 0 && number.DeviceNumber == disk {
            found = Some(info.DevInst);
            break;
        }
    }

    unsafe { SetupDiDestroyDeviceInfoList(set) };
    found
}

#[cfg(target_os = "windows")]
fn wide(s: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
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

/// Replace every game's poster on a cartridge with one from SteamGridDB.
///
/// One request per game, so the window asks before calling it.
#[tauri::command]
fn refetch_cartridge_artwork(drive_path: String) -> Result<edit::UpdateResult, String> {
    edit::refetch_artwork(&drive_path)
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
async fn pick_game_folder(
    window: tauri::WebviewWindow,
) -> Result<Option<PickedGameFolder>, String> {
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

/// Readable volumes Windows has left without a drive letter.
///
/// Listed separately from `list_target_drives` because they are not targets
/// yet: nothing can write to a volume with no mount point, so the wizard shows
/// them as drives that need one rather than pretending they are ready.
#[tauri::command]
fn list_unmounted_volumes() -> Vec<drives::UnmountedVolume> {
    drives::unmounted_volumes()
}

/// Give one of those volumes a drive letter, and return its new root.
///
/// Elevates, so the user sees a UAC prompt and can decline it — which is the
/// whole consent step for changing how their disks are mounted.
#[tauri::command]
fn mount_volume(volume: drives::UnmountedVolume) -> Result<String, String> {
    drives::mount_volume(&volume)
}

/// What formatting a drive would destroy, for the warning shown before it runs.
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
    if let Some(dir) = source_dir
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        return create::executable_choices_in(dir, title.as_deref().unwrap_or_default());
    }
    match playnite_id
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(id) => create::executable_choices(id),
        None => Err("No game folder to look in.".to_string()),
    }
}

/// Whether the drive is currently a registered Steam library folder.
#[tauri::command]
fn steam_registration(drive_path: String) -> bool {
    create::steam_registration(&drive_path)
}

/// Does this cartridge carry Steam games?
///
/// Asked alongside `steam_registration` so the picker can offer to register a
/// cartridge that needs it, and stay quiet about one that has nothing to
/// register.
#[tauri::command]
fn holds_steam_games(drive_path: String) -> bool {
    create::holds_steam_games(&drive_path)
}

/// What registering this cartridge would change, before it changes anything.
#[tauri::command]
fn steam_registration_plan(drive_path: String) -> Vec<String> {
    create::steam_registration_plan(&drive_path)
}

/// Add the cartridge to Steam's library list.
#[tauri::command]
fn register_with_steam(drive_path: String) -> Result<bool, String> {
    create::register_with_steam(&drive_path)
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
    // Read here rather than carried on the request: the cap describes the drive
    // and the enclosure, not this cartridge, and it should hold for a write the
    // window started before the setting was last changed.
    gamepak_core::throttle::set_limit_mb_s(settings::load().default_copy_rate_mb_s);

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

/// The wizard itself, on the tab it opens with.
///
/// The popup had a way to Settings but none to the thing Settings belongs to,
/// so making a second cartridge meant finding the tray icon.
#[tauri::command]
fn open_wizard_window(app: tauri::AppHandle) {
    spawn_open_wizard(app, false);
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

/// Ask Windows to round the window, and let it be the only thing that does.
///
/// Two curves were fighting. The app drew its own rounded corner in CSS, which
/// on a transparent window leaves the area outside the curve see-through; DWM
/// rounds an undecorated window at its own radius and paints a border on that.
/// Neither radius is the other's, so between them sat a crescent of DWM's
/// border over the app's transparent corner — a pale hook at every corner.
///
/// Squaring both was one way out and looked like what it was. The other is to
/// have exactly one rounder: the window is opaque and square, painted edge to
/// edge, and DWM clips the corner. That is the shape Windows draws for every
/// other window, anti-aliased, with the shadow that belongs to it.
#[cfg(windows)]
fn round_dwm_corners(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(handle) = window.hwnd() else { return };
    let preference = DWMWCP_ROUND;
    unsafe {
        DwmSetWindowAttribute(
            handle.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            std::ptr::addr_of!(preference).cast(),
            std::mem::size_of_val(&preference) as u32,
        );
    }
}

#[cfg(not(windows))]
fn round_dwm_corners(_window: &tauri::WebviewWindow) {}

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
        // Opaque on purpose. Transparency is what made the corner artefact
        // possible: it gave DWM's border somewhere to show through. Nothing
        // here needs to see the desktop — the card fills the window.
        .transparent(false)
        // WebView2 installs an OS-level drag-and-drop handler and Tauri turns it
        // on by default. It swallows the events before the page sees them, so
        // HTML5 drag-and-drop inside the webview does nothing — a row could be
        // gripped and then would not move. Nothing here wants files dropped onto
        // the window; the wizard wants to reorder its own list.
        .disable_drag_drop_handler()
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

    round_dwm_corners(&wizard);

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
    // `--settings` is `--create` that lands on the Settings page. The tray is
    // in another process now, so "open settings" has to survive being asked for
    // across a process boundary rather than through a menu handler.
    let args: Vec<String> = std::env::args().skip(1).collect();

    // The elevated half of Eject, which is this same executable run again with
    // administrator. It does its work and exits before any window is built, so
    // the UAC prompt does not flash a second launcher at the user.
    #[cfg(target_os = "windows")]
    if let Some(index) = args.iter().position(|arg| arg == "--eject") {
        let drive = args.get(index + 1).cloned().unwrap_or_default();
        std::process::exit(run_elevated_eject(&drive) as i32);
    }
    let settings = args.iter().any(|arg| arg == "--settings");
    let wizard = settings || args.iter().any(|arg| arg == "--create");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            drive_path,
            parse_cartridge,
            launch_game,
            eject_drive,
            focus_window,
            list_skins,
            debug_logging,
            debug_log,
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
            refetch_cartridge_artwork,
            host_platform,
            tuning_plan,
            apply_tuning,
            sgdb_search_games,
            sgdb_get_artwork,
            sgdb_download_artwork,
            sgdb_last_used_artwork,
            list_target_drives,
            list_unmounted_volumes,
            mount_volume,
            format_plan,
            executable_choices,
            steam_registration,
            holds_steam_games,
            steam_registration_plan,
            register_with_steam,
            unregister_from_steam,
            create_cartridge,
            open_wizard_settings,
            open_wizard_window,
        ])
        .setup(move |app| {
            if wizard {
                // The same door the launcher's Settings link uses, rather than
                // a second builder that had drifted to a fixed size the
                // resizing comment in open_wizard explicitly argues against.
                open_wizard(app.handle(), settings)?;
            } else {
                let launcher =
                    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                        .title("PC GamePak")
                        .inner_size(420.0, 630.0)
                        .resizable(false)
                        .decorations(false)
                        .transparent(false)
                        // The popup has to land on top of whatever is running.
                        .always_on_top(true)
                        .center()
                        .visible(false)
                        .build()?;
                round_dwm_corners(&launcher);
                let _ = launcher; // keep the window alive and preserve the builder's side effects.
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
