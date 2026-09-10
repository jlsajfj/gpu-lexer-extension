import {
  DEFAULT_SETTINGS,
  isHostDisabled,
  loadSettings,
  saveSettings,
  type Settings,
} from '../shared/settings.js';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup: missing #${id}`);
  return node as T;
};

const panel = el<HTMLElement>('panel');
const enabledInput = el<HTMLInputElement>('enabled');
const inlineInput = el<HTMLInputElement>('inline-code');
const siteRow = el<HTMLElement>('site-row');
const siteHost = el<HTMLElement>('site-host');
const siteNote = el<HTMLElement>('site-note');
const siteToggle = el<HTMLInputElement>('site-toggle');
const minInput = el<HTMLInputElement>('min-length');
const maxInput = el<HTMLInputElement>('max-length');
const lengthError = el<HTMLElement>('length-error');
const errorLine = el<HTMLElement>('error');
const themeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="theme"]')];

let settings: Settings = { ...DEFAULT_SETTINGS, disabledHosts: [] };
let hostname: string | null = null;

const themeOf = (value: string): Settings['theme'] | null =>
  value === 'auto' || value === 'light' || value === 'dark' ? value : null;

function setMessage(node: HTMLElement, text: string | null): void {
  node.textContent = text ?? '';
}

function render(): void {
  enabledInput.checked = settings.enabled;
  inlineInput.checked = settings.inlineCode;
  minInput.value = String(settings.minLength);
  maxInput.value = String(settings.maxLength);
  for (const input of themeInputs) input.checked = input.value === settings.theme;
  siteToggle.checked = hostname !== null && isHostDisabled(settings, hostname);
  document.documentElement.setAttribute('data-theme', settings.theme);
  panel.classList.toggle('off', !settings.enabled);
  for (const control of [siteToggle, inlineInput, minInput, maxInput]) {
    control.disabled = !settings.enabled;
  }
}

function renderSite(): void {
  if (hostname === null) {
    siteRow.hidden = true;
    siteNote.hidden = false;
    return;
  }
  siteRow.hidden = false;
  siteNote.hidden = true;
  siteHost.textContent = hostname;
  siteHost.title = hostname;
}

// the storage layer reports write failures by not throwing, so confirm by re-reading
async function stored(next: Settings): Promise<boolean> {
  return JSON.stringify(await loadSettings()) === JSON.stringify(next);
}

async function update(patch: Partial<Settings>): Promise<void> {
  try {
    const next = await saveSettings(patch);
    if (await stored(next)) {
      settings = next;
      setMessage(errorLine, null);
      render();
      return;
    }
  } catch {
    // handled by the shared failure path below
  }
  setMessage(errorLine, 'Settings could not be saved, so that change was not stored.');
  render();
}

type Site = { host: string } | { reason: string };

async function probeSite(): Promise<Site> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      return { reason: 'Site control needs the activeTab permission to read this tab.' };
    }
    const url = new URL(tab.url);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return { reason: 'Site control is unavailable on this page.' };
    }
    return { host: url.hostname };
  } catch {
    return { reason: 'Site control is unavailable on this page.' };
  }
}

type Lengths = { ok: true; min: number; max: number } | { ok: false; message: string };

function readNumber(input: HTMLInputElement, label: string): number | string {
  const raw = input.value.trim();
  if (raw === '') return `${label} is required.`;
  const value = Number(raw);
  if (!Number.isFinite(value)) return `${label} must be a number.`;
  if (value < 0) return `${label} cannot be negative.`;
  return Math.trunc(value);
}

function readLengths(): Lengths {
  const min = readNumber(minInput, 'Minimum length');
  if (typeof min === 'string') return { ok: false, message: min };
  const max = readNumber(maxInput, 'Maximum length');
  if (typeof max === 'string') return { ok: false, message: max };
  if (min > max) return { ok: false, message: 'Minimum length must not exceed maximum length.' };
  return { ok: true, min, max };
}

enabledInput.addEventListener('change', () => {
  void update({ enabled: enabledInput.checked });
});

inlineInput.addEventListener('change', () => {
  void update({ inlineCode: inlineInput.checked });
});

siteToggle.addEventListener('change', () => {
  if (hostname === null) return;
  // unchecking drops every entry that already matches this host, not just an identical string
  const disabledHosts = siteToggle.checked
    ? [...new Set([...settings.disabledHosts, hostname])]
    : settings.disabledHosts.filter(
        (entry) => !isHostDisabled({ ...settings, disabledHosts: [entry] }, hostname as string),
      );
  void update({ disabledHosts });
});

for (const input of themeInputs) {
  input.addEventListener('change', () => {
    const theme = themeOf(input.value);
    if (input.checked && theme !== null) void update({ theme });
  });
}

for (const input of [minInput, maxInput]) {
  input.addEventListener('input', () => {
    const lengths = readLengths();
    setMessage(lengthError, lengths.ok ? null : lengths.message);
  });
  input.addEventListener('change', () => {
    const lengths = readLengths();
    if (!lengths.ok) {
      setMessage(lengthError, lengths.message);
      return;
    }
    setMessage(lengthError, null);
    void update({ minLength: lengths.min, maxLength: lengths.max });
  });
}

async function init(): Promise<void> {
  const site = await probeSite();
  if ('host' in site) hostname = site.host;
  else setMessage(siteNote, site.reason);

  try {
    settings = await loadSettings();
  } catch {
    setMessage(errorLine, 'Settings could not be read. Showing defaults.');
  }

  render();
  renderSite();
  document.body.classList.add('ready');
}

void init().catch(() => {
  setMessage(errorLine, 'The popup failed to start.');
  document.body.classList.add('ready');
});
