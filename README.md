<div align="center">

<img src="docs/icon.png" width="96" alt="" />

# PC GamePak

**Turn removable storage into physical game cartridges.**
Plug one in and a launcher appears with the game's cover art and two buttons.

[![CI](https://github.com/HarryBMa/pc-gamepak/actions/workflows/ci.yml/badge.svg)](https://github.com/HarryBMa/pc-gamepak/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/HarryBMa/pc-gamepak)](https://github.com/HarryBMa/pc-gamepak/releases)
[![AUR version](https://img.shields.io/aur/version/pc-gamepak)](https://aur.archlinux.org/packages/pc-gamepak)
[![WinGet version](https://img.shields.io/winget/v/HarryBMa.PCGamePak)](https://github.com/microsoft/winget-pkgs)
[![License](https://img.shields.io/github/license/HarryBMa/pc-gamepak)](LICENSE)
[![Support on Ko-Fi](https://img.shields.io/badge/Support-Ko--Fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/harrybma)

<br />

[![Windows Support](https://img.shields.io/badge/Windows-Supported-0078D4?logo=windows&logoColor=white)](#install)
[![Linux Support](https://img.shields.io/badge/Linux-Supported-FCC624?logo=linux&logoColor=black)](#install)
[![Steam Deck Support](https://img.shields.io/badge/Steam_Deck-Supported-1A9FFF?logo=steamdeck&logoColor=white)](#install)
[![Works offline](https://img.shields.io/badge/Works-offline-2e7d52)](docs/MANUAL.md#security)
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
  launcher. Nothing runs until you press Play.
- **One game or a shelf of them.** A cartridge can carry a collection, with a
  rail to pick from.
- **Real eject.** The button parks the drive and powers it down, elevating only
  if the unprivileged path fails.
- **Controller and keyboard.** A pad navigates the list and works the buttons;
  so do the arrow keys, Enter, `E` and `I`.
- **Skinnable, by the cartridge.** A `.gamepak/skin.css` on the drive restyles
  the launcher — its size, layout, and which of the four artworks it shows in
  each place. Eight worked examples in [docs/skins/](docs/skins/);
  [SKINNING.md](docs/SKINNING.md) is the reference.
- **Artwork from SteamGridDB**, optional and off until you add a key. Covers,
  heroes, logos and icons are written onto the cartridge, so it looks the same
  on a machine that has never heard of it.
- **Steam-aware.** A cartridge registers as a Steam library so copied games run
  from the drive rather than being redownloaded.
- **Tags instead of drives.** An NFC tag can stand in for a cartridge — see
  [NFC-Cartridge-Player](https://github.com/TheStockPot/NFC-Cartridge-Player).
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
stick. exFAT for cross-platform cartridges, btrfs for Linux-only ones.

## Install

**Windows** — [WinGet](https://github.com/microsoft/winget-pkgs), Scoop, or the
installer from [Releases](https://github.com/HarryBMa/pc-gamepak/releases):

```powershell
winget install HarryBMa.PCGamePak
```

**Arch / Steam Deck** — from the [AUR](https://aur.archlinux.org/packages/pc-gamepak):

```bash
paru -S pc-gamepak
```

**Other Linux** — clone and run `sudo linux/install.sh`, or
`linux/install-user.sh` for a rootless install under `~/.local`.

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

[The manual](docs/MANUAL.md) · [Writing a skin](docs/SKINNING.md) ·
[Where the project is](docs/STATUS.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
