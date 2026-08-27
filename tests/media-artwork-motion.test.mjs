import assert from "node:assert/strict";
import test from "node:test";

import {
  getArtworkMotionVariables,
  getRestingArtworkMotionVariables
} from "../src/renderer/island/components/media-artwork-motion.mjs";

test("artwork motion is neutral at the center", () => {
  assert.deepEqual(getArtworkMotionVariables({ x: 50, y: 50, width: 100, height: 100 }), {
    "--artwork-rotate-x": "0.00deg",
    "--artwork-rotate-y": "0.00deg",
    "--artwork-light-x": "50.00%",
    "--artwork-light-y": "50.00%",
    "--artwork-glow-x": "0.00px",
    "--artwork-glow-y": "0.00px"
  });
});

test("artwork motion is bounded at the corners", () => {
  assert.deepEqual(getArtworkMotionVariables({ x: 1000, y: -1000, width: 100, height: 100 }), {
    "--artwork-rotate-x": "5.50deg",
    "--artwork-rotate-y": "-5.50deg",
    "--artwork-light-x": "100.00%",
    "--artwork-light-y": "0.00%",
    "--artwork-glow-x": "3.00px",
    "--artwork-glow-y": "-3.00px"
  });
});

test("invalid artwork geometry returns the resting state", () => {
  assert.deepEqual(
    getArtworkMotionVariables({ x: 10, y: 10, width: 0, height: 0 }),
    getRestingArtworkMotionVariables()
  );
});

test("resting artwork variables are stable", () => {
  assert.deepEqual(getRestingArtworkMotionVariables(), {
    "--artwork-rotate-x": "0deg",
    "--artwork-rotate-y": "0deg",
    "--artwork-light-x": "50%",
    "--artwork-light-y": "50%",
    "--artwork-glow-x": "0px",
    "--artwork-glow-y": "0px"
  });
});
