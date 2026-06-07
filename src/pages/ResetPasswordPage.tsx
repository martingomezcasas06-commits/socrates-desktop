import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState("");
  const [done, setDone]           = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      // After a short delay the session is already live → App.tsx
      // will automatically render the main app.
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.avatar}>S</div>

      {done ? (
        <div style={s.successBox}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 600, color: "#f1f5f9", marginBottom: 6 }}>
            Password updated!
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>
            Signing you in…
          </div>
        </div>
      ) : (
        <>
          <h1 style={s.title}>Set a new password</h1>
          <p style={s.sub}>Choose something strong and memorable.</p>

          <form onSubmit={handleReset} style={s.form}>
            <div style={s.fieldWrap}>
              <label style={s.label}>New password</label>
              <input
                type="password"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={s.input}
              />
            </div>

            <div style={s.fieldWrap}>
              <label style={s.label}>Confirm password</label>
              <input
                type="password"
                placeholder="Repeat password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                style={s.input}
              />
            </div>

            {/* Strength hint */}
            {password.length > 0 && (
              <StrengthBar password={password} />
            )}

            {error && <div style={s.error}>{error}</div>}

            <button type="submit" disabled={busy} style={s.primaryBtn}>
              {busy ? "Saving…" : "Update password →"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

// ── Password strength indicator ────────────────────────────────

function StrengthBar({ password }: { password: string }) {
  const score = getStrength(password);
  const labels = ["Too short", "Weak", "Fair", "Strong", "Very strong"];
  const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"];

  return (
    <div style={{ width: "100%", maxWidth: 300 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i < score ? colors[score] : "#1e293b",
              transition: "background 200ms",
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors[score], textAlign: "right" }}>
        {labels[score]}
      </div>
    </div>
  );
}

function getStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

// ── Styles ─────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
    padding: "32px 28px",
    textAlign: "center",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    fontWeight: 700,
    color: "#fff",
    marginBottom: 16,
    boxShadow: "0 8px 24px rgba(99,102,241,0.35)",
    flexShrink: 0,
  },
  title: { fontSize: 18, fontWeight: 700, color: "#f1f5f9", margin: "0 0 4px" },
  sub:   { fontSize: 13, color: "#64748b", margin: "0 0 22px" },

  form:      { width: "100%", maxWidth: 300, display: "flex", flexDirection: "column", gap: 12 },
  fieldWrap: { display: "flex", flexDirection: "column", gap: 5, textAlign: "left" },
  label:     { fontSize: 12, fontWeight: 600, color: "#94a3b8" },
  input: {
    padding: "10px 13px",
    borderRadius: 8,
    border: "1px solid #1e293b",
    background: "#1e293b",
    color: "#f1f5f9",
    fontSize: 14,
    outline: "none",
  },
  primaryBtn: {
    padding: "11px 14px",
    borderRadius: 8,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  error: { fontSize: 12, color: "#f87171", textAlign: "left" },
  successBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 28,
    maxWidth: 280,
    textAlign: "center",
  },
};
