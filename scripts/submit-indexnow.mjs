import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = "workisland.yanglaishe.cn";
const key = "12f1aa6eee29e53cee78c0417bcc142e";
const keyLocation = `https://${host}/${key}.txt`;
const defaultUrls = [
  `https://${host}/`,
  `https://${host}/en/`,
  `https://${host}/guide/`,
  `https://${host}/guides/claude-code-notifications/`,
  `https://${host}/en/claude-code-notifications/`
];

const shouldSubmit = process.argv.includes("--submit");
const keyFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../website", `${key}.txt`);
const localKey = (await readFile(keyFile, "utf8")).trim();
if (localKey !== key) throw new Error(`IndexNow key file does not match ${keyFile}`);

const payload = { host, key, keyLocation, urlList: defaultUrls };
if (!shouldSubmit) {
  console.log(JSON.stringify({ mode: "dry-run", endpoint: "https://api.indexnow.org/indexnow", payload }, null, 2));
  process.exit(0);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(payload)
});
if (!response.ok) {
  throw new Error(`IndexNow returned ${response.status}: ${await response.text()}`);
}
console.log(`Submitted ${defaultUrls.length} URLs to IndexNow (${response.status}).`);
