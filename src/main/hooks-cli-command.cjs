"use strict";

const path = require("node:path");

function quoteShellArgument(value, platform = process.platform) {
  if (platform === "win32") return `"${String(value).replaceAll('"', '\\"')}"`;
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createHooksCliCommand({ appPath, source, nodePath, electronNodePath, platform = process.platform }) {
  if (!appPath || !source || !nodePath) {
    throw new TypeError("appPath, source, and nodePath are required");
  }

  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const cliPath = pathApi.resolve(appPath, "src", "island", "hooks-cli", "index.cjs");
  const electronNodePrefix = electronNodePath && nodePath === electronNodePath
    ? platform === "win32" ? 'set "ELECTRON_RUN_AS_NODE=1"&& ' : "ELECTRON_RUN_AS_NODE=1 "
    : "";

  return `${electronNodePrefix}${quoteShellArgument(nodePath, platform)} ${quoteShellArgument(cliPath, platform)} --source ${quoteShellArgument(source, platform)}`;
}

module.exports = { createHooksCliCommand, quoteShellArgument };
