// The screen shown before the game starts: play on this computer, or host or join an online room. Also the
// status line and waiting panel shown during an online game.
import type { SeatInfo } from '../net/protocol.ts';
import type { LinkState } from '../net/mesh.ts';
import { cleanName, NAME_MAX, SEATS } from '../net/protocol.ts';

const NAME_KEY = 'tf.name';
const DELAY_KEY = 'tf.delay';
const NAME_RULE = 'Names use letters, numbers, _ and -, as Scratch usernames do.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A made-up name, which online play accepts without a Scratch account. */
function randomName(): string {
  return `player${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
}

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage may be blocked.
  }
}

export interface LobbyHandlers {
  local(): void;
  host(name: string): void;
  join(name: string, code: string): void;
  start(delay: number): void;
  leave(): void;
}

export class Lobby {
  root: HTMLDivElement;
  private status: HTMLDivElement;
  private progress: HTMLDivElement;
  private menu: HTMLDivElement;
  private room: HTMLDivElement;
  private codeOut: HTMLSpanElement;
  private seatList: HTMLUListElement;
  private startBtn: HTMLButtonElement;
  private waitNote: HTMLParagraphElement;
  private nameIn: HTMLInputElement;
  private delayIn: HTMLSelectElement;
  private onlineRows: HTMLElement[];
  private offlineNote: HTMLParagraphElement;
  private loading = true;

  constructor(parent: HTMLElement, private h: LobbyHandlers) {
    this.root = el('div', 'lobby');
    const panel = el('div', 'lobby-panel');
    panel.append(el('h1', 'lobby-title lobby-name', 'Tinmanfish'));

    this.menu = el('div', 'lobby-menu');
    const nameRow = el('label', 'lobby-field');
    nameRow.append(el('span', '', 'Name'));
    this.nameIn = el('input');
    this.nameIn.maxLength = NAME_MAX;
    this.nameIn.spellcheck = false;
    this.nameIn.autocomplete = 'off';
    this.nameIn.autocapitalize = 'off';
    this.nameIn.title = 'Your Scratch username, or player and a number';
    this.nameIn.value = cleanName(load(NAME_KEY, '')) || randomName();
    // Characters a Scratch username cannot hold are dropped as they are typed or pasted.
    this.nameIn.addEventListener('input', () => {
      const v = this.nameIn.value;
      const clean = cleanName(v);
      if (clean === v) return;
      const at = cleanName(v.slice(0, this.nameIn.selectionStart ?? v.length)).length;
      this.nameIn.value = clean;
      this.nameIn.setSelectionRange(at, at);
      this.setStatus(NAME_RULE);
    });
    nameRow.append(this.nameIn);
    const localBtn = el('button', 'primary', 'Play on this computer');
    const hostBtn = el('button', '', 'Host an online game');
    const joinRow = el('div', 'lobby-join');
    const codeIn = el('input');
    codeIn.placeholder = 'Room code';
    codeIn.maxLength = 6;
    codeIn.autocapitalize = 'characters';
    const joinBtn = el('button', '', 'Join');
    joinRow.append(codeIn, joinBtn);
    this.onlineRows = [nameRow, hostBtn, joinRow];
    this.offlineNote = el('p', 'lobby-note', 'Online play is not set up for this copy of the game.');
    this.offlineNote.hidden = true;
    this.menu.append(localBtn, el('div', 'lobby-heading', 'Online'), nameRow, hostBtn, joinRow, this.offlineNote);

    this.room = el('div', 'lobby-room');
    this.room.hidden = true;
    const bar = el('div', 'lobby-bar');
    this.codeOut = el('span', 'code');
    const codeCell = el('span', '', 'Code ');
    codeCell.append(this.codeOut);
    bar.append(el('span', 'lobby-bar-title', 'Online'), codeCell);
    this.seatList = el('ul', 'lobby-seats');
    const opts = el('div', 'lobby-opts');
    const delayRow = el('label', 'lobby-field');
    delayRow.append(el('span', '', 'Input delay'));
    this.delayIn = el('select');
    for (let d = 0; d <= 4; d++) {
      const o = el('option', '', `${d} frame${d === 1 ? '' : 's'} (${Math.round((d * 1000) / 30)} ms)`);
      o.value = String(d);
      this.delayIn.append(o);
    }
    this.delayIn.value = load(DELAY_KEY, '1');
    delayRow.append(this.delayIn);
    opts.append(delayRow);
    this.startBtn = el('button', 'primary', 'Start');
    this.waitNote = el('p', 'lobby-note', 'Waiting for the host to start.');
    const keysNote = el(
      'p',
      'lobby-note',
      'Use the arrow keys with space, Z, X and C, or V, F, B and N with A, D, S and G. Either set controls your own fighter. Player 1 clicks through the menus. Leave the computer opponent off so Player 2 plays.',
    );
    const leaveBtn = el('button', '', 'Leave room');
    leaveBtn.addEventListener('click', () => this.h.leave());
    this.room.append(bar, this.seatList, opts, this.startBtn, this.waitNote, keysNote, leaveBtn);

    this.status = el('div', 'lobby-status');
    this.progress = el('div', 'lobby-progress');
    panel.append(this.menu, this.room, this.status, this.progress);
    this.root.append(panel);
    parent.append(this.root);

    localBtn.addEventListener('click', () => !this.loading && this.h.local());
    hostBtn.addEventListener('click', () => {
      const name = this.name();
      if (name) this.h.host(name);
    });
    const join = () => {
      const name = this.name();
      if (name) this.h.join(name, codeIn.value.trim().toUpperCase());
    };
    joinBtn.addEventListener('click', join);
    codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    this.startBtn.addEventListener('click', () => {
      store(DELAY_KEY, this.delayIn.value);
      this.h.start(Number(this.delayIn.value));
    });
    // Keys typed into the lobby must not reach the game underneath.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.addEventListener('keyup', (e) => e.stopPropagation());
  }

  private name(): string | null {
    const name = cleanName(this.nameIn.value);
    if (!name) {
      this.setStatus(NAME_RULE);
      return null;
    }
    store(NAME_KEY, name);
    return name;
  }

  /** Disables the play buttons while the first images load, with the progress as status. */
  setLoading(loading: boolean, text = ''): void {
    this.loading = loading;
    for (const b of this.menu.querySelectorAll('button')) b.disabled = loading;
    this.setStatus(text);
  }

  setOnline(available: boolean): void {
    for (const r of this.onlineRows) r.hidden = !available;
    this.offlineNote.hidden = available;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** The asset warm-up count under the menu, gone once everything has loaded. */
  setProgress(done: number, total: number): void {
    const text = done >= total ? '' : `Loading images and sounds: ${Math.floor((done / total) * 100)}%`;
    if (this.progress.textContent !== text) this.progress.textContent = text;
  }

  showMenu(): void {
    this.root.classList.remove('in-room');
    this.menu.hidden = false;
    this.room.hidden = true;
  }

  showRoom(code: string, seats: SeatInfo[], local: number, host: number, links: (seat: number) => LinkState | null): void {
    this.root.classList.add('in-room');
    this.menu.hidden = true;
    this.room.hidden = false;
    this.codeOut.textContent = code;
    const items: HTMLLIElement[] = [];
    for (let s = 0; s < SEATS; s++) {
      const info = seats.find((x) => x.seat === s);
      const li = el('li', `seat${info ? '' : ' seat-open'}`);
      li.style.setProperty('--c', `var(--p${s + 1})`);
      li.append(el('span', 'seat-tag', `P${s + 1}`));
      if (!info) li.append(el('span', 'seat-empty', 'Open'));
      else {
        li.append(el('span', 'seat-name', info.name));
        if (s === local) li.append(el('span', 'seat-link', 'you'));
        else if (!info.connected) li.append(el('span', 'seat-link', 'reconnecting'));
        else {
          const state = links(s);
          if (state) li.append(el('span', `seat-link ${state}`, state === 'direct' ? 'direct link' : state === 'relay' ? 'relayed' : 'connecting'));
        }
        if (s === host) li.append(el('span', 'seat-link', 'host'));
      }
      items.push(li);
    }
    this.seatList.replaceChildren(...items);
    const isHost = local === host;
    const ready = seats.filter((x) => x.connected).length >= 2;
    this.startBtn.hidden = !isHost;
    this.startBtn.disabled = !ready;
    this.waitNote.hidden = isHost && ready;
    this.waitNote.textContent = isHost ? 'Waiting for another player to join with the code.' : 'Waiting for the host to start.';
  }

  hide(): void {
    this.root.hidden = true;
  }
}

export class Hud {
  root: HTMLDivElement;
  private line: HTMLSpanElement;
  private warn: HTMLSpanElement;
  private button: HTMLButtonElement;
  private onAction: () => void = () => {};
  private wait: HTMLDivElement;
  private waitTitle: HTMLDivElement;
  private waitText: HTMLParagraphElement;
  private waitButton: HTMLButtonElement;
  private onWait: () => void = () => {};

  constructor(parent: HTMLElement, onLeave: () => void, stage: HTMLElement) {
    this.root = el('div', 'hud');
    this.line = el('span', 'hud-line');
    this.warn = el('span', 'hud-warn');
    this.button = el('button', 'hud-action');
    this.button.hidden = true;
    this.button.addEventListener('click', () => this.onAction());
    const leave = el('button', 'hud-leave', 'Leave game');
    leave.addEventListener('click', onLeave);
    this.root.append(this.line, this.warn, this.button, leave);
    parent.append(this.root);
    this.wait = el('div', 'hud-wait');
    this.wait.hidden = true;
    this.waitTitle = el('div', 'lobby-heading');
    this.waitText = el('p', 'lobby-note');
    this.waitButton = el('button', 'primary');
    this.waitButton.addEventListener('click', () => this.onWait());
    this.wait.append(this.waitTitle, this.waitText, this.waitButton);
    stage.append(this.wait);
  }

  update(text: string, warn: string): void {
    if (this.line.textContent !== text) this.line.textContent = text;
    if (this.warn.textContent !== warn) this.warn.textContent = warn;
  }

  action(label: string | null, onClick: () => void): void {
    this.button.hidden = label === null;
    if (label !== null && this.button.textContent !== label) this.button.textContent = label;
    this.onAction = onClick;
  }

  /** The panel over the stage while the game waits for a player, or nothing for a null title. */
  waiting(title: string | null, text = '', button: { label: string; onClick: () => void } | null = null): void {
    this.wait.hidden = title === null;
    if (title === null) return;
    if (this.waitTitle.textContent !== title) this.waitTitle.textContent = title;
    if (this.waitText.textContent !== text) this.waitText.textContent = text;
    this.waitButton.hidden = !button;
    if (button) {
      if (this.waitButton.textContent !== button.label) this.waitButton.textContent = button.label;
      this.onWait = button.onClick;
    }
  }
}
