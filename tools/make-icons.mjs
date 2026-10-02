/**
 * Build every icon from the logo artwork.
 *
 *   docs/pc-gamepak-logo_0004_Lager-1.png   the badge (left) and the cartridge (right)
 *
 * The cartridge is the app: the launcher's executable, its taskbar button, the
 * watcher and its notification-area icon (the watcher embeds icon.ico). The
 * badge is the wizard's window, so the two windows of one executable can be
 * told apart in the taskbar.
 *
 * Cleaned on the way: each picture is cut out of the sheet by its own alpha,
 * stray near-transparent pixels are dropped, and it is centred on a square.
 * Shrunk in halving steps, which keeps 16 and 24 px legible where one big jump
 * would alias. The cut-outs are kept beside the icons as the sources.
 *
 *   node tools/make-icons.mjs
 *
 * Needs `playwright` or `playwright-core` and a Chromium-family browser (Edge
 * on Windows): the canvas does the image work, so nothing else is installed.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = path.join(ROOT, "docs/pc-gamepak-logo_0004_Lager-1.png");
const ICONS = path.join(ROOT, "tauri-ui/src-tauri/icons");

// The sizes Tauri's bundler expects, and the ones that go into the .ico.
const PNGS = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square150x150Logo.png", 150],
  ["Square44x44Logo.png", 44],
];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// The wizard's window icon, as raw RGBA: Tauri takes that without the
// image-png feature, which `tauri build` would otherwise have to keep enabled.
const WIZARD_SIZE = 64;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("playwright-core"));
}
const browser = await chromium.launch(process.platform === "win32" ? { channel: "msedge" } : {});
const tab = await browser.newPage();
await tab.setContent("<!doctype html><body></body>");

const sheet = (await fs.readFile(SHEET)).toString("base64");

/** Runs in the page: cut the n-th picture out of the sheet and render it at each size. */
const render = await tab.evaluate(
  async ({ sheet, sizes }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${sheet}`;
    await img.decode();
    const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
    const src = canvas(img.width, img.height);
    const sg = src.getContext("2d");
    sg.drawImage(img, 0, 0);
    const px = sg.getImageData(0, 0, img.width, img.height);
    // Near-transparent specks are compression dust, not edge: drop them.
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 8) px.data[i] = 0;
    sg.putImageData(px, 0, 0);

    // The pictures are separated by columns with nothing in them.
    const filled = (x) => {
      for (let y = 0; y < img.height; y++) if (px.data[(y * img.width + x) * 4 + 3]) return true;
      return false;
    };
    const runs = [];
    let start = -1;
    for (let x = 0; x <= img.width; x++) {
      const on = x < img.width && filled(x);
      if (on && start < 0) start = x;
      if (!on && start >= 0) runs.push([start, x - 1]), (start = -1);
    }
    const boxes = runs.map(([x0, x1]) => {
      let y0 = img.height, y1 = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = x0; x <= x1; x++)
          if (px.data[(y * img.width + x) * 4 + 3]) (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    });

    const toBase64 = (c) => c.toDataURL("image/png").split(",")[1];

    /** One picture on a transparent square, `fill` of the side, shrunk by halving. */
    const square = (box, size, fill) => {
      // Start from the cut-out at full resolution on a square, then halve
      // towards the target and finish with one last smoothed step.
      const side = Math.ceil(Math.max(box.w, box.h) / fill);
      let cur = canvas(side, side);
      cur.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h,
        Math.round((side - box.w) / 2), Math.round((side - box.h) / 2), box.w, box.h);
      while (cur.width / 2 >= size) {
        const next = canvas(Math.round(cur.width / 2), Math.round(cur.width / 2));
        const g = next.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      const out = canvas(size, size);
      const g = out.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(cur, 0, 0, size, size);
      return out;
    };

    // Small sizes fill the square: every pixel counts at 16. Large ones keep a
    // little air, as Windows' own icons do.
    const fillFor = (size) => (size <= 32 ? 1 : 0.94);
    const [badge, cartridge] = boxes;
    const result = { app: {}, cutouts: {} };
    for (const size of sizes.app) result.app[size] = toBase64(square(cartridge, size, fillFor(size)));
    const w = square(badge, sizes.wizard, 1);
    result.wizard = Array.from(w.getContext("2d").getImageData(0, 0, sizes.wizard, sizes.wizard).data);
    for (const [name, box] of [["cartridge", cartridge], ["badge", badge]]) {
      const c = canvas(box.w, box.h);
      c.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      result.cutouts[name] = toBase64(c);
    }
    result.boxes = boxes;
    return result;
  },
  { sheet, sizes: { app: [...new Set([...PNGS.map(([, s]) => s), ...ICO_SIZES])], wizard: WIZARD_SIZE } },
);
await browser.close();

const png = (size) => Buffer.from(render.app[size], "base64");

for (const [name, size] of PNGS) {
  await fs.writeFile(path.join(ICONS, name), png(size));
  console.log(`${name.padEnd(24)} ${size}x${size}`);
}

// Multi-resolution .ico. Each entry stores a PNG verbatim, which Windows has
// accepted since Vista and keeps the file small at 256px.
const entries = ICO_SIZES.map((size) => ({ size, data: png(size) }));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach((entry, i) => {
  const at = 6 + i * 16;
  header.writeUInt8(entry.size === 256 ? 0 : entry.size, at); // 256 encodes as 0
  header.writeUInt8(entry.size === 256 ? 0 : entry.size, at + 1);
  header.writeUInt16LE(1, at + 4); // colour planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(entry.data.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += entry.data.length;
});
const ico = Buffer.concat([header, ...entries.map((e) => e.data)]);
await fs.writeFile(path.join(ICONS, "icon.ico"), ico);
console.log(`${"icon.ico".padEnd(24)} ${ICO_SIZES.join(", ")} (${(ico.length / 1024).toFixed(0)} KB)`);

await fs.writeFile(path.join(ICONS, "wizard.rgba"), Buffer.from(render.wizard));
console.log(`${"wizard.rgba".padEnd(24)} ${WIZARD_SIZE}x${WIZARD_SIZE} raw RGBA, the wizard's window`);

for (const [name, data] of Object.entries(render.cutouts)) {
  await fs.writeFile(path.join(ICONS, `logo-${name}.png`), Buffer.from(data, "base64"));
}
console.log(`logo-cartridge.png, logo-badge.png   the cut-outs (${render.boxes.map((b) => `${b.w}x${b.h}`).join(", ")})`);
