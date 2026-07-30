/**
 * RealtimeVoiceSession — the GPT-realtime voice call.
 *
 * One WebRTC session straight to OpenAI's realtime model: mic audio streams
 * up, Socrates' voice streams back, turn-taking and barge-in are handled by
 * the model's own semantic voice detection. Sub-second replies — a real call.
 *
 * Screenshots are pushed INTO the live conversation as images: one when the
 * call opens, one the instant you start speaking (so he sees what you see
 * when he answers), and a periodic refresh while idle.
 *
 * Captions: the model streams its own transcript as it speaks; the orb shows it
 * as scrolling subtitles that follow the newest line.
 *
 * If the realtime session can't be established, onFallback() lets the caller
 * drop back to the classic pipeline (VoiceSession).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Icon from "../Icon";
import PlanetOrb from "./PlanetOrb";
import { floatWindow, restoreWindow, captureScreen, ORB_W, ORB_H, EXP_W, EXP_H } from "./VoiceSession";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const API_URL = import.meta.env.VITE_API_URL as string;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type Turn = { role: "user" | "assistant"; content: string };
type Status = "connecting" | "speaking" | "listening" | "thinking";

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Connecting…",
  speaking: "Socrates is speaking",
  listening: "Listening…",
  thinking: "Thinking…",
};

const IDLE_SHOT_MS = 10000; // periodic screen refresh while nobody is talking

export default function RealtimeVoiceSession({
  session,
  tool,
  onEnd,
  onFallback,
}: {
  session: Session;
  tool: string;
  onEnd: () => void;
  onFallback: () => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [caption, setCaption] = useState("");        // live caption text, streamed
  const [youSaid, setYouSaid] = useState("");
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const planetRef = useRef<HTMLDivElement | null>(null);   // orb element — amplitude is written here
  const capRef = useRef<HTMLDivElement | null>(null);      // caption viewport, kept scrolled to the newest line
  const vizCtxRef = useRef<AudioContext | null>(null);
  const vizRafRef = useRef<number | null>(null);
  const latestShotRef = useRef<string>("");
  const shotTimerRef = useRef<number | null>(null);
  const idleShotRef = useRef<number>(0);
  const aliveRef = useRef(true);
  const statusRef = useRef<Status>("connecting");
  const assistantTextRef = useRef(""); // accumulates the current reply's transcript

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s); };
  const pushTurn = useCallback((t: Turn) => {
    setTranscript((prev) => [...prev, t]);
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try { dc.send(JSON.stringify(event)); } catch { /* channel closing */ }
    }
  }, []);

  /** Push the freshest screenshot into the conversation so the model sees "now". */
  const sendScreen = useCallback(() => {
    const shot = latestShotRef.current;
    if (!shot) return;
    idleShotRef.current = Date.now();
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${shot}` }],
      },
    });
  }, [send]);

  // ── Lifecycle: float the orb, connect the call ──
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    (async () => {
      await floatWindow(ORB_W, ORB_H);

      // 1. Ephemeral key from our server (bumps session count, builds tutor instructions)
      let secret = "";
      try {
        const res = await fetch(`${API_URL}/api/coaching/realtime-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ tool }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { client_secret: string; level?: string };
        secret = data.client_secret;
        if (data.level) setLevel(data.level);
      } catch (e) {
        console.error("realtime-session mint failed, falling back", e);
        if (!cancelled) onFallback();
        return;
      }

      // 2. Mic + WebRTC peer connection
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) { mic.getTracks().forEach((t) => t.stop()); return; }
        micRef.current = mic;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.addTrack(mic.getTracks()[0]);

        // Socrates' voice comes back as a remote track
        pc.ontrack = (e) => {
          const el = new Audio();
          el.srcObject = e.streams[0];
          el.autoplay = true;
          audioElRef.current = el;

          // Tap the voice to drive the planet. We write amplitude to a CSS
          // variable on the orb element rather than React state — this runs every
          // frame and would otherwise re-render the panel 60x a second.
          try {
            const ctx = new AudioContext();
            vizCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(e.streams[0]);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            const buf = new Uint8Array(analyser.fftSize);
            let smoothed = 0;
            const tick = () => {
              if (!aliveRef.current) return;
              analyser.getByteTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
              const rms = Math.sqrt(sum / buf.length);
              // normalize speech-ish range and ease it so the planet glides
              const target = Math.min(1, rms * 7);
              smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12);
              planetRef.current?.style.setProperty("--amp", smoothed.toFixed(3));
              vizRafRef.current = requestAnimationFrame(tick);
            };
            vizRafRef.current = requestAnimationFrame(tick);
          } catch { /* visual flourish only — baseline CSS animation still runs */ }
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          if (!aliveRef.current) return;
          // Semantic turn detection (model decides when you're done talking — this is
          // what killed our hand-tuned VAD) + user speech transcription for the chat view.
          send({
            type: "session.update",
            session: {
              type: "realtime",
              audio: {
                input: {
                  turn_detection: { type: "semantic_vad" },
                  transcription: { model: "gpt-4o-mini-transcribe" },
                },
              },
            },
          });
          // Open the call: current screen + a nudge so Socrates greets first.
          sendScreen();
          send({ type: "response.create" });
        };

        dc.onmessage = (msg) => {
          if (!aliveRef.current) return;
          let ev: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
          try { ev = JSON.parse(msg.data); } catch { return; }

          switch (ev.type) {
            case "input_audio_buffer.speech_started":
              // You started talking: he sees the screen you're talking about.
              setStatusBoth("listening");
              sendScreen();
              break;
            case "response.created":
              setStatusBoth("thinking");
              assistantTextRef.current = "";
              setCaption("");
              break;
            // Both event names appear depending on output modality — accept either.
            case "response.output_text.delta":
            case "response.output_audio_transcript.delta":
              if (ev.delta) {
                setStatusBoth("speaking");
                assistantTextRef.current += ev.delta;
                setCaption(assistantTextRef.current);
              }
              break;
            case "response.output_audio_transcript.done":
            case "response.done": {
              const text = assistantTextRef.current.trim();
              if (ev.type === "response.done") {
                if (text) pushTurn({ role: "assistant", content: text });
                assistantTextRef.current = "";
                if (statusRef.current !== "listening") setStatusBoth("listening");
              }
              break;
            }
            case "conversation.item.input_audio_transcription.completed":
              if (ev.transcript?.trim()) {
                setYouSaid(ev.transcript.trim());
                pushTurn({ role: "user", content: ev.transcript.trim() });
              }
              break;
            case "error":
              console.error("realtime error", ev);
              if (ev.error?.message && !/transcription|truncat/i.test(ev.error.message)) {
                setError(ev.error.message);
              }
              break;
          }
        };

        // 3. SDP handshake with the ephemeral key
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/sdp" },
        });
        if (!sdpRes.ok) throw new Error(`SDP ${sdpRes.status}`);
        await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

        setStatusBoth("listening");
      } catch (e) {
        console.error("webrtc setup failed, falling back", e);
        if (!cancelled) onFallback();
        return;
      }

      // 4. Screen capture loop (warm frame + idle refresh into the conversation)
      if (IS_TAURI) {
        try {
          const ok = await tauriInvoke<boolean>("screen_recording_allowed");
          if (!ok) {
            try { await tauriInvoke("request_screen_recording"); } catch { /* noop */ }
            setWarn("I can't see your screen yet — turn on Screen Recording for Socrates in System Settings, then quit and reopen.");
          }
        } catch { /* older build */ }
        const grab = async () => {
          const s = await captureScreen();
          if (s) {
            latestShotRef.current = s;
            if (Date.now() - idleShotRef.current > IDLE_SHOT_MS) sendScreen();
          }
        };
        void grab();
        shotTimerRef.current = window.setInterval(grab, 2500);
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (shotTimerRef.current) clearInterval(shotTimerRef.current);
      try { dcRef.current?.close(); } catch { /* noop */ }
      try { pcRef.current?.close(); } catch { /* noop */ }
      micRef.current?.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) audioElRef.current.srcObject = null;
      if (vizRafRef.current) cancelAnimationFrame(vizRafRef.current);
      vizCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    const track = micRef.current?.getTracks()[0];
    if (track) track.enabled = !next;
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    await floatWindow(next ? EXP_W : ORB_W, next ? EXP_H : ORB_H);
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    setYouSaid(t);
    pushTurn({ role: "user", content: t });
    sendScreen();
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
    });
    send({ type: "response.create" });
  }

  useEffect(() => {
    if (expanded && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [transcript, expanded, status]);

  // Follow the newest caption line as it streams in.
  useEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [caption]);

  async function end() {
    aliveRef.current = false;
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    try { dcRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    await restoreWindow();
    onEnd();
  }

  const statusHead = (
    <>
      <PlanetOrb status={status} size={40} innerRef={planetRef} />
      <span className="vo-status">
        {STATUS_LABEL[status]}
        {level && <span className="vo-lvl">{level === "new" ? "intro" : level === "learning" ? "core" : "pro"}</span>}
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
      ) : caption ? (
        // Captions scroll like real subtitles: text stays put, the view follows the
        // newest line, and the top edge fades out. No per-word animation — with a
        // streaming transcript that only made the layout jitter.
        <div className="vo-cap" aria-live="polite" ref={capRef}>
          <p className="vo-cap-line">{caption}</p>
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
