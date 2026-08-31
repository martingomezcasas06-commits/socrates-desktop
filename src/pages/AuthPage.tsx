import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "../lib/supabase";
import Icon, { GoogleG } from "../Icon";

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

  // ── Left brand aside (shared across all views) ─────────────
  const aside = (
    <div className="login-aside">
      <div className="la-brand">
        <span className="brand-mark" />
        <span className="nm">Socrates</span>
      </div>
      <div className="la-tag">
        <h2>Your team's <span className="ital">AI&nbsp;mentor</span>, right on your desktop.</h2>
        <div className="la-points">
          <div className="la-point">
            <div className="ic"><Icon name="stack" /></div>
            <div className="tx"><b>Your approved stack</b> — every tool cleared for your role, in one place.</div>
          </div>
          <div className="la-point">
            <div className="ic"><Icon name="coach" /></div>
            <div className="tx"><b>Live coaching</b> — Socrates watches your screen and guides you, step by step.</div>
          </div>
          <div className="la-point">
            <div className="ic"><Icon name="shield" /></div>
            <div className="tx"><b>Safe by default</b> — only tools and data your org has approved.</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ── "Waiting for browser sign-in" screen ──────────────────
  if (oauthWaiting) {
    return (
      <div className="login anim">
        {aside}
        <div className="login-form">
          <div style={{ textAlign: "center" }}>
            {deepLinkError ? (
              <>
                <div style={{ fontSize: 22, marginBottom: 10 }}>⚠️</div>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--red)", marginBottom: 8 }}>
                  Sign-in failed
                </h1>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto", wordBreak: "break-all" }}>
                  {deepLinkError}
                </p>
              </>
            ) : deepLinkRaw ? (
              <>
                <span className="brand-mark" style={{ width: 36, height: 36, margin: "0 auto 14px" }} />
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--accent-2)", marginBottom: 8 }}>
                  Processing…
                </h1>
                <p style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto", wordBreak: "break-all" }}>
                  {deepLinkRaw}
                </p>
              </>
            ) : (
              <>
                <span className="brand-mark" style={{ width: 36, height: 36, margin: "0 auto 14px" }} />
                <h1 style={{ fontSize: 21, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
                  Waiting for sign-in…
                </h1>
                <p style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
                  Complete sign-in in your browser. You'll be brought back here automatically.
                </p>
              </>
            )}
            <button
              className="btn btn-soft"
              onClick={() => {
                setOauthWaiting(false);
                getCurrentWindow().setAlwaysOnTop(true).catch(console.error);
              }}
              style={{ marginTop: 22 }}
            >
              {deepLinkError ? "Try again" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Forgot password sent ───────────────────────────────────
  if (view === "forgot_sent") {
    return (
      <div className="login anim">
        {aside}
        <div className="login-form">
          <div className="lf-head">
            <h1>Check your email</h1>
            <p>
              We sent a password reset link to <strong style={{ color: "var(--ink)" }}>{email}</strong>.
              Click it and you'll be able to set a new password.
            </p>
          </div>
          <button className="btn btn-soft" onClick={goSignIn}>← Back to sign in</button>
        </div>
      </div>
    );
  }

  // ── Forgot password form ───────────────────────────────────
  if (view === "forgot") {
    return (
      <div className="login anim">
        {aside}
        <div className="login-form">
          <div className="lf-head">
            <h1>Reset your password</h1>
            <p>Enter your email and we'll send a reset link.</p>
          </div>
          <form onSubmit={handleForgot}>
            <input
              className="field"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            {error && <div style={errorStyle}>{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? "Sending…" : <>Send reset link <Icon name="arrow" /></>}
            </button>
          </form>
          <div className="forgot">
            <a href="#" onClick={e => { e.preventDefault(); goSignIn(); }}>← Back to sign in</a>
          </div>
        </div>
      </div>
    );
  }

  // ── Main sign-in view ──────────────────────────────────────
  return (
    <div className="login anim">
      {aside}
      <div className="login-form">
        <div className="lf-head">
          <h1>Welcome back</h1>
          <p>Sign in with your work account to continue.</p>
        </div>

        <button className="oauth-btn" onClick={() => handleOAuth("google")} disabled={busy}>
          <GoogleG /> Continue with Google
        </button>

        <div className="or-sep">or</div>

        <div className="seg">
          <button className={tab === "password" ? "active" : ""} onClick={() => switchTab("password")}>
            Password
          </button>
          <button className={tab === "magic" ? "active" : ""} onClick={() => switchTab("magic")}>
            Magic link
          </button>
        </div>

        {/* Password form */}
        {tab === "password" && (
          <form onSubmit={handlePassword}>
            <input
              className="field"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              className="field"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            {error && <div style={errorStyle}>{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? "Signing in…" : <>Sign in <Icon name="arrow" /></>}
            </button>
            <div className="forgot">
              <a href="#" onClick={e => { e.preventDefault(); goForgot(); }}>Forgot password?</a>
            </div>
          </form>
        )}

        {/* Magic link form */}
        {tab === "magic" && (
          magicSent ? (
            <div>
              <div className="magic-note" style={{ marginBottom: 14 }}>
                Sent a link to <strong style={{ color: "var(--ink)" }}>{email}</strong>.
                Click it and you'll be signed in automatically.
              </div>
              <button className="btn btn-soft btn-block" onClick={() => setMagicSent(false)}>
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagic}>
              <div className="magic-note">We'll email you a one-time sign-in link. No password needed.</div>
              <input
                className="field"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
                {busy ? "Sending…" : <>Send magic link <Icon name="send" /></>}
              </button>
            </form>
          )
        )}

        <div className="foot-note">Use the same email as your Socrates web account.</div>
      </div>
    </div>
  );
}

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--red)",
  background: "var(--red-soft)",
  borderRadius: "var(--r-sm)",
  padding: "8px 11px",
  marginBottom: 11,
  lineHeight: 1.4,
};
