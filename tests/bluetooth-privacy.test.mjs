import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import afterPack from '../scripts/after-pack.cjs';
import { test } from 'node:test';

test('signed macOS app declares the purpose of Bluetooth device access', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.match(pkg.build.mac.extendInfo.NSBluetoothAlwaysUsageDescription ?? '', /connected.*audio/i);
});

test('packaging preserves Bluetooth purpose while removing unused capture permissions', { skip: process.platform !== 'darwin' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'workisland-privacy-'));
  try {
    const contents = join(root, 'WorkIsland.app', 'Contents');
    mkdirSync(contents, { recursive: true });
    const plist = join(contents, 'Info.plist');
    execFileSync('/usr/bin/plutil', ['-create', 'xml1', plist]);
    for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSAppleEventsUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string Purpose`, plist]);
    }
    await afterPack({ electronPlatformName: 'darwin', appOutDir: root, packager: { appInfo: { productFilename: 'WorkIsland' } } });
    assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSBluetoothAlwaysUsageDescription', plist], { encoding: 'utf8' }).trim(), 'Purpose');
    assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSAppleEventsUsageDescription', plist], { encoding: 'utf8' }).trim(), 'Purpose');
    const xml = readFileSync(plist, 'utf8');
    assert.ok(!xml.includes('NSCameraUsageDescription') && !xml.includes('NSMicrophoneUsageDescription'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
