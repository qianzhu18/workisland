import { d as i18nInit } from "../vendor/react-runtime.js";
import { createRendererI18n } from "./i18n-runtime.mjs";

const runtime = createRendererI18n({
  onApply(snapshot) {
    i18nInit({
      [snapshot.locale]: { translation: snapshot.messages },
      en: { translation: snapshot.fallbackMessages }
    }, snapshot.locale);
    if (typeof document !== "undefined") document.documentElement.lang = snapshot.locale;
  }
});

function defaultBridge() {
  if (typeof window === "undefined") return null;
  return window.islandBridge || window.settingsApi || window.debugBridge || window.welcomeBridge || window.petBridge || window.petPanelBridge;
}

async function initializeI18n(bridge = defaultBridge()) {
  return runtime.initialize(bridge);
}

async function setLanguagePreference(preference, bridge = defaultBridge()) {
  if (typeof bridge?.setLanguagePreference !== "function") return null;
  return bridge.setLanguagePreference(preference);
}

const t = (key, parameters) => runtime.t(key, parameters);
const onLocaleChange = (listener) => runtime.onChange(listener);
const getLocale = () => runtime.getLocale();
const getLanguagePreference = () => runtime.getLanguagePreference();

export {
  getLanguagePreference,
  getLocale,
  initializeI18n,
  onLocaleChange,
  setLanguagePreference,
  t
};
