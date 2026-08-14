import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareVersions, createUpdateService } = require("../src/main/update-service.cjs");

function makeApp(version, isPackaged = true) {
  return { isPackaged, getVersion: () => version };
}

test("version comparison treats stable releases as newer than prereleases", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
});

test("update service reports and notifies about a newer stable release once", async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "workisland-update-"));
  const shown = [];
  const opened = [];
  const available = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    on(event, handler) { if (event === "click") this.click = handler; }
    show() { shown.push(this); }
  }
  const service = createUpdateService({
    app: makeApp("0.2.0"),
    shell: { openExternal: (url) => opened.push(url) },
    notificationClass: FakeNotification,
    userDataPath,
    onUpdateAvailable: (update) => available.push(update),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.3.0",
        name: "WorkIsland 0.3.0",
        html_url: "https://github.com/qianzhu18/workisland/releases/tag/v0.3.0",
        prerelease: false
      })
    }),
    logger: { warn() {} }
  });

  const first = await service.check({ force: true });
  assert.equal(first.status, "update-available");
  assert.equal(first.latestVersion, "0.3.0");
  assert.equal(available.length, 1);
  assert.equal(shown.length, 1);
  shown[0].click();
  assert.deepEqual(opened, [first.releaseUrl]);

  await service.check({ force: true });
  assert.equal(shown.length, 1);
});

test("development builds never contact the release endpoint", async () => {
  let fetchCount = 0;
  const service = createUpdateService({
    app: makeApp("0.2.0", false),
    userDataPath: mkdtempSync(join(tmpdir(), "workisland-update-dev-")),
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ tag_name: "v9.0.0" }) };
    }
  });
  const result = await service.check({ force: true });
  assert.equal(result.status, "disabled");
  assert.equal(fetchCount, 0);
});
