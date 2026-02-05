
/**
 * Base91 Encoding Service
 * Optimized for sending binary data over text-based messengers.
 * Alphabet: A–Z a–z 0–9 !#$%&()*+,-./:;<=>?@[]^_`{|}~
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

export const encodeBase91 = (data: Uint8Array): string => {
  let b = 0;
  let n = 0;
  let out = "";

  for (let i = 0; i < data.length; i++) {
    b |= data[i] << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) {
        b >>= 13;
        n -= 13;
      } else {
        v = b & 16383;
        b >>= 14;
        n -= 14;
      }
      out += ALPHABET[v % 91] + ALPHABET[Math.floor(v / 91)];
    }
  }

  if (n > 0) {
    out += ALPHABET[b % 91];
    if (n > 7 || b > 90) {
      out += ALPHABET[Math.floor(b / 91)];
    }
  }

  return out;
};

export const decodeBase91 = (str: string): Uint8Array => {
  let b = 0;
  let n = 0;
  let v = -1;
  const out = [];

  for (let i = 0; i < str.length; i++) {
    const c = ALPHABET.indexOf(str[i]);
    if (c === -1) continue;

    if (v < 0) {
      v = c;
    } else {
      v += c * 91;
      b |= v << n;
      n += (v & 8191) > 88 ? 13 : 14;
      do {
        out.push(b & 255);
        b >>= 8;
        n -= 8;
      } while (n > 7);
      v = -1;
    }
  }

  if (v > -1) {
    out.push((b | (v << n)) & 255);
  }

  return new Uint8Array(out);
};

export const calculateChecksum = (data: string): string => {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).substring(0, 4).toUpperCase();
};
