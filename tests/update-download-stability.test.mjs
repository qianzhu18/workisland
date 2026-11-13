import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { createUpdateService } = require("../src/main/update-service.cjs");
const bytes = Buffer.from("12345678");
const name = "WorkIsland-1.0.0-arm64.dmg";
const dmgUrl = `https://example.com/${name}`;
const checksumUrl = "https://example.com/SHA256SUMS.txt";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const never = () => new Promise(() => {});
function response(body, status = 200, range = null) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(range ? { "Content-Range": range } : {}), body };
}
function stream(...chunks) {
  return (async function* () { yield* chunks; })();
}
function dropped(prefix = bytes.subarray(0, 4)) {
  return (async function* () { yield prefix; throw new Error("socket dropped"); })();
}
async function fixture(t, transfer, options = {}) {
  const userDataPath = fs.mkdtempSync(join(tmpdir(), "workisland-download-stability-"));
  t.after(() => fs.promises.rm(userDataPath, { recursive: true, force: true }));
  const calls = [];
  const warnings = [];
  const states = [];
  const payload = {
    tag_name: "v1.0.0", assets: [
      { name, size: bytes.length, browser_download_url: dmgUrl },
      { name: "SHA256SUMS.txt", browser_download_url: checksumUrl }
    ]
  };
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => "0.9.0" },
    platform: "darwin", arch: "arm64", userDataPath,
    requestTimeoutMs: 30, downloadIdleTimeoutMs: 30,
    downloadRetryDelaysMs: [0, 0, 0],
    logger: { warn: (...args) => warnings.push(args), debug() {} },
    onUpdateState: (state) => states.push(state),
    fetchImpl: async (url, init) => {
      if (url === checksumUrl) return { ok: true, text: async () => `${sha256(options.content ?? bytes)}  ${name}\n` };
      if (url === dmgUrl) {
        calls.push(init);
        return transfer(calls.length, init);
      }
      return { ok: true, json: async () => payload };
    },
    ...options.service
  });
  await service.check({ force: true, notify: false });
  return { service, calls, warnings, states, destination: join(userDataPath, "update", name) };
}

test("download header timeout bounds fetches that ignore abort and preserves its cause", async (t) => {
  const f = await fixture(t, never);
  const result = await f.service.download();
  assert.equal(result.phase, "error");
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(({ signal }) => signal.aborted));
  const error = f.warnings.find(([message]) => message === "[UpdateService] download failed:")[1];
  assert.equal(error.cause.code, "ETIMEDOUT");
  assert.match(error.cause.message, /request timed out/);
  assert.equal(fs.existsSync(f.destination), false);
});

test("late header responses are canceled after a request timeout", async (t) => {
  let cancelled = 0;
  const f = await fixture(t, async () => {
    await delay(70);
    return response({ cancel() { cancelled += 1; return Promise.reject(new Error("cancel failed")); } });
  });
  assert.equal((await f.service.download()).phase, "error");
  await delay(90);
  assert.equal(cancelled, 3);
});

test("stream idle timeout cancels web readers, releases locks and resumes the written prefix", async (t) => {
  let cancelled = 0;
  let released = 0;
  const ranges = [];
  const f = await fixture(t, (attempt, init) => {
    ranges.push(init.headers.Range);
    if (attempt > 1) return response(stream(bytes.subarray(4)), 206, "bytes 4-7/8");
    let reads = 0;
    return response({ getReader() { return {
      read() { return ++reads === 1 ? Promise.resolve({ value: bytes.subarray(0, 4), done: false }) : never(); },
      cancel() { cancelled += 1; return Promise.reject(new Error("broken cleanup")); },
      releaseLock() { released += 1; }
    }; } });
  });
  assert.equal((await f.service.download()).phase, "ready");
  assert.deepEqual(ranges, [undefined, "bytes=4-"]);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("hanging iterator cleanup cannot prevent idle timeout exhaustion", async (t) => {
  let returned = 0;
  const f = await fixture(t, () => response({
    [Symbol.asyncIterator]() { return this; }, next: never,
    return() { returned += 1; return never(); }
  }));
  assert.equal((await f.service.download()).phase, "error");
  assert.equal(f.calls.length, 3);
  assert.equal(returned, 3);
  assert.equal(fs.existsSync(f.destination), false);
});

test("the idle deadline resets for every stream read rather than bounding the whole transfer", async (t) => {
  const f = await fixture(t, () => response((async function* () {
    for (const byte of bytes) { await delay(10); yield Buffer.from([byte]); }
  })()), { service: { downloadIdleTimeoutMs: 50 } });
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(f.calls.length, 1);
});

for (const range of [null, "bytes 3-7/8", "bytes 4-6/8", "bytes 4-8/9", "bytes 4-7/*", "bytes 4-7/9007199254740993"]) {
  test(`invalid resumed Content-Range ${JSON.stringify(range)} restarts cleanly from zero`, async (t) => {
    let invalidRead = false;
    const f = await fixture(t, (attempt) => {
      if (attempt === 1) return response(dropped());
      if (attempt === 2) return response((async function* () { invalidRead = true; yield bytes; })(), 206, range);
      return response(stream(bytes));
    });
    assert.equal((await f.service.download()).phase, "ready");
    assert.deepEqual(f.calls.map(({ headers }) => headers.Range), [undefined, "bytes=4-", undefined]);
    assert.equal(invalidRead, false);
    assert.deepEqual(fs.readFileSync(f.destination), bytes);
  });
}

test("a 416 resumes only after resetting the file and hash", async (t) => {
  const f = await fixture(t, (attempt) => attempt === 1 ? response(dropped()) : attempt === 2 ? response(null, 416) : response(stream(bytes)));
  assert.equal((await f.service.download()).phase, "ready");
  assert.deepEqual(f.calls.map(({ headers }) => headers.Range), [undefined, "bytes=4-", undefined]);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("ignored Range 200 replaces the partial file and resets the hash", async (t) => {
  const f = await fixture(t, (attempt) => response(attempt === 1 ? dropped() : stream(bytes)));
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("excess stream length is rejected before writing and the next attempt starts at zero", async (t) => {
  const f = await fixture(t, (attempt) => response(attempt === 1 ? stream(bytes.subarray(0, 4), Buffer.from("56789")) : stream(bytes)));
  assert.equal((await f.service.download()).phase, "ready");
  assert.deepEqual(f.calls.map(({ headers }) => headers.Range), [undefined, undefined]);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("full-file writes are used instead of a potentially short single write", async (t) => {
  const nativeOpen = fs.promises.open;
  let writeFileCalls = 0;
  fs.promises.open = async (...args) => {
    const handle = await nativeOpen(...args);
    if (!String(args[0]).endsWith(".dmg")) return handle;
    return {
      async write() { throw new Error("single write must not be used"); },
      async writeFile(buffer) {
        writeFileCalls += 1;
        for (let offset = 0; offset < buffer.length; offset += 2) await handle.write(buffer.subarray(offset, offset + 2));
      },
      close: () => handle.close()
    };
  };
  t.after(() => { fs.promises.open = nativeOpen; });
  const f = await fixture(t, () => response(stream(bytes)));
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(writeFileCalls, 1);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("a partial ENOSPC write is not retried or retained as a resumable prefix", async (t) => {
  const nativeOpen = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await nativeOpen(...args);
    if (!String(args[0]).endsWith(".dmg")) return handle;
    return {
      async writeFile(buffer) {
        await handle.write(buffer.subarray(0, 2));
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
      close: () => handle.close()
    };
  };
  t.after(() => { fs.promises.open = nativeOpen; });
  const f = await fixture(t, () => response(stream(bytes)));
  assert.equal((await f.service.download()).phase, "error");
  assert.equal(f.calls.length, 1);
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.existsSync(`${f.destination}.partial.json`), false);
  const error = f.warnings.find(([message]) => message === "[UpdateService] download failed:")[1];
  assert.equal(error.code, "ENOSPC");
  assert.equal(error.cause.code, "ENOSPC");
});

test("a permanent HTTP error is not retried and its response body is canceled", async (t) => {
  let cancelled = 0;
  const f = await fixture(t, () => response({ cancel() { cancelled += 1; } }, 404));
  assert.equal((await f.service.download()).phase, "error");
  assert.equal(f.calls.length, 1);
  assert.equal(cancelled, 1);
});

test("manual retry reuses only an identity-bound committed prefix", async (t) => {
  let allowSuccess = false;
  const f = await fixture(t, (attempt, init) => {
    if (allowSuccess) return response(stream(bytes.subarray(4)), 206, "bytes 4-7/8");
    return response(attempt === 1 ? dropped() : (async function* () { throw new Error("offline"); })(), init.headers.Range ? 206 : 200, init.headers.Range ? "bytes 4-7/8" : null);
  });
  assert.equal((await f.service.download()).phase, "error");
  assert.deepEqual(fs.readFileSync(f.destination), bytes.subarray(0, 4));
  assert.ok(fs.existsSync(`${f.destination}.partial.json`));
  allowSuccess = true;
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(f.calls[3].headers.Range, "bytes=4-");
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
  assert.equal(fs.existsSync(`${f.destination}.partial.json`), false);
});

test("unknown stale partial and stale metadata are not trusted", async (t) => {
  const f = await fixture(t, () => response(stream(bytes)));
  fs.mkdirSync(join(f.destination, ".."), { recursive: true });
  fs.writeFileSync(f.destination, "old");
  fs.writeFileSync(`${f.destination}.partial.json`, JSON.stringify({ checksum: "0".repeat(64) }));
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(f.calls[0].headers.Range, undefined);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

for (const existing of [bytes, Buffer.from("87654321"), Buffer.from("123456789")]) {
  test(`identity-bound complete file of ${existing.length} bytes is reused only after SHA verification (${sha256(existing).slice(0, 6)})`, async (t) => {
    const f = await fixture(t, () => response(stream(bytes)));
    fs.mkdirSync(join(f.destination, ".."), { recursive: true });
    fs.writeFileSync(f.destination, existing);
    fs.writeFileSync(`${f.destination}.partial.json`, JSON.stringify({ url: dmgUrl, total: bytes.length, checksum: sha256(bytes) }));
    assert.equal((await f.service.download()).phase, "ready");
    assert.equal(f.calls.length, existing.equals(bytes) ? 0 : 1);
    assert.deepEqual(fs.readFileSync(f.destination), bytes);
    assert.equal(fs.existsSync(`${f.destination}.partial.json`), false);
  });
}

test("all excess-length attempts are cleaned rather than retained for manual retry", async (t) => {
  const f = await fixture(t, () => response(stream(bytes, Buffer.from("9"))));
  assert.equal((await f.service.download()).phase, "error");
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(({ headers }) => headers.Range === undefined));
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.existsSync(`${f.destination}.partial.json`), false);
});

test("an unsolicited 206 must begin at zero before any bytes are accepted", async (t) => {
  const f = await fixture(t, (attempt) => attempt === 1 ? response(stream(bytes.subarray(4)), 206, "bytes 4-7/8") : response(stream(bytes)));
  assert.equal((await f.service.download()).phase, "ready");
  assert.equal(f.calls.length, 2);
  assert.deepEqual(fs.readFileSync(f.destination), bytes);
});

test("checksum mismatch removes both the completed file and resume metadata", async (t) => {
  const f = await fixture(t, () => response(stream(Buffer.from("87654321"))));
  const result = await f.service.download();
  assert.equal(result.phase, "error");
  assert.match(result.error, /verification failed/i);
  assert.equal(f.calls.length, 1);
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.existsSync(`${f.destination}.partial.json`), false);
});
