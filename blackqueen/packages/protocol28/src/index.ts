// Wire protocol for 28 — Zod schemas validating every client action before it reaches the room core.
// Kept separate from the Black Queen protocol so the two games can evolve independently.
import { z } from "zod";

export const SuitSchema = z.enum(["C", "D", "H", "S"]);
export const Rank28Schema = z.enum(["7", "8", "Q", "K", "10", "A", "9", "J"]);
export const Card28Schema = z.object({ suit: SuitSchema, rank: Rank28Schema });
export type Card28 = z.infer<typeof Card28Schema>;

/** In-game + host/lobby actions a client may send for a 28 table. */
export const Action28Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BID"), payload: z.object({ value: z.number().int() }) }),
  z.object({ type: z.literal("PASS"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("DEMAND_REDEAL"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("SET_TRUMP"), payload: z.object({ card: Card28Schema }) }),
  z.object({ type: z.literal("RAISE"), payload: z.object({ value: z.number().int() }) }),
  z.object({ type: z.literal("DECLINE_RAISE"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("REVEAL_TRUMP"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("PLAY"), payload: z.object({ card: Card28Schema }) }),
  z.object({ type: z.literal("HOST_NEXT_DEAL"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("HOST_END_GAME"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("EMOTE"), payload: z.object({ emote: z.string().max(24) }) }),
]);
export type Action28 = z.infer<typeof Action28Schema>;

/** Parse a raw socket message into a validated {type,payload} action, or throw. */
export function parseAction28(raw: unknown): Action28 & { actionId: string; playerId: string; stateVersion: number } {
  const env = z.object({
    type: z.string(), roomId: z.string().optional(), playerId: z.string(),
    actionId: z.string(), stateVersion: z.number().int().nonnegative(), payload: z.unknown(),
  }).parse(raw);
  const action = Action28Schema.parse({ type: env.type, payload: env.payload });
  return { ...action, actionId: env.actionId, playerId: env.playerId, stateVersion: env.stateVersion };
}
