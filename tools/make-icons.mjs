/**
 * Build every icon from the logo artwork.
 *
 *   docs/pc-gamepak-logo-hires.png   the badge (left) and the cartridge (right),
 *                                    the sheet upscaled 4x
 *
 * One is the app: the launcher's executable, its taskbar button, the watcher
 * and its notification-area icon (the watcher embeds icon.ico). The other is
 * the wizard's window, so the two windows of one executable can be told apart
 * in the taskbar. The cartridge is the app unless told otherwise.
 *
 * Cleaned on the way, because the upscale left soft, white-tinted edges: specks
 * and stray lines are dropped, the soft alpha ramp is tightened to a crisp edge,
 * and every edge pixel takes its colour from the solid picture just inside it,
 * which removes the light rim. Then each picture is cut out by its own alpha and
 * centred on a square, and shrunk in halving steps, which keeps 16 and 24 px
 * legible where one big jump would alias. The cleaned cut-outs are kept beside
 * the icons as the sources.
 *
*   node tools/make-icons.mjs --app badge  what this project uses
 *   node tools/make-icons.mjs --app badge  the badge is
 *
 * Needs `playwright` or `playwright-core` and a Chromium-family browser (Edge
 * on Windows): the canvas does the image work, so nothing else is installed.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = path.join(ROOT, "docs/pc-gamepak-logo-hires.png");
const APP = process.argv.includes("--app") ? process.argv[process.argv.indexOf("--app") + 1] : "cartridge";
if (!["cartridge", "badge"].includes(APP)) throw new Error(`--app cartridge|badge, not ${APP}`);
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
// Largest first: Tauri builds its default window icon from the .ico's first
// entry alone, and Windows picks the best size whatever the order.
const ICO_SIZES = [256, 128, 96, 64, 48, 40, 32, 24, 20, 16];
// The wizard's window icon. Large, because Windows is asked for it at the
// window's DPI and shrinks it: 48 px for a taskbar at 150%.
const WIZARD_SIZE = 256;

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
    const W = img.width, H = img.height, d = px.data;
    const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);

    // 1. Tighten the alpha: the upscale smeared a one-pixel edge across four.
    //    Below LO is haze, above HI is solid, between is the real edge.
    const LO = 60, HI = 220;
    for (let i = 3; i < d.length; i += 4) {
      d[i] = d[i] <= LO ? 0 : d[i] >= HI ? 255 : Math.round(((d[i] - LO) / (HI - LO)) * 255);
    }

    // 2. Re-colour the rim from the inside. A pixel is "inside" when nothing
    //    within R of it is see-through; every other visible pixel takes the
    //    average colour of the inside pixels near it, which replaces the white
    //    the upscaler blended in with the picture's own edge colour.
    const R = 3;
    const inside = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (A(x, y) < 255) continue;
        let ok = true;
        for (let dy = -R; dy <= R && ok; dy++)
          for (let dx = -R; dx <= R; dx++) if (A(x + dx, y + dy) < 255) { ok = false; break; }
        inside[y * W + x] = ok ? 1 : 0;
      }
    const copy = new Uint8ClampedArray(d);
    const reach = R + 4;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (!d[i + 3] || inside[y * W + x]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H || !inside[yy * W + xx]) continue;
            const j = (yy * W + xx) * 4;
            r += copy[j]; g += copy[j + 1]; b += copy[j + 2]; n++;
          }
        if (n) (d[i] = r / n), (d[i + 1] = g / n), (d[i + 2] = b / n);
      }
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
    // A run a few pixels wide is a stray line at the sheet's edge, not a picture.
    const boxes = runs.filter(([x0, x1]) => x1 - x0 > 8).map(([x0, x1]) => {
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
    const [app, wizard] = sizes.appIsBadge ? [badge, cartridge] : [cartridge, badge];
    const result = { app: {}, cutouts: {} };
    for (const size of sizes.app) result.app[size] = toBase64(square(app, size, fillFor(size)));
    result.wizard = toBase64(square(wizard, sizes.wizard, 1));
    result.wizardIco = {};
    for (const size of sizes.ico) result.wizardIco[size] = toBase64(square(wizard, size, fillFor(size)));
    for (const [name, box] of [["cartridge", cartridge], ["badge", badge]]) {
      const c = canvas(box.w, box.h);
      c.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      result.cutouts[name] = toBase64(c);
    }
    result.boxes = boxes;
    return result;
  },
  {
    sheet,
    sizes: {
      app: [...new Set([...PNGS.map(([, s]) => s), ...ICO_SIZES])],
      wizard: WIZARD_SIZE,
      appIsBadge: APP === "badge",
      ico: ICO_SIZES,
    },
  },
);
await browser.close();

const png = (size) => Buffer.from(render.app[size], "base64");

for (const [name, size] of PNGS) {
  await fs.writeFile(path.join(ICONS, name), png(size));
  console.log(`${name.padEnd(24)} ${size}x${size}`);
}

// Multi-resolution .ico. Each entry stores a PNG verbatim, which Windows has
// accepted since Vista and keeps the file small at 256px.
function icoOf(pngFor) {
const entries = ICO_SIZES.map((size) => ({ size, data: pngFor(size) }));
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
return Buffer.concat([header, ...entries.map((e) => e.data)]);
}
const ico = icoOf(png);
await fs.writeFile(path.join(ICONS, "icon.ico"), ico);
await fs.writeFile(path.join(ICONS, "wizard.ico"), icoOf((size) => Buffer.from(render.wizardIco[size], "base64")));
console.log(`${"icon.ico".padEnd(24)} ${ICO_SIZES.join(", ")} (${(ico.length / 1024).toFixed(0)} KB)`);

await fs.writeFile(path.join(ICONS, "wizard.png"), Buffer.from(render.wizard, "base64"));
console.log(`${"wizard.ico, wizard.png".padEnd(24)} the wizard's window`);

for (const [name, data] of Object.entries(render.cutouts)) {
  await fs.writeFile(path.join(ICONS, `logo-${name}.png`), Buffer.from(data, "base64"));
}
console.log(`logo-cartridge.png, logo-badge.png   the cleaned cut-outs (${render.boxes.map((b) => `${b.w}x${b.h}`).join(", ")})`);
console.log(`the ${APP} is the app; the ${APP === "badge" ? "cartridge" : "badge"} is the wizard`);
