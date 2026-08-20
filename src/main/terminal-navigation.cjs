"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const child_process = require("node:child_process");
const util = require("node:util");
const log = require("electron-log");
const fs__namespace = fs;
const path__namespace = path;
const os__namespace = os;

function createTerminalNavigation({ isPluginAgentTool, PLUGIN_BY_TOOL }) {
  const COMMON_TMUX_PATHS = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"];
  function firstAbsoluteLine(stdout) {
    const text = String(stdout ?? "");
    for (const line of text.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate && path.isAbsolute(candidate)) return candidate;
    }
    return null;
  }
  function lookupTmuxWithShell(shellPath) {
    const result = child_process.spawnSync(shellPath, ["-lc", "command -v tmux"], {
      encoding: "utf-8",
      timeout: 5e3
    });
    return result.status === 0 ? firstAbsoluteLine(result.stdout) : null;
  }
  function resolveTmuxBinary() {
    const override = process.env.FLUX_TMUX_BIN?.trim();
    if (override && path.isAbsolute(override)) return override;
    const fromBash = lookupTmuxWithShell("/bin/bash");
    if (fromBash) return fromBash;
    const fromZsh = lookupTmuxWithShell("/bin/zsh");
    if (fromZsh) return fromZsh;
    for (const candidate of COMMON_TMUX_PATHS) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  function escapeDoubleQuotedArg(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function buildTmuxAttachCommand(tmuxBin, session) {
    if (!path.isAbsolute(tmuxBin)) {
      throw new Error("tmux attach command must use absolute path to tmux");
    }
    return `${tmuxBin} attach -t "${escapeDoubleQuotedArg(session)}"`;
  }
  const execFileAsync$6 = util.promisify(child_process.execFile);
  const CURSOR_BUNDLE_ID = "com.todesktop.230313mzl4w4u92";
  const CODEX_APP_BUNDLE_ID = "com.openai.codex";
  const CLAUDE_DESKTOP_BUNDLE_ID = "com.anthropic.claudefordesktop";
  // 与 Claude Desktop 自身对 resume 深链参数的校验保持一致
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /**
   * 在 Claude Desktop 的本地会话存储里，按 cliSessionId 反查桌面会话 id。
   *
   * 存储布局：~/Library/Application Support/Claude/claude-code-sessions/<org>/<account>/local_*.json
   * 每条记录同时有 sessionId（记录自身，形如 local_<uuid>）和 cliSessionId
   * （当前挂载的 CLI 会话）。两者的 uuid 通常不同 —— 桌面会话先建、之后才挂上
   * CLI 会话，且 resume/fork 后 cliSessionId 还会变。
   *
   * 注意：这是读另一个应用的内部存储，格式随版本可能变化。所以整段都在 try 里，
   * 任何异常都退回上层的兜底路径，不影响跳转本身可用。
   */
  // 反查结果的短缓存。桌面会话的 cliSessionId 会随 resume/fork 变化，
  // 不能永久缓存；10s 只覆盖「连续点击」的场景，陈旧风险可忽略。
  let claudeSessionScanCache = null;
  function findClaudeDesktopSessionId(cliSessionId) {
    const now = Date.now();
    if (claudeSessionScanCache && now - claudeSessionScanCache.at < 1e4) {
      return claudeSessionScanCache.map.get(cliSessionId) ?? null;
    }
    try {
      // Cowork（local-agent-mode-sessions）与普通 Code 会话（claude-code-sessions）
      // 记录结构同款（sessionId/cliSessionId/lastActivityAt），一并扫描，
      // 点击 Cowork 会话卡片同样能经 epitaxy 深链跳进对应对话
      const roots = ["claude-code-sessions", "local-agent-mode-sessions"].map((d) =>
        path__namespace.join(os__namespace.homedir(), "Library", "Application Support", "Claude", d)
      ).filter((r) => fs__namespace.existsSync(r));
      if (roots.length === 0) return null;
      const best = new Map();
      for (const root of roots) for (const org of fs__namespace.readdirSync(root)) {
        const orgDir = path__namespace.join(root, org);
        if (!fs__namespace.statSync(orgDir).isDirectory()) continue;
        for (const acct of fs__namespace.readdirSync(orgDir)) {
          const acctDir = path__namespace.join(orgDir, acct);
          if (!fs__namespace.statSync(acctDir).isDirectory()) continue;
          for (const name of fs__namespace.readdirSync(acctDir)) {
            if (!name.startsWith("local_") || !name.endsWith(".json")) continue;
            let rec;
            try {
              rec = JSON.parse(fs__namespace.readFileSync(path__namespace.join(acctDir, name), "utf8"));
            } catch { continue; }
            if (!rec?.cliSessionId || rec.isArchived) continue;
            // 同一个 cliSessionId 可能对应多条（例如之前误导入过），取最近活跃的那条
            const prev = best.get(rec.cliSessionId);
            if (!prev || (rec.lastActivityAt ?? 0) > (prev.lastActivityAt ?? 0)) best.set(rec.cliSessionId, rec);
          }
        }
      }
      const map = new Map();
      for (const [k, v] of best) map.set(k, v.sessionId);
      claudeSessionScanCache = { at: now, map };
      return map.get(cliSessionId) ?? null;
    } catch (err) {
      log.debug("[TerminalJumpService] findClaudeDesktopSessionId failed:", err);
      return null;
    }
  }
  const VSCODE_BUNDLE_ID = "com.microsoft.VSCode";
  const VSCODE_INSIDERS_BUNDLE_ID = "com.microsoft.VSCodeInsiders";
  const WINDSURF_BUNDLE_ID = "com.exafunction.windsurf";
  const ANTIGRAVITY_BUNDLE_ID = "com.google.antigravity";
  const TRAE_BUNDLE_IDS = [
    "com.trae.app",
    "com.trae.app.dev",
    "cn.trae.app",
    "cn.trae.app.alpha",
    "cn.trae.app.dev",
    "cn.trae.solo.app"
  ];
  const TRAE_VARIANTS_INFO = [
    {
      dirName: "Trae",
      bundleId: "com.trae.app",
      cliPath: "/Applications/Trae.app/Contents/Resources/app/bin/trae",
      displayName: "Trae"
    },
    {
      dirName: "Trae - Dev",
      bundleId: "com.trae.app.dev",
      cliPath: "/Applications/Trae - Dev.app/Contents/Resources/app/bin/trae-dev",
      displayName: "Trae - Dev"
    },
    {
      dirName: "Trae CN",
      bundleId: "cn.trae.app",
      cliPath: "/Applications/Trae CN.app/Contents/Resources/app/bin/trae-cn",
      displayName: "Trae CN"
    },
    {
      dirName: "Trae CN - Alpha",
      bundleId: "cn.trae.app.alpha",
      cliPath: "/Applications/Trae CN - Alpha.app/Contents/Resources/app/bin/trae-cn-alpha",
      displayName: "Trae CN - Alpha"
    },
    {
      dirName: "Trae CN - Dev",
      bundleId: "cn.trae.app.dev",
      cliPath: "/Applications/Trae CN - Dev.app/Contents/Resources/app/bin/trae-cn-dev",
      displayName: "Trae CN - Dev"
    },
    {
      dirName: "TRAE SOLO",
      bundleId: "com.trae.solo.app",
      cliPath: "/Applications/TRAE SOLO.app/Contents/Resources/app/bin/trae-solo",
      displayName: "TRAE SOLO"
    }
  ];
  function findTraeVariantInfo(dirName) {
    if (!dirName) return void 0;
    return TRAE_VARIANTS_INFO.find((v) => v.dirName === dirName);
  }
  const TRAE_VARIANT_DISPATCH_KEYS = new Set(
    TRAE_VARIANTS_INFO.map((v) => v.dirName.toLowerCase())
  );
  const TRAE_AGENT_TOOLS = /* @__PURE__ */ new Set(["trae", "trae-cn", "traework"]);
  function findTraeVariantByApp(app) {
    if (!app) return void 0;
    const lc = app.toLowerCase();
    return TRAE_VARIANTS_INFO.find((v) => v.dirName.toLowerCase() === lc);
  }
  const JETBRAINS_BUNDLE_IDS = {
    "intellij idea": ["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
    "android studio": ["com.google.android.studio"],
    goland: ["com.jetbrains.goland"],
    pycharm: ["com.jetbrains.pycharm", "com.jetbrains.pycharm.ce"],
    webstorm: ["com.jetbrains.WebStorm"],
    clion: ["com.jetbrains.CLion"],
    rubymine: ["com.jetbrains.rubymine"],
    phpstorm: ["com.jetbrains.PhpStorm"],
    rider: ["com.jetbrains.rider"],
    rustrover: ["com.jetbrains.rustrover"]
  };
  const TERMINAL_APP_TO_BUNDLE_ID = {
    iterm2: "com.googlecode.iterm2",
    iterm: "com.googlecode.iterm2",
    "iterm.app": "com.googlecode.iterm2",
    terminal: "com.apple.Terminal",
    apple_terminal: "com.apple.Terminal",
    ghostty: "com.mitchellh.ghostty",
    wezterm: "com.github.wez.wezterm",
    warp: "dev.warp.Warp-Stable",
    warpterminal: "dev.warp.Warp-Stable",
    warpteminal: "dev.warp.Warp-Stable",
    // Alacritty 0.17.0 实际 CFBundleIdentifier = `org.alacritty`（见 .app/Contents/Info.plist），
    // 历史上 Flux 误用过 `io.alacritty`——上游 alacritty repo 也没用过这个 prefix，
    // System Events `frontmost is true` 永远拿不到这个值，导致跳转 / 通知抑制等
    // bundle id 路径全数失效。
    alacritty: "org.alacritty",
    kitty: "net.kovidgoyal.kitty",
    cmux: "com.cmuxterm.app",
    // Kaku 是 WezTerm 的深度 fork，CFBundleIdentifier 实测为 `fun.tw93.kaku`
    // （见 tw93/Kaku assets/macos/Kaku.app/Contents/Info.plist）。CLI 协议与
    // wezterm 等价（kaku cli list / list-clients / activate-tab 等），跳转走 jumpKaku。
    kaku: "fun.tw93.kaku",
    // VS Code (TERM_PROGRAM=vscode → detectTerminalApp returns 'VS Code' → toLowerCase = 'vs code')
    "vs code": VSCODE_BUNDLE_ID,
    vscode: VSCODE_BUNDLE_ID,
    // Antigravity（Google 的 VS Code fork）—— hooks-cli detectVscodeForkApp 命中
    // bundleId=com.google.antigravity 后返回 'Antigravity'，toLowerCase = 'antigravity'。
    antigravity: ANTIGRAVITY_BUNDLE_ID,
    cursor: CURSOR_BUNDLE_ID,
    codex: CODEX_APP_BUNDLE_ID,
    opencode: "com.opencode.app",
    zcode: "dev.zcode.app",
    workbuddy: "com.workbuddy.workbuddy",
    codebuddy: "com.tencent.codebuddycn",
    "codebuddy cn": "com.tencent.codebuddycn",
    traework: "com.trae.solo.app",
    "trae solo": "com.trae.solo.app"
  };
  function getSessionBundleIds(session) {
    const ids = [];
    if (session.jumpTarget?.app) {
      const key = session.jumpTarget.app.toLowerCase();
      const bundleId = TERMINAL_APP_TO_BUNDLE_ID[key];
      if (bundleId) ids.push(bundleId);
      const jetbrainsIds = JETBRAINS_BUNDLE_IDS[key];
      if (jetbrainsIds) ids.push(...jetbrainsIds);
      let traeVariant = void 0;
      if (session.jumpTarget.traeVariant != null) {
        traeVariant = findTraeVariantInfo(session.jumpTarget.traeVariant);
      }
      if (!traeVariant && session.jumpTarget.app) {
        traeVariant = findTraeVariantByApp(session.jumpTarget.app);
      }
      if (traeVariant?.bundleId) {
        ids.push(traeVariant.bundleId);
      }
      if (key === "opencode") {
        ids.push("com.opencode.app", "com.opencode.desktop", "ai.opencode.desktop");
      }
    }
    if (session.jumpTarget && session.jumpTarget.app.toLowerCase() === "tmux" && !session.isRemote && session.jumpTarget.tmuxOuterHost) {
      const outer = session.jumpTarget.tmuxOuterHost.toLowerCase();
      const id = TERMINAL_APP_TO_BUNDLE_ID[outer];
      if (id) ids.push(id);
      const jb = JETBRAINS_BUNDLE_IDS[outer];
      if (jb) ids.push(...jb);
      if (outer.includes("trae")) ids.push(...TRAE_BUNDLE_IDS);
    }
    switch (session.tool) {
      case "cursor":
        ids.push(CURSOR_BUNDLE_ID);
        break;
      case "codex":
        ids.push(CODEX_APP_BUNDLE_ID);
        break;
      case "coco":
      case "trae":
        ids.push(...TRAE_BUNDLE_IDS);
        break;
      case "traework":
        ids.push("com.trae.solo.app");
        break;
      case "claude":
        ids.push(CLAUDE_DESKTOP_BUNDLE_ID);
        break;
      case "opencode":
        ids.push("com.opencode.app", "com.opencode.desktop", "ai.opencode.desktop");
        break;
      case "zcode":
        ids.push("dev.zcode.app");
        break;
      case "workbuddy":
        ids.push("com.workbuddy.workbuddy");
        break;
      case "codebuddy":
        ids.push("com.tencent.codebuddycn");
        break;
      default:
        if (isPluginAgentTool(session.tool)) {
          const plugin = PLUGIN_BY_TOOL.get(session.tool);
          if (plugin) ids.push(...plugin.suppressionBundleIds);
        }
        break;
    }
    return [...new Set(ids)];
  }
  async function runAppleScript$1(script) {
    const { stdout } = await execFileAsync$6("/usr/bin/osascript", ["-e", script], {
      timeout: 5e3
    });
    return stdout.trim();
  }
  async function runJxa(script) {
    const { stdout } = await execFileAsync$6(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script],
      { timeout: 5e3 }
    );
    return stdout.trim();
  }
  function escapeAppleScriptString(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function isDedicatedTerminalJumpApp(target) {
    if (target.tmuxTarget) return true;
    const a = target.app.toLowerCase();
    return a === "ghostty" || a === "iterm" || a === "iterm2" || a === "iterm.app" || a === "terminal" || a === "apple_terminal" || a === "wezterm" || a === "warp" || a === "warpteminal" || a === "warpterminal" || a === "alacritty" || a === "kitty" || a === "cmux" || a === "kaku" || a === "zellij";
  }
  function shouldUseToolJumpHandler(tool, target, handlerToolName) {
    if (!target) return true;
    if (isDedicatedTerminalJumpApp(target)) return false;
    const hostApp = target.app.trim().toLowerCase();
    if (!hostApp || hostApp === handlerToolName) return true;
    return TRAE_AGENT_TOOLS.has(tool) && TRAE_VARIANT_DISPATCH_KEYS.has(hostApp);
  }
  async function activateMacAppByBundle(bundleId) {
    if (process.platform !== "darwin") return;
    await execFileAsync$6("open", ["-b", bundleId], { timeout: 5e3 });
  }
  async function activateMacAppWithoutAllWindows(bundleId) {
    if (process.platform !== "darwin") return false;
    const escapedBundleId = JSON.stringify(bundleId);
    const script = `
  ObjC.import('AppKit');
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier($(${escapedBundleId}));
  if (apps.count === 0) {
    "";
  } else {
    const app = apps.objectAtIndex(0);
    app.activateWithOptions($.NSApplicationActivateIgnoringOtherApps) ? "activated" : "";
  }`;
    try {
      const result = await runJxa(script);
      return result.includes("activated");
    } catch (err) {
      console.warn(
        "[activateMacAppWithoutAllWindows] JXA activate failed, falling back:",
        err
      );
      return false;
    }
  }
  async function jumpGhostty(target) {
    let matchCondition;
    if (target.tabId) {
      matchCondition = `(id of aTerminal as text) is "${escapeAppleScriptString(target.tabId)}"`;
    } else if (target.workingDirectory) {
      matchCondition = `(working directory of aTerminal as text) is "${escapeAppleScriptString(target.workingDirectory)}"`;
    }
    if (matchCondition) {
      const focusScript = `
  tell application "Ghostty"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aTerminal in terminals of aTab
          if ${matchCondition} then
            focus aTerminal
            return "focused"
          end if
        end repeat
      end repeat
    end repeat
  end tell`;
      try {
        const result = await runAppleScript$1(focusScript);
        if (result.includes("focused")) {
          const activated = await activateMacAppWithoutAllWindows(
            TERMINAL_APP_TO_BUNDLE_ID.ghostty
          );
          if (activated) return;
          try {
            await runAppleScript$1(`tell application "Ghostty" to activate`);
            return;
          } catch (err) {
            console.warn("[jumpGhostty] activate fallback failed:", err);
          }
        }
      } catch (err) {
        console.warn("[jumpGhostty] focus failed:", err);
      }
    }
    await jumpFallback(target);
  }
  async function jumpITerm2(target) {
    if (target.tabId) {
      const colonIdx = target.tabId.indexOf(":");
      const guid = colonIdx >= 0 ? target.tabId.slice(colonIdx + 1) : target.tabId;
      const script = buildITermSelectScript(
        `(unique ID of aSession) is "${guid}"`,
        `(unique ID of current session of current tab of front window) is "${guid}"`
      );
      try {
        const result = await runAppleScript$1(script);
        if (result.includes("matched") || result.includes("focused")) return;
      } catch {
      }
    }
    if (target.tty) {
      const tty = target.tty;
      const script = buildITermSelectScript(
        `(tty of aSession) is "${tty}"`,
        `(tty of current session of current tab of front window) is "${tty}"`
      );
      try {
        const result = await runAppleScript$1(script);
        if (result.includes("matched") || result.includes("focused")) return;
      } catch {
      }
    }
    await jumpFallback(target);
  }
  function buildITermSelectScript(matchClause, verifyClause) {
    return `
  tell application "iTerm"
    set matchedW to missing value
    set matchedT to missing value
    set matchedS to missing value
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aSession in sessions of aTab
          if ${matchClause} then
            set matchedW to aWindow
            set matchedT to aTab
            set matchedS to aSession
            exit repeat
          end if
        end repeat
        if matchedS is not missing value then exit repeat
      end repeat
      if matchedS is not missing value then exit repeat
    end repeat
    if matchedS is missing value then return ""
    repeat 3 times
      select matchedW
      delay 0.04
      select matchedT
      select matchedS
      activate
      delay 0.1
      try
        if ${verifyClause} then return "matched"
      end try
    end repeat
    return "focused"
  end tell`;
  }
  async function resolveTtyFromCwd(workingDirectory) {
    try {
      const script = `
  tell application "Terminal"
    set ttyList to ""
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        set ttyList to ttyList & (tty of aTab) & linefeed
      end repeat
    end repeat
    return ttyList
  end tell`;
      const termTtysRaw = await runAppleScript$1(script);
      const termTtys = termTtysRaw.split("\n").map((t) => t.trim()).filter(Boolean);
      if (termTtys.length === 0) return void 0;
      const { stdout } = await execFileAsync$6("/usr/sbin/lsof", ["-d", "cwd", "-Fpn", workingDirectory], {
        timeout: 5e3,
        maxBuffer: 4 * 1024 * 1024
      });
      const lines = stdout.split("\n");
      const pidsByCwd = /* @__PURE__ */ new Map();
      let currentPid = "";
      for (const line of lines) {
        if (line.startsWith("p")) {
          currentPid = line.slice(1);
        } else if (line.startsWith("n") && currentPid) {
          const cwd = line.slice(1);
          if (cwd === workingDirectory) {
            if (!pidsByCwd.has(cwd)) pidsByCwd.set(cwd, []);
            pidsByCwd.get(cwd).push(currentPid);
          }
        }
      }
      const matchedPids = pidsByCwd.get(workingDirectory);
      if (!matchedPids || matchedPids.length === 0) return void 0;
      const { stdout: psOut } = await execFileAsync$6("/bin/ps", [
        "-p",
        matchedPids.join(","),
        "-o",
        "tty="
      ], { timeout: 3e3 });
      const processTtys = [...new Set(
        psOut.trim().split("\n").map((t) => t.trim()).filter((t) => t && t !== "??").map((t) => t.startsWith("/dev/") ? t : `/dev/${t}`)
      )];
      const termTtySet = new Set(termTtys);
      return processTtys.find((t) => termTtySet.has(t));
    } catch {
      return void 0;
    }
  }
  async function jumpTerminalApp(target) {
    let tty = target.tty;
    if (!tty && target.workingDirectory) {
      tty = await resolveTtyFromCwd(target.workingDirectory);
    }
    if (tty) {
      try {
        const phase1 = restoreTerminalWindow(tty);
        const p1Result = await runAppleScript$1(phase1);
        if (p1Result === "matched") return;
        if (p1Result === "miss") {
          await jumpFallback(target);
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
        const phase2 = focusTerminalTab(tty);
        const p2Result = await runAppleScript$1(phase2);
        if (p2Result === "matched") return;
      } catch {
      }
    }
    await jumpFallback(target);
  }
  function restoreTerminalWindow(tty) {
    return `
  tell application "Terminal"
    set found to false
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        if (tty of aTab) is "${tty}" then
          set found to true
          try
            if miniaturized of aWindow then set miniaturized of aWindow to false
          end try
          exit repeat
        end if
      end repeat
      if found then exit repeat
    end repeat
    if not found then return "miss"
    activate
  end tell
  return "activated"`;
  }
  function focusTerminalTab(tty) {
    return `
  tell application "Terminal"
    set targetWinIdx to 0
    set targetTabIdx to 0
    set winIdx to 0
    repeat with aWindow in windows
      set winIdx to winIdx + 1
      set tabIdx to 0
      repeat with aTab in tabs of aWindow
        set tabIdx to tabIdx + 1
        if (tty of aTab) is "${tty}" then
          set targetWinIdx to winIdx
          set targetTabIdx to tabIdx
          exit repeat
        end if
      end repeat
      if targetWinIdx > 0 then exit repeat
    end repeat
    if targetWinIdx is 0 then return "miss"
    set index of window targetWinIdx to 1
    delay 0.05
    set selected of tab targetTabIdx of window 1 to true
    delay 0.1
    try
      if (tty of (selected tab of front window)) is "${tty}" then return "matched"
    end try
  end tell
  return "focused"`;
  }
  async function jumpWezTerm(target) {
    let panes = [];
    try {
      const { stdout } = await execFileAsync$6(
        "wezterm",
        ["cli", "list", "--format", "json"],
        { timeout: 5e3 }
      );
      panes = JSON.parse(stdout);
    } catch {
      try {
        await execFileAsync$6("open", ["-a", "WezTerm"], { timeout: 5e3 });
      } catch {
      }
      return;
    }
    let matched;
    if (target.paneId !== void 0) {
      matched = panes.find((p) => p.pane_id === parseInt(target.paneId, 10));
    }
    if (!matched && target.tty) {
      matched = panes.find((p) => p.tty_name === target.tty);
    }
    if (!matched && target.workingDirectory) {
      const cwd = target.workingDirectory;
      const cwdUrl = `file://${cwd}`;
      matched = panes.find((p) => p.cwd === cwd || p.cwd === cwdUrl);
    }
    if (matched) {
      try {
        await execFileAsync$6(
          "wezterm",
          ["cli", "activate-tab", "--tab-id", String(matched.tab_id)],
          { timeout: 5e3 }
        );
      } catch {
      }
    }
    try {
      await execFileAsync$6("open", ["-a", "WezTerm"], { timeout: 5e3 });
    } catch {
    }
    if (!matched) return;
    const windowIds = [...new Set(panes.map((p) => p.window_id))];
    if (windowIds.length <= 1) return;
    const targetWin = matched.window_id;
    for (let i = 0; i < windowIds.length; i++) {
      const currentWin = await getWezTermFocusedWindowId(panes);
      if (currentWin === targetWin) return;
      const ok = await sendWezTermCycleWindowKeystroke();
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  async function getWezTermFocusedWindowId(panes) {
    try {
      const { stdout } = await execFileAsync$6(
        "wezterm",
        ["cli", "list-clients", "--format", "json"],
        { timeout: 3e3 }
      );
      const clients = JSON.parse(stdout);
      const fid = clients.find((c) => typeof c.focused_pane_id === "number")?.focused_pane_id;
      if (typeof fid !== "number") return void 0;
      return panes.find((p) => p.pane_id === fid)?.window_id;
    } catch {
      return void 0;
    }
  }
  async function sendWezTermCycleWindowKeystroke() {
    const script = `tell application "System Events"
    set frontmost of (first process whose bundle identifier is "com.github.wez.wezterm") to true
    delay 0.1
    keystroke "\`" using {command down}
  end tell`;
    try {
      await runAppleScript$1(script);
      return true;
    } catch {
      return false;
    }
  }
  const KAKU_CLI_CANDIDATES = [
    "kaku",
    "/Applications/Kaku.app/Contents/MacOS/kaku"
  ];
  async function runKakuCli(args, timeoutMs = 5e3) {
    let lastErr;
    for (const bin of KAKU_CLI_CANDIDATES) {
      try {
        const { stdout } = await execFileAsync$6(bin, args, { timeout: timeoutMs });
        return stdout;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("kaku cli unavailable");
  }
  function parseKakuCwd(raw) {
    if (!raw) return null;
    if (!raw.startsWith("file://")) return raw;
    const rest = raw.slice("file://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) return null;
    const path2 = rest.slice(slashIdx);
    try {
      return decodeURIComponent(path2);
    } catch {
      return path2;
    }
  }
  async function jumpKaku(target) {
    let panes = [];
    try {
      const stdout = await runKakuCli(["cli", "list", "--format", "json"]);
      panes = JSON.parse(stdout);
    } catch {
      try {
        await execFileAsync$6("open", ["-b", "fun.tw93.kaku"], { timeout: 5e3 });
      } catch {
      }
      return;
    }
    let matched;
    if (target.paneId !== void 0) {
      matched = panes.find((p) => p.pane_id === parseInt(target.paneId, 10));
    }
    if (!matched && target.tty) {
      matched = panes.find((p) => p.tty_name === target.tty);
    }
    if (!matched && target.workingDirectory) {
      const cwd = target.workingDirectory;
      matched = panes.find((p) => parseKakuCwd(p.cwd) === cwd);
    }
    if (matched) {
      try {
        await runKakuCli([
          "cli",
          "activate-tab",
          "--tab-id",
          String(matched.tab_id)
        ]);
      } catch {
      }
    }
    try {
      await execFileAsync$6("open", ["-b", "fun.tw93.kaku"], { timeout: 5e3 });
    } catch {
    }
    if (!matched) return;
    const windowIds = [...new Set(panes.map((p) => p.window_id))];
    if (windowIds.length <= 1) return;
    const targetWin = matched.window_id;
    for (let i = 0; i < windowIds.length; i++) {
      const currentWin = await getKakuFocusedWindowId(panes);
      if (currentWin === targetWin) return;
      const ok = await sendKakuCycleWindowKeystroke();
      if (!ok) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  async function getKakuFocusedWindowId(panes) {
    try {
      const stdout = await runKakuCli(
        ["cli", "list-clients", "--format", "json"],
        3e3
      );
      const clients = JSON.parse(stdout);
      const fid = clients.find((c) => typeof c.focused_pane_id === "number")?.focused_pane_id;
      if (typeof fid !== "number") return void 0;
      return panes.find((p) => p.pane_id === fid)?.window_id;
    } catch {
      return void 0;
    }
  }
  async function sendKakuCycleWindowKeystroke() {
    const script = `tell application "System Events"
    set frontmost of (first process whose bundle identifier is "fun.tw93.kaku") to true
    delay 0.1
    keystroke "\`" using {command down}
  end tell`;
    try {
      await runAppleScript$1(script);
      return true;
    } catch {
      return false;
    }
  }
  function getVSCodeFamilyMetadata(cli) {
    switch (cli) {
      case "code":
        return {
          appName: "Visual Studio Code",
          bundleId: VSCODE_BUNDLE_ID
        };
      case "code-insiders":
        return {
          appName: "Visual Studio Code - Insiders",
          bundleId: VSCODE_INSIDERS_BUNDLE_ID
        };
      case "cursor":
        return {
          appName: "Cursor",
          bundleId: CURSOR_BUNDLE_ID
        };
      case "antigravity":
        return {
          appName: "Antigravity",
          bundleId: ANTIGRAVITY_BUNDLE_ID
        };
      case "windsurf":
      default:
        return {
          appName: "Windsurf",
          bundleId: WINDSURF_BUNDLE_ID
        };
    }
  }
  async function focusVSCodeFamilyWindow(bundleId, projectName) {
    const escapedBundleId = escapeAppleScriptString(bundleId);
    const escapedProjectName = escapeAppleScriptString(projectName);
    const processWindowDumpScript = `
  tell application "System Events"
    repeat with aProcess in every process
      set processBundleId to ""
      try
        set processBundleId to bundle identifier of aProcess
      end try
      if processBundleId is "${escapedBundleId}" then
        try
          repeat with aWindow in windows of aProcess
            set windowName to ""
            try
              set windowName to name of aWindow
            end try
            if windowName contains "${escapedProjectName}" then
              set frontmost of aProcess to true
              perform action "AXRaise" of aWindow
              return "matched"
            end if
          end repeat
        end try
      end if
    end repeat
  end tell`;
    try {
      const result = await runAppleScript$1(processWindowDumpScript);
      return result.includes("matched");
    } catch (err) {
      return false;
    }
  }
  async function jumpKitty(target) {
    const sock = target.kittyListenOn;
    const id = target.tabId;
    try {
      await execFileAsync$6("open", ["-a", "kitty"], { timeout: 5e3 });
    } catch {
    }
    if (sock && id) {
      await new Promise((r) => setTimeout(r, 80));
      try {
        await execFileAsync$6(
          "kitty",
          ["@", "--to", sock, "focus-window", "--match", `id:${id}`],
          { timeout: 3e3 }
        );
      } catch {
      }
    }
  }
  async function jumpCmux(target) {
    if (target.tabId) {
      const id = escapeAppleScriptString(target.tabId);
      const focusScript = `
  tell application "cmux"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aTerminal in terminals of aTab
          if (id of aTerminal as text) is "${id}" then
            focus aTerminal
            return "focused"
          end if
        end repeat
      end repeat
    end repeat
  end tell`;
      try {
        const result = await runAppleScript$1(focusScript);
        if (result.includes("focused")) {
          const activated = await activateMacAppWithoutAllWindows(
            TERMINAL_APP_TO_BUNDLE_ID.cmux
          );
          if (activated) {
            await new Promise((r) => setTimeout(r, 120));
          }
          return;
        }
      } catch (err) {
        console.warn("[jumpCmux] AppleScript failed, falling back:", err);
      }
    }
    try {
      await execFileAsync$6("open", ["-a", "cmux"], { timeout: 5e3 });
    } catch {
    }
  }
  function ideWorkspaceOpenPath(target) {
    const definitionFilePath = target.ideWorkspace?.definitionFilePath?.trim();
    if (definitionFilePath) return definitionFilePath;
    const workspacePath = target.ideWorkspace?.path?.trim();
    if (workspacePath) return workspacePath;
    return void 0;
  }
  function windowTitleMatchNameForPath(rawPath) {
    if (!rawPath) return void 0;
    const name = rawPath.split("/").filter(Boolean).pop();
    if (!name) return void 0;
    return name.endsWith(".code-workspace") ? name.slice(0, -".code-workspace".length) : name;
  }
  function ideWorkspaceWindowTitleMatchName(target) {
    return windowTitleMatchNameForPath(ideWorkspaceOpenPath(target)) ?? windowTitleMatchNameForPath(target.workingDirectory);
  }
  async function jumpVSCodeFamily(target, cli) {
    const pathToOpen = ideWorkspaceOpenPath(target) ?? target.workingDirectory;
    if (!pathToOpen) return jumpFallback(target);
    const { appName, bundleId } = getVSCodeFamilyMetadata(cli);
    const projectName = ideWorkspaceWindowTitleMatchName(target);
    const cliCandidates = [cli, `/usr/local/bin/${cli}`];
    if (cli === "cursor")
      cliCandidates.push(
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
      );
    if (cli === "windsurf")
      cliCandidates.push(
        "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"
      );
    if (cli === "antigravity")
      cliCandidates.push(
        "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
        "/opt/homebrew/bin/agy"
      );
    let cliOpened = false;
    for (const c of cliCandidates) {
      try {
        await execFileAsync$6(c, [pathToOpen], { timeout: 5e3 });
        cliOpened = true;
        break;
      } catch {
      }
    }
    if (projectName) {
      const matched = await focusVSCodeFamilyWindow(bundleId, projectName);
      if (matched) return;
    }
    if (cliOpened) {
      try {
        await activateMacAppByBundle(bundleId);
        return;
      } catch {
      }
    }
    await execFileAsync$6("open", ["-a", appName], { timeout: 5e3 });
  }
  async function jumpCursorAgentSession(target) {
    log.debug("[TerminalJumpService] jumpCursorAgentSession:", target);
    const folderName = ideWorkspaceWindowTitleMatchName(target);
    if (folderName) {
      const escaped = folderName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `
  tell application "System Events"
    try
      set proc to first process whose bundle identifier is "${CURSOR_BUNDLE_ID}"
    on error
      return ""
    end try
    set frontmost of proc to true
    set bestWindow to missing value
    set bestLen to 999999
    repeat with w in windows of proc
      try
        set wName to name of w as text
        if wName contains "${escaped}" then
          set wLen to count of wName
          if wLen < bestLen then
            set bestWindow to w
            set bestLen to wLen
          end if
        end if
      end try
    end repeat
    if bestWindow is not missing value then
      perform action "AXRaise" of bestWindow
      return "matched"
    end if
  end tell`;
      try {
        const result = await runAppleScript$1(script);
        if (result.includes("matched")) return;
      } catch {
      }
    }
    try {
      await activateMacAppByBundle(CURSOR_BUNDLE_ID);
      return;
    } catch (err) {
      console.warn(
        "[TerminalJumpService] open -b Cursor failed, trying open -a:",
        err
      );
    }
    try {
      await execFileAsync$6("open", ["-a", "Cursor"], { timeout: 5e3 });
    } catch (err) {
      console.warn("[TerminalJumpService] open -a Cursor failed:", err);
    }
  }
  async function jumpCodexAgentSession(target, threadId, needAlreadyOpened) {
    log.debug(
      "[TerminalJumpService] jumpCodexAgentSession:",
      target,
      "threadId:",
      threadId,
      "needAlreadyOpened:",
      needAlreadyOpened
    );
    if (needAlreadyOpened) {
      const checkScript = `tell application "System Events" to count (processes whose bundle identifier is "${CODEX_APP_BUNDLE_ID}")`;
      try {
        const isRunning = await runAppleScript$1(checkScript);
        if (isRunning.trim() === "0") {
          throw new Error("Codex is not currently running");
        }
      } catch (err) {
        if (err instanceof Error && err.message === "Codex is not currently running") {
          throw err;
        }
        console.warn("[TerminalJumpService] check Codex running state failed:", err);
      }
    }
    if (threadId) {
      const url2 = `codex://threads/${encodeURIComponent(threadId)}`;
      try {
        await execFileAsync$6("open", [url2], { timeout: 5e3 });
        return;
      } catch (err) {
        console.warn(
          "[TerminalJumpService] codex:// deep link failed, falling back to app activation:",
          err
        );
      }
    }
    try {
      await activateMacAppByBundle(CODEX_APP_BUNDLE_ID);
    } catch (err) {
      console.warn(
        "[TerminalJumpService] open -b Codex failed, trying open -a:",
        err
      );
      try {
        await execFileAsync$6("open", ["-a", "Codex"], { timeout: 5e3 });
      } catch (err2) {
        console.warn("[TerminalJumpService] open -a Codex failed:", err2);
      }
    }
  }
  async function jumpClaudeAgentSession(target) {
    log.debug("[TerminalJumpService] jumpClaudeAgentSession:", target);
    // Claude Desktop 是单窗口应用，会话都在侧边栏里 —— 按窗口标题匹配那套
    // （jumpTraeAgentSession 用的办法）在这里根本无从下手，一共就一个窗口。
    //
    // 它自己注册了 claude:// 协议，其中 resume 分支的实现是：
    //   claude://resume?session=<uuid>  →  importCliSession(uuid) 并导航过去
    // 参数正是 Claude Code 的 session_id，我们在 hook 里本来就有。
    // 走深链既准确又不需要辅助功能权限。
    const sessionId = target.sessionId;
    if (sessionId && UUID_RE.test(sessionId)) {
      // 优先：本地已有对应的桌面会话记录，直接导航过去。
      // 不能拿 CLI uuid 去走 resume —— importCliSession 是按 `local_${uuid}` 查表的，
      // 而桌面会话有自己的 id（记录键是 local_<自身uuid>，cliSessionId 才是我们手上
      // 这个 uuid），查不到就会新建一条，这正是「跳过去多出一个一模一样的对话」的成因。
      // 先把窗口带到前台，深链并行送达。Claude Desktop 处理深链偏慢（大内存
      // Electron 应用，常在换页），若等它处理完才激活，观感就是「点了没反应」。
      // 并行后窗口立即前置，导航随后落位。应用未运行时两个 open 会被
      // LaunchServices 合并成单实例启动，无副作用。
      const activation = activateMacAppByBundle(CLAUDE_DESKTOP_BUNDLE_ID).catch((err) => {
        log.debug("[TerminalJumpService] parallel activation failed:", err);
      });
      const desktopId = findClaudeDesktopSessionId(sessionId);
      if (desktopId) {
        try {
          await execFileAsync$6(
            "open",
            [`claude://claude.ai/epitaxy/${encodeURIComponent(desktopId)}`],
            { timeout: 5e3 }
          );
          await activation;
          return;
        } catch (err) {
          log.debug("[TerminalJumpService] epitaxy deep link failed:", err);
        }
      } else {
        // 没有桌面记录 = 纯终端起的 CLI 会话，此时 resume 的导入正是想要的行为，
        // 且 local_<uuid> 与记录键一致，不会产生重复。
        try {
          await execFileAsync$6(
            "open",
            [`claude://resume?session=${encodeURIComponent(sessionId)}`],
            { timeout: 5e3 }
          );
          await activation;
          return;
        } catch (err) {
          log.debug("[TerminalJumpService] claude://resume failed:", err);
        }
      }
    }
    // 深链不可用时退回纯激活
    try {
      await activateMacAppByBundle(CLAUDE_DESKTOP_BUNDLE_ID);
    } catch (err) {
      console.warn(
        "[TerminalJumpService] open -b Claude desktop failed, trying open -a:",
        err
      );
      try {
        await execFileAsync$6("open", ["-a", "Claude"], { timeout: 5e3 });
      } catch (err2) {
        console.warn("[TerminalJumpService] open -a Claude failed:", err2);
      }
    }
  }
  async function jumpTraeAgentSession(target) {
    log.debug("[TerminalJumpService] jumpTraeAgentSession:", target);
    const preferred = findTraeVariantInfo(target.traeVariant) ?? findTraeVariantByApp(target.app);
    const candidates = preferred ? [preferred, ...TRAE_VARIANTS_INFO.filter((v) => v !== preferred)] : [...TRAE_VARIANTS_INFO];
    const projectName = ideWorkspaceWindowTitleMatchName(target);
    const escapedProjectName = projectName ? escapeAppleScriptString(projectName) : null;
    for (const v of candidates) {
      if (escapedProjectName) {
        const escapedBundleId = escapeAppleScriptString(v.bundleId);
        const script = `
  tell application "System Events"
    try
      set traeProcess to first process whose bundle identifier is "${escapedBundleId}"
    on error
      return ""
    end try
    set bestWindow to missing value
    set bestLen to 999999
    repeat with aWindow in windows of traeProcess
      try
        set wName to name of aWindow as text
        if wName contains "${escapedProjectName}" then
          set wLen to count of wName
          if wLen < bestLen then
            set bestWindow to aWindow
            set bestLen to wLen
          end if
        end if
      end try
    end repeat
    if bestWindow is not missing value then
      set frontmost of traeProcess to true
      perform action "AXRaise" of bestWindow
      return "matched"
    end if
  end tell`;
        try {
          const result = await runAppleScript$1(script);
          if (result.includes("matched")) return;
        } catch {
        }
      }
      const cliPathToOpen = ideWorkspaceOpenPath(target) ?? target.workingDirectory;
      if (cliPathToOpen) {
        try {
          await execFileAsync$6(v.cliPath, [cliPathToOpen], { timeout: 5e3 });
          return;
        } catch {
        }
      }
    }
    for (const v of candidates) {
      try {
        await activateMacAppByBundle(v.bundleId);
        return;
      } catch {
      }
    }
    for (const v of candidates) {
      try {
        await execFileAsync$6("open", ["-a", v.displayName], { timeout: 5e3 });
        return;
      } catch {
      }
    }
  }
  function resolveBestWorkspaceForFolder(folderPath, variantDirName) {
    if (!folderPath) return folderPath;
    try {
      const dir = path__namespace.join(
        os__namespace.homedir(),
        "Library",
        "Application Support",
        variantDirName,
        "User",
        "workspaceStorage"
      );
      if (!fs__namespace.existsSync(dir)) return folderPath;
      let bestWorkspacePath = null;
      let bestMtime = 0;
      const names = fs__namespace.readdirSync(dir);
      for (const name of names) {
        try {
          const wp = path__namespace.join(dir, name, "workspace.json");
          const dbp = path__namespace.join(dir, name, "state.vscdb");
          if (!fs__namespace.existsSync(wp) || !fs__namespace.existsSync(dbp)) continue;
          const stat = fs__namespace.statSync(dbp);
          const mtime = stat.mtimeMs;
          const json = JSON.parse(fs__namespace.readFileSync(wp, "utf8"));
          if (json.workspace && typeof json.workspace === "string" && json.workspace.startsWith("file://")) {
            const workspaceUri = json.workspace;
            let workspaceFilePath = workspaceUri.slice("file://".length);
            try {
              workspaceFilePath = decodeURIComponent(workspaceFilePath);
            } catch {
            }
            if (fs__namespace.existsSync(workspaceFilePath)) {
              const wsJson = JSON.parse(fs__namespace.readFileSync(workspaceFilePath, "utf8"));
              if (wsJson.folders && Array.isArray(wsJson.folders)) {
                const hasMatch = wsJson.folders.some((f) => {
                  if (f.path) {
                    if (f.path === folderPath) return true;
                    if (f.path === `file://${folderPath}`) return true;
                    if (!f.path.startsWith("/") && !f.path.startsWith("file://")) {
                      const absPath = path__namespace.resolve(path__namespace.dirname(workspaceFilePath), f.path);
                      if (absPath === folderPath) return true;
                    }
                  }
                  return false;
                });
                if (hasMatch && mtime > bestMtime) {
                  bestMtime = mtime;
                  bestWorkspacePath = workspaceFilePath;
                }
              }
            }
          }
        } catch (e) {
        }
      }
      return bestWorkspacePath || folderPath;
    } catch (e) {
      return folderPath;
    }
  }
  async function jumpTraeTerminalHost(target) {
    log.debug("[TerminalJumpService] jumpTraeTerminalHost:", target);
    const variant = findTraeVariantInfo(target.traeVariant) ?? findTraeVariantByApp(target.app);
    if (!variant) {
      await jumpFallback(target);
      return;
    }
    const projectName = ideWorkspaceWindowTitleMatchName(target);
    if (projectName) {
      const escapedProjectName = escapeAppleScriptString(projectName);
      const escapedBundleId = escapeAppleScriptString(variant.bundleId);
      const script = `
  tell application "System Events"
    try
      set traeProcess to first process whose bundle identifier is "${escapedBundleId}"
    on error
      return ""
    end try
    set bestWindow to missing value
    set bestLen to 999999
    repeat with aWindow in windows of traeProcess
      try
        set wName to name of aWindow as text
        if wName contains "${escapedProjectName}" then
          set wLen to count of wName
          if wLen < bestLen then
            set bestWindow to aWindow
            set bestLen to wLen
          end if
        end if
      end try
    end repeat
    if bestWindow is not missing value then
      set frontmost of traeProcess to true
      perform action "AXRaise" of bestWindow
      return "matched"
    end if
  end tell`;
      try {
        const result = await runAppleScript$1(script);
        if (result.includes("matched")) return;
      } catch {
      }
    }
    const idePathToOpen = ideWorkspaceOpenPath(target);
    if ((idePathToOpen || target.workingDirectory) && variant.cliPath) {
      try {
        const bestPathToOpen = idePathToOpen ?? resolveBestWorkspaceForFolder(target.workingDirectory, variant.dirName);
        await execFileAsync$6(variant.cliPath, [bestPathToOpen], { timeout: 8e3 });
        return;
      } catch (err) {
        console.warn(`[TerminalJumpService] CLI 打开失败 ${variant.cliPath}:`, err);
      }
    }
    try {
      await activateMacAppByBundle(variant.bundleId);
      return;
    } catch (err) {
      console.warn("[TerminalJumpService] jumpTraeTerminalHost bundle activate failed:", err);
    }
    try {
      await execFileAsync$6("open", ["-a", variant.displayName], { timeout: 5e3 });
    } catch (err) {
      console.warn("[TerminalJumpService] jumpTraeTerminalHost final open -a failed:", err);
    }
  }
  async function jumpOpenCodeAgentSession(target) {
    log.debug("[TerminalJumpService] jumpOpenCodeAgentSession:", target);
    const projectName = target.workingDirectory?.split("/").filter(Boolean).pop();
    if (projectName) {
      const escapedProjectName = projectName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `
  tell application "System Events"
    set possibleOpenCodeBundleIds to {"com.opencode.app", "com.opencode.desktop", "ai.opencode.desktop"}
    repeat with bundleId in possibleOpenCodeBundleIds
      try
        set openCodeProcess to first process whose bundle identifier is bundleId
        repeat with aWindow in windows of openCodeProcess
          try
            set windowName to name of aWindow as string
            if windowName contains "${escapedProjectName}" then
              set frontmost of openCodeProcess to true
              perform action "AXRaise" of aWindow
              return "matched"
            end if
          end try
        end repeat
      end try
    end repeat
  end tell`;
      try {
        const result = await runAppleScript$1(script);
        if (result.includes("matched")) return;
      } catch {
      }
    }
    try {
      await activateMacAppByBundle("com.opencode.app");
      return;
    } catch {
      try {
        await activateMacAppByBundle("com.opencode.desktop");
        return;
      } catch {
      }
    }
    try {
      await execFileAsync$6("open", ["-a", "OpenCode"], { timeout: 5e3 });
    } catch {
      await jumpFallback(target);
    }
  }
  async function jumpJetBrains(target, app) {
    const PROCESS_NAME_MAP = {
      "intellij idea": "idea",
      "webstorm": "webstorm",
      "pycharm": "pycharm",
      "goland": "goland",
      "clion": "clion",
      "rubymine": "rubymine",
      "phpstorm": "phpstorm",
      "rider": "rider",
      "rustrover": "rustrover"
    };
    const APP_NAME_MAP = {
      "intellij idea": "IntelliJ IDEA",
      "webstorm": "WebStorm",
      "pycharm": "PyCharm",
      "goland": "GoLand",
      "clion": "CLion",
      "rubymine": "RubyMine",
      "phpstorm": "PhpStorm",
      "rider": "Rider",
      "rustrover": "RustRover"
    };
    const processName = PROCESS_NAME_MAP[app];
    const projectName = target.workingDirectory?.split("/").filter(Boolean).pop();
    if (processName && projectName) {
      const escapedProjectName = escapeAppleScriptString(projectName);
      const script = `
  tell application "System Events"
    set proc to first process whose name is "${processName}"
    set windowCount to count of windows of proc
    if windowCount is 1 then
      set frontmost of proc to true
      delay 0.2
      set targetMenuBarItem to missing value
      repeat with aMenuBarItem in menu bar items of menu bar 1 of proc
        set menuBarItemTitle to name of aMenuBarItem
        if menuBarItemTitle is "Window" or menuBarItemTitle is "窗口" then
          set targetMenuBarItem to aMenuBarItem
          exit repeat
        end if
      end repeat
      if targetMenuBarItem is not missing value then
        repeat with aMenuItem in menu items of menu 1 of targetMenuBarItem
          set itemTitle to name of aMenuItem
          ignoring case
            if itemTitle contains "${escapedProjectName}" then
              click aMenuItem
              return "clicked"
            end if
          end ignoring
        end repeat
      end if
    else if windowCount > 1 then
      repeat with aWindow in windows of proc
        if name of aWindow starts with "${escapedProjectName}" then
          set frontmost of proc to true
          perform action "AXRaise" of aWindow
          return "matched"
        end if
      end repeat
    end if
  end tell`;
      try {
        const result = await runAppleScript$1(script);
        log.debug("[TerminalJumpService] jumpJetBrains result:", result);
        if (result.includes("matched") || result.includes("clicked")) return;
      } catch {
      }
    }
    const appName = APP_NAME_MAP[app] ?? target.app;
    try {
      await execFileAsync$6("open", ["-a", appName], { timeout: 5e3 });
      return;
    } catch {
      try {
        await execFileAsync$6("open", ["-a", `${appName} CE`], { timeout: 5e3 });
      } catch {
      }
    }
  }
  function parseTmuxSessionName(tmuxTarget) {
    if (!tmuxTarget) return void 0;
    const idx = tmuxTarget.indexOf(":");
    const name = idx > 0 ? tmuxTarget.slice(0, idx) : tmuxTarget;
    return name.trim() || void 0;
  }
  let tmuxEnvLogged = false;
  function resolveTmuxBinaryForJump(context) {
    const tmuxBin = resolveTmuxBinary();
    if (!tmuxEnvLogged) {
      tmuxEnvLogged = true;
      log.debug(
        "[TerminalJumpService] tmux env: context=%s resolved=%s shell=%s path=%s",
        context,
        tmuxBin ?? "null",
        process.env.SHELL ?? "",
        process.env.PATH ?? ""
      );
    }
    if (!tmuxBin) {
      console.warn("[TerminalJumpService] %s: tmux binary not found", context);
    }
    return tmuxBin;
  }
  async function tmuxHasSession(tmuxBin, session) {
    try {
      await execFileAsync$6(tmuxBin, ["has-session", "-t", session], { timeout: 3e3 });
      return true;
    } catch {
      return false;
    }
  }
  async function tmuxListClients(tmuxBin) {
    try {
      const { stdout } = await execFileAsync$6(
        tmuxBin,
        ["list-clients", "-F", "#{client_tty} #{client_session}"],
        { timeout: 5e3 }
      );
      return stdout.trim().split("\n").filter(Boolean).map((line) => {
        const idx = line.indexOf(" ");
        return idx > 0 ? { tty: line.slice(0, idx), session: line.slice(idx + 1) } : { tty: line, session: "" };
      });
    } catch {
      return [];
    }
  }
  async function attachTmuxInOuterHost(outer, session, tmuxBin) {
    const key = outer.toLowerCase();
    const attachCommand = escapeAppleScriptString(buildTmuxAttachCommand(tmuxBin, session));
    if (key === "terminal" || key === "apple_terminal") {
      const script = `
  tell application "Terminal"
    activate
    do script "${attachCommand}"
  end tell
  return "ok"`;
      try {
        await runAppleScript$1(script);
        return true;
      } catch (err) {
        console.warn("[TerminalJumpService] attach tmux in Terminal.app failed:", err);
        return false;
      }
    }
    if (key === "iterm2" || key === "iterm" || key === "iterm.app") {
      const script = `
  tell application "iTerm"
    activate
    create window with default profile command "${attachCommand}"
  end tell
  return "ok"`;
      try {
        await runAppleScript$1(script);
        return true;
      } catch (err) {
        console.warn("[TerminalJumpService] attach tmux in iTerm2 failed:", err);
        return false;
      }
    }
    return false;
  }
  async function jumpTmuxWithOuter(target) {
    const outer = target.tmuxOuterHost?.trim();
    const session = parseTmuxSessionName(target.tmuxTarget);
    const tmuxBin = resolveTmuxBinaryForJump("jumpTmuxWithOuter");
    if (!tmuxBin) {
      if (outer) {
        try {
          await jumpFallback({ ...target, app: outer });
        } catch (err) {
          console.warn("[TerminalJumpService] tmux fallback host activation failed:", err);
        }
      }
      return;
    }
    const clients = await tmuxListClients(tmuxBin);
    const preferred = target.tmuxClientTty;
    const exactClient = session ? clients.find((c) => c.tty === preferred && c.session === session) ?? clients.find((c) => c.session === session) : void 0;
    log.debug(
      "[TerminalJumpService] jumpTmuxWithOuter: session=%s, clients=%s, exactClient=%s",
      session,
      JSON.stringify(clients),
      JSON.stringify(exactClient)
    );
    if (exactClient) {
      if (outer) {
        const outerTarget = { ...target, app: outer };
        outerTarget.tty = exactClient.tty;
        delete outerTarget.tmuxTarget;
        try {
          await jumpToTarget(outerTarget);
        } catch (err) {
          console.warn("[TerminalJumpService] tmux outer host activation failed:", err);
        }
      }
      if (target.tmuxTarget) {
        try {
          await execFileAsync$6(tmuxBin, ["select-window", "-t", target.tmuxTarget], {
            timeout: 5e3
          });
          await execFileAsync$6(tmuxBin, ["select-pane", "-t", target.tmuxTarget], {
            timeout: 5e3
          });
        } catch (err) {
          console.warn("[TerminalJumpService] tmux select failed:", err);
        }
      }
      return;
    }
    if (clients.length > 0 && session && await tmuxHasSession(tmuxBin, session)) {
      let attached = false;
      if (outer) {
        attached = await attachTmuxInOuterHost(outer, session, tmuxBin);
      }
      if (attached && target.tmuxTarget) {
        await waitForClientOnSession(tmuxBin, session, 2e3);
        try {
          await execFileAsync$6(tmuxBin, ["select-window", "-t", target.tmuxTarget], {
            timeout: 5e3
          });
          await execFileAsync$6(tmuxBin, ["select-pane", "-t", target.tmuxTarget], {
            timeout: 5e3
          });
        } catch (err) {
          console.warn("[TerminalJumpService] tmux post-attach select failed:", err);
        }
      }
      if (attached) return;
    }
    if (clients.length === 0 && session && await tmuxHasSession(tmuxBin, session)) {
      let attached = false;
      if (outer) {
        attached = await attachTmuxInOuterHost(outer, session, tmuxBin);
      }
      if (attached) {
        if (target.tmuxTarget) {
          await waitForClientOnSession(tmuxBin, session, 2e3);
          try {
            await execFileAsync$6(tmuxBin, ["select-window", "-t", target.tmuxTarget], {
              timeout: 5e3
            });
            await execFileAsync$6(tmuxBin, ["select-pane", "-t", target.tmuxTarget], {
              timeout: 5e3
            });
          } catch (err) {
            console.warn("[TerminalJumpService] tmux post-attach select failed:", err);
          }
        }
        return;
      }
    }
    if (outer) {
      try {
        await jumpFallback({ ...target, app: outer });
      } catch (err) {
        console.warn("[TerminalJumpService] tmux fallback host activation failed:", err);
      }
    }
  }
  async function waitForClientOnSession(tmuxBin, session, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const clients = await tmuxListClients(tmuxBin);
      if (clients.some((c) => c.session === session)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
  const TERM_PROGRAM_TO_APP_NAME = {
    apple_terminal: "Terminal",
    warpterminal: "Warp",
    "iterm.app": "iTerm2",
    iterm: "iTerm2",
    iterm2: "iTerm2"
  };
  async function jumpFallback(target) {
    if (!target.app) return;
    const appName = TERM_PROGRAM_TO_APP_NAME[target.app.toLowerCase()] ?? target.app;
    try {
      await execFileAsync$6("open", ["-a", appName], { timeout: 5e3 });
    } catch (err) {
      console.warn("[TerminalJumpService] fallback open failed:", err);
    }
  }
  async function jumpToTarget(target) {
    log.debug("[TerminalJumpService] jumping to:", target);
    const app = target.app.toLowerCase();
    try {
      if (app === "ghostty") {
        await jumpGhostty(target);
      } else if (app === "iterm2" || app === "iterm" || app === "iterm.app") {
        await jumpITerm2(target);
      } else if (app === "terminal" || app === "apple_terminal") {
        await jumpTerminalApp(target);
      } else if (app === "wezterm") {
        await jumpWezTerm(target);
      } else if (app === "kaku") {
        await jumpKaku(target);
      } else if (app === "kitty") {
        await jumpKitty(target);
      } else if (app === "cmux") {
        await jumpCmux(target);
      } else if (app === "visual studio code" || app === "vs code" || app === "vscode" || app === "code") {
        await jumpVSCodeFamily(target, "code");
      } else if (app === "vs code insiders") {
        await jumpVSCodeFamily(target, "code-insiders");
      } else if (app === "cursor") {
        await jumpCursorAgentSession(target);
      } else if (TRAE_VARIANT_DISPATCH_KEYS.has(app)) {
        await jumpTraeTerminalHost(target);
      } else if (app === "windsurf") {
        await jumpVSCodeFamily(target, "windsurf");
      } else if (app === "antigravity") {
        await jumpVSCodeFamily(target, "antigravity");
      } else if (app === "intellij idea" || app === "webstorm" || app === "pycharm" || app === "goland" || app === "clion" || app === "rubymine" || app === "phpstorm" || app === "rider" || app === "rustrover") {
        await jumpJetBrains(target, app);
      } else if (app === "tmux" || target.tmuxTarget) {
        log.debug("[TerminalJumpService] dispatch tmux branch, target:", JSON.stringify(target));
        await jumpTmuxWithOuter(target);
      } else {
        await jumpFallback(target);
      }
    } catch (err) {
      console.warn("[TerminalJumpService] unhandled error:", err);
    }
  }
  function isSessionTabFocused(jumpTarget) {
    const app = jumpTarget.app.toLowerCase();
    try {
      if (app === "tmux" && jumpTarget.tmuxOuterHost && jumpTarget.tmuxClientTty) {
        return checkTmuxTab(jumpTarget);
      }
      if (app === "iterm" || app === "iterm2" || app === "iterm.app") {
        return checkITerm2Tab(jumpTarget);
      }
      if (app === "ghostty") {
        return checkGhosttyTab(jumpTarget);
      }
      if (app === "terminal" || app === "apple_terminal") {
        return checkTerminalAppTab(jumpTarget);
      }
      if (app === "wezterm") {
        return checkWezTermTab(jumpTarget);
      }
      if (app === "cmux") {
        return checkCmuxTab(jumpTarget);
      }
    } catch {
      return "skipped";
    }
    return "skipped";
  }
  function checkTmuxTab(target) {
    const outerApp = target.tmuxOuterHost.toLowerCase();
    const outerTarget = {
      ...target,
      app: target.tmuxOuterHost,
      tty: target.tmuxClientTty
    };
    if (outerApp === "iterm" || outerApp === "iterm2" || outerApp === "iterm.app") {
      return checkITerm2TabByTty(outerTarget);
    }
    if (outerApp === "terminal" || outerApp === "apple_terminal") {
      return checkTerminalAppTab(outerTarget);
    }
    if (outerApp === "wezterm") {
      return checkWezTermTab(outerTarget);
    }
    if (outerApp === "cmux") {
      return checkCmuxTab(outerTarget);
    }
    return "skipped";
  }
  function checkITerm2TabByTty(target) {
    if (!target.tty) return "skipped";
    const focusedTty = runAppleScriptSync(`
      tell application "iTerm"
        tty of current session of current tab of front window
      end tell
    `);
    if (!focusedTty) return "skipped";
    return target.tty === focusedTty ? "match" : "mismatch";
  }
  function checkITerm2Tab(target) {
    if (!target.tabId) return "skipped";
    const focusedSessionId = runAppleScriptSync(`
      tell application "iTerm"
        unique ID of current session of current tab of front window
      end tell
    `);
    if (!focusedSessionId) return "skipped";
    const colonIdx = target.tabId.indexOf(":");
    const targetGuid = colonIdx >= 0 ? target.tabId.slice(colonIdx + 1) : target.tabId;
    return targetGuid === focusedSessionId ? "match" : "mismatch";
  }
  function checkGhosttyTab(target) {
    if (!target.tabId) return "skipped";
    const focusedId = runAppleScriptSync(`
      tell application "Ghostty"
        id of focused terminal of selected tab of front window as text
      end tell
    `);
    if (!focusedId) return "skipped";
    return target.tabId === focusedId ? "match" : "mismatch";
  }
  function checkTerminalAppTab(target) {
    if (!target.tty) return "skipped";
    const focusedTTY = runAppleScriptSync(`
      tell application "Terminal"
        tty of selected tab of front window
      end tell
    `);
    if (!focusedTTY) return "skipped";
    return target.tty === focusedTTY ? "match" : "mismatch";
  }
  function checkWezTermTab(target) {
    if (!target.tty && !target.paneId) return "skipped";
    try {
      const raw = child_process.execFileSync("wezterm", ["cli", "list", "--format", "json"], {
        timeout: 2e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).toString();
      const panes = JSON.parse(raw);
      let agentPane;
      if (target.paneId !== void 0) {
        agentPane = panes.find((p) => p.pane_id === parseInt(target.paneId, 10));
      }
      if (!agentPane && target.tty) {
        agentPane = panes.find((p) => p.tty_name === target.tty);
      }
      if (!agentPane) return "skipped";
      return agentPane.is_active ? "match" : "mismatch";
    } catch {
      return "skipped";
    }
  }
  function checkCmuxTab(target) {
    if (!target.tabId && !target.tty) return "skipped";
    try {
      const cliPath = process.env.CMUX_BUNDLED_CLI_PATH || "cmux";
      const raw = child_process.execFileSync(cliPath, ["tree", "--all"], {
        timeout: 2e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).toString();
      const activeSurfaceLine = raw.split("\n").find(
        (line) => line.includes("surface ") && line.includes("◀ active")
      );
      if (!activeSurfaceLine) return "skipped";
      const ttyMatch = activeSurfaceLine.match(/tty=(\S+)/);
      if (!ttyMatch) return "skipped";
      const focusedTTY = `/dev/${ttyMatch[1]}`;
      if (!target.tty) return "skipped";
      return target.tty === focusedTTY ? "match" : "mismatch";
    } catch {
      return "skipped";
    }
  }
  function runAppleScriptSync(script) {
    try {
      const result = child_process.execFileSync("/usr/bin/osascript", ["-e", script], {
        timeout: 2e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).toString().trim();
      return result || null;
    } catch {
      return null;
    }
  }
  const execFileAsync$3 = util.promisify(child_process.execFile);
  async function sendTextToTerminal(target, text) {
    try {
      if (target.tmuxTarget) {
        log.info("[TerminalInput] using tmux, target=%s", target.tmuxTarget);
        return await sendTextViaTmux(target.tmuxTarget, text);
      }
      const app = (target.app || "").toLowerCase();
      log.info("[TerminalInput] app=%s tabId=%s tty=%s", app, target.tabId, target.tty);
      if (app === "iterm2" || app === "iterm" || app === "iterm.app") {
        return await sendTextITerm2(target, text);
      }
      if (app === "terminal" || app === "apple_terminal") {
        return await sendTextTerminalApp(target, text);
      }
      if (app === "kitty" || app === "wezterm" || app === "kaku" || app === "ghostty" || app === "cmux") {
        return { ok: false, reason: "unsupported", error: `${target.app} does not support terminal prompt continuation` };
      }
      return { ok: false, reason: "unsupported", error: `${target.app || "Unknown terminal"} does not support background text injection` };
    } catch (err) {
      log.error("[TerminalInput] error:", err);
      return { ok: false, reason: terminalPromptReason(err) ?? "command-failed", error: errorMessage$1(err) };
    }
  }
  async function sendTextViaTmux(tmuxTarget, text) {
    const tmuxBin = resolveTmuxBinary();
    if (!tmuxBin) {
      return { ok: false, reason: "command-failed", error: "tmux binary not found" };
    }
    await execFileAsync$3(tmuxBin, ["send-keys", "-l", "-t", tmuxTarget, text], {
      timeout: 5e3
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await execFileAsync$3(tmuxBin, ["send-keys", "-t", tmuxTarget, "Enter"], {
      timeout: 5e3
    });
    return { ok: true };
  }
  async function sendTextITerm2(target, text) {
    const escapedText = escapeAppleScript(text);
    let matchClause;
    if (target.tabId) {
      const colonIdx = target.tabId.indexOf(":");
      const guid = colonIdx >= 0 ? target.tabId.slice(colonIdx + 1) : target.tabId;
      log.info("[TerminalInput:iTerm2] tabId=%s guid=%s", target.tabId, guid);
      matchClause = `(unique ID of aSession) is "${escapeAppleScript(guid)}"`;
    } else if (target.tty) {
      log.info("[TerminalInput:iTerm2] matching by tty=%s", target.tty);
      matchClause = `(tty of aSession) is "${escapeAppleScript(target.tty)}"`;
    } else {
      return { ok: false, reason: "missing-target", error: "iTerm2: missing tabId or tty for session lookup" };
    }
    const script = `
  tell application "iTerm"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        repeat with aSession in sessions of aTab
          if ${matchClause} then
            tell aSession to write text "${escapedText}" newline no
            delay 0.5
            tell aSession to write text "" newline yes
            return "sent"
          end if
        end repeat
      end repeat
    end repeat
    return "not_found"
  end tell`;
    const result = await runAppleScriptForTerminalPrompt(script);
    if (result.includes("sent")) return { ok: true };
    return { ok: false, reason: "terminal-session-not-found", error: "iTerm2: target session not found" };
  }
  async function sendTextTerminalApp(target, text) {
    if (!target.tty) {
      return { ok: false, reason: "missing-target", error: "Terminal.app: missing tty for tab lookup" };
    }
    const escapedText = escapeAppleScript(text);
    const escapedTty = escapeAppleScript(target.tty);
    const script = `
  tell application "Terminal"
    repeat with aWindow in windows
      repeat with aTab in tabs of aWindow
        if (tty of aTab) is "${escapedTty}" then
          do script "${escapedText}" in aTab
          delay 0.5
          do script "" in aTab
          return "sent"
        end if
      end repeat
    end repeat
    return "not_found"
  end tell`;
    const result = await runAppleScriptForTerminalPrompt(script);
    if (result.includes("sent")) return { ok: true };
    return { ok: false, reason: "terminal-session-not-found", error: "Terminal.app: target tab not found" };
  }
  async function runAppleScriptForTerminalPrompt(script) {
    try {
      return await runAppleScript(script);
    } catch (err) {
      const error = errorMessage$1(err);
      const reason = classifyAppleScriptError(err);
      throw Object.assign(new Error(error), { terminalPromptReason: reason });
    }
  }
  async function runAppleScript(script) {
    const { stdout } = await execFileAsync$3("/usr/bin/osascript", ["-e", script], {
      timeout: 5e3
    });
    return stdout.trim();
  }
  function classifyAppleScriptError(err) {
    const text = errorSearchText(err);
    if (text.includes("-1743")) return "automation-denied";
    if (text.includes("erraeeventnotpermitted")) return "automation-denied";
    const hasAppleEventContext = text.includes("appleevent") || text.includes("apple event") || text.includes("apple events");
    const hasPermissionText = text.includes("not permitted") || text.includes("not authorized") || text.includes("not authorised") || text.includes("not allowed");
    if (hasAppleEventContext && hasPermissionText) return "automation-denied";
    return "unknown";
  }
  function errorMessage$1(err) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
  function errorSearchText(err) {
    const parts = [errorMessage$1(err)];
    if (typeof err === "object" && err) {
      const maybe = err;
      if (maybe.code !== void 0) parts.push(String(maybe.code));
      if (typeof maybe.stderr === "string") parts.push(maybe.stderr);
      if (typeof maybe.stdout === "string") parts.push(maybe.stdout);
      if (maybe.terminalPromptReason !== void 0) parts.push(String(maybe.terminalPromptReason));
    }
    return parts.join("\n").toLowerCase();
  }
  function terminalPromptReason(err) {
    if (typeof err !== "object" || !err) return void 0;
    const reason = err.terminalPromptReason;
    if (reason === "automation-denied" || reason === "terminal-session-not-found" || reason === "unsupported" || reason === "missing-target" || reason === "command-failed" || reason === "unknown") {
      return reason;
    }
    return void 0;
  }
  function escapeAppleScript(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, '" & return & "').replace(/\r/g, "");
  }
  return {
    getSessionBundleIds,
    jumpToTarget,
    isSessionTabFocused,
    sendTextToTerminal,
    shouldUseToolJumpHandler,
    jumpCursorAgentSession,
    jumpCodexAgentSession,
    jumpClaudeAgentSession,
    jumpOpenCodeAgentSession,
    jumpTraeAgentSession
  };
}

module.exports = { createTerminalNavigation };
