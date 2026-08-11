"use strict";

function formatFallback(template, params = {}) {
  return String(template).replace(/\{([^}]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

const i18n = new Proxy({}, {
  get(_target, key) {
    if (key === "then") return undefined;
    return (params, fallback = "") => formatFallback(fallback, params);
  }
});

module.exports = { i18n, formatFallback };
