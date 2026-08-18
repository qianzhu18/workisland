import { r as reactExports, R as React, a as ReactDOM } from "../vendor/react-runtime.js";
import { f as formatTokenCount } from "../shared/tokens.js";
import { LittleEcho, __setFrame } from "./little-echo.js";
import {
  BASE_DISPLAY_SIZE,
  BASE_PET_SIZE,
  COMPLETE_IDLE_TIMEOUT_MS,
  SLEEP_TIMEOUT_MS,
  STATUS_ROWS,
  TOTAL_ROWS,
  CODEX_V2_TOTAL_ROWS,
  CODEX_V2_CELL_WIDTH,
  isCodexV2Sprite,
  derivePetBubble,
  derivePetStatus,
  statusToIntervalMs,
  statusToRow
} from "./model.mjs";
const bubbleSmUrl = "data:image/svg+xml,%3csvg%20width='212'%20height='115'%20viewBox='0%200%20212%20115'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='126'%20y='88'%20width='45'%20height='12'%20fill='white'/%3e%3crect%20x='171'%20y='78'%20width='13'%20height='12'%20fill='white'/%3e%3crect%20x='184'%20y='68'%20width='12'%20height='12'%20fill='white'/%3e%3crect%20x='184'%20y='20'%20width='12'%20height='50'%20fill='white'/%3e%3crect%20x='162'%20y='40'%20width='12'%20height='54'%20fill='white'/%3e%3crect%20x='162'%20y='10'%20width='22'%20height='72'%20fill='white'/%3e%3crect%20x='52'%20width='110'%20height='100'%20fill='white'/%3e%3crect%20x='196'%20y='30'%20width='12'%20height='40'%20fill='white'/%3e%3crect%20x='6'%20y='30'%20width='12'%20height='40'%20fill='white'/%3e%3crect%20x='97'%20y='55'%20width='18'%20height='50'%20fill='white'/%3e%3crect%20x='30'%20y='10'%20width='22'%20height='80'%20fill='white'/%3e%3crect%20x='18'%20y='20'%20width='12'%20height='60'%20fill='white'/%3e%3crect%20x='126'%20y='90'%20width='51'%20height='10'%20fill='%23313233'/%3e%3crect%20x='37'%20y='90'%20width='51'%20height='10'%20fill='%23313233'/%3e%3crect%20x='88'%20y='96'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='100'%20y='105'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='114'%20y='96'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='177'%20y='80'%20width='13'%20height='10'%20fill='%23313233'/%3e%3crect%20x='24'%20y='80'%20width='13'%20height='10'%20fill='%23313233'/%3e%3crect%20x='190'%20y='70'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='70'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='190'%20y='20'%20width='12'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='20'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='168'%20y='10'%20width='22'%20height='10'%20fill='%23313233'/%3e%3crect%20x='24'%20y='10'%20width='22'%20height='10'%20fill='%23313233'/%3e%3crect%20x='46'%20width='122'%20height='10'%20fill='%23313233'/%3e%3crect%20x='202'%20y='30'%20width='10'%20height='40'%20fill='%23313233'/%3e%3crect%20y='30'%20width='10'%20height='40'%20fill='%23313233'/%3e%3c/svg%3e";
const bubbleMdUrl = "data:image/svg+xml,%3csvg%20width='318'%20height='114'%20viewBox='0%200%20318%20114'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='10'%20y='10'%20width='298'%20height='80'%20fill='white'/%3e%3crect%20width='38'%20height='16'%20transform='matrix(1%200%200%20-1%20140%20106)'%20fill='white'/%3e%3crect%20x='20'%20y='90'%20width='120'%20height='10'%20fill='%23313233'/%3e%3crect%20x='178'%20y='90'%20width='120'%20height='10'%20fill='%23313233'/%3e%3crect%20x='140'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='154'%20y='104'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='164'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='298'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='298'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='20'%20width='278'%20height='10'%20fill='%23313233'/%3e%3crect%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3crect%20x='308'%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3c/svg%3e";
const bubbleLgUrl = "data:image/svg+xml,%3csvg%20width='354'%20height='114'%20viewBox='0%200%20354%20114'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3crect%20x='10'%20y='10'%20width='334'%20height='80'%20fill='white'/%3e%3crect%20width='38'%20height='16'%20transform='matrix(1%200%200%20-1%20158%20106)'%20fill='white'/%3e%3crect%20x='20'%20y='90'%20width='138'%20height='10'%20fill='%23313233'/%3e%3crect%20x='196'%20y='90'%20width='138'%20height='10'%20fill='%23313233'/%3e%3crect%20x='158'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='172'%20y='104'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='182'%20y='97'%20width='14'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='334'%20y='10'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='10'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='334'%20y='80'%20width='10'%20height='10'%20fill='%23313233'/%3e%3crect%20x='20'%20width='314'%20height='10'%20fill='%23313233'/%3e%3crect%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3crect%20x='344'%20y='20'%20width='10'%20height='60'%20fill='%23313233'/%3e%3c/svg%3e";
// 宠物气泡里不再放火苗图标，只留用量数字
const TokenCount = ({ tokenCount, onClick }) => {
  const displayCount = reactExports.useMemo(() => {
    if (typeof tokenCount === "string") {
      return tokenCount;
    }
    return formatTokenCount(tokenCount);
  }, [tokenCount]);
  return /* @__PURE__ */ React.createElement("div", { className: "token-count-container", onClick }, tokenCount !== 0 && /* @__PURE__ */ React.createElement("span", { className: "token-count-text" }, displayCount));
};
// The main process resolves the packaged Codex V2 default (`codex:qianxue`)
// through IPC. Orca remains an embedded v1 fallback for damaged/custom input.
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
  const [echoMode, setEchoMode] = reactExports.useState(false);
  const [echoFrame, setEchoFrame] = reactExports.useState(0);
  // Echo 程序化动画的帧驱动：15fps，与源工程的 GIF 帧率一致
  reactExports.useEffect(() => {
    if (!echoMode) return;
    const t = setInterval(() => {
      setEchoFrame((f) => {
        const n = f + 1;
        __setFrame(n);
        echoFrameRef.current = n;
        return n;
      });
    }, 1000 / 15);
    return () => clearInterval(t);
  }, [echoMode]);
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
    const loadSprite = async (fileName) => {
      // echo:little 走程序化渲染（移植自视频工程的 LittleEcho），不加载雪碧图
      if (fileName === "echo:little") {
        setEchoMode(true);
        return;
      }
      setEchoMode(false);
      if (!window.petBridge?.getSpritePath) return;
      try {
        const result = await window.petBridge.getSpritePath(fileName);
        // 初始调用不带 fileName，主进程按设置解析 —— echo 模式经返回值标记回传
        if (result?.echoMode) {
          setEchoMode(true);
          return;
        }
        const url = typeof result === "string" ? result : result?.dataUrl;
        if (url) setSpriteUrl(url);
      } catch (error) {
        console.error("[PetApp] sprite load failed; using bundled fallback", error);
        setSpriteUrl(orcaSprite);
      }
    };
    void loadSprite();
    const offSettings = window.petBridge?.onSettingsChanged((settings) => {
      if (settings?.petSprite) void loadSprite(settings.petSprite);
    });
    window.petBridge?.ready();
    return () => {
      offBurn?.();
      offSettings?.();
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
      // 检测 Codex V2 协议（1536×2288，11 行）。否则使用兼容的 Orca 格式（7 行）。
      const codexV2 = isCodexV2Sprite(img.naturalWidth, img.naturalHeight);
      const meta = codexV2 ? { protocol: "codex-v2" } : null;
      const totalRows = codexV2 ? CODEX_V2_TOTAL_ROWS : TOTAL_ROWS;
      // codex V2 cell 是 192×208（非正方形），默认协议 cell 是正方形
      const cellHeight = Math.round(img.naturalHeight / totalRows);
      const cellWidth = codexV2 ? CODEX_V2_CELL_WIDTH : cellHeight;
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
  // ── Echo 导演层 ──────────────────────────────────────────────────────
  // 组件本身有 12 种情绪、6 种动作和视线向量，静态映射只用到零头，观感死板。
  // 导演层做四件事：空闲情绪轮换 + 随机小动作、状态转场的一次性动作、
  // 点击分级反馈、视线跟随鼠标。全部只在 echoMode 下运行。
  const echoFrameRef = reactExports.useRef(0);
  const echoModeRef = reactExports.useRef(false);
  echoModeRef.current = echoMode;
  const [echoIdleMood, setEchoIdleMood] = reactExports.useState("calm");
  const [echoOverride, setEchoOverride] = reactExports.useState(null);
  const [echoAction, setEchoAction] = reactExports.useState(null);
  const [echoGaze, setEchoGaze] = reactExports.useState(null);
  const echoPrevStatus = reactExports.useRef("idle");
  const fireEchoAction = reactExports.useCallback((name) => {
    setEchoAction({ name, at: echoFrameRef.current + 2 });
  }, []);
  const overrideEcho = reactExports.useCallback((patch, ms) => {
    setEchoOverride({ ...patch, until: Date.now() + ms });
  }, []);
  // 临时覆盖到点自动失效
  reactExports.useEffect(() => {
    if (!echoOverride) return;
    const ms = echoOverride.until - Date.now();
    if (ms <= 0) {
      setEchoOverride(null);
      return;
    }
    const t = setTimeout(() => setEchoOverride(null), ms);
    return () => clearTimeout(t);
  }, [echoOverride]);
  // 空闲时不再永远 calm：情绪按权重轮换，偶尔来一个小动作（歪头/探头/点头）
  reactExports.useEffect(() => {
    if (!echoMode || status !== "idle") return;
    let alive = true;
    let moodT;
    let actT;
    const rotate = () => {
      if (!alive) return;
      const r = Math.random();
      setEchoIdleMood(r < 0.55 ? "calm" : r < 0.75 ? "curious" : r < 0.92 ? "listening" : "sleepy");
      moodT = setTimeout(rotate, 12e3 + Math.random() * 16e3);
    };
    const micro = () => {
      if (!alive) return;
      const r = Math.random();
      fireEchoAction(r < 0.4 ? "tilt" : r < 0.75 ? "peek" : "nod");
      actT = setTimeout(micro, 18e3 + Math.random() * 26e3);
    };
    moodT = setTimeout(rotate, 8e3);
    actT = setTimeout(micro, 9e3 + Math.random() * 8e3);
    return () => {
      alive = false;
      clearTimeout(moodT);
      clearTimeout(actT);
      setEchoIdleMood("calm");
    };
  }, [echoMode, status, fireEchoAction]);
  // 状态转场：完成→跳一下庆祝再转 fond；来任务→点头应声；睡醒→wake 过渡；
  // 拖拽落地→回弹小跳
  reactExports.useEffect(() => {
    if (!echoMode) return;
    const prev = echoPrevStatus.current;
    echoPrevStatus.current = status;
    if (prev === status) return;
    if (status === "complete") {
      fireEchoAction("hop");
      overrideEcho({ mood: "happy" }, 5e3);
    } else if (status === "attention") {
      fireEchoAction("shake");
    } else if (status === "running" && (prev === "idle" || prev === "sleep" || prev === "complete")) {
      fireEchoAction("nod");
    } else if (prev === "sleep" && status === "idle") {
      overrideEcho({ mood: "wake" }, 1800);
    } else if (prev === "drag") {
      fireEchoAction("hop");
    }
  }, [echoMode, status, fireEchoAction, overrideEcho]);
  // 待处理状态每隔一阵摇头呼唤，直到被处理
  reactExports.useEffect(() => {
    if (!echoMode || status !== "attention") return;
    const t = setInterval(() => fireEchoAction("shake"), 9e3);
    return () => clearInterval(t);
  }, [echoMode, status, fireEchoAction]);
  // 视线跟随鼠标（rAF 节流；睡着时不跟）。鼠标离开窗口即回落到情绪默认视线
  reactExports.useEffect(() => {
    if (!echoMode) return;
    let raf = 0;
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        setEchoGaze([
          Math.max(-1, Math.min(1, nx)),
          Math.max(-1, Math.min(1, ny * 0.7))
        ]);
      });
    };
    const onLeave = () => setEchoGaze(null);
    window.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [echoMode]);
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
    if (echoModeRef.current) {
      if (clickCountRef.current === 1) fireEchoAction("nod");
      else if (clickCountRef.current === 2) {
        fireEchoAction("hop");
        overrideEcho({ mood: "happy" }, 2500);
      }
    }
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      // 先播一段告别动作再切回灵动岛。
      // 原来是三连击后立刻 returnToIsland()，桌宠凭空消失、没有任何反馈，
      // 很容易被当成崩溃而不是「切回去了」。play 行用的是 fond-hop
      // （好感 + 小跳），当告别刚好。
      triggerPlay();
      const playFrames = frameCountMap["play"] || 1;
      setTimeout(
        () => window.petBridge?.returnToIsland(),
        playFrames * statusToIntervalMs("play")
      );
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
  }, [wakeUp, triggerPlay, frameCountMap]);
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
      className: `pet-root${panelOpen ? " is-panel-open" : ""}${echoMode ? " is-echo" : ""}`,
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
      echoMode
        ? /* @__PURE__ */ React.createElement(
            "div",
            // 不能 pointer-events:none：LittleEcho 根节点是 0×0 绝对定位锚点，
            // 容器高度全靠这个盒子撑起 —— 它还得接住 mousedown 冒泡给容器做拖动。
            { className: "pet-echo", style: { width: petSize, height: Math.round(petSize * 432 / 1034) } },
            /* @__PURE__ */ React.createElement(LittleEcho, {
              // 桌宠七态 → Echo 情绪/动作。echoFrame 仅用于触发重渲染，
              // 组件内部经 __setFrame 读全局帧号。
              key: echoFrame >= 0 ? "echo" : "echo",
              // play → fond + hop 循环 = 素材库的招牌「好感小跳」组合；
              // complete 基础态用 fond（庆祝转场后的陪伴感），idle 由轮换给出
              mood: echoOverride && Date.now() < echoOverride.until
                ? echoOverride.mood
                : { idle: echoIdleMood, play: "fond", sleep: "doze", running: "focused", attention: "surprised", complete: "fond", drag: "calm" }[status] ?? "calm",
              loop: status === "play" ? "hop" : status === "drag" ? "stumble" : echoOverride && Date.now() < echoOverride.until ? echoOverride.loop : void 0,
              action: echoAction ?? void 0,
              gaze: status === "sleep" ? void 0 : echoGaze ?? void 0,
              width: petSize,
              shadow: false
            })
          )
        : /* @__PURE__ */ React.createElement("canvas", { ref: canvasRef, className: "pet-canvas" }),
      (sheetReady || echoMode) && /* @__PURE__ */ React.createElement(
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
