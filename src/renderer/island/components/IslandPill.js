import { R as React, i as i18n } from "../../vendor/react-runtime.js";
import { s as sanitizeAgentDisplayText } from "../../shared/formatters.js";
import { d as defaultIcon, b as approvalIcon, c as completeIcon, r as runningIcon } from "./IslandPanel.js";
function requiresAttention(phase) {
  return phase === "waitingForApproval" || phase === "waitingForAnswer";
}
const DEFAULT_NOTCH_INFO = {
  hasNotch: false,
  screenWidth: 0,
  screenHeight: 0,
  screenOriginX: 0,
  screenOriginY: 0,
  scaleFactor: 1,
  notchHeight: 0,
  notchWidth: 0,
  menuBarHeight: 0
};
const STATUS_ICONS = {
  idle: defaultIcon,
  running: runningIcon,
  waitingForApproval: approvalIcon,
  completed: completeIcon
};
function dominantPhase(sessions) {
  for (const phase of ["waitingForApproval", "waitingForAnswer", "running", "completed"]) {
    if (sessions.some((s) => s.phase === phase && !s.isPullColdCompleteSession)) return phase;
  }
  return null;
}
function getLatestActivity(sessions) {
  const runningSessions = sessions.filter((s) => s.phase === "running").sort((a, b) => b.updatedAt - a.updatedAt);
  if (runningSessions.length === 0) return "";
  const latest = runningSessions[0];
  const prompt = sanitizeAgentDisplayText(latest.latestUserPrompt || "");
  if (prompt) return `${i18n.k680472829({ placeholder1: prompt }, "你：{placeholder1}")}`;
  return sanitizeAgentDisplayText(latest.currentActivity || "");
}
function derivePillDisplay(sessions, visibleCount, hasNotch) {
  const phase = dominantPhase(sessions);
  let status = "idle";
  let icon = STATUS_ICONS.idle;
  let label = null;
  if (visibleCount === 0) ;
  else if (phase === "waitingForApproval" || phase === "waitingForAnswer") {
    status = "waitingForApproval";
    icon = STATUS_ICONS.waitingForApproval;
    label = /* @__PURE__ */ React.createElement("span", { className: "pill-label-attention" }, "Please note");
  } else if (phase === "completed") {
    const completedCount = sessions.filter((s) => s.phase === "completed" && !s.isPullColdCompleteSession).length;
    status = "completed";
    icon = STATUS_ICONS.completed;
    label = /* @__PURE__ */ React.createElement("span", { className: "pill-label-completed" }, completedCount, " Completed");
  } else if (phase === "running") {
    status = "running";
    icon = STATUS_ICONS.running;
    const activity = getLatestActivity(sessions);
    label = activity || "In Progress";
  }
  if (hasNotch) {
    label = null;
  } else if (visibleCount === 0) {
    label = "Orca";
  }
  return { status, icon, label };
}
function IslandPill({ sessions, visibleCount, hasNotch, onClick }) {
  const { status, icon, label } = derivePillDisplay(sessions, visibleCount, hasNotch);
  const isIdle = status === "idle";
  return /* @__PURE__ */ React.createElement("div", { className: "pill", onClick }, /* @__PURE__ */ React.createElement("div", { className: "pill-left" }, /* @__PURE__ */ React.createElement("img", { className: "pill-icon-img", src: icon, alt: "", draggable: false })), label && /* @__PURE__ */ React.createElement("div", { className: `pill-label${isIdle ? " pill-label-idle" : ""}` }, label), /* @__PURE__ */ React.createElement("div", { className: "pill-right" }, visibleCount > 0 && /* @__PURE__ */ React.createElement("div", { className: "pill-count" }, visibleCount)));
}
function buildNotchPath(left, right, bottom, topRadius, bottomRadius, topInset = 0) {
  const width = right - left;
  const tR = Math.min(topRadius, width / 4, bottom / 4);
  const bR = Math.min(bottomRadius, width / 4, bottom / 2);
  const top = -topInset;
  return [
    `M ${left},${top}`,
    `H ${right}`,
    `A ${tR},${tR} 0 0,0 ${right - tR},${top + tR}`,
    `V ${bottom - bR}`,
    `A ${bR},${bR} 0 0,1 ${right - tR - bR},${bottom}`,
    `H ${left + tR + bR}`,
    `A ${bR},${bR} 0 0,1 ${left + tR},${bottom - bR}`,
    `V ${top + tR}`,
    `A ${tR},${tR} 0 0,0 ${left},${top}`,
    "Z"
  ].join(" ");
}
function getIslandClipShape({
  bodyWidth,
  bottom,
  bottomRadius,
  topInset = 0,
  topRadius,
  windowWidth
}) {
  const outerWidth = Math.min(bodyWidth + 2 * Math.min(topRadius, bottomRadius), windowWidth);
  const left = Math.max(0, (windowWidth - outerWidth) / 2);
  const right = windowWidth - left;
  return {
    clipPath: `path('${buildNotchPath(left, right, bottom, topRadius, bottomRadius, topInset)}')`,
    left,
    outerWidth,
    right
  };
}
function getIslandMaxBodyWidth({
  bottomRadius,
  topRadius,
  windowWidth
}) {
  return Math.max(0, windowWidth - 2 * Math.min(topRadius, bottomRadius));
}
export {
  DEFAULT_NOTCH_INFO as D,
  IslandPill as I,
  getIslandMaxBodyWidth as a,
  dominantPhase as d,
  getIslandClipShape as g,
  requiresAttention as r
};
