# Skin examples

Eight worked skins. None of them ship inside the launcher — copy one onto a
cartridge and it wears it:

```
H:\.gamepak\skin.css
```

Then replug the cartridge. [`../SKINNING.md`](../SKINNING.md) is the reference:
the elements a skin styles, the two layers it owns, the states, and what the
content security policy forbids.

| File | |
|---|---|
| [`luna.css`](luna.css) | Explorer, about 2003: a title bar, a white pane, no artwork at all |
| [`retro.css`](retro.css) | A wood-grain television — a screen set into a cabinet, knobs and lamps |
| [`cyberpunk.css`](cyberpunk.css) | Wide and split: titles down the left, the hero filling the right |
| [`phantom.css`](phantom.css) | Black and gold, a hero band over a two-up grid, and nothing else |
| [`desktop.css`](desktop.css) | Games as a grid of shortcuts, with a taskbar |
| [`arcade.css`](arcade.css) | A cabinet: scanlines, a marquee, and the games run sideways |
| [`cozy.css`](cozy.css) | Cream and rounded: the light one, artwork kept out of it |
| [`bigpicture.css`](bigpicture.css) | A hero behind, covers along the bottom, the logo in front |

They are deliberately not variations on a palette. They differ in the window's
size, in the shape of the list — a column, a sideways strip, a grid — in which
of the four artworks they ask for in each of the three places one can go, and in
whether the launcher looks like a poster, a file window or an appliance.

The clearest single tell is what happens when a button is pressed: `retro` sinks
into moulded plastic, `arcade` drops a dome onto its own coloured base,
`cyberpunk` lights a cut corner, and `cozy` barely moves. Eject is a square, a
wide bar, a circle and a hardware key across them.

## Trying one without a cartridge

The launcher runs in a browser with a sample cartridge, which is a faster loop
than writing a drive:

```bash
python -m http.server 8731        # from the repository root
```

```
localhost:8731/tauri-ui/app/index.html?drive=D:\&state=bundle&skin=retro
```

`&skin=` hands the launcher that file as if the cartridge were carrying it, so
this is the same path a real drive takes. `&state=bundle` gives you a collection
so the list is real. Edit the file and reload.
