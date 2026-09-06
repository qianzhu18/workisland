export const TOOL_SLOT = 32;
export function toolbarCapacity(width, count) {
  const slots = Math.max(0, Math.floor(width / TOOL_SLOT) - 2);
  return count <= slots ? count : Math.max(0, slots - 1);
}
export function insertTool(order, source, index) {
  if (!order.includes(source)) return order;
  const next = order.filter(id => id !== source);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, source);
  return next;
}
