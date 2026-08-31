'use strict';

// Content: versioned stages, themes, tutorial lessons, and offline validators.
import { createGame, step, initHash, PHASE, mulberry32, dailySeed, fnv1a } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------- themes
export const THEMES = [
  {
    id: 'meadow-dawn', name: 'Meadow Dawn',
    background: '#0b1220', grid: '#16233c', gridLine: '#22344f',
    empty: '#1b2b47', players: ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171'],
    trailGlow: '#e8ecf3', ambience: 'bright',
  },
  {
    id: 'ember-night', name: 'Ember Night',
    background: '#140c0c', grid: '#241414', gridLine: '#3a1f1f',
    empty: '#2b1818', players: ['#fb923c', '#facc15', '#f87171', '#e879f9', '#fdba74', '#fca5a5'],
    trailGlow: '#ffe4c7', ambience: 'warm',
  },
  {
    id: 'tide-pool', name: 'Tide Pool',
    background: '#041a1e', grid: '#0a2b31', gridLine: '#114149',
    empty: '#0d343b', players: ['#2dd4bf', '#38bdf8', '#a3e635', '#f0abfc', '#fde68a', '#67e8f9'],
    trailGlow: '#d9fffb', ambience: 'cool',
  },
  {
    id: 'slate-storm', name: 'Slate Storm',
    background: '#0d1017', grid: '#181d29', gridLine: '#28304a',
    empty: '#202737', players: ['#93c5fd', '#c4b5fd', '#f9a8d4', '#6ee7b7', '#fcd34d', '#fda4af'],
    trailGlow: '#eef2ff', ambience: 'moody',
  },
  {
    id: 'contrast-forge', name: 'Contrast Forge',
    background: '#000000', grid: '#101010', gridLine: '#3f3f3f',
    empty: '#181818', players: ['#00ff88', '#00bfff', '#ff4fd8', '#ffe600', '#b26bff', '#ff5340'],
    trailGlow: '#ffffff', ambience: 'contrast',
  },
];

// ---------------------------------------------------------------- stages
// 40 authored stages + 5 mastery gates. Difficulty grows one concept at a
// time: move → claim → cut → pressure → time.
function stageDef(n, opts) {
  return {
    id: 'stage-' + String(n).padStart(2, '0'),
    index: n,
    contentVersion: CONTENT_VERSION,
    seed: opts.seed,
    width: opts.width || 30,
    height: opts.height || 30,
    bots: opts.bots,
    maxTicks: opts.maxTicks,
    areaGoal: opts.areaGoal,
    par: opts.par, // par area to reach
    mastery: !!opts.mastery,
    tutorialFlags: opts.tutorialFlags || [],
    theme: THEMES[opts.theme % THEMES.length].id,
    mechanics: opts.mechanics,
    name: opts.name,
    goalText: opts.goalText,
  };
}

export function buildStages() {
  const stages = [];
  const names1 = ['First Steps', 'Wide Loop', 'Homeward', 'Long Way Round', 'Deep Cut', 'Far Shore', 'Big Sky', 'Steady Hand'];
  const names2 = ['Intruder', 'Snip', 'Crossfire', 'Bold Claim', 'Guard Duty', 'Ambush', 'Narrow Margin', 'Mastery: Claim'];
  const names3 = ['Crowded Field', 'Threading', 'Bold Frontier', 'Counter Cut', 'Hold the Line', 'Squeeze', 'High Stakes', 'Mastery: Duel'];
  const names4 = ['Sprint', 'Clockwork', 'Blitz', 'Thin Ice', 'Deadline', 'Rapid Claim', 'Rush Hour', 'Mastery: Speed'];
  const names5 = ['Grand Arena', 'Six Ways', 'Gauntlet', 'Full Court', 'Dominion', 'Last Light', 'Summit', 'Mastery: Trail'];
  const nameSets = [names1, names2, names3, names4, names5];

  for (let chapter = 0; chapter < 5; chapter++) {
    for (let i = 0; i < 8; i++) {
      const n = chapter * 8 + i + 1;
      const mastery = i === 7;
      const size = 22 + chapter * 3 + (i % 3) * 2;
      const bots = chapter === 0 ? (i < 2 ? 0 : 1) : Math.min(1 + chapter + (i > 3 ? 1 : 0), 5);
      const maxTicks = chapter === 3 ? 500 - i * 30 : 900 + chapter * 100;
      const areaGoal = 60 + chapter * 30 + i * 10;
      const seed = parseInt(fnv1a('tt-stage-' + n), 16) >>> 0;
      stages.push(stageDef(n, {
        seed: seed, width: size, height: size, bots: bots,
        maxTicks: maxTicks, areaGoal: areaGoal, par: Math.round(areaGoal * 0.7),
        mastery: mastery, theme: chapter,
        mechanics: chapter === 0 ? ['move', 'claim']
          : chapter === 1 ? ['move', 'claim', 'cut']
          : chapter === 2 ? ['move', 'claim', 'cut', 'pressure']
          : chapter === 3 ? ['move', 'claim', 'cut', 'speed']
          : ['move', 'claim', 'cut', 'pressure', 'speed'],
        tutorialFlags: n === 1 ? ['intro-move', 'intro-claim'] : [],
        name: (mastery ? '' : '') + nameSets[chapter][i],
        goalText: 'Claim ' + areaGoal + ' cells of territory' + (maxTicks ? ' within ' + maxTicks + ' ticks' : '') + '.',
      }));
    }
  }
  return stages;
}

export const STAGES = buildStages();

// ---------------------------------------------------------------- tutorials
// Learn mode: one rule per lesson; each lesson requires the player to
// perform the action (validated through the same legal-action API).
export const LESSONS = [
  {
    id: 'lesson-move', title: 'Steer your trail',
    text: 'Use the arrow keys, WASD, or swipe to change direction. Leave your green territory to draw a trail.',
    requires: 'move', minMoves: 3, theme: THEMES[0].id,
    config: { width: 16, height: 16, maxTicks: 400, areaGoal: 0, seed: 101, bots: 0 },
  },
  {
    id: 'lesson-claim', title: 'Claim land',
    text: 'Loop back into your own territory. Everything you enclose becomes yours.',
    requires: 'claim', minClaims: 1, theme: THEMES[0].id,
    config: { width: 16, height: 16, maxTicks: 600, areaGoal: 0, seed: 102, bots: 0 },
  },
  {
    id: 'lesson-danger', title: 'Your trail is exposed',
    text: 'While your trail is out, rivals can cut it. Watch the warning color and get home safely.',
    requires: 'survive', minTicks: 120, theme: THEMES[1].id,
    config: { width: 18, height: 18, maxTicks: 600, areaGoal: 0, seed: 103, bots: 1 },
  },
  {
    id: 'lesson-cut', title: 'Cut a rival trail',
    text: 'Cross an exposed rival trail to eliminate them. Claim land to finish the lesson.',
    requires: 'cut', minEliminations: 1, theme: THEMES[2].id,
    config: { width: 20, height: 20, maxTicks: 900, areaGoal: 0, seed: 104, bots: 1 },
  },
];

// ---------------------------------------------------------------- daily
export function dailyChallenge(date) {
  const d = dailySeed(date);
  return {
    id: 'daily-' + d.key,
    contentVersion: CONTENT_VERSION,
    seed: d.seed, day: d.day,
    width: 30, height: 30, bots: 3, maxTicks: 900, areaGoal: 120,
    theme: THEMES[d.seed % THEMES.length].id,
    name: 'Daily ' + d.day,
    goalText: 'One shared seed for everyone today. Claim 120 cells in 900 ticks.',
    immutable: true,
  };
}

// ---------------------------------------------------------------- practice/challenge presets
export const PRACTICE_DIFFICULTIES = [
  { id: 'calm', name: 'Calm', bots: 0, width: 24, height: 24, maxTicks: 1500, areaGoal: 80 },
  { id: 'steady', name: 'Steady', bots: 2, width: 28, height: 28, maxTicks: 1100, areaGoal: 120 },
  { id: 'fierce', name: 'Fierce', bots: 4, width: 32, height: 32, maxTicks: 900, areaGoal: 180 },
];

export const CHALLENGES = [
  {
    id: 'challenge-sprinter', name: 'Sprinter', kind: 'speed',
    goalText: 'Claim 100 cells in only 400 ticks.',
    config: { width: 26, height: 26, bots: 1, maxTicks: 400, areaGoal: 100, seed: 7771 },
  },
  {
    id: 'challenge-landgrab', name: 'Landgrab', kind: 'area',
    goalText: 'Claim 250 cells on a huge board against 4 rivals.',
    config: { width: 40, height: 40, bots: 4, maxTicks: 2000, areaGoal: 250, seed: 7772 },
  },
  {
    id: 'challenge-hunter', name: 'Hunter', kind: 'elimination',
    goalText: 'Eliminate every rival before the clock runs out.',
    config: { width: 30, height: 30, bots: 3, maxTicks: 1200, areaGoal: 0, seed: 7773 },
  },
];

// ---------------------------------------------------------------- validators
// Offline validation: legality, reachable goals, bounded duration, no soft locks.
export function validateStage(stage) {
  const errors = [];
  if (!stage.id || typeof stage.seed !== 'number') errors.push('missing-id-or-seed');
  if (stage.width < 12 || stage.height < 12) errors.push('grid-too-small');
  if (!(stage.maxTicks > 0 && stage.maxTicks <= 5000)) errors.push('unbounded-duration');
  if (stage.areaGoal > stage.width * stage.height) errors.push('goal-impossible');
  if (!THEMES.some((t) => t.id === stage.theme)) errors.push('unknown-theme');

  if (errors.length === 0) {
    // Simulated reachability: run a solo bot game from the stage config and
    // check territory grows beyond the starting patch (proxy for human play).
    const g = createGame({ seed: stage.seed, width: stage.width, height: stage.height, maxTicks: stage.maxTicks, areaGoal: stage.areaGoal,
      players: [{ id: 'p1', name: 'Validator', isBot: true }] });
    initHash(g);
    let guard = 0;
    while (g.phase === PHASE.ACTIVE && guard < stage.maxTicks + 10) { step(g); guard++; }
    if (guard >= stage.maxTicks + 10 && g.phase === PHASE.ACTIVE) errors.push('simulation-overrun');
    if (stage.areaGoal > 0) {
      const best = Math.max.apply(null, g.players.map((p) => p.area));
      if (best <= 9) errors.push('goal-unreachable-in-sim');
    }
  }
  return { id: stage.id, ok: errors.length === 0, errors: errors };
}

export function validateAllContent() {
  const results = [];
  for (const s of STAGES) results.push(validateStage(s));
  results.push(validateStage(dailyChallenge(new Date(Date.UTC(2026, 0, 1)))));
  for (const c of CHALLENGES) {
    results.push(validateStage({ id: c.id, contentVersion: CONTENT_VERSION, theme: THEMES[0].id, ...c.config }));
  }
  for (const l of LESSONS) {
    results.push(validateStage({ id: l.id, contentVersion: CONTENT_VERSION, theme: l.theme, areaGoal: 0, ...l.config }));
  }
  return results;
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || null;
}

export { dailySeed };
