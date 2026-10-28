// The game's data and the StarHermit platform, on the runtime's modules (what
// js/platform.js did over the JS SDK and localStorage):
// - the save (starhermit:storage `saves`, schema 1: on the device and in the
//   player's cloud slot) is the checksummed progress document (js/progress.js:
//   stages, lessons, daily bests, achievements, rating, long-road total); two
//   devices' saves merge on a conflict (mergeProgress, as the browser build
//   merged on its saveconflict); the slot the browser build wrote through the
//   JS SDK (game:<slug>, the same document as JSON) shows as foreign: it is
//   merged in and replaced once;
// - the game's own options (colour palette, left-handed pad, haptics,
//   tutorial hints) are engine `settings` (synced with the account); the
//   browser build's values in the account's settings KV (platform.js
//   PREF_KEYS) are adopted (unless set here since), then all its KV keys are
//   removed (volumes, graphics, language, reduced motion, contrast and larger
//   text are the runtime's Options);
// - the player, the invite link, the platform's clock for the Daily, posting a
//   finished round's total through server.js (a practice session whose socket
//   carries { type: 'result', scores }, as the JS SDK's submitScores did) with
//   the rank;
// - rooms and the bound session's game socket for js/online.js (`adapter`).
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, rooms, serverNow, serverTime, sessions,
  type GameSocket, type Leaderboard, type Room, type RoomSocket,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { P, type Options, type Progress } from "./game.ts";

// --- the save --------------------------------------------------------------------------------
let data: Progress = P.freshProgress();
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    P.stamp(data);
    saves.save(data as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** The live progress (change it, then persist()). */
export function progress(): Progress { return data; }
/** Saves (the device at once, the account debounced by the runtime). */
export function persist(): void { write(); }
function adopt(other: unknown): boolean {
  const o = P.readProgress(other);
  const next = P.mergeProgress(data, o);
  if (P.sameProgress(next, data)) return false;
  data = next;
  write();
  return true;
}
saves.onConflict((mine, remote) => ({
  merged: P.mergeProgress(P.readProgress(mine?.data ?? null), P.readProgress(remote.data)) as unknown as JsonValue,
}));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});
/** The browser build's cloud progress: merged with this device's save, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = old.text != null ? P.readForeign(old.text) : null;
  let grew = false;
  if (doc) {
    const next = P.mergeProgress(data, doc);
    grew = !P.sameProgress(next, data);
    data = next;
  }
  write({ replaceForeign: true });
  if (grew) merged();
}
/** The status-bar sync word (platform.js accountLine): saving / synced / offline. */
export function syncState(): "saving" | "synced" | "offline" {
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "foreign" || st === "uploading" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's options -----------------------------------------------------------------------
export const options: Options = { ...P.DEFAULT_OPTIONS };
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
function readOption(key: keyof Options): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = P.pickOptions({ [key]: v })[key];
  if (ok !== undefined) (options as unknown as Record<string, unknown>)[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: keyof Options, value: unknown): void {
  const v = P.pickOptions({ [key]: value })[key];
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v as JsonValue);
    (options as unknown as Record<string, unknown>)[key] = v;
    optionsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  if (options[key] === value) return;
  options[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
  optionsChanged();
}
/** The browser build's settings KV: the game's options carry over (unless set here since), then all its keys go. */
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  const kv: Record<string, unknown> = {};
  for (const k of keys) kv[k] = store.legacy(k);
  for (const [k, v] of Object.entries(P.pickOptions(kv))) adoptOption(k as keyof Options, v);
  for (const k of keys) if (P.BROWSER_KEYS.includes(k)) store.removeLegacy(k);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  data = P.readProgress(cur?.data ?? null);
  for (const k of P.OPTION_KEYS) readOption(k);
  store.onChange((k) => {
    if (!(P.OPTION_KEYS as string[]).includes(k)) return;
    readOption(k as keyof Options);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().then(() => undefined, () => undefined);
}

// --- the player and the clock -----------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function userId(): string | null { return player()?.userId ?? null; }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
const playerListeners = new Set<() => void>();
export function onPlayer(fn: () => void): void { playerListeners.add(fn); }
onPlayerChange(() => { refreshPlayer(); for (const fn of playerListeners) fn(); });

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's UTC day). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the high-score board ---------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface Posted { posted: boolean; rank: number | null }
/** Signed in only: post a finished round's total through server.js; { posted, rank }. Never rejects. */
export async function postScore(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (d) => {
        const m = d as { type?: string; accepted?: string[] } | null;
        if (m && m.type === "result-ack") finish(Array.isArray(m.accepted) ? m.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

// --- rooms and the game socket (js/online.js's platform) ------------------------------------
interface RoomHandlers { onOpen?: () => void; onDown?: () => void; onRoster?: (room: Room) => void; onStopped?: (reason: string) => void }
interface GameHandlers {
  onOpen?: () => void; onDown?: () => void; onMessage?: (data: unknown) => void; onError?: (message: string) => void; onStopped?: (reason: string) => void;
}
export const adapter = {
  get userId(): string | null { return userId(); },
  createRoom: (cfg: { teamCount: number; seatsPerTeam: number; backfillAiPlayers: boolean; metadata: JsonValue }): Promise<Room> =>
    rooms.create({ ...cfg, isVisible: true }),
  openRoom: (id: string): Promise<Room> => rooms.open(id),
  startRoom: (id: string): Promise<Room> => rooms.start(id),
  leaveRoom: (id: string): Promise<void> => rooms.leave(id),
  getRoom: (id: string): Promise<Room | null> => rooms.get(id),
  quickJoin: (shape: { teamCount: number; seatsPerTeam: number }): Promise<Room | null> => rooms.quickJoin(shape),
  myRoom: (): Promise<Room | null> => rooms.mine(),
  connectRoom(roomId: string, h: RoomHandlers): { close(): void } {
    let socket: RoomSocket | null = null;
    try { socket = rooms.connect(roomId); } catch { queueMicrotask(() => h.onStopped?.("connect")); }
    if (socket) {
      socket.on("open", () => h.onOpen?.());
      socket.on("disconnected", () => h.onDown?.());
      socket.on("roster", (room) => h.onRoster?.(room));
      socket.on("stopped", (reason) => h.onStopped?.(reason));
    }
    return { close(): void { try { socket?.close(); } catch { /* gone */ } socket = null; } };
  },
  connectGame(sessionId: string, h: GameHandlers): { send(data: JsonValue): boolean; input(data: { [k: string]: JsonValue }): boolean; close(): void } {
    let socket: GameSocket | null = null;
    try { socket = connectGame(sessionId); } catch { queueMicrotask(() => h.onStopped?.("connect")); }
    if (socket) {
      socket.on("open", () => h.onOpen?.());
      socket.on("disconnected", () => h.onDown?.());
      socket.on("game", (d) => h.onMessage?.(d));
      socket.on("error", (message) => h.onError?.(message));
      socket.on("stopped", (reason) => h.onStopped?.(reason));
      socket.on("abandoned", (reason) => h.onStopped?.(`abandoned:${reason}`));
    }
    return {
      send(d: JsonValue): boolean { try { return !!socket && socket.state === "open" && socket.sendCommand(d); } catch { return false; } },
      input(d: { [k: string]: JsonValue }): boolean { try { return !!socket && socket.state === "open" && socket.sendInput(d); } catch { return false; } },
      close(): void { try { socket?.close(); } catch { /* gone */ } socket = null; },
    };
  },
};
