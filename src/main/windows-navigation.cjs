"use strict";

const childProcess = require("node:child_process");
const util = require("node:util");

const WINDOWS_APPS = Object.freeze({
  "windows terminal": { title: "Windows Terminal", executable: "wt.exe" },
  terminal: { title: "Windows Terminal", executable: "wt.exe" },
  powershell: { title: "PowerShell", executable: "powershell.exe" },
  pwsh: { title: "PowerShell", executable: "pwsh.exe" },
  "command prompt": { title: "Command Prompt", executable: "cmd.exe" },
  cmd: { title: "Command Prompt", executable: "cmd.exe" },
  cursor: { title: "Cursor", executable: "Cursor.exe" },
  "visual studio code": { title: "Visual Studio Code", executable: "code.cmd" },
  "vs code": { title: "Visual Studio Code", executable: "code.cmd" },
  vscode: { title: "Visual Studio Code", executable: "code.cmd" },
  code: { title: "Visual Studio Code", executable: "code.cmd" },
  windsurf: { title: "Windsurf", executable: "Windsurf.exe" },
  trae: { title: "TRAE", executable: "Trae.exe" },
  codex: { title: "Codex", executable: "Codex.exe" },
  claude: { title: "Claude", executable: "Claude.exe" },
  opencode: { title: "OpenCode", executable: "opencode.exe" },
  wezterm: { title: "WezTerm", executable: "wezterm-gui.exe" },
  alacritty: { title: "Alacritty", executable: "alacritty.exe" }
});

function resolveWindowsApp(app) {
  const value = String(app || "").trim();
  if (!value) return null;
  return WINDOWS_APPS[value.toLowerCase()] || { title: value, executable: null };
}

function createWindowsNavigation({ execFile = childProcess.execFile, logger = console } = {}) {
  const execFileAsync = util.promisify(execFile);

  async function jumpToTarget(target) {
    const app = resolveWindowsApp(target?.app);
    if (!app) return false;
    const script = [
      "$title = [Environment]::GetEnvironmentVariable('WORKISLAND_APP_TITLE')",
      "$executable = [Environment]::GetEnvironmentVariable('WORKISLAND_APP_EXECUTABLE')",
      "$shell = New-Object -ComObject WScript.Shell",
      "$activated = $shell.AppActivate($title)",
      "if (-not $activated -and $executable) { Start-Process -FilePath $executable }"
    ].join("; ");
    try {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script
      ], {
        timeout: 5e3,
        windowsHide: true,
        env: {
          ...process.env,
          WORKISLAND_APP_TITLE: app.title,
          WORKISLAND_APP_EXECUTABLE: app.executable || ""
        }
      });
      return true;
    } catch (error) {
      logger.warn?.(`[WindowsNavigation] failed to activate ${app.title}:`, error.message);
      return false;
    }
  }

  return { jumpToTarget };
}

module.exports = { WINDOWS_APPS, createWindowsNavigation, resolveWindowsApp };
