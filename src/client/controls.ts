// Seat keys for online games. The game reads each player's keys from its controls table (ten per player, which the
// player can change in the game's controls menu), so online every player's own presses are translated to their
// seat's keys before they are sent. A player may use either player's default layout on their own keyboard.
import type { Runtime } from '../engine/runtime.ts';
import { keyArgToName } from '../engine/io.ts';

/** The table's default rows: Player 1, then Player 2. Empty slots are unused buttons. */
export const DEFAULT_KEYS: string[][] = [
  ['left arrow', 'space', 'down arrow', 'right arrow', 'Z', 'X', 'C', 'up arrow', '', ''],
  ['V', 'F', 'B', 'N', 'A', 'D', 'S', 'G', '', ''],
];

const BOUND = new Set(DEFAULT_KEYS.flat().filter((k) => k !== ''));

/** The keys the game reads for a seat right now, from its controls table. */
export function seatKeys(rt: Runtime, seat: number): string[] {
  const list = (rt.stage.l[rt.stage.sprite.def.varNames?.playercontrols ?? 'playercontrols'] ?? []) as unknown[];
  return Array.from({ length: 10 }, (_, i) => {
    const k = list[seat * 10 + i];
    return k === undefined || k === '' ? '' : keyArgToName(k as string);
  });
}

/**
 * Replaces each pressed key of either default layout with the seat's key for the same button. Other keys pass
 * through unchanged.
 */
export function translateKeys(pressed: string[], seat: number, rt: Runtime): string[] {
  const target = seatKeys(rt, seat);
  const out = new Set<string>();
  for (const layout of DEFAULT_KEYS) layout.forEach((k, i) => k && target[i] && pressed.includes(k) && out.add(target[i]));
  for (const k of pressed) if (!BOUND.has(k)) out.add(k);
  return [...out];
}
