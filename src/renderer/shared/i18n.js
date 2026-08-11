import { d as i18nInit } from "../vendor/react-runtime.js";

const LOCAL_LANG = "flux-language";

function getInitLangSync() {
  const saved = localStorage.getItem(LOCAL_LANG);
  if (saved === "en" || saved === "zh") return saved;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

async function syncLangFromMain() {
  try {
    const bridge = window.islandBridge || window.settingsApi || window.debugBridge || window.welcomeBridge || window.petPanelBridge;
    if (typeof bridge?.getLocale !== "function") return;
    const locale = await bridge.getLocale();
    if (locale === "en" || locale === "zh") localStorage.setItem(LOCAL_LANG, locale);
  } catch {
  }
}

async function switchLang(lang) {
  if (lang !== "en" && lang !== "zh") return;
  localStorage.setItem(LOCAL_LANG, lang);
  const bridge = window.islandBridge || window.settingsApi || window.debugBridge || window.welcomeBridge || window.petPanelBridge;
  if (typeof bridge?.setLocale === "function") await bridge.setLocale(lang);
}

// Active renderer components carry their maintainable fallback strings. The
// translation proxy returns those fallbacks whenever this intentionally small
// local resource does not define a key.
i18nInit({ zh: { translation: {} }, en: { translation: {} } }, getInitLangSync());
void syncLangFromMain();

export { getInitLangSync as g, switchLang as s };
