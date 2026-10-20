/**
 * The TV launcher's stand-in backend, for looking at it in a browser.
 *
 * Loaded only when there is no Tauri. The games are made up and drawn with the
 * preview's own pictures, so the screenshots and demos made from it carry
 * nobody's box art. `?drive=` (empty for no cartridge), `?state=memcard` (a
 * card on its own) and `?view=card` pick what is in the slot and what shows.
 */

const params = new URLSearchParams(location.search);
const now = () => Math.floor(Date.now() / 1000);

/** The cartridge in the slot: a collection that carries a sleeve kit. */
const MOONFALL = {
  title: "Moonfall Trilogy",
  cover: "src/demo/gow-collection.jpg",
  drive_path: "X",
  executable: "steam://rungameid/1",
  is_bundle: true,
  memory_card: true,
  platform: "PC",
  games: [
    { title: "Moonrise", executable: "steam://rungameid/1", cover: "src/demo/gow-1.jpg" },
    { title: "Moonfall", executable: "steam://rungameid/2", cover: "src/demo/gow-2.jpg" },
    { title: "Moonset", executable: "steam://rungameid/3", cover: "src/demo/gow-collection.jpg" },
  ],
  sleeve: {
    front: "src/demo/gow-collection.jpg",
    back: "src/demo/gow-2.jpg",
    spine: "",
    spineRight: "",
    boxRender: "",
    tagline: "Moonrise · Moonfall · Moonset",
    headline: "THREE NIGHTS.\nONE LONG DAWN.",
    blurb:
      "Climb the mountain before the moon comes down, hold the valley through the longest night, then find out who was waiting at the top.",
    features: "1 PLAYER · ACTION ADVENTURE · WINDOWS 10 / 11",
    rating: "12",
    descriptor: "Fantasy violence",
    accent: "#6ed7ff",
    legal: "",
  },
};

const CREATED = [
  { id: "1", title: "Moonfall Trilogy", games: ["Moonrise", "Moonfall", "Moonset"], driveLabel: "MOON", cover: "src/demo/gow-collection.jpg" },
  { id: "2", title: "Cinder & Salt", games: ["Cinder & Salt"], driveLabel: "CINDER", cover: "src/demo/cover.jpg" },
  { id: "3", title: "Hollow Peaks", games: ["Hollow Peaks"], driveLabel: "PEAKS", cover: "src/demo/gow-1.jpg" },
  { id: "4", title: "Stormline", games: ["Stormline"], driveLabel: "STORM", cover: "src/demo/gow-2.jpg" },
  { id: "5", title: "Lanternfish", games: ["Lanternfish"], driveLabel: "LANTERN", cover: "" },
];

function block(id, title, icon, direction, hostBytes, cartridgeBytes, ago) {
  return {
    slot: { id, label: title, template: `{appdata}/${id}`, mode: "copy" },
    hostPath: `/home/you/.config/${id}`,
    direction,
    hostNewest: now() - ago,
    cartridgeNewest: now() - ago - 3600,
    hostBytes,
    cartridgeBytes,
    lastSync: 0,
    detail: "",
    title,
    icon,
    seconds: 36_000,
    launches: 4,
  };
}

const BLOCKS = [
  block("moonfall", "Moonfall Trilogy", "src/demo/gow-collection.jpg", "pull", 30_000_000, 33_500_000, 86_400),
  block("cinder", "Cinder & Salt", "src/demo/cover.jpg", "inSync", 2_400_000, 2_400_000, 2 * 86_400),
  block("peaks", "Hollow Peaks", "src/demo/gow-1.jpg", "conflict", 800_000, 810_000, 6 * 86_400),
  block("storm", "Stormline", "src/demo/gow-2.jpg", "push", 41_000_000, 38_000_000, 3_600),
];

export async function demoInvoke(command, args) {
  const cardOnly = params.get("state") === "memcard";
  switch (command) {
    case "drive_path":
      return params.get("drive") ?? "X";
    case "memory_card":
      if (!args.drivePath) throw "no drive";
      return { title: "Harry's Memory Card", cardOnly, blocks: BLOCKS };
    case "parse_cartridge":
      if (cardOnly) throw "not a cartridge";
      return MOONFALL;
    case "can_eject":
      return true;
    case "cartridge_health":
      return { totalBytes: 128_000_000_000, freeBytes: 97_400_000_000 };
    case "list_created":
      return CREATED;
    case "launch_game":
      await new Promise((r) => setTimeout(r, 500));
      return null;
    case "eject_with_guard":
      await new Promise((r) => setTimeout(r, 500));
      return { ejected: true, message: "Safe to remove" };
    case "memcard_copy": {
      const b = BLOCKS.find((x) => x.slot.id === args.slotId);
      if (b) Object.assign(b, { direction: "inSync", hostBytes: b.cartridgeBytes, cartridgeBytes: b.cartridgeBytes });
      return { backup: "kept" };
    }
    case "memcard_remove": {
      const b = BLOCKS.find((x) => x.slot.id === args.slotId);
      if (b) Object.assign(b, { cartridgeBytes: 0, direction: "push" });
      return null;
    }
    case "memcard_reveal":
    case "open_wizard_settings":
    case "focus_window":
      return null;
    default:
      throw `the preview has no ${command}`;
  }
}
