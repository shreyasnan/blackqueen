// Wire protocol for Teen Patti — Zod schemas validating every client action before the room core sees it.
// Kept separate from the other games so they evolve independently. Same {playerId, actionId,
// stateVersion, payload} envelope as 28 and Black Queen.
import { z } from "zod";

export const SuitSchema = z.enum(["C", "D", "H", "S"]);
export const RankTPSchema = z.enum(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]);
export const CardTPSchema = z.object({ suit: SuitSchema, rank: RankTPSchema });
export type CardTP = z.infer<typeof CardTPSchema>;

export const ActionTPSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SEE"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("BET"), payload: z.object({ amount: z.number().int().nonnegative() }) }),
  z.object({ type: z.literal("PACK"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("SHOW"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("SIDESHOW"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("SIDESHOW_RESPONSE"), payload: z.object({ accept: z.boolean() }) }),
  z.object({ type: z.literal("HOST_NEXT_HAND"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("HOST_END_GAME"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("EMOTE"), payload: z.object({ emote: z.string().max(24) }) }),
]);
export type ActionTP = z.infer<typeof ActionTPSchema>;

export function parseActionTP(raw: unknown): ActionTP & { actionId: string; playerId: string; stateVersion: number } {
  const env = z.object({
    type: z.string(), roomId: z.string().optional(), playerId: z.string(),
    actionId: z.string(), stateVersion: z.number().int().nonnegative(), payload: z.unknown(),
  }).parse(raw);
  const action = ActionTPSchema.parse({ type: env.type, payload: env.payload });
  return { ...action, actionId: env.actionId, playerId: env.playerId, stateVersion: env.stateVersion };
}
