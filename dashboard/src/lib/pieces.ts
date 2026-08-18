// Pure piece-bitfield downsampling for the torrent hero band.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(input: string): Uint8Array | null {
  const clean = input.replace(/=+$/, "");
  const bits: number[] = [];
  let buffer = 0;
  let bufferBits = 0;
  for (const ch of clean) {
    const value = B64.indexOf(ch);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bufferBits += 6;
    if (bufferBits >= 8) {
      bufferBits -= 8;
      bits.push((buffer >> bufferBits) & 0xff);
    }
  }
  return Uint8Array.from(bits);
}

export function downsamplePieces(bitfieldBase64: string, pieceCount: number, cells: number): number[] {
  const zeros = new Array<number>(cells).fill(0);
  if (pieceCount <= 0 || cells <= 0) return zeros;
  const bytes = decodeBase64(bitfieldBase64);
  if (!bytes || bytes.length * 8 < pieceCount) return zeros;

  // Transmission serializes the bitfield MSB-first per byte.
  const hasPiece = (i: number) => (bytes[i >> 3] & (0x80 >> (i & 7))) !== 0;

  return zeros.map((_, cell) => {
    const start = Math.floor((cell * pieceCount) / cells);
    const end = Math.floor(((cell + 1) * pieceCount) / cells);
    if (end <= start) {
      return hasPiece(Math.min(start, pieceCount - 1)) ? 1 : 0;
    }
    let sum = 0;
    for (let i = start; i < end; i++) {
      if (hasPiece(i)) sum++;
    }
    return sum / (end - start);
  });
}
