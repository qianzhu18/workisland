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

// All coordinates are relative to the toolbar's content box. The two banks
// share one reading order, but no slot intersects the physical camera.
export function toolbarSlots(width, notchWidth, leadingWidth) {
  const cameraWidth = Math.max(0, Math.min(notchWidth, width));
  const cameraLeft = (width - cameraWidth) / 2;
  const cameraRight = cameraLeft + cameraWidth;
  const leftStart = Math.min(cameraLeft, Math.max(0, leadingWidth) + (leadingWidth ? 8 : 0));
  const slots = [];
  for (let x = leftStart; x + TOOL_SLOT <= cameraLeft; x += TOOL_SLOT) slots.push({ x, bank: 'left' });
  for (let x = cameraRight + TOOL_SLOT; x + TOOL_SLOT <= width - 2 * TOOL_SLOT; x += TOOL_SLOT) slots.push({ x, bank: 'right' });
  return { slots, cameraLeft, cameraRight, home: cameraRight, more: width - 2 * TOOL_SLOT, settings: width - TOOL_SLOT };
}

export function toolbarDropTarget(layout, x, y, height) {
  if (y < 0 || y > height) return null;
  if (x >= layout.more && x <= layout.more + TOOL_SLOT) return 'more';
  const index = layout.slots.findIndex(slot => x >= slot.x && x <= slot.x + TOOL_SLOT);
  return index < 0 ? null : index;
}

export function visibleToolbarOrder(order, hidden, source = null) {
  return order.filter(id => id === source || !hidden.includes(id));
}

export function placeToolbarTools(order, layout, sides = {}) {
  const available = layout.slots.map((slot, index) => ({ ...slot, index }));
  const positions = new Map();
  for (const id of order) {
    const preferred = sides[id];
    let index = preferred ? available.findIndex(slot => slot.bank === preferred) : 0;
    if (index < 0) index = 0;
    if (!available.length) break;
    positions.set(id, available.splice(index, 1)[0]);
  }
  return positions;
}
