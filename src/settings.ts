import { diagnostic, createDiagnosticReporter } from './diagnostics';
import { settingsFrom, type Settings, type ApiKeys, type CloudProvider, type ExecutionSettings } from './types';

const providers: CloudProvider[] = ['gemini', 'openai', 'groq'];
const VERSION = 1;
export interface PanelSettings { settings: Settings; configured: Record<CloudProvider, boolean> }
export interface SettingsUpdate { settings: Settings; credentials?: Partial<Record<CloudProvider, string | null>> }
/** A null tombstone records deliberate deletion, including across interrupted migrations. */
type StoredKeys = Partial<Record<CloudProvider, string | null>>;
const report = createDiagnosticReporter(value => console.warn(value));
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action, action);
    queue = result.catch(() => {});
    return result;
}
function keysFrom(value: unknown): StoredKeys {
    const keys: StoredKeys = {};
    if (!value || typeof value !== 'object') return keys;
    for (const p of providers) {
        const key = (value as Record<string, unknown>)[p];
        if (key === null) keys[p] = null;
        else if (typeof key === 'string' && key.trim() && key.length <= 2048) keys[p] = key.trim();
    }
    return keys;
}
async function load(): Promise<{ settings: Settings; keys: StoredKeys; failed?: boolean }> {
    const sync = await chrome.storage.sync.get('settings');
    const settings = settingsFrom(sync.settings);
    let keys: StoredKeys;
    try {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        const local = await chrome.storage.local.get(['apiKeys', 'credentialsMigrationVersion']);
        keys = keysFrom(local.apiKeys);
        if (local.credentialsMigrationVersion !== VERSION) {
            const legacy = keysFrom(sync.settings && typeof sync.settings === 'object' ? (sync.settings as { keys?: unknown }).keys : undefined);
            for (const p of providers) if (keys[p] === undefined && legacy[p]) keys[p] = legacy[p];
            // Both credentials and marker commit before any destructive sync cleanup.
            await chrome.storage.local.set({ apiKeys: keys, credentialsMigrationVersion: VERSION });
        }
    } catch {
        report(diagnostic('SETTINGS_MIGRATION_FAILED'));
        return { settings, keys: {}, failed: true };
    }
    // Retrying this on every load also scrubs keys reintroduced by older installations.
    if (JSON.stringify(sync.settings) !== JSON.stringify(settings)) {
        try { await chrome.storage.sync.set({ settings }); }
        catch { report(diagnostic('SETTINGS_MIGRATION_FAILED')); }
    }
    return { settings, keys };
}
export function loadPanelSettings(): Promise<PanelSettings> {
    return serialized(async () => { const { settings, keys } = await load(); return { settings, configured: { gemini: !!keys.gemini, openai: !!keys.openai, groq: !!keys.groq } }; });
}
export function loadExecutionSettings(): Promise<ExecutionSettings> {
    return serialized(async () => {
        const { settings, keys } = await load();
        const provider = settings.provider === 'auto' ? settings.cloudProvider : settings.provider;
        const selected: ApiKeys = {};
        if (providers.includes(provider as CloudProvider) && keys[provider as CloudProvider]) selected[provider as CloudProvider] = keys[provider as CloudProvider]!;
        return { ...settings, keys: selected };
    });
}
export function savePanelSettings(update: SettingsUpdate): Promise<PanelSettings> {
    return serialized(async () => {
        const current = await load();
        if (current.failed) throw new Error('Could not save settings. Try again.');
        const keys = { ...current.keys };
        for (const p of providers) {
            const value = update.credentials?.[p];
            if (value === null) keys[p] = null;
            else if (typeof value === 'string' && value.trim() && value.length <= 2048) keys[p] = value.trim();
        }
        const settings = settingsFrom(update.settings);
        await chrome.storage.local.set({ apiKeys: keys, credentialsMigrationVersion: VERSION });
        await chrome.storage.sync.set({ settings });
        return { settings, configured: { gemini: !!keys.gemini, openai: !!keys.openai, groq: !!keys.groq } };
    });
}
