// SHA-256 in plain TypeScript. core-model has no I/O and must also load in the browser (the web UI imports
// its schemas), so it cannot use `node:crypto`. `crypto.subtle` is not an option either: it is async, and a
// fingerprint is needed synchronously. Used only to give findings a stable identity, not for secrets.
//
// Arithmetic note: every sum below is of integers below 2^32 and is wrapped to 32 bits when it is stored in a
// `Uint32Array` or shifted with `>>> 0`, which is what SHA-256 specifies.

// `noUncheckedIndexedAccess` types an index read as `number | undefined`; every index used here is in range.
const at = (array: Uint32Array, index: number): number => array[index] as number;

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

function firstPrimes(count: number): number[] {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < count; candidate++) {
    if (primes.every((prime) => candidate % prime !== 0)) primes.push(candidate);
  }
  return primes;
}

const fractionalBits = (value: number): number => Math.floor((value - Math.floor(value)) * 2 ** 32);

const PRIMES = firstPrimes(64);
// FIPS 180-4: round constants are the fractional parts of the cube roots of the first 64 primes,
// the initial hash is the fractional part of the square roots of the first 8.
const ROUND_CONSTANTS = Uint32Array.from(PRIMES, (prime) => fractionalBits(Math.cbrt(prime)));
const INITIAL_HASH = Uint32Array.from(PRIMES.slice(0, 8), (prime) =>
  fractionalBits(Math.sqrt(prime)),
);

/** UTF-8 bytes of a string. A lone surrogate becomes U+FFFD, like `TextEncoder` does. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let code = char.codePointAt(0) as number;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** Message plus the 0x80 marker, zeros and the 64-bit bit length, in whole 64-byte blocks. */
function padded(bytes: number[]): DataView {
  const buffer = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(buffer.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(buffer.length - 4, bitLength >>> 0);
  return view;
}

/** Lowercase hexadecimal SHA-256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  const message = padded(utf8Bytes(text));
  const hash = Uint32Array.from(INITIAL_HASH);
  const schedule = new Uint32Array(64);

  for (let block = 0; block < message.byteLength; block += 64) {
    for (let i = 0; i < 16; i++) schedule[i] = message.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = at(schedule, i - 15);
      const w2 = at(schedule, i - 2);
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      schedule[i] = at(schedule, i - 16) + s0 + at(schedule, i - 7) + s1;
    }

    let [a, b, c, d, e, f, g, h] = hash as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = h + sum1 + choose + at(ROUND_CONSTANTS, i) + at(schedule, i);
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = sum0 + majority;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      hash[i] = at(hash, i) + value;
    });
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}
