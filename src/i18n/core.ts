/**
 * The desktop app's i18n core: no React, no Tauri, so it is unit-testable and
 * usable from plain modules (lib/api.ts reads the current locale from here to
 * stamp X-Socrates-Locale on every request).
 *
 * Language order (see wiki/concepts/desktop-app.md):
 *   signed in  → GET /api/profile/locale (the web's resolution: user → org → …)
 *   otherwise  → last choice saved here → navigator.language (es* → es) → en
 * Whatever wins is cached in localStorage so the next launch starts in the right
 * language without flashing English first.
 */
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

/** BCP 47 tags for Intl. Spanish is Colombia-first, matching the web. */
export const INTL_TAG: Record<Locale, string> = { en: "en-US", es: "es-CO" };

export const CATALOGS: Record<Locale, Messages> = { en, es };

const STORAGE_KEY = "socrates.locale";
/** Set when the person picked a language before signing in; pushed to the server after. */
const PENDING_KEY = "socrates.locale.pending";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** "es-CO" / "es" / "ES_419" → "es"; anything else → "en". */
export function fromNavigatorLanguage(lang: string | undefined | null): Locale {
  return lang && lang.toLowerCase().startsWith("es") ? "es" : "en";
}

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked: the choice just won't survive a relaunch */ }
}

export function savedLocale(): Locale | null {
  const v = storageGet(STORAGE_KEY);
  return isLocale(v) ? v : null;
}
export function saveLocale(l: Locale) { storageSet(STORAGE_KEY, l); }

export function pendingChoice(): boolean { return storageGet(PENDING_KEY) === "1"; }
export function setPendingChoice(on: boolean) { storageSet(PENDING_KEY, on ? "1" : null); }

export function detectInitialLocale(): Locale {
  return savedLocale() ?? fromNavigatorLanguage(typeof navigator !== "undefined" ? navigator.language : null);
}

// Module-level current locale, for code outside React (the fetch helper).
let current: Locale = detectInitialLocale();
export function getLocale(): Locale { return current; }
export function setCurrentLocale(l: Locale) { current = l; }

export type Vars = Record<string, string | number>;

function lookup(messages: Messages, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/**
 * Translate `key` in `locale`. Plural entries ({ one, other }) pick a form with
 * Intl.PluralRules from `vars.count`, and `#` becomes the formatted count.
 * A key missing at runtime (can't happen past tsc, but a bad dynamic key could)
 * falls back to English, then to the key itself.
 */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  let entry = lookup(CATALOGS[locale], key);
  if (entry === undefined) entry = lookup(en, key);
  if (typeof entry === "string") return interpolate(entry, vars);
  if (entry && typeof entry === "object" && "other" in entry) {
    const forms = entry as { one?: string; other: string };
    const count = Number(vars?.count ?? 0);
    const rule = new Intl.PluralRules(INTL_TAG[locale]).select(count);
    const form = (rule === "one" ? forms.one : undefined) ?? forms.other;
    const withCount = form.replace(/#/g, new Intl.NumberFormat(INTL_TAG[locale]).format(count));
    return interpolate(withCount, vars);
  }
  return key;
}
