import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { createAppIconResolver } = require("../src/main/app-icon-resolver.cjs");

function fakeNativeImage(bytes = Buffer.from("icon")) {
  return {
    isEmpty: () => false,
    resizeCalls: [],
    resize(options) {
      this.resizeCalls.push(options);
      return { toPNG: () => bytes };
    }
  };
}

test("app icon resolver returns a cached bounded PNG data URL for an installed bundle", async () => {
  const image = fakeNativeImage();
  const lookups = [];
  const iconReads = [];
  const resolveAppIcon = createAppIconResolver({
    locateApplication: async (bundleId) => {
      lookups.push(bundleId);
      return "/System/Applications/Music.app";
    },
    pathExists: (appPath) => appPath === "/System/Applications/Music.app",
    getFileIcon: async (appPath) => {
      iconReads.push(appPath);
      return image;
    }
  });

  const first = await resolveAppIcon("com.apple.Music");
  const second = await resolveAppIcon("com.apple.Music");

  assert.equal(first, `data:image/png;base64,${Buffer.from("icon").toString("base64")}`);
  assert.equal(second, first);
  assert.deepEqual(lookups, ["com.apple.Music"]);
  assert.deepEqual(iconReads, ["/System/Applications/Music.app"]);
  assert.deepEqual(image.resizeCalls, [{ width: 64, height: 64, quality: "best" }]);
});

test("app icon resolver prefers the icon declared by the application bundle", async () => {
  const fallbackReads = [];
  const convertedPaths = [];
  const resolveAppIcon = createAppIconResolver({
    locateApplication: async () => "/Applications/NeteaseMusic.app",
    pathExists: (candidate) => new Set([
      "/Applications/NeteaseMusic.app",
      "/Applications/NeteaseMusic.app/Contents/Resources/163Music.icns"
    ]).has(candidate),
    readDeclaredIconName: async () => "163Music",
    readDeclaredIcon: async (iconPath) => {
      convertedPaths.push(iconPath);
      return Buffer.from("declared-icon");
    },
    getFileIcon: async (appPath) => {
      fallbackReads.push(appPath);
      return fakeNativeImage(Buffer.from("generic-icon"));
    }
  });

  const icon = await resolveAppIcon("com.netease.163music");

  assert.equal(icon, `data:image/png;base64,${Buffer.from("declared-icon").toString("base64")}`);
  assert.deepEqual(convertedPaths, ["/Applications/NeteaseMusic.app/Contents/Resources/163Music.icns"]);
  assert.deepEqual(fallbackReads, []);
});

test("app icon resolver rejects invalid identifiers and non-application paths", async () => {
  let lookups = 0;
  const resolveInvalid = createAppIconResolver({
    locateApplication: async () => { lookups += 1; return "/tmp/not-an-app"; },
    pathExists: () => true,
    getFileIcon: async () => fakeNativeImage()
  });

  assert.equal(await resolveInvalid("../../Music"), "");
  assert.equal(lookups, 0);
  assert.equal(await resolveInvalid("com.example.player"), "");
  assert.equal(lookups, 1);
});

test("app icon resolver fails closed for missing, empty, and oversized icons", async () => {
  const cases = [
    createAppIconResolver({
      locateApplication: async () => "",
      pathExists: () => false,
      getFileIcon: async () => fakeNativeImage()
    }),
    createAppIconResolver({
      locateApplication: async () => "/Applications/Player.app",
      pathExists: () => true,
      getFileIcon: async () => ({ isEmpty: () => true })
    }),
    createAppIconResolver({
      locateApplication: async () => "/Applications/Player.app",
      pathExists: () => true,
      getFileIcon: async () => fakeNativeImage(Buffer.alloc(64)),
      maxDataUrlLength: 32
    })
  ];

  for (const resolveAppIcon of cases) assert.equal(await resolveAppIcon("com.example.player"), "");
});
