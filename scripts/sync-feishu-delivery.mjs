import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const FEISHU_API = "https://open.feishu.cn/open-apis";
const TASK_STATUS = {
  merged: "待验收",
};

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function request(url, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code) {
    throw new Error(`Feishu API request failed (${response.status}): ${payload.msg || payload.message || "unknown error"}`);
  }
  return payload;
}

export function taskMatchesPullRequest(task, pullRequestNumber) {
  const needle = `#${pullRequestNumber}`;
  return Object.values(task.fields || {}).some((value) => JSON.stringify(value).includes(needle));
}

export function updateForPullRequest(event) {
  const pullRequest = event?.pull_request;
  if (!pullRequest?.number || !pullRequest.merged) return null;
  return {
    pullRequestNumber: pullRequest.number,
    status: TASK_STATUS.merged,
    summary: `GitHub PR #${pullRequest.number} 已合入 ${pullRequest.base?.ref || "main"}，等待验收证据回填。`,
  };
}

async function getTenantAccessToken() {
  const payload = await request(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    body: {
      app_id: requiredEnvironment("FEISHU_APP_ID"),
      app_secret: requiredEnvironment("FEISHU_APP_SECRET"),
    },
  });
  if (!payload?.tenant_access_token) throw new Error("Feishu did not return a tenant access token.");
  return payload.tenant_access_token;
}

async function listRecords({ token, baseToken, tableId }) {
  const records = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const payload = await request(
      `${FEISHU_API}/base/v3/bases/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`,
      { token },
    );
    const data = payload.data || {};
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : "";
  } while (pageToken);
  return records;
}

async function updateRecord({ token, baseToken, tableId, recordId, fields }) {
  return request(
    `${FEISHU_API}/base/v3/bases/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    { method: "PATCH", token, body: { fields } },
  );
}

export async function syncPullRequest({ event, dryRun = false, api = { getTenantAccessToken, listRecords, updateRecord } }) {
  const update = updateForPullRequest(event);
  if (!update) return { skipped: true, reason: "The event is not a merged pull request." };

  const token = await api.getTenantAccessToken();
  const baseToken = requiredEnvironment("FEISHU_BASE_TOKEN");
  const taskTableId = requiredEnvironment("FEISHU_TASK_TABLE_ID");
  const tasks = await api.listRecords({ token, baseToken, tableId: taskTableId });
  const task = tasks.find((candidate) => taskMatchesPullRequest(candidate, update.pullRequestNumber));
  if (!task) return { skipped: true, reason: `No Feishu task references PR #${update.pullRequestNumber}.` };

  const fields = { "状态": update.status };
  if (dryRun) return { dryRun: true, recordId: task.record_id, fields, summary: update.summary };

  await api.updateRecord({ token, baseToken, tableId: taskTableId, recordId: task.record_id, fields });
  return { updated: true, recordId: task.record_id, fields, summary: update.summary };
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required. Run this command from GitHub Actions or provide an event fixture in a test.");
  return JSON.parse(readFileSync(eventPath, "utf8"));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await syncPullRequest({ event: readEvent(), dryRun });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
