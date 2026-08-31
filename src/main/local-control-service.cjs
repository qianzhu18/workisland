"use strict";

const crypto = require("node:crypto");
const {
  describeControlledSettings,
  readControlledSettings,
  validateControlledChanges
} = require("../shared/settings-control-schema.cjs");

const SETTINGS_SECTIONS = new Set(["general", "agents", "workstation", "appearance", "sound", "about", "agent-control"]);
const DISPLAY_SURFACES = new Set(["island", "pet"]);
const ATTENTION_PHASES = new Set(["waitingForApproval", "waitingForAnswer"]);
const MAX_JOURNAL_ENTRIES = 50;

function localControlError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function safeClient(client) {
  const name = typeof client?.name === "string"
    ? client.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80)
    : "Local agent";
  const version = typeof client?.version === "string"
    ? client.version.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40)
    : undefined;
  return { name: name || "Local agent", version: version || undefined };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class LocalControlService {
  constructor(dependencies) {
    if (!dependencies?.getSettings || !dependencies?.updateSettings) {
      throw new TypeError("LocalControlService requires settings dependencies");
    }
    this.dependencies = dependencies;
    this.now = dependencies.now || Date.now;
    this.randomId = dependencies.randomId || ((prefix) => `${prefix}-${crypto.randomBytes(12).toString("base64url")}`);
    this.audit = dependencies.audit || { append() {}, list: () => [] };
    this.changeJournal = [];
    this.publicToInternalSession = new Map();
    this.internalToPublicSession = new Map();
  }

  async execute(command, params = {}, client = {}) {
    const safe = safeClient(client);
    try {
      this.#assertEnabled();
      let result;
      switch (command) {
        case "control.describeSettings":
          result = { settings: describeControlledSettings(this.dependencies.getSettings()) };
          break;
        case "control.getSettings":
          result = { settings: readControlledSettings(this.dependencies.getSettings(), params.keys) };
          break;
        case "control.updateSettings":
          result = await this.#updateSettings(params, safe);
          break;
        case "control.undoSettingsChange":
          result = await this.#undoSettingsChange(params, safe);
          break;
        case "control.getProductState":
          result = this.#getProductState();
          break;
        case "control.listVisibleSessions":
          result = { sessions: this.#listVisibleSessions() };
          break;
        case "control.focusSession":
          result = await this.#focusSession(params);
          break;
        case "control.openSettings":
          result = await this.#openSettings(params);
          break;
        case "control.setDisplaySurface":
          result = await this.#setDisplaySurface(params);
          break;
        case "control.getRecentActivity":
          result = { activity: this.audit.list() };
          break;
        default:
          throw localControlError("UNKNOWN_COMMAND", `Unknown local control command: ${String(command)}`);
      }
      this.#audit(command, safe, "success", result);
      return result;
    } catch (error) {
      this.#audit(command, safe, "rejected", undefined, error);
      throw error;
    }
  }

  async undoFromUser(changeId) {
    const client = { name: "WorkIsland user" };
    try {
      const result = await this.#undoSettingsChange({ changeId }, client);
      this.#audit("control.undoSettingsChange", client, "success", result);
      return result;
    } catch (error) {
      this.#audit("control.undoSettingsChange", client, "rejected", undefined, error);
      throw error;
    }
  }

  #assertEnabled() {
    if (this.dependencies.getSettings().localAgentControlEnabled !== true) {
      throw localControlError("LOCAL_CONTROL_DISABLED", "Enable Agent Control in WorkIsland Settings before using local tools.");
    }
  }

  async #updateSettings(params, client) {
    const settings = this.dependencies.getSettings();
    const context = {
      installedPetIds: this.dependencies.getInstalledPetIds?.() || new Set([settings.petSprite])
    };
    const validated = validateControlledChanges(settings, params?.changes, context);
    const oldValues = readControlledSettings(settings, Object.keys(validated.values));
    const changes = Object.keys(validated.values).map((key) => ({
      key,
      oldValue: oldValues[key],
      newValue: validated.values[key]
    }));
    const changeId = this.randomId("change");

    await this.dependencies.updateSettings(validated.partial, "local-agent");
    this.changeJournal.push({ changeId, changes, client: client.name, timestamp: this.now() });
    this.changeJournal = this.changeJournal.slice(-MAX_JOURNAL_ENTRIES);
    this.dependencies.presentSettingsChange?.({ changeId, client: client.name, changes });
    return { changeId, changes };
  }

  async #undoSettingsChange(params, client) {
    const changeId = typeof params?.changeId === "string" ? params.changeId : "";
    const change = this.changeJournal.find((entry) => entry.changeId === changeId);
    if (!change) throw localControlError("CHANGE_UNAVAILABLE", "The requested settings change is no longer available.");

    const settings = this.dependencies.getSettings();
    const keys = change.changes.map((item) => item.key);
    const current = readControlledSettings(settings, keys);
    const conflicts = change.changes.filter((item) => !valuesEqual(current[item.key], item.newValue)).map((item) => item.key);
    if (conflicts.length > 0) {
      throw localControlError("UNDO_CONFLICT", "A newer settings change prevents undo.", { keys: conflicts });
    }

    const oldValues = Object.fromEntries(change.changes.map((item) => [item.key, item.oldValue]));
    const context = {
      installedPetIds: this.dependencies.getInstalledPetIds?.() || new Set([settings.petSprite, ...change.changes.filter((item) => item.key === "petSprite").map((item) => item.oldValue)])
    };
    const validated = validateControlledChanges(settings, oldValues, context);
    await this.dependencies.updateSettings(validated.partial, "local-agent-undo");
    this.changeJournal = this.changeJournal.filter((entry) => entry.changeId !== changeId);
    return { undone: true, changeId, changes: change.changes.map((item) => ({ key: item.key, oldValue: item.newValue, newValue: item.oldValue })), client: client.name };
  }

  #listVisibleSessions() {
    const sessions = Array.isArray(this.dependencies.getSessions?.()) ? this.dependencies.getSessions() : [];
    const liveInternalIds = new Set(sessions.map((session) => session?.id).filter((id) => typeof id === "string"));
    for (const [internalId, publicId] of this.internalToPublicSession) {
      if (liveInternalIds.has(internalId)) continue;
      this.internalToPublicSession.delete(internalId);
      this.publicToInternalSession.delete(publicId);
    }

    return sessions.flatMap((session) => {
      if (!session || typeof session.id !== "string") return [];
      let publicId = this.internalToPublicSession.get(session.id);
      if (!publicId) {
        publicId = this.randomId("session");
        this.internalToPublicSession.set(session.id, publicId);
        this.publicToInternalSession.set(publicId, session.id);
      }
      return [{
        id: publicId,
        agent: typeof session.tool === "string" ? session.tool.slice(0, 80) : "unknown",
        phase: typeof session.phase === "string" ? session.phase.slice(0, 80) : "unknown",
        updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : null,
        requiresAttention: ATTENTION_PHASES.has(session.phase),
        canFocus: Boolean(session.jumpTarget)
      }];
    });
  }

  async #focusSession(params) {
    const publicId = typeof params?.id === "string" ? params.id : "";
    const internalId = this.publicToInternalSession.get(publicId);
    if (!internalId) throw localControlError("SESSION_UNAVAILABLE", "The session is no longer available.");
    const session = (this.dependencies.getSessions?.() || []).find((candidate) => candidate?.id === internalId);
    if (!session?.jumpTarget) throw localControlError("SESSION_UNAVAILABLE", "The session cannot be focused.");
    await this.dependencies.jumpToSession(internalId);
    return { focused: true, id: publicId };
  }

  #getProductState() {
    const base = this.dependencies.getProductState?.() || {};
    const sessions = this.#listVisibleSessions();
    return {
      displaySurface: DISPLAY_SURFACES.has(base.displaySurface) ? base.displaySurface : "island",
      expanded: base.expanded === true,
      modules: base.modules && typeof base.modules === "object" ? { ...base.modules } : {},
      visibleSessionCount: sessions.length,
      requiresAttention: sessions.some((session) => session.requiresAttention)
    };
  }

  async #openSettings(params) {
    const section = typeof params?.section === "string" ? params.section : "agent-control";
    if (!SETTINGS_SECTIONS.has(section)) throw localControlError("ACTION_NOT_ALLOWED", "That Settings section is not available to local control.");
    await this.dependencies.openSettingsTab?.(section);
    return { opened: true, section };
  }

  async #setDisplaySurface(params) {
    const surface = params?.surface;
    if (!DISPLAY_SURFACES.has(surface)) throw localControlError("ACTION_NOT_ALLOWED", "Display surface must be island or pet.");
    await this.dependencies.setDisplaySurface?.(surface);
    return { surface };
  }

  #audit(command, client, result, response, error) {
    const keys = response?.changes?.map((change) => change.key);
    this.audit.append({
      timestamp: this.now(),
      client: client.name,
      clientVersion: client.version,
      tool: typeof command === "string" ? command.replace(/^control\./, "") : "unknown",
      keys,
      result,
      errorCode: error?.code,
      changeId: response?.changeId
    });
  }
}

module.exports = { DISPLAY_SURFACES, LocalControlService, SETTINGS_SECTIONS, localControlError };
