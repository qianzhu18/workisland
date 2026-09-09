import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";

function preview(entry) {
  if (entry.type === "image") return React.createElement("img", { src: entry.dataUrl, alt: t("clipboard.imageAlt") });
  if (entry.type === "files") return entry.paths?.join("\n");
  return entry.text;
}

export function ClipboardPanel() {
  const [state, setState] = React.useState({ items: [] });
  const [query, setQuery] = React.useState("");
  const [copiedId, setCopiedId] = React.useState(null);
  React.useEffect(() => {
    window.islandBridge?.getClipboardHistory?.().then(setState);
    return window.islandBridge?.onClipboardHistoryUpdate?.(setState);
  }, []);
  const entries = state.items.filter((entry) => !query || String(entry.text || entry.paths?.join(" ") || "").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const copyEntry = async (id) => {
    await window.islandBridge.replayClipboardEntry(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1400);
  };
  return React.createElement("section", { className: "toolbox-panel clipboard-panel" },
    React.createElement("div", { className: "toolbox-panel-heading" },
      React.createElement("div", null, React.createElement("strong", null, t("clipboard.title")), React.createElement("span", null, t("clipboard.localOnly"))),
      state.items.length > 0 && React.createElement("button", { type: "button", onClick: () => window.confirm(t("clipboard.clearConfirm")) && window.islandBridge.clearClipboardHistory() }, t("clipboard.clear"))
    ),
    React.createElement("input", { className: "toolbox-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: t("clipboard.search"), "aria-label": t("clipboard.search") }),
    entries.length === 0
      ? React.createElement("div", { className: "toolbox-empty" }, React.createElement("span", { className: "toolbox-empty-icon" }, "▤"), React.createElement("strong", null, t("clipboard.empty.title")), React.createElement("span", null, t("clipboard.empty.description")))
      : React.createElement("div", { className: "clipboard-list" }, entries.map((entry) => React.createElement("article", { key: entry.id, className: "clipboard-item" },
        React.createElement("button", { type: "button", className: "clipboard-preview", onClick: () => copyEntry(entry.id), title: t("clipboard.copyItem") }, preview(entry)),
        React.createElement("div", { className: "clipboard-actions" },
          React.createElement("span", null, t(`clipboard.type.${entry.type === "code" || entry.type === "url" || entry.type === "image" ? entry.type : "text"}`)),
          React.createElement("button", { type: "button", className: copiedId === entry.id ? "is-copied" : "", onClick: () => copyEntry(entry.id) }, t(copiedId === entry.id ? "clipboard.copied" : "clipboard.copy")),
          React.createElement("button", { type: "button", className: entry.favorite ? "is-active" : "", onClick: () => window.islandBridge.favoriteClipboardEntry(entry.id, !entry.favorite) }, entry.favorite ? "★" : "☆"),
          React.createElement("button", { type: "button", onClick: () => window.islandBridge.removeClipboardEntries([entry.id]) }, t("common.delete"))
        ))))
  );
}
