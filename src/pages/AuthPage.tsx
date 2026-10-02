import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "../lib/supabase";
import Icon, { GoogleG } from "../Icon";
import { LanguageSwitch, useT } from "../i18n";

type Tab  = "password" | "magic";
type View = "signin" | "forgot" | "forgot_sent";

export default function AuthPage({ deepLinkError, deepLinkRaw }: { deepLinkError?: string; deepLinkRaw?: string }) {
  const { t } = useT();
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
    <>
    <LanguageSwitch className="login-lang" />
    <div className="login-aside">
      <div className="la-brand">
        <span className="brand-mark" />
        <span className="nm">Socrates</span>
      </div>
      <div className="la-tag">
        <h2>{t("auth.asideTitleBefore")}<span className="ital">{t("auth.asideTitleAccent").replace(/ /g, "\u00a0")}</span>{t("auth.asideTitleAfter")}</h2>
        <div className="la-points">
          <div className="la-point">
            <div className="ic"><Icon name="stack" /></div>
            <div className="tx"><b>{t("auth.pointStackTitle")}</b>{t("auth.pointStackBody")}</div>
          </div>
          <div className="la-point">
            <div className="ic"><Icon name="coach" /></div>
            <div className="tx"><b>{t("auth.pointCoachTitle")}</b>{t("auth.pointCoachBody")}</div>
          </div>
          <div className="la-point">
            <div className="ic"><Icon name="shield" /></div>
            <div className="tx"><b>{t("auth.pointSafeTitle")}</b>{t("auth.pointSafeBody")}</div>
          </div>
        </div>
      </div>
    </div>
    </>
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
                  {t("auth.signInFailed")}
                </h1>
                <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto", wordBreak: "break-all" }}>
                  {deepLinkError}
                </p>
              </>
            ) : deepLinkRaw ? (
              <>
                <span className="brand-mark" style={{ width: 36, height: 36, margin: "0 auto 14px" }} />
                <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--accent-2)", marginBottom: 8 }}>
                  {t("auth.processing")}
                </h1>
                <p style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto", wordBreak: "break-all" }}>
                  {deepLinkRaw}
                </p>
              </>
            ) : (
              <>
                <span className="brand-mark" style={{ width: 36, height: 36, margin: "0 auto 14px" }} />
                <h1 style={{ fontSize: 21, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>
                  {t("auth.waitingTitle")}
                </h1>
                <p style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.6, maxWidth: 300, margin: "0 auto" }}>
                  {t("auth.waitingBody")}
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
              {deepLinkError ? t("auth.tryAgain") : t("auth.cancel")}
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
            <h1>{t("auth.checkEmail")}</h1>
            <p>
              {t("auth.resetSentBefore")}<strong style={{ color: "var(--ink)" }}>{email}</strong>{t("auth.resetSentAfter")}
            </p>
          </div>
          <button className="btn btn-soft" onClick={goSignIn}>{t("auth.backToSignIn")}</button>
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
            <h1>{t("auth.resetTitle")}</h1>
            <p>{t("auth.resetSub")}</p>
          </div>
          <form onSubmit={handleForgot}>
            <input
              className="field"
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            {error && <div style={errorStyle}>{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? t("auth.sending") : <>{t("auth.sendResetLink")} <Icon name="arrow" /></>}
            </button>
          </form>
          <div className="forgot">
            <a href="#" onClick={e => { e.preventDefault(); goSignIn(); }}>{t("auth.backToSignIn")}</a>
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
          <h1>{t("auth.welcomeBack")}</h1>
          <p>{t("auth.signInSub")}</p>
        </div>

        <button className="oauth-btn" onClick={() => handleOAuth("google")} disabled={busy}>
          <GoogleG /> {t("auth.continueGoogle")}
        </button>

        <div className="or-sep">{t("auth.or")}</div>

        <div className="seg">
          <button className={tab === "password" ? "active" : ""} onClick={() => switchTab("password")}>
            {t("auth.tabPassword")}
          </button>
          <button className={tab === "magic" ? "active" : ""} onClick={() => switchTab("magic")}>
            {t("auth.tabMagic")}
          </button>
        </div>

        {/* Password form */}
        {tab === "password" && (
          <form onSubmit={handlePassword}>
            <input
              className="field"
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              className="field"
              type="password"
              placeholder={t("auth.passwordPlaceholder")}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            {error && <div style={errorStyle}>{error}</div>}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? t("auth.signingIn") : <>{t("auth.signIn")} <Icon name="arrow" /></>}
            </button>
            <div className="forgot">
              <a href="#" onClick={e => { e.preventDefault(); goForgot(); }}>{t("auth.forgot")}</a>
            </div>
          </form>
        )}

        {/* Magic link form */}
        {tab === "magic" && (
          magicSent ? (
            <div>
              <div className="magic-note" style={{ marginBottom: 14 }}>
                {t("auth.magicSentBefore")}<strong style={{ color: "var(--ink)" }}>{email}</strong>{t("auth.magicSentAfter")}
              </div>
              <button className="btn btn-soft btn-block" onClick={() => setMagicSent(false)}>
                {t("auth.tryDifferentEmail")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagic}>
              <div className="magic-note">{t("auth.magicNote")}</div>
              <input
                className="field"
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              {error && <div style={errorStyle}>{error}</div>}
              <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
                {busy ? t("auth.sending") : <>{t("auth.sendMagic")} <Icon name="send" /></>}
              </button>
            </form>
          )
        )}

        <div className="foot-note">{t("auth.footNote")}</div>
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
