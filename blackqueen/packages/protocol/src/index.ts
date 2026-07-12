// MESSAGE_PROTOCOL.md v1.3 — wire contract. Zod-validated at the boundary;
// §2.1 Card encoding enforced at parse time (unicode glyphs rejected).
import { z } from "zod";

export const CardSchema = z.object({
  suit: z.enum(["C", "D", "H", "S"]),
  rank: z.enum(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]),
}).strict();

export const ClientActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BID"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ value: z.number().int() }).strict() }),
  z.object({ type: z.literal("PASS"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({}).strict() }),
  z.object({ type: z.literal("CHOOSE_TRUMP"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ suit: z.enum(["C", "D", "H", "S"]) }).strict() }),
  z.object({ type: z.literal("CALL_CARDS"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ cards: z.array(CardSchema).min(1).max(2) }).strict() }),
  z.object({ type: z.literal("PLAY_CARD"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ card: CardSchema }).strict() }),
  z.object({ type: z.literal("HOST_NEXT_ROUND"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({}).strict() }),
  z.object({ type: z.literal("HOST_END_GAME"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({}).strict() }),
  z.object({ type: z.literal("HOST_RESTART_ROUND"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({}).strict() }),
  z.object({ type: z.literal("HOST_RESOLVE_PAUSE"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ action: z.enum(["resume", "end"]) }).strict() }),
  // UI_SPEC v1.1 §8: six fixed, non-informational emotes; rate-limited server-side; not order-sensitive
  z.object({ type: z.literal("EMOTE"), roomId: z.string(), playerId: z.string(), actionId: z.string().uuid(), stateVersion: z.number().int().nonnegative(), payload: z.object({ emote: z.enum(["hello", "wellplayed", "uhoh", "trusted", "laugh", "gg"]) }).strict() }),
]);
export type ClientAction = z.infer<typeof ClientActionSchema>;

export const RejectReason = z.enum(["ILLEGAL", "STALE_VERSION", "NOT_YOUR_TURN", "DUPLICATE", "RATE_LIMITED"]);
export type RejectReason = z.infer<typeof RejectReason>;

export interface RejectMsg {
  t: "Reject";
  roomId: string;
  actionId: string;
  reason: RejectReason;
  currentStateVersion: number;
}
export interface ViewUpdateMsg {
  t: "ViewUpdate";
  roomId: string;
  stateVersion: number;
  phase: string;
  view: unknown; // engine ClientView (already viewer-filtered)
}
export interface EventMsg {
  t: "Event";
  roomId: string;
  stateVersion: number;
  seq: number;
  kind: string;
  data: unknown;
}
export type ServerMsg = RejectMsg | ViewUpdateMsg | EventMsg;

// Lobby REST payloads
export const CreateRoomSchema = z.object({
  N: z.number().int().min(1).optional(),
  seatAssignment: z.enum(["random", "host-arranged"]).default("random"),
  turnTimerMs: z.number().int().min(5000).default(30000),
  graceMs: z.number().int().min(1000).default(15000),
  deckCount: z.union([z.literal(1), z.literal(2)]).default(1), // GAME_SPEC v2.0 §16; 2 → 6–7 players (validated at start)
  calledCount: z.number().int().min(1).max(3).optional(), // 2-deck only; default 2
  handSize: z.number().int().min(7).max(17).optional(), // v2.1 §3.2; clamped at start to the actual table's legal range
}).strict();
export const JoinRoomSchema = z.object({ code: z.string().length(6) }).strict();
