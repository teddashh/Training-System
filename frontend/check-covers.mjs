// Offline catalogue/artwork contract. Run after either cover generator.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {scenes, legacyCatalogue, translations} from './cover-art/catalogue.mjs';
import {families, accents, scenePalette, composition} from './cover-art/drawing.mjs';
import {pathToFileURL} from 'node:url';

// Optional offline pixel checks use the caller's installed rasteriser, never a
// downloaded package. The default run remains dependency-free.
const Resvg = process.env.COVER_RASTERIZER
  ? (await import(pathToFileURL(process.env.COVER_RASTERIZER).href)).Resvg : null;
assert.deepEqual(composition.subject, [540, 100, 1060, 400]);
assert.deepEqual(composition.recognition, [680, 150, 1050, 370]);
assert.deepEqual(composition.card, [131, 0, 1069, 600]);
assert.deepEqual(composition.strip, [0, 150, 1200, 450]);
assert.ok(composition.floor >= 395 && composition.floor <= 410);
assert.ok(scenes.filter((_, i) => families[i % families.length] === '#A97D4E').length <= 12);
const coverage = [];

const catalog = JSON.parse(fs.readFileSync(new URL('../shared/brand/covers.json', import.meta.url)));
const messages = JSON.parse(fs.readFileSync(new URL('../shared/locales/messages.json', import.meta.url)));
assert.deepEqual(catalog, [...scenes, ...legacyCatalogue()]);
assert.equal(new Set(catalog.map(c => c.id)).size, 166);
assert.equal(new Set(scenes.map(c => c.category)).size, 11);
for (const category of new Set(scenes.map(c => c.category))) {
  assert.equal(scenes.filter(c => c.category === category).length, 6, category);
}
for (const [key, values] of Object.entries(translations)) {
  assert.deepEqual(messages[key], values, `Translation: ${key}`);
}
const sizes = [];
for (const [index, scene] of scenes.entries()) {
  const svg = fs.readFileSync(new URL(`./public/covers/${scene.id}.svg`, import.meta.url), 'utf8');
  const base = families[index % families.length];
  const accent = accents[(index + Math.floor(index / 6)) % accents.length];
  const p = scenePalette(base, accent);
  const palette = new Set(Object.values(p));
  const root = svg.match(/^<svg\b[^>]*>/)?.[0] || '';
  assert.match(root, /viewBox="0 0 1200 600"/);
  assert.match(root, /role="img"/);
  assert.doesNotMatch(root, /\b(?:width|height)=/);
  assert.ok(svg.includes(`<title>${scene.title}</title>`), scene.id);
  assert.doesNotMatch(svg, /<(?:text|style|script|image|use|pattern|mask|filter|linearGradient|radialGradient|foreignObject)\b/i);
  assert.doesNotMatch(svg, /\b(?:href|opacity|on\w+)=|url\(/i);
  assert.doesNotMatch(svg, /-?\d+\.\d{2,}/);
  const colors = [...svg.matchAll(/#[a-fA-F0-9]{6}/g)].map(m => m[0]);
  assert.ok(colors.includes(p.cool) && colors.includes(p.warm), `Missing cool/warm accent: ${scene.id}`);
  assert.ok(['#52BEC7', '#3B9D8E'].includes(p.cool));
  assert.ok(['#A91264', '#A97D4E'].includes(p.warm));
  // Fixed stage and background bands protect the measured crop geometry. Pixel
  // occupancy is a guard against empty crops, not a substitute for visual review.
  assert.ok(svg.includes(`<rect x="0" y="${composition.floor}" width="1200"`));
  for (const y of [120, 225, 315]) assert.ok(svg.includes(`<rect x="0" y="${y}" width="1200"`));
  assert.ok(svg.includes('<g data-layer="subject" transform="translate(0 -95) scale(1 1.1)">'));
  assert.ok(svg.includes('<g data-layer="foreground">'));
  if (Resvg) {
    const start = svg.indexOf('<g data-layer="subject"');
    const end = svg.indexOf('<g data-layer="foreground"');
    const isolated = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">${svg.slice(start, end)}</svg>`;
    const pixels = new Resvg(isolated).render().pixels;
    const accentRGB = [p.cool, p.warm].map(c => c.slice(1).match(/../g).map(h => parseInt(h, 16)).join(','));
    let subject = 0, core = 0, coloured = 0;
    for (let y = composition.subject[1]; y <= composition.subject[3]; y++) {
      for (let x = composition.subject[0]; x <= composition.subject[2]; x++) {
        const at = (y * 1200 + x) * 4;
        if (pixels[at + 3] < 128) continue;
        subject++;
        const [left, top, right, bottom] = composition.recognition;
        if (x >= left && x <= right && y >= top && y <= bottom) core++;
        if (accentRGB.includes([pixels[at], pixels[at + 1], pixels[at + 2]].join(','))) coloured++;
      }
    }
    const proportion = coloured / subject;
    assert.ok(core >= 15000, `Empty recognition crop: ${scene.id} (${core} pixels)`);
    // Half a percent accommodates antialiased edges on narrow coloured strokes.
    assert.ok(proportion >= .195 && proportion <= .338, `Accent area: ${scene.id} (${(proportion * 100).toFixed(1)}%)`);
    coverage.push(proportion);
  }
  assert.ok(colors.every(c => palette.has(c)), `Palette: ${scene.id}`);
  assert.ok([...svg.matchAll(/stroke-width="([\d.]+)"/g)].every(m => Number(m[1]) >= 3));
  assert.ok(scene.keywords.some(k => /[\u3400-\u9fff]/.test(k)), `Chinese keywords: ${scene.id}`);
  assert.ok(scene.keywords.every(k => k === k.toLowerCase() && k.trim() === k));
  sizes.push(Buffer.byteLength(svg));
  assert.ok(sizes.at(-1) <= 30_000, `File size: ${scene.id}`);
}
console.log(`66 scenes, 11 themes, 100 legacy entries: catalogue, locales, SVG restrictions, palette and sizes pass (${Math.min(...sizes)}–${Math.max(...sizes)} bytes).`);

if (coverage.length) console.log(`Raster check: all 66 cores visible; accent area ${(Math.min(...coverage) * 100).toFixed(1)}–${(Math.max(...coverage) * 100).toFixed(1)}%. Visual recognition still requires contact-sheet review.`);
