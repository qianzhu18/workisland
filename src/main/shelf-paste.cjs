'use strict';
function pasteShelfClipboard(coordinator, clipboard, readPaths) {
  const paths = readPaths();
  if (Array.isArray(paths) && paths.length) return coordinator.addShelfPaths(paths);
  const image = clipboard.readImage();
  if (!image.isEmpty()) return coordinator.addShelfClipboardImage(image.toPNG());
  const text = clipboard.readText().trim();
  if (!text) return coordinator.getShelfState();
  return coordinator.addShelfPayload({ type: /^https?:\/\//i.test(text) ? 'url' : 'text', value: text });
}
module.exports = { pasteShelfClipboard };
