import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";
import { h as getAgentLabel } from "../../shared/settings.js";
import { s as sanitizeAgentDisplayText } from "../../shared/formatters.js";
import { terminalPendingSessions } from "./terminal-notification-policy.mjs";

export function TerminalAgentNotices({ sessions, onOpen }) {
  const pending = terminalPendingSessions(sessions);
  if (!pending.length) return null;
  return React.createElement("details", { className: "terminal-agent-notices" },
    React.createElement("summary", null, t("terminal.notices.pending", { count: pending.length })),
    React.createElement("ul", { "aria-label": t("terminal.notices.title") }, pending.map(session => {
      const label = getAgentLabel(session.tool);
      const status = session.phase === "waitingForApproval" ? "approval" : session.phase === "waitingForAnswer" ? "question" : "error";
      return React.createElement("li", { key: session.id }, React.createElement("button", {
        type: "button", className: "terminal-agent-notice", "data-agent-session-id": session.id, onClick: () => onOpen?.(session.id)
      }, React.createElement("strong", null, sanitizeAgentDisplayText(session.title || label)),
      React.createElement("span", null, `${label} · ${t(`terminal.notices.${status}`)}`)));
    })));
}
