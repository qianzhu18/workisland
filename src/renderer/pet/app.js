import { r as reactExports, R as React, a as ReactDOM } from "../vendor/react-runtime.js";
import { f as formatTokenCount } from "../shared/tokens.js";
import { g as getFireIconByTokenCount } from "../shared/formatters.js";
import {
  BASE_DISPLAY_SIZE,
  BASE_PET_SIZE,
  COMPLETE_IDLE_TIMEOUT_MS,
  SLEEP_TIMEOUT_MS,
  STATUS_ROWS,
  TOTAL_ROWS,
  CODEX_V2_TOTAL_ROWS,
  isCodexV2Sprite,
  derivePetBubble,
  derivePetStatus,
  statusToIntervalMs,
  statusToRow
} from "./model.mjs";
const bubbleSmUrl = "data:image/svg+xml,%3csvg%20width='212'%20height='115'%20viewBox='0%200%20212%20115'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='126'%20y='88'%20width='45'%20height='12'%20fill='white'/%3e%3crect%20x='171'%20y='78'%20width='13'%20height='12'%20fill='white'/%3e%3crect%20x='184'%20y='68'%20width='12'%20height='12'%20fill='white'/%3e%3crect%20x='184'%20y='20'%20width='12'%20height='50'%20fill='white'/%3e%3crect%20x='162'%20y='40'%20width='12'%20height='54'%20fill='white'/%3e%3crect%20x='162'%20y='10'%20width='22'%20height='72'%20fill='white'/%3e%3crect%20x='52'%20width='110'%20height='100'%20fill='white'/%3e%3crect%20x='196'%20y='30'%20width='12'%20height='40'%20fill='white'/%3e%3crect%20x='6'%20y='30'%20width='12'%20height='40'%20fill='white'/%3e%3crect%20x='97'%20y='55'%20width='18'%20height='50'%20fill='white'/%3e%3crect%20x='30'%20y='10'%20width='22'%20height='80'%20fill='white'/%3e%3crect%20x='18'%20y='20'%20width='12'%20height='60'%20fill='white'/%3e%3crect%20x='126'%20y='90'%20width='51'%20height='10'%20fill='%23313233'/%3e%3crect%20x='37'%20y='90'%20width='51'%20height='10'%20fill='%23313233'/%3e%3crect%20x='88'%20y='96'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='100'%20y='105'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='114'%20y='96'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='177'%20y='80'%20width='13'%20height='10'%20fill='%23313233'/%3e%3crect%20x='24'%20y='80'%20width='13'%20height='10'%20fill='%23313233'/%3e%3crect%20x='190'%20y='70'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='70'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='190'%20y='20'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='20'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='168'%20y='10'%20width='22'%20height='10'%20fill='%23313233'/%3e%3crect%20x='24'%20y='10'%20width='22'%20height='10'%20fill='%23313233'/%3e%3crect%20x='46'%20width='122'%20height='10'%20fill='%23313233'/%3e%3crect%20x='202'%20y='30'%20width='10'%20height='40'%20fill='%23313233'/%3e%3crect%20y='30'%20width='10'%20height='40'%20fill='%23313233'/%3e%3c/svg%3e";
const bubbleMdUrl = "data:image/svg+xml,%3csvg%20width='318'%20height='114'%20viewBox='0%200%20318%20114'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='10'%20y='10'%20width='298'%20height='80'%20fill='white'/%3e%3crect%20width='38'%20height='16'%20transform='matrix(1%200%200%20-1%20140%20106)'%20fill='white'/%3e%3crect%20x='20'%20y='90'%20width='120'%20height='10'%20fill='%23313233'/%3e%3crect%20x='178'%20y='90'%20width='120'%20height='10'%20fill='%23313233'/%3e%3crect%20x='140'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='154'%20y='104'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='164'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='298'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='298'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='20'%20width='278'%20height='10'%20fill='%23313233'/%3e%3crect%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3crect%20x='308'%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3c/svg%3e";
const bubbleLgUrl = "data:image/svg+xml,%3csvg%20width='354'%20height='114'%20viewBox='0%200%20354%20114'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='10'%20y='10'%20width='334'%20height='80'%20fill='white'/%3e%3crect%20width='38'%20height='16'%20transform='matrix(1%200%200%20-1%20158%20106)'%20fill='white'/%3e%3crect%20x='20'%20y='90'%20width='138'%20height='10'%20fill='%23313233'/%3e%3crect%20x='196'%20y='90'%20width='138'%20height='10'%20fill='%23313233'/%3e%3crect%20x='158'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='172'%20y='104'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='182'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='334'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='334'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='20'%20width='314'%20height='10'%20fill='%23313233'/%3e%3crect%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3crect%20x='344'%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3c/svg%3e";
const TokenCount = ({ tokenCount, onClick }) => {
  const iconSrc = reactExports.useMemo(() => {
    return getFireIconByTokenCount(tokenCount);
  }, [tokenCount]);
  const displayCount = reactExports.useMemo(() => {
    if (typeof tokenCount === "string") {
      return tokenCount;
    }
    return formatTokenCount(tokenCount);
  }, [tokenCount]);
  return /* @__PURE__ */ React.createElement("div", { className: "token-count-container", onClick }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "token-count-icon",
      style: { backgroundImage: `url(${iconSrc})` }
    }
  ), tokenCount !== 0 && /* @__PURE__ */ React.createElement("span", { className: "token-count-text" }, displayCount));
};
const orcaSprite = new URL("./orca.png", import.meta.url).href;
function PetApp() {
  const [sessions, setSessions] = reactExports.useState([]);
  const [isDragging, setIsDragging] = reactExports.useState(false);
  const [isSleeping, setIsSleeping] = reactExports.useState(false);
  const [isPlaying, setIsPlaying] = reactExports.useState(false);
  const [isCompleteExpired, setIsCompleteExpired] = reactExports.useState(false);
  const [sheetReady, setSheetReady] = reactExports.useState(false);
  const [frameSize, setFrameSize] = reactExports.useState(120);
  const [frameWidth, setFrameWidth] = reactExports.useState(120);
  const [frameCountMap, setFrameCountMap] = reactExports.useState({});
  const [spriteMeta, setSpriteMeta] = reactExports.useState(null);
  const [displaySize, setDisplaySize] = reactExports.useState(BASE_DISPLAY_SIZE);
  const [petSize, setPetSize] = reactExports.useState(BASE_PET_SIZE);
  const [panelState, setPanelState] = reactExports.useState({ open: false, direction: "up" });
  const [todayBurnTotal, setTodayBurnTotal] = reactExports.useState(0);
  const [spriteUrl, setSpriteUrl] = reactExports.useState(orcaSprite);
  const panelOpen = panelState.open;
  const panelDirection = panelState.direction;
  const canvasRef = reactExports.useRef(null);
  const sheetRef = reactExports.useRef(null);
  const frameRef = reactExports.useRef(0);
  const animTimerRef = reactExports.useRef(null);
  const lastActivityTs = reactExports.useRef(Date.now());
  const sleepCheckTimer = reactExports.useRef(null);
  const dragOffset = reactExports.useRef({ x: 0, y: 0 });
  const isHoveredRef = reactExports.useRef(false);
  const lastClickTs = reactExports.useRef(0);
  const clickCountRef = reactExports.useRef(0);
  const playTimerRef = reactExports.useRef(null);
  const completeTimerRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    window.petBridge?.onSessionUpdate((s) => setSessions(s));
    window.petBridge?.onPanelState((state) => {
      setPanelState(state);
    });
    window.petBridge?.onSizeUpdate((size) => {
      setPetSize(size.petSize);
      setDisplaySize(size.displaySize);
    });
    const offBurn = window.petBridge?.onTodayBurnUpdate((total) => setTodayBurnTotal(total));
    window.petBridge?.getSpritePath().then((url) => {
      if (url) setSpriteUrl(url);
    }).catch(() => {
    });
    window.petBridge?.ready();
    return () => {
      offBurn?.();
    };
  }, []);
  reactExports.useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = spriteUrl;
    img.onerror = () => {
      if (cancelled || spriteUrl === orcaSprite) return;
      setSpriteUrl(orcaSprite);
    };
    img.onload = () => {
      if (cancelled) return;
      // 检测 Codex V2 协议（1536×2288，11 行）。否则用默认 orca 格式（7 行）。
      const codexV2 = isCodexV2Sprite(img.naturalWidth, img.naturalHeight);
      const meta = codexV2 ? { protocol: "codex-v2" } : null;
      const totalRows = codexV2 ? CODEX_V2_TOTAL_ROWS : TOTAL_ROWS;
      // codex V2 cell 是 192×208（非正方形），默认协议 cell 是正方形
      const cellHeight = Math.round(img.naturalHeight / totalRows);
      const cellWidth = codexV2 ? 192 : cellHeight;
      const maxFrameCount = Math.floor(img.naturalWidth / cellWidth);
      const offscreen = document.createElement("canvas");
      offscreen.width = img.naturalWidth;
      offscreen.height = img.naturalHeight;
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      sheetRef.current = offscreen;
      // 根据协议选择状态→行映射表
      const rowsMap = codexV2
        ? {
            idle: 0, play: 4, sleep: 0, running: 7,
            attention: 6, complete: 8, drag: 1
          }
        : STATUS_ROWS;
      const actualFrameCounts = {};
      for (const [status2, row] of Object.entries(rowsMap)) {
        let validFrames = 0;
        for (let col = 0; col < maxFrameCount; col++) {
          const imageData = ctx.getImageData(
            col * cellWidth,
            row * cellHeight,
            cellWidth,
            cellHeight
          );
          let isEmpty = true;
          for (let i = 3; i < imageData.data.length; i += 16) {
            if (imageData.data[i] > 0) {
              isEmpty = false;
              break;
            }
          }
          if (!isEmpty) {
            validFrames = col + 1;
          } else if (validFrames > 0) {
            break;
          }
        }
        actualFrameCounts[status2] = Math.max(1, validFrames);
      }
      setFrameSize(cellHeight);
      setFrameWidth(cellWidth);
      setFrameCountMap(actualFrameCounts);
      setSpriteMeta(meta);
      setSheetReady(true);
    };
    return () => {
      cancelled = true;
    };
  }, [spriteUrl]);
  const baseStatus = derivePetStatus(sessions);
  const visibleCount = sessions.length;
  const wakeUp = reactExports.useCallback(() => {
    lastActivityTs.current = Date.now();
    if (isSleeping) setIsSleeping(false);
  }, [isSleeping]);
  reactExports.useEffect(() => {
    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
    if (baseStatus === "complete") {
      completeTimerRef.current = setTimeout(() => {
        setIsCompleteExpired(true);
        lastActivityTs.current = Date.now();
        completeTimerRef.current = null;
      }, COMPLETE_IDLE_TIMEOUT_MS);
    } else {
      setIsCompleteExpired(false);
    }
    return () => {
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
    };
  }, [baseStatus]);
  const effectiveBaseStatus = baseStatus === "complete" && isCompleteExpired ? "idle" : baseStatus;
  reactExports.useEffect(() => {
    if (effectiveBaseStatus !== "idle") wakeUp();
  }, [effectiveBaseStatus, wakeUp]);
  reactExports.useEffect(() => {
    sleepCheckTimer.current = setInterval(() => {
      if (effectiveBaseStatus === "idle" && Date.now() - lastActivityTs.current > SLEEP_TIMEOUT_MS) {
        setIsSleeping(true);
      }
    }, 1e4);
    return () => {
      if (sleepCheckTimer.current) clearInterval(sleepCheckTimer.current);
    };
  }, [effectiveBaseStatus]);
  const status = isDragging ? "drag" : isPlaying ? "play" : effectiveBaseStatus === "idle" && isSleeping ? "sleep" : effectiveBaseStatus;
  const drawFrame = reactExports.useCallback((frame) => {
    const canvas = canvasRef.current;
    const sheet = sheetRef.current;
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const dw = displaySize;
    const dh = displaySize;
    if (canvas.width !== Math.round(dw * dpr) || canvas.height !== Math.round(dh * dpr)) {
      canvas.width = Math.round(dw * dpr);
      canvas.height = Math.round(dh * dpr);
      canvas.style.width = `${dw}px`;
      canvas.style.height = `${dh}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = true;
    const row = statusToRow(status, spriteMeta);
    const sx = frame * frameWidth;
    const sy = row * frameSize;
    ctx.drawImage(sheet, sx, sy, frameWidth, frameSize, 0, 0, dw, dh);
  }, [status, displaySize, frameSize, frameWidth, spriteMeta]);
  reactExports.useEffect(() => {
    if (!sheetReady) return;
    frameRef.current = 0;
    drawFrame(0);
    const interval = statusToIntervalMs(status);
    const framesForStatus = frameCountMap[status] || 1;
    animTimerRef.current = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % framesForStatus;
      drawFrame(frameRef.current);
    }, interval);
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [sheetReady, status, drawFrame, frameCountMap]);
  const handleBadgeClick = reactExports.useCallback((e) => {
    e.stopPropagation();
    wakeUp();
    window.petBridge?.togglePanel();
  }, [wakeUp]);
  const triggerPlay = reactExports.useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setIsPlaying(true);
    const playFrames = frameCountMap["play"] || 1;
    playTimerRef.current = setTimeout(() => {
      setIsPlaying(false);
      playTimerRef.current = null;
    }, playFrames * statusToIntervalMs("play"));
  }, [frameCountMap]);
  const handleMouseDown = reactExports.useCallback((e) => {
    e.preventDefault();
    wakeUp();
    const now = Date.now();
    if (now - lastClickTs.current < 300) {
      clickCountRef.current += 1;
    } else {
      clickCountRef.current = 1;
    }
    lastClickTs.current = now;
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      window.petBridge?.returnToIsland();
      return;
    }
    if (clickCountRef.current === 2) {
      triggerPlay();
      return;
    }
    setIsDragging(true);
    dragOffset.current = { x: e.screenX, y: e.screenY };
    const onMove = (ev) => {
      const dx = ev.screenX - dragOffset.current.x;
      const dy = ev.screenY - dragOffset.current.y;
      dragOffset.current = { x: ev.screenX, y: ev.screenY };
      window.petBridge?.movePet(dx, dy);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setIsDragging(false);
      if (!isHoveredRef.current) {
        window.petBridge?.leavePet();
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [wakeUp, triggerPlay]);
  const handleMouseEnter = reactExports.useCallback(() => {
    isHoveredRef.current = true;
    window.petBridge?.enterPet();
    wakeUp();
  }, [wakeUp]);
  const handleMouseLeave = reactExports.useCallback(() => {
    isHoveredRef.current = false;
    if (!isDragging) {
      window.petBridge?.leavePet();
    }
  }, [isDragging]);
  const bubble = derivePetBubble(status, visibleCount);
  const bubbleBg = bubble ? { sm: bubbleSmUrl, md: bubbleMdUrl, lg: bubbleLgUrl }[bubble.size] : void 0;
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: `pet-root${panelOpen ? " is-panel-open" : ""}`,
      "data-direction": panelDirection,
      style: {
        "--pet-size": `${petSize}px`,
        "--pet-scale": petSize / BASE_PET_SIZE
      }
    },
    /* @__PURE__ */ React.createElement("div", { className: "pet-wrapper" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: `pet-container${isDragging ? " is-dragging" : ""}`,
        onMouseDown: handleMouseDown,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: `pet-speech-bubble${bubble ? " is-visible" : ""}${bubble ? ` is-${bubble.size}` : ""}`,
          style: bubbleBg ? { backgroundImage: `url("${bubbleBg}")` } : void 0,
          onMouseDown: (e) => e.stopPropagation(),
          onClick: handleBadgeClick
        },
        bubble && /* @__PURE__ */ React.createElement("span", { className: "pet-speech-bubble-text", style: { color: bubble.color } }, bubble.text)
      ),
      /* @__PURE__ */ React.createElement("canvas", { ref: canvasRef, className: "pet-canvas" }),
      sheetReady && /* @__PURE__ */ React.createElement(
        TokenCount,
        {
          tokenCount: todayBurnTotal,
          onClick: () => window.petBridge?.openSettingsTab("statistics")
        }
      )
    ))
  );
}
const root = document.getElementById("root");
ReactDOM.createRoot(root).render(/* @__PURE__ */ React.createElement(PetApp, null));
