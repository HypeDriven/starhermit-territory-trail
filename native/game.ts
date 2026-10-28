// The browser build's pure game modules (shared with the node tests and the
// server script), typed for this client: the rules (js/rules.js: the grid,
// steering commands, the 8-tick-a-second step, claims, cuts, bots, scoring),
// the fixed-step session (js/session.js: command ids, events, Practice undo),
// the content (js/content.js: five themes, 40 Journey stages, four lessons,
// the Daily, practice difficulties, challenges), the progress document and
// the game's options (js/progress.js) and the strings (js/i18n.js).
import * as rules from "../js/rules.js";
import * as session from "../js/session.js";
import * as content from "../js/content.js";
import * as progress from "../js/progress.js";
import * as i18n from "../js/i18n.js";

export type Dir = "up" | "down" | "left" | "right";
export interface Player {
  id: string; name: string; isBot: boolean; x: number; y: number; dir: Dir | null; pendingDir: Dir | null; alive: boolean;
  trail: number[]; area: number; eliminations: number; invalidActions: number; outside: boolean;
}
export interface State {
  version: number; seed: number; width: number; height: number; maxTicks: number; areaGoal: number; tick: number;
  phase: "active" | "ended"; reason: string | null; winner: string | null; cells: number[]; trailOf: number[]; players: Player[];
  commands: unknown[]; hashes: unknown[]; eliminatedOrder: { playerId: string; by: string | null; reason: string; tick: number }[];
}
export interface PlayerDef { id: string; name: string; isBot: boolean }
export interface Config { seed: number; width: number; height: number; maxTicks: number; areaGoal: number; bots?: number }
export interface Theme {
  id: string; name: string; background: string; grid: string; gridLine: string; empty: string; players: string[]; trailGlow: string; ambience: string;
}
export interface Stage extends Config { id: string; index: number; bots: number; par: number; mastery: boolean; theme: string; name: string }
export interface Lesson { id: string; title: string; text: string; requires: "move" | "claim" | "survive" | "cut"; minMoves?: number; minClaims?: number; minTicks?: number; minEliminations?: number; theme: string; config: Config & { bots: number } }
export interface Daily extends Config { id: string; day: string; bots: number; theme: string }
export interface Difficulty { id: string; name: string; bots: number; width: number; height: number; maxTicks: number; areaGoal: number }
export interface Challenge { id: string; name: string; kind: string; config: Config & { bots: number } }
export type SessionEvent = { kind: "input"; dir: Dir } | { kind: "invalid"; reason: string } | { kind: "claim"; playerIndex: number; area: number }
  | { kind: "eliminated" } | { kind: "cut"; playerId: string } | { kind: "ended"; reason: string };
export interface Session {
  config: Config; state: State; localPlayerId: string; accumulator: number; running: boolean; paused: boolean; allowUndo?: boolean;
  events: SessionEvent[]; undoStack: string[];
  onEnd: ((s: State) => void) | null; onSnapshot: ((s: unknown) => void) | null;
  localPlayerIndex(): number; sendDirection(dir: Dir): { ok: boolean; reason?: string };
  undo(): boolean; tickFrame(nowMs: number): void; start(): void; pause(): void; resume(): void; stop(): void;
  envelope(): unknown;
}
export interface Progress {
  version: number; stagesCompleted: Record<string, { score: number; won: boolean; attempts: number }>; lessonsCompleted: Record<string, { done: boolean }>;
  bestDaily: Record<string, { score: number; seed: number; contentVersion: number; duration: number }>; achievements: string[]; rating: number;
  longRoadTotal?: number; checksum: number;
}
export interface Options { palette: "default" | "deuteranopia" | "protanopia" | "tritanopia"; leftHanded: boolean; haptics: boolean; showTutorialHints: boolean }

interface RulesApi {
  PHASE: { ACTIVE: "active"; ENDED: "ended" }; DIRS: Record<Dir, { x: number; y: number }>;
  createGame(o: Config & { players: PlayerDef[] }): State; initHash(s: State): string; step(s: State): State;
  rankPlayers(s: State): number[]; legalDirections(s: State, i: number): Dir[];
  dailySeed(d: Date): { key: number; seed: number; day: string };
}
export const R = rules as unknown as RulesApi;
interface SessionCtor { new (config: Config, defs: PlayerDef[], localId: string): Session }
export const SessionClass = (session as unknown as { Session: SessionCtor }).Session;
export const TICK_MS = (session as unknown as { TICK_MS: number }).TICK_MS;
interface ContentApi {
  THEMES: Theme[]; STAGES: Stage[]; LESSONS: Lesson[]; PRACTICE_DIFFICULTIES: Difficulty[]; CHALLENGES: Challenge[]; CONTENT_VERSION: number;
  dailyChallenge(d: Date): Daily; themeById(id: string): Theme;
}
export const C = content as unknown as ContentApi;
interface ProgressApi {
  freshProgress(): Progress; readProgress(raw: unknown): Progress; readForeign(text: string): Progress | null; stamp(p: Progress): Progress;
  mergeProgress(a: Progress | null, b: Progress | null): Progress; sameProgress(a: unknown, b: unknown): boolean;
  ACHIEVEMENTS: { key: string; name: string; desc: string }[]; unlockAchievement(p: Progress, key: string): boolean;
  PALETTES: Options["palette"][]; DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; pickOptions(raw: unknown): Partial<Options>; BROWSER_KEYS: string[];
}
export const P = progress as unknown as ProgressApi;
type Vars = Record<string, string | number>;
interface I18nApi {
  t(key: string, vars?: Vars): string; setLocale(tag: string): string; locale(): string;
  stageName(s: Stage): string; stageGoal(s: Stage): string; lessonTitle(l: Lesson): string; lessonText(l: Lesson): string;
  difficultyName(d: Difficulty): string; challengeName(c: Challenge): string; challengeGoal(c: Challenge): string;
  playerName(p: { name: string }): string; endReason(code: string | null): string; rejectReason(code: string | undefined): string; dirName(d: string): string;
}
export const L = i18n as unknown as I18nApi;
