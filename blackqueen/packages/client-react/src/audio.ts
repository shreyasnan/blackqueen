// Sound (UI_SPEC §7): fully synthesized Web Audio palette — no asset files.
// Warm/woody family: filtered triangles + short noise bursts. The reveal sting is the sonic logo.
let ctx: AudioContext | null = null;
let muted = localStorage.getItem("bq_muted") === "1";

export const isMuted = () => muted;
export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem("bq_muted", muted ? "1" : "0");
  return muted;
}

let master: GainNode | null = null;

const AC: typeof AudioContext | undefined =
  typeof window !== "undefined" ? (window.AudioContext ?? (window as any).webkitAudioContext) : undefined;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx && AC) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8; // headroom: layered one-shots never clip
      master.connect(ctx.destination);
    }
    return ctx;
  } catch { return null; }
}

function ac(): AudioContext | null {
  if (muted) return null;
  const c = ensureCtx();
  if (!c) return null;
  if (c.state === "suspended") void c.resume();
  return c.state === "running" ? c : c; // sounds scheduled while resuming still land once running
}

/** MOBILE UNLOCK (iOS/Android): WebAudio starts "suspended" and may only be resumed INSIDE a
 *  user gesture. Most of our sounds fire from server events — never a gesture — so on phones
 *  the context stayed suspended forever (= total silence). Unlock on the first real touch:
 *  create + resume the context and play a one-sample silent buffer (the iOS ritual).
 *  Also re-resume after backgrounding (iOS suspends the context when the tab sleeps). */
function unlock(): void {
  const c = ensureCtx();
  if (!c) return;
  void c.resume().then(() => {
    try { // silent kick: some iOS versions only truly unlock after a source starts in-gesture
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch { /* already unlocked */ }
  });
}
if (typeof window !== "undefined") {
  const EVENTS = ["touchend", "pointerdown", "click", "keydown"] as const;
  const tryUnlock = () => {
    unlock();
    if (ctx?.state === "running") { // done — stop listening
      for (const ev of EVENTS) window.removeEventListener(ev, tryUnlock, true);
    }
  };
  // Capture phase (true): fire BEFORE any app handler that might stopPropagation — on Chrome mobile the
  // context only resumes inside a gesture, so we must never miss the very first tap. `click` is added
  // because some mobile browsers deliver it more reliably than touchend/pointerdown.
  for (const ev of EVENTS) window.addEventListener(ev, tryUnlock, { capture: true, passive: true } as AddEventListenerOptions);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx?.state === "suspended") void ctx.resume();
  });
}

const out = (c: AudioContext) => master ?? c.destination;
/** Humanize: tiny random pitch drift so repeated sounds never feel stamped. */
const drift = (f: number, cents = 25) => f * Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200);

function tone(freq: number, dur: number, type: OscillatorType = "triangle", gain = 0.16, when = 0, glideTo?: number) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(drift(freq), t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008); // 8ms attack: kills clicky onsets
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(out(c));
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur: number, freq: number, gain = 0.12, when = 0) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + when;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = drift(freq, 60);
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(out(c));
  src.start(t0);
}

export const sfx = {
  thock: () => { tone(170, 0.09, "triangle", 0.22); noise(0.05, 900, 0.1); },          // card commit
  lift: () => tone(520, 0.05, "sine", 0.06),
  ret: () => tone(320, 0.07, "sine", 0.07),                                             // spring back
  illegal: () => { tone(110, 0.14, "square", 0.1); },                                   // dull thud
  bid: (value: number) => tone(240 + value * 2.2, 0.12, "triangle", 0.14),              // pitch rises with bid
  slam150: () => { tone(240, 0.4, "sawtooth", 0.12, 0, 570); noise(0.25, 500, 0.1, 0.05); },
  pass: () => noise(0.09, 1400, 0.05),
  crown: () => { [392, 494, 587].forEach((f, i) => tone(f, 0.3, "triangle", 0.1, i * 0.07)); }, // declarer crowned
  stamp: () => { tone(140, 0.16, "square", 0.16); noise(0.08, 700, 0.14); },            // contract stamp
  gather: () => noise(0.22, 800, 0.1),
  coin: (i = 0) => tone(880 + i * 120, 0.07, "sine", 0.1, i * 0.06),                    // pitch-rising per point card
  // THE sonic logo: two notes, minor-lift — reveal sting
  sting: () => { tone(659, 0.22, "triangle", 0.18); tone(988, 0.42, "triangle", 0.16, 0.14); },
  stingDark: () => { tone(659, 0.25, "triangle", 0.18); tone(466, 0.55, "triangle", 0.16, 0.16); }, // solo variant
  queen: () => { tone(1175, 0.1, "sine", 0.1); tone(1568, 0.2, "sine", 0.09, 0.08); },
  made: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, "triangle", 0.11, i * 0.08)); },
  failed: () => { tone(300, 0.3, "sawtooth", 0.08, 0, 220); tone(220, 0.5, "sawtooth", 0.08, 0.25, 150); }, // sad trombone-ish
  yourTurn: () => { tone(700, 0.06, "sine", 0.08); tone(700, 0.06, "sine", 0.08, 0.12); },
  emote: () => tone(600, 0.08, "sine", 0.08),
  fanfare: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, "triangle", 0.1, i * 0.09)); },
};

export function haptic(pattern: number | number[]): void {
  if (localStorage.getItem("bq_haptics") === "0") return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
