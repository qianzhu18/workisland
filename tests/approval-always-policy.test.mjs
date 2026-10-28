import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { canAllowAlways } from '../src/renderer/shared/approval-policy.mjs';
const require = createRequire(import.meta.url);
const { buildPermissionDirective } = require('../src/main/permission-directives.cjs');
test('OpenCode and Sara support always approvals through their native reply', () => {
  for (const tool of ['opencode', 'sara']) {
    assert.equal(canAllowAlways(tool, {}), true);
    assert.deepEqual(buildPermissionDirective({ tool }, { action: 'allowAlways' }), { type: 'allow', permanent: true });
    assert.equal(canAllowAlways(tool, { approvalMode: 'terminalNative' }), false);
  }
});
test('other agents need an explicit rule suggestion or plan mode', () => {
  assert.equal(canAllowAlways('cursor', {}), false);
  assert.equal(canAllowAlways('cursor', { permissionSuggestions: [{ type: 'addRules' }] }), false);
  assert.equal(canAllowAlways('claude', { permissionSuggestions: [{ type: 'addRules' }] }), true);
  assert.equal(canAllowAlways('claude', { toolName: 'ExitPlanMode' }), true);
  assert.equal(canAllowAlways('claude', { permissionSuggestions: [] }), false);
});
