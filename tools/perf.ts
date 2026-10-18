// Times the port on a scenario: milliseconds per frame overall and the slowest frames.
// Usage: npx tsx tools/perf.ts <scenario-file>   (add --cpu-prof through NODE_OPTIONS to profile)
import fs from 'node:fs';
import path from 'node:path';
import { createPort, InputTimeline, type Scenario } from './lib/port.ts';

const sc: Scenario = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const rt = createPort(sc.seed);
rt.logPen = false;
rt.greenFlag();
const tl = new InputTimeline(sc.events);
const times: number[] = [];
const t0 = performance.now();
for (let f = 1; f <= sc.frames; f++) {
  const s = performance.now();
  rt.stepFrame(tl.inputsFor(f));
  times.push(performance.now() - s);
}
const total = performance.now() - t0;
const sorted = [...times].sort((a, b) => b - a);
console.log(`${sc.name}: ${sc.frames} frames in ${total.toFixed(0)} ms, ${(total / sc.frames).toFixed(2)} ms per frame, slowest ${sorted.slice(0, 5).map((t) => t.toFixed(1)).join(', ')} ms, 99th ${sorted[Math.floor(sorted.length / 100)].toFixed(1)} ms`);
