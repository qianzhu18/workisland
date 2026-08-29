"use strict";

function fileUrlToPlatformPath(url, platform) {
  const pathname = decodeURIComponent(url.pathname);
  if (platform === "win32") {
    if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`;
    return pathname.replace(/^\/(?:([A-Za-z]:))/, "$1").replaceAll("/", "\\");
  }
  return pathname;
}

function parseFileUriList(value, { platform = process.platform } = {}) {
  const paths = [];
  const seen = new Set();
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      const url = new URL(line);
      if (url.protocol !== "file:") continue;
      const path = fileUrlToPlatformPath(url, platform);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    } catch {
      // Finder can include non-URL pasteboard representations; ignore them.
    }
  }
  return paths;
}

module.exports = { fileUrlToPlatformPath, parseFileUriList };
