/**
 * Meters a realtime voice call. The call runs straight between this app and
 * OpenAI, so only the app sees what each reply cost: the `usage` on every
 * `response.done` event, and on each finished transcription of the user's
 * speech. This sums them and reports to the server (/api/usage/voice), which
 * records them in ai_usage. Reports go out every 2 minutes and when the call
 * ends, so a crash loses at most the last couple of minutes.
 */
import { apiFetch } from "./api";
import { vlog } from "./vlog";

const API_URL = import.meta.env.VITE_API_URL as string;
const FLUSH_MS = 120_000;

type Totals = {
  text_in: number; audio_in: number; image_in: number;
  cached_text: number; cached_audio: number; cached_image: number;
  text_out: number; audio_out: number;
};
type Transcription = { audio_in: number; text_in: number; text_out: number };

const zero = (): Totals => ({ text_in: 0, audio_in: 0, image_in: 0, cached_text: 0, cached_audio: 0, cached_image: 0, text_out: 0, audio_out: 0 });
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

type RealtimeUsage = {
  input_tokens?: number; output_tokens?: number;
  input_token_details?: {
    text_tokens?: number; audio_tokens?: number; image_tokens?: number; cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number; image_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

export class VoiceUsage {
  private totals = zero();
  private transcription: Transcription = { audio_in: 0, text_in: 0, text_out: 0 };
  private responses = 0;
  private readonly started = Date.now();
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private readonly tool: string;
  private readonly model: string;
  private readonly transcribeModel: string;

  constructor(tool: string, model: string, transcribeModel = "gpt-4o-mini-transcribe") {
    this.tool = tool;
    this.model = model;
    this.transcribeModel = transcribeModel;
    this.timer = setInterval(() => void this.flush(false), FLUSH_MS);
  }

  /** Feed every data-channel event; only the two usage-bearing ones count. */
  add(ev: { type?: string; response?: { usage?: RealtimeUsage }; usage?: RealtimeUsage }): void {
    if (ev.type === "response.done" && ev.response?.usage) {
      const u = ev.response.usage;
      const d = u.input_token_details ?? {};
      const c = d.cached_tokens_details ?? {};
      this.totals.text_in += num(d.text_tokens);
      this.totals.audio_in += num(d.audio_tokens);
      this.totals.image_in += num(d.image_tokens);
      this.totals.cached_text += num(c.text_tokens);
      this.totals.cached_audio += num(c.audio_tokens);
      this.totals.cached_image += num(c.image_tokens);
      this.totals.text_out += num(u.output_token_details?.text_tokens);
      this.totals.audio_out += num(u.output_token_details?.audio_tokens);
      this.responses += 1;
    } else if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.usage) {
      const u = ev.usage;
      this.transcription.audio_in += num(u.input_token_details?.audio_tokens ?? u.input_tokens);
      this.transcription.text_in += num(u.input_token_details?.text_tokens);
      this.transcription.text_out += num(u.output_tokens);
    }
  }

  /** Report what has accumulated since the last report. */
  async flush(final: boolean): Promise<void> {
    const totals = this.totals;
    const transcription = this.transcription;
    const responses = this.responses;
    const empty = Object.values(totals).every((v) => v === 0) && Object.values(transcription).every((v) => v === 0);
    if (empty && !final) return;
    this.totals = zero();
    this.transcription = { audio_in: 0, text_in: 0, text_out: 0 };
    this.responses = 0;
    try {
      const res = await apiFetch(`${API_URL}/api/usage/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          model: this.model, tool: this.tool, final, responses,
          seconds: Math.round((Date.now() - this.started) / 1000),
          usage: totals,
          transcription: { model: this.transcribeModel, ...transcription },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Put it back so the next report carries it. Metering must never disturb the call.
      for (const k of Object.keys(totals) as (keyof Totals)[]) this.totals[k] += totals[k];
      for (const k of Object.keys(transcription) as (keyof Transcription)[]) this.transcription[k] += transcription[k];
      this.responses += responses;
      vlog("USAGE: report failed, will retry: " + String(e));
    }
  }

  /** End of call: stop the timer and send the final report. Safe to call twice. */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    clearInterval(this.timer);
    return this.flush(true);
  }
}
