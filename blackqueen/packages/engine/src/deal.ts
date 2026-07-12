// ARCHITECTURE.md §5 — pinned deterministic dealing pipeline.
// ChaCha20 (RFC 8439) keystream, zero nonce, counter 0; LE uint32 draws;
// unbiased rejection sampling; descending Fisher–Yates; round-robin deal.
// Locked by KAT-001 (TEST_CASES.md §7). Pure TS, zero deps.

import { Card, canonicalDeck } from "./cards.js";

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

/** One ChaCha20 block (RFC 8439). key: 32 bytes, nonce: 12 bytes, counter: uint32. */
function chachaBlock(key: Uint8Array, nonce: Uint8Array, counter: number): Uint8Array {
  const c = new Uint32Array(16);
  c[0] = 0x61707865; c[1] = 0x3320646e; c[2] = 0x79622d32; c[3] = 0x6b206574;
  const dv = new DataView(key.buffer, key.byteOffset, key.byteLength);
  for (let i = 0; i < 8; i++) c[4 + i] = dv.getUint32(i * 4, true);
  c[12] = counter >>> 0;
  const nv = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  for (let i = 0; i < 3; i++) c[13 + i] = nv.getUint32(i * 4, true);

  const s = Uint32Array.from(c);
  const qr = (a: number, b: number, d: number, e: number) => {
    s[a] = (s[a]! + s[b]!) >>> 0; s[e] = rotl(s[e]! ^ s[a]!, 16);
    s[d] = (s[d]! + s[e]!) >>> 0; s[b] = rotl(s[b]! ^ s[d]!, 12);
    s[a] = (s[a]! + s[b]!) >>> 0; s[e] = rotl(s[e]! ^ s[a]!, 8);
    s[d] = (s[d]! + s[e]!) >>> 0; s[b] = rotl(s[b]! ^ s[d]!, 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setUint32(i * 4, (s[i]! + c[i]!) >>> 0, true);
  return out;
}

/** Continuous keystream reader — one stream per deal (no rekeying), per ARCH §5. */
export class ChaChaStream {
  private counter = 0;
  private block: Uint8Array = new Uint8Array(0);
  private pos = 64;
  private readonly nonce = new Uint8Array(12);
  constructor(private readonly key: Uint8Array) {
    if (key.length !== 32) throw new Error("shuffleSeed must be exactly 32 bytes");
  }
  private byte(): number {
    if (this.pos >= 64) {
      this.block = chachaBlock(this.key, this.nonce, this.counter++);
      this.pos = 0;
    }
    return this.block[this.pos++]!;
  }
  /** 4 keystream bytes as little-endian uint32. */
  uint32(): number {
    return (this.byte() | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)) >>> 0;
  }
  /** Unbiased uniform integer in [0, m] inclusive (rejection sampling, ARCH §5). */
  uniform(m: number): number {
    const n = m + 1;
    const bound = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const v = this.uint32();
      if (v < bound) return v % n;
    }
  }
}

/** ARCH §5: in-place descending Fisher–Yates. */
export function shuffle(deck: Card[], seed: Uint8Array): Card[] {
  const d = deck.slice();
  const rng = new ChaChaStream(seed);
  for (let i = d.length - 1; i >= 1; i--) {
    const j = rng.uniform(i);
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}

/** GAME_SPEC §3.1 steps 1–5: full reproducible deal. Returns hands indexed by seat. */
export function deal(playerCount: number, defaultDeclarerSeat: number, shuffleSeed: Uint8Array, deckCount = 1, handSize?: number): Card[][] {
  const shuffled = shuffle(canonicalDeck(playerCount, deckCount, handSize), shuffleSeed);
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  shuffled.forEach((card, i) => {
    hands[(defaultDeclarerSeat + i) % playerCount]!.push(card);
  });
  return hands;
}
