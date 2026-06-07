import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "../lib/supabase";

type Tab  = "password" | "magic";
type View = "signin" | "forgot" | "forgot_sent";

export default function AuthPage({ deepLinkError, deepLinkRaw }: { deepLinkError?: string; deepLinkRaw?: string }) {
  const [tab, setTab]           = useState<Tab>("password");
  const [view, setView]         = useState<View>("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [magicSent, setMagicSent] = useState(false);

  // Show "waiting for browser" screen after OAuth is initiated
  const [oauthWaiting, setOauthWaiting] = useState(false);

  function switchTab(t: Tab) {
    setTab(t);
    setError("");
    setMagicSent(false);
  }

  function goForgot() { setView("forgot"); setError(""); }
  function goSignIn()  { setView("signin"); setError(""); }

  // ── Password sign-in ───────────────────────────────────────
  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  }

  // ── Forgot password ────────────────────────────────────────
  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: "socrates://auth/callback",
    });
    setBusy(false);
    if (error) setError(error.message);
    else setView("forgot_sent");
  }

  // ── Magic link ─────────────────────────────────────────────
  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: "socrates://auth/callback" },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setMagicSent(true);
  }

  // ── OAuth ──────────────────────────────────────────────────
  async function handleOAuth(provider: "google" | "azure") {
    setError("");
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: "socrates://auth/callback", skipBrowserRedirect: true },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (data?.url) {
      const win = getCurrentWindow();
      await win.setAlwaysOnTop(false);
      setOauthWaiting(true);
      await open(data.url);
    }
  }

  // ── "Waiting for browser sign-in" screen ──────────────────
  if (oauthWaiting) {
    return (
      <Shell>
        <div style={s.waitBox}>
          {deepLinkError ? (
            <>
              <div style={{ fontSize: 20, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontWeight: 600, color: "#f87171", marginBottom: 6, fontSize: 13 }}>
                Sign-in failed
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5, maxWidth: 260, wordBreak: "break-all" }}>
                {deepLinkError}
              </div>
            </>
          ) : deepLinkRaw ? (
            <>
              <div style={s.spinner} />
              <div style={{ fontWeight: 600, color: "#818cf8", marginBottom: 6, fontSize: 13 }}>
                Processing…
              </div>
              <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.5, maxWidth: 260, wordBreak: "break-all" }}>
                {deepLinkRaw}
              </div>
            </>
          ) : (
            <>
              <div style={s.spinner} />
              <div style={{ fontWeight: 600, color: "#f1f5f9", marginBottom: 6 }}>
                Waiting for sign-in…
              </div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, maxWidth: 240 }}>
                Complete sign-in in your browser. You'll be brought back here automatically.
              </div>
            </>
          )}
          <button
            onClick={() => {
              setOauthWaiting(false);
              getCurrentWindow().setAlwaysOnTop(true).catch(console.error);
            }}
            style={{ ...s.ghostBtn, marginTop: 18 }}
          >
            {deepLinkError ? "Try again" : "Cancel"}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Forgot password sent ───────────────────────────────────
  if (view === "forgot_sent") {
    return (
      <Shell>
        <div style={s.sentBox}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📬</div>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#f1f5f9" }}>
            Check your email
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
            We sent a password reset link to <strong>{email}</strong>.
            Click it and you'll be able to set a new password.
          </div>
          <button onClick={goSignIn} style={{ ...s.ghostBtn, marginTop: 16 }}>
            ← Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  // ── Forgot password form ───────────────────────────────────
  if (view === "forgot") {
    return (
      <Shell>
        <h2 style={s.forgotTitle}>Reset your password</h2>
        <p style={s.forgotSub}>
          Enter your email and we'll send a reset link.
        </p>
        <form onSubmit={handleForgot} style={s.form}>
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={s.input}
          />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy} style={s.primaryBtn}>
            {busy ? "Sending…" : "Send reset link →"}
          </button>
        </form>
        <button onClick={goSignIn} style={{ ...s.ghostBtn, marginTop: 12 }}>
          ← Back to sign in
        </button>
      </Shell>
    );
  }

  // ── Main sign-in view ──────────────────────────────────────
  return (
    <Shell>
      {/* OAuth buttons */}
      <div style={s.oauthRow}>
        <OAuthBtn
          icon={<GoogleIcon />}
          label="Google"
          onClick={() => handleOAuth("google")}
          loading={busy}
        />
      </div>

      {/* Divider */}
      <div style={s.divider}>
        <span style={s.dividerLine} />
        <span style={s.dividerText}>or</span>
        <span style={s.dividerLine} />
      </div>

      {/* Tab switcher */}
      <div style={s.tabs}>
        <TabBtn label="Password"   active={tab === "password"} onClick={() => switchTab("password")} />
        <TabBtn label="Magic link" active={tab === "magic"}    onClick={() => switchTab("magic")} />
      </div>

      {/* Password form */}
      {tab === "password" && (
        <form onSubmit={handlePassword} style={s.form}>
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={s.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={s.input}
          />
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={busy} style={s.primaryBtn}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
          <button type="button" onClick={goForgot} style={s.forgotLink}>
            Forgot password?
          </button>
        </form>
      )}

      {/* Magic link form */}
      {tab === "magic" && (
        magicSent ? (
          <div style={s.sentBox}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>📬</div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "#f1f5f9" }}>
              Check your email
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              Sent a link to <strong>{email}</strong>.
              Click it and you'll be signed in automatically.
            </div>
            <button
              onClick={() => setMagicSent(false)}
              style={{ ...s.ghostBtn, marginTop: 14 }}
            >
              Try a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleMagic} style={s.form}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={s.input}
            />
            {error && <div style={s.error}>{error}</div>}
            <button type="submit" disabled={busy} style={s.primaryBtn}>
              {busy ? "Sending…" : "Send magic link →"}
            </button>
          </form>
        )
      )}

      <p style={s.hint}>Use the same email as your Socrates web account.</p>
    </Shell>
  );
}

// ── Shared layout wrapper ──────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={s.wrap}>
      <div style={s.avatar}>S</div>
      <h1 style={s.title}>Welcome to Socrates</h1>
      <p style={s.sub}>Sign in with your work account</p>
      {children}
    </div>
  );
}

// ── Small components ───────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...s.tabBtn,
        color: active ? "#f1f5f9" : "#64748b",
        borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
      }}
    >
      {label}
    </button>
  );
}

function OAuthBtn({
  icon, label, onClick, loading,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; loading?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading} style={s.oauthBtn}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-9 20-20 0-1.3-.1-2.7-.4-4z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4c-7.7 0-14.4 4.4-17.7 10.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.4-5L31.1 33.5C29.2 34.8 26.7 36 24 36c-5.2 0-9.7-3.5-11.3-8.4l-6.5 5C9.5 39.4 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20H24v8h11.3c-1 2.7-2.8 4.8-5.1 6.2l6.3 5.1C40.5 35.8 44 30.4 44 24c0-1.3-.1-2.7-.4-4z"/>
    </svg>
  );
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
  },
  title: { fontSize: 19, fontWeight: 700, color: "#f1f5f9", margin: "0 0 4px" },
  sub:   { fontSize: 13, color: "#64748b", margin: "0 0 20px" },

  forgotTitle: { fontSize: 17, fontWeight: 700, color: "#f1f5f9", margin: "0 0 6px" },
  forgotSub:   { fontSize: 13, color: "#64748b", margin: "0 0 20px", maxWidth: 260 },

  oauthRow: { display: "flex", gap: 10, width: "100%", maxWidth: 300, marginBottom: 20 },
  oauthBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#f1f5f9",
    cursor: "pointer",
  },

  divider: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    maxWidth: 300,
    gap: 10,
    marginBottom: 16,
  },
  dividerLine: { flex: 1, height: 1, background: "#1e293b" },
  dividerText: { fontSize: 12, color: "#475569" },

  tabs: {
    display: "flex",
    width: "100%",
    maxWidth: 300,
    marginBottom: 14,
    borderBottom: "1px solid #1e293b",
  },
  tabBtn: {
    flex: 1,
    padding: "7px 0",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    transition: "color 120ms",
  },

  form: { width: "100%", maxWidth: 300, display: "flex", flexDirection: "column", gap: 10 },
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
  },
  ghostBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  forgotLink: {
    background: "none",
    border: "none",
    color: "#6366f1",
    fontSize: 12,
    cursor: "pointer",
    padding: "2px 0",
    textAlign: "center",
  },

  error: { fontSize: 12, color: "#f87171", textAlign: "left" },
  sentBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 22,
    maxWidth: 280,
    textAlign: "center",
  },
  waitBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    padding: 24,
    textAlign: "center",
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "3px solid #1e293b",
    borderTop: "3px solid #6366f1",
    animation: "spin 0.8s linear infinite",
    marginBottom: 8,
  },
  hint: { fontSize: 11, color: "#334155", margin: "14px 0 0", maxWidth: 260 },
};
