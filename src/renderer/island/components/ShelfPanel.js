import { R as React } from "../../vendor/react-runtime.js";

export function ShelfPanel() {
  const [state, setState] = React.useState({ items: [] });
  const [dragging, setDragging] = React.useState(false);
  const refresh = React.useCallback(() => window.islandBridge?.getShelfState?.().then(setState), []);
  React.useEffect(() => {
    refresh();
    return window.islandBridge?.onShelfUpdate?.(setState);
  }, [refresh]);
  const onDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) await window.islandBridge.addShelfFiles(event.dataTransfer.files);
    else {
      const url = event.dataTransfer.getData("text/uri-list");
      const text = event.dataTransfer.getData("text/plain");
      if (url || text) await window.islandBridge.addShelfPayload({ type: url ? "url" : "text", value: url || text });
    }
    refresh();
  };
  const remove = (id) => window.islandBridge.removeShelfItems([id]);
  return React.createElement("section", {
    className: `toolbox-panel shelf-panel${dragging ? " is-dragging" : ""}`,
    onDragOver: (event) => { event.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop
  },
  React.createElement("div", { className: "toolbox-panel-heading" },
    React.createElement("div", null, React.createElement("strong", null, "文件架"), React.createElement("span", null, "拖入文件，跨应用临时周转")),
    state.items.length > 0 && React.createElement("button", { type: "button", onClick: () => window.confirm("清空文件架引用？原文件不会被删除。") && window.islandBridge.clearShelf() }, "清空")
  ),
  state.items.length === 0
    ? React.createElement("div", { className: "toolbox-empty shelf-drop-target" }, React.createElement("span", { className: "toolbox-empty-icon" }, "↓"), React.createElement("strong", null, "把文件拖到这里临时存放"), React.createElement("span", null, "原文件不会被移动或删除"))
    : React.createElement("div", { className: "shelf-grid" }, state.items.map((item) => React.createElement("article", {
      key: item.id,
      className: `shelf-item${item.available ? "" : " is-missing"}`,
      draggable: Boolean(item.path && item.available),
      onDragStart: () => window.islandBridge.startShelfDrag(item.id),
      onDoubleClick: () => item.path && window.islandBridge.openShelfItem(item.id)
    },
    React.createElement("div", { className: "shelf-item-icon" }, item.type === "directory" ? "▰" : item.type === "url" ? "↗" : "▧"),
    React.createElement("div", { className: "shelf-item-name", title: item.name }, item.name),
    React.createElement("div", { className: "shelf-item-actions" },
      item.path && React.createElement("button", { type: "button", disabled: !item.available, onClick: () => window.islandBridge.quickLookShelfItem(item.id) }, "预览"),
      item.path && React.createElement("button", { type: "button", disabled: !item.available, onClick: () => window.islandBridge.revealShelfItem(item.id) }, "定位"),
      React.createElement("button", { type: "button", onClick: () => remove(item.id) }, "移除引用")
    )))));
}
