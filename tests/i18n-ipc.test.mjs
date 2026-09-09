import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("locale IPC exposes state, preference changes, and broadcasts", () => {
  const ipc = read("src/shared/ipc.cjs");
  assert.match(ipc, /LOCALE_GET_STATE:\s*"locale:get-state"/);
  assert.match(ipc, /LOCALE_SET_PREFERENCE:\s*"locale:set-preference"/);
  assert.match(ipc, /LOCALE_DID_CHANGE:\s*"locale:did-change"/);

  const services = read("src/main/ipc-services.cjs");
  assert.match(services, /IPC\.LOCALE_GET_STATE/);
  assert.match(services, /localization\.getSnapshot\(\)/);
  assert.match(services, /IPC\.LOCALE_SET_PREFERENCE/);
  assert.match(services, /localization\.setPreference\(preference\)/);
});

test("every product preload exposes the bounded locale API", () => {
  const preloads = [
    "src/preload/island.js",
    "src/preload/settings.js",
    "src/preload/welcome.js",
    "src/preload/pet.js",
    "src/preload/pet-panel.js",
    "src/preload/debug.js"
  ];

  for (const path of preloads) {
    const source = read(path);
    assert.match(source, /getLocaleState/, `${path} should expose getLocaleState`);
    assert.match(source, /setLanguagePreference/, `${path} should expose setLanguagePreference`);
    assert.match(source, /onLocaleChanged/, `${path} should expose onLocaleChanged`);
    assert.doesNotMatch(source, /exposeInMainWorld\([^]*ipcRenderer\s*[,}]/, `${path} must not expose ipcRenderer`);
  }
});

test("main initializes localization instead of writing a guessed legacy locale", () => {
  const source = read("src/main/index.cjs");
  assert.match(source, /createLocalizationService/);
  assert.match(source, /getPreferredSystemLanguages/);
  assert.match(source, /IPC\.LOCALE_DID_CHANGE/);
  assert.doesNotMatch(source, /updateSettings\(\{\s*locale:/);
});
