import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isShelfShareDrop } = require("../src/main/shelf-drop-routing.cjs");

test("native drop points inside the renderer share zone route to AirDrop", () => {
  const bounds = { x: 18, y: 92, width: 138, height: 310 };
  assert.equal(isShelfShareDrop({ x: 20, y: 100 }, bounds), true);
  assert.equal(isShelfShareDrop({ x: 155, y: 401 }, bounds), true);
});

test("invalid and outside points stay on the ordinary shelf route", () => {
  const bounds = { x: 18, y: 92, width: 138, height: 310 };
  assert.equal(isShelfShareDrop({ x: 160, y: 100 }, bounds), false);
  assert.equal(isShelfShareDrop({ x: 20, y: 403 }, bounds), false);
  assert.equal(isShelfShareDrop({ x: Number.NaN, y: 100 }, bounds), false);
  assert.equal(isShelfShareDrop({ x: 20, y: 100 }, null), false);
});
