// Renders the site's favicon, touch icon and link preview image from the game's title art.
// Usage: npx tsx tools/site-images.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { allCostumes, skins } from '../src/game/assets.ts';
import { modules } from '../src/game/generated/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public');

/** A bitmap costume as a data URL with its size in pixels. */
function costume(sprite: string, name: string): { src: string; w: number; h: number } {
  const ti = modules.findIndex((m) => m.def.name === sprite);
  const c = allCostumes[ti]?.find((x) => x.name === name);
  if (!c) throw new Error(`missing costume ${sprite}/${name}`);
  const png = fs.readFileSync(path.join(OUT, 'assets', skins[c.skin].file));
  return { src: `data:image/png;base64,${png.toString('base64')}`, w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

// The title art: the game's name over the red fighter's head and shoulders.
const title = costume('tinmanfish fighting game', 'costume1');
// The red fighter's head in the title art, in its pixels.
const HEAD = { x: 122, y: 266, size: 440 };

function page(w: number, h: number, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:transparent"><div style="position:relative;width:${w}px;height:${h}px;overflow:hidden">${body}</div></body></html>`;
}

/** The fighter's head on a white rounded square, so its black outline shows on dark tab bars. */
function icon(size: number): string {
  const inner = size * 0.9;
  const s = inner / HEAD.size;
  const pad = (size - inner) / 2;
  return page(
    size,
    size,
    `<div style="position:absolute;inset:0;background:#fff;border-radius:${size * 0.18}px"></div>` +
      `<div style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px;overflow:hidden">` +
      `<img src="${title.src}" style="position:absolute;left:${-HEAD.x * s}px;top:${-HEAD.y * s}px;width:${title.w * s}px;height:${title.h * s}px"></div>`,
  );
}

// The whole title art centered on white.
const PREVIEW_H = 590;
const previewW = (title.w * PREVIEW_H) / title.h;
const preview = page(
  1200,
  630,
  `<div style="position:absolute;inset:0;background:#fff"></div>` +
    `<img src="${title.src}" style="position:absolute;left:${(1200 - previewW) / 2}px;top:${(630 - PREVIEW_H) / 2}px;width:${previewW}px;height:${PREVIEW_H}px">`,
);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const tab = await browser.newPage();
const jobs: [string, number, number, string, boolean][] = [
  ['favicon.png', 64, 64, icon(64), true],
  ['apple-touch-icon.png', 180, 180, icon(180), true],
  ['preview.png', 1200, 630, preview, false],
];
for (const [file, w, h, html, transparent] of jobs) {
  await tab.setViewportSize({ width: w, height: h });
  await tab.setContent(html);
  await tab.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await tab.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
  console.log(`wrote public/${file} (${w}x${h})`);
}
await browser.close();
