// Bust avatars — Roblox-style: head + neck + shoulders, layered skin/hair/expression/accessory.
// Fully procedural SVG: crisp at 16px and 80px, zero assets, trivially extensible.
// `tint` (optional) colors the shirt — the table passes the seat color so identity and seat unify.
import React from "react";

type Skin = keyof typeof SKINS;
type Hair = "none" | "fringe" | "curly" | "spiky" | "bun" | "long" | "buzz";
type HairColor = keyof typeof HAIR_COLORS;
type Mouth = "smile" | "grin" | "wink" | "wow" | "grr" | "tongue" | "sleepy" | "smirk";
type Acc = "none" | "goggles" | "sunglasses" | "beanie" | "cap" | "headphones" | "mask" | "halo" | "monocle" | "visor";

interface Recipe { skin: Skin; hair: Hair; hairColor: HairColor; mouth: Mouth; acc: Acc }

const SKINS = { peach: "#f2d3b3", tan: "#d9a877", brown: "#a9744c", deep: "#7c5236", grey: "#cfd6d4" };
const HAIR_COLORS = { brown: "#6b4423", black: "#2a2126", blonde: "#c9992e", auburn: "#a34d2e", slate: "#5c6470", pink: "#c96a8e" };
const INK = "#1d1a1e";
const DEFAULT_SHIRT = "#4a7fb5";

/** Curated roster — ids are the server whitelist (AVATAR_FACES in core mirrors this list). */
export const ROSTER: Record<string, Recipe> = {
  classic:  { skin: "peach", hair: "none",   hairColor: "brown",  mouth: "smile",  acc: "none" },
  scout:    { skin: "peach", hair: "fringe", hairColor: "brown",  mouth: "smile",  acc: "beanie" },
  aviator:  { skin: "tan",   hair: "buzz",   hairColor: "black",  mouth: "grin",   acc: "goggles" },
  sunny:    { skin: "brown", hair: "curly",  hairColor: "black",  mouth: "smile",  acc: "sunglasses" },
  dj:       { skin: "deep",  hair: "buzz",   hairColor: "black",  mouth: "smirk",  acc: "headphones" },
  captain:  { skin: "peach", hair: "none",   hairColor: "brown",  mouth: "grin",   acc: "cap" },
  bun:      { skin: "tan",   hair: "bun",    hairColor: "auburn", mouth: "wink",   acc: "none" },
  spike:    { skin: "peach", hair: "spiky",  hairColor: "pink",   mouth: "grr",    acc: "none" },
  curls:    { skin: "brown", hair: "curly",  hairColor: "brown",  mouth: "grin",   acc: "none" },
  ninja:    { skin: "tan",   hair: "none",   hairColor: "black",  mouth: "smirk",  acc: "mask" },
  saint:    { skin: "deep",  hair: "fringe", hairColor: "black",  mouth: "smile",  acc: "halo" },
  dreamer:  { skin: "peach", hair: "long",   hairColor: "blonde", mouth: "sleepy", acc: "none" },
  gasp:     { skin: "tan",   hair: "long",   hairColor: "slate",  mouth: "wow",    acc: "none" },
  cheeky:   { skin: "brown", hair: "spiky",  hairColor: "black",  mouth: "tongue", acc: "none" },
  scholar:  { skin: "peach", hair: "bun",    hairColor: "slate",  mouth: "smile",  acc: "monocle" },
  racer:    { skin: "deep",  hair: "none",   hairColor: "black",  mouth: "grin",   acc: "visor" },
  frost:    { skin: "peach", hair: "curly",  hairColor: "slate",  mouth: "wink",   acc: "beanie" },
  rebel:    { skin: "tan",   hair: "fringe", hairColor: "black",  mouth: "grr",    acc: "sunglasses" },
};
export const FACE_IDS = Object.keys(ROSTER);

// Legacy flat-face ids from earlier builds render as sensible busts.
const LEGACY: Record<string, string> = {
  smile: "classic", grin: "captain", wink: "bun", cool: "sunny", beanie: "scout", fringe: "rebel",
  wow: "gasp", sleepy: "dreamer", grr: "spike", tongue: "cheeky", mask: "ninja", halo: "saint",
};

export function Face({ id, size = 24, tint }: { id: string; size?: number; tint?: string }) {
  const rid = ROSTER[id] ? id : LEGACY[id] ?? (id === "bot" ? "bot" : null);
  if (rid === null) return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>{id}</span>; // ancient emoji rooms
  const r: Recipe = rid === "bot"
    ? { skin: "grey", hair: "none", hairColor: "black", mouth: "smile", acc: "visor" }
    : ROSTER[rid]!;
  const skin = SKINS[r.skin];
  const hairC = HAIR_COLORS[r.hairColor];
  const shirt = tint ?? DEFAULT_SHIRT;
  const isBot = rid === "bot";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "inline-block", verticalAlign: "middle" }} aria-label={`avatar ${id}`}>
      <defs>
        <clipPath id="bq-bust"><rect x={0} y={0} width={64} height={64} rx={14} /></clipPath>
      </defs>
      <g clipPath="url(#bq-bust)">
        {/* backdrop */}
        <rect x={0} y={0} width={64} height={64} rx={14} fill="rgba(59,34,71,.07)" />
        {/* shoulders / shirt */}
        <path d="M8 66 q2 -17 24 -17 q22 0 24 17 z" fill={shirt} stroke="rgba(0,0,0,.18)" strokeWidth={1.5} />
        {/* neck */}
        <rect x={27} y={38} width={10} height={10} rx={3} fill={skin} stroke="rgba(0,0,0,.12)" strokeWidth={1} />
        {/* head */}
        <rect x={17} y={8} width={30} height={34} rx={12} fill={skin} stroke="rgba(0,0,0,.15)" strokeWidth={1.5} />
        {hairBack(r.hair, hairC)}
        {face(r.mouth, isBot)}
        {hairFront(r.hair, hairC, r.acc)}
        {accessory(r.acc, isBot)}
      </g>
    </svg>
  );
}

function face(mouth: Mouth, bot: boolean): React.ReactNode {
  const eyes = bot ? (
    <><rect x={23} y={22} width={5.5} height={6.5} rx={1.4} fill={INK} /><rect x={35.5} y={22} width={5.5} height={6.5} rx={1.4} fill={INK} /></>
  ) : mouth === "wink" ? (
    <><ellipse cx={26} cy={25} rx={2.1} ry={3.4} fill={INK} /><path d="M35.5 25 h6" stroke={INK} strokeWidth={2.3} strokeLinecap="round" /></>
  ) : mouth === "sleepy" ? (
    <><path d="M23 25 q3 2.8 6 0" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" /><path d="M35 25 q3 2.8 6 0" stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" /></>
  ) : mouth === "grr" ? (
    <><path d="M22 19.5 l8 3" stroke={INK} strokeWidth={2} strokeLinecap="round" /><path d="M42 19.5 l-8 3" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <ellipse cx={26} cy={26} rx={2} ry={3} fill={INK} /><ellipse cx={38} cy={26} rx={2} ry={3} fill={INK} /></>
  ) : (
    <><ellipse cx={26} cy={25} rx={2.1} ry={3.4} fill={INK} /><ellipse cx={38} cy={25} rx={2.1} ry={3.4} fill={INK} /></>
  );
  const m = (() => {
    switch (mouth) {
      case "grin": return (<><path d="M24 32.5 q8 8 16 0 z" fill={INK} /><path d="M26.5 33.8 q5.5 3.2 11 0" stroke="#fff" strokeWidth={1.8} fill="none" /></>);
      case "wow": return <ellipse cx={32} cy={34.5} rx={3.6} ry={4.4} fill={INK} />;
      case "grr": return <path d="M25 36 q7 -4.5 14 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
      case "tongue": return (<><path d="M24 32.5 q8 6.5 16 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <path d="M30 34.5 q0 5.5 4 5.5 q3.4 0 3 -5" fill="#d97a8a" stroke="#b85a6a" strokeWidth={0.8} /></>);
      case "sleepy": return <path d="M27 34.5 q5 2.6 10 0" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />;
      case "smirk": return <path d="M26 34 q6 4 12 -1" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
      default: return <path d="M24 32.5 q8 6.5 16 0" stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
    }
  })();
  return <>{eyes}{m}</>;
}

function hairBack(h: Hair, c: string): React.ReactNode {
  if (h === "long") return <path d="M15 20 q0 -14 17 -14 q17 0 17 14 v22 q-4 3 -7 0 v-16 h-20 v16 q-3 3 -7 0 z" fill={c} />;
  return null;
}

function hairFront(h: Hair, c: string, acc: Acc): React.ReactNode {
  if (acc === "beanie" || acc === "cap") return null; // hat covers hair top; fringe peeks handled in accessory
  switch (h) {
    case "fringe": return <path d="M16 21 q1 -14 16 -14 q15 0 16 14 q-3 -6 -7 -6 q1.5 2.5 .8 4.5 q-3.5 -4.5 -8.8 -4.5 q-6.5 0 -11 3.8 q-.8 -2 .5 -4 q-5 1 -6.5 6.2 z" fill={c} />;
    case "curly": return (<><circle cx={22} cy={11} r={5.5} fill={c} /><circle cx={32} cy={8.5} r={6} fill={c} /><circle cx={42} cy={11} r={5.5} fill={c} />
      <circle cx={17.5} cy={16} r={4.5} fill={c} /><circle cx={46.5} cy={16} r={4.5} fill={c} /></>);
    case "spiky": return <path d="M16 18 l3 -9 l4 6 l4 -9 l4 7 l4 -8 l4 8 l4 -6 l3 9 q-8 -6 -15 -6 q-7 0 -15 8 z" fill={c} />;
    case "bun": return (<><circle cx={32} cy={6} r={5} fill={c} /><path d="M17 19 q2 -11 15 -11 q13 0 15 11 q-7 -5 -15 -5 q-8 0 -15 5 z" fill={c} /></>);
    case "buzz": return <path d="M17.5 17 q2 -8 14.5 -8 q12.5 0 14.5 8 q-7 -4 -14.5 -4 q-7.5 0 -14.5 4 z" fill={c} opacity={0.85} />;
    case "long": return <path d="M16 21 q1 -14 16 -14 q15 0 16 14 q-6 -7 -16 -7 q-10 0 -16 7 z" fill={c} />;
    default: return null;
  }
}

function accessory(a: Acc, bot: boolean): React.ReactNode {
  switch (a) {
    case "goggles": return (<>
      <rect x={16} y={19} width={32} height={4} rx={2} fill="#5c4a3a" />
      <circle cx={26} cy={23} r={7} fill="#bfe3e8" stroke="#5c4a3a" strokeWidth={2.6} />
      <circle cx={38} cy={23} r={7} fill="#bfe3e8" stroke="#5c4a3a" strokeWidth={2.6} />
      <circle cx={24} cy={21} r={2} fill="#fff" opacity={0.8} />
    </>);
    case "sunglasses": return (<>
      <rect x={19} y={21} width={11} height={7.5} rx={2.4} fill={INK} />
      <rect x={34} y={21} width={11} height={7.5} rx={2.4} fill={INK} />
      <path d="M30 24 h4 M19 23 l-3 -1.6 M45 23 l3 -1.6" stroke={INK} strokeWidth={2} />
    </>);
    case "beanie": return (<>
      <path d="M15.5 20 q1.5 -13.5 16.5 -13.5 q15 0 16.5 13.5 l-2.8 1.6 q-4.5 -8.5 -13.7 -8.5 q-9.2 0 -13.7 8.5 z" fill="#d64a3b" />
      <path d="M14.5 20.5 q17.5 -5.5 35 0 l-.8 3 q-16.7 -5 -33.4 0 z" fill="#b83a2e" />
      <path d="M18 23 q4 4.5 8 5.5 q-6 .5 -9 -2 z" fill="#6b4423" />
    </>);
    case "cap": return (<>
      <path d="M16 19 q2 -12 16 -12 q14 0 16 12 z" fill="#2e6f5e" />
      <path d="M14 19 h36 q3 0 3 2.4 q0 1.6 -3 1.6 h-36 q-3 0 -3 -1.6 q0 -2.4 3 -2.4 z" fill="#245647" />
      <circle cx={32} cy={11} r={1.8} fill="#c9992e" />
    </>);
    case "headphones": return (<>
      <path d="M15 22 q0 -16 17 -16 q17 0 17 16" stroke="#3a3f52" strokeWidth={3.6} fill="none" />
      <rect x={12} y={20} width={7} height={11} rx={3} fill="#3a3f52" />
      <rect x={45} y={20} width={7} height={11} rx={3} fill="#3a3f52" />
    </>);
    case "mask": return (<>
      <path d="M16 19.5 h32 v9.5 q-16 4 -32 0 z" fill="#3a3f52" />
      <ellipse cx={26} cy={24.5} rx={2.6} ry={3.2} fill="#fff" />
      <ellipse cx={38} cy={24.5} rx={2.6} ry={3.2} fill="#fff" />
      <ellipse cx={26} cy={25} rx={1.3} ry={1.9} fill={INK} />
      <ellipse cx={38} cy={25} rx={1.3} ry={1.9} fill={INK} />
    </>);
    case "halo": return <ellipse cx={32} cy={4.5} rx={10} ry={2.8} fill="none" stroke="#d9a92e" strokeWidth={2.6} />;
    case "monocle": return (<>
      <circle cx={38} cy={25} r={5.5} fill="none" stroke="#5c4a3a" strokeWidth={2} />
      <path d="M38 30.5 v6" stroke="#5c4a3a" strokeWidth={1.4} />
    </>);
    case "visor": return (<>
      {bot && <><path d="M32 8 v-5" stroke="#8a8f8d" strokeWidth={2.4} /><circle cx={32} cy={2.5} r={2.2} fill="#d64a3b" /></>}
      <path d="M17 19 h30 q2.5 0 2.5 3 q0 3 -2.5 3 h-30 q-2.5 0 -2.5 -3 q0 -3 2.5 -3 z" fill={bot ? "#3a3f52" : "#c9412e"} opacity={bot ? 1 : 0.92} />
      {!bot && <rect x={19} y={20.5} width={26} height={2} rx={1} fill="#fff" opacity={0.35} />}
    </>);
    default: return null;
  }
}
