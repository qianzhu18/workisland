import assert from "node:assert/strict";
import test from "node:test";
import { deriveWorkspaceLayout, formatMediaTime, getNotchMediaLayout } from "../src/renderer/island/components/workstation-model.mjs";

test("media only splits the expanded island when a playable item exists", () => {
  assert.equal(deriveWorkspaceLayout({ active: false }, 720).mode, "agents");
  assert.equal(deriveWorkspaceLayout({ active: true, title: "Track" }, 720).mode, "split");
  assert.equal(deriveWorkspaceLayout({ active: true, title: "Track" }, 420).mode, "stacked");
});

test("media duration uses compact clock formatting", () => {
  assert.equal(formatMediaTime(0), "0:00");
  assert.equal(formatMediaTime(65), "1:05");
  assert.equal(formatMediaTime(3661), "1:01:01");
});

test("notch media keeps full-size artwork outside the camera safe area", () => {
  const layout = getNotchMediaLayout(179, 28, 6);
  assert.equal(layout.artworkRight, -95.5);
  assert.equal(layout.artworkLeft, -123.5);
  assert.equal(layout.indicatorLeft, 95.5);
  assert.equal(layout.artworkSize, 28);
});
