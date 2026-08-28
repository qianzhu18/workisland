#!/usr/bin/env node
"use strict";

// workisland-cli — AI-facing customization interface for WorkIsland.
//
// Lets any local agent (or human) customize the island background theme and
// the desktop-pet sprite over the same local-only Unix socket bridge the
// agent hooks use. Zero network exposure, zero third-party dependencies.
//
// Full documentation: docs/AI-CUSTOMIZATION.md (also printable via
// `workisland-cli manual`).

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_BRIDGE_ERROR = 2;
const EXIT_VALIDATION = 3;

const USAGE = `workisland-cli — WorkIsland AI 自定义接口

用法:
  workisland-cli appearance get                                读取当前岛屿主题与桌宠配置
  workisland-cli appearance set --json '<主题JSON>'            设置岛屿背景(纯色/渐变/图片)
  workisland-cli appearance set --file <theme.json>            从文件读取主题 JSON
  ... | workisland-cli appearance set                          从 stdin 读取主题 JSON
  workisland-cli appearance set --image <bg.png> --json '{"kind":"image"}'  安装并使用背景图
  workisland-cli appearance reset                              恢复默认黑色岛屿
  workisland-cli pet list                                      列出全部可用桌宠
  workisland-cli pet set <sprite>                              切换桌宠(如 codex:qianxue / my-pet.webp)
  workisland-cli pet install <sprite.png|webp> [--name <name>] [--no-select]  安装(并默认选用)精灵图
  workisland-cli validate <sprite.png|webp>                    校验精灵图几何尺寸(生成-校验-重试闭环)
  workisland-cli manual                                        输出完整 AI 接口手册

选项:
  --socket <path>   指定 bridge socket 路径(默认 $FLUX_SOCKET_PATH 或 ~/.flux/run/bridge.sock)

退出码: 0 成功; 1 用法错误; 2 桥接/服务错误; 3 校验失败(输入不合法)
`;

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

/**
 * Strip global flags (and their values) so subcommand position is free.
 */
function stripGlobalFlags(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--socket") {
      i += 1; // skip the value
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

/**
 * Parse CLI arguments into a dispatch plan. Exported for unit tests.
 * Returns { action: "usage" } on malformed input.
 */
function parseArgs(argv) {
  const all = argv.slice(2);
  const socketPath = readArgValue(all, "--socket");
  const rest = stripGlobalFlags(all);
  if (rest.length === 0) return { action: "usage" };
  const [group, sub] = rest;

  if (group === "manual") return { action: "manual", socketPath };

  if (group === "appearance") {
    if (sub === "get") return { action: "appearance-get", socketPath };
    if (sub === "reset") return { action: "appearance-reset", socketPath };
    if (sub === "set") {
      const jsonArg = readArgValue(rest, "--json");
      const fileArg = readArgValue(rest, "--file");
      const imageArg = readArgValue(rest, "--image");
      if (!jsonArg && !fileArg) {
        // JSON is expected on stdin when neither --json nor --file is given.
        if (process.stdin.isTTY) return { action: "usage", error: "appearance set 需要 --json、--file 或管道 stdin" };
      }
      return { action: "appearance-set", jsonArg, fileArg, imageArg, socketPath };
    }
    return { action: "usage" };
  }

  if (group === "pet") {
    if (sub === "list") return { action: "pet-list", socketPath };
    if (sub === "set") {
      const sprite = rest[2];
      if (!sprite) return { action: "usage", error: "pet set 需要 <sprite> 参数" };
      return { action: "pet-set", sprite, socketPath };
    }
    if (sub === "install") {
      const sourcePath = rest[2];
      if (!sourcePath) return { action: "usage", error: "pet install 需要 <sprite 文件路径>" };
      return {
        action: "pet-install",
        sourcePath,
        name: readArgValue(rest, "--name"),
        select: !hasFlag(rest, "--no-select"),
        socketPath
      };
    }
    return { action: "usage" };
  }

  if (group === "validate") {
    const sourcePath = rest[1];
    if (!sourcePath) return { action: "usage", error: "validate 需要 <文件路径>" };
    return { action: "validate", sourcePath, socketPath };
  }

  return { action: "usage" };
}

/**
 * Turn a parsed plan into the bridge command frame. Exported for unit
 * tests; throws Error with a readable message on bad JSON / bad files.
 */
async function buildBridgeCommand(plan) {
  switch (plan.action) {
    case "appearance-get":
      return { type: "getAppearance" };
    case "appearance-reset":
      return { type: "resetAppearance" };
    case "appearance-set": {
      let raw = plan.jsonArg;
      if (!raw && plan.fileArg) {
        raw = fs.readFileSync(path.resolve(plan.fileArg), "utf8");
      }
      if (!raw) raw = await readStdin();
      let appearance;
      try {
        appearance = JSON.parse(raw);
      } catch (err) {
        throw new Error(`主题 JSON 解析失败: ${err.message}`);
      }
      const command = { type: "setAppearance", appearance };
      if (plan.imageArg) command.imageSource = { sourcePath: plan.imageArg };
      return command;
    }
    case "pet-list":
      return { type: "listPets" };
    case "pet-set":
      return { type: "setPet", sprite: plan.sprite };
    case "pet-install":
      return { type: "installPet", sourcePath: plan.sourcePath, name: plan.name, select: plan.select };
    case "validate":
      return { type: "validateSprite", sourcePath: plan.sourcePath };
    default:
      throw new Error(`unsupported action: ${plan.action}`);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("stdin payload exceeds 1 MB"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function resolveSocketPath(override) {
  return override || process.env.FLUX_SOCKET_PATH || path.join(os.homedir(), ".flux", "run", "bridge.sock");
}

/**
 * Connect to the bridge, handshake, send one command, wait for the response
 * envelope ({ type: "result", data } | { type: "error", code, message }).
 */
function sendBridgeCommand(socketPath, command, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let commandSent = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`连接 WorkIsland 超时（socket: ${socketPath}）。请确认 WorkIsland 正在运行。`));
    }, timeoutMs);
    const finish = (value) => {
      clearTimeout(timer);
      socket.end();
      resolve(value);
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type === "hello" && !commandSent) {
          commandSent = true;
          socket.write(`${JSON.stringify({ type: "command", command })}\n`);
          continue;
        }
        if (message.type === "response") finish(message.response);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法连接 WorkIsland（socket: ${socketPath}）: ${err.message}。请确认应用已启动。`));
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!commandSent) reject(new Error("bridge closed before handshake"));
    });
  });
}

// ── Manual ──────────────────────────────────────────────────────────────────

const FALLBACK_MANUAL = `# WorkIsland AI 自定义接口(内嵌简版)

完整手册未能定位。核心用法:

  workisland-cli appearance get                          # 读取当前主题
  workisland-cli appearance set --json '{"kind":"solid","color":"#123456","opacity":1}'
  workisland-cli appearance reset                        # 恢复默认
  workisland-cli pet list / pet set <sprite> / pet install <file>
  workisland-cli validate <file>                         # 校验精灵图几何

主题 JSON: {kind: default|solid|gradient|image, color, color2, angle, opacity, imageRef, imageDim}
精灵图协议: Codex V2 1536x2288(8列x11行,cell 192x208) 或 Orca v1 1024x896(8列x7行,cell 128x128)
仓库完整文档: docs/AI-CUSTOMIZATION.md
`;

function resolveManualPath() {
  if (process.env.WORKISLAND_MANUAL_PATH) return process.env.WORKISLAND_MANUAL_PATH;
  // Packaged layout: Resources/ai-manual/AI-CUSTOMIZATION.md next to app.asar.
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "ai-manual", "AI-CUSTOMIZATION.md");
    if (fs.existsSync(packaged)) return packaged;
  }
  // Dev layout: <repo>/src/island/workisland-cli/index.cjs → <repo>/docs/…
  const dev = path.resolve(__dirname, "..", "..", "..", "docs", "AI-CUSTOMIZATION.md");
  if (fs.existsSync(dev)) return dev;
  return null;
}

function readManual() {
  const manualPath = resolveManualPath();
  if (!manualPath) return FALLBACK_MANUAL;
  try {
    return fs.readFileSync(manualPath, "utf8");
  } catch {
    return FALLBACK_MANUAL;
  }
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  const plan = parseArgs(process.argv);
  if (plan.action === "usage") {
    if (plan.error) process.stderr.write(`错误: ${plan.error}\n\n`);
    process.stdout.write(USAGE);
    return plan.error ? EXIT_USAGE : EXIT_OK;
  }
  if (plan.action === "manual") {
    process.stdout.write(readManual());
    return EXIT_OK;
  }

  const command = await buildBridgeCommand(plan);
  const response = await sendBridgeCommand(resolveSocketPath(plan.socketPath), command);
  if (!response || typeof response !== "object") {
    process.stderr.write(`${JSON.stringify({ ok: false, error: "bridge returned an unreadable response" })}\n`);
    return EXIT_BRIDGE_ERROR;
  }
  if (response.type === "result") {
    process.stdout.write(`${JSON.stringify({ ok: true, ...response.data }, null, 2)}\n`);
    // `validate` answers as data even for failed checks; mirror the outcome
    // in the exit code so scripts can branch without parsing JSON.
    if (plan.action === "validate" && response.data?.ok === false) return EXIT_VALIDATION;
    return EXIT_OK;
  }
  if (response.type === "error") {
    process.stderr.write(`${JSON.stringify({ ok: false, code: response.code ?? "ERROR", error: response.message ?? "unknown error" }, null, 2)}\n`);
    return response.code === "VALIDATION" ? EXIT_VALIDATION : EXIT_BRIDGE_ERROR;
  }
  // Legacy envelopes (acknowledged / hookDirective) — not expected here.
  process.stderr.write(`${JSON.stringify({ ok: false, error: "unexpected bridge response", response }, null, 2)}\n`);
  return EXIT_BRIDGE_ERROR;
}

async function run() {
  try {
    process.exitCode = await main();
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "CLI", error: err.message }, null, 2)}\n`);
    process.exitCode = EXIT_USAGE;
  }
}

if (require.main === module) void run();

module.exports = {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_BRIDGE_ERROR,
  EXIT_VALIDATION,
  USAGE,
  FALLBACK_MANUAL,
  parseArgs,
  buildBridgeCommand,
  resolveSocketPath,
  resolveManualPath,
  readManual,
  sendBridgeCommand,
  run
};
