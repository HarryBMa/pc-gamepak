//! The one watcher setting that matters while no window is open.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnInsert {
    None,
    FocusUi,
    AutoLaunchGame,
    NotifyOnly,
}

impl Default for OnInsert {
    fn default() -> Self {
        Self::FocusUi
    }
}

impl OnInsert {
    fn from_settings_value(value: &str) -> Option<Self> {
        match value {
            "none" => Some(Self::None),
            "focus_ui" => Some(Self::FocusUi),
            "auto_launch_game" => Some(Self::AutoLaunchGame),
            "notify_only" => Some(Self::NotifyOnly),
            _ => None,
        }
    }
}

pub fn on_insert() -> OnInsert {
    let Ok(text) = std::fs::read_to_string(settings_path()) else {
        return OnInsert::default();
    };
    read_json_string(&text, "onCartridgeInsert")
        .as_deref()
        .and_then(OnInsert::from_settings_value)
        .unwrap_or_default()
}

fn settings_path() -> PathBuf {
    if let Ok(dir) = std::env::var("PC_GAMEPAK_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("settings.json");
        }
    }

    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.trim().is_empty() {
                return PathBuf::from(local).join("PC-GamePak").join("settings.json");
            }
        }
        PathBuf::from("settings.json")
    }

    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("state")
            .join("pc-gamepak")
            .join("settings.json")
    }
}

fn read_json_string(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = text.find(&needle)? + needle.len();
    let after_key = text.get(start..)?;
    let colon = after_key.find(':')?;
    let mut chars = after_key[colon + 1..].chars();

    while matches!(chars.clone().next(), Some(c) if c.is_whitespace()) {
        chars.next();
    }
    if chars.next()? != '"' {
        return None;
    }

    let mut out = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            out.push(match ch {
                '"' => '"',
                '\\' => '\\',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return Some(out),
            other => out.push(other),
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_settings_keep_the_existing_insert_behaviour() {
        assert_eq!(OnInsert::default(), OnInsert::FocusUi);
    }

    #[test]
    fn reads_the_insert_setting_from_json() {
        let text = r#"{
          "steamgriddbEnabled": false,
          "onCartridgeInsert": "auto_launch_game"
        }"#;
        assert_eq!(
            read_json_string(text, "onCartridgeInsert").as_deref(),
            Some("auto_launch_game")
        );
        assert_eq!(
            read_json_string(text, "onCartridgeInsert")
                .as_deref()
                .and_then(OnInsert::from_settings_value),
            Some(OnInsert::AutoLaunchGame)
        );
    }

    #[test]
    fn ignores_unknown_insert_modes() {
        assert_eq!(OnInsert::from_settings_value("surprise"), None);
    }
}
