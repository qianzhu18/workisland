const TOOLBOX_MODULES = Object.freeze(["agent", "shelf", "clipboard", "terminal"]);

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
  reduceToolboxState,
  resolveToolboxReopenModule,
  selectToolboxModule
};
