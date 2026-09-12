<div align="center">

<img src="docs/icon.png" width="96" alt="" />

# PC GamePak

**Turn removable storage into physical game cartridges.**
Plug one in and a launcher appears with the game's cover art and two buttons.

[![CI](https://github.com/HarryBMa/pc-gamepak/actions/workflows/ci.yml/badge.svg)](https://github.com/HarryBMa/pc-gamepak/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/HarryBMa/pc-gamepak)](https://github.com/HarryBMa/pc-gamepak/releases)
[![WinGet version](https://img.shields.io/winget/v/HarryBMa.PCGamePak)](https://github.com/microsoft/winget-pkgs)
[![Scoop version](https://img.shields.io/scoop/v/pc-gamepak?bucket=https%3A%2F%2Fgithub.com%2FHarryBMa%2Fscoop-bucket)](https://github.com/HarryBMa/scoop-bucket)
[![License](https://img.shields.io/github/license/HarryBMa/pc-gamepak)](LICENSE)
[![Support on Ko-Fi](https://img.shields.io/badge/Support-Ko--Fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/harrybma)

<br />

[![Windows Support](https://img.shields.io/badge/Windows-Supported-0078D4?logo=windows&logoColor=white)](#install)
[![Linux Support](https://img.shields.io/badge/Linux-Supported-FCC624?logo=linux&logoColor=black)](#install)
[![Steam Deck Support](https://img.shields.io/badge/Steam_Deck-Supported-1A9FFF?logo=steamdeck&logoColor=white)](#install)
[![Works offline](https://img.shields.io/badge/Works-offline-2e7d52)](docs/MANUAL.md)
[![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)](#build-from-source)
[![Tauri 2](https://img.shields.io/badge/Tauri_2-24C8B8?logo=tauri&logoColor=white)](#build-from-source)

<img width="560" alt="A cartridge going into a USB-C port and the launcher opening with it" src="docs/cartridge-demo.gif" />

</div>

---

A cartridge is a small drive in a pocketable enclosure with a game on it. Push it
into a USB-C port; the launcher opens showing what is on it. Press **Play** to
start the game, or **Eject** to power the drive down and pull it out.

Each cartridge is a drive with a `cartridge.conf` text file at its root. There
are no scripts to write and nothing to allowlist, because **nothing on a
cartridge is ever executed automatically** — pressing Play is the gate.

<div align="center">
<img width="380" alt="The launcher showing one game: cover art filling the window, the title over it, and a wide Play button beside an eject icon" src="docs/launcher.png" />
&nbsp;
<img width="380" alt="The launcher showing a collection: a rail of games down the window with the selected one's art behind" src="docs/launcher-bundle.png" />
</div>

## Features

- **Plug and it opens.** A background watcher notices the drive and shows the
  launcher. Nothing runs until you press Play — or, if you ask it to, the game
  starts on its own, a notification appears, or nothing happens at all. Even
  set to start the game, a program carried *on* the cartridge still waits for a
  click: a URI hands off to a launcher you already have, and a stranger's binary
  does not get the machine.
- **One game or a shelf of them.** A cartridge can carry a collection, with a
  rail to pick from.
- **Real eject.** The button parks the drive and powers it down, elevating only
  if the unprivileged path fails.
- **Controller and keyboard.** A pad navigates the list and works the buttons;
  so do the arrow keys, Enter, `E` and `I`.
- **Skinnable, by the cartridge.** A `.gamepak/skin.css` on the drive restyles
  the launcher — its size, layout, and which of the four artworks it shows in
  each place. Fifteen worked examples with screenshots in
  [docs/skins/](docs/skins/); [SKINNING.md](docs/SKINNING.md) is the reference.
- **Artwork from SteamGridDB**, optional and off until you add a key. Covers,
  heroes, logos and icons are written onto the cartridge, so it looks the same
  on a machine that has never heard of it.
- **Steam-aware.** A cartridge registers as a Steam library so copied games run
  from the drive rather than being redownloaded.
- **The cartridge counts its own hours.** Launches, playtime and last-played go
  on the drive, not on the PC, so the count follows the cartridge between
  machines.
- **Saves that travel too**, optional and off until you turn it on. A cartridge
  can say where its saves live — as `{appdata}/Foo/Saves`, resolved by whichever
  platform reads it — and insert and eject carry whichever copy changed. If both
  changed, neither is touched and the launcher says so; anything replaced is
  kept beside it. A game the cartridge *carries* needs none of that: one line
  gives it its whole home directory on the drive, and every save it writes goes
  there whether or not anyone knew where it would put them.
- **Not an NFC project.** If you want to tap a card, a toy or a QR code to
  launch a game, use [Zaparoo](https://zaparoo.org/) — it does that across nine
  platforms and this does not do it at all.
- **Works offline.** Nothing phones home. The only network call is the artwork
  lookup you asked for.

## Supported platforms

| | Status |
|---|---|
| Windows 10 / 11 | Supported |
| Linux (systemd + udev) | Supported |
| Steam Deck | Supported |
| macOS | Not yet — the drive layer needs a rewrite |

Any removable drive works: NVMe in a USB enclosure, a portable SSD, or a USB
stick. NTFS by default — it is the only one of the three that can hold the
symlinks Steam needs to install Proton onto a cartridge; exFAT when a Mac has to
write to the drive, btrfs for Linux-only cartridges.

## Install

**Windows** — [Scoop](https://scoop.sh), which is the one that works today:

```powershell
scoop bucket add harrybma https://github.com/HarryBMa/scoop-bucket
scoop install pc-gamepak
```

Scoop puts both binaries on your PATH but cannot register the watcher to start
at logon, so run the installer once to do that:

```powershell
powershell -ExecutionPolicy Bypass -File "$(scoop prefix pc-gamepak)\windows\install.ps1" -Mode Watcher
```

Or take the installer from
[Releases](https://github.com/HarryBMa/pc-gamepak/releases) and skip Scoop
entirely. A [WinGet](https://github.com/microsoft/winget-pkgs) package is in
review; once it lands, `winget install HarryBMa.PCGamePak` does the lot.

**Linux** — the pacman package is written and tested, and waiting on the AUR
reopening registrations. Building it by hand is a clone and a command:

```bash
git clone https://github.com/HarryBMa/pc-gamepak.git
cd pc-gamepak/packaging/aur/pc-gamepak && makepkg -si
systemctl --user enable --now pc-gamepak-watcher.service
```

There is a Flatpak too, for everything else and for the Steam Deck. Or clone and
run `sudo linux/install.sh`, or `linux/install-user.sh` for a rootless install
under `~/.local`.

**[Full instructions, and why automount decides whether any of it
works →](docs/INSTALL.md)**

## Usage

Run `pc-gamepak --create` to open the wizard: pick a game, pick a drive, and it
writes the cartridge — copying the files if you ask it to, fetching artwork, and
registering the drive with Steam.

Then plug the cartridge in. The launcher opens; press Play.

<div align="center">
<img width="560" alt="The cartridge wizard: a list of installed games on the left and the target drive on the right" src="docs/wizard.png" />
</div>

To write one by hand, put a `cartridge.conf` at the drive's root:

```ini
title=Stardew Valley
executable=steam://rungameid/413150
cover=cover.jpg
```

## Build from source

Needs [Rust](https://rustup.rs) and Node 18+. On Windows also the Visual Studio
Build Tools with "Desktop development with C++"; on Linux, `webkit2gtk` and
`libudev`.

```bash
git clone https://github.com/HarryBMa/pc-gamepak.git
cd pc-gamepak
cd tauri-ui && npm install && npm run build && cd ..

sudo linux/install.sh          # Linux
# Windows: right-click windows/install.ps1 → Run with PowerShell
```

`core/` holds every decision the launcher and wizard make, with no UI and no
Tauri, so `cd core && cargo test` covers the logic on any machine.

## More

[Installing on Linux](docs/INSTALL.md) · [The manual](docs/MANUAL.md) ·
[Writing a skin](docs/SKINNING.md) · [Other frontends](docs/FRONTENDS.md) ·
[Where the project is](docs/STATUS.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
