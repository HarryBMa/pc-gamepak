//! Where a game keeps its saves, from Ludusavi's manifest.
//!
//! Nothing on a PC says where a game writes its saves; PCGamingWiki does, and
//! [Ludusavi](https://github.com/mtkennerly/ludusavi-manifest) turns that into
//! one open YAML file covering tens of thousands of games. Off by default, like
//! every other lookup: switched on, the file is downloaded once, kept beside
//! `settings.json`, and refreshed when it is a month old.
//!
//! The file is 17 MB of very regular YAML, so it is read with a line scanner
//! rather than a YAML library — two-space indents, one game per top-level key:
//!
//! ```text
//! Stardew Valley:
//!   files:
//!     "<winAppData>/StardewValley/Saves":
//!       tags:
//!         - save
//!       when:
//!         - os: windows
//!   steam:
//!     id: 413150
//! ```
//!
//! What comes out is a `save.windows=` and a `save.linux=` line, each written
//! in the `{token}` form [`crate::saves`] resolves, so a cartridge made on one
//! machine syncs on the other kind too.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const URL: &str =
    "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";

/// How old the cached manifest may get before it is fetched again.
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// A game's save directory on each platform, as `save=` templates.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocations {
    pub windows: Option<String>,
    pub linux: Option<String>,
}

impl SaveLocations {
    pub fn is_empty(&self) -> bool {
        self.windows.is_none() && self.linux.is_none()
    }

    /// The template for the machine this is running on.
    pub fn here(&self) -> Option<&str> {
        if cfg!(windows) {
            self.windows.as_deref()
        } else {
            self.linux.as_deref()
        }
    }

    /// The conf lines, labelled so the two platform lines are one slot.
    pub fn conf_lines(&self, label: &str) -> Vec<String> {
        let label = label.replace(['|', '\n', '\r', '='], " ");
        [("windows", &self.windows), ("linux", &self.linux)]
            .into_iter()
            .filter_map(|(os, template)| {
                template
                    .as_ref()
                    .map(|template| format!("save.{os}={}|{template}", label.trim()))
            })
            .collect()
    }
}

fn cache_path() -> PathBuf {
    crate::settings::settings_dir()
        .join("ludusavi")
        .join("manifest.yaml")
}

/// Look a game up, downloading the manifest first if it is missing or stale.
///
/// `steam_id` wins over the title when the manifest has it: names drift
/// ("Hollow Knight" and "Hollow Knight: Voidheart Edition"), app ids do not.
pub fn lookup(title: &str, steam_id: Option<&str>) -> Result<Option<SaveLocations>, String> {
    let text = manifest()?;
    Ok(lookup_in(&text, title, steam_id).or_else(|| scan_here(title)))
}

/// A folder named after the game where games put saves, on this machine.
///
/// For a game the manifest does not list: most write to a folder with their
/// own name, directly under one of these or under their studio's. Only finds a
/// game that has saved here already, and only the platform it runs on.
pub fn scan_here(title: &str) -> Option<SaveLocations> {
    let wanted = normalise(title);
    // "Ys" or "Rez" would match any folder with those letters in it.
    if wanted.len() < 4 {
        return None;
    }
    let roots: &[(&str, &str)] = &[
        ("documents", "My Games"),
        ("documents", ""),
        ("savedgames", ""),
        ("appdata", ""),
        ("localappdata", ""),
        ("home", "AppData/LocalLow"),
    ];
    let named = |dir: &std::path::Path| {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>()
    };
    let is_it = |path: &std::path::Path| {
        path.file_name()
            .is_some_and(|name| normalise(&name.to_string_lossy()) == wanted)
    };
    for (token, under) in roots {
        let Some(base) = crate::saves::token_path(token).map(|p| p.join(under)) else {
            continue;
        };
        let top = named(&base);
        // The game's own folder, else one inside its studio's.
        let found = top
            .iter()
            .find(|path| is_it(path))
            .cloned()
            .or_else(|| top.iter().flat_map(|studio| named(studio)).find(|p| is_it(p)));
        if let Some(template) = found.and_then(|path| crate::saves::template_from_path(&path)) {
            let mut places = SaveLocations::default();
            if cfg!(windows) {
                places.windows = Some(template);
            } else {
                places.linux = Some(template);
            }
            return Some(places);
        }
    }
    None
}

/// The manifest's text, fetched if it has to be.
fn manifest() -> Result<String, String> {
    let path = cache_path();
    let fresh = std::fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age < MAX_AGE);
    if !fresh {
        if let Err(e) = download(&path) {
            // A stale copy is still a good answer; only no copy at all fails.
            if !path.is_file() {
                return Err(format!("Could not download Ludusavi's save list: {e}"));
            }
        }
    }
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

fn download(path: &PathBuf) -> Result<(), String> {
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .user_agent("pc-gamepak")
        .build()
        .get(URL)
        .call()
        .map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Written beside and renamed over, so an interrupted download never leaves
    // half a manifest that parses as fewer games.
    let partial = path.with_extension("yaml.part");
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    std::io::copy(&mut response.into_reader(), &mut file).map_err(|e| e.to_string())?;
    drop(file);
    #[cfg(windows)]
    let _ = std::fs::remove_file(path);
    std::fs::rename(&partial, path).map_err(|e| e.to_string())
}

/// Find a game in manifest text and work out its save directories.
pub fn lookup_in(text: &str, title: &str, steam_id: Option<&str>) -> Option<SaveLocations> {
    let wanted = normalise(title);
    let mut by_name = None;
    for (name, block) in games(text) {
        if let Some(id) = steam_id.filter(|id| !id.is_empty()) {
            if steam_id_of(&block).as_deref() == Some(id) {
                return Some(locations(&block)).filter(|found| !found.is_empty());
            }
        }
        if by_name.is_none() && normalise(&name) == wanted {
            by_name = Some(block);
            if steam_id.is_none() {
                break;
            }
        }
    }
    by_name
        .map(|block| locations(&block))
        .filter(|found| !found.is_empty())
}

/// Lower case, letters and digits only: "STAR WARS™: Knights" matches
/// "Star Wars Knights".
fn normalise(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Every top-level key with the lines that belong to it.
fn games(text: &str) -> impl Iterator<Item = (String, Vec<&str>)> {
    let mut lines = text.lines().peekable();
    std::iter::from_fn(move || loop {
        let line = lines.next()?;
        if line.starts_with(' ') || line.starts_with('#') || line.starts_with("---") {
            continue;
        }
        let Some(key) = line.strip_suffix(':') else {
            continue;
        };
        let name = unquote(key);
        let mut block = Vec::new();
        while let Some(next) = lines.peek() {
            if !next.is_empty() && !next.starts_with(' ') {
                break;
            }
            block.push(lines.next().unwrap_or_default());
        }
        return Some((name, block));
    })
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .map(|v| v.replace("\\\"", "\""))
        .unwrap_or_else(|| value.to_string())
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

fn steam_id_of(block: &[&str]) -> Option<String> {
    let at = block.iter().position(|line| *line == "  steam:")?;
    block[at + 1..]
        .iter()
        .take_while(|line| indent(line) > 2)
        .find_map(|line| line.trim().strip_prefix("id:"))
        .map(|id| id.trim().to_string())
}

/// One entry under `files:`.
#[derive(Default)]
struct Entry {
    path: String,
    save: bool,
    /// `(os, store)` per `when` item; empty means everywhere.
    when: Vec<(Option<String>, Option<String>)>,
}

fn entries(block: &[&str]) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    let mut in_files = false;
    let mut list = "";
    for line in block {
        let depth = indent(line);
        let text = line.trim();
        if depth == 2 {
            in_files = text == "files:";
            continue;
        }
        if !in_files || text.is_empty() {
            continue;
        }
        match depth {
            4 => out.push(Entry {
                path: unquote(text.strip_suffix(':').unwrap_or(text)),
                ..Default::default()
            }),
            6 => list = text.trim_end_matches(':'),
            _ => {
                let Some(entry) = out.last_mut() else {
                    continue;
                };
                let item = text.strip_prefix("- ");
                match list {
                    "tags" => entry.save |= item == Some("save"),
                    "when" => {
                        let (field, starts) = match item {
                            Some(rest) => (rest, true),
                            None => (text, false),
                        };
                        if starts {
                            entry.when.push((None, None));
                        }
                        let Some(last) = entry.when.last_mut() else {
                            continue;
                        };
                        if let Some(os) = field.strip_prefix("os:") {
                            last.0 = Some(os.trim().to_string());
                        } else if let Some(store) = field.strip_prefix("store:") {
                            last.1 = Some(store.trim().to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

fn locations(block: &[&str]) -> SaveLocations {
    let entries = entries(block);
    let first = |os: &str| {
        entries
            .iter()
            .filter(|entry| entry.save && applies(entry, os))
            .find_map(|entry| template_for(&entry.path, os))
    };
    SaveLocations {
        windows: first("windows"),
        linux: first("linux"),
    }
}

/// Whether an entry is for this platform, installed the ordinary way. A
/// Microsoft Store copy keeps its saves somewhere else entirely.
fn applies(entry: &Entry, os: &str) -> bool {
    entry.when.is_empty()
        || entry.when.iter().any(|(when_os, store)| {
            when_os.as_deref().is_none_or(|w| w == os) && store.as_deref() != Some("microsoft")
        })
}

/// Ludusavi's placeholders in [`crate::saves`] tokens, or `None` for a path
/// that needs something only Ludusavi knows (the install directory, a store
/// user id).
fn template_for(path: &str, os: &str) -> Option<String> {
    let map: &[(&str, &str)] = match os {
        "windows" => &[
            ("<winAppData>", "{appdata}"),
            ("<winLocalAppDataLow>", "{home}/AppData/LocalLow"),
            ("<winLocalAppData>", "{localappdata}"),
            ("<winDocuments>", "{documents}"),
            ("<home>", "{home}"),
        ],
        _ => &[
            ("<xdgConfig>", "{appdata}"),
            ("<xdgData>", "{localappdata}"),
            ("<home>", "{home}"),
        ],
    };
    let (from, to) = map.iter().find(|(from, _)| path.starts_with(from))?;
    // The folder is what gets carried, so a path that goes on into a pattern
    // (`*.dat`) or a placeholder only Ludusavi can fill (`<storeUserId>`) is
    // cut at the last folder before it. At least one folder of the game's own
    // has to remain: carrying the whole of AppData is not carrying a save.
    let rest: Vec<&str> = path[from.len()..]
        .split('/')
        .filter(|part| !part.is_empty())
        .take_while(|part| !part.contains('*') && !part.contains('<'))
        .collect();
    (!rest.is_empty()).then(|| format!("{to}/{}", rest.join("/")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
"!Hidden Game":
  files:
    "<base>/save.dat":
      tags:
        - save
Hollow Knight:
  files:
    "<base>/hollow_knight_Data/Config.ini":
      tags:
        - config
    "<home>/AppData/LocalLow/Team Cherry/Hollow Knight/*.dat":
      tags:
        - save
      when:
        - os: windows
    "<winProgramData>/Packages/TeamCherry/SystemAppData/wgs":
      tags:
        - save
      when:
        - os: windows
          store: microsoft
    "<xdgConfig>/unity3d/Team Cherry/Hollow Knight/*.dat":
      tags:
        - save
      when:
        - os: linux
  steam:
    id: 367520
Stardew Valley:
  cloud:
    steam: true
  files:
    "<winAppData>/StardewValley/Saves":
      tags:
        - save
      when:
        - os: windows
    "<xdgConfig>/StardewValley/Saves":
      tags:
        - save
      when:
        - os: linux
  steam:
    id: 413150
"#;

    #[test]
    fn finds_by_steam_id_before_name() {
        let found = lookup_in(SAMPLE, "Something Else Entirely", Some("413150")).unwrap();
        assert_eq!(
            found.windows.as_deref(),
            Some("{appdata}/StardewValley/Saves")
        );
        assert_eq!(
            found.linux.as_deref(),
            Some("{appdata}/StardewValley/Saves")
        );
    }

    #[test]
    fn finds_by_name_and_carries_the_folder_of_a_pattern() {
        let found = lookup_in(SAMPLE, "HOLLOW KNIGHT", None).unwrap();
        assert_eq!(
            found.windows.as_deref(),
            Some("{home}/AppData/LocalLow/Team Cherry/Hollow Knight")
        );
        assert_eq!(
            found.linux.as_deref(),
            Some("{appdata}/unity3d/Team Cherry/Hollow Knight")
        );
    }

    #[test]
    fn a_game_only_its_install_folder_knows_is_not_a_match() {
        assert_eq!(lookup_in(SAMPLE, "!Hidden Game", None), None);
        assert_eq!(lookup_in(SAMPLE, "Not In The List", None), None);
    }

    #[test]
    fn writes_one_slot_for_both_platforms() {
        let found = lookup_in(SAMPLE, "Stardew Valley", None).unwrap();
        assert_eq!(
            found.conf_lines("Stardew | Valley"),
            [
                "save.windows=Stardew   Valley|{appdata}/StardewValley/Saves",
                "save.linux=Stardew   Valley|{appdata}/StardewValley/Saves",
            ]
        );
        // And the saves module reads them back as one slot on this machine.
        let conf = format!("title=S\n{}\n", found.conf_lines("Stardew").join("\n"));
        let slots = crate::saves::parse_declarations(&conf);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].template, "{appdata}/StardewValley/Saves");
    }
}
