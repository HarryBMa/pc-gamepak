/**
 * The memory card as a thing, built from CSS faces so it can turn (styles in
 * objects.css).
 *
 * The shape is a memory card's: 24 by 32, an SD card's proportions, with the
 * top right corner cut off and every edge, the cut one included, a face of its
 * own, so it has a real thickness from any side. On the front: the PC-GAMEPAK
 * mark over a moulded grip, a label window, the gold contacts, and CoverForge's
 * holographic PC-GAMEPAK sticker, which shimmers.
 *
 * There are two of them. The drive's own card (`kind: "drive"`) has the set's
 * label: the planet, the colour bars, MEMORY CARD, and a plate for what the
 * caller has to say about it (TV mode its name, the popup its size). A save
 * (`kind: "save"`) is a card of its own, with its game's art and name on the
 * label: on a console every save was a block on a card; here every save is a
 * card. Nothing is put on a label that the caller did not give: no art, no
 * art; no plate text, no plate.
 */

import { STRIPES } from "./sleeve3d.js";

const HOLO = new URL("objects/gp-holo.svg", import.meta.url).href;
const PLANET = new URL("objects/gp-planet.svg", import.meta.url).href;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Only pictures the backend inlined, or the preview's own art. */
function safeArt(src) {
  return typeof src === "string" && /^(data:image\/|src\/)/.test(src) ? src : "";
}

function mark() {
  const bars = el("span", "mcard__mark");
  for (const colour of STRIPES) {
    const bar = el("i");
    bar.style.background = colour;
    bars.append(bar);
  }
  return bars;
}

function initials(title) {
  return (title || "")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}

/** The drive's label: the set's planet over the colour bars, and the word. */
function driveLabel(plate) {
  const label = el("span", "mcard__label mcard__label--drive");
  const planet = el("img", "mcard__planet");
  planet.src = PLANET;
  planet.alt = "";
  const word = el("span", "mcard__word");
  word.append("Memory", el("br"), el("span", "", "Card"));
  label.append(el("span", "mcard__bars"), planet, word, el("span", "mcard__plate", plate));
  return label;
}

/** A save's label: its game's art, and its name along the foot. */
function saveLabel(art, title) {
  const label = el("span", "mcard__label mcard__label--save");
  const src = safeArt(art);
  // Absolute: a url() in a custom property resolves against the stylesheet.
  if (src) label.style.setProperty("--art", `url("${new URL(src, document.baseURI).href}")`);
  else label.append(el("span", "mcard__initials", initials(title)));
  if (title) label.append(el("span", "mcard__title", title));
  return label;
}

/**
 * The card. Its width is `--cw` on the returned element; the rest follows.
 * `kind` is "drive" or "save"; `art` and `title` are a save's game, `plate`
 * the drive's line.
 */
export function buildMemoryCard({ kind = "drive", art = "", title = "", plate = "" } = {}) {
  const card = el("div", `mcard mcard--${kind}`);
  const slab = el("div", "mcard__slab");
  // The front last: if 3D is ever painted flattened, it is the face on top.
  for (const name of ["back", "left", "bottom", "right", "cut", "top", "front"]) {
    slab.append(el("div", `mcard__face mcard__face--${name}`));
  }
  const front = slab.lastElementChild;

  const head = el("span", "mcard__head");
  head.append(mark(), document.createTextNode("PC-GAMEPAK"));
  const grip = el("span", "mcard__grip");
  const sticker = el("span", "mcard__sticker");
  const img = el("img");
  img.src = HOLO;
  img.alt = "";
  // The foil, through the sticker's own shape (the same shimmer as a sleeve's).
  const foil = el("span", "sv__foil sv__foil--glitter");
  foil.style.setProperty("--mask", `url("${HOLO}")`);
  sticker.append(img, foil);
  const pins = el("span", "mcard__pins");
  for (let i = 0; i < 8; i += 1) pins.append(el("i"));

  front.append(
    head,
    grip,
    kind === "save" ? saveLabel(art, title) : driveLabel(plate),
    sticker,
    pins,
  );
  front.setAttribute("aria-hidden", "true");
  card.append(slab);
  return card;
}

/** Change what the drive card's plate says; empty takes the plate off. */
export function setPlate(card, text) {
  const plate = card.querySelector(".mcard__plate");
  if (plate) plate.textContent = text || "";
}
