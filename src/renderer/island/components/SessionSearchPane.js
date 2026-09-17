import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";
import { A as AGENT_TOOL_LABELS } from "../../shared/settings.js";
import { buildResumeCommand, buildFallbackCopyText, searchResultAction, CLIENT_TOOLS } from "./search-jump.mjs";

function toolLabel(tool) {
  if (tool === "qoder") return t("agent.qoder.label");
  return AGENT_TOOL_LABELS[tool] || tool;
}

function formatUpdatedAt(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}

export function SessionSearchPane({ query, onQueryChange }) {
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return React.createElement("div", { className: "session-search-row" },
    React.createElement("input", {
      ref: inputRef,
      className: "session-search-input",
      type: "text",
      placeholder: t("island.search.placeholder"),
      "aria-label": t("island.search.placeholder"),
      value: query,
      onChange: (event) => onQueryChange(event.target.value),
      onKeyDown: (event) => { if (event.key === "Escape") { onQueryChange(""); event.target.blur(); } }
    }),
    query && React.createElement("button", {
      type: "button",
      className: "session-search-clear",
      "aria-label": t("island.search.clear"),
      onClick: () => onQueryChange("")
    }, "×")
  );
}

export function SessionSearchResults({ query, onRunInTerminal, onOpenClient, terminalEnabled = false }) {
  const [state, setState] = React.useState({ loading: true, results: [] });
  React.useEffect(() => {
    let alive = true;
    setState({ loading: true, results: [] });
    const timer = setTimeout(async () => {
      try {
        const results = await window.islandBridge?.searchSessions?.(query) || [];
        if (alive) setState({ loading: false, results });
      } catch {
        if (alive) setState({ loading: false, results: [] });
      }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  const copy = async (event, result) => {
    event.stopPropagation();
    const text = buildResumeCommand(result) || buildFallbackCopyText(result);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setState((prev) => ({ ...prev, copiedId: result.tool + ":" + result.id }));
      setTimeout(() => setState((prev) => ({ ...prev, copiedId: null })), 1500);
    } catch {}
  };

  const activate = (event, result) => {
    const action = searchResultAction(result, terminalEnabled);
    if (action.type === "terminal" && onRunInTerminal) {
      event.stopPropagation();
      onRunInTerminal(result, action.command);
      return;
    }
    if (action.type === "client" && onOpenClient) {
      event.stopPropagation();
      onOpenClient(result);
      return;
    }
    copy(event, result);
  };

  if (state.loading) {
    return React.createElement("div", { className: "session-search-results" },
      React.createElement("div", { className: "session-search-empty" }, t("island.search.searching")));
  }
  if (!state.results.length) {
    return React.createElement("div", { className: "session-search-results" },
      React.createElement("div", { className: "session-search-empty" }, t("island.search.noResults")));
  }
  return React.createElement("div", { className: "session-search-results" },
    state.results.map((result) => {
      const key = result.tool + ":" + result.id;
      const resume = buildResumeCommand(result);
      const inTerminal = resume && terminalEnabled;
      const toClient = CLIENT_TOOLS.has(result.tool);
      return React.createElement("div", {
        key,
        className: "session-search-result" + (inTerminal ? " is-resumable" : ""),
        onClick: (event) => activate(event, result),
        title: t(toClient ? "island.search.openClient" : inTerminal ? "island.search.openTerminal" : resume ? "island.search.copyResume" : "island.search.copyPath")
      },
        React.createElement("div", { className: "session-search-result-head" },
          React.createElement("span", { className: "session-search-result-tool" }, toolLabel(result.tool)),
          React.createElement("span", { className: "session-search-result-time" }, formatUpdatedAt(result.updatedAt)),
          React.createElement("span", { className: "session-search-result-copy" }, state.copiedId === key ? "✓" : inTerminal ? "↵" : toClient ? "⇱" : "⧉")
        ),
        React.createElement("div", { className: "session-search-result-title" }, result.title || result.id),
        result.snippet && React.createElement("div", { className: "session-search-result-snippet" }, result.snippet),
        result.projectPath && React.createElement("div", { className: "session-search-result-path" }, result.projectPath)
      );
    })
  );
}
