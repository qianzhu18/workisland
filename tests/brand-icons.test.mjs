import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

const settingsWorkIsland = new URL("../src/renderer/island/assets/workisland-icon.png", import.meta.url);
const codexIcon = new URL("../src/renderer/island/assets/brands/codex.png", import.meta.url);
const panelSource = readFileSync(new URL("../src/renderer/island/components/IslandPanel.js", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../src/renderer/island/components/IslandPanel.css", import.meta.url), "utf8");

function readPngMetadata(url) {
  assert.equal(existsSync(url), true, `${url.pathname} must exist`);
  const png = readFileSync(url);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25]
  };
}

function readAlphaValues(url) {
  const png = readFileSync(url);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const data = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows = [];
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[cursor++];
    const row = Buffer.from(data.subarray(cursor, cursor + stride));
    cursor += stride;
    const previous = rows[y - 1];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous?.[x] ?? 0;
      const upLeft = x >= 4 ? previous?.[x - 4] ?? 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distances = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        const predictor = distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : upLeft;
        row[x] = (row[x] + predictor) & 255;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
    }
    rows.push(row);
  }
  return rows.flatMap((row) => Array.from({ length: width }, (_, x) => row[x * 4 + 3]));
}

test("settings icon assets are compact square RGBA PNGs", () => {
  for (const url of [settingsWorkIsland, codexIcon]) {
    const metadata = readPngMetadata(url);
    assert.equal(metadata.width, metadata.height);
    assert.ok(metadata.width >= 128 && metadata.width <= 256);
    assert.equal(metadata.colorType, 6, "asset must carry a real alpha channel");
    const alpha = readAlphaValues(url);
    assert.equal(Math.min(...alpha), 0, "asset must include transparent pixels");
    assert.equal(Math.max(...alpha), 255, "asset must preserve opaque logo pixels");
  }
});

test("Island Codex quota marker uses the transparent Codex image", () => {
  assert.match(panelSource, /codexIcon/);
  assert.match(panelSource, /agent-monogram-image/);
  assert.match(panelSource, /tool === "codex"/);
  assert.match(panelCss, /\.agent-monogram-image/);
});
