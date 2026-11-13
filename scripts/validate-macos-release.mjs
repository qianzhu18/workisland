import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

// Validate the *combined* matrix output, never publish a partially built release.
export async function validateMacosRelease(directory, tag, remoteRelease = null) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error("Invalid release tag");
  const version = tag.slice(1);
  const dmgs = ["arm64", "x64"].map((arch) => `WorkIsland-${version}-${arch}.dmg`);
  const expectedNames = [...dmgs, "SHA256SUMS.txt", "SHA256SUMS-x64.txt"].sort();
  const entries = await readdir(directory, { withFileTypes: true });
  const actualNames = entries.map((entry) => entry.name).sort();
  if (entries.some((entry) => !entry.isFile()) || JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Expected exactly both architecture DMGs and checksum manifests: ${expectedNames.join(", ")}`);
  }
  const hashes = new Map();
  for (const name of dmgs) {
    if ((await stat(path.join(directory, name))).size === 0) throw new Error(`Empty release asset: ${name}`);
    hashes.set(name, await sha256(path.join(directory, name)));
  }
  for (const [manifest, requiredName] of [["SHA256SUMS.txt", dmgs[0]], ["SHA256SUMS-x64.txt", dmgs[1]]]) {
    const seen = new Set();
    const text = await readFile(path.join(directory, manifest), "utf8");
    for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
      const match = line.match(/^([a-fA-F0-9]{64})\s+\*?([^/\\]+)$/);
      if (!match || !hashes.has(match[2]) || seen.has(match[2])) throw new Error(`Invalid checksum entry in ${manifest}`);
      if (hashes.get(match[2]) !== match[1].toLowerCase()) throw new Error(`Checksum mismatch in ${manifest}: ${match[2]}`);
      seen.add(match[2]);
    }
    if (!seen.has(requiredName)) throw new Error(`Missing ${requiredName} checksum in ${manifest}`);
  }
  if (remoteRelease) {
    if (remoteRelease.tagName !== tag || remoteRelease.isDraft !== true) throw new Error("Release must remain a draft for this tag until validation completes");
    const assets = remoteRelease.assets;
    if (!Array.isArray(assets) || JSON.stringify(assets.map((asset) => asset.name).sort()) !== JSON.stringify(expectedNames)) {
      throw new Error("Draft release is missing assets or contains unexpected assets");
    }
    for (const asset of assets) {
      if (asset.size !== (await stat(path.join(directory, asset.name))).size) throw new Error(`Uploaded asset size mismatch: ${asset.name}`);
    }
  }
  return expectedNames;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, tag, remotePath] = process.argv.slice(2);
  if (!directory || !tag) throw new Error("Usage: node scripts/validate-macos-release.mjs <directory> <tag> [remote-release.json]");
  const remote = remotePath ? JSON.parse(await readFile(remotePath, "utf8")) : null;
  const names = await validateMacosRelease(directory, tag, remote);
  console.log(`Validated ${names.length} macOS release assets for ${tag}`);
}
