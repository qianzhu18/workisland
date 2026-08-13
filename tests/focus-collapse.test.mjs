import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldCollapseOnFocusLoss } from "../src/renderer/island/focus-policy.mjs";

test("a visible Island hides when focus moves away and the setting is enabled", () => {
  assert.equal(shouldCollapseOnFocusLoss({ isVisible: true, enabled: true, followUpFocused: false }), true);
});

test("closed or disabled surfaces stay unchanged", () => {
  assert.equal(shouldCollapseOnFocusLoss({ isVisible: false, enabled: true, followUpFocused: false }), false);
  assert.equal(shouldCollapseOnFocusLoss({ isVisible: true, enabled: false, followUpFocused: false }), false);
});

test("focused follow-up input is not dismissed by a transient focus transition", () => {
  assert.equal(shouldCollapseOnFocusLoss({ isVisible: true, enabled: true, followUpFocused: true }), false);
});
