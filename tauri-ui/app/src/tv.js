/**
 * The TV launcher: the whole library on a shelf, for a controller across a
 * room. The popup (main.js) is the same app for a desk; Settings → TV mode, or
 * `--tv`, opens this instead.
 *
 * Three screens, as the design has them:
 *
 *   Home        every cartridge made on this PC, and the one in the slot first,
 *               as boxes on a shelf. The one in the slot plays.
 *   Cartridge   its box, the words on its sleeve, and its games to pick from.
 *   Memory card the card in the slot, its saves, and what each one needs.
 *
 * Every action is one the popup already has, through the same command: Play is
 * `launch_game`, Eject `eject_with_guard`, the memory card's copies and delete
 * `memcard_copy` and `memcard_remove`. Nothing shown is made up: a rating, a
 * blurb or a headline appears only when the cartridge's sleeve kit has one
 * (see core/src/sleeve.rs), and a cartridge that is not plugged in says so
 * rather than offering a Play that cannot work.
 *
 * Keys: arrows move, Enter plays (or does what the card's state suggests),
 * I opens a cartridge, E ejects, M the memory card, Esc goes back (and closes
 * from Home). Pad: A, Y details (delete on the card, pressed twice), X ejects,
 * View the memory card, B back. B does nothing on Home: a stray press should
 * not close a full-screen window.
 *
 * Text from a cartridge is written with textContent, never as markup.
 */

import { connect as connectGamepad } from "./gamepad.js";
import { describe, needsAttention } from "./memcard.js";
import { buildMemoryCard } from "./card3d.js";
import { buildSleeve } from "./sleeve3d.js";

const tauri = window.__TAURI__;
const still = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (id) => document.getElementById(id);

let demo = null;
/** The backend, or the preview's stand-in when there is no Tauri (a browser). */
async function invoke(command, args) {
  if (tauri?.core?.invoke) return tauri.core.invoke(command, args);
  demo ??= await import("./tv-demo.js");
  return demo.demoInvoke(command, args);
}

const el = {
  tv: $("tv"),
  tabs: { shelf: $("tab-shelf"), card: $("tab-card"), settings: $("tab-settings") },
  chip: $("tv-chip"),
  chipName: $("tv-chip-name"),
  clock: $("tv-clock"),
  views: { shelf: $("view-shelf"), detail: $("view-detail"), card: $("view-card") },
  shelf: $("shelf"),
  shelfEmpty: $("shelf-empty"),
  selState: $("sel-state"),
  selTitle: $("sel-title"),
  selSub: $("sel-sub"),
  selTags: $("sel-tags"),
  detailArt: $("detail-art"),
  detailState: $("detail-state"),
  detailHeadline: $("detail-headline"),
  detailBlurb: $("detail-blurb"),
  detailGames: $("detail-games"),
  detailNote: $("detail-note"),
  cardArt: $("card-art"),
  cardSlot: $("card-slot"),
  cardCap: $("card-cap"),
  cardTitle: $("card-title"),
  cardSaves: $("card-saves"),
  cardEmpty: $("card-empty"),
  toPc: $("card-to-pc"),
  toCard: $("card-to-card"),
  folder: $("card-folder"),
  remove: $("card-delete"),
  prompts: $("tv-prompts"),
  footRight: $("tv-foot-right"),
  toast: $("tv-toast"),
};

const state = {
  view: "shelf",
  drive: "",
  /** The cartridge in the slot, as parse_cartridge reads it; null for none. */
  slot: null,
  /** The memory card in the slot (a card, or a cartridge that is one too). */
  card: null,
  cardHealth: null,
  ejectable: true,
  library: [],
  shelfIndex: 0,
  gameIndex: 0,
  cardIndex: 0,
  armed: false,
  busy: false,
};

/* --- Formatting ----------------------------------------------------------- */

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

function since(unix) {
  const days = Math.floor((Date.now() / 1000 - unix) / 86400);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const sameTitle = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Only pictures the backend inlined, or the preview's own art. */
function safeArt(src) {
  return typeof src === "string" && /^(data:image\/|src\/)/.test(src) ? src : "";
}

/* --- The stage, the clock and the toast ----------------------------------- */

function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  el.tv.style.setProperty("--k", String(k));
}
addEventListener("resize", fit);
fit();

function tick() {
  el.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
tick();
setInterval(tick, 15_000);

let toastTimer = 0;
function toast(message, error = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("is-error", error);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), error ? 6000 : 3500);
}

/* --- Loading -------------------------------------------------------------- */

async function load() {
  state.drive = tauri
    ? await invoke("drive_path").catch(() => "")
    : new URLSearchParams(location.search).get("drive") ?? "X";
  state.slot = null;
  state.card = null;
  if (state.drive) {
    // The popup's order: a drive that is only a memory card is the card; any
    // other is read as a cartridge, which may be a card too.
    const card = await invoke("memory_card", { drivePath: state.drive }).catch(() => null);
    if (card?.cardOnly) {
      state.card = card;
    } else {
      state.slot = await invoke("parse_cartridge", { drivePath: state.drive }).catch((error) => {
        toast(`The cartridge could not be read: ${error}`, true);
        return null;
      });
      if (state.slot?.memory_card && card) state.card = card;
    }
    state.ejectable = Boolean(await invoke("can_eject", { drivePath: state.drive }).catch(() => true));
  }
  if (state.card) {
    state.cardHealth = await invoke("cartridge_health", { drivePath: state.drive }).catch(() => null);
  }
  const created = await invoke("list_created").catch(() => []);
  state.library = libraryFrom(created, state.slot);
  state.shelfIndex = 0;
}

/**
 * The shelf: every cartridge made on this PC, newest first, and the one in the
 * slot at the front. A cartridge made elsewhere is on the shelf while it is in.
 */
function libraryFrom(created, slot) {
  const items = created.map((entry) => ({
    key: entry.id,
    title: entry.title,
    games: entry.games ?? [],
    cover: entry.cover,
    sleeve: null,
    label: entry.driveLabel ?? "",
    info: null,
  }));
  if (!slot) return items;
  const games = slot.is_bundle ? slot.games.map((g) => g.title) : [];
  const inSlot = {
    key: "slot",
    title: slot.title,
    games,
    cover: slot.cover,
    sleeve: slot.sleeve ?? null,
    label: "",
    info: slot,
  };
  const known = items.findIndex((item) => sameTitle(item.title, slot.title));
  if (known >= 0) items.splice(known, 1);
  return [inSlot, ...items];
}

/* --- Views ---------------------------------------------------------------- */

function show(view) {
  state.view = view;
  for (const [name, section] of Object.entries(el.views)) section.hidden = name !== view;
  const tab = view === "detail" ? "shelf" : view;
  for (const [name, button] of Object.entries(el.tabs)) {
    if (name === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view === "shelf") renderShelf();
  if (view === "detail") renderDetail();
  if (view === "card") renderCard();
  renderPrompts();
}

function selectedItem() {
  return state.library[state.shelfIndex] ?? null;
}

/* --- Home: the shelf ------------------------------------------------------ */

function renderShelf() {
  const items = state.library;
  el.shelfEmpty.hidden = items.length > 0;
  el.shelf.replaceChildren(
    ...items.map((item, index) => {
      const li = document.createElement("li");
      li.className = "tv__item";
      li.setAttribute("role", "option");
      li.dataset.index = String(index);
      li.tabIndex = -1;
      li.setAttribute("aria-label", `${item.title}. ${item.info ? "In the slot" : "On the shelf"}.`);
      li.append(buildSleeve(item));
      li.addEventListener("click", () => {
        if (index === state.shelfIndex) openDetail();
        else selectShelf(index);
      });
      return li;
    }),
  );
  selectShelf(Math.min(state.shelfIndex, Math.max(items.length - 1, 0)), true);
}

function selectShelf(index, force = false) {
  if (!force && index === state.shelfIndex) return;
  state.shelfIndex = index;
  const hadFocus = el.shelf.contains(document.activeElement);
  for (const li of el.shelf.children) {
    const on = Number(li.dataset.index) === index;
    li.setAttribute("aria-selected", String(on));
    li.tabIndex = on ? 0 : -1;
    if (on) {
      if (hadFocus) li.focus({ preventScroll: true });
      li.scrollIntoView({ inline: "center", block: "nearest", behavior: still.matches ? "auto" : "smooth" });
    }
  }
  renderSelected();
  renderPrompts();
}

function renderSelected() {
  const item = selectedItem();
  el.selTags.replaceChildren();
  if (!item) {
    el.selState.textContent = "";
    el.selTitle.textContent = "";
    el.selSub.textContent = "";
    return;
  }
  el.selState.textContent = item.info
    ? "In the slot · Ready"
    : item.label
      ? `On the shelf · ${item.label}`
      : "On the shelf";
  el.selState.classList.toggle("is-away", !item.info);
  el.selTitle.textContent = item.title;
  const sleeve = item.sleeve ?? {};
  el.selSub.textContent = sleeve.tagline || (item.games.length > 1 ? item.games.join(" · ") : "");

  const tags = [];
  if (sleeve.rating) {
    const pegi = tag(`PEGI ${sleeve.rating}`);
    pegi.classList.add("tv__tag--pegi");
    pegi.style.background = PEGI[sleeve.rating];
    tags.push(pegi);
  }
  if (item.games.length > 1) tags.push(tag(plural(item.games.length, "game")));
  const platform = item.info?.platform;
  if (platform && platform.toUpperCase() !== "PC") tags.push(tag(platform));
  el.selTags.replaceChildren(...tags);
}

const PEGI = { 3: "#56b947", 7: "#56b947", 12: "#f6a41b", 16: "#f6a41b", 18: "#e2001a" };

function tag(text) {
  const span = document.createElement("span");
  span.className = "tv__tag";
  span.textContent = text;
  return span;
}

/* --- A cartridge ---------------------------------------------------------- */

function openDetail() {
  if (!selectedItem()) return;
  state.gameIndex = 0;
  show("detail");
}

/** What can be played from the cartridge: its games, or itself. */
function gamesOf(item) {
  if (item.info) {
    return item.info.is_bundle && item.info.games.length
      ? item.info.games
      : [{ title: item.info.title, executable: item.info.executable }];
  }
  return (item.games.length ? item.games : [item.title]).map((title) => ({ title, executable: "" }));
}

function renderDetail() {
  const item = selectedItem();
  if (!item) return;
  const sleeve = item.sleeve ?? {};
  el.detailArt.replaceChildren();
  const back = safeArt(sleeve.back);
  if (back) {
    const print = document.createElement("div");
    print.className = "tv__back-print";
    print.style.setProperty("--art", `url("${new URL(back, document.baseURI).href}")`);
    el.detailArt.append(print);
  }
  el.detailArt.append(buildSleeve(item));

  el.detailState.textContent = item.info ? "Cartridge inserted" : "On the shelf · not in the slot";
  el.detailState.classList.toggle("is-away", !item.info);
  el.tv.style.setProperty("--sleeve-accent", sleeve.accent || "");

  // The sleeve's headline, its last line in the accent; otherwise the name.
  const lines = (sleeve.headline || item.title).split("\n").filter(Boolean);
  el.detailHeadline.replaceChildren(
    ...lines.flatMap((line, i) => {
      const span = document.createElement("span");
      span.textContent = line;
      if (lines.length > 1 && i === lines.length - 1) span.className = "is-accent";
      return i ? [document.createElement("br"), span] : [span];
    }),
  );
  el.detailBlurb.textContent = sleeve.blurb || "";
  renderGames();

  el.detailNote.textContent = state.card && item.info ? `Saves load from ${state.card.title}` : "";
  el.detailNote.classList.toggle("has-card", Boolean(el.detailNote.textContent));
}

function renderGames() {
  const item = selectedItem();
  const games = gamesOf(item);
  el.detailGames.replaceChildren(
    ...games.map((game, index) => {
      const li = document.createElement("li");
      li.className = "tv__row";
      li.setAttribute("role", "option");
      li.dataset.index = String(index);
      const on = index === state.gameIndex;
      li.setAttribute("aria-selected", String(on));
      li.tabIndex = on ? 0 : -1;
      const title = document.createElement("span");
      title.className = "tv__row-title";
      title.textContent = game.title;
      li.append(title);
      if (on && item.info) li.append(badge("A"));
      li.addEventListener("click", () => {
        if (state.gameIndex === index) void play();
        else {
          state.gameIndex = index;
          renderGames();
          renderPrompts();
        }
      });
      return li;
    }),
  );
  el.detailGames.children[state.gameIndex]?.scrollIntoView({ block: "nearest" });
  markMore(el.detailGames);
}

/* --- The memory card ------------------------------------------------------ */

function blocks() {
  return state.card?.blocks ?? [];
}

function renderCard() {
  const card = state.card;
  // The set's card, with the card's name on its plate.
  el.cardArt.replaceChildren(buildMemoryCard({ plate: card?.title ?? "" }));
  el.cardSlot.textContent = card ? "Card in the slot" : "No card in the slot";
  el.cardSlot.classList.toggle("is-away", !card);
  el.cardTitle.textContent = card?.title ?? "Memory card";
  const health = state.cardHealth;
  if (card && health?.totalBytes) {
    const saves = blocks().reduce((sum, b) => sum + (b.cartridgeBytes || 0), 0);
    el.cardCap.textContent = `${saves ? `${formatBytes(saves)} of saves` : "No saves"} · ${formatBytes(health.freeBytes ?? 0)} free of ${formatBytes(health.totalBytes)}`;
  } else {
    el.cardCap.textContent = card ? "Memory card" : "";
  }

  const list = blocks();
  el.cardEmpty.hidden = list.length > 0;
  el.cardEmpty.textContent = card
    ? "No saves on this card yet."
    : "Plug in a memory card, or a cartridge that is one too, to see its saves here.";
  state.cardIndex = Math.min(state.cardIndex, Math.max(list.length - 1, 0));
  el.cardSaves.replaceChildren(
    ...list.map((block, index) => {
      const { state: said, tone } = describe(block);
      const li = document.createElement("li");
      li.className = "tv__row";
      li.setAttribute("role", "option");
      li.dataset.index = String(index);
      li.setAttribute("aria-label", `${block.title}. ${said}.`);
      // The save as a memory card of its own, as on the popup, with its
      // game's art on the label (the row says its name).
      const art = document.createElement("span");
      art.className = "tv__save-art";
      art.append(buildMemoryCard({ kind: "save", art: block.icon }));
      const text = document.createElement("span");
      text.className = "tv__save-text";
      const title = document.createElement("span");
      title.className = "tv__row-title";
      title.textContent = block.title;
      const sub = document.createElement("span");
      sub.className = "tv__save-sub";
      const lamp = document.createElement("i");
      lamp.className = "lamp";
      lamp.dataset.tone = tone;
      lamp.setAttribute("aria-hidden", "true");
      const newest = Math.max(block.cartridgeNewest || 0, block.hostNewest || 0);
      sub.append(lamp, document.createTextNode(newest ? `${said} · saved ${since(newest)}` : said));
      text.append(title, sub);
      const side = document.createElement("span");
      side.className = "tv__row-side";
      side.textContent = block.cartridgeBytes ? formatBytes(block.cartridgeBytes) : "";
      li.append(art, text, side);
      li.addEventListener("click", () => selectSave(index));
      return li;
    }),
  );
  selectSave(state.cardIndex, true);
}

function selectSave(index, force = false) {
  if (!force && index === state.cardIndex) return;
  state.cardIndex = index;
  disarm();
  for (const li of el.cardSaves.children) {
    const on = Number(li.dataset.index) === index;
    li.setAttribute("aria-selected", String(on));
    li.tabIndex = on ? 0 : -1;
    if (on) li.scrollIntoView({ block: "nearest" });
  }
  markMore(el.cardSaves);
  renderCardActions();
  renderPrompts();
}

/** Fade a list's foot while there is more of it below. */
function markMore(list) {
  list.classList.toggle("is-more", list.scrollTop + list.clientHeight < list.scrollHeight - 4);
}
el.cardSaves.addEventListener("scroll", () => markMore(el.cardSaves));
el.detailGames.addEventListener("scroll", () => markMore(el.detailGames));

function renderCardActions() {
  const block = blocks()[state.cardIndex];
  for (const button of [el.toPc, el.toCard, el.folder, el.remove]) button.hidden = !block;
  if (!block) return;
  const { suggest } = describe(block);
  const conflict = block.direction === "conflict";
  const hasFolder = Boolean(block.hostPath);
  el.toPc.hidden = !hasFolder || !(suggest === "pc" || conflict);
  el.toCard.hidden = !hasFolder || !(suggest === "card" || conflict);
  el.toPc.textContent = conflict ? "Keep the card's" : "Copy to this PC";
  el.toCard.textContent = conflict ? "Keep this PC's" : "Copy to the card";
  // Both plain when both changed: which to keep is the player's choice.
  el.toPc.classList.toggle("tv__btn--fill", !conflict);
  el.toCard.classList.toggle("tv__btn--fill", !conflict);
  el.folder.hidden = !block.hostBytes && !block.cartridgeBytes;
  el.remove.hidden = !block.cartridgeBytes;
  el.remove.textContent = state.armed ? "Delete from card? A backup stays" : "Delete";
  el.remove.classList.toggle("is-armed", state.armed);
  for (const button of [el.toPc, el.toCard, el.remove]) button.disabled = state.busy;
}

async function refreshCard() {
  state.card = await invoke("memory_card", { drivePath: state.drive }).catch(() => state.card);
  state.cardHealth = await invoke("cartridge_health", { drivePath: state.drive }).catch(() => state.cardHealth);
  if (state.view === "card") renderCard();
}

async function copy(to) {
  const block = blocks()[state.cardIndex];
  if (!block || state.busy) return;
  state.busy = true;
  renderCardActions();
  try {
    await invoke("memcard_copy", { drivePath: state.drive, slotId: block.slot.id, to });
    toast(`${block.title} copied to ${to === "pc" ? "this PC" : "the card"}. The copy it replaced was kept.`);
  } catch (error) {
    toast(`${block.title} was not copied: ${error}`, true);
  } finally {
    state.busy = false;
    await refreshCard();
  }
}

let disarmTimer = 0;
function disarm() {
  clearTimeout(disarmTimer);
  state.armed = false;
}

/** Delete asks twice: the first press arms it, the second does it. */
async function remove() {
  const block = blocks()[state.cardIndex];
  if (!block || state.busy || !block.cartridgeBytes) return;
  if (!state.armed) {
    state.armed = true;
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => {
      state.armed = false;
      renderCardActions();
    }, 4000);
    renderCardActions();
    return;
  }
  disarm();
  state.busy = true;
  try {
    await invoke("memcard_remove", { drivePath: state.drive, slotId: block.slot.id });
    toast(`${block.title} taken off the card. A backup stays on it, and this PC's copy is untouched.`);
  } catch (error) {
    toast(`${block.title} was not deleted: ${error}`, true);
  } finally {
    state.busy = false;
    await refreshCard();
  }
}

async function reveal() {
  const block = blocks()[state.cardIndex];
  if (!block) return;
  await invoke("memcard_reveal", { drivePath: state.drive, slotId: block.slot.id }).catch((error) =>
    toast(String(error), true),
  );
}

/** The copy the save's state suggests, for Enter and A. */
function cardPrimary() {
  const block = blocks()[state.cardIndex];
  if (!block) return;
  const { suggest, tone, state: said } = describe(block);
  if (suggest) void copy(suggest);
  else
    toast(
      tone === "bad"
        ? `${block.title} changed on both sides. Choose which copy to keep.`
        : `${block.title} needs nothing: ${said.toLowerCase()}.`,
    );
}

/* --- Play and Eject ------------------------------------------------------- */

let launching = false;

async function play() {
  const item = selectedItem();
  if (!item) return;
  if (!item.info) {
    toast(`${item.title} is not in the slot. Plug it in to play it.`);
    return;
  }
  const games = gamesOf(item);
  // A collection is chosen from on its own screen; from Home, A opens it.
  if (state.view === "shelf" && games.length > 1) {
    openDetail();
    return;
  }
  const game = games[state.view === "detail" ? state.gameIndex : 0];
  if (!game?.executable || launching) return;
  launching = true;
  toast(`Launching ${game.title}…`);
  try {
    await invoke("launch_game", {
      executable: game.executable,
      drivePath: item.info.drive_path,
      title: game.title ?? item.title,
    });
    toast(`${game.title} launched`);
    // The game has the screen now; step back so it can keep it.
    setTimeout(standAside, 900);
  } catch (error) {
    toast(String(error), true);
  } finally {
    launching = false;
  }
}

async function standAside() {
  if (!tauri?.window) return;
  await tauri.window.getCurrentWindow().minimize().catch(() => {});
}

async function eject() {
  const item = state.library.find((entry) => entry.info);
  if (!state.drive || !state.ejectable || (!item && !state.card) || state.busy) return;
  state.busy = true;
  toast("Ejecting…");
  try {
    const outcome = await invoke("eject_with_guard", { drivePath: state.drive });
    if (!outcome?.ejected) {
      toast(outcome?.message || "Left in the slot.");
      return;
    }
    toast(outcome.message || "Safe to remove");
    // Still on the shelf, no longer in the slot.
    if (item) {
      item.info = null;
      item.key = `away-${item.title}`;
    }
    state.slot = null;
    state.card = null;
    state.drive = "";
    show(state.view === "card" ? "card" : "shelf");
  } catch (error) {
    toast(String(error), true);
  } finally {
    state.busy = false;
  }
}

/* --- Prompts -------------------------------------------------------------- */

function badge(button) {
  const span = document.createElement("span");
  span.className = "tv__badge";
  span.dataset.button = button;
  span.textContent = button === "View" ? "View" : button;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function prompt(button, label, action, enabled = true) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "tv__prompt";
  node.disabled = !enabled;
  node.append(badge(button), document.createTextNode(label));
  node.addEventListener("click", action);
  return node;
}

function renderPrompts() {
  const item = selectedItem();
  const inSlot = Boolean(item?.info);
  const canEject = Boolean(state.drive && state.ejectable && (state.slot || state.card));
  const parts = [];
  const right = [];
  if (state.view === "shelf") {
    if (item) {
      parts.push(prompt("A", inSlot ? "Play" : "Not in the slot", () => void play(), inSlot));
      parts.push(prompt("Y", "Details", openDetail));
    }
    if (canEject) parts.push(prompt("X", "Eject", () => void eject()));
    if (state.card) parts.push(prompt("View", "Memory card", () => show("card")));
    const n = state.library.length;
    if (n) right.push(document.createTextNode(`${plural(n, "cartridge")} in the library`));
  } else if (state.view === "detail") {
    if (inSlot) parts.push(prompt("A", "Play", () => void play()));
    parts.push(prompt("B", "Back to the shelf", () => show("shelf")));
    if (inSlot && canEject) parts.push(prompt("X", "Eject", () => void eject()));
    const sleeve = item?.sleeve ?? {};
    if (sleeve.rating) {
      const pegi = tag(`PEGI ${sleeve.rating}`);
      pegi.classList.add("tv__tag--pegi");
      pegi.style.background = PEGI[sleeve.rating];
      right.push(pegi);
      if (sleeve.descriptor) right.push(document.createTextNode(sleeve.descriptor));
    }
  } else if (state.view === "card") {
    const block = blocks()[state.cardIndex];
    if (block) {
      const { suggest } = describe(block);
      if (suggest) parts.push(prompt("A", suggest === "pc" ? "Copy to this PC" : "Copy to the card", cardPrimary));
      if (block.cartridgeBytes) parts.push(prompt("Y", state.armed ? "Delete — press again" : "Delete", () => void remove()));
    }
    parts.push(prompt("B", "Back", () => show("shelf")));
    if (canEject && state.card && !state.slot) parts.push(prompt("X", "Eject", () => void eject()));
  }
  el.prompts.replaceChildren(...parts);
  el.footRight.replaceChildren(...right);
  // The header's card chip: the card's name, when there is one.
  el.chip.hidden = !state.card;
  el.chipName.textContent = state.card?.title ?? "";
}

/* --- Input ---------------------------------------------------------------- */

function move(x, y) {
  const step = Math.sign(x || y);
  if (!step) return;
  if (state.view === "shelf") {
    const next = state.shelfIndex + step;
    if (next >= 0 && next < state.library.length) selectShelf(next);
  } else if (state.view === "detail") {
    const count = gamesOf(selectedItem()).length;
    const next = state.gameIndex + step;
    if (next >= 0 && next < count) {
      state.gameIndex = next;
      renderGames();
    }
  } else if (state.view === "card") {
    const next = state.cardIndex + step;
    if (next >= 0 && next < blocks().length) selectSave(next);
  }
}

function primary() {
  if (state.view === "card") cardPrimary();
  else void play();
}

function details() {
  if (state.view === "shelf") openDetail();
  else if (state.view === "card") void remove();
}

function back({ fromPad = false } = {}) {
  if (state.view !== "shelf") show("shelf");
  // Home is home: only the keyboard's Esc leaves it, never a stray B.
  else if (!fromPad && tauri?.window) void tauri.window.getCurrentWindow().close();
}

function toggleCard() {
  show(state.view === "card" ? "shelf" : "card");
}

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement && event.key === "Enter") return;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (arrows[key]) move(...arrows[key]);
  else if (key === "Enter") primary();
  else if (key === "Escape" || key === "Backspace") back();
  else if (key === "i") details();
  else if (key === "e") void eject();
  else if (key === "m") toggleCard();
  else if (key === "Delete" && state.view === "card") void remove();
  else if (key === "o" && state.view === "card") void reveal();
  else return;
  event.preventDefault();
});

// The header is for a mouse. Focus is handed back after a click, so the pad
// and the arrows go on moving the shelf rather than a ring left on a tab.
function headerButton(node, action) {
  node.addEventListener("click", () => {
    node.blur();
    action();
  });
}
headerButton(el.tabs.shelf, () => show("shelf"));
headerButton(el.tabs.card, () => show("card"));
headerButton(el.tabs.settings, () => {
  invoke("open_wizard_settings").catch((error) => toast(String(error), true));
});
headerButton(el.chip, () => show("card"));
el.toPc.addEventListener("click", () => void copy("pc"));
el.toCard.addEventListener("click", () => void copy("card"));
el.folder.addEventListener("click", () => void reveal());
el.remove.addEventListener("click", () => void remove());

connectGamepad({
  play: primary,
  eject: () => void eject(),
  details,
  back: () => back({ fromPad: true }),
  card: toggleCard,
  move,
  log: () => {},
});

/* --- Start ---------------------------------------------------------------- */

await load();
show(new URLSearchParams(location.search).get("view") === "card" || (state.card && !state.slot) ? "card" : "shelf");
if (tauri?.window) {
  await tauri.window.getCurrentWindow().show();
  await invoke("focus_window").catch(() => {});
}
