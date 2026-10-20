//! The sleeve a cartridge slides into: the box art of a PC game, front, spines
//! and back, and the words printed on it.
//!
//! CoverForge (the PC GamePak fork's cartridge-sleeve template) designs and
//! prints the sleeve, and exports it for the cartridge as a *sleeve kit*: one
//! picture per face and a `sleeve.json` with the words. The wizard copies the
//! kit to `.gamepak/sleeve/`, and the TV launcher builds the box in 3D from the
//! faces and prints the words on its screens. Everything is optional: a
//! cartridge with no kit is drawn from its cover, and a kit with no blurb shows
//! no blurb rather than a made-up one.
//!
//! ```text
//! .gamepak/sleeve/sleeve.json
//! .gamepak/sleeve/front.png        71.5 × 101 mm
//! .gamepak/sleeve/back.png         71.5 × 101 mm
//! .gamepak/sleeve/spine.png        16 × 101 mm, the left side as the front faces you
//! .gamepak/sleeve/spine-right.png  16 × 101 mm
//! .gamepak/sleeve/box.png          optional: a rendered picture of the whole box
//! .gamepak/sleeve/front-foil.png   optional: where holo foil shows, in the alpha
//! ```
//!
//! ```json
//! {
//!   "format": "pc-gamepak-sleeve",
//!   "version": 1,
//!   "faces": { "front": "front.png", "back": "back.png",
//!              "spine": "spine.png", "spineRight": "spine-right.png", "box": "box.png" },
//!   "tagline": "Enemy Unknown · XCOM 2 · Chimera Squad",
//!   "headline": "THREE CAMPAIGNS.\nONE WAR FOR EARTH.",
//!   "blurb": "Earth has one line of defence, and you command it…",
//!   "features": "1 PLAYER · TURN-BASED STRATEGY · WINDOWS 10 / 11",
//!   "rating": "18",
//!   "descriptor": "Violence",
//!   "accent": "#6ed7ff",
//!   "legal": "…",
//!   "foil": { "style": "glitter", "front": "front-foil.png" }
//! }
//! ```
//!
//! The field names are CoverForge's `SleeveCopy`. A cartridge is not a trusted
//! input, so this reads only the files the kit names, only from its own folder,
//! only up to the sizes below, and checks every value it hands to the window.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cartridge::{cover_as_data_uri, MAX_COVER_BYTES};

/// The kit's folder, inside the cartridge's asset folder.
pub const DIR: &str = "sleeve";
/// The kit's description.
pub const FILE: &str = "sleeve.json";
/// What `format` says, so a stray `sleeve.json` from something else is ignored.
pub const FORMAT: &str = "pc-gamepak-sleeve";
/// The one version this reads. A later one is ignored rather than misread.
pub const VERSION: u32 = 1;
/// The description is words, not pictures.
const MAX_JSON_BYTES: u64 = 64 * 1024;
/// The longest any one text field may be, in characters. A blurb is a
/// paragraph; anything longer is not a box.
const MAX_TEXT_CHARS: usize = 1200;
/// The PEGI labels printed on PC boxes.
pub const RATINGS: [&str; 5] = ["3", "7", "12", "16", "18"];
/// CoverForge's holo foil looks. A kit naming another is shown as the first.
pub const FOIL_STYLES: [&str; 4] = ["pastel", "silver", "oil", "glitter"];

/// A cartridge's sleeve, ready for the window: faces as `data:` URIs, empty
/// where the kit has none, and the words checked.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sleeve {
    pub front: String,
    pub back: String,
    pub spine: String,
    pub spine_right: String,
    /// A rendered picture of the whole box, shown in place of the 3D one.
    pub box_render: String,
    pub tagline: String,
    pub headline: String,
    pub blurb: String,
    pub features: String,
    /// One of [`RATINGS`], or empty.
    pub rating: String,
    pub descriptor: String,
    /// `#rgb` or `#rrggbb`, or empty.
    pub accent: String,
    pub legal: String,
    /// Holo foil on the sleeve (a sticker, a logo), when the design has any.
    pub foil: Option<Foil>,
}

/// Where a sleeve's holo foil shows, face by face, and how it shimmers. Each
/// mask is a PNG `data:` URI, opaque where the foil is, or empty for a face
/// with none.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Foil {
    /// One of [`FOIL_STYLES`].
    pub style: String,
    pub front: String,
    pub back: String,
    pub spine: String,
    pub spine_right: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct KitFoil {
    style: Option<String>,
    front: Option<String>,
    back: Option<String>,
    spine: Option<String>,
    spine_right: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Kit {
    format: String,
    version: u32,
    #[serde(default)]
    faces: Faces,
    #[serde(default)]
    tagline: Option<String>,
    #[serde(default)]
    headline: Option<String>,
    #[serde(default)]
    blurb: Option<String>,
    #[serde(default)]
    features: Option<String>,
    #[serde(default)]
    rating: Option<String>,
    #[serde(default)]
    descriptor: Option<String>,
    #[serde(default)]
    accent: Option<String>,
    #[serde(default)]
    legal: Option<String>,
    #[serde(default)]
    foil: Option<KitFoil>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Faces {
    front: Option<String>,
    back: Option<String>,
    spine: Option<String>,
    spine_right: Option<String>,
    #[serde(rename = "box")]
    box_render: Option<String>,
}

/// The cartridge's sleeve, or `None` when it carries no kit (or one this
/// cannot read, which is treated the same: the box is drawn from the cover).
pub fn read(root: &Path) -> Option<Sleeve> {
    read_dir(&root.join(crate::create::ASSET_DIR).join(DIR))
}

/// The sleeve in a kit folder laid out as the cartridge keeps it.
fn read_dir(dir: &Path) -> Option<Sleeve> {
    let json = dir.join(FILE);
    let meta = std::fs::metadata(&json).ok()?;
    if !meta.is_file() || meta.len() > MAX_JSON_BYTES {
        return None;
    }
    let kit: Kit = serde_json::from_str(&std::fs::read_to_string(&json).ok()?).ok()?;
    if kit.format != FORMAT || kit.version != VERSION {
        return None;
    }
    let face = |name: &Option<String>| -> String {
        name.as_deref()
            .filter(|name| is_plain_image_name(name))
            .map(|name| dir.join(name))
            .filter(|path| {
                std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() <= MAX_COVER_BYTES)
            })
            .map(|path| cover_as_data_uri(&path.to_string_lossy()))
            .unwrap_or_default()
    };
    // A foil mask needs its alpha, so only a PNG is one.
    let mask = |name: &Option<String>| {
        let png = name
            .as_ref()
            .filter(|n| n.to_ascii_lowercase().ends_with(".png"));
        face(&png.cloned())
    };
    let foil = kit.foil.as_ref().map(|f| Foil {
        style: foil_style(f.style.as_deref()),
        front: mask(&f.front),
        back: mask(&f.back),
        spine: mask(&f.spine),
        spine_right: mask(&f.spine_right),
    });
    let foil = foil.filter(|f| {
        [&f.front, &f.back, &f.spine, &f.spine_right]
            .iter()
            .any(|m| !m.is_empty())
    });
    let sleeve = Sleeve {
        front: face(&kit.faces.front),
        back: face(&kit.faces.back),
        spine: face(&kit.faces.spine),
        spine_right: face(&kit.faces.spine_right),
        box_render: face(&kit.faces.box_render),
        tagline: text(kit.tagline),
        headline: text(kit.headline),
        blurb: text(kit.blurb),
        features: text(kit.features),
        rating: kit
            .rating
            .map(|r| r.trim().to_string())
            .filter(|r| RATINGS.contains(&r.as_str()))
            .unwrap_or_default(),
        descriptor: text(kit.descriptor),
        accent: kit
            .accent
            .map(|a| a.trim().to_ascii_lowercase())
            .filter(|a| is_hex_colour(a))
            .unwrap_or_default(),
        legal: text(kit.legal),
        foil,
    };
    (sleeve != Sleeve::default()).then_some(sleeve)
}

/// A face is named by a bare file name in the kit's own folder: no folders,
/// no `..`, nothing hidden, and a picture's extension.
fn is_plain_image_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        && [".png", ".jpg", ".jpeg", ".webp"]
            .iter()
            .any(|ext| lower.ends_with(ext))
}

/// The kit's foil style, or the first one for anything else.
fn foil_style(value: Option<&str>) -> String {
    let value = value.unwrap_or_default().trim().to_ascii_lowercase();
    if FOIL_STYLES.contains(&value.as_str()) {
        value
    } else {
        FOIL_STYLES[0].to_string()
    }
}

fn is_hex_colour(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// Words for the window: trimmed, line breaks kept (the headline's last line
/// is drawn in the accent), other control characters dropped, and cut to a
/// paragraph's length.
fn text(value: Option<String>) -> String {
    value
        .unwrap_or_default()
        .replace("\r\n", "\n")
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(MAX_TEXT_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// The largest kit file the wizard will import: five faces at the cover's
/// limit, as base64, and the words.
const MAX_KIT_BYTES: u64 = 10 * MAX_COVER_BYTES * 4 / 3 + MAX_JSON_BYTES;

/// Each face as it is written on the cartridge, without its extension.
const FACE_FILES: [&str; 5] = ["front", "back", "spine", "spine-right", "box"];

/// Puts the sleeve kit at `kit` on the cartridge at `root`, replacing any it
/// had, and returns the sleeve as the launcher will see it.
///
/// A kit comes two ways. CoverForge's export is one file: `sleeve.json` with
/// each face inlined as a `data:image/…;base64,` URI, so it travels as a
/// single download. An unpacked kit is the folder the format describes, with
/// faces named beside the JSON. Either way, every face must really be a PNG,
/// JPEG or WebP (by its first bytes, not its name), and the words are cleaned
/// the same way `read` cleans them.
///
/// The new kit is written to a folder of its own and swapped in at the end,
/// so a failed import leaves the cartridge's old sleeve as it was.
pub fn install(root: &Path, kit: &Path) -> Result<Sleeve, String> {
    let meta = std::fs::metadata(kit).map_err(|e| format!("Couldn't open the kit: {e}"))?;
    if !meta.is_file() {
        return Err("Pick the kit's sleeve.json file.".into());
    }
    if meta.len() > MAX_KIT_BYTES {
        return Err("That file is too big to be a sleeve kit.".into());
    }
    let raw = std::fs::read_to_string(kit).map_err(|e| format!("Couldn't read the kit: {e}"))?;
    let parsed: Kit =
        serde_json::from_str(&raw).map_err(|_| "That file isn't a sleeve kit.".to_string())?;
    if parsed.format != FORMAT {
        return Err("That file isn't a sleeve kit.".into());
    }
    if parsed.version != VERSION {
        return Err(format!(
            "This kit is version {}; this PC GamePak reads version {VERSION}.",
            parsed.version
        ));
    }

    let here = kit.parent().unwrap_or(Path::new("."));
    let wanted = [
        &parsed.faces.front,
        &parsed.faces.back,
        &parsed.faces.spine,
        &parsed.faces.spine_right,
        &parsed.faces.box_render,
    ];
    let mut faces: Vec<Option<(String, Vec<u8>)>> = Vec::new();
    for (stem, value) in FACE_FILES.iter().zip(wanted) {
        let Some(value) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
            faces.push(None);
            continue;
        };
        let bytes = face_bytes(here, value).map_err(|why| format!("The {stem} face {why}."))?;
        let ext = image_extension(&bytes)
            .ok_or_else(|| format!("The {stem} face isn't a PNG, JPEG or WebP picture."))?;
        faces.push(Some((format!("{stem}.{ext}"), bytes)));
    }

    // Foil masks, the same way, but only PNG: the mask is in its alpha.
    let kit_foil = parsed.foil.as_ref();
    let mut masks: Vec<Option<(String, Vec<u8>)>> = Vec::new();
    if let Some(f) = kit_foil {
        for (stem, value) in FACE_FILES
            .iter()
            .zip([&f.front, &f.back, &f.spine, &f.spine_right])
        {
            let Some(value) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
                masks.push(None);
                continue;
            };
            let bytes = face_bytes(here, value).map_err(|why| format!("The {stem} foil {why}."))?;
            if image_extension(&bytes) != Some("png") {
                return Err(format!("The {stem} foil isn't a PNG picture."));
            }
            masks.push(Some((format!("{stem}-foil.png"), bytes)));
        }
    }
    let mask_name = |i: usize| {
        masks
            .get(i)
            .and_then(|m| m.as_ref())
            .map(|(name, _)| name.clone())
    };
    let foil_json = masks.iter().any(Option::is_some).then(|| {
        serde_json::json!({
            "style": foil_style(kit_foil.and_then(|f| f.style.as_deref())),
            "front": mask_name(0), "back": mask_name(1),
            "spine": mask_name(2), "spineRight": mask_name(3),
        })
    });

    let name = |i: usize| faces[i].as_ref().map(|(name, _)| name.clone());
    let clean_text = |value: &Option<String>| Some(text(value.clone())).filter(|t| !t.is_empty());
    let description = serde_json::json!({
        "format": FORMAT,
        "version": VERSION,
        "faces": {
            "front": name(0), "back": name(1), "spine": name(2),
            "spineRight": name(3), "box": name(4),
        },
        "tagline": clean_text(&parsed.tagline),
        "headline": clean_text(&parsed.headline),
        "blurb": clean_text(&parsed.blurb),
        "features": clean_text(&parsed.features),
        "rating": parsed.rating.as_deref().map(str::trim).filter(|r| RATINGS.contains(r)),
        "descriptor": clean_text(&parsed.descriptor),
        "accent": parsed.accent.as_deref().map(|a| a.trim().to_ascii_lowercase()).filter(|a| is_hex_colour(a)),
        "legal": clean_text(&parsed.legal),
        "foil": foil_json,
    });

    let assets = root.join(crate::create::ASSET_DIR);
    let fresh = assets.join(format!("{DIR}.new"));
    let stale = assets.join(format!("{DIR}.old"));
    let live = assets.join(DIR);
    let _ = std::fs::remove_dir_all(&fresh);
    let _ = std::fs::remove_dir_all(&stale);
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(&fresh)?;
        for (name, bytes) in faces.iter().chain(&masks).flatten() {
            std::fs::write(fresh.join(name), bytes)?;
        }
        let json = serde_json::to_string_pretty(&description).map_err(std::io::Error::other)?;
        std::fs::write(fresh.join(FILE), json)
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_dir_all(&fresh);
        return Err(format!("Couldn't write the sleeve to the cartridge: {e}"));
    }
    // Checked before the swap, so a kit with nothing in it changes nothing.
    let Some(sleeve) = read_dir(&fresh) else {
        let _ = std::fs::remove_dir_all(&fresh);
        return Err("That kit has no faces and no words.".into());
    };
    if live.exists() {
        std::fs::rename(&live, &stale)
            .map_err(|e| format!("Couldn't replace the old sleeve: {e}"))?;
    }
    if let Err(e) = std::fs::rename(&fresh, &live) {
        let _ = std::fs::rename(&stale, &live);
        return Err(format!("Couldn't put the sleeve on the cartridge: {e}"));
    }
    let _ = std::fs::remove_dir_all(&stale);
    Ok(sleeve)
}

/// Takes the sleeve kit off the cartridge. The launcher draws the box from the
/// cover again.
pub fn remove(root: &Path) -> Result<(), String> {
    let live = root.join(crate::create::ASSET_DIR).join(DIR);
    match std::fs::remove_dir_all(&live) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't remove the sleeve: {e}")),
    }
}

/// A face's picture: inlined in the kit, or a file beside it.
fn face_bytes(here: &Path, value: &str) -> Result<Vec<u8>, &'static str> {
    if let Some(rest) = value.strip_prefix("data:") {
        let (kind, payload) = rest.split_once(',').ok_or("is not a picture")?;
        if !matches!(
            kind,
            "image/png;base64" | "image/jpeg;base64" | "image/webp;base64"
        ) {
            return Err("isn't a PNG, JPEG or WebP picture");
        }
        if payload.len() as u64 > MAX_COVER_BYTES * 4 / 3 + 4 {
            return Err("is bigger than 8 MB");
        }
        return base64_decode(payload).ok_or("is damaged");
    }
    if !is_plain_image_name(value) {
        return Err("must be a picture beside sleeve.json");
    }
    let path = here.join(value);
    let meta = std::fs::metadata(&path).map_err(|_| "is missing")?;
    if !meta.is_file() {
        return Err("is missing");
    }
    if meta.len() > MAX_COVER_BYTES {
        return Err("is bigger than 8 MB");
    }
    std::fs::read(&path).map_err(|_| "couldn't be read")
}

/// What a picture is by its first bytes, as the extension to save it under.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// Standard base64 (RFC 4648), padding optional, line breaks allowed. `None`
/// for anything else.
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let digits: Vec<u8> = input.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    let body = digits
        .strip_suffix(b"==")
        .or_else(|| digits.strip_suffix(b"="))
        .unwrap_or(&digits);
    if body.len() % 4 == 1 || (body.len() != digits.len() && !digits.len().is_multiple_of(4)) {
        return None;
    }
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    for chunk in body.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= value(c)? << (18 - 6 * i);
        }
        let bytes = acc.to_be_bytes();
        out.extend_from_slice(&bytes[1..chunk.len()]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Scratch;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    fn kit(scratch: &Scratch, json: &str) {
        scratch.write(".gamepak/sleeve/sleeve.json", json.as_bytes());
    }

    #[test]
    fn a_cartridge_without_a_kit_has_no_sleeve() {
        let scratch = Scratch::new("sleeve-none");
        assert_eq!(read(scratch.path()), None);
    }

    #[test]
    fn a_kit_gives_its_faces_and_words() {
        let scratch = Scratch::new("sleeve-full");
        scratch.write(".gamepak/sleeve/front.png", PNG);
        scratch.write(".gamepak/sleeve/spine.png", PNG);
        kit(
            &scratch,
            r##"{"format":"pc-gamepak-sleeve","version":1,
                "faces":{"front":"front.png","spine":"spine.png","back":"missing.png"},
                "tagline":"Enemy Unknown · XCOM 2","headline":"THREE CAMPAIGNS.\r\nONE WAR FOR EARTH.",
                "blurb":"  Earth has one line of defence.  ","rating":"18","descriptor":"Violence",
                "accent":"#6ED7FF"}"##,
        );
        let sleeve = read(scratch.path()).expect("a sleeve");
        assert!(sleeve.front.starts_with("data:image/png;base64,"));
        assert!(sleeve.spine.starts_with("data:image/png;base64,"));
        assert_eq!(
            sleeve.back, "",
            "a face the kit names but does not carry is absent"
        );
        assert_eq!(sleeve.headline, "THREE CAMPAIGNS.\nONE WAR FOR EARTH.");
        assert_eq!(sleeve.blurb, "Earth has one line of defence.");
        assert_eq!(sleeve.rating, "18");
        assert_eq!(sleeve.accent, "#6ed7ff");
        assert_eq!(sleeve.legal, "");
    }

    #[test]
    fn faces_are_read_only_from_the_kits_own_folder() {
        let scratch = Scratch::new("sleeve-escape");
        scratch.write(".gamepak/cover.png", PNG);
        scratch.write("secret.png", PNG);
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"X",
                "faces":{"front":"../cover.png","back":"../../secret.png","spine":"/etc/passwd.png",
                         "spineRight":".hidden.png","box":"box.exe"}}"#,
        );
        let sleeve = read(scratch.path()).expect("the words still count");
        assert_eq!(
            (
                sleeve.front,
                sleeve.back,
                sleeve.spine,
                sleeve.spine_right,
                sleeve.box_render
            ),
            Default::default()
        );
    }

    #[test]
    fn values_the_window_cannot_trust_are_dropped() {
        let scratch = Scratch::new("sleeve-values");
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"OK",
                "rating":"21","accent":"red; background:url(x)","tagline":"a\u0007b"}"#,
        );
        let sleeve = read(scratch.path()).unwrap();
        assert_eq!(sleeve.rating, "", "not a PEGI label");
        assert_eq!(sleeve.accent, "", "not a colour");
        assert_eq!(sleeve.tagline, "ab", "control characters go");
    }

    #[test]
    fn long_words_are_cut_to_a_paragraph() {
        let scratch = Scratch::new("sleeve-long");
        let blurb = "word ".repeat(1000);
        kit(
            &scratch,
            &format!(r#"{{"format":"pc-gamepak-sleeve","version":1,"blurb":"{blurb}"}}"#),
        );
        assert!(read(scratch.path()).unwrap().blurb.chars().count() <= MAX_TEXT_CHARS);
    }

    #[test]
    fn something_that_is_not_a_kit_is_ignored() {
        for (name, json) in [
            ("format", r#"{"format":"other","version":1,"headline":"X"}"#),
            (
                "version",
                r#"{"format":"pc-gamepak-sleeve","version":2,"headline":"X"}"#,
            ),
            ("broken", r#"{"format":"pc-gamepak-sleeve","#),
            ("empty", r#"{"format":"pc-gamepak-sleeve","version":1}"#),
        ] {
            let scratch = Scratch::new(&format!("sleeve-not-{name}"));
            kit(&scratch, json);
            assert_eq!(read(scratch.path()), None, "{name}");
        }
    }

    #[test]
    fn an_oversized_description_is_not_read() {
        let scratch = Scratch::new("sleeve-huge");
        let padding = " ".repeat(MAX_JSON_BYTES as usize);
        kit(
            &scratch,
            &format!(r#"{{"format":"pc-gamepak-sleeve","version":1,"headline":"X"}}{padding}"#),
        );
        assert_eq!(read(scratch.path()), None);
    }

    fn data_uri(kind: &str, bytes: &[u8]) -> String {
        format!(
            "data:image/{kind};base64,{}",
            crate::cartridge::base64_encode(bytes)
        )
    }

    #[test]
    fn base64_round_trips() {
        for len in 0..10 {
            let bytes: Vec<u8> = (0..len as u8).map(|b| b.wrapping_mul(37)).collect();
            let encoded = crate::cartridge::base64_encode(&bytes);
            assert_eq!(base64_decode(&encoded), Some(bytes.clone()), "{encoded}");
            assert_eq!(base64_decode(encoded.trim_end_matches('=')), Some(bytes));
        }
        assert_eq!(base64_decode("QUJD\nREVG"), Some(b"ABCDEF".to_vec()));
        assert_eq!(base64_decode("QUJ$"), None);
        assert_eq!(base64_decode("QUJDR"), None);
        assert_eq!(base64_decode("QQ="), None, "padding on an unfinished quad");
    }

    #[test]
    fn a_single_file_kit_is_unpacked_onto_the_cartridge() {
        let scratch = Scratch::new("sleeve-install-file");
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
        let json = format!(
            r##"{{"format":"pc-gamepak-sleeve","version":1,
                "faces":{{"front":"{}","back":"{}"}},
                "headline":"ONE\nTWO","rating":"16","accent":"#ABC","descriptor":"a\u0007b"}}"##,
            data_uri("png", PNG),
            data_uri("jpeg", &jpeg),
        );
        let kit = scratch.write("download/sleeve.json", json.as_bytes());
        let sleeve = install(scratch.path(), &kit).expect("installed");
        assert!(sleeve.front.starts_with("data:image/png;base64,"));
        assert!(sleeve.back.starts_with("data:image/jpeg;base64,"));
        assert_eq!(sleeve.headline, "ONE\nTWO");
        assert_eq!(
            (sleeve.rating.as_str(), sleeve.accent.as_str()),
            ("16", "#abc")
        );
        assert_eq!(sleeve.descriptor, "ab");
        let dir = scratch.path().join(".gamepak/sleeve");
        assert_eq!(std::fs::read(dir.join("back.jpg")).unwrap(), jpeg);
        assert_eq!(read(scratch.path()), Some(sleeve), "reads back the same");
        assert!(!scratch.path().join(".gamepak/sleeve.new").exists());
    }

    #[test]
    fn a_folder_kit_is_copied_and_replaces_the_old_one() {
        let scratch = Scratch::new("sleeve-install-folder");
        scratch.write(".gamepak/sleeve/front.png", PNG);
        scratch.write(".gamepak/sleeve/old-extra.png", PNG);
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"OLD","faces":{"front":"front.png"}}"#,
        );
        scratch.write("kit/spine.png", PNG);
        let json = scratch.write(
            "kit/sleeve.json",
            br#"{"format":"pc-gamepak-sleeve","version":1,"faces":{"spine":"spine.png"},"blurb":"New."}"#,
        );
        let sleeve = install(scratch.path(), &json).expect("installed");
        assert_eq!(sleeve.front, "", "the old kit is gone, not merged");
        assert!(sleeve.spine.starts_with("data:image/png"));
        assert_eq!(sleeve.blurb, "New.");
        assert!(!scratch
            .path()
            .join(".gamepak/sleeve/old-extra.png")
            .exists());
        assert!(!scratch.path().join(".gamepak/sleeve.old").exists());
    }

    #[test]
    fn a_bad_kit_leaves_the_old_sleeve_alone() {
        let scratch = Scratch::new("sleeve-install-bad");
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"KEEP ME"}"#,
        );
        scratch.write("secret.png", PNG);
        let not_a_picture = data_uri("png", b"MZ\x90\x00 not a png");
        for (name, json) in [
            ("format", r#"{"format":"other","version":1,"headline":"X"}"#.to_string()),
            ("version", r#"{"format":"pc-gamepak-sleeve","version":9,"headline":"X"}"#.to_string()),
            ("empty", r#"{"format":"pc-gamepak-sleeve","version":1}"#.to_string()),
            ("escape", r#"{"format":"pc-gamepak-sleeve","version":1,"faces":{"front":"../secret.png"}}"#.to_string()),
            ("missing", r#"{"format":"pc-gamepak-sleeve","version":1,"faces":{"front":"gone.png"}}"#.to_string()),
            ("magic", format!(r#"{{"format":"pc-gamepak-sleeve","version":1,"faces":{{"front":"{not_a_picture}"}}}}"#)),
            ("svg", r#"{"format":"pc-gamepak-sleeve","version":1,"faces":{"front":"data:image/svg+xml;base64,PHN2Zz4="}}"#.to_string()),
            ("damaged", r#"{"format":"pc-gamepak-sleeve","version":1,"faces":{"front":"data:image/png;base64,***"}}"#.to_string()),
        ] {
            let path = scratch.write(&format!("kits/{name}/sleeve.json"), json.as_bytes());
            assert!(install(scratch.path(), &path).is_err(), "{name}");
            assert_eq!(read(scratch.path()).unwrap().headline, "KEEP ME", "{name}");
        }
    }

    /// A PNG with an alpha channel's worth of header: enough for the checks.
    const MASK: &[u8] = b"\x89PNG\r\n\x1a\nmask";

    #[test]
    fn a_kits_foil_is_installed_and_read_back() {
        let scratch = Scratch::new("sleeve-foil");
        let json = format!(
            r#"{{"format":"pc-gamepak-sleeve","version":1,"faces":{{"front":"{}"}},
                "foil":{{"style":"Glitter","front":"{}"}}}}"#,
            data_uri("png", PNG),
            data_uri("png", MASK),
        );
        let kit = scratch.write("download/sleeve.json", json.as_bytes());
        let sleeve = install(scratch.path(), &kit).expect("installed");
        let foil = sleeve.foil.clone().expect("foil");
        assert_eq!(foil.style, "glitter");
        assert!(foil.front.starts_with("data:image/png;base64,"));
        assert_eq!((foil.back.as_str(), foil.spine.as_str()), ("", ""));
        assert!(scratch
            .path()
            .join(".gamepak/sleeve/front-foil.png")
            .exists());
        assert_eq!(read(scratch.path()), Some(sleeve));
    }

    #[test]
    fn foil_must_be_a_png_and_a_known_style() {
        let scratch = Scratch::new("sleeve-foil-bad");
        let json = format!(
            r#"{{"format":"pc-gamepak-sleeve","version":1,"headline":"X","foil":{{"front":"{}"}}}}"#,
            data_uri("jpeg", &[0xff, 0xd8, 0xff, 0xe0]),
        );
        let path = scratch.write("a/sleeve.json", json.as_bytes());
        assert!(
            install(scratch.path(), &path).is_err(),
            "a JPEG has no alpha to mask with"
        );

        scratch.write(".gamepak/sleeve/f.png", MASK);
        scratch.write(".gamepak/sleeve/f.jpg", PNG);
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"X","foil":{"style":"plaid","front":"f.png","back":"f.jpg"}}"#,
        );
        let foil = read(scratch.path()).unwrap().foil.unwrap();
        assert_eq!(foil.style, "pastel");
        assert!(!foil.front.is_empty());
        assert_eq!(foil.back, "", "only a .png is a mask");

        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"X","foil":{"style":"oil"}}"#,
        );
        assert_eq!(
            read(scratch.path()).unwrap().foil,
            None,
            "a style with no masks is no foil"
        );
    }

    #[test]
    fn removing_a_sleeve_is_safe_twice() {
        let scratch = Scratch::new("sleeve-remove");
        kit(
            &scratch,
            r#"{"format":"pc-gamepak-sleeve","version":1,"headline":"X"}"#,
        );
        remove(scratch.path()).unwrap();
        assert_eq!(read(scratch.path()), None);
        remove(scratch.path()).unwrap();
    }
}
