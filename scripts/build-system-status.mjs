#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function buildSystemStatus({ arch = process.arch, testOnly = false } = {}) {
if (process.platform !== 'darwin') { console.log('System status helper is macOS only; skipped.'); return; }
const source = join(root, 'native/system-status');
const temporary = mkdtempSync(join(tmpdir(), 'workisland-system-status-'));
function swift(args) {
  const result = spawnSync('xcrun', ['swiftc', ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`swiftc failed (${result.status})`);
}
try {
  const test = join(temporary, 'power-tests');
  swift([join(source, 'PowerMetrics.swift'), join(source, 'Tests/main.swift'), '-o', test]);
  const result = spawnSync(test, [], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Power telemetry regression tests failed');
  if (!testOnly) {
    const output = join(root, 'resources/bin/workisland-system-status');
    mkdirSync(dirname(output), { recursive: true });
    swift(['-O', '-swift-version', '5', '-target', `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
      ...['PowerMetrics.swift', 'CaptureObserver.swift', 'LockScreenHost.swift', 'main.swift'].map(file => join(source, file)),
      ...['AppKit', 'IOKit', 'CoreAudio', 'CoreWLAN', 'Network', 'IOBluetooth'].flatMap(name => ['-framework', name]), '-o', output]);
    console.log(`Built ${output}`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--arch');
  buildSystemStatus({ arch: index >= 0 ? process.argv[index + 1] : process.arch, testOnly: process.argv.includes('--test-only') });
}
