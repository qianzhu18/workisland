'use strict';
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { KiroHookStore } = require('./kiro-hooks.cjs');
const { createHooksCliCommand } = require('./hooks-cli-command.cjs');
const { wrapWithInstallCheck } = require('./hook-shared.cjs');
class KiroHookManager extends KiroHookStore {
  agentId = 'kiro';
  constructor() {
    super({ homeDir: os.homedir(), kiroHome: process.env.KIRO_HOME && path.isAbsolute(process.env.KIRO_HOME) ? process.env.KIRO_HOME : path.join(os.homedir(), '.kiro'), hookCommand: wrapWithInstallCheck(process.execPath, createHooksCliCommand({ appPath: electron.app.getAppPath(), source: 'kiro', nodePath: process.execPath, electronNodePath: process.execPath })) });
  }
}
module.exports = { KiroHookManager };
