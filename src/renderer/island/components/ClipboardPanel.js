import { R as React } from "../../vendor/react-runtime.js";

function preview(entry) {
  if (entry.type === "image") return React.createElement("img", { src: entry.dataUrl, alt: "剪贴板图片" });
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
      React.createElement("div", null, React.createElement("strong", null, "剪贴板"), React.createElement("span", null, "内容只保存在本机")),
      state.items.length > 0 && React.createElement("button", { type: "button", onClick: () => window.confirm("清空全部剪贴板历史？") && window.islandBridge.clearClipboardHistory() }, "清空")
    ),
    React.createElement("input", { className: "toolbox-search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "搜索剪贴板", "aria-label": "搜索剪贴板" }),
    entries.length === 0
      ? React.createElement("div", { className: "toolbox-empty" }, React.createElement("span", { className: "toolbox-empty-icon" }, "▤"), React.createElement("strong", null, "还没有剪贴板历史"), React.createElement("span", null, "复制文本、代码、链接或图片后会显示在这里"))
      : React.createElement("div", { className: "clipboard-list" }, entries.map((entry) => React.createElement("article", { key: entry.id, className: "clipboard-item" },
        React.createElement("button", { type: "button", className: "clipboard-preview", onClick: () => copyEntry(entry.id), title: "复制此项" }, preview(entry)),
        React.createElement("div", { className: "clipboard-actions" },
          React.createElement("span", null, entry.type === "code" ? "代码" : entry.type === "url" ? "链接" : entry.type === "image" ? "图片" : "文本"),
          React.createElement("button", { type: "button", className: copiedId === entry.id ? "is-copied" : "", onClick: () => copyEntry(entry.id) }, copiedId === entry.id ? "已复制" : "复制"),
          React.createElement("button", { type: "button", className: entry.favorite ? "is-active" : "", onClick: () => window.islandBridge.favoriteClipboardEntry(entry.id, !entry.favorite) }, entry.favorite ? "★" : "☆"),
          React.createElement("button", { type: "button", onClick: () => window.islandBridge.removeClipboardEntries([entry.id]) }, "删除")
        ))))
  );
}
