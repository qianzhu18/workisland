import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { buildBarkUrl, pushBarkNotification } from "../src/main/bark-push.cjs";

test("buildBarkUrl appends encoded title, body and group", () => {
  const url = buildBarkUrl({ url: "https://api.day.app/abc/" }, "approval", "claude");
  assert.ok(url.startsWith("https://api.day.app/abc/"), "should keep the configured base");
  assert.ok(url.includes(encodeURIComponent("等待审批")), "title should be URL-encoded");
  assert.ok(url.includes("group=WorkIsland"), "group tag should be appended");
});

test("buildBarkUrl returns empty without a configured endpoint", () => {
  assert.equal(buildBarkUrl({ url: "" }, "approval"), "");
  assert.equal(buildBarkUrl(undefined, "approval"), "");
});

test("pushBarkNotification skips disabled and non-whitelisted events", async () => {
  const disabled = { barkPush: { enabled: false, url: "https://api.day.app/x", events: { approval: true } } };
  assert.equal(await pushBarkNotification(disabled, "approval"), false);
  const missingEvent = { barkPush: { enabled: true, url: "https://api.day.app/x", events: { approval: true } } };
  assert.equal(await pushBarkNotification(missingEvent, "appLaunch"), false);
  const missingUrl = { barkPush: { enabled: true, url: "", events: { approval: true } } };
  assert.equal(await pushBarkNotification(missingUrl, "approval"), false);
});

test("pushBarkNotification hits the configured endpoint", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    res.end('{"code":200}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const ok = await pushBarkNotification(
      { barkPush: { enabled: true, url: `http://127.0.0.1:${port}`, events: { approval: true } } },
      "approval",
      "codex"
    );
    assert.equal(ok, true);
    assert.equal(seen.length, 1);
    assert.ok(seen[0].startsWith(`/${encodeURIComponent("等待审批")}/`), "path should carry the encoded event title");
    assert.ok(seen[0].includes("group=WorkIsland"));
  } finally {
    server.close();
  }
});

test("pushBarkNotification returns false on unreachable endpoint", async () => {
  const ok = await pushBarkNotification(
    { barkPush: { enabled: true, url: "http://127.0.0.1:9", events: { approval: true } } },
    "approval"
  );
  assert.equal(ok, false);
});
