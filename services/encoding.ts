
/**
 * GhostComm Titan-Safe Base32768 Encoding
 * Maps exactly 15 bits to 1 CJK character.
 * Range: 0x4E00 (19968) to 0xCEFF (52735) - CJK Unified Ideographs.
 * This range is extremely stable across all messenger platforms.
 */

const START_CHAR = 0x4E00;
const ALPHABET_SIZE = 32768;

export const encodeBase32768 = (data: Uint8Array): string => {
  let encoded = "";
  let buffer = 0;
  let bitsInBuffer = 0;

  // Prepend length (4 bytes) to the data stream
  const lengthHeader = new Uint8Array(4);
  const view = new DataView(lengthHeader.buffer);
  view.setUint32(0, data.length);

  const combined = new Uint8Array(lengthHeader.length + data.length);
  combined.set(lengthHeader);
  combined.set(data, 4);

  for (let i = 0; i < combined.length; i++) {
    buffer = (buffer << 8) | combined[i];
    bitsInBuffer += 8;

    while (bitsInBuffer >= 15) {
      bitsInBuffer -= 15;
      const index = (buffer >> bitsInBuffer) & 0x7FFF;
      encoded += String.fromCharCode(START_CHAR + index);
    }
  }

  if (bitsInBuffer > 0) {
    const index = (buffer << (15 - bitsInBuffer)) & 0x7FFF;
    encoded += String.fromCharCode(START_CHAR + index);
  }

  return encoded;
};

export const decodeBase32768 = (str: string): Uint8Array => {
  const indices: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= START_CHAR && code < START_CHAR + ALPHABET_SIZE) {
      indices.push(code - START_CHAR);
    }
  }

  const out = [];
  let buffer = 0;
  let bitsInBuffer = 0;

  for (const index of indices) {
    buffer = (buffer << 15) | index;
    bitsInBuffer += 15;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      out.push((buffer >> bitsInBuffer) & 0xFF);
    }
  }

  const fullData = new Uint8Array(out);
  if (fullData.length < 4) return new Uint8Array(0);

  // Extract original length from header
  const view = new DataView(fullData.buffer);
  const originalLength = view.getUint32(0);
  
  // Return exactly the original bytes, excluding bit-padding at the end
  return fullData.slice(4, 4 + originalLength);
};

// Aliases for compatibility
export const encodeBase60000 = encodeBase32768;
export const decodeBase60000 = decodeBase32768;

export const calculateChecksum = (data: string): string => {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).substring(0, 4).toUpperCase();
};
