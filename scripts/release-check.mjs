import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const tagArgIndex = process.argv.indexOf("--tag");
const tag = tagArgIndex >= 0
  ? process.argv[tagArgIndex + 1]
  : process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "") || "";
const normalizedTag = String(tag).replace(/^refs\/tags\//, "");
const expectedTag = `v${packageJson.version}`;
const requiredFiles = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"];
const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

if (missing.length > 0) {
  console.error(`Release metadata is incomplete. Missing: ${missing.join(", ")}`);
  process.exit(1);
}

if (packageJson.license !== "Apache-2.0" || packageLock.packages?.[""]?.license !== "Apache-2.0") {
  console.error("package.json and package-lock.json must declare Apache-2.0.");
  process.exit(1);
}

const bundledFiles = new Set(packageJson.build?.files || []);
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  if (!bundledFiles.has(file)) {
    console.error(`electron-builder must include ${file} in build.files.`);
    process.exit(1);
  }
}

if (normalizedTag && normalizedTag !== expectedTag) {
  console.error(`Release tag ${normalizedTag} does not match package.json version ${packageJson.version}. Expected ${expectedTag}.`);
  process.exit(1);
}

const channel = packageJson.version.includes("-") ? "prerelease" : "stable";
console.log(`Release metadata OK: ${packageJson.productName} ${packageJson.version} (${channel})`);
if (normalizedTag) console.log(`Release tag OK: ${normalizedTag}`);
