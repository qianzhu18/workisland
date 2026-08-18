"use strict";

const fs = require("node:fs");

const MAX_CLAUDE_READ_BYTES = 512 * 1024;

/**
 * Read the tail of a Claude Code transcript and determine whether its latest
 * user turn has a terminal assistant response.
 */
function readClaudeTranscriptState(file, maxReadBytes = MAX_CLAUDE_READ_BYTES) {
  try {
    const size = fs.statSync(file).size;
    const readLen = Math.min(size, maxReadBytes);
    const buf = Buffer.alloc(readLen);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, buf, 0, readLen, size - readLen);
    } finally {
      fs.closeSync(fd);
    }
    let unfinished = false;
    let latestPrompt = null;
    let lastEventAt = 0;
    let latestPromptAt = 0;
    for (const line of buf.toString("utf8").split("\n")) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const eventAt = rec?.timestamp ? new Date(rec.timestamp).getTime() : 0;
      if (Number.isFinite(eventAt) && eventAt > lastEventAt) lastEventAt = eventAt;
      if (rec?.type === "user" && !rec.isMeta) {
        const content = rec.message?.content;
        const blocks = Array.isArray(content) ? content : [];
        const text = typeof content === "string"
          ? content
          : blocks.find((block) => block?.type === "text")?.text;
        if (typeof text === "string" && text.trim() && !text.trim().startsWith("<")) {
          latestPrompt = text.trim().slice(0, 200);
          latestPromptAt = eventAt || latestPromptAt;
          unfinished = true;
        }
      }
      if (rec?.type === "assistant") {
        const stopReason = rec.message?.stop_reason ?? rec.stop_reason;
        if (stopReason === "end_turn") unfinished = false;
      }
      if (rec?.type === "system" && rec.subtype === "stop_hook_summary") {
        unfinished = false;
      }
    }
    return { unfinished, latestPrompt, lastEventAt, latestPromptAt };
  } catch {
    return { unfinished: false, latestPrompt: null, lastEventAt: 0, latestPromptAt: 0 };
  }
}

module.exports = { readClaudeTranscriptState, MAX_CLAUDE_READ_BYTES };
