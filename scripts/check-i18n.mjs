import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u3400-\u9fff]/u;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

function placeholders(value) {
  return [...String(value).matchAll(PLACEHOLDER)].map(match => match[1]).sort();
}

export function validateCatalogs(zh, en) {
  const errors = [];
  const keys = new Set([...Object.keys(zh), ...Object.keys(en)]);
  for (const key of [...keys].sort()) {
    if (!(key in zh)) errors.push(`${key}: missing from zh-CN`);
    if (!(key in en)) errors.push(`${key}: missing from en`);
    if (key in zh && key in en && placeholders(zh[key]).join("|") !== placeholders(en[key]).join("|")) {
      errors.push(`${key}: placeholder mismatch`);
    }
  }
  return errors;
}

export function findHardcodedCjk(source, filename = "source") {
  const errors = [];
  let i = 0;
  let line = 1;
  let state = "code";
  let quote = "";
  let value = "";
  let startLine = 1;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") line += 1;
    if (state === "line-comment") {
      if (ch === "\n") state = "code";
      i += 1;
      continue;
    }
    if (state === "block-comment") {
      if (ch === "*" && next === "/") { state = "code"; i += 2; continue; }
      i += 1;
      continue;
    }
    if (state === "string") {
      if (ch === "\\") {
        value += ch + (next || "");
        i += 2;
        continue;
      }
      if (ch === quote) {
        if (CJK.test(value)) errors.push(`${filename}:${startLine}: hardcoded CJK string: ${value.slice(0, 100)}`);
        state = "code";
        value = "";
        i += 1;
        continue;
      }
      value += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") { state = "line-comment"; i += 2; continue; }
    if (ch === "/" && next === "*") { state = "block-comment"; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      state = "string";
      quote = ch;
      startLine = line;
      value = "";
      i += 1;
      continue;
    }
    i += 1;
  }
  return errors;
}

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(?:js|mjs|cjs|html)$/.test(name)) files.push(full);
  }
  return files;
}

export function run() {
  const zh = JSON.parse(readFileSync(path.join(ROOT, "src/locales/zh-CN.json"), "utf8"));
  const en = JSON.parse(readFileSync(path.join(ROOT, "src/locales/en.json"), "utf8"));
  const errors = validateCatalogs(zh, en);
  const rendererFiles = walk(path.join(ROOT, "src/renderer"));
  const mainFiles = walk(path.join(ROOT, "src/main")).filter(file => file.endsWith(".cjs"));
  const guardedMain = new Set(["ipc-services.cjs", "update-service.cjs"]);
  for (const file of [...rendererFiles, ...mainFiles]) {
    const relative = path.relative(ROOT, file);
    const source = readFileSync(file, "utf8");
    if (file.includes(`${path.sep}renderer${path.sep}`) || guardedMain.has(path.basename(file))) {
      errors.push(...findHardcodedCjk(source, relative));
    }
    for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
      if (!(match[1] in zh)) errors.push(`${relative}: missing catalog key ${match[1]}`);
    }
  }
  if (errors.length) {
    console.error(`i18n validation failed (${errors.length}):\n${errors.join("\n")}`);
    return false;
  }
  console.log(`i18n validation passed: ${Object.keys(zh).length} aligned keys, ${rendererFiles.length} renderer files guarded.`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (!run()) process.exitCode = 1;
}
