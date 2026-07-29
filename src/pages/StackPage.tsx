import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Icon from "../Icon";
import ToolLogo from "../components/ToolLogo";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const WEB_APP_URL = import.meta.env.VITE_API_URL as string;

/** Open a URL in the system browser. Inside Tauri, a plain target="_blank" does nothing —
 *  the webview swallows it — so route through the shell plugin instead. */
async function openExternal(url: string) {
  if (IS_TAURI) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch { /* fall through to browser */ }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

type Rec = {
  id: string;
  tool_name: string;
  tool_category: string;
  tool_url: string | null;
  use_case: string;
  estimated_impact: "high" | "medium" | "low";
};

/** Stable per-tool gradient derived from the tool name (real tools have no brand colors). */
function toolHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
function toolGradient(name: string): string {
  const H = toolHue(name);
  return `linear-gradient(135deg, hsl(${H} 60% 45%), hsl(${H} 65% 30%))`;
}

export default function StackPage({
  session,
  onStartCoaching,
}: {
  session: Session;
  onStartCoaching: (tool: string) => void;
}) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Get the Socrates user profile to find their user_id
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user.id)
        .single();

      if (!profile) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("recommendations")
        .select("id, tool_name, tool_category, tool_url, use_case, estimated_impact")
        .eq("user_id", profile.id)
        .eq("status", "approved")
        .order("estimated_impact", { ascending: false });

      setRecs((data ?? []) as Rec[]);
      setLoading(false);
    }
    // session.access_token is available for any authed backend fetch (matches ChatPage pattern):
    //   Authorization: `Bearer ${session.access_token}`
    void session;
    load();
  }, [session]);

  // Static-ish pill filters: "All" plus the first few distinct categories from the user's stack.
  const filters = useMemo(() => {
    const cats: string[] = [];
    for (const r of recs) {
      if (r.tool_category && !cats.includes(r.tool_category)) cats.push(r.tool_category);
    }
    return ["All", ...cats.slice(0, 4)];
  }, [recs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recs.filter((r) => {
      const matchesFilter = activeFilter === "All" || r.tool_category === activeFilter;
      const matchesQuery =
        !q ||
        r.tool_name.toLowerCase().includes(q) ||
        r.tool_category.toLowerCase().includes(q) ||
        r.use_case.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [recs, query, activeFilter]);

  if (loading) {
    return (
      <>
        <div className="head">
          <div className="titles">
            <h1>Your <span className="ital">stack</span></h1>
            <div className="sub">Loading your tools…</div>
          </div>
        </div>
      </>
    );
  }

  if (recs.length === 0) {
    return (
      <div className="scroll">
        <div className="head">
          <div className="titles">
            <h1>Your <span className="ital">stack</span></h1>
            <div className="sub">Approved tools will appear here</div>
          </div>
        </div>
        <div className="empty-rich anim">
          <div className="empty-ill">
            <div className="ring" />
            <div className="core"><Icon name="stack" /></div>
          </div>
          <h3>No tools approved <span className="ital">yet</span></h3>
          <p>
            Once you finish your onboarding interview and your manager signs off, your tailored
            AI toolkit lands right here.
          </p>
          <div className="empty-steps">
            <div className="empty-step">
              <span className="n">01</span>
              <span className="tx"><b>Finish onboarding</b>A ~30-min chat about how you work.</span>
            </div>
            <div className="empty-step">
              <span className="n">02</span>
              <span className="tx"><b>Manager review</b>Socrates routes recommendations for approval.</span>
            </div>
            <div className="empty-step">
              <span className="n">03</span>
              <span className="tx"><b>Start using them</b>Approved tools show up here with coaching.</span>
            </div>
          </div>
          <button
            className="btn btn-soft btn-block"
            onClick={() => openExternal(WEB_APP_URL)}
          >
            <Icon name="open" /> Open the Socrates web app
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="head">
        <div className="titles">
          <h1>Your <span className="ital">stack</span></h1>
          <div className="sub">{recs.length} tools approved for you · ready to use</div>
        </div>
        <div className="tools">
          <div className="search">
            <Icon name="search" />
            <input
              placeholder="Search tools…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="head" style={{ paddingTop: 0, paddingBottom: 10 }}>
        <div className="pill-filter">
          {filters.map((f) => (
            <button
              key={f}
              className={`pill${activeFilter === f ? " active" : ""}`}
              onClick={() => setActiveFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll">
        <div className="stack-grid anim">
          {visible.map((rec) => (
            <div key={rec.id} className="tool-card">
              <div className="tool-top">
                <ToolLogo
                  name={rec.tool_name}
                  className="tool-logo"
                  fallbackStyle={{ background: toolGradient(rec.tool_name) }}
                />
                <div className="tt">
                  <div className="nm">{rec.tool_name}</div>
                  <div className="ct">{rec.tool_category}</div>
                </div>
                <span className="badge approved"><span className="dot" />Approved</span>
              </div>
              <div className="tool-use">{rec.use_case}</div>
              <div className="tool-actions">
                {rec.tool_url ? (
                  <button
                    className="btn btn-soft btn-sm"
                    onClick={() => openExternal(rec.tool_url!)}
                  >
                    <Icon name="open" /> Open
                  </button>
                ) : (
                  <button className="btn btn-soft btn-sm" disabled>
                    <Icon name="open" /> Open
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onStartCoaching(rec.tool_name)}
                >
                  <Icon name="coach" /> Coach me
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
