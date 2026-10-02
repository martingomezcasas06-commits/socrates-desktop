/**
 * Has the screen changed since Socrates last saw it?
 *
 * A call used to send a screenshot every 10 seconds whether or not anything had
 * moved, and every one stayed in the conversation, re-read on every reply.
 * Screenshots were about 40% of a call's cost (docs/unit-costs.md).
 *
 * The rule now: any visible change is sent, however small (a new chat, one new
 * line of text, a menu opening). Only an identical screen is skipped. So the
 * comparison is deliberately sensitive. It reduces each frame to a small
 * grayscale grid, and one cell changing is enough.
 */

export const GRID_W = 96;
export const GRID_H = 60;
/** Mean brightness change (0–255) for a cell to count as changed. */
export const CELL_DELTA = 4;

/** Number of grid cells that differ by more than `delta`. */
export function changedCells(a: Uint8Array, b: Uint8Array, delta = CELL_DELTA): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > delta) n++;
  return n;
}

/** True when `next` must be sent: no previous frame, no fingerprint, or any cell changed. */
export function screenChanged(prev: Uint8Array | null, next: Uint8Array | null): boolean {
  if (!prev || !next) return true;
  return changedCells(prev, next) > 0;
}

/**
 * Grayscale GRID_W × GRID_H fingerprint of a base64 JPEG. Resolves to null if
 * the frame can't be decoded, and the caller then treats it as changed: an
 * unreadable frame must never cost Socrates his view of the screen.
 */
export function fingerprint(jpegB64: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = GRID_W;
          canvas.height = GRID_H;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, GRID_W, GRID_H);
          const px = ctx.getImageData(0, 0, GRID_W, GRID_H).data;
          const out = new Uint8Array(GRID_W * GRID_H);
          for (let i = 0; i < out.length; i++) {
            out[i] = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
          }
          resolve(out);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/jpeg;base64,${jpegB64}`;
    } catch { resolve(null); }
  });
}
