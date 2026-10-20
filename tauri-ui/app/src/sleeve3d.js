/**
 * A cartridge's sleeve as a box in 3D: the PC GamePak sleeve CoverForge prints,
 * 71.5 by 101 mm with 16 mm sides, built from CSS faces so it can turn.
 *
 * Each face is the sleeve kit's picture when the cartridge carries one (see
 * core/src/sleeve.rs), and otherwise drawn here from what every cartridge has:
 * the cover on the front, and on each side the sleeve's own spine — the colour
 * stripes at the open end, a PC badge, the title running down it. A kit that
 * carries a finished render of the whole box (`box.png`) is shown as that
 * picture instead, which is what CoverForge's own 3D view made.
 *
 * Nothing on a drawn face is invented: no rating unless the kit gives one, no
 * back cover text unless it has one. Sizes are in `--h`; the rest follow.
 */

/** The six colour bars of the PC-GAMEPAK mark, from CoverForge's gamepak.ts. */
export const STRIPES = ["#e83246", "#f78c1e", "#facd28", "#3cb95a", "#1e96eb", "#8c50c8"];

/** PEGI label colours, from CoverForge's gamepak.ts. */
const PEGI = { 3: "#56b947", 7: "#56b947", 12: "#f6a41b", 16: "#f6a41b", 18: "#e2001a" };

/** Only pictures the backend inlined, or the preview's own art. */
function safeArt(src) {
  return typeof src === "string" && /^(data:image\/|src\/)/.test(src) ? src : "";
}

function art(src) {
  // Absolute: a url() in a custom property resolves against the stylesheet.
  return `url("${new URL(src, document.baseURI).href}")`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function stripes() {
  const band = el("span", "sv__stripes");
  for (const colour of STRIPES) {
    const bar = el("i");
    bar.style.background = colour;
    band.append(bar);
  }
  return band;
}

function pegi(rating) {
  if (!PEGI[rating]) return null;
  const label = el("span", "sv__pegi", rating);
  label.style.background = PEGI[rating];
  label.setAttribute("aria-label", `PEGI ${rating}`);
  return label;
}

/** A side drawn from the title, when the kit has no picture for it. */
function drawnSpine(title, rating) {
  const face = el("span", "sv__drawn-spine");
  face.append(stripes(), el("span", "sv__pc", "PC"), el("span", "sv__spine-title", title));
  const label = pegi(rating);
  if (label) face.append(label);
  return face;
}

/**
 * The box. `item` is what the cartridge or the library knows:
 * `{ title, cover, sleeve }`, where `sleeve` is the backend's Sleeve or null.
 */
export function buildSleeve(item) {
  const sleeve = item.sleeve ?? {};
  const title = item.title || "";
  const wrap = el("div", "sv");
  const render = safeArt(sleeve.boxRender);
  if (render) {
    // CoverForge's own render of the box: a picture, already in 3D.
    wrap.classList.add("is-render");
    const img = el("img", "sv__render");
    img.src = render;
    img.alt = "";
    img.decoding = "async";
    wrap.append(img);
    return wrap;
  }

  const box = el("div", "sv__box");
  const front = safeArt(sleeve.front) || safeArt(item.cover);
  const faces = {
    // Drawn back to front, so a webview that paints 3D flattened still shows
    // the front on top.
    back: safeArt(sleeve.back),
    right: safeArt(sleeve.spineRight),
    left: safeArt(sleeve.spine),
    top: "",
    bottom: "",
    front,
  };
  for (const [name, src] of Object.entries(faces)) {
    const face = el("span", `sv__face sv__face--${name}`);
    if (src) face.style.setProperty("--art", art(src));
    else if (name === "front") face.append(el("span", "sv__initials", initials(title)));
    else if (name === "left" || name === "right") face.append(drawnSpine(title, sleeve.rating));
    else if (name === "back") face.classList.add("is-plain");
    box.append(face);
  }
  wrap.append(box, el("span", "sv__shadow"));
  return wrap;
}

function initials(title) {
  return (title || "")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}
