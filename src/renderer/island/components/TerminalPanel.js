import { R as React } from "../../vendor/react-runtime.js";
import { Terminal } from "../../../../node_modules/@xterm/xterm/lib/xterm.mjs";

export function TerminalPanel({ savedCommands = [], onOpenSettings }) {
  const [full, setFull] = React.useState(false);
  const [status, setStatus] = React.useState({ running: false, cwd: "" });
  const hostRef = React.useRef(null);
  const terminalRef = React.useRef(null);
  React.useEffect(() => {
    window.islandBridge?.getTerminalState?.().then(setStatus);
    return window.islandBridge?.onTerminalStatus?.(setStatus);
  }, []);
  React.useEffect(() => {
    if (!full || !hostRef.current) return undefined;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      theme: { background: "#07090c", foreground: "#e7edf5", cursor: "#72e7a7", selectionBackground: "#315b48" },
      scrollback: 5000
    });
    terminal.open(hostRef.current);
    window.islandBridge?.setTerminalInteractive?.(true);
    terminalRef.current = terminal;
    if (status.recentOutput) terminal.write(status.recentOutput);
    terminal.onData((data) => window.islandBridge.sendTerminalInput(data));
    const resize = () => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cols = Math.max(20, Math.min(500, Math.floor(rect.width / 7.3)));
      const rows = Math.max(5, Math.min(200, Math.floor(rect.height / 16)));
      terminal.resize(cols, rows);
      window.islandBridge.resizeTerminal(cols, rows);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(hostRef.current);
    const offData = window.islandBridge?.onTerminalData?.((data) => terminal.write(data));
    window.islandBridge.startTerminal().then((next) => { setStatus(next); resize(); });
    return () => { window.islandBridge?.setTerminalInteractive?.(false); offData?.(); observer.disconnect(); terminal.dispose(); terminalRef.current = null; };
  }, [full]);
  const commands = savedCommands;
  return React.createElement("section", { className: "toolbox-panel terminal-panel", "data-terminal-interactive": full ? "true" : "false" },
    React.createElement("div", { className: "toolbox-panel-heading" },
      React.createElement("div", null, React.createElement("strong", null, full ? "完整终端" : "快捷终端"), React.createElement("span", null, status.cwd || "优先使用当前 Agent 项目目录")),
      full && React.createElement("button", { type: "button", onClick: () => setFull(false) }, "返回快捷命令")
    ),
    full
      ? React.createElement("div", { className: "terminal-shell" }, React.createElement("div", { className: "terminal-host", ref: hostRef }), !status.running && React.createElement("button", { type: "button", className: "terminal-restart", onClick: () => window.islandBridge.restartTerminal().then(setStatus) }, "重新启动终端"))
      : React.createElement(React.Fragment, null,
        commands.length > 0
          ? React.createElement("div", { className: "quick-command-grid" }, commands.map((command) => React.createElement("button", { key: command.id, type: "button", className: "quick-command", onClick: async () => { await window.islandBridge.runSavedTerminalCommand(command.id); setFull(true); } }, React.createElement("strong", null, command.name), React.createElement("code", null, command.command))))
          : React.createElement("div", { className: "terminal-command-empty" },
            React.createElement("strong", null, "尚未添加快捷命令"),
            React.createElement("span", null, "可以在设置中添加任何常用命令"),
            React.createElement("button", { type: "button", onClick: onOpenSettings }, "前往设置添加")
          ),
        React.createElement("button", { type: "button", className: "terminal-enter-full", onClick: () => setFull(true) }, "进入完整终端")
      )
  );
}
