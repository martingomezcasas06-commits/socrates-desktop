import { describe, it, expect } from "vitest";
import { changedCells, screenChanged, GRID_W, GRID_H } from "./screenDiff";

const blank = () => new Uint8Array(GRID_W * GRID_H).fill(240);

describe("screenChanged", () => {
  it("skips an identical screen", () => {
    expect(screenChanged(blank(), blank())).toBe(false);
  });

  it("ignores JPEG-level noise below the cell threshold", () => {
    const b = blank();
    b[10] = 243;
    expect(screenChanged(blank(), b)).toBe(false);
  });

  it("sends when a single cell changes, such as one new word", () => {
    const b = blank();
    b[GRID_W * 30 + 40] = 180;
    expect(changedCells(blank(), b)).toBe(1);
    expect(screenChanged(blank(), b)).toBe(true);
  });

  it("sends a whole new screen, such as a new chat", () => {
    const b = blank().fill(30);
    expect(changedCells(blank(), b)).toBe(GRID_W * GRID_H);
  });

  it("always sends when there is nothing to compare with", () => {
    expect(screenChanged(null, blank())).toBe(true);
    expect(screenChanged(blank(), null)).toBe(true);
  });
});
