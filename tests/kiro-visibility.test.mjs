import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isVisibleInIsland } = require('../src/main/session-policy.cjs');
test('Kiro activity after connecting an existing session is visible without a captured prompt', () => {
  const session = { tool: 'kiro', isHookManaged: true, phase: 'running', currentActivity: 'Running tool', isSessionEnded: false };
  assert.equal(isVisibleInIsland(session), true);
  assert.equal(isVisibleInIsland({ ...session, currentActivity: undefined }), false);
  assert.equal(isVisibleInIsland({ ...session, isSessionEnded: true }), false);
  assert.equal(isVisibleInIsland({ ...session, parentSessionId: 'parent' }), false);
});
