#!/usr/bin/env node
/**
 * WorkIsland 闲置性能基准（issue #108 / B-13）。
 *
 * 对「正在运行的 WorkIsland」做多轮 top 采样，产出可公开的闲置 CPU / 内存
 * 数据。口径与活动监视器一致（macOS top 的 CPU% / MEM 均为物理口径）：
 *
 *   - CPU：top -l 多轮采样。macOS top 的第一轮是「自进程启动以来的平均值」，
 *     必须丢弃；后续轮次为采样间隔内的瞬时值。逐轮把所有 WorkIsland 进程
 *     的 CPU 相加得到合计序列，取中位数（稳态）/ P95（动画瞬时峰值）。
 *     动画、灵动岛展开等瞬时活动只影响 P95，不污染中位数。
 *   - 内存：top MEM 列（活动监视器「内存」列同源），合计所有进程，取中位数；
 *     另采一轮 ps RSS 作为第二口径。
 *
 * 用法：
 *   node scripts/perf-idle-benchmark.mjs                     # 默认 45 轮 × 2s
 *   node scripts/perf-idle-benchmark.mjs --rounds 30 --interval 2 --json out.json
 *
 * 采样条件要求：岛收起、无进行中的会话（报告需注明采样时的场景）。
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const WORKISLAND_MARK = "WorkIsland";

function parseArgs(argv) {
  const args = { rounds: 45, interval: 2, json: null, label: "idle" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--rounds") args.rounds = Number(argv[++i]);
    else if (key === "--interval") args.interval = Number(argv[++i]);
    else if (key === "--json") args.json = argv[++i];
    else if (key === "--label") args.label = argv[++i];
    else {
      console.error(`未知参数: ${key}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.rounds) || args.rounds < 3 || args.rounds > 600) {
    console.error("--rounds 需在 [3, 600]");
    process.exit(2);
  }
  if (!Number.isFinite(args.interval) || args.interval < 1 || args.interval > 10) {
    console.error("--interval 需在 [1, 10] 秒");
    process.exit(2);
  }
  return args;
}

function machineInfo() {
  const sys = (name) => execFileSync("sysctl", ["-n", name], { encoding: "utf-8" }).trim();
  const sw = (name) => execFileSync("sw_vers", ["-" + name], { encoding: "utf-8" }).trim();
  return {
    cpu: sys("machdep.cpu.brand_string"),
    model: sys("hw.model"),
    ramGb: Math.round(Number(sys("hw.memsize")) / 2 ** 30),
    macOS: `${sw("productVersion")} (${sw("buildVersion")})`,
    date: new Date().toISOString()
  };
}

function findWorkislandPids() {
  const stdout = execFileSync("pgrep", ["-f", "/WorkIsland.app/"], { encoding: "utf-8" });
  const pids = stdout.split("\n").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  if (pids.length === 0) {
    console.error("未发现运行中的 WorkIsland 进程（需要先启动 app）");
    process.exit(1);
  }
  return pids;
}

/** top 的 MEM 列形如 `3360K` / `140M` / `2.1G`，尾部可能带 `+`/`-` 增减标记。统一折算成 MB。 */
function parseMemMb(token) {
  const m = /^(\d+(?:\.\d+)?)([KMG])?[+-]?$/.exec(token);
  if (!m) return NaN;
  const value = Number(m[1]);
  const mult = m[2] === "K" ? 1 / 1024 : m[2] === "G" ? 1024 : 1;
  return value * mult;
}

/**
 * 解析一轮 top 输出中 WorkIsland 进程的 {pid, cpu, mem}。
 * 行格式：PID  COMMAND...  CPU%  MEM  （-stats pid,command,cpu,mem）
 */
function parseTopSample(stdout, pids) {
  const pidSet = new Set(pids);
  const found = [];
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4) continue;
    const pid = Number(fields[0]);
    if (!pidSet.has(pid)) continue;
    const cpu = Number(fields[fields.length - 2]);
    const mem = parseMemMb(fields[fields.length - 1]);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem)) continue;
    found.push({ pid, cpu, mem });
  }
  return found;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function median(values) {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function psRssOf(pids) {
  let total = 0;
  for (const pid of pids) {
    try {
      const kb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf-8" }).trim());
      if (Number.isFinite(kb)) total += kb;
    } catch {
      // 进程可能在采样期间退出，跳过
    }
  }
  return (total / 1024); // MB
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pids = findWorkislandPids();
  const info = machineInfo();
  console.log(`采样目标：${pids.length} 个 WorkIsland 进程 ${JSON.stringify(pids)}`);
  console.log(`机型：${info.cpu} · ${info.model} · ${info.ramGb} GB · macOS ${info.macOS}`);
  console.log(`开始采样：${args.rounds} 轮 × ${args.interval}s（第 1 轮丢弃）…`);

  // macOS top：-l 轮数，-s 间隔（秒）。stats 顺序固定，便于解析。
  // -n 必须盖过系统全部进程（默认按 pid 排序截断，WorkIsland 子进程 pid 大，
  // -n 太小会被截掉导致 CPU 低估）。
  const totalProcs = Number(execFileSync("sh", ["-c", "ps -A -o pid= | wc -l"], { encoding: "utf-8" }).trim()) || 500;
  const stdout = execFileSync(
    "top",
    ["-l", String(args.rounds), "-s", String(args.interval), "-n", String(totalProcs + 200),
     "-stats", "pid,command,cpu,mem"],
    { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 }
  );

  // top 输出按采样轮次分段：每段以「Processes: ...」头部行开始。
  const segments = stdout.split(/^Processes:/m).slice(1);
  if (segments.length < 2) {
    console.error("top 输出解析失败（采样段不足）");
    process.exit(1);
  }
  const samples = [];
  // 第 1 段是「自启动以来的平均」，丢弃；从第 2 段开始是瞬时值
  for (let i = 1; i < segments.length; i += 1) {
    const rows = parseTopSample(segments[i], pids);
    if (rows.length === 0) continue;
    samples.push({
      cpuSum: rows.reduce((acc, r) => acc + r.cpu, 0),
      memSum: rows.reduce((acc, r) => acc + r.mem, 0),
      perProcess: rows
    });
  }
  if (samples.length < 2) {
    console.error(`有效采样轮次不足（${samples.length}），请重试`);
    process.exit(1);
  }

  const cpuSeries = samples.map((s) => s.cpuSum).sort((a, b) => a - b);
  const memSeries = samples.map((s) => s.memSum).sort((a, b) => a - b);
  const rssMb = psRssOf(pids);

  const result = {
    label: args.label,
    machine: info,
    app: "WorkIsland",
    version: (() => {
      try {
        return execFileSync("/usr/libexec/PlistBuddy",
          ["-c", "Print CFBundleShortVersionString",
           "/Applications/WorkIsland.app/Contents/Info.plist"],
          { encoding: "utf-8" }).trim();
      } catch {
        return null;
      }
    })(),
    method: {
      tool: "macOS top -l",
      rounds: samples.length,
      intervalSeconds: args.interval,
      firstRoundDiscarded: true,
      processesTracked: pids.length,
      note: "CPU 合计口径：逐轮所有 WorkIsland 进程（主进程/Helper/Renderer/子进程）CPU 相加；中位数≈稳态，P95≈动画瞬时峰值。MEM 为 top 物理内存口径（与活动监视器同源）。"
    },
    cpuPercent: {
      median: Number(median(samples.map((s) => s.cpuSum)).toFixed(2)),
      p95: Number(quantile(cpuSeries, 0.95).toFixed(2)),
      max: Number(cpuSeries[cpuSeries.length - 1].toFixed(2))
    },
    memoryMb: {
      medianTop: Number(median(samples.map((s) => s.memSum)).toFixed(0)),
      psRss: Number(rssMb.toFixed(0))
    },
    perProcessMedian: samples[0].perProcess.map((r) => ({
      pid: r.pid,
      cpuMedian: Number(median(samples
        .map((s) => s.perProcess.find((p) => p.pid === r.pid))
        .filter(Boolean)
        .map((p) => p.cpu)).toFixed(2)),
      memMedianMb: Number(median(samples
        .map((s) => s.perProcess.find((p) => p.pid === r.pid))
        .filter(Boolean)
        .map((p) => p.mem)).toFixed(0))
    }))
  };

  console.log("\n===== 结果 =====");
  console.log(`闲置 CPU：中位 ${result.cpuPercent.median}% · P95 ${result.cpuPercent.p95}% · 峰值 ${result.cpuPercent.max}%`);
  console.log(`内存：top 口径合计 ${result.memoryMb.medianTop} MB · ps RSS 合计 ${result.memoryMb.psRss} MB`);
  console.log(`达标判定（issue #108：闲置 CPU < 3%）：${result.cpuPercent.median < 3 ? "✅ 达标" : "❌ 未达标，需列优化项"}`);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(result, null, 2) + "\n");
    console.log(`\nJSON 已写入 ${args.json}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
