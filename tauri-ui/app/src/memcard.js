/**
 * The memory card view.
 *
 * Every save a drive carries, as blocks in a grid, the way a console's memory
 * card browser showed them: each save named under its icon, a lamp saying where
 * it stands, the chosen one lifted, and a panel underneath that says where that
 * save is newer and what can be done with it. A drive with `memorycard.conf`
 * opens straight into this; a combo cartridge reaches it with a button or the
 * pad's View, and goes back the same way.
 *
 * Nothing here decides anything. Which copy is newer comes from the save
 * module's own comparison (`direction`), and every copy it asks for is backed
 * up by the backend first.
 *
 * Keys: arrows move, Enter copies the way the state suggests, Delete asks to
 * delete, O opens the save folder, Esc or M goes back. Pad: A copies, Y asks to
 * delete, B goes back. X does nothing here on purpose: on the cartridge it
 * ejects, and a button that ejects on one screen must not delete on the next.
 */

const $ = (id) => document.getElementById(id);

/** How long an armed Delete waits for its second press. */
const ARMED_MS = 4000;

/** Only these get a lamp: the saves that ask for something. */
function needsAttention(tone) {
  return tone === "warn" || tone === "bad";
}

/** What each state is called, and which way the obvious copy goes. */
function describe(block) {
  const onPc = block.hostBytes > 0;
  const onCard = block.cartridgeBytes > 0;
  switch (block.direction) {
    case "inSync":
      return { state: "Same on this PC and the card", tone: "good" };
    case "push":
      return onCard
        ? { state: "Newer on this PC", tone: "warn", suggest: "card" }
        : { state: "Only on this PC", tone: "muted", suggest: "card" };
    case "pull":
      return onPc
        ? { state: "Newer on the card", tone: "warn", suggest: "pc" }
        : { state: "Only on the card", tone: "muted", suggest: "pc" };
    case "conflict":
      return { state: "Changed on both", tone: "bad" };
    case "linked":
      return { state: "Played straight from the card", tone: "good" };
    case "unusable":
      return { state: block.detail || "Has no save folder on this PC", tone: "muted" };
    default:
      return { state: "Not played yet", tone: "muted" };
  }
}

export function createMemoryCard({ invoke, toast, formatBytes, duration, since }) {
  const el = {
    root: $("memcard"),
    title: $("mc-title"),
    capacity: $("mc-capacity"),
    barFill: $("mc-bar-fill"),
    cap: $("mc-cap"),
    blocks: $("mc-blocks"),
    empty: $("mc-empty"),
    game: $("mc-game"),
    state: $("mc-state"),
    stage: $("mc-stage"),
    hero: $("mc-hero"),
    toPc: $("mc-to-pc"),
    toCard: $("mc-to-card"),
    remove: $("mc-remove"),
    folder: $("mc-folder"),
    close: $("mc-close"),
  };
  const label = (button) => button.querySelector(".btn__label");

  let drivePath = "";
  let view = null;
  let selected = 0;
  let onClose = null;
  let busy = false;
  /** Delete asks twice: the first press arms it, the second does it. */
  let armed = false;
  let disarmTimer = null;
  const spinner = createSpinner(el.blocks);
  const stage = createStage(el.stage, el.hero);
  el.hero.addEventListener("click", () => void reveal());

  function blocks() {
    return view?.blocks ?? [];
  }

  function disarm() {
    clearTimeout(disarmTimer);
    armed = false;
  }

  function render() {
    el.title.textContent = view.title;
    el.empty.hidden = blocks().length > 0;
    el.blocks.replaceChildren(
      ...blocks().map((block, index) => {
        const { state, tone } = describe(block);
        const li = document.createElement("li");
        li.className = "mc__block";
        li.setAttribute("role", "option");
        li.tabIndex = -1;
        li.dataset.index = String(index);
        li.dataset.tone = tone;
        li.setAttribute("aria-label", `${block.title}. ${state}.`);

        const icon = cube(block);
        li.addEventListener("pointerenter", () => (li.dataset.hover = "1"));
        li.addEventListener("pointerleave", () => delete li.dataset.hover);

        // Under the box: its name, with a lamp only on a save that needs
        // something, and what it takes on the card.
        const name = document.createElement("span");
        name.className = "mc__label";
        const lamp = document.createElement("i");
        lamp.className = "lamp";
        lamp.dataset.tone = tone;
        lamp.hidden = !needsAttention(tone);
        lamp.setAttribute("aria-hidden", "true");
        name.append(lamp, document.createTextNode(block.title));
        const size = document.createElement("span");
        size.className = "mc__size";
        size.textContent = block.cartridgeBytes ? formatBytes(block.cartridgeBytes) : "Not on the card";

        li.append(icon, name, size);
        li.addEventListener("click", () => select(index));
        return li;
      }),
    );
    select(Math.min(selected, Math.max(blocks().length - 1, 0)), true);
  }

  function select(index, force = false) {
    if (!force && index === selected) return;
    const moved = index !== selected || !el.hero.firstChild;
    selected = index;
    disarm();
    const hadFocus = el.blocks.contains(document.activeElement);
    for (const li of el.blocks.children) {
      const on = Number(li.dataset.index) === index;
      li.setAttribute("aria-selected", String(on));
      // One stop in the tab order, on the save that is chosen.
      li.tabIndex = on ? 0 : -1;
      if (on && hadFocus) li.focus();
    }
    const li = el.blocks.children[index];
    li?.scrollIntoView({ block: "nearest", inline: "nearest" });
    renderInfo();
    // Pulled off the shelf: the case flies from its slot to the stage and
    // turns to its back cover. A refresh after a copy only reprints it.
    const block = blocks()[index];
    if (block) stage.show(cube(block, { back: backCover(block) }), moved ? li : null);
    else stage.clear();
  }

  /** The back of the case: the save's details, printed. */
  function backCover(block) {
    const { state, tone } = describe(block);
    const back = document.createElement("span");
    back.className = "mc__back";
    const title = document.createElement("b");
    title.className = "mc__back-title";
    title.textContent = block.title;
    const status = document.createElement("span");
    status.className = "mc__back-state";
    status.dataset.tone = tone;
    const lamp = document.createElement("i");
    lamp.className = "lamp";
    lamp.dataset.tone = tone;
    lamp.hidden = !needsAttention(tone);
    status.append(lamp, document.createTextNode(state));
    back.append(title, status);
    const newest = Math.max(block.cartridgeNewest || 0, block.hostNewest || 0);
    const rows = [];
    if (newest) rows.push(`Saved ${since(newest)}`);
    if (block.seconds >= 60) rows.push(`${duration(block.seconds)} played`);
    if (block.cartridgeBytes) rows.push(`${formatBytes(block.cartridgeBytes)} on the card`);
    for (const text of rows) {
      const row = document.createElement("span");
      row.className = "mc__back-row";
      row.textContent = text;
      back.append(row);
    }
    return back;
  }

  function renderInfo() {
    const block = blocks()[selected];
    el.root.classList.toggle("has-block", Boolean(block));
    if (!block) return;
    const { state, suggest } = describe(block);
    // Read out for a screen reader; seen on the case's back cover.
    el.game.textContent = block.title;
    el.state.textContent = state;

    // Only the copy that fixes it. Both, unfilled, when both changed: the
    // choice is the player's, so neither is lit as the answer.
    const conflict = block.direction === "conflict";
    const hasFolder = Boolean(block.hostPath);
    el.toPc.hidden = !hasFolder || !(suggest === "pc" || conflict);
    el.toCard.hidden = !hasFolder || !(suggest === "card" || conflict);
    for (const button of [el.toPc, el.toCard]) {
      button.disabled = busy;
      button.classList.toggle("btn--primary", !conflict);
      button.classList.toggle("btn--ghost", conflict);
      button.classList.toggle("is-suggested", !conflict);
    }
    label(el.toPc).textContent = conflict ? "Keep the card's" : "Copy to PC";
    label(el.toCard).textContent = conflict ? "Keep this PC's" : "Copy to card";

    el.remove.hidden = !block.cartridgeBytes;
    el.remove.disabled = busy;
    // Nothing saved anywhere yet: there is no folder to open.
    el.folder.hidden = !block.hostBytes && !block.cartridgeBytes;
    el.remove.classList.toggle("is-armed", armed);
    label(el.remove).textContent = armed ? "Delete from card? A backup stays" : "Delete";
  }

  async function refresh() {
    view = await invoke("memory_card", { drivePath });
    render();
    void renderCapacity();
  }

  /** How full the card is: the saves, and what is left on the drive. */
  async function renderCapacity() {
    let health = null;
    try {
      health = await invoke("cartridge_health", { drivePath });
    } catch {
      // No reading, no bar: a guess would be worse.
    }
    const total = health?.totalBytes ?? 0;
    el.capacity.hidden = !total;
    if (!total) return;
    const saves = blocks().reduce((sum, block) => sum + (block.cartridgeBytes || 0), 0);
    const used = total - (health.freeBytes ?? 0);
    el.barFill.style.transform = `scaleX(${Math.min(1, used / total).toFixed(3)})`;
    el.cap.textContent = `${formatBytes(saves)} of saves · ${formatBytes(health.freeBytes ?? 0)} free of ${formatBytes(total)}`;
  }

  async function copy(to) {
    const block = blocks()[selected];
    if (!block || busy) return;
    busy = true;
    renderInfo();
    try {
      await invoke("memcard_copy", { drivePath, slotId: block.slot.id, to });
      toast(`${block.title} copied to ${to === "pc" ? "this PC" : "the card"}. The copy it replaced was kept.`);
    } catch (error) {
      toast(`${block.title} was not copied: ${error}`, true);
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function remove() {
    const block = blocks()[selected];
    if (!block || busy || !block.cartridgeBytes) return;
    if (!armed) {
      armed = true;
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        armed = false;
        renderInfo();
      }, ARMED_MS);
      renderInfo();
      return;
    }
    disarm();
    busy = true;
    try {
      await invoke("memcard_remove", { drivePath, slotId: block.slot.id });
      toast(`${block.title} taken off the card. A backup stays on it, and this PC's copy is untouched.`);
    } catch (error) {
      toast(`${block.title} was not deleted: ${error}`, true);
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function reveal() {
    const block = blocks()[selected];
    if (!block) return;
    try {
      await invoke("memcard_reveal", { drivePath, slotId: block.slot.id });
    } catch (error) {
      toast(String(error), true);
    }
  }

  /** The copy the state suggests, for Enter and the pad's A. */
  function primary() {
    const block = blocks()[selected];
    if (!block) return;
    const { suggest, tone } = describe(block);
    if (suggest) {
      void copy(suggest);
      return;
    }
    // Nothing to do is still an answer, and a silent press reads as broken.
    toast(
      tone === "bad"
        ? `${block.title} changed on both sides. Choose Copy to PC or Copy to card.`
        : `${block.title} needs nothing: ${describe(block).state.toLowerCase()}.`,
    );
  }

  /** How many blocks sit on a row, measured, as the launcher's rail does. */
  function columns() {
    const rows = [...el.blocks.children];
    if (rows.length < 2) return 1;
    const top = rows[0].offsetTop;
    return Math.max(1, rows.filter((row) => row.offsetTop === top).length);
  }

  function move(x, y) {
    const count = blocks().length;
    if (count < 2) return;
    // A shelf that is one row has no row above or below: up and down move
    // along it, as the launcher's rail does.
    const across = columns();
    select((selected + x + y * (across >= count ? 1 : across) + count) % count);
  }

  el.toPc.addEventListener("click", () => copy("pc"));
  el.toCard.addEventListener("click", () => copy("card"));
  el.remove.addEventListener("click", remove);
  el.folder.addEventListener("click", reveal);
  el.close.addEventListener("click", () => onClose?.());

  return {
    get open() {
      return !el.root.hidden;
    },

    /**
     * Show a drive's card. `close` is what leaving it means here, and `back`
     * says whether that is returning to a cartridge rather than closing the
     * window, which is what the close button is then called.
     */
    async show(path, close, { back = false } = {}) {
      drivePath = path;
      onClose = close;
      selected = 0;
      const name = back ? "Back to cartridge" : "Close";
      el.close.setAttribute("aria-label", name);
      el.close.title = `${name} — Esc`;
      await refresh();
      el.root.hidden = false;
      spinner.start();
      stage.start();
    },

    hide() {
      disarm();
      spinner.stop();
      stage.stop();
      el.root.hidden = true;
    },

    /** A key while the card is open. True when it was the card's. */
    key(event) {
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      // Enter on a focused button is that button's; only elsewhere is it the
      // suggested copy.
      if (event.key === "Enter" && event.target instanceof HTMLButtonElement) return false;
      if (arrows[event.key]) {
        move(...arrows[event.key]);
      } else if (event.key === "Enter") {
        primary();
      } else if (event.key === "Delete") {
        void remove();
      } else if (event.key === "o" || event.key === "O") {
        void reveal();
      } else if (event.key === "Escape" || event.key === "m" || event.key === "M") {
        onClose?.();
      } else {
        return false;
      }
      event.preventDefault();
      return true;
    },

    pad: { move, primary, remove: () => void remove(), back: () => onClose?.() },
  };
}

/**
 * A save as a game case on a shelf: the art on the cover, the game's name
 * running down the spine, lids top and bottom, a soft shadow on the floor
 * under it and a faded reflection that turns with it. A game with no art gets
 * a cover in the card's accent with its initials.
 */
function cube(block, { back = null } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "mc__icon";
  const box = document.createElement("span");
  box.className = "mc__cube";
  const art = block.icon && /^(data:image\/|src\/)/.test(block.icon) ? block.icon : "";
  // Absolute, because a url() inside a custom property resolves against the
  // stylesheet that uses it, not the page — which breaks a relative path.
  if (art) wrap.style.setProperty("--art", `url("${new URL(art, document.baseURI).href}")`);
  else wrap.classList.add("is-blank");
  for (const face of ["front", "back", "right", "left", "top", "bottom"]) {
    const side = document.createElement("span");
    side.className = `mc__face mc__face--${face}`;
    if (!art && face === "front") side.textContent = initials(block.title);
    if (back && face === "back") side.append(back);
    if (face === "left") {
      const spine = document.createElement("span");
      spine.textContent = block.title;
      side.append(spine);
    }
    box.append(side);
  }
  const shadow = document.createElement("span");
  shadow.className = "mc__shadow";
  const reflection = document.createElement("span");
  reflection.className = "mc__refl";
  const plane = document.createElement("span");
  plane.className = "mc__refl-plane";
  reflection.append(plane);
  wrap.append(shadow, reflection, box);
  return wrap;
}

/**
 * The stage: where the chosen case is pulled to.
 *
 * On a new choice the case starts where its slot on the shelf is — same place,
 * same size, facing front — and a spring carries it to the stage, growing and
 * turning round to its back cover, with a little overshoot so it lands rather
 * than stops. At rest it sits turned slightly off square so its spine shows,
 * and tips a few degrees towards the pointer. One loop while the card is open.
 */
function createStage(stage, hero) {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const REST = 162;
  const s = { p: 1, v: 0, dx: 0, dy: 0, scale: 1, tiltX: 0, tiltY: 0, aimX: 0, aimY: 0 };
  let frame = 0;
  let last = 0;

  stage.addEventListener("pointermove", (event) => {
    const box = stage.getBoundingClientRect();
    s.aimX = ((event.clientX - box.left) / box.width - 0.5) * 2;
    s.aimY = ((event.clientY - box.top) / box.height - 0.5) * 2;
  });
  stage.addEventListener("pointerleave", () => {
    s.aimX = 0;
    s.aimY = 0;
  });

  function apply() {
    const box = hero.querySelector(".mc__cube");
    const p = s.p;
    hero.style.transform =
      `translate(${(s.dx * (1 - p)).toFixed(1)}px, ${(s.dy * (1 - p)).toFixed(1)}px) ` +
      `scale(${(s.scale + (1 - s.scale) * p).toFixed(4)})`;
    if (box) {
      box.style.transform =
        `rotateX(${(-6 - s.tiltY * 7).toFixed(2)}deg) ` +
        `rotateY(${(REST * p + s.tiltX * 12).toFixed(2)}deg)`;
    }
  }

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.034);
    last = now;
    // Slightly under-damped: it arrives, overshoots a touch, settles.
    const force = 190 * (1 - s.p) - 20 * s.v;
    s.v += force * dt;
    s.p += s.v * dt;
    const k = 1 - Math.exp(-dt * 6);
    s.tiltX += (s.aimX - s.tiltX) * k;
    s.tiltY += (s.aimY - s.tiltY) * k;
    apply();
    frame = requestAnimationFrame(tick);
  }

  return {
    /** Put a case on the stage, flown in from `from` (a shelf slot) if given. */
    show(caseEl, from) {
      hero.replaceChildren(caseEl);
      hero.style.transform = "";
      const origin = from?.querySelector(".mc__cube");
      const a = origin?.getBoundingClientRect();
      const b = hero.getBoundingClientRect();
      // Nothing to fly from — no slot, reduced motion, or the card not laid
      // out yet on first open: it is simply there.
      if (!a?.width || !b.width || still.matches) {
        s.p = 1;
        s.v = 0;
        apply();
        return;
      }
      s.scale = a.width / b.width;
      s.dx = a.left + a.width / 2 - (b.left + b.width / 2);
      s.dy = a.top + a.height / 2 - (b.top + b.height / 2);
      s.p = 0;
      s.v = 0;
      apply();
    },
    clear() {
      hero.replaceChildren();
    },
    start() {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/**
 * Turn the boxes.
 *
 * Driven here rather than by a CSS animation because a CSS animation can only
 * pause wherever it happens to be, and a box has to come to rest facing you:
 * a held box (selected, or under the pointer) eases round to the nearest front
 * and levels out, and the rest keep turning, each at its own pace. One loop,
 * only while the card is open.
 *
 * Deliberately not stopped by reduced motion: the turn is slow (about once in
 * twenty seconds), ambient rather than something to follow, and it comes to
 * rest on its own the moment a save is chosen or pointed at. Windows reports
 * reduced motion whenever "Animation effects" is off, which is common, and a
 * shelf of cases frozen side-on read as broken.
 */
function createSpinner(list) {
  const state = new WeakMap();
  let frame = 0;
  let last = 0;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const li of list.children) {
      const box = li.querySelector(".mc__cube");
      if (!box) continue;
      let s = state.get(li);
      if (!s) {
        // Out of step from the start, so the shelf does not turn as one.
        s = { angle: Number(li.dataset.index || 0) * 47, tilt: -8 };
        state.set(li, s);
      }
      const held = li.getAttribute("aria-selected") === "true" || li.dataset.hover;
      if (held) {
        const front = Math.round(s.angle / 360) * 360;
        const k = 1 - Math.exp(-dt * 9);
        s.angle += (front - s.angle) * k;
        s.tilt += (0 - s.tilt) * k;
      } else {
        // About one turn in twenty seconds: a shelf, not a carousel.
        s.angle += dt * (16 + (Number(li.dataset.index || 0) % 3) * 3);
        s.tilt += (-8 - s.tilt) * (1 - Math.exp(-dt * 3));
      }
      box.style.transform = `rotateX(${s.tilt.toFixed(2)}deg) rotateY(${s.angle.toFixed(2)}deg)`;
      const plane = li.querySelector(".mc__refl-plane");
      if (plane) plane.style.transform = `rotateY(${s.angle.toFixed(2)}deg)`;
    }
    frame = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

function initials(title) {
  return (title || "")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}
