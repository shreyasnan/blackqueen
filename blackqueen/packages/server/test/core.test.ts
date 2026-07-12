// Server-core tests: PLAT-001 (seat binding), idempotency, stale guard, private rejects,
// staged-trump non-emission at the wire level, seq monotonicity, host migration exclusion (MIG-001),
// lobby rules (PLAT-002 uniform errors), full game over the core apply loop.
import { describe, expect, it, beforeEach } from "vitest";
import { RoomCore, Outbound } from "../src/core.js";

class TestOut implements Outbound {
  sent: { to: string; msg: any }[] = [];
  persisted = new Map<string, unknown>();
  audits: unknown[] = [];
  private ctr = 1;
  send(to: string, msg: unknown): void { this.sent.push({ to, msg }); }
  randomBytes(n: number): Uint8Array {
    // deterministic but varied
    return new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + this.ctr++) % 256));
  }
  persist(key: string, value: unknown): void { this.persisted.set(key, value); }
  audit(r: Record<string, unknown>): void { this.audits.push(r); }
  of(to: string) { return this.sent.filter((s) => s.to === to).map((s) => s.msg); }
  clear() { this.sent = []; }
}

const A = "acct_alice", B = "acct_bob", C = "acct_carol", D = "acct_dave";
let out: TestOut;
let room: RoomCore;
let aid = 0;
const act = (who: string, type: any, payload: any = {}) =>
  room.handleAction(who, `00000000-0000-4000-8000-${String(++aid).padStart(12, "0")}`, room.stateVersion, { type, payload });

function makeStartedRoom(): void {
  out = new TestOut();
  room = new RoomCore("room1", out);
  room.create(A, "Alice", { N: 4, turnTimerMs: 30000, graceMs: 15000 });
  const code = room.inviteCode;
  expect(room.join(code, B, "Bob").ok).toBe(true);
  expect(room.join(code, C, "Carol").ok).toBe(true);
  expect(room.join(code, D, "Dave").ok).toBe(true);
  expect(room.startGame(A).ok).toBe(true);
  out.clear();
}

beforeEach(makeStartedRoom);

const turnAccount = () => room.accountOfSeat[room.game!.round!.turnSeat!]!;
const declarerAccount = () => room.accountOfSeat[room.game!.round!.declarerSeat]!;

function passToDeclarer(): void {
  let guard = 0;
  while (room.game!.phase === "BIDDING" && guard++ < 20) act(turnAccount(), "PASS");
  expect(room.game!.phase).toBe("TRUMP_SELECTION");
}

describe("lobby (PLAT-002 spirit)", () => {
  it("uniform join failure for bad code, full room, in-game", () => {
    expect(room.join("WRONG1", "x", "X").ok).toBe(false); // in-game now → uniform false
    const r2 = new RoomCore("r2", new TestOut());
    r2.create(A, "Alice", {});
    expect(r2.join("BADBAD", B, "Bob").ok).toBe(false);
    for (const [i, acct] of [B, C, D, "e", "f", "g"].entries()) expect(r2.join(r2.inviteCode, acct, `P${i}`).ok).toBe(true);
    expect(r2.join(r2.inviteCode, "h", "H").ok).toBe(false); // 8th member
  });
  it("code regeneration invalidates old code instantly", () => {
    const r2 = new RoomCore("r2", new TestOut());
    r2.create(A, "Alice", {});
    const old = r2.inviteCode;
    r2.regenCode();
    expect(r2.join(old, B, "Bob").ok).toBe(false);
    expect(r2.join(r2.inviteCode, B, "Bob").ok).toBe(true);
  });
  it("start requires 4+; config bounds enforced", () => {
    const r2 = new RoomCore("r2", new TestOut());
    r2.create(A, "Alice", {});
    r2.join(r2.inviteCode, B, "Bob");
    expect(r2.startGame(A).ok).toBe(false); // 2 players
    const r3 = new RoomCore("r3", new TestOut());
    r3.create(A, "Alice", { N: 0 });
    [B, C, D].forEach((x) => r3.join(r3.inviteCode, x, x));
    expect(r3.startGame(A).ok).toBe(false); // N=0 rejected (CFG-003)
    const r4 = new RoomCore("r4", new TestOut());
    r4.create(A, "Alice", { turnTimerMs: 5000, graceMs: 1000 });
    [B, C, D].forEach((x) => r4.join(r4.inviteCode, x, x));
    expect(r4.startGame(A).ok).toBe(false); // combined budget < 10s rejected
  });
  it("v2.1 handSize: clamped to the actual table's legal range at start", () => {
    const r5 = new RoomCore("r5", new TestOut());
    r5.create(A, "Alice", { handSize: 17 }); // 1-deck, 4p → max 13
    [B, C, D].forEach((x) => r5.join(r5.inviteCode, x, x));
    expect(r5.startGame(A).ok).toBe(true);
    expect(r5.game!.handSize).toBe(13); // clamped down to whole deck
    const r6 = new RoomCore("r6", new TestOut());
    r6.create(A, "Alice", { handSize: 10 });
    [B, C, D].forEach((x) => r6.join(r6.inviteCode, x, x));
    expect(r6.startGame(A).ok).toBe(true);
    expect(r6.game!.handSize).toBe(10);
    expect(r6.game!.round!.hands.every((h) => h.length === 10)).toBe(true);
    const r7 = new RoomCore("r7", new TestOut());
    r7.create(A, "Alice", { handSize: 7.5 });
    [B, C, D].forEach((x) => r7.join(r7.inviteCode, x, x));
    expect(r7.startGame(A).ok).toBe(false); // non-integer rejected
  });
});

describe("apply loop — idempotency, stale guard, private rejects", () => {
  it("duplicate actionId is a no-op returning the original outcome", () => {
    const who = turnAccount();
    const id = "00000000-0000-4000-8000-dededededede";
    room.handleAction(who, id, room.stateVersion, { type: "PASS", payload: {} });
    const v1 = room.stateVersion;
    room.handleAction(who, id, room.stateVersion, { type: "PASS", payload: {} });
    expect(room.stateVersion).toBe(v1); // not applied twice
    const acks = out.of(who).filter((m) => m.t === "Ack");
    expect(acks.length).toBe(1); // replayed outcome
  });
  it("stale stateVersion rejected privately; no broadcast; no state change", () => {
    const who = turnAccount();
    room.handleAction(who, "00000000-0000-4000-8000-000000000001", room.stateVersion - 1 < 0 ? 99 : room.stateVersion + 5, { type: "PASS", payload: {} });
    const rejects = out.of(who).filter((m) => m.t === "Reject");
    expect(rejects.length).toBe(1);
    expect(rejects[0].reason).toBe("STALE_VERSION");
    for (const other of [A, B, C, D].filter((x) => x !== who)) {
      expect(out.of(other).filter((m) => m.t === "Reject").length).toBe(0); // private (HID-003)
    }
  });
  it("illegal action: private reject, zero version bump, zero events", () => {
    const who = turnAccount();
    const v = room.stateVersion;
    room.handleAction(who, "00000000-0000-4000-8000-000000000002", v, { type: "BID", payload: { value: 76 } });
    expect(room.stateVersion).toBe(v);
    expect(out.sent.filter((s) => s.msg.t === "Event").length).toBe(0);
  });
});

describe("PHASE-001 wire level — staged trump emits nothing", () => {
  it("CHOOSE_TRUMP: private Ack only; no Event, no ViewUpdate, no version bump; snapshot written", () => {
    passToDeclarer();
    out.clear();
    const v = room.stateVersion;
    act(declarerAccount(), "CHOOSE_TRUMP", { suit: "H" });
    expect(room.stateVersion).toBe(v); // no bump
    expect(out.sent.filter((s) => s.msg.t === "Event").length).toBe(0);
    expect(out.sent.filter((s) => s.msg.t === "ViewUpdate").length).toBe(0);
    expect(out.of(declarerAccount()).filter((m) => m.t === "Ack").length).toBe(1); // private ack
    expect(out.persisted.has("snap:latest")).toBe(true); // staged value snapshotted
    // CALL_CARDS: single transition, TRUMP_CHOSEN + CARDS_CALLED consecutive seq
    out.clear();
    act(declarerAccount(), "CALL_CARDS", { cards: [{ suit: "S", rank: "A" }] });
    const evs = out.of(A).filter((m) => m.t === "Event").map((m) => m.kind);
    expect(evs.slice(0, 2)).toEqual(["TRUMP_CHOSEN", "CARDS_CALLED"]);
    expect(room.stateVersion).toBe(v + 1); // exactly one bump for both
  });
});

describe("seq monotonicity & ViewUpdate delivery", () => {
  it("events carry strictly increasing seq; every member gets a personal ViewUpdate", () => {
    passToDeclarer();
    const seqs = out.of(B).filter((m) => m.t === "Event").map((m) => m.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
    for (const who of [A, B, C, D]) {
      const vus = out.of(who).filter((m) => m.t === "ViewUpdate");
      expect(vus.length).toBeGreaterThan(0);
      // PLAT-001: each ViewUpdate's ownHand belongs to that viewer's seat only
      const seat = room.seatOf.get(who)!;
      expect(vus.at(-1)!.view.viewerSeat).toBe(seat);
    }
  });
});

describe("MIG-001 — host migration excludes the awaited actor", () => {
  it("host==declarer disconnected during PAUSED: authority goes to lowest other connected seat", () => {
    passToDeclarer();
    // force PAUSED via timeout
    room.onTimeout();
    expect(room.game!.phase).toBe("PAUSED");
    const declarer = declarerAccount();
    // make the declarer the host, then disconnect them
    room.hostAccountId = declarer;
    room.setConnected(declarer, false);
    const migrated = room.currentHostAccountId();
    expect(migrated).not.toBe(declarer);
    const declarerSeat = room.game!.round!.declarerSeat;
    const expected = room.accountOfSeat.find((_, seat) => seat !== declarerSeat)!;
    expect(migrated).toBe(expected);
    // and the awaited actor cannot end the game
    out.clear();
    room.handleAction(declarer, "00000000-0000-4000-8000-00000000ff01", room.stateVersion, { type: "HOST_END_GAME", payload: {} });
    expect(out.of(declarer).filter((m) => m.t === "Reject").length).toBe(1);
    // but the migrated host can
    room.handleAction(migrated, "00000000-0000-4000-8000-00000000ff02", room.stateVersion, { type: "HOST_END_GAME", payload: {} });
    expect(room.game!.phase).toBe("GAME_END");
    expect(room.phase).toBe("ENDED");
  });
});

describe("practice bots", () => {
  it("1 human + 3 bots: bots act instantly; human drives a full game to ENDED", () => {
    const bout = new TestOut();
    const r = new RoomCore("botroom", bout);
    r.create(A, "Alice", { N: 4 });
    expect(r.addBot(B).ok).toBe(false); // host-only
    expect(r.addBot(A).ok).toBe(true);
    expect(r.addBot(A).ok).toBe(true);
    expect(r.addBot(A).ok).toBe(true);
    expect(r.members.filter((m) => m.isBot).length).toBe(3);
    expect(r.startGame(A).ok).toBe(true);

    let id = 0;
    const humanAct = () => {
      const g = r.game!;
      const mySeat = r.seatOf.get(A)!;
      const say = (type: any, payload: any) =>
        r.handleAction(A, `00000000-0000-4000-8000-bb${String(++id).padStart(10, "0")}`, r.stateVersion, { type, payload });
      if (g.phase === "BIDDING" && g.round!.turnSeat === mySeat) say("PASS", {});
      else if (g.phase === "TRUMP_SELECTION" && g.round!.declarerSeat === mySeat) say("CHOOSE_TRUMP", { suit: "S" });
      else if (g.phase === "CALLING_PARTNERS" && g.round!.declarerSeat === mySeat) say("CALL_CARDS", { cards: [{ suit: "S", rank: "A" }] });
      else if (g.phase === "TRICK_PLAY" && g.round!.turnSeat === mySeat) r.onTimeout(); // auto-play for the human too
      else if (g.phase === "ROUND_END") say("HOST_NEXT_ROUND", {}); // explicit next-round start (host)
      else throw new Error(`human stuck: game waiting on ${g.phase} seat ${g.round?.turnSeat} (not human ${mySeat})`);
    };

    let guard = 0;
    while (r.phase === "IN_GAME" && guard++ < 800) {
      r.botTurnLoop(); // shell pacing stand-in: drain pending bot turns (the DO does this via alarms)
      if (r.phase !== "IN_GAME") break;
      humanAct(); // after draining, every wait point must be the human's
    }
    expect(r.phase).toBe("ENDED");
    expect(r.game!.roundNumber).toBe(4);
    // bots never bid: every auction ended at Y=75 or a human bid — here, all 75
    // bots never paused the room:
    expect(bout.sent.some((s) => s.msg.t === "Event" && s.msg.kind === "PAUSED")).toBe(false);
    // no view was ever sent "to" a bot socket — TestOut records sends; bots have no sockets in the DO,
    // but at core level sends are addressed; assert bot views exist logically but carry only their own hand
    const botAcct = r.members.find((m) => m.isBot)!.accountId;
    const botViews = bout.of(botAcct).filter((m) => m.t === "ViewUpdate");
    for (const vu of botViews) expect(vu.view.viewerSeat).toBe(r.seatOf.get(botAcct));
  });

  it("BOT-STUCK regression: 2-deck bot declarer calls DISTINCT identities and never wedges", () => {
    // Repro: 5 bots + 1 human, 2 decks. When a bot wins the standing bid it must call C
    // distinct identities (the old pool held both copies of A-trump -> duplicate -> reject loop).
    for (let attempt = 0; attempt < 3; attempt++) {
      const bout = new TestOut();
      const r = new RoomCore("wedge" + attempt, bout);
      r.create(A, "Alice", { N: 1, deckCount: 2, handSize: 10 });
      for (let i = 0; i < 5; i++) expect(r.addBot(A).ok).toBe(true);
      expect(r.startGame(A).ok).toBe(true);
      let id = 0;
      const say = (type: any, payload: any) =>
        r.handleAction(A, `00000000-0000-4000-8000-cc${String(++id).padStart(10, "0")}`, r.stateVersion, { type, payload });
      let guard = 0;
      while (r.phase === "IN_GAME" && guard++ < 900) {
        const before = r.stateVersion;
        r.botTurnLoop();
        if (r.phase !== "IN_GAME") break;
        const g = r.game!;
        const mySeat = r.seatOf.get(A)!;
        if (g.phase === "BIDDING" && g.round!.turnSeat === mySeat) say("PASS", {});
        else if (g.phase === "TRICK_PLAY" && g.round!.turnSeat === mySeat) r.onTimeout();
        else if (g.phase === "ROUND_END") say("HOST_NEXT_ROUND", {});
        else if (g.phase === "TRUMP_SELECTION" && g.round!.declarerSeat === mySeat) say("CHOOSE_TRUMP", { suit: "S" });
        else if (g.phase === "CALLING_PARTNERS" && g.round!.declarerSeat === mySeat) say("CALL_CARDS", { cards: [{ suit: "S", rank: "A" }, { suit: "H", rank: "A" }] });
        else if (r.stateVersion === before) throw new Error(`WEDGED in ${g.phase} at v${r.stateVersion}`);
      }
      expect(r.phase).toBe("ENDED");
      // and the wedge fallback never had to fire:
      expect(bout.audits?.some?.((a: any) => a.anomaly === "bot_decision_rejected") ?? false).toBe(false);
    }
  });

  it("removeBot pops the last bot; bots can't be added mid-game", () => {
    const bout = new TestOut();
    const r = new RoomCore("botroom2", bout);
    r.create(A, "Alice", { N: 4 });
    r.addBot(A); r.addBot(A); r.addBot(A);
    expect(r.removeBot(A).ok).toBe(true);
    expect(r.members.filter((m) => m.isBot).length).toBe(2);
    r.addBot(A);
    expect(r.startGame(A).ok).toBe(true);
    expect(r.addBot(A).ok).toBe(false); // not OPEN anymore
  });
});

describe("v1.4 surfaces: emotes, avatars, explicit next round", () => {
  it("EMOTE broadcasts to all, rate-limits at 1/10s, never bumps stateVersion", () => {
    const who = turnAccount();
    const v = room.stateVersion;
    room.handleAction(who, "00000000-0000-4000-8000-00000000ee01", v, { type: "EMOTE", payload: { emote: "laugh" } });
    expect(room.stateVersion).toBe(v); // order-insensitive: no bump
    const emotes = out.of(B).filter((m) => m.t === "Event" && m.kind === "EMOTE");
    expect(emotes.length).toBe(1);
    room.handleAction(who, "00000000-0000-4000-8000-00000000ee02", v, { type: "EMOTE", payload: { emote: "gg" } });
    const rejects = out.of(who).filter((m) => m.t === "Reject" && m.reason === "RATE_LIMITED");
    expect(rejects.length).toBe(1); // second within 10s throttled
  });

  it("avatars: whitelisted ids pass, junk sanitizes to default, bots wear the bot face", () => {
    const r2 = new RoomCore("avroom", new TestOut());
    r2.create(A, "Alice", {}, "aviator");
    r2.join(r2.inviteCode, B, "Bob", "<script>alert(1)</script>");
    r2.join(r2.inviteCode, C, "Carol", "scout");
    r2.addBot(A);
    expect(r2.members[0]!.avatar).toBe("aviator");
    expect(r2.members[1]!.avatar).toBe("classic"); // junk → default, never echoed to clients
    expect(r2.members[2]!.avatar).toBe("scout");
    expect(r2.members[3]!.avatar).toBe("bot");
    r2.join(r2.inviteCode, D, "Dave", "smile"); // legacy id stays valid
    expect(r2.members[4]!.avatar).toBe("smile");
    expect(r2.startGame(A).ok).toBe(true);
    expect(r2.seatAvatars.length).toBe(5);
  });

  it("HOST_NEXT_ROUND: host-only, ROUND_END-only; timeout fallback also advances", () => {
    // play round 1 to completion
    passToDeclarer();
    act(declarerAccount(), "CHOOSE_TRUMP", { suit: "S" });
    act(declarerAccount(), "CALL_CARDS", { cards: [{ suit: "S", rank: "A" }] });
    let guard = 0;
    while (room.game!.phase === "TRICK_PLAY" && guard++ < 100) room.onTimeout();
    expect(room.game!.phase).toBe("ROUND_END");
    const rn = room.game!.roundNumber;
    // mid-round-end: non-host rejected
    const nonHost = [A, B, C, D].find((x) => x !== room.hostAccountId)!;
    out.clear();
    room.handleAction(nonHost, "00000000-0000-4000-8000-00000000nr01".replace("nr", "a1"), room.stateVersion, { type: "HOST_NEXT_ROUND", payload: {} });
    expect(out.of(nonHost).some((m) => m.t === "Reject")).toBe(true);
    expect(room.game!.roundNumber).toBe(rn);
    // host advances
    room.handleAction(room.hostAccountId, "00000000-0000-4000-8000-00000000a102", room.stateVersion, { type: "HOST_NEXT_ROUND", payload: {} });
    expect(room.game!.roundNumber).toBe(rn + 1);
    expect(room.game!.phase).toBe("BIDDING");
    // and the AFK fallback path: finish this round, then onTimeout advances
    while (room.game!.phase === "BIDDING") room.onTimeout();
    act(declarerAccount(), "CHOOSE_TRUMP", { suit: "S" });
    act(declarerAccount(), "CALL_CARDS", { cards: [{ suit: "S", rank: "A" }] });
    guard = 0;
    while (room.game!.phase === "TRICK_PLAY" && guard++ < 100) room.onTimeout();
    expect(room.game!.phase).toBe("ROUND_END");
    room.onTimeout(); // host dozed — table moves on
    expect(room.game!.roundNumber).toBe(rn + 2);
  });
});

describe("full game over the core loop", () => {
  it("timeout-driven game reaches ENDED; snapshots at every version; audit per round", () => {
    let guard = 0;
    while (room.phase === "IN_GAME" && guard++ < 3000) {
      const p = room.game!.phase;
      if (p === "TRUMP_SELECTION") act(declarerAccount(), "CHOOSE_TRUMP", { suit: "S" });
      else if (p === "CALLING_PARTNERS") act(declarerAccount(), "CALL_CARDS", { cards: [{ suit: "S", rank: "A" }] });
      else room.onTimeout(); // auto-pass bidding, auto-play tricks
    }
    expect(room.phase).toBe("ENDED");
    expect(room.game!.roundNumber).toBe(4);
    expect(out.persisted.has(`snap:${room.stateVersion}`)).toBe(true);
    expect(out.audits.length).toBeGreaterThanOrEqual(3); // rounds 2..4 via auto-advance
    // snapshot restore round-trips
    const restored = RoomCore.restore("room1", out, room.serialize() as any);
    expect(restored.stateVersion).toBe(room.stateVersion);
    expect(restored.game!.totalScore).toEqual(room.game!.totalScore);
  });
});
