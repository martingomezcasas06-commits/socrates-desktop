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
import Icon from "../Icon";
import PlanetOrb from "./PlanetOrb";
import { vlog } from "../lib/vlog";
import { apiFetch } from "../lib/api";
import { useSmoothText } from "../lib/useSmoothText";
import { floatWindow, restoreWindow, captureScreen, ORB_W, ORB_H, EXP_W, EXP_H } from "./VoiceSession";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const API_URL = import.meta.env.VITE_API_URL as string;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type Turn = { role: "user" | "assistant"; content: string; itemId?: string };
type Status = "connecting" | "speaking" | "listening" | "thinking";

const IDLE_SHOT_MS = 10000; // periodic screen refresh while nobody is talking
const PERM_RECHECK_MS = 3000; // poll for Screen Recording being switched on mid-call

// Loudness (RMS, 0–1) the mic must reach for a turn to count as real speech.
// Room tone sits around 0.002–0.01; talking clears 0.05 comfortably. Anything
// under this is silence, and a transcript claimed for it is a hallucination.
const SPEECH_RMS_MIN = 0.02;

// Biggest base64 screenshot we'll put on the data channel. The SCTP limit is
// ~256 KB per message and the JSON wrapper adds a little, so stay well under it.
const MAX_SHOT_B64 = 180_000;


// No session prop: every request mints its own fresh token via lib/api.
export default function RealtimeVoiceSession({
  tool,
  onEnd,
  onFallback,
}: {
  tool: string;
  onEnd: () => void;
  onFallback: (reason: string) => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [caption, setCaption] = useState("");        // live caption text, streamed
  // Rendered instead of `caption`: glides in character by character so the
  // words read as written rather than popping in a lump per delta.
  // Opened when Socrates is actually audible; see the analyser and the failsafe
  // timer on response.created. Starts true so the very first frame is never stuck.
  const audibleRef = useRef(true);
  const audibleTimerRef = useRef<number | null>(null);
  const shownCaption = useSmoothText(caption, { gateRef: audibleRef });
  const [youSaid, setYouSaid] = useState("");
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  // The panel's meta line shows elapsed time and whether Socrates can actually
  // see the screen. screenOk mirrors screenOkRef because a ref cannot re-render.
  const [elapsed, setElapsed] = useState(0);
  const [screenOk, setScreenOk] = useState(false);
  const [muted, setMuted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // True between response.created and response.done — i.e. while Socrates is
  // actually speaking. Drives the live, still-being-written bubble in the chat.
  const [streaming, setStreaming] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);      // caption viewport, kept scrolled to the newest line
  const vizCtxRef = useRef<AudioContext | null>(null);
  const vizRafRef = useRef<number | null>(null);
  const latestShotRef = useRef<string>("");
  const shotTimerRef = useRef<number | null>(null);
  const permTimerRef = useRef<number | null>(null);
  const idleShotRef = useRef<number>(0);
  const aliveRef = useRef(true);
  const statusRef = useRef<Status>("connecting");
  const assistantTextRef = useRef(""); // accumulates the current reply's transcript
  const activeRespRef = useRef<string | null>(null); // id of the reply we're currently showing
  const droppedRespRef = useRef<Set<string>>(new Set()); // superseded replies we've already logged
  const userPartialRef = useRef<Map<string, string>>(new Map()); // your speech, per item, while it transcribes

  // Mic loudness, used to throw away hallucinated transcripts (see micPeak below).
  const micCtxRef = useRef<AudioContext | null>(null);
  const micTimerRef = useRef<number | null>(null);
  const micWatchdogRef = useRef<number | null>(null);
  // Mirrors the `muted` state for code that runs outside React's render cycle
  // (the watchdog), so recovering the mic can't silently un-mute you.
  const mutedRef = useRef(false);
  const micGateOkRef = useRef(false);                           // false ⇒ never drop, we can't measure
  const micPeakRef = useRef(0);                                 // loudest moment of the turn being spoken
  const lastTurnPeakRef = useRef(0);                            // that peak, frozen when the turn ended
  const itemPeakRef = useRef<Map<string, number>>(new Map());   // …then keyed by conversation item
  // Only ONE response may exist at a time. Sending a second is a protocol error,
  // so creates are gated and deferred rather than fired blind.
  const respBusyRef = useRef(false);
  const pendingCreateRef = useRef(false);
  const pendingInstrRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const errTimerRef = useRef<number | null>(null);
  const screenOkRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s); };
  const pushTurn = useCallback((t: Turn) => {
    setTranscript((prev) => [...prev, t]);
  }, []);

  /** Insert-or-update your own turn, keyed by the conversation item it belongs to. */
  const upsertUserTurn = useCallback((itemId: string, content: string) => {
    setTranscript((prev) => {
      const i = prev.findIndex((t) => t.itemId === itemId);
      if (i === -1) return [...prev, { role: "user", content, itemId }];
      if (prev[i].content === content) return prev;
      const next = [...prev];
      next[i] = { ...next[i], content };
      return next;
    });
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    const payload = JSON.stringify(event);
    try {
      dc.send(payload);
    } catch (e) {
      // NEVER swallow this again. A silent throw here is how screenshots went
      // missing for weeks: an oversized frame exceeded the channel's message
      // limit, send() threw, and the app carried on as if the model could see.
      vlog('REALTIME: dc.send FAILED for ' + String(event.type) +
        ' (' + payload.length + ' bytes, limit ' +
        ((dc as RTCDataChannel & { maxMessageSize?: number }).maxMessageSize ?? '?') + '): ' + String(e));
    }
  }, []);

  /** Push the freshest screenshot into the conversation so the model sees "now". */
  const sendScreen = useCallback(() => {
    const shot = latestShotRef.current;
    if (!shot) return;
    idleShotRef.current = Date.now();
    vlog('REALTIME: sending screenshot (' + Math.round(shot.length / 1024) + ' KB base64)');
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${shot}` }],
      },
    });
  }, [send]);

  /**
   * Ask for a reply, but never while one is running.
   *
   * With semantic VAD the *server* creates a response the moment it decides you
   * stopped talking, so a manual create can collide with one we never asked for
   * ("Conversation already has an active response in progress"). The loser is
   * dropped, which is how a greeting or a typed message could vanish. Deferring
   * instead of firing blind means the request survives.
   */
  const requestResponse = useCallback((instructions?: string) => {
    const create = () => send(
      instructions
        ? { type: "response.create", response: { instructions } }
        : { type: "response.create" },
    );
    if (respBusyRef.current) {
      pendingCreateRef.current = true;
      pendingInstrRef.current = instructions ?? null;
      // Safety net. The queue is drained by `response.done`, so if that never
      // arrives — a cancel that emits nothing, a dropped event, a reply the
      // server abandoned — a typed question would sit here forever and look
      // like the app simply ignored it. That was the actual "typing does
      // nothing" bug: the create was refused and nobody ever retried it.
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = window.setTimeout(() => {
        if (!pendingCreateRef.current) return;
        pendingCreateRef.current = false;
        vlog('REALTIME: queued response.create timed out — forcing it');
        respBusyRef.current = true;
        create();
      }, 2500);
      return;
    }
    respBusyRef.current = true;
    create();
  }, [send]);

  /**
   * Was this turn too quiet to be real speech? If we never got the analyser
   * running we can't tell, so nothing is dropped and behaviour is as before.
   */
  const isSilentItem = useCallback((itemId: string, known?: number) => {
    if (!micGateOkRef.current) return false;
    const peak = known ?? itemPeakRef.current.get(itemId);
    return peak !== undefined && peak < SPEECH_RMS_MIN;
  }, []);

  /** Surface an error, but don't let it sit over the captions for the whole call. */
  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errTimerRef.current) clearTimeout(errTimerRef.current);
    errTimerRef.current = window.setTimeout(() => setError(""), 6000);
  }, []);

  // ── Lifecycle: float the orb, connect the call ──
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    (async () => {
      vlog('REALTIME: mounting (engine=realtime)');
      await floatWindow(ORB_W, ORB_H);

      // 1. Ephemeral key from our server (bumps session count, builds tutor instructions)
      let secret = "";
      let modelName = "gpt-realtime-2.1";
      // The first spoken turn, written by the server: it knows the person's name
      // and the goal from their interview. The fallback names no one.
      let opening =
        "Open the call: greet the person warmly in ONE short spoken sentence, " +
        "then ask one simple question about what they'd like to work on. " +
        "Do not teach or give advice yet — just say hello and hand the turn back.";
      try {
        const res = await apiFetch(`${API_URL}/api/coaching/realtime-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { client_secret: string; level?: string; model?: string; opening?: string };
        secret = data.client_secret;
        modelName = data.model ?? modelName;
        if (data.opening) opening = data.opening;
        vlog('REALTIME: mint ok, model=' + data.model);
      } catch (e) {
        vlog('REALTIME: mint FAILED → falling back to classic. ' + String(e));
        if (!cancelled) onFallback('key: ' + String(e));
        return;
      }

      // 2. Mic + WebRTC peer connection
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            // AGC winds the gain up during quiet stretches until room tone looks
            // like speech — which is exactly what the VAD and the transcriber
            // then hallucinate words out of. Keep the true noise floor.
            autoGainControl: false,
          },
        });
        if (cancelled) { mic.getTracks().forEach((t) => t.stop()); return; }
        micRef.current = mic;

        // THE MIC IS SENT RAW. Nothing here may ever attenuate it.
        //
        // There WAS a noise gate: the mic was piped through a GainNode into a
        // MediaStreamDestination and muted between phrases. It went wrong twice —
        // an AudioContext starts suspended, so that destination could emit pure
        // silence for an entire call, and no fixed loudness threshold could ever
        // separate Martin's voice from his room (measured: speech 0.058 vs
        // chatter 0.06, overlapping). It was also never what fixed the truncated
        // replies — `interrupt_response:false` did that, server-side.
        //
        // So the gate is gone. Web Audio is now ONLY a measurement tap feeding the
        // hallucinated-transcript filter; it cannot make the microphone quieter.
        const outTrack = mic.getTracks()[0];
        outTrack.enabled = true;
        // `muted` here is NOT our mute button — it is the browser telling us the
        // OS stopped delivering audio from the device (sleep, an audio-route
        // change, WKWebView suspending capture in a backgrounded panel). When that
        // happens the call looks alive but Socrates simply stops hearing you.
        outTrack.onmute = () => vlog('REALTIME: mic track went MUTED (source stopped delivering audio)');
        outTrack.onunmute = () => vlog('REALTIME: mic track unmuted');
        outTrack.onended = () => vlog('REALTIME: mic track ENDED');
        try {
          const mctx = new AudioContext();
          micCtxRef.current = mctx;
          void mctx.resume().catch(() => {});
          const msrc = mctx.createMediaStreamSource(mic);
          const manalyser = mctx.createAnalyser();
          manalyser.fftSize = 512;
          msrc.connect(manalyser);

          const mbuf = new Uint8Array(manalyser.fftSize);
          let sawSignal = false;
          const startedAt = Date.now();
          const mtick = () => {
            if (!aliveRef.current) return;
            manalyser.getByteTimeDomainData(mbuf);
            let sum = 0;
            for (let i = 0; i < mbuf.length; i++) { const v = (mbuf[i] - 128) / 128; sum += v * v; }
            const rms = Math.sqrt(sum / mbuf.length);
            if (rms > micPeakRef.current) micPeakRef.current = rms;

            // If the analyser only ever reports digital silence it is broken (a
            // suspended context, a tap that never connected). Stand the filter
            // down rather than let it judge every transcript as "too quiet to be
            // real" and delete the entire conversation.
            if (rms > 0.0005) sawSignal = true;
            if (!sawSignal && Date.now() - startedAt > 4000) {
              vlog('REALTIME: analyser reads pure silence — hallucination filter disabled');
              micGateOkRef.current = false;
              if (micTimerRef.current) { clearInterval(micTimerRef.current); micTimerRef.current = null; }
            }
          };
          // A TIMER, not rAF. rAF stops in an occluded/hidden window, and a frozen
          // gate keeps its last gain — if that was 0, the mic goes silent for the
          // rest of the call and Socrates simply stops hearing you. A timer keeps
          // running, and the stall check below fails the gate OPEN rather than shut.
          micTimerRef.current = window.setInterval(mtick, 33);
          micGateOkRef.current = true;
        } catch (e) {
          // Any failure here must leave a WORKING call, not a dead mic.
          micGateOkRef.current = false;
          outTrack.enabled = true;
          vlog('REALTIME: mic gate unavailable, mic left fully open. ' + String(e));
        }

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        const micSender = pc.addTrack(outTrack);

        // SELF-HEALING MIC. A dead microphone is indistinguishable from a working
        // one until you notice nobody is answering — Martin's calls "went on mute
        // after a while". So watch the track, and if the source stops delivering,
        // get a new one and swap it into the live connection rather than letting
        // the rest of the call carry on deaf.
        micWatchdogRef.current = window.setInterval(async () => {
          if (!aliveRef.current) return;
          const t = micRef.current?.getTracks()[0];
          const broken = !t || t.readyState === "ended" || t.muted;
          if (!broken) return;
          vlog('REALTIME: mic looks dead (readyState=' + (t?.readyState ?? 'gone') +
            ', muted=' + (t?.muted ?? '?') + ') — reacquiring');
          try {
            const fresh = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
            });
            const nt = fresh.getTracks()[0];
            nt.enabled = !mutedRef.current;   // respect the user's own mute button
            await micSender.replaceTrack(nt);
            micRef.current?.getTracks().forEach((old) => old.stop());
            micRef.current = fresh;
            nt.onmute = () => vlog('REALTIME: mic track went MUTED (source stopped delivering audio)');
            nt.onended = () => vlog('REALTIME: mic track ENDED');
            vlog('REALTIME: mic recovered');
          } catch (e) {
            vlog('REALTIME: mic reacquire FAILED: ' + String(e));
          }
        }, 3000);

        // Socrates' voice comes back as a remote track
        pc.ontrack = (e) => {
          const el = new Audio();
          el.srcObject = e.streams[0];
          el.autoplay = true;
          audioElRef.current = el;

          // Tap the voice so we know the moment Socrates actually becomes
          // audible — that is what releases the caption below. Kept off React
          // state deliberately: this runs every frame and would otherwise
          // re-render the panel 60x a second.
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
              // normalize speech-ish range, then ease so one loud frame can't
              // trip the gate on its own
              const target = Math.min(1, rms * 7);
              smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12);
              // First real sound of this reply: release the caption. Until now it
              // has been held at zero so it can't run ahead of the voice.
              if (!audibleRef.current && smoothed > 0.04) audibleRef.current = true;
              vizRafRef.current = requestAnimationFrame(tick);
            };
            vizRafRef.current = requestAnimationFrame(tick);
          } catch { /* the caption falls back to releasing immediately */ }
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          if (!aliveRef.current) return;
          vlog('REALTIME: data channel OPEN — realtime engine is live');
          // Semantic turn detection (model decides when you're done talking — this is
          // what killed our hand-tuned VAD) + user speech transcription for the chat view.
          send({
            type: "session.update",
            session: {
              type: "realtime",
              // Audio ONLY. If the model also emits a text modality, we get two
              // parallel streams (spoken-transcript + written answer) that are
              // worded differently — interleaving them made captions read like
              // nonsense that didn't match the voice.
              output_modalities: ["audio"],
              audio: {
                input: {
                  // "low" eagerness: wait for a real pause before calling the turn
                  // over. On the default the model committed turns on room noise,
                  // which both cut Socrates off mid-sentence and handed the
                  // transcriber silence to invent words from.
                  //
                  // interrupt_response:false is the one that makes the transcript
                  // readable. Detected speech still starts a new turn, but it no
                  // longer CANCELS the reply in progress — so a cough, a door, or
                  // someone else talking can't truncate a sentence any more. That
                  // was the cause of the `reply done, 0 chars` entries and every
                  // half-finished caption. Verified accepted and echoed back by
                  // the live API before shipping. Deliberate consequence: barging
                  // in by voice no longer stops him mid-sentence; typing does
                  // (sendTyped cancels explicitly).
                  turn_detection: {
                    type: "semantic_vad",
                    eagerness: "low",
                    interrupt_response: false,
                    create_response: true,
                  },
                  transcription: { model: "gpt-4o-mini-transcribe" },
                },
              },
            },
          });
          // Open the call with an actual greeting. Left to its own instructions the
          // tutor dives straight into a lesson with no hello. A per-response
          // `instructions` override fixes that; it REPLACES the session
          // instructions for this one turn, so the server writes it with the
          // person's name and the goal from their interview.
          sendScreen();
          requestResponse(opening);
        };

        dc.onmessage = (msg) => {
          if (!aliveRef.current) return;
          let ev: {
            type?: string; delta?: string; transcript?: string;
            response_id?: string; item_id?: string;
            response?: { id?: string };
            item?: { id?: string; role?: string; type?: string; content?: { type?: string }[] };
            error?: { message?: string };
          };
          try { ev = JSON.parse(msg.data); } catch { return; }

          switch (ev.type) {
            case "input_audio_buffer.speech_started":
              // Someone started talking — NOT necessarily you, and not necessarily
              // an interruption. This used to drop the in-flight reply on the spot,
              // which in a room with other voices truncated nearly every sentence
              // and reduced the greeting to nothing. We now wait for the server to
              // actually cancel (it emits response.done), and only then stop
              // accepting that reply's words. Stragglers are still filtered, by
              // response id, in the delta case below.
              micPeakRef.current = 0;   // start measuring this turn's loudness
              sendScreen();
              break;
            case "input_audio_buffer.speech_stopped":
              // Freeze the peak now; the item it belongs to is announced next.
              lastTurnPeakRef.current = micPeakRef.current;
              break;
            case "response.created":
              activeRespRef.current = ev.response?.id ?? null;
              respBusyRef.current = true;
              setStreaming(true);
              // Hold the caption until this reply is audible, but NEVER longer
              // than 2s — a silent reply or a stalled analyser must not leave the
              // transcript frozen. Failing open costs a little lead; failing shut
              // costs the whole feature.
              audibleRef.current = false;
              if (audibleTimerRef.current) clearTimeout(audibleTimerRef.current);
              audibleTimerRef.current = window.setTimeout(() => { audibleRef.current = true; }, 2000);
              setStatusBoth("thinking");
              assistantTextRef.current = "";
              setCaption("");
              break;
            // The transcript of what he ACTUALLY SPEAKS — the only stream we show.
            case "response.output_audio_transcript.delta":
              // Ignore deltas from a superseded reply (a cancelled response keeps
              // leaking words for a moment after the server drops it).
              if (ev.delta && (!ev.response_id || ev.response_id === activeRespRef.current)) {
                setStatusBoth("speaking");
                assistantTextRef.current += ev.delta;
                setCaption(assistantTextRef.current);
              } else if (ev.delta && ev.response_id && !droppedRespRef.current.has(ev.response_id)) {
                // Once per response, so a truncated caption is explainable from the log.
                droppedRespRef.current.add(ev.response_id);
                vlog('REALTIME: ignoring deltas from superseded response ' + ev.response_id +
                  ' (active=' + (activeRespRef.current ?? 'none') + ')');
              }
              break;
            case "response.done": {
              const text = assistantTextRef.current.trim();
              vlog('REALTIME: reply done, ' + text.length + ' chars: "' + text.slice(0, 120) + '"');
              if (text) pushTurn({ role: "assistant", content: text });
              assistantTextRef.current = "";
              activeRespRef.current = null;
              respBusyRef.current = false;
              setStreaming(false);
              if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
              if (pendingCreateRef.current) {
                pendingCreateRef.current = false;
                const instr = pendingInstrRef.current;
                pendingInstrRef.current = null;
                requestResponse(instr ?? undefined);
              }
              if (statusRef.current !== "listening") setStatusBoth("listening");
              break;
            }
            // Your speech becomes a chat bubble the moment the turn is captured, then
            // fills in as it transcribes. Verified against the live API: the
            // transcription can land AFTER his reply, so appending on completion put
            // your question BELOW his answer. Reserving the slot early fixes the order.
            case "conversation.item.added":
              if (
                ev.item?.role === "user" &&
                ev.item?.content?.some((c) => c?.type === "input_audio") &&
                ev.item.id
              ) {
                const peak = lastTurnPeakRef.current;
                itemPeakRef.current.set(ev.item.id, peak);
                // Silence never gets a bubble — see the transcription case below.
                if (peak >= SPEECH_RMS_MIN) upsertUserTurn(ev.item.id, "");
              }
              break;
            // gpt-4o-mini-transcribe invents fluent sentences — often in languages
            // nobody in the room speaks — when handed near-silence. We can't stop it
            // guessing, but we know how loud you actually were, so we can refuse the
            // guess. Anything quieter than a whisper is dropped outright.
            case "conversation.item.input_audio_transcription.delta":
              if (ev.item_id && ev.delta && !isSilentItem(ev.item_id)) {
                const soFar = (userPartialRef.current.get(ev.item_id) ?? "") + ev.delta;
                userPartialRef.current.set(ev.item_id, soFar);
                setYouSaid(soFar);
                upsertUserTurn(ev.item_id, soFar);
              }
              break;
            case "conversation.item.input_audio_transcription.completed":
              if (ev.item_id) {
                const finalText = (ev.transcript ?? userPartialRef.current.get(ev.item_id) ?? "").trim();
                userPartialRef.current.delete(ev.item_id);
                const peak = itemPeakRef.current.get(ev.item_id) ?? 1;
                itemPeakRef.current.delete(ev.item_id);
                if (finalText && isSilentItem(ev.item_id, peak)) {
                  vlog('REALTIME: dropped hallucinated transcript (peak ' +
                    peak.toFixed(4) + ' < ' + SPEECH_RMS_MIN + '): "' + finalText.slice(0, 60) + '"');
                } else if (finalText) {
                  vlog('REALTIME: you said (peak ' + peak.toFixed(3) + '): "' + finalText.slice(0, 120) + '"');
                  setYouSaid(finalText);
                  upsertUserTurn(ev.item_id, finalText);
                }
              }
              break;
            case "error": {
              console.error("realtime error", ev);
              const m = ev.error?.message ?? "";
              // A rejected response.create means the server already had one running,
              // so our optimistic "busy" flag is right — but nothing will ever clear
              // it unless we do, and then no manual create would fire again.
              if (/active response/i.test(m)) {
                // Our create was REFUSED. Whatever asked for it (a typed question,
                // the opening greeting) gets nothing unless we retry once the
                // current reply finishes. Not retrying was the silent-typing bug.
                if (!activeRespRef.current) respBusyRef.current = false;
                requestResponse();
              }
              vlog('REALTIME: server error: ' + m);
              // Protocol races and transcriber noise are ours to handle, not
              // Martin's to read over his captions.
              if (m && !/transcription|truncat|active response/i.test(m)) showError(m);
              break;
            }
          }
        };

        // 3. SDP handshake with the ephemeral key
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // The SDP handshake CANNOT go directly from the webview: posting to
        // api.openai.com from origin tauri://localhost is cross-origin and
        // WKWebView drops it with only "TypeError: Load failed" — which is what
        // sent every call to the fallback engine. Do it natively in Rust (no CORS
        // at all); in a plain browser, go through our server instead.
        let answerSdp: string;
        if (IS_TAURI) {
          answerSdp = await tauriInvoke<string>("realtime_sdp", {
            secret, model: modelName, offer: offer.sdp ?? "",
          });
          vlog('REALTIME: sdp exchange ok (native), ' + answerSdp.length + ' chars');
        } else {
          const r = await apiFetch(`${API_URL}/api/coaching/realtime-sdp?model=${encodeURIComponent(modelName)}`, {
            method: "POST",
            body: offer.sdp,
            headers: {
              "X-Realtime-Secret": secret,
              "Content-Type": "application/sdp",
            },
          });
          if (!r.ok) throw new Error(`SDP ${r.status}`);
          answerSdp = await r.text();
          vlog('REALTIME: sdp exchange ok (proxy), ' + answerSdp.length + ' chars');
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });


        setStatusBoth("listening");
      } catch (e) {
        vlog('REALTIME: webrtc setup FAILED → falling back to classic. ' + String(e));
        if (!cancelled) onFallback('connect: ' + String(e));
        return;
      }

      // 4. Screen capture loop (warm frame + idle refresh into the conversation)
      if (IS_TAURI) {
        const grab = async () => {
          // Without permission macOS still hands us a picture — the desktop
          // wallpaper with every window stripped out. Sending that is worse than
          // sending nothing: Socrates confidently described Martin's wallpaper
          // back to him instead of saying he couldn't see. Capture only when the
          // frame can actually contain his screen.
          if (!screenOkRef.current) return;
          // Small on purpose: this frame travels over the data channel, which
          // hard-rejects any single message over ~256 KB. A busy screen can still
          // surprise us, so measure and shrink again rather than trust one guess —
          // an oversized frame doesn't degrade, it vanishes.
          let s = await captureScreen(900, 50);
          if (s && s.length > MAX_SHOT_B64) {
            const first = s.length;
            s = await captureScreen(640, 35);
            vlog('REALTIME: screenshot too big (' + Math.round(first / 1024) +
              ' KB) — recaptured at ' + Math.round(s.length / 1024) + ' KB');
          }
          if (s && s.length > MAX_SHOT_B64) {
            vlog('REALTIME: screenshot STILL too big (' + Math.round(s.length / 1024) + ' KB) — skipping');
            return;
          }
          if (s) {
            latestShotRef.current = s;
            if (Date.now() - idleShotRef.current > IDLE_SHOT_MS) sendScreen();
          }
        };

        /** Tell Socrates, in the conversation itself, whether he has eyes. */
        const announceScreen = (ok: boolean) => {
          send({
            type: "conversation.item.create",
            item: {
              type: "message", role: "user",
              content: [{
                type: "input_text",
                text: ok
                  ? "[system] Screen sharing is now ON. Images that follow are the user's live screen."
                  : "[system] Screen sharing is OFF — you cannot see the user's screen at all. If asked, say so plainly and ask them to enable Screen Recording for Socrates in System Settings. Never describe or guess at what is on their screen.",
              }],
            },
          });
        };

        const checkPerm = async (first: boolean) => {
          let ok = false;
          try { ok = await tauriInvoke<boolean>("screen_recording_allowed"); }
          catch { ok = true; /* older build without the command: behave as before */ }
          if (ok === screenOkRef.current && !first) return;
          screenOkRef.current = ok;
          setScreenOk(ok);
          vlog('REALTIME: screen recording permission = ' + ok);
          if (ok) {
            setWarn("");
            if (!first) announceScreen(true);
            void grab();
          } else {
            if (first) {
              vlog('REALTIME: no screen permission — requesting, then attempting a capture to force the prompt');
              try { await tauriInvoke("request_screen_recording"); } catch (e) { vlog('REALTIME: request_screen_recording threw: ' + String(e)); }
              // AND actually attempt a capture. macOS raises the permission dialog
              // when an app TRIES to record — CGRequestScreenCaptureAccess alone
              // does not reliably prompt from a background thread. The previous
              // build skipped capturing whenever permission was false, so nothing
              // ever attempted, nothing ever prompted, and the app sat at
              // "permission = false" forever. The frame is thrown away; this call
              // exists purely to make macOS ask.
              // A non-empty result here while permission is false means macOS
              // silently handed back the wallpaper (denied, no error). An empty
              // result means the capture itself failed. Both are worth knowing —
              // they point at completely different problems.
              try {
                const probe = await captureScreen(640, 35);
                vlog('REALTIME: capture probe returned ' + (probe ? Math.round(probe.length / 1024) + ' KB' : 'NOTHING'));
                // Write the frame to disk so it can be OPENED and looked at. A
                // denied capture returns the wallpaper with no error, so bytes
                // alone can't tell success from failure — only the picture can.
                const saved = await tauriInvoke<string>("save_capture_probe");
                vlog('REALTIME: capture probe saved to ' + saved);
              } catch (e) { vlog('REALTIME: capture probe threw: ' + String(e)); }
              try {
                const after = await tauriInvoke<boolean>("screen_recording_allowed");
                vlog('REALTIME: permission re-check after prompt = ' + after);
                if (after) {
                  screenOkRef.current = true;
                  setScreenOk(true);
                  vlog('REALTIME: screen recording granted after prompt');
                  setWarn(""); announceScreen(true); void grab();
                  return;
                }
              } catch { /* older build */ }
            }
            setWarn("I can't see your screen — turn on Screen Recording for Socrates in System Settings ▸ Privacy & Security, then reopen the app.");
            announceScreen(false);
          }
        };

        await checkPerm(true);
        // Granting the permission mid-call should just start working.
        permTimerRef.current = window.setInterval(() => void checkPerm(false), PERM_RECHECK_MS);
        shotTimerRef.current = window.setInterval(grab, 2500);
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (shotTimerRef.current) clearInterval(shotTimerRef.current);
      if (permTimerRef.current) clearInterval(permTimerRef.current);
      if (errTimerRef.current) clearTimeout(errTimerRef.current);
      if (audibleTimerRef.current) clearTimeout(audibleTimerRef.current);
      try { dcRef.current?.close(); } catch { /* noop */ }
      try { pcRef.current?.close(); } catch { /* noop */ }
      micRef.current?.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) audioElRef.current.srcObject = null;
      if (vizRafRef.current) cancelAnimationFrame(vizRafRef.current);
      if (micTimerRef.current) clearInterval(micTimerRef.current);
      if (micWatchdogRef.current) clearInterval(micWatchdogRef.current);
      vizCtxRef.current?.close().catch(() => {});
      micCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    const track = micRef.current?.getTracks()[0];
    if (track) track.enabled = !next;
    vlog('REALTIME: mic ' + (next ? 'MUTED by user' : 'unmuted by user'));
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
    // Typing is a deliberate interruption. If Socrates is mid-sentence, stop him
    // and answer what was actually asked instead of queueing behind a reply to
    // something else — and the cancel is what produces the response.done that
    // releases the queued create.
    if (respBusyRef.current) {
      vlog('REALTIME: typed while replying — cancelling the in-flight response');
      send({ type: "response.cancel" });
    }
    requestResponse();
  }

  // Follow the conversation, including the line currently being written.
  useEffect(() => {
    if (expanded && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [transcript, expanded, status, shownCaption]);

  // Keep the ticker pinned to the words being spoken. Depends on the SMOOTHED
  // text, not the raw caption — that is what's actually on screen, and following
  // the raw value scrolled ahead of the visible line.
  useEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shownCaption]);

  async function end() {
    aliveRef.current = false;
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    if (permTimerRef.current) clearInterval(permTimerRef.current);
    if (micWatchdogRef.current) clearInterval(micWatchdogRef.current);
    if (micTimerRef.current) clearInterval(micTimerRef.current);
    try { dcRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    await restoreWindow();
    onEnd();
  }

  /* The panel follows the design system's CoachingPanel: a 22px mark, a display
     title over a mono meta line, a VU meter while audio is live, and the
     controls. Tone colours the meta line — teal normally, amber when something
     needs attention, red when the call has failed. */
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const TITLE: Record<Status, string> = {
    connecting: "Connecting",
    speaking: "Socrates is talking",
    listening: "Listening",
    thinking: "Thinking",
  };
  // Two facts, the way the design writes them: how long we have been going,
  // and what Socrates can currently see. Nothing else fits on one mono line.
  const meta =
    status === "connecting" ? "starting up"
    : [mmss, status === "listening" ? "your turn" : screenOk ? "sharing screen" : "audio only"]
        .join(" · ");
  const tone = error ? "bad" : warn ? "warn" : "ok";
  const live = status === "speaking" || status === "listening";

  const statusHead = (
    <>
      <span className={`vo-mark${live ? " live" : ""}`} aria-hidden="true">
        <PlanetOrb status={status} size={22} />
      </span>
      <span className="vo-status">
        <b className="vo-title">{TITLE[status]}</b>
        <span className={`vo-meta ${tone}`}>{meta}</span>
      </span>
      {live && (
        <span className="vo-vu" aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </span>
      )}
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
          {transcript.length === 0 && !streaming && !error && <div className="ve-empty">Your conversation shows up here. Talk to me, or type below.</div>}
          {transcript.map((m, i) => (
            <div key={i} className={`ve-msg ${m.role}`}>{m.content}</div>
          ))}
          {/* Socrates' words appear HERE as he says them, not in one lump when he
              finishes. This view used to render only completed turns, so the chat
              sat empty through an entire spoken reply — the reason the transcript
              was unreadable in real time. `response.done` moves the finished text
              into `transcript` and this bubble disappears in the same commit. */}
          {/* `|| caption` is a safety net: if the smoothing loop is ever starved,
              show the real text rather than an empty bubble. Readable beats pretty. */}
          {streaming && (shownCaption || caption) && (
            <div className="ve-msg assistant live">{shownCaption || caption}</div>
          )}
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
          <p className="vo-cap-line">{shownCaption || caption}</p>
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
