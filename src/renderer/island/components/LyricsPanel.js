import { R as React } from "../../vendor/react-runtime.js";

function activeLineIndex(lines, elapsedSec) {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (Number(lines[index]?.atSec) > elapsedSec) break;
    active = index;
  }
  return active;
}

const STATUS_COPY = {
  loading: ["正在寻找歌词", "从公开歌词库匹配当前歌曲"],
  instrumental: ["纯音乐", "让旋律占满这一刻"],
  "not-found": ["暂未找到歌词", "媒体控制仍可正常使用"],
  unavailable: ["歌词暂时不可用", "网络恢复后会自动重试"]
};

export function LyricsPanel({ lyrics, elapsedSec = 0, mode = "full" }) {
  const viewportRef = React.useRef(null);
  const resumeTimerRef = React.useRef(null);
  const [following, setFollowing] = React.useState(true);
  const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
  const activeIndex = activeLineIndex(lines, elapsedSec);

  const pauseFollowing = () => {
    setFollowing(false);
    window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setFollowing(true), 4000);
  };

  React.useEffect(() => () => window.clearTimeout(resumeTimerRef.current), []);
  React.useEffect(() => {
    if (!following || activeIndex < 0 || !viewportRef.current) return;
    const line = viewportRef.current.querySelector(`[data-lyric-index="${activeIndex}"]`);
    if (!line) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    viewportRef.current.scrollTo({
      top: Math.max(0, line.offsetTop - viewportRef.current.clientHeight * 0.42),
      behavior: reduceMotion ? "auto" : "smooth"
    });
  }, [activeIndex, following]);

  if (lyrics?.status === "synced" && lines.length) {
    return React.createElement("section", { className: `lyrics-panel is-${mode}`, "aria-label": "同步歌词", "aria-hidden": mode === "compact" },
      React.createElement("div", { className: "lyrics-eyebrow" }, "正在播放"),
      React.createElement("div", { className: "lyrics-viewport", ref: viewportRef, onWheel: pauseFollowing, onTouchMove: pauseFollowing },
        lines.map((line, index) => React.createElement("p", {
          key: `${line.atSec}:${index}`,
          "data-lyric-index": index,
          className: index === activeIndex ? "lyrics-line is-active" : "lyrics-line"
        }, line.text))
      )
    );
  }

  if (lyrics?.status === "plain" && lyrics.plainText) {
    return React.createElement("section", { className: `lyrics-panel is-${mode}`, "aria-label": "歌词", "aria-hidden": mode === "compact" },
      React.createElement("div", { className: "lyrics-eyebrow" }, "歌词"),
      React.createElement("div", { className: "lyrics-viewport lyrics-plain", ref: viewportRef, onWheel: pauseFollowing, onTouchMove: pauseFollowing },
        lyrics.plainText.split("\n").map((line, index) => React.createElement("p", { className: "lyrics-line", key: index }, line))
      )
    );
  }

  const copy = STATUS_COPY[lyrics?.status];
  if (!copy) return null;
  return React.createElement("section", { className: `lyrics-panel lyrics-status is-${mode}`, "aria-live": "polite", "aria-hidden": mode === "compact" },
    React.createElement("span", { className: `lyrics-status-mark is-${lyrics.status}`, "aria-hidden": "true" }, lyrics.status === "loading" ? "···" : "♪"),
    React.createElement("strong", null, copy[0]),
    React.createElement("span", null, copy[1])
  );
}
