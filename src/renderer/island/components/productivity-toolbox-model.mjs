const TOOLBOX_MODULES = Object.freeze(["agent", "shelf", "clipboard", "terminal"]);

// Sort known utility modules by the user-dragged order; modules missing from
// the order (including newly introduced ones) keep their default position
// after the ordered ones.
function orderToolboxModules(modules = [], order = []) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...modules].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : order.length;
    const rb = rank.has(b) ? rank.get(b) : order.length;
    return ra === rb ? modules.indexOf(a) - modules.indexOf(b) : ra - rb;
  });
}

// Reorder for a drag-and-drop move: move `sourceId` to the position of
// `targetId` within `modules`. Returns a new ordered array of all modules
// (enabled or not) so the persisted order stays stable when modules toggle.
function reorderToolboxModules(modules = [], sourceId, targetId) {
  if (!modules.includes(sourceId) || !modules.includes(targetId) || sourceId === targetId) return modules;
  const next = modules.filter((id) => id !== sourceId);
  next.splice(modules.indexOf(targetId) > modules.indexOf(sourceId)
    ? next.indexOf(targetId) + 1
    : next.indexOf(targetId), 0, sourceId);
  return next;
}

function enabledToolboxModules(settings = {}) {
  const enabled = ["agent"];
  if (settings.fileShelfEnabled !== false) enabled.push("shelf");
  if (settings.clipboardHistoryEnabled === true) enabled.push("clipboard");
  if (settings.terminalEnabled !== false) enabled.push("terminal");
  return enabled;
}

function selectToolboxModule({ current = "agent", attention = false, enabled = ["agent"] } = {}) {
  if (attention) return "agent";
  return TOOLBOX_MODULES.includes(current) && enabled.includes(current) ? current : "agent";
}

function resolveToolboxReopenModule({ mode = "agent", lastModule = "agent", enabled = ["agent"] } = {}) {
  if (mode !== "last") return "agent";
  return TOOLBOX_MODULES.includes(lastModule) && enabled.includes(lastModule) ? lastModule : "agent";
}

function reduceToolboxState(state, event) {
  const current = TOOLBOX_MODULES.includes(state?.current) ? state.current : "agent";
  const previousUtility = current === "agent" ? state?.previousUtility || "" : current;
  if (event?.type === "agent-attention") return { current: "agent", previousUtility };
  if (event?.type === "select" && TOOLBOX_MODULES.includes(event.module)) {
    return {
      current: event.module,
      previousUtility: event.module === "agent" ? previousUtility : event.module
    };
  }
  return { current, previousUtility };
}

export {
  TOOLBOX_MODULES,
  enabledToolboxModules,
  orderToolboxModules,
  reduceToolboxState,
  reorderToolboxModules,
  resolveToolboxReopenModule,
  selectToolboxModule
};
