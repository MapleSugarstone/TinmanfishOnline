// Owns one simulation plus everything that presents it: renderer, audio and overlays.
import { Runtime, FRAME_MS } from '../engine/runtime.ts';
import type { PlayerInput } from '../engine/io.ts';
import { modules, monitors } from '../game/generated/index.ts';
import { skins } from '../game/assets.ts';
import { installSilhouettes, type SilhouetteData } from '../game/silhouettes.ts';
import { pauseRule } from '../game/pause.ts';
import silhouetteData from '../game/silhouettes-data.json';
import { WebGLRenderer } from '../render/webgl.ts';
import { EFFECT_BITS } from '../render/shaders.ts';
import { AudioOut } from './audio.ts';
import { Bubbles, ListMonitors, PauseMenu, QuestionBox, VarMonitors } from './overlays.ts';

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

export interface GameOptions {
  seed: number;
  /** Simulation start time; also drives the date blocks. */
  t0: number;
}

export class Game {
  rt: Runtime;
  renderer: WebGLRenderer;
  audio: AudioOut;
  question: QuestionBox;
  lists: ListMonitors;
  vars: VarMonitors;
  bubbles: Bubbles;
  pause: PauseMenu;

  constructor(
    public canvas: HTMLCanvasElement,
    public overlay: HTMLElement,
    opts: GameOptions,
  ) {
    this.rt = Game.createRuntime(opts);
    this.renderer = new WebGLRenderer(canvas, skins);
    this.audio = new AudioOut();
    this.question = new QuestionBox(overlay);
    this.lists = new ListMonitors(overlay, monitors);
    this.vars = new VarMonitors(overlay, monitors);
    this.bubbles = new Bubbles(overlay);
    this.pause = new PauseMenu(overlay, pauseRule);
  }

  static createRuntime(opts: GameOptions): Runtime {
    const rt = new Runtime(modules, skins, { seed: opts.seed, t0: opts.t0, pause: pauseRule });
    installSilhouettes(rt, silhouetteData as unknown as SilhouetteData);
    rt.greenFlag();
    return rt;
  }

  /**
   * Loads and decodes every image and sound, then uploads every texture, so no frame of play waits on an asset.
   */
  async load(onProgress: (done: number, total: number) => void): Promise<void> {
    const counts = { images: [0, skins.length], sounds: [0, this.rt.sprites.reduce((n, s) => n + s.sounds.length, 0)] };
    const report = () => onProgress(counts.images[0] + counts.sounds[0], counts.images[1] + counts.sounds[1]);
    this.renderer.startLoading(ASSET_BASE, (d, n) => ((counts.images = [d, n]), report()));
    this.audio.startLoading(this.rt, ASSET_BASE, (d, n) => ((counts.sounds = [d, n]), report()));
    await Promise.all([this.renderer.loadNow(skins.map((_, i) => i)), this.audio.allLoaded()]);
    this.renderer.warmUp([EFFECT_BITS.color, EFFECT_BITS.ghost, EFFECT_BITS.color | EFFECT_BITS.ghost]);
  }

  step(inputs: PlayerInput[]): void {
    this.rt.stepFrame(inputs);
  }

  present(): void {
    this.audio.apply(this.rt.soundEvents);
    this.audio.sync(this.rt.currentMSecs);
    this.renderer.render(this.rt);
    this.question.update(this.rt);
    this.lists.update(this.rt);
    this.vars.update(this.rt);
    this.bubbles.update(this.rt);
    this.pause.update(this.rt);
  }
}

/** Runs in a worker and posts a message every 4 ms, which keeps arriving in a background tab. */
const HEARTBEAT = 'const beat = () => { postMessage(0); setTimeout(beat, 4); }; beat();';

/** How early a frame may start, so timing noise in screen refreshes cannot push a frame to the next refresh. */
const SLACK_MS = 4;
/** How late a frame may get before the heartbeat runs it, which is longer than a refresh at 50 Hz or more. */
const LATE_MS = 25;

/**
 * Calls `tick` once per frame, every FRAME_MS like the original, then `after` once if any frame ran.
 * Screen refreshes drive the loop, so each frame starts on a refresh and frames stay evenly spaced.
 * Animation frames stop in background tabs and slow down on some screens, so a worker's heartbeat
 * runs any frame that is LATE_MS overdue, or due at all once refreshes stop, and an online match keeps running.
 */
export function startFixedLoop(tick: () => void, after: () => void): () => void {
  const clock = () => performance.timeOrigin + performance.now();
  let next = clock() + FRAME_MS;
  let stopped = false;
  const run = (now: number) => {
    // After a long stall the loop skips ahead rather than playing the missed frames back at once.
    if (now - next > 250) next = now;
    let ran = false;
    while (now >= next - SLACK_MS) {
      tick();
      next += FRAME_MS;
      ran = true;
    }
    if (ran) after();
  };
  let raf = 0;
  let lastRefresh = 0;
  const refresh = (ts: number) => {
    if (stopped) return;
    lastRefresh = clock();
    run(performance.timeOrigin + ts);
    raf = requestAnimationFrame(refresh);
  };
  raf = requestAnimationFrame(refresh);
  const beat = () => {
    const now = clock();
    if (!stopped && now > next + (now - lastRefresh < 100 ? LATE_MS : 0)) run(now);
  };
  let heard = false;
  let timer = 0;
  const worker = new Worker(URL.createObjectURL(new Blob([HEARTBEAT], { type: 'text/javascript' })));
  worker.onmessage = () => {
    heard = true;
    beat();
  };
  // Some embedded browsers never start a worker made from a blob. The page's own timers then
  // give the heartbeat, though they slow down while the tab is in the background.
  const fallback = window.setTimeout(() => {
    if (heard || stopped) return;
    worker.terminate();
    const loop = () => {
      beat();
      if (!stopped) timer = window.setTimeout(loop, 4);
    };
    loop();
  }, 500);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    worker.terminate();
    clearTimeout(fallback);
    clearTimeout(timer);
  };
}
