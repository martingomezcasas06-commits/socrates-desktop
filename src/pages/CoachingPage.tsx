/**
 * CoachingPage — the core of the desktop app. (Design-system reskin; logic unchanged.)
 *
 *   Advisory  — captures a screenshot every 5s → /api/coaching/analyze → guidance
 *               + stuck detection (offer to take over). Inline "ask about your screen" Q&A.
 *   Autonomous — on accepting the offer, loops /api/coaching/autonomous → Claude
 *               decides an action → Tauri/enigo executes it, until task_complete.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Icon from "../Icon";
import { apiFetch } from "../lib/api";
import VoiceSession from "../components/VoiceSession";
import RealtimeVoiceSession from "../components/RealtimeVoiceSession";
import { useT } from "../i18n";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function getTauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

const FLOAT_W = 440, FLOAT_H = 680;

/** Shrink the window into a floating, always-on-top coaching companion parked
 *  top-right — so it stays visible and reachable while you work in another app. */
async function enterFloating() {
  try {
    const { getCurrentWindow, currentMonitor } = await import("@tauri-apps/api/window");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(FLOAT_W, FLOAT_H));
    const mon = await currentMonitor();
    if (mon) {
      const scale = mon.scaleFactor || 1;
      const monW = mon.size.width / scale;
      await win.setPosition(new LogicalPosition(Math.max(12, monW - FLOAT_W - 24), 56));
    }
    // Turn the window into a non-activating panel that floats over everything — including
    // another app's native fullscreen. (Rust orders it front without activating our app.)
    try { await tauriInvoke("set_fullscreen_overlay", { enable: true }); } catch { /* older build */ }
  } catch (e) { console.error("enterFloating", e); }
}

/** Restore the full app window (normal, not on top) when a session ends. */
async function exitFloating() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    // Restore a normal window (drops overlay level/behaviour + non-activating style).
    try { await tauriInvoke("set_fullscreen_overlay", { enable: false }); } catch { /* older build */ }
    await win.setSize(new LogicalSize(980, 700));
    await win.center();
  } catch (e) { console.error("exitFloating", e); }
}

/** Expand the floating companion back to a comfortable size (stays on top during a session). */
async function expandFloating() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(980, 700));
    await win.center();
  } catch (e) { console.error("expandFloating", e); }
}

type Mode = "idle" | "advisory" | "autonomous";

type AnalysisResult = { guidance: string; tryThis?: string | null; stuck: boolean; offer: string | null; level?: string; sessionCount?: number };
type AutonomousResult = {
  action: string; x: number | null; y: number | null; value: string;
  scroll_direction: string; action_taken: string; task_complete: boolean; summary: string | null;
};

const API_URL  = import.meta.env.VITE_API_URL as string;
// Teaching cadence: a learner needs time to read a step and act on it before the
// tutor advances. A fast tick makes the guidance churn and feel reactive.
const INTERVAL = 9000;

// Phase shown in the session header (coaching.levels) — reinforces the "leveling up" feel.
const LEVELS = ["new", "learning", "confident"] as const;
type Level = (typeof LEVELS)[number];
const isLevel = (l: string | null): l is Level => !!l && (LEVELS as readonly string[]).includes(l);

export default function CoachingPage({ session, initialTool }: { session: Session; initialTool: string }) {
  const { t, m } = useT();
  const [tool, setTool] = useState(initialTool || "");
  const [mode, setMode] = useState<Mode>("idle");
  const [guidance, setGuidance] = useState("");
  const [tryThis, setTryThis] = useState<string | null>(null);
  const [offer, setOffer] = useState<string | null>(null);
  // The lesson so far — recent guidance steps, sent back each tick so the tutor
  // advances instead of repeating itself.
  const taughtRef = useRef<string[]>([]);
  // First tick of a session is phase:"start" (bumps the saved session count).
  const startPhaseRef = useRef(false);
  // Where the learner is for this tool: new (tour) → learning (core) → confident (pro).
  const [level, setLevel] = useState<string | null>(null);
  const [autonomousLog, setAutonomousLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autonomousRef = useRef(false);
  const analyzingRef = useRef(false);

  const [qa, setQa] = useState<{ q: string; a: string | null; tryThis?: string | null }[]>([]);
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const guidanceScrollRef = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [tab, setTab] = useState<"coaching" | "chat">("coaching");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceFallback, setVoiceFallback] = useState(false);
  // Why realtime bailed, so the "classic" badge can say what actually broke
  // instead of just that something did.
  const [voiceFallbackReason, setVoiceFallbackReason] = useState("");

  function startVoice() {
    if (!tool.trim()) { setError(t("coaching.enterTool")); return; }
    setError("");
    setVoiceActive(true);
  }

  // ── Screen capture ──
  async function captureScreen(): Promise<string> {
    if (IS_TAURI) return tauriInvoke<string>("capture_screen");
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return "";
    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  // ── Advisory loop ──
  const analyzeScreen = useCallback(async () => {
    if (mode === "autonomous") return;
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    try {
      const screenshot = await captureScreen();
      if (!screenshot || screenshot.length < 100) {
        setError(IS_TAURI ? t("coaching.captureFailedTauri") : t("coaching.captureFailedBrowser"));
        return;
      }
      setError("");
      setGuidance((g) => g || t("coaching.looking"));
      const phase = startPhaseRef.current ? "start" : "tick";
      const res = await apiFetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshot, tool, taught: taughtRef.current.slice(-4), phase }),
      });
      if (!res.ok) { setError(t("coaching.analyzeFailed", { status: res.status })); return; }
      const data: AnalysisResult = await res.json();
      startPhaseRef.current = false; // the session has been counted
      setGuidance(data.guidance);
      setTryThis(data.tryThis ?? null);
      if (data.level) setLevel(data.level);
      // Record the step (skip near-duplicate ticks where the tutor is holding).
      if (data.guidance && taughtRef.current[taughtRef.current.length - 1] !== data.guidance) {
        taughtRef.current = [...taughtRef.current, data.guidance].slice(-8);
      }
      if (data.stuck && data.offer) setOffer(data.offer);
    } catch (e) {
      setError(t("common.connectionProblem", { detail: e instanceof Error ? e.message : String(e) }));
    } finally {
      analyzingRef.current = false;
    }
  }, [mode, tool, session.access_token, t]);

  async function startAdvisory() {
    if (!tool.trim()) { setError(t("coaching.enterTool")); return; }
    setError("");
    if (IS_TAURI) {
      // Screen Recording permission is required to see your screen. If it's missing,
      // macOS silently returns only the desktop wallpaper — so check first and guide.
      try {
        const ok = await tauriInvoke<boolean>("screen_recording_allowed");
        if (!ok) {
          await tauriInvoke("request_screen_recording");
          setError(t("coaching.needScreenRecording"));
          return;
        }
      } catch { /* older build without the check */ }
    }
    if (!IS_TAURI) {
      if (!navigator.mediaDevices?.getDisplayMedia) { setError(t("coaching.shareUnsupported")); return; }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        stream.getVideoTracks()[0].addEventListener("ended", () => stopSession());
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") return;
        setError(t("coaching.shareFailed"));
        return;
      }
    }
    setMode("advisory");
    setGuidance(t("coaching.kickoff", { tool }));
    setTryThis(null); taughtRef.current = []; startPhaseRef.current = true; setLevel(null);
    setOffer(null); setSummary(null); setAutonomousLog([]);
    // Become a floating, always-on-top companion so Socrates stays reachable
    // while you work in the tool you're being coached on.
    if (IS_TAURI) await enterFloating();
  }

  async function stopSession() {
    autonomousRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    // Restore the full app window.
    if (IS_TAURI) await exitFloating();
    taughtRef.current = []; startPhaseRef.current = false;
    setMode("idle"); setOffer(null); setSummary(null); setGuidance(""); setTryThis(null); setLevel(null);
  }

  useEffect(() => {
    if (mode === "advisory") {
      analyzeScreen();
      intervalRef.current = setInterval(analyzeScreen, INTERVAL);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [mode, analyzeScreen]);

  // ── Autonomous ──
  async function acceptOffer() {
    // The offer IS the goal ("Want me to open Memory settings for you?"). It used
    // to be discarded here, so autonomous mode was never told what to do.
    const goal = offer;
    setOffer(null); setMode("autonomous"); autonomousRef.current = true;
    setAutonomousLog([]); setSummary(null);
    if (IS_TAURI) {
      const win = await getTauriWindow();
      await win.setAlwaysOnTop(false); await win.hide();
    }
    await runAutonomousLoop(goal);
    // Back to the floating advisory companion.
    if (IS_TAURI) await enterFloating();
  }

  // Hard cap on actions per takeover. Socrates is driving someone's mouse and
  // keyboard; if it has not arrived in this many steps, it hands control back.
  const MAX_AUTONOMOUS_STEPS = 15;

  async function runAutonomousLoop(goal: string | null) {
    // A local array, not the autonomousLog state: state read inside this loop is
    // the value from the render that started it (always []), so the model was
    // never shown what it had already done and could repeat the same click.
    const log: string[] = [];
    while (autonomousRef.current) {
      if (log.length >= MAX_AUTONOMOUS_STEPS) {
        autonomousRef.current = false;
        setSummary(t("coaching.handBack"));
        setMode("advisory");
        break;
      }
      try {
        const screenshot = await captureScreen();
        const res = await apiFetch(`${API_URL}/api/coaching/autonomous`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screenshot, tool, log, goal }),
        });
        if (!res.ok) { autonomousRef.current = false; break; }
        const data: AutonomousResult = await res.json();
        log.push(data.action_taken);
        setAutonomousLog([...log]);
        if (data.task_complete) {
          autonomousRef.current = false;
          setSummary(data.summary ?? t("coaching.doneHandBack"));
          setMode("advisory");
          setGuidance(data.summary ?? "");
          break;
        }
        if (data.action !== "done" && IS_TAURI) {
          try {
            await tauriInvoke("execute_action", {
              action: data.action, x: data.x, y: data.y,
              text: data.value || null, scrollDirection: data.scroll_direction || "down",
            });
          } catch (execErr) { console.error("execute_action error:", execErr); }
        }
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e) {
        console.error("autonomous error", e);
        autonomousRef.current = false; setMode("advisory"); break;
      }
    }
  }

  function declineOffer() { setOffer(null); }

  // ── Inline Q&A ──
  async function askQuestion(e: React.FormEvent) {
    e.preventDefault();
    const q = askInput.trim();
    if (!q || asking) return;
    setAskInput(""); setAsking(true);
    setQa((prev) => [...prev, { q, a: null }]);
    try {
      const screenshot = await captureScreen();
      const res = await apiFetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshot, tool, question: q, history: qa.filter((turn): turn is { q: string; a: string } => turn.a !== null).slice(-6) }),
      });
      const data: AnalysisResult = await res.json();
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: data.guidance, tryThis: data.tryThis ?? null } : item)));
    } catch {
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: t("coaching.askFailed") } : item)));
    }
    setAsking(false);
  }

  // Sticky auto-scroll: follow new guidance/answers only when you're already at the
  // bottom, so a 5s advisory tick can't yank you while you're reading further up.
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = guidanceScrollRef.current;
    if (!el || !atBottomRef.current) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [qa, guidance, asking]);

  const [expanded, setExpanded] = useState(false);
  async function toggleSize() {
    if (IS_TAURI) {
      if (expanded) { await enterFloating(); setExpanded(false); }
      else { await expandFloating(); setExpanded(true); }
      return;
    }
    const w = window.open(window.location.href, "socrates-companion", "width=440,height=680,resizable=yes,scrollbars=no");
    if (w) w.focus();
  }

  // ── Q&A bar (shared) ──
  const qaBar = (
    <div className="guide-qa">
      <div className="qa-label">{t("coaching.askLabel")}</div>
      <form className="qa-input" onSubmit={askQuestion}>
        <Icon name="eye" />
        <input value={askInput} onChange={(e) => setAskInput(e.target.value)} placeholder={t("coaching.askPlaceholder")} />
        <button type="submit" className="send-sm" disabled={!askInput.trim() || asking}><Icon name="send" /></button>
      </form>
    </div>
  );

  // Hands-free voice call takes over the whole window (shrunk to a tiny orb).
  // GPT-realtime (speech-to-speech, sub-second) first; classic pipeline as fallback.
  if (voiceActive) {
    return voiceFallback ? (
      <VoiceSession
        tool={tool}
        onEnd={() => setVoiceActive(false)}
        fallbackReason={voiceFallbackReason}
      />
    ) : (
      <RealtimeVoiceSession
        tool={tool}
        onEnd={() => setVoiceActive(false)}
        onFallback={(reason) => { setVoiceFallbackReason(reason); setVoiceFallback(true); }}
      />
    );
  }

  return (
    <div className="coach">
      {/* hidden capture elements (browser mode) */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* sub-tabs */}
      <div className="coach-sub">
        <button className={`coach-tab${tab === "coaching" ? " active" : ""}`} onClick={() => setTab("coaching")}><Icon name="coach" /> {t("coaching.tabCoaching")}</button>
        <button className={`coach-tab${tab === "chat" ? " active" : ""}`} onClick={() => setTab("chat")}><Icon name="chat" /> {t("coaching.tabChat")}</button>
        <button className="tb-btn" style={{ marginLeft: "auto", marginRight: 0 }} onClick={toggleSize} title={expanded ? t("coaching.shrink") : t("coaching.expand")}><Icon name="pop" /></button>
      </div>

      {tab === "chat" ? (
        <CoachingChat tool={tool} />
      ) : mode === "idle" ? (
        /* ── IDLE ── */
        <div className="coach-idle anim">
          <div className="start-panel">
            <h2>{t("coaching.startTitleBefore")}<span className="ital">{t("coaching.startTitleAccent")}</span>{t("coaching.startTitleAfter")}</h2>
            <p>{t("coaching.startBody")}</p>
            <div className="start-row">
              <input className="field" value={tool} onChange={(e) => setTool(e.target.value)} placeholder={t("coaching.toolPlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter") startVoice(); }} />
              <button className="btn btn-primary btn-lg" onClick={startVoice}><Icon name="coach" /> {t("coaching.startVoice")}</button>
            </div>
            <button className="link-quiet" onClick={startAdvisory}>{t("coaching.preferText")}</button>
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>{error}</div>}
          <div className="panel" style={{ marginTop: 16 }}>
            <h4><Icon name="help" /> {t("coaching.howTitle")}</h4>
            <div className="how-row">
              {m.coaching.how.map((h, i) => (
                <div key={i} className="how-card">
                  <div className="n">{i + 1}</div>
                  <div className="t">{h.t}</div>
                  <div className="d">{h.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── LIVE: watching | autonomous ── */
        <>
          {mode === "autonomous" && (
            <div className="control-banner">
              <div className="control-orb"><Icon name="bolt" /></div>
              <div className="cb-tx"><div className="t">{t("coaching.inControl")}</div><div className="d">{t("coaching.navigating", { tool: tool || t("coaching.yourTool") })}</div></div>
              <button className="btn btn-danger btn-sm" onClick={stopSession}><Icon name="stop" /> {t("coaching.stop")}</button>
            </div>
          )}
          <div className="coach-live">
            {/* preview pane */}
            <div className="preview-pane">
              {mode !== "autonomous" && (
                <div className="preview-status">
                  <span className="badge live"><span className="dot" />{t("coaching.liveWatching")}</span>
                  <span className="st-txt">{t("coaching.coachingOn")} <span className="dim">·</span> {tool || t("coaching.yourScreen")}</span>
                  <span className="spacer" />
                  <button className="btn btn-danger btn-sm" onClick={stopSession}><Icon name="stop" /> {t("coaching.stopSession")}</button>
                </div>
              )}
              <div className="preview-frame">
                {!IS_TAURI && streamRef.current ? (
                  <video autoPlay muted playsInline ref={(el) => { if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }} style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--bg)" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-faint)", textAlign: "center", padding: 24 }}>
                    <div>
                      <div style={{ display: "grid", placeItems: "center", marginBottom: 12 }}><Icon name="eye" size={30} /></div>
                      <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>{t("coaching.watchingPrivately")}</div>
                      <div className="mono" style={{ marginTop: 6 }}>{t("coaching.staysOnDevice")}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* guide pane */}
            <aside className="guide-pane">
              {mode === "autonomous" ? (
                <>
                  <div className="guide-head"><Icon name="bolt" /><div className="gh-t">{t("coaching.actionLog")}<span className="mono">{t("coaching.autonomousMode")}</span></div></div>
                  <div className="action-log">
                    {autonomousLog.map((a, i) => (
                      <div key={i} className={`log-item${i === autonomousLog.length - 1 ? " cur" : ""}`}>
                        <span className="lx"><Icon name="check" size={13} style={{ display: "inline", verticalAlign: "-2px", color: "var(--green)" }} /> {a}</span>
                      </div>
                    ))}
                    <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{t("coaching.working")}</div>
                  </div>
                  {qaBar}
                </>
              ) : (
                <>
                  <div className="guide-head"><Icon name="target" /><div className="gh-t" style={{ flex: 1, minWidth: 0 }}>{t("coaching.guidance")}<span className="mono">{tool || t("coaching.liveCoaching")}</span></div>
                    {isLevel(level) && <span className={`lvl-badge ${level}`}>{t(`coaching.levels.${level}`)}</span>}
                    <button className="btn btn-danger btn-sm" onClick={stopSession}><Icon name="stop" /> {t("coaching.endSession")}</button>
                  </div>
                  <div className="guide-feed" ref={guidanceScrollRef}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                    }}>
                    {error && <div style={{ color: "var(--red)", fontSize: 12.5 }}>{error}</div>}
                    {summary && (
                      <div className="offer-card" style={{ background: "var(--green-soft)", borderColor: "rgba(79,178,134,0.4)" }}>
                        <div className="oc-top"><div className="oc-ic" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Icon name="check" /></div><h4>{t("coaching.done")}</h4></div>
                        <p>{summary}</p>
                      </div>
                    )}
                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)" }}>{guidance || t("coaching.analysing")}</p>
                    {tryThis && <TryThisBox text={tryThis} />}
                    {qa.map((item, i) => (
                      <div key={i} style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 12.5, color: "var(--accent-2)", background: "var(--accent-soft)", borderRadius: "10px 10px 2px 10px", padding: "7px 11px", marginLeft: "auto", width: "fit-content", maxWidth: "90%", lineHeight: 1.45 }}>{item.q}</div>
                        <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, marginTop: 6 }}>
                          {item.a ?? <span style={{ opacity: 0.6, fontStyle: "italic" }}>{t("coaching.lookingShort")}</span>}
                        </div>
                        {item.tryThis && <TryThisBox text={item.tryThis} />}
                      </div>
                    ))}
                    {offer && (
                      <div className="offer-card">
                        <div className="oc-top"><div className="oc-ic"><Icon name="bolt" /></div><h4>{t("coaching.stuckTitle")}</h4></div>
                        <p>{offer}</p>
                        <div className="offer-actions">
                          <button className="btn btn-soft btn-sm" onClick={declineOffer}>{t("coaching.gotIt")}</button>
                          <button className="btn btn-primary btn-sm" onClick={acceptOffer}><Icon name="bolt" /> {t("coaching.takeOver")}</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {qaBar}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** A copy-paste-ready example the tutor wants the learner to type into the tool.
 *  This is the thing a true beginner needs most — they never face a blank box. */
function TryThisBox({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked — the text is still visible to retype */ }
  }
  return (
    <div className="try-box">
      <div className="try-head">
        <span className="try-label"><Icon name="sparkle" /> {t("coaching.tryTyping")}</span>
        <button className="try-copy" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} /> {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <div className="try-text">{text}</div>
    </div>
  );
}

// ── Embedded chat (the "Chat" sub-tab — in-context conversation while coaching) ──
type ChatMsg = { role: "user" | "assistant"; content: string };

// No session prop: apiFetch attaches a freshly-minted token per request.
function CoachingChat({ tool }: { tool: string }) {
  const { t } = useT();
  // Greeting rendered from the catalog (follows a language switch), still sent as turn one.
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busy]);
  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return;
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    try {
      const res = await apiFetch(`${API_URL}/api/chat/employee-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "assistant", content: t("coaching.chatGreeting") }, ...next] }),
      });
      const reply = await res.text();
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...next, { role: "assistant", content: t("coaching.chatError") }]);
    }
    setBusy(false);
  }
  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="chat-main" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-stream" ref={listRef} style={{ padding: "18px 22px" }}>
        <div className="msg bot">
          <div className="av"><Icon name="sparkle" /></div>
          <div className="bubble">{t("coaching.chatGreeting")}</div>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "me" : "bot"}`}>
            <div className="av">{m.role === "user" ? "" : <Icon name="sparkle" />}</div>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {busy && <div className="dim" style={{ fontSize: 12, fontStyle: "italic", paddingLeft: 6 }}>{t("common.thinking")}</div>}
      </div>
      <div className="chat-foot" style={{ padding: "0 22px 18px" }}>
        <div className="composer">
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey} rows={1}
            placeholder={tool ? t("coaching.askAbout", { tool }) : t("coaching.askAnything")} />
          <button className="send" onClick={send} disabled={!input.trim() || busy}><Icon name="send" /></button>
        </div>
      </div>
    </div>
  );
}
