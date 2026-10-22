import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';

let local: Record<string, any>, sync: Record<string, any>, writes: string[];
let failLocal = false, failSync = false;
beforeEach(() => {
    vi.resetModules(); failLocal = false; failSync = false; local = {}; sync = {}; writes = [];
    vi.stubGlobal('chrome', { storage: {
        local: { setAccessLevel: vi.fn(async () => {}), get: async () => structuredClone(local), set: vi.fn(async (v: object) => { writes.push('local'); if (failLocal) throw new Error('secret raw failure'); Object.assign(local, structuredClone(v)); }) },
        sync: { get: async () => structuredClone(sync), set: vi.fn(async (v: object) => { writes.push('sync'); if (failSync) throw new Error('secret raw failure'); Object.assign(sync, structuredClone(v)); }) },
    } });
});
it('migrates local-first, preserves existing credentials and never exposes saved keys', async () => {
    sync.settings = { ...DEFAULT_SETTINGS, keys: { openai: 'legacy', gemini: 'imported' } };
    local.apiKeys = { openai: 'existing' };
    const repo = await import('../src/settings');
    const panel = await repo.loadPanelSettings();
    expect(local.apiKeys).toEqual({ openai: 'existing', gemini: 'imported' });
    expect(writes).toEqual(['local', 'sync']);
    expect(sync.settings).not.toHaveProperty('keys');
    expect(panel.configured).toEqual({ openai: true, gemini: true, groq: false });
    expect(JSON.stringify(panel)).not.toMatch(/existing|imported|legacy/);
});
it('never resurrects a deleted key when an older installation reintroduces sync secrets', async () => {
    const repo = await import('../src/settings');
    await repo.savePanelSettings({ settings: DEFAULT_SETTINGS, credentials: { gemini: 'first' } });
    await repo.savePanelSettings({ settings: DEFAULT_SETTINGS, credentials: { gemini: null } });
    sync.settings = { ...DEFAULT_SETTINGS, keys: { gemini: 'resurrected' } };
    expect((await repo.loadPanelSettings()).configured.gemini).toBe(false);
    expect(local.apiKeys.gemini).toBeNull();
    expect(sync.settings).not.toHaveProperty('keys');
});
it('retains legacy storage and disables cloud credentials on failed migration; retry succeeds', async () => {
    sync.settings = { ...DEFAULT_SETTINGS, keys: { gemini: 'sentinel' } }; failLocal = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = await import('../src/settings');
    expect((await repo.loadExecutionSettings()).keys).toEqual({});
    expect(sync.settings.keys.gemini).toBe('sentinel');
    expect(writes).toEqual(['local']);
    await expect(repo.savePanelSettings({ settings: DEFAULT_SETTINGS })).rejects.toThrow('Could not save');
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/secret|sentinel/);
    failLocal = false;
    expect((await repo.loadExecutionSettings()).keys).toEqual({ gemini: 'sentinel' });
    warning.mockRestore();
});
it('retries sync cleanup after successful local commit without reimporting overwritten values', async () => {
    sync.settings = { ...DEFAULT_SETTINGS, keys: { gemini: 'sentinel' } }; failSync = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = await import('../src/settings');
    await repo.loadPanelSettings();
    expect(local.credentialsMigrationVersion).toBe(1);
    local.apiKeys.gemini = 'new'; failSync = false;
    await repo.loadPanelSettings();
    expect(local.apiKeys.gemini).toBe('new'); expect(sync.settings).not.toHaveProperty('keys');
    warning.mockRestore();
});
it('serializes concurrent initialization and saves, preserving untouched provider credentials', async () => {
    sync.settings = { ...DEFAULT_SETTINGS, keys: { openai: 'old' } };
    const repo = await import('../src/settings');
    await Promise.all([repo.loadPanelSettings(), repo.loadPanelSettings(), repo.savePanelSettings({ settings: DEFAULT_SETTINGS, credentials: { gemini: 'new' } }), repo.savePanelSettings({ settings: DEFAULT_SETTINGS, credentials: { groq: 'third' } })]);
    expect(local.apiKeys).toEqual({ openai: 'old', gemini: 'new', groq: 'third' });
    expect(writes.filter(w => w === 'local')).toHaveLength(3);
    expect(await repo.loadExecutionSettings()).toEqual({ ...DEFAULT_SETTINGS, keys: { gemini: 'new' } });
});
