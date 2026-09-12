# Changelog

What changed in each release, in the words someone deciding whether to upgrade
would want. The commit log has the detail; this has the consequences.

Versions follow [semantic versioning](https://semver.org/): the minor number
moves when a cartridge or a setting gains something, the patch number when
nothing about either changes.

Every version in the repository is checked to agree —
`node tools/check-versions.mjs` — because for three releases they did not.

## 1.1.0 — unreleased

The release where the cartridge stopped being only a way to carry a game and
started carrying everything around it: the saves, the hours, the compiled
shaders. And where the launcher stopped being the only place a cartridge can
open.

### The filesystem default changed to NTFS

exFAT held that place from the start and is the one filesystem that cannot hold
what a cartridge carries. No symlinks, so Steam cannot unpack Proton onto a
cartridge — it dies on the first of 1,892 of them, reporting `AppError_11`,
"Disk write error", which says nothing about why. No executable bit, so a
carried Linux game has to be a shell script. No permissions that survive a
replug.

**Existing cartridges are unaffected**: this changes what the wizard offers to
format a *new* drive as. exFAT is still one dropdown away — and so are five more
now: ext4, XFS, F2FS, HFS+ and APFS, for a cartridge that only ever meets one
kind of machine. The picker says what each costs at the point of choosing: which
desktops read it with nothing installed, whether Proton runs from it, its label
limit, and what would have to be installed first. One list, read from the code
that does the formatting, rather than a copy in the window that had already
drifted. A format this machine has no `mkfs` for is shown anyway, greyed, with
the package to install — so "why is btrfs missing?" has an answer on screen.

**If a Mac has to write to the drive, pick exFAT.** macOS reads NTFS and does
not write it, so an NTFS cartridge can be played from and copied off on a Mac
and cannot take a save back.

A side effect: cartridges are now named `God of War Ragnarok` rather than
truncated to eleven characters, because the volume label limit follows the
filesystem.

### Saves travel with the cartridge

Two mechanisms, and which one applies depends on whether the cartridge carries
the game or points at it.

- **`save=` lines** name where a game keeps its saves, as `{appdata}/Foo/Saves`
  — a role the host resolves, because the three platforms disagree about where
  saves go. Insert and eject copy whichever side changed. If both changed,
  **neither is touched** and the launcher says so; anything replaced is kept
  beside it, three deep.
- **`portable_home=yes`** gives a game the cartridge *carries* its whole home
  directory on the drive. Every save it writes lands there with nothing
  declared, nothing copied, and no conflict possible — there is only ever one
  copy.

Off until switched on, in Settings. It is the one thing here that writes to a
directory in your home on the say-so of a file on a drive.

### The cartridge counts its own hours

Launches, playtime and last-played go in `.gamepak/stats.json` on the drive, so
the count follows the cartridge between machines rather than staying on the PC
that happened to play it. The open session re-stamps itself once a minute, so a
crash or a pulled drive costs a minute rather than the session — and whichever
machine sees the cartridge next settles whatever the last one abandoned.

On by default: one small file, written to the drive you just pressed Play on.

### Compiled shaders, if the cartridge asks

`shader_cache=drive` carries Steam's per-game shader cache, which is what stops a
second machine stuttering through the first hour of a game the cartridge has
already played.

Per cartridge rather than a global setting, because it is a trade against the
drive's own speed: free on a fast NVMe cartridge, and a wait on a cheap stick.
Only whoever made the cartridge knows which it is.

### Where a cartridge opens is now a choice

The launcher is one front-end, not the only one. It ships with the project and is
on by default; everything else is a plugin, off until switched on. More than one
may be on at once.

- **PC GamePak launcher** — the cartridge's own window.
- **Steam Deck row** — cartridge games on the Steam home screen, through the
  [Decky plugin](https://github.com/HarryBMa/pc-gamepak-decky). Switch the
  launcher off on a Deck and no window appears over the top of it.
- **Playnite library** — named, and not built yet.

The whole contract between the launcher and a plugin is one boolean in
`settings.json`. No socket, no daemon, nothing to keep in step.

### And what the launcher does on insert

A new setting with four answers: open the window (the default, and what it has
always done), start the game, post a notification, or do nothing.

**Starting the game only ever starts a game your PC already has** — a
`steam://`-class URI. A program carried *on* the cartridge still waits for a
click, and so does a collection, which has no single game to mean. Nothing on a
cartridge runs without a click, and a setting left switched on is not consent to
run a stranger's binary.

`notify_only` is Linux-only so far and falls back to opening the window.

### Eject now says what is in the way

Before it takes the volume away, it asks the system who is using it and names
them: *"TombRaider.exe (4812) is running from the cartridge"*. Then two choices —
**Force quit and eject**, which asks each process to quit and waits five seconds
before killing anything, because a game asked to quit writes its save first; or
leave the drive mounted. If something survives being killed, the cartridge stays
mounted and says so.

On Linux this sees open files, memory-mapped files, working directories and
programs running from the drive, and counts the processes it was not allowed to
look at rather than implying the drive is idle. On Windows it sees programs
running from the volume.

### A cartridge can be checked against somebody else's

`build-cart` and `verify-cart` print a **digest**: one SHA-256 over every copied
file's path, length and checksum. Verifying answers "did these bytes survive";
the digest answers "is this the same cartridge somebody else built", which no
amount of local verifying can. Put it in a `build-cart` request as
`expectDigest` and the build fails if it does not match.

### Removed: NFC and tag support

About 1,200 lines of PC/SC reader and line-source code, gone.
[Zaparoo](https://zaparoo.org/) does tokens across nine platforms and does them
better, and a thinner version living inside a cartridge launcher was never going
to catch up. **A drive is the only doorbell now.** If you were using a tag to
launch a cartridge, use Zaparoo.

### Also

- The controller prompts follow the device in your hands rather than the device
  plugged in: pad icons appear on the first button press and the keycaps come
  back on the next keystroke. A controller left on the table no longer decides
  what somebody typing is shown.
- Flathub's actual requirements are documented and the manifest meets them.
- `tools/check-versions.mjs` checks that every one of the fourteen places the
  version is written agrees, and can move them all at once.

## 1.0.1 — 2026-09-06

Packaging only. The Flatpak build needed a tag that contained its own packaging,
and autostart moved to the Background portal instead of a systemd user unit,
because a Flatpak cannot enable one.

## 1.0.0 — 2026-09-05

The first release that built on both platforms. Until shortly before it, nothing
on Windows compiled at all: `gamepak-core` called the Win32 volume API without
depending on `windows-sys`, and CI only ran core on Linux, so the failure
surfaced three jobs later and looked like a launcher problem. Core is checked on
both operating systems now.

## 0.1.0 — 2026-09-01

The first tag, cut while the enclosure that corrupted two files was still being
diagnosed. What that diagnosis found is why `verify` is on by default: a bad USB
link does not merely fail a copy, it can damage a game already written and
already verified — and both faults on that machine turned out to be physical,
and neither was the drive.
