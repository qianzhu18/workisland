import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";

const reasonKey = {
  "automation-denied": "terminal.external.permissionDenied",
  "not-found": "terminal.external.notFound",
  "close-in-host": "terminal.external.closeInHost",
  "confirmation-pending": "terminal.external.confirmationPending",
  "host-unavailable": "terminal.external.unavailable",
  "scan-failed": "terminal.external.unavailable"
};
export function ExternalTerminalList({ Icon }) {
  const [state, setState] = React.useState({ available: false, sessions: [], errors: [], scanned: false });
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [confirmId, setConfirmId] = React.useState(null);
  const busyRef = React.useRef(false);
  React.useEffect(() => {
    let disposed = false;
    window.islandBridge.getExternalTerminalState().then(s => { if (!disposed) setState(s); }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  const act = async (action, id) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      if (action === "refresh") setState(await window.islandBridge.refreshExternalTerminals());
      else {
        const result = await (action === "focus" ? window.islandBridge.focusExternalTerminal(id) : window.islandBridge.closeExternalTerminal(id));
        if (result.state) setState(result.state);
        if (!result.ok) setMessage(t(reasonKey[result.reason] || "terminal.external.unavailable"));
        else setConfirmId(null);
      }
    } catch { setMessage(t("terminal.external.unavailable")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  if (!state.available) return null;
  return React.createElement("div", { className: "terminal-external" },
    React.createElement("div", { className: "terminal-quick-heading" }, React.createElement("strong", null, t("terminal.external.title")),
      React.createElement("button", { type: "button", disabled: busy, onClick: () => act("refresh") }, busy ? t("terminal.external.scanning") : state.scanned ? t("terminal.external.refresh") : t("terminal.external.find"))),
    React.createElement("p", { className: "terminal-external-description" }, t("terminal.external.description")),
    state.sessions.length > 0 && React.createElement("ul", { className: "terminal-external-list", "aria-label": t("terminal.external.title") }, state.sessions.map(session => React.createElement("li", { key: session.id, "data-external-terminal-id": session.id },
      React.createElement("div", { className: "terminal-session-main" },
        React.createElement("button", { type: "button", className: "terminal-session-open", disabled: busy, onClick: () => act("focus", session.id), "aria-label": t("terminal.external.open", { name: session.title }) },
          React.createElement("span", { className: "terminal-session-mark" }, React.createElement(Icon)),
          React.createElement("span", { className: "terminal-session-text" }, React.createElement("strong", null, session.title || session.tty), React.createElement("span", null, `${session.host === "terminal" ? "Terminal" : "iTerm2"} · ${session.tty}`))),
        session.capabilities.close && React.createElement("button", { type: "button", className: "terminal-icon-action", title: t("terminal.manager.closeLabel", { name: session.title }), "aria-label": t("terminal.manager.closeLabel", { name: session.title }), disabled: busy, onClick: () => setConfirmId(session.id) }, React.createElement(Icon, { kind: "close" }))),
      confirmId === session.id && React.createElement("div", { className: "terminal-close-confirm" }, React.createElement("span", null, t("terminal.manager.closeDescription")),
        React.createElement("button", { type: "button", disabled: busy, onClick: () => setConfirmId(null) }, t("terminal.manager.cancel")),
        React.createElement("button", { type: "button", className: "terminal-confirm-close", disabled: busy, onClick: () => act("close", session.id) }, t("terminal.manager.close")))
    ))),
    state.scanned && !state.sessions.length && !state.errors.length && React.createElement("p", { className: "terminal-external-description" }, t("terminal.external.empty")),
    (message || state.errors.length > 0) && React.createElement("p", { className: "terminal-external-note", role: "status" }, message || t(reasonKey[state.errors[0].reason] || "terminal.external.unavailable"))
  );
}
