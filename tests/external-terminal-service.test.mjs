import assert from 'node:assert/strict';
import test from 'node:test';
import { ExternalTerminalService } from '../src/main/external-terminal-service.cjs';

const terminal = { host: 'terminal', appPid: 50, windowId: 6, tty: '/dev/ttys002', title: 'Task', busy: true };
const iterm = { host: 'iterm2', appPid: 60, windowId: 7, tty: '/dev/ttys003', sessionId: 'unique-123', title: 'Claude', busy: null };
function setup() {
  const calls = [];
  let rows = [terminal, iterm], errors = [], action = { ok: true };
  const service = new ExternalTerminalService({ platform: 'darwin', runner: async (file, args) => {
    const payload = JSON.parse(args.at(-1)); calls.push({ file, args, payload });
    return { stdout: JSON.stringify(payload.action === 'list' ? { sessions: rows, errors } : action) };
  } });
  return { service, calls, rows: value => { rows = value; }, errors: value => { errors = value; }, action: value => { action = value; } };
}

test('external discovery is explicit, metadata only, and preserves stable opaque IDs', async () => {
  const { service, calls } = setup();
  assert.equal(calls.length, 0);
  assert.equal(service.snapshot().scanned, false);
  const first = await service.refresh();
  assert.equal(first.sessions.length, 2);
  assert.equal(first.sessions[0].source, 'external');
  assert.equal(first.sessions[0].capabilities.close, false, 'Terminal tab closing cannot be replaced with closing its window');
  assert.equal(first.sessions[1].capabilities.close, true);
  assert.deepEqual((await service.refresh()).sessions.map(s => s.id), first.sessions.map(s => s.id));
});

test('stale external entries never fall back to a different tab', async () => {
  const fixture = setup();
  const state = await fixture.service.refresh();
  fixture.rows([{ ...iterm, sessionId: 'replacement' }]);
  assert.equal((await fixture.service.focus(state.sessions[1].id)).reason, 'not-found');
  assert.equal(fixture.calls.every(c => c.payload.action === 'list'), true);
  assert.equal((await fixture.service.close('renderer-supplied-tty')).reason, 'not-found');
});

test('external close targets a single iTerm session and waits for actual disappearance', async () => {
  const fixture = setup();
  const state = await fixture.service.refresh();
  assert.equal((await fixture.service.close(state.sessions[0].id)).reason, 'close-in-host');
  assert.equal((await fixture.service.close(state.sessions[1].id)).reason, 'confirmation-pending');
  const call = fixture.calls.find(c => c.payload.action === 'close');
  assert.equal(call.file, '/usr/bin/osascript');
  assert.equal(call.payload.target.sessionId, 'unique-123');
  assert.equal(call.payload.target.windowId, 7);
  assert.ok(!call.args[3].includes('unique-123'), 'target values are arguments, not executable script text');
});

test('permission refusal and unsupported platforms return clear state without throwing', async () => {
  const fixture = setup();
  fixture.rows([]); fixture.errors([{ host: 'terminal', reason: 'automation-denied' }]);
  const state = await fixture.service.refresh();
  assert.equal(state.errors[0].reason, 'automation-denied');
  assert.deepEqual(state.sessions, []);
  let called = false;
  const windows = new ExternalTerminalService({ platform: 'win32', runner: () => { called = true; } });
  assert.equal((await windows.refresh()).available, false);
  assert.equal(called, false);
});

test('external close cannot report success when the follow-up host scan fails', async () => {
  let closed = false;
  const service = new ExternalTerminalService({ platform: 'darwin', runner: async (_file, args) => {
    const request = JSON.parse(args.at(-1));
    if (request.action === 'close') { closed = true; return { stdout: JSON.stringify({ ok: true }) }; }
    return { stdout: JSON.stringify(closed
      ? { sessions: [], errors: [{ host: 'iterm2', reason: 'automation-denied' }] }
      : { sessions: [iterm], errors: [] }) };
  } });
  const state = await service.refresh();
  const result = await service.close(state.sessions[0].id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'automation-denied');
});
