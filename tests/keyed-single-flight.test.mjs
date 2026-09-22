import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { KeyedSingleFlight } = require("../src/main/keyed-single-flight.cjs");

test("same-key callers share one in-flight task", async () => {
  const flight = new KeyedSingleFlight();
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const calls = Array.from({ length: 100 }, () => flight.run("codex:s1", async () => {
    executions += 1;
    await gate;
    return "done";
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executions, 1);
  release();
  assert.deepEqual(await Promise.all(calls), Array(100).fill("done"));
});

test("different keys run independently and rejected tasks release their key", async () => {
  const flight = new KeyedSingleFlight();

  await assert.rejects(
    flight.run("codex:bad", async () => { throw new Error("boom"); }),
    /boom/
  );
  assert.equal(await flight.run("codex:bad", async () => "retry"), "retry");
  assert.deepEqual(await Promise.all([
    flight.run("codex:a", async () => "a"),
    flight.run("codex:b", async () => "b")
  ]), ["a", "b"]);
});
