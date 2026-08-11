"use strict";

const electron = require("electron");
const log = require("electron-log");

const APPROVAL_ACTIONS = ["approve", "reject", "allowAlways"];
const JUMP_ACTIONS = ["jumpToTerminal"];
const COLLAPSE_ACTIONS = ["collapsePanel"];
const SWITCH_SESSION_ACTIONS = ["switchSession"];
const EPHEMERAL_ACTIONS = [
  ...APPROVAL_ACTIONS,
  ...JUMP_ACTIONS,
  ...COLLAPSE_ACTIONS
];
const ALL_ACTIONS = [
  "toggleIsland",
  "collapsePanel",
  "approve",
  "reject",
  "allowAlways",
  "jumpToTerminal",
  "switchSession"
];
function modifierToElectron(m) {
  switch (m) {
    case "Ctrl":
      return "Control";
    case "Cmd":
      return "Command";
    case "Shift":
      return "Shift";
    case "Alt":
      return "Alt";
  }
}
function buildAccelerator(modifiers, key) {
  if (!key) return null;
  if (modifiers.length === 0) return null;
  const parts = modifiers.map(modifierToElectron);
  parts.push(key.toUpperCase());
  return parts.join("+");
}
class ShortcutService {
  constructor(handlers) {
    this.handlers = handlers;
  }
  config = null;
  approvalArmed = false;
  jumpArmed = false;
  panelExpanded = false;
  confirmArmed = false;
  registered = /* @__PURE__ */ new Set();
  switchSessionKeys = /* @__PURE__ */ new Set();
  status = {
    toggleIsland: "disabled",
    collapsePanel: "disabled",
    approve: "disabled",
    reject: "disabled",
    allowAlways: "disabled",
    jumpToTerminal: "disabled",
    switchSession: "disabled"
  };
  onStatusChange = null;
  setOnStatusChange(cb) {
    this.onStatusChange = cb;
    cb({ ...this.status });
  }
  getStatus() {
    return { ...this.status };
  }
  /** Called on app start and whenever user edits shortcut settings. */
  setConfig(config) {
    this.config = config;
    this.unregisterAll();
    for (const id of ALL_ACTIONS) this.status[id] = "disabled";
    this.registerPersistent();
    this.probeEphemeral(EPHEMERAL_ACTIONS);
    if (this.panelExpanded) {
      if (this.approvalArmed) this.registerApproval();
      if (this.jumpArmed) this.registerJump();
      this.registerCollapse();
      this.registerSwitchSession();
    }
    this.emitStatus();
  }
  /** Called when a pending approval first appears. Idempotent. */
  armApproval() {
    if (this.approvalArmed) return;
    this.approvalArmed = true;
    if (this.panelExpanded) {
      this.registerApproval();
      this.emitStatus();
    }
  }
  /** Called when all pending approvals are resolved. Idempotent. */
  disarmApproval() {
    if (!this.approvalArmed) return;
    this.approvalArmed = false;
    if (this.panelExpanded) {
      this.unregisterIds(APPROVAL_ACTIONS);
      this.probeEphemeral(EPHEMERAL_ACTIONS);
      this.emitStatus();
    }
  }
  /** Called when a jump-target-available completed session first appears. Idempotent. */
  armJump() {
    if (this.jumpArmed) return;
    this.jumpArmed = true;
    if (this.panelExpanded) {
      this.registerJump();
      this.emitStatus();
    }
  }
  /** Called when no such session exists anymore. Idempotent. */
  disarmJump() {
    if (!this.jumpArmed) return;
    this.jumpArmed = false;
    if (this.panelExpanded) {
      this.unregisterIds(JUMP_ACTIONS);
      this.probeEphemeral(EPHEMERAL_ACTIONS);
      this.emitStatus();
    }
  }
  /** Called when island panel expands — registers all armed ephemeral shortcuts. */
  setPanelExpanded(expanded) {
    if (this.panelExpanded === expanded) return;
    this.panelExpanded = expanded;
    if (expanded) {
      if (this.approvalArmed) this.registerApproval();
      if (this.jumpArmed) this.registerJump();
      this.registerCollapse();
      this.registerSwitchSession();
    } else {
      this.unregisterIds([...APPROVAL_ACTIONS, ...JUMP_ACTIONS, ...COLLAPSE_ACTIONS]);
      this.unregisterSwitchSession();
      this.confirmArmed = false;
      this.probeEphemeral(EPHEMERAL_ACTIONS);
    }
    this.emitStatus();
  }
  /** 用户按上下键选中会话后才允许 Enter 确认。面板收起自动 disarm。 */
  armConfirm() {
    if (this.confirmArmed) return;
    this.confirmArmed = true;
    if (this.panelExpanded) this.registerConfirmKey();
  }
  dispose() {
    this.unregisterAll();
  }
  registerPersistent() {
    this.registerBinding("toggleIsland", this.handlers.toggleIsland);
  }
  registerCollapse() {
    const accel = this.acceleratorFor("collapsePanel");
    if (!accel) {
      this.status.collapsePanel = "disabled";
      return;
    }
    if (this.registered.has(accel)) {
      this.status.collapsePanel = "ok";
      return;
    }
    try {
      const ok = electron.globalShortcut.register(accel, this.handlers.collapsePanel);
      if (!ok) {
        log.warn("[ShortcutService] collapsePanel register failed (conflict): accel=%s", accel);
        this.status.collapsePanel = "conflict";
        return;
      }
      this.registered.add(accel);
      this.status.collapsePanel = "ok";
      log.info("[ShortcutService] registered collapsePanel accel=%s", accel);
    } catch (err) {
      log.warn("[ShortcutService] collapsePanel register threw: accel=%s err=%s", accel, String(err));
      this.status.collapsePanel = "invalid";
    }
  }
  registerApproval() {
    this.registerBinding("approve", this.handlers.approve);
    this.registerBinding("reject", this.handlers.reject);
    this.registerBinding("allowAlways", this.handlers.allowAlways);
  }
  registerJump() {
    this.registerBinding("jumpToTerminal", this.handlers.jumpToTerminal);
  }
  registerSwitchSession() {
    if (!this.config) return;
    const binding = this.config.bindings.switchSession;
    if (!binding || !binding.enabled) {
      this.status.switchSession = "disabled";
      return;
    }
    let ok = true;
    const accels = [
      { key: "Up", handler: this.handlers.switchSessionUp },
      { key: "Down", handler: this.handlers.switchSessionDown }
    ];
    for (const { key, handler } of accels) {
      if (this.switchSessionKeys.has(key)) continue;
      if (this.registered.has(key)) {
        ok = false;
        continue;
      }
      try {
        const result = electron.globalShortcut.register(key, handler);
        if (!result) {
          ok = false;
          continue;
        }
        this.registered.add(key);
        this.switchSessionKeys.add(key);
      } catch {
      }
    }
    if (this.confirmArmed) this.registerConfirmKey();
    this.status.switchSession = ok ? "ok" : "conflict";
  }
  unregisterSwitchSession() {
    for (const accel of ["Up", "Down", "Return"]) {
      this.unregister(accel);
      this.switchSessionKeys.delete(accel);
    }
  }
  registerConfirmKey() {
    const key = "Return";
    if (this.switchSessionKeys.has(key)) return;
    if (this.registered.has(key)) return;
    try {
      const result = electron.globalShortcut.register(key, this.handlers.confirmSession);
      if (!result) return;
      this.registered.add(key);
      this.switchSessionKeys.add(key);
    } catch {
    }
  }
  unregisterIds(ids) {
    for (const id of ids) {
      const accel = this.acceleratorFor(id);
      if (accel) this.unregister(accel);
    }
  }
  unregisterAll() {
    for (const accel of this.registered) {
      try {
        electron.globalShortcut.unregister(accel);
      } catch {
      }
    }
    this.registered.clear();
    this.switchSessionKeys.clear();
  }
  acceleratorFor(id) {
    if (!this.config) return null;
    const binding = this.config.bindings[id];
    if (!binding || !binding.enabled || !binding.key) return null;
    if (COLLAPSE_ACTIONS.includes(id)) {
      return binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
    }
    return buildAccelerator(this.config.modifiers, binding.key);
  }
  registerBinding(id, handler) {
    const accel = this.acceleratorFor(id);
    if (!accel) {
      this.status[id] = "disabled";
      return;
    }
    if (this.registered.has(accel)) {
      this.status[id] = "ok";
      return;
    }
    try {
      const ok = electron.globalShortcut.register(accel, handler);
      if (!ok) {
        log.warn("[ShortcutService] register failed (likely conflict): id=%s accel=%s", id, accel);
        this.status[id] = "conflict";
        return;
      }
      this.registered.add(accel);
      this.status[id] = "ok";
      log.info("[ShortcutService] registered id=%s accel=%s", id, accel);
    } catch (err) {
      log.warn("[ShortcutService] register threw: id=%s accel=%s err=%s", id, accel, String(err));
      this.status[id] = "invalid";
    }
  }
  /**
   * Dry-run registration for ephemeral actions to classify accelerator as
   * ok / invalid / conflict without leaving it registered. Used on setConfig
   * so the UI can show failure state even before the action is armed.
   *
   * Three conflict shapes we must surface:
   *   1. external (OS / other app) — register returns false
   *   2. vs. persistent (toggleIsland) — register returns false
   *   3. within the group itself (approve & reject same key) — detected by
   *      holding each successful probe until the whole group is done, then
   *      releasing all at once.
   */
  probeEphemeral(ids) {
    const probed = [];
    for (const id of ids) {
      const accel = this.acceleratorFor(id);
      if (!accel) {
        this.status[id] = "disabled";
        continue;
      }
      if (this.isSelfRegistered(id)) {
        this.status[id] = "ok";
        continue;
      }
      try {
        const ok = electron.globalShortcut.register(accel, () => {
        });
        if (!ok) {
          this.status[id] = "conflict";
          continue;
        }
        probed.push(accel);
        this.status[id] = "ok";
      } catch (err) {
        log.warn("[ShortcutService] probe threw: id=%s accel=%s err=%s", id, accel, String(err));
        this.status[id] = "invalid";
      }
    }
    for (const accel of probed) {
      try {
        electron.globalShortcut.unregister(accel);
      } catch {
      }
    }
  }
  isSelfRegistered(id) {
    if (!this.panelExpanded) return false;
    if (APPROVAL_ACTIONS.includes(id)) return this.approvalArmed;
    if (JUMP_ACTIONS.includes(id)) return this.jumpArmed;
    if (COLLAPSE_ACTIONS.includes(id)) return true;
    if (SWITCH_SESSION_ACTIONS.includes(id)) return true;
    return false;
  }
  emitStatus() {
    this.onStatusChange?.({ ...this.status });
  }
  unregister(accel) {
    if (!this.registered.has(accel)) return;
    try {
      electron.globalShortcut.unregister(accel);
    } catch {
    }
    this.registered.delete(accel);
  }
}
module.exports = { ShortcutService, buildAccelerator };
