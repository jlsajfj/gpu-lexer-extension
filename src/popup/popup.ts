import {
  DEFAULT_SETTINGS,
  hostEntryMatches,
  isHostDisabled,
  isTheme,
  LENGTH_CAP,
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

minInput.max = String(LENGTH_CAP);
maxInput.max = String(LENGTH_CAP);

let settings: Settings = DEFAULT_SETTINGS;
let hostname: string | null = null;
let writes: Promise<void> = Promise.resolve();

const SAVE_ERROR = 'Settings could not be saved, so that change was not stored.';

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
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-gpu-lexer-theme');
  else root.setAttribute('data-gpu-lexer-theme', settings.theme);
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

// Serialized: every write re-reads storage, so overlapping updates would drop each other
function update(patch: Partial<Settings>): void {
  writes = writes
    .then(async () => {
      const { settings: next, persisted } = await saveSettings(patch);
      settings = next;
      setMessage(errorLine, persisted ? null : SAVE_ERROR);
      render();
    })
    .catch(() => {
      setMessage(errorLine, SAVE_ERROR);
      render();
    });
}

type Site = { host: string } | { reason: string };

async function probeSite(): Promise<Site> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      return { reason: 'Site control needs the activeTab permission to read this tab.' };
    }
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { reason: 'Site control works on http and https pages only.' };
    }
    if (!url.hostname) {
      return { reason: 'Site control could not read this page address.' };
    }
    return { host: url.hostname };
  } catch {
    return { reason: 'Site control could not read this tab.' };
  }
}

type Lengths = { ok: true; min: number; max: number } | { ok: false; message: string };
type ReadNumber = { ok: true; value: number } | { ok: false; message: string };

function readNumber(input: HTMLInputElement, label: string): ReadNumber {
  const raw = input.value.trim();
  if (raw === '') return { ok: false, message: `${label} is required.` };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, message: `${label} must be a number.` };
  if (value < 0) return { ok: false, message: `${label} cannot be negative.` };
  if (value > LENGTH_CAP) {
    return { ok: false, message: `${label} cannot exceed ${LENGTH_CAP.toLocaleString()}.` };
  }
  return { ok: true, value: Math.trunc(value) };
}

function readLengths(): Lengths {
  const min = readNumber(minInput, 'Minimum length');
  if (!min.ok) return { ok: false, message: min.message };
  const max = readNumber(maxInput, 'Maximum length');
  if (!max.ok) return { ok: false, message: max.message };
  if (min.value > max.value) {
    return { ok: false, message: 'Minimum length must not exceed maximum length.' };
  }
  return { ok: true, min: min.value, max: max.value };
}

enabledInput.addEventListener('change', () => {
  update({ enabled: enabledInput.checked });
});

inlineInput.addEventListener('change', () => {
  update({ inlineCode: inlineInput.checked });
});

siteToggle.addEventListener('change', () => {
  const host = hostname;
  if (host === null) return;
  // unchecking drops every entry that already matches this host, not just an identical string
  const disabledHosts = siteToggle.checked
    ? [...new Set([...settings.disabledHosts, host])]
    : settings.disabledHosts.filter((entry) => !hostEntryMatches(entry, host));
  update({ disabledHosts });
});

for (const input of themeInputs) {
  input.addEventListener('change', () => {
    if (input.checked && isTheme(input.value)) update({ theme: input.value });
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
    update({ minLength: lengths.min, maxLength: lengths.max });
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
