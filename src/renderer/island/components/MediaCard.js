import { R as React } from "../../vendor/react-runtime.js";
import { formatMediaTime } from "./workstation-model.mjs";

const icon = (path) => React.createElement("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, React.createElement("path", { d: path, fill: "currentColor" }));
const ICONS = {
  previous: "M6 5h2v14H6zm3 7 9-7v14z",
  next: "M16 5h2v14h-2zM6 5l9 7-9 7z",
  play: "M8 5v14l11-7z",
  pause: "M7 5h4v14H7zm6 0h4v14h-4z"
};

export function MediaCard({ media }) {
  const [clock, setClock] = React.useState(Date.now());
  React.useEffect(() => {
    setClock(Date.now());
    if (!media?.playing) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [media?.playing, media?.title, media?.updatedAt]);
  const duration = Math.max(0, Number(media?.durationSec) || 0);
  const projected = Number(media?.elapsedSec) || 0;
  const elapsed = Math.min(duration || Infinity, Math.max(0, projected + (media?.playing ? Math.max(0, clock - (Number(media?.updatedAt) || clock)) / 1000 * (Number(media?.playbackRate) || 1) : 0)));
  const send = (command, extra) => window.islandBridge?.mediaCommand?.({ command, ...extra });
  return React.createElement("section", { className: `media-card${media?.playing ? " is-playing" : " is-paused"}`, "aria-label": "正在播放" },
    React.createElement("button", { type: "button", className: "media-artwork-stage", onClick: () => send("openSource"), "aria-label": `打开 ${media?.appName || "媒体来源"}` },
      media?.artworkDataUrl && React.createElement("div", { className: "media-artwork-glow", style: { backgroundImage: `url(${media.artworkDataUrl})` } }),
      media?.artworkDataUrl
        ? React.createElement("img", { key: `${media?.title}:${media?.artworkDataUrl.length}`, className: "media-artwork", src: media.artworkDataUrl, alt: "", draggable: false })
        : React.createElement("div", { className: "media-artwork media-artwork-placeholder", "aria-hidden": "true" }, "♪"),
      media?.appIconDataUrl && React.createElement("span", { className: "media-source-badge", title: media?.appName || "媒体来源", "aria-label": media?.appName || "媒体来源" },
        React.createElement("img", { key: media.appBundleId, className: "media-source-icon", src: media.appIconDataUrl, alt: "", draggable: false })
      )
    ),
    React.createElement("div", { className: "media-copy" },
      React.createElement("div", { className: "media-title", title: media?.title }, media?.title || "正在播放"),
      React.createElement("div", { className: "media-artist", title: media?.artist }, media?.artist || media?.album || "未知艺术家")
    ),
    React.createElement("div", { className: "media-progress-row" },
      React.createElement("span", null, formatMediaTime(elapsed)),
      React.createElement("input", { className: "media-progress", type: "range", min: 0, max: duration || 1, step: 1, value: elapsed, disabled: !duration, "aria-label": "播放进度", onChange: (event) => send("seek", { positionSec: Number(event.target.value) }), style: { "--media-progress": `${duration ? elapsed / duration * 100 : 0}%` } }),
      React.createElement("span", null, formatMediaTime(duration))
    ),
    React.createElement("div", { className: "media-controls" },
      React.createElement("button", { type: "button", disabled: !media?.canPrevious, onClick: () => send("previous"), "aria-label": "上一首" }, icon(ICONS.previous)),
      React.createElement("button", { type: "button", className: "media-toggle", disabled: !media?.canPlayPause, onClick: () => send("toggle"), "aria-label": media?.playing ? "暂停" : "播放" }, icon(media?.playing ? ICONS.pause : ICONS.play)),
      React.createElement("button", { type: "button", disabled: !media?.canNext, onClick: () => send("next"), "aria-label": "下一首" }, icon(ICONS.next))
    )
  );
}
