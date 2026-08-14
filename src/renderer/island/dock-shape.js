// 贴边形态的裁切路径。
//
// 复用刘海那套「贴边侧内凹、自由端凸圆角」的轮廓：与屏幕边缘相接处用一段反向
// 弧线（sweep=0），看起来像是从边缘长出来的，而不是一块贴上去的圆角矩形。
//
// 路径先写在「沿边 u / 深度 v」坐标系里，再按边做 90° 旋转映射到窗口坐标。
// 旋转是正交变换（行列式为 1），所以弧线的 sweep 标志无需改动即可保持方向。
const MAP = {
  // (u 沿边, v 深度) → (x, y)
  top: (u, v) => [u, v],
  right: (u, v, W) => [W - v, u],
  left: (u, v, W, H) => [v, H - u]
};

/**
 * @param edge      "top" | "left" | "right"
 * @param winW/winH 窗口尺寸
 * @param bodyLen   本体沿边方向的长度（不含两端内凹外扩的部分）
 * @param depth     本体垂直于边的深度
 * @param concaveR  贴边侧内凹半径
 * @param convexR   自由端凸圆角半径
 * @param spanStart 形状沿边方向的起点（窗口内坐标）；缺省时居中
 */
function buildDockClipPath({ edge, winW, winH, bodyLen, depth, concaveR, convexR, spanStart }) {
  const map = MAP[edge] ?? MAP.top;
  const p = (u, v) => {
    const [x, y] = map(u, v, winW, winH);
    return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
  };
  // 沿边方向的总跨度 = 本体 + 两端各一个内凹半径
  const span = edge === "top" ? winW : winH;
  const outer = Math.min(bodyLen + 2 * concaveR, span);
  const u0 = spanStart == null
    ? (span - outer) / 2
    : Math.max(0, Math.min(spanStart, span - outer));
  const u1 = u0 + outer;
  const cR = Math.min(concaveR, outer / 4, depth / 4);
  const vR = Math.min(convexR, outer / 4, depth / 2);
  const d = depth;
  return `path('${[
    `M ${p(u0, 0)}`,
    `L ${p(u1, 0)}`,
    `A ${cR},${cR} 0 0,0 ${p(u1 - cR, cR)}`,      // 贴边侧内凹
    `L ${p(u1 - cR, d - vR)}`,
    `A ${vR},${vR} 0 0,1 ${p(u1 - cR - vR, d)}`,  // 自由端凸角
    `L ${p(u0 + cR + vR, d)}`,
    `A ${vR},${vR} 0 0,1 ${p(u0 + cR, d - vR)}`,
    `L ${p(u0 + cR, cR)}`,
    `A ${cR},${cR} 0 0,0 ${p(u0, 0)}`,            // 贴边侧内凹
    "Z"
  ].join(" ")}')`;
}

export { buildDockClipPath as b };
