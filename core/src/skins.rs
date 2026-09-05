//! Which looks the launcher will wear, and the fact that a cartridge can only
//! choose between them.
//!
//! A skin is a stylesheet shipped inside the application. A cartridge names one
//! and gets it; it cannot supply one. That is the whole of the design, and the
//! restriction is the point rather than a shortcut.
//!
//! Everything else a cartridge provides is content the launcher puts *inside* a
//! frame it controls: a title goes through `textContent`, artwork is read here
//! and handed over as a `data:` URI, and nothing is executed. A stylesheet is a
//! different kind of thing. It cannot run code, but it can move, cover and
//! restyle anything on screen — including making Eject look like Play, or
//! putting a convincing false sentence where a real one was. A cartridge is a
//! removable drive somebody handed you, and letting one repaint the window that
//! is asking whether to trust it is a bad trade for a nicer background.
//!
//! So the name is looked up in this list, and an unknown one falls back to the
//! stock look rather than being loaded from the drive.

/// The skins that ship with the launcher.
///
/// `("name", "what it looks like")` — the description is what Settings shows,
/// so the list is the single place a new skin has to be added.
pub const SKINS: [(&str, &str); 5] = [
    ("default", "Dark, quiet, and out of the way of the artwork"),
    (
        "retro",
        "A beige CRT: scanlines, chunky buttons, orange and teal",
    ),
    (
        "neon",
        "A HUD: cut corners, hairline outlines, Eject as a wide bar",
    ),
    (
        "cozy",
        "Soft and warm: rounded frame, big pill Play, round Eject",
    ),
    (
        "terminal",
        "Amber phosphor: hard borders, scanlines, arcade buttons that travel",
    ),
];

/// The skin used when nothing has asked for one.
pub const DEFAULT: &str = "default";

/// The name if it is one we ship, otherwise the stock look.
///
/// Also the guard that keeps a cartridge from naming a path: the value is only
/// ever compared against this list, never joined onto a directory, so
/// `../../something.css` matches nothing and becomes `default` like any other
/// unknown word.
pub fn resolve(name: &str) -> &'static str {
    let wanted = name.trim().to_ascii_lowercase();
    SKINS
        .iter()
        .find(|(skin, _)| *skin == wanted)
        .map(|(skin, _)| *skin)
        .unwrap_or(DEFAULT)
}

/// Every skin, for the Settings list.
pub fn all() -> Vec<(String, String)> {
    SKINS
        .iter()
        .map(|(name, description)| (name.to_string(), description.to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_name_is_kept_however_it_was_typed() {
        assert_eq!(resolve("retro"), "retro");
        assert_eq!(resolve("  RETRO "), "retro");
        assert_eq!(resolve("Default"), "default");
    }

    #[test]
    fn anything_else_is_the_stock_look() {
        assert_eq!(resolve(""), "default");
        assert_eq!(resolve("nonsense"), "default");

        // The reason this is a list and not a filename. A cartridge is a drive
        // somebody handed you, and the one thing it must not be able to do is
        // point the launcher at a stylesheet it brought with it.
        assert_eq!(resolve("../../evil"), "default");
        assert_eq!(resolve("/etc/passwd"), "default");
        assert_eq!(resolve("http://example.com/x.css"), "default");
        assert_eq!(resolve("retro.css"), "default");
    }

    #[test]
    fn every_skin_ships_a_stylesheet_to_go_with_it() {
        // The list is the whole contract: a name here that has no file beside
        // it resolves fine and then loads nothing, which looks exactly like a
        // skin that did not work.
        for (name, _) in SKINS {
            if name == DEFAULT {
                continue; // The stock look is style.css, which is always loaded.
            }
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../tauri-ui/app/skins")
                .join(format!("{name}.css"));
            assert!(
                path.is_file(),
                "{name} has no stylesheet at {}",
                path.display()
            );
        }
    }

    #[test]
    fn every_stylesheet_has_a_name_in_the_list() {
        // The other direction, and the one that actually went wrong: a
        // stylesheet nobody can ask for. It sits in the folder looking like a
        // skin, is never offered in Settings, and cannot be named by a
        // cartridge, so the only way to find out is to go looking for it.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tauri-ui/app/skins");
        for entry in std::fs::read_dir(&dir).expect("the skins folder").flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(stem) = name.strip_suffix(".css") else {
                continue;
            };
            assert!(
                SKINS.iter().any(|(skin, _)| *skin == stem),
                "{name} is not in SKINS, so nothing can ever load it"
            );
        }
    }

    #[test]
    fn the_stock_look_is_one_of_the_skins() {
        assert!(SKINS.iter().any(|(name, _)| *name == DEFAULT));
        assert_eq!(all().len(), SKINS.len());
    }
}
