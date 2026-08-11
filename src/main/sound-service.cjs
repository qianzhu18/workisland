"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const child_process = require("node:child_process");

const SOUND_FILES = {
  appLaunch: "app_launch.wav",
  sessionStart: "session_start.wav",
  taskComplete: "task_complete.wav",
  taskError: "task_error.wav",
  approvalNeeded: "approval_needed.wav"
};
function getDefaultSoundsDir() {
  if (electron.app.isPackaged) {
    return path.resolve(process.resourcesPath, "sounds");
  }
  return path.resolve(electron.app.getAppPath(), "resources", "sounds");
}
function getUserSoundsDir() {
  return path.join(electron.app.getPath("userData"), "sounds");
}
function resolveSoundFile(fileName) {
  const userPath = path.join(getUserSoundsDir(), fileName);
  if (fs.existsSync(userPath)) return userPath;
  return path.join(getDefaultSoundsDir(), fileName);
}
let soundDirsInitialized = false;
function initSoundDirs() {
  if (soundDirsInitialized) return;
  soundDirsInitialized = true;
  const userDir = getUserSoundsDir();
  const defaultDir = getDefaultSoundsDir();
  try {
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    const allFiles = Object.values(SOUND_FILES);
    for (const file of allFiles) {
      const dest = path.join(userDir, file);
      if (!fs.existsSync(dest)) {
        const src = path.join(defaultDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    }
  } catch (err) {
    console.error("[SoundService] failed to init user sounds dir:", err);
  }
}
function playSoundEvent(eventId, settings) {
  const sound = settings.sound;
  if (!sound.enabled) return;
  if (sound.events[eventId]?.enabled === false) return;
  const fileName = SOUND_FILES[eventId];
  if (!fileName) return;
  const filePath = resolveSoundFile(fileName);
  const volume = Math.round(sound.volume) / 100;
  child_process.execFile("afplay", [filePath, "-v", String(volume)], (err) => {
    if (err) {
      console.error(`[SoundService] failed to play ${eventId}:`, err.message);
    }
  });
}
function previewSound(filename, volume) {
  const filePath = resolveSoundFile(filename);
  const clampedVolume = Math.max(0, Math.min(1, volume / 100));
  child_process.execFile("afplay", [filePath, "-v", String(clampedVolume)], (err) => {
    if (err) {
      console.error(`[SoundService] failed to preview ${filename}:`, err.message);
    }
  });
}
module.exports = { initSoundDirs, getUserSoundsDir, playSoundEvent, previewSound };
