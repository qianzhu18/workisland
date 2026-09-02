"use strict";

const { requestLocalControl } = require("../local-control-client.cjs");

const CONTROL_USAGE = `Usage:
  workisland settings list
  workisland settings get <key>
  workisland settings set <key> <json-value>
  workisland settings undo <change-id>
  workisland settings open <section>
  workisland sessions list
  workisland session focus <public-session-id>
  workisland surface set <island|pet>
  workisland state
  workisland activity`;

const CONTROL_GROUPS = new Set(["settings", "sessions", "session", "surface", "state", "activity"]);

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE_ERROR";
  return error;
}

function parseValue(input) {
  if (typeof input !== "string" || input.length === 0) throw usageError("A setting value is required.");
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function parseCommand(argv) {
  const [group, action, third, fourth, ...rest] = argv;
  if (rest.length > 0) throw usageError("Too many arguments.");

  if (group === "settings" && action === "list" && third === undefined) return ["control.describeSettings", {}];
  if (group === "settings" && action === "get" && third && fourth === undefined) return ["control.getSettings", { keys: [third] }];
  if (group === "settings" && action === "set" && third && fourth !== undefined) {
    return ["control.updateSettings", { changes: { [third]: parseValue(fourth) } }];
  }
  if (group === "settings" && action === "undo" && third && fourth === undefined) {
    return ["control.undoSettingsChange", { changeId: third }];
  }
  if (group === "settings" && action === "open" && third && fourth === undefined) {
    return ["control.openSettings", { section: third }];
  }
  if (group === "sessions" && action === "list" && third === undefined) return ["control.listVisibleSessions", {}];
  if (group === "session" && action === "focus" && third && fourth === undefined) {
    return ["control.focusSession", { id: third }];
  }
  if (group === "surface" && action === "set" && ["island", "pet"].includes(third) && fourth === undefined) {
    return ["control.setDisplaySurface", { surface: third }];
  }
  if (group === "state" && action === undefined) return ["control.getProductState", {}];
  if (group === "activity" && action === undefined) return ["control.getRecentActivity", {}];
  throw usageError("Unknown command.");
}

function isControlCommand(argv) {
  return CONTROL_GROUPS.has(argv[0]);
}

async function runControl(argv, dependencies = {}) {
  const request = dependencies.requestLocalControl || requestLocalControl;
  const writeOut = dependencies.writeOut || ((value) => process.stdout.write(value));
  const [command, params] = parseCommand(argv);
  const result = await request(command, params, { client: { name: "WorkIsland CLI", version: "1" } });
  writeOut(`${JSON.stringify(result)}\n`);
  return result;
}

module.exports = { CONTROL_USAGE, isControlCommand, parseCommand, parseValue, runControl };
