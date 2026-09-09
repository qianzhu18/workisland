const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;

function localizedRuntimeText(locale, value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (locale === "en" && CJK_PATTERN.test(text)) return fallback;
  return text;
}

export { localizedRuntimeText };
