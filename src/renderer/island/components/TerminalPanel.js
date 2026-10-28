import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";
import { Terminal } from "../../../../node_modules/@xterm/xterm/lib/xterm.mjs";
import { FitAddon } from "../../../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import { createTerminalStream } from "./terminal-stream.mjs";
import { ExternalTerminalList } from "./ExternalTerminalList.js";
import { TerminalAgentNotices } from "./TerminalAgentNotices.js";

function TerminalIcon({ kind = "terminal" }) {
  const paths = { terminal: "m6 7 4 5-4 5m7 0h5", plus: "M12 5v14M5 12h14", close: "m6 6 12 12M18 6 6 18", edit: "m14 5 5 5M4 20l5-1L20 8l-4-4L5 15z", back: "m12 5-7 7 7 7M5 12h15" };
  return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, React.createElement("path", { d: paths[kind] }));
}
const sessionName = session => session.name || t("terminal.manager.defaultName", { number: session.ordinal });

function TerminalSessionView({ session, visible, register, onRestart, onError }) {
  const hostRef = React.useRef(null);
  const terminalRef = React.useRef(null);
  const resizeRef = React.useRef(null);
  React.useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, fontFamily: "SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.25,
      theme: { background: "#07090c", foreground: "#e7edf5", cursor: "#72e7a7", selectionBackground: "#315b48" }, scrollback: 5000
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    const stream = createTerminalStream({ id: session.id, generation: session.generation, write: text => terminal.write(text) });
    const unregister = register(session.id, session.generation, frame => stream.accept(frame));
    let disposed = false;
    const restore = async () => {
      try {
        for (let n = 0; n < 5 && !disposed; n++) {
          const snapshot = await window.islandBridge.getTerminalState(session.id);
          if (disposed || stream.restore(snapshot)) return;
        }
        if (!disposed) onError();
      } catch { if (!disposed) onError(); }
    };
    void restore();
    terminal.onData(data => window.islandBridge.sendTerminalInput(data, session.id).catch(onError));
    const resize = () => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) return;
      const dimensions = fit.proposeDimensions();
      if (!dimensions) return;
      const cols = Math.max(20, Math.min(500, dimensions.cols));
      const rows = Math.max(5, Math.min(200, dimensions.rows));
      if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
      window.islandBridge.resizeTerminal(cols, rows, session.id).catch(onError);
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(hostRef.current);
    return () => { disposed = true; unregister(); stream.dispose(); observer.disconnect(); terminal.dispose(); terminalRef.current = null; resizeRef.current = null; };
  }, [session.id, session.generation, register, onError]);
  React.useEffect(() => {
    if (!visible) return undefined;
    const frame = requestAnimationFrame(() => { resizeRef.current?.(); terminalRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  return React.createElement("div", { className: "terminal-session-view", hidden: !visible, "data-terminal-id": session.id },
    React.createElement("div", { className: "terminal-shell" }, React.createElement("div", { className: "terminal-host", ref: hostRef })),
    !session.running && React.createElement("div", { className: "terminal-exit-note", role: "status" },
      React.createElement("span", null, t("terminal.manager.exitCode", { code: session.exitCode ?? "–" })),
      React.createElement("button", { type: "button", onClick: onRestart }, t("terminal.full.restart")))
  );
}

export function TerminalPanel({ active = false, panelOpen = true, savedCommands = [], agentSessions = [], onAgentNotice, onOpenSettings, onFullChange }) {
  const [full, setFull] = React.useState(false);
  const [status, setStatus] = React.useState({ sessions: [], activeId: null, revision: -1 });
  const [visited, setVisited] = React.useState(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirmId, setConfirmId] = React.useState(null);
  const [editingId, setEditingId] = React.useState(null);
  const [draftName, setDraftName] = React.useState("");
  const [controlsFocused, setControlsFocused] = React.useState(false);
  const statusRef = React.useRef(status);
  const busyRef = React.useRef(false);
  const listenersRef = React.useRef(new Map());
  const fail = React.useCallback(() => setError(t("terminal.manager.operationFailed")), []);
  const applyState = React.useCallback(next => {
    if (!next || (next.revision ?? 0) < (statusRef.current.revision ?? -1)) return;
    statusRef.current = next;
    setStatus(next);
  }, []);
  const register = React.useCallback((id, generation, handler) => {
    const key = `${id}:${generation}`;
    listenersRef.current.set(key, handler);
    return () => { if (listenersRef.current.get(key) === handler) listenersRef.current.delete(key); };
  }, []);
  React.useEffect(() => {
    let disposed = false;
    const offStatus = window.islandBridge?.onTerminalStatus?.(applyState);
    const offData = window.islandBridge?.onTerminalData?.(frame => listenersRef.current.get(`${frame.id}:${frame.generation}`)?.(frame));
    window.islandBridge?.getTerminalState?.().then(next => { if (!disposed) applyState(next); }).catch(fail);
    return () => { disposed = true; offStatus?.(); offData?.(); window.islandBridge?.setTerminalInteractive?.(false); };
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
    if (full && !status.activeId) setFull(false);
    setVisited(previous => {
      const next = new Set([...previous].filter(id => sessions.some(s => s.id === id)));
      if (full && selected) next.add(selected.id);
      return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
    });
  }, [full, status.activeId, status.sessions]);
  const run = async (operation, enter = false) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const next = await operation();
      if (!next) throw new Error("Terminal unavailable");
      applyState(next);
      if (enter && next.id) { setVisited(previous => new Set([...previous, next.id])); setFull(true); }
      return next;
    } catch (err) {
      setError(String(err?.message).includes("Terminal limit reached") ? t("terminal.manager.limit", { count: status.maxSessions || 24 }) : t("terminal.manager.operationFailed"));
    } finally { busyRef.current = false; setBusy(false); }
  };
  const create = () => run(() => window.islandBridge.createTerminal(), true);
  const select = id => run(() => window.islandBridge.selectTerminal(id), true);
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
            editingId === session.id ? React.createElement("form", { className: "terminal-rename", onSubmit: e => { e.preventDefault(); void rename(); } },
              React.createElement("input", { autoFocus: true, value: draftName, maxLength: 80, "aria-label": t("terminal.manager.rename"), onChange: e => setDraftName(e.target.value), onKeyDown: e => { if (e.key === "Escape") setEditingId(null); } }),
              React.createElement("button", { type: "submit", disabled: busy || !draftName.trim() }, t("terminal.manager.save")),
              React.createElement("button", { type: "button", onClick: () => setEditingId(null) }, t("terminal.manager.cancel")))
              : React.createElement("button", { className: "terminal-session-open", type: "button", disabled: busy, onClick: () => select(session.id), "aria-label": t("terminal.manager.open", { name: sessionName(session) }) },
                React.createElement("span", { className: `terminal-session-mark${session.running ? " is-running" : ""}` }, React.createElement(TerminalIcon)),
                React.createElement("span", { className: "terminal-session-text" }, React.createElement("strong", null, sessionName(session)), React.createElement("span", { title: session.cwd }, session.cwd)),
                React.createElement("span", { className: `terminal-session-state${session.running ? " is-running" : ""}` }, session.running ? t("terminal.manager.running") : t("terminal.manager.exited"))),
            editingId !== session.id && React.createElement("div", { className: "terminal-row-actions" },
              iconButton(t("terminal.manager.renameLabel", { name: sessionName(session) }), "edit", () => { setEditingId(session.id); setDraftName(sessionName(session)); setConfirmId(null); }),
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
    sessions.filter(s => visited.has(s.id)).map(session => React.createElement(TerminalSessionView, { key: `${session.id}:${session.generation}`, session,
      visible: Boolean(panelOpen && active && full && session.id === status.activeId), register, onError: fail,
      onRestart: () => run(() => window.islandBridge.restartTerminal({ id: session.id }), true) }))
  );
}
