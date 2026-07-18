// Shared accessibility preferences. "Large cards" scales every card up across all games (helps players
// who find the default size hard to read). Persisted per-device; components re-render via useCardScale.
import { useEffect, useReducer } from "react";

const KEY = "bq_large_cards";
const LARGE_SCALE = 1.32;

let large = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
const listeners = new Set<() => void>();

export const isLargeCards = (): boolean => large;
export const cardScale = (): number => (large ? LARGE_SCALE : 1);
export function toggleLargeCards(): boolean {
  large = !large;
  try { localStorage.setItem(KEY, large ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l());
  return large;
}

/** Subscribe a component to the current card scale (re-renders on toggle). */
export function useCardScale(): number {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return cardScale();
}
