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
    games: $("step-games"),
    custom: $("step-custom"),
    name: $("step-name"),
    options: $("step-options"),
    running: $("step-running"),
  },

  tickCount: $("tick-count"),
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
  btnCollectionCover: $("btn-collection-cover"),
  btnInheritCover: $("btn-inherit-cover"),
  collectionTitle: $("collection-title"),
  collectionNameHint: $("collection-name-hint"),
  orderList: $("order-list"),

  // Options
  optCopy: $("opt-copy"),
  optCopyLabel: $("opt-copy-label"),
  optCopyHint: $("opt-copy-hint"),
  optCloseSteamRow: $("opt-close-steam-row"),
  optCloseSteam: $("opt-close-steam"),
  optCloseSteamHint: $("opt-close-steam-hint"),
  optVerifyRow: $("opt-verify-row"),
  optVerify: $("opt-verify"),
  optVerifyHint: $("opt-verify-hint"),
  optIcon: $("opt-icon"),
  optTuneRow: $("opt-tune-row"),
  optTune: $("opt-tune"),
  btnTuneCommands: $("btn-tune-commands"),
  btnTuneUndo: $("btn-tune-undo"),
  optTrimRow: $("opt-trim-row"),
  optTrim: $("opt-trim"),
  optEject: $("opt-eject"),
  optFormat: $("opt-format"),
  optFormatHint: $("opt-format-hint"),
  formatFields: $("format-fields"),
  formatLabel: $("format-label"),
  formatConfirm: $("format-confirm"),
  confirmLabel: $("confirm-label"),
  labelHintText: $("label-hint-text"),
  formatWarning: $("format-warning"),
  btnOptionsBack: $("btn-options-back"),

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
  railCover: $("rail-cover"),
  railCoverImg: $("rail-cover-img"),
  railTitle: $("rail-title"),
  railSub: $("rail-sub"),
  btnRailArt: $("btn-rail-art"),
  railGames: $("rail-games"),
  railGameList: $("rail-game-list"),
  railSpace: $("rail-space"),
  railDriveLabel: $("rail-drive-label"),
  railDriveFill: $("rail-drive-fill"),
  railBar: $("rail-bar"),
  railBarHint: $("rail-bar-hint"),
  railDrives: $("rail-drives"),
  drives: $("drives"),
  drivesEmpty: $("drives-empty"),
  btnEdit: $("btn-edit"),
  btnUnregister: $("btn-unregister"),
  railPlan: $("rail-plan"),
  plan: $("plan"),
  railForced: $("rail-forced"),
  forced: $("forced"),
  readyMessage: $("ready-message"),
  btnOptions: $("btn-options"),
  create: $("btn-create"),
  createLabel: document.querySelector("#btn-create .btn__label"),
  status: $("status"),

  // Dialogs
  editDialog: $("edit-dialog"),
  editTitle: $("edit-title"),
  btnEditCover: $("btn-edit-cover"),
  editCoverName: $("edit-cover-name"),
  editGames: $("edit-games"),
  editGamesHint: $("edit-games-hint"),
  editSave: $("edit-save"),
  editStatus: $("edit-status"),

  settingsDialog: $("settings-dialog"),
  sources: $("sources"),
  scanAge: $("scan-age"),
  btnRescan: $("btn-rescan"),
  setSgdb: $("set-sgdb"),
  sgdbKeyField: $("sgdb-key-field"),
  setSgdbKey: $("set-sgdb-key"),
  setFilesystem: $("set-filesystem"),
  setVerify: $("set-verify"),
  setIcon: $("set-icon"),
  setEject: $("set-eject"),
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
  previewArt: $("preview-art"),
  previewHero: $("preview-hero"),
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
/** Ticked games, in the order they were ticked — which is the play order. */
let picked = [];
let selectedDrive = null;
let formatPlan = null;
let building = false;
let platform = "";
let driveIsSteamLibrary = false;
let labelIsOurs = true;
let scannedAt = null;

/** Artwork chosen by hand, per role. */
const art = { cover: null, logo: null, icon: null, background: null };

/** The by-hand game, when one is being entered. */
let manual = null;

/** Set once the user has had an opinion about copying, so we stop guessing. */
let copyTouched = false;

let settings = {
  steamgriddbEnabled: false,
  steamgriddbApiKey: "",
  defaultFilesystem: "exfat",
  defaultVerify: false,
  defaultIcon: true,
  defaultEject: true,
};

let editing = null;

/** Which phase the left column is showing. */
let phase = "games";

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
  renderGames();
  renderTickCount();

  // A single game brings its own art; a collection starts with none, which is
  // the reason step 2 exists at all.
  if (picked.length === 1 && !art.cover) {
    const game = picked[0];
    try {
      const cover = await invoke("game_cover", { library: game.library, id: game.id });
      if (picked.length === 1 && picked[0].id === game.id) game.cover = cover;
    } catch {
      // no art is a state, not a failure
    }
  }

  if (isCollection() && !el.collectionTitle.value.trim()) {
    suggestName();
  }

  // Offloading a game off the internal disk is the practical half of the
  // appeal, so copying is on whenever there is anything to copy. Untouched
  // once the user has had an opinion about it.
  if (!copyTouched) el.optCopy.checked = copyable().length > 0;

  refreshOptions();
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

function renderOrder() {
  el.orderList.replaceChildren();
  picked.forEach((game, index) => {
    const li = document.createElement("li");
    li.className = "order-row";
    li.draggable = true;
    li.dataset.index = String(index);

    const n = document.createElement("span");
    n.className = "order-row__n";
    n.textContent = String(index + 1);

    // The poster this game gets on the launcher. Steam and Playnite already
    // have one for most games, so the row shows what will be used rather than
    // an empty slot waiting to be filled in.
    const thumb = document.createElement("span");
    thumb.className = "order-row__art";
    if (safeSrc(game.cover)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = safeSrc(game.cover);
      thumb.append(img);
    } else {
      thumb.classList.add("is-empty");
    }

    const name = document.createElement("span");
    name.className = "order-row__name";
    name.textContent = game.name;
    const size = document.createElement("span");
    size.className = "order-row__size";
    size.textContent = game.sizeOnDisk ? formatBytes(game.sizeOnDisk) : "—";

    const poster = document.createElement("button");
    poster.className = "order-row__poster";
    poster.type = "button";
    // Not draggable, or starting the drag from the button would reorder rather
    // than press.
    poster.draggable = false;
    poster.textContent = game.coverSource ? "Change" : "Poster…";
    poster.setAttribute("aria-label", `Choose the poster for ${game.name}`);
    poster.addEventListener("click", (event) => {
      event.stopPropagation();
      openArtwork("cover", Number(li.dataset.index));
    });

    li.append(n, thumb, name, size, poster);
    el.orderList.append(li);
  });
}

/**
 * Fill in the poster each game already has, for the order list to show.
 *
 * One request per game, and only for the ones with nothing yet: a collection
 * is built from a library that has cached art for most of it, and the point of
 * the list is to show which games will look bare before the cartridge is
 * written rather than after.
 */
async function fillGameCovers() {
  const missing = picked.filter((game) => !game.cover);
  for (const game of missing) {
    try {
      const cover = await invoke("game_cover", { library: game.library, id: game.id });
      if (cover) game.cover = cover;
    } catch {
      // no art is a state, not a failure
    }
  }
  if (missing.length) renderOrder();
}

/* Drag to reorder — this is the order the games appear in on the launcher. */
let dragFrom = null;

el.orderList.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".order-row");
  if (!row) return;
  dragFrom = Number(row.dataset.index);
  row.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
});

el.orderList.addEventListener("dragover", (event) => {
  event.preventDefault();
  const row = event.target.closest(".order-row");
  for (const other of el.orderList.children) other.classList.remove("is-over");
  if (row) row.classList.add("is-over");
});

el.orderList.addEventListener("drop", (event) => {
  event.preventDefault();
  const row = event.target.closest(".order-row");
  if (row && dragFrom !== null) {
    const to = Number(row.dataset.index);
    const [moved] = picked.splice(dragFrom, 1);
    picked.splice(to, 0, moved);
    renderOrder();
    refreshRail();
  }
  dragFrom = null;
});

el.orderList.addEventListener("dragend", () => {
  for (const other of el.orderList.children) {
    other.classList.remove("is-over", "is-dragging");
  }
  dragFrom = null;
});

el.collectionTitle.addEventListener("input", () => {
  if (labelIsOurs) el.formatLabel.value = driveLabelFor(collectionName(), filesystem());
  renderCollectionHint();
  refreshRail();
  refreshCreateButton();
});

function renderCollectionHint() {
  const label = driveLabelFor(collectionName(), filesystem());
  el.collectionNameHint.innerHTML = "";
  el.collectionNameHint.append("Shown on the launcher above the game list. The drive itself will be named ");
  const code = document.createElement("span");
  code.className = "mono";
  code.textContent = label;
  el.collectionNameHint.append(code, ` — ${filesystemLabel(filesystem())} allows ${filesystem() === "btrfs" ? 64 : 11} characters.`);
}

/* ==========================================================================
   Step 1b — a game nothing scanned
   ========================================================================== */

function enterManual() {
  manual = manual ?? { title: "", executable: "", folder: null, choices: [], cover: null };
  picked = [];
  showPhase("custom");
  renderGames();
  renderTickCount();
  refreshOptions();
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

function renderDrives() {
  el.drives.replaceChildren();
  for (const drive of drives) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "drive";
    btn.setAttribute("aria-selected", String(drive.path === selectedDrive));

    const name = document.createElement("span");
    name.className = "drive__name";
    name.textContent = drive.label || drive.path;

    const meta = document.createElement("span");
    meta.className = "drive__meta";
    meta.textContent = drive.hasCartridge
      ? `${formatBytes(drive.freeBytes)} free · has a cartridge`
      : `${formatBytes(drive.freeBytes)} free of ${formatBytes(drive.totalBytes)}`;
    if (drive.hasCartridge) meta.classList.add("drive__warn");

    btn.append(name, meta);
    btn.addEventListener("click", () => selectDrive(drive));
    li.append(btn);
    el.drives.append(li);
  }

  el.drivesEmpty.hidden = drives.length > 0;
  if (drives.length === 0) {
    el.drivesEmpty.textContent =
      "No removable drive found. Plug a cartridge in, then press Rescan.";
  }
}

async function selectDrive(drive) {
  selectedDrive = drive.path;
  renderDrives();

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

  el.btnEdit.hidden = !drive.hasCartridge;
  el.btnUnregister.hidden = !driveIsSteamLibrary;

  if (labelIsOurs) el.formatLabel.value = driveLabelFor(cartridgeTitle(), filesystem());
  refreshFormatFields();
  refreshOptions();
  refreshRail();
}

/* ==========================================================================
   Step 3 — options
   ========================================================================== */

function filesystem() {
  const checked = document.querySelector('#format-filesystem input:checked');
  return checked?.value ?? "exfat";
}

function filesystemLabel(fs) {
  return fs === "btrfs" ? "btrfs" : "exFAT";
}

/** Every game that would actually have its files copied. */
function copyable() {
  if (manual) return manual.folder ? [manual] : [];
  return picked.filter((g) => g.sizeOnDisk > 0);
}

function refreshOptions() {
  const count = picked.length;
  const steamCount = picked.filter((g) => g.library === "steam").length;
  const size = totalBytes();

  el.optCopyLabel.textContent =
    count > 1
      ? `Copy all ${count} games onto the cartridge`
      : "Copy the game onto the cartridge";
  el.optCopyHint.textContent =
    count > 1
      ? "Each into its own folder, with the launcher pointing at all of them."
      : "Also registers the drive as a Steam library, so Steam plays from the cartridge instead of your internal copy.";

  // Closing Steam is only relevant when Steam is involved at all.
  const steamInvolved = steamCount > 0 || driveIsSteamLibrary;
  el.optCloseSteamRow.hidden = !(el.optCopy.checked && steamInvolved);
  el.optCloseSteamHint.textContent = steamCount
    ? `${steamCount} of ${count} ${count === 1 ? "is a Steam game" : "are Steam games"}. Steam writes its library list out on exit, so a cartridge it knows about cannot be rewritten while it runs.`
    : "This drive is already registered as a Steam library, so Steam has to close before it can be rewritten.";

  el.optVerifyRow.hidden = !el.optCopy.checked;
  const verifySeconds = size > 0 ? size / readRate() : 0;
  el.optVerifyHint.textContent = verifySeconds
    ? `Sums every file as it is written, then reads the cartridge back and compares. Adds ${formatDuration(verifySeconds)} over ${formatBytes(size)}.`
    : "Sums every file as it is written, then reads the cartridge back and compares.";

  // Windows-only options say nothing at all on Linux.
  el.optTuneRow.hidden = platform !== "windows";
  el.optTrimRow.hidden = el.optFormat.checked || platform === "windows";

  el.optFormatHint.textContent = formatPlan?.warning
    ? formatPlan.warning
    : selectedDrive
      ? "This drive cannot be formatted by the wizard."
      : "Erases everything on the drive. Choose a cartridge first.";

  refreshFormatFields();
  refreshPlan();
  refreshCreateButton();
}

function refreshFormatFields() {
  const on = el.optFormat.checked;
  el.formatFields.hidden = !on;
  if (!on) return;

  if (formatPlan) {
    el.confirmLabel.textContent = `Type ${formatPlan.currentLabel} to confirm`;
    el.formatConfirm.placeholder = formatPlan.currentLabel;
    el.formatWarning.textContent = formatPlan.warning;
  } else {
    el.confirmLabel.textContent = "Type the current drive name to confirm";
    el.formatConfirm.placeholder = "";
    el.formatWarning.textContent = selectedDrive
      ? "This drive cannot be formatted by the wizard."
      : "Choose a drive first.";
  }

  const fs = filesystem();
  const limit = fs === "btrfs" ? 64 : 11;
  el.formatLabel.maxLength = limit;
  el.labelHintText.textContent =
    fs === "btrfs"
      ? "btrfs has room for the whole title, but Windows cannot read it without WinBtrfs installed."
      : "exFAT allows an 11-character name, and reads anywhere with nothing to install.";

  if (!el.formatLabel.value || labelIsOurs) {
    el.formatLabel.value = driveLabelFor(cartridgeTitle(), fs);
  }
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
  if (el.optFormat.checked) seconds += 20;
  if (el.optCloseSteam.checked && !el.optCloseSteamRow.hidden) seconds += 5;
  const size = el.optCopy.checked ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0) : 0;
  if (size) seconds += size / writeRate();
  if (el.optVerify.checked && size) seconds += size / readRate();
  seconds += 2; // conf, launcher, manifest
  return seconds;
}

/* ==========================================================================
   The plan: what is ticked, in the order it will happen
   ========================================================================== */

function planSteps() {
  const steps = [];
  const size = el.optCopy.checked
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;

  if (el.optFormat.checked && formatPlan) {
    steps.push({
      what: `Format ${formatPlan.currentLabel} as ${filesystemLabel(filesystem())}`,
      detail: `renamed ${el.formatLabel.value.trim()} · ~20 s`,
      danger: true,
    });
  }
  if (el.optCopy.checked && !el.optCloseSteamRow.hidden && el.optCloseSteam.checked) {
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
  if (el.optVerify.checked && size) {
    steps.push({ what: "Verify the copy", detail: formatDuration(size / readRate()) });
  }
  steps.push({
    what: el.optIcon.checked
      ? "Write launcher, icon and manifest"
      : "Write the launcher and manifest",
    detail: el.optIcon.checked ? "autorun.ico · ~2 s" : "~2 s",
  });
  if (el.optTune.checked && !el.optTuneRow.hidden) {
    steps.push({ what: "Tune Windows for this cartridge", detail: "Defender and Search" });
  }
  if (el.optTrim.checked && !el.optTrimRow.hidden) {
    steps.push({ what: "Release freed space", detail: "needs the format permission" });
  }
  if (el.optEject.checked) {
    // Only a formatted drive answers to the new name; otherwise it keeps its own.
    const name = el.optFormat.checked
      ? el.formatLabel.value.trim() || driveLabel()
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
  const show = phase === "options" && selectedDrive && (picked.length > 0 || manual);
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
  const has = picked.length > 0 || Boolean(manual);
  el.railEmpty.hidden = has;
  el.railBody.hidden = !has;
  el.railDrives.hidden = phase === "running";

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
    ? `Writing ${el.optFormat.checked ? el.formatLabel.value.trim() || driveLabel() : driveLabel()}`
    : collection
      ? "Create multicartridge"
      : "Create cartridge";

  el.railTitle.textContent = cartridgeTitle() || "Nothing yet";

  // A collection has no art of its own until it is given some.
  const coverSrc = art.cover?.preview ?? (collection ? null : picked[0]?.cover);
  setPlate(el.railCover, el.railCoverImg, coverSrc);

  const bits = [];
  if (!collection && picked[0]) {
    if (picked[0].sizeOnDisk) bits.push(formatBytes(picked[0].sizeOnDisk));
    if (picked[0].source) bits.push(picked[0].source);
  } else if (collection) {
    // Only name a drive once one has been chosen — before that the collection
    // has a name and nothing else, and saying otherwise is an invention.
    if (selectedDrive) {
      const label = el.optFormat.checked ? el.formatLabel.value.trim() : driveLabel();
      if (label) bits.push(label);
      bits.push(filesystemLabel(filesystem()));
    } else {
      bits.push(`${picked.length} games`);
    }
  } else if (manual?.folder) {
    bits.push(formatBytes(manual.folder.sizeBytes));
  }
  el.railSub.textContent = bits.join(" · ");
  el.btnRailArt.hidden = collection || !picked[0];
  el.btnRailArt.textContent = art.cover ? "Change artwork" : "Replace artwork";

  // "Use Hollow Knight's" — the link has to name what it would borrow from.
  const first = picked[0];
  el.btnInheritCover.textContent = first ? `Use ${first.name}'s` : "Use the first game's";
  el.btnInheritCover.hidden = !first;

  // The games in it, while the library is open.
  const showGames = collection && phase === "games";
  el.railGames.hidden = !showGames;
  if (showGames) renderRailGames();

  refreshSpace();
  refreshPlan();
  refreshCreateButton();
}

function renderRailGames() {
  el.railGameList.replaceChildren();
  for (const game of picked) {
    const li = document.createElement("li");
    li.className = "rail-game";

    const cover = document.createElement("img");
    cover.className = "rail-game__cover";
    cover.alt = "";
    if (game.cover) cover.src = safeSrc(game.cover);

    const name = document.createElement("span");
    name.className = "rail-game__name";
    name.textContent = game.name;

    const size = document.createElement("span");
    size.className = "rail-game__size";
    size.textContent = game.sizeOnDisk ? formatBytes(game.sizeOnDisk) : "—";

    li.append(cover, name, size);
    el.railGameList.append(li);
  }
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

  const capacity = el.optFormat.checked ? drive.totalBytes : drive.freeBytes;
  el.railDriveLabel.textContent = drive.label || drive.path;
  el.railDriveFill.textContent = `${formatBytes(size)} of ${formatBytes(drive.totalBytes)}`;

  el.railBar.replaceChildren();
  el.railBar.classList.toggle("is-over", size > capacity);
  list.forEach((game, index) => {
    const bytes = game.sizeOnDisk || game.folder?.sizeBytes || 0;
    const band = document.createElement("div");
    band.style.width = `${Math.max(1, (bytes / drive.totalBytes) * 100)}%`;
    // Each band a step further round the accent's hue, so they read as one
    // family rather than a chart.
    band.style.background = `color-mix(in oklch, var(--accent) ${100 - index * 12}%, oklch(0.5 0.12 20))`;
    el.railBar.append(band);
  });

  el.railBarHint.hidden = list.length < 2;
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
  const size = el.optCopy.checked
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;
  const capacity = el.optFormat.checked ? drive?.totalBytes : drive?.freeBytes;
  if (size > 0 && drive && size > capacity) return "free enough space";

  if (el.optFormat.checked) {
    if (!formatPlan) return "load the drive format details";
    if (el.formatConfirm.value.trim() !== formatPlan.currentLabel) {
      return `type ${formatPlan.currentLabel} to confirm`;
    }
    if (!el.formatLabel.value.trim()) return "name the drive";
  }
  return "";
}

function refreshCreateButton() {
  if (building) {
    el.create.disabled = true;
    el.btnOptions.hidden = true;
    return;
  }

  const collection = isCollection();
  const reason = blockingReason();
  const ready = reason === "";

  // In the library phase a collection is named before it is written. That
  // needs no drive and no options, so the button leads there as soon as there
  // is more than one game — the cartridge is chosen on the way.
  const needsNaming = collection && phase === "games";

  if (needsNaming) {
    el.btnOptions.hidden = true;
    el.create.disabled = false;
    el.createLabel.textContent = "Name the collection";
    el.readyMessage.textContent = `Name it, or write it as "${picked.length} games".`;
    el.readyMessage.className = "";
    return;
  }

  el.btnOptions.hidden = !ready || phase === "options";
  el.create.disabled = !ready;

  el.createLabel.textContent = el.optFormat.checked
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
  const size = el.optCopy.checked
    ? copyable().reduce((s, g) => s + (g.sizeOnDisk || g.folder?.sizeBytes || 0), 0)
    : 0;

  if (el.optFormat.checked && formatPlan) {
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
    [el.optFormat.checked, `Formatted as ${filesystemLabel(filesystem())}`, "Not formatted"],
    [el.optCopy.checked, "Games copied onto the cartridge", "Nothing copied — a key only"],
    [el.optVerify.checked && el.optCopy.checked, "Verify after copying", "Copy not verified"],
    [el.optIcon.checked, "Drive icon from artwork", "No drive icon"],
    [el.optTune.checked && !el.optTuneRow.hidden, "Windows tuned", "Windows tuning skipped"],
    [el.optEject.checked, "Eject when done", "Left mounted"],
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
    el.progressFill.style.width = `${pct}%`;
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
    // Steps without a byte count still need to look alive.
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
    formatDrive: el.optFormat.checked,
    formatFilesystem: filesystem(),
    formatLabel: el.formatLabel.value.trim() || null,
    formatConfirmation: el.formatConfirm.value.trim() || null,
    copyGame: el.optCopy.checked,
    closeSteam: el.optCloseSteam.checked,
    verifyCopy: el.optVerify.checked,
    trimAfterWrite: el.optTrim.checked && !el.optTrimRow.hidden,
    writeIcon: el.optIcon.checked,
  };

  if (isCollection()) {
    return {
      ...shared,
      title: collectionName(),
      executable: "",
      collectionCoverSource: art.cover?.path ?? null,
      collectionLogoSource: art.logo?.path ?? null,
      collectionIconSource: art.icon?.path ?? null,
      collectionBackgroundSource: art.background?.path ?? null,
      games: picked.map((g) => ({
        title: g.name,
        executable: g.executable,
        appId: g.library === "steam" ? g.id : null,
        playniteId: g.library === "playnite" ? g.id : null,
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
      backgroundSource: art.background?.path ?? null,
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
    coverSource: art.cover?.path ?? null,
    iconSource: art.icon?.path ?? null,
    backgroundSource: art.background?.path ?? null,
    logoSource: art.logo?.path ?? null,
  };
}

async function write() {
  if (building || el.create.disabled) return;

  // From the library, a collection goes to be named rather than written.
  if (isCollection() && phase === "games") {
    renderOrder();
    renderCollectionHint();
    showPhase("name");
    refreshCreateButton();
    // Not awaited: the step is usable while the posters arrive, and the list
    // redraws itself when they do.
    fillGameCovers();
    return;
  }

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
    el.progressFill.style.width = "100%";

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

    // Ejecting is a step of the plan, not an afterthought, so it reports into
    // the same status line.
    if (el.optEject.checked) {
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
    showPhase("options");
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

function artGameOf() {
  return artGame === null ? null : picked[artGame] ?? null;
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
    renderOrder();
    refreshRail();
    return;
  }
  art[artTarget] = { path, preview };
}

function targetFor(kind) {
  return { grid: "cover", hero: "background", logo: "logo", icon: "icon" }[kind] ?? "cover";
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
    img.src = safeSrc(item.thumb) || safeSrc(item.url);
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
        `${name} — 16, 32, 48 and 256 px, written to the cartridge root as autorun.ico.`;
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
  const hero = art.background?.preview;
  const grid = targeted
    ? targeted.cover
    : art.cover?.preview ?? (isCollection() ? null : picked[0]?.cover);

  el.previewHero.hidden = !safeSrc(hero);
  if (safeSrc(hero)) el.previewHero.src = safeSrc(hero);
  el.previewGrid.hidden = !safeSrc(grid);
  if (safeSrc(grid)) el.previewGrid.src = safeSrc(grid);
  // A hero is the launcher background when there is one; the grid is behind it.
  el.previewGrid.style.opacity = safeSrc(hero) ? "0" : "1";
  el.previewArt.classList.toggle("has-art", Boolean(safeSrc(hero) || safeSrc(grid)));

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
async function pickCoverFile(target) {
  try {
    const chosen = await invoke("pick_cover_image");
    if (!chosen) return;
    art[target] = { path: chosen.path, preview: chosen.preview };
    setPlate(el.collectionCover, el.collectionCoverImg, chosen.preview);
    refreshPreview();
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
}

function applyDefaults() {
  el.optVerify.checked = Boolean(settings.defaultVerify);
  el.optIcon.checked = settings.defaultIcon !== false;
  el.optEject.checked = settings.defaultEject !== false;
  const fs = settings.defaultFilesystem ?? "exfat";
  const radio = document.querySelector(`#format-filesystem input[value="${fs}"]`);
  if (radio) radio.checked = true;
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
      },
    });
    applyDefaults();
    refreshOptions();
    el.settingsDialog.close();
  } catch (error) {
    el.settingsStatus.textContent = String(error);
  }
}

/* ==========================================================================
   Editing a cartridge that is already there
   ========================================================================== */

async function openEditor() {
  if (!selectedDrive) return;
  try {
    editing = await invoke("read_cartridge_for_edit", { drivePath: selectedDrive });
  } catch (error) {
    status(String(error), "error");
    return;
  }
  el.editTitle.value = editing.title ?? "";
  el.editCoverName.textContent = editing.coverPath ? "" : "no artwork on this cartridge";
  el.editStatus.textContent = "";
  renderEditGames();
  el.editDialog.showModal();
}

function renderEditGames() {
  el.editGames.replaceChildren();
  const list = editing?.games ?? [];
  list.forEach((game, index) => {
    const li = document.createElement("li");
    li.className = "rail-game";

    const name = document.createElement("span");
    name.className = "rail-game__name";
    name.textContent = game.title;

    const up = document.createElement("button");
    up.type = "button";
    up.className = "link";
    up.textContent = "↑";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveGame(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.className = "link";
    down.textContent = "↓";
    down.disabled = index === list.length - 1;
    down.addEventListener("click", () => moveGame(index, 1));

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "link";
    drop.textContent = "×";
    drop.addEventListener("click", () => {
      editing.games.splice(index, 1);
      renderEditGames();
    });

    li.append(name, up, down, drop);
    el.editGames.append(li);
  });

  el.editGamesHint.textContent = list.length
    ? "Reordering changes the order on the launcher. Nothing is copied or deleted."
    : "This cartridge lists no games.";
}

function moveGame(index, direction) {
  const to = index + direction;
  if (to < 0 || to >= editing.games.length) return;
  const [moved] = editing.games.splice(index, 1);
  editing.games.splice(to, 0, moved);
  renderEditGames();
}

async function saveEdits() {
  el.editStatus.textContent = "Saving…";
  try {
    await invoke("update_cartridge", {
      request: {
        drivePath: editing.drivePath,
        title: el.editTitle.value.trim() || editing.title,
        coverSource: art.cover?.path ?? null,
        games: (editing.games ?? []).map((g) => ({
          title: g.title,
          executable: g.executable,
        })),
      },
    });
    el.editDialog.close();
    status("Cartridge updated. No files were moved.", "good");
    await refreshDrives();
  } catch (error) {
    el.editStatus.textContent = String(error);
  }
}

/* ==========================================================================
   Wiring
   ========================================================================== */

el.search.addEventListener("input", renderGames);
el.btnCustom.addEventListener("click", enterManual);
el.btnCustomBack.addEventListener("click", () => {
  manual = null;
  showPhase("games");
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

el.btnCollectionCover.addEventListener("click", () => openArtwork("cover"));
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
el.btnRailArt.addEventListener("click", () => openArtwork("cover"));

el.optCopy.addEventListener("change", () => {
  copyTouched = true;
});
for (const box of [el.optCopy, el.optVerify, el.optIcon, el.optTune, el.optTrim, el.optEject, el.optCloseSteam]) {
  box.addEventListener("change", refreshOptions);
}
el.optFormat.addEventListener("change", () => {
  refreshFormatFields();
  refreshOptions();
  refreshRail();
});
for (const radio of document.querySelectorAll("#format-filesystem input")) {
  radio.addEventListener("change", () => {
    labelIsOurs = true;
    refreshFormatFields();
    renderCollectionHint();
    refreshOptions();
  });
}
el.formatLabel.addEventListener("input", () => {
  labelIsOurs = false;
  refreshCreateButton();
  refreshRail();
});
el.formatConfirm.addEventListener("input", refreshCreateButton);

el.btnOptions.addEventListener("click", () => {
  showPhase("options");
  refreshOptions();
});
el.btnOptionsBack.addEventListener("click", () => {
  showPhase(isCollection() ? "name" : manual ? "custom" : "games");
});
el.create.addEventListener("click", write);
el.btnEdit.addEventListener("click", openEditor);
el.editSave.addEventListener("click", saveEdits);
el.btnEditCover.addEventListener("click", () => pickCoverFile("cover"));
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

el.btnTuneCommands.addEventListener("click", async () => {
  try {
    const commands = await invoke("tuning_plan", {
      drivePath: selectedDrive,
      tweaks: WINDOWS_TWEAKS,
      applying: true,
    });
    status((commands ?? []).join("\n"));
  } catch (error) {
    status(String(error), "error");
  }
});
el.btnTuneUndo.addEventListener("click", async () => {
  try {
    const lines = await invoke("apply_tuning", {
      drivePath: selectedDrive,
      tweaks: WINDOWS_TWEAKS,
      applying: false,
    });
    status((lines ?? []).join(" "), "good");
    el.btnTuneUndo.hidden = true;
  } catch (error) {
    status(String(error), "error");
  }
});

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
    if (result.problems?.length) status(result.problems.join(" "), "error");
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
  refreshOptions();
  showPhase("games");
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
        ? ["Excluded the cartridge from Defender scanning."]
        : ["Defender scans the cartridge again."];
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
