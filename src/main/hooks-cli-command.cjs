"use strict";

const path = require("node:path");

function quoteShellArgument(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function createHooksCliCommand({ appPath, source, nodePath, electronNodePath }) {
  if (!appPath || !source || !nodePath) {
    throw new TypeError("appPath, source, and nodePath are required");
  }

  const cliPath = path.resolve(appPath, "src", "island", "hooks-cli", "index.cjs");
  const electronNodePrefix = electronNodePath && nodePath === electronNodePath
    ? "ELECTRON_RUN_AS_NODE=1 "
    : "";

  return `${electronNodePrefix}${quoteShellArgument(nodePath)} ${quoteShellArgument(cliPath)} --source ${quoteShellArgument(source)}`;
}

module.exports = { createHooksCliCommand, quoteShellArgument };
