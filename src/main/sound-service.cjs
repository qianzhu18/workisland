"use strict";

const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SOUND_FILES = Object.freeze({
  appLaunch: "app_launch.wav",
  sessionStart: "session_start.wav",
  taskComplete: "task_complete.wav",
  taskError: "task_error.wav",
  approvalNeeded: "approval_needed.wav"
});

function clampVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric / 100));
}

/**
 * Create the sound service with injectable platform dependencies.
 * Dependency injection keeps playback deterministic in unit tests while the
 * default export continues to use Electron, the local filesystem, and afplay.
 */
function createSoundService({
  electronApi = electron,
  fsApi = fs,
  pathApi = path,
  execFile = childProcess.execFile,
  platform = process.platform,
  logger = console
} = {}) {
  let soundDirsInitialized = false;

  function getDefaultSoundsDir() {
    if (electronApi.app?.isPackaged) {
      return pathApi.resolve(electronApi.processResourcesPath ?? process.resourcesPath, "sounds");
    }
    return pathApi.resolve(electronApi.app.getAppPath(), "resources", "sounds");
  }

  function getUserSoundsDir() {
    return pathApi.join(electronApi.app.getPath("userData"), "sounds");
  }

  function resolveSoundFile(fileName) {
    const safeName = pathApi.basename(String(fileName));
    const userPath = pathApi.join(getUserSoundsDir(), safeName);
    if (fsApi.existsSync(userPath)) return userPath;
    return pathApi.join(getDefaultSoundsDir(), safeName);
  }

  function initSoundDirs() {
    if (soundDirsInitialized) return;
    const userDir = getUserSoundsDir();
    const defaultDir = getDefaultSoundsDir();
    try {
      fsApi.mkdirSync(userDir, { recursive: true });
      for (const file of Object.values(SOUND_FILES)) {
        const dest = pathApi.join(userDir, file);
        const src = pathApi.join(defaultDir, file);
        if (!fsApi.existsSync(dest) && fsApi.existsSync(src)) {
          fsApi.copyFileSync(src, dest);
        }
      }
      soundDirsInitialized = true;
    } catch (error) {
      logger.error?.("[SoundService] failed to initialize sound assets:", error);
    }
  }

  function playFile(filePath, volume, label) {
    if (!fsApi.existsSync(filePath)) {
      logger.warn?.(`[SoundService] sound asset is missing for ${label}: ${filePath}`);
      return false;
    }
    const command = platform === "win32" ? "powershell.exe" : "afplay";
    const args = platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "(New-Object System.Media.SoundPlayer ([Environment]::GetEnvironmentVariable('WORKISLAND_SOUND_FILE'))).PlaySync()"]
      : ["-v", String(volume), filePath];
    const options = platform === "win32"
      ? { windowsHide: true, env: { ...process.env, WORKISLAND_SOUND_FILE: filePath } }
      : { windowsHide: true };
    execFile(command, args, options, (error) => {
      if (error) logger.error?.(`[SoundService] failed to play ${label}:`, error.message);
    });
    return true;
  }

  function playSoundEvent(eventId, settings = {}) {
    const sound = settings.sound ?? {};
    if (sound.enabled === false) return false;
    if (sound.events?.[eventId]?.enabled === false) return false;
    const fileName = SOUND_FILES[eventId];
    if (!fileName) {
      logger.warn?.(`[SoundService] unknown sound event: ${eventId}`);
      return false;
    }
    return playFile(resolveSoundFile(fileName), clampVolume(sound.volume), eventId);
  }

  function previewSound(filename, volume) {
    const safeName = pathApi.basename(String(filename));
    if (!Object.values(SOUND_FILES).includes(safeName)) {
      logger.warn?.(`[SoundService] refusing to preview unknown sound asset: ${safeName}`);
      return false;
    }
    return playFile(resolveSoundFile(safeName), clampVolume(volume), `preview:${safeName}`);
  }

  return {
    initSoundDirs,
    getUserSoundsDir,
    playSoundEvent,
    previewSound,
    resolveSoundFile
  };
}

const defaultService = createSoundService();

module.exports = {
  SOUND_FILES,
  clampVolume,
  createSoundService,
  ...defaultService
};
