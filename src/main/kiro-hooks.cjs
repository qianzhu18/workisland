'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const CLASSIC = ['agentSpawn', 'userPromptSubmit', 'preToolUse', 'postToolUse', 'stop'];
const PROFILE = 'workisland-status';
const DESCRIPTION = 'WorkIsland local status hooks for the Kiro classic engine';
const hash = text => createHash('sha256').update(text).digest('hex');
async function read(file) { try { const raw = await fs.readFile(file, 'utf8'); return { raw, doc: JSON.parse(raw) }; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function write(file, doc) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const raw = JSON.stringify(doc, null, 2) + '\n', temp = `${file}.workisland-${process.pid}.tmp`;
  try { await fs.copyFile(file, file + '.workisland.backup'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { await fs.writeFile(temp, raw, { mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); }
  return hash(raw);
}
function ownCommand(s) { return typeof s === 'string' && /--source\s+["']?kiro(?:["']|\s|$)/.test(s) && /hooks-cli\/index\.cjs|flux-hooks/.test(s.replaceAll('\\', '/')); }
function ownHook(h) { return h?.name?.startsWith('workisland-status-') && ownCommand(h.action?.command); }
class KiroHookStore {
  constructor({ homeDir, hookCommand, kiroHome = path.join(homeDir, ".kiro") }) {
    this.homeDir = homeDir; this.command = hookCommand; this.kiroHome = kiroHome; this.pending = Promise.resolve();
    this.hookPath = path.join(kiroHome, 'hooks', 'workisland-status.json');
    this.legacyPath = path.join(kiroHome, 'agents', PROFILE + '.json');
    this.manifestPath = path.join(homeDir, '.flux', 'kiro-manifest.json');
  }
  document() { return { version: 'v1', hooks: EVENTS.map(trigger => ({ name: `workisland-status-${trigger}`, trigger, action: { type: 'command', command: this.command }, timeout: 5, enabled: true })) }; }
  profile() { return { name: PROFILE, description: DESCRIPTION, hooks: Object.fromEntries(CLASSIC.map(event => [event, [{ command: `${this.command} --event ${event} --kiro-classic-only`, timeout_ms: 5000 }]])) }; }
  enqueue(operation) { const result = this.pending.then(operation); this.pending = result.catch(() => {}); return result; }
  install() { return this.enqueue(() => this.installOwnedFiles()); }
  uninstall() { return this.enqueue(() => this.uninstallOwnedFiles()); }
  recordEvent(event) { return this.enqueue(() => this.recordObservedEvent(event)); }
  async installOwnedFiles() {
    // Preflight every owned destination before writing either file.
    const priorManifest = await read(this.manifestPath), manifest = priorManifest?.doc;
    const global = await read(this.hookPath), legacy = await read(this.legacyPath);
    if (global && (!manifest?.owned || !Array.isArray(global.doc?.hooks))) throw new Error('Kiro hook config file already exists and is not owned by WorkIsland');
    if (legacy && (!manifest?.owned || legacy.doc?.name !== PROFILE || !legacy.doc.hooks || Array.isArray(legacy.doc.hooks))) throw new Error('Kiro agent profile already exists and is not owned by WorkIsland');
    const doc = this.document(); if (global) doc.hooks.unshift(...global.doc.hooks.filter(h => !ownHook(h)));
    const profile = legacy ? { ...legacy.doc, hooks: { ...legacy.doc.hooks } } : this.profile();
    for (const event of CLASSIC) { const existing = profile.hooks[event] || []; if (!Array.isArray(existing)) throw new Error('Invalid Kiro classic hook config'); profile.hooks[event] = [...existing.filter(h => !ownCommand(h?.command)), ...this.profile().hooks[event]]; }
    try {
      const files = { hook: await write(this.hookPath, doc), legacy: await write(this.legacyPath, profile) };
      await write(this.manifestPath, { ...manifest, owned: true, files, installedAt: new Date().toISOString() });
    } catch (error) {
      for (const [file, before] of [[this.hookPath, global], [this.legacyPath, legacy], [this.manifestPath, priorManifest]]) {
        try { if (before) { const temp = file + '.rollback.tmp'; await fs.writeFile(temp, before.raw, {mode: 0o600}); await fs.rename(temp, file); } else await fs.rm(file, {force:true}); } catch {}
      }
      throw error;
    }
  }
  async uninstallOwnedFiles() {
    const manifest = (await read(this.manifestPath))?.doc; if (!manifest?.owned) return;
    const global = await read(this.hookPath), legacy = await read(this.legacyPath);
    if (global && Array.isArray(global.doc?.hooks)) { const remaining = global.doc.hooks.filter(h => !ownHook(h)); if (!remaining.length && global.doc.version === 'v1' && Object.keys(global.doc).every(k => ['version','hooks'].includes(k))) await fs.unlink(this.hookPath); else if (remaining.length !== global.doc.hooks.length) await write(this.hookPath, { ...global.doc, hooks: remaining }); }
    if (legacy && legacy.doc?.name === PROFILE && legacy.doc.hooks && !Array.isArray(legacy.doc.hooks)) {
      const hooks = {}; for (const [event, entries] of Object.entries(legacy.doc.hooks)) { if (!Array.isArray(entries)) { hooks[event] = entries; continue; } const remaining = entries.filter(h => !ownCommand(h?.command)); if (remaining.length) hooks[event] = remaining; }
      if (!Object.keys(hooks).length && legacy.doc.description === DESCRIPTION && Object.keys(legacy.doc).every(k => ['name','description','hooks'].includes(k))) await fs.unlink(this.legacyPath); else await write(this.legacyPath, { ...legacy.doc, hooks });
    }
    await fs.rm(this.manifestPath, { force: true });
  }
  async checkHealth() {
    const issues = [], manifest = (await read(this.manifestPath))?.doc, global = await read(this.hookPath);
    if (!manifest?.owned) issues.push('Kiro manifest missing');
    for (const event of EVENTS) {
      const hook = global?.doc?.hooks?.find?.(h => h.name === `workisland-status-${event}`);
      if (!hook || !hook.enabled) issues.push(`Hook not registered: ${event}`);
      else if (hook.trigger !== event || hook.action?.command !== this.command || hook.action?.type !== 'command' || hook.timeout !== 5) issues.push(`Stale hook command: ${event}`);
    }
    return { agentId: 'kiro', installed: issues.length === 0, issues, manifestPath: this.manifestPath, lastVerifiedAt: manifest?.lastVerifiedAt, lastEventAt: manifest?.lastVerifiedAt, lastEventType: manifest?.lastEventType, notes: ['IDE 1.x / CLI V3: global hooks. Classic CLI: --agent workisland-status. Native approvals remain in Kiro.'] };
  }
  async recordObservedEvent(event) {
    if (!event?.sessionId || !['sessionStarted','activityUpdated','toolUseStarted','sessionCompleted'].includes(event.type)) return;
    const manifest = (await read(this.manifestPath))?.doc;
    if (!manifest?.owned || manifest.lastVerifiedAt) return;
    await write(this.manifestPath, { ...manifest, lastVerifiedAt: new Date().toISOString(), lastEventType: event.type });
  }
}
module.exports = { KiroHookStore, KIRO_EVENTS: EVENTS };
