"use strict";

class PetModeController {
  #islandWindow = null;
  #petWindow = null;
  #windowFactory = null;
  #autoCollapseTimer = null;
  #registerReady;
  #sessionUpdateChannel;
  #getSessions;
  #onReady;
  #onModeChange;

  constructor({ registerReady, sessionUpdateChannel, getSessions, onReady = () => {}, onModeChange = () => {} }) {
    if (!sessionUpdateChannel) throw new TypeError("A pet session update channel is required");
    this.#registerReady = registerReady;
    this.#sessionUpdateChannel = sessionUpdateChannel;
    this.#getSessions = getSessions;
    this.#onReady = onReady;
    this.#onModeChange = onModeChange;
  }

  get isActive() {
    return this.#petWindow !== null;
  }

  get window() {
    return this.#petWindow;
  }

  setIslandWindow(window) {
    this.#islandWindow = window;
  }

  setWindowFactory(factory) {
    this.#windowFactory = factory;
  }

  enter(screenX, screenY) {
    if (this.isActive || !this.#islandWindow || !this.#windowFactory) return false;
    this.#petWindow = this.#windowFactory(screenX, screenY);
    this.#petWindow.setOnMove(() => this.tryReturnToIsland());
    this.#onModeChange("island", "pet");
    this.#registerReady(() => {
      this.#petWindow?.send(this.#sessionUpdateChannel, this.#getSessions());
      this.#onReady();
    });
    return true;
  }

  exit() {
    if (!this.isActive) return false;
    this.#clearAutoCollapse();
    this.#petWindow.destroy();
    this.#petWindow = null;
    this.#onModeChange("pet", "island");
    return true;
  }

  tryReturnToIsland() {
    if (!this.#petWindow || !this.#islandWindow) return false;
    const pill = this.#islandWindow.getPillRect();
    const pet = this.#petWindow.getCanvasBounds();
    const overlaps = pet.x < pill.x + pill.width
      && pet.x + pet.width > pill.x
      && pet.y < pill.y + pill.height
      && pet.y + pet.height > pill.y;
    return overlaps ? this.exit() : false;
  }

  resize(scale) {
    this.#petWindow?.resize(scale);
  }

  collapsePanel() {
    if (!this.#petWindow?.isPanelOpen) return;
    this.#clearAutoCollapse();
    this.#petWindow.collapsePanel();
  }

  send(channel, payload) {
    this.#petWindow?.send(channel, payload);
  }

  presentSurface(surface, autoCollapseDelayMs = null) {
    if (!this.#petWindow) return;
    this.#clearAutoCollapse();
    if (this.#petWindow.isPanelOpen) this.#petWindow.sendSurfaceToPanel(surface);
    else this.#petWindow.expandPanelWithSurface(surface);

    if (Number.isFinite(autoCollapseDelayMs) && autoCollapseDelayMs >= 0) {
      this.#autoCollapseTimer = setTimeout(() => {
        this.#autoCollapseTimer = null;
        this.#petWindow?.collapsePanel();
      }, autoCollapseDelayMs);
    }
  }

  dispose() {
    this.exit();
    this.#clearAutoCollapse();
  }

  #clearAutoCollapse() {
    if (!this.#autoCollapseTimer) return;
    clearTimeout(this.#autoCollapseTimer);
    this.#autoCollapseTimer = null;
  }
}

module.exports = { PetModeController };
