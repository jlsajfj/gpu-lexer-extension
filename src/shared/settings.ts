export interface Settings {
  enabled: boolean;
  disabledHosts: string[];
  inlineCode: boolean;   // highlight single-line <code> outside <pre>
  minLength: number;
  maxLength: number;
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true, disabledHosts: [], inlineCode: false,
  minLength: 24, maxLength: 100_000, theme: 'auto',
};

export const SETTINGS_KEY = 'settings';

const THEMES = ['auto', 'light', 'dark'] as const;
const LENGTH_CAP = 10_000_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampLength(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(LENGTH_CAP, Math.max(0, Math.trunc(v)));
}

function isTheme(v: unknown): v is Settings['theme'] {
  return THEMES.some((t) => t === v);
}

/** Coerces arbitrary stored/supplied data into a complete, valid Settings. */
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
    return { ...DEFAULT_SETTINGS, disabledHosts: [...DEFAULT_SETTINGS.disabledHosts] };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  } catch {
    // storage unavailable: still return the validated result for this session
  }
  return next;
}

export function isHostDisabled(s: Settings, hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return s.disabledHosts.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (!e.startsWith('.')) return host === e;
    return host === e.slice(1) || host.endsWith(e);
  });
}
