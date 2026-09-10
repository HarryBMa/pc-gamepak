//! Portable save syncing for cartridges that opt into it.
//!
//! A cartridge may carry a `.pc-gamepak/config.json` describing local save paths
//! to mirror into `.pc-gamepak/saves/` on the drive. The preferred shape is a
//! symlink from the local save directory to the cartridge; when that is not
//! possible, the data is copied in both directions on mount and again after play
//! or before eject.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;

pub const CONFIG_DIR: &str = ".pc-gamepak";
pub const CONFIG_PATH: &str = ".pc-gamepak/config.json";
pub const SAVES_DIR: &str = ".pc-gamepak/saves";

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SyncSummary {
    pub entries: usize,
    pub symlinks_created: usize,
    pub files_copied: usize,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SaveConfig {
    #[serde(alias = "save_paths", alias = "saves")]
    save_paths: Vec<SaveEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SaveEntry {
    Path(String),
    Detailed(SaveEntryDetail),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEntryDetail {
    path: String,
    #[serde(default, alias = "cartridge_path", alias = "name")]
    cartridge_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSave {
    local_path: PathBuf,
    cartridge_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SaveKind {
    File,
    Directory,
}

pub fn sync_cartridge(root: &Path) -> Result<SyncSummary, String> {
    let saves = configured_saves(root)?;
    let mut summary = SyncSummary::default();

    for save in saves {
        summary.entries += 1;
        let outcome = sync_entry(&save)?;
        summary.symlinks_created += usize::from(outcome.symlinked);
        summary.files_copied += outcome.files_copied;
    }

    Ok(summary)
}

fn configured_saves(root: &Path) -> Result<Vec<ResolvedSave>, String> {
    let path = root.join(CONFIG_PATH);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };

    let config: SaveConfig = serde_json::from_str(&text)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;

    config
        .save_paths
        .into_iter()
        .map(|entry| resolve_entry(root, entry))
        .collect()
}

fn resolve_entry(root: &Path, entry: SaveEntry) -> Result<ResolvedSave, String> {
    let (raw_local, raw_cartridge) = match entry {
        SaveEntry::Path(path) => (path, None),
        SaveEntry::Detailed(detail) => (detail.path, detail.cartridge_path),
    };

    let local = expand_local_path(raw_local.trim());
    if local.as_os_str().is_empty() {
        return Err("save path in .pc-gamepak/config.json may not be empty".to_string());
    }

    let relative = match raw_cartridge
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(path) => confined_relative(path)?,
        None => PathBuf::from(safe_component(name_for_save(&local))),
    };

    Ok(ResolvedSave {
        local_path: local,
        cartridge_path: root.join(SAVES_DIR).join(relative),
    })
}

fn name_for_save(path: &Path) -> &str {
    path.file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("save")
}

fn safe_component(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        "save".to_string()
    } else {
        trimmed.to_string()
    }
}

fn confined_relative(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() || path.contains(':') {
        return Err(format!("save path {path:?} must stay under {SAVES_DIR}"));
    }

    let mut out = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("save path {path:?} must stay under {SAVES_DIR}"))
            }
        }
    }

    if out.as_os_str().is_empty() {
        return Err("save path in .pc-gamepak/config.json may not be empty".to_string());
    }
    Ok(out)
}

fn expand_local_path(raw: &str) -> PathBuf {
    let with_home = if raw == "~" || raw.starts_with("~/") || raw.starts_with("~\\") {
        home_dir()
            .map(|home| home.join(raw[2..].trim_start_matches(['/', '\\'])))
            .unwrap_or_else(|| PathBuf::from(raw))
    } else {
        PathBuf::from(raw)
    };

    expand_env_vars(&with_home.to_string_lossy()).into()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn expand_env_vars(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        match chars[i] {
            '%' => {
                if let Some(end) = chars[i + 1..].iter().position(|ch| *ch == '%') {
                    let name: String = chars[i + 1..i + 1 + end].iter().collect();
                    if let Ok(value) = std::env::var(&name) {
                        out.push_str(&value);
                        i += end + 2;
                        continue;
                    }
                }
                out.push('%');
                i += 1;
            }
            '$' => {
                if i + 1 < chars.len() && chars[i + 1] == '{' {
                    if let Some(end) = chars[i + 2..].iter().position(|ch| *ch == '}') {
                        let name: String = chars[i + 2..i + 2 + end].iter().collect();
                        if let Ok(value) = std::env::var(&name) {
                            out.push_str(&value);
                            i += end + 3;
                            continue;
                        }
                    }
                } else {
                    let mut end = i + 1;
                    while end < chars.len()
                        && (chars[end].is_ascii_alphanumeric() || chars[end] == '_')
                    {
                        end += 1;
                    }
                    if end > i + 1 {
                        let name: String = chars[i + 1..end].iter().collect();
                        if let Ok(value) = std::env::var(&name) {
                            out.push_str(&value);
                            i = end;
                            continue;
                        }
                    }
                }
                out.push('$');
                i += 1;
            }
            ch => {
                out.push(ch);
                i += 1;
            }
        }
    }

    out
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct SyncOutcome {
    symlinked: bool,
    files_copied: usize,
}

fn sync_entry(save: &ResolvedSave) -> Result<SyncOutcome, String> {
    let kind = detect_kind(&save.local_path, &save.cartridge_path);
    match kind {
        SaveKind::Directory => sync_directory(save),
        SaveKind::File => sync_file_entry(save),
    }
}

fn detect_kind(local: &Path, cartridge: &Path) -> SaveKind {
    for path in [local, cartridge] {
        if let Ok(meta) = std::fs::metadata(path) {
            return if meta.is_file() {
                SaveKind::File
            } else {
                SaveKind::Directory
            };
        }
    }
    SaveKind::Directory
}

fn sync_directory(save: &ResolvedSave) -> Result<SyncOutcome, String> {
    std::fs::create_dir_all(&save.cartridge_path)
        .map_err(|e| format!("could not create {}: {e}", save.cartridge_path.display()))?;

    if points_at(&save.local_path, &save.cartridge_path) {
        return Ok(SyncOutcome::default());
    }

    if !save.local_path.exists() {
        if try_link_directory(&save.local_path, &save.cartridge_path).is_ok() {
            return Ok(SyncOutcome {
                symlinked: true,
                files_copied: 0,
            });
        }

        std::fs::create_dir_all(&save.local_path)
            .map_err(|e| format!("could not create {}: {e}", save.local_path.display()))?;
        let copied = sync_tree(&save.cartridge_path, &save.local_path)?;
        return Ok(SyncOutcome {
            symlinked: false,
            files_copied: copied,
        });
    }

    let to_cartridge = sync_tree(&save.local_path, &save.cartridge_path)?;
    let back_local = sync_tree(&save.cartridge_path, &save.local_path)?;
    Ok(SyncOutcome {
        symlinked: false,
        files_copied: to_cartridge + back_local,
    })
}

fn sync_file_entry(save: &ResolvedSave) -> Result<SyncOutcome, String> {
    if let Some(parent) = save.cartridge_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }

    if points_at(&save.local_path, &save.cartridge_path) {
        return Ok(SyncOutcome::default());
    }

    if !save.local_path.exists() {
        if try_link_file(&save.local_path, &save.cartridge_path).is_ok() {
            return Ok(SyncOutcome {
                symlinked: true,
                files_copied: 0,
            });
        }
        let copied = sync_file_one_way(&save.cartridge_path, &save.local_path)?;
        return Ok(SyncOutcome {
            symlinked: false,
            files_copied: usize::from(copied),
        });
    }

    let mut copied = 0;
    copied += usize::from(sync_file_one_way(&save.local_path, &save.cartridge_path)?);
    copied += usize::from(sync_file_one_way(&save.cartridge_path, &save.local_path)?);
    Ok(SyncOutcome {
        symlinked: false,
        files_copied: copied,
    })
}

fn points_at(path: &Path, target: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.file_type().is_symlink() {
        return false;
    }
    std::fs::read_link(path).is_ok_and(|linked| linked == target)
}

fn sync_tree(from: &Path, to: &Path) -> Result<usize, String> {
    let Ok(meta) = std::fs::metadata(from) else {
        return Ok(0);
    };
    if meta.is_file() {
        return Ok(usize::from(sync_file_one_way(from, to)?));
    }
    if !meta.is_dir() {
        return Ok(0);
    }

    std::fs::create_dir_all(to).map_err(|e| format!("could not create {}: {e}", to.display()))?;

    let entries =
        std::fs::read_dir(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    let mut copied = 0;
    for entry in entries {
        let entry = entry.map_err(|e| format!("could not read {}: {e}", from.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("could not read {}: {e}", entry.path().display()))?;
        let source = entry.path();
        let destination = to.join(entry.file_name());
        if file_type.is_dir() {
            copied += sync_tree(&source, &destination)?;
        } else if file_type.is_file() {
            copied += usize::from(sync_file_one_way(&source, &destination)?);
        }
    }
    Ok(copied)
}

fn sync_file_one_way(from: &Path, to: &Path) -> Result<bool, String> {
    let Ok(source_meta) = std::fs::metadata(from) else {
        return Ok(false);
    };
    if !source_meta.is_file() {
        return Ok(false);
    }

    let copy = match std::fs::metadata(to) {
        Ok(dest_meta) if dest_meta.is_file() => should_copy(from, &source_meta, to, &dest_meta)?,
        Ok(_) => false,
        Err(_) => true,
    };
    if !copy {
        return Ok(false);
    }

    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    copy_file(from, to)?;
    Ok(true)
}

fn should_copy(
    from: &Path,
    from_meta: &std::fs::Metadata,
    to: &Path,
    to_meta: &std::fs::Metadata,
) -> Result<bool, String> {
    if from_meta.len() == to_meta.len() && files_match(from, to)? {
        return Ok(false);
    }

    let source_time = modified(from_meta);
    let dest_time = modified(to_meta);
    Ok(source_time >= dest_time)
}

fn modified(meta: &std::fs::Metadata) -> SystemTime {
    meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)
}

fn files_match(a: &Path, b: &Path) -> Result<bool, String> {
    use std::io::Read;

    let mut left =
        std::fs::File::open(a).map_err(|e| format!("could not read {}: {e}", a.display()))?;
    let mut right =
        std::fs::File::open(b).map_err(|e| format!("could not read {}: {e}", b.display()))?;
    let mut left_buf = [0u8; 65_536];
    let mut right_buf = [0u8; 65_536];

    loop {
        let left_n = left
            .read(&mut left_buf)
            .map_err(|e| format!("could not read {}: {e}", a.display()))?;
        let right_n = right
            .read(&mut right_buf)
            .map_err(|e| format!("could not read {}: {e}", b.display()))?;
        if left_n != right_n {
            return Ok(false);
        }
        if left_n == 0 {
            return Ok(true);
        }
        if left_buf[..left_n] != right_buf[..right_n] {
            return Ok(false);
        }
    }
}

fn copy_file(from: &Path, to: &Path) -> Result<(), String> {
    use std::io::{Read, Write};

    let mut input =
        std::fs::File::open(from).map_err(|e| format!("could not read {}: {e}", from.display()))?;
    let mut output =
        std::fs::File::create(to).map_err(|e| format!("could not write {}: {e}", to.display()))?;
    let mut buffer = [0u8; 131_072];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|e| format!("could not read {}: {e}", from.display()))?;
        if read == 0 {
            return Ok(());
        }
        output
            .write_all(&buffer[..read])
            .map_err(|e| format!("could not write {}: {e}", to.display()))?;
    }
}

fn try_link_directory(link: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent)?;
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link)
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(target, link)
    }
}

fn try_link_file(link: &Path, target: &Path) -> std::io::Result<()> {
    if let Some(parent) = link.parent() {
        std::fs::create_dir_all(parent)?;
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link)
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(target, link)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Scratch;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn reads_simple_and_named_save_entries() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let scratch = Scratch::new("saves-config");
        std::fs::create_dir_all(scratch.join(CONFIG_DIR)).unwrap();
        std::fs::write(
            scratch.join(CONFIG_PATH),
            r#"{
              "savePaths": [
                "~/My Game/Saves",
                { "path": "$SAVE_ROOT/Profiles", "cartridgePath": "profiles/main" }
              ]
            }"#,
        )
        .unwrap();

        std::env::set_var("HOME", scratch.join("home"));
        std::env::set_var("SAVE_ROOT", scratch.join("root"));

        let saves = configured_saves(scratch.path()).unwrap();
        assert_eq!(saves.len(), 2);
        assert_eq!(saves[0].local_path, scratch.join("home/My Game/Saves"));
        assert_eq!(
            saves[0].cartridge_path,
            scratch.join(".pc-gamepak/saves/Saves")
        );
        assert_eq!(
            saves[1].cartridge_path,
            scratch.join(".pc-gamepak/saves/profiles/main")
        );
    }

    #[test]
    fn refuses_cartridge_paths_that_escape_the_save_area() {
        let scratch = Scratch::new("saves-escape");
        std::fs::create_dir_all(scratch.join(CONFIG_DIR)).unwrap();
        std::fs::write(
            scratch.join(CONFIG_PATH),
            r#"{ "savePaths": [{ "path": "~/save", "cartridgePath": "../outside" }] }"#,
        )
        .unwrap();

        let error = configured_saves(scratch.path()).unwrap_err();
        assert!(error.contains("must stay under"));
    }

    #[test]
    fn missing_local_directory_becomes_a_symlink_when_possible() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let scratch = Scratch::new("saves-link");
        std::env::set_var("HOME", scratch.join("home"));
        std::fs::create_dir_all(scratch.join(CONFIG_DIR)).unwrap();
        std::fs::write(
            scratch.join(CONFIG_PATH),
            r#"{ "savePaths": ["~/Game/Saves"] }"#,
        )
        .unwrap();

        let summary = sync_cartridge(scratch.path()).unwrap();
        assert_eq!(summary.entries, 1);
        assert_eq!(summary.symlinks_created, 1);
        let local = scratch.join("home/Game/Saves");
        let meta = std::fs::symlink_metadata(local).unwrap();
        assert!(meta.file_type().is_symlink());
    }

    #[test]
    fn existing_local_save_is_copied_onto_the_cartridge() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let scratch = Scratch::new("saves-copy-to-cart");
        std::env::set_var("HOME", scratch.join("home"));
        let local = scratch.join("home/Game/Saves");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("slot1.sav"), b"local").unwrap();
        std::fs::create_dir_all(scratch.join(CONFIG_DIR)).unwrap();
        std::fs::write(
            scratch.join(CONFIG_PATH),
            r#"{ "savePaths": ["~/Game/Saves"] }"#,
        )
        .unwrap();

        let summary = sync_cartridge(scratch.path()).unwrap();
        assert_eq!(summary.files_copied, 1);
        assert_eq!(
            std::fs::read(scratch.join(".pc-gamepak/saves/Saves/slot1.sav")).unwrap(),
            b"local"
        );
    }

    #[test]
    fn cartridge_changes_are_copied_back_when_linking_is_not_possible() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let scratch = Scratch::new("saves-copy-back");
        std::env::set_var("HOME", scratch.join("home"));
        let local = scratch.join("home/Game/Saves");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("slot1.sav"), b"old").unwrap();
        let cartridge = scratch.join(".pc-gamepak/saves/Saves");
        std::fs::create_dir_all(&cartridge).unwrap();
        std::fs::write(cartridge.join("slot2.sav"), b"cart").unwrap();
        std::fs::create_dir_all(scratch.join(CONFIG_DIR)).unwrap();
        std::fs::write(
            scratch.join(CONFIG_PATH),
            r#"{ "savePaths": ["~/Game/Saves"] }"#,
        )
        .unwrap();

        let summary = sync_cartridge(scratch.path()).unwrap();
        assert_eq!(summary.symlinks_created, 0);
        assert_eq!(std::fs::read(local.join("slot2.sav")).unwrap(), b"cart");
    }
}
