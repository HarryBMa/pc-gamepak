# PC GamePak — the manual

Everything the [README](../README.md) does not have room for: the launcher, the
wizard, cartridge format, performance, hardware, and how the pieces fit.

A cartridge is a small drive in a pocketable enclosure with a game on it. Push it
into a USB-C port; the launcher opens showing what's on it. Press **Play** to
start the game, or **Eject** to power the drive down and pull it out.

Each cartridge is just a drive with a `cartridge.conf` text file at its root.
There are no scripts to write and nothing to allowlist, because **nothing on a
cartridge is ever executed automatically** — pressing Play is the gate.

```bash
git clone https://github.com/HarryBMa/pc-gamepak.git
cd pc-gamepak
cd tauri-ui && npm install && npm run build && cd ..

sudo linux/install.sh       # Linux, system install
# or: linux/install-user.sh  # Linux, no root
# Windows: right-click windows/install.ps1 → Run with PowerShell
```

Then plug a drive in, or run `pc-gamepak --create` to make one.

## Contents

**Using it**
&nbsp;&nbsp;[The idea](#the-idea) ·
[The launcher](#the-launcher) ·
[Making a cartridge](#making-a-cartridge) ·
[Getting the most out of a cartridge](#performance) ·
[Tags instead of drives](#tags)

**Building one**
&nbsp;&nbsp;[Hardware](#hardware) ·
[Cartridge format](#cartridge-format) ·
[Setup and install](#setup) ·
[Uninstall](#uninstall)

**Under it**
&nbsp;&nbsp;[How it works](#how-it-works) ·
[Security](#security) ·
[Working on it](#working-on-it) ·
[Packages](#packages)

**Everything else**
&nbsp;&nbsp;[Thanks](#thanks) ·
[Licence](#licence) ·
[Disclaimer](#disclaimer)

Click any heading below to open it.

---

<a id="the-idea"></a>
<details open>
<summary><b>The idea</b> — what a cartridge is, and why</summary>
<br />

It's the console-cartridge feeling, using hardware that already exists — and it
genuinely offloads a game off your internal disk, which is the practical half of
the appeal.

A shelf of cartridges is a library you can hold. Each one carries a game, its
cover art and nothing else, so what is on it is obvious from across the room and
from the drive's own name in Explorer.

<img width="480" alt="A cartridge is pushed into its enclosure; the launcher appears on the screen behind it showing Stardew Valley's cover art, and then reports Ejecting" src="docs/cartridge-demo.gif" />

That is the whole loop: plug it in, the launcher is there, press Play, press
Eject, take it out.

The build documented here uses an **M.2 2230 NVMe** stick in a USB enclosure, but
nothing in the software requires that: any removable drive your OS automounts
will do — a SATA SSD in a dock, an SD card, a USB stick, an external HDD. The
form factor is a comfort choice, not a technical one.

</details>

<a id="the-launcher"></a>
<details>
<summary><b>The launcher</b> — one window, cover art, Play and Eject</summary>
<br />

The window is 420 × 560 — the 3:4 of a cover — and the artwork fills it. The
window is the slot and the cover is the cartridge seated in it: press Eject and
the whole face rides out, leaving the empty slot behind.

<img width="420" alt="The launcher showing Stardew Valley: cover art filling the window, the title over it, a line reading On the cartridge, and a wide Play button beside an eject icon" src="docs/launcher.png" />
<img width="420" alt="The details sheet for a Stardew Valley cartridge: the free space as one large figure with a fill bar, above a folded Show file paths disclosure" src="docs/launcher-details.png" />

The accent colour is sampled from the cover art at load, so the Play button
belongs to whatever game is in the dock. At rest almost nothing else is on
screen — the buttons in the corner appear when the pointer is in the window,
and everything the launcher knows beyond the title is behind the ⓘ.

### More than one game on a cartridge

A 256 GB drive holds a series, not a game. Put several on one cartridge and the
launcher grows a rail: **picking a game is what Play acts on**, and the artwork
behind it cross-fades to whichever one is selected — no menu, no submenu,
nothing to learn.

<img width="420" alt="The launcher showing a ten-game Tomb Raider cartridge: the selected game's art filling the window, the collection name above a rail of games, and the selected game's title over one shared Play button" src="docs/launcher-bundle.png" />

Each row carries the game's own art and size, and the first nine answer to the
number keys — pressing one selects that game and starts it, so the window shows
what it just launched. A cartridge with one game on it has no rail at all.

| Key | Action |
|-----|--------|
| `Enter` | Play the selected game |
| `1`–`9` | Select the *n*th game of a collection and play it |
| `E` | Eject |
| `I` | Details |
| `Esc` | Close details, or dismiss |

### Skins

The launcher ships with more than one look, and a cartridge can ask for the one
it wants:

```ini
title=Stardew Valley
executable=steam://rungameid/413150
skin=retro
```

| Skin | |
|---|---|
| `default` | Dark, quiet, and out of the way of the artwork |
| `luna` | Explorer, about 2003: a title bar, a white pane, no artwork at all |
| `neon` | Cyan and magenta over the hero, in a vertical list |
| `cozy` | Cream and rounded: the light one, and the artwork stays out of it |
| `desktop` | Games as a grid of shortcuts, with a taskbar |
| `arcade` | A cabinet: the games run sideways, and Play is a big round button |

The six are deliberately not variations on a palette. Retro is moulded
plastic with buttons you press into, neon is etched glass with outlines you
press through, and cozy is a knitted thing on a shelf — so they differ in the
frame, in the shape and size of the two actions, in how the list is drawn and in
whether the title shouts. The clearest single tell is what happens when a
button is pressed: retro sinks into moulded plastic, neon lights an outline,
cozy barely moves, and terminal drops four pixels onto a solid edge underneath
it. Eject is a square, a wide bar, a circle and a hardware key across the four.

A cartridge that says nothing wears whatever **Launcher look** is set to in the
wizard's Settings. A cartridge that asks wins, because the cartridge is the
thing being shown.

**A cartridge picks a skin; it cannot bring one.** The name is looked up in the
list above and an unknown one quietly becomes `default` — `../../evil`,
`http://…`, and `retro.css` all match nothing. That is deliberate. Everything
else a cartridge supplies is content the launcher puts inside a frame it
controls: titles go in as text, artwork is read and handed over as a `data:`
URI, and nothing is executed. A stylesheet is a different animal — it cannot run
code, but it can move, cover and restyle anything on screen, including making
Eject look like Play or putting a convincing false sentence where a real one
was. A cartridge is a drive somebody handed you, and letting one repaint the
window that is asking whether to trust it is a poor trade for a nicer
background.

The star in the corner of the launcher cycles through them, live, and
remembers the one you stop on as the default. It is a cycle rather than a menu
because five looks in a 420px window means a list would cover the artwork it is
meant to be showing off.

A skin gets two boxes of its own — one over the artwork, one behind the
controls — which is what lets it add things rather than only recolour them: the
retro skin's speaker grille and power lamp are drawn in one, and the terminal
skin's title bar in the other. A stylesheet cannot add elements, so without
somewhere to put them a skin could only ever be a palette.

### A cartridge can carry its own look

Put a stylesheet at `.gamepak/skin.css` on the cartridge and the launcher wears
it, on top of whatever `skin=` selected — so a cartridge can bring a whole look
of its own, or take one of the five and adjust it.

```
H:\.gamepak\skin.css
```

It is read by the backend and inlined into the window, the same way the artwork
is read and handed over as a `data:` URI, so the window never opens a path on
the drive itself. Capped at 256 KB, which is sixty times the largest of the five
that ship.

This does mean a cartridge can restyle the window that is asking whether to
trust it. That is a fair trade here, where the cartridges are ones you wrote for
your own shelf, and a bad one if you ever hand a cartridge to somebody else —
the named skins exist for that case and cannot be supplied by a drive.

### A skin can choose the window's shape

The launcher is 420x630 because a cover is 3:4. A skin that is not built around
a cover says otherwise in two custom properties, and the window resizes to
match:

```css
:root {
  --skin-width: 560;
  --skin-height: 380;
}
```

`neon` uses it to turn the window on its side — artwork on the left, the list
and the controls in a column to the right. Saying nothing keeps the stock size.

### A skin chooses which artwork it wants

SteamGridDB has four kinds and the wizard fetches all four — grid (the 2:3
cover), hero (the wide banner), logo and icon. Which one fills the window is the
skin's to say, because it depends on the shape the skin chose:

```css
:root { --skin-art: hero; }
```

All four are on offer — `hero`, `grid`, `logo`, `icon` — and anything else, or
nothing at all, gets the grid. `neon` asks for the hero, which is the picture it
was always for: heroes were dropped from the launcher because one wants a window
three times as wide as a cartridge is, and there was only one window. A portrait
skin says nothing and keeps the grid.

The icon is really autorun.inf's — it is what Explorer puts on the drive — and
at 256px it makes a poor fill. It is on the list anyway, because a skin maker
with a reason is better served by having the option than by being protected from
it.

For a desktop-full-of-icons skin the fill is the wrong lever regardless: each
game already carries its own picture, in `.game-row__cover`, so laying
`#game-list` out as a grid of square tiles and hiding the row titles gets there
with no new data. What a cartridge does not have is a per-game *icon* — games
carry one picture each, and it is the grid.

Every game in a collection carries the same four, not just a poster — the art
picker is the same picker whether it is pointed at the cartridge or at one game
on it. Any of them may be left empty: somebody who knows their cartridge will be
read under a skin that wants heroes can fill in ten heroes and nothing else, and
that works. A frame with no picture for it shows the game's initials and its
name, so a half-filled collection is still one you can use rather than a row of
error states.

What fills a frame is resolved game-first: the game's own picture of the kind
the skin asked for, then the cartridge's, then the game's cover, then the
cartridge's. The first thing that exists wins.

**The artwork itself never changes shape.** A skin picks its frame, size, layout
and which of the four it shows; the pictures are the same pictures at the same
aspects, so one set works under all of them. A skin choosing a shape is not a
skin asking for different art.

Adding a skin is a stylesheet in `tauri-ui/app/skins/` and a line in
`core/src/skins.rs`. **[docs/SKINNING.md](docs/SKINNING.md)** is the reference:
every element a skin can style, the three properties it sets, the states to
handle, and the handful of things it must not do. The file is loaded *on top of* the stock one rather than
instead of it, so a skin is only the difference — `retro.css` is about 150 lines
and changes no markup at all.

### Getting back to the launcher

Press Play and the launcher does not close — it drops to the taskbar and gives
up always-on-top, so it is out of the game's way but still there when the game
is over. Eject is on that window, and quitting a game is exactly when you want
it.

If you do close it, the cartridge is still plugged in and the notification-area
icon is the way back. Left-click opens the launcher for the cartridge you have
in; right-click lists them by name when there is more than one, and carries the
wizard, Settings, and Quit.

The icon belongs to the watcher rather than to the launcher, which is why it is
still there after the window has gone. The watcher is a hidden window and a
message loop and nothing else — see [Idle cost](#idle-cost).

### With a controller

A cartridge next to a television wants a controller, not a mouse. Plug one in
and the launcher picks it up — no setting, nothing to install, and nothing
resident: the polling loop exists only while a pad is connected and the window
is open, which is a few seconds per insert.

| Control | Action |
|---|---|
| D-pad or left stick | Move up and down the game list |
| **A** | Play |
| **X** | Eject |
| **Y** | Details |
| **B** | Back out of details, or dismiss |
| **Start** | Play |

Every action has its own button, and the stick only ever changes which game is
selected. So a pad and a cartridge is: plug in, press A — and on a collection,
up and down first. Holding a direction repeats after a pause, and the list wraps,
because three games on a television is a ring rather than a form.

It used to move focus between the controls instead, which meant reaching Eject
by pressing down past Play and the rail. That is how a form works, not how a
thing plugged into a television works: on a console the buttons *are* the
actions. There are four controls and four face buttons, so nothing has to be
navigated to. Each one calls the same function the mouse and the keyboard call,
so a controller can do exactly what a person at the keyboard can and nothing
more.

**Anything that calls itself a gamepad is not necessarily one.** Plenty of
devices enumerate as gamepads — a Keychron keyboard's own dongle reports sixteen
buttons that are never pressed — so the launcher prefers a pad reporting the
standard layout, and reads all of them at once when several are plugged in. If a
controller is ever ignored, `PC_GAMEPAK_DEBUG=1` makes the launcher write what it
sees to `launcher.log` next to the watcher's, which names every device it found
and what each one reported.

With a pad connected the prompts change with it: the keycaps give way to each
action's own icon, because face-button lettering differs between Xbox,
PlayStation and Switch and a printed **A** would be wrong on two of the three.
The chip in the corner overrides the guess when the hardware gets it wrong.

**The window takes the keyboard when it opens**, which matters more than it
sounds. The launcher is opened by the watcher — a background process — and
Windows will let a background process put a window in front without giving it
focus, on the reasonable grounds that programs should not be able to steal your
typing. The result was a launcher sitting on top of whatever you were doing
while Enter still went to the window underneath it, and a controller that was
worse off than that: browsers only report gamepad state to a focused document,
so a pad would announce itself, light up the indicator in the corner, and then
read as though every button were resting. Connected, visible, and completely
dead, with no way out but reaching for the mouse — on the one setup where the
mouse is across the room. The launcher now asks for the foreground properly on
the way up.

The wizard is deliberately not controller-driven. Making a cartridge is a desk
job.

</details>

<a id="making-a-cartridge"></a>
<details>
<summary><b>Making a cartridge</b> — the wizard: pick a game, pick a drive, Write</summary>
<br />

Run the installer menu and choose **Create a cartridge**, or start it directly:

```bash
pc-gamepak --create
```

<img width="760" alt="The create-cartridge wizard: one screen with Game, Media, Artwork and Written to as four groups down the left, each stating what is chosen with a Change button beside it, and a rail on the right previewing the launcher the cartridge will open" src="docs/wizard.png" />

The wizard lists everything installed. **Playnite** is read first when present —
one list covering Steam, GOG, Epic, Xbox, Ubisoft, itch and emulators — and
Steam's own manifests are read too, which is the only source on Linux. Cover art
comes from whichever cache the game came from, so **nothing is fetched**; the
wizard **works offline**, with the optional SteamGridDB integration switched
off — see [Artwork from SteamGridDB](#artwork-from-steamgriddb) to turn it on.

Playnite is detected automatically on Windows (the standard `%APPDATA%\Playnite`
location and portable installs in `Program Files`) and on Linux through every
Proton `compatdata` prefix that contains a Playnite install. If detection fails,
a **Playnite data folder** field appears at the bottom of the game list so you
can point the wizard at the right directory.

> **Note:** Playnite stores its library in a binary database. The wizard reads a
> JSON export instead — install a library-exporter extension in Playnite and run
> it once before using the wizard. Any extension that writes a `library.json` or
> `games.json` file will work.

Pick a game, pick the media, press Write. It is **one screen**: Game, Media,
Artwork and what gets written, each stating what is currently chosen with a
**Change** beside it — so nothing has to be finished before the next thing can
be looked at, and there is no step to go back to.

**Change** opens the library as a dialog, and it is a real list with tick boxes:
selection is always multiple, so ticking a second game is all it takes. The rail
on the right titles itself **Cartridge** or **Multicartridge** to match. There is
no mode to enter.

<img width="760" alt="Choose the media: a dialog listing every removable drive with its free space, and a note against each one that already holds a cartridge" src="docs/wizard-media.png" />

Media is the same dialog asking the same kind of question. Every removable drive
is listed with the room on it, and one that already holds a cartridge says so
before you overwrite it.

The rail is a **live preview of the launcher** this cartridge will open — the
cover behind, the logo or the title over it, Play in the colour sampled from the
art. It is the only place that answers the question a thumbnail cannot: whether
the title is still readable on the picture you just chose.

### Collections

Tick a second game and the cartridge is a collection — nothing else to press.
The rail counts them, and the bar under it puts one band per game so you can see
which one is taking the room:

<img width="760" alt="The wizard with three games chosen: the Game card naming the collection, a Name and order group with a drag-sortable play order, and the rail titled Multicartridge above a live preview of the launcher" src="docs/wizard-bundle.png" />

A collection is the one thing in a library with no artwork of its own, so a
**Name and order** group appears on the same screen for the two things the wizard
cannot work out — what to call it, and what it should look like:

- **The name** is suggested from what the games share — *God of War* and *God of
  War Ragnarök* give *God of War Collection* — and can be typed over. The drive
  itself takes a squeezed version of it, because exFAT allows 11 characters.
- **The artwork** is whatever picture you point at, or the first game's cover if
  you would rather borrow one. Without either, the launcher shows a placeholder.
- **The order** is drag-to-reorder, and it is the order the games appear in on
  the launcher's rail.

A single game never sees that step: it takes its name and its art from itself.

Copying works the same for a collection as for a single game: tick the box and
every game goes across, each entry pointing at its own copy.

### Changing a cartridge you already made

Everything a cartridge says about itself is two small files and a picture, so
renaming one, fixing a typo or swapping its art should not mean writing the
whole thing again — which, with the games copied onto it, is hours.

Select a drive that already holds a cartridge and **Edit the cartridge already
on this drive** appears:

<img width="760" alt="The edit dialog: the cartridge name, a Change artwork button, and the list of games with controls to rename, reorder and remove them" src="docs/wizard-edit.png" />

You can rename the cartridge, change its artwork, rename the individual games,
reorder them — the order is the order of the launcher's rail — and take one off
the list. Adding a game means writing the cartridge again, since that is when files
move.

**Nothing here copies or deletes a game.** Taking a game off the list leaves its
files exactly where they are; the launcher simply stops offering it. A cartridge
that ends up with one game on the list becomes an ordinary single-game cartridge
again, and one that gains a second becomes a collection.

### Checking the copy

`std::fs::copy` reports success for every byte the kernel accepted, which is not
the same as every byte arriving on the drive. When a copy over USB goes wrong it
goes wrong quietly, and you find out later, in a level you have not played yet.

**Check the copy afterwards** sums every file with CRC-32 as it is written —
free next to a USB write — then reads the cartridge back and compares. It names
what is wrong rather than just failing: a missing file, a half-written one with
both byte counts, or one that arrived with different contents.

It is opt-in because it costs one extra pass over the drive, so it roughly adds
the time the copy itself took. The file list is left on the cartridge at
`.gamepak/manifest.json`, so the same check can be run later on a machine that no
longer has the original.

This is an integrity check, not a signature: CRC-32 is the right tool for *did
this survive the cable*, the job it does in zip and gzip, and the wrong tool for
*did somebody change this on purpose*.

### What it can put on the cartridge

**The launcher files** — `cartridge.conf` and the cover art. Always written.

**The drive's name and icon** — an `autorun.inf` with `label=`, so Explorer shows
*HOLLOW KNIGHT* rather than *Removable Disk (D:)*. The `icon=` key is written
when a usable `.ico` can be produced; Explorer will not take a JPEG, so a
Steam-sourced cover usually leaves the default icon in place. On by default, and
a tick box under **The cartridge itself** when you would rather the drive stayed
plain.

**The game itself**, by whichever route suits where it came from:

<img width="760" alt="Adding a game by hand: the chosen folder, a title taken from the folder name, and the executables inside it ranked with the uninstaller and the runtime pushed to the bottom" src="docs/wizard-portable.png" />

- *Steam games* go to `steamapps/` and the drive is registered in Steam's
  `libraryfolders.vdf`, so Steam plays **from the cartridge** rather than your
  internal copy. Steam rewrites that file from memory when it exits, so it has to
  be closed first — the wizard offers to do that for you, and does it before
  anything on the drive is touched.
- *Rewriting a cartridge Steam already knows about* takes the old entry out of
  that list first, so a repurposed drive does not leave Steam pointing at a
  library that no longer holds the game.
- *Everything else* — GOG, itch, emulator builds, anything Playnite records an
  install folder for — is copied to `Games/<title>/` and Play is pointed at a
  file inside it. No launcher in the middle. The wizard ranks the executables it
  finds (Playnite's own play action first, then a binary named after the game;
  uninstallers and redistributables sink) and offers the best guess, which you
  can change.

**Games in no library at all** — an itch download, a folder nothing scanned —
are entered by hand: point at the folder and the wizard ranks the programs
inside it, saying which it thinks are uninstallers or runtimes rather than
hiding them, and tidies a title out of the folder name for you to correct. There
is no art to inherit for these, so the cover is honestly empty until you give it
one. Any supported URI or a path on the cartridge works too.

<a id="artwork-from-steamgriddb"></a>

### Artwork from SteamGridDB

Some games have no cached art at all — anything added to Playnite by hand,
emulator entries, older GOG titles — and the launcher then shows a placeholder.
The wizard can look artwork up on [SteamGridDB](https://www.steamgriddb.com/)
to fill those gaps.

<img width="760" alt="The wizard's settings, grouped: a count of where the 87 games came from with a Rescan link, the SteamGridDB switch and its key field, and defaults for a new cartridge" src="docs/wizard-settings.png" />

**It is off by default**, and it is the only part of this project that talks to
the network. Turn it on behind the gear in the wizard's title bar, where it also
asks for a personal API key — their API refuses unauthenticated requests, so the
lookup does nothing without one. The key is stored on this machine only, next to
the artwork cache, and the backend refuses every request while the setting is
off, so hiding the button is not the only thing keeping it quiet.

With it off you can still give a cartridge any picture you like: **Choose
artwork…** opens the desktop's own file dialog and copies whatever you point at.

### Formatting erases the drive

<img width="760" alt="Every option with formatting enabled: options grouped by what they touch, with the destructive one alone under its own heading" src="docs/wizard-format.png" />

Formatting is opt-in per cartridge and gated three ways: the target must be on
the removable-drive allowlist the wizard re-derives itself, it must not be the
system drive, and it must have been asked for explicitly. All three are checked
in the backend, which re-derives them rather than trusting the window's idea of
where to write, and the plan on screen names the drive and what is on it before
anything runs.

### Which filesystem

**exFAT is the default, and it is the right answer for a cartridge you hand to
someone.** Windows, Linux and macOS all read it with nothing to install, which
is the entire point of a thing you carry between machines.

**btrfs is there for enthusiasts**, and it is a real choice with real costs:

- It brings TRIM (`discard=async`) and transparent zstd compression
  (`compress=zstd`).
- Windows cannot read it at all without [WinBtrfs](https://github.com/maharmstone/btrfs),
  a third-party kernel driver — so a btrfs cartridge only opens on machines you
  have prepared.
- Neither benefit is as large here as it sounds. TRIM only reaches the drive if
  the USB bridge speaks UASP and passes UNMAP through, which many enclosures do
  not; and game data is already compressed, so zstd typically buys single-digit
  percentages in exchange for CPU on every read. A cartridge is also written
  once and read for years, which is the workload flash wear cares least about.

Pick btrfs if your cartridges live on Linux machines you control and you want
the filesystem's other properties. Otherwise exFAT.

The drive name follows the filesystem: exFAT allows 11 characters, btrfs has
room for the whole title. On Linux the relevant mount options are set by the
desktop environment or `/etc/fstab`.

</details>

<a id="performance"></a>
<details>
<summary><b>Getting the most out of a cartridge</b> — what actually causes stutter, in order</summary>
<br />

A game running from a cartridge is running over USB, and USB is the slowest
part of the machine. Most of what people blame on that is not actually the
drive, so this is in order: check the boring things first, then the storage.

### It is usually not the storage

**Shader compilation.** Modern DX12 and Vulkan games compile pipeline state
objects the first time each one is needed, and that stutter looks exactly like a
slow disk. The compiled cache lives on your internal drive, not the cartridge,
and it is keyed to GPU *and* driver version — so moving a cartridge to a second
PC, or updating your driver, throws it away and the first hour stutters again.

- NVIDIA Control Panel → Manage 3D settings → **Shader Cache Size → 10 GB** or
  Unlimited. The default is small enough that a big game evicts its own cache.
- On Steam, leave **Shader Pre-Caching** on. On Linux it is doing most of the
  work for you.

**VRAM.** A texture pool set above your VRAM budget spills over PCIe and hitches
in a way that reads as storage. Drop textures one notch and see whether the
stutter goes before touching anything else.

Neither of these gets better with a faster cartridge.

### The connection, which the launcher will tell you about

Press `I` on the launcher and it reports three things about the drive in front
of it:

<img width="420" alt="The details sheet for a ten-game cartridge with the paths unfolded: free space, a games count, and the steam:// URI each game launches by" src="docs/launcher-health.png" />

- **Link** — 10 Gbps is what a Gen 2 enclosure should negotiate. 5 Gbps means a
  front-panel port, a hub, or a cable that is not rated for it; 480 Mbps means
  USB 2.0, and games will stream badly.
- **Transport** — **UASP** queues commands; **BOT** sends one at a time. On the
  small random reads a game streams that is worth roughly two to three times as
  much, and which one you get depends on the enclosure's firmware and the port.
- **Space** — see below.

### Leave the drive some room

Almost every M.2 2230 drive is DRAM-less. On an internal slot that is fine: it
borrows host RAM over PCIe — the **Host Memory Buffer** — to hold its flash
translation table. **A USB bridge does not provide HMB**, so the translation
table is paged from the flash itself, and it gets worse the fuller the drive is.

Keep roughly **15% free** and the difference is measurable on random reads. The
wizard says so when a cartridge crosses 85%, and the launcher repeats it.

Free space only helps if the drive knows about it, which is what TRIM is for,
and nothing sends TRIM to removable media on a schedule. The wizard offers
**Release freed space back to the drive** when it is not formatting. Some
enclosures do not pass the command through at all — it will say so plainly if
yours is one of them, which is a good reason to keep the headroom anyway.

### Windows settings worth changing

The wizard's **Tune Windows for this cartridge** does the first two, per
cartridge, showing the exact commands first and offering to undo them:

- **Defender exclusion.** Real-time scanning walks a freshly copied 60 GB game
  the first time anything reads it, competing for the link you are trying to
  stream over.
- **Search indexing off** for the volume, for the same reason in the background.

The Defender exclusion is the one with a memory. `Add-MpPreference` records a
*path*, and the only path a cartridge has is a drive letter Windows hands out
from whatever is free — so the cartridge that was `D:` last week is `H:` today,
and `D:` is now something else nobody chose to stop scanning. Tuning a cartridge
therefore also takes back any exclusion left on a bare drive root that no longer
holds a cartridge. Those removals are in the plan with everything else, so an
exclusion you added yourself can be seen before you agree to the prompt; only
bare roots are ever offered, never a path any deeper.

A cartridge that is unplugged when you tune another one will have its exclusion
taken back too — there is no way to tell an unplugged cartridge from a letter
that has moved on. Tuning it again when it is next plugged in puts it back.

The third is worth doing by hand, once per cartridge:

- **Device Manager → Disk drives → your cartridge → Policies → Better
  performance.** Windows sets removable drives to *Quick removal*, which turns
  write caching off entirely. *Better performance* is the right setting for a
  drive that is always ejected properly — which is what this launcher's Eject
  button is for. It is left as a manual step because the supported way to set it
  is that dialog; the registry keys behind it are per-device and undocumented,
  and this tool does not guess at those.

### If a cartridge will not eject

Eject asks the PnP manager to stop the device, the same way Safely Remove
Hardware does. When that is refused it elevates and takes the volume by force,
locking and unmounting the filesystem — because Windows calls an NVMe stick in a
USB enclosure a *fixed* disk and will not give a fixed volume write access to
anyone else. That is what the UAC prompt is for, on a drive you are only trying
to unplug.

If it still reports the cartridge in use with administrator already granted,
then files really are open on it, and the obvious candidates are not always the
ones holding it. A cartridge that has just been plugged in ejects every time; a
cartridge that has had a game played from it can stay busy afterwards and, on
some machines, does not let go until it is replugged. A Defender exclusion does
not change this — that was tried.

So when one refuses: unplug it, plug it back in, and eject before opening
anything on it.

### If a cartridge gets no drive letter

A volume with no letter has no path, so nothing can see it — not the launcher,
not the wizard, not Explorer. It is not a fault in the drive and rescanning will
not find it, because there is nothing to look at.

Windows normally hands out a letter on its own. When it stops, it is usually
because automount has been turned off, which some disk and imaging tools do
without saying so, and which is remembered across reboots:

```powershell
# In an admin PowerShell. 1 means automount is off.
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\mountmgr).NoAutoMount

mountvol /E   # turn it back on
```

The tell is that drives you have lettered by hand keep coming back and new ones
never get one at all: the manual assignments are remembered per volume in
`HKLM\SYSTEM\MountedDevices`, and everything else falls through. Those entries
key on the partition, not the port, so moving a cartridge to a different socket
changes nothing.

`mountvol /E` does not letter a drive that is already plugged in — unplug and
replug it, or use the wizard. Cartridges Windows can read but has not lettered
show up in **Change media** as a dashed entry; clicking one asks Windows for the
first free letter, which needs administrator, so there is a UAC prompt. Skip
`mountvol /R`: it clears every remembered assignment, including the ones you
made deliberately.

### Do not put a pagefile or swap on a cartridge

It comes up, and it is a bad idea three ways over. Windows will not page to a
disk it considers removable, and cannot page to exFAT at all. More importantly,
a failed read of a game asset is a retry, while a failed read of *swap* is a
bugcheck on Windows or a hard freeze on Linux — and a USB link that resets under
thermal load is a normal Tuesday. And it is backwards for stutter: swapping puts
*more* traffic on the slowest link in the machine.

If a game is short of RAM, add RAM. On Linux, `zram` gives you compressed swap
inside memory with no device involved.

### Install once, cleanly

exFAT's allocator is simple, so a game copied onto a freshly formatted cartridge
stays contiguous, and churning installs on and off it does not. Format, copy,
play. Sustained writes also heat the enclosure — that affects how long the copy
takes, not how the game runs.

</details>

<a id="tags"></a>
<details>
<summary><b>Tags instead of drives</b> — NFC, which now lives in its own project</summary>
<br />

A cartridge carries the game. A tag only points at one that is already
installed, which is the right answer for a shelf of thirty titles or a 150 GB
install that would never fit on a 2230.

That idea has grown up somewhere else and is better looked after there:

**[TheStockPot/NFC-Cartridge-Player](https://github.com/TheStockPot/NFC-Cartridge-Player)**

</details>

<a id="hardware"></a>
<details>
<summary><b>Hardware</b> — 2230 NVMe, enclosures, and how fast that really is</summary>
<br />

Built around **M.2 2230 NVMe drives** — the short ones from Steam Decks and
Surface tablets — in compact aluminium USB enclosures.

| | |
|---|---|
| **Drives** | 128 GB M.2 2230 NVMe |
| **Enclosures** | ITGZ aluminium compact M.2 2230 case, USB 3.2 Gen 2 (10 Gbps), passive auto-cooling |
| **Filesystem** | exFAT by default, so a cartridge works in whatever machine it is plugged into. btrfs is offered for people who want TRIM and compression and do not mind [WinBtrfs](https://github.com/maharmstone/btrfs) on Windows. |

2230 is the right form factor for this: the drive plus enclosure is roughly the
size of a USB stick, so a shelf of ten cartridges takes almost no room. 128 GB
holds most single games, and the whole point of a cartridge is that it carries
one thing.

The enclosure is doing two jobs. It makes the cartridge pocketable, and it keeps
the wear away from the NVMe stick itself. A bare M.2 NVMe edge connector is
typically only rated for roughly **50–100 insertion cycles**; used as a raw
plug-in cartridge, the drive would become the sacrificial part. In a USB
enclosure, the NVMe drive is installed once and left alone, while the repeated
insertions happen on the cheaper, easier-to-replace USB side instead.

<img width="340" alt="A cartridge with its backplate removed: an M.2 2230 NVMe drive screwed into an aluminium enclosure, the USB-C plug moulded into the shell, and the plate and its single screw beside it" src="docs/hardware-cartridge.jpg" />

That is the whole assembly, opened up: the 2230 drive screwed down inside the
shell, the USB-C plug part of the enclosure rather than part of the drive, and a
backplate held on by one screw. Building a cartridge is this once — after that
the plate goes back on and the only thing that ever meets a port again is the
enclosure's own connector.

That trade-off does **not** mean giving up useful speed. 10 Gbps over USB 3.2
Gen 2 is around 1 GB/s in practice — already ahead of what a 2.5" SATA SSD can
deliver, and far beyond Switch-cartridge or SD-card territory. The aluminium
body doubles as the heatsink, which matters when a game is streaming assets off
it for hours.

| Medium | Practical read speed | What runs comfortably | Notes |
|---|---:|---|---|
| **USB 3.2 Gen 2 enclosure + 2230 NVMe** | **~800–1000 MB/s** | Indies, emulators, AA games, older AAA games, and many modern installs | The USB link is not the bottleneck here; drive quality and thermals usually matter more |
| **2.5" SATA SSD** | ~500–550 MB/s | Most PC games, including many large installs | Still slower than a 10 Gbps USB NVMe enclosure |
| **Nintendo Switch game card** | ~50–100 MB/s | Games built and optimised around console-style asset budgets | Much slower, but the software is designed for it |
| **UHS-I SD / microSD** | ~30–90 MB/s | Retro libraries, indies, lightweight PC games, emulators | Fine for small assets; weak for large modern PC installs |

So the practical answer is: the **adapter is the durability win**, and USB 3.2
is still fast enough that the cartridge remains a real play-from-media device
rather than just cold storage.

For this build, cheap refurbished bulk 2230 drives are a value play, not a
promise of flagship performance. They should be perfectly usable for indies,
retro, emulation, smaller AA releases and plenty of older AAA games, but the
newest asset-streaming-heavy PC blockbusters may still be happier on a strong
internal NVMe if a bargain cartridge drive cannot keep up.

Nothing here is specific to NVMe or to 2230. Any removable storage your OS will
automount works: 2.5" SATA SSDs in a dock, SD cards, USB sticks, external HDDs.
The form factor is a comfort choice, not a technical one.

</details>

<a id="cartridge-format"></a>
<details>
<summary><b>Cartridge format</b> — the one file a cartridge needs, by hand</summary>
<br />

A cartridge is a text file and some art, so you can make one by hand. Copy
`cartridge.conf.example` to the root of the drive as `cartridge.conf`:

```ini
executable=steam://rungameid/1091500
title=Cyberpunk 2077
cover=cover.jpg
```

Portrait art at 3:4 fills the launcher window exactly. A finished cartridge:

```
CARTRIDGE/
├── cartridge.conf
├── cover.jpg
├── autorun.inf          drive name and icon in Explorer
├── Games/               a copied non-Steam game
│   └── Tunic/
│       └── TUNIC.exe
└── steamapps/           a copied Steam game
    ├── appmanifest_367520.acf
    └── common/Hollow Knight/
```

`executable=` takes any URI the OS can handle — `steam://`, `heroic://`, `gog://`,
`epic://`, `playnite://`, `lutris://`, `http://`, `https://` — or a path to a file
on the cartridge. See `cartridge.conf.example` for every key.

A classic `autorun.inf` is also read, for `label` and `icon` only. Its `open=`
and `shellexecute=` keys are deliberately ignored: Windows has ignored them on
non-optical media since Windows 7, and they are the oldest autorun malware vector
there is.

</details>

<a id="setup"></a>
<details>
<summary><b>Setup and install</b> — prerequisites, and the two shapes of Linux install</summary>
<br />

### Prerequisites

Rust (stable) and Node 18+, plus a C toolchain.

```bash
# Linux
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev

# Windows: Visual Studio Build Tools, "Desktop development with C++"
```

### Build and install

```bash
git clone https://github.com/HarryBMa/pc-gamepak.git
cd pc-gamepak
cd tauri-ui && npm install && npm run build && cd ..
```

**Linux** — two shapes, and you pick by which script you run:

```bash
sudo linux/install.sh       # 1) the system install   (recommended)
linux/install-user.sh       # 2) install without root
```

**1 — the system install.** A udev rule, two systemd template units, the helpers
and the launcher. udev is already running as part of the OS, so **nothing is
resident**: no process of ours exists until a cartridge is plugged in. Needs your
password once.

**2 — the rootless install.** Everything under `~/.local/bin`, plus a systemd
*user* service. No password, no udev rule, nothing written outside your home. In
exchange a small watcher stays running — about **2 MB, blocked in `poll()` on the
mount table**, no CPU while it waits.

Pick 1 unless you have a reason: zero is a better number than two megabytes. Pick
2 if you would rather not give a game launcher root, if you are on a machine
where you do not have it, or if you are installing from a sandboxed package,
which cannot write a udev rule at all.

They are not two codebases — the same launcher, the same detection rules, a
different trigger. The rootless one is arguably the more accurate of the two: it
wakes when the cartridge is *mounted and readable*, where udev fires when the
kernel first sees the partition and the helper then waits up to a minute for the
desktop to catch up.

```bash
# What the rootless install did, if you want to look:
systemctl --user status pc-gamepak-watcher.service
tail ~/.local/state/pc-gamepak/watcher.log
```

**Windows**

```powershell
cd watcher; cargo build --release; cd ..
# Right-click windows/install.ps1 → Run with PowerShell
```

Installs the watcher and launcher to `%LOCALAPPDATA%\PC-GamePak` and
registers a logon task.

**Platforms:** Windows and Linux. macOS is not supported — there is no watcher,
no installer and no icon set for it, so rather than ship something half-working
the macOS branches were removed.

</details>

<a id="uninstall"></a>
<details>
<summary><b>Uninstall</b> — putting the machine back</summary>
<br />

Run the installer menu and choose Uninstall. It removes the udev rule and systemd
units on Linux, or the logon task and install folder on Windows.

</details>

<a id="how-it-works"></a>
<details>
<summary><b>How it works</b> — insertion to launcher, and what it costs while idle</summary>
<br />

```
drive plugged in                          tag put on a reader
      │                                         │
      ├─ Linux    udev ──▶ systemd unit         └─ watcher, blocked in PC/SC,
      └─ Windows  watcher sees the volume          asks the reader for the UID
      │                                         │
      ▼                                         ▼
is there a cartridge.conf at the root?    is there one in tags/<UID>/ ?
      │                    ╰──no──▶  nothing happens  ◀──no──╯
      │ yes                                     │ yes
      ╰───────────────────────┬─────────────────╯
                              ▼
launcher opens with the cover art
      │
      ├─ Play   ──▶ starts what cartridge.conf names, then minimises
      └─ Eject  ──▶ flushes, unmounts, powers the drive down
```

**Nothing on a cartridge is executed automatically.** The launcher shows you what
it found and waits — pressing Play is the gate. That is the whole security model,
and it is why there is no trust list or allowlist to maintain.

### Idle cost

The point of a thing that waits all day for a drive is that it costs nothing
while it waits.

| | Idle |
|---|---|
| **Linux** | **Nothing resident** with the system install: udev is already part of the OS, and the rule adds no process. The rootless install trades that for one process of about 2 MB, blocked in `poll()` on the mount table. |
| **Windows** | **One process, ~2 MB, 0% CPU.** `pc-gamepak-watcher.exe` blocks on the Windows message queue — no polling, no timer. |
| **[Tags](#tags)** | Only when switched on: one extra thread in that process, blocked in PC/SC, plus whatever the reader library maps in. Still no timer and no polling. It wakes every thirty seconds to re-check which readers exist, which costs one syscall. |

The launcher is a webview, so it is not small *while it is on screen* — expect
around 100 MB for the few seconds it is up, then it exits and gives all of it
back. There is no tray icon and no background service for the UI.

The watcher ignores a second arrival on the same drive letter within 4 seconds,
so a cartridge that is ejected and immediately re-inserted may require a brief
pause before the launcher reopens.

</details>

<a id="security"></a>
<details>
<summary><b>Security</b> — nothing runs without a click</summary>
<br />

Nothing on a cartridge runs without a click. That is the model. Earlier versions
of this idea auto-executed a `launch.sh` on insert, which needed a SHA-256
allowlist to be safe at all; removing the auto-execution removed the need for the
allowlist along with it.

- **Play runs what `cartridge.conf` says.** If `executable=` names a binary on the
  drive, Play runs that binary. On your own cartridges that is the feature. On a
  drive someone hands you, read the conf first — or keep to `steam://`-style URIs,
  where the argument goes to a program you already trust.
- **The launcher window cannot read your disk.** The webview has no filesystem
  access and no command that takes a path. The cover is read in Rust, from a path
  confined to the cartridge, and passed in as a `data:` URI.
- **Nothing is fetched**, with the optional SteamGridDB integration switched off.
  Fonts are bundled, the cover is inlined, and the content-security policy is
  `default-src 'self'`. The launcher never has a reason to reach the network at
  all; only the wizard does, and only once you have turned the lookup on and
  given it a key.
- **Titles are text, never markup.** They come off an untrusted volume and are
  inserted with `textContent`.
- **Eject cannot pull a drive out from under a running game.** It takes an
  exclusive lock before unmounting, which a volume with an open handle on it
  will not give — so a game still running makes the eject fail and say what to
  close, rather than being talked out of it by a dialog.

- **Quit on the tray menu stops the watcher**, and nothing restarts it until the
  next logon. Plugging a cartridge in after that does nothing at all, which is
  the intended reading of Quit.

### Cartridges in Steam's library list

A cartridge you copied a Steam game onto is registered in `libraryfolders.vdf`,
labelled `PC GamePak`. Those entries are never removed automatically: a
cartridge is *meant* to spend most of its life unplugged, so a missing folder is
the normal state rather than stale cruft. When you reformat or repurpose one, the
wizard offers **Remove this drive from Steam's library list**.

Either way Steam has to be closed, because it keeps that list in memory and
writes it back out on exit — an edit made underneath a running Steam is simply
overwritten. **Close Steam if it is in the way** (ticked by default, and only
shown when the drive is or is about to be a Steam library) asks Steam to shut
itself down and waits for it. That is a request, not a kill: Steam flushes
`libraryfolders.vdf` and its download state on the way out, and killing it
mid-write to its own config is how the file we came to fix gets corrupted. If it
has not gone within 25 seconds the build stops and says so — and because this
runs before the format, nothing has been changed yet.

</details>

<a id="working-on-it"></a>
<details>
<summary><b>Working on it</b> — the crate split, the tests, the layout</summary>
<br />

The logic lives in `core/` (crate `gamepak-core`), deliberately free of any UI
dependency, so the tests run anywhere:

```bash
cargo test --manifest-path core/Cargo.toml
```

That split is the point: the Tauri binary cannot be compiled without webkit2gtk
and a display, so tests living inside it could not run in CI or on a
contributor's machine.

CI runs that suite plus clippy and rustfmt, compiles the watcher on Linux and
Windows, `cargo check`s the launcher on both, parses the frontend JavaScript, and
verifies every element the scripts reach for exists in the HTML — the UI ships
unbundled, so a missing id is a runtime crash rather than a build error.

```
cartridge.conf.example      the one file a cartridge needs
core/                       cartridge logic, no UI — this is where the tests are
linux/                      udev rule, systemd units, the user service, helpers,
                            and install.sh / install-user.sh
windows/                    install.ps1, uninstall.ps1, eject.ps1
watcher/                    volume watcher: WM_DEVICECHANGE on Windows, the
                            mount table on Linux (rootless install only)
tauri-ui/                   one binary, two windows (Tauri 2 + Rust, no framework)
  app/                      the HTML, CSS and JS, shipped unbundled
  src-tauri/                commands and window construction
packaging/                  AUR and Scoop manifests
tools/                      icon generation, DOM-id check
docs/                       screenshots, PUBLISHING.md, STATUS.md
```

[`docs/STATUS.md`](docs/STATUS.md) is the working inventory: what each module is
for, what is built, and what is missing.

When a cartridge does not open the launcher, the logs are the first place to
look: `%LOCALAPPDATA%\PC-GamePak\watcher.log` on Windows,
`~/.local/state/pc-gamepak/helper.log` on Linux.

</details>

<a id="packages"></a>
<details>
<summary><b>Packages</b> — where this will be published, and why not everywhere</summary>
<br />

Nothing is published yet. When it is, the shortlist is the AUR (which is where
the Steam Deck and Arch audience is), WinGet and Scoop on Windows — the channels
that can actually install the udev rule or the logon task this depends on.

[`docs/PUBLISHING.md`](docs/PUBLISHING.md) has the reasoning, including why
Flatpak, Snap and Homebrew are not on that list yet and what would change it.

</details>

<a id="thanks"></a>
<details>
<summary><b>Thanks</b> — the project this forked from, and others on the same idea</summary>
<br />

This project began as a fork of
**[LewdM3at/PC-cartridge-system](https://github.com/LewdM3at/PC-cartridge-system)**,
which had the original idea and the first working implementation: the udev rule,
the systemd template unit and the Windows monitor that make insert-detection work
at all. The shape of the Linux side is still recognisably theirs.

That project is built around 2.5" SATA SSDs and has 3D-printable cartridge shells
on [MakerWorld](https://makerworld.com/en/models/3057977-2-5-ssd-dock-cartridge-system) — worth a look if you
want the full physical-cartridge build rather than a pocket enclosure.

This fork diverges in a few ways: 2230 NVMe rather than 2.5" SATA, a Tauri
launcher and a create-cartridge wizard instead of per-game shell scripts, and a
click-to-play model in place of the auto-execute-plus-allowlist one.

### Others working on the same idea

**[TheStockPot/NFC-Cartridge-Player](https://github.com/TheStockPot/NFC-Cartridge-Player)**
is where the tag idea above comes from, and it is worth seeing on its own terms:
an ESP32 and an RC522 in a 3D-printed shell, reporting tag IDs to Home Assistant,
which then dims the lights and starts the film. It is a smart-home project rather
than a PC one, and no code is shared with it — its licence is GPL-3.0 against our
MIT. Tags are its subject rather than ours, which is why this README now points
at it instead of explaining them again.

**[Uplinkpro/CartLaunchCompanion](https://github.com/Uplinkpro/CartLaunchCompanion)**
takes the opposite half of this problem, and takes it further than this project
does. It is a fullscreen, controller-first launcher — Avalonia and .NET, with
trailers and shelves — that lives **on the cartridge itself**, so a drive works
on a machine that has never been prepared. You lay the drive out yourself and its
configurator writes a `game.json` per game.

Where PC GamePak differs: the launcher is installed on the PC and the cartridge
carries only data, so a cartridge stays a text file and some art; and there is a
wizard that *makes* one — formatting, copying the game across, registering it as
a Steam library — which CartLaunchCompanion leaves to you. If you want a console
UI on a drive you assemble by hand, look there. Note its licence is PolyForm
Noncommercial, not MIT, so code cannot move between the two projects.


</details>

<a id="licence"></a>
<details>
<summary><b>Licence</b> — MIT</summary>
<br />

MIT, inherited from the upstream project. See [`LICENSE`](LICENSE) — the original
copyright notice is retained as the licence requires.

</details>

<a id="disclaimer"></a>
<details>
<summary><b>Disclaimer</b> — a hobby project</summary>
<br />

A hobby project, not affiliated with Valve, Steam, Playnite or ITGZ.

Auto-detection depends on your OS automounting removable drives. Some setups need
that configured before any of this works.

Use at your own risk.

</details>
