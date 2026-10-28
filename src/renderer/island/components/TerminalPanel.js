import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";
import { ExternalTerminalList } from "./ExternalTerminalList.js";
import { TerminalAgentNotices } from "./TerminalAgentNotices.js";
import { TerminalNativeHost } from "./TerminalNativeHost.js";
import { TerminalDragHandle } from "./TerminalDragHandle.js";

function TerminalIcon({ kind = "terminal" }) {
  const paths = { terminal: "m6 7 4 5-4 5m7 0h5", plus: "M12 5v14M5 12h14", close: "m6 6 12 12M18 6 6 18", edit: "m14 5 5 5M4 20l5-1L20 8l-4-4L5 15z", back: "m12 5-7 7 7 7M5 12h15", detach: "M14 4h6v6M20 4l-9 9M10 5H4v15h15v-6", dock: "M10 20H4v-6M4 20l9-9M14 19h6V4H5v6", drag: "M9 4v16M15 4v16M4 9h16M4 15h16" };
  return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, React.createElement("path", { d: paths[kind] }));
}
const sessionName = session => session.name || t("terminal.manager.defaultName", { number: session.ordinal });

export function TerminalPanel({ active = false, panelOpen = true, savedCommands = [], agentSessions = [], onAgentNotice, requestedTerminalReveal, onOpenSettings, onFullChange }) {
  const [full, setFull] = React.useState(false);
  const [status, setStatus] = React.useState({ sessions: [], activeId: null, revision: -1 });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirmId, setConfirmId] = React.useState(null);
  const [editingId, setEditingId] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const [controlsFocused, setControlsFocused] = React.useState(false);
  const statusRef = React.useRef(status);
  const busyRef = React.useRef(false);
  const handledReveal = React.useRef(null);
  const fail = React.useCallback(() => setError(t("terminal.manager.operationFailed")), []);
  const applyState = React.useCallback(next => {
    if (!next || (next.revision ?? 0) < (statusRef.current.revision ?? -1)) return;
    statusRef.current = next;
    setStatus(next);
  }, []);
  React.useEffect(() => {
    let disposed = false;
    const offStatus = window.islandBridge?.onTerminalStatus?.(applyState);
    window.islandBridge?.getTerminalState?.().then(next => { if (!disposed) applyState(next); }).catch(fail);
    return () => { disposed = true; offStatus?.(); window.islandBridge?.setTerminalInteractive?.(false); };
  }, [applyState, fail]);
  React.useEffect(() => {
    if (active && !full) window.islandBridge?.getTerminalState?.().then(applyState).catch(fail);
  }, [active, full, applyState, fail]);
  React.useEffect(() => { onFullChange?.(full); }, [full, onFullChange]);
  React.useEffect(() => {
    const interactive = Boolean(panelOpen && active && (full || controlsFocused || editingId || confirmId));
    window.islandBridge?.setTerminalInteractive?.(interactive);
    return () => window.islandBridge?.setTerminalInteractive?.(false);
  }, [active, full, panelOpen, controlsFocused, editingId, confirmId]);
  const sessions = status.sessions || [];
  const selected = sessions.find(s => s.id === status.activeId);
  React.useEffect(() => {
    if (full && (!status.activeId || selected?.location === "desktop")) setFull(false);
  }, [full, status.activeId, selected?.location]);
  React.useEffect(() => {
    const request = requestedTerminalReveal, key = request && `${request.id}:${request.nonce}`;
    if (!request || handledReveal.current === key || !sessions.some(s => s.id === request.id)) return;
    handledReveal.current = key;
    void select(request.id);
  }, [requestedTerminalReveal, status.sessions]);
  const run = async (operation, enter = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const next = await operation();
      if (!next) throw new Error("Terminal unavailable");
      applyState(next);
      if (enter && next.id) setFull(true);
      return next;
    } catch (err) {
      setError(String(err?.message).includes("Terminal limit reached") ? t("terminal.manager.limit", { count: status.maxSessions || 24 }) : t("terminal.manager.operationFailed"));
    } finally { busyRef.current = false; setBusy(false); }
  };
  const create = () => run(() => window.islandBridge.createTerminal(), true);
  const select = id => sessions.find(s => s.id === id)?.location === "desktop"
    ? run(() => window.islandBridge.focusTerminalWindow(id)) : run(() => window.islandBridge.selectTerminal(id), true);
  const close = async id => { const next = await run(() => window.islandBridge.closeTerminal(id)); if (next) setConfirmId(null); };
  const rename = async () => { const next = await run(() => window.islandBridge.renameTerminal(editingId, draftName)); if (next) setEditingId(null); };
  const iconButton = (label, kind, onClick) => React.createElement("button", { type: "button", className: "terminal-icon-action", title: label, "aria-label": label, disabled: busy, onClick }, React.createElement(TerminalIcon, { kind }));
  return React.createElement("section", { className: `toolbox-panel terminal-panel${active ? "" : " is-hidden"}`, "aria-label": full ? t("terminal.full.title") : t("terminal.manager.title"), "aria-hidden": active ? undefined : "true", "data-terminal-interactive": panelOpen && active && (full || controlsFocused || editingId || confirmId) ? "true" : "false",
    "data-terminal-viewing": panelOpen && active ? "true" : "false",
    onFocusCapture: () => setControlsFocused(true), onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setControlsFocused(false); },
    onKeyDown: event => { if (!full && event.key === "Escape" && (editingId || confirmId)) { event.preventDefault(); setEditingId(null); setConfirmId(null); } } },
    React.createElement("div", { className: "toolbox-panel-heading" },
      React.createElement("div", null, React.createElement("strong", null, full && selected ? sessionName(selected) : t("terminal.manager.title")),
        React.createElement("span", { title: full ? selected?.cwd : undefined }, full ? selected?.cwd : t("terminal.manager.summary", { running: sessions.filter(s => s.running).length, total: sessions.length }))),
      React.createElement("div", { className: "toolbox-heading-actions" },
        full && selected && React.createElement(TerminalDragHandle, { id: selected.id, Icon: TerminalIcon, onError: fail }),
        full && selected && iconButton(t("terminal.window.detach"), "detach", () => run(() => window.islandBridge.detachTerminal(selected.id))),
        full && React.createElement("button", { type: "button", className: "terminal-back", onClick: () => setFull(false) }, React.createElement(TerminalIcon, { kind: "back" }), t("terminal.full.back")),
        React.createElement("button", { type: "button", className: "terminal-new", disabled: busy, onClick: create }, React.createElement(TerminalIcon, { kind: "plus" }), t("terminal.manager.new")))
    ),
    React.createElement(TerminalAgentNotices, { sessions: agentSessions, onOpen: onAgentNotice }),
    error && React.createElement("div", { className: "terminal-error", role: "alert" }, error),
    !full && React.createElement("div", { className: "terminal-manager" },
      sessions.length === 0 ? React.createElement("div", { className: "terminal-manager-empty" },
        React.createElement(TerminalIcon), React.createElement("strong", null, t("terminal.manager.emptyTitle")), React.createElement("p", null, t("terminal.manager.emptyDescription")),
        React.createElement("button", { type: "button", className: "terminal-enter-full", disabled: busy, onClick: create }, t("terminal.full.enter")))
        : React.createElement("ul", { className: "terminal-session-list", "aria-label": t("terminal.manager.sessions") }, sessions.map(session => React.createElement("li", { key: session.id, className: `terminal-session-row${session.id === status.activeId ? " is-current" : ""}`, "data-session-id": session.id },
          React.createElement("div", { className: "terminal-session-main" },
            React.createElement(TerminalDragHandle, { id: session.id, Icon: TerminalIcon, onError: fail }),
            editingId === session.id ? React.createElement("form", { className: "terminal-rename", onSubmit: e => { e.preventDefault(); void rename(); } },
              React.createElement("input", { autoFocus: true, value: draftName, maxLength: 80, "aria-label": t("terminal.manager.rename"), onChange: e => setDraftName(e.target.value), onKeyDown: e => { if (e.key === "Escape") setEditingId(null); } }),
              React.createElement("button", { type: "submit", disabled: busy || !draftName.trim() }, t("terminal.manager.save")),
              React.createElement("button", { type: "button", onClick: () => setEditingId(null) }, t("terminal.manager.cancel")))
              : React.createElement("button", { className: "terminal-session-open", type: "button", disabled: busy, onClick: () => select(session.id), "aria-label": t("terminal.manager.open", { name: sessionName(session) }) },
                React.createElement("span", { className: `terminal-session-mark${session.running ? " is-running" : ""}` }, React.createElement(TerminalIcon)),
                React.createElement("span", { className: "terminal-session-text" }, React.createElement("strong", null, sessionName(session)), React.createElement("span", { title: session.cwd }, session.cwd)),
                React.createElement("span", { className: `terminal-session-state${session.running ? " is-running" : ""}` }, session.location === "desktop" ? t("terminal.window.desktop") : session.running ? t("terminal.manager.running") : t("terminal.manager.exited"))),
            editingId !== session.id && React.createElement("div", { className: "terminal-row-actions" },
              iconButton(t("terminal.manager.renameLabel", { name: sessionName(session) }), "edit", () => { setEditingId(session.id); setDraftName(sessionName(session)); setConfirmId(null); }),
              session.location === "desktop" ? iconButton(t("terminal.window.dock"), "dock", () => run(() => window.islandBridge.dockTerminal(session.id))) : iconButton(t("terminal.window.detach"), "detach", () => run(() => window.islandBridge.detachTerminal(session.id))),
              iconButton(t("terminal.manager.closeLabel", { name: sessionName(session) }), "close", () => { setEditingId(null); session.running ? setConfirmId(session.id) : void close(session.id); }))),
          confirmId === session.id && React.createElement("div", { className: "terminal-close-confirm", role: "group", "aria-label": t("terminal.manager.confirmClose") },
            React.createElement("span", null, t("terminal.manager.closeDescription")),
            React.createElement("button", { type: "button", disabled: busy, onClick: () => setConfirmId(null) }, t("terminal.manager.cancel")),
            React.createElement("button", { type: "button", className: "terminal-confirm-close", disabled: busy, onClick: () => close(session.id) }, t("terminal.manager.close")))
        ))),
      React.createElement(ExternalTerminalList, { Icon: TerminalIcon }),
      React.createElement("div", { className: "terminal-quick-heading" }, React.createElement("strong", null, t("terminal.quick.title")),
        React.createElement("button", { type: "button", onClick: onOpenSettings }, savedCommands.length ? t("terminal.manager.manageCommands") : t("terminal.quick.empty.action"))),
      savedCommands.length > 0
        ? React.createElement("div", { className: "quick-command-grid" }, savedCommands.map(command => React.createElement("button", { key: command.id, type: "button", className: "quick-command", disabled: busy, onClick: () => run(() => window.islandBridge.runSavedTerminalCommand(command.id), true) }, React.createElement("strong", null, command.name), React.createElement("code", null, command.command))))
        : React.createElement("div", { className: "terminal-command-empty terminal-quick-empty" }, React.createElement("strong", null, t("terminal.quick.empty.title")), React.createElement("span", null, t("terminal.quick.empty.description")))
    ),
    full && selected && React.createElement("div", { className: "terminal-session-bar" },
      React.createElement("label", null, t("terminal.manager.switch"), React.createElement("select", { value: status.activeId, disabled: busy, "aria-label": t("terminal.manager.switch"), onChange: e => select(e.target.value) },
        sessions.map(s => React.createElement("option", { key: s.id, value: s.id }, `${sessionName(s)}${s.running ? "" : ` · ${t("terminal.manager.exited")}`}`)))),
      iconButton(t("terminal.manager.closeLabel", { name: sessionName(selected) }), "close", () => { setFull(false); setConfirmId(selected.id); })),
    full && selected && selected.location !== "desktop" && React.createElement(TerminalNativeHost, { key: `${selected.id}:${selected.generation}`, session: selected,
      visible: Boolean(panelOpen && active && full && selected.id === status.activeId), onError: fail })
  );
}
