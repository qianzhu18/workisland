"use strict";

class KeyedSingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  has(key) {
    return this.inFlight.has(key);
  }

  run(key, task) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    let tracked;
    tracked = Promise.resolve()
      .then(task)
      .finally(() => {
        if (this.inFlight.get(key) === tracked) this.inFlight.delete(key);
      });
    this.inFlight.set(key, tracked);
    return tracked;
  }
}

module.exports = { KeyedSingleFlight };
