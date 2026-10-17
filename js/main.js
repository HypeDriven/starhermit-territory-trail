'use strict';

// Bootstrap/controller: game-state machine, input routing, mode orchestration.
// boot → title → mode-select → preparing → countdown → active ↔ paused → results → progression
import { Session, TICK_MS } from './session.js';
import { Renderer } from './render.js';
import { ui } from './ui.js';
import * as audio from './audio.js';
import * as platform from './platform.js?v=l10n1017';
import { RoomsClient } from './net.js?v=l10n1017';
import { shText } from './sh-i18n.js';
import { t, locale, onLanguage, stageName, stageGoal, lessonTitle, lessonText, difficultyName, challengeName, challengeGoal, rejectReason, dirName, endReason } from './i18n.js';

// Platform-control strings (sh-i18n.js) in the game language.
const sh = (key, vars) => shText(key, vars || {}, locale());
import { STAGES, LESSONS, dailyChallenge, themeById, CONTENT_VERSION } from './content.js';
import { PHASE, rankPlayers, legalDirections, makeEnvelope, dailySeed, createGame, initHash, step as stepGame } from './rules.js';

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
  hosted: null, // { mode: 'rooms', client, room, playerId, state }
  lastTickApplied: -1,
  pausedByHidden: false,
  bindings: platform.DEFAULT_BINDINGS, // replaced by platform.loadBindings() at boot
  hudText: null, // { goal(), label() } for the HUD objective + status badge, re-rendered on a language change
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
  // Platform handshake runs on every boot path (even the no-WebGL fallback):
  // profile nickname + remote-preferred cloud save when a launch token was read.
  platform.onSyncStatus(() => ui.setPlayerStatus(platform.accountLine()));
  platform.onAuth((a) => {
    // A refused renewal before a room reconnect shows the expired screen instead.
    const renewing = app.hosted && app.hosted.client && app.hosted.client.renewing;
    if (!a.signedIn && !renewing) toast(sh('signedOut'), 4000);
    refreshAccountButtons();
    ui.setPlayerStatus(platform.accountLine());
  });
  onLanguage(relabel);
  relabel();
  refreshAccountButtons();
  $('btn-signin').addEventListener('click', () => platform.signIn());
  $('btn-invite').addEventListener('click', copyInvite);
  // Another device saved first: platform.js merged both saves; adopt the merged progress.
  platform.onMerged(() => {
    app.progress = platform.loadProgress();
    ui.updateRails(null, null, app.progress);
    if (app.phase === 'title') $('title-progress').textContent = progressSummary();
  });
  platform.initHosted().then(async (remoteApplied) => {
    // Platform-stored preferences (adopted by initHosted) win over local ones.
    const adopted = platform.loadSettings();
    if (platform.isHosted() && JSON.stringify(adopted) !== JSON.stringify(app.settings)) {
      Object.assign(app.settings, adopted);
      ui.applyAccessibility();
      applyQuality();
      audio.updateSettings(app.settings); // no AudioContext before a gesture
    }
    app.bindings = await platform.loadBindings();
    ui.setBindings(app.bindings);
    refreshAccountButtons();
    if (remoteApplied) {
      app.progress = platform.loadProgress();
      ui.updateRails(null, null, app.progress);
      $('title-progress').textContent = progressSummary();
    }
    updateDailyLabel();
    ui.setPlayerStatus(platform.accountLine());
  });

  const host = $('canvas-host');
  app.renderer = new Renderer(host);
  if (app.renderer.failed) {
    $('screen-title').innerHTML = '<div class="card"><h1 data-i18n="webglTitle"></h1><p data-i18n="webglBody"></p></div>';
    $('screen-title').querySelector('h1').textContent = t('webglTitle');
    $('screen-title').querySelector('p').textContent = t('webglBody');
    ui.init(app.settings, onAction);
    ui.show('title');
    return;
  }

  ui.gfxInfo = (words) => app.renderer.graphicsInfo(words);
  ui.init(app.settings, onAction);
  audio.init(app.settings);

  migrateGraphics();
  applyQuality();
  bindInput();
  startAttract();
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
  const stages = Object.values(app.progress.stagesCompleted).filter((r) => r && r.won).length;
  return stages > 0 ? t('progressSummary', { n: stages, total: STAGES.length }) : t('newHere');
}

function updateDailyLabel() {
  const d = dailySeed(new Date(platform.serverNow()));
  $('btn-daily').textContent = t('dailyButton', { day: d.day });
}

function reducedMotion() {
  return !!app.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Older builds stored one coarse `quality` tier; carry an explicit choice over once.
function migrateGraphics() {
  if (app.settings.graphics && typeof app.settings.graphics === 'object') return;
  const map = { low: 'low', medium: 'balanced', high: 'high' };
  app.settings.graphics = map[app.settings.quality] ? { preset: map[app.settings.quality] } : { preset: 'auto' };
}

function applyQuality() {
  app.renderer.setGraphics(app.settings.graphics, reducedMotion());
}

// Title backdrop: a small rival-only round plays itself behind the menu.
const ATTRACT_TICK_MS = 150;
function startAttract() {
  if (!app.renderer || app.renderer.failed) return;
  const bots = [0, 1, 2, 3].map((i) => ({ id: 'a' + i, name: 'Demo ' + (i + 1), isBot: true }));
  const g = createGame({ seed: 9401, width: 26, height: 18, maxTicks: 100000, players: bots });
  initHash(g);
  for (let i = 0; i < 160 && g.phase === PHASE.ACTIVE; i++) stepGame(g);
  app.attract = { state: g, last: 0, steps: 0 };
  app.renderer.buildBoard(g, effectiveTheme('meadow-dawn'));
  app.renderer.setAttract(true);
  app.renderer.update({ state: g, events: [] }, 1);
}

function tickAttract(now) {
  const A = app.attract;
  if (!A || app.phase !== 'title' || app.session) return;
  if (reducedMotion() || app.renderer.q.background !== 'animated') return;
  if (now - A.last < ATTRACT_TICK_MS) return;
  A.last = now;
  stepGame(A.state);
  A.steps++;
  if (A.state.phase !== PHASE.ACTIVE || A.steps > 1200) { startAttract(); return; }
  app.renderer.update({ state: A.state, events: [] }, 1);
}

// ------------------------------------------------------------------ actions
function onAction(action, payload) {
  audio.unlock();
  switch (action) {
    case 'play':
      // Short path to play: continue Journey at first unfinished stage.
      {
        const next = STAGES.find((s) => !(app.progress.stagesCompleted[s.id] && app.progress.stagesCompleted[s.id].won)) || STAGES[STAGES.length - 1];
        startJourneyStage(next);
      }
      break;
    case 'mode':
      if (payload === 'daily') { startDaily(); break; }
      if (payload === 'hosted') {
        setPhase('mode-select');
        ui.setHostedMode({ rooms: platform.isHosted() });
        ui.show('hosted');
        break;
      }
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
        ui.announce(t('undone'));
        app.renderer.buildBoard(app.session.state, effectiveTheme(app.modeData.theme));
      }
      break;
    case 'camera': app.renderer.resize(); ui.announce(t('cameraReset')); break;
    case 'hosted-quickjoin': roomsJoin(false); break;
    case 'hosted-create': roomsJoin(true); break;
    case 'hosted-start':
      if (app.hosted && app.hosted.mode === 'rooms' && app.hosted.client) app.hosted.client.startRound();
      break;
    case 'hosted-leave':
      hostedLeave();
      ui.setHostedStartVisible(false, false);
      ui.setHostedStatus({ key: platform.isHosted() ? 'leftRoom' : 'notConnected' });
      break;
    case 'relaunch':
      if (!platform.relaunch()) toast(sh('signedOut'), 4000);
      break;
    case 'overlay-closed': break;
    case 'settings-changed':
      applyQuality();
      audio.updateSettings(app.settings);
      break;
  }
}

// ------------------------------------------------------------------ modes
function playerDefs(botCount, names) {
  const defs = [{ id: 'p1', name: platform.getDisplayName() || 'You', isBot: false }];
  for (let i = 0; i < botCount; i++) defs.push({ id: 'b' + (i + 1), name: (names && names[i]) || ('Rival ' + (i + 1)), isBot: true });
  return defs;
}

function beginRound(config, defs, modeData) {
  if (app.session) app.session.stop();
  app.modeData = modeData;
  wasExposed = false;
  app.session = new Session(config, defs, 'p1');
  app.session.allowUndo = modeData.mode === 'practice';
  app.session.onEnd = onRoundEnd;
  ui.setUndoVisible(modeData.mode === 'practice');
  app.hudText = { goal: modeData.goal, label: modeData.label };
  ui.setObjective(modeData.goal());
  ui.setStatus(modeData.label(), '');
  ui.announce(modeData.goal());
  app.attract = null;
  app.renderer.buildBoard(app.session.state, effectiveTheme(modeData.theme));
  app.renderer.resize();
  setPhase('preparing');
  countdown(3, () => {
    setPhase('active');
    ui.showHudOnly();
    app.session.start();
  });
}

let countdownToken = 0;
let wasExposed = false; // local trail-exposed edge, for the warning ping
function countdown(n, done) {
  const token = ++countdownToken; // invalidate any still-pending countdown chain
  ui.show('countdown');
  const el = $('countdown-num');
  let left = n;
  const stepFn = () => {
    if (token !== countdownToken) return; // a newer round superseded this one
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
    { mode: 'journey', stage: stage, theme: stage.theme, goal: () => stageGoal(stage), label: () => t('labelJourney', { n: stage.index, name: stageName(stage) }) }
  );
}

function startPractice(diff) {
  app.mode = 'practice';
  const seed = (Date.now() % 100000) >>> 0;
  beginRound(
    { seed: seed, width: diff.width, height: diff.height, maxTicks: diff.maxTicks, areaGoal: diff.areaGoal },
    playerDefs(diff.bots),
    { mode: 'practice', difficulty: diff, theme: 'meadow-dawn', goal: () => t('goalPractice', { name: difficultyName(diff), n: diff.areaGoal }), label: () => t('labelPractice', { name: difficultyName(diff) }) }
  );
}

function startDaily() {
  app.mode = 'daily';
  const d = dailyChallenge(new Date(platform.serverNow()));
  beginRound(
    { seed: d.seed, width: d.width, height: d.height, maxTicks: d.maxTicks, areaGoal: d.areaGoal },
    playerDefs(d.bots),
    { mode: 'daily', daily: d, theme: d.theme, goal: () => t('goalDaily'), label: () => t('labelDaily', { day: d.day }) }
  );
}

function startChallenge(c) {
  app.mode = 'challenge';
  beginRound(
    { ...c.config },
    playerDefs(c.config.bots),
    { mode: 'challenge', challenge: c, theme: 'slate-storm', goal: () => challengeGoal(c), label: () => t('labelChallenge', { name: challengeName(c) }) }
  );
}

function startLesson(lesson) {
  app.mode = 'learn';
  app.lesson = lesson;
  app.lessonStats = { moves: 0, claims: 0, eliminations: 0 };
  beginRound(
    { ...lesson.config },
    playerDefs(lesson.config.bots),
    { mode: 'learn', lesson: lesson, theme: lesson.theme, goal: () => t('goalLesson', { title: lessonTitle(lesson), text: lessonText(lesson) }), label: () => t('labelLearn', { name: lessonTitle(lesson) }) }
  );
}

function pauseGame() {
  if (!app.session || app.phase !== 'active') return;
  app.session.pause();
  setPhase('paused');
  ui.show('pause');
  ui.announce(t('announcePaused'));
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
  ++countdownToken;
  if (app.session) { app.session.stop(); app.session = null; }
  if (app.hosted) hostedLeave(); // leaving from the lobby/results drops the room seat
  setPhase('title');
  startAttract();
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

  let progressText = () => '';
  if (app.mode === 'journey' && app.modeData.stage) {
    const sid = app.modeData.stage.id;
    const score = local.area + local.eliminations * 50;
    // Best score and attempts are recorded for every run; a stage only
    // counts as complete once it has actually been won.
    const prev = app.progress.stagesCompleted[sid] || { score: 0, won: false, attempts: 0 };
    app.progress.stagesCompleted[sid] = {
      score: Math.max(prev.score || 0, score),
      won: !!(prev.won || won),
      attempts: (prev.attempts || 0) + 1,
    };
    if (won) {
      app.streak++;
      if (app.streak >= 3 && platform.unlockAchievement(app.progress, 'streak-three')) unlocked.push('streak-three');
      if (app.modeData.stage.index === 40 && platform.unlockAchievement(app.progress, 'chapter-five')) unlocked.push('chapter-five');
    } else app.streak = 0;
    const idx = app.modeData.stage.index, best = app.progress.stagesCompleted[sid].score;
    progressText = () => t(won ? 'stageComplete' : 'stageIncomplete', { n: idx }) + t('bestN', { n: best });
  } else if (app.mode === 'learn' && app.lesson) {
    app.progress.lessonsCompleted[app.lesson.id] = { done: true };
    if (Object.keys(app.progress.lessonsCompleted).length >= LESSONS.length &&
        platform.unlockAchievement(app.progress, 'mechanic-mastery')) unlocked.push('mechanic-mastery');
    progressText = () => t('lessonComplete');
  } else if (app.mode === 'daily') {
    const d = dailySeed(new Date(platform.serverNow()));
    const score = local.area + local.eliminations * 50;
    if (!app.progress.bestDaily[d.day] || score > app.progress.bestDaily[d.day]) {
      app.progress.bestDaily[d.day] = { score: score, seed: d.seed, contentVersion: CONTENT_VERSION, duration: state.tick };
      progressText = () => t('newDailyBest', { n: score });
    }
    app.streak = won ? app.streak + 1 : 0;
  } else if (app.mode === 'practice') {
    progressText = () => t('practiceUnranked');
  }
  platform.saveProgress(app.progress);
  audio.play(won ? 'win' : 'lose');

  // Save replay envelope for inspection.
  try {
    const env = app.session.envelope();
    localStorage.setItem('territory-trail-last-replay', JSON.stringify(env));
  } catch (e) { /* storage unavailable */ }

  ui.updateRails(state, 'p1', app.progress);
  ui.showResults(state, 'p1', { rank: rank, unlocked: unlocked, progressText: progressText });
  postToLeaderboard(local.area + local.eliminations * 50);
}

// Signed in: Journey, Daily and Challenge rounds post their total to the
// platform high-score board; the results screen shows the player's rank.
function postToLeaderboard(total) {
  const line = $('results-lb');
  if (!line || !platform.isHosted() || !['journey', 'daily', 'challenge'].includes(app.mode)) return;
  const session = app.session;
  line.hidden = false;
  ui.setLeaderboardLine({ key: 'lbPosting' });
  platform.submitScore(total).then((r) => {
    if (app.session !== session || !line.isConnected) return;
    ui.setLeaderboardLine(!r.posted ? { key: 'lbNotPosted' } : r.rank ? { key: 'lbRank', vars: { rank: r.rank } } : { key: 'lbPosted' });
  });
}

// ------------------------------------------------------------------ input
function sendDir(dir) {
  const H = app.hosted;
  if (H && H.mode === 'rooms') {
    if (H.client.isHost) {
      const res = H.client.hostSendDir(dir, 'c' + (++H.cmdCounter));
      audio.play(res.ok ? 'input' : 'invalid');
      if (!res.ok) ui.announce(t('cannotMove', { dir: dirName(dir), reason: rejectReason(res.reason) }));
      return;
    }
    if (H.client.guestSendDir(dir, 'c' + (++H.cmdCounter))) audio.play('input');
    return;
  }
  if (!app.session) return;
  const res = app.session.sendDirection(dir);
  audio.play(res.ok ? 'input' : 'invalid');
  if (!res.ok) ui.announce(t('cannotMove', { dir: dirName(dir), reason: rejectReason(res.reason) }));
  if (res.ok && app.mode === 'learn' && app.lessonStats) app.lessonStats.moves++;
}

function refreshAccountButtons() {
  $('btn-signin').hidden = !platform.canSignIn();
  $('btn-invite').hidden = !platform.inviteLink();
}

let toastTimer = 0;
function toast(msg, ms) {
  const el = $('sh-toast');
  el.textContent = msg;
  el.hidden = false;
  ui.announce(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
}

async function copyInvite() {
  const url = platform.inviteLink();
  if (!url) return;
  try { await navigator.clipboard.writeText(url); toast(sh('copied')); }
  catch (e) { toast(sh('copyFail', { url: url }), 6000); }
}

function bindInput() {
  // Keydown routes through the effective bindings (KeyboardEvent.code).
  const is = (action, e) => (app.bindings[action] || []).indexOf(e.code) >= 0;
  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const dir = ['up', 'down', 'left', 'right'].find((d) => is(d, e));
    if (dir && app.phase === 'active') { e.preventDefault(); sendDir(dir); return; }
    if (is('pause', e)) {
      if (app.phase === 'active') pauseGame();
      else if (app.phase === 'paused') resumeGame();
      return;
    }
    if (is('undo', e) && app.phase === 'active' && app.mode === 'practice') onAction('undo');
    if (is('camera', e) && app.phase === 'active') onAction('camera');
  });

  // One-input confidence: every button press acknowledges with the ui clip.
  // Touch-pad steer buttons already play their own input/move sounds.
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (b && !b.closest('#touch-pad')) audio.play('ui');
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
// StarHermit realtime rooms (host-routed) — signed-in only; the hosted screen
// shows an unavailable note standalone.
async function roomsJoin(asHost) {
  if (!platform.isHosted()) return;
  if (app.hosted) hostedLeave();
  const client = new RoomsClient(platform);
  app.hosted = { mode: 'rooms', client: client, room: null, playerId: null, cmdCounter: 0, state: null, alive: false };
  client.on('status', (m) => ui.setHostedStatus(m));
  client.on('welcome', (m) => hostedMessage({ type: 'welcome', playerId: m.playerId }));
  client.on('roster', (m) => hostedMessage({ type: 'roster', players: m.players }));
  client.on('start', (m) => { ui.setHostedStartVisible(false, client.isHost); hostedMessage({ type: 'start', seed: m.seed }); });
  client.on('snapshot', (m) => hostedMessage({ type: 'snapshot', state: m.state, events: m.events || [] }));
  client.on('ack', (m) => hostedMessage({ type: 'ack', cmdId: m.cmdId, ok: m.ok, reason: m.reason, playerId: m.playerId }));
  client.on('end', (m) => hostedMessage({ type: 'end', state: m.state, rank: m.rank }));
  client.on('error', (m) => hostedMessage({ type: 'error', message: m.message }));
  client.on('closed', () => hostedMessage({ type: 'closed' }));
  client.on('auth-lost', (m) => hostedMessage({ type: 'auth-lost', terms: !!m.terms }));
  client.on('unavailable', () => hostedMessage({ type: 'unavailable' }));
  try {
    const ok = asHost ? await client.createAndOpen() : await client.quickJoin();
    if (!ok || !app.hosted || app.hosted.client !== client) { app.hosted = null; return; } // honest note already shown
    app.hosted.room = client.roomId;
    ui.setHostedStartVisible(true, client.isHost);
  } catch (e) {
    if (app.hosted && app.hosted.client === client) app.hosted = null;
    ui.setHostedStatus({ key: 'hostedUnavailable', vars: { error: e.message } });
  }
}

function hostedMessage(msg) {
  const H = app.hosted;
  if (!H) return;
  if (msg.type === 'welcome') {
    H.playerId = msg.playerId;
    const name = { name: platform.getDisplayName() || msg.playerId };
    ui.setHostedStatus(H.room ? { key: 'joinedRoom', vars: { room: H.room, ...name } } : { key: 'joined', vars: name });
  } else if (msg.type === 'roster') {
    ui.setHostedStatus(H.room ? { key: 'roomLobby', vars: { room: H.room, n: msg.players.length } } : { key: 'lobby', vars: { n: msg.players.length } },
      msg.players.map((p) => ({ name: p.name, you: p.id === H.playerId })));
  } else if (msg.type === 'start') {
    ui.setHostedStatus({ key: 'roundStartingStatus' });
    H.needBoard = true; // force a fresh board: player count/theme may differ from the last solo round
    setPhase('preparing');
    const room = H.room || 'room';
    app.hudText = { goal: () => t('goalHosted'), label: () => t('labelHosted', { room }) };
    ui.setObjective(app.hudText.goal());
    ui.setStatus(app.hudText.label(), '');
    countdown(3, () => { setPhase('active'); ui.showHudOnly(); });
  } else if (msg.type === 'snapshot') {
    H.state = msg.state;
    if (app.phase === 'active' || app.phase === 'preparing') {
      if (H.needBoard || !app.renderer.board || app.renderer.lastStateDims.w !== msg.state.width || app.renderer.lastStateDims.h !== msg.state.height) {
        H.needBoard = false;
        app.renderer.buildBoard(msg.state, effectiveTheme('tide-pool'));
        app.renderer.resize();
      }
      app.renderer.update({ state: msg.state, events: msg.events || [] }, 1);
      ui.updateRails(msg.state, H.playerId, app.progress);
      const me = msg.state.players.find((p) => p.id === H.playerId);
      ui.setDanger(me && me.trail.length > 0);
    }
  } else if (msg.type === 'ack') {
    if (msg.playerId && msg.playerId !== H.playerId) return; // another guest's ack
    if (!msg.ok) { ui.announce(t('moveRejected', { reason: rejectReason(msg.reason) })); audio.play('invalid'); }
  } else if (msg.type === 'end') {
    setPhase('results');
    const reason = msg.state.reason;
    ui.showResults(msg.state, H.playerId, { rank: msg.rank, unlocked: [], progressText: () => t('hostedResult', { reason: endReason(reason) }) });
    audio.play(msg.state.winner === H.playerId ? 'win' : 'lose');
    hostedLeave();
  } else if (msg.type === 'error') {
    // net.js reports its own errors as { key, vars }; a platform error frame carries text.
    ui.setHostedStatus(msg.message && typeof msg.message === 'object' ? msg.message : typeof msg.message === 'string' ? msg.message : { key: 'roomError' });
  } else if (msg.type === 'auth-lost') {
    // Launch token dead, or StarHermit needs the player to accept updated
    // terms: reconnecting stopped; offer a fresh launch (localized either way).
    app.hosted = null;
    ui.setHostedStartVisible(false, false);
    expiredKind = msg.terms ? 'terms' : 'expired';
    labelExpired();
    ui.setHostedStatus({ sh: expiredKind === 'terms' ? 'termsTitle' : 'expiredTitle' });
    goHome();
    ui.show('expired');
  } else if (msg.type === 'unavailable') {
    // The room is gone: the reconnect loop has ended; say so on the hosted screen.
    app.hosted = null;
    goHome();
    ui.setHostedMode({ rooms: platform.isHosted() });
    ui.setHostedStatus({ key: 'roomGone' });
    ui.show('hosted');
    toast(t('roomGone'), 5000);
  } else if (msg.type === 'closed') {
    ui.setHostedStatus({ key: 'disconnected' });
    if (app.phase === 'active') { pauseGame(); app.hudText = { ...app.hudText, label: () => t('labelReconnecting') }; ui.setStatus(app.hudText.label(), ''); }
  }
}

function hostedLeave() {
  if (app.hosted && app.hosted.client) app.hosted.client.leave();
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
        const exposed = p.alive && p.trail.length > 0;
        if (exposed && !wasExposed) audio.play('warning');
        wasExposed = exposed;
        ui.setDanger(exposed);
        const remainTicks = Math.max(0, snap.maxTicks - snap.tick);
        const remainSec = Math.ceil(remainTicks * TICK_MS / 1000);
        ui.setClock(t('timeLeft', { time: Math.floor(remainSec / 60) + ':' + String(remainSec % 60).padStart(2, '0') }));
        ui.mirrorBoard(t('mirror', { tick: snap.tick, max: snap.maxTicks, area: p.area, elims: p.eliminations,
          state: p.alive ? (p.trail.length > 0 ? t('mirrorExposed', { n: p.trail.length }) : t('mirrorSafe')) : t('mirrorOut') }));
      }
      if (app.mode === 'learn' && app.lesson) trackLesson(snap);
      if (snap.tick % 16 === 0) ui.updateRails(snap, 'p1', app.progress);
      // Audio for logical events.
    }
    const evs = app.session.events; app.session.events = [];
    const fxEvents = evs.filter((ev) => ev.kind === 'claim');
    for (const ev of evs) {
      if (ev.kind === 'claim') { audio.play('claim'); if (app.mode === 'learn' && app.lessonStats) app.lessonStats.claims++; }
      else if (ev.kind === 'cut') audio.play('cut');
      else if (ev.kind === 'eliminated') audio.play('eliminated');
      else if (ev.kind === 'input') audio.play('move');
      else if (ev.kind === 'ended') { /* handled by onEnd */ }
    }
    if (!hidden) {
      const alpha = app.session.paused ? 1 : Math.min(1, app.session.accumulator / TICK_MS);
      app.renderer.update({ state: snap, events: fxEvents }, alpha);
    }
  } else if (!hidden) {
    tickAttract(now);
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

// ------------------------------------------------------------------ language
let expiredKind = 'expired'; // 'expired' | 'terms'
function labelExpired() {
  $('expired-h').textContent = sh(expiredKind === 'terms' ? 'termsTitle' : 'expiredTitle');
  $('expired-body').textContent = sh(expiredKind === 'terms' ? 'termsBody' : 'expiredBody');
  $('btn-relaunch').textContent = sh('relaunch');
  $('btn-expired-local').textContent = sh('playLocal');
}

/** Re-render code-built text in the current language; the round and any room keep running. */
function relabel() {
  $('btn-signin').textContent = sh('signIn');
  $('btn-invite').textContent = sh('invite');
  labelExpired();
  if (!app.renderer || app.renderer.failed) {
    const h1 = document.querySelector('#screen-title h1[data-i18n="webglTitle"]');
    if (h1) { h1.textContent = t('webglTitle'); h1.nextElementSibling.textContent = t('webglBody'); }
  }
  updateDailyLabel();
  $('title-progress').textContent = progressSummary();
  ui.setPlayerStatus(platform.accountLine());
  if (app.hudText && (app.session || app.hosted)) {
    ui.setObjective(app.hudText.goal());
    $('status-mode').textContent = app.hudText.label();
  }
  ui.relabel(app.progress);
}

boot();

// Debug/testing handle (read-only usage expected).
window.__tt = app;
