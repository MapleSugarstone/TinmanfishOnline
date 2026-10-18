// The pause menu's rules for this game. P (Escape on the page) pauses and resumes a battle, also after it ends, and
// K while paused goes back to the title. The game reads neither key. The original only restarts with the green flag,
// so going back is a green flag press.
import type { PauseRule } from '../engine/runtime.ts';
import { inBattle } from './screens.ts';

export const pauseRule: PauseRule = {
  pauseKey: 'P',
  quitKey: 'K',
  quitLabel: 'Back to title',
  canPause: inBattle,
  quit: (rt) => rt.greenFlag(),
};
