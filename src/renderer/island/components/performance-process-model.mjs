export function preferredProcessMetric(state = {}) {
  const pressure = String(state.memoryPressure || "unknown");
  if (pressure === "warning" || pressure === "critical" || Number(state.memoryPct) >= 75) return "memory";
  return "cpu";
}

export function sortProcessesByMetric(processes = [], metric = "cpu") {
  const key = metric === "memory" ? "memoryBytes" : "cpuPct";
  return [...processes].sort((left, right) => (Number(right?.[key]) || 0) - (Number(left?.[key]) || 0));
}

export function formatProcessMemory(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const gigabyte = 1024 ** 3;
  if (bytes >= gigabyte) return `${(bytes / gigabyte).toFixed(1).replace(/\.0$/, "")} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}
