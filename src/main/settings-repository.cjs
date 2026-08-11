"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createDefaultSettings, mergeSettings } = require("../shared/settings.cjs");

class SettingsRepository {
  #filePath;
  #saveDelayMs;
  #timer = null;
  #pendingSettings = null;
  #onError;

  constructor(filePath, { saveDelayMs = 300, onError = () => {} } = {}) {
    if (!filePath) throw new TypeError("A settings file path is required");
    this.#filePath = filePath;
    this.#saveDelayMs = saveDelayMs;
    this.#onError = onError;
  }

  load() {
    try {
      return mergeSettings(JSON.parse(fs.readFileSync(this.#filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") this.#onError(error);
      return createDefaultSettings();
    }
  }

  scheduleSave(settings) {
    this.#pendingSettings = settings;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#saveDelayMs);
  }

  flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#pendingSettings) return;

    try {
      fs.mkdirSync(path.dirname(this.#filePath), { recursive: true });
      const temporaryPath = `${this.#filePath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(this.#pendingSettings, null, 2));
      fs.renameSync(temporaryPath, this.#filePath);
      this.#pendingSettings = null;
    } catch (error) {
      this.#onError(error);
    }
  }

  dispose() {
    this.flush();
  }
}

module.exports = { SettingsRepository };
