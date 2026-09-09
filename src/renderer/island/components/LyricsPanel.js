import { R as React } from "../../vendor/react-runtime.js";
import { t } from "../../shared/i18n.js";

function activeLineIndex(lines, elapsedSec) {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (Number(lines[index]?.atSec) > elapsedSec) break;
    active = index;
  }
  return active;
}

const STATUS_COPY = {
  loading: ["lyrics.loading.title", "lyrics.loading.description"],
  instrumental: ["lyrics.instrumental.title", "lyrics.instrumental.description"],
  "not-found": ["lyrics.notFound.title", "lyrics.notFound.description"],
  unavailable: ["lyrics.unavailable.title", "lyrics.unavailable.description"]
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
    return React.createElement("section", { className: `lyrics-panel is-${mode}`, "aria-label": t("lyrics.synced") , "aria-hidden": mode === "compact" },
      React.createElement("div", { className: "lyrics-eyebrow" }, t("media.playing")),
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
    return React.createElement("section", { className: `lyrics-panel is-${mode}`, "aria-label": t("lyrics.title"), "aria-hidden": mode === "compact" },
      React.createElement("div", { className: "lyrics-eyebrow" }, t("lyrics.title")),
      React.createElement("div", { className: "lyrics-viewport lyrics-plain", ref: viewportRef, onWheel: pauseFollowing, onTouchMove: pauseFollowing },
        lyrics.plainText.split("\n").map((line, index) => React.createElement("p", { className: "lyrics-line", key: index }, line))
      )
    );
  }

  const copy = STATUS_COPY[lyrics?.status];
  if (!copy) return null;
  return React.createElement("section", { className: `lyrics-panel lyrics-status is-${mode}`, "aria-live": "polite", "aria-hidden": mode === "compact" },
    React.createElement("span", { className: `lyrics-status-mark is-${lyrics.status}`, "aria-hidden": "true" }, lyrics.status === "loading" ? "···" : "♪"),
    React.createElement("strong", null, t(copy[0])),
    React.createElement("span", null, t(copy[1]))
  );
}
