"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const promises = require("node:fs/promises");

function createSerializedJsonUpdater(filePath) {
  let pending = Promise.resolve();
  return function updateJson(transform) {
    const operation = pending.then(async () => {
      const current = JSON.parse(await promises.readFile(filePath, "utf8"));
      const next = await transform(current);
      const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        await promises.writeFile(tempPath, JSON.stringify(next, null, 2) + "\n", "utf8");
        await promises.rename(tempPath, filePath);
      } catch (error) {
        await promises.unlink(tempPath).catch(() => {});
        throw error;
      }
      return next;
    });
    pending = operation.catch(() => {});
    return operation;
  };
}

module.exports = { createSerializedJsonUpdater };
