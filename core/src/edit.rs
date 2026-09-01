//! Changing a cartridge that already exists.
//!
//! Everything a cartridge says about itself lives in two small files —
//! `cartridge.conf` and `autorun.inf` — and a picture or two. Renaming a
//! collection, fixing a typo, swapping cover art or dropping a game from the
//! list should therefore cost nothing, and until now it meant writing the whole
//! cartridge again: hours, if the games were copied onto it.
//!
//! So this rewrites only the metadata. **Nothing here copies, deletes or moves a
//! game.** Taking a game out of the list leaves its files exactly where they
//! are; the launcher simply stops offering it, and putting it back is a matter
//! of typing its launch target again.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cartridge::{self, CartridgeInfo};
use crate::{autorun, create};

/// A cartridge as the editor sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Editable {
    pub drive_path: String,
    pub title: String,
    /// The collection's art, as a data URI for the preview.
    pub cover: String,
    pub cover_path: String,
    pub is_bundle: bool,
    pub games: Vec<EditableGame>,
    /// True when the games live on the cartridge, which is what makes removing
    /// one from the list worth a warning.
    pub holds_game: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableGame {
    pub title: String,
    pub executable: String,
    pub cover: String,
    pub cover_path: String,
}

/// What the window is asking for.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequest {
    pub drive_path: String,
    pub title: String,
    /// A new picture for the collection. Absent leaves the existing art alone.
    #[serde(default)]
    pub cover_source: Option<String>,
    /// The games, in the order they should appear. A single-game cartridge has
    /// exactly one; removing the last one is refused.
    pub games: Vec<UpdateGame>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGame {
    pub title: String,
    pub executable: String,
    #[serde(default)]
    pub cover_source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    pub conf_path: String,
    pub cover_written: bool,
    pub autorun_written: bool,
    pub icon: Option<String>,
    pub warnings: Vec<String>,
}

/// Read a cartridge so it can be edited.
pub fn read(drive_path: &str) -> Result<Editable, String> {
    let info = cartridge::read_cartridge_info(drive_path)?;
    Ok(from_info(drive_path, info))
}

fn from_info(drive_path: &str, info: CartridgeInfo) -> Editable {
    // A single-game cartridge has no [game] sections, so the one game is
    // assembled from the top-level keys. The editor then treats both shapes the
    // same, which is why it can turn one into the other.
    let games = if info.games.is_empty() {
        vec![EditableGame {
            title: info.title.clone(),
            executable: info.executable.clone(),
            cover: String::new(),
            cover_path: String::new(),
        }]
    } else {
        info.games
            .iter()
            .map(|game| EditableGame {
                title: game.title.clone(),
                executable: game.executable.clone(),
                cover: game.cover.clone(),
                cover_path: game.cover_path.clone(),
            })
            .collect()
    };

    Editable {
        drive_path: drive_path.to_string(),
        title: info.title,
        cover: info.cover,
        cover_path: info.cover_path,
        is_bundle: info.is_bundle,
        holds_game: info.holds_game,
        games,
    }
}

/// Give every game on a cartridge a fresh portrait cover.
///
/// The repair for a cartridge built when the only art to hand was Steam's
/// landscape header: a wide picture in a 2:3 slot reads as a bad crop however
/// it is displayed, and the fix is a different picture, not different CSS.
///
/// One SteamGridDB request per game, so it is an action someone asks for rather
/// than something that happens on open. A game nobody recognises keeps what it
/// has and says so; the rest are replaced.
pub fn refetch_artwork(drive_path: &str) -> Result<UpdateResult, String> {
    let root = create::resolve_target(drive_path)?;
    let current = read(drive_path)?;

    let mut missed = Vec::new();
    let games: Vec<UpdateGame> = current
        .games
        .iter()
        .map(|game| {
            let found = create::fetch_cover_for(&game.title);
            if found.is_none() {
                missed.push(game.title.clone());
            }
            UpdateGame {
                title: game.title.clone(),
                executable: game.executable.clone(),
                cover_source: found.map(|path| path.to_string_lossy().into_owned()),
            }
        })
        .collect();

    // The collection's own art is the first game's, which has just been
    // replaced; leaving it out keeps whatever the cartridge already had.
    let mut result = update_at(
        &root,
        &UpdateRequest {
            drive_path: drive_path.to_string(),
            title: current.title,
            cover_source: None,
            games,
        },
    )?;

    if !missed.is_empty() {
        result.warnings.push(format!(
            "No artwork was found for {}. {} kept what {} had.",
            missed.join(", "),
            if missed.len() == 1 { "It" } else { "They" },
            if missed.len() == 1 { "it" } else { "they" },
        ));
    }
    Ok(result)
}

/// Write the changes back.
pub fn update(request: &UpdateRequest) -> Result<UpdateResult, String> {
    let root = create::resolve_target(&request.drive_path)?;
    update_at(&root, request)
}

/// The work, against a root that has already been checked.
///
/// Split out so it can be tested without a removable drive: `update` is the
/// half that decides *where*, and refuses anywhere it should not write.
pub fn update_at(root: &Path, request: &UpdateRequest) -> Result<UpdateResult, String> {
    let title = create::sanitize_conf_value(&request.title);
    if title.is_empty() {
        return Err("Give the cartridge a title.".into());
    }
    if request.games.is_empty() {
        return Err("A cartridge needs at least one game.".into());
    }

    let mut result = UpdateResult::default();
    let mut warnings = Vec::new();

    // What is on the cartridge now, so superseded art can be tidied up and
    // untouched art kept.
    let existing = cartridge::read_cartridge_info(&root.to_string_lossy()).ok();

    // ---- The games -------------------------------------------------------
    let mut titles = Vec::with_capacity(request.games.len());
    let mut executables = Vec::with_capacity(request.games.len());
    for (index, game) in request.games.iter().enumerate() {
        let game_title = create::sanitize_conf_value(&game.title);
        if game_title.is_empty() {
            return Err(format!("Game {} needs a title.", index + 1));
        }
        let executable = create::sanitize_conf_value(&game.executable);
        create::validate_executable(&executable, root)?;
        titles.push(game_title);
        executables.push(executable);
    }

    // A game keeps the art it already had unless a new picture was chosen for
    // it — and the art belongs to the *game*, not to the slot it sits in. The
    // list arrives in its new order, so looking art up by position handed each
    // game whatever used to be in its seat: one press of the reorder button and
    // every poster on the cartridge moved along by one.
    let mut art: Vec<Option<String>> = executables
        .iter()
        .map(|executable| {
            existing
                .as_ref()?
                .games
                .iter()
                .find(|previous| create::sanitize_conf_value(&previous.executable) == *executable)
                .map(|previous| previous.cover_path.clone())
                .filter(|path| !path.is_empty())
                .and_then(|path| file_name_relative(root, &path))
        })
        .collect();

    for (index, game) in request.games.iter().enumerate() {
        let Some(source) = game
            .cover_source
            .as_deref()
            .map(str::trim)
            .filter(|source| !source.is_empty())
        else {
            continue;
        };
        // `cover_<index>` is the natural name and nearly always free, but after
        // a reorder that file can still belong to a game that kept its art —
        // and writing there would quietly replace that game's poster with this
        // one's.
        let stem = free_cover_stem(index, &art);
        match create::copy_cover(Path::new(source), root, &stem) {
            Ok(name) => art[index] = Some(name),
            Err(e) => warnings.push(format!(
                "Cover art for {} was not changed: {e}",
                titles[index]
            )),
        }
    }

    let entries: Vec<(String, String, Option<String>)> = titles
        .into_iter()
        .zip(executables)
        .zip(art)
        .map(|((title, executable), cover)| (title, executable, cover))
        .collect();

    // ---- The collection's own art ---------------------------------------
    let previous_cover = existing
        .as_ref()
        .map(|info| info.cover_path.clone())
        .filter(|path| !path.is_empty());

    let stem = if entries.len() > 1 {
        "collection"
    } else {
        "cover"
    };
    let cover_name = match request.cover_source.as_deref().map(str::trim) {
        Some(source) if !source.is_empty() => {
            match create::copy_cover(Path::new(source), root, stem) {
                Ok(name) => {
                    result.cover_written = true;
                    Some(name)
                }
                Err(e) => {
                    warnings.push(format!("Cover art was not changed: {e}"));
                    previous_cover
                        .as_deref()
                        .and_then(|p| file_name_relative(root, p))
                }
            }
        }
        _ => previous_cover
            .as_deref()
            .and_then(|path| file_name_relative(root, path)),
    };

    // ---- cartridge.conf --------------------------------------------------
    //
    // Neither the background nor the logo can be changed from here — this
    // request has nowhere to carry a new source for either — so whatever the
    // cartridge already had is carried forward unchanged rather than dropped.
    // Bundle icon/background/logo have no round trip yet (`existing` never
    // populates them for a bundle); that is a pre-existing gap, not something
    // this edit introduces.
    let existing_background = existing
        .as_ref()
        .map(|info| info.background_path.clone())
        .filter(|path| !path.is_empty())
        .and_then(|path| file_name_relative(root, &path));
    let existing_logo = existing
        .as_ref()
        .map(|info| info.logo_path.clone())
        .filter(|path| !path.is_empty())
        .and_then(|path| file_name_relative(root, &path));

    let conf = if entries.len() > 1 {
        let tuples: Vec<(&str, &str, Option<&str>)> = entries
            .iter()
            .map(|(t, e, c)| (t.as_str(), e.as_str(), c.as_deref()))
            .collect();
        create::render_bundle_conf(&title, cover_name.as_deref(), None, None, None, &tuples)
    } else {
        create::render_cartridge_conf(
            &title,
            &entries[0].1,
            cover_name.as_deref(),
            None,
            existing_background.as_deref(),
            existing_logo.as_deref(),
        )
    };

    let conf_path = root.join("cartridge.conf");
    std::fs::write(&conf_path, conf)
        .map_err(|e| format!("Could not write {}: {e}", conf_path.display()))?;
    result.conf_path = conf_path.to_string_lossy().into_owned();

    // ---- autorun.inf ------------------------------------------------------
    let cover_full = cover_name.as_ref().map(|name| root.join(name));
    match autorun::write_autorun(root, &title, cover_full.as_deref()) {
        Ok(icon) => {
            result.autorun_written = true;
            result.icon = icon;
        }
        Err(e) => warnings.push(format!("autorun.inf was not rewritten: {e}")),
    }

    // ---- Tidy up the picture that was replaced ---------------------------
    if let (Some(previous), Some(now)) = (previous_cover.as_deref(), cover_name.as_deref()) {
        if let Some(old_name) = file_name_relative(root, previous) {
            if old_name != now && is_ours_to_delete(&old_name) {
                let _ = std::fs::remove_file(root.join(&old_name));
            }
        }
    }

    result.warnings = warnings;
    Ok(result)
}

/// A `cover_<n>` stem that no other game's kept art is already using.
///
/// The slot's own number is the right answer almost every time; it is not when
/// a reorder has left a different game still holding that file.
fn free_cover_stem(index: usize, art: &[Option<String>]) -> String {
    let taken: Vec<&str> = art
        .iter()
        .enumerate()
        .filter(|(other, _)| *other != index)
        .filter_map(|(_, name)| name.as_deref())
        .map(stem_of)
        .collect();

    let preferred = format!("cover_{index}");
    if !taken.contains(&preferred.as_str()) {
        return preferred;
    }
    // Finite `taken`, so some number is always free.
    (0..)
        .map(|n| format!("cover_{n}"))
        .find(|candidate| !taken.contains(&candidate.as_str()))
        .expect("a free cover stem")
}

/// The part of a file name before its extension.
fn stem_of(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// An absolute path under the cartridge, back to the name the conf would use.
fn file_name_relative(root: &Path, absolute: &str) -> Option<String> {
    crate::verify::relative_path(root, Path::new(absolute))
}

/// Only art this tool wrote is ever removed.
///
/// A cartridge is somebody's drive; a file named anything else is theirs, even
/// if `cover=` happened to point at it.
fn is_ours_to_delete(name: &str) -> bool {
    let stem = name.rsplit('/').next().unwrap_or(name);
    stem.starts_with("cover") || stem.starts_with("collection")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Scratch;

    fn single_game(scratch: &Scratch) {
        scratch.write(
            "cartridge.conf",
            b"title=Hollow Knight\nexecutable=steam://rungameid/367520\ncover=cover.jpg\n",
        );
        scratch.write("cover.jpg", b"pretend art");
    }

    fn request(title: &str, games: &[(&str, &str)]) -> UpdateRequest {
        UpdateRequest {
            drive_path: String::new(),
            title: title.to_string(),
            cover_source: None,
            games: games
                .iter()
                .map(|(t, e)| UpdateGame {
                    title: t.to_string(),
                    executable: e.to_string(),
                    cover_source: None,
                })
                .collect(),
        }
    }

    #[test]
    fn a_single_game_cartridge_reads_as_one_game() {
        let scratch = Scratch::new("edit-read");
        single_game(&scratch);

        let editable = read(scratch.path().to_str().unwrap()).unwrap();
        assert_eq!(editable.title, "Hollow Knight");
        assert!(!editable.is_bundle);
        // Even though the file has no [game] section, the editor sees one game,
        // so both shapes are edited the same way.
        assert_eq!(editable.games.len(), 1);
        assert_eq!(editable.games[0].executable, "steam://rungameid/367520");
    }

    #[test]
    fn renaming_rewrites_the_conf_and_keeps_the_art() {
        let scratch = Scratch::new("edit-rename");
        single_game(&scratch);

        let result = update_at(
            scratch.path(),
            &request(
                "Hollow Knight: Silksong",
                &[("Hollow Knight: Silksong", "steam://rungameid/367520")],
            ),
        )
        .unwrap();

        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
        let conf = std::fs::read_to_string(scratch.join("cartridge.conf")).unwrap();
        assert!(conf.contains("title=Hollow Knight: Silksong"), "{conf}");
        // The picture was not touched, and the conf still points at it.
        assert!(conf.contains("cover=cover.jpg"), "{conf}");
        assert!(scratch.join("cover.jpg").is_file());
    }

    #[test]
    fn new_art_replaces_the_old_file() {
        let scratch = Scratch::new("edit-art");
        single_game(&scratch);
        scratch.write("chosen.png", b"a different picture");

        let mut req = request(
            "Hollow Knight",
            &[("Hollow Knight", "steam://rungameid/367520")],
        );
        req.cover_source = Some(scratch.join("chosen.png").to_string_lossy().into_owned());
        let result = update_at(scratch.path(), &req).unwrap();

        assert!(result.cover_written);
        let conf = std::fs::read_to_string(scratch.join("cartridge.conf")).unwrap();
        assert!(conf.contains("cover=cover.png"), "{conf}");
        assert!(scratch.join("cover.png").is_file());
        // The superseded picture is cleared away rather than left behind.
        assert!(!scratch.join("cover.jpg").exists());
    }

    #[test]
    fn a_picture_this_tool_did_not_write_is_left_alone() {
        let scratch = Scratch::new("edit-art-theirs");
        scratch.write(
            "cartridge.conf",
            b"title=Tunic\nexecutable=steam://rungameid/553420\ncover=my-own-photo.jpg\n",
        );
        scratch.write("my-own-photo.jpg", b"someone's own file");
        scratch.write("chosen.png", b"a different picture");

        let mut req = request("Tunic", &[("Tunic", "steam://rungameid/553420")]);
        req.cover_source = Some(scratch.join("chosen.png").to_string_lossy().into_owned());
        update_at(scratch.path(), &req).unwrap();

        assert!(scratch.join("cover.png").is_file());
        assert!(
            scratch.join("my-own-photo.jpg").is_file(),
            "a file we did not write must survive being replaced in the conf"
        );
    }

    #[test]
    fn a_single_game_can_become_a_collection() {
        let scratch = Scratch::new("edit-to-bundle");
        single_game(&scratch);

        update_at(
            scratch.path(),
            &request(
                "Hollow Knight Collection",
                &[
                    ("Hollow Knight", "steam://rungameid/367520"),
                    ("Silksong", "steam://rungameid/1030300"),
                ],
            ),
        )
        .unwrap();

        let info = cartridge::read_cartridge_info(scratch.path().to_str().unwrap()).unwrap();
        assert!(info.is_bundle);
        assert_eq!(info.games.len(), 2);
        assert_eq!(info.title, "Hollow Knight Collection");
        // And Enter still starts something.
        assert_eq!(info.executable, "steam://rungameid/367520");
    }

    #[test]
    fn dropping_a_game_leaves_its_files_where_they_are() {
        let scratch = Scratch::new("edit-drop");
        scratch.write(
            "cartridge.conf",
            b"[collection]\ntitle=Two Games\n\n[game]\ntitle=One\nexecutable=steam://rungameid/1\n\n[game]\ntitle=Two\nexecutable=steam://rungameid/2\n",
        );
        scratch.write("Games/Two/Two.exe", b"a game nobody asked to delete");

        update_at(
            scratch.path(),
            &request("One", &[("One", "steam://rungameid/1")]),
        )
        .unwrap();

        let info = cartridge::read_cartridge_info(scratch.path().to_str().unwrap()).unwrap();
        assert!(
            !info.is_bundle,
            "one game left means it is no longer a bundle"
        );
        assert!(
            scratch.join("Games/Two/Two.exe").is_file(),
            "removing a game from the list must never delete it"
        );
    }

    #[test]
    fn the_order_of_the_games_is_the_order_given() {
        let scratch = Scratch::new("edit-order");
        scratch.write(
            "cartridge.conf",
            b"[collection]\ntitle=Series\n\n[game]\ntitle=First\nexecutable=steam://rungameid/1\n\n[game]\ntitle=Second\nexecutable=steam://rungameid/2\n",
        );

        update_at(
            scratch.path(),
            &request(
                "Series",
                &[
                    ("Second", "steam://rungameid/2"),
                    ("First", "steam://rungameid/1"),
                ],
            ),
        )
        .unwrap();

        let info = cartridge::read_cartridge_info(scratch.path().to_str().unwrap()).unwrap();
        assert_eq!(info.games[0].title, "Second");
        assert_eq!(info.games[1].title, "First");
    }

    #[test]
    fn reordering_moves_each_game_with_its_own_poster() {
        let scratch = Scratch::new("edit-order-art");
        scratch.write(
            "cartridge.conf",
            b"[collection]\ntitle=Series\n\n[game]\ntitle=First\nexecutable=steam://rungameid/1\ncover=cover_0.jpg\n\n[game]\ntitle=Second\nexecutable=steam://rungameid/2\ncover=cover_1.jpg\n",
        );
        scratch.write("cover_0.jpg", b"first");
        scratch.write("cover_1.jpg", b"second");

        update_at(
            scratch.path(),
            &request(
                "Series",
                &[
                    ("Second", "steam://rungameid/2"),
                    ("First", "steam://rungameid/1"),
                ],
            ),
        )
        .unwrap();

        // Looked up by position, Second would come back holding cover_0.jpg —
        // the poster that belongs to First.
        let info = cartridge::read_cartridge_info(scratch.path().to_str().unwrap()).unwrap();
        assert!(
            info.games[0].cover_path.ends_with("cover_1.jpg"),
            "Second kept its own art, got {}",
            info.games[0].cover_path
        );
        assert!(
            info.games[1].cover_path.ends_with("cover_0.jpg"),
            "First kept its own art, got {}",
            info.games[1].cover_path
        );
    }

    #[test]
    fn new_art_never_lands_on_a_file_another_game_still_uses() {
        let scratch = Scratch::new("edit-order-collide");
        scratch.write(
            "cartridge.conf",
            b"[collection]\ntitle=Series\n\n[game]\ntitle=First\nexecutable=steam://rungameid/1\ncover=cover_0.jpg\n\n[game]\ntitle=Second\nexecutable=steam://rungameid/2\ncover=cover_1.jpg\n",
        );
        scratch.write("cover_0.jpg", b"first");
        scratch.write("cover_1.jpg", b"second");
        let fresh = scratch.write("new.jpg", b"brand new art");

        // Second moves to slot 0 and gets new art. The obvious name for slot 0
        // is cover_0.jpg, which First is still using.
        let mut req = request(
            "Series",
            &[
                ("Second", "steam://rungameid/2"),
                ("First", "steam://rungameid/1"),
            ],
        );
        req.games[0].cover_source = Some(fresh.to_string_lossy().into_owned());

        update_at(scratch.path(), &req).unwrap();

        assert_eq!(
            std::fs::read(scratch.join("cover_0.jpg")).unwrap(),
            b"first",
            "First's poster was overwritten by Second's new art"
        );
        let info = cartridge::read_cartridge_info(scratch.path().to_str().unwrap()).unwrap();
        assert!(info.games[1].cover_path.ends_with("cover_0.jpg"));
    }

    #[test]
    fn an_empty_title_or_an_empty_cartridge_is_refused() {
        let scratch = Scratch::new("edit-refuse");
        single_game(&scratch);

        assert!(update_at(
            scratch.path(),
            &request("   ", &[("X", "steam://rungameid/1")])
        )
        .unwrap_err()
        .contains("title"));
        assert!(update_at(scratch.path(), &request("Fine", &[]))
            .unwrap_err()
            .contains("at least one game"));
        assert!(update_at(
            scratch.path(),
            &request("Fine", &[("  ", "steam://rungameid/1")])
        )
        .unwrap_err()
        .contains("needs a title"));

        // None of that touched the cartridge.
        let conf = std::fs::read_to_string(scratch.join("cartridge.conf")).unwrap();
        assert!(conf.contains("title=Hollow Knight"), "{conf}");
    }

    #[test]
    fn a_launch_target_that_is_not_on_the_cartridge_is_refused() {
        let scratch = Scratch::new("edit-bad-exe");
        single_game(&scratch);

        // The same confinement the wizard applies: a path must stay on the
        // cartridge, and must exist.
        let err = update_at(
            scratch.path(),
            &request("Hollow Knight", &[("Hollow Knight", "../../etc/passwd")]),
        )
        .unwrap_err();
        assert!(!err.is_empty());

        let conf = std::fs::read_to_string(scratch.join("cartridge.conf")).unwrap();
        assert!(conf.contains("steam://rungameid/367520"), "{conf}");
    }
}
