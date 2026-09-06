/**
 * VoiceSession — hands-free voice coaching.
 *
 * A real "call" with Socrates: it listens continuously (voice-activity
 * detection, so it only sends your actual speech), transcribes what you say,
 * asks the voice brain for the next spoken step (with a screenshot for context),
 * and speaks the reply aloud. You can talk over it to interrupt (barge-in).
 *
 * The UI is a tiny orb — not a rectangle over your screen.
 *
 * Pipeline per turn:
 *   mic → VAD segment → /api/coaching/transcribe → /api/coaching/voice → /api/coaching/speak → play
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { vlog } from "../lib/vlog";
import { freshToken } from "../lib/api";
import { useSmoothText } from "../lib/useSmoothText";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const API_URL = import.meta.env.VITE_API_URL as string;

// ── Voice-activity detection tuning ──
const SPEECH_RMS = 0.025;     // energy above this = likely speech
const ONSET_FRAMES = 2;       // consecutive loud frames to call it "speaking"
// End-of-utterance silence is ADAPTIVE: quick remarks close fast (snappy turns),
// but once someone has been talking a while they're mid-thought — natural pauses
// get longer, and cutting at 400ms chops their sentence into fragments the tutor
// can't follow. Long speech earns a longer grace window.
const SILENCE_MS_SHORT = 420;   // utterances under ~3.5s
const SILENCE_MS_LONG = 850;    // utterances past LONG_SPEECH_MS
const LONG_SPEECH_MS = 3500;
const MIN_UTTERANCE_MS = 350; // ignore blips shorter than this
// The design system's coaching panel. The design draws it at 288 wide, but that
// assumes its single ✕ — we carry mute and expand too, and at 288 those ate the
// text column until both the title and the mono line ellipsised. 348 is the
// width at which the design's own strings fit whole. Height hugs the panel: it
// measures 71px normally and 98px with a two-line warning, so 100 is snug with
// nothing clipped.
export const ORB_W = 348, ORB_H = 100;
export const EXP_W = 384, EXP_H = 540; // expanded chat view

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Float the window at a given size, top-right, over everything. The app's normal
// minimum size (380x460) would otherwise clamp the tiny orb, so relax it first;
// and the Rust overlay sizes the NSPanel directly (JS setSize is ignored on a panel).
export async function floatWindow(w: number, h: number) {
  if (!IS_TAURI) return;
  try {
    const { getCurrentWindow, currentMonitor } = await import("@tauri-apps/api/window");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    // Isolate setMinSize: if its capability were ever missing it must NOT abort the
    // resize/overlay below (that left the orb stuck at full window size).
    try { await win.setMinSize(new LogicalSize(200, 80)); } catch { /* needs allow-set-min-size */ }
    await win.setSize(new LogicalSize(w, h));
    const mon = await currentMonitor();
    if (mon) {
      const scale = mon.scaleFactor || 1;
      const monW = mon.size.width / scale;
      await win.setPosition(new LogicalPosition(Math.max(12, monW - w - 24), 56));
    }
    // noActivate: the orb has no text input, so on Windows it takes WS_EX_NOACTIVATE and
    // stops stealing focus from the app being coached. (macOS ignores it — its NSPanel is
    // already non-activating.) The typeable coaching panel deliberately does NOT set this.
    try { await tauriInvoke("set_fullscreen_overlay", { enable: true, width: w, height: h, noActivate: true }); } catch { /* older build */ }
  } catch (e) { console.error("floatWindow", e); }
}

export async function restoreWindow() {
  if (!IS_TAURI) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    try { await tauriInvoke("set_fullscreen_overlay", { enable: false }); } catch { /* older build */ }
    try { await win.setMinSize(new LogicalSize(380, 460)); } catch { /* needs allow-set-min-size */ }
    await win.setSize(new LogicalSize(980, 700));
    await win.center();
  } catch (e) { console.error("restoreWindow", e); }
}

/**
 * Base64 JPEG of the screen. Defaults suit the HTTP coaching routes; the realtime
 * call passes a smaller size because a WebRTC data channel rejects messages over
 * ~256 KB and a full-size frame silently exceeded it.
 */
export async function captureScreen(maxSide?: number, quality?: number): Promise<string> {
  if (!IS_TAURI) return "";
  try { return await tauriInvoke<string>("capture_screen", { maxSide, quality }); } catch { return ""; }
}

type Turn = { role: "user" | "assistant"; content: string };
type Status = "connecting" | "speaking" | "listening" | "thinking";

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Connecting",
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
};

// No session prop: every request mints its own fresh token via lib/api.
export default function VoiceSession({
  tool,
  onEnd,
  fallbackReason = "",
}: {
  tool: string;
  onEnd: () => void;
  fallbackReason?: string;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [caption, setCaption] = useState("");      // last thing Socrates said
  const [reveal, setReveal] = useState(0);          // # of caption words shown (live, synced to speech)
  const [youSaid, setYouSaid] = useState("");       // last thing you said
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");      // e.g. screen-recording not granted
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);   // caption viewport, follows the newest line

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<HTMLAudioElement | null>(null);
  const revealRafRef = useRef<number | null>(null);
  const latestShotRef = useRef<string>("");   // most recent screen capture (kept warm in the background)
  const shotTimerRef = useRef<number | null>(null);
  const turnNumRef = useRef(0);                // counts turns → send a screenshot only every Nth (vision is slow)
  const historyRef = useRef<Turn[]>([]);
  const taughtRef = useRef<string[]>([]);

  const statusRef = useRef<Status>("connecting");
  const mutedRef = useRef(false);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);          // a turn is being processed
  const recordingRef = useRef(false);     // currently capturing an utterance
  const speechFramesRef = useRef(0);
  const lastVoiceTsRef = useRef(0);
  const segStartRef = useRef(0);

  // The reveal stays synced to the spoken audio, but renders as ONE text node.
  // This used to emit a <span class="vo-word"> per word; when that CSS rule was
  // dropped in the redesign the spans lost their spacing and every caption came
  // out as one run-on string of jammed-together words.
  // Word count stays synced to the spoken audio, but the characters within each
  // step glide in rather than the whole word popping — same reading feel as the
  // realtime engine.
  const revealedWords = caption
    ? caption.split(/\s+/).slice(0, Math.max(reveal, 1)).join(" ")
    : "";
  const shownCaption = useSmoothText(revealedWords);

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s); };
  const pushTurn = useCallback((t: Turn) => {
    historyRef.current = [...historyRef.current, t];
    setTranscript([...historyRef.current]);
  }, []);

  // Ask for a token per request — the session prop is captured at login and
  // goes stale after an hour, which 401'd the whole app.
  const authHeaders = useCallback(async () => ({ Authorization: `Bearer ${await freshToken()}` }), []);

  // Speak a reply, then return to listening. Interruptible via stopSpeaking().
  const speak = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean || !aliveRef.current) return;
    const words = clean.split(/\s+/);
    // Show the line (cleared to 0 words) and start a fresh animation for this reply.
    setCaption(clean);
    setReveal(0);
    try {
      const res = await fetch(`${API_URL}/api/coaching/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ text: clean }),
      });
      if (!res.ok) { setError("Couldn't generate speech."); setReveal(words.length); setStatusBoth("listening"); return; }
      const buf = await res.arrayBuffer();
      if (!aliveRef.current) return;
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      ttsRef.current = audio;
      setStatusBoth("speaking");

      // Reveal the caption word-by-word in time with the audio (karaoke style): each
      // newly-shown word slides up + de-blurs in. Paced by real playback position so
      // the words and the voice stay together; falls back to an estimate if duration
      // isn't known yet.
      let lastShown = 0;
      const estDur = Math.max(1.4, words.length * 0.34);
      const stepReveal = () => {
        if (ttsRef.current !== audio || !aliveRef.current) return;
        const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : estDur;
        const target = Math.max(1, Math.round(Math.min(1, audio.currentTime / dur) * words.length));
        if (target !== lastShown) { lastShown = target; setReveal(target); }
        if (!audio.paused && !audio.ended) revealRafRef.current = requestAnimationFrame(stepReveal);
      };
      audio.onplay = () => { lastShown = 1; setReveal(1); revealRafRef.current = requestAnimationFrame(stepReveal); };
      audio.onended = () => {
        if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
        setReveal(words.length); // make sure the whole line lands, even if rAF missed the tail
        URL.revokeObjectURL(url);
        if (ttsRef.current === audio) ttsRef.current = null;
        if (aliveRef.current && statusRef.current === "speaking") setStatusBoth("listening");
      };
      audio.onerror = () => { URL.revokeObjectURL(url); setReveal(words.length); if (aliveRef.current) setStatusBoth("listening"); };
      await audio.play().catch(() => { setReveal(words.length); setStatusBoth("listening"); });
    } catch { setReveal(words.length); setStatusBoth("listening"); }
  }, [authHeaders]);

  const stopSpeaking = useCallback(() => {
    if (revealRafRef.current) { cancelAnimationFrame(revealRafRef.current); revealRafRef.current = null; }
    const a = ttsRef.current;
    if (a) { try { a.pause(); a.currentTime = 0; } catch { /* noop */ } ttsRef.current = null; }
  }, []);

  // Ask the brain for the next spoken step.
  const takeTurn = useCallback(async (phase: "start" | "turn") => {
    if (!aliveRef.current) return;
    busyRef.current = true;
    setStatusBoth("thinking");
    try {
      // A screen coach must SEE the screen — every turn. We tried sending vision only
      // every 3rd turn for latency and it made Socrates feel blind ("what do you see?"
      // landing on a blind turn). The background capture loop keeps a fresh frame warm,
      // so attaching it costs no capture time on the turn itself.
      turnNumRef.current++;
      const screenshot = latestShotRef.current || (IS_TAURI ? await captureScreen() : "");
      const res = await fetch(`${API_URL}/api/coaching/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ messages: historyRef.current.slice(-12), screenshot, tool, taught: taughtRef.current.slice(-6), phase }),
      });
      if (!res.ok) {
        setError(res.status === 503 ? "Voice isn't switched on yet (server needs the OpenAI key)." : `Socrates couldn't respond (HTTP ${res.status}).`);
        setStatusBoth("listening"); busyRef.current = false; return;
      }
      const data = await res.json() as { reply: string; level?: string };
      const reply = (data.reply ?? "").trim();
      if (data.level) setLevel(data.level);
      if (reply) {
        pushTurn({ role: "assistant", content: reply });
        if (taughtRef.current[taughtRef.current.length - 1] !== reply) taughtRef.current = [...taughtRef.current, reply].slice(-8);
        await speak(reply); // sets the caption + animates it in sync with the spoken audio
      } else {
        setStatusBoth("listening");
      }
    } catch (e) {
      setError(`Connection problem: ${e instanceof Error ? e.message : String(e)}`);
      setStatusBoth("listening");
    } finally {
      busyRef.current = false;
    }
  }, [authHeaders, tool, speak, pushTurn]);

  // A finished utterance → transcribe → take a turn.
  const handleUtterance = useCallback(async (blob: Blob) => {
    if (!aliveRef.current || mutedRef.current) return;
    busyRef.current = true;
    setStatusBoth("thinking");
    try {
      const res = await fetch(`${API_URL}/api/coaching/transcribe`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm", ...(await authHeaders()) },
        body: blob,
      });
      const data = res.ok ? (await res.json()) as { text?: string } : { text: "" };
      const text = (data.text ?? "").trim();
      if (!text || text.length < 2) { setStatusBoth("listening"); busyRef.current = false; return; }
      setYouSaid(text);
      setCaption(""); setReveal(0); // flip the orb to your line while Socrates thinks
      pushTurn({ role: "user", content: text });
      busyRef.current = false;
      await takeTurn("turn");
    } catch {
      setStatusBoth("listening"); busyRef.current = false;
    }
  }, [authHeaders, takeTurn, pushTurn]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recordingRef.current || mutedRef.current) return;
    let mime = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mime)) mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    try {
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const dur = performance.now() - segStartRef.current;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        recordingRef.current = false;
        if (dur >= MIN_UTTERANCE_MS && blob.size > 800 && !mutedRef.current) handleUtterance(blob);
        else if (aliveRef.current && statusRef.current !== "speaking") setStatusBoth("listening");
      };
      rec.start();
      recorderRef.current = rec;
      recordingRef.current = true;
      segStartRef.current = performance.now();
    } catch (e) { console.error("startRecording", e); }
  }, [handleUtterance]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") { try { rec.stop(); } catch { /* noop */ } }
  }, []);

  // ── VAD loop ──
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || !aliveRef.current) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    // Require a louder voice to interrupt while Socrates is speaking, so its own
    // audio leaking into the mic doesn't make it cut itself off (self-barge-in).
    const threshold = statusRef.current === "speaking" ? SPEECH_RMS * 2.2 : SPEECH_RMS;
    const loud = rms > threshold;

    if (!mutedRef.current && !busyRef.current) {
      if (loud) {
        speechFramesRef.current += 1;
        lastVoiceTsRef.current = now;
        if (speechFramesRef.current >= ONSET_FRAMES && !recordingRef.current) {
          // Speech onset. Barge in if Socrates is talking.
          if (statusRef.current === "speaking") stopSpeaking();
          setStatusBoth("listening");
          startRecording();
        }
      } else {
        speechFramesRef.current = 0;
        if (recordingRef.current) {
          const speakingFor = now - segStartRef.current;
          const grace = speakingFor > LONG_SPEECH_MS ? SILENCE_MS_LONG : SILENCE_MS_SHORT;
          if (now - lastVoiceTsRef.current > grace) stopRecording();
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [startRecording, stopRecording, stopSpeaking]);

  // ── Lifecycle ──
  useEffect(() => {
    aliveRef.current = true;
    vlog('CLASSIC: mounting (engine=old pipeline — realtime was unavailable) reason=' + (fallbackReason || 'unknown'));
    let cancelled = false;
    (async () => {
      await floatWindow(ORB_W, ORB_H);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        analyserRef.current = analyser;
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        setError(IS_TAURI
          ? "I couldn't reach your microphone. Allow microphone access for Socrates in System Settings ▸ Privacy & Security ▸ Microphone, then restart the app."
          : "I couldn't reach your microphone. Allow mic access and try again.");
        setStatusBoth("listening");
        return;
      }
      // Make sure Socrates can actually see the screen — without Screen Recording
      // permission macOS only hands back the desktop wallpaper, so it'd be "blind".
      if (IS_TAURI) {
        try {
          const ok = await tauriInvoke<boolean>("screen_recording_allowed");
          if (!ok) {
            try { await tauriInvoke("request_screen_recording"); } catch { /* noop */ }
            setWarn("I can't see your screen yet — turn on Screen Recording for Socrates in System Settings ▸ Privacy & Security, then quit and reopen.");
          }
        } catch { /* older build without the check */ }
      }
      // Keep a recent screenshot warm in the background so turns never wait on a capture.
      if (IS_TAURI) {
        const grab = async () => { const s = await captureScreen(); if (s) latestShotRef.current = s; };
        grab();
        shotTimerRef.current = window.setInterval(grab, 2500);
      }

      // Socrates opens the call.
      await takeTurn("start");
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (shotTimerRef.current) clearInterval(shotTimerRef.current);
      stopSpeaking();
      try { recorderRef.current?.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next; setMuted(next);
    if (next) { stopRecording(); }
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    await floatWindow(next ? EXP_W : ORB_W, next ? EXP_H : ORB_H);
  }

  // Type instead of talking (works alongside the live mic).
  async function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t || busyRef.current) return;
    setTyped(""); setYouSaid(t);
    setCaption(""); setReveal(0);
    pushTurn({ role: "user", content: t });
    await takeTurn("turn");
  }

  // Follow the newest caption line as it reveals.
  useEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shownCaption]);

  // Keep the transcript scrolled to the latest line in expanded view.
  useEffect(() => {
    if (expanded && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [transcript, expanded, status]);

  async function end() {
    aliveRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    stopSpeaking();
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    await restoreWindow();
    onEnd();
  }

  const statusHead = (
    <>
      <span className={`vo-dot ${status}`} />
      <span className="vo-status">
        <span className="vo-status-text">{STATUS_LABEL[status]}</span>
        {level && <span className="vo-lvl">{level === "new" ? "intro" : level === "learning" ? "core" : "pro"}</span>}
        {/* This engine only runs when the realtime call couldn't connect. Say so —
            a silent downgrade made a broken call look like a broken product. */}
        <span
          className="vo-lvl vo-lvl-warn"
          title={
            fallbackReason
              ? `Realtime voice unavailable — using the classic engine.\n${fallbackReason}`
              : "Realtime voice unavailable — using the classic engine"
          }
        >
          classic
        </span>
      </span>
      <button className={`vo-btn${muted ? " on" : ""}`} onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
        <Icon name={muted ? "eye" : "coach"} />
      </button>
      <button className="vo-btn" onClick={toggleExpand} title={expanded ? "Shrink to orb" : "Open chat"}>
        <Icon name={expanded ? "pop" : "chat"} />
      </button>
      <button className="vo-btn end" onClick={end} title="End call"><Icon name="stop" /></button>
    </>
  );

  if (expanded) {
    return (
      <div className="voice-exp">
        <div className="ve-head">{statusHead}</div>
        <div className="ve-feed" ref={feedRef}>
          {warn && <div className="vo-warn" style={{ marginBottom: 8 }}>{warn}</div>}
          {transcript.length === 0 && !error && <div className="ve-empty">Your conversation shows up here. Talk to me, or type below.</div>}
          {transcript.map((m, i) => (
            <div key={i} className={`ve-msg ${m.role}`}>{m.content}</div>
          ))}
          {error && <div className="ve-err">{error}</div>}
        </div>
        <form className="ve-input" onSubmit={sendTyped}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead of talking…" />
          <button type="submit" className="send-sm" disabled={!typed.trim()}><Icon name="send" /></button>
        </form>
      </div>
    );
  }

  return (
    <div className="voice-orb">
      <div className="vo-top">{statusHead}</div>
      {error ? (
        <div className="vo-cap"><p className="vo-cap-line vo-cap-err">{error}</p></div>
      ) : shownCaption ? (
        <div className="vo-cap" aria-live="polite" ref={capRef}>
          <p className="vo-cap-line">{shownCaption}</p>
        </div>
      ) : (
        <div className="vo-cap vo-cap-soft">
          <p className="vo-cap-line">
            {status === "connecting" ? "Starting your call…" : youSaid ? `“${youSaid}”` : "Say hi, or ask me anything."}
          </p>
        </div>
      )}
      {warn && <div className="vo-warn">{warn}</div>}
    </div>
  );
}
