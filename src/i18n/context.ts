import { createContext, useContext } from "react";
import type { MessageKey, Messages } from "./en";
import { CATALOGS, INTL_TAG, getLocale, translate, type Locale, type Vars } from "./core";

export type I18n = {
  locale: Locale;
  /** Translate a key; `{name}` placeholders from `vars`, plurals from `vars.count`. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** The raw catalog, for lists (suggested prompts, steps). */
  m: Messages;
  /** Switch language now; saves it locally and, when signed in, on the server. */
  setLocale: (l: Locale) => void;
  formatDate: (d: Date | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
};

export function makeI18n(locale: Locale, setLocale: (l: Locale) => void): I18n {
  const tag = INTL_TAG[locale];
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    m: CATALOGS[locale],
    setLocale,
    formatDate: (d, opts) => new Intl.DateTimeFormat(tag, opts ?? { dateStyle: "medium" }).format(d),
    formatNumber: (n, opts) => new Intl.NumberFormat(tag, opts).format(n),
  };
}

// Default outside a provider: current locale, no switching. Keeps components
// renderable in isolation (tests, previews).
export const I18nContext = createContext<I18n>(makeI18n(getLocale(), () => {}));

export function useT(): I18n {
  return useContext(I18nContext);
}
