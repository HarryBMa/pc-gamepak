# Publishing PC GamePak

## The constraint that decides everything

This is not a self-contained application. Installing it means installing
**system integration**:

| Platform | What goes where |
|---|---|
| Linux | a udev rule in `/usr/lib/udev/rules.d`, two systemd template units, three helpers in `/usr/local/bin` |
| Windows | two binaries under `%LOCALAPPDATA%`, plus a Task Scheduler logon task |

That is the whole feature. A cartridge opens its launcher **because** udev saw a
partition appear. Anything that cannot write those files, or cannot see the
device layer, ships a program that does nothing until the user installs the real
thing by hand.

So every channel below is judged on one question first: *can a package
installed this way actually watch for a drive?*

The wizard alone is a different matter — it is an ordinary desktop app and would
be fine in a sandbox. Splitting the two is possible, and worth considering later,
but shipping "PC GamePak" that cannot notice a cartridge would be a bait and
switch.

## Verdicts

### Yes — start here

| Channel | Why it fits | Effort |
|---|---|---|
| **GitHub Releases** | The source of truth every other channel points at. Tag `v0.1.0`, CI builds Linux and Windows artefacts with checksums. | Done — `.github/workflows/release.yml` |
| **AUR** (`pc-gamepak`) | Arch, CachyOS, Manjaro — and the Steam Deck crowd, who are the audience. Ships the rootless watcher as a systemd *user* service, because a package cannot bake a username into a system unit. | Low. `packaging/aur/pc-gamepak/` is written |
| **Flatpak / Flathub** | Verified on real hardware, see below — host mounts propagate into the sandbox and the watcher fires inside one. The way onto a Steam Deck, which ships Flatpak and no AUR. | Medium. `packaging/flatpak/` is written; needs vendored cargo sources for Flathub's offline build |
| **WinGet** | Built into Windows 11. The installer script does the logon task; the manifest just delivers the files. | Low, once a release exists |
| **Scoop** | User-space, no admin, popular with the same people who own a drawer of NVMe drives. `packaging/scoop/pc-gamepak.json` is written. | Low |

### Later, and only with a reason

| Channel | Verdict |
|---|---|
| **`.deb` artefact** | Cheap and useful: `cargo-deb` produces one, attach it to the release, `sudo dpkg -i` installs the binary and the units. Do this before standing up an APT repository — a repo is weeks of maintenance for the same result. |
| **Chocolatey** | Fine technically; first submission goes through human moderation and the package needs a maintained `.nuspec`. Worth it only once Windows users actually ask. |
| **AppImage** | Tauri already builds one. It covers the *launcher*, not the watcher or the udev rule, so it is a convenience for people who want the wizard without installing anything — not a way to ship the product. |

### No, for now

| Channel | Why not |
|---|---|
| **Snap** | The audience is the Steam Deck, and SteamOS ships Flatpak. snapd is not installed on Arch by default and has to be added by hand, so a Snap asks the exact people this is for to install a second package manager first. Classic confinement's manual review queue on top. Flatpak covers the same ground with none of that. |
| **Homebrew** | macOS is not a supported platform at all: no watcher, no installer, no icon set. On Linux, Homebrew installs into its own prefix and cannot place system units either. A tap would ship something that cannot work on the platform people would `brew install` it from. |
| **Native pacman repo** | Hosting a signed binary repository to serve what the AUR already serves from source. |

## What changed these answers

Every "no" above used to trace back to one root: the Linux side needed root to
install a udev rule. It no longer does.

`linux/install-user.sh` installs everything under `$HOME` and runs the watcher as
a **systemd user service**. The watcher blocks in `poll()` on
`/proc/self/mountinfo` — not on udev, which a sandbox cannot reach — and wakes
when the mount table changes. About 2 MB resident, no CPU while it waits.

The system install stays the recommendation, because zero is a better number than
two megabytes. But the rootless one is what a package format can actually
install, which is what puts Flatpak back on the table.

That was the last theoretical objection, and it has now been measured rather
than reasoned about. See below.

## What Linux actually does, tested

Checked on CachyOS (KDE Plasma 6, Wayland) against a real 128 GB exFAT
cartridge — a ten-game Tomb Raider collection written by the Windows wizard.

| | Result |
|---|---|
| `cargo build --release` for all three crates | Builds clean, warnings only |
| `cargo test --release` in `core` | 218 pass |
| `verify-cart` over the whole cartridge | 107.43 GB read at 345 MB/s, `intact: every file matches the manifest` |
| Launcher on Wayland | Draws the collection, per-game art, Play and Eject |
| Wizard (`--create`) | Opens, and finds the cartridge: `20.4 GB free · exFAT · has a cartridge` |
| Rootless watcher | Detects arrival and removal, opens and closes the launcher, 2.4 MB resident |
| udev route (`install.sh`) | Fires and opens the launcher |

The cartridge written on Windows was read on Linux without conversion, which is
the claim the exFAT choice exists to make.

**The one thing that actually breaks it is automount.** The watcher waits on the
mount table and the udev helper waits for a mount point; neither can do anything
for a drive the desktop never mounts. KDE does not automount removable media
unless it is switched on, and the first plug-in of the test cartridge failed
exactly there:

```
==== 2026-09-05T18:13:49 cartridge detected: sda2 ====
no mount point appeared for /dev/sda2 after 30s; giving up
```

Nothing was wrong with the cartridge — it opened normally once mounted. So the
packaging says so out loud: `udiskie` is an optdepend, and the post-install
message names automount as the thing to check first. It is the Linux equivalent
of a Windows autorun policy, and it will be the top support question.

## Does a sandboxed watcher actually work?

The Flatpak question was whether a mount made on the host after the sandbox
started becomes visible inside it. Tested with bubblewrap 0.11.2 — the same
thing Flatpak runs — with `/run/media` bound, a private mount namespace and an
unprivileged user namespace, against the real cartridge:

```
[1..4]   sees mount     cartridge was mounted before the sandbox started
[5..11]  --             host unmounted it
[12..30] sees mount     host mounted it again, after the sandbox started
```

Propagation works in both directions, within the one-second granularity of the
poll. Then the same test with the real `pc-gamepak-watcher` binary inside the
sandbox rather than a shell loop:

```
watcher starting (mount table)
watching 16 mounted filesystems
cartridge removed: /run/media/playbox/TOMBRAIDERC
cartridge detected at /run/media/playbox/TOMBRAIDERC
launcher started, pid 3
```

So `poll()` on `/proc/self/mountinfo` receives its `POLLPRI` wakeups through
mount propagation, inside a namespace, with no udev and no root. That is the
whole mechanism the product depends on, working in the place it was assumed it
might not.

`steam://` is the other half, and the pieces are all present on a normal
desktop: the scheme resolves to a handler (`steam.desktop`),
`xdg-desktop-portal` and a backend are installed and running, and
`org.freedesktop.portal.OpenURI` answers on the session bus. A Flatpak's
`xdg-open` is a shim onto that portal, so the URI is handed to the host rather
than run in the sandbox. Worth confirming once packaged, since the portal may
ask the user to confirm the handler the first time.

The remaining Flatpak design question is not permissions but autostart: a
Flatpak gets no systemd user unit, so the watcher has to ask for background
autostart through `org.freedesktop.portal.Background` instead of being enabled
with `systemctl --user`.

## Order of work

1. **Tag `v1.0.0`.** Nothing below can start without artefacts to point at.
   `cargo build --release` is confirmed on Linux (above) and on Windows — CI
   covers `check`, not `build`.
2. **AUR `pc-gamepak`**, built from the release tarball with a real checksum.
   One package, under the plain name: the `-git` suffix is what the AUR
   reserves for a package that tracks a branch, and this one does not.
3. **Scoop**, in a personal bucket (`HarryBMa/scoop-bucket`). One JSON file, and
   `checkver`/`autoupdate` keep it current on their own.
4. **WinGet**, via `wingetcreate` for the first submission and the
   `winget-releaser` action thereafter.
5. **`.deb`** attached to releases via `cargo-deb`.
6. **Flatpak**, whose two open questions are now answered (below). What is
   left is mechanical: vendored cargo sources, so the build works with no
   network, and a Flathub submission. Snap is not planned.

## Before the first tag

- **Version numbers.** All three crates say `0.1.0`. Decide whether they move
  together (simplest, and what the packaging assumes) and set them from the tag.
- **Code signing on Windows.** Unsigned binaries mean a SmartScreen warning on
  every download, and it does not go away until the certificate builds
  reputation. Azure Trusted Signing is the cheap path; self-signing achieves
  nothing here. Not a blocker, but decide before the first release rather than
  re-issuing artefacts later.
- **A `LICENSE` in every artefact.** The release workflow copies it; the AUR
  package installs it.
- **A changelog.** `--generate-notes` produces one from commits for the first
  release; a hand-written `CHANGELOG.md` earns its keep from the second.
- **The release is created as a draft.** Look at it, then publish — a tag is
  cheap to delete before anyone has downloaded it, and expensive afterwards.
