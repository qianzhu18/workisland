"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CODEX_PET_PROTOCOL_VERSION = 2;
const ALLOWED_SPRITE_EXTENSIONS = new Set([".png", ".webp"]);

function getCodexHome(env = process.env, home = os.homedir()) {
  const configured = typeof env.CODEX_HOME === "string" && env.CODEX_HOME.trim()
    ? env.CODEX_HOME.trim()
    : path.join(home, ".codex");
  return path.resolve(configured);
}

function getCodexPetsDir(env = process.env, home = os.homedir()) {
  return path.join(getCodexHome(env, home), "pets");
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function readManifest(petDir) {
  const manifestPath = path.join(petDir, "pet.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Codex pet manifest unavailable: ${manifestPath} (${error.message})`);
  }
  if (!manifest || manifest.spriteVersionNumber !== CODEX_PET_PROTOCOL_VERSION) {
    throw new Error(`Codex pet is not V2: ${manifestPath}`);
  }
  if (typeof manifest.id !== "string" || !manifest.id || typeof manifest.spritesheetPath !== "string" || !manifest.spritesheetPath) {
    throw new Error(`Codex pet manifest is invalid: ${manifestPath}`);
  }
  return manifest;
}

function resolveSpriteFile(petDir, manifest) {
  const root = path.resolve(petDir);
  const spritePath = path.resolve(root, manifest.spritesheetPath);
  const extension = path.extname(spritePath).toLowerCase();
  if (!isWithin(root, spritePath) || !ALLOWED_SPRITE_EXTENSIONS.has(extension)) {
    throw new Error(`Codex pet spritesheet path is invalid: ${manifest.spritesheetPath}`);
  }
  if (!fs.existsSync(spritePath)) {
    throw new Error(`Codex pet spritesheet not found: ${spritePath}`);
  }
  return spritePath;
}

function normalizePet(petDir, manifest) {
  return {
    id: manifest.id,
    displayName: typeof manifest.displayName === "string" && manifest.displayName.trim()
      ? manifest.displayName.trim()
      : manifest.id,
    description: typeof manifest.description === "string" ? manifest.description : "",
    spriteVersionNumber: CODEX_PET_PROTOCOL_VERSION,
    spritePath: resolveSpriteFile(petDir, manifest),
    value: `codex:${manifest.id}`
  };
}

function resolveCodexPet(petId, env = process.env, home = os.homedir()) {
  if (typeof petId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(petId)) {
    throw new Error("Invalid Codex pet id");
  }
  const petDir = path.join(getCodexPetsDir(env, home), petId);
  if (!fs.existsSync(petDir) || !fs.statSync(petDir).isDirectory()) {
    throw new Error(`Codex pet not found: ${petId}`);
  }
  return normalizePet(petDir, readManifest(petDir));
}

function listCodexPets(env = process.env, home = os.homedir()) {
  const petsDir = getCodexPetsDir(env, home);
  if (!fs.existsSync(petsDir)) return [];
  const pets = [];
  for (const entry of fs.readdirSync(petsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pet = resolveCodexPet(entry.name, env, home);
      pets.push({
        id: pet.id,
        displayName: pet.displayName,
        description: pet.description,
        spriteVersionNumber: pet.spriteVersionNumber,
        value: pet.value
      });
    } catch {
      // Ignore incomplete or legacy pet folders in the picker.
    }
  }
  return pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

module.exports = {
  CODEX_PET_PROTOCOL_VERSION,
  getCodexHome,
  getCodexPetsDir,
  listCodexPets,
  resolveCodexPet
};
