// Simulated network test for the rollback session: two peers on one virtual clock with latency,
// jitter, loss and clock drift. Each peer plays its seat's keys from a recorded scenario, and the
// test checks both end in the same state.
// Usage: npx tsx tools/netsim.ts [peers] [frames] [latencyMs] [jitterMs] [loss] [dropAt] [scenario]
import fs from 'node:fs';
import path from 'node:path';
import { createPort, InputTimeline, T0, type Scenario } from './lib/port.ts';
import { RollbackSession, snapshotHash } from '../src/net/rollback.ts';
import { saveSnapshot } from '../src/engine/snapshot.ts';
import { Rng } from '../src/engine/rng.ts';
import type { PlayerInput } from '../src/engine/io.ts';
import { DEFAULT_KEYS, translateKeys } from '../src/client/controls.ts';
import { seatScreen } from '../src/game/screens.ts';

const peers = Math.min(2, Number(process.argv[2] ?? 2));
const frames = Number(process.argv[3] ?? 2400);
const latency = Number(process.argv[4] ?? 60);
const jitter = Number(process.argv[5] ?? 20);
const loss = Number(process.argv[6] ?? 0.05);
const scenarioFile = process.argv[8] ?? 'tests/scenarios/vs-1-2-s1.json';
const scenario: Scenario = JSON.parse(fs.readFileSync(path.resolve(scenarioFile), 'utf8'));
const seed = scenario.seed;
const FRAME = 1000 / 30;

/**
 * Seat 1 plays the scenario's Player 2 keys, and seat 0 plays every other key. Seat 0 also drives the mouse and
 * answers the game's questions, as the first seat does in the page (src/client/online.ts).
 */
function scriptFor(seat: number): (tick: number) => PlayerInput {
  const tl = new InputTimeline(scenario.events);
  const p2 = new Set(DEFAULT_KEYS[1].filter((k) => k !== ''));
  return (tick) => {
    const inp = tl.inputsFor(tick + 1)[0] ?? { keys: [] };
    const rt = sessions[seat].rt;
    const out: PlayerInput = { keys: translateKeys(inp.keys.filter((k) => p2.has(k) === (seat === 1)), seatScreen(rt) ? seat : 0, rt) };
    if (seat === 0 && inp.mouse) out.mouse = inp.mouse;
    if (seat === 0 && inp.answer !== undefined) out.answer = inp.answer;
    return out;
  };
}

interface Ev {
  t: number;
  kind: 'tick' | 'packet';
  peer: number;
  data?: ArrayBuffer;
  seq: number;
}
const queue: Ev[] = [];
let seq = 0;
function push(e: Omit<Ev, 'seq'>): void {
  queue.push({ ...e, seq: seq++ });
}
function pop(): Ev | undefined {
  let best = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i].t < queue[best].t || (queue[i].t === queue[best].t && queue[i].seq < queue[best].seq)) best = i;
  return queue.splice(best, 1)[0];
}

const netRng = new Rng(7);
let now = 0;
const seats = Array.from({ length: peers }, (_, i) => i);
const sessions = seats.map((seat) => {
  const rt = createPort(seed);
  rt.logPen = false;
  rt.greenFlag();
  return new RollbackSession({
    rt,
    local: seat,
    seats,
    delay: 2,
    maxPrediction: 10,
    now: () => now,
    transport: {
      send(to, data) {
        if (netRng.next() < loss) return;
        const delay = latency / 2 + netRng.next() * jitter;
        push({ t: now + delay, kind: 'packet', peer: to, data });
      },
    },
  });
});
// With --jumps, record each frame's drawn targets as first shown and as finally corrected, to find what visibly
// jumps when a rollback corrects a prediction.
const jumps = process.argv.includes('--jumps');
type Seen = Map<number, { battle: boolean; targets: Map<string, string> }>;
const firstSeen: Seen[] = seats.map(() => new Map());
const finalSeen: Seen[] = seats.map(() => new Map());
const v = (x: RollbackSession, n: string) => String(x.rt.stage.v[x.rt.stage.sprite.def.varNames?.[n] ?? n]);
const inBattle = (x: RollbackSession) => x.rt.targets.some((t) => t.name === 'player1' && t.isOriginal && t.visible);
if (jumps) {
  sessions.forEach((s, i) => {
    s.onFrame = (f, resim) => {
      const rt = s.rt;
      const targets = new Map<string, string>();
      for (const t of rt.drawList) {
        if (!t.visible) continue;
        const key = `${t.name}#${t.sprite.clones.indexOf(t)}`;
        targets.set(key, `${Math.round(t.x)},${Math.round(t.y)},${t.costumeName()},${Math.round(t.effects.ghost)},${Math.round(t.effects.brightness)}`);
      }
      const rec = { battle: inBattle(s), targets };
      if (!resim) firstSeen[i].set(f, rec);
      finalSeen[i].set(f, rec);
    };
  });
}
const scripts = seats.map(scriptFor);
const ticks = seats.map(() => 0);
const stalledTicks = seats.map(() => 0);
const drift = seats.map((s) => 1 + (s - (peers - 1) / 2) * 0.002);
seats.forEach((s) => push({ t: s * 7, kind: 'tick', peer: s }));

// Optional 7th argument: the last seat disconnects at this tick, and the host drops it after 5 s.
const dropAt = Number(process.argv[7] ?? 0);
const leaver = peers - 1;
const gone = new Set<number>();
let dropSent = false;
const dropEvents: { t: number; peer: number; frame: number; data: ArrayBuffer }[] = [];

const started = performance.now();
let lastProbe = 0;
while (queue.length || dropEvents.length) {
  dropEvents.sort((a, b) => a.t - b.t);
  if (dropEvents.length && (!queue.length || dropEvents[0].t <= Math.min(...queue.map((q) => q.t)))) {
    const d = dropEvents.shift()!;
    now = d.t;
    if (!sessions[d.peer].applyDrop(leaver, d.frame, d.data)) console.log(`seat ${d.peer} could not apply the drop`);
    continue;
  }
  const e = pop()!;
  now = e.t;
  if (gone.has(e.peer)) continue;
  const s = sessions[e.peer];
  if (e.kind === 'packet') {
    s.receive(e.data!);
    continue;
  }
  if (dropAt && e.peer === leaver && ticks[e.peer] >= dropAt) {
    gone.add(e.peer);
    continue;
  }
  // Like the page, a tick that does not advance offers the same input again next time.
  if (s.tick(scripts[e.peer](ticks[e.peer]))) ticks[e.peer]++;
  else stalledTicks[e.peer]++;
  if (dropAt && e.peer === 0 && !dropSent && gone.has(leaver) && s.stats.silentFor[leaver] > 5000) {
    const offer = s.dropOffer(leaver);
    s.applyDrop(leaver, offer.frame, offer.data);
    for (const p of seats) if (p !== 0 && p !== leaver) dropEvents.push({ t: now + latency, peer: p, frame: offer.frame, data: offer.data });
    dropSent = true;
    console.log(`host dropped seat ${leaver} after frame ${offer.frame} (host at frame ${s.frame})`);
  }
  if (now - lastProbe > 1000) {
    sessions.forEach((x, i) => !gone.has(i) && x.probe());
    lastProbe = now;
  }
  const done = sessions.every((x, i) => gone.has(i) || x.confirmedFrame() >= frames);
  if (!done && ticks[e.peer] + stalledTicks[e.peer] < frames * 3) push({ t: now + FRAME * drift[e.peer], kind: 'tick', peer: e.peer });
}

// Every remaining peer's state at the common confirmed frame must agree.
const live = sessions.filter((_, i) => !gone.has(i));
const target = Math.min(...live.map((x) => x.confirmedFrame()));
const hashes = live.map((x) => {
  const snap = (x as unknown as { snaps: Map<number, ReturnType<typeof saveSnapshot>> }).snaps.get(target);
  return snap ? snapshotHash(snap) : -1;
});
const agree = hashes.every((h) => h === hashes[0] && h !== -1);
if (!agree) {
  // Find the first retained frame where seat 0 and seat 1 differ, and show what differs.
  const a = (sessions[0] as unknown as { snaps: Map<number, any> }).snaps;
  const b = (sessions[1] as unknown as { snaps: Map<number, any> }).snaps;
  const common = [...a.keys()].filter((f) => b.has(f)).sort((x, y) => x - y);
  for (const f of common) {
    if (snapshotHash(a.get(f)) !== snapshotHash(b.get(f))) {
      const ja = a.get(f);
      const jb = b.get(f);
      console.log(`first retained differing frame ${f} (retained ${common[0]}..${common[common.length - 1]})`);
      for (const k of Object.keys(ja)) {
        const sa = JSON.stringify(ja[k]);
        const sb = JSON.stringify(jb[k]);
        if (sa !== sb) {
          let i = 0;
          while (i < sa.length && sa[i] === sb[i]) i++;
          console.log(`  ${k} differs at char ${i}: ...${sa.slice(Math.max(0, i - 150), i + 150)}\n  vs ...${sb.slice(Math.max(0, i - 150), i + 150)}`);
        }
      }
      break;
    }
  }
  console.log('scores', sessions.map((x) => [v(x, '1SCORE'), v(x, '2SCORE')]));
}
const st = sessions.map((x) => x.stats);
console.log(`peers=${peers} frames=${target} latency=${latency}+${jitter}ms loss=${loss} wall=${((performance.now() - started) / 1000).toFixed(1)}s`);
st.forEach((x, i) => console.log(`  seat ${i}: frame ${x.frame} rollbacks ${x.rollbacks} rolled ${x.rolledFrames} stalls ${x.stalls} adv ${x.advantage.toFixed(2)} desync ${x.desync ? JSON.stringify(x.desync) : 'none'}`));
if (jumps) {
  seats.forEach((seat) => {
    const byTarget = new Map<string, { menus: number; battle: number; example: string }>();
    let menuFrames = 0;
    let corrected = 0;
    for (const [f, first] of firstSeen[seat]) {
      const fin = finalSeen[seat].get(f)!;
      if (!first.battle) menuFrames++;
      let any = false;
      for (const [k, a] of first.targets) {
        const b = fin.targets.get(k);
        if (a === b) continue;
        any = true;
        const e = byTarget.get(k) ?? { menus: 0, battle: 0, example: '' };
        if (first.battle) e.battle++;
        else e.menus++;
        if (!e.example) e.example = `frame ${f}: shown ${a}, corrected ${b ?? 'hidden'}`;
        byTarget.set(k, e);
      }
      if (any) corrected++;
    }
    const top = [...byTarget.entries()].sort((a, b) => b[1].battle - a[1].battle).slice(0, 8);
    console.log(`  seat ${seat}: ${corrected} frames showed something a correction moved (${menuFrames} menu frames); most in battle:`);
    for (const [k, e] of top) console.log(`    ${k}: ${e.battle} battle frames, ${e.menus} menu frames (${e.example})`);
  });
}
live.forEach((x, i) => console.log(`  seat ${i} game: battle ${inBattle(x)} scores ${v(x, '1SCORE')}/${v(x, '2SCORE')}`));
console.log(agree ? `STATES AGREE at frame ${target} (${hashes[0].toString(16)})` : `STATES DIFFER at frame ${target}: ${hashes.map((h) => h.toString(16)).join(' ')}`);
if (!agree || st.some((x) => x.desync)) process.exitCode = 1;
void T0;
