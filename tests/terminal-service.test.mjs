import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { TerminalService } from "../src/main/terminal-service.cjs";
import { normalizeSavedCommand, normalizeTerminalSize, resolveRecentProjectCwd, resolveTerminalCommand, resolveTerminalCwd } from "../src/shared/terminal-state.cjs";

function fakePty() {
  const child = new EventEmitter();
  child.writes = [];
  child.resizes = [];
  child.killed = false;
  child.write = (value) => child.writes.push(value);
  child.resize = (cols, rows) => child.resizes.push([cols, rows]);
  child.kill = () => { child.killed = true; };
  child.onData = (handler) => { child.dataHandler = handler; return { dispose() {} }; };
  child.onExit = (handler) => { child.exitHandler = handler; return { dispose() {} }; };
  return child;
}

test("terminal persists across panel switches and stops on disable", () => {
  const pty = fakePty();
  const service = new TerminalService({ spawnPty: () => pty, homeDir: "/Users/test", pathExists: () => true });
  service.start({ cwd: "/project" });
  pty.dataHandler("first line\r\n");
  service.setPanelVisible(false);
  assert.equal(pty.killed, false);
  assert.match(service.snapshot().recentOutput, /first line/);
  service.setEnabled(false);
  assert.equal(pty.killed, true);
});

test("terminal forwards bounded input and dimensions", () => {
  const pty = fakePty();
  const service = new TerminalService({ spawnPty: () => pty, homeDir: "/Users/test", pathExists: () => true });
  service.start({ cwd: "/project" });
  assert.equal(service.input("echo ok\r"), true);
  assert.equal(service.resize({ cols: 120, rows: 30 }), true);
  assert.deepEqual(pty.writes, ["echo ok\r"]);
  assert.deepEqual(pty.resizes, [[120, 30]]);
});

test("terminal state rejects invalid commands and impossible dimensions", () => {
  assert.deepEqual(normalizeSavedCommand({ id: "tests", name: "Tests", command: "npm test", cwdMode: "agent-project" }), {
    id: "tests", name: "Tests", command: "npm test", cwdMode: "agent-project"
  });
  assert.equal(normalizeSavedCommand({ id: "bad", name: "", command: "npm test" }), null);
  assert.deepEqual(normalizeTerminalSize({ cols: 120, rows: 30 }), { cols: 120, rows: 30 });
  assert.equal(normalizeTerminalSize({ cols: 0, rows: 99999 }), null);
});

test("invalid project directory falls back to home", () => {
  assert.equal(resolveTerminalCwd({ projectCwd: "/missing", homeDir: "/home", pathExists: value => value === "/home" }), "/home");
});

test("built-in quick commands resolve by ID without accepting renderer command text", () => {
  assert.equal(resolveTerminalCommand("git-status", []).command, "git status --short --branch");
  assert.equal(resolveTerminalCommand("unknown", []), null);
  assert.equal(resolveTerminalCommand("custom", [{ id: "custom", name: "Lint", command: "npm run lint", cwdMode: "agent-project" }]).command, "npm run lint");
});

test("terminal chooses the most recently active Agent project with a real directory", () => {
  const sessions = [
    { cwd: "/old", updatedAt: 100 },
    { cwd: "relative/path", updatedAt: 500 },
    { cwd: "/latest", updatedAt: 300 }
  ];
  assert.equal(resolveRecentProjectCwd(sessions, value => value === "/old" || value === "/latest"), "/latest");
  assert.equal(resolveRecentProjectCwd([], () => true), "");
});
