// Territory Trail on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), the fixed-step session
// (js/session.js) and the content (js/content.js) are the browser build's,
// unchanged; this module is what js/main.js did around them — the state
// machine (title → setup / hosted → preparing → countdown → active ⇄ paused →
// results), starting every mode (Journey from Play, the Daily, Learn's four
// lessons; Practice and Challenge as the setup screen offers them), steering
// by keys, pads, swipes, taps and the on-screen pad, the per-tick danger
// state, lesson tracking, the results with progress, achievements and the
// leaderboard post, the title's self-playing rival board, hosted rooms
// (refereed by server.js through js/online.js) and the lifecycle (a hidden
// window pauses a solo round, as visibilitychange did). Screens are drawn by
// screens.ts (starhermit:ui), the board by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the session's 8-tick
// clock, the countdown, the attract board and the toasts run on a clock
// advanced 1000/60 ms per fixed step, so rounds replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { bindings, onAction, onPointerButton, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { C, L, P, R, SessionClass, TICK_MS, type Challenge, type Config, type Difficulty, type Dir, type Lesson, type PlayerDef, type Session, type Stage, type State, type Theme } from "./game.ts";
import * as audio from "./audio.ts";
import { S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";
import { LobbyClient, MatchClient, createRoom, quickJoin, stateFromSnap } from "../js/online.js";

export type Screen = "title" | "modes" | "setup" | "countdown" | "pause" | "results" | "hosted" | "expired" | "none";
export type Overlay = "settings" | "help" | null;
export type Mode = "journey" | "practice" | "daily" | "challenge" | "learn" | "hosted";
export interface ModeData {
  mode: Mode; theme: string; goal: () => string; label: () => string;
  stage?: Stage; difficulty?: Difficulty; challenge?: Challenge; lesson?: Lesson; daily?: { day: string; seed: number };
}
export interface Results {
  state: State; localId: string; rank: number[]; unlocked: string[]; progressText: () => string; lb: platform.Posted | "posting" | null; hosted: boolean;
}
export type Msg = { key: string; vars?: Record<string, string | number> } | { sh: string; vars?: Record<string, string | number> } | null;
export interface Hosted {
  lobby: LobbyClient | null; match: MatchClient | null; room: string | null; status: Msg; busy: boolean;
  state: State | null; prevState: State | null; snapAt: number; table: { seats: { id: string; name: string; ai: boolean; userId: string | null }[] } | null;
}

const PALETTES: Record<string, string[] | null> = {
  default: null,
  deuteranopia: ["#f6c445", "#0072b2", "#d55e00", "#cc79a7", "#009e73", "#e69f00"],
  protanopia: ["#f6c445", "#0072b2", "#d55e00", "#cc79a7", "#009e73", "#e69f00"],
  tritanopia: ["#e64b35", "#4dbbd5", "#00a087", "#3c5488", "#f39b7f", "#8491b4"],
};

export const app = {
  /** boot → title → mode-select → preparing → active ⇄ paused → results (main.js setPhase). */
  phase: "title" as "title" | "mode-select" | "preparing" | "active" | "paused" | "results",
  screen: "title" as Screen,
  overlay: null as Overlay,
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  mode: null as Mode | null,
  modeData: null as ModeData | null,
  setupMode: "learn" as "journey" | "practice" | "challenge" | "learn",
  streak: 0,
  results: null as Results | null,
  hosted: null as Hosted | null,
  hostedScreen: false,
  expired: "expired" as "expired" | "terms",
  drawer: null as "left" | "right" | null,
  countdown: 0,
  exposed: false,
  clock: "",
  mirror: "",
  lesson: null as Lesson | null,
  lessonStats: { moves: 0, claims: 0, eliminations: 0 },
  toast: null as { text: string; until: number } | null,
  attract: null as { state: State; last: number; steps: number } | null,
};
let clockMs = 0;
export const nowMs = (): number => clockMs;
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
/** #sr-announcer: one announcement a frame (the newest lines joined). */
export function announce(text: string): void { if (text) spoken.push(text); }
function flushAnnouncements(): void {
  if (!spoken.length) return;
  const text = spoken.splice(0).slice(-3).join(" ").slice(0, 400);
  try { ui.announce(text); } catch { /* busy */ }
}
export function toast(text: string, ms = 2600): void { app.toast = { text, until: clockMs + ms }; announce(text); }
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built. */
export function later(fn: () => void): void { pending.push(fn); }
/** Every button press acknowledges with the ui clip (the delegated click listener). */
export function click(fn: () => void): () => void { return () => { audio.play("ui"); fn(); }; }

function effectiveTheme(id: string): Theme {
  const base = C.themeById(id);
  const pal = PALETTES[platform.options.palette];
  return pal ? { ...base, players: pal } : base;
}
const reducedMotion = (): boolean => preferences().reducedMotion;
export function inRound(): boolean { return app.phase === "active" && app.screen === "none"; }

// ------------------------------------------------------------------ screens
export function show(name: Screen, focus?: string | null): void {
  app.screen = name;
  app.openedFrame = frame().frame;
  const coarse = frame().width / ui.preferences().scale < 600;
  const def: Partial<Record<Screen, string>> = { title: "btn-play", pause: "btn-resume", results: "btn-retry", expired: "btn-relaunch", modes: "mode-journey" };
  app.focusNext = focus !== undefined ? focus : coarse ? null : (def[name] ?? null);
  ui.setFocus(null);
}
export function openOverlay(o: Overlay): void {
  app.overlay = o;
  app.openedFrame = frame().frame;
  app.focusNext = o ? "btn-overlay-close" : null;
}
export function closeOverlay(): void { app.overlay = null; app.openedFrame = frame().frame; ui.setFocus(null); }
function showHudOnly(): void { app.screen = "none"; app.openedFrame = frame().frame; app.focusNext = null; ui.setFocus(null); }

// ------------------------------------------------------------------ title backdrop: a rival-only round plays itself
const ATTRACT_TICK_MS = 150;
function startAttract(): void {
  const bots: PlayerDef[] = [0, 1, 2, 3].map((i) => ({ id: "a" + i, name: "Demo " + (i + 1), isBot: true }));
  const g = R.createGame({ seed: 9401, width: 26, height: 18, maxTicks: 100000, areaGoal: 0, players: bots });
  R.initHash(g);
  for (let i = 0; i < 160 && g.phase === "active"; i++) R.step(g);
  app.attract = { state: g, last: clockMs, steps: 0 };
  render.buildBoard(g, effectiveTheme("meadow-dawn"));
  render.setAttract(true);
  render.endTick(g);
  render.update(g, 1);
}
function tickAttract(): void {
  const A = app.attract;
  if (!A || app.phase !== "title" || app.session) return;
  if (reducedMotion() || !render.current()?.animated) return;
  if (clockMs - A.last < ATTRACT_TICK_MS) return;
  A.last = clockMs;
  R.step(A.state);
  A.steps++;
  if (A.state.phase !== "active" || A.steps > 1200) { startAttract(); return; }
  render.endTick(A.state);
  render.update(A.state, 1);
}

// ------------------------------------------------------------------ modes
function playerDefs(botCount: number): PlayerDef[] {
  const defs: PlayerDef[] = [{ id: "p1", name: platform.displayName() || "You", isBot: false }];
  for (let i = 0; i < botCount; i++) defs.push({ id: "b" + (i + 1), name: "Rival " + (i + 1), isBot: true });
  return defs;
}
let countdownToken = 0;
function countdown(n: number, done: () => void): void {
  const token = ++countdownToken;
  show("countdown", null);
  let left = n;
  let at = clockMs;
  const step = (): void => {
    if (token !== countdownToken) return;
    if (left === 0) { done(); return; }
    app.countdown = left;
    announce(String(left));
    audio.play("countdown");
    left--;
    at += reducedMotion() ? 400 : 800;
    timers.push({ at, fn: step });
  };
  step();
}
const timers: { at: number; fn: () => void }[] = [];
function beginRound(config: Config, defs: PlayerDef[], md: ModeData): void {
  if (app.session) app.session.stop();
  app.modeData = md;
  app.mode = md.mode;
  app.exposed = false;
  app.results = null;
  const s = new SessionClass(config, defs, "p1");
  s.allowUndo = md.mode === "practice";
  s.onEnd = onRoundEnd;
  app.session = s;
  announce(md.goal());
  app.attract = null;
  render.buildBoard(s.state, effectiveTheme(md.theme));
  render.endTick(s.state);
  render.update(s.state, 1);
  app.phase = "preparing";
  countdown(3, () => { app.phase = "active"; showHudOnly(); s.start(); });
}
export function startJourneyStage(stage: Stage): void {
  beginRound({ seed: stage.seed, width: stage.width, height: stage.height, maxTicks: stage.maxTicks, areaGoal: stage.areaGoal }, playerDefs(stage.bots),
    { mode: "journey", stage, theme: stage.theme, goal: () => L.stageGoal(stage), label: () => T("labelJourney", { n: stage.index, name: L.stageName(stage) }) });
}
export function startPractice(d: Difficulty): void {
  const seed = (Math.floor(platform.nowMs()) % 100000) >>> 0;
  beginRound({ seed, width: d.width, height: d.height, maxTicks: d.maxTicks, areaGoal: d.areaGoal }, playerDefs(d.bots),
    { mode: "practice", difficulty: d, theme: "meadow-dawn", goal: () => T("goalPractice", { name: L.difficultyName(d), n: d.areaGoal }), label: () => T("labelPractice", { name: L.difficultyName(d) }) });
}
export function startDaily(): void {
  const d = C.dailyChallenge(new Date(platform.nowMs()));
  beginRound({ seed: d.seed, width: d.width, height: d.height, maxTicks: d.maxTicks, areaGoal: d.areaGoal }, playerDefs(d.bots),
    { mode: "daily", daily: { day: d.day, seed: d.seed }, theme: d.theme, goal: () => T("goalDaily"), label: () => T("labelDaily", { day: d.day }) });
}
export function startChallenge(c: Challenge): void {
  beginRound({ ...c.config }, playerDefs(c.config.bots),
    { mode: "challenge", challenge: c, theme: "slate-storm", goal: () => L.challengeGoal(c), label: () => T("labelChallenge", { name: L.challengeName(c) }) });
}
export function startLesson(l: Lesson): void {
  app.lesson = l;
  app.lessonStats = { moves: 0, claims: 0, eliminations: 0 };
  beginRound({ ...l.config }, playerDefs(l.config.bots),
    { mode: "learn", lesson: l, theme: l.theme, goal: () => T("goalLesson", { title: L.lessonTitle(l), text: L.lessonText(l) }), label: () => T("labelLearn", { name: L.lessonTitle(l) }) });
}
/** Play: continue the Journey at the first stage not yet won. */
export function play(): void {
  const done = platform.progress().stagesCompleted;
  const next = C.STAGES.find((s) => !(done[s.id] && done[s.id]!.won)) || C.STAGES[C.STAGES.length - 1]!;
  startJourneyStage(next);
}
export function openSetup(mode: "journey" | "practice" | "challenge" | "learn"): void {
  app.phase = "mode-select";
  app.setupMode = mode;
  show("setup", null);
}
export function openModes(): void { app.phase = "mode-select"; show("modes"); }
export function pauseGame(): void {
  if (!app.session || app.phase !== "active") return;
  app.session.pause();
  app.phase = "paused";
  show("pause");
  announce(T("announcePaused"));
}
export function resumeGame(): void {
  if (!app.session) return;
  app.phase = "active";
  showHudOnly();
  app.session.resume();
}
export function restartRound(): void {
  const md = app.modeData;
  if (!md) return;
  if (md.mode === "journey") startJourneyStage(md.stage!);
  else if (md.mode === "practice") startPractice(md.difficulty!);
  else if (md.mode === "daily") startDaily();
  else if (md.mode === "challenge") startChallenge(md.challenge!);
  else if (md.mode === "learn") startLesson(md.lesson!);
}
export function nextRound(): void {
  if (app.mode === "journey" && app.modeData?.stage) {
    const next = C.STAGES.find((s) => s.index === app.modeData!.stage!.index + 1);
    if (next) { startJourneyStage(next); return; }
  }
  goHome();
}
export function leaveRound(): void {
  if (app.session) app.session.stop();
  goHome();
}
export function goHome(): void {
  ++countdownToken;
  timers.length = 0;
  if (app.session) { app.session.stop(); app.session = null; }
  if (app.hosted) hostedLeave();
  app.phase = "title";
  app.exposed = false;
  app.modeData = null;
  app.hostedScreen = false;
  app.overlay = null;
  startAttract();
  show("title");
}
export function undo(): void {
  if (app.session && app.mode === "practice" && app.session.undo()) {
    announce(T("undone"));
    render.buildBoard(app.session.state, effectiveTheme(app.modeData!.theme));
    render.endTick(app.session.state);
    render.update(app.session.state, 1);
  }
}
export function cameraReset(): void { render.resetCamera(); announce(T("cameraReset")); }

// ------------------------------------------------------------------ round end (main.js onRoundEnd)
function onRoundEnd(state: State): void {
  app.phase = "results";
  const rank = R.rankPlayers(state);
  const local = state.players.find((p) => p.id === "p1")!;
  const won = state.winner === "p1";
  const unlocked: string[] = [];
  const prog = platform.progress();
  if (local.area > 9 || local.eliminations > 0) { if (P.unlockAchievement(prog, "first-claim")) unlocked.push("first-claim"); }
  prog.longRoadTotal = (prog.longRoadTotal || 0) + local.area;
  if (prog.longRoadTotal >= 10000 && P.unlockAchievement(prog, "long-road")) unlocked.push("long-road");
  let progressText = (): string => "";
  const score = local.area + local.eliminations * 50;
  const md = app.modeData!;
  if (md.mode === "journey" && md.stage) {
    const sid = md.stage.id;
    // best score and attempts are recorded for every run; a stage only counts as complete once won
    const prev = prog.stagesCompleted[sid] || { score: 0, won: false, attempts: 0 };
    prog.stagesCompleted[sid] = { score: Math.max(prev.score || 0, score), won: !!(prev.won || won), attempts: (prev.attempts || 0) + 1 };
    if (won) {
      app.streak++;
      if (app.streak >= 3 && P.unlockAchievement(prog, "streak-three")) unlocked.push("streak-three");
      if (md.stage.index === 40 && P.unlockAchievement(prog, "chapter-five")) unlocked.push("chapter-five");
    } else app.streak = 0;
    const idx = md.stage.index, best = prog.stagesCompleted[sid]!.score;
    progressText = () => T(won ? "stageComplete" : "stageIncomplete", { n: idx }) + T("bestN", { n: best });
  } else if (md.mode === "learn" && md.lesson) {
    prog.lessonsCompleted[md.lesson.id] = { done: true };
    if (Object.keys(prog.lessonsCompleted).length >= C.LESSONS.length && P.unlockAchievement(prog, "mechanic-mastery")) unlocked.push("mechanic-mastery");
    progressText = () => T("lessonComplete");
  } else if (md.mode === "daily") {
    const d = R.dailySeed(new Date(platform.nowMs()));
    if (!prog.bestDaily[d.day] || score > prog.bestDaily[d.day]!.score) {
      prog.bestDaily[d.day] = { score, seed: d.seed, contentVersion: C.CONTENT_VERSION, duration: state.tick };
      progressText = () => T("newDailyBest", { n: score });
    }
    app.streak = won ? app.streak + 1 : 0;
  } else if (md.mode === "practice") progressText = () => T("practiceUnranked");
  platform.persist();
  audio.play(won ? "win" : "lose");
  const r: Results = { state, localId: "p1", rank, unlocked, progressText, lb: null, hosted: false };
  app.results = r;
  show("results");
  announce(`${resultsHeadline(r)}. ${T("endedBy", { reason: L.endReason(state.reason), tick: state.tick, max: state.maxTicks })}`);
  // signed in: Journey, Daily and Challenge rounds post their total to the high-score board
  if (platform.signedIn() && (md.mode === "journey" || md.mode === "daily" || md.mode === "challenge")) {
    r.lb = "posting";
    void platform.postScore(score).then((res) => { r.lb = res; });
  }
}
export function resultsHeadline(r: Results): string {
  const local = r.state.players.find((p) => p.id === r.localId);
  return r.state.winner === r.localId ? T("victory") : local && !local.alive ? T("eliminated") : T("roundOver");
}
export function resultsLbLine(): string | null {
  const lb = app.results?.lb;
  if (!lb) return null;
  if (lb === "posting") return S("lbPosting");
  return !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted");
}

// ------------------------------------------------------------------ steering
export function sendDir(dir: Dir): void {
  ui.setFocus(null);
  const H = app.hosted;
  if (H && H.match) {
    if (H.match.over || app.phase !== "active") return;
    H.match.steer(dir);
    audio.play("input");
    return;
  }
  if (!app.session || app.phase !== "active") return;
  const res = app.session.sendDirection(dir);
  audio.play(res.ok ? "input" : "invalid");
  if (!res.ok) announce(T("cannotMove", { dir: L.dirName(dir), reason: L.rejectReason(res.reason) }));
  if (res.ok && app.mode === "learn") app.lessonStats.moves++;
}
/** The local player's state (solo: p1; hosted: this player's seat). */
export function localPlayer(): State["players"][number] | null {
  const H = app.hosted;
  if (H && H.state && H.match) { const i = H.match.seat; return i >= 0 ? H.state.players[i] ?? null : null; }
  if (app.session) { const i = app.session.localPlayerIndex(); return i >= 0 ? app.session.state.players[i] ?? null : null; }
  return null;
}
export function viewState(): State | null {
  if (app.phase === "results" && app.results) return app.results.state;
  if (app.hosted?.state && app.hosted.match) return app.hosted.state;
  return app.session?.state ?? null;
}

// ------------------------------------------------------------------ keys and pads (main.js keydown routing)
const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
/** The help cards' key labels over the effective bindings (the runtime's rebinding). */
export function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join("/") || "—";
}
const DIR_ACTIONS: Record<string, Dir> = { up: "up", down: "down", left: "left", right: "right" };
onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const dir = DIR_ACTIONS[e.action];
  if (dir && app.phase === "active" && app.screen === "none" && !app.overlay) { later(() => sendDir(dir)); return; }
  if (app.overlay) { if (e.action === "pause" && fresh()) later(closeOverlay); return; }
  if (app.drawer) { if (e.action === "pause") later(() => { app.drawer = null; }); return; }
  if (e.action === "pause") {
    if (app.phase === "active" && app.screen === "none") later(pauseGame);
    else if (app.phase === "paused" && fresh()) later(resumeGame);
    return;
  }
  if (e.action === "undo" && app.phase === "active" && app.mode === "practice") later(undo);
  if (e.action === "camera" && app.phase === "active") later(cameraReset);
});

// ------------------------------------------------------------------ swipe / tap on the board (canvas pointerdown/up)
interface Press { x: number; y: number; t: number; id: number }
let press: Press | null = null;
const releases: { start: Press; x: number; y: number; t: number }[] = [];
let lastTouch = -1e9;
onTouch((e) => {
  lastTouch = clockMs;
  if (e.control || !e.primary) return;
  if (e.phase === "start") { press = ui.pointerCaptured() ? null : { x: e.x, y: e.y, t: clockMs, id: e.id }; return; }
  if ((e.phase === "end") && press && press.id === e.id) { releases.push({ start: press, x: e.x, y: e.y, t: clockMs }); press = null; }
  else if (e.phase === "cancel") press = null;
});
onPointerButton((e) => {
  if (e.button !== 0 || clockMs - lastTouch < 600) return;
  if (e.pressed) { press = ui.pointerCaptured() ? null : { x: e.x, y: e.y, t: clockMs, id: -1 }; return; }
  if (press && press.id === -1) { releases.push({ start: press, x: e.x, y: e.y, t: clockMs }); press = null; }
});
/** The playfield (the old canvas host) in window px, set by screens.ts. */
export const field = { x: 0, y: 0, width: 0, height: 0 };
function pointerInput(wasActive: boolean): void {
  const list = releases.splice(0);
  if (!wasActive || !inRound() || app.overlay || app.drawer) return;
  const sc = ui.preferences().scale;
  for (const r of list) {
    const s = r.start;
    if (s.x < field.x || s.y < field.y || s.x > field.x + field.width || s.y > field.y + field.height) continue;
    const dx = (r.x - s.x) / sc, dy = (r.y - s.y) / sc;
    const dist = Math.hypot(dx, dy);
    if (dist > 24) sendDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    else if (r.t - s.t < 400) {
      // tap: steer toward the tapped cell relative to the marker
      const cell = render.pickCell(r.x, r.y);
      const p = localPlayer();
      if (cell && p) {
        const ddx = cell.x - p.x, ddy = cell.y - p.y;
        if (Math.abs(ddx) > Math.abs(ddy)) sendDir(ddx > 0 ? "right" : "left");
        else if (ddy !== 0) sendDir(ddy > 0 ? "down" : "up");
      }
    }
  }
}

// ------------------------------------------------------------------ the session's ticks (main.js frame)
function tickSession(): void {
  const s = app.session;
  if (!s || !s.running) return;
  const before = s.state.tick;
  s.tickFrame(clockMs);
  const snap = s.state;
  const claims: number[] = [];
  const evs = s.events; s.events = [];
  for (const ev of evs) {
    if (ev.kind === "claim") { audio.play("claim"); claims.push(ev.playerIndex); if (app.mode === "learn") app.lessonStats.claims++; }
    else if (ev.kind === "cut") audio.play("cut");
    else if (ev.kind === "eliminated") audio.play("eliminated");
    else if (ev.kind === "input") audio.play("move");
  }
  if (snap.tick !== before) {
    render.endTick(snap);
    const p = localPlayer();
    if (p) {
      const exposed = p.alive && p.trail.length > 0;
      if (exposed && !app.exposed) audio.play("warning");
      app.exposed = exposed;
      app.mirror = T("mirror", { tick: snap.tick, max: snap.maxTicks, area: p.area, elims: p.eliminations,
        state: p.alive ? (p.trail.length > 0 ? T("mirrorExposed", { n: p.trail.length }) : T("mirrorSafe")) : T("mirrorOut") });
    }
    if (app.mode === "learn" && app.lesson) trackLesson(snap);
  }
  pendingClaims.push(...claims);
}
const pendingClaims: number[] = [];
export function clockText(): string {
  const st = viewState();
  if (!st || app.phase === "title" || app.phase === "mode-select") return "";
  const remainSec = Math.ceil(Math.max(0, st.maxTicks - st.tick) * TICK_MS / 1000);
  return T("timeLeft", { time: Math.floor(remainSec / 60) + ":" + String(remainSec % 60).padStart(2, "0") });
}
function trackLesson(state: State): void {
  const l = app.lesson!, st = app.lessonStats;
  let complete = false;
  if (l.requires === "move") complete = st.moves >= (l.minMoves || 1);
  else if (l.requires === "claim") complete = st.claims >= (l.minClaims || 1);
  else if (l.requires === "survive") complete = state.tick >= (l.minTicks || 0);
  else if (l.requires === "cut") { st.eliminations = state.players[app.session!.localPlayerIndex()]!.eliminations; complete = st.eliminations >= (l.minEliminations || 1); }
  if (complete && state.phase === "active") {
    state.phase = "ended"; // lesson success: end via the session path
    state.reason = "lesson-complete";
    state.winner = "p1";
    app.session!.stop();
    onRoundEnd(state);
  }
}

// ------------------------------------------------------------------ hosted play (StarHermit rooms, refereed by server.js)
export function openHosted(): void {
  app.phase = "mode-select";
  app.hostedScreen = true;
  if (!app.hosted) app.hosted = newHosted(platform.signedIn() ? { key: "hostedHint" } : { key: "hostedNone" });
  show("hosted", null);
}
function newHosted(status: Msg): Hosted { return { lobby: null, match: null, room: null, status, busy: false, state: null, prevState: null, snapAt: 0, table: null }; }
export async function hostedJoin(create: boolean): Promise<void> {
  if (!platform.signedIn()) return;
  if (app.hosted?.lobby || app.hosted?.match) hostedLeave();
  const H = newHosted({ key: create ? "creatingRoom" : "lookingForRoom" });
  H.busy = true;
  app.hosted = H;
  try {
    const room = create ? await createRoom(platform.adapter) : await quickJoin(platform.adapter);
    if (app.hosted !== H) return;
    H.busy = false;
    if (!room) { H.status = { key: "noOpenRooms" }; return; }
    H.room = room.name || room.joinCode || String(room.id).slice(0, 8);
    attachLobby(H, room);
  } catch (e) {
    if (app.hosted !== H) return;
    H.busy = false;
    H.status = { key: "hostedUnavailable", vars: { error: e instanceof Error ? e.message : String(e) } };
  }
}
function attachLobby(H: Hosted, room: import("starhermit:platform").Room): void {
  const lobby: LobbyClient = new LobbyClient(platform.adapter, room, {
    onChange: () => {
      if (app.hosted !== H || H.match) return;
      const n = lobby.participants.length;
      H.status = { key: "roomLobby", vars: { room: H.room ?? "", n } };
    },
    onPlaying: (r: import("starhermit:platform").Room) => { if (app.hosted === H) startMatch(H, r); },
    onClosed: () => {
      if (app.hosted !== H || H.match) return;
      roomGone();
    },
  });
  H.lobby = lobby;
  H.status = { key: "joinedRoom", vars: { room: H.room ?? "", name: platform.displayName() || "…" } };
  lobby.connect();
}
export function hostedStart(): void { void app.hosted?.lobby?.start(); }
export function rosterNames(): { name: string; you: boolean }[] {
  const lobby = app.hosted?.lobby;
  if (!lobby) return [];
  const me = platform.userId();
  return lobby.participants.map((p: import("starhermit:platform").Participant) => ({ name: p.displayName || p.username, you: !!me && p.userId === me }));
}
function startMatch(H: Hosted, room: import("starhermit:platform").Room): void {
  H.status = { key: "roundStartingStatus" };
  const m: MatchClient = new MatchClient(platform.adapter, room, {
    onTable: (t: Hosted["table"]) => { if (app.hosted === H) H.table = t; },
    onSnap: (snap: { ph: string; cd: number; ev: { k: string; i: number; by: number }[] }) => { if (app.hosted === H) onSnap(H, m, snap); },
    onOver: (over: HostedOver) => { if (app.hosted === H) onHostedOver(H, over); },
    onChange: () => {
      if (app.hosted !== H) return;
      if (m.unavailable && !m.over) roomGone();
    },
  });
  H.match = m;
  m.connect();
  app.session = null;
  app.mode = "hosted";
  app.results = null;
  app.exposed = false;
  const label = H.room ?? "room";
  app.modeData = { mode: "hosted", theme: "tide-pool", goal: () => T("goalHosted"), label: () => T("labelHosted", { room: label }) };
  app.phase = "preparing";
  app.hostedScreen = false;
  app.attract = null;
  show("countdown", null);
  app.countdown = 3;
}
let lastCount = 0;
function onSnap(H: Hosted, m: MatchClient, snap: { ph: string; cd: number; ev: { k: string; i: number; by: number }[] }): void {
  if (!m.table) return;
  const fresh = !H.state;
  H.prevState = H.state ? JSON.parse(JSON.stringify({ players: H.state.players.map((p) => ({ x: p.x, y: p.y })) })) : null;
  H.state = stateFromSnap(m.table, snap, H.state) as State;
  H.snapAt = clockMs;
  if (fresh) {
    render.buildBoard(H.state, effectiveTheme("tide-pool"));
    render.endTick(H.state);
  } else if (H.prevState) {
    render.endTick({ players: H.prevState.players } as unknown as State);
  }
  const claims = snap.ev.filter((e) => e.k === "claim").map((e) => e.i);
  pendingClaims.push(...claims);
  const me = m.seat;
  for (const e of snap.ev) {
    if (e.k === "claim" && e.i === me) audio.play("claim");
    if (e.k === "out" && e.i === me) audio.play("eliminated");
    if (e.k === "out" && e.by === me && e.i !== me) audio.play("cut");
  }
  if (snap.ph === "countdown" || snap.ph === "waiting") {
    const n = snap.ph === "waiting" ? 3 : Math.max(1, Math.ceil(snap.cd / 800));
    if (n !== lastCount) { lastCount = n; app.countdown = n; announce(String(n)); audio.play("countdown"); }
    if (app.screen !== "countdown" && app.phase !== "paused") show("countdown", null);
  } else if (snap.ph === "active" && app.phase === "preparing") {
    lastCount = 0;
    app.phase = "active";
    showHudOnly();
    announce(T("goalHosted"));
  }
  const p = localPlayer();
  if (p) {
    const exposed = p.alive && p.trail.length > 0;
    if (exposed && !app.exposed && app.phase === "active") audio.play("warning");
    app.exposed = exposed;
  }
}
interface HostedOver { reason: string; winner: string | null; rank: number[]; tick: number; maxTicks: number; players: { id: string; name: string; area: number; eliminations: number; alive: boolean }[] }
function onHostedOver(H: Hosted, over: HostedOver): void {
  const m = H.match!;
  const st = H.state ?? stateFromSnap(m.table!, { k: over.tick, ph: "ended", cd: 0, c: "", t: "", p: [], ev: [] }, null) as State;
  const players = st.players.map((p, i) => ({ ...p, ...over.players[i], trail: p.trail }));
  const state = { ...st, players, reason: over.reason, winner: over.winner, tick: over.tick, phase: "ended" } as State;
  H.state = state;
  const me = m.seat;
  const localId = me >= 0 ? state.players[me]!.id : "";
  app.phase = "results";
  const reason = over.reason;
  const r: Results = { state, localId, rank: over.rank, unlocked: [], progressText: () => T("hostedResultServer", { reason: L.endReason(reason) }), lb: null, hosted: true };
  app.results = r;
  show("results");
  audio.play(over.winner && over.winner === localId ? "win" : "lose");
  announce(`${resultsHeadline(r)}. ${r.progressText()}`);
  // the round is over: the room closes with it; drop our sockets and seat
  m.close();
  H.lobby?.close();
  void platform.adapter.leaveRoom(m.room.id).catch(() => undefined);
  H.match = null;
  H.lobby = null;
}
function roomGone(): void {
  hostedLeave();
  app.hosted = newHosted({ key: "roomGone" });
  if (app.phase === "active" || app.phase === "preparing" || app.phase === "paused") goHome();
  app.hostedScreen = true;
  app.phase = "mode-select";
  show("hosted", null);
  toast(T("roomGone"), 5000);
}
export function hostedLeave(): void {
  const H = app.hosted;
  if (!H) return;
  if (H.match) void H.match.leave();
  else if (H.lobby) void H.lobby.leave();
  H.match = null; H.lobby = null; H.room = null; H.state = null;
  app.hosted = null;
}
export function hostedLeaveButton(): void {
  hostedLeave();
  app.hosted = newHosted({ key: platform.signedIn() ? "leftRoom" : "notConnected" });
}
/** Leave round (pause screen): a hosted seat leaves the round and the room. */
export function leaveFromPause(): void {
  if (app.hosted?.match) { hostedLeave(); goHome(); return; }
  leaveRound();
}
function sessionLost(kind: "expired" | "terms"): void {
  if (!app.hosted || !(app.hosted.lobby || app.hosted.match)) return;
  hostedLeave();
  app.expired = kind;
  goHome();
  show("expired");
}

// ------------------------------------------------------------------ account
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function relaunch(): void { void requestSignIn().catch(() => toast(S("signedOut"), 4000)); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFail", { url: link }), 6000); }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  for (let i = 0; i < timers.length;) {
    if (timers[i]!.at <= clockMs) { const t = timers.splice(i, 1)[0]!; t.fn(); } else i++;
  }
  tickSession();
  tickAttract();
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  render.setActive(true);
  startAttract();
  show("title");
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => {
  // the palette recolours the board (main.js effectiveTheme on the next build)
  const st = viewState() ?? app.attract?.state ?? null;
  if (!st || !render.hasBoard()) return;
  const id = app.modeData?.theme ?? "meadow-dawn";
  render.buildBoard(st, effectiveTheme(id));
  if (app.attract && !app.modeData) render.setAttract(true);
  render.endTick(st);
  render.update(st, 1);
});
onSessionEnded((reason) => {
  if (app.hosted && (app.hosted.lobby || app.hosted.match)) { sessionLost(reason === "terms-required" ? "terms" : "expired"); return; }
  toast(S("signedOut"), 4000);
});
onSuspend(() => {
  hidden = true;
  // solo simulation pauses on backgrounding; the player resumes deliberately
  if (app.phase === "active" && !app.hosted && app.screen === "none") pauseGame();
  platform.flush();
});
onResume(() => { hidden = false; });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(ui.preferences().highContrast);
  audio.update();
  app.hosted?.match?.update();
  if (app.toast && app.toast.until < clockMs) app.toast = null;
});
onRender(() => {
  const wasActive = inRound();
  app.clock = clockText();
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput(wasActive);
  const f = frame();
  render.frame(frameDt, f.width, f.height, field);
  const st = viewState();
  if (st) {
    let alpha = 1;
    if (app.hosted?.match) alpha = Math.min(1, (clockMs - app.hosted.snapAt) / 125);
    else if (app.session && !app.session.paused && app.phase === "active") alpha = Math.min(1, app.session.accumulator / TICK_MS);
    render.update(st, alpha, pendingClaims.splice(0));
  } else pendingClaims.length = 0;
  flushAnnouncements();
});
