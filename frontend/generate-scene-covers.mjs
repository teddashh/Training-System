// Run: node frontend/generate-scene-covers.mjs (no dependencies or network).
// To add a scene: add its ID/keywords/translations in cover-art/catalogue.mjs,
// a recipe in cover-art/scenes.mjs, and the translation keys in messages.json.
// Reuse cover-art/drawing.mjs primitives; inspect full/card/strip previews in /tmp.
// Run check-covers.mjs afterwards (adjust its expected counts when extending the library).
import fs from 'node:fs';
import {drawing, families, accents} from './cover-art/drawing.mjs';
import {scenes, writeCatalogue} from './cover-art/catalogue.mjs';
import {renderScene} from './cover-art/scenes.mjs';
const out = new URL('./public/covers/', import.meta.url);
fs.mkdirSync(out, {recursive:true});
for (const [index, scene] of scenes.entries()) {
  const d = drawing(families[index % families.length], accents[(index + Math.floor(index / 6)) % accents.length]);
  // One decimal maximum, including coordinates computed for circular details.
  const body = renderScene(scene.id, d).replace(/-?\d+\.\d+/g, n => String(Math.round(Number(n) * 10) / 10));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600" role="img"><title>${scene.title}</title>${body}</svg>\n`;
  if (Buffer.byteLength(svg) > 30_000) throw new Error(`Scene too large: ${scene.id}`);
  fs.writeFileSync(new URL(`${scene.id}.svg`, out), svg);
}
writeCatalogue();
console.log(`Generated ${scenes.length} illustrated scenes; preserved all legacy assets.`);
