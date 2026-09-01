//! Build a cartridge from a JSON `CartridgeRequest`, with no wizard.
//!
//! The wizard is the only way to make a cartridge, which is fine for one and
//! tedious for eleven. This runs the same `create::create_cartridge` the
//! wizard's Tauri command runs, against a request read from a file, so a batch
//! of cartridges is a batch of JSON files rather than an evening of clicking.
//!
//!     build-cart plan  cart.json     what formatting would destroy, then stop
//!     build-cart build cart.json     do it
//!
//! `plan` is the default: building is opt-in because formatting is not undoable.

use std::io::Write;

use gamepak_core::create;

fn main() {
    let mut args = std::env::args().skip(1);
    let mut args = {
        // `drives` and `games` take no request file: they report what the
        // wizard would have to choose from, which is the fastest way to see
        // why something is missing from it.
        let peeked: Vec<String> = args.by_ref().collect();
        match peeked.first().map(String::as_str) {
            Some("drives") => {
                for drive in create::target_drives() {
                    println!("{}", serde_json::to_string(&drive).unwrap());
                }
                return;
            }
            Some("games") => {
                match create::list_games(None) {
                    Ok(list) => {
                        for problem in &list.problems {
                            eprintln!("problem: {problem}");
                        }
                        println!("{} games", list.games.len());
                        for game in &list.games {
                            println!("{:?}\t{}\t{}", game.library, game.source, game.name);
                        }
                    }
                    Err(e) => eprintln!("{e}"),
                }
                return;
            }
            Some("query") => {
                for name in peeked.iter().skip(1) {
                    println!("{name}\t->\t{}", create::search_query_for(name));
                }
                return;
            }
            Some("cover") => {
                // Exercises the SteamGridDB fetch the wizard triggers when a
                // folder game with no local art is picked.
                match peeked.get(1) {
                    Some(path) => {
                        let art = create::game_cover(create::Library::Folder, path);
                        match art.split_once(',') {
                            Some((header, data)) => {
                                println!("{header} — {} bytes of base64", data.len())
                            }
                            None => println!("no cover"),
                        }
                    }
                    None => eprintln!("usage: build-cart cover <game folder path>"),
                }
                return;
            }
            _ => peeked.into_iter(),
        }
    };
    let (mode, path) = match (args.next(), args.next()) {
        (Some(mode), Some(path)) => (mode, path),
        (Some(path), None) => ("plan".to_string(), path),
        _ => {
            eprintln!("usage: build-cart [plan|build] <request.json>");
            std::process::exit(2);
        }
    };

    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("{path}: {e}");
            std::process::exit(1);
        }
    };
    let request: create::CartridgeRequest = match serde_json::from_str(&text) {
        Ok(request) => request,
        Err(e) => {
            eprintln!("{path}: {e}");
            std::process::exit(1);
        }
    };

    // What is on the drive now, named before anything touches it. Printed for
    // both modes: the point of `plan` is to read it, and the point of printing
    // it on `build` is that the log says what was overwritten.
    if request.format_drive {
        match create::format_plan(&request.drive_path) {
            Ok(plan) => println!("format plan: {}", serde_json::to_string(&plan).unwrap()),
            Err(e) => {
                eprintln!("cannot read {}: {e}", request.drive_path);
                std::process::exit(1);
            }
        }
    }

    if mode != "build" {
        println!("plan only; nothing written. Re-run with `build` to write it.");
        return;
    }

    let mut last = String::new();
    let result = create::create_cartridge(&request, &mut |progress| {
        // One line per step, plus a percentage that overwrites itself, so a
        // 100 GiB copy is watchable without scrolling a terminal off its buffer.
        if progress.step != last {
            println!();
            print!("{}: {}", progress.step, progress.message);
            last = progress.step.to_string();
        }
        if progress.total_bytes > 0 {
            print!(
                "\r{}: {} {:.1}%",
                progress.step,
                progress.message,
                progress.done_bytes as f64 / progress.total_bytes as f64 * 100.0
            );
        }
        let _ = std::io::stdout().flush();
    });
    println!();

    match result {
        Ok(result) => {
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
            // A cartridge that failed its own integrity check is not a
            // cartridge. The library reports this as a warning and still
            // returns the built result, which is right for a wizard showing it
            // to someone — but a script that reads exit status alone would
            // record a good build, so it is an error here.
            if result.verified_ok == Some(false) {
                eprintln!("verification failed: the cartridge is not trustworthy");
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("failed: {e}");
            std::process::exit(1);
        }
    }
}
