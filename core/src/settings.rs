//! What the user has chosen, kept between runs.
//!
//! One file, a handful of keys, and a deliberate default: **nothing here is
//! switched on**. The wizard works with no network at all — game lists and
//! cover art come from caches Steam and Playnite have already written — and it
//! stays that way until someone opts in.
//!
//! The file lives beside the artwork cache: `%LOCALAPPDATA%\PC-GamePak`
//! on Windows, `~/.local/state/pc-gamepak` elsewhere.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Look artwork up on SteamGridDB. Off unless the user says otherwise: it
    /// is the only thing in the project that talks to the network.
    pub steamgriddb_enabled: bool,
    /// A personal SteamGridDB API key. Their v2 API refuses unauthenticated
    /// requests, so the integration does nothing useful without one.
    pub steamgriddb_api_key: String,
    /// Folders to scan for games that no launcher knows about.
    ///
    /// Empty means "whatever `folders::default_roots` finds", which is the
    /// state every install starts in. It is only written once the user edits
    /// the list, so a new launcher directory appearing on disk is picked up
    /// without anyone having to re-run anything.
    pub game_folder_roots: Vec<String>,

    // ---- What Create does without asking ---------------------------------
    //
    // The wizard has always had these controls; it just had nowhere to put the
    // answers. They were sent to `set_settings` as fields this struct did not
    // declare, and serde dropped them on the floor, so every one of them reset
    // on the next run. They live here now because Create stopped asking: it
    // reads them and gets on with it.
    /// `exfat` or `btrfs`.
    pub default_filesystem: String,
    /// Read the cartridge back and check it against what was written.
    ///
    /// On by default. The first two cartridges written on real hardware were
    /// checked, and one of them had two 2 GB archives that arrived with the
    /// right length and the wrong contents — a USB bridge dropping the link
    /// under a sustained write. Nothing else would have caught that until the
    /// game crashed on a level the user had not reached yet.
    pub default_verify: bool,
    /// Write `autorun.inf` and `cover.ico` so Explorer names the drive.
    pub default_icon: bool,
    /// Power the drive down when the write finishes.
    pub default_eject: bool,
    /// Register a Steam cartridge in `libraryfolders.vdf`.
    pub default_register_steam: bool,
    /// Format the drive before writing.
    ///
    /// Off unless asked for, and the backend still requires the drive's current
    /// label to be sent back before it will touch a filesystem — this decides
    /// whether Create *offers* to format, never whether the gate applies.
    pub default_format: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            steamgriddb_enabled: false,
            steamgriddb_api_key: String::new(),
            game_folder_roots: Vec::new(),
            default_filesystem: "exfat".to_string(),
            // Costs a read pass over the drive and is worth it: the alternative
            // is finding out from a crash months later.
            default_verify: true,
            // A cartridge that does not name itself in Explorer is half a
            // cartridge, and ejecting is what you were going to do anyway.
            default_icon: true,
            default_eject: true,
            default_register_steam: true,
            default_format: false,
        }
    }
}

impl Settings {
    /// The key to send, or nothing when the integration is off or unkeyed.
    pub fn steamgriddb_key(&self) -> Option<&str> {
        if !self.steamgriddb_enabled {
            return None;
        }
        let key = self.steamgriddb_api_key.trim();
        (!key.is_empty()).then_some(key)
    }
}

/// Where the settings file lives. `PC_GAMEPAK_CONFIG_DIR` overrides it, which
/// is what the tests use.
pub fn settings_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("PC_GAMEPAK_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.trim().is_empty() {
                return PathBuf::from(local).join("PC-GamePak");
            }
        }
        PathBuf::from(".")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("state")
            .join("pc-gamepak")
    }
}

fn settings_path() -> PathBuf {
    settings_dir().join("settings.json")
}

/// Read the settings. A missing or unreadable file is not an error — it means
/// the defaults, which are what a fresh install runs on.
pub fn load() -> Settings {
    load_from(&settings_path())
}

pub fn load_from(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<(), String> {
    save_to(&settings_path(), settings)
}

pub fn save_to(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("could not encode the settings: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_install_is_offline() {
        let settings = Settings::default();
        assert!(!settings.steamgriddb_enabled);
        assert!(settings.steamgriddb_key().is_none());
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let scratch = crate::testutil::Scratch::new("settings");
        let path = scratch.join("settings.json");

        // Nothing written yet: the defaults stand rather than an error.
        assert_eq!(load_from(&path), Settings::default());

        let chosen = Settings {
            steamgriddb_enabled: true,
            steamgriddb_api_key: "  abc123  ".to_string(),
            ..Settings::default()
        };
        save_to(&path, &chosen).unwrap();

        let read_back = load_from(&path);
        assert_eq!(read_back, chosen);
        // Whitespace around a pasted key is the user's, not theirs to debug.
        assert_eq!(read_back.steamgriddb_key(), Some("abc123"));
    }

    #[test]
    fn every_default_the_wizard_sends_survives_a_save() {
        // These were declared nowhere, so `set_settings` accepted them and
        // serde dropped them: the wizard's own defaults reset on every run.
        let scratch = crate::testutil::Scratch::new("settings-defaults");
        let path = scratch.join("settings.json");

        let chosen = Settings {
            default_filesystem: "btrfs".to_string(),
            // Every value here is the opposite of the default, so a field that
            // is silently dropped shows up as a mismatch rather than passing by
            // coincidence.
            default_verify: false,
            default_icon: false,
            default_eject: false,
            default_register_steam: false,
            default_format: true,
            ..Settings::default()
        };
        save_to(&path, &chosen).unwrap();

        assert_eq!(load_from(&path), chosen);
    }

    #[test]
    fn a_fresh_install_writes_a_named_cartridge_and_ejects_it() {
        let fresh = Settings::default();
        assert!(fresh.default_icon, "a cartridge should name itself");
        assert!(fresh.default_eject);
        assert!(fresh.default_register_steam);
        // Formatting erases a drive, so it never happens unless it is asked
        // for. Verifying only costs time, and the time buys the one guarantee
        // nothing else on a cartridge provides.
        assert!(!fresh.default_format);
        assert!(fresh.default_verify, "a copy should check its own work");
    }

    #[test]
    fn a_key_is_only_offered_when_the_lookup_is_on() {
        let off = Settings {
            steamgriddb_enabled: false,
            steamgriddb_api_key: "abc123".to_string(),
            ..Settings::default()
        };
        assert!(off.steamgriddb_key().is_none());

        let on_but_unkeyed = Settings {
            steamgriddb_enabled: true,
            steamgriddb_api_key: "   ".to_string(),
            ..Settings::default()
        };
        assert!(on_but_unkeyed.steamgriddb_key().is_none());
    }

    #[test]
    fn nonsense_in_the_file_falls_back_to_the_defaults() {
        let scratch = crate::testutil::Scratch::new("settings-junk");
        let path = scratch.join("settings.json");
        std::fs::write(&path, b"{ not json at all").unwrap();
        assert_eq!(load_from(&path), Settings::default());
    }
}
