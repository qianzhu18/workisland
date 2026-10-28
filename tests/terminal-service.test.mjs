import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { resolveTerminalShell, TerminalService } from "../src/main/terminal-service.cjs";
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

test("only user-saved quick commands resolve by ID without accepting renderer command text", () => {
  assert.equal(resolveTerminalCommand("git-status", []), null);
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

test("terminal selects Windows PowerShell and its native startup arguments", () => {
  const powerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  assert.deepEqual(resolveTerminalShell({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    pathExists: (candidate) => candidate === powerShell
  }), { shell: powerShell, args: ["-NoLogo"] });
});

function terminalPool(options = {}) {
  const children = [];
  const service = new TerminalService({ spawnPty: () => { const p = fakePty(); children.push(p); return p; }, homeDir: "/home/test", pathExists: () => true, ...options });
  return { service, children };
}

test("three terminals route input, size and output by stable ID", () => {
  const { service, children } = terminalPool();
  const first = service.create({ cwd: "/one" });
  const second = service.create({ cwd: "/two" });
  const third = service.create({ cwd: "/three" });
  assert.equal(service.snapshot().sessions.length, 3);
  assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  children.forEach((child, n) => child.dataHandler(`output-${n}`));
  assert.equal(service.input("one\r", first.id), true);
  assert.equal(service.input("three\r", third.id), true);
  service.resize({ cols: 81, rows: 25 }, second.id);
  assert.deepEqual(children.map(c => c.writes), [["one\r"], [], ["three\r"]]);
  assert.deepEqual(children[1].resizes, [[81, 25]]);
  assert.equal(service.select(first.id).id, first.id);
  assert.equal(service.snapshot(first.id).recentOutput, "output-0");
  assert.equal(service.snapshot(second.id).recentOutput, "output-1");
  assert.equal(children.every(c => !c.killed), true);
});

test("closing a middle or active terminal preserves its siblings and rejects stale IDs", () => {
  const { service, children } = terminalPool();
  const a = service.create(), b = service.create(), c = service.create();
  service.close(b.id);
  assert.equal(children[1].killed, true);
  assert.equal(children[0].killed || children[2].killed, false);
  assert.equal(service.snapshot().id, c.id);
  assert.equal(service.input("stale", b.id), false);
  assert.equal(service.resize({ cols: 100, rows: 30 }, b.id), false);
  assert.equal(service.select(b.id), false);
  assert.equal(service.restart({}, b.id), false);
  assert.equal(service.close("missing"), false);
  service.close(c.id);
  assert.equal(service.snapshot().id, a.id);
  assert.equal(service.input("still alive\r", a.id), true);
  service.close(a.id);
  assert.equal(service.snapshot().activeId, null);
  assert.deepEqual(service.snapshot().sessions, []);
});

test("late data and exit from closed or restarted processes cannot corrupt another session", () => {
  const { service, children } = terminalPool();
  const a = service.create(), b = service.create();
  service.restart({}, a.id);
  children[2].dataHandler("replacement");
  children[0].dataHandler("stale data");
  children[0].exitHandler({ exitCode: 9 });
  assert.equal(service.snapshot(a.id).running, true);
  assert.equal(service.snapshot(a.id).recentOutput, "replacement");
  service.close(b.id);
  children[1].dataHandler("closed data");
  children[1].exitHandler({ exitCode: 3 });
  assert.equal(service.snapshot().sessions.length, 1);
  assert.equal(service.snapshot().id, a.id);
});

test("large output is transported intact with sequence numbers while retained history stays bounded", () => {
  const { service, children } = terminalPool();
  const a = service.create();
  const frames = [];
  service.on("data", frame => frames.push(frame));
  const text = "终端😀".repeat(180000);
  children[0].dataHandler(text);
  assert.equal(frames.map(f => f.data).join(""), text);
  assert.equal(frames.every(f => f.id === a.id), true);
  assert.deepEqual(frames.map(f => f.sequence), frames.map((_, n) => n + 1));
  assert.ok(service.snapshot().recentOutput.length <= 512 * 1024);
  assert.equal(service.snapshot().sequence, frames.length);
  assert.equal(service.snapshot().sessions.some(s => "recentOutput" in s), false);
});

test("natural exit retains history, names are bounded, disabling and disposing clean up every PTY", () => {
  const { service, children } = terminalPool();
  const a = service.create({ name: "OpenCode" }), b = service.create({ name: "Claude" });
  children[0].dataHandler("done");
  children[0].exitHandler({ exitCode: 7 });
  assert.equal(service.snapshot(a.id).exitCode, 7);
  assert.equal(service.snapshot(a.id).recentOutput, "done");
  service.rename(b.id, "  my task\x00  ");
  assert.equal(service.snapshot(b.id).name, "my task");
  service.setEnabled(false);
  assert.equal(children[1].killed, true);
  assert.equal(service.create(), false);
  assert.equal(service.snapshot().sessions.every(s => !s.running), true);
  service.dispose();
  assert.deepEqual(service.snapshot().sessions, []);
});

test("the terminal limit fails without spawning or replacing an existing task", () => {
  const { service, children } = terminalPool({ maxSessions: 2 });
  service.create(); service.create();
  assert.throws(() => service.create(), { code: "TERMINAL_LIMIT" });
  assert.equal(children.length, 2);
  assert.equal(children.every(c => !c.killed), true);
});
