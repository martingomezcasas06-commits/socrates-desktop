import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { vlog } from "../lib/vlog";
import { I18nContext, makeI18n } from "./context";
import {
  getLocale, isLocale, pendingChoice, saveLocale, setCurrentLocale, setPendingChoice, type Locale,
} from "./core";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const API_URL = import.meta.env.VITE_API_URL as string;

/** Everything outside React that shows text: <html lang>, the tray menu, the cache. */
function applyEverywhere(l: Locale) {
  setCurrentLocale(l);
  saveLocale(l);
  document.documentElement.lang = l;
  if (IS_TAURI) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_tray_language", { locale: l }))
      .catch((e) => vlog("I18N: set_tray_language failed: " + String(e)));
  }
}

async function saveOnServer(l: Locale) {
  try {
    const res = await apiFetch(`${API_URL}/api/profile/locale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    });
    if (!res.ok) vlog(`I18N: saving locale ${l} failed: HTTP ${res.status}`);
  } catch (e) {
    vlog("I18N: saving locale failed: " + String(e));
  }
}

export default function LocaleProvider({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  // Starts from the cache (or the OS language), so there is no English flash.
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  useEffect(() => { applyEverywhere(locale); }, [locale]);

  // After sign-in, the web's resolution wins — unless the person picked a
  // language on the sign-in screen, in which case that choice is saved instead.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      if (pendingChoice()) {
        await saveOnServer(getLocale());
        setPendingChoice(false);
        return;
      }
      try {
        const res = await apiFetch(`${API_URL}/api/profile/locale`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { locale?: unknown };
        if (!cancelled && isLocale(data.locale)) setLocaleState(data.locale);
      } catch (e) {
        // Keep the cached / OS language; say why so it isn't a silent fallback.
        vlog("I18N: GET /api/profile/locale failed, keeping " + getLocale() + ": " + String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [signedIn]);

  const setLocale = useCallback((l: Locale) => {
    setCurrentLocale(l); // before any request the re-render might trigger
    setLocaleState(l);
    if (signedIn) void saveOnServer(l);
    else setPendingChoice(true);
  }, [signedIn]);

  const value = useMemo(() => makeI18n(locale, setLocale), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
