import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Rec = {
  id: string;
  tool_name: string;
  tool_category: string;
  tool_url: string | null;
  use_case: string;
  estimated_impact: "high" | "medium" | "low";
};

const IMPACT = {
  high:   { label: "High impact", color: "#15803d", bg: "#14532d33" },
  medium: { label: "Medium impact", color: "#a16207", bg: "#78350f33" },
  low:    { label: "Low impact", color: "#64748b", bg: "#1e293b" },
};

export default function StackPage({ onStartCoaching }: { onStartCoaching: (tool: string) => void }) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get the Socrates user profile to find their user_id
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user.id)
        .single();

      if (!profile) return;

      const { data } = await supabase
        .from("recommendations")
        .select("id, tool_name, tool_category, tool_url, use_case, estimated_impact")
        .eq("user_id", profile.id)
        .eq("status", "approved")
        .order("estimated_impact", { ascending: false });

      setRecs((data ?? []) as Rec[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div style={styles.center}>Loading your stack…</div>;

  if (recs.length === 0) {
    return (
      <div style={styles.center}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>⏳</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No approved tools yet</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>Check the web app — your manager may be reviewing recommendations.</div>
      </div>
    );
  }

  return (
    <div style={styles.list}>
      {recs.map((rec) => {
        const imp = IMPACT[rec.estimated_impact];
        return (
          <div key={rec.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <div style={styles.toolName}>{rec.tool_name}</div>
                <div style={styles.category}>{rec.tool_category}</div>
              </div>
              <span style={{ ...styles.badge, background: imp.bg, color: imp.color }}>
                {imp.label}
              </span>
            </div>

            <p style={styles.useCase}>{rec.use_case}</p>

            <div style={styles.actions}>
              <button
                onClick={() => onStartCoaching(rec.tool_name)}
                style={styles.coachBtn}
              >
                ◎ Coach me on this
              </button>
              {rec.tool_url && (
                <a href={rec.tool_url} target="_blank" rel="noreferrer" style={styles.openBtn}>
                  Open ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  list: { overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  toolName: { fontSize: 14, fontWeight: 700, color: "#f1f5f9" },
  category: { fontSize: 11, color: "#64748b", marginTop: 2 },
  badge: { fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 },
  useCase: { fontSize: 12, color: "#94a3b8", lineHeight: 1.6, margin: 0 },
  actions: { display: "flex", gap: 8 },
  coachBtn: {
    flex: 1,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  openBtn: {
    background: "#0f172a",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 500,
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    padding: 24,
  },
};
