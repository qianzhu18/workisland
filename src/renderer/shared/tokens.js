function formatTokenCount(count, unit) {
  const suffix = unit ? ` ${unit}` : "";
  if (count < 1e3) {
    return count.toString() + suffix;
  }
  if (count < 1e4) {
    return (count / 1e3).toFixed(1).replace(/\.0$/, "") + "K" + suffix;
  }
  if (count < 1e6) {
    return Math.floor(count / 1e3) + "K" + suffix;
  }
  if (count < 1e7) {
    return (count / 1e6).toFixed(1).replace(/\.0$/, "") + "M" + suffix;
  }
  if (count < 1e9) {
    return Math.floor(count / 1e6) + "M" + suffix;
  }
  if (count < 1e10) {
    return (count / 1e9).toFixed(1).replace(/\.0$/, "") + "B" + suffix;
  }
  return Math.floor(count / 1e9) + "B" + suffix;
}
export {
  formatTokenCount as f
};
