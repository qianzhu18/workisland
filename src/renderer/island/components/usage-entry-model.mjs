export function quotaPeriods(quota) {
  return ['daily', 'weekly'].flatMap(key => {
    const period = quota?.[key];
    if (!period || typeof period.total !== 'string' || !period.total || period.total === '-' ||
        typeof period.usedPct !== 'number' || !Number.isFinite(period.usedPct)) return [];
    const usedPct = Math.min(100, Math.max(0, period.usedPct));
    return [{ ...period, key, usedPct, remainingPct: Math.round((100 - usedPct) * 10) / 10 }];
  });
}
export function codexQuotaSummary(quota) { return quotaPeriods(quota)[0] || null; }
export function usageTotals(summary) {
  if (!summary?.totals) return null;
  const number = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const t = summary.totals;
  return { tokens: ['inputTokens','outputTokens','cacheReadTokens','cacheCreationTokens'].reduce((n,key)=>n+number(t[key]),0),
    costMicroUsd: number(t.costMicroUsd), unknownCostTokens: number(t.unknownCostTokens) };
}
