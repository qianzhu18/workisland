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
  const right = slots.filter(slot => slot.bank === 'right');
  const slack = right.length ? width - 2 * TOOL_SLOT - right.at(-1).x - TOOL_SLOT : 0;
  const counts = { left: 0, right: 0 };
  for (const slot of slots) {
    if (slot.bank === 'right') slot.x += slack;
    slot.key = slot.bank + ':' + counts[slot.bank]++;
  }
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

export function placeToolbarTools(order, layout, sides = {}, saved = {}) {
  const available = layout.slots.map((slot, index) => ({ ...slot, index }));
  const positions = new Map();
  for (const id of order) {
    if (!Object.hasOwn(saved, id)) continue;
    const index = available.findIndex(slot => slot.key === saved[id]);
    if (index >= 0) positions.set(id, available.splice(index, 1)[0]);
  }
  for (const id of order) {
    if (Object.hasOwn(saved, id)) continue;
    const preferred = sides[id];
    let index = preferred ? available.findIndex(slot => slot.bank === preferred) : 0;
    if (index < 0) index = 0;
    if (!available.length) break;
    positions.set(id, available.splice(index, 1)[0]);
  }
  return positions;
}

// Freeze existing positions before moving: deliberate gaps must not compact.
export function moveToolbarTool(order, layout, sides, saved, source, target) {
  const positions = placeToolbarTools(order, layout, sides, saved);
  const next = { ...saved };
  for (const [id, slot] of positions) next[id] = slot.key;
  const destination = layout.slots[target];
  if (!destination) return next;
  const occupant = [...positions].find(([, slot]) => slot.key === destination.key)?.[0];
  const origin = positions.get(source);
  if (occupant && occupant !== source) {
    const free = layout.slots.find(slot => ![...positions.values()].some(p => p.key === slot.key));
    next[occupant] = origin?.key || free?.key || 'overflow';
  }
  next[source] = destination.key;
  return next;
}
