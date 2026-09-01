import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preloadSourceRoot = join(root, "src", "preload");
const rendererEntries = [
  "renderer/island/app.js",
  "renderer/island/session-model.mjs",
  "renderer/island/theme.mjs",
  "renderer/island/components/IslandPanel.js",
  "renderer/island/components/IslandPill.js",
  "renderer/pet/app.js",
  "renderer/pet/model.mjs",
  "renderer/pet/panel-app.js"
];
const preloadFiles = [
  "debug.js",
  "island.js",
  "pet-panel.js",
  "pet.js",
  "settings.js",
  "welcome.js"
];

for (const file of preloadFiles) readFileSync(join(preloadSourceRoot, file));
for (const file of rendererEntries) readFileSync(join(root, "src", file));

console.log("Runtime prepared from src: preloads + island/pet entries + authored settings app.");
