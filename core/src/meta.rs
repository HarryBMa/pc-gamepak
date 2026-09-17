//! What a cartridge says about a game beyond its name.
//!
//! Until now a cartridge could say four things: a title, a picture, what to
//! run, and where the saves live. That is enough to *launch* a game and not
//! enough to *present* one — every skin had a title and an image to arrange and
//! nothing else, so every skin arranged a title and an image.
//!
//! ```text
//! description=Dr. Eggman has stolen the Chaos Emeralds.
//! genre=Platformer
//! publisher=Sega
//! year=1991
//! screenshot=shots/green-hill.jpg
//! screenshot=shots/marble.jpg
//! ```
//!
//! # Why this is its own module
//!
//! Because `screenshot=` repeats, and the two parsers in [`crate::cartridge`]
//! both collapse a section into a `HashMap`, where the last line of a repeated
//! key wins. Rather than change what those return — every caller of theirs
//! wants one value per key — the descriptive layer scans the text itself, the
//! same way [`crate::saves`] does for its own repeated `save=` lines.
//!
//! # Every field is optional and every field is capped
//!
//! A cartridge is a volume somebody else may have written, so none of this is
//! trusted to be sensible. A description of four megabytes, a genre containing
//! a page of text, forty screenshots: each is refused by being cut down rather
//! than by refusing the cartridge, because a cartridge that will not open is a
//! worse outcome than one that opens with a shortened summary.
//!
//! The caps here are a safety bound, not a layout decision. **How much of a
//! description is visible is the skin's business** — the stock stylesheet
//! clamps it to a few lines and a skin with a wider window can show more, which
//! is the same division of labour as everything else here.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

/// How many screenshots a cartridge may carry per game.
///
/// Four, because that is what a row of thumbnails holds at the window sizes
/// skins actually use, and because each one is base64'd into the window: the
/// cost of this is paid in the webview's memory, not on the drive.
pub const MAX_SCREENSHOTS: usize = 4;

/// Largest screenshot that will be inlined.
///
/// Smaller than a cover's eight, and deliberately: a cover is the thing the
/// window is mostly made of, a screenshot is a thumbnail. Four of these is
/// already eight megabytes of base64 in the page.
pub const MAX_SCREENSHOT_BYTES: u64 = 2 * 1024 * 1024;

/// Longest description kept, in characters.
///
/// Generous on purpose. This is the bound that stops a cartridge putting a
/// novel in the DOM; it is not the bound that decides what fits on screen.
pub const MAX_DESCRIPTION_CHARS: usize = 600;

/// Longest single-line field kept, in characters. Genre, publisher and year are
/// each a few words at most.
pub const MAX_FIELD_CHARS: usize = 120;

/// The descriptive fields, resolved against a cartridge.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub description: String,
    pub genre: String,
    pub publisher: String,
    pub year: String,
    /// Inlined, in the order the cartridge listed them.
    pub screenshots: Vec<String>,
    /// Where each came from, for the details sheet and for diagnosis.
    pub screenshot_paths: Vec<String>,
    /// `Sega · Platformer · 1991`, prebuilt.
    ///
    /// A field rather than something the window assembles, so that a skin
    /// restyling the line, a front-end printing it as text and a details sheet
    /// listing it cannot disagree about the order or the separator.
    pub byline: String,
}

impl Meta {
    /// Whether this says anything at all.
    ///
    /// The window hides each element it has nothing for, so a cartridge written
    /// before any of this existed shows exactly what it showed before.
    pub fn is_empty(&self) -> bool {
        self.description.is_empty()
            && self.genre.is_empty()
            && self.publisher.is_empty()
            && self.year.is_empty()
            && self.screenshots.is_empty()
    }
}

/// The `Sega · Platformer · 1991` line, in that order, skipping what is missing.
fn join_byline(publisher: &str, genre: &str, year: &str) -> String {
    [publisher, genre, year]
        .iter()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Everything descriptive in a `cartridge.conf`.
///
/// Returns the general-or-collection section's fields, then one set per
/// `[game]` section in the order they appear — the same shape
/// [`crate::cartridge::parse_game_sections`] returns, so the two zip together.
pub fn read(root: &Path, conf: &str) -> (Meta, Vec<Meta>) {
    let (outer, per_game) = fields(conf);
    (
        resolve(root, &outer),
        per_game.iter().map(|raw| resolve(root, raw)).collect(),
    )
}

/// One section's worth of raw strings, before anything is read off the drive.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Raw {
    singles: HashMap<String, String>,
    screenshots: Vec<String>,
}

/// Scan the conf, keeping repeated `screenshot=` lines rather than collapsing
/// them.
///
/// `[collection]` and the flat single-game form both feed the outer set: a
/// cartridge that names one game says `description=` at the top level, and one
/// that names several says it inside `[collection]`, and neither should have to
/// know which section name the other uses.
fn fields(conf: &str) -> (Raw, Vec<Raw>) {
    let mut outer = Raw::default();
    let mut games: Vec<Raw> = Vec::new();
    let mut in_game = false;

    for raw_line in conf.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            if let Some(end) = line.find(']') {
                let section = line[1..end].trim().to_lowercase();
                in_game = section == "game";
                if in_game {
                    games.push(Raw::default());
                }
            }
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim().to_lowercase();
        let value = line[eq + 1..].trim();
        if value.is_empty() {
            continue;
        }

        // An unterminated `[game` never set `in_game`, so a stray line before
        // any section belongs to the outer set. `games.last_mut()` returning
        // None cannot happen while `in_game` is true, but falling back rather
        // than unwrapping costs nothing.
        let target = match in_game {
            true => games.last_mut().unwrap_or(&mut outer),
            false => &mut outer,
        };

        match key.as_str() {
            "screenshot" => {
                if target.screenshots.len() < MAX_SCREENSHOTS {
                    target.screenshots.push(value.to_string());
                }
            }
            "description" | "genre" | "publisher" | "year" => {
                target.singles.insert(key, value.to_string());
            }
            _ => {}
        }
    }

    (outer, games)
}

/// Turn one section's strings into a [`Meta`], reading the screenshots off the
/// drive.
fn resolve(root: &Path, raw: &Raw) -> Meta {
    let single = |key: &str, cap: usize| {
        raw.singles
            .get(key)
            .map(|value| clamp_words(value, cap))
            .unwrap_or_default()
    };

    let mut screenshots = Vec::new();
    let mut screenshot_paths = Vec::new();
    for rel in &raw.screenshots {
        // Not `resolve_cover`: that falls back to guessing at some image on the
        // drive when the path is unusable, which is right for the one cover a
        // cartridge must have and wrong here — a screenshot that is not there
        // is simply not there, and silently substituting the cover for it would
        // print the same picture four times.
        let Some(path) = crate::cartridge::join_within(root, rel) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() <= MAX_SCREENSHOT_BYTES => {}
            _ => continue,
        }
        let as_text = path.to_string_lossy().to_string();
        let data = crate::cartridge::cover_as_data_uri(&as_text);
        if data.is_empty() {
            continue;
        }
        screenshots.push(data);
        screenshot_paths.push(as_text);
    }

    let genre = single("genre", MAX_FIELD_CHARS);
    let publisher = single("publisher", MAX_FIELD_CHARS);
    let year = single("year", MAX_FIELD_CHARS);

    Meta {
        description: single("description", MAX_DESCRIPTION_CHARS),
        byline: join_byline(&publisher, &genre, &year),
        genre,
        publisher,
        year,
        screenshots,
        screenshot_paths,
    }
}

/// Cut text to a length, on a word boundary, with an ellipsis.
///
/// Counted in characters rather than bytes, so a description in Japanese is cut
/// where it looks cut rather than a quarter of the way in — and never inside a
/// character, which slicing a `&str` by byte would risk panicking on.
///
/// The break walks back to the last space so the result ends at a word. A
/// single word longer than the whole budget has no space to walk back to, and
/// is cut where the budget runs out rather than vanishing entirely.
fn clamp_words(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }

    let cut: String = text.chars().take(max).collect();
    let kept = match cut.rfind(char::is_whitespace) {
        // Only honour a word boundary that leaves most of the budget used;
        // otherwise a long word near the start would throw away the rest.
        Some(at) if at >= max / 2 => &cut[..at],
        _ => cut.as_str(),
    };
    format!("{}…", kept.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Scratch;

    #[test]
    fn a_cartridge_that_says_nothing_new_reads_as_empty() {
        // The whole backwards-compatibility promise in one assertion: every
        // cartridge written before this existed takes this path.
        let (outer, games) = read(Path::new("/nowhere"), "title=Sonic\nexecutable=x\n");
        assert!(outer.is_empty());
        assert!(games.is_empty());
    }

    #[test]
    fn the_flat_form_and_a_collection_both_reach_the_outer_set() {
        let flat = read(
            Path::new("/nowhere"),
            "description=A game.\ngenre=Platformer\n",
        )
        .0;
        assert_eq!(flat.description, "A game.");
        assert_eq!(flat.genre, "Platformer");

        let collection = read(
            Path::new("/nowhere"),
            "[collection]\ntitle=Two\ndescription=A pair.\n\n[game]\ntitle=One\n",
        )
        .0;
        assert_eq!(collection.description, "A pair.");
    }

    #[test]
    fn each_game_keeps_its_own_fields() {
        let conf = "[collection]\ntitle=Two\n\n\
                    [game]\ntitle=A\ngenre=Platformer\nyear=1991\n\n\
                    [game]\ntitle=B\ngenre=Shooter\nyear=1993\n";
        let (_, games) = read(Path::new("/nowhere"), conf);
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].genre, "Platformer");
        assert_eq!(games[0].year, "1991");
        assert_eq!(games[1].genre, "Shooter");
        assert_eq!(games[1].year, "1993");
    }

    #[test]
    fn a_games_fields_do_not_leak_into_the_collections() {
        let conf = "[collection]\ntitle=Two\n\n[game]\ntitle=A\npublisher=Sega\n";
        let (outer, games) = read(Path::new("/nowhere"), conf);
        assert_eq!(outer.publisher, "", "the collection said nothing");
        assert_eq!(games[0].publisher, "Sega");
    }

    #[test]
    fn the_byline_joins_what_is_there_and_skips_what_is_not() {
        assert_eq!(
            join_byline("Sega", "Platformer", "1991"),
            "Sega · Platformer · 1991"
        );
        // No stray separators around what a cartridge left out.
        assert_eq!(join_byline("", "Platformer", ""), "Platformer");
        assert_eq!(join_byline("Sega", "", "1991"), "Sega · 1991");
        assert_eq!(join_byline("", "", ""), "");
        assert_eq!(join_byline("  ", "Platformer", " "), "Platformer");
    }

    #[test]
    fn the_byline_is_built_when_the_cartridge_is_read() {
        let meta = read(
            Path::new("/nowhere"),
            "publisher=Sega\ngenre=Platformer\nyear=1991\n",
        )
        .0;
        assert_eq!(meta.byline, "Sega · Platformer · 1991");
    }

    #[test]
    fn screenshots_are_read_in_order_and_capped_at_four() {
        let scratch = Scratch::new("meta-shots");
        let mut conf = String::from("title=Sonic\n");
        for n in 1..=6 {
            scratch.write(&format!("shots/{n}.png"), b"\x89PNG-ish");
            conf.push_str(&format!("screenshot=shots/{n}.png\n"));
        }

        let meta = read(scratch.path(), &conf).0;
        assert_eq!(meta.screenshots.len(), MAX_SCREENSHOTS);
        assert_eq!(meta.screenshot_paths.len(), MAX_SCREENSHOTS);
        assert!(meta
            .screenshots
            .iter()
            .all(|s| s.starts_with("data:image/")));
        assert!(
            meta.screenshot_paths[0].ends_with("1.png"),
            "the order the cartridge gave them: {:?}",
            meta.screenshot_paths
        );
    }

    #[test]
    fn a_screenshot_that_is_not_there_is_skipped_rather_than_substituted() {
        // resolve_cover would fall back to *some* image on the drive here. That
        // is right for a cover and would print the cover four times in a
        // thumbnail row.
        let scratch = Scratch::new("meta-missing");
        scratch.write("cover.png", b"\x89PNG-ish");
        scratch.write("shots/real.png", b"\x89PNG-ish");
        let conf = "title=Sonic\nscreenshot=shots/gone.png\nscreenshot=shots/real.png\n";

        let meta = read(scratch.path(), conf).0;
        assert_eq!(meta.screenshots.len(), 1);
        assert!(meta.screenshot_paths[0].ends_with("real.png"));
    }

    #[test]
    fn a_screenshot_path_may_not_leave_the_drive() {
        let scratch = Scratch::new("meta-escape");
        let conf = "title=Sonic\n\
                    screenshot=../../secrets.png\n\
                    screenshot=/etc/passwd\n\
                    screenshot=C:\\Windows\\win.ini\n";
        assert!(read(scratch.path(), conf).0.screenshots.is_empty());
    }

    #[test]
    fn an_oversized_screenshot_is_left_out() {
        let scratch = Scratch::new("meta-big");
        scratch.write("huge.png", &vec![0u8; (MAX_SCREENSHOT_BYTES + 1) as usize]);
        scratch.write("small.png", b"\x89PNG-ish");
        let conf = "screenshot=huge.png\nscreenshot=small.png\n";

        let meta = read(scratch.path(), conf).0;
        assert_eq!(meta.screenshots.len(), 1);
        assert!(meta.screenshot_paths[0].ends_with("small.png"));
    }

    #[test]
    fn a_long_description_is_cut_at_a_word_with_an_ellipsis() {
        let long = "word ".repeat(400);
        let cut = clamp_words(&long, MAX_DESCRIPTION_CHARS);
        assert!(
            cut.chars().count() <= MAX_DESCRIPTION_CHARS + 1,
            "{}",
            cut.len()
        );
        assert!(cut.ends_with('…'));
        assert!(
            !cut.ends_with("wor…"),
            "cut mid-word: {}",
            &cut[cut.len().saturating_sub(12)..]
        );
    }

    #[test]
    fn a_description_that_fits_is_left_exactly_alone() {
        let text = "Dr. Eggman has stolen the Chaos Emeralds.";
        assert_eq!(clamp_words(text, MAX_DESCRIPTION_CHARS), text);
        assert!(!clamp_words(text, MAX_DESCRIPTION_CHARS).ends_with('…'));
    }

    #[test]
    fn cutting_never_lands_inside_a_character() {
        // Byte-slicing this would panic rather than truncate.
        let japanese = "ソニック・ザ・ヘッジホッグ".repeat(80);
        let cut = clamp_words(&japanese, 50);
        assert!(cut.chars().count() <= 51);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn one_enormous_word_is_still_cut_rather_than_dropped() {
        let cut = clamp_words(&"x".repeat(900), 100);
        assert_eq!(cut.chars().count(), 101);
        assert!(cut.starts_with("xxxx"));
    }

    #[test]
    fn an_empty_value_is_not_a_field() {
        let meta = read(Path::new("/nowhere"), "description=\ngenre=   \n").0;
        assert!(meta.is_empty(), "{meta:?}");
    }

    #[test]
    fn keys_are_case_insensitive_like_the_rest_of_the_format() {
        let meta = read(Path::new("/nowhere"), "Description=A game.\nYEAR=1991\n").0;
        assert_eq!(meta.description, "A game.");
        assert_eq!(meta.year, "1991");
    }

    #[test]
    fn comments_are_not_fields() {
        let meta = read(Path::new("/nowhere"), "# description=nope\n; genre=nope\n").0;
        assert!(meta.is_empty());
    }
}
