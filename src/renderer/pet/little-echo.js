import { R as React } from "../vendor/react-runtime.js";
const bodyUrl = new URL("./echo-body.png", import.meta.url).href;
const Img = (props) => /* @__PURE__ */ React.createElement("img", { ...props, draggable: false });
const staticFile = (_) => bodyUrl;
let __frame = 0;
const __setFrame = (f) => {
  __frame = f;
};
const useCurrentFrame = () => __frame;
// 以下常量/工具内联自视频工程的 tokens.ts / cinema.ts，避免跨项目依赖
const COLORS = { vermillion: "#C4452D" };
const PAPER_SHADOW_RGB = "96,84,66";
const mix = (t, from, to) => from + (to - from) * t;
const hash01 = (seed) => {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const CANVAS = { w: 1034, h: 432 };
const EYE = { w: 49, h: 51, cy: 234.5, lcx: 381.5, rcx: 664.5 };
const BODY = { x0: 106, x1: 928, y1: 392 };
const ELL = { cx: 517, cy: 216, rx: 411, ry: 176 };
const IDENTITY = [
  { x: 12, y: 12, s: 42 },
  { x: 54, y: 95, s: 42 },
  { x: 982, y: 263, s: 41 },
  { x: 939, y: 328, s: 42 }
];
const EYE_CREAM = "#F8F2E6";
const GLYPH_PIXELS = {
  heart: [
    ".##.##.",
    "#######",
    "#######",
    ".#####.",
    "..###..",
    "...#..."
  ],
  // 八分音符 —— Echo 是声音胶囊，音符比任何抽象粒子都贴题
  note: [
    "..###",
    "..#.#",
    "..#..",
    "..#..",
    "..#..",
    "###..",
    "###.."
  ],
  spark: [
    "...#...",
    "...#...",
    ".#####.",
    "#######",
    ".#####.",
    "...#...",
    "...#..."
  ],
  drop: [
    "..#..",
    "..#..",
    ".###.",
    "#####",
    "#####",
    ".###."
  ],
  zzz: [
    "#####",
    "...#.",
    "..#..",
    ".#...",
    "#####"
  ],
  // 空心方环 = 回声的波纹，倾听时用
  ring: [
    "#####",
    "#...#",
    "#...#",
    "#...#",
    "#####"
  ]
};
const buildGlyphURI = (rows) => {
  const w = rows[0].length;
  const h = rows.length;
  const rects = rows.map(
    (row, y) => [...row].map((c, x) => c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : "").join("")
  ).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="${COLORS.vermillion}" shape-rendering="crispEdges">${rects}</svg>`
  )}`;
};
const GLYPHS = Object.fromEntries(
  Object.keys(GLYPH_PIXELS).map((k) => [
    k,
    {
      uri: buildGlyphURI(GLYPH_PIXELS[k]),
      ratio: GLYPH_PIXELS[k].length / GLYPH_PIXELS[k][0].length
    }
  ])
);
const BODY_URI = staticFile("assets/little-echo/echo-body.png");
const TAU = Math.PI * 2;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const between = (f, a, b) => smooth((f - a) / (b - a));
const snap = (v) => Math.round(v / 3) * 3;
const supr = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.6);
const loopPeriod = (period, loopFrames) => {
  if (!loopFrames) return period;
  return loopFrames / Math.max(1, Math.round(loopFrames / period));
};
const SHAPES = {
  open: () => [[0, 0, 1, 1]],
  half: () => [[0, 0.57, 1, 0.43]],
  closed: () => [[0, 0.58, 1, 0.11]],
  squint: () => [[0, 0.34, 1, 0.3]],
  // 五块像素拱：三块的台阶太小，缩到成片尺寸会读成一条横线
  happy: () => [
    [0, 0.52, 0.21, 0.28],
    [0.2, 0.33, 0.21, 0.28],
    [0.4, 0.18, 0.21, 0.28],
    [0.6, 0.33, 0.21, 0.28],
    [0.8, 0.52, 0.21, 0.28]
  ],
  // 失落 = 上眼睑压下来 + 外眼角更低；坡度不能陡，陡了读成碎片不是眼睛
  sad: (side) => {
    const y = [0.46, 0.38, 0.31, 0.25, 0.2];
    const o = side < 0 ? y : [...y].reverse();
    return o.map((v, i) => [i * 0.2, v, 0.21, 0.36]);
  },
  wide: () => [[-0.09, -0.13, 1.18, 1.26]],
  doze: () => [[0, 0.62, 1, 0.19]]
};
const MOODS = {
  calm: { eye: "open", gaze: [0, 0], tilt: 0, sq: [1, 1], pt: { n: 5, rate: 0.55, reach: 1, rise: -0.05, size: 1 } },
  curious: { eye: "open", gaze: [-0.9, -0.3], tilt: -5, sq: [1, 1], pt: { n: 7, rate: 1, reach: 1.35, rise: -0.2, size: 0.95 } },
  focused: { eye: "open", gaze: [0, -0.75], tilt: 0, sq: [1, 1], pt: { n: 5, rate: 0.5, reach: 0.9, rise: -0.35, size: 1 } },
  listening: {
    eye: "squint",
    gaze: [0.35, 0],
    tilt: 3,
    sq: [1.02, 0.99],
    pt: { n: 5, rate: 0.4, reach: 0.85, rise: 0, size: 1.1 },
    glyph: { kind: "ring", n: 1, motion: "rise", size: 76, life: 150 }
  },
  happy: {
    eye: "happy",
    gaze: [0, 0],
    tilt: 0,
    sq: [0.97, 1.05],
    pt: { n: 8, rate: 1.35, reach: 1.25, rise: -0.75, size: 0.9 },
    glyph: { kind: "note", n: 1, motion: "rise", size: 78, life: 120 }
  },
  // 好感 —— 弯眼 + 两颗像素爱心从头顶浮上去。全片朱红的语义焦点就该落在这里。
  fond: {
    eye: "happy",
    gaze: [0, 0],
    tilt: 2,
    sq: [0.98, 1.03],
    pt: { n: 4, rate: 0.6, reach: 0.95, rise: -0.3, size: 0.9 },
    glyph: { kind: "heart", n: 2, motion: "rise", size: 104, life: 165 }
  },
  // 动容 —— 不是哭，是一滴朱砂从眼下缓缓落下。只一颗。
  moved: {
    eye: "happy",
    gaze: [0, 0.1],
    tilt: 1.5,
    sq: [1, 1],
    pt: { n: 4, rate: 0.4, reach: 0.85, rise: 0.1, size: 1 },
    glyph: { kind: "drop", n: 1, motion: "fall", size: 56, life: 180 }
  },
  sad: {
    eye: "sad",
    gaze: [0, 0.55],
    tilt: -3,
    sq: [1.04, 0.94],
    pt: { n: 3, rate: 0.28, reach: 0.7, rise: 0.7, size: 1.15 },
    glyph: { kind: "drop", n: 1, motion: "fall", size: 50, life: 210 }
  },
  surprised: {
    eye: "wide",
    gaze: [0, -0.3],
    tilt: 0,
    sq: [0.95, 1.08],
    pt: { n: 8, rate: 1.9, reach: 1.9, rise: -0.35, size: 0.85 },
    glyph: { kind: "spark", n: 2, motion: "burst", size: 86, life: 66 }
  },
  sleepy: { eye: "half", gaze: [0, 0.5], tilt: -3, sq: [1.03, 0.96], pt: { n: 3, rate: 0.25, reach: 0.75, rise: 0.35, size: 1.1 } },
  doze: {
    eye: "doze",
    gaze: [0, 0],
    tilt: -6,
    sq: [1.05, 0.93],
    pt: { n: 2, rate: 0.18, reach: 0.6, rise: 0.2, size: 1.2 },
    glyph: { kind: "zzz", n: 1, motion: "rise", size: 72, life: 240 }
  },
  wake: { eye: "half", gaze: [0, -0.6], tilt: -1.5, sq: [1, 1], pt: { n: 4, rate: 0.7, reach: 0.95, rise: -0.1, size: 1 } }
};
const ACTIONS = {
  nod: {
    len: 34,
    at: (t) => ({
      dy: t < 10 ? between(t, 0, 10) * 16 : t < 22 ? mix(between(t, 10, 22), 16, -5) : mix(between(t, 22, 34), -5, 0)
    })
  },
  shake: {
    len: 44,
    at: (t) => ({ rot: Math.sin(t / 44 * Math.PI * 4) * (1 - t / 44) * 6 })
  },
  // 四拍：伸展起跳 → 抛物线 → 挤压落地 → 回弹。落地不许二次弹跳。
  hop: {
    len: 56,
    at: (t) => {
      if (t < 7) {
        const p2 = between(t, 0, 7);
        return { sx: mix(p2, 1, 0.93), sy: mix(p2, 1, 1.1) };
      }
      if (t < 34) {
        const p2 = (t - 7) / 27;
        return { dy: -4 * 96 * p2 * (1 - p2), height: 4 * p2 * (1 - p2) };
      }
      if (t < 41) {
        const p2 = between(t, 34, 41);
        return { sx: mix(p2, 1, 1.1), sy: mix(p2, 1, 0.82), impact: 1 - p2 * 0.15 };
      }
      const p = between(t, 41, 56);
      return { sx: mix(p, 1.1, 1), sy: mix(p, 0.82, 1), impact: (1 - p) * 0.85 };
    }
  },
  tilt: {
    len: 70,
    at: (t) => ({
      rot: t < 14 ? between(t, 0, 14) * -9 : t < 52 ? -9 : mix(between(t, 52, 70), -9, 0)
    })
  },
  peek: {
    len: 76,
    at: (t) => {
      const p = t < 16 ? between(t, 0, 16) : t < 58 ? 1 : 1 - between(t, 58, 76);
      return { rot: p * -4, dx: p * -54, dy: p * 8 };
    }
  },
  stumble: {
    len: 58,
    at: (t) => {
      const p = t / 58;
      return {
        dx: Math.sin(p * Math.PI * 2.2) * (1 - p) * 26,
        // 相位滞后要用 max(0, …−0.5) 而不是 +0.5：后者在 t=0 时是 sin(0.5)≈1.92°，
        // 动作一起手就瞬跳一下角度（循环片的接缝就是这么来的）。
        rot: Math.sin(Math.max(0, p * Math.PI * 2.2 - 0.5)) * (1 - p) * 4
      };
    }
  }
};
const bodyMotion = (f, mood, seed, life, tiltOverride, action, loop, loopFrames) => {
  const M = MOODS[mood];
  const breathe = Math.sin(f / loopPeriod(90, loopFrames) * Math.PI * 2) * 0.012;
  let dx = 0;
  let dy = 0;
  let rot = tiltOverride ?? M.tilt;
  let sx = (1 - breathe) * M.sq[0];
  let sy = (1 + breathe) * M.sq[1];
  let height = 0;
  let impact = 0;
  if (life && !loopFrames) {
    const k = Math.floor(f / 210);
    const lt = (f - k * 210) / 30;
    if (lt >= 0 && lt <= 1) {
      dx += Math.sin(lt * Math.PI) * (hash01(seed + k) > 0.5 ? 3 : -3);
    }
  }
  let d = null;
  if (loop) {
    const A = ACTIONS[loop];
    const period = loopFrames && loopFrames > A.len ? loopFrames : A.len + 34;
    const t = f % period;
    if (t <= A.len) d = A.at(t);
  } else if (action) {
    const A = ACTIONS[action.name];
    const t = f - action.at;
    if (t >= 0 && t <= A.len) d = A.at(t);
  }
  if (d) {
    dx += d.dx ?? 0;
    dy += d.dy ?? 0;
    rot += d.rot ?? 0;
    sx *= d.sx ?? 1;
    sy *= d.sy ?? 1;
    height = d.height ?? 0;
    impact = d.impact ?? 0;
  }
  return { dx, dy, rot, sx, sy, height, impact };
};
const blinkEnvelope = (d) => d < 2 ? 1 : d < 4 ? 2 : d < 6 ? 1 : 0;
const blinkAt = (f, seed, life, scripted) => {
  if (scripted && scripted.length > 0) {
    for (const at of scripted) {
      const d = f - at;
      if (d >= 0 && d < 8) return blinkEnvelope(d);
    }
    return 0;
  }
  if (!life) return 0;
  let t = mix(hash01(seed * 3.1), 40, 120);
  for (let i = 0; i < 400 && t < f + 200; i++) {
    const d = f - t;
    if (d >= 0 && d < 8) return blinkEnvelope(d);
    if (hash01(seed + i * 13.3) < 0.25 && d >= 12 && d < 20) {
      const e = d - 12;
      return blinkEnvelope(e);
    }
    t += mix(hash01(seed + i * 7.7), 90, 150);
  }
  return 0;
};
const saccadeAt = (f, seed, life) => {
  if (!life) return [0, 0];
  const i = Math.floor(f / 42);
  const l = f - i * 42;
  const on = l < 4 ? 0 : clamp01((l - 4) / 3);
  return [
    (hash01(seed + i * 5.3) - 0.5) * 6 * on,
    (hash01(seed + i * 9.1) - 0.5) * 3.6 * on
  ];
};
const LittleEcho = ({
  mood = "calm",
  action,
  loop,
  width = 420,
  x,
  y,
  gaze,
  blinkFrames,
  tilt,
  eyeScale = 1.8,
  seed = 7,
  life = true,
  particles = true,
  glyphs = true,
  identityMotes = true,
  shadow = true,
  impact = true,
  lag = true,
  loopFrames,
  opacity = 1,
  zIndex
}) => {
  const frame = useCurrentFrame();
  const M = MOODS[mood];
  const S = width / CANVAS.w;
  const m = bodyMotion(frame, mood, seed, life, tilt, action, loop, loopFrames);
  const left = x === void 0 ? "50%" : `${x}px`;
  const top = y === void 0 ? "50%" : `${y}px`;
  const scriptedBlinks = blinkFrames ?? (loopFrames ? [Math.round(loopFrames * 0.22)] : void 0);
  const blink = blinkAt(frame, seed, life, scriptedBlinks);
  const [sacX, sacY] = saccadeAt(frame, seed, life && !loopFrames);
  const shapeName = blink === 2 ? "closed" : blink === 1 ? "half" : M.eye;
  const ew = EYE.w * eyeScale;
  const eh = EYE.h * eyeScale;
  const g = gaze ?? M.gaze;
  const eyes = [];
  ["L", "R"].forEach((side) => {
    const sgn = side === "L" ? -1 : 1;
    const cx = side === "L" ? EYE.lcx : EYE.rcx;
    const ox = cx - ew / 2 + g[0] * 16 + sacX;
    const oy = EYE.cy - eh / 2 + g[1] * 12 + sacY;
    SHAPES[shapeName](sgn).forEach((b) => {
      eyes.push({
        position: "absolute",
        left: ox + b[0] * ew,
        top: oy + b[1] * eh,
        width: b[2] * ew,
        height: b[3] * eh,
        backgroundColor: EYE_CREAM
      });
    });
  });
  const motes = [];
  if (identityMotes) {
    IDENTITY.forEach((a, i) => {
      const lm = lag ? bodyMotion(frame - (5 + i * 2), mood, seed, life, tilt, action, loop, loopFrames) : m;
      const ph = i * 2.1 + seed * 0.01;
      motes.push({
        position: "absolute",
        left: snap(a.x + Math.sin(frame / loopPeriod(125.7, loopFrames) * TAU + ph) * 8 + lm.dx),
        top: snap(a.y + Math.cos(frame / loopPeriod(149.6, loopFrames) * TAU + ph) * 6 + lm.dy),
        width: a.s,
        height: a.s,
        backgroundColor: COLORS.vermillion,
        opacity: 0.88
      });
    });
  }
  if (particles) {
    const P = M.pt;
    const LIFE = loopPeriod(96 / P.rate, loopFrames);
    for (let k = 0; k < P.n; k++) {
      const t = ((frame + k * (LIFE / P.n)) % LIFE + LIFE) % LIFE / LIFE;
      const r = hash01(seed * 3.7 + k * 17.3);
      const r2 = hash01(seed * 5.1 + k * 29.7);
      const upper = k % 2 === 0;
      const a = upper ? mix(r, Math.PI * 1.02, Math.PI * 1.42) : mix(r, -Math.PI * 0.02, Math.PI * 0.42);
      const grow = 1.1 + t * 0.62 * P.reach;
      let px = ELL.cx + supr(Math.cos(a)) * ELL.rx * grow;
      let py = ELL.cy + supr(Math.sin(a)) * ELL.ry * grow;
      py += P.rise * t * 90;
      px += Math.sin(frame / loopPeriod(139.6, loopFrames) * TAU + k * 2.3) * 7;
      py += Math.cos(frame / loopPeriod(165.3, loopFrames) * TAU + k * 1.7) * 6;
      const lagF = 4 + Math.floor(r2 * 10);
      const lm = lag ? bodyMotion(frame - lagF, mood, seed, life, tilt, action, loop, loopFrames) : m;
      px += lm.dx;
      py += lm.dy;
      if (impact && m.impact > 0) {
        px += Math.cos(a) * m.impact * 78;
        py += Math.sin(a) * m.impact * 46;
      }
      const size = Math.max(6, snap(mix(t, 34, 11) * P.size));
      motes.push({
        position: "absolute",
        left: snap(px),
        top: snap(py),
        width: size,
        height: size,
        backgroundColor: COLORS.vermillion,
        // 生出来快、消下去慢
        opacity: clamp01(t / 0.12) * (1 - smooth(clamp01((t - 0.45) / 0.55))) * mix(r, 0.55, 0.9)
      });
    }
  }
  const glyphNodes = [];
  const G = M.glyph;
  if (particles && glyphs && G) {
    const spec = GLYPHS[G.kind];
    for (let k = 0; k < G.n; k++) {
      const gLife = loopPeriod(G.life, loopFrames);
      const t = ((frame + k * (gLife / G.n)) % gLife + gLife) % gLife / gLife;
      const r = hash01(seed * 7.9 + k * 23.1);
      const r2 = hash01(seed * 11.3 + k * 41.7);
      const sway = Math.sin(frame / loopPeriod(125.7, loopFrames) * TAU + k * 2.7) * 20;
      let px;
      let py;
      let grow = 1;
      if (G.motion === "rise") {
        px = ELL.cx + mix(r, -210, 210) + sway * t;
        py = -30 - t * 200;
        grow = mix(t, 0.82, 1.12);
      } else if (G.motion === "fall") {
        px = (r < 0.5 ? EYE.lcx : EYE.rcx) + sway * t * 0.4;
        py = EYE.cy + 52 + t * t * 200;
        grow = mix(t, 1, 0.78);
      } else {
        const a = k % 2 === 0 ? mix(r, Math.PI * 1.02, Math.PI * 1.42) : mix(r, -Math.PI * 0.02, Math.PI * 0.42);
        const out = 1.05 + t * 0.72;
        px = ELL.cx + supr(Math.cos(a)) * ELL.rx * out;
        py = ELL.cy + supr(Math.sin(a)) * ELL.ry * out;
        grow = mix(t, 1.1, 0.6);
      }
      const lm = lag ? bodyMotion(frame - (6 + Math.floor(r2 * 8)), mood, seed, life, tilt, action, loop, loopFrames) : m;
      px += lm.dx;
      py += lm.dy;
      const gw = snap(G.size * grow);
      glyphNodes.push({
        position: "absolute",
        left: snap(px) - gw / 2,
        top: snap(py) - gw * spec.ratio / 2,
        width: gw,
        height: gw * spec.ratio,
        backgroundImage: `url("${spec.uri}")`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        opacity: clamp01(t / 0.14) * (1 - smooth(clamp01((t - 0.55) / 0.45)))
      });
    }
  }
  const h = clamp01(m.height);
  const shadowW = (BODY.x1 - BODY.x0) * mix(h, 0.9, 1.38) * S;
  const shadowH = 44 * mix(h, 1, 1.6) * S;
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left, top, width: 0, height: 0, zIndex, opacity } }, shadow ? /* @__PURE__ */ React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: -shadowW / 2,
        top: (BODY.y1 - CANVAS.h / 2) * S - shadowH * 0.18,
        width: shadowW,
        height: shadowH,
        borderRadius: "50%",
        background: `radial-gradient(ellipse at 50% 50%,
              rgba(${PAPER_SHADOW_RGB},${mix(h, 0.5, 0.14)}) 0%,
              rgba(${PAPER_SHADOW_RGB},${mix(h, 0.28, 0.09)}) 46%,
              transparent 74%)`,
        filter: `blur(${mix(h, 2.4, 13) * S * 2.2}px)`
      }
    }
  ) : null, /* @__PURE__ */ React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: -CANVAS.w / 2,
        top: -CANVAS.h / 2,
        width: CANVAS.w,
        height: CANVAS.h,
        transformOrigin: "center center",
        transform: `scale(${S}) translate(${m.dx}px,${m.dy}px) rotate(${m.rot}deg) scale(${m.sx},${m.sy})`
      }
    },
    /* @__PURE__ */ React.createElement(
      Img,
      {
        src: BODY_URI,
        style: {
          position: "absolute",
          inset: 0,
          width: CANVAS.w,
          height: CANVAS.h,
          imageRendering: "pixelated"
        }
      }
    ),
    eyes.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: `eye-${i}`, style: s }))
  ), /* @__PURE__ */ React.createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: -CANVAS.w / 2,
        top: -CANVAS.h / 2,
        width: CANVAS.w,
        height: CANVAS.h,
        transformOrigin: "center center",
        transform: `scale(${S})`
      }
    },
    motes.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: `mote-${i}`, style: s })),
    glyphNodes.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: `glyph-${i}`, style: s }))
  ));
};
export {
  LittleEcho,
  __setFrame
};
