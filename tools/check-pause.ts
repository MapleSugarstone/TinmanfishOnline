// Checks the pause menu in the port: pausing freezes the battle and its clock, resuming continues it, and going back
// to the title restarts the game, from which a new battle starts.
// Usage: npx tsx tools/check-pause.ts
import { createPort } from './lib/port.ts';
import type { PlayerInput } from '../src/engine/io.ts';
import type { Target } from '../src/engine/target.ts';

const rt = createPort(3);
rt.logPen = false;
rt.greenFlag();
const v = (n: string) => String(rt.stage.v[rt.stage.sprite.def.varNames?.[n] ?? n]);
const step = (inp: PlayerInput) => rt.stepFrame([inp]);
const run = (n: number, keys: string[] = []) => { for (let i = 0; i < n; i++) step({ keys }); };
const tap = (key: string, wait = 15) => { run(3, [key]); run(wait); };
const shown = (name: string) => rt.drawList.find((t) => t.name === name && t.visible);

/** Clicks a pixel of the shown sprite's mask that no other shown sprite covers. */
function click(name: string, wait = 40): void {
  const t = shown(name);
  if (!t) throw new Error(`${name} is not shown`);
  const b = rt.render.aabb(t);
  let at: [number, number] | null = null;
  for (let x = Math.ceil(b.left); x <= Math.floor(b.right) && !at; x++) {
    for (let y = Math.ceil(b.bottom); y <= Math.floor(b.top) && !at; y++) {
      if (x <= -240 || x >= 240 || y <= -180 || y >= 180 || !rt.render.touchingPoint(t, x, y)) continue;
      const above = rt.drawList.slice(rt.drawList.indexOf(t) + 1).some((o: Target) => o.visible && o.effects.ghost < 100 && rt.render.touchingPoint(o, x, y));
      if (!above) at = [x, y];
    }
  }
  if (!at) throw new Error(`no clickable point on ${name}`);
  step({ keys: [], mouse: { x: at[0], y: at[1], down: false } });
  step({ keys: [], mouse: { x: at[0], y: at[1], down: true } });
  run(2);
  step({ keys: [], mouse: { x: at[0], y: at[1], down: false } });
  run(wait);
}
const p1 = () => rt.targets.find((t) => t.name === 'player1' && t.isOriginal)!;
const show = (label: string) => console.log(`${label.padEnd(18)} f=${rt.frame} paused=${rt.paused} clock=${rt.currentMSecs - rt.t0} scores=${v('1SCORE')}/${v('2SCORE')} battle=${p1().visible} x=${p1().x.toFixed(1)}`);
let failures = 0;
const expect = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
};

run(60);
click('Sprite3');
click('Sprite5', 150);
show('battle');
expect(p1().visible, 'the battle starts');
tap('P', 5);
show('paused');
expect(rt.paused, 'P pauses the battle');
const clock = rt.currentMSecs, x = p1().x;
run(90, ['right arrow', 'Z']);
show('paused 90 frames');
expect(rt.currentMSecs === clock && p1().x === x, 'nothing moves and the clock stands still while paused');
tap('P', 30);
show('resumed');
expect(!rt.paused && rt.currentMSecs > clock, 'P again resumes and the clock runs');
tap('P', 5);
tap('K', 60);
show('back to title');
expect(!rt.paused && !p1().visible && !!shown('Sprite3'), 'K while paused goes back to the title');
click('Sprite3');
click('Sprite5', 150);
show('new battle');
expect(p1().visible && v('1SCORE') === '5' && v('2SCORE') === '5', 'a new battle starts with full scores');
console.log(failures ? `${failures} checks failed` : 'pause checks pass');
process.exitCode = failures ? 1 : 0;
