import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateMacosRelease } from "../scripts/validate-macos-release.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workisland-release-validation-"));
  // Only remove the known temporary fixture directory created immediately above.
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = [];
  for (const arch of ["arm64", "x64"]) {
    const name = `WorkIsland-1.6.4-${arch}.dmg`;
    const content = Buffer.from(`test dmg ${arch}`);
    await writeFile(path.join(directory, name), content);
    const digest = createHash("sha256").update(content).digest("hex");
    await writeFile(path.join(directory, arch === "arm64" ? "SHA256SUMS.txt" : "SHA256SUMS-x64.txt"), `${digest}  ${name}\n`);
    names.push(name);
  }
  return { directory, names };
}

test("combined release requires both architectures and valid checksums", async (t) => {
  const { directory } = await fixture(t);
  assert.equal((await validateMacosRelease(directory, "v1.6.4")).length, 4);
  await assert.rejects(validateMacosRelease(directory, "v1.6.5"), /Expected exactly/);
  await writeFile(path.join(directory, "SHA256SUMS-x64.txt"), `${"0".repeat(64)}  WorkIsland-1.6.4-x64.dmg\n`);
  await assert.rejects(validateMacosRelease(directory, "v1.6.4"), /Checksum mismatch/);
});

test("partial matrix artifacts and uncovered checksums cannot publish", async (t) => {
  const { directory, names } = await fixture(t);
  await writeFile(path.join(directory, "SHA256SUMS.txt"), "");
  await assert.rejects(validateMacosRelease(directory, "v1.6.4"), /Missing.*checksum/);
  await rm(path.join(directory, names[1]));
  await assert.rejects(validateMacosRelease(directory, "v1.6.4"), /Expected exactly/);
});

test("uploaded release must still be draft with exactly the validated asset sizes", async (t) => {
  const { directory } = await fixture(t);
  const names = await validateMacosRelease(directory, "v1.6.4");
  const assets = await Promise.all(names.map(async (name) => ({ name, size: (await stat(path.join(directory, name))).size })));
  const remote = { tagName: "v1.6.4", isDraft: true, assets };
  await validateMacosRelease(directory, "v1.6.4", remote);
  await assert.rejects(validateMacosRelease(directory, "v1.6.4", { ...remote, isDraft: false }), /remain a draft/);
  await assert.rejects(validateMacosRelease(directory, "v1.6.4", { ...remote, assets: assets.slice(1) }), /missing assets/);
  await assert.rejects(validateMacosRelease(directory, "v1.6.4", { ...remote, assets: assets.map((asset) => ({ ...asset, size: 1 })) }), /size mismatch/);
});

test("macOS matrix only uploads artifacts and one dependent job publishes a validated draft", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const build = workflow.slice(workflow.indexOf("  macos:"), workflow.indexOf("  publish-macos:"));
  const publish = workflow.slice(workflow.indexOf("  publish-macos:"), workflow.indexOf("  windows-x64-alpha:"));
  assert.match(build, /arch: \[arm64, x64\]/);
  assert.match(build, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(build, /action-gh-release|gh release (?:create|upload|edit)/);
  assert.match(publish, /needs: macos/);
  assert.match(publish, /actions\/download-artifact@v4/);
  assert.match(publish, /pattern: WorkIsland-macOS-\*/);
  assert.match(publish, /--verify-tag --draft --generate-notes/);
  assert.match(publish, /Refusing to overwrite an already-published release/);
  assert.equal((publish.match(/--draft=false/g) || []).length, 1);
  assert.ok(publish.indexOf('validate-macos-release.mjs release "$RELEASE_TAG" "$RUNNER_TEMP/macos-draft.json"') < publish.indexOf("--draft=false"));
});
