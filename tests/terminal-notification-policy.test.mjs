import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeferAgentSurface, terminalPendingSessions } from '../src/renderer/island/components/terminal-notification-policy.mjs';

test('automatic Agent surfaces never interrupt a visible terminal page', () => {
  for (const type of ['sessionList', 'completion']) {
    for (const autoDismiss of [true, false]) {
      assert.equal(shouldDeferAgentSurface({ reason: 'notification', surface: { type, actionableSessionId: 'agent-a' }, autoDismiss }, true), true);
    }
  }
});

test('manual navigation, other notices, and notifications outside terminals keep their behavior', () => {
  const payload = { reason: 'notification', surface: { type: 'sessionList' } };
  assert.equal(shouldDeferAgentSurface(payload, false), false);
  for (const reason of ['click', 'hover', undefined]) assert.equal(shouldDeferAgentSurface({ ...payload, reason }, true), false);
  for (const type of ['settingsChange', 'systemStatus', undefined]) assert.equal(shouldDeferAgentSurface({ ...payload, surface: { type } }, true), false);
  assert.equal(shouldDeferAgentSurface(null, true), false);
});

test('pending items retain approvals, questions and actionable errors without ordinary completion noise', () => {
  const sessions = [
    { id: 'approval', phase: 'waitingForApproval', updatedAt: 1 },
    { id: 'question', phase: 'waitingForAnswer', updatedAt: 3 },
    { id: 'error', phase: 'completed', error: 'failed', isProcessAlive: true, updatedAt: 2 },
    { id: 'completed', phase: 'completed', isProcessAlive: true },
    { id: 'running', phase: 'running', isProcessAlive: true },
    { id: 'dismissed', phase: 'completed', error: true, completionDismissed: true, isProcessAlive: true },
    { id: 'child', phase: 'waitingForApproval', parentSessionId: 'approval' },
    { id: 'ended', phase: 'completed', error: true, isHookManaged: true, isSessionEnded: true }
  ];
  const before = structuredClone(sessions);
  assert.deepEqual(terminalPendingSessions(sessions).map(s => s.id), ['question', 'error', 'approval']);
  assert.deepEqual(sessions, before, 'session updates must not be mutated');
});

test('newer resolution replaces old pending state, and deleted sessions leave no stale queue', () => {
  assert.deepEqual(terminalPendingSessions([
    { id: 'a', phase: 'waitingForApproval', updatedAt: 1 },
    { id: 'a', phase: 'running', isProcessAlive: true, updatedAt: 2 },
    { id: 'b', phase: 'waitingForAnswer', updatedAt: 3 },
    { id: 'b', phase: 'waitingForAnswer', updatedAt: 3 }
  ]).map(s => s.id), ['b']);
  assert.deepEqual(terminalPendingSessions([]), []);
});
