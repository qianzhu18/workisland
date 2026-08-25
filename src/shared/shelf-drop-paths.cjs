"use strict";

const { fileURLToPath } = require("node:url");

function parseFileUriList(value) {
  const paths = [];
  const seen = new Set();
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const url = new URL(line);
      if (url.protocol !== "file:") continue;
      const path = fileURLToPath(url);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    } catch {
      // Finder can include non-URL pasteboard representations; ignore them.
    }
  }
  return paths;
}

module.exports = { parseFileUriList };
