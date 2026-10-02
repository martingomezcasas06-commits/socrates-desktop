import { describe, it, expect, vi, beforeEach } from "vitest";

// What the collector reports is what the server bills from, so pin it down
// with events shaped exactly like OpenAI's realtime `response.done`.
const sent: { body: Record<string, unknown> }[] = [];
let fail = false;
vi.mock("./api", () => ({
  apiFetch: async (_url: string, init: RequestInit) => {
    if (fail) throw new Error("offline");
    sent.push({ body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 200 });
  },
}));
vi.mock("./vlog", () => ({ vlog: () => {} }));

const { VoiceUsage } = await import("./voiceUsage");

const done = (textIn: number, audioIn: number, imageIn: number, cachedAudio: number, audioOut: number) => ({
  type: "response.done",
  response: { usage: {
    input_tokens: textIn + audioIn + imageIn, output_tokens: audioOut + 20,
    input_token_details: { text_tokens: textIn, audio_tokens: audioIn, image_tokens: imageIn, cached_tokens: cachedAudio, cached_tokens_details: { text_tokens: 0, audio_tokens: cachedAudio, image_tokens: 0 } },
    output_token_details: { text_tokens: 20, audio_tokens: audioOut },
  } },
});

beforeEach(() => { sent.length = 0; fail = false; });

describe("VoiceUsage", () => {
  it("sums every reply's usage and reports it once at the end", async () => {
    const u = new VoiceUsage("Claude", "gpt-realtime-2.1");
    u.add(done(1000, 300, 765, 0, 600));
    u.add(done(1000, 900, 1530, 300, 1200));
    u.add({ type: "response.output_audio_transcript.delta" }); // ignored
    u.add({ type: "conversation.item.input_audio_transcription.completed", usage: { input_tokens: 50, output_tokens: 12, input_token_details: { audio_tokens: 50, text_tokens: 0 } } });
    await u.stop();
    expect(sent).toHaveLength(1);
    const b = sent[0].body as { model: string; tool: string; final: boolean; responses: number; usage: Record<string, number>; transcription: Record<string, unknown> };
    expect(b).toMatchObject({ model: "gpt-realtime-2.1", tool: "Claude", final: true, responses: 2 });
    expect(b.usage).toEqual({ text_in: 2000, audio_in: 1200, image_in: 2295, cached_text: 0, cached_audio: 300, cached_image: 0, text_out: 40, audio_out: 1800 });
    expect(b.transcription).toMatchObject({ model: "gpt-4o-mini-transcribe", audio_in: 50, text_out: 12 });
  });

  it("sends only what's new since the last report, and stops once", async () => {
    const u = new VoiceUsage("Claude", "gpt-realtime-2.1");
    u.add(done(100, 100, 0, 0, 100));
    await u.flush(false);
    u.add(done(100, 100, 0, 0, 100));
    await u.stop();
    await u.stop();
    expect(sent).toHaveLength(2);
    expect((sent[1].body as { usage: { audio_out: number } }).usage.audio_out).toBe(100);
  });

  it("keeps usage it failed to send and includes it in the next report", async () => {
    const u = new VoiceUsage("Claude", "gpt-realtime-2.1");
    u.add(done(100, 100, 0, 0, 100));
    fail = true;
    await u.flush(false);
    fail = false;
    u.add(done(100, 100, 0, 0, 100));
    await u.stop();
    expect((sent[0].body as { usage: { audio_out: number }; responses: number }).usage.audio_out).toBe(200);
    expect((sent[0].body as { responses: number }).responses).toBe(2);
  });
});
