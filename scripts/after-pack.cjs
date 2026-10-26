"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const plist = path.join(context.appOutDir, `${appName}.app`, "Contents", "Info.plist");
  for (const key of [
    "NSAudioCaptureUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription"
  ]) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plist]);
    } catch {
      // These unused capture/peripheral keys may be absent. The connected-audio
      // Bluetooth purpose is used by the native helper and must be preserved.
    }
  }
};
