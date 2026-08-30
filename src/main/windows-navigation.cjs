"use strict";

const childProcess = require("node:child_process");
const util = require("node:util");

// executable 为 null 的条目永不主动启动：终端宿主（wt/pwsh/cmd）拉起只会得到
// 一个落在默认 profile 的空控制台（issue #57 的「跳到裸 cmd」），codex 在
// Windows 上是 CLI、不存在 Codex.exe 桌面客户端。对这些目标只聚焦已有窗口。
// launchable 的 GUI 客户端在窗口全关时才允许启动兜底。
const WINDOWS_APPS = Object.freeze({
  "windows terminal": { title: "Windows Terminal", executable: null },
  terminal: { title: "Windows Terminal", executable: null },
  powershell: { title: "PowerShell", executable: null },
  pwsh: { title: "PowerShell", executable: null },
  "command prompt": { title: "Command Prompt", executable: null },
  cmd: { title: "Command Prompt", executable: null },
  cursor: { title: "Cursor", executable: "Cursor.exe", launchable: true },
  "visual studio code": { title: "Visual Studio Code", executable: "code.cmd", launchable: true },
  "vs code": { title: "Visual Studio Code", executable: "code.cmd", launchable: true },
  vscode: { title: "Visual Studio Code", executable: "code.cmd", launchable: true },
  code: { title: "Visual Studio Code", executable: "code.cmd", launchable: true },
  windsurf: { title: "Windsurf", executable: "Windsurf.exe", launchable: true },
  trae: { title: "TRAE", executable: "Trae.exe", launchable: true },
  codex: { title: "Codex", executable: null },
  claude: { title: "Claude", executable: "Claude.exe", launchable: true },
  opencode: { title: "OpenCode", executable: null },
  wezterm: { title: "WezTerm", executable: "wezterm-gui.exe", launchable: true },
  alacritty: { title: "Alacritty", executable: "alacritty.exe", launchable: true }
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
    // 激活优先级（issue #57）：
    // 1) 按会话 pid 激活（AppActivate 接受 PID，GUI 客户端会话直接命中）；
    // 2) 沿父进程链找 WindowsTerminal/conhost 等终端宿主，按宿主 PID 激活
    //    （WT 窗口标题随活动标签变化，标题匹配几乎必然失败；标签级精确定位
    //    尚无公开接口，只能聚焦到宿主窗口）；
    // 3) 按标题激活兜底；
    // 4) 仅对 launchable 的 GUI 客户端允许 Start-Process 兜底——codex/终端类
    //    目标任何情况下都不再凭空弹出新窗口。
    const script = [
      "$title = [Environment]::GetEnvironmentVariable('WORKISLAND_APP_TITLE')",
      "$executable = [Environment]::GetEnvironmentVariable('WORKISLAND_APP_EXECUTABLE')",
      "$launchable = [Environment]::GetEnvironmentVariable('WORKISLAND_APP_LAUNCHABLE') -eq '1'",
      "$targetPid = 0",
      "[void][int]::TryParse([Environment]::GetEnvironmentVariable('WORKISLAND_APP_PID'), [ref]$targetPid)",
      "$shell = New-Object -ComObject WScript.Shell",
      "$activated = $false",
      "if ($targetPid -gt 0) {",
      "  $activated = $shell.AppActivate($targetPid)",
      "  if (-not $activated) {",
      "    $termHost = $null",
      "    $hostNames = @('windowsterminal.exe','conhost.exe','openconsole.exe','wezterm-gui.exe','alacritty.exe')",
      "    $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$targetPid\"",
      "    for ($i = 0; $i -lt 8 -and $p; $i++) {",
      "      $n = $p.Name.ToLowerInvariant()",
      "      if ($hostNames -contains $n) { $termHost = $p; break }",
      "      if ($n -eq 'explorer.exe') { break }",
      "      $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$($p.ParentProcessId)\"",
      "    }",
      "    if ($termHost) { $activated = $shell.AppActivate([int]$termHost.ProcessId) }",
      "  }",
      "}",
      "if (-not $activated -and $title) { $activated = $shell.AppActivate($title) }",
      "if ($activated) { Write-Output 'RESULT:activated'; exit 0 }",
      "if ($launchable -and $executable) { Start-Process -FilePath $executable; Write-Output 'RESULT:launched'; exit 0 }",
      "Write-Output 'RESULT:failed'"
    ].join("; ");
    try {
      // promisify(execFile) 对多返回值的实现是数组（真实 child_process 为 {stdout}）
      const result = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script
      ], {
        timeout: 8e3,
        windowsHide: true,
        env: {
          ...process.env,
          WORKISLAND_APP_TITLE: app.title,
          WORKISLAND_APP_EXECUTABLE: app.executable || "",
          WORKISLAND_APP_LAUNCHABLE: app.launchable ? "1" : "0",
          WORKISLAND_APP_PID: String(Number(target?.pid) || 0)
        }
      });
      const stdout = typeof result === "string"
        ? result
        : Array.isArray(result) ? result[0] : result?.stdout;
      return /RESULT:(activated|launched)/.test(String(stdout));
    } catch (error) {
      logger.warn?.(`[WindowsNavigation] failed to activate ${app.title}:`, error.message);
      return false;
    }
  }

  return { jumpToTarget };
}

module.exports = { WINDOWS_APPS, createWindowsNavigation, resolveWindowsApp };
