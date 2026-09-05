"use strict";

/**
 * B-9 Developer API（对标 Notchy 127.0.0.1:9999）。
 *
 * 边界约束：
 * - loopback-only（127.0.0.1）只读状态端点，默认关闭，需在设置中显式开启；
 * - 配置了访问令牌时，请求必须携带 Bearer 令牌（或 ?token=），否则 401；
 * - 响应只包含会话状态元数据（id / Agent / phase / 时间），绝不包含
 *   prompt、transcript、文件路径或审批内容。
 */

const http = require("node:http");
const log = require("electron-log");

const DEFAULT_PORT = 9938;

let serverState = null; // { server, port }

function buildStatusPayload(coordinator) {
  const sessions = (coordinator.getSessions?.() || []).map((session) => ({
    id: session.id ?? null,
    agent: session.tool || session.agent || null,
    phase: session.phase ?? null,
    startedAt: session.startedAt ?? null,
    updatedAt: session.updatedAt ?? null
  }));
  return {
    ok: true,
    app: "WorkIsland",
    version: coordinator.getAppVersion?.() || null,
    platform: process.platform,
    sessions,
    generatedAt: new Date().toISOString()
  };
}

function handleDeveloperApiRequest(coordinator, apiSettings, req, res) {
  if (req.url.split("?")[0] !== "/api/status") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }
  const token = String(apiSettings?.token || "").trim();
  if (token) {
    const header = String(req.headers.authorization || "");
    const urlToken = new URL(req.url, "http://127.0.0.1").searchParams.get("token") || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : urlToken;
    if (provided !== token) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(buildStatusPayload(coordinator)));
}

function stopDeveloperApi() {
  if (!serverState) return false;
  const { server } = serverState;
  serverState = null;
  try {
    server.close();
  } catch (err) {
    log.warn("[developer-api] close failed:", err?.message ?? String(err));
  }
  return true;
}

function syncDeveloperApi(coordinator) {
  const api = coordinator.getSettings?.()?.developerApi;
  const wantRunning = !!api?.enabled;
  if (!wantRunning) return stopDeveloperApi();
  const port = Number(api.port) > 0 ? Number(api.port) : DEFAULT_PORT;
  if (serverState && serverState.port === port) return true;
  stopDeveloperApi();
  const server = http.createServer((req, res) => handleDeveloperApiRequest(coordinator, api, req, res));
  server.on("error", (err) => {
    log.warn("[developer-api] server error:", err?.message ?? String(err));
    if (serverState?.server === server) serverState = null;
  });
  server.listen(port, "127.0.0.1", () => {
    serverState = { server, port };
    log.info(`[developer-api] listening on 127.0.0.1:${port}`);
  });
  serverState = { server, port };
  return true;
}

module.exports = { DEFAULT_PORT, buildStatusPayload, handleDeveloperApiRequest, syncDeveloperApi, stopDeveloperApi };
