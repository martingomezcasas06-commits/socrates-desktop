/**
 * useSmoothText — makes a streaming caption read like it is being written.
 *
 * Transcript deltas arrive in lumps: a whole clause materialises at once, then
 * nothing, then another lump. On screen that reads as words POPPING into place,
 * which is hard to follow — your eye is yanked to a new blob instead of moving
 * along a line.
 *
 * So we never render the target directly. We keep a cursor that walks toward it
 * a few characters per frame, proportional to how far behind it is: it glides
 * during a lump and idles when caught up, and it can never fall badly behind the
 * voice (the further back it is, the faster it moves).
 *
 * Character granularity, not word — a word appearing whole is the pop we're
 * removing.
 */
import { useEffect, useRef, useState } from "react";

export function useSmoothText(target: string, opts?: { minPerFrame?: number; catchUp?: number }) {
  const minPerFrame = opts?.minPerFrame ?? 1.1;   // floor speed, chars/frame (~66/s at 60fps)
  const catchUp = opts?.catchUp ?? 10;            // higher = gentler catch-up
  const [shown, setShown] = useState("");
  const posRef = useRef(0);
  const rafRef = useRef<number | null>(null);
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
    const tick = () => {
      const t = targetRef.current;
      const remaining = t.length - posRef.current;
      if (remaining > 0) {
        posRef.current = Math.min(t.length, posRef.current + Math.max(minPerFrame, remaining / catchUp));
        setShown(t.slice(0, Math.floor(posRef.current)));
      } else if (posRef.current > t.length) {
        posRef.current = t.length;
        setShown(t);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [minPerFrame, catchUp]);

  return shown;
}
