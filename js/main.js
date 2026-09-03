'use strict';

// Bootstrap/controller: game-state machine, input routing, mode orchestration.
// boot → title → mode-select → preparing → countdown → active ↔ paused → results → progression
import { Session, TICK_MS } from './session.js';
import { Renderer } from './render.js';
import { ui } from './ui.js';
import * as audio from './audio.js';
import * as platform from './platform.js?v=d149b156';
import { STAGES, LESSONS, dailyChallenge, themeById, CONTENT_VERSION } from './content.js';
import { PHASE, rankPlayers, legalDirections, makeEnvelope, dailySeed } from './rules.js';

const $ = (id) => document.getElementById(id);

const PALETTES = {
  default: null,
  deuteranopia: ['#f6c445', '#0072b2', '#d55e00', '#cc79a7', '#009e73', '#e69f00'],
  protanopia: ['#f6c445', '#0072b2', '#d55e00', '#cc79a7', '#009e73', '#e69f00'],
  tritanopia: ['#e64b35', '#4dbbd5', '#00a087', '#3c5488', '#f39b7f', '#8491b4'],
};

const app = {
  phase: 'boot',
  settings: platform.loadSettings(),
  progress: platform.loadProgress(),
  session: null,
  renderer: null,
  mode: null,
  modeData: null,
  streak: 0,
  hosted: null, // { ws, room, playerId, state }
  lastTickApplied: -1,
  pausedByHidden: false,
};

function setPhase(p) { app.phase = p; }

function effectiveTheme(themeId) {
  const base = themeById(themeId);
  const pal = PALETTES[app.settings.palette];
  if (!pal) return base;
  return Object.assign({}, base, { players: pal });
}

// ------------------------------------------------------------------ boot
function boot() {
  const host = $('canvas-host');
  app.renderer = new Renderer(host);
  if (app.renderer.failed) {
    $('screen-title').innerHTML = '<div class="card"><h1>Territory Trail</h1>' +
      '<p>This device or browser cannot create a WebGL context, so the 3D playfield is unavailable. ' +
      'Your settings and progress are preserved. Try a browser with WebGL enabled.</p></div>';
    ui.init(app.settings, onAction);
    ui.show('title');
    return;
  }

  ui.init(app.settings, onAction);
  audio.init(app.settings);
  platform.syncServerTime().then(() => {
    updateDailyLabel();
    platform.startPresence();
    platform.track('start');
  });

  applyQuality();
  bindInput();
  updateDailyLabel();
  ui.updateRails(null, null, app.progress);
  $('title-progress').textContent = progressSummary();
  setPhase('title');
  ui.show('title');

  window.addEventListener('resize', () => app.renderer.resize());
  document.addEventListener('visibilitychange', onVisibility);
  requestAnimationFrame(frame);
}

function progressSummary() {
  const stages = Object.keys(app.progress.stagesCompleted).length;
  return stages > 0 ? 'Journey progress: ' + stages + ' / ' + STAGES.length + ' stages.' : 'New here? Start with Learn.';
}

function updateDailyLabel() {
  const d = dailySeed(new Date(platform.serverNow()));
  $('btn-daily').textContent = 'Daily Challenge — ' + d.day + (platform.isTimeSynced() ? '' : ' (local clock)');
}

function applyQuality() {
  let q = app.settings.quality;
  if (q === 'auto') {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    q = coarse ? 'medium' : 'high';
  }
  app.renderer.setQuality(q, app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ------------------------------------------------------------------ actions
function onAction(action, payload) {
  audio.unlock();
  switch (action) {
    case 'play':
      // Short path to play: continue Journey at first unfinished stage.
      {
        const next = STAGES.find((s) => !app.progress.stagesCompleted[s.id]) || STAGES[STAGES.length - 1];
        startJourneyStage(next);
      }
      break;
    case 'mode':
      if (payload === 'daily') { startDaily(); break; }
      if (payload === 'hosted') { setPhase('mode-select'); ui.show('hosted'); break; }
      setPhase('mode-select');
      ui.buildSetup(payload, { progress: app.progress });
      app.mode = payload;
      ui.show('setup');
      break;
    case 'setup-pick':
      if (payload.mode === 'journey') startJourneyStage(payload.stage);
      else if (payload.mode === 'practice') startPractice(payload.difficulty);
      else if (payload.mode === 'challenge') startChallenge(payload.challenge);
      else if (payload.mode === 'learn') startLesson(payload.lesson);
      break;
    case 'setup-start': {
      // Default: first uncompleted stage of current mode.
      if (app.mode === 'journey') onAction('play');
      break;
    }
    case 'dir': if (app.session) sendDir(payload); break;
    case 'pause': pauseGame(); break;
    case 'resume': resumeGame(); break;
    case 'restart': restartRound(); break;
    case 'leave': leaveRound(); break;
    case 'retry': restartRound(); break;
    case 'next': nextRound(); break;
    case 'home': goHome(); break;
    case 'undo':
      if (app.session && app.mode === 'practice' && app.session.undo()) {
        ui.announce('Undone to before your last claim.');
        app.renderer.buildBoard(app.session.state, effectiveTheme(app.modeData.theme));
      }
      break;
    case 'camera': app.renderer.resize(); ui.announce('Camera reset.'); break;
    case 'hosted-join': hostedJoin(payload); break;
    case 'overlay-closed': break;
    case 'settings-changed':
      applyQuality();
      audio.updateSettings(app.settings);
      break;
  }
}

// ------------------------------------------------------------------ modes
function playerDefs(botCount, names) {
  const defs = [{ id: 'p1', name: 'You', isBot: false }];
  for (let i = 0; i < botCount; i++) defs.push({ id: 'b' + (i + 1), name: (names && names[i]) || ('Rival ' + (i + 1)), isBot: true });
  return defs;
}

function beginRound(config, defs, modeData) {
  if (app.session) app.session.stop();
  app.modeData = modeData;
  app.session = new Session(config, defs, 'p1');
  app.session.allowUndo = modeData.mode === 'practice';
  app.session.onEnd = onRoundEnd;
  ui.setUndoVisible(modeData.mode === 'practice');
  ui.setObjective(modeData.goalText);
  ui.setStatus(modeData.label, '');
  ui.announce(modeData.goalText);
  app.renderer.buildBoard(app.session.state, effectiveTheme(modeData.theme));
  app.renderer.resize();
  setPhase('preparing');
  countdown(3, () => {
    setPhase('active');
    ui.showHudOnly();
    app.session.start();
  });
}

function countdown(n, done) {
  ui.show('countdown');
  const el = $('countdown-num');
  let left = n;
  const stepFn = () => {
    if (left === 0) { done(); return; }
    el.textContent = String(left);
    ui.announce(String(left));
    audio.play('countdown');
    left--;
    setTimeout(stepFn, app.settings.reducedMotion ? 400 : 800);
  };
  stepFn();
}

function startJourneyStage(stage) {
  app.mode = 'journey';
  const defs = playerDefs(stage.bots);
  beginRound(
    { seed: stage.seed, width: stage.width, height: stage.height, maxTicks: stage.maxTicks, areaGoal: stage.areaGoal },
    defs,
    { mode: 'journey', stage: stage, theme: stage.theme, goalText: stage.goalText, label: 'Journey ' + stage.index + ' — ' + stage.name }
  );
}

function startPractice(diff) {
  app.mode = 'practice';
  const seed = (Date.now() % 100000) >>> 0;
  beginRound(
    { seed: seed, width: diff.width, height: diff.height, maxTicks: diff.maxTicks, areaGoal: diff.areaGoal },
    playerDefs(diff.bots),
    { mode: 'practice', difficulty: diff, theme: 'meadow-dawn', goalText: 'Practice (' + diff.name + '): claim ' + diff.areaGoal + ' cells. Undo is available.', label: 'Practice — ' + diff.name }
  );
}

function startDaily() {
  app.mode = 'daily';
  const d = dailyChallenge(new Date(platform.serverNow()));
  beginRound(
    { seed: d.seed, width: d.width, height: d.height, maxTicks: d.maxTicks, areaGoal: d.areaGoal },
    playerDefs(d.bots),
    { mode: 'daily', daily: d, theme: d.theme, goalText: d.goalText, label: 'Daily ' + d.day }
  );
}

function startChallenge(c) {
  app.mode = 'challenge';
  beginRound(
    { ...c.config },
    playerDefs(c.config.bots),
    { mode: 'challenge', challenge: c, theme: 'slate-storm', goalText: c.goalText, label: 'Challenge — ' + c.name }
  );
}

function startLesson(lesson) {
  app.mode = 'learn';
  app.lesson = lesson;
  app.lessonStats = { moves: 0, claims: 0, eliminations: 0 };
  beginRound(
    { ...lesson.config },
    playerDefs(lesson.config.bots),
    { mode: 'learn', lesson: lesson, theme: lesson.theme, goalText: lesson.title + ': ' + lesson.text, label: 'Learn — ' + lesson.title }
  );
}

function pauseGame() {
  if (!app.session || app.phase !== 'active') return;
  app.session.pause();
  setPhase('paused');
  ui.show('pause');
  ui.announce('Paused.');
}

function resumeGame() {
  if (!app.session) return;
  setPhase('active');
  ui.showHudOnly();
  app.session.resume();
}

function restartRound() {
  if (!app.modeData) return;
  const md = app.modeData;
  if (md.mode === 'journey') startJourneyStage(md.stage);
  else if (md.mode === 'practice') startPractice(md.difficulty);
  else if (md.mode === 'daily') startDaily();
  else if (md.mode === 'challenge') startChallenge(md.challenge);
  else if (md.mode === 'learn') startLesson(md.lesson);
  platform.track('retry');
}

function nextRound() {
  if (app.mode === 'journey' && app.modeData.stage) {
    const next = STAGES.find((s) => s.index === app.modeData.stage.index + 1);
    if (next) { startJourneyStage(next); return; }
  }
  goHome();
}

function leaveRound() {
  if (app.session) app.session.stop();
  if (app.hosted) hostedLeave();
  goHome();
}

function goHome() {
  if (app.session) { app.session.stop(); app.session = null; }
  setPhase('title');
  ui.setStatus('', '');
  ui.setDanger(false);
  ui.updateRails(null, null, app.progress);
  $('title-progress').textContent = progressSummary();
  ui.show('title');
}

// ------------------------------------------------------------------ round end
function onRoundEnd(state) {
  setPhase('results');
  const rank = rankPlayers(state);
  const li = state.players.findIndex((p) => p.id === 'p1');
  const local = state.players[li];
  const won = state.winner === 'p1';
  const unlocked = [];

  // Progression & achievements (idempotent).
  if (local.area > 9 || local.eliminations > 0) {
    if (platform.unlockAchievement(app.progress, 'first-claim')) unlocked.push('first-claim');
  }
  app.progress.longRoadTotal = (app.progress.longRoadTotal || 0) + local.area;
  if (app.progress.longRoadTotal >= 10000 && platform.unlockAchievement(app.progress, 'long-road')) unlocked.push('long-road');

  let progressText = '';
  if (app.mode === 'journey' && app.modeData.stage) {
    const sid = app.modeData.stage.id;
    const score = local.area + local.eliminations * 50;
    const prev = app.progress.stagesCompleted[sid];
    if (!prev || score > prev.score) app.progress.stagesCompleted[sid] = { score: score, won: won };
    if (won) {
      app.streak++;
      if (app.streak >= 3 && platform.unlockAchievement(app.progress, 'streak-three')) unlocked.push('streak-three');
      if (app.modeData.stage.index === 40 && platform.unlockAchievement(app.progress, 'chapter-five')) unlocked.push('chapter-five');
    } else app.streak = 0;
    progressText = 'Journey stage ' + app.modeData.stage.index + ' recorded. Best: ' + app.progress.stagesCompleted[sid].score + '.';
  } else if (app.mode === 'learn' && app.lesson) {
    app.progress.lessonsCompleted[app.lesson.id] = { done: true };
    if (Object.keys(app.progress.lessonsCompleted).length >= LESSONS.length &&
        platform.unlockAchievement(app.progress, 'mechanic-mastery')) unlocked.push('mechanic-mastery');
    progressText = 'Lesson complete.';
  } else if (app.mode === 'daily') {
    const d = dailySeed(new Date(platform.serverNow()));
    const score = local.area + local.eliminations * 50;
    if (!app.progress.bestDaily[d.day] || score > app.progress.bestDaily[d.day]) {
      app.progress.bestDaily[d.day] = { score: score, seed: d.seed, contentVersion: CONTENT_VERSION, duration: state.tick };
      progressText = 'New daily best: ' + score + '.';
    }
    app.streak = won ? app.streak + 1 : 0;
  } else if (app.mode === 'practice') {
    progressText = 'Practice is unranked; rating unchanged.';
  }
  platform.saveProgress(app.progress);
  platform.track('round-end', { mode: app.mode, reason: state.reason, won: won });
  audio.play(won ? 'win' : 'lose');

  // Save replay envelope for inspection.
  try {
    const env = app.session.envelope();
    localStorage.setItem('territory-trail-last-replay', JSON.stringify(env));
  } catch (e) { /* storage unavailable */ }

  ui.updateRails(state, 'p1', app.progress);
  ui.showResults(state, 'p1', { rank: rank, unlocked: unlocked, progressText: progressText });
}

// ------------------------------------------------------------------ input
function sendDir(dir) {
  if (app.hosted && app.hosted.ws && app.hosted.ws.readyState === 1) {
    app.hosted.ws.send(JSON.stringify({ type: 'dir', dir: dir, cmdId: 'c' + (++app.hosted.cmdCounter) }));
    audio.play('input');
    return;
  }
  if (!app.session) return;
  const res = app.session.sendDirection(dir);
  audio.play(res.ok ? 'input' : 'invalid');
  if (!res.ok) ui.announce('Cannot move ' + dir + ': ' + res.reason);
  if (res.ok && app.mode === 'learn' && app.lessonStats) app.lessonStats.moves++;
}

function bindInput() {
  const keymap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };
  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const dir = keymap[e.key];
    if (dir && app.phase === 'active') { e.preventDefault(); sendDir(dir); return; }
    if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P')) {
      if (app.phase === 'active') pauseGame();
      else if (app.phase === 'paused') resumeGame();
      return;
    }
    if ((e.key === 'u' || e.key === 'U') && app.phase === 'active' && app.mode === 'practice') onAction('undo');
    if ((e.key === 'c' || e.key === 'C') && app.phase === 'active') onAction('camera');
  });

  // Swipe / pointer on canvas: tap = steer toward tapped cell; drag = direction.
  const el = app.renderer.renderer.domElement;
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    audio.unlock();
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - start.t;
    start = null;
    if (app.phase !== 'active') return;
    if (dist > 24) {
      // Drag: dominant axis wins.
      sendDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    } else if (dt < 400) {
      // Tap: steer toward tapped cell relative to the player.
      const rect = el.getBoundingClientRect();
      const cell = app.renderer.pickCell(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      if (cell && app.session) {
        const p = app.session.state.players[app.session.localPlayerIndex()];
        if (p) {
          const ddx = cell.x - p.x, ddy = cell.y - p.y;
          if (Math.abs(ddx) > Math.abs(ddy)) sendDir(ddx > 0 ? 'right' : 'left');
          else if (ddy !== 0) sendDir(ddy > 0 ? 'down' : 'up');
        }
      }
    }
  });
  el.addEventListener('pointercancel', () => { start = null; });
  el.addEventListener('lostpointercapture', () => { start = null; });

  // Gamepad polling.
  let padPrev = {};
  setInterval(() => {
    if (app.phase !== 'active' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      const prev = padPrev[pad.index] || {};
      const cur = {};
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) {
        const dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up');
        if (prev.dir !== dir) sendDir(dir);
        cur.dir = dir;
      }
      if (pad.buttons[9] && pad.buttons[9].pressed && !prev.start) pauseGame();
      cur.start = pad.buttons[9] && pad.buttons[9].pressed;
      padPrev[pad.index] = cur;
    }
  }, 100);
}

function onVisibility() {
  if (document.hidden) {
    if (app.phase === 'active' && !app.hosted) {
      app.pausedByHidden = true;
      pauseGame(); // solo simulation pauses on backgrounding
    }
  } else if (app.pausedByHidden) {
    app.pausedByHidden = false;
    // Stay paused; player resumes deliberately (no surprise inputs).
  }
}

// ------------------------------------------------------------------ hosted play
function hostedJoin(room) {
  if (app.hosted) hostedLeave();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = proto + '//' + location.host + '/ws?room=' + encodeURIComponent(room);
  let ws;
  try { ws = new WebSocket(url); } catch (e) { ui.setHostedStatus('Cannot open WebSocket: ' + e.message); return; }
  app.hosted = { ws: ws, room: room, playerId: null, cmdCounter: 0, state: null, alive: false };
  ui.setHostedStatus('Connecting to room "' + room + '"…');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name: 'You' }));
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    const H = app.hosted;
    if (msg.type === 'welcome') {
      H.playerId = msg.playerId;
      ui.setHostedStatus('Joined room "' + room + '" as ' + msg.playerId + '. Waiting for players…');
    } else if (msg.type === 'roster') {
      ui.setHostedStatus('Room "' + room + '" — ' + msg.players.length + ' in lobby.', msg.players.map((p) => p.name + (p.id === H.playerId ? ' (you)' : '')));
    } else if (msg.type === 'start') {
      ui.setHostedStatus('Round starting…');
      setPhase('preparing');
      ui.setObjective('Hosted round: claim territory, cut rivals, survive.');
      ui.setStatus('Hosted — ' + room, '');
      countdown(3, () => { setPhase('active'); ui.showHudOnly(); });
    } else if (msg.type === 'snapshot') {
      H.state = msg.state;
      if (app.phase === 'active' || app.phase === 'preparing') {
        if (!app.renderer.board || app.renderer.lastStateDims.w !== msg.state.width) {
          app.renderer.buildBoard(msg.state, effectiveTheme('tide-pool'));
          app.renderer.resize();
        }
        app.renderer.update({ state: msg.state, events: msg.events || [] }, 1);
        ui.updateRails(msg.state, H.playerId, app.progress);
        const me = msg.state.players.find((p) => p.id === H.playerId);
        ui.setDanger(me && me.trail.length > 0);
      }
    } else if (msg.type === 'ack') {
      if (!msg.ok) { ui.announce('Move rejected: ' + msg.reason); audio.play('invalid'); }
    } else if (msg.type === 'end') {
      setPhase('results');
      ui.showResults(msg.state, H.playerId, { rank: msg.rank, unlocked: [], progressText: 'Hosted result verified by the server. Reason: ' + msg.state.reason + '.' });
      audio.play(msg.state.winner === H.playerId ? 'win' : 'lose');
      hostedLeave();
    } else if (msg.type === 'error') {
      ui.setHostedStatus('Error: ' + msg.message);
    }
  };
  ws.onclose = () => {
    if (app.hosted && app.hosted.ws === ws) {
      ui.setHostedStatus('Disconnected.');
      if (app.phase === 'active') { pauseGame(); ui.setStatus('Hosted — reconnecting', ''); }
    }
  };
  ws.onerror = () => ui.setHostedStatus('Connection failed. Is the server running?');
}

function hostedLeave() {
  if (app.hosted && app.hosted.ws) {
    try { app.hosted.ws.close(); } catch (e) {}
  }
  app.hosted = null;
}

// ------------------------------------------------------------------ frame loop
let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const hidden = document.hidden;
  if (app.session && app.session.running) {
    app.session.tickFrame(now);
    const snap = app.session.state;
    if (snap.tick !== app.lastTickApplied) {
      app.lastTickApplied = snap.tick;
      app.renderer.endTick(snap);
      // Per-tick UI: danger state, lesson tracking, mirror, rails.
      const li = app.session.localPlayerIndex();
      if (li >= 0) {
        const p = snap.players[li];
        ui.setDanger(p.alive && p.trail.length > 0);
        ui.mirrorBoard('Tick ' + snap.tick + ' of ' + snap.maxTicks + '. You have ' + p.area +
          ' cells and ' + p.eliminations + ' eliminations. ' +
          (p.alive ? (p.trail.length > 0 ? 'Your trail is exposed with ' + p.trail.length + ' cells.' : 'You are safe inside your territory.') : 'You are eliminated.'));
      }
      if (app.mode === 'learn' && app.lesson) trackLesson(snap);
      if (snap.tick % 16 === 0) ui.updateRails(snap, 'p1', app.progress);
      // Audio for logical events.
    }
    const evs = app.session.events; app.session.events = [];
    for (const ev of evs) {
      if (ev.kind === 'claim') { audio.play('claim'); if (app.mode === 'learn' && app.lessonStats) app.lessonStats.claims++; }
      else if (ev.kind === 'eliminated') audio.play('eliminated');
      else if (ev.kind === 'ended') { /* handled by onEnd */ }
    }
    if (!hidden) {
      const alpha = app.session.paused ? 1 : Math.min(1, app.session.accumulator / TICK_MS);
      app.renderer.update({ state: snap, events: [] }, alpha);
    }
  }
  if (!hidden && app.renderer && !app.renderer.failed) app.renderer.render();
  lastFrame = now;
}

function trackLesson(state) {
  const l = app.lesson, st = app.lessonStats;
  let complete = false;
  if (l.requires === 'move') complete = st.moves >= l.minMoves;
  else if (l.requires === 'claim') complete = st.claims >= (l.minClaims || 1);
  else if (l.requires === 'survive') complete = state.tick >= l.minTicks;
  else if (l.requires === 'cut') {
    st.eliminations = state.players[app.session.localPlayerIndex()].eliminations;
    complete = st.eliminations >= (l.minEliminations || 1);
  }
  if (complete && state.phase === PHASE.ACTIVE) {
    state.phase = PHASE.ENDED; // lesson success: end via session path
    state.reason = 'lesson-complete';
    state.winner = 'p1';
    app.session.events.push({ kind: 'ended', reason: 'lesson-complete' });
    onRoundEnd(state);
  }
}

boot();

// Debug/testing handle (read-only usage expected).
window.__tt = app;
