"use strict";

// Agent Doctor：把各 hook manager 的健康检查结果（issues 字符串数组）归类为
// 可行动的结构化状态。本模块是纯函数、只读；真正改配置的修复动作走各
// manager 既有 install 路径（PR2），这里不触碰任何文件。

const AGENT_DOCTOR_STATUS = Object.freeze({
  OK: "ok",
  NOT_INSTALLED: "not_installed",
  NOT_RUNNING: "not_running",
  HOOK_MISSING: "hook_missing",
  HOOK_STALE: "hook_stale",
  HOOK_INVALID: "hook_invalid",
  ERROR: "error"
});

const STALE_PATTERN = /stale hook|stale command/i;
const MISSING_PATTERN = /no hooks section|not found|not installed|not registered|not enabled|尚未连接|未启用|manifest missing|config file/i;
const NOT_RUNNING_PATTERN = /请先启动/i;
const HEALTH_ERROR_PATTERN = /health check error/i;

function diagnoseReport(report) {
  const issues = (report?.issues || []).filter(Boolean).map(String);
  if (issues.some((issue) => HEALTH_ERROR_PATTERN.test(issue))) {
    return { status: AGENT_DOCTOR_STATUS.ERROR, repairable: false, reasons: issues };
  }
  if (issues.some((issue) => NOT_RUNNING_PATTERN.test(issue))) {
    return { status: AGENT_DOCTOR_STATUS.NOT_RUNNING, repairable: false, reasons: issues };
  }
  if (!report?.installed) {
    if (report?.available === false) {
      return { status: AGENT_DOCTOR_STATUS.NOT_INSTALLED, repairable: false, reasons: issues };
    }
    return {
      status: AGENT_DOCTOR_STATUS.HOOK_MISSING,
      repairable: true,
      reasons: issues.length ? issues : ["Hook 未安装"]
    };
  }
  if (issues.some((issue) => NOT_RUNNING_PATTERN.test(issue))) {
    return { status: AGENT_DOCTOR_STATUS.NOT_RUNNING, repairable: false, reasons: issues };
  }
  if (issues.some((issue) => STALE_PATTERN.test(issue))) {
    return { status: AGENT_DOCTOR_STATUS.HOOK_STALE, repairable: true, reasons: issues };
  }
  if (issues.some((issue) => MISSING_PATTERN.test(issue))) {
    return { status: AGENT_DOCTOR_STATUS.HOOK_MISSING, repairable: true, reasons: issues };
  }
  if (issues.length) {
    return { status: AGENT_DOCTOR_STATUS.HOOK_INVALID, repairable: true, reasons: issues };
  }
  return { status: AGENT_DOCTOR_STATUS.OK, repairable: false, reasons: [] };
}

function summarizeDiagnosis(reports) {
  const summary = {
    total: reports?.length || 0,
    ok: 0,
    repairable: 0,
    notInstalled: 0,
    blocked: 0,
    repairableAgentIds: []
  };
  for (const report of reports || []) {
    const diagnosis = diagnoseReport(report);
    switch (diagnosis.status) {
      case AGENT_DOCTOR_STATUS.OK:
        summary.ok += 1;
        break;
      case AGENT_DOCTOR_STATUS.NOT_INSTALLED:
        summary.notInstalled += 1;
        break;
      case AGENT_DOCTOR_STATUS.NOT_RUNNING:
      case AGENT_DOCTOR_STATUS.ERROR:
        summary.blocked += 1;
        break;
      default:
        summary.repairable += 1;
        summary.repairableAgentIds.push(report.agentId);
    }
  }
  return summary;
}

module.exports = {
  AGENT_DOCTOR_STATUS,
  diagnoseReport,
  summarizeDiagnosis
};
