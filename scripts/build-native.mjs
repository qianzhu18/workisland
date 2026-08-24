import { createHash } from "node:crypto";
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// URL.pathname leaves spaces percent-encoded (e.g. "qianzhu%20Vault"),
// which makes clang unable to find the native source on this workspace path.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.platform !== "darwin") {
  console.log("Native panel module is macOS-only; skipping build.");
  process.exit(0);
}
const outDir = join(root, "resources/bin");
mkdirSync(outDir, { recursive: true });
const nodeInclude = join(process.execPath, "..", "..", "include", "node");
const require = createRequire(import.meta.url);
const electronInclude = join(require.resolve("electron"), "..", "..", "headers");
const include = existsSync(join(electronInclude, "include/node/node_api.h"))
  ? join(electronInclude, "include/node") : nodeInclude;
const buildDir = join(root, ".native-build");
mkdirSync(buildDir, { recursive: true });
const args = ["-std=c++17", "-fobjc-arc", "-dynamiclib", "-undefined", "dynamic_lookup",
  "-I", include, "-framework", "AppKit", "-framework", "CoreGraphics", "-framework", "Foundation",
  join(root, "native/panel-fix/src/panel_fix.mm"), "-o", join(buildDir, "panel_fix.node")];
execFileSync("clang++", args, { stdio: "inherit" });
copyFileSync(join(buildDir, "panel_fix.node"), join(outDir, "panel_fix.node"));
console.log(`Built ${join(outDir, "panel_fix.node")}`);

const adapterVersion = "v0.7.6";
const adapterSha256 = "0891554af8ee8fc1bb1d14ddf023f8e4ce3093387391122c865f7e02c2d1f3de";
const adapterArchive = join(buildDir, `mediaremote-adapter-${adapterVersion}.tar.gz`);
const adapterSource = join(buildDir, "mediaremote-adapter-0.7.6");
const adapterOutput = join(root, "resources/mediaremote-adapter");
const framework = join(adapterOutput, "MediaRemoteAdapter.framework");
const frameworkVersion = join(framework, "Versions/A");

if (!existsSync(adapterSource)) {
  execFileSync("curl", ["-L", "--fail", "--silent", "--show-error",
    `https://codeload.github.com/ungive/mediaremote-adapter/tar.gz/refs/tags/${adapterVersion}`,
    "-o", adapterArchive], { stdio: "inherit" });
  const actualSha = createHash("sha256").update(readFileSync(adapterArchive)).digest("hex");
  if (actualSha !== adapterSha256) throw new Error(`MediaRemote Adapter checksum mismatch: ${actualSha}`);
  execFileSync("tar", ["-xzf", adapterArchive, "-C", buildDir], { stdio: "inherit" });
}

rmSync(adapterOutput, { recursive: true, force: true });
mkdirSync(join(frameworkVersion, "Headers"), { recursive: true });
mkdirSync(join(frameworkVersion, "Resources"), { recursive: true });
const sourceDirs = ["src/adapter", "src/private", "src/utility"];
const adapterSources = sourceDirs.flatMap((directory) => readdirSync(join(adapterSource, directory))
  .filter((name) => name.endsWith(".m")).map((name) => join(adapterSource, directory, name)));
execFileSync("clang", ["-fobjc-arc", "-fvisibility=default", "-dynamiclib", "-arch", process.arch === "arm64" ? "arm64" : "x86_64",
  "-I", join(adapterSource, "include"), "-I", join(adapterSource, "src"),
  "-framework", "Foundation", "-framework", "AppKit", "-framework", "UniformTypeIdentifiers",
  ...adapterSources, "-install_name", "@rpath/MediaRemoteAdapter.framework/Versions/A/MediaRemoteAdapter",
  "-o", join(frameworkVersion, "MediaRemoteAdapter")], { stdio: "inherit" });
copyFileSync(join(adapterSource, "include/MediaRemoteAdapter.h"), join(frameworkVersion, "Headers/MediaRemoteAdapter.h"));
writeFileSync(join(frameworkVersion, "Resources/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>MediaRemoteAdapter</string>
<key>CFBundleIdentifier</key><string>com.vandenbe.MediaRemoteAdapter</string>
<key>CFBundleName</key><string>MediaRemoteAdapter</string>
<key>CFBundlePackageType</key><string>FMWK</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>CFBundleVersion</key><string>0.1.0</string>
</dict></plist>\n`);
symlinkSync("A", join(framework, "Versions/Current"));
symlinkSync("Versions/Current/MediaRemoteAdapter", join(framework, "MediaRemoteAdapter"));
symlinkSync("Versions/Current/Headers", join(framework, "Headers"));
symlinkSync("Versions/Current/Resources", join(framework, "Resources"));
execFileSync("codesign", ["--force", "--deep", "--sign", "-", framework], { stdio: "inherit" });
copyFileSync(join(adapterSource, "bin/mediaremote-adapter.pl"), join(adapterOutput, "mediaremote-adapter.pl"));
copyFileSync(join(adapterSource, "LICENSE"), join(adapterOutput, "LICENSE"));
console.log(`Built ${framework} from MediaRemote Adapter ${adapterVersion}`);
