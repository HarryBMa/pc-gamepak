/**
 * The TV launcher's stand-in backend, for looking at it in a browser.
 *
 * Loaded only when there is no Tauri. The cartridge in the slot is an XCOM
 * collection carrying a real sleeve kit: the faces and words CoverForge
 * exported from the PC GamePak sleeve made for it (src/demo/xcom-*.jpg). The
 * rest of the shelf is made up, drawn with the preview's own pictures.
 * `?drive=` (empty for no cartridge), `?state=memcard` (a card on its own) and
 * `?view=card` pick what is in the slot and what shows.
 */

const params = new URLSearchParams(location.search);
const now = () => Math.floor(Date.now() / 1000);

/** The cartridge in the slot: a collection that carries a sleeve kit. */
const XCOM = {
  title: "XCOM",
  cover: "src/demo/xcom-front.jpg",
  drive_path: "X",
  executable: "steam://rungameid/200510",
  is_bundle: true,
  memory_card: true,
  platform: "PC",
  games: [
    { title: "XCOM: Enemy Unknown", executable: "steam://rungameid/200510", cover: "src/demo/xcom-front.jpg" },
    { title: "XCOM 2", executable: "steam://rungameid/268500", cover: "src/demo/xcom-front.jpg" },
    { title: "XCOM: Chimera Squad", executable: "steam://rungameid/882100", cover: "src/demo/xcom-front.jpg" },
  ],
  sleeve: {
    front: "src/demo/xcom-front.jpg",
    back: "src/demo/xcom-back.jpg",
    spine: "src/demo/xcom-spine.jpg",
    spineRight: "src/demo/xcom-spine-right.jpg",
    boxRender: "",
    tagline: "Enemy Unknown  •  XCOM 2  •  Chimera Squad",
    headline: "THREE CAMPAIGNS.\nONE WAR FOR EARTH.",
    blurb:
      "Earth has one line of defence, and you command it. Stop the first invasion, lead the resistance twenty years after the aliens won, then hold a fragile peace in City 31. The complete Firaxis XCOM saga, together on one PC GamePak.",
    features: "1 player  ·  Turn-based strategy  ·  Windows 10 / 11",
    rating: "18",
    descriptor: "Violence",
    accent: "#6ed7ff",
    legal:
      "XCOM © Take-Two Interactive Software. Developed by Firaxis Games, published by 2K. Fan-made sleeve for personal use only. Not for sale.",
    // The PC-GAMEPAK holo sticker on the front, in CoverForge's glitter foil.
    foil: { style: "glitter", front: "src/demo/xcom-front-foil.png", back: "", spine: "", spineRight: "" },
  },
};

const CREATED = [
  { id: "0", title: "XCOM", games: ["XCOM: Enemy Unknown", "XCOM 2", "XCOM: Chimera Squad"], driveLabel: "XCOM", cover: "src/demo/xcom-front.jpg" },
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
  block("xcom2", "XCOM 2", "src/demo/xcom-front.jpg", "pull", 30_000_000, 33_500_000, 86_400),
  block("moonfall", "Moonfall Trilogy", "src/demo/gow-collection.jpg", "inSync", 8_200_000, 8_200_000, 4 * 86_400),
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
      return XCOM;
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
