import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// dock-shape.js 是浏览器侧 ESM（无 import、单一 export），在 node 测试里
// 以文本载入并剥掉 export 后求值 —— 与仓库内读 settings-app.js 源文本的
// 测试同一思路，避免给渲染层文件引入打包器依赖。
const source = readFileSync(new URL("../src/renderer/island/dock-shape.js", import.meta.url), "utf8");
const buildDockClipPath = new Function(
  `${source.replace(/export\s*\{[^}]*\};?/, "")}\nreturn buildDockClipPath;`
)();

/** 取 path 里每个绘图命令的终点坐标（M/L 直接取，A 取末组坐标对）。 */
function endpoints(clipPath) {
  const inner = clipPath.match(/path\('(.*)'\)/)[1];
  const pts = [];
  for (const chunk of inner.split(/(?=[MLA])/)) {
    const cmd = chunk[0];
    if (cmd !== "M" && cmd !== "L" && cmd !== "A") continue;
    const pairs = [...chunk.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    if (pairs.length === 0) continue;
    const last = pairs[pairs.length - 1];
    pts.push([Number(last[1]), Number(last[2])]);
  }
  return pts;
}

const EDGES = ["top", "left", "right"];
// 覆盖从小屏侧边面板到大屏顶部面板的窗口谱系 —— 形状必须在任何机器的
// 任何窗口尺寸下都完整落在窗口内，越界即「贴边只剩空黑/形状被裁」级故障。
const WINDOWS = [
  [380, 560],
  [740, 620],
  [240, 320],
  [1200, 300]
];

test("dock clip path stays inside the window for every edge and size", () => {
  for (const edge of EDGES) {
    for (const [winW, winH] of WINDOWS) {
      const span = edge === "top" ? winW : winH;
      const depth = edge === "top" ? Math.min(44, winH) : Math.min(44, winW);
      for (const spanStart of [0, Math.floor(span / 3), span]) {
        const clip = buildDockClipPath({
          edge, winW, winH,
          bodyLen: Math.min(132, span),
          depth,
          concaveR: 14, convexR: 14,
          spanStart
        });
        for (const [x, y] of endpoints(clip)) {
          assert.ok(x >= -0.5 && x <= winW + 0.5, `${edge} ${winW}x${winH} spanStart=${spanStart}: x=${x} 越界`);
          assert.ok(y >= -0.5 && y <= winH + 0.5, `${edge} ${winW}x${winH} spanStart=${spanStart}: y=${y} 越界`);
        }
      }
    }
  }
});

test("the docked side is flush with the window edge", () => {
  const cases = [
    ["right", (pts, w) => Math.max(...pts.map(p => p[0])) === w],
    ["left", (pts) => Math.min(...pts.map(p => p[0])) === 0],
    ["top", (pts) => Math.min(...pts.map(p => p[1])) === 0]
  ];
  for (const [edge, flush] of cases) {
    const clip = buildDockClipPath({
      edge, winW: 380, winH: 560,
      bodyLen: 132, depth: 44, concaveR: 14, convexR: 14, spanStart: 0
    });
    assert.ok(flush(endpoints(clip), 380), `${edge} 贴边侧不齐平`);
  }
});

// 回归：左边缘的旋转映射 (u,v)→[v,H-u] 翻转了沿边方向，曾把条形画到窗口
// 底部（与顶部定位的胶囊层分家，表现为「左侧吸附只剩一块空黑」）。
// spanStart 的语义必须两侧一致：0 = 贴窗口顶部。
test("left and right strips anchor at the same span position (regression)", () => {
  for (const edge of ["left", "right"]) {
    const clip = buildDockClipPath({
      edge, winW: 380, winH: 560,
      bodyLen: 132, depth: 44, concaveR: 14, convexR: 14, spanStart: 0
    });
    const ys = endpoints(clip).map(p => p[1]);
    assert.equal(Math.min(...ys), 0, `${edge}: 条形应贴窗口顶部`);
    assert.ok(Math.max(...ys) <= 160.5, `${edge}: 条形长度应为 160，实际延伸到 ${Math.max(...ys)}`);
  }
});

// 左右互为镜像：同参数下左边形状 = 右边形状按 x → winW−x 翻转。
// 端点集合逐点比对（排序后），任何一侧的映射改动都会在此暴露。
test("left edge mirrors right edge exactly", () => {
  const opts = { winW: 380, winH: 560, bodyLen: 132, depth: 44, concaveR: 14, convexR: 14, spanStart: 40 };
  // 按去重点集比较：M 起点与闭合弧终点重合会产生一次重复，
  // 两侧遍历方向不同导致重复落在不同角上，属提取伪差而非几何差异
  const norm = (pts) => [...new Set(pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`))]
    .sort()
    .join(" ");
  const right = endpoints(buildDockClipPath({ edge: "right", ...opts }));
  const left = endpoints(buildDockClipPath({ edge: "left", ...opts }));
  const mirrored = left.map(([x, y]) => [380 - x, y]);
  assert.equal(norm(mirrored), norm(right));
});
