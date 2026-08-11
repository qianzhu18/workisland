import { i as i18n } from "../vendor/react-runtime.js";
const fireHighIcon = new URL("./fire-high.png", import.meta.url).href;
const fireMiddleIcon = new URL("./fire-middle.png", import.meta.url).href;
const fireLowIcon = new URL("./fire-low.png", import.meta.url).href;
function cleanAppName(appName) {
  if (appName.toLowerCase() === "trae cn") return "TRAE CN";
  if (appName.toLowerCase() === "trae") return "TRAE";
  if (["flux", "orca"].includes(appName.toLowerCase())) return "Orca";
  return appName.endsWith(".app") ? appName.slice(0, -4) : appName;
}
function sanitizeAgentDisplayText(raw) {
  let s = raw.trim();
  if (!s) return "";
  if (!/<task-notification\b/i.test(s)) return s;
  s = s.replace(/<task-notification\b[^>]*>[\s\S]*?<\/task-notification>/gi, "").trim();
  s = s.replace(/<task-notification\b[\s\S]*/gi, "").trim();
  return s.trim();
}
function uniq(items) {
  return [...new Set(items)];
}
function basenameOfPath(p, trailingSlash = false) {
  const parts = p.split(/[/\\]/).filter(Boolean);
  const name = parts[parts.length - 1] || p;
  return trailingSlash ? `${name}/` : name;
}
function formatList(items, max = 2) {
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length <= max) return cleaned.join("、");
  return `${i18n.k3760958615({ placeholder1: cleaned.slice(0, max).join("、"), placeholder2: cleaned.length }, "{placeholder1} 等{placeholder2}项")}`;
}
function stripBashRedirections(cmd) {
  return cmd.replace(/\s+\d?>>\s+\S+[\s\S]*$/g, "").replace(/\s+\d?>\s+\S+[\s\S]*$/g, "").trim();
}
function extractRulePrefix(rule) {
  const s = rule.trim();
  if (!s) return "";
  if (s.endsWith("/**")) return s.slice(0, -3);
  const star = s.indexOf("*");
  if (star >= 0) return s.slice(0, star + 1);
  return s;
}
function extractRules(s) {
  const raw = s.rules;
  return Array.isArray(raw) ? raw : [];
}
function extractDirectories(s) {
  const raw = s.directories;
  return Array.isArray(raw) ? raw.map(String) : [];
}
function buildApproveAlwaysTooltip(req) {
  const suggestions = req.permissionSuggestions;
  if (!suggestions || suggestions.length === 0) return void 0;
  const allRules = suggestions.filter((s) => s.type === "addRules").flatMap(extractRules);
  const readPaths = allRules.filter((r) => r?.toolName === "Read").map((r) => String(r?.ruleContent ?? "")).map(extractRulePrefix).filter(Boolean);
  const directories = suggestions.filter((s) => s.type === "addDirectories").flatMap(extractDirectories).map((p) => String(p)).filter(Boolean);
  const shellCommands = allRules.filter((r) => r?.toolName === req.toolName).map((r) => String(r?.ruleContent ?? "")).map(extractRulePrefix).map((c) => req.toolName === "Bash" ? stripBashRedirections(c) : c).filter(Boolean);
  const uniqRead = uniq(readPaths);
  const uniqDirs = uniq(directories);
  const uniqCmds = uniq(shellCommands);
  const hasRead = uniqRead.length > 0;
  const hasDirs = uniqDirs.length > 0;
  const hasCmds = uniqCmds.length > 0;
  const pathNames = uniq([...uniqDirs, ...uniqRead]).map((p) => basenameOfPath(p, true));
  const cmdNames = uniqCmds;
  let label;
  if (hasDirs && !hasRead && !hasCmds)
    label = `${i18n.k2869054726({ placeholder1: formatList(pathNames) }, "将始终允许访问：{placeholder1}")}`;
  else if (hasRead && !hasDirs && !hasCmds)
    label = `${i18n.k2328913338({ placeholder1: formatList(pathNames) }, "将始终允许读取：{placeholder1}")}`;
  else if (hasCmds && !hasDirs && !hasRead)
    label = `${i18n.k4228512737({ placeholder1: formatList(cmdNames) }, "将不再询问：{placeholder1}")}`;
  else if ((hasDirs || hasRead) && hasCmds) {
    label = `${i18n.k1213928192({ placeholder1: formatList(pathNames), placeholder2: formatList(cmdNames) }, "将始终允许：访问 {placeholder1}；执行 {placeholder2}")}`;
  } else if (hasDirs && hasRead && !hasCmds) {
    label = `${i18n.k2869054726({ placeholder1: formatList(pathNames) }, "将始终允许访问：{placeholder1}")}`;
  }
  if (label) return label;
  return void 0;
}
function getFireIconByTokenCount(tokenCount) {
  if (tokenCount === void 0 || typeof tokenCount === "string") {
    return fireHighIcon;
  }
  if (tokenCount <= 5e6) {
    return fireLowIcon;
  }
  if (tokenCount <= 5e7) {
    return fireMiddleIcon;
  }
  return fireHighIcon;
}
export {
  buildApproveAlwaysTooltip as b,
  cleanAppName as c,
  getFireIconByTokenCount as g,
  sanitizeAgentDisplayText as s
};
