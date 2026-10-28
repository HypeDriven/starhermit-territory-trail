// The browser build's DOM shell (js/ui.js + index.html) as starhermit:ui,
// built every frame over the board: the status bar (rail toggles on compact
// windows, the title, the mode badge, the player and cloud line, the time
// left, Help and Settings), the progress rail (left) and the status rail
// (right) — side panels from 1024 logical px, drawers below —, the HUD over
// the playfield (the objective with Pause in its own column, the danger
// banner beneath, Undo in Practice and Camera at the bottom, the touch pad on
// touch screens), the board mirror (a named target over the playfield), the
// toast and every screen (title over the self-playing board, modes, setup,
// countdown, pause, results, hosted play, session expired) inside the
// playfield, with Settings and Help over them. The old media queries are
// layouts picked by the window's logical size (< 1024 px: drawers; ≤ 480 px:
// compact bar, no clock; ≤ 500 px tall landscape: a lower bar). The
// playfield rectangle goes to main.ts (field → render.ts).
import { frame, openMenu } from "starhermit:engine";
import { primaryPointer, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { C, L, P, type Challenge, type Difficulty, type Lesson, type Stage } from "./game.ts";
import { S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { token } from "./style.ts";
import {
  app, cameraReset, click, closeOverlay, fresh, field, goHome, hostedJoin, hostedLeaveButton, hostedStart, invite, keysFor, later,
  leaveFromPause, localPlayer, nextRound, openHosted, openModes, openOverlay, openSetup, pauseGame, play, relaunch, restartRound, resultsHeadline,
  resultsLbLine, resumeGame, rosterNames, sendDir, signIn, startChallenge, startDaily, startJourneyStage, startLesson, startPractice,
  undo, viewState, type Msg,
} from "./main.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; narrow: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, ox: sa.left, oy: sa.top, wide: lw >= 1024, narrow: lw <= 480, short: lh <= 500 && lw > lh };
}
const lastSize = new Map<string, ui.Rect>();
function tw(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (tw(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
/** The text cut with an ellipsis to fit `width` (status-title: text-overflow ellipsis). */
function ellipsize(text: string, cls: string, width: number): string {
  if (tw(text, cls) <= width) return text;
  let s = text;
  while (s.length > 1 && tw(s + "…", cls) > width) s = s.slice(0, -1);
  return s.trimEnd() + "…";
}
interface Btn {
  id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; sub?: string; width?: number; height?: number;
}
function btnWidth(b: Btn): number {
  const style = b.style ?? "btn";
  return Math.max(44, tw(b.text, style, "button") + 2);
}
function button(b: Btn): void {
  const style = b.style ?? "btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const inner = (b.width ?? btnWidth(b)) - 34;
  const ink = style === "btn-primary" || style === "btn-play";
  if (b.sub != null) {
    // a card button: a bold title, a line break and a muted detail line
    const sub = b.sub;
    opts.content = () => {
      para(b.text, inner, "btn-label-b");
      if (sub) para(sub, inner, "btn-label-sub");
    };
  } else if (b.width != null && btnWidth(b) > b.width) {
    opts.content = () => { ui.style(ink ? "wrap-ink" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.style(ink ? "wrap-ink" : "btn-label").label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  if (ui.style(style, s).id(b.id).button(b.name ?? (b.sub ? `${b.text}. ${b.sub}` : b.text), opts) && fresh()) later(click(b.act));
}
/** Buttons at their own widths in rows that wrap at `width` (.row flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 9.6, justify: "start" | "center" | "end" = "start"): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? btnWidth(b));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
/** A box over a logical rectangle drawn by a placed role-none widget. */
function paint(id: string, x: number, y: number, w: number, h: number, cls: string): void {
  if (w <= 0 || h <= 0) return;
  ui.place(id, { anchor: "top-start", x, y }, () => { ui.style(cls).widget("", { role: "none", size: { width: w, height: h } }); });
}
function msgText(m: Msg): string {
  if (!m) return "";
  if ("sh" in m) return S(m.sh, m.vars);
  return T(m.key, m.vars);
}

// ------------------------------------------------------------------ the frame
interface Box { x: number; y: number; w: number; h: number }
export function drawScreens(): void {
  const L0 = layoutNow();
  const f = frame();
  const barH = statusBar(L0);
  // #main: the rails beside the playfield (wide) or drawers (compact)
  const railW = L0.wide ? 240 : 0;
  const pf: Box = { x: railW, y: barH, w: L0.lw - 2 * railW, h: L0.lh - barH };
  Object.assign(field, { x: L0.ox + pf.x * L0.sc, y: L0.oy + pf.y * L0.sc, width: pf.w * L0.sc, height: pf.h * L0.sc });
  if (L0.wide) {
    rail(L0, "left", { x: 0, y: barH, w: railW, h: L0.lh - barH });
    rail(L0, "right", { x: L0.lw - railW, y: barH, w: railW, h: L0.lh - barH });
  }
  const showHud = app.screen === "none" || app.screen === "countdown";
  if (showHud && app.modeData) hud(L0, pf);
  if (app.screen === "none" && app.mirror && app.phase === "active") {
    ui.target(app.mirror, { x: field.x, y: field.y, width: field.width, height: field.height }, { role: "label" });
  }
  if (app.screen !== "none") screen(L0, pf);
  if (app.overlay) overlayScreen(L0, pf);
  if (!L0.wide && app.drawer) drawer(L0);
  toastLine(L0);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ header#statusbar
function statusBar(L0: Layout): number {
  const padY = 6.4, padX = L0.narrow ? 6.4 : 12.8, gap = L0.narrow ? 6.4 : 12;
  const h = (L0.short ? 36 : 44) + 2 * padY;
  paint("bar-bg", 0, 0, L0.lw, h, "bar");
  const inner = L0.lw - 2 * padX;
  const st = viewState();
  const mode = app.modeData && st && app.phase !== "title" && app.phase !== "mode-select" ? app.modeData.label() : "";
  const who = platform.signedIn() ? T("accountLine", { name: platform.displayName() || "…", sync: T({ saving: "syncSaving", synced: "syncSynced", offline: "syncOffline" }[platform.syncState()]) }) : "";
  const clock = !L0.narrow ? app.clock : "";
  const btnH = L0.short ? 36 : 44;
  const icon = (id: string, glyph: string, name: string, act: () => void): void => {
    if (ui.style("btn", { width: 44, minHeight: btnH, height: btnH, padding: 0 }).id(id).button(name, { content: () => ui.style("btn-label").label(glyph) }) && fresh()) later(click(act));
  };
  const nIcons = 2 + (L0.wide ? 0 : 2);
  let free = inner - nIcons * 44 - (nIcons + 1) * gap - (clock ? tw(clock, "muted") + gap : 0);
  const titleW = Math.min(tw("Territory Trail", "status-title") + 1, Math.max(40, free * (mode || who ? 0.4 : 1)));
  free -= titleW + gap;
  const badgeW = (text: string): number => Math.min(tw(text, "badge-text") + 14, Math.max(0, free));
  const mW = mode ? badgeW(mode) : 0;
  free -= mW ? mW + gap : 0;
  const wW = who && free > 60 ? Math.min(tw(who, "badge-text") + 14, free) : 0;
  ui.place("bar", { anchor: "top-start", x: padX, y: padY }, () => {
    ui.row("bar-row", () => {
      if (!L0.wide) icon("rail-toggle-left", "☰", T("openProgress"), () => { app.drawer = "left"; });
      ui.style("status-title").id("status-title").label(ellipsize("Territory Trail", "status-title", titleW));
      if (mW > 20) ui.row("status-mode", () => ui.style("badge-text").id("status-mode-text").label(ellipsize(mode, "badge-text", mW - 14)), { style: "badge" });
      if (wW > 20) ui.row("status-player", () => ui.style("badge-text").label(ellipsize(who, "badge-text", wW - 14)), { style: "badge" });
      ui.spacer();
      if (clock) ui.style("muted").id("status-clock").label(clock);
      icon("btn-help", "?", T("help"), () => openOverlay("help"));
      icon("btn-settings", "⚙", T("settings"), () => openOverlay("settings"));
      if (!L0.wide) icon("rail-toggle-right", "≡", T("openStatus"), () => { app.drawer = "right"; });
    }, { width: inner, height: btnH, spacing: gap, align: "center" });
  });
  return h;
}

// ------------------------------------------------------------------ the rails
function railBody(side: "left" | "right", w: number): void {
  const iw = w - 25.6;
  if (side === "left") {
    para(T("progressH"), iw, "h2", "progress-h");
    const prog = platform.progress();
    const done = Object.values(prog.stagesCompleted).filter((r) => r && r.won).length;
    para(T("railJourney", { n: done, total: C.STAGES.length }), iw, "text", "rail-journey");
    para(T("railLessons", { n: Object.keys(prog.lessonsCompleted).length, total: C.LESSONS.length }), iw, "text", "rail-lessons");
    para(T("railAchievements", { n: prog.achievements.length, total: P.ACHIEVEMENTS.length }), iw, "text", "rail-ach");
    para(T("railRating", { n: prog.rating }), iw, "muted", "rail-rating");
  } else {
    para(T("statusH"), iw, "h2", "status-h");
    const st = app.phase === "title" || app.phase === "mode-select" ? null : viewState();
    if (st) {
      const me = localPlayer();
      st.players.forEach((p, i) => ui.row(`rail-p${i}`, () => {
        const name = p === me ? T("youSuffix", { name: L.playerName(p) }) : L.playerName(p);
        const stat = T("railCells", { n: p.area }) + (p.alive ? "" : T("railOut"));
        const sw = tw(stat, "text");
        ui.style("text").label(ellipsize(name, "text", Math.max(30, iw - sw - 8)));
        ui.spacer();
        ui.style("text").label(stat);
      }, { style: "score-line", width: iw, align: "center" }));
      para(T("railTick", { tick: st.tick, max: st.maxTicks }), iw, "muted", "rail-tick");
    }
  }
}
function rail(L0: Layout, side: "left" | "right", b: Box): void {
  paint(`rail-${side}-bg`, b.x, b.y, b.w, b.h, "rail");
  paint(`rail-${side}-line`, side === "left" ? b.x + b.w - 1 : b.x, b.y, 1, b.h, "rail-line");
  ui.place(`rail-${side}`, { anchor: "top-start", x: b.x + 12.8, y: b.y + 12.8 }, () => {
    ui.column(`rail-${side}-in`, () => railBody(side, b.w), { spacing: 16, width: b.w - 25.6 });
  });
  void L0;
}
function drawer(L0: Layout): void {
  const w = Math.min(L0.lw * 0.8, 300);
  const side = app.drawer!;
  const x = side === "left" ? 0 : L0.lw - w;
  // #drawer-backdrop: a tap outside the drawer closes it
  const sx = side === "left" ? w : 0;
  ui.place("drawer-scrim", { anchor: "top-start", x: sx, y: 0 }, () => {
    const r = ui.style("drawer-scrim").widget(T("close"), { role: "button", size: { width: L0.lw - w, height: L0.lh } });
    if (r.activated && fresh()) later(() => { app.drawer = null; });
  });
  paint("drawer-bg", x, 0, w, L0.lh, "rail");
  ui.place("drawer", { anchor: "top-start", x: x + 12.8, y: 12.8 }, () => {
    ui.column("drawer-in", () => {
      railBody(side, w);
      button({ id: "btn-drawer-close", text: T("close"), act: () => { app.drawer = null; } });
    }, { spacing: 16, width: w - 25.6 });
  });
}

// ------------------------------------------------------------------ #hud
function hud(L0: Layout, pf: Box): void {
  const st = viewState();
  if (!st) return;
  const md = app.modeData!;
  const gap = 9.6;
  const inner = pf.w - 16;
  const objective = md.goal();
  const pauseW = 44;
  const objMax = Math.max(60, inner - pauseW - gap);
  const objW = Math.min(objMax, tw(objective, "objective-text") + 32 + 1);
  ui.place("hud-top", { anchor: "top-start", x: pf.x + 8 + (inner - objW - gap - pauseW) / 2, y: pf.y + 8 }, () => {
    ui.column("hud-stack", () => {
      ui.row("hud-top-row", () => {
        ui.column("objective", () => para(objective, objW - 32, "objective-text", "objective-text"), { style: "objective", width: objW });
        if (ui.style("btn", { width: pauseW, minHeight: 44, height: 44, padding: 0 }).id("btn-pause").button(T("pauseGame"), {
          disabled: app.phase !== "active", content: () => ui.widget("", { role: "none", size: { width: 16, height: 16 }, draw: (r) => {
            const s = frame().scale;
            const c = token("text");
            draw.rect(r.x + 3 * s, r.y + 2 * s, 3.5 * s, 12 * s, c);
            draw.rect(r.x + 9.5 * s, r.y + 2 * s, 3.5 * s, 12 * s, c);
          } }),
        }) && fresh()) later(click(pauseGame));
      }, { spacing: gap, align: "center" });
      if (app.exposed && app.phase === "active") {
        ui.row("danger-row", () => {
          ui.row("danger-banner", () => ui.style("danger-text").id("danger-text").label(T("danger")), { style: "danger" });
        }, { width: objW + gap + pauseW, justify: "center" });
      }
    }, { spacing: 6.4, align: "center" });
  });
  // #hud-actions: Undo (Practice) · Camera, centred at the bottom
  const acts: Btn[] = [];
  if (md.mode === "practice") acts.push({ id: "btn-undo", text: T("undo"), act: undo });
  acts.push({ id: "btn-camera", text: T("camera"), act: cameraReset });
  const actsW = acts.reduce((a, b) => a + btnWidth(b), 0) + gap * (acts.length - 1);
  ui.place("hud-actions", { anchor: "top-start", x: pf.x + (pf.w - actsW) / 2, y: pf.y + pf.h - 12 - 44 }, () => {
    ui.row("hud-actions-row", () => { for (const b of acts) button(b); }, { spacing: gap });
  });
  // #touch-pad on touch screens: 3 × 52 px with 6 px gaps, right (left-handed: left), above the actions
  if (primaryPointer() === "coarse" || L0.lw < 600) {
    const cell = 52, g = 6, size = cell * 3 + g * 2;
    const x = platform.options.leftHanded ? pf.x + 12.8 : pf.x + pf.w - 12.8 - size;
    const y = pf.y + pf.h - 73.6 - size;
    const padBtn = (dir: "up" | "down" | "left" | "right", glyph: string, nameKey: string): void => {
      if (ui.style("btn-pad", { width: cell, height: cell }).id(`pad-${dir}`).button(T(nameKey), { content: () => ui.style("btn-label").label(glyph) }) && fresh()) later(() => sendDir(dir));
    };
    const gapCell = (k: string): void => { ui.widget("", { role: "none", size: { width: cell, height: cell } }); void k; };
    ui.place("touch-pad", { anchor: "top-start", x, y }, () => {
      ui.column("touch-pad-col", () => {
        ui.row("pad-r0", () => { gapCell("a"); padBtn("up", "▲", "moveUp"); gapCell("b"); }, { spacing: g });
        ui.row("pad-r1", () => { padBtn("left", "◀", "moveLeft"); gapCell("c"); padBtn("right", "▶", "moveRight"); }, { spacing: g });
        ui.row("pad-r2", () => { gapCell("d"); padBtn("down", "▼", "moveDown"); gapCell("e"); }, { spacing: g });
      }, { spacing: g });
    });
  }
}

// ------------------------------------------------------------------ .screen (inside the playfield)
function cardPanel(L0: Layout, pf: Box, key: string, build: (w: number) => void, width = 640): void {
  const w = Math.min(width, pf.w * 0.94, pf.w - 16);
  const pad = 19.2;
  const inner = w - 2 * pad;
  const maxH = Math.min(L0.lh * 0.86, pf.h - 16);
  const prev = lastSize.get(key);
  const natural = prev ? prev.height / L0.sc + 2 * pad + 2 : 0;
  const scroll = !!prev && natural > maxH;
  const h = scroll ? maxH : natural;
  const opening = frame().frame - app.openedFrame <= 6;
  const x = pf.x + (pf.w - w) / 2;
  const y = pf.y + Math.max(8, (pf.h - (h || maxH * 0.5)) / 2);
  ui.place(`${key}-card`, { anchor: "top-start", x, y }, () => {
    ui.column(`${key}-panel`, () => {
      const iw = inner - (scroll ? 14 : 0);
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => build(iw), { spacing: 9.6, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: maxH - 2 * pad }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
    }, { style: "card", width: w, spacing: 0, padding: pad });
  });
}
function screen(L0: Layout, pf: Box): void {
  const s = app.screen;
  if (s === "title") {
    paint("scrim", pf.x, pf.y, pf.w, pf.h, "title-scrim");
    titleScreen(L0, pf);
    return;
  }
  paint("scrim", pf.x, pf.y, pf.w, pf.h, "scrim");
  switch (s) {
    case "countdown": {
      const n = String(app.countdown);
      ui.place("countdown", { anchor: "top-start", x: pf.x + (pf.w - tw(n, "countdown")) / 2, y: pf.y + pf.h / 2 - 50 }, () => ui.style("countdown").id("countdown-num").label(n));
      break;
    }
    case "modes": cardPanel(L0, pf, "modes", modesPanel); break;
    case "setup": cardPanel(L0, pf, "setup", setupPanel); break;
    case "pause": cardPanel(L0, pf, "pause", pausePanel); break;
    case "results": cardPanel(L0, pf, "results", resultsPanel); break;
    case "hosted": cardPanel(L0, pf, "hosted", hostedPanel); break;
    case "expired": cardPanel(L0, pf, "expired", expiredPanel); break;
    default: break;
  }
}
function overlayScreen(L0: Layout, pf: Box): void {
  paint("overlay-scrim", pf.x, pf.y, pf.w, pf.h, app.screen === "none" ? "scrim" : "scrim-top");
  if (app.overlay === "settings") cardPanel(L0, pf, "settings", settingsPanel);
  else cardPanel(L0, pf, "help", helpPanel);
}

function titleScreen(L0: Layout, pf: Box): void {
  const w = Math.min(pf.w - 32, 720);
  const prev = lastSize.get("title");
  const h = prev ? prev.height / L0.sc : 300;
  ui.place("title", { anchor: "top-start", x: pf.x + (pf.w - w) / 2, y: pf.y + Math.max(16, (pf.h - h) / 2) }, () => {
    lastSize.set("title", ui.column("title-col", () => {
      ui.row("title-h-row", () => para("Territory Trail", w, "h1", "title-h"), { width: w, justify: "center" });
      ui.row("tagline-row", () => para(T("tagline"), Math.min(w, 70 * 8), "muted", "tagline"), { width: w, justify: "center" });
      flow("play-row", [{ id: "btn-play", text: T("play"), style: "btn-play", act: play }], w, 9.6, "center");
      const d = C.dailyChallenge(new Date(platform.nowMs()));
      flow("modes-row", [
        { id: "btn-daily", text: T("dailyButton", { day: d.day }), act: startDaily },
        { id: "btn-learn", text: T("learn"), act: () => openSetup("learn") },
        { id: "btn-hosted", text: T("hostedPlay"), act: openHosted },
        { id: "btn-modes", text: T("chooseMode"), act: openModes },
      ], w, 9.6, "center");
      const acct: Btn[] = [];
      if (!platform.signedIn()) acct.push({ id: "btn-signin", text: S("signIn"), act: signIn });
      if (platform.inviteLink()) acct.push({ id: "btn-invite", text: S("invite"), act: invite });
      if (acct.length) flow("acct-row", acct, w, 9.6, "center");
      const prog = platform.progress();
      const stages = Object.values(prog.stagesCompleted).filter((r) => r && r.won).length;
      const sum = stages > 0 ? T("progressSummary", { n: stages, total: C.STAGES.length }) : T("newHere");
      ui.row("title-progress-row", () => para(sum, w, "muted", "title-progress"), { width: w, justify: "center" });
    }, { spacing: 14.4, width: w, align: "center" }));
  });
}
function modesPanel(w: number): void {
  para(T("chooseMode"), w, "h2", "modes-h");
  const card = (mode: string, key: string, act: () => void): Btn => ({ id: `mode-${mode}`, text: T(key), sub: T(key + "Desc"), style: "btn-card", act });
  grid("modes-grid", [
    card("journey", "modeJourney", () => openSetup("journey")),
    card("practice", "modePractice", () => openSetup("practice")),
    card("daily", "modeDaily", startDaily),
    card("challenge", "modeChallenge", () => openSetup("challenge")),
    card("learn", "modeLearn", () => openSetup("learn")),
    card("hosted", "modeHosted", openHosted),
  ], w);
  flow("modes-back", [{ id: "btn-modes-back", text: T("back"), act: goHome }], w);
}
/** .grid-list: auto-fill columns of at least 150 px. */
function grid(id: string, list: Btn[], w: number): void {
  const gap = 9.6;
  const cols = Math.max(1, Math.floor((w + gap) / (150 + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < list.length; r++) {
      ui.row(`${id}-r${r}`, () => { for (const b of list.slice(r * cols, (r + 1) * cols)) button({ ...b, width: cw }); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
function setupPanel(w: number): void {
  const mode = app.setupMode;
  para(T("setup"), w, "h2", "setup-h");
  const prog = platform.progress();
  if (mode === "journey") {
    para(T("setupJourney"), w, "text", "setup-text");
    grid("setup-list", C.STAGES.map((s: Stage) => ({
      id: `stage-${s.index}`, text: `${s.index}. ${L.stageName(s)}`, style: "btn-card",
      sub: L.stageGoal(s) + (prog.stagesCompleted[s.id]?.won ? " ✓" : "") + (s.mastery ? T("mastery") : ""), act: () => startJourneyStage(s),
    })), w);
  } else if (mode === "practice") {
    para(T("setupPractice"), w, "text", "setup-text");
    grid("setup-list", C.PRACTICE_DIFFICULTIES.map((d: Difficulty) => ({
      id: `diff-${d.id}`, text: L.difficultyName(d), style: "btn-card", sub: T("rivalsSize", { n: d.bots, w: d.width, h: d.height }), act: () => startPractice(d),
    })), w);
  } else if (mode === "challenge") {
    para(T("setupChallenge"), w, "text", "setup-text");
    grid("setup-list", C.CHALLENGES.map((c: Challenge) => ({ id: c.id, text: L.challengeName(c), style: "btn-card", sub: L.challengeGoal(c), act: () => startChallenge(c) })), w);
  } else {
    para(T("setupLearn"), w, "text", "setup-text");
    grid("setup-list", C.LESSONS.map((l: Lesson) => ({
      id: l.id, text: L.lessonTitle(l), style: "btn-card", sub: L.lessonText(l) + (prog.lessonsCompleted[l.id] ? " ✓" : ""), act: () => startLesson(l),
    })), w);
  }
  // Start: the first unfinished stage of the Journey (setup-start); the other modes start from their list
  flow("setup-row", [
    { id: "btn-setup-start", text: T("start"), style: "btn-primary", act: () => { if (app.setupMode === "journey") play(); } },
    { id: "btn-setup-back", text: T("back"), act: goHome },
  ], w);
}
function pausePanel(w: number): void {
  para(T("paused"), w, "h2", "pause-h");
  flow("resume-row", [{ id: "btn-resume", text: T("resume"), style: "btn-primary", act: resumeGame }], w);
  const list: Btn[] = [
    { id: "btn-pause-settings", text: T("settings"), act: () => openOverlay("settings") },
    { id: "btn-pause-help", text: T("help"), act: () => openOverlay("help") },
  ];
  if (!app.hosted?.match) list.push({ id: "btn-restart", text: T("restart"), act: restartRound });
  list.push({ id: "btn-leave", text: T("leaveRound"), style: "btn-danger", act: leaveFromPause });
  flow("pause-row", list, w);
}
/** .score-line: a name, an optional muted middle and a bold value. */
function scoreLine(id: string, name: string, calc: string, value: string, w: number): void {
  ui.row(id, () => {
    const vw = tw(value, "td-num");
    const cw = calc ? tw(calc, "td-muted") : 0;
    ui.style("td").label(ellipsize(name, "td", Math.max(30, w * (calc ? 0.42 : 1) - vw - 12)));
    ui.spacer();
    if (calc) { ui.style("td-muted").label(calc); ui.spacer(); }
    ui.style("td-num").label(value);
    void cw;
  }, { style: "score-line", width: w, align: "center", spacing: 8 });
}
const ACH_KEYS: Record<string, string> = { "first-claim": "achFirstClaim", "mechanic-mastery": "achMechanic", "streak-three": "achStreak", "chapter-five": "achSummit", "long-road": "achLongRoad" };
function resultsPanel(w: number): void {
  const r = app.results!;
  const st = r.state;
  para(resultsHeadline(r), w, "h2", "results-h");
  para(T("endedBy", { reason: L.endReason(st.reason), tick: st.tick, max: st.maxTicks }), w, "muted", "results-reason");
  const local = st.players.find((p) => p.id === r.localId);
  if (local) {
    para(T("scoreBreakdown"), w, "h3", "results-breakdown-h");
    scoreLine("score-area", T("territoryArea"), T("cellsTimes", { n: local.area }), String(local.area), w);
    scoreLine("score-elims", T("eliminations"), T("timesFifty", { n: local.eliminations }), String(local.eliminations * 50), w);
    scoreLine("score-total", T("total"), "", String(local.area + local.eliminations * 50), w);
  }
  para(T("standings"), w, "h3", "results-standings-h");
  r.rank.forEach((i, k) => {
    const p = st.players[i];
    if (!p) return;
    scoreLine(`standing-${k}`, (p.id === r.localId ? "▶ " : "") + L.playerName(p) + (p.alive ? "" : " ✝"), "", String(p.area + p.eliminations * 50), w);
  });
  if (r.unlocked.length) {
    para(T("achievementsUnlocked"), w, "h3", "results-ach-h");
    for (const key of r.unlocked) { const k = ACH_KEYS[key]; para("🏅 " + (k ? `${T(k)} — ${T(k + "Desc")}` : key), w, "text", `ach-${key}`); }
  }
  para(r.progressText(), w, "muted", "results-progress");
  const lb = resultsLbLine();
  if (lb) para(lb, w, "muted", "results-lb");
  const list: Btn[] = r.hosted ? [] : [
    { id: "btn-retry", text: T("retry"), style: "btn-primary", act: restartRound },
    { id: "btn-results-next", text: T("next"), act: nextRound },
  ];
  list.push({ id: "btn-results-home", text: T("home"), act: goHome });
  if (r.hosted) list.push({ id: "btn-results-hosted", text: T("hostedPlay"), act: () => { goHome(); openHosted(); } });
  flow("results-row", list, w);
}
function helpPanel(w: number): void {
  para(T("howToPlay"), w, "h2", "help-h");
  const k = keysFor;
  const cards: [string, string][] = [
    [T("helpSteer"), T("helpSteerText", { keys: `${k("up")} ${k("left")} ${k("down")} ${k("right")}` })],
    [T("helpClaim"), T("helpClaimText")],
    [T("helpDanger"), T("helpDangerText")],
    [T("helpCut"), T("helpCutText")],
    [T("helpWin"), T("helpWinText")],
    [T("helpUndo"), T("helpUndoText", { key: k("undo") })],
    [T("helpCamera"), T("helpCameraText", { camera: k("camera"), pause: k("pause") })],
  ];
  const iw = w - 25.6 - 2;
  cards.forEach(([h, p], i) => ui.column(`help-${i}`, () => { para(h, iw, "h3", `help-${i}-h`); para(p, iw, "text", `help-${i}-p`); }, { style: "rule-card", width: w, spacing: 3.2 }));
  flow("help-row", [{ id: "btn-overlay-close", text: T("close"), style: "btn-primary", act: closeOverlay }], w);
}
/** Settings: what the runtime's Options do not cover (ui.js settings): colour palette, left-handed pad, haptics, tutorial hints. */
function settingsPanel(w: number): void {
  const o = platform.options;
  para(T("settings"), w, "h2", "settings-h");
  para(T("optionsNote"), w, "muted", "options-note");
  flow("set-runtime", [
    { id: "btn-options", text: T("openOptions"), act: () => openMenu() },
    { id: "btn-rebind", text: T("keyBindings"), act: () => requestRebind() },
  ], w);
  const names = P.PALETTES.map((p) => T("pal" + p.charAt(0).toUpperCase() + p.slice(1)));
  const idx = Math.max(0, P.PALETTES.indexOf(o.palette));
  ui.row("opt-palette-row", () => {
    para(T("colorPalette"), w * 0.45, "text", "opt-palette-label");
    ui.spacer();
    const pick = ui.id("opt-palette").select(T("colorPalette"), idx, names, { width: Math.min(w * 0.52, 240) } as ui.WidgetOptions);
    if (pick !== idx) later(() => platform.setOption("palette", P.PALETTES[pick]!));
  }, { width: w, align: "center", height: 48 });
  toggleRow("opt-left", T("leftHanded"), o.leftHanded, w, (v) => platform.setOption("leftHanded", v));
  toggleRow("opt-haptics", T("haptics"), o.haptics, w, (v) => platform.setOption("haptics", v));
  toggleRow("opt-hints", T("tutorialHints"), o.showTutorialHints, w, (v) => platform.setOption("showTutorialHints", v));
  flow("settings-row", [{ id: "btn-overlay-close", text: T("done"), style: "btn-primary", act: closeOverlay }], w);
}
/** A check box row (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w - 56, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel2"));
        draw.strokeRoundRect(bx, by, box, box, 4, token("edge"), 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: token("ink"), align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(click(() => set(!on)));
  }, { width: w, align: "center", spacing: 8, height: 44 });
}
function hostedPanel(w: number): void {
  const H = app.hosted;
  para(T("hostedTitle"), w, "h2", "hosted-h");
  para(msgText(H?.status ?? null), w, "muted", "hosted-status");
  if (platform.signedIn()) {
    const inRoom = !!H?.lobby;
    if (!inRoom) {
      flow("hosted-join-row", [
        { id: "btn-hosted-quickjoin", text: T("quickJoin"), style: "btn-primary", act: () => void hostedJoin(false), disabled: !!H?.busy },
        { id: "btn-hosted-create", text: T("createRoom"), act: () => void hostedJoin(true), disabled: !!H?.busy },
      ], w);
    } else {
      const list: Btn[] = [];
      if (H!.lobby!.host) list.push({ id: "btn-hosted-start", text: T("startRound"), style: "btn-primary", act: hostedStart, disabled: H!.lobby!.starting });
      list.push({ id: "btn-hosted-leave", text: T("leaveRoom"), act: hostedLeaveButton });
      flow("hosted-room-row", list, w);
    }
    para(T("hostedInfo"), w, "muted", "hosted-info");
  } else para(T("hostedOffline"), w, "muted", "hosted-offline");
  const roster = rosterNames();
  roster.forEach((e, i) => para(e.you ? T("youSuffix", { name: e.name }) : e.name, w, "text", `roster-${i}`));
  flow("hosted-back", [{ id: "btn-hosted-back", text: T("back"), act: goHome }], w);
}
function expiredPanel(w: number): void {
  const terms = app.expired === "terms";
  para(S(terms ? "termsTitle" : "expiredTitle"), w, "h2", "expired-h");
  para(S(terms ? "termsBody" : "expiredBody"), w, "muted", "expired-body");
  flow("expired-row", [
    { id: "btn-relaunch", text: S("relaunch"), style: "btn-primary", act: relaunch },
    { id: "btn-expired-local", text: S("playLocal"), act: goHome },
  ], w);
}

// ------------------------------------------------------------------ #sh-toast
function toastLine(L0: Layout): void {
  const t = app.toast;
  if (!t) return;
  const max = Math.min(L0.lw * 0.92, 34 * 16);
  const w = Math.min(max, tw(t.text, "toast-text") + 36);
  const prev = lastSize.get("toast");
  const h = prev ? prev.height / L0.sc : 44;
  ui.place("toast", { anchor: "top-start", x: (L0.lw - w) / 2, y: L0.lh - 16 - h }, () => {
    lastSize.set("toast", ui.column("toast-box", () => para(t.text, w - 36, "toast-text", "toast-text"), { style: "toast", width: w }));
  });
}
// the pause screen's Escape and the overlays' Escape are handled in main.ts (the pause action)
