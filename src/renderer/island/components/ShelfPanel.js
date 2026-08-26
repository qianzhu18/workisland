import { R as React } from "../../vendor/react-runtime.js";

const INTERNAL_SHELF_DRAG = "application/x-workisland-shelf-id";

function SvgIcon({ children, viewBox = "0 0 24 24" }) {
  return React.createElement("svg", { viewBox, width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, children);
}
function PreviewIcon() { return React.createElement(SvgIcon, null, React.createElement("path", { d: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" }), React.createElement("circle", { cx: 12, cy: 12, r: 2.6 })); }
function FinderIcon() { return React.createElement(SvgIcon, null, React.createElement("path", { d: "M3 7.5h7l2-2h9v13H3z" }), React.createElement("path", { d: "M3 9h18" })); }
function SystemShareIcon() { return React.createElement(SvgIcon, null, React.createElement("path", { d: "M12 15V3m0 0L8.2 6.8M12 3l3.8 3.8" }), React.createElement("path", { d: "M7 10H5.5A2.5 2.5 0 0 0 3 12.5v6A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H17" })); }
function CopyIcon() { return React.createElement(SvgIcon, null, React.createElement("rect", { x: 8, y: 8, width: 11, height: 11, rx: 2 }), React.createElement("path", { d: "M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" })); }
function RemoveIcon() { return React.createElement(SvgIcon, null, React.createElement("path", { d: "m7 7 10 10M17 7 7 17" })); }

function ShelfItemPreview({ item }) {
  const [preview, setPreview] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!item.path || !item.available) return undefined;
    window.islandBridge?.getShelfPreview?.(item.id).then((dataUrl) => { if (!cancelled) setPreview(dataUrl || null); });
    return () => { cancelled = true; };
  }, [item.id, item.path, item.available]);
  return React.createElement("div", { className: "shelf-item-preview" },
    preview
      ? React.createElement("img", { src: preview, alt: "", draggable: false })
      : React.createElement("span", { className: `shelf-preview-fallback is-${item.type}` }, item.type === "directory" ? "⌑" : item.type === "url" ? "↗" : "◇")
  );
}

function IconButton({ label, disabled, onClick, children, className = "" }) {
  return React.createElement("button", {
    type: "button",
    className: `shelf-icon-button ${className}`.trim(),
    disabled,
    title: label,
    "aria-label": label,
    onClick: (event) => { event.stopPropagation(); onClick?.(); }
  }, children);
}

function parseInternalDragIds(value) {
  if (!value) return [];
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [String(ids)];
  } catch {
    return [String(value)];
  }
}

export function ShelfPanel() {
  const [state, setState] = React.useState({ items: [] });
  const [dragging, setDragging] = React.useState(false);
  const [shareTargeted, setShareTargeted] = React.useState(false);
  const [dropError, setDropError] = React.useState("");
  const [shareStatus, setShareStatus] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  const [anchorIndex, setAnchorIndex] = React.useState(null);
  const [shareProviders, setShareProviders] = React.useState([]);
  const [quickShareProviderId, setQuickShareProviderId] = React.useState("AirDrop");
  const [providerMenuOpen, setProviderMenuOpen] = React.useState(false);
  const shareZoneRef = React.useRef(null);
  const refresh = React.useCallback(() => window.islandBridge?.getShelfState?.().then(setState), []);
  const selectedArray = React.useMemo(() => state.items.map((item) => item.id).filter((id) => selectedIds.has(id)), [state.items, selectedIds]);
  const quickShareProvider = React.useMemo(() => shareProviders.find((provider) => provider.id === quickShareProviderId)
    || shareProviders.find((provider) => provider.id === "AirDrop")
    || shareProviders[0]
    || { id: "__system__", title: "系统分享菜单", iconDataUrl: "" }, [quickShareProviderId, shareProviders]);
  const finishShelfDrag = React.useCallback(() => {
    setDragging(false);
    setShareTargeted(false);
  }, []);

  React.useEffect(() => {
    refresh();
    return window.islandBridge?.onShelfUpdate?.(setState);
  }, [refresh]);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.islandBridge?.getShelfShareProviders?.() || [],
      window.islandBridge?.getSettings?.() || {}
    ]).then(([providers, settings]) => {
      if (cancelled) return;
      setShareProviders(Array.isArray(providers) ? providers : []);
      setQuickShareProviderId(settings?.shelfQuickShareProvider || "AirDrop");
    });
    const unsubscribe = window.islandBridge?.onSettingsChanged?.((settings) => {
      setQuickShareProviderId(settings?.shelfQuickShareProvider || "AirDrop");
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  React.useEffect(() => {
    const valid = new Set(state.items.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [state.items]);
  React.useEffect(() => {
    const zone = shareZoneRef.current;
    if (!zone) return undefined;
    const report = () => {
      const rect = zone.getBoundingClientRect();
      window.islandBridge?.setShelfShareDropBounds?.({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(zone);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.islandBridge?.setShelfShareDropBounds?.(null);
    };
  }, [state.items.length, selectedArray.length]);
  React.useEffect(() => {
    const onGlobalDrop = (event) => {
      setDragging(false);
      setShareTargeted(false);
      const addedCount = Number(event.detail?.addedCount || 0);
      if (event.detail?.shared) {
        setDropError("");
        setShareStatus("已打开系统分享");
      } else {
        setDropError(addedCount > 0 ? "" : event.detail?.error || "没有读取到文件，请从 Finder 拖入本地文件");
        if (event.detail?.error) setShareStatus(event.detail.error);
      }
      refresh();
    };
    window.addEventListener("workisland:shelf-drop-result", onGlobalDrop);
    return () => window.removeEventListener("workisland:shelf-drop-result", onGlobalDrop);
  }, [refresh]);

  const paste = React.useCallback(async () => {
    await window.islandBridge?.pasteShelfFromClipboard?.();
    refresh();
  }, [refresh]);
  const copyItems = React.useCallback(async (ids) => {
    const ok = await window.islandBridge?.copyShelfItems?.(ids);
    setShareStatus(ok ? `已复制 ${ids.length} 项，可在 Finder 中粘贴` : "没有可复制的项目");
    return ok;
  }, []);
  const shareItems = React.useCallback(async (ids) => {
    if (!ids.length) { setShareStatus("请先选择要分享的文件"); return false; }
    setShareStatus("正在打开系统分享…");
    const ok = await window.islandBridge?.shareShelfItems?.(ids);
    setShareStatus(ok ? "已打开系统分享" : "系统分享暂时不可用");
    return ok;
  }, []);
  const shareViaDefault = React.useCallback(async (ids) => {
    if (!ids.length) { setShareStatus("请先选择要分享的文件"); return false; }
    setShareStatus(`正在通过 ${quickShareProvider.title} 分享…`);
    const result = await window.islandBridge?.shareShelfItemsViaDefault?.(ids);
    const ok = result?.ok === true;
    setShareStatus(ok
      ? result.fallback ? `${quickShareProvider.title} 不可用，已打开系统分享` : `已打开 ${quickShareProvider.title}`
      : "快速分享暂时不可用");
    return ok;
  }, [quickShareProvider.title]);
  const changeQuickShareProvider = React.useCallback(async (providerId) => {
    const ok = await window.islandBridge?.setShelfQuickShareProvider?.(providerId);
    if (ok) {
      setQuickShareProviderId(providerId);
      setProviderMenuOpen(false);
      setShareStatus(`默认分享已改为 ${shareProviders.find((provider) => provider.id === providerId)?.title || providerId}`);
    }
  }, [shareProviders]);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        paste();
      } else if (key === "a" && state.items.length > 0) {
        event.preventDefault();
        setSelectedIds(new Set(state.items.map((item) => item.id)));
        setAnchorIndex(0);
      } else if (key === "c" && selectedArray.length > 0) {
        event.preventDefault();
        copyItems(selectedArray);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copyItems, paste, selectedArray, state.items]);

  const selectItem = (event, item, index) => {
    if (event.shiftKey && anchorIndex !== null) {
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const range = state.items.slice(start, end + 1).map((entry) => entry.id);
      setSelectedIds((current) => new Set(event.metaKey ? [...current, ...range] : range));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      });
    } else {
      setSelectedIds(new Set([item.id]));
    }
    setAnchorIndex(index);
  };
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
  const remove = (ids) => window.islandBridge.removeShelfItems(Array.isArray(ids) ? ids : [ids]);
  const shareZoneDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setShareTargeted(false);
    const ids = parseInternalDragIds(event.dataTransfer.getData(INTERNAL_SHELF_DRAG));
    if (ids.length) await shareViaDefault(ids);
  };

  return React.createElement("section", {
    className: `toolbox-panel shelf-panel${dragging ? " is-dragging" : ""}`,
    onDragOver: (event) => { event.preventDefault(); setDropError(""); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop
  },
  React.createElement("div", { className: "toolbox-panel-heading" },
    React.createElement("div", null, React.createElement("strong", null, "文件架"), React.createElement("span", null, "拖入文件，跨应用临时周转与分享")),
    React.createElement("div", { className: "toolbox-heading-actions" },
      React.createElement("button", { type: "button", onClick: paste }, "粘贴"),
      state.items.length > 0 && React.createElement("button", { type: "button", onClick: () => window.confirm("清空文件架引用？原文件不会被删除。") && window.islandBridge.clearShelf() }, "清空")
    )
  ),
  React.createElement("div", { className: "shelf-workspace" },
    React.createElement("aside", {
      ref: shareZoneRef,
      className: `shelf-share-zone${shareTargeted ? " is-targeted" : ""}`,
      role: "button",
      tabIndex: 0,
      onClick: () => shareViaDefault(selectedArray),
      onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") shareViaDefault(selectedArray); },
      onDragEnter: (event) => { event.preventDefault(); event.stopPropagation(); setShareTargeted(true); },
      onDragOver: (event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setShareTargeted(true); },
      onDragLeave: () => setShareTargeted(false),
      onDrop: shareZoneDrop
    },
      React.createElement("button", {
        type: "button",
        className: "shelf-share-switch",
        title: "更换默认快速分享",
        "aria-label": "更换默认快速分享",
        onClick: (event) => { event.stopPropagation(); setProviderMenuOpen((open) => !open); }
      }, "⇄"),
      providerMenuOpen && React.createElement("div", { className: "shelf-share-provider-menu", onClick: (event) => event.stopPropagation() },
        React.createElement("div", { className: "shelf-share-provider-heading" }, "默认快速分享"),
        shareProviders.map((provider) => React.createElement("button", {
          type: "button",
          key: provider.id,
          className: provider.id === quickShareProvider.id ? "is-selected" : "",
          onClick: () => changeQuickShareProvider(provider.id)
        },
          provider.iconDataUrl
            ? React.createElement("img", { src: provider.iconDataUrl, alt: "" })
            : React.createElement("span", { className: "shelf-share-provider-fallback" }, "↗"),
          React.createElement("span", null, provider.title),
          provider.id === quickShareProvider.id && React.createElement("b", null, "✓")
        ))
      ),
      React.createElement("div", { className: "shelf-share-icon" }, quickShareProvider.iconDataUrl
        ? React.createElement("img", { src: quickShareProvider.iconDataUrl, alt: "" })
        : React.createElement(SystemShareIcon)),
      React.createElement("strong", null, quickShareProvider.title),
      React.createElement("span", null, `拖到这里直接使用 ${quickShareProvider.title}`),
      React.createElement("button", {
        type: "button",
        className: "shelf-system-share-once",
        disabled: selectedArray.length === 0,
        onClick: (event) => { event.stopPropagation(); shareItems(selectedArray); }
      }, React.createElement(SystemShareIcon), React.createElement("span", null, "临时打开系统分享")),
      React.createElement("small", null, shareStatus || "右上角可更换默认方式")
    ),
    React.createElement("div", { className: "shelf-files-area" },
      selectedArray.length > 0 && React.createElement("div", { className: "shelf-selection-bar" },
        React.createElement("span", null, `已选择 ${selectedArray.length} 项`),
        React.createElement("div", null,
          React.createElement(IconButton, { label: "复制所选文件", onClick: () => copyItems(selectedArray) }, React.createElement(CopyIcon)),
          React.createElement(IconButton, { label: "分享所选文件", onClick: () => shareItems(selectedArray) }, React.createElement(SystemShareIcon)),
          React.createElement(IconButton, { label: "移除所选引用", onClick: () => remove(selectedArray) }, React.createElement(RemoveIcon))
        )
      ),
      state.items.length === 0
        ? React.createElement("div", { className: "toolbox-empty shelf-drop-target" }, React.createElement("span", { className: "toolbox-empty-icon" }, "↓"), React.createElement("strong", null, dropError || "拖入文件，或按 ⌘V 粘贴"), React.createElement("span", null, dropError ? "也可以点击右上角“粘贴”重试" : "原文件不会被移动或删除"))
        : React.createElement("div", { className: `shelf-grid${selectedArray.length ? " has-selection" : ""}` }, state.items.map((item, index) => React.createElement("article", {
          key: item.id,
          className: `shelf-item${item.available ? "" : " is-missing"}${selectedIds.has(item.id) ? " is-selected" : ""}`,
          "aria-selected": selectedIds.has(item.id),
          draggable: Boolean(item.path && item.available),
          onClick: (event) => selectItem(event, item, index),
          onDragStart: (event) => {
            // Electron's native file drag replaces Chromium's HTML drag session.
            // Letting both run at once can strand the transparent window in a
            // native drag state where it no longer receives pointer events.
            event.preventDefault();
            const dragIds = selectedIds.has(item.id) ? selectedArray : [item.id];
            if (!selectedIds.has(item.id)) { setSelectedIds(new Set([item.id])); setAnchorIndex(index); }
            Promise.resolve(window.islandBridge.startShelfDrag(dragIds)).finally(finishShelfDrag);
          },
          onDragEnd: finishShelfDrag,
          onDoubleClick: () => item.path && window.islandBridge.openShelfItem(item.id)
        },
        React.createElement(IconButton, { label: "移除引用", className: "shelf-remove-button", onClick: () => remove(item.id) }, React.createElement(RemoveIcon)),
        React.createElement(ShelfItemPreview, { item }),
        React.createElement("div", { className: "shelf-item-name", title: item.name }, item.name),
        React.createElement("div", { className: "shelf-item-actions" },
          item.path && React.createElement(IconButton, { label: "预览", disabled: !item.available, onClick: () => window.islandBridge.quickLookShelfItem(item.id) }, React.createElement(PreviewIcon)),
          item.path && React.createElement(IconButton, { label: "在 Finder 中显示", disabled: !item.available, onClick: () => window.islandBridge.revealShelfItem(item.id) }, React.createElement(FinderIcon)),
          item.path && React.createElement(IconButton, { label: "系统分享", disabled: !item.available, onClick: () => shareItems([item.id]) }, React.createElement(SystemShareIcon))
        ))))
    )
  ));
}
