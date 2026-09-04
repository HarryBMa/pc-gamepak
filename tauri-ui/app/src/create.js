/**
 * PC GamePak — create.js
 *
 * The wizard. Selection is always multiple: ticking one game builds a
 * cartridge, ticking three builds a multicartridge, and the rail on the right
 * titles itself to match. There is no bundle mode to enter and no + to find.
 *
 * The left column moves through phases — the library, then a name and a face
 * if there is more than one game, then what to put on it, then the write
 * itself. The rail never changes place: it always says what is being built.
 *
 * Backend contract (src-tauri/src/main.rs):
 *   list_games()                     -> { games, problems }
 *   list_target_drives()             -> [{ path, label, totalBytes, freeBytes, hasCartridge }]
 *   list_unmounted_volumes()         -> [{ disk, partition, label, filesystem, totalBytes }]
 *   mount_volume({ volume })         -> the new drive root
 *   game_cover({ library, id })      -> data URI or ""
 *   executable_choices({ ... })      -> [{ relative, name, score }]
 *   format_plan({ drivePath })       -> { currentLabel, device, totalBytes, warning }
 *   steam_registration({ drivePath })-> bool
 *   suggest_collection_name({ titles }) -> string
 *   pick_cover_image()               -> { path, preview } | null
 *   pick_game_folder()               -> { path, name, sizeBytes, choices } | null
 *   create_cartridge({ request })    -> { confPath, formatted, gameCopied, ... }
 *
 * The backend re-derives the list of writable drives and re-checks the format
 * confirmation itself, so nothing here can talk it into writing to the wrong
 * place.
 */

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke ?? demoInvoke;

const $ = (id) => document.getElementById(id);

const el = {
  shell: $("shell"),
  barText: $("bar-text"),
  settings: $("btn-settings"),
  close: $("btn-close"),

  phases: {
    build: $("step-build"),
    custom: $("step-custom"),
    running: $("step-running"),
  },
  search: $("search"),
  games: $("games"),
  gamesEmpty: $("games-empty"),
  btnCustom: $("btn-custom"),

  // By hand
  customCover: $("custom-cover"),
  btnCustomCover: $("btn-custom-cover"),
  btnPickFolder: $("btn-pick-folder"),
  btnClearFolder: $("btn-clear-folder"),
  folderChosen: $("folder-chosen"),
  customTitle: $("custom-title"),
  titleHint: $("title-hint"),
  exeChoices: $("exe-choices"),
  exeHint: $("exe-hint"),
  customExec: $("custom-exec"),
  btnCustomBack: $("btn-custom-back"),

  // Name it
  collectionCover: $("collection-cover"),
  collectionCoverImg: $("collection-cover-img"),
  btnInheritCover: $("btn-inherit-cover"),
  collectionTitle: $("collection-title"),
  orderList: $("order-list"),

  // Options

  // Running
  runningPhase: $("running-phase"),
  runningTitle: $("running-title"),
  writtenDone: $("written-done"),
  writtenTotal: $("written-total"),
  remaining: $("remaining"),
  progressTrack: $("progress-track"),
  progressFill: $("progress-fill"),
  rate: $("rate"),
  currentFile: $("current-file"),
  log: $("log"),

  // Rail
  railEmpty: $("rail-empty"),
  railBody: $("rail-body"),
  railKindText: $("rail-kind-text"),
  railKindCount: $("rail-kind-count"),
  railLauncherCard: $("rail-launcher-card"),
  railLauncherArt: $("rail-launcher-art"),
  railLauncherScrim: $("rail-launcher-scrim"),
  railLauncherStage: $("rail-launcher-stage"),
  railLauncherEyebrow: $("rail-launcher-eyebrow"),
  railLauncherLogo: $("rail-launcher-logo"),
  railLauncherTitle: $("rail-launcher-title"),
  railExplorer: $("rail-explorer"),
  railExplorerIcon: $("rail-explorer-icon"),
  railExplorerName: $("rail-explorer-name"),
  railExplorerFree: $("rail-explorer-free"),
  railSpace: $("rail-space"),
  railDriveLabel: $("rail-drive-label"),
  railDriveFill: $("rail-drive-fill"),
  railBar: $("rail-bar"),
  drives: $("drives"),
  drivesEmpty: $("drives-empty"),
  btnUnregister: $("btn-unregister"),
  railPlan: $("rail-plan"),
  plan: $("plan"),
  railForced: $("rail-forced"),
  forced: $("forced"),
  readyMessage: $("ready-message"),
  create: $("btn-create"),
  createLabel: document.querySelector("#btn-create .btn__label"),
  status: $("status"),

  // Dialogs
  tabCreate: $("tab-create"),
  tabEdit: $("tab-edit"),
  panelCreate: $("panel-create"),
  panelEdit: $("panel-edit"),
  editMediaTitle: $("edit-media-title"),
  editMediaMeta: $("edit-media-meta"),
  btnChangeCart: $("btn-change-cart"),
  editFormWrap: $("edit-form-wrap"),
  btnRefetchArt: $("btn-refetch-art"),
  setFormat: $("set-format"),
  setRegisterSteam: $("set-register-steam"),
  editTitle: $("edit-title"),
  editArtSlots: $("edit-art-slots"),
  editCoverSlot: $("edit-cover-slot"),
  editCover: $("edit-cover"),
  editCoverImg: $("edit-cover-img"),
  editLogo: $("edit-logo"),
  editLogoImg: $("edit-logo-img"),
  editIcon: $("edit-icon"),
  editIconImg: $("edit-icon-img"),
  editGames: $("edit-games"),
  editTuneGroup: $("edit-tune-group"),
  editTunePlan: $("edit-tune-plan"),
  btnTune: $("btn-tune"),
  btnUntune: $("btn-untune"),
  btnTuneRun: $("btn-tune-run"),
  btnTuneCancel: $("btn-tune-cancel"),
  editStatus: $("edit-status"),

  changeGame: $("btn-change-game"),
  changeMedia: $("btn-change-media"),
  pickDialog: $("pick-dialog"),
  pickForm: $("pick-form"),
  pickTitle: $("pick-title"),
  tickCount: $("tick-count"),
  pickGames: $("pick-games"),
  pickMedia: $("pick-media"),

  buildGamePlate: $("build-game-plate"),
  buildGameCover: $("build-game-cover"),
  buildGameTitle: $("build-game-title"),
  buildGameMeta: $("build-game-meta"),
  buildName: $("build-name"),
  buildMediaTitle: $("build-media-title"),
  buildMediaMeta: $("build-media-meta"),
  artSlots: $("art-slots"),
  coverSlot: $("cover-slot"),
  slotLogo: $("slot-logo"),
  slotLogoImg: $("slot-logo-img"),
  slotIcon: $("slot-icon"),
  slotIconImg: $("slot-icon-img"),

  settingsDialog: $("settings-dialog"),
  sources: $("sources"),
  scanAge: $("scan-age"),
  btnRescan: $("btn-rescan"),
  setSgdb: $("set-sgdb"),
  sgdbKeyField: $("sgdb-key-field"),
  setSgdbKey: $("set-sgdb-key"),
  setFilesystem: $("set-filesystem"),
  setCopy: $("set-copy"),
  setVerify: $("set-verify"),
  setIcon: $("set-icon"),
  setEject: $("set-eject"),
  setCloseSteam: $("set-close-steam"),
  setTune: $("set-tune"),
  setTuneRow: $("set-tune-row"),
  setTrim: $("set-trim"),
  setCopyRate: $("set-copy-rate"),
  settingsSave: $("settings-save"),
  settingsStatus: $("settings-status"),

  sgdbDialog: $("sgdb-dialog"),
  sgdbTitle: $("sgdb-title"),
  sgdbTabs: $("sgdb-tabs"),
  sgdbSearch: $("sgdb-search"),
  sgdbStatus: $("sgdb-status"),
  sgdbResults: $("sgdb-results"),
  icoReceipt: $("ico-receipt"),
  sgdbManualUrl: $("sgdb-manual-url"),
  sgdbUseManual: $("sgdb-use-manual"),
  sgdbUseLocal: $("sgdb-use-local"),
  previewArt: $("preview-art"),
  previewGrid: $("preview-grid"),
  previewStage: $("preview-stage"),
  previewLogo: $("preview-logo"),
  previewTitle: $("preview-title"),
  previewIcon: $("preview-icon"),
};

/* ==========================================================================
   State
   ========================================================================== */

let library = [];
let drives = [];
// Volumes Windows can read but has not lettered. Not drives yet — nothing
// can be written to a volume with no mount point — so they are held apart
// from `drives` and only join it once one has been assigned.
let unmounted = [];
/** Ticked games, in the order they were ticked — which is the play order. */
let picked = [];
let selectedDrive = null;
let formatPlan = null;
let building = false;
let platform = "";
let driveIsSteamLibrary = false;
let scannedAt = null;

/** Artwork chosen by hand, per role. */
const art = { cover: null, logo: null, icon: null, background: null };

/** The by-hand game, when one is being entered. */
let manual = null;

let settings = {
  steamgriddbEnabled: false,
  steamgriddbApiKey: "",
  defaultFilesystem: "exfat",
  defaultVerify: true,
  defaultIcon: true,
  defaultEject: true,
};

let editing = null;
let activeTab = "create";

/** Which phase the left column is showing. */
/**
 * What is switched on.
 *
 * Every one of these used to be a checkbox on a panel between the wizard and
 * the Write button, duplicating a default that already lived in Settings. There
 * is one copy now and Settings holds it, so the build screen is three questions
 * and nothing else.
 *
 * `copy` is the exception that stays run-state: it is switched off
 * automatically when nothing selected can be copied, which is a fact about the
 * games rather than a preference.
 */
let copyWanted = true;

/** How many of the chosen games came out of Steam. */
function steamGames() {
  return picked.filter((g) => g.library === "steam").length;
}

const on = {
  get copy() { return copyWanted && copyable().length > 0; },
  get verify() { return settings.defaultVerify !== false; },
  get icon() { return settings.defaultIcon !== false; },
  get eject() { return settings.defaultEject !== false; },
  get registerSteam() { return settings.defaultRegisterSteam !== false; },
  // Only meaningful when Steam is involved: it exists so Steam does not write
  // its library list back over the cartridge on exit.
  get closeSteam() {
    return settings.defaultCloseSteam !== false && steamGames() > 0;
  },
  get tune() { return platform === "windows" && Boolean(settings.defaultTune); },
  // Formatting already discards the whole volume, and Windows does this on its
  // own schedule, so neither case asks.
  get trim() {
    return Boolean(settings.defaultTrim) && !this.format && platform !== "windows";
  },
  get format() { return Boolean(settings.defaultFormat); },
};

let phase = "build";

/* ==========================================================================
   Small helpers
   ========================================================================== */

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

/** "about 11 minutes" — never a false precision, and never a bare number. */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 90) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** mm:ss, for a countdown that is being watched. */
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function status(message, kind = "") {
  el.status.textContent = message;
  el.status.className = kind ? `selectable is-${kind}` : "selectable";
}

function safeSrc(src) {
  const value = String(src ?? "");
  // A cover arrives as a data: URI from Rust, or a relative path in the browser
  // preview. Nothing else may reach an img src.
  if (value.startsWith("data:image/")) return value;
  if (/^[\w./-]+$/.test(value) && !value.startsWith("//")) return value;
  return "";
}

/** The only hosts the CSP will load an image from. */
const ARTWORK_HOST = /^([\w-]+\.)*steamgriddb\.com$/;

/**
 * A thumbnail in the artwork picker, which is the one remote image on the page.
 *
 * Deliberately not part of `safeSrc`: everything else here is a data: URI from
 * Rust or a file sitting beside this one, and widening that guard to let an
 * https URL through would let one into every img on the page. The picker sent
 * its thumbnails through `safeSrc` anyway, which refused every one of them —
 * so the results grid was a wall of blank tiles with only "600×900" underneath,
 * and the artwork was picked without ever being seen.
 */
function safeRemoteSrc(src) {
  let url;
  try {
    url = new URL(String(src ?? ""));
  } catch {
    return "";
  }
  return url.protocol === "https:" && ARTWORK_HOST.test(url.hostname) ? url.href : "";
}

/** Put art into a .plate, or take it away. */
function setPlate(plate, img, src) {
  const safe = safeSrc(src);
  if (safe) {
    img.src = safe;
    img.hidden = false;
    plate.classList.add("has-art");
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    plate.classList.remove("has-art");
  }
}

/* ==========================================================================
   Phases
   ========================================================================== */

function showPhase(next) {
  phase = next;
  for (const [name, node] of Object.entries(el.phases)) {
    node.hidden = name !== next;
  }
  el.shell.classList.toggle("is-running", next === "running");
  refreshRail();
}

/**
 * Whether this is one game or several.
 *
 * The whole selection model is this predicate: a cartridge takes its name and
 * art from the game itself, a multicartridge has neither and has to be given
 * both, which is what step 2 exists for.
 */
function isCollection() {
  return picked.length > 1;
}

function totalBytes() {
  return picked.reduce((sum, g) => sum + (g.sizeOnDisk || 0), 0);
}

/* ==========================================================================
   Step 1 — the library
   ========================================================================== */

function matches(game, query) {
  if (!query) return true;
  return game.name.toLowerCase().includes(query) ||
    String(game.source ?? "").toLowerCase().includes(query);
}

function renderGames() {
  const query = el.search.value.trim().toLowerCase();
  const shown = library.filter((g) => matches(g, query));

  el.games.replaceChildren();
  for (const game of shown) {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "game";
    label.classList.toggle("is-on", picked.some((p) => p.id === game.id));

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = picked.some((p) => p.id === game.id);
    box.addEventListener("change", () => toggle(game, box.checked));

    const name = document.createElement("span");
    name.className = "game__name";
    name.textContent = game.name;

    const meta = document.createElement("span");
    meta.className = "game__meta";
    const size = document.createElement("span");
    if (game.sizeOnDisk) {
      size.textContent = formatBytes(game.sizeOnDisk);
    } else {
      // Not installed locally, so there is no size to report and nothing to
      // copy — the cartridge would be a key to an installed copy.
      size.textContent = "—";
      size.className = "is-unknown";
    }
    const divider = document.createElement("span");
    divider.className = "game__divider";
    const source = document.createElement("span");
    source.textContent = game.source || game.library || "";
    meta.append(size, divider, source);

    label.append(box, name, meta);
    li.append(label);
    el.games.append(li);
  }

  el.gamesEmpty.hidden = shown.length > 0;
  if (shown.length === 0) {
    el.gamesEmpty.textContent = query
      ? "Nothing in your library matches that."
      : "No games found. Steam manifests and a Playnite export are what the wizard reads.";
  }
}

function toggle(game, on) {
  if (on) {
    if (!picked.some((p) => p.id === game.id)) picked.push(game);
  } else {
    picked = picked.filter((p) => p.id !== game.id);
  }
  // Ticking a real game supersedes a half-finished by-hand entry.
  if (picked.length > 0) manual = null;
  onSelectionChanged();
}

async function onSelectionChanged() {
  // Draw first, fetch after. Everything below this point is artwork, which
  // arrives over a network or off a disk; making the whole window wait on it
  // meant ticking a game appeared to do nothing until the cover turned up.
  if (!isCollection()) el.collectionTitle.value = "";
  renderGames();
  renderTickCount();
  refreshRail();

  // A single game brings its own art; a collection has none of its own until it
  // is given some, and each game on it still needs its own poster for the rail.
  if (picked.length === 1 && !art.cover) {
    const game = picked[0];
    try {
      const cover = await invoke("game_cover", { library: game.library, id: game.id });
      if (picked.length === 1 && picked[0].id === game.id) game.cover = cover;
    } catch {
      // no art is a state, not a failure
    }
  }

  if (isCollection()) {
    if (!el.collectionTitle.value.trim()) suggestName();
    // Not awaited: the play order is usable while the posters arrive, and it
    // redraws itself when they do.
    fillGameCovers();
  }

  refreshRail();
}

function renderTickCount() {
  if (manual) {
    el.tickCount.textContent = "by hand";
    return;
  }
  if (picked.length === 0) {
    el.tickCount.textContent = "none ticked";
    return;
  }
  const size = totalBytes();
  el.tickCount.textContent = size
    ? `${picked.length} ticked · ${formatBytes(size)}`
    : `${picked.length} ticked`;
}

async function suggestName() {
  try {
    const name = await invoke("suggest_collection_name", {
      titles: picked.map((g) => g.name),
    });
    el.collectionTitle.placeholder = name || "Game Collection";
  } catch {
    el.collectionTitle.placeholder = `${picked[0]?.name ?? "Games"} and ${picked.length - 1} more`;
  }
  refreshRail();
}

/* ==========================================================================
   Step 2 — name it and give it a face
   ========================================================================== */

function collectionName() {
  return el.collectionTitle.value.trim() || el.collectionTitle.placeholder || "Game Collection";
}

/** exFAT caps a drive label at 11 characters, so the name is squeezed to fit. */
function driveLabelFor(title, filesystem = "exfat") {
  const limit = filesystem === "btrfs" ? 64 : 11;
  const cleaned = String(title).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return cleaned.slice(0, limit) || "GAMEPAK";
}

/** An inline SVG, since these are the only pictures in the interface. */
function icon(paths, size = 14) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", d);
    svg.append(node);
  }
  return svg;
}

const ICON_IMAGE = ["M2.4 3.6h11.2v8.8H2.4z", "M2.4 10l3.2-2.6 2.6 2 2-1.4 3.4 2.4", "M5.9 6.3v.01"];
const ICON_CROSS = ["M4.4 4.4l7.2 7.2", "M11.6 4.4l-7.2 7.2"];
const ICON_GRIP = ["M6 4.5h.01", "M10 4.5h.01", "M6 8h.01", "M10 8h.01", "M6 11.5h.01", "M10 11.5h.01"];

/**
 * One list of games, drawn the same way wherever it appears.
 *
 * Create orders the games about to be written; Edit orders the ones already on
 * a cartridge. They were two renderers with two different sets of controls —
 * arrows in one, drag in the other — for what is visibly the same list, so a
 * person who learned to drag in Create found arrows in Edit.
 *
 * `rows` is the array being reordered in place. Everything is a picture: a grip
 * to say the row moves, the poster it will use, and a cross to take it off.
 */
function renderGameRows(list, rows, { showSize = false, removable = false, onChange }) {
  list.replaceChildren();
  rows.forEach((game, index) => {
    const li = document.createElement("li");
    li.className = "order-row";
    li.draggable = true;
    li.dataset.index = String(index);

    const grip = document.createElement("span");
    grip.className = "order-row__grip";
    grip.append(icon(ICON_GRIP, 13));

    const n = document.createElement("span");
    n.className = "order-row__n";
    n.textContent = String(index + 1);

    // The poster this game gets on the launcher. Steam and Playnite already
    // have one for most games, so the row shows what will be used rather than
    // an empty slot waiting to be filled in.
    const thumb = document.createElement("span");
    thumb.className = "order-row__art";
    const art = safeSrc(game.cover);
    if (art) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = art;
      thumb.append(img);
    } else {
      thumb.classList.add("is-empty");
    }

    const name = document.createElement("span");
    name.className = "order-row__name";
    name.textContent = game.name ?? game.title ?? "";

    li.append(grip, n, thumb, name);

    if (showSize) {
      const size = document.createElement("span");
      size.className = "order-row__size";
      size.textContent = game.sizeOnDisk ? formatBytes(game.sizeOnDisk) : "—";
      li.append(size);
    }

    const poster = document.createElement("button");
    poster.className = "row-btn";
    poster.type = "button";
    // Not draggable, or starting the drag from the button would reorder rather
    // than press.
    poster.draggable = false;
    poster.append(icon(ICON_IMAGE));
    poster.classList.toggle("is-set", Boolean(game.coverSource));
    poster.title = `Poster for ${game.name ?? game.title}`;
    poster.setAttribute("aria-label", poster.title);
    poster.addEventListener("click", (event) => {
      event.stopPropagation();
      openArtwork("cover", Number(li.dataset.index));
    });
    li.append(poster);

    if (removable) {
      const drop = document.createElement("button");
      drop.className = "row-btn row-btn--danger";
      drop.type = "button";
      drop.draggable = false;
      drop.append(icon(ICON_CROSS));
      drop.title = `Take ${game.name ?? game.title} off the cartridge`;
      drop.setAttribute("aria-label", drop.title);
      drop.addEventListener("click", (event) => {
        event.stopPropagation();
        rows.splice(index, 1);
        onChange();
      });
      li.append(drop);
    }

    list.append(li);
  });
}

function renderOrder() {
  renderGameRows(el.orderList, picked, {
    showSize: true,
    onChange: () => {
      renderOrder();
      refreshRail();
    },
  });
}

/* Drag to reorder — the launcher plays them in this order. */
let dragFrom = null;

/**
 * Reordering, for any list drawn by renderGameRows.
 *
 * Attached once per list rather than per row, so a redraw during a drag cannot
 * strand a listener on a row that no longer exists.
 */
function draggable(list, rowsOf, onChange) {
  list.addEventListener("dragstart", (event) => {
    const row = event.target.closest(".order-row");
    if (!row) return;
    dragFrom = Number(row.dataset.index);
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    // WebKitGTK refuses to start a drag whose dataTransfer carries nothing, so
    // the index goes in even though the drop reads it from `dragFrom`.
    event.dataTransfer.setData("text/plain", String(dragFrom));
  });

  list.addEventListener("dragover", (event) => {
    event.preventDefault();
    const row = event.target.closest(".order-row");
    for (const other of list.children) other.classList.remove("is-over");
    if (row) row.classList.add("is-over");
  });

  list.addEventListener("drop", (event) => {
    event.preventDefault();
    const row = event.target.closest(".order-row");
    if (row && dragFrom !== null) {
      const to = Number(row.dataset.index);
      // Looked up now, not captured: `picked` is reassigned by ticking and
      // `editing.games` is replaced whenever another cartridge is opened, so a
      // reference taken when the listener was attached goes stale.
      const rows = rowsOf();
      const [moved] = rows.splice(dragFrom, 1);
      rows.splice(to, 0, moved);
      onChange();
    }
    dragFrom = null;
  });

  list.addEventListener("dragend", () => {
    for (const other of list.children) other.classList.remove("is-over", "is-dragging");
    dragFrom = null;
  });
}

draggable(el.orderList, () => picked, () => {
  renderOrder();
  refreshRail();
});

el.collectionTitle.addEventListener("input", () => {
  refreshRail();
  refreshCreateButton();
});


/* ==========================================================================
   Step 1b — a game nothing scanned
   ========================================================================== */

function enterManual() {
  manual = manual ?? { title: "", executable: "", folder: null, choices: [], cover: null };
  picked = [];
  showPhase("custom");
  renderGames();
  renderTickCount();
  refreshRail();
  refreshRail();
}

async function pickFolder() {
  try {
    const chosen = await invoke("pick_game_folder");
    if (!chosen) return;
    manual = manual ?? { title: "", executable: "", folder: null, choices: [], cover: null };
    manual.folder = chosen;
    // The folder's own name is the best guess at the title, tidied.
    if (!el.customTitle.value.trim()) {
      el.customTitle.value = tidyFolderName(chosen.name || "");
      el.titleHint.hidden = false;
      el.titleHint.textContent = "Taken from the folder name — change it if it is wrong.";
    }
    manual.choices = chosen.choices ?? [];
    renderFolder();
    renderExeChoices();
    refreshRail();
    refreshCreateButton();
  } catch (error) {
    status(String(error), "error");
  }
}

/**
 * "Split_Fiction v1.2" → "Split Fiction".
 *
 * Version tags go before separators are normalised, or "v1.2" turns into
 * "v1 2" and stops looking like a version at all. A guess either way, which is
 * why it is offered as a filled-in field rather than applied silently.
 */
function tidyFolderName(name) {
  return String(name)
    .replace(/\s*[[(].*?[\])]\s*/g, " ")
    .replace(/[_v]?\d+(\.\d+)+\s*$/i, " ")
    .replace(/\bv\d+(\.\d+)*\b/gi, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function renderFolder() {
  const chosen = manual?.folder;
  el.folderChosen.hidden = !chosen;
  el.btnClearFolder.hidden = !chosen;
  el.btnPickFolder.textContent = chosen ? "Change folder…" : "Choose folder…";
  if (chosen) {
    el.folderChosen.textContent = chosen.sizeBytes
      ? `${chosen.path} · ${formatBytes(chosen.sizeBytes)}`
      : chosen.path;
  }
}

/**
 * The executables in the folder, best guess first.
 *
 * The backend scores them; helper runtimes, crash handlers and uninstallers
 * come back negative and are shown last, saying why rather than being hidden —
 * sometimes the odd-looking one really is the game.
 */
function renderExeChoices() {
  const choices = [...(manual?.choices ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  el.exeChoices.replaceChildren();

  if (choices.length === 0) {
    el.exeHint.textContent = manual?.folder
      ? "Nothing in that folder looks like a program. Type the launch target below."
      : "Pick a folder and the programs inside it are listed here.";
    return;
  }

  for (const choice of choices) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "exe";
    btn.classList.toggle("is-demoted", (choice.score ?? 0) < 0);
    btn.setAttribute("aria-pressed", String(manual?.executable === choice.relative));

    const name = document.createElement("span");
    name.className = "exe__name";
    name.textContent = choice.relative;
    btn.append(name);

    const why = whyDemoted(choice);
    if (why) {
      const tag = document.createElement("span");
      tag.className = "exe__why";
      tag.textContent = why;
      btn.append(tag);
    }

    btn.addEventListener("click", () => {
      manual.executable = choice.relative;
      el.customExec.value = "";
      renderExeChoices();
      refreshCreateButton();
    });

    li.append(btn);
    el.exeChoices.append(li);
  }

  el.exeHint.textContent = "Pick the one that starts the game.";
}

function whyDemoted(choice) {
  const name = String(choice.relative ?? "").toLowerCase();
  if (/unins|uninstall/.test(name)) return "uninstaller";
  if (/(^|\/)(ue4prereqsetup|vcredist|dxsetup|directx|dotnet)/.test(name)) return "runtime";
  if (/crashp|crashre|handler/.test(name)) return "crash handler";
  if ((choice.score ?? 0) < 0) return "probably not the game";
  return "";
}

/* ==========================================================================
   Drives
   ========================================================================== */

/**
 * The drive list, for whichever picker asked.
 *
 * Create offers every writable drive; Edit offers only the ones that already
 * hold a cartridge, because editing one that does not exist is not a thing.
 */
function renderDrives({ onlyCartridges = false, choose = selectDrive } = {}) {
  el.drives.replaceChildren();
  // Every drive, every time. This once collapsed to the chosen one, which made
  // sense while the list sat in the rail and made none at all once the list
  // became the picker: opening "Change" to change the drive showed one drive,
  // the one you were trying to change away from.
  const shown = onlyCartridges ? drives.filter((d) => d.hasCartridge) : drives;
  for (const drive of shown) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "drive";
    const current = onlyCartridges ? editing?.drivePath : selectedDrive;
    btn.setAttribute("aria-selected", String(drive.path === current));

    const name = document.createElement("span");
    name.className = "drive__name";
    name.textContent = drive.label || drive.path;

    const meta = document.createElement("span");
    meta.className = "drive__meta";
    meta.textContent = drive.hasCartridge && !onlyCartridges
      ? `${formatBytes(drive.freeBytes)} free · has a cartridge`
      : `${formatBytes(drive.freeBytes)} free of ${formatBytes(drive.totalBytes)}`;
    if (drive.hasCartridge && !onlyCartridges) meta.classList.add("drive__warn");

    btn.append(name, meta);
    btn.addEventListener("click", () => choose(drive));
    li.append(btn);
    el.drives.append(li);
  }

  // A cartridge on a volume Windows never lettered is invisible to every
  // other part of this: it has no path to write to and no path to read from,
  // so it cannot be listed above and could not be found by looking harder.
  // Offering it here, as a drive that needs a letter, is the only way anyone
  // finds out it is there at all — short of opening Disk Management.
  for (const volume of unmounted) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "drive drive--unmounted";

    const name = document.createElement("span");
    name.className = "drive__name";
    // A volume Windows never mounted has no label to read either, so there is
    // often nothing here but the size and the disk it sits on.
    name.textContent =
      volume.label ||
      (volume.filesystem
        ? `${volume.filesystem} volume`
        : `Unnamed volume on disk ${volume.disk}`);

    const meta = document.createElement("span");
    meta.className = "drive__meta drive__warn";
    meta.textContent = `${formatBytes(volume.totalBytes)} · needs a drive letter`;

    btn.append(name, meta);
    btn.addEventListener("click", () => mountVolume(volume, btn));
    li.append(btn);
    el.drives.append(li);
  }

  el.drivesEmpty.hidden = shown.length > 0 || unmounted.length > 0;
  if (shown.length === 0) {
    el.drivesEmpty.textContent = onlyCartridges
      ? "No cartridge is plugged in. Write one on the Create tab first."
      : "No removable drive found. Plug a cartridge in, then press Rescan.";
  }
}

/**
 * Ask Windows to give this volume a drive letter, then pick it up as a drive.
 *
 * Elevates on the backend, so there is a UAC prompt in the middle of it and a
 * decline comes back as an error rather than a silent nothing.
 */
async function mountVolume(volume, button) {
  button.disabled = true;
  status(`Assigning a drive letter to ${volume.label || "the volume"}…`);
  let path;
  try {
    path = await invoke("mount_volume", { volume });
  } catch (error) {
    button.disabled = false;
    status(String(error), "error");
    return;
  }
  await refreshDrives();
  const drive = drives.find((d) => d.path === path);
  if (drive) {
    status(`${drive.label} is ready.`);
    await selectDrive(drive);
  } else {
    status(`Mounted at ${path}.`);
  }
}

/* ==========================================================================
   Change game / Change media

   The library and the drive list did not move into a new widget — they moved
   into a dialog. Same markup, same renderers, same ticking, so multi-select,
   search, "Enter it by hand" and the drag order all behave exactly as they did
   when this list was step 1.
   ========================================================================== */

function openPick(kind) {
  const games = kind === "game";
  el.pickTitle.textContent = games ? "Choose a game" : "Choose the media";
  el.pickGames.hidden = !games;
  el.pickMedia.hidden = games;
  el.pickDialog.showModal();
  if (games) el.search.focus();
}

function openGamePicker() {
  openPick("game");
}

function openMediaPicker() {
  openPick("media");
}

async function selectDrive(drive) {
  selectedDrive = drive.path;
  renderDrives();
  // One drive is the whole answer, so the dialog has nothing left to ask.
  if (el.pickDialog.open && !el.pickMedia.hidden) el.pickDialog.close();

  formatPlan = null;
  try {
    formatPlan = await invoke("format_plan", { drivePath: drive.path });
  } catch {
    formatPlan = null;
  }

  try {
    driveIsSteamLibrary = Boolean(
      await invoke("steam_registration", { drivePath: drive.path }),
    );
  } catch {
    driveIsSteamLibrary = false;
  }

  await readLinkRate(drive.path);

  el.btnUnregister.hidden = !driveIsSteamLibrary;
  refreshRail();
}

/* ==========================================================================
   What gets written
   ========================================================================== */

/** The filesystem a fresh cartridge is made with. Settings decides. */
function filesystem() {
  return settings.defaultFilesystem === "btrfs" ? "btrfs" : "exfat";
}

function filesystemLabel(fs) {
  return fs === "btrfs" ? "btrfs" : "exFAT";
}

/** Every game that would actually have its files copied. */
function copyable() {
  if (manual) return manual.folder ? [manual] : [];
  return picked.filter((g) => g.sizeOnDisk > 0);
}

/* ==========================================================================
   Rate and time
   --------------------------------------------------------------------------
   An estimate has to come from somewhere real or it should not be shown. The
   write rate starts as a conservative figure for a USB-attached NVMe, and is
   replaced by the measured rate the moment the copy is actually running — so
   the number on the button before the write is an estimate, and the number
   during it is an observation.
   ========================================================================== */

/**
 * What to assume before anything has been measured.
 *
 * A cartridge is only as quick as the link it is on, and the launcher already
 * asks the drive what that is. A negotiated link gives a ceiling; the fraction
 * of it a real copy reaches is well under the theoretical figure, because a
 * game is thousands of files rather than one long stream. When the link cannot
 * be read at all, this is the fallback — deliberately pessimistic, so an
 * estimate comes in early rather than late.
 */
const FALLBACK_WRITE_BYTES_PER_S = 120_000_000;

/** Sustained many-file throughput as a share of the negotiated link. */
const LINK_EFFICIENCY = 0.45;

let measuredRate = null;
let linkRate = null;

function writeRate() {
  return measuredRate ?? linkRate ?? FALLBACK_WRITE_BYTES_PER_S;
}

/** Ask the drive what it is connected at, so the estimate has a basis. */
async function readLinkRate(drivePath) {
  linkRate = null;
  try {
    const health = await invoke("cartridge_health", { drivePath });
    if (typeof health?.linkMbps === "number" && health.linkMbps > 0) {
      linkRate = (health.linkMbps * 1_000_000 / 8) * LINK_EFFICIENCY;
    }
  } catch {
    // an estimate without it is still an estimate
  }
}

/** Reading back to verify is faster than writing, but not free. */
function readRate() {
  return writeRate() * 1.6;
}

/** Seconds the whole build is expected to take, from what is ticked. */
function estimateSeconds() {
  let seconds = 0;
  if (on.format) seconds += 20;
  if (on.closeSteam) seconds += 5;
  const size = on.copy ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0) : 0;
  if (size) seconds += size / writeRate();
  if (on.verify && size) seconds += size / readRate();
  seconds += 2; // conf, launcher, manifest
  return seconds;
}

/* ==========================================================================
   The plan: what is ticked, in the order it will happen
   ========================================================================== */

function planSteps() {
  const steps = [];
  const size = on.copy
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;

  if (on.format && formatPlan) {
    steps.push({
      what: `Format ${formatPlan.currentLabel} as ${filesystemLabel(filesystem())}`,
      detail: `renamed ${driveLabelFor(cartridgeTitle(), filesystem())} · ~20 s`,
      danger: true,
    });
  }
  if (on.copy && on.closeSteam) {
    const steamCount = picked.filter((g) => g.library === "steam").length;
    steps.push({
      what: "Close Steam",
      detail: steamCount ? `${steamCount} of ${picked.length} are Steam games` : "the drive is a Steam library",
    });
  }
  if (size) {
    const folders = copyable().length;
    steps.push({
      what: `Copy ${formatBytes(size)}`,
      detail: `${folders} folder${folders === 1 ? "" : "s"} · ${formatDuration(size / writeRate())}`,
    });
  }
  if (on.verify && size) {
    steps.push({ what: "Verify the copy", detail: formatDuration(size / readRate()) });
  }
  steps.push({
    what: on.icon
      ? "Write launcher, icon and manifest"
      : "Write the launcher and manifest",
    detail: on.icon ? "autorun.ico · ~2 s" : "~2 s",
  });
  if (on.tune) {
    steps.push({ what: "Tune Windows for this cartridge", detail: "Defender and Search" });
  }
  if (on.trim) {
    steps.push({ what: "Release freed space", detail: "needs the format permission" });
  }
  if (on.eject) {
    // Only a formatted drive answers to the new name; otherwise it keeps its own.
    const name = on.format
      ? driveLabelFor(cartridgeTitle(), filesystem()) || driveLabel()
      : driveLabel();
    steps.push({ what: `Eject ${name}` });
  }
  return steps;
}

function driveLabel() {
  return drives.find((d) => d.path === selectedDrive)?.label ?? "the cartridge";
}

function refreshPlan() {
  // The plan is only worth showing once there is a drive for it to happen to.
  const show = selectedDrive && (picked.length > 0 || manual);
  el.railPlan.hidden = !show;
  if (!show) return;

  el.plan.replaceChildren();
  planSteps().forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "plan-row";
    if (step.danger) li.classList.add("plan-row--danger");

    const n = document.createElement("span");
    n.className = "plan-row__n";
    n.textContent = String(index + 1);

    const body = document.createElement("span");
    const what = document.createElement("span");
    what.className = "plan-row__what";
    what.textContent = step.what;
    body.append(what);
    if (step.detail) {
      const detail = document.createElement("span");
      detail.className = "plan-row__detail";
      detail.textContent = step.detail;
      body.append(detail);
    }

    li.append(n, body);
    el.plan.append(li);
  });
}

/* ==========================================================================
   The rail
   ========================================================================== */

function cartridgeTitle() {
  if (manual) return el.customTitle.value.trim() || "Untitled";
  if (isCollection()) return collectionName();
  return picked[0]?.name ?? "";
}

function refreshRail() {
  if (activeTab === "edit") {
    el.barText.textContent = editing?.title ? `Edit ${editing.title}` : "Edit cartridge";
    el.railEmpty.hidden = Boolean(editing);
    el.railBody.hidden = !editing;
    if (editing) {
      const games = editing.games ?? [];
      el.railKindText.textContent = games.length > 1 ? "Multicartridge" : "Cartridge";
      el.railKindCount.hidden = games.length <= 1;
      el.railKindCount.textContent = `${games.length} games`;
      renderRailLauncher(editing.cover, {
        title: el.editTitle.value.trim() || editing.title,
        first: games[0]?.title,
        games: games.length,
      });
      el.railSpace.hidden = true;
      el.railPlan.hidden = true;
    }
    refreshCreateButton();
    return;
  }

  const has = picked.length > 0 || Boolean(manual);
  el.railEmpty.hidden = has;
  el.railBody.hidden = !has;

  // The build screen is the left column, not part of the rail, so it renders
  // whether or not a game has been chosen — choosing the media before the game
  // is a perfectly ordinary way round, and the card has to say so.
  renderBuild();

  if (!has) {
    refreshCreateButton();
    return;
  }

  // Cartridge or Multicartridge — the panel titles itself to the tick count.
  const collection = isCollection();
  el.railKindText.textContent = collection ? "Multicartridge" : "Cartridge";
  el.railKindCount.hidden = !collection;
  el.railKindCount.textContent = `${picked.length} games`;
  el.barText.textContent = building
    ? `Writing ${on.format ? driveLabelFor(cartridgeTitle(), filesystem()) || driveLabel() : driveLabel()}`
    : collection
      ? "Create multicartridge"
      : "Create cartridge";

  // The rail shows what the cartridge will look like. What it *is* — the game,
  // the drive, the artwork — is stated by the cards in the left column, so
  // repeating any of it here would be two places to keep in step.
  const coverSrc = art.cover?.preview ?? (collection ? null : picked[0]?.cover);
  renderRailLauncher(coverSrc);

  renderBuild();
  refreshSpace();
  refreshPlan();
  refreshCreateButton();
}

/**
 * Keep the preview scaled to whatever width the rail gives it.
 *
 * The card is laid out at the launcher's real 420x560 so every size inside it is
 * the size the launcher itself uses. Fitting it to the rail is therefore one
 * number, and CSS cannot work it out: `scale()` needs a unitless factor and
 * there is no way to divide a container width by 420 to get one.
 */
function fitRailLauncher() {
  const frame = el.railLauncherCard?.parentElement;
  if (!frame) return;
  const width = frame.clientWidth;
  if (width > 0) el.railLauncherCard.style.setProperty("--rail-scale", String(width / 420));
}

if (el.railLauncherCard?.parentElement && "ResizeObserver" in window) {
  new ResizeObserver(fitRailLauncher).observe(el.railLauncherCard.parentElement);
}

/**
 * The launcher, as this cartridge will look when it is plugged in.
 *
 * Built from the same three parts the real one is — the cover behind, the logo
 * or the title over it, Play in the accent — because the question the wizard
 * cannot otherwise answer is whether the artwork and the title survive being put
 * on top of each other. A cover thumbnail on its own never shows that.
 *
 * `--rail-accent` is set from the cover the same way the launcher samples it, so
 * a dark cover gets a light Play and a bright one gets dark ink, here as there.
 */
function renderRailLauncher(coverSrc, override = null) {
  const collection = override ? (override.games ?? 0) > 1 : isCollection();
  setPlate(el.railLauncherCard, el.railLauncherArt, coverSrc);

  // Edit hands in what the cartridge already says, so the preview answers the
  // same question there as here: what will this look like when it is plugged
  // in — which is most of what editing a cartridge is for.
  if (override) {
    el.railLauncherLogo.hidden = true;
    el.railLauncherStage.classList.remove("has-logo");
    el.railLauncherEyebrow.hidden = !collection;
    el.railLauncherEyebrow.textContent = collection ? override.title || "Collection" : "";
    const name = (collection ? override.first : override.title) || override.title || "Nothing yet";
    el.railLauncherTitle.textContent = name;
    el.railLauncherTitle.classList.toggle("is-long", name.length > 22);
    el.railExplorer.hidden = true;
    return;
  }

  // A collection's own name goes above the title, because on a collection the
  // title names whichever game is selected rather than the cartridge.
  const logoSrc = safeSrc(art.logo?.preview);
  el.railLauncherLogo.hidden = !logoSrc;
  if (logoSrc) el.railLauncherLogo.src = logoSrc;
  el.railLauncherStage.classList.toggle("has-logo", Boolean(logoSrc));

  el.railLauncherEyebrow.hidden = !collection || Boolean(logoSrc);
  el.railLauncherEyebrow.textContent = collection ? cartridgeTitle() || "Collection" : "";

  // With a logo the title is already printed in the artwork; without one this
  // is the launcher's heading, so it shows the game rather than the collection.
  const heading = collection
    ? picked[0]?.name || cartridgeTitle() || "Nothing yet"
    : cartridgeTitle() || "Nothing yet";
  el.railLauncherTitle.textContent = heading;
  el.railLauncherTitle.classList.toggle("is-long", heading.length > 22);

  renderRailExplorer();
}

/** The drive as Explorer will label it — the one thing the icon slot is for. */
function renderRailExplorer() {
  const drive = drives.find((d) => d.path === selectedDrive);
  const named = on.icon;
  el.railExplorer.hidden = !drive || !named;
  if (!drive) return;

  const icon = safeSrc(art.icon?.preview) || safeSrc(art.cover?.preview) || safeSrc(picked[0]?.cover);
  el.railExplorerIcon.style.backgroundImage = icon ? `url("${icon}")` : "";
  el.railExplorerIcon.classList.toggle("is-blank", !icon);

  const label = on.format ? driveLabelFor(cartridgeTitle(), filesystem()) : driveLabel();
  const name = label || cartridgeTitle() || "Cartridge";
  // The path is only worth appending when it says something the name does not.
  // It usually does not: on Windows `drive.label` is already "STARDEW (G:)", and
  // on Linux the mount point is named after the label, so a naive append gives
  // "STARDEW (G:) (G:)" or "CINDER (CINDER)".
  const where = shortPath(drive.path);
  const said =
    name.toLowerCase() === where.toLowerCase() ||
    name.toLowerCase().endsWith(`(${where.toLowerCase()})`);
  el.railExplorerName.textContent = said ? name : `${name} (${where})`;
  el.railExplorerFree.textContent = `${formatBytes(drive.freeBytes)} free`;
}

/**
 * How a drive is worth naming in a sentence: `E:` on Windows, and the mount
 * point's own name elsewhere.
 *
 * Explorer's row has one line to play with, so printing
 * `/run/media/harry/CINDER` in it pushes out the thing the row is actually for.
 */
function shortPath(path) {
  const trimmed = String(path ?? "").replace(/[\\/]+$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
  const last = trimmed.split(/[\\/]/).filter(Boolean).pop();
  return last || trimmed || "?";
}

/**
 * The build screen: what is chosen, on one page.
 *
 * Every card here is a statement of the current answer with the way to change
 * it beside it. Nothing is a step, so nothing has to be finished before the
 * next thing can be looked at — which is the point of the rebuild.
 */
function renderBuild() {
  const collection = isCollection();
  const first = picked[0];

  // --- Game -------------------------------------------------------------
  const coverSrc = art.cover?.preview ?? (collection ? null : first?.cover);
  setPlate(el.buildGamePlate, el.buildGameCover, coverSrc);

  if (manual) {
    el.buildGameTitle.textContent = manual.title || "Entered by hand";
    el.buildGameMeta.textContent = manual.folder
      ? `By hand · ${formatBytes(manual.folder.sizeBytes)}`
      : "By hand";
  } else if (collection) {
    el.buildGameTitle.textContent = cartridgeTitle() || `${picked.length} games`;
    el.buildGameMeta.textContent = `${picked.length} games · ${formatBytes(totalBytes())}`;
  } else if (first) {
    el.buildGameTitle.textContent = first.name;
    const bits = [];
    if (first.source) bits.push(first.source);
    bits.push(first.sizeOnDisk ? formatBytes(first.sizeOnDisk) : "not installed");
    el.buildGameMeta.textContent = bits.join(" · ");
  } else {
    el.buildGameTitle.textContent = "Choose games";
    el.buildGameMeta.textContent = "";
  }

  // Naming and ordering only mean anything with more than one game on it.
  el.buildName.hidden = !collection;
  if (collection) {
    renderOrder();
  }

  // --- Media ------------------------------------------------------------
  const drive = drives.find((d) => d.path === selectedDrive);
  if (drive) {
    el.buildMediaTitle.textContent = drive.label || drive.path;
    const bits = [`${formatBytes(drive.freeBytes)} free`, filesystemLabel(filesystem())];
    if (drive.hasCartridge) bits.push("has a cartridge");
    el.buildMediaMeta.textContent = bits.join(" · ");
  } else {
    el.buildMediaTitle.textContent = "Choose media";
    el.buildMediaMeta.textContent = "";
  }


  // --- Artwork ----------------------------------------------------------
  el.coverSlot.hidden = collection;
  setPlate(el.collectionCover, el.collectionCoverImg, coverSrc);
  setPlate(el.slotLogo, el.slotLogoImg, art.logo?.preview);
  setPlate(el.slotIcon, el.slotIconImg, art.icon?.preview ?? coverSrc);
  el.btnInheritCover.textContent = first ? `Use ${first.name}'s artwork` : "";
  el.btnInheritCover.hidden = !collection || !first || Boolean(art.cover);
}


/**
 * What it costs on the drive — one band per game.
 *
 * A stack of bands rather than one bar, so it is visible which game is taking
 * the room before anything is written.
 */
function refreshSpace() {
  const drive = drives.find((d) => d.path === selectedDrive);
  const list = copyable();
  const size = list.reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0);

  el.railSpace.hidden = !drive || size === 0;
  if (el.railSpace.hidden) return;

  const capacity = on.format ? drive.totalBytes : drive.freeBytes;
  el.railDriveLabel.textContent = drive.label || drive.path;
  el.railDriveFill.textContent = `${formatBytes(size)} of ${formatBytes(drive.totalBytes)}`;

  el.railBar.replaceChildren();
  el.railBar.classList.toggle("is-over", size > capacity);
  // The band widths are the grid's track sizes, set in one go on the container,
  // so the transition has a single property to interpolate rather than one per
  // band. The bands themselves carry only their colour.
  const tracks = [];
  list.forEach((game, index) => {
    const bytes = game.sizeOnDisk || game.folder?.sizeBytes || 0;
    tracks.push(`${Math.max(1, (bytes / drive.totalBytes) * 100)}%`);
    const band = document.createElement("div");
    // Each band a step further round the accent's hue, so they read as one
    // family rather than a chart.
    band.style.background = `color-mix(in oklch, var(--accent) ${100 - index * 12}%, oklch(0.5 0.12 20))`;
    el.railBar.append(band);
  });
  el.railBar.style.gridTemplateColumns = tracks.join(" ");
}

/* ==========================================================================
   The button, and what it is waiting for
   ========================================================================== */

function blockingReason() {
  if (picked.length === 0 && !manual) return "tick a game";
  if (manual && !manual.executable && !el.customExec.value.trim() && !manual.folder) {
    return "say what Play should start";
  }
  if (manual && !el.customTitle.value.trim()) return "give it a title";
  if (!selectedDrive) return "choose a cartridge";

  const drive = drives.find((d) => d.path === selectedDrive);
  const size = on.copy
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;
  const capacity = on.format ? drive?.totalBytes : drive?.freeBytes;
  if (size > 0 && drive && size > capacity) return "free enough space";

  if (on.format) {
    // No typed confirmation to wait for — formatting is a setting now. The plan
    // is still required, because it is what states on screen which drive is
    // about to be erased and what is on it.
    if (!formatPlan) return "load the drive format details";
    if (!driveLabelFor(cartridgeTitle(), filesystem())) return "name the drive";
  }
  return "";
}

function refreshCreateButton() {
  if (building) {
    el.create.disabled = true;
    return;
  }

  // Edit writes changes to a cartridge that exists. Same button, same place,
  // one word different — there is no second Save tucked into the panel.
  if (activeTab === "edit") {
    el.create.disabled = !editing;
    el.createLabel.textContent = "Update cartridge";
    el.readyMessage.textContent = editing
      ? `Changing ${editing.title || "this cartridge"}`
      : "Choose a cartridge to edit";
    el.readyMessage.className = "";
    return;
  }

  const collection = isCollection();
  const reason = blockingReason();
  const ready = reason === "";
  el.create.disabled = !ready;

  el.createLabel.textContent = on.format
    ? "Format and write"
    : collection
      ? "Write multicartridge"
      : "Write cartridge";

  if (!ready) {
    el.readyMessage.textContent =
      picked.length === 0 && !manual ? "Nothing to write yet" : `Ready when: ${reason}`;
    el.readyMessage.className = "";
    return;
  }

  const seconds = estimateSeconds();
  const size = on.copy
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;

  if (on.format && formatPlan) {
    el.readyMessage.textContent = `Erases ${formatPlan.currentLabel} · ${formatDuration(seconds)}`;
    el.readyMessage.className = "is-destructive";
  } else {
    el.readyMessage.textContent = size
      ? `Ready — ${formatBytes(size)}, ${formatDuration(seconds)}`
      : `Ready — ${formatDuration(seconds)}`;
    el.readyMessage.className = "is-ready";
  }
}

/* ==========================================================================
   Writing
   ========================================================================== */

/** One row per step of the plan, ticked off as the build reports them. */
function renderLog(steps, doneCount) {
  el.log.replaceChildren();
  steps.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "log-row";
    if (index < doneCount) li.classList.add("is-done");
    else if (index === doneCount) li.classList.add("is-now");

    const mark = document.createElement("span");
    mark.className = "log-row__mark";
    if (index < doneCount) {
      mark.innerHTML =
        '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="8" height="8" aria-hidden="true"><path d="M2.4 6.2l2.2 2.2 5-5.4" /></svg>';
    }

    const text = document.createElement("span");
    text.textContent = step.what;

    li.append(mark, text);
    el.log.append(li);
  });
}

/** The options that are in force, so the running window still says what it is doing. */
function renderForced() {
  const rows = [
    [on.format, `Formatted as ${filesystemLabel(filesystem())}`, "Not formatted"],
    [on.copy, "Games copied onto the cartridge", "Nothing copied — a key only"],
    [on.verify && on.copy, "Verify after copying", "Copy not verified"],
    [on.icon, "Drive icon from artwork", "No drive icon"],
    [on.tune, "Windows tuned", "Windows tuning skipped"],
    [on.eject, "Eject when done", "Left mounted"],
  ];

  el.forced.replaceChildren();
  for (const [on, yes, no] of rows) {
    const li = document.createElement("li");
    li.className = on ? "forced-row" : "forced-row is-off";
    const mark = document.createElement("span");
    mark.className = "forced-row__mark";
    mark.textContent = on ? "✓" : "—";
    const text = document.createElement("span");
    text.textContent = on ? yes : no;
    li.append(mark, text);
    el.forced.append(li);
  }
}

let runStartedAt = 0;
let planForRun = [];
let doneSteps = 0;

function onProgress(p) {
  // The step name the backend reports moves the log on.
  const stepIndex = planForRun.findIndex((s) => s.step === p.step);
  if (stepIndex >= 0 && stepIndex > doneSteps) doneSteps = stepIndex;

  el.runningPhase.textContent = p.message || "";
  if (p.title) el.runningTitle.textContent = p.title;

  if (p.totalBytes > 0) {
    el.progressFill.classList.remove("is-indeterminate");
    const pct = Math.min(100, (p.doneBytes / p.totalBytes) * 100);
    el.progressFill.style.transform = `scaleX(${pct / 100})`;
    el.progressTrack.setAttribute("aria-valuenow", pct.toFixed(0));
    el.progressTrack.setAttribute(
      "aria-valuetext",
      `${p.message} ${formatBytes(p.doneBytes)} of ${formatBytes(p.totalBytes)}, ${pct.toFixed(0)}%`,
    );

    el.writtenDone.textContent = formatBytes(p.doneBytes).replace(/\s\w+$/, "");
    el.writtenTotal.textContent = ` / ${formatBytes(p.totalBytes)}`;

    // Measured, not assumed, the moment there is anything to measure.
    const elapsed = (performance.now() - runStartedAt) / 1000;
    if (elapsed > 2 && p.doneBytes > 0) {
      measuredRate = p.doneBytes / elapsed;
      el.rate.textContent = `${formatBytes(measuredRate)}/s`;
      const left = (p.totalBytes - p.doneBytes) / measuredRate;
      el.remaining.textContent = clock(left);
    }
  } else {
    // Steps without a byte count still need to look alive. The inline scale
    // has to go, or it would sit under the sweep's own transform.
    el.progressFill.style.transform = "";
    el.progressFill.classList.add("is-indeterminate");
    el.progressTrack.removeAttribute("aria-valuenow");
    el.progressTrack.setAttribute("aria-valuetext", p.message);
  }

  if (p.file) el.currentFile.textContent = p.file;
  renderLog(planForRun, doneSteps);
}

function buildRequest() {
  const shared = {
    drivePath: selectedDrive,
    formatDrive: on.format,
    formatFilesystem: filesystem(),
    formatLabel: driveLabelFor(cartridgeTitle(), filesystem()) || null,
    copyGame: on.copy,
    closeSteam: on.closeSteam,
    verifyCopy: on.verify,
    trimAfterWrite: on.trim,
    writeIcon: on.icon,
  };

  if (isCollection()) {
    return {
      ...shared,
      title: collectionName(),
      executable: "",
      collectionCoverSource: art.cover?.path ?? null,
      collectionLogoSource: art.logo?.path ?? null,
      collectionIconSource: art.icon?.path ?? null,
      games: picked.map((g) => ({
        title: g.name,
        executable: g.executable,
        appId: g.library === "steam" ? g.id : null,
        playniteId: g.library === "playnite" ? g.id : null,
        // A scanned game has no launcher behind it, so its id *is* its folder.
        // The backend copies that folder and works out what to run inside it.
        sourceDir: g.library === "folder" ? g.id : null,
        coverSource: g.coverSource ?? null,
      })),
    };
  }

  if (manual) {
    return {
      ...shared,
      title: el.customTitle.value.trim(),
      executable: el.customExec.value.trim() || manual.executable || "",
      appId: null,
      playniteId: null,
      sourceDir: manual.folder?.path ?? null,
      copyExecutable: manual.executable || null,
      coverSource: art.cover?.path ?? null,
      iconSource: art.icon?.path ?? null,
      logoSource: art.logo?.path ?? null,
    };
  }

  const game = picked[0];
  return {
    ...shared,
    title: game.name,
    executable: game.executable,
    appId: game.library === "steam" ? game.id : null,
    playniteId: game.library === "playnite" ? game.id : null,
    sourceDir: game.library === "folder" ? game.id : null,
    coverSource: art.cover?.path ?? null,
    iconSource: art.icon?.path ?? null,
    logoSource: art.logo?.path ?? null,
  };
}

async function write() {
  if (building || el.create.disabled) return;

  building = true;
  measuredRate = null;
  runStartedAt = performance.now();
  doneSteps = 0;

  // The plan the log ticks through, tagged with the step names the backend
  // reports so the two stay in step.
  planForRun = planSteps().map((step) => ({
    ...step,
    step: stepKeyFor(step.what),
  }));

  renderForced();
  el.railForced.hidden = false;
  el.railPlan.hidden = true;
  el.runningTitle.textContent = cartridgeTitle();
  el.runningPhase.textContent = "Starting…";
  el.writtenDone.textContent = "—";
  el.writtenTotal.textContent = "";
  el.remaining.textContent = "—";
  el.rate.textContent = "";
  el.currentFile.textContent = "";
  el.progressFill.style.transform = "";
  el.progressFill.classList.add("is-indeterminate");
  renderLog(planForRun, 0);
  showPhase("running");
  refreshCreateButton();
  status("");
  el.close.disabled = true;

  try {
    const request = buildRequest();
    const result = await invoke("create_cartridge", { request });

    doneSteps = planForRun.length;
    renderLog(planForRun, doneSteps);
    el.progressFill.classList.remove("is-indeterminate");
    el.progressFill.style.transform = "scaleX(1)";

    const drive = drives.find((d) => d.path === selectedDrive);
    const parts = [`Cartridge written to ${drive ? drive.label : selectedDrive}.`];
    if (result.formatted) {
      parts.push(`Formatted to ${filesystemLabel(result.formattedFilesystem || request.formatFilesystem)}.`);
    }
    if (result.gameCopied) {
      parts.push(
        result.gameFolder
          ? `Copied ${formatBytes(result.bytesCopied)} to ${result.gameFolder}.`
          : `Copied ${formatBytes(result.bytesCopied)}.`,
      );
    }
    if (result.registeredWithSteam) parts.push("Registered as a Steam library.");
    for (const warning of result.warnings ?? []) parts.push(warning);

    // Tuning elevates, so it happens here rather than inside the copy: the UAC
    // prompt lands once, after the long part is over, and declining it costs
    // nothing that has already been written. Before the eject, because tuning a
    // cartridge that has just been unmounted does nothing at all.
    //
    // It was in the plan and in the summary before it was in the code: the run
    // showed "Tune Windows for this cartridge", finished, and reported "Windows
    // tuned" without anything having called apply_tuning. Which is why the
    // cartridges that had been through this wizard were still being scanned.
    if (on.tune) {
      try {
        const tuned = await invoke("apply_tuning", {
          drivePath: selectedDrive,
          tweaks: ["defender", "indexing"],
          applying: true,
        });
        parts.push(...tuned);
      } catch (error) {
        parts.push(`Written, but Windows was not tuned: ${error}`);
      }
    }

    // Ejecting is a step of the plan, not an afterthought, so it reports into
    // the same status line.
    if (on.eject) {
      try {
        await invoke("eject_drive", { drivePath: selectedDrive });
        parts.push("Safe to remove.");
      } catch (error) {
        parts.push(`Written, but the drive would not eject: ${error}`);
      }
    }

    status(parts.join(" "), (result.warnings ?? []).length ? "" : "good");
    el.runningPhase.textContent = "Done";
  } catch (error) {
    status(String(error), "error");
    el.runningPhase.textContent = "Stopped";
    showPhase("build");
  } finally {
    building = false;
    el.close.disabled = false;
    el.railForced.hidden = true;
    await refreshDrives();
    refreshCreateButton();
  }
}

/** Match a plan step to the step name the backend reports for it. */
function stepKeyFor(what) {
  const text = what.toLowerCase();
  if (text.startsWith("format")) return "format";
  if (text.startsWith("close steam")) return "steam";
  if (text.startsWith("copy")) return "copy";
  if (text.startsWith("verify")) return "verify";
  if (text.startsWith("write")) return "autorun";
  if (text.startsWith("tune")) return "tune";
  if (text.startsWith("release")) return "trim";
  if (text.startsWith("eject")) return "eject";
  return "";
}

/* ==========================================================================
   Artwork
   ========================================================================== */

let artTarget = "cover";
let sgdbTimer = null;

/**
 * Which game's poster is being chosen, as an index into `picked`.
 *
 * `null` means the cartridge's own art. A multicartridge has both: one
 * background, logo and icon for the cartridge, and a poster for each game on
 * it, because the launcher shows a different picture per row and a different
 * one again behind the whole thing.
 */
let artGame = null;

/**
 * The game a poster is being chosen for, from whichever list is on screen.
 *
 * Create orders `picked`; Edit orders the cartridge's own games. Resolving
 * against `picked` either way meant the poster button on the Edit tab pointed
 * into the wrong array — usually an empty one, so it silently did nothing.
 */
function artGameOf() {
  if (artGame === null) return null;
  const rows = activeTab === "edit" ? editing?.games ?? [] : picked;
  return rows[artGame] ?? null;
}

/** Redraw whichever list the poster just landed in. */
function renderActiveGameList() {
  if (activeTab === "edit") renderEditGames();
  else renderOrder();
}

function openArtwork(target, gameIndex = null) {
  artTarget = gameIndex === null ? target : "cover";
  artGame = gameIndex;

  const game = artGameOf();
  // A game on a collection has exactly one piece of art: its poster. The
  // background, logo and icon belong to the cartridge, not to any one game, so
  // the tabs that pick them are not offered here.
  el.sgdbTabs.hidden = game !== null;
  for (const tab of el.sgdbTabs.children) {
    tab.setAttribute("aria-selected", String(tab.dataset.type === kindFor(artTarget)));
  }
  el.sgdbTitle.textContent = game ? `Poster — ${game.name}` : "Artwork";
  el.sgdbSearch.value = game ? game.name : cartridgeTitle();
  el.icoReceipt.hidden = true;
  refreshPreview();
  el.sgdbDialog.showModal();
  if (settings.steamgriddbEnabled) searchArtwork();
  else {
    el.sgdbStatus.textContent =
      "SteamGridDB lookup is off. Turn it on in Settings, or paste a URL below.";
    el.sgdbResults.replaceChildren();
  }
}

function kindFor(target) {
  return { cover: "grid", background: "hero", logo: "logo", icon: "icon" }[target] ?? "grid";
}

/**
 * How a downloaded image is filed.
 *
 * `cacheKey` names the file in the artwork cache, alongside a hash of the URL,
 * so it is namespaced by game as well as kind: two cartridges both asking for
 * a grid are not asking for the same picture. `gameKey` is what the backend
 * remembers the choice under, so reopening a cartridge can offer the artwork
 * that was used last time.
 */
function artworkKeys() {
  const name = artGameOf()?.name ?? cartridgeTitle() ?? "";
  const game = name || "untitled";
  return { cacheKey: `${game}-${kindFor(artTarget)}`, gameKey: game };
}

/**
 * File a chosen image against whatever the dialog is currently pointed at.
 *
 * A game's poster lives on the game, so it survives reordering and so
 * buildRequest can hand the backend one cover per `[game]` block. Everything
 * else is the cartridge's, and lives in `art`.
 */
function applyArt(path, preview) {
  const game = artGameOf();
  if (game) {
    game.coverSource = path;
    game.cover = preview;
    renderActiveGameList();
    refreshRail();
    return;
  }
  art[artTarget] = { path, preview };
}

function targetFor(kind) {
  return { grid: "cover", logo: "logo", icon: "icon" }[kind] ?? "cover";
}

el.sgdbTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  artTarget = targetFor(tab.dataset.type);
  for (const other of el.sgdbTabs.children) {
    other.setAttribute("aria-selected", String(other === tab));
  }
  el.icoReceipt.hidden = true;
  if (settings.steamgriddbEnabled) searchArtwork();
});

async function searchArtwork() {
  const query = el.sgdbSearch.value.trim();
  if (!query) {
    el.sgdbStatus.textContent = "Type a game title.";
    return;
  }
  el.sgdbStatus.textContent = "Searching…";
  el.sgdbResults.replaceChildren();

  try {
    const found = await invoke("sgdb_search_games", { query });
    if (!found?.length) {
      el.sgdbStatus.textContent = "No SteamGridDB matches.";
      return;
    }
    const artwork = await invoke("sgdb_get_artwork", {
      gameId: found[0].id,
      artType: kindFor(artTarget),
    });
    renderArtwork(artwork ?? []);
  } catch (error) {
    el.sgdbStatus.textContent = String(error);
  }
}

function renderArtwork(list) {
  el.sgdbStatus.textContent = list.length ? "" : "No artwork of that kind.";
  el.sgdbResults.replaceChildren();

  for (const item of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "art-card";
    btn.setAttribute("aria-pressed", "false");

    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = safeRemoteSrc(item.thumb) || safeRemoteSrc(item.url);
    const meta = document.createElement("span");
    meta.className = "art-card__meta";
    meta.textContent = item.width && item.height ? `${item.width}×${item.height}` : "SteamGridDB";

    btn.append(img, meta);
    btn.addEventListener("click", () => chooseArtwork(item, btn));
    el.sgdbResults.append(btn);
  }
}

async function chooseArtwork(item, btn) {
  for (const other of el.sgdbResults.children) other.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-pressed", "true");
  el.sgdbStatus.textContent = "Fetching…";

  try {
    const got = await invoke("sgdb_download_artwork", { url: item.url, ...artworkKeys() });
    applyArt(got.path, got.dataUri);
    el.sgdbStatus.textContent = "";

    // The icon is the only kind that becomes a different file on disk, so it
    // is the only one that reports back — a line of type, not a wizard page.
    if (artTarget === "icon") {
      const name = String(got.path).split(/[/\\]/).pop();
      el.icoReceipt.hidden = false;
      el.icoReceipt.textContent =
        `${name} — converted to cover.ico at the cartridge root, at every size Explorer asks for.`;
    }

    refreshPreview();
    refreshRail();
  } catch (error) {
    el.sgdbStatus.textContent = String(error);
  }
}

/** Where the chosen artwork lands: the launcher, exactly as it will look. */
function refreshPreview() {
  // While a game's poster is being chosen, the preview shows that game — it is
  // the row the picture will land on, not the cartridge's own face.
  const targeted = artGameOf();
  const grid = targeted
    ? targeted.cover
    : art.cover?.preview ?? (isCollection() ? null : picked[0]?.cover);

  el.previewGrid.hidden = !safeSrc(grid);
  if (safeSrc(grid)) el.previewGrid.src = safeSrc(grid);
  el.previewArt.classList.toggle("has-art", Boolean(safeSrc(grid)));

  const logo = art.logo?.preview;
  el.previewLogo.hidden = !safeSrc(logo);
  if (safeSrc(logo)) el.previewLogo.src = safeSrc(logo);
  el.previewStage.classList.toggle("has-logo", Boolean(safeSrc(logo)));
  el.previewTitle.textContent = targeted?.name ?? (cartridgeTitle() || "Nothing yet");

  const icon = art.icon?.preview ?? grid;
  el.previewIcon.style.backgroundImage = safeSrc(icon) ? `url("${safeSrc(icon)}")` : "";
}

// The target outlives the dialog otherwise, and every later preview would go on
// showing the game whose poster was picked last.
el.sgdbDialog.addEventListener("close", () => {
  artGame = null;
  el.sgdbTabs.hidden = false;
  refreshPreview();
});

el.sgdbSearch.addEventListener("input", () => {
  clearTimeout(sgdbTimer);
  if (settings.steamgriddbEnabled) sgdbTimer = setTimeout(searchArtwork, 320);
});

el.sgdbUseManual.addEventListener("click", async () => {
  const url = el.sgdbManualUrl.value.trim();
  if (!url) return;
  el.sgdbStatus.textContent = "Fetching…";
  try {
    const got = await invoke("sgdb_download_artwork", { url, ...artworkKeys() });
    applyArt(got.path, got.dataUri);
    el.sgdbStatus.textContent = "";
    refreshPreview();
    refreshRail();
  } catch (error) {
    el.sgdbStatus.textContent = String(error);
  }
});

/** A file on this machine, rather than anything fetched. */
async function pickCoverFile(target = artTarget) {
  try {
    const chosen = await invoke("pick_cover_image");
    if (!chosen) return;
    const game = artGameOf();
    if (game) {
      game.coverSource = chosen.path;
      game.cover = chosen.preview;
      renderActiveGameList();
      refreshPreview();
      refreshRail();
      return;
    }
    art[target] = { path: chosen.path, preview: chosen.preview };
    if (target === "cover") {
      setPlate(el.collectionCover, el.collectionCoverImg, chosen.preview);
    }
    refreshPreview();
    if (activeTab === "edit") renderEditArt();
    refreshRail();
  } catch (error) {
    status(String(error), "error");
  }
}

/* ==========================================================================
   Settings
   ========================================================================== */

function applySettings() {
  el.setSgdb.checked = Boolean(settings.steamgriddbEnabled);
  el.setSgdbKey.value = settings.steamgriddbApiKey ?? "";
  el.sgdbKeyField.hidden = !el.setSgdb.checked;
  el.setFilesystem.value = settings.defaultFilesystem ?? "exfat";
  el.setVerify.checked = Boolean(settings.defaultVerify);
  el.setIcon.checked = settings.defaultIcon !== false;
  el.setEject.checked = settings.defaultEject !== false;
  el.setRegisterSteam.checked = settings.defaultRegisterSteam !== false;
  el.setCopy.checked = settings.defaultCopy !== false;
  el.setCloseSteam.checked = settings.defaultCloseSteam !== false;
  el.setTune.checked = Boolean(settings.defaultTune);
  el.setTrim.checked = Boolean(settings.defaultTrim);
  el.setCopyRate.value = String(settings.defaultCopyRateMbS ?? 0);
  el.setFormat.checked = Boolean(settings.defaultFormat);
  // Tuning edits Defender and Search, which exist on one platform.
  el.setTuneRow.hidden = platform !== "windows";
}

/** Settings changed, so anything derived from them is stale. */
function applyDefaults() {
  copyWanted = settings.defaultCopy !== false;
  refreshRail();
}

/* ==========================================================================
   Create / Edit
   ========================================================================== */

/** Which tab is showing. The rail belongs to both and never moves. */
async function showTab(name) {
  const isEdit = name === "edit";
  activeTab = isEdit ? "edit" : "create";

  el.tabCreate.setAttribute("aria-selected", String(!isEdit));
  el.tabEdit.setAttribute("aria-selected", String(isEdit));
  el.tabCreate.tabIndex = isEdit ? -1 : 0;
  el.tabEdit.tabIndex = isEdit ? 0 : -1;
  el.panelCreate.hidden = isEdit;
  el.panelEdit.hidden = !isEdit;

  if (isEdit) {
    await refreshEditDrives();
    const cartridges = (drives ?? []).filter((drive) => drive.hasCartridge);
    const preferred = cartridges.find((drive) => drive.path === selectedDrive) ?? cartridges[0];
    if (preferred && (!editing || editing.drivePath !== preferred.path)) {
      await openEditor(preferred.path);
    }
    el.barText.textContent = editing?.title ? `Edit ${editing.title}` : "Edit cartridge";
    // Coming back to a cartridge that is already open skips openEditor, and
    // without this the rail keeps whatever Create left in it — which looked
    // like switching tabs had thrown the preview away.
    refreshRail();
    return;
  }

  el.barText.textContent = building
    ? `Writing ${on.format ? driveLabelFor(cartridgeTitle(), filesystem()) || driveLabel() : driveLabel()}`
    : isCollection()
      ? "Create multicartridge"
      : "Create cartridge";
  refreshRail();
}

/**
 * The cartridges that can be edited: every target drive that already holds one.
 *
 * This is the whole reason Edit is a tab. It used to be a link under the drive
 * list inside step 3, so reaching it meant ticking a game you did not want in
 * order to edit a cartridge that already existed.
 */
async function refreshEditDrives() {
  let drives = [];
  try {
    drives = await invoke("list_target_drives");
  } catch (error) {
    status(String(error), "error");
    return;
  }
  const cartridges = drives.filter((drive) => drive.hasCartridge);

  // Opening Edit with a cartridge plugged in and nothing selected picks one:
  // there is exactly one thing this tab can be about, and asking which is a
  // question with one answer.
  if (activeTab === "edit" && cartridges.length > 0) {
    const preferred = cartridges.find((drive) => drive.path === selectedDrive) ?? cartridges[0];
    if (!editing || editing.drivePath !== preferred.path) {
      await openEditor(preferred.path);
    }
  }

  renderEditMedia();
}

/** The cartridge being edited, stated the way Create states its media. */
function renderEditMedia() {
  const drive = drives.find((d) => d.path === editing?.drivePath);
  if (drive) {
    el.editMediaTitle.textContent = drive.label || drive.path;
    el.editMediaMeta.textContent =
      `${formatBytes(drive.freeBytes)} free of ${formatBytes(drive.totalBytes)}`;
  } else {
    el.editMediaTitle.textContent = "Choose a cartridge";
    el.editMediaMeta.textContent = "";
  }
}

/** Change, on the Edit tab: the same dialog, listing only written cartridges. */
function openCartridgePicker() {
  renderDrives({ onlyCartridges: true, choose: (drive) => openEditor(drive.path) });
  el.pickTitle.textContent = "Choose a cartridge";
  el.pickGames.hidden = true;
  el.pickMedia.hidden = false;
  el.pickDialog.showModal();
}

function openSettings() {
  applySettings();
  renderSources();
  el.settingsStatus.textContent = "";
  el.settingsDialog.showModal();
}

/**
 * What the library was built from.
 *
 * The backend reports problems it hit while scanning rather than a list of
 * enabled sources, so this says what was actually read and what was not — not
 * a set of switches the wizard cannot honour.
 */
function renderSources() {
  const counts = new Map();
  for (const game of library) {
    const key = game.source || game.library || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}: ${n}`);
  el.sources.textContent = parts.length
    ? `${library.length} games — ${parts.join(", ")}.`
    : "No games found yet.";

  el.scanAge.textContent = scannedAt
    ? `Last scanned ${Math.max(1, Math.round((Date.now() - scannedAt) / 60000))} minutes ago.`
    : "Not scanned yet.";
}

async function saveSettings() {
  el.settingsStatus.textContent = "Saving…";
  try {
    settings = await invoke("set_settings", {
      settings: {
        steamgriddbEnabled: el.setSgdb.checked,
        steamgriddbApiKey: el.setSgdbKey.value.trim(),
        defaultFilesystem: el.setFilesystem.value,
        defaultVerify: el.setVerify.checked,
        defaultIcon: el.setIcon.checked,
        defaultEject: el.setEject.checked,
        defaultRegisterSteam: el.setRegisterSteam.checked,
        defaultCopy: el.setCopy.checked,
        defaultCloseSteam: el.setCloseSteam.checked,
        defaultTune: el.setTune.checked,
        defaultTrim: el.setTrim.checked,
        defaultCopyRateMbS: Number(el.setCopyRate.value) || 0,
        defaultFormat: el.setFormat.checked,
        gameFolderRoots: settings.gameFolderRoots ?? [],
      },
    });
    applyDefaults();
    refreshRail();
    el.settingsDialog.close();
  } catch (error) {
    el.settingsStatus.textContent = String(error);
  }
}

/* ==========================================================================
   Editing a cartridge that is already there
   ========================================================================== */

async function openEditor(drivePath) {
  const target = drivePath ?? selectedDrive;
  if (!target) return;
  try {
    editing = await invoke("read_cartridge_for_edit", { drivePath: target });
  } catch (error) {
    status(String(error), "error");
    return;
  }
  // `art` is shared with Create, and nothing used to clear it: a cover chosen
  // while building a cartridge was still sitting there when Edit opened, and
  // Update wrote it to whatever cartridge happened to be selected. Editing
  // starts from what is on the drive, every time.
  art.cover = null;
  art.logo = null;
  art.icon = null;
  art.background = null;
  artGame = null;

  el.editTitle.value = editing.title ?? "";
  renderEditArt();
  el.editStatus.textContent = "";
  el.editFormWrap.hidden = false;
  // Windows settings, on Windows. A cartridge opened on Linux has neither
  // Defender nor Search to switch off.
  el.editTuneGroup.hidden = platform !== "windows";
  resetTune();
  if (el.pickDialog.open) el.pickDialog.close();
  renderEditGames();
  renderEditMedia();
  refreshRail();
}

/** The three slots, showing what is chosen or what the cartridge already has. */
function renderEditArt() {
  // A collection's cover is written and then never shown: the launcher paints
  // the selected game's art, not the cartridge's. Until something displays it,
  // offering the slot is offering work with nowhere to land.
  const collection = (editing?.games ?? []).length > 1;
  el.editCoverSlot.hidden = collection;

  setPlate(el.editCover, el.editCoverImg, art.cover?.preview ?? editing?.cover);
  setPlate(el.editLogo, el.editLogoImg, art.logo?.preview ?? editing?.logo);
  // Falls back to the cover only when the cartridge genuinely has no icon of
  // its own, which is what autorun.inf does with it.
  setPlate(
    el.editIcon,
    el.editIconImg,
    art.icon?.preview ?? editing?.icon ?? art.cover?.preview ?? editing?.cover,
  );
}

/**
 * Replace every poster on the cartridge with one fetched from SteamGridDB.
 *
 * Writes straight to the cartridge rather than staging like the rest of the
 * panel: it is a repair, and there is nothing to preview against — the point is
 * that what is there now is wrong.
 */
async function refetchArtwork() {
  if (!editing) return;
  if (!settings.steamgriddbEnabled || !(settings.steamgriddbApiKey ?? "").trim()) {
    el.editStatus.textContent =
      "SteamGridDB is switched off. Turn it on in Settings and add a key.";
    return;
  }
  el.btnRefetchArt.disabled = true;
  el.editStatus.textContent = "Fetching posters…";
  try {
    const result = await invoke("refetch_cartridge_artwork", { drivePath: editing.drivePath });
    await openEditor(editing.drivePath);
    el.editStatus.textContent = result.warnings?.length
      ? result.warnings.join(" ")
      : "Every game has a fresh poster.";
  } catch (error) {
    el.editStatus.textContent = String(error);
  } finally {
    el.btnRefetchArt.disabled = false;
  }
}

function renderEditGames() {
  renderGameRows(el.editGames, editing?.games ?? [], {
    removable: true,
    onChange: () => {
      renderEditGames();
      refreshRail();
    },
  });
}



/* --------------------------------------------------------------------------
   Tuning a cartridge that already exists

   The same two settings the create flow offers, reachable for a cartridge that
   was written before anyone thought to ask for them — which is every cartridge
   made while the create flow was reporting "Windows tuned" without calling
   anything. It also carries the reconciliation, so the exclusion an older
   cartridge left on a drive letter that has since moved is taken back from
   here too.
   -------------------------------------------------------------------------- */

/** Which direction the shown plan is for, or null when none is shown. */
let tunePending = null;

const TWEAKS = ["defender", "indexing"];

/**
 * Show the commands, and nothing else, until they are agreed to.
 *
 * This is elevated and one of the two commands weakens malware scanning, so it
 * is the commands themselves that get shown — not a description of them, and
 * not a checkbox that stands in for having read anything.
 */
async function showTunePlan(applying) {
  if (!editing?.drivePath) return;
  el.editStatus.textContent = "Reading what would change…";

  let commands;
  try {
    commands = await invoke("tuning_plan", {
      drivePath: editing.drivePath,
      tweaks: TWEAKS,
      applying,
    });
  } catch (error) {
    el.editStatus.textContent = String(error);
    return;
  }

  tunePending = applying;
  el.editTunePlan.replaceChildren();
  for (const command of commands) {
    const li = document.createElement("li");
    li.textContent = command;
    el.editTunePlan.append(li);
  }
  el.editTunePlan.hidden = commands.length === 0;
  el.editStatus.textContent =
    "These run as administrator, one prompt each.";
  showTuneButtons(true);
}

function showTuneButtons(pending) {
  el.btnTune.hidden = pending;
  el.btnUntune.hidden = pending;
  el.btnTuneRun.hidden = !pending;
  el.btnTuneCancel.hidden = !pending;
}

function resetTune() {
  tunePending = null;
  el.editTunePlan.hidden = true;
  el.editTunePlan.replaceChildren();
  el.editStatus.textContent = "";
  showTuneButtons(false);
}

async function runTuning() {
  if (tunePending === null) return;
  const applying = tunePending;
  el.btnTuneRun.disabled = true;
  el.editStatus.textContent = "Waiting for Windows…";

  try {
    const done = await invoke("apply_tuning", {
      drivePath: editing.drivePath,
      tweaks: TWEAKS,
      applying,
    });
    resetTune();
    status(done.join(" "), "good");
  } catch (error) {
    el.editStatus.textContent = String(error);
  } finally {
    el.btnTuneRun.disabled = false;
  }
}

el.btnTune.addEventListener("click", () => showTunePlan(true));
el.btnUntune.addEventListener("click", () => showTunePlan(false));
el.btnTuneRun.addEventListener("click", runTuning);
el.btnTuneCancel.addEventListener("click", resetTune);

async function saveEdits() {
  el.editStatus.textContent = "Saving…";
  try {
    await invoke("update_cartridge", {
      request: {
        drivePath: editing.drivePath,
        title: el.editTitle.value.trim() || editing.title,
        coverSource: art.cover?.path ?? null,
        logoSource: art.logo?.path ?? null,
        iconSource: art.icon?.path ?? null,
        games: (editing.games ?? []).map((g) => ({
          title: g.title,
          executable: g.executable,
          // Absent leaves the game's existing poster alone.
          coverSource: g.coverSource ?? null,
        })),
      },
    });
    el.editStatus.textContent = "";
    status("Cartridge updated. No files were moved.", "good");
    // Read it back so the panel shows what is on the drive rather than what
    // was typed, and so a second edit starts from the saved state.
    await openEditor(editing.drivePath);
    await refreshDrives();
  } catch (error) {
    el.editStatus.textContent = String(error);
  }
}

/* ==========================================================================
   Wiring
   ========================================================================== */

el.search.addEventListener("input", renderGames);

el.changeGame.addEventListener("click", openGamePicker);
el.changeMedia.addEventListener("click", openMediaPicker);
// method="dialog" means a stray Enter in the search box would close the dialog
// mid-selection, which is the opposite of what Enter means in a filter.
el.pickForm.addEventListener("submit", (event) => {
  if (event.submitter?.id !== "pick-close") event.preventDefault();
});
// Entering a game by hand is an answer to "which game", so the dialog that
// asked has done its job.
el.btnCustom.addEventListener("click", () => {
  if (el.pickDialog.open) el.pickDialog.close();
  enterManual();
});

// Each slot opens the artwork picker on its own kind. 8a's "click one to change
// it" — the slot is the control, not a label beside one.
el.artSlots.addEventListener("click", (event) => {
  const slot = event.target.closest(".art-slot");
  if (slot) openArtwork(slot.dataset.slot);
});
el.btnCustomBack.addEventListener("click", () => {
  manual = null;
  showPhase("build");
  renderTickCount();
  refreshRail();
});
el.btnPickFolder.addEventListener("click", pickFolder);
el.btnClearFolder.addEventListener("click", () => {
  if (!manual) return;
  manual.folder = null;
  manual.choices = [];
  manual.executable = "";
  renderFolder();
  renderExeChoices();
  refreshRail();
});
el.customTitle.addEventListener("input", () => {
  refreshRail();
  refreshCreateButton();
});
el.customExec.addEventListener("input", () => {
  if (manual && el.customExec.value.trim()) manual.executable = "";
  renderExeChoices();
  refreshCreateButton();
});
el.btnCustomCover.addEventListener("click", () => pickCoverFile("cover"));

el.sgdbUseLocal.addEventListener("click", () => pickCoverFile(artTarget));
el.btnInheritCover.addEventListener("click", async () => {
  const first = picked[0];
  if (!first) return;
  try {
    const cover = await invoke("game_cover", { library: first.library, id: first.id });
    if (cover) {
      art.cover = { path: null, preview: cover, inherited: first };
      setPlate(el.collectionCover, el.collectionCoverImg, cover);
      refreshRail();
    }
  } catch {
    // nothing cached for it either
  }
});


el.create.addEventListener("click", () => (activeTab === "edit" ? saveEdits() : write()));
el.tabCreate.addEventListener("click", () => showTab("create"));
el.tabEdit.addEventListener("click", () => showTab("edit"));
el.btnRefetchArt.addEventListener("click", refetchArtwork);

// Edit is now a single tab action, not a second link in the drive list.
draggable(el.editGames, () => editing?.games ?? [], () => {
  renderEditGames();
  refreshRail();
});

el.btnChangeCart.addEventListener("click", openCartridgePicker);
el.editArtSlots.addEventListener("click", (event) => {
  const slot = event.target.closest(".art-slot");
  if (slot) openArtwork(slot.dataset.slot);
});
// The preview is the reason to type a name here, so it keeps up with the typing.
el.editTitle.addEventListener("input", refreshRail);
el.btnUnregister.addEventListener("click", async () => {
  try {
    await invoke("unregister_from_steam", { drivePath: selectedDrive });
    driveIsSteamLibrary = false;
    el.btnUnregister.hidden = true;
    status("Removed from Steam's library list.", "good");
  } catch (error) {
    status(String(error), "error");
  }
});

el.settings.addEventListener("click", openSettings);
el.settingsSave.addEventListener("click", saveSettings);
el.setSgdb.addEventListener("change", () => {
  el.sgdbKeyField.hidden = !el.setSgdb.checked;
});
el.btnRescan.addEventListener("click", async () => {
  await refreshLibrary();
  await refreshDrives();
  renderSources();
});

/**
 * What "Tune Windows for this cartridge" covers, under the names the backend
 * parses. One checkbox, two tweaks — Defender and Search, as the step it adds
 * to the plan says.
 */
const WINDOWS_TWEAKS = ["defender", "indexing"];


el.close.addEventListener("click", async () => {
  if (building) return;
  if (tauri?.window) await tauri.window.getCurrentWindow().close();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (building) event.preventDefault();
    return;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    write();
  }
});

/* ==========================================================================
   Boot
   ========================================================================== */

async function refreshLibrary() {
  try {
    const result = await invoke("list_games");
    library = result.games ?? [];
    scannedAt = Date.now();
    // A scanner that found nothing is not an error the person making a
    // cartridge can act on — Playnite not having a JSON export is a fact about
    // Playnite. The games it did find are the answer; the rest goes to the
    // console for whoever is debugging a scanner.
    if (result.problems?.length) console.info("[gamepak] scan:", result.problems.join(" "));
  } catch (error) {
    library = [];
    status(String(error), "error");
  }
  renderGames();
}

async function refreshDrives() {
  try {
    drives = await invoke("list_target_drives");
  } catch {
    drives = [];
  }
  try {
    unmounted = await invoke("list_unmounted_volumes");
  } catch {
    unmounted = [];
  }
  // A drive that has gone away takes the selection with it.
  if (selectedDrive && !drives.some((d) => d.path === selectedDrive)) {
    selectedDrive = null;
    formatPlan = null;
  }
  renderDrives();
  if (!selectedDrive && drives.length === 1) await selectDrive(drives[0]);
  refreshRail();
}

async function start() {
  // Subscribed before the first await, not after. open_wizard emits
  // "open-settings" as soon as the page finishes loading, and a listener
  // attached after the library scan would arrive long after that event had come
  // and gone — opening the wizard on the game list instead of on Settings.
  //
  // Showing the window is deliberately not done here; open_wizard does it on
  // page load, so nothing below can strand a window nobody can see.
  if (tauri?.event) {
    tauri.event.listen("open-settings", openSettings);
    tauri.event.listen("cartridge://progress", (event) => onProgress(event.payload));
  }

  try {
    platform = await invoke("host_platform");
  } catch {
    platform = "";
  }

  try {
    settings = { ...settings, ...(await invoke("get_settings")) };
  } catch {
    // defaults stand
  }
  applyDefaults();

  await refreshLibrary();
  await refreshDrives();
  refreshRail();
  showPhase("build");
}

/* ==========================================================================
   Browser preview
   --------------------------------------------------------------------------
   Outside Tauri the wizard serves a sample library so the window can be
   designed and reviewed without a drive:
       npx http-server tauri-ui  →  http://localhost:8080/app/create.html
   ========================================================================== */

async function demoInvoke(command, args) {
  switch (command) {
    case "list_games":
      return { problems: [], games: [
        { id: "367520", name: "Hollow Knight", library: "steam", source: "Steam",
          sizeOnDisk: 9_106_886_656, hasCover: true,
          executable: "steam://rungameid/367520", canCopy: true },
        { id: "1145360", name: "Hades", library: "steam", source: "Steam",
          sizeOnDisk: 15_204_593_664, hasCover: false,
          executable: "steam://rungameid/1145360", canCopy: true },
        { id: "b7f3-tunic", name: "Tunic", library: "playnite", source: "GOG",
          sizeOnDisk: 3_221_225_472, hasCover: false,
          executable: "playnite://playnite/start/b7f3-tunic", canCopy: true },
        { id: "c8a1-outer", name: "Outer Wilds", library: "playnite", source: "Epic",
          sizeOnDisk: 0, hasCover: false,
          executable: "playnite://playnite/start/c8a1-outer", canCopy: false },
        { id: "d9b2-halo", name: "Halo Infinite", library: "playnite", source: "Xbox",
          sizeOnDisk: 0, hasCover: false,
          executable: "playnite://playnite/start/d9b2-halo", canCopy: false },
        { id: "413150", name: "Stardew Valley", library: "steam", source: "Steam",
          sizeOnDisk: 1_006_632_960, hasCover: false,
          executable: "steam://rungameid/413150", canCopy: true },
      ] };
    case "get_settings":
      // The preview mirrors a fresh install: offline until switched on.
      return { steamgriddbEnabled: false, steamgriddbApiKey: "" };
    case "set_settings":
      return args.settings;
    case "suggest_collection_name": {
      const words = args.titles.map((t) => t.trim().split(/\s+/));
      const shared = [];
      for (let i = 0; i < words[0].length; i += 1) {
        const word = words[0][i];
        if (!words.every((w) => w[i]?.toLowerCase() === word.toLowerCase())) break;
        shared.push(word);
      }
      return shared.length >= 2
        ? `${shared.join(" ")} Collection`
        : `${args.titles[0]} and ${args.titles.length - 1} more`;
    }
    case "read_cartridge_for_edit":
      return {
        drivePath: args.drivePath,
        title: "God of War Collection",
        cover: "src/demo/gow-collection.jpg",
        coverPath: "D:\\collection.jpg",
        isBundle: true,
        holdsGame: true,
        games: [
          { title: "God of War (2018)", executable: "steam://rungameid/1593500", cover: "", coverPath: "" },
          { title: "God of War Ragnarök", executable: "steam://rungameid/2322010", cover: "", coverPath: "" },
        ],
      };
    case "update_cartridge":
      return { confPath: `${args.request.drivePath}/cartridge.conf`, warnings: [] };
    case "host_platform":
      return "linux";
    case "tuning_plan":
      return [
        "Add-MpPreference -ExclusionPath 'D:\\'",
        "Get-CimInstance -ClassName Win32_Volume -Filter \"DriveLetter='D:'\" | Set-CimInstance -Property @{IndexingEnabled=$false}",
      ];
    case "apply_tuning":
      return args.applying
        ? [
            "Defender scans D:\\ again — left excluded by a cartridge that has since moved letter.",
            "Excluded the cartridge from Defender scanning.",
            "Search indexing switched off for the cartridge.",
          ]
        : ["Defender scans the cartridge again.", "Search indexing switched back on."];
    case "pick_cover_image":
      return { path: "/home/harry/Pictures/collection.jpg", preview: "src/demo/gow-collection.jpg" };
    case "game_cover":
      return args.id === "367520" ? "src/demo/cover.jpg" : "";
    case "sgdb_last_used_artwork":
      return null;
    case "sgdb_search_games":
      return [{ id: 1, name: args.query || "Hollow Knight" }];
    case "sgdb_get_artwork":
      return [
        { id: 7001, url: "https://cdn.steamgriddb.com/grid/demo-7001.jpg",
          thumb: "src/demo/cover.jpg", width: 600, height: 900 },
        { id: 7002, url: "https://cdn.steamgriddb.com/grid/demo-7002.jpg",
          thumb: "src/demo/gow-collection.jpg", width: 600, height: 900 },
      ];
    case "sgdb_download_artwork":
      return { path: "/tmp/sgdb-cache/demo-cover.jpg", dataUri: "src/demo/cover.jpg" };
    case "list_target_drives":
      return [
        { path: "/run/media/harry/CINDER", label: "CINDER",
          totalBytes: 128_035_676_160, freeBytes: 119_014_128_640, hasCartridge: false },
        { path: "/run/media/harry/HOLLOW", label: "HOLLOW",
          totalBytes: 128_035_676_160, freeBytes: 18_253_611_008, hasCartridge: true },
      ];
    case "executable_choices":
      return [
        { relative: "TUNIC.exe", name: "TUNIC.exe", score: 120 },
        { relative: "bin/launcher.exe", name: "launcher.exe", score: -40 },
        { relative: "unins000.exe", name: "unins000.exe", score: -400 },
      ];
    case "pick_game_folder":
      return {
        path: "B:\\Games\\Split_Fiction v1.2",
        name: "Split_Fiction v1.2",
        sizeBytes: 74_088_775_680,
        choices: [
          { relative: "SplitFiction.exe", name: "SplitFiction.exe", score: 120 },
          { relative: "Engine/Binaries/UE4PrereqSetup_x64.exe", name: "UE4PrereqSetup_x64.exe", score: -300 },
          { relative: "unins000.exe", name: "unins000.exe", score: -400 },
        ],
      };
    case "cartridge_health":
      return { link: "10 Gbps", linkMbps: 10_000, transport: "UASP",
               label: args.drivePath.split("/").pop(), filesystem: "exFAT",
               totalBytes: 128_035_676_160, freeBytes: 119_014_128_640,
               usedPercent: 7, warnings: [] };
    case "steam_registration":
      return args.drivePath.endsWith("HOLLOW");
    case "unregister_from_steam":
      return true;
    case "eject_drive":
      return true;
    case "format_plan":
      return {
        path: args.drivePath,
        currentLabel: args.drivePath.split("/").pop(),
        device: "/dev/sdb1",
        totalBytes: 128_035_676_160,
        warning: `Everything on ${args.drivePath.split("/").pop()} (128 GB) will be erased.`,
      };
    case "create_cartridge":
      return {
        confPath: `${args.request.drivePath}/cartridge.conf`,
        coverWritten: true,
        autorunWritten: Boolean(args.request.writeIcon),
        icon: null,
        formatted: args.request.formatDrive,
        formattedFilesystem: args.request.formatFilesystem || "exfat",
        gameCopied: args.request.copyGame,
        bytesCopied: args.request.copyGame ? 9_106_886_656 : 0,
        registeredWithSteam: args.request.copyGame && Boolean(args.request.appId),
        gameFolder: args.request.copyGame ? "Games" : null,
        warnings: [],
      };
    default:
      console.log("[preview]", command, args);
      return "";
  }
}

start();
