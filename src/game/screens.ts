// Which screen the game shows, for the page's pause menu. The menus are clicked with the mouse, and only battles
// read keys, so every key always belongs to its player's seat.
import type { Runtime } from '../engine/runtime.ts';

/** A battle, running or over: the fighters are shown from Battle Begin until the green flag. */
export function inBattle(rt: Runtime): boolean {
  return rt.sprites.find((s) => s.name === 'player1')?.original.visible ?? false;
}

/** Keys always belong to their player's seat in this game. */
export function seatScreen(_rt: Runtime): boolean {
  return true;
}
