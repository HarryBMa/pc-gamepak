# Two launchers: Tauri and Iced

PC GamePak currently has two launcher front-ends on one core:

1. **Tauri** (`tauri-ui/`): the shipping launcher and the wizard. Plain
   HTML/CSS/JS in a WebView, with a Rust shell. This is where layout, artwork,
   motion and skins are tried out, because a CSS change is a reload.
2. **Iced** (`iced-ui/`): an experiment. A native Rust window, used to find out
   whether a native launcher is the better long-term answer. It has a fixed,
   plain look on purpose: the question is architecture, not skinning.

Both are thin shells over `gamepak-core`, which has no UI dependency at all.
Nothing a cartridge *means* is decided in either front-end.

```text
                   gamepak-core  (no Tauri, no Iced)
     cartridge · launch · eject · saves · shaders · stats · busy · settings
                 │                                   │
        tauri-ui (WebView)                    iced-ui (native)
                 ▲                                   ▲
                 └──── pc-gamepak-watcher opens one ─┘
                        with --drive <path>
```

## Running them

```bash
# Tauri, as before
cd tauri-ui && npm run dev                  # or: npm run build

# Iced
cargo run  --manifest-path iced-ui/Cargo.toml -- --drive E:\
cargo build --manifest-path iced-ui/Cargo.toml --release
#   → iced-ui/target/release/pc-gamepak-iced
```

To have the **watcher** open Iced instead of Tauri on insert, point
`PC_GAMEPAK_LAUNCHER` at the Iced executable in the watcher's environment (a
user environment variable, then restart the watcher). That is the watcher's
existing override; nothing else changes.

In the Iced window: arrows or d-pad choose, Enter / A plays, E / X ejects,
Esc / B backs out or closes, 1–9 picks a game, F12 / Y toggles the debug panel,
R / F5 re-reads the cartridge.

## What moved to make this possible

Before this, three things every launcher needs lived inside the Tauri binary,
so a second front-end could only have copied them. They moved to core, with
the Tauri commands now calling through unchanged:

| Now in core | Was in | What it is |
|---|---|---|
| `launch::start` | `launch_game`, `open_uri` | Start a cartridge's game: hand a URI to Steam/Playnite/…, or run a carried program with its portable home |
| `eject::eject`, `eject::run_elevated` | `unmount` → `eject_windows` / `eject_linux` and ~550 lines of PnP/elevation | Take the volume away and power it down |
| `eject::settle` | inline in `unmount` | Push saves and shader caches back before the volume goes |

The elevated retry on Windows re-runs *the current executable* with
`--eject <letter>`, so each front-end hands that argument to
`eject::run_elevated` before building a window. Both do.

## What is shared, adapted, and front-end specific

**Shared (core, called directly by both):** reading the cartridge
(`cartridge::read_cartridge_info`, covers, collections), launching, the
Steam/Playnite/Heroic/Lutris hand-off (URIs), carried games and their portable
home, the "still in use" check and force-close (`busy`), save sync on insert and
eject, shader caches, the eject itself, settings, play stats (reading).

**Adapted per front-end (small, on purpose):** where blocking core work runs
(Tauri: `spawn_blocking`; Iced: a thread and a oneshot), how "still in use" is
asked (Tauri: a native dialog; Iced: inline "Force quit and eject / Keep
mounted"), debug logging.

**Still Tauri-only:**
- **Playtime counting.** Sessions are timed by a tracker thread owned by the
  Tauri process (`count_the_launch`, `track`, `finish`). Iced reads and shows
  the hours but does not count new ones. Moving the tracker to core is the next
  step if Iced continues.
- **Insert reactions** (`on_cartridge_insert`: start the game, notify only, do
  nothing), and honouring `frontends.launcher = false`.
- The memory card view, unboxing, skins, the details sheet, cartridge health.
- The wizard (Iced has none, and there is no plan for one yet).

**Iced-only:** the window checks its own drive root once a second and shows "The
cartridge was removed", reloading when it returns. That is not a second watcher:
the watcher still closes whichever launcher it opened when its drive goes; this
covers an Iced window started by hand.

**Integrations.** Decky and the (unwritten) Playnite plugin are separate
processes that read `settings.json`; they never talked to the Tauri front-end
and do not talk to Iced, so they are unaffected by which launcher runs.

## Parity checklist

Checked by running both on Windows 11 on 2026-09-29, against a real three-game
collection cartridge (`D:\`) and a scratch folder cartridge. "Not tested" means
exactly that; nothing is ticked because it compiles.

| | Tauri | Iced | Notes |
|---|---|---|---|
| Opened on insert by the watcher | ✅ | ⬜ not tested | Iced needs `PC_GAMEPAK_LAUNCHER` set |
| Detect removal | ✅ watcher closes it | ✅ | Iced: renamed folder → "cartridge was removed" |
| Recover after reconnect | ✅ watcher reopens | ✅ | Iced reloaded when the folder came back |
| Read contents / discover games | ✅ | ✅ | same core call |
| Display metadata (cover, title, launches) | ✅ | ✅ | |
| Select game | ✅ | ✅ | keyboard verified |
| Launch game | ✅ | ⬜ not pressed | would start a real game; same `launch::start` |
| Failed launch handled | ✅ | ✅ | missing executable → error line, no crash |
| Eject | ✅ | ⬜ not pressed | same `eject::settle` + `eject::eject` |
| Save sync on insert | ✅ | ✅ | three saves reported in step |
| Mouse | ✅ | ✅ | |
| Keyboard | ✅ | ✅ | Down + F12 sent and seen |
| Controller | ✅ | ⬜ partly | gilrs found a pad; no button presses made |
| Steam / Playnite hand-off | ✅ | ⬜ | same URI code; not launched |
| Decky | n/a | n/a | separate plugin, reads settings |
| Windows build | ✅ | ✅ | |
| Linux build | ✅ (CI) | ⬜ | Iced not in CI yet |
| macOS build | ⬜ | ⬜ | no macOS support in either |

## Comparison

Measured on the same machine, same cartridge, release builds, window on screen
four seconds.

| Capability | Tauri | Iced |
|---|---|---|
| GamePak detection | watcher → `--drive` | same, via `PC_GAMEPAK_LAUNCHER` |
| Filesystem watcher | separate watcher process | same process; plus a 1 s self-check |
| Game discovery | core | core |
| Launching | core (`launch::start`) | core (`launch::start`) |
| Steam / Playnite | URI hand-off in core | same |
| Decky | independent plugin | independent plugin |
| Keyboard | full, with shortcuts shown | full |
| Controller | Gamepad API in the WebView | gilrs |
| Windows | shipping | builds and runs |
| Linux | shipping | not built yet |
| macOS | unsupported | unsupported |
| Window on screen | ~0.9 s | ~0.6 s |
| Memory (private) | ~276 MB across 7 processes (6 MB app + WebView2) | ~241 MB in 1 process |
| Binary | 8 MB (plus the system WebView) | 13 MB |
| Core coupling | thin shell over core | thin shell over core |
| Development speed (UI) | fast: CSS reloads, skins, animation | slow: rebuild per change, no skin system |

## What this shows so far

- The boundary works: with launch and eject moved, the Iced launcher is ~700
  lines and contains no cartridge logic. The same moves also made Tauri's own
  backend 550 lines shorter.
- Iced starts faster and is one process, but it is **not** much lighter as
  built: most of its 241 MB is the GPU renderer (wgpu). Trying Iced's
  software renderer (tiny-skia) is the obvious next measurement.
- What Iced cannot do today is what the launcher's personality is made of:
  cartridge skins, the unboxing, the memory card's 3D boxes. None of that has a
  path in Iced short of a data-driven skin format.
- Next steps if it continues: move the playtime tracker and insert reactions
  into core (both front-ends would then share them), put Iced in CI on Linux,
  and measure the software renderer.

Not decided here: whether to keep, replace or drop either front-end.
