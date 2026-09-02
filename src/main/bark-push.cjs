"use strict";

/**
 * B-8 Bark 手机推送（对标 Vibe Island v1.0.44 的四类事件推送）。
 *
 * 边界约束：
 * - 默认关闭，只在用户填写自己的 Bark 端点（官方或自托管）后生效；
 * - 只推送事件类型与 Agent 展示名，不带 prompt / transcript / 路径 / 审批内容；
 * - 请求失败只记日志，绝不影响本地声音与岛的行为。
 */

const log = require("electron-log");

const EVENT_TITLES = {
  approval: "等待审批",
  question: "等待你的回答",
  completed: "任务完成",
  failed: "任务失败"
};

function describeEvent(eventId) {
  return EVENT_TITLES[eventId] || "WorkIsland 更新";
}

function buildBarkUrl(barkSettings, eventId, agentName = "") {
  const base = String(barkSettings?.url || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const title = describeEvent(eventId);
  const body = agentName ? `${agentName} 有新动态` : "WorkIsland";
  return `${base}/${encodeURIComponent(title)}/${encodeURIComponent(body)}?group=WorkIsland`;
}

async function pushBarkNotification(settings, eventId, agentName = "") {
  const bark = settings?.barkPush;
  if (!bark?.enabled) return false;
  // 事件白名单：只有用户开启的事件类型才离开本机（appLaunch 默认不推）。
  if (!bark.events?.[eventId]) return false;
  const url = buildBarkUrl(bark, eventId, agentName);
  if (!url) return false;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      log.warn("[bark-push] endpoint responded with", response.status);
      return false;
    }
    return true;
  } catch (err) {
    log.warn("[bark-push] request failed:", err?.message ?? String(err));
    return false;
  }
}

module.exports = { EVENT_TITLES, describeEvent, buildBarkUrl, pushBarkNotification };
