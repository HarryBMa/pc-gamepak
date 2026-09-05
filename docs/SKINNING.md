# Writing a skin

A skin is one stylesheet. It is loaded **on top of** `style.css`, never instead
of it, so a skin file is only the difference — the shipped ones run from 150 to
280 lines and none of them touches the markup.

There is no JavaScript in a skin, no template, and no build step. Everything on
this page is a CSS selector or a custom property.

---

## The two files

```
tauri-ui/app/skins/<name>.css     the stylesheet
core/src/skins.rs                 one line in SKINS: ("<name>", "one-line description")
```

Both, or nothing happens. A name with no file loads nothing and looks exactly
like a skin that did not work; a file with no name can never be chosen. There is
a test for each of those, so `cargo test skins` will tell you which half you
forgot.

The description is what Settings shows. Keep it to what somebody would see.

### Or carry one on the cartridge

```
<drive>\.gamepak\skin.css
```

Applied after the named skin, so a cartridge can bring a whole look or adjust
one of the shipped ones. Capped at 256 KB. It is read by the backend and inlined
into the window, so the window never opens a path on the drive.

This is for cartridges you wrote yourself. A stylesheet can restyle the window
that is asking whether to trust the drive it came from — including making Eject
look like Play — so it is a fair trade on your own shelf and a poor one for a
cartridge somebody handed you. The named skins cannot be supplied by a drive,
which is the answer for that case.

---

## Choosing a skin

| | |
|---|---|
| `skin=<name>` in `cartridge.conf` | that cartridge, whatever the machine prefers |
| **Launcher look** in the wizard's Settings | every cartridge with no opinion |
| The ★ in the launcher's corner | cycles live, and remembers the one you stop on |

A cartridge that asks wins, because the cartridge is the thing being shown.

---

## What a skin decides

Three custom properties on `:root`. All optional; saying nothing keeps the stock
behaviour, so a skin that does not care pays nothing.

```css
:root {
  --skin-width: 560;      /* logical px. Default 420 */
  --skin-height: 430;     /* logical px. Default 630 */
  --skin-art: hero;       /* grid | hero | logo | icon. Default grid */
}
```

**Size.** The window resizes itself to match after the stylesheet lands. 420×630
is the shape of a cover, which is right for a skin built around one and wrong
for a skin laid out sideways.

**Artwork.** Which of SteamGridDB's four fills the window. Every game carries all
four and any may be empty, so the launcher falls through: the game's picture of
the kind you asked for, then the cartridge's, then the game's cover, then the
cartridge's, then the game's initials. A row in the list is that game, so it
takes that game's picture of that kind and stops — otherwise a grid of ten
shortcuts is ten copies of one cover.

`icon` is really `autorun.inf`'s and is 256px, so it makes a poor fill. It is on
the list because a skin maker with a reason is better served by having it.

---

## The markup a skin styles

This never changes. A skin cannot add elements, which is what the two owned
layers below are for.

```
#card                        the window
├── #slot                    what is behind the cartridge; seen after Eject
│   ├── #slot-label
│   └── #btn-insert
└── #face                    everything printed on the cartridge
    ├── #plate               the artwork
    │   ├── #cover-img       two layers, so a collection can cross-fade
    │   ├── #cover-img-b
    │   └── #cover-placeholder   shown when there is no picture
    │       ├── #placeholder-initials
    │       └── #placeholder-name
    ├── #skin-chrome         yours. Over the artwork
    ├── #skin-panel          yours. Behind the controls
    ├── #scrim-top           gradients, so type does not depend on the art
    ├── #scrim-bottom
    ├── #cart-mark           a collection's logo, in the corner
    ├── #chrome              the three corner buttons
    │   └── #chrome-actions
    │       ├── #btn-skin        ★ cycles skins
    │       ├── #btn-details     ⓘ  carries .pad-badge
    │       └── #btn-close       ✕
    ├── #stage
    │   ├── #eyebrow
    │   ├── #game-list          the rail. One .game-row per game
    │   ├── #title-logo         printed instead of the title when there is one
    │   ├── #game-title
    │   ├── #notice             why Play is disabled, when it is
    │   └── #button-row
    │       ├── #play-ring > #btn-play    .btn.btn--play
    │       └── #btn-eject                .btn.btn--eject, carries .pad-badge
    ├── #sheet                  the ⓘ panel
    └── #toast
```

A row in `#game-list`, built at runtime:

```
.game-row[aria-selected]
├── .game-row__cover              <img>, or a <span class="game-row__cover--empty">
│                                 holding the game's initials when it has no picture
├── .game-row__body
│   ├── .game-row__title
│   └── .game-row__meta           size, only for a game whose files are on the cartridge
└── .game-row__dot                lit for the selected row
```

### The two layers that are yours

Empty in the stock look, and nothing in them draws itself. Fill them with
pseudo-elements — this is how a skin adds a marquee, a speaker grille, a title
bar or a power lamp without any markup.

```css
#skin-chrome::before { /* over the artwork */ }
#skin-panel::after   { /* behind the controls */ }
```

Both ignore the pointer, so nothing a skin draws can get between somebody and a
button. Do not undo that.

---

## States to style

| Selector | When |
|---|---|
| `.game-row[aria-selected="true"]` | the game Play will start |
| `.btn:disabled` | no executable, or a job is running |
| `.btn--play.is-launching` | between the press and the game appearing |
| `#card.is-collection` | more than one game, so the rail is showing |
| `#card.is-ejected` | the face has ridden out of the slot |
| `#card.is-crossfaded` | the second art layer is in front |
| `#stage.has-logo` | a logo is printed instead of the title |
| `body.is-gamepad` | a controller is connected |
| `.hidden`, `[hidden]` | do not make these visible |

---

## Tokens worth overriding

Defined in `tokens.css`. Redefine on `:root`.

```
--accent  --accent-ink        the one accent, normally sampled from the cover
--radius                      the window's corner
--shell --panel --sunk        surfaces
--ink --ink-2 --ink-3         text
--hairline --hairline-soft    borders
--danger --good               states
--ease                        the shared easing curve
```

`--accent` is re-sampled from each cover at load. A skin whose palette is painted
rather than printed — a CRT's front panel, a HUD — should set it and mean it.

---

## What is not allowed

**No network.** The content security policy is `default-src 'self'`, with images
also permitted from `data:` and steamgriddb.com. So:

- `@import url('https://fonts.googleapis.com/...')` silently loads nothing.
  Bundle a `woff2` next to the two already in `src/fonts/` and `@font-face` it,
  or use `"Archivo"` and `"Spline Sans Mono"`, which are already there.
- No remote background images.

**No markup, no script.** A skin is a stylesheet. If you find yourself needing an
element, use `#skin-chrome` or `#skin-panel`.

**Nothing that makes the launcher unusable.** These are not enforced, and they
are the whole reason a skin is CSS and not a program:

- Do not hide or cover `#btn-play`, `#btn-eject`, `#btn-close` or `#btn-details`.
  If you position `#stage` absolutely, keep it clear of `#chrome` — both are
  `z-index: 3`, and the stage comes later in the markup, so a stage that spans
  the window will swallow every click on the corner buttons.
- Keep a visible focus state. `body.is-gamepad` exists so a controller user can
  see where they are.
- Keep `:disabled` looking disabled.
- Anything that moves should stop under `@media (prefers-reduced-motion: reduce)`.

---

## A minimal skin

```css
:root {
  --skin-width: 480;
  --skin-height: 640;
  --skin-art: hero;
  --accent: oklch(0.7 0.15 300);
  --accent-ink: oklch(0.15 0.03 300);
}

#card { background: oklch(0.1 0.02 300); border-radius: 4px; }

.btn--play { border-radius: 2px; letter-spacing: 0.2em; }

#skin-chrome::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--accent);
}
```

Then add `("mine", "…")` to `SKINS` in `core/src/skins.rs`, rebuild, and pick it
from Settings or the ★.

---

## When it does not work

```
PC_GAMEPAK_DEBUG=1
```

The launcher then writes to `%LOCALAPPDATA%\PC-GamePak\launcher.log`, beside the
watcher's, and says which skin it was asked for, whether the stylesheet was
attached, and what the window resized to. A release build has no devtools and the
window closes on eject, so this is the only way to see inside it.

The eight shipped skins are the other reference. `retro` and `terminal` are the
most conventional, `arcade` moves the most furniture, and `phantom` is the
shortest.
