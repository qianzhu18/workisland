import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}

function png(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(scanlines, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("sRGB", Buffer.from([0])),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function canvas(width, height) {
  const data = new Uint8Array(width * height * 4);
  const blend = (x, y, color, alpha = 1) => {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;
    const i = (y * width + x) * 4;
    const sourceAlpha = (color[3] ?? 255) / 255 * alpha;
    const destAlpha = data[i + 3] / 255;
    const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
    if (!outAlpha) return;
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round((color[channel] * sourceAlpha + data[i + channel] * destAlpha * (1 - sourceAlpha)) / outAlpha);
    data[i + 3] = Math.round(outAlpha * 255);
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    const edge = 1.25;
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const distance = Math.sqrt(((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2);
      blend(x, y, color, Math.max(0, Math.min(1, (1 - distance) * Math.min(rx, ry) / edge + 0.5)));
    }
  };
  const polygon = (points, color) => {
    const minY = Math.floor(Math.min(...points.map((p) => p[1]))), maxY = Math.ceil(Math.max(...points.map((p) => p[1])));
    for (let y = minY; y <= maxY; y++) {
      const intersections = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length; i += 2) for (let x = Math.ceil(intersections[i]); x < intersections[i + 1]; x++) blend(x, y, color);
    }
  };
  const roundedRect = (x, y, w, h, radius, color) => {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      const dx = Math.max(x + radius - px, 0, px - (x + w - radius));
      const dy = Math.max(y + radius - py, 0, py - (y + h - radius));
      if (dx * dx + dy * dy <= radius * radius) blend(px, py, color);
    }
  };
  return { data, blend, ellipse, polygon, roundedRect };
}

function savePng(path, width, height, draw) {
  const surface = canvas(width, height);
  draw(surface);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(width, height, surface.data));
}

function drawOrca(surface, cx, cy, scale, pose = {}) {
  const { ellipse, polygon } = surface;
  const navy = [11, 22, 38, 255], white = [246, 250, 252, 255], cyan = [45, 210, 202, 255], coral = [255, 111, 97, 255];
  const bob = pose.bob ?? 0, tilt = pose.tilt ?? 0;
  cy += bob;
  polygon([[cx - 43 * scale, cy], [cx - 69 * scale, cy - 19 * scale], [cx - 61 * scale, cy + 8 * scale]], navy);
  polygon([[cx - 43 * scale, cy], [cx - 67 * scale, cy + 25 * scale], [cx - 61 * scale, cy - 5 * scale]], navy);
  ellipse(cx, cy, 48 * scale, 31 * scale, navy);
  polygon([[cx - 4 * scale, cy - 24 * scale], [cx + 8 * scale, cy - 49 * scale], [cx + 17 * scale, cy - 21 * scale]], navy);
  polygon([[cx + 2 * scale, cy + 20 * scale], [cx - 8 * scale, cy + 39 * scale], [cx + 20 * scale, cy + 23 * scale]], navy);
  ellipse(cx + 17 * scale, cy + 11 * scale, 28 * scale, 15 * scale, white);
  ellipse(cx + 28 * scale, cy - 7 * scale + tilt, 10 * scale, 7 * scale, white);
  ellipse(cx + 30 * scale, cy - 7 * scale + tilt, 3.5 * scale, 3.5 * scale, navy);
  ellipse(cx + 45 * scale, cy + 1 * scale, 3 * scale, 2 * scale, cyan);
  if (pose.alert) polygon([[cx + 41 * scale, cy - 23 * scale], [cx + 48 * scale, cy - 34 * scale], [cx + 52 * scale, cy - 20 * scale]], coral);
}

// 应用图标由设计师提供的 logo 生成（resources/icon.png + icon.icns），
// 不再由代码绘制覆盖。如需重新生成，删除 resources/icon.* 后运行
// GENERATE_ICON=1 npm run build:assets。
const GENERATE_ICON = process.env.GENERATE_ICON === "1";
if (GENERATE_ICON) {
savePng(join(root, "resources/icon.png"), 1024, 1024, (s) => {
  const { roundedRect, ellipse } = s;
  roundedRect(64, 64, 896, 896, 210, [13, 18, 28, 255]);
  ellipse(780, 210, 120, 120, [255, 111, 97, 255]);
  ellipse(760, 190, 120, 120, [13, 18, 28, 255]);
  drawOrca(s, 520, 535, 6.4);
});
}

if (process.platform === "darwin" && GENERATE_ICON) {
  const iconDir = mkdtempSync(join(tmpdir(), "orca-icon-"));
  const source = join(root, "resources", "icon.png");
  const parts = [];
  for (const [type, size] of [
    ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128],
    ["ic08", 256], ["ic09", 512], ["ic10", 1024]
  ]) {
    const resized = join(iconDir, `${size}.png`);
    execFileSync("sips", ["-z", String(size), String(size), source, "--out", resized], { stdio: "ignore" });
    const image = readFileSync(resized);
    const part = Buffer.alloc(8 + image.length);
    part.write(type, 0, 4, "ascii");
    part.writeUInt32BE(part.length, 4);
    image.copy(part, 8);
    parts.push(part);
  }
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4);
  writeFileSync(join(root, "resources", "icon.icns"), Buffer.concat([header, ...parts]));
  rmSync(iconDir, { recursive: true, force: true });
}

const frame = 128, columns = 8, rows = 7;
savePng(join(root, "resources/pet-sprites/orca.png"), frame * columns, frame * rows, (s) => {
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const phase = col / columns * Math.PI * 2;
    drawOrca(s, col * frame + 66, row * frame + 67, 0.78, {
      bob: Math.sin(phase) * (row === 2 ? 2 : 4),
      tilt: Math.sin(phase) * 2,
      alert: row === 4
    });
  }
});
copyFileSync(join(root, "resources/pet-sprites/orca.png"), join(root, "src/renderer/pet/orca.png"));

for (const [name, colors, size] of [
  ["fire-low.png", [[45, 210, 202, 255], [235, 250, 247, 255]], 0.72],
  ["fire-middle.png", [[255, 194, 71, 255], [255, 247, 201, 255]], 0.86],
  ["fire-high.png", [[255, 111, 97, 255], [255, 220, 117, 255]], 1]
]) savePng(join(root, "src/renderer/shared", name), 256, 256, (s) => {
  s.ellipse(128, 150, 68 * size, 82 * size, colors[0]);
  s.polygon([[128, 24], [81, 142], [135, 118], [177, 45], [175, 174]], colors[0]);
  s.ellipse(128, 171, 32 * size, 43 * size, colors[1]);
});

function wav(path, notes) {
  const rate = 44100, duration = notes.reduce((sum, note) => Math.max(sum, note.start + note.duration), 0) + 0.08;
  const samples = new Int16Array(Math.ceil(rate * duration));
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate; let value = 0;
    for (const note of notes) if (t >= note.start && t < note.start + note.duration) {
      const local = t - note.start, envelope = Math.min(1, local / 0.015) * Math.exp(-4 * local / note.duration);
      value += Math.sin(2 * Math.PI * note.frequency * local) * envelope * (note.gain ?? 0.35);
    }
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(value * 32767)));
  }
  const out = Buffer.alloc(44 + samples.byteLength);
  out.write("RIFF"); out.writeUInt32LE(36 + samples.byteLength, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(samples.byteLength, 40);
  Buffer.from(samples.buffer).copy(out, 44); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, out);
}

const sounds = {
  app_launch: [[523.25, 0], [659.25, 0.09], [783.99, 0.18]],
  session_start: [[392, 0], [523.25, 0.11]],
  task_complete: [[523.25, 0], [659.25, 0.09], [880, 0.18]],
  task_error: [[311.13, 0], [233.08, 0.13]],
  approval_needed: [[659.25, 0], [659.25, 0.18]]
};
for (const [name, tones] of Object.entries(sounds)) wav(join(root, "resources/sounds", `${name}.wav`), tones.map(([frequency, start]) => ({ frequency, start, duration: 0.25 })));

console.log("Generated WorkIsland assets (icon preserved from logo, pet sprite, usage indicators, sounds).");
