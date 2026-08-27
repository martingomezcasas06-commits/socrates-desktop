/**
 * useSmoothText — makes a streaming caption read like it is being written.
 *
 * Transcript deltas arrive in lumps: a whole clause materialises at once, then
 * nothing, then another lump. On screen that reads as words POPPING into place,
 * which is hard to follow — your eye is yanked to a new blob instead of moving
 * along a line.
 *
 * So we never render the target directly. We keep a cursor that walks toward it,
 * fast when it is far behind and idle when caught up, so it glides during a lump
 * and can never fall badly behind the voice.
 *
 * TIME-BASED, ON A TIMER — NOT requestAnimationFrame. rAF does not fire in a
 * window the OS considers hidden or occluded, and this app is a tray panel that
 * spends real time in exactly that state. On rAF the caption froze outright when
 * the window was occluded, which reads as "the transcript stopped working".
 * A timer keeps advancing (throttled, but advancing), the maths is per-elapsed-
 * second so a throttled tick just takes a bigger step, and returning to the tab
 * snaps straight to the target.
 */
import { useEffect, useRef, useState } from "react";

const TICK_MS = 33;
// SPEAKING PACE, not delta pace. The model streams its whole transcript in about
// a second while the AUDIO of it takes twenty — so revealing text as fast as it
// arrives dumped an entire paragraph on screen while Socrates was still on his
// first sentence. Martin: "a million words at a time, not even readable."
// Natural speech is ~150 wpm ≈ 13 characters/second, so that is the floor.
// MEASURED, not guessed: a probe against the live API counted 967 transcript
// characters against 52.45 seconds of actual PCM audio (bytes / 48000 at 24kHz
// mono 16-bit) = 18.44 chars/second. Sit a hair under it so the caption trails
// the voice rather than leading it — trailing keeps the spoken words on screen,
// leading scrolls them away.
const MIN_CPS = 18;
// Left exactly as it was in the build Martin called perfect. The drift he saw
// was the FLOOR being too slow, not this — so only the floor moved.
const BACKLOG_DIVISOR = 25;

export function useSmoothText(
  target: string,
  opts?: { minCps?: number; divisor?: number; gateRef?: { current: boolean } },
) {
  const minCps = opts?.minCps ?? MIN_CPS;
  const divisor = opts?.divisor ?? BACKLOG_DIVISOR;
  const gateRef = opts?.gateRef;
  const [shown, setShown] = useState("");
  const posRef = useRef(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    // A new reply (or a cleared caption) resets the cursor instead of trying to
    // diff its way across unrelated text.
    if (!target.startsWith(shown.slice(0, Math.min(shown.length, 12)))) {
      posRef.current = 0;
      setShown("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target === "" ? "" : target.slice(0, 12)]);

  useEffect(() => {
    let last = Date.now();
    const step = () => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000); // cap so a long stall doesn't jump oddly
      last = now;
      // Hold until the voice is actually audible. Transcript deltas arrive within
      // milliseconds while the audio takes a second or two to start playing, so
      // revealing on arrival put the caption ~2 lines ahead of the speech — in a
      // two-line ticker that means the words being spoken have already scrolled
      // off. The caller opens this gate when it hears sound (and force-opens it
      // on a timer, so a stalled analyser can never freeze the caption).
      if (gateRef && !gateRef.current) return;
      const t = targetRef.current;
      const remaining = t.length - posRef.current;
      if (remaining > 0) {
        posRef.current = Math.min(t.length, posRef.current + Math.max(minCps, remaining / divisor) * dt);
        setShown(t.slice(0, Math.floor(posRef.current)));
      } else if (posRef.current > t.length) {
        posRef.current = t.length;
        setShown(t);
      }
    };
    // ONE clock, deliberately. A 33ms interval is what Martin confirmed read as
    // real typing. Adding a parallel requestAnimationFrame loop "for smoothness"
    // made it die after ~5s — so it is not coming back. If pacing ever needs
    // changing again, change the RATE, never the number of loops.
    const id = window.setInterval(step, TICK_MS);
    // NOTE: there is deliberately no snap-to-full on visibilitychange. A tray
    // panel fires that event constantly, and each one dumped the entire reply at
    // once — defeating the pacing this hook exists for.
    return () => clearInterval(id);
  }, [minCps, divisor]);

  return shown;
}
