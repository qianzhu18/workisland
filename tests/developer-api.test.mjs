import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { buildStatusPayload, handleDeveloperApiRequest, syncDeveloperApi, stopDeveloperApi } = require("../src/main/developer-api.cjs");

function mockResponse() {
  const res = { statusCode: 0, body: "", headers: {} };
  return {
    res,
    writeHead(code, headers) {
      res.statusCode = code;
      res.headers = headers || {};
      return this;
    },
    end(payload) {
      res.body = payload ?? "";
    }
  };
}

function mockCoordinator() {
  return {
    getSessions: () => [
      { id: "s1", tool: "claude", phase: "running", startedAt: 1, updatedAt: 2, latestUserPrompt: "SECRET PROMPT" }
    ],
    getAppVersion: () => "1.3.0-test"
  };
}

test("buildStatusPayload exposes status metadata but never prompts", () => {
  const payload = buildStatusPayload(mockCoordinator());
  assert.equal(payload.ok, true);
  assert.equal(payload.version, "1.3.0-test");
  assert.equal(payload.sessions.length, 1);
  assert.deepEqual(Object.keys(payload.sessions[0]).sort(), ["agent", "id", "phase", "startedAt", "updatedAt"]);
  assert.equal(JSON.stringify(payload).includes("SECRET PROMPT"), false);
});

test("handleDeveloperApiRequest serves status and rejects other paths", () => {
  const coordinator = mockCoordinator();
  const ok = mockResponse();
  handleDeveloperApiRequest(coordinator, {}, { url: "/api/status", headers: {} }, ok);
  assert.equal(ok.res.statusCode, 200);
  const missing = mockResponse();
  handleDeveloperApiRequest(coordinator, {}, { url: "/api/other", headers: {} }, missing);
  assert.equal(missing.res.statusCode, 404);
});

test("handleDeveloperApiRequest enforces the optional bearer token", () => {
  const coordinator = mockCoordinator();
  const apiSettings = { token: "s3cret" };
  const denied = mockResponse();
  handleDeveloperApiRequest(coordinator, apiSettings, { url: "/api/status", headers: {} }, denied);
  assert.equal(denied.res.statusCode, 401);
  const allowed = mockResponse();
  handleDeveloperApiRequest(coordinator, apiSettings, { url: "/api/status", headers: { authorization: "Bearer s3cret" } }, allowed);
  assert.equal(allowed.res.statusCode, 200);
});

test("syncDeveloperApi starts on loopback only when enabled and stops when disabled", async () => {
  const coordinator = {
    getSettings: () => ({ developerApi: { enabled: true, port: 9938, token: "" } }),
    getSessions: () => [],
    getAppVersion: () => "test"
  };
  assert.equal(syncDeveloperApi(coordinator), true);
  // Give the async listen callback a moment, then hit the endpoint.
  await new Promise((resolve) => setTimeout(resolve, 120));
  const response = await fetch("http://127.0.0.1:9938/api/status");
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(stopDeveloperApi(), true);
  let refused = false;
  try {
    await fetch("http://127.0.0.1:9938/api/status");
  } catch {
    refused = true;
  }
  assert.equal(refused, true);
});
