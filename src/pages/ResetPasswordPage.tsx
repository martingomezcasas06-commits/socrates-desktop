import { useState } from "react";
import { supabase } from "../lib/supabase";
import Icon from "../Icon";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", padding: 28 }}>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <span className="brand-mark" style={{ width: 48, height: 48, marginBottom: 22 }} />

        {done ? (
          <div className="panel" style={{ padding: 28, width: "100%" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", margin: "0 auto 14px", background: "var(--green-soft)", border: "1px solid rgba(79,178,134,0.4)", display: "grid", placeItems: "center", color: "var(--green)" }}>
              <Icon name="check" size={26} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Password updated</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 6 }}>Signing you in…</div>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Set a new password</h1>
            <p className="dim" style={{ fontSize: 13.5, marginTop: 5, marginBottom: 22 }}>Choose something strong and memorable.</p>

            <form onSubmit={handleReset} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 11 }}>
              <input className="field" type="password" placeholder="New password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ margin: 0 }} />
              <input className="field" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required style={{ margin: 0 }} />
              {password.length > 0 && <StrengthBar password={password} />}
              {error && <div style={{ fontSize: 12.5, color: "var(--red)", textAlign: "left" }}>{error}</div>}
              <button type="submit" disabled={busy} className="btn btn-primary btn-lg btn-block" style={{ marginTop: 4 }}>
                {busy ? "Saving…" : <>Update password <Icon name="arrow" /></>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function StrengthBar({ password }: { password: string }) {
  const score = getStrength(password);
  const labels = ["Too short", "Weak", "Fair", "Strong", "Very strong"];
  const colors = ["var(--red)", "var(--warm)", "var(--amber)", "var(--green)", "var(--green)"];
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < score ? colors[score] : "var(--surface-3)", transition: "background 200ms" }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors[score], textAlign: "right" }}>{labels[score]}</div>
    </div>
  );
}

function getStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}
