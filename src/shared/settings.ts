import { isRecord } from './protocol.js';

export const THEMES = ['auto', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export interface Settings {
  enabled: boolean;
  disabledHosts: string[];
  inlineCode: boolean;
  minLength: number;
  maxLength: number;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  enabled: true, disabledHosts: [], inlineCode: false,
  minLength: 24, maxLength: 100_000, theme: 'auto',
});

export const SETTINGS_KEY = 'settings';

/** 200k chars is ~100k tokens, whose 32-float-per-token GPU buffer stays well inside maxBufferSize. */
export const LENGTH_CAP = 200_000;

function clampLength(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(LENGTH_CAP, Math.max(0, Math.trunc(v)));
}

export function isTheme(v: unknown): v is Theme {
  return THEMES.some((theme) => theme === v);
}

export function normalizeSettings(raw: unknown): Settings {
  const src = isRecord(raw) ? raw : {};

  const a = clampLength(src['minLength'], DEFAULT_SETTINGS.minLength);
  const b = clampLength(src['maxLength'], DEFAULT_SETTINGS.maxLength);

  const hosts = src['disabledHosts'];
  const disabledHosts = Array.isArray(hosts)
    ? hosts.filter((h): h is string => typeof h === 'string')
    : [...DEFAULT_SETTINGS.disabledHosts];

  return {
    enabled: typeof src['enabled'] === 'boolean' ? src['enabled'] : DEFAULT_SETTINGS.enabled,
    disabledHosts,
    inlineCode: typeof src['inlineCode'] === 'boolean' ? src['inlineCode'] : DEFAULT_SETTINGS.inlineCode,
    minLength: Math.min(a, b),
    maxLength: Math.max(a, b),
    theme: isTheme(src['theme']) ? src['theme'] : DEFAULT_SETTINGS.theme,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    return normalizeSettings(stored[SETTINGS_KEY]);
  } catch {
    return normalizeSettings(undefined);
  }
}

export interface SaveResult { settings: Settings; persisted: boolean }

export async function saveSettings(patch: Partial<Settings>): Promise<SaveResult> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
    return { settings: next, persisted: true };
  } catch {
    return { settings: next, persisted: false };
  }
}

export function hostEntryMatches(entry: string, hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (!e.startsWith('.')) return host === e;
  return host === e.slice(1) || host.endsWith(e);
}

export function isHostDisabled(s: Settings, hostname: string): boolean {
  return s.disabledHosts.some((entry) => hostEntryMatches(entry, hostname));
}
