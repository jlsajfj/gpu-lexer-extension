import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  isHostDisabled,
  loadSettings,
  saveSettings,
  type Settings,
} from '../src/shared/settings.js';

interface FakeOptions { readonly throwOnGet?: boolean; readonly throwOnSet?: boolean }

function installChrome(initial: Record<string, unknown> = {}, options: FakeOptions = {}) {
  const store: Record<string, unknown> = { ...initial };

  const sync = {
    async get(key?: unknown): Promise<Record<string, unknown>> {
      if (options.throwOnGet === true) throw new Error('storage unavailable');
      if (key === undefined || key === null) return { ...store };
      if (typeof key === 'string') return key in store ? { [key]: store[key] } : {};
      if (Array.isArray(key)) {
        const out: Record<string, unknown> = {};
        for (const k of key) if (typeof k === 'string' && k in store) out[k] = store[k];
        return out;
      }
      if (typeof key === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, fallback] of Object.entries(key as Record<string, unknown>)) {
          out[k] = k in store ? store[k] : fallback;
        }
        return out;
      }
      return {};
    },
    async set(items: Record<string, unknown>): Promise<void> {
      if (options.throwOnSet === true) throw new Error('storage unavailable');
      Object.assign(store, items);
    },
  };

  (globalThis as unknown as Record<string, unknown>)['chrome'] = { storage: { sync } };
  return { store };
}

function stored(): Record<string, unknown> {
  return installChrome({}).store;
}

beforeEach(() => {
  installChrome();
});

describe('loadSettings', () => {
  it('returns DEFAULT_SETTINGS when storage is empty', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial stored object over the defaults', async () => {
    installChrome({ [SETTINGS_KEY]: { enabled: false, theme: 'dark' } });
    const s = await loadSettings();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, enabled: false, theme: 'dark' });
  });

  it('returns DEFAULT_SETTINGS when storage throws', async () => {
    installChrome({}, { throwOnGet: true });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('coerces entirely garbage stored data to something valid', async () => {
    installChrome({
      [SETTINGS_KEY]: {
        enabled: 'yes',
        inlineCode: 1,
        disabledHosts: 'nope',
        minLength: 'x',
        maxLength: null,
        theme: 'neon',
        unknownKey: 5,
      },
    });
    const s = await loadSettings();
    expect(typeof s.enabled).toBe('boolean');
    expect(typeof s.inlineCode).toBe('boolean');
    expect(Array.isArray(s.disabledHosts)).toBe(true);
    expect(Number.isFinite(s.minLength)).toBe(true);
    expect(Number.isFinite(s.maxLength)).toBe(true);
    expect(s.minLength).toBeGreaterThanOrEqual(0);
    expect(s.maxLength).toBeGreaterThanOrEqual(0);
    expect(['auto', 'light', 'dark']).toContain(s.theme);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('coerces a non-object stored value', async () => {
    installChrome({ [SETTINGS_KEY]: 'not an object' });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps minLength within maxLength when stored bounds are inverted', async () => {
    installChrome({ [SETTINGS_KEY]: { minLength: 5000, maxLength: 100 } });
    const s = await loadSettings();
    expect(s.minLength).toBeLessThanOrEqual(s.maxLength);
  });

  it('drops non-string entries from disabledHosts', async () => {
    installChrome({ [SETTINGS_KEY]: { disabledHosts: ['ok.com', 5, null, {}, 'also.com'] } });
    const s = await loadSettings();
    expect(s.disabledHosts).toEqual(['ok.com', 'also.com']);
  });
});

describe('saveSettings', () => {
  it('merges a patch over the stored value and persists the merged result', async () => {
    const { store } = installChrome({ [SETTINGS_KEY]: { enabled: false } });
    const result = await saveSettings({ theme: 'dark' });
    expect(result).toEqual({ ...DEFAULT_SETTINGS, enabled: false, theme: 'dark' });
    expect(store[SETTINGS_KEY]).toEqual(result);
  });

  it('returns and persists the defaults when nothing was stored', async () => {
    const { store } = installChrome();
    const result = await saveSettings({ minLength: 40 });
    expect(result).toEqual({ ...DEFAULT_SETTINGS, minLength: 40 });
    expect(store[SETTINGS_KEY]).toEqual(result);
  });

  it('persists a complete object rather than the bare patch', async () => {
    const { store } = installChrome();
    await saveSettings({ inlineCode: true });
    const persisted = store[SETTINGS_KEY] as Settings;
    expect(Object.keys(persisted).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(persisted.inlineCode).toBe(true);
  });

  it('coerces garbage in the patch instead of writing it through', async () => {
    const { store } = installChrome();
    const result = await saveSettings({ theme: 'neon' } as unknown as Partial<Settings>);
    expect(result.theme).toBe('auto');
    expect(store[SETTINGS_KEY]).toEqual(result);
  });

  it('still returns a valid merged result when the write fails', async () => {
    installChrome({}, { throwOnSet: true });
    await expect(saveSettings({ enabled: false })).resolves.toEqual({ ...DEFAULT_SETTINGS, enabled: false });
  });
});

describe('isHostDisabled', () => {
  const s = (disabledHosts: string[]): Settings => ({ ...DEFAULT_SETTINGS, disabledHosts });

  it('matches an exact hostname', () => {
    expect(isHostDisabled(s(['example.com']), 'example.com')).toBe(true);
  });

  it('matches a bare hostname only exactly, not its subdomains', () => {
    expect(isHostDisabled(s(['example.com']), 'docs.example.com')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isHostDisabled(s(['example.com']), 'EXAMPLE.COM')).toBe(true);
    expect(isHostDisabled(s(['Example.COM']), 'example.com')).toBe(true);
  });

  it('matches subdomains for a dot-prefixed entry', () => {
    expect(isHostDisabled(s(['.example.com']), 'docs.example.com')).toBe(true);
    expect(isHostDisabled(s(['.example.com']), 'a.b.example.com')).toBe(true);
  });

  it('does not match a host that merely ends with the letters of a dot-prefixed entry', () => {
    expect(isHostDisabled(s(['.example.com']), 'notexample.com')).toBe(false);
  });

  it('disables nothing when the list is empty', () => {
    expect(isHostDisabled(s([]), 'example.com')).toBe(false);
    expect(isHostDisabled(DEFAULT_SETTINGS, 'anything.test')).toBe(false);
  });
});
