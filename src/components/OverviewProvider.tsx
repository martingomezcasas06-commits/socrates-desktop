/** Loads the overview once and shares it (lib/overview.ts); refetches on a language switch. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useT } from "../i18n";
import { OverviewContext, type Overview } from "../lib/overview";

const API_URL = import.meta.env.VITE_API_URL as string;

export default function OverviewProvider({ children }: { children: ReactNode }) {
  const { locale } = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch(`${API_URL}/api/desktop/overview`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Overview;
        if (alive) { setData(body); setError(""); }
      } catch (e) {
        // Keep what we had: a failed refresh shouldn't blank the app.
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [locale, tick]);

  return <OverviewContext.Provider value={{ data, error, loading, reload }}>{children}</OverviewContext.Provider>;
}

