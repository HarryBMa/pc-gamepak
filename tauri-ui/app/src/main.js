/**
 * PC GamePak — main.js
 *
 * Reads the drive path from the query string (?drive=D%3A%5C), asks the Rust
 * backend what is on the cartridge, and wires up Play and Eject.
 *
 * Backend contract (src-tauri/src/main.rs):
 *   parse_cartridge({ drivePath })            -> { title, cover, cover_path, background, logo, executable, drive_path }
 *   launch_game({ executable, drivePath })    -> ()
 *   eject_drive({ drivePath })                -> ()
 *   focus_window()                            -> ()
 *   debug_logging() / debug_log(line)         -> diagnostics, off by default
 *   get_settings() / set_settings(settings)   -> Settings
 *   list_skins()                              -> [(name, description)]
 *   can_eject({ drivePath })                  -> bool
 *   cartridge_health({ drivePath })           -> { link, transport, label, filesystem, usedPercent, warnings[] }
 *
 * `cover` arrives as a data URI already. There is no command that takes a path
 * to read, so the webview cannot ask the backend for arbitrary files.
 *
 * All cartridge-supplied text is written with textContent. The title and paths
 * come off an untrusted volume and must never be able to inject markup.
 */

import { connect as connectGamepad } from "./gamepad.js";

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke ?? demoInvoke;

const el = {
  card: document.getElementById("card"),
  face: document.getElementById("face"),
  slot: document.getElementById("slot"),
  slotLabel: document.getElementById("slot-label"),
  insert: document.getElementById("btn-insert"),
  skin: document.getElementById("skin"),
  cartSkin: document.getElementById("cart-skin"),
  btnSkin: document.getElementById("btn-skin"),
  cover: document.getElementById("cover-img"),
  coverB: document.getElementById("cover-img-b"),
  placeholder: document.getElementById("cover-placeholder"),
  placeholderInitials: document.getElementById("placeholder-initials"),
  placeholderName: document.getElementById("placeholder-name"),
  eyebrow: document.getElementById("eyebrow"),
  titleLogo: document.getElementById("title-logo"),
  cartMark: document.getElementById("cart-mark"),
  title: document.getElementById("game-title"),
  stage: document.getElementById("stage"),
  notice: document.getElementById("notice"),
  play: document.getElementById("btn-play"),
  playLabel: document.querySelector("#btn-play .btn__label"),
  eject: document.getElementById("btn-eject"),
  close: document.getElementById("btn-close"),
  details: document.getElementById("btn-details"),
  openWizard: document.getElementById("btn-open-wizard"),
  openSettings: document.getElementById("btn-open-settings"),
  sheet: document.getElementById("sheet"),
  sheetClose: document.getElementById("btn-sheet-close"),
  sheetBack: document.getElementById("btn-sheet-back"),
  sheetThumb: document.getElementById("sheet-thumb"),
  sheetTitle: document.getElementById("sheet-title"),
  sheetSub: document.getElementById("sheet-sub"),
  readings: document.getElementById("readings"),
  specs: document.getElementById("specs"),
  paths: document.getElementById("paths"),
  pathsFold: document.getElementById("paths-fold"),
  pathsToggle: document.getElementById("btn-paths"),
  pathsLabel: document.getElementById("paths-label"),
  toast: document.getElementById("toast"),
  gameList: document.getElementById("game-list"),
};

let cartridge = null;
/** The connection is only looked at once, and only if the sheet is opened. */
let healthAsked = false;

/* ==========================================================================
   Accent colour, sampled from the cover art
   ========================================================================== */

/** WCAG relative luminance from 8-bit sRGB. */
function luminance(r, g, b) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** The label contrast of an accent at lightness `l`, with the better ink. */
function inkFor(h, s, l) {
  const accentLum = luminance(...hslToRgb(h, s, l));
  const dark = contrast(accentLum, luminance(...hslToRgb(h, 0.22, 0.11)));
  const light = contrast(accentLum, luminance(...hslToRgb(h, 0.12, 0.97)));
  return dark >= light
    ? { ratio: dark, ink: `hsl(${h.toFixed(0)} 22% 11%)` }
    : { ratio: light, ink: `hsl(${h.toFixed(0)} 12% 97%)` };
}

/**
 * Apply an accent and pick the ink that sits on it.
 *
 * Play is the only filled surface in the window, so its label has to stay
 * readable whatever colour the artwork happens to be: dark ink wins on ambers
 * and greens, near-white on deep blues and reds.
 *
 * Choosing the better of the two inks is not enough by itself. At the sampler's
 * preferred lightness the best ink still measures about 4.0:1 on deep blues,
 * purples and crimsons — under AA for a 12px uppercase label, and those are
 * exactly the colours game covers are made of. Rather than give up the sampled
 * colour and fall back to a stock amber, the hue and saturation stay as the
 * artwork gave them and only the lightness moves, the smallest step first,
 * until the measurement clears. The target carries a little headroom because
 * the button paints a gradient over this colour.
 */
function setAccent(h, s, preferred) {
  const TARGET = 4.6;
  const root = document.documentElement.style;

  let best = { lightness: preferred, ...inkFor(h, s, preferred) };

  for (let step = 0.02; best.ratio < TARGET && step <= 0.34; step += 0.02) {
    for (const l of [preferred - step, preferred + step]) {
      if (l < 0.3 || l > 0.9) continue;
      const candidate = inkFor(h, s, l);
      if (candidate.ratio > best.ratio) best = { lightness: l, ...candidate };
      if (best.ratio >= TARGET) break;
    }
  }

  root.setProperty(
    "--accent",
    `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(best.lightness * 100).toFixed(1)}%)`,
  );
  root.setProperty("--accent-ink", best.ink);
}

/**
 * Pick the colour a person would name if asked to describe the cover.
 *
 * A flat average of any cover is mud, so each pixel is weighted by its own
 * saturation squared, biased toward the lit areas. Hues are summed as vectors
 * so reds either side of 0° do not cancel out.
 */
function sampleAccent(img) {
  const SIZE = 48;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  // Read once, so the CPU-backed canvas that willReadFrequently asks for would
  // cost the draw and buy nothing back.
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  let data;
  try {
    data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return; // tainted canvas: keep the default accent
  }

  let x = 0;
  let y = 0;
  let satSum = 0;
  let weight = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.06) continue; // greys carry no hue
    if (l < 0.08 || l > 0.95) continue; // crushed and blown pixels lie about hue

    const s = d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);

    const w = s * s * (0.3 + l);
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
    satSum += s * w;
    weight += w;
  }

  if (weight === 0) return; // a greyscale cover keeps the default

  const hue = (Math.atan2(y, x) * 180) / Math.PI;
  // Floor the saturation and hold the lightness out of the pastel range so the
  // sampled accent always has enough body to carry a button.
  const saturation = Math.min(Math.max(satSum / weight, 0.72), 0.9);
  setAccent(hue, saturation, 0.575);
}

/* ==========================================================================
   The slot, and the cartridge seated in it
   ========================================================================== */

/** How long the face takes to leave or enter the slot; matches style.css. */
const SEAT_MS = 620;

/**
 * Show what is behind the cartridge.
 *
 * The empty slot is not decoration: it is what the window has to say when
 * there is no readable cartridge to show, and what Eject leaves behind. The
 * label carries the reason, so nothing has to be explained twice.
 */
function showSlot(label, action) {
  el.slotLabel.textContent = label;
  if (action) {
    el.insert.textContent = action.label;
    el.insert.hidden = false;
    el.insert.onclick = action.onClick;
  } else {
    el.insert.hidden = true;
    el.insert.onclick = null;
  }
  el.card.classList.add("is-ejected");
  // Nothing on the face is reachable once it has left the slot.
  el.face.inert = true;
}

/** Seat the cartridge: the entrance, mirroring the insert that just happened. */
function seat() {
  el.face.inert = false;
  el.card.classList.remove("is-ejected");
}

/* ==========================================================================
   Details sheet
   ========================================================================== */

function specRow(list, label, value, muted = false) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  // Mount points and launch targets are what people paste into a terminal or a
  // bug report, so they opt out of the window-wide selection ban.
  dd.classList.add("selectable");
  if (muted) dd.classList.add("is-muted");
  const row = document.createElement("div");
  row.append(dt, dd);
  list.append(row);
}

/**
 * A reading, with its advisory folded behind its own icon.
 *
 * The two things the sheet is opened for are whether the link is healthy and
 * whether the drive is nearly full. Everything that explains a reading belongs
 * to that reading, not to a block of prose under the whole sheet, so it hides
 * behind the icon on the card it is about and the sheet stays quiet until it
 * is asked why.
 */
function reading({ label, value, unit, note, fill, advisory, icon }) {
  const card = document.createElement("div");
  card.className = "reading";

  const head = document.createElement("div");
  head.className = "reading__head";
  const labelEl = document.createElement("p");
  labelEl.className = "reading__label";
  labelEl.textContent = label;
  head.append(labelEl);

  let box;
  if (advisory) {
    const why = document.createElement("button");
    why.className = "reading__why";
    why.type = "button";
    why.setAttribute("aria-expanded", "false");
    why.setAttribute("aria-label", `Why ${label.toLowerCase()} matters`);
    why.title = "Why this matters";
    why.innerHTML = icon === "warn"
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="11" height="11" aria-hidden="true"><path d="M8 2.6L14.6 13.4H1.4z" /><path d="M8 6.6v3.1M8 11.6v.1" /></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="6.4" /><path d="M8 5.1v.1M8 7.4v3.6" /></svg>';
    head.append(why);

    box = document.createElement("div");
    box.className = "reading__advisory";
    const p = document.createElement("p");
    // The lead is the reading restated; the rest is why it matters.
    const lead = document.createElement("strong");
    lead.textContent = advisory.lead;
    p.append(lead, ` ${advisory.body}`);
    box.append(p);

    why.addEventListener("click", () => {
      const open = box.classList.toggle("is-open");
      why.setAttribute("aria-expanded", String(open));
    });
  }

  card.append(head);

  const valueEl = document.createElement("p");
  valueEl.className = "reading__value";
  valueEl.textContent = value;
  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.className = "reading__unit";
    unitEl.textContent = ` ${unit}`;
    valueEl.append(unitEl);
  }
  card.append(valueEl);

  if (note) {
    const noteEl = document.createElement("p");
    noteEl.className = "reading__note";
    noteEl.textContent = note;
    card.append(noteEl);
  }

  if (typeof fill === "number") {
    const bar = document.createElement("div");
    bar.className = "reading__bar";
    const inner = document.createElement("div");
    inner.className = "reading__fill";
    inner.style.width = `${Math.max(0, Math.min(100, fill))}%`;
    bar.append(inner);
    card.append(bar);
  }

  if (box) card.append(box);
  return card;
}

/** Split "9.7 GB" into the number and its unit, so the number can be set large. */
function splitMeasure(text) {
  const match = /^(\S+)\s*(.*)$/.exec(text ?? "");
  return match ? { value: match[1], unit: match[2] } : { value: text ?? "—", unit: "" };
}

function renderIdentity(info) {
  el.sheetTitle.textContent = info.title || "Cartridge";
  if (info.cover) {
    el.sheetThumb.src = info.cover;
    el.sheetThumb.hidden = false;
  } else {
    el.sheetThumb.hidden = true;
    el.sheetThumb.removeAttribute("src");
  }
}

/**
 * The paths. Least-read thing on the sheet, so they start folded.
 *
 * A collection carries one launch target per game rather than one for the
 * cartridge, so the list says exactly what each row of the rail starts.
 */
function renderPaths(info) {
  el.paths.replaceChildren();
  const games = info.games ?? [];

  if (games.length > 1) {
    for (const game of games) {
      specRow(el.paths, game.title || "Untitled", game.executable || "nothing configured", !game.executable);
    }
  } else {
    specRow(el.paths, "Launch", info.executable || "nothing configured", !info.executable);
  }

  specRow(el.paths, "Drive", info.drive_path || "—", !info.drive_path);
  specRow(el.paths, "Cover", info.cover_path || "none found", !info.cover_path);
}

function togglePaths(open) {
  // The fold opens; the list inside it only holds the rows.
  const next = open ?? !el.pathsFold.classList.contains("is-open");
  el.pathsFold.classList.toggle("is-open", next);
  el.pathsFold.hidden = !next;
  el.pathsToggle.setAttribute("aria-expanded", String(next));
  el.pathsLabel.textContent = next ? "Hide file paths" : "Show file paths";
}

/**
 * How the cartridge is connected, filled in after the sheet is open.
 *
 * Three things decide whether a cartridge performs like the drive inside it —
 * the negotiated link, UASP or BOT, and how full it is — and none of them are
 * visible anywhere else. Asked for lazily: on Windows this shells out, and the
 * launcher opening late is worse than the sheet filling in late.
 */
async function renderHealth() {
  if (!cartridge?.drive_path || healthAsked) return;
  healthAsked = true;

  let health;
  try {
    health = await invoke("cartridge_health", { drivePath: cartridge.drive_path });
  } catch {
    return; // the sheet is still useful without it
  }

  // The drive's own name, so the sheet says which cartridge this is without
  // anyone reading a mount path.
  const marks = [health.label, health.filesystem].filter(Boolean);
  el.sheetSub.textContent = marks.join(" · ");

  const cards = [];

  if (health.link) {
    const { value, unit } = splitMeasure(health.link);
    const slow = typeof health.linkMbps === "number" && health.linkMbps < 10_000;
    cards.push(
      reading({
        label: "Link",
        value,
        unit,
        note: health.transport || undefined,
        icon: slow ? "warn" : "info",
        advisory: advisoryForLink(health),
      }),
    );
  }

  if (health.totalBytes > 0) {
    const { value, unit } = splitMeasure(formatBytes(health.freeBytes));
    cards.push(
      reading({
        label: "Free",
        value,
        unit,
        fill: health.usedPercent,
        icon: "warn",
        advisory: advisoryForSpace(health),
      }),
    );
  }

  el.readings.replaceChildren(...cards);
}

/**
 * The link advisory, rewritten for a card rather than a paragraph.
 *
 * The backend's `warnings` are full sentences meant to stand alone. Here the
 * reading is already on screen directly above, so the lead restates it in three
 * words and the body is only the part the number cannot say.
 */
function advisoryForLink(health) {
  if (typeof health.linkMbps === "number" && health.linkMbps < 1000) {
    return {
      lead: "USB 2.0 port or cable.",
      body: "Games will stream badly. Try a different port, and the cable the enclosure came with.",
    };
  }
  if (typeof health.linkMbps === "number" && health.linkMbps < 10_000) {
    return {
      lead: "About half what the enclosure can do.",
      body: "Usually a front-panel port, a hub, or a cable that is not rated for 10 Gbps.",
    };
  }
  if (health.transport === "BOT") {
    return {
      lead: "One command at a time.",
      body: "UASP would queue them — worth 2–3× on the small random reads a game streams. A different port or enclosure usually fixes it.",
    };
  }
  return null;
}

function advisoryForSpace(health) {
  if (health.usedPercent < 85) return null;
  return {
    lead: `${health.usedPercent}% full.`,
    body: "No DRAM of its own and no host memory over USB, so the last 15% costs more than it looks like. Leaving room back keeps random reads quick.",
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function toggleSheet(open) {
  const next = open ?? !el.sheet.classList.contains("is-open");
  if (next) renderHealth();
  el.sheet.classList.toggle("is-open", next);
  el.sheet.hidden = !next;
  el.details.setAttribute("aria-expanded", String(next));

  // The sheet is opaque and covers the card, but Play and Eject stay in the tab
  // order behind it unless they are made inert — and a Play button you cannot
  // see is a game launched from what looks like a details screen. The toast is
  // left reachable so a message that arrives underneath can still be read.
  for (const node of el.card.children) {
    if (node !== el.sheet && node !== el.toast) node.inert = next;
  }

  // preventScroll matters here: #card has overflow:hidden, which makes it a
  // scroll container, and focusing the sheet while it is still translated
  // off-screen would scroll the whole card up to reveal it.
  if (next) el.sheetClose.focus({ preventScroll: true });
  else el.details.focus({ preventScroll: true });
  el.card.scrollTop = 0;
}

/* ==========================================================================
   Status
   ========================================================================== */

let toastTimer;

/**
 * Say something, briefly.
 *
 * Confirmations leave on their own. An error does not: a failed launch is the
 * one message in this window a person needs to read twice, and 3.4 seconds is
 * gone before a slow reader reaches the end of it. It waits for a click, for
 * Escape, or for whatever happens next.
 */
function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("is-error", isError);
  el.toast.classList.toggle("is-sticky", isError);
  el.toast.classList.add("is-on");
  clearTimeout(toastTimer);
  if (!isError) {
    toastTimer = setTimeout(() => el.toast.classList.remove("is-on"), 3400);
  }
}

function dismissToast() {
  clearTimeout(toastTimer);
  el.toast.classList.remove("is-on", "is-sticky");
}

el.toast.addEventListener("click", dismissToast);

/**
 * Whether this cartridge is on a drive at all.
 *
 * A tag is a cartridge that never moves: it resolves to a directory on this
 * machine, so there is nothing to unmount and no button to offer. The backend
 * refuses the command as well — this only keeps the window honest.
 */
let ejectable = true;

function setBusy(busy) {
  el.play.disabled = busy || !playable();
  el.eject.disabled = busy || !cartridge || !ejectable;
  if (el.gameList && !el.gameList.hidden) {
    for (const row of el.gameList.querySelectorAll(".game-row")) {
      row.setAttribute("aria-disabled", String(busy));
    }
  }
}

async function closeWindow() {
  if (tauri?.window) await tauri.window.getCurrentWindow().close();
}

/**
 * Get out of the way of the game without ending the session.
 *
 * Closing here used to be right: the launcher had said everything it had to
 * say. But Eject is on this window, and quitting a game is exactly when a
 * person wants it — so closing meant unplugging the cartridge and plugging it
 * back in to reach the button that exists to make that unnecessary.
 *
 * Always-on-top goes with it. It is there so the popup lands in front of
 * whatever is running; keeping it while a game is running would put the
 * launcher over the game the moment anything restored it.
 */
async function standAside() {
  if (!tauri?.window) return;
  const self = tauri.window.getCurrentWindow();
  try {
    await self.setAlwaysOnTop(false);
  } catch {
    // Older webview, or a platform without it. Minimising still works.
  }
  await self.minimize();
  resetPlay();
}

/* ==========================================================================
   The rail: which game Play acts on
   ========================================================================== */

/** Index into cartridge.games; 0 for a single game. */
let selected = 0;

/** Which layer is currently showing, so the other one can take the next art. */
let coverFront = true;

function games() {
  return cartridge?.games ?? [];
}

function isCollection() {
  return Boolean(cartridge?.is_bundle) && games().length > 0;
}

function currentGame() {
  return isCollection() ? games()[selected] : cartridge;
}

function playable() {
  return Boolean(currentGame()?.executable);
}

/**
 * Move the selection.
 *
 * A collection has one Play, and it acts on whatever the rail has picked — so
 * picking a game is what changes the artwork, the title and what Play will
 * start. Giving every row its own button made the window a list of buttons;
 * this makes it a cartridge with a side selected.
 */
function select(index) {
  const list = games();
  if (index < 0 || index >= list.length || index === selected) return;
  selected = index;

  for (const row of el.gameList.querySelectorAll(".game-row")) {
    row.setAttribute("aria-selected", String(Number(row.dataset.index) === index));
  }

  el.gameList
    .querySelector(`.game-row[data-index="${index}"]`)
    ?.scrollIntoView({ block: "nearest" });

  const game = list[index];
  setGameTitle(game.title);
  const art = artFor(game);
  if (art) crossfadeCover(art);
  else showPlaceholder(game);
  setBusy(false);
}


/**
 * Move the selection by one, wrapping.
 *
 * What up and down do on a pad. Wraps because a list of three on a television
 * is a ring, not a form: pressing up on the first game should reach the last
 * one rather than stop.
 */
function step(delta) {
  const list = games();
  if (list.length < 2) return;
  select((selected + delta + list.length) % list.length);
}

/**
 * The picture that fills the window, for whichever game is showing.
 *
 * Which of the four a skin wants is the skin's to say, because it depends on
 * the shape it chose — a hero was tried here once and taken back out, since one
 * wants a window three times as wide as a cartridge is and there was only one
 * window. All four are on offer, the icon included: it exists for autorun.inf
 * and makes a poor fill at 256px, but it is a skin maker's to misuse if they
 * have a reason. Anything unrecognised gets the grid.
 *
 *   :root { --skin-art: hero; }
 *
 * The game's own picture is preferred over the cartridge's, then the game's
 * cover, then the cartridge's — so somebody filling in heroes for ten games and
 * leaving the rest empty gets exactly what they asked for, and somebody who
 * filled in none still gets a cartridge that looks like something.
 */
function artFor(game) {
  const wanted = getComputedStyle(document.documentElement)
    .getPropertyValue("--skin-art")
    .trim();

  const pick = (from) =>
    from && ({ hero: from.background, logo: from.logo, icon: from.icon }[wanted] || "");

  return (
    pick(game) || pick(cartridge) || game?.cover || cartridge?.cover || ""
  );
}

/**
 * Say which game it is when there is no picture for it.
 *
 * Initials rather than a generic icon. Ten games under a skin that wants heroes
 * with three heroes filled in is seven blank frames, and seven frames that each
 * say which game they are is a cartridge somebody can still use.
 */
function showPlaceholder(game) {
  const title = game?.title || cartridge?.title || "";
  const initials = title
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 3)
    .map((word) => [...word][0].toUpperCase())
    .join("");

  el.placeholderInitials.textContent = initials;
  el.placeholderName.textContent = title;
  el.cover.hidden = true;
  el.coverB.hidden = true;
  el.placeholder.classList.remove("hidden");
}

/** Bring the next game's art up behind the current one, then swap. */
function crossfadeCover(src) {
  const incoming = coverFront ? el.coverB : el.cover;
  incoming.hidden = false;
  incoming.src = src;
  coverFront = !coverFront;
  el.card.classList.toggle("is-crossfaded", !coverFront);

  // The accent belongs to the art that is showing. It was sampled once, at
  // startup, from whichever game loaded first — so on a collection Play kept
  // that game's colour however far down the rail you went, and if the first
  // cover was too grey to sample it kept the stock amber for ever.
  const resample = () => sampleAccent(incoming);
  if (incoming.complete && incoming.naturalWidth > 0) resample();
  else incoming.addEventListener("load", resample, { once: true });
}

function renderRail(list) {
  el.gameList.replaceChildren();

  list.forEach((game, index) => {
    const row = document.createElement("li");
    row.className = "game-row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === selected));
    row.tabIndex = 0;
    row.dataset.index = String(index);

    const img = document.createElement("img");
    img.className = "game-row__cover";
    img.alt = "";
    if (game.cover) img.src = game.cover;

    const body = document.createElement("span");
    body.className = "game-row__body";
    const titleEl = document.createElement("span");
    titleEl.className = "game-row__title";
    titleEl.textContent = game.title || "Unknown game";
    const meta = document.createElement("span");
    meta.className = "game-row__meta";
    // Only a game whose files are actually on the cartridge has a size worth
    // printing; a key that points at an installed copy takes no room.
    meta.textContent = game.sizeBytes ? formatBytes(game.sizeBytes) : "";
    body.append(titleEl, meta);

    const dot = document.createElement("span");
    dot.className = "game-row__dot";
    dot.setAttribute("aria-hidden", "true");

    row.append(img, body, dot);
    row.addEventListener("click", () => select(index));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(index);
      }
    });
    el.gameList.append(row);
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

/**
 * Which cartridge this window is for.
 *
 * Inside Tauri the answer comes from the backend, which has the `--drive`
 * argument it was started with. The query string is only for the browser
 * preview, where there is no backend to ask.
 */
async function resolveDrivePath() {
  if (tauri) {
    try {
      const fromArgs = await invoke("drive_path");
      if (fromArgs) return fromArgs;
    } catch {
      // fall through to the query string
    }
  }
  return new URLSearchParams(location.search).get("drive") ?? "";
}

/**
 * There is nothing to show.
 *
 * The window stays a slot rather than a cartridge with an error printed on it:
 * an unreadable cartridge is an empty slot, and saying so in the slot's own
 * label needs no second explanation underneath.
 */
function fail(headline, detail) {
  el.card.classList.add("is-blocked");
  showSlot(headline, { label: "Close", onClick: closeWindow });
  toast(`${detail} Close this window, reconnect the cartridge, and try again.`, true);
}

/** The name printed under the mark. A collection repoints it on every pick. */
function setGameTitle(title) {
  const safeTitle = title || "Unknown game";
  el.title.textContent = safeTitle;
  el.title.classList.toggle("is-long", safeTitle.length > 15);
}

/**
 * Print the cartridge's mark and the name under it.
 *
 * `logoOf` is what separates a single game from a collection. A single game's
 * logo *is* its title, so it stands in for the heading rather than repeating
 * the name underneath itself — that is what `null` means. A collection's mark
 * names the collection, so the heading below it has to stay: it is the only
 * thing that says which game the rail has picked.
 */
function renderTitle(title, logo, logoOf = null) {
  setGameTitle(title);

  if (!el.titleLogo) return;
  if (logo && String(logo).startsWith("data:image/")) {
    el.titleLogo.src = logo;
    el.titleLogo.alt = `${logoOf ?? title ?? "Unknown game"} logo`;
    el.titleLogo.hidden = false;
    el.stage?.classList.toggle("has-logo", logoOf === null);
    return;
  }

  el.titleLogo.hidden = true;
  el.titleLogo.removeAttribute("src");
  el.titleLogo.alt = "";
  el.stage?.classList.remove("has-logo");
}

async function init() {
  // The window opens on an empty slot and the cartridge seats into it, which is
  // the insert that has just happened in the user's hand.
  el.card.classList.add("is-ejected");
  el.face.inert = true;

  const drivePath = await resolveDrivePath();

  if (!drivePath) {
    fail("No cartridge", "The launcher was started without a --drive path.");
    await showWindow();
    return;
  }

  try {
    cartridge = await invoke("parse_cartridge", { drivePath });
  } catch (error) {
    fail("Unreadable", String(error));
    await showWindow();
    return;
  }

  // Before the window is shown, so the cartridge never appears in the stock
  // look and then changes its mind a frame later.
  wearSkin(cartridge.skin, cartridge.skin_css ?? "");

  // A tag has no drive behind it, so Eject goes away rather than failing when
  // pressed. If the backend cannot answer, assume there is a drive: an old
  // build that does not know the command should keep the button it had.
  try {
    ejectable = Boolean(await invoke("can_eject", { drivePath }));
  } catch {
    ejectable = true;
  }
  if (!ejectable) el.eject.hidden = true;

  // A collection's mark names the collection, so the heading under it stays
  // free to name whichever game the rail has picked.
  const collected = isCollection();
  // On a single game the logo *is* the title, printed instead of it. On a
  // collection it belongs to the cartridge rather than to whichever game is
  // selected — printing it over each one put Mirror's Edge's logo across
  // Hollow Knight — so it becomes a small mark in the corner and the heading
  // goes back to naming the game.
  renderTitle(
    collected ? games()[0]?.title ?? cartridge.title : cartridge.title,
    collected ? null : cartridge.logo,
    null,
  );
  if (collected && cartridge.logo) {
    el.cartMark.src = cartridge.logo;
    el.cartMark.alt = `${cartridge.title || "Collection"} logo`;
    el.cartMark.hidden = false;
  }
  renderIdentity(cartridge);
  renderSpecs(cartridge);
  renderPaths(cartridge);

  // A collection: the cartridge's own name goes above, the rail picks which
  // game the one Play acts on, and the title becomes the selected game.
  if (collected) {
    el.card.classList.add("is-collection");
    // The mark in the corner already prints the collection's name. The eyebrow
    // only stands in when there is no mark to print it — otherwise the window
    // says "Tomb Raider Collection" twice, once as a picture and once as type.
    const marked = !el.cartMark.hidden;
    el.eyebrow.hidden = marked;
    if (!marked) el.eyebrow.textContent = cartridge.title || "Collection";
    el.gameList.hidden = false;
    renderRail(games());
  }

  if (!playable()) {
    el.card.classList.add("is-blocked");
    el.notice.hidden = false;
    el.notice.textContent =
      "No executable set in cartridge.conf, so there is nothing to play. Eject is still available.";
  }

  const launcherArt = artFor(currentGame());
  if (launcherArt) await showCover(launcherArt);
  else showPlaceholder(currentGame());

  setBusy(false);
  await showWindow();
  seat();
  // Only now is there something to point at: with a pad connected the cursor
  // starts on Play.
}

function renderSpecs(info) {
  el.specs.replaceChildren();
  const list = info.games ?? [];
  if (list.length > 1) specRow(el.specs, "Games", String(list.length));
}

function showCover(src) {
  return new Promise((resolve) => {
    el.cover.hidden = false;
    el.cover.addEventListener(
      "load",
      () => {
        el.placeholder.classList.add("hidden");
        sampleAccent(el.cover);
        resolve();
      },
      { once: true },
    );
    el.cover.addEventListener("error", () => {
      el.cover.hidden = true;
      resolve();
    }, { once: true });
    el.cover.src = src;
  });
}

/**
 * Wear the look this cartridge asked for.
 *
 * The name has already been checked against the list the launcher ships with,
 * by the time it reaches here — see `skins.rs`. That is what makes this safe to
 * put in an href: a cartridge picks from what is installed, it does not supply
 * a stylesheet, so there is nothing here that a drive someone handed you can
 * point at.
 *
 * "default" is the stylesheet already loaded, so it clears the link rather than
 * loading an empty file.
 */
function wearSkin(name, css = null) {
  debugLog(`wearSkin(${name}) css=${(css ?? "").length}b link=${Boolean(el.skin)}`);
  if (!el.skin) return;
  worn = name || "default";
  const wanted = worn !== "default" ? `skins/${worn}.css` : "";
  if (el.skin.getAttribute("href") !== wanted) el.skin.setAttribute("href", wanted);

  // The cartridge's own, after the named one, so it can either bring a whole
  // look or adjust one that already exists. Only replaced when a cartridge is
  // being loaded — cycling skins must not throw away what the cartridge said.
  if (css !== null) el.cartSkin.textContent = css;

  // A stylesheet arriving over a link lands a frame later than one set inline,
  // so the size is taken after the next paint rather than immediately.
  requestAnimationFrame(() => requestAnimationFrame(resizeToSkin));
}

/**
 * Let the skin choose the window's size.
 *
 * The launcher is 420x630 because a cover is 3:4, which is the right shape for
 * one game and the wrong one for a skin laid out sideways. A skin says what it
 * wants in two custom properties and this passes them on; saying nothing keeps
 * the stock size, so this costs a skin that does not care exactly nothing.
 *
 *   :root { --skin-width: 520; --skin-height: 400; }
 */
async function resizeToSkin() {
  if (!tauri?.window) return;

  const style = getComputedStyle(document.documentElement);
  const width = Number.parseInt(style.getPropertyValue("--skin-width"), 10) || 420;
  const height = Number.parseInt(style.getPropertyValue("--skin-height"), 10) || 630;
  if (width === sized.width && height === sized.height) return;
  sized = { width, height };

  try {
    const { getCurrentWindow, LogicalSize } = tauri.window;
    await getCurrentWindow().setSize(new LogicalSize(width, height));
    debugLog(`resized to ${width}x${height}`);
  } catch (error) {
    debugLog(`resize to ${width}x${height} failed: ${error}`);
  }
}

/** What the window was last asked to be, so it is not asked again for nothing. */
let sized = { width: 420, height: 630 };

/** What is on now, so the button knows what comes next. */
let worn = "default";

/** Every look this build ships, filled in once the backend has been asked. */
let skins = [];

invoke("list_skins")
  .then((list) => {
    skins = list.map(([name]) => name);
  })
  .catch(() => {});

/**
 * Put on the next skin, and remember it.
 *
 * A cycle rather than a menu. Five looks and a 420px window: a list would be a
 * popup covering the artwork it is meant to be showing off, where pressing a
 * button repeatedly shows the same thing faster and never hides anything.
 *
 * Saved as the default for cartridges that do not ask for one — pressing this
 * is a preference, not a fidget. A cartridge with its own `skin=` still wins
 * next time it is plugged in, which is why the toast says what it changed.
 */
async function cycleSkin() {
  if (skins.length < 2) return;

  const next = skins[(Math.max(0, skins.indexOf(worn)) + 1) % skins.length];
  wearSkin(next);
  toast(`Skin: ${next}`);

  try {
    const current = await invoke("get_settings");
    await invoke("set_settings", { settings: { ...current, defaultSkin: next } });
  } catch {
    // The look changed either way; it just will not be remembered.
  }
}

async function showWindow() {
  if (tauri?.window) await tauri.window.getCurrentWindow().show();

  // Showing is not focusing. The watcher opens this window from the
  // background, and Windows lets a background process put a window in front
  // without giving it the keyboard — so Enter went to whatever was behind it,
  // and a controller reported every button unpressed, because Chromium only
  // tells a focused document what a gamepad is doing.
  try {
    await invoke("focus_window");
  } catch {
    // Nothing to do about it here; the window is up either way.
  }
}

/* ==========================================================================
   Actions
   ========================================================================== */

/** Set while a launch is in flight, so the sweep runs once and Play holds. */
let launching = false;

/**
 * Put Play back to rest.
 *
 * Used to be needed only when a launch failed, because a launch that worked
 * closed the window a moment later and the button went with it. Now the window
 * comes back — so it has to come back saying Play, not still spinning on a
 * launch that finished when the game started an hour ago.
 */
function resetPlay() {
  launching = false;
  el.play.classList.remove("is-launching");
  el.playLabel.textContent = "Play";
  setBusy(false);
}

async function doPlay() {
  const game = currentGame();
  if (!game?.executable || el.play.disabled || launching) return;

  launching = true;
  setBusy(true);
  el.play.classList.add("is-launching");
  el.playLabel.textContent = "Launching";
  toast("Launching…");

  try {
    await invoke("launch_game", {
      executable: game.executable,
      drivePath: cartridge.drive_path,
    });
    toast("Launched");
    // The game has the screen now. The launcher steps back to the taskbar
    // rather than closing, so Eject is still there when the game is over.
    setTimeout(standAside, 900);
  } catch (error) {
    toast(String(error), true);
    resetPlay();
  }
}

el.play.addEventListener("click", doPlay);

/**
 * Eject, on the first press.
 *
 * There used to be a confirmation step when the game lived on the cartridge,
 * on the reasoning that pulling a disc out from under a running game is bad.
 * It is — but Windows already refuses it: a volume with an open handle on it
 * will not lock, so a game that is actually running makes the eject fail on
 * its own, with a message naming what to close. The confirmation was warning
 * about something that cannot happen, and charging every safe eject two presses
 * and a paragraph to do it.
 */
async function doEject() {
  if (!cartridge || el.eject.disabled) return;

  setBusy(true);
  toast("Ejecting…");
  try {
    await invoke("eject_drive", { drivePath: cartridge.drive_path });
    // The face leaves the slot, and what is left is the thing to take out —
    // which is the whole message, so the toast stops repeating it.
    dismissToast();
    showSlot("Safe to remove", null);
    setTimeout(closeWindow, SEAT_MS + 800);
  } catch (error) {
    toast(String(error), true);
    setBusy(false);
  }
}

el.eject.addEventListener("click", doEject);

// A controller reaches the same four things the keyboard does, and nothing
// more: it moves focus and clicks, so it cannot start anything a person at the
// keyboard could not.
/**
 * Write a line to the launcher log, when there is one.
 *
 * A no-op unless PC_GAMEPAK_DEBUG is set, which is decided once below rather
 * than on every call — a gamepad poll runs sixty times a second and is not
 * somewhere to put a round trip.
 */
let debugOn = null;
let debugPending = [];
function debugLog(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  // Held until the answer arrives rather than dropped. Whether logging is on is
  // one round trip, and the most interesting lines — what the cartridge asked
  // for, what the window resized to — all happen inside it.
  if (debugOn === null) debugPending.push(stamped);
  else if (debugOn) invoke("debug_log", { line: stamped });
}

invoke("debug_logging")
  .then((on) => {
    debugOn = Boolean(on);
    if (debugOn) {
      invoke("debug_log", { line: `[${new Date().toISOString()}] launcher started` });
      for (const line of debugPending) invoke("debug_log", { line });
    }
    debugPending = [];
  })
  .catch(() => {
    debugOn = false;
    debugPending = [];
  });

const gamepad = connectGamepad({
  play: doPlay,
  eject: doEject,
  details: () => toggleSheet(),
  previous: () => step(-1),
  next: () => step(1),
  log: debugLog,
  back: () => {
    if (el.sheet.classList.contains("is-open")) toggleSheet(false);
    else closeWindow();
  },
});

el.close.addEventListener("click", closeWindow);
el.btnSkin.addEventListener("click", cycleSkin);
el.details.addEventListener("click", () => toggleSheet());
el.sheetClose.addEventListener("click", () => toggleSheet(false));
el.sheetBack.addEventListener("click", () => toggleSheet(false));
el.pathsToggle.addEventListener("click", () => togglePaths());
el.openWizard.addEventListener("click", async () => {
  try {
    await invoke("open_wizard_window");
  } catch (error) {
    console.error(error);
  }
});

el.openSettings.addEventListener("click", async () => {
  try {
    await invoke("open_wizard_settings");
  } catch (error) {
    console.error(error);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const sheetOpen = el.sheet.classList.contains("is-open");

  // 1-9 start the nth game of a collection, so a cartridge you know can be
  // played without reaching for the mouse or arrowing down the rail. The
  // selection follows, so the window shows what it just started.
  if (!sheetOpen && isCollection() && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    if (index < games().length) {
      event.preventDefault();
      select(index);
      doPlay();
    }
    return;
  }

  // Up and down move the selection, which is what the rail is for. They used
  // to scroll it, so a collection could be scrolled past a game without ever
  // choosing one — and Play still acted on whatever was selected before.
  if (!sheetOpen && isCollection() && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = selected + step;
    if (next >= 0 && next < games().length) {
      select(next);
      el.gameList.children[next]?.scrollIntoView({ block: "nearest" });
    }
    return;
  }

  switch (event.key) {
    case "Enter":
      if (sheetOpen) return;
      event.preventDefault();
      doPlay();
      break;
    case "e":
    case "E":
      event.preventDefault();
      el.eject.click();
      break;
    case "i":
    case "I":
      event.preventDefault();
      toggleSheet();
      break;
    case "Escape":
      event.preventDefault();
      // Escape peels one layer at a time: a waiting error, then the sheet, then
      // the window itself.
      if (el.toast.classList.contains("is-sticky")) dismissToast();
      else if (sheetOpen) toggleSheet(false);
      else closeWindow();
      break;
  }
});

/* ==========================================================================
   Browser preview
   --------------------------------------------------------------------------
   Opened outside Tauri, the page serves a sample cartridge so the window can
   be designed and reviewed without a physical drive:
       npx http-server tauri-ui  →  http://localhost:8080/?drive=/demo
   Append &state=noexec to see the nothing-to-play case, &state=bundle for a
   collection, and &tag=1 for a cartridge that is a tag rather than a drive —
   which composes with the others.
   ========================================================================== */

async function demoInvoke(command, args) {
  const state = new URLSearchParams(location.search).get("state");
  switch (command) {
    case "parse_cartridge":
      if (state === "bundle") {
        return {
          title: "God of War Collection",
          cover: "src/demo/gow-collection.jpg",
          cover_path: "D:\\collection.jpg",
          executable: "steam://rungameid/310970",
          drive_path: args.drivePath,
          is_bundle: true,
          holds_game: true,
          games: [
            {
              title: "God of War (2018)",
              executable: "steam://rungameid/310970",
              cover: "src/demo/gow-1.jpg",
              cover_path: "",
              sizeBytes: 64_200_000_000,
            },
            {
              title: "God of War: Ragnarök",
              executable: "steam://rungameid/1476670",
              cover: "src/demo/gow-2.jpg",
              cover_path: "",
              sizeBytes: 44_700_000_000,
            },
          ],
        };
      }
      return {
        title: "Cinder & Salt",
        // A plain path stands in for the data URI the backend would send; the
        // browser loads it directly.
        cover: "src/demo/cover.jpg",
        cover_path: "D:\\cover.jpg",
        executable: state === "noexec" ? "" : "steam://rungameid/367520",
        drive_path: args.drivePath,
        is_bundle: false,
        holds_game: true,
        games: [],
      };
    case "can_eject":
      // A tag resolves to a directory on this machine; there is no drive to
      // unmount and the button should not be there.
      return !new URLSearchParams(location.search).has("tag");
    case "cartridge_health":
      // The preview shows the case worth designing for: a link that is fine,
      // a transport that is not, and a drive with no room left.
      return {
        link: "10 Gbps",
        linkMbps: 10000,
        transport: "BOT",
        label: "CINDER",
        filesystem: "exFAT",
        totalBytes: 128_035_676_160,
        freeBytes: 9_663_676_416,
        usedPercent: 92,
        warnings: [
          "Running in BOT mode, which sends one command at a time. UASP queues them and is worth roughly two to three times as much on the small random reads a game streams. Usually a different port or enclosure firmware fixes it.",
          "92% full. These drives have no DRAM of their own and cannot borrow host memory over USB, so the last 15% costs more than it looks like it should. Leaving some room back keeps random reads quick.",
        ],
      };
    default:
      console.log("[preview]", command, args);
      return "";
  }
}

init();
