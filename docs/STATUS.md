# Where the project is

A working inventory: what exists, what it does, and what is missing. Kept in the
repository rather than in a chat log so it stays honest.

## What is built

### `core/` — `gamepak-core`, 292 tests

No Tauri, no UI, no display. That is the point: every decision the launcher and
the wizard make is testable on any machine, in CI, without a webview.

| Module | What it does |
|---|---|
| `cartridge` | Reads a cartridge: `cartridge.conf` (single game, or `[collection]` + `[game]` sections) and legacy `autorun.inf` for label and icon only. Inline INI parser, path confinement, cover inlined as a `data:` URI under an 8 MB cap. |
| `create` | The build pipeline: close Steam and drop its stale entry → format → copy → check the launch target → cover art → `cartridge.conf` → `autorun.inf` → trim and report. Game lists from Playnite and Steam, collection naming, per-game covers. |
| `edit` | Rewrites a cartridge's metadata — name, artwork, which games are listed and in what order — without copying or deleting anything. |
| `drives` | Which volumes may be written to — an allowlist of automount locations, never a denylist. Parses `/proc/mounts`; Win32 volume APIs on Windows. |
| `format` | exFAT and btrfs, behind four gates: removable allowlist re-derived here, not the system drive, the current label typed back exactly, and explicitly asked for. |
| `health` | Negotiated link speed, UASP vs BOT, how full the drive is, and the volume's own name and filesystem. sysfs on Linux; the transport only, lazily, on Windows. |
| `playnite` | Reads a Playnite JSON library export: one list covering Steam, GOG, Epic, Xbox, itch, emulators. Finds Playnite on Windows and through Proton prefixes on Linux. |
| `portable` | Ranks the executables in a copied game folder so Play points at the game rather than its uninstaller. |
| `settings` | What the user has switched on, stored beside the artwork cache. Everything defaults to off. |
| `saves` | Saves that travel with the cartridge. Reads `save=` lines whose paths are written as a `{token}` the host resolves — the three platforms disagree about where saves go — and reconciles the two copies against what *this machine* last saw of each, kept per host on the drive. Only the side that changed is copied; both changing is a conflict that writes nothing; whatever is about to be replaced is moved aside and kept. Symlink mode for people who want one copy rather than two. |
| `sgdb` | SteamGridDB artwork search, download and cache. Refuses every request until the user opts in and supplies a key. |
| `stats` | Launches, hours and last-played in `.gamepak/stats.json` on the drive, so the count follows the cartridge rather than the PC. The launch is written before the game starts and the open session re-stamps itself every sixty seconds, so a crash costs a minute rather than the session — and the machine that sees the cartridge next settles whatever the last one left open. No write here can fail a launch. |
| `steam` | Steam's own manifests: `libraryfolders.vdf`, `appmanifest_*.acf`, the library cache for covers. Hand-written KeyValues parser. |
| `steamlib` | Copies a Steam game onto a cartridge and registers the drive as a Steam library, so Steam plays from the cartridge. Also unregisters one, and asks a running Steam to shut down so those edits survive its exit. |
| `trim` | Tells the drive which blocks it no longer has to keep. Treats "this enclosure will not" as a fact, not a failure. |
| `tuning` | The Windows settings worth changing per cartridge, the commands they run, and their exact opposites. |
| `verify` | CRC-32, taken as each file is copied and checked by reading the cartridge back. Also a SHA-256 **cartridge digest** over the manifest — one value answering "is this the same cartridge somebody else built", which verifying against your own manifest cannot. Hand-written hash, checked against the published vectors and an independent implementation. **On by default** since it caught real corruption on the first cartridge ever checked on hardware. Leaves a manifest so the same check can be run later without the original; `verify-cart` is the command that does it. |
| `autorun` | Writes `autorun.inf` so Explorer shows the game's name and icon; builds a PNG-in-ICO when the cover allows it. |

### `tauri-ui/` — one binary, two windows

`pc-gamepak --drive <path>` is the popup; `pc-gamepak --create` is the wizard.
Exactly one window is ever built, so neither mode costs anything for the other.
44 commands, no command that takes a path to read.

The launcher counts what it starts and, if asked to, carries the saves. Both
are off the same principle: the cartridge is the thing that travels, so the
history and the save belong on it. Counting is on — it writes one file, to the
drive the user just pressed Play on. Syncing saves is **off** until switched on,
because it is the one thing here that writes to a directory in the user's home
on the say-so of a file on a drive.

**Launcher** — the artwork fills a 420 × 560 window, which is the slot the
cartridge is seated in: Eject rides the whole face out and leaves the slot
behind. Title, Play and an eject icon; everything else appears only under the
pointer. A collection grows a rail, and the one Play acts on whatever it has
selected, with `1`–`9` selecting and starting the *n*th. The accent colour is
sampled from the cover. A pad swaps the keycaps for face-button icons and gets a
focus ring that is always drawn. Details behind the ⓘ, leading with link and
free space and folding the paths away. Nothing on a cartridge runs without a
click.

**Wizard** — search your library, tick one game or several, pick the drive,
choose what goes on it, Write. Selection is always multiple: one ticked is a
cartridge, more is a multicartridge, and the second step for a name and a face
only exists for the latter. The third step groups the options by what they touch
and turns them into a numbered plan with a time estimate; the write itself
happens in the same window, as a log that ticks itself off. Formatting, copying,
artwork by file picker or SteamGridDB, per-cartridge Windows tuning.

### `watcher/` — both platforms, 6 tests

**Windows:** a hidden top-level window blocking on `WM_DEVICECHANGE`. No polling,
no timer, about 2 MB resident.

**Tags:** removed. A PC/SC reader and a line source used to be a second
doorbell here, about 1,200 lines of it. [Zaparoo](https://zaparoo.org/) does
tokens across nine platforms and does them better; a thinner version living
inside a cartridge launcher was not going to catch up, and it split the idea.
A drive is the only doorbell now.

**Linux:** blocks in `poll()` on `/proc/self/mountinfo`, which the kernel wakes on
any mount activity. Used only by the rootless install — the system install has
udev do this and keeps nothing resident. Deliberately does not link
`gamepak-core`: core pulls serde and ureq, which is fine for a launcher that runs
for ten seconds and not for a process that is resident all session.

### `linux/`, `windows/` — installers

udev rule plus two systemd template units on Linux; two binaries and a logon task
on Windows. Both installers uninstall cleanly, including names from before the
project was called PC GamePak.

### `core/src/bin/` — the wizard's job without the wizard

Two small commands over the same `gamepak-core`, for the cases a GUI is the
wrong shape. `build-cart plan|build <request.json>` builds a cartridge from a
JSON `CartridgeRequest`, so eleven cartridges are eleven files rather than an
evening of clicking; `plan` is the default because formatting is not undoable.
`verify-cart <root>` re-checks a cartridge against its manifest and touches
nothing.

### Everything else

CI on every push (core, watcher, launcher, frontend, shell), a release workflow
that builds both platforms from a tag, AUR and Scoop packaging, and
`docs/PUBLISHING.md` for what each channel can and cannot install.

## What is missing

Ranked by how much it matters.

1. **A tagged release.** Everything downstream — AUR, WinGet, Scoop — points at
   artefacts that do not exist yet. Nothing else on this list unblocks as much.
2. **Real hardware, partly answered — and the answer was not clean.** Two
   cartridges have now been written by this code on real drives:

   | Cartridge | Written | Verified |
   |---|---|---|
   | `TOMB RAIDER` — 10 games, 107.43 GB | 2026-08-31 | **2 files corrupt** |
   | `PLAYSTATION` — 3 games | 2026-09-01 | no manifest — cannot be checked |

   The Tomb Raider cartridge was read back on 2026-09-01 at 420 MB/s and two
   2 GB `.tiger` archives came back the right length with the wrong CRC-32.
   Repeated reads return the same bytes, so the corruption is on the drive, not
   in the read — the bytes never landed. Windows logged 19 `UASPStor` bus resets
   during that write and five more during the verify, on a Realtek RTL9210B-CG
   enclosure. `std::fs::copy` would have reported success for every byte of it.

   That is the case for `verify` existing, and it is why it is now on by
   default.

   **One path is now proven good, and one is still actively corrupting data.**

   On the AMD chipset port, `PLAYSTATION` was rewritten as a single-game Stardew
   Valley cartridge — format to exFAT, copy, register with Steam, verify — and
   the run logged no bus resets and no I/O retries at all. 3833 files, all
   matching; `verify-cart` agreed afterwards; the launcher opens on it. First
   clean end-to-end write this project has had. It also confirmed the new
   default: the request that built it never mentioned verifying and got it
   anyway.

   The Tomb Raider enclosure took longer to pin down. Its two corrupt archives
   were replaced from source and both verified — but the same pass found a third
   file corrupt that had been intact three hours earlier, with a `UASPStor` reset
   logged inside the window where that copy ran. Writing 4 GB had destroyed 2 GB
   of a file nothing was writing to.

   **That was the port, not the enclosure.** On a different port the same
   enclosure behaves. Both faults on this machine turned out to be physical and
   neither was the drive — which is worth remembering when a user reports that
   this tool corrupted their cartridge.

   The cost is on the record: `bigfile.005.tiger` on that cartridge is still
   corrupt, because repairing it meant another write through the port that broke
   it. A bad link does not merely fail a copy, it can damage a game already
   written and already verified.

   Still untested: a sustained write big enough to be interesting. The clean run
   was 0.75 GB and the corrupt one 107 GB, so the wizard's running panel — the
   throughput, the countdown, the log — still has not been watched through
   anything long.

   Related, and now fixed: until PR #10 nothing on Windows compiled at all —
   `gamepak-core` had no `windows-sys` dependency despite calling the Win32
   volume API, and two more crates were missing feature flags. CI ran core on
   Linux only, so the failure surfaced in the launcher job and looked like a
   launcher problem. Core is checked on both operating systems now.
3. **Version numbers.** Three crates all saying `0.1.0`, moved by hand.
4. **Adding a game to an existing cartridge** still means writing it again.
   Editing covers everything that does not move files; adding one does.
5. **Programming a tag from the wizard.** A virtual cartridge is a directory
   made by hand; the wizard has no step for it, and nothing writes NDEF onto the
   tag so that it would work on another PC.
6. **Verifying a cartridge you already have — half done.** `verify-cart <root>`
   reads `.gamepak/manifest.json`, re-reads every file it names and reports what
   does not match; it is read-only and exits non-zero when a cartridge is bad.
   That is the command. It still needs a button: nothing in the launcher or the
   wizard offers to check a cartridge that is sitting in front of you, which is
   where someone would actually look for it.
7. **Windows code signing.** Unsigned means SmartScreen on every download.
8. **macOS** is not supported at all — no watcher, no installer, no icons. The
   save-path tokens resolve for it (`~/Library/Application Support`,
   `~/Library/Preferences`), which is the only part of the platform that has
   been written.
9. **The `gamepak-linux.sh` / `gamepak-windows.ps1` menu wrappers.** The README
   pointed at both as the way to install, and neither has ever been in the
   repository — `linux/install.sh`, `linux/install-user.sh` and
   `windows/install.ps1` are the real entry points and the docs now say so. CI's
   `shell scripts` job still globs `./*.sh` expecting them, which is why that
   job is red on `main`: either write the wrappers, or narrow the glob to
   `linux/*.sh`.
10. **Saves and hours have never met a second machine.** The round trip is
   tested — play on A, carry to B, play, carry back — but in one process with
   two scratch directories standing in for two PCs, which is not the same as a
   Deck and a desktop disagreeing about a clock. The conflict path is the one
   to watch: it is meant to refuse, and a refusal nobody notices is a feature
   that quietly does nothing.
11. **The settings the design asks for that no command answers.** Per-source
   toggles with game counts, the artwork cache's size and an Empty button, a
   copy-speed default, and the launcher-on-the-cartridge options are all drawn
   in the design and absent here. The dialog is grouped the way the design asks
   and reports what was actually scanned instead of offering switches that would
   do nothing.

## What Kazeta settles, and what it does not

[Kazeta](https://github.com/kazetaos/kazeta) and
[kazeta-creator](https://github.com/kazetaos/kazeta-creator) (both MIT) are the
closest prior art there is, and reading them changes what is worth building
here. Recorded now rather than rediscovered later; the manual's *Thanks* section
credits them properly.

Kazeta is an operating system, not a program: an Arch image that boots greetd
into gamescope with no desktop, finds a `*.kzi` within two levels of `/media` or
`/run/media`, and shows a BIOS screen when there is no cart. That single fact —
**it owns the session** — is what lets it do three things this project cannot,
and the honest reading of each is different.

| | Kazeta | Here |
|---|---|---|
| Saves | The cart is an overlayfs lowerdir, a host directory the upperdir, the result is the game's `$HOME`. No save paths are known or needed. | `save=` lines declaring where each game keeps its saves, resolved per platform |
| Where saves live | On the host, moved to external "memory cards" as `<cart-id>.tar` | On the cartridge |
| Playtime | ISO-8601 start/end pairs in `.kazeta/var/playtime.log`, re-stamped every 60s | Launch count and seconds in `.gamepak/stats.json` |
| A cart | One immutable erofs image (`.kzp`) with a hash, or a directory | A directory with a text file in it |
| Runtimes | Proton as a `.kzr` image mounted *under* the game | Steam's own Proton, on the host |
| Reach | One OS, which you install instead of yours | Windows and Linux you already run |

**1. The overlay is better than declared save paths, where it is available.**
It cannot miss a path, needs no per-game knowledge, and captures a game that
writes somewhere nobody documented. `saves` is the weaker mechanism and it is
the weaker mechanism *on purpose*: a launcher that starts a game inside the
user's own desktop session cannot overlay that game's home directory, and on
Windows cannot do it at all. So the token vocabulary stays. What it does suggest
is a Linux-only path worth considering later — for games the cartridge carries
and this project launches itself, a bind or overlay mount would make the
declaration unnecessary. Not a commitment; a note that the ceiling here is lower
than it looked.

**2. Proton as a mounted image is the answer to the exFAT symlink problem.**
This project's own finding — Steam unpacking Proton onto a cartridge dies on the
first of 1892 symlinks, because exFAT has none — is a problem Kazeta does not
have, because a runtime never gets unpacked anywhere. Worth remembering before
building anything clever about shader caches or per-game Proton pinning.

**3. `kazeta-creator`'s recipe model is the best idea in either repository.**
`contentdb.yaml` holds recipes, not games: where to get the files, how to
unpack, what to run, which runtime, and the xxh3 hash the finished cart must
match. The community shares recipes, everyone builds a byte-identical cart, and
the same file is a compatibility list as a side effect.

**Half of this is now taken.** `build-cart` and `verify-cart` print a SHA-256
digest over the manifest, and a request can declare `expectDigest` and fail the
build when it does not match — so `verify-cart` now answers across machines, not
only against the manifest one write produced. What is *not* taken is the part
that makes Kazeta's version work: a shared file of recipes anybody can build
from. That is a community, not a feature, and this project has no claim on
having one.

**4. The playtime heartbeat, also taken.** Kazeta re-stamps `playtime_end` every
sixty seconds while a game runs, so a crash costs a minute. `stats` did not, and
"the launch survives, the hours do not" was written down here as honest
undercounting — which it was, and a minute is more honest for one small write a
minute. An open session now lives in `stats.json`, and whichever machine sees
the cartridge next settles whatever the last one abandoned.

**What none of this changes.** Kazeta replaces the operating system, so it cannot
be the thing you plug a cartridge into on a work laptop, a Windows gaming PC, or
a Mac — which is the whole premise here, and is not a premise Kazeta is competing
for. The formats are close enough to read each other (`.kzi` is `Key=value`
with `Name`, `Id`, `Exec`, `Icon`, `Runtime`, `GamescopeOptions`), so a
`.kzi` arm in `cartridge` would let a Kazeta cart open in this launcher, and a
`.kzi` written beside `cartridge.conf` would let one drive do both. Neither is
built and neither is decided.

## The rootless Linux install

Built. `linux/install-user.sh` puts everything under `$HOME` and runs the watcher
as a systemd user service; `linux/uninstall-user.sh` takes it back out. You pick
between this and the system install by which script you run — the `gamepak-*`
menu wrappers the README used to point at were never written.

| Install | Trigger | Resident | Needs root |
|---|---|---|---|
| **System** (AUR, `.deb`, `install.sh`) | udev rule | nothing | yes, once |
| **Rootless** (`install-user.sh`, and what a Flatpak would use) | mount-table watcher, systemd user service | one process, ~2 MB | no |

Both run the same launcher and the same detection rules; only the trigger
differs. The rootless one is arguably more accurate: it wakes when the cartridge
is mounted and readable, where udev fires when the kernel first sees the
partition and its helper then polls `findmnt` for up to sixty seconds waiting for
the desktop to catch up.

Verified on Linux with a loop-mounted image: insert opens the launcher, eject
closes that launcher and leaves any other cartridge's window alone, and a
re-insert after a genuine eject opens a new one rather than being debounced away.
Not yet verified on real removable hardware, or inside a Flatpak sandbox.
