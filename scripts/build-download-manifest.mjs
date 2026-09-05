import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/build-download-manifest.mjs --tag vX.Y.Z --source <release-dir> --public-base <https-url> --output <latest.json> [--published-at <ISO-8601>]");
  process.exit(1);
}

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) usage(`Invalid argument near ${key || "end of command"}.`);
    args[key.slice(2)] = value;
  }
  return args;
}

function httpsBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not HTTPS");
    return url.toString().replace(/\/$/, "");
  } catch {
    usage("--public-base must be an HTTPS URL.");
  }
}

function classifyAsset(name) {
  if (/\.dmg$/i.test(name)) {
    return { platform: "macos", arch: /arm64/i.test(name) ? "arm64" : /x64|intel/i.test(name) ? "x64" : "unknown" };
  }
  if (/\.exe$/i.test(name)) return { platform: "windows", arch: /arm64/i.test(name) ? "arm64" : "x64" };
  return null;
}

const args = readArgs(process.argv.slice(2));
if (!args.tag || !args.source || !args["public-base"] || !args.output) usage();
if (!/^v[0-9]/.test(args.tag)) usage("--tag must begin with v, for example v1.3.0.");

const publicBase = httpsBase(args["public-base"]);
const sourceDir = path.resolve(args.source);
const outputPath = path.resolve(args.output);
const publishedAt = args["published-at"] || new Date().toISOString();
if (Number.isNaN(Date.parse(publishedAt))) usage("--published-at must be an ISO-8601 timestamp.");

const entries = await readdir(sourceDir, { withFileTypes: true });
const assets = [];
for (const entry of entries) {
  if (!entry.isFile()) continue;
  const classification = classifyAsset(entry.name);
  if (!classification) continue;
  const content = await readFile(path.join(sourceDir, entry.name));
  assets.push({
    name: entry.name,
    ...classification,
    sizeBytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
    url: `${publicBase}/releases/${encodeURIComponent(args.tag)}/${encodeURIComponent(entry.name)}`
  });
}

if (!assets.some((asset) => asset.platform === "macos" && asset.arch === "arm64")) {
  usage("Source directory must contain an arm64 macOS DMG.");
}

assets.sort((left, right) => left.name.localeCompare(right.name));
const manifest = {
  schemaVersion: 1,
  version: args.tag,
  publishedAt: new Date(publishedAt).toISOString(),
  source: "qianzhu18/workisland",
  fallbackUrl: `https://github.com/qianzhu18/workisland/releases/tag/${encodeURIComponent(args.tag)}`,
  assets
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${assets.length} mirrored asset entries to ${outputPath}`);
