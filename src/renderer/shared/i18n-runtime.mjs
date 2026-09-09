function interpolate(template, parameters = {}) {
  return String(template ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(parameters, key) && parameters[key] != null
      ? String(parameters[key])
      : match
  ));
}

function normalizeSnapshot(snapshot = {}) {
  return {
    preference: ["system", "zh-CN", "en"].includes(snapshot.preference) ? snapshot.preference : "system",
    locale: snapshot.locale === "zh-CN" ? "zh-CN" : "en",
    messages: snapshot.messages && typeof snapshot.messages === "object" ? snapshot.messages : {},
    fallbackMessages: snapshot.fallbackMessages && typeof snapshot.fallbackMessages === "object"
      ? snapshot.fallbackMessages
      : {}
  };
}

function createRendererI18n({ onApply = () => {} } = {}) {
  let state = normalizeSnapshot();
  let detachBridge = null;
  const listeners = new Set();

  function applySnapshot(snapshot) {
    state = normalizeSnapshot(snapshot);
    onApply(state);
    for (const listener of listeners) listener(state);
    return state;
  }

  async function initialize(bridge) {
    if (detachBridge) {
      detachBridge();
      detachBridge = null;
    }
    if (typeof bridge?.getLocaleState === "function") {
      applySnapshot(await bridge.getLocaleState());
    } else {
      applySnapshot(state);
    }
    if (typeof bridge?.onLocaleChanged === "function") {
      detachBridge = bridge.onLocaleChanged(applySnapshot) || null;
    }
    return state;
  }

  function t(key, parameters = {}) {
    return interpolate(state.messages[key] ?? state.fallbackMessages[key] ?? key, parameters);
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    initialize,
    applySnapshot,
    t,
    onChange,
    getLocale: () => state.locale,
    getLanguagePreference: () => state.preference,
    dispose() {
      detachBridge?.();
      detachBridge = null;
      listeners.clear();
    }
  };
}

export { createRendererI18n, interpolate, normalizeSnapshot };
