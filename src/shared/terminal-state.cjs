"use strict";

const path = require("node:path");

function normalizeSavedCommand(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = typeof entry.id === "string" ? entry.id.trim().slice(0, 80) : "";
  const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 80) : "";
  const command = typeof entry.command === "string" ? entry.command.trim().slice(0, 8192) : "";
  if (!id || !name || !command) return null;
  const cwdMode = ["agent-project", "home", "custom"].includes(entry.cwdMode) ? entry.cwdMode : "agent-project";
  return { id, name, command, cwdMode };
}

function normalizeTerminalSize(size) {
  const cols = Number(size?.cols);
  const rows = Number(size?.rows);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 500 || rows < 5 || rows > 200) return null;
  return { cols, rows };
}

function resolveTerminalCwd({ projectCwd = "", customCwd = "", homeDir, mode = "agent-project", pathExists = () => false } = {}) {
  const candidates = mode === "custom"
    ? [customCwd, homeDir]
    : mode === "home"
      ? [homeDir]
      : [projectCwd, customCwd, homeDir];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && path.isAbsolute(candidate) && pathExists(candidate)) return candidate;
  }
  return path.isAbsolute(homeDir || "") ? homeDir : "/";
}

function resolveRecentProjectCwd(sessions = [], pathExists = () => false) {
  return [...sessions]
    .filter((session) => typeof session?.cwd === "string" && path.isAbsolute(session.cwd) && pathExists(session.cwd))
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0]?.cwd || "";
}

const BUILT_IN_TERMINAL_COMMANDS = Object.freeze([
  Object.freeze({ id: "git-status", name: "查看 Git 状态", command: "git status --short --branch", cwdMode: "agent-project" }),
  Object.freeze({ id: "project-tests", name: "运行项目测试", command: "npm test", cwdMode: "agent-project" })
]);

function resolveTerminalCommand(id, savedCommands = []) {
  const normalized = [...BUILT_IN_TERMINAL_COMMANDS, ...savedCommands.map(normalizeSavedCommand).filter(Boolean)];
  return normalized.find((entry) => entry.id === id) || null;
}

module.exports = { BUILT_IN_TERMINAL_COMMANDS, normalizeSavedCommand, normalizeTerminalSize, resolveRecentProjectCwd, resolveTerminalCommand, resolveTerminalCwd };
