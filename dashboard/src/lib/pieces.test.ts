// Runs via root `npm test` (vitest's default glob sweeps the dashboard even
// though it isn't a workspace). Imports must stay relative — nothing maps the
// "@/" alias outside Next.
import { describe, it, expect } from "vitest";
import { downsamplePieces } from "./pieces";

const b64 = (...bytes: number[]) => Buffer.from(bytes).toString("base64");

describe("downsamplePieces", () => {
  it("decodes MSB-first: 0x80 sets only piece 0", () => {
    expect(downsamplePieces(b64(0x80), 8, 8)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("maps 0xFF00 over 16 pieces to a set first half", () => {
    const cells = downsamplePieces(b64(0xff, 0x00), 16, 16);
    expect(cells.slice(0, 8)).toEqual(new Array(8).fill(1));
    expect(cells.slice(8)).toEqual(new Array(8).fill(0));
  });

  it("averages when the count does not divide evenly", () => {
    // 10 pieces into 4 cells: ranges [0,2) [2,5) [5,7) [7,10)
    const cells = downsamplePieces(b64(0b11011000, 0b01000000), 10, 4);
    expect(cells[0]).toBe(1);
    expect(cells[1]).toBeCloseTo(2 / 3);
    expect(cells[2]).toBe(0);
    expect(cells[3]).toBeCloseTo(1 / 3);
  });

  it("repeats pieces when there are more cells than pieces", () => {
    const cells = downsamplePieces(b64(0x80), 2, 4);
    expect(cells).toEqual([1, 1, 0, 0]);
  });

  it("returns zeros for a zero piece count", () => {
    expect(downsamplePieces(b64(0xff), 0, 4)).toEqual([0, 0, 0, 0]);
  });

  it("returns zeros for garbage base64", () => {
    expect(downsamplePieces("!!not-base64!!", 8, 4)).toEqual([0, 0, 0, 0]);
  });

  it("returns zeros when the bitfield is too short for the count", () => {
    expect(downsamplePieces(b64(0xff), 16, 4)).toEqual([0, 0, 0, 0]);
  });

  it("maps a full bitfield to all ones", () => {
    expect(downsamplePieces(b64(0xff, 0xff), 16, 4)).toEqual([1, 1, 1, 1]);
  });
});
