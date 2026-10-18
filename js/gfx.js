'use strict';

// Graphics quality model: presets, per-category overrides, StarHermit hardware-level
// detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js) so the settings panel, the renderer and the
// unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  detail: ['plain', 'detailed'],       // bevelled glossy tiles, rock island, image-based reflections
  particles: ['low', 'high'],          // claim sparks + cell flash (low: ring pulse only)
  background: ['static', 'animated'],  // drifting motes and the slow title-board orbit
};

// Each preset is a row of tiers plus a render scale (multiplies the capped device pixel ratio).
const TABLE = {
  low: { scale: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', detail: 'plain', particles: 'low', background: 'static' },
  balanced: { scale: 1, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', detail: 'detailed', particles: 'high', background: 'animated' },
  high: { scale: 1, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', detail: 'detailed', particles: 'high', background: 'animated' },
  ultra: { scale: 1.25, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', detail: 'detailed', particles: 'high', background: 'animated' },
};

// Device-pixel-ratio cap per preset, so Low is never costlier than the original build.
export const DPR_CAP = { low: 1, balanced: 1.5, high: 2, ultra: 2 };

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (js/gpu-level.js → window.StarHermitGpu, a
// classic script loaded before main.js; 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090, each level
// ≈ 1.23× the one below): Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and
// ≤ 4 GB machines are capped at level 9 (Balanced).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it
 * (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). The grid,
 * trails, pawns' footprint, picking and rules are identical on every preset — only visuals change.
 *   material   lit-surface shader of tiles, trails, island and pawns: Lambert (Low), Standard
 *              (Balanced), Physical with clearcoat tiles and pawns (High/Ultra)
 *   bevel      RoundedBox segments of tiles, trails and the island (Surface detail: detailed)
 *   round      pawn cone / beacon / ring tessellation (radial segments)
 *   texture    procedural grain texture size in px (island and tiles)
 *   motes      drifting ambient motes (Ambient motion animated), scaled with the level
 *   sparks     sparks per claimed cell (Particles high), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', bevel: 1, round: 12, texture: 64, motes: 60, sparks: 2, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', bevel: 1, round: 20, texture: 128, motes: 90, sparks: 3, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', bevel: 2, round: 32, texture: 128, motes: 140, sparks: 3, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', bevel: 3, round: 48, texture: 256, motes: 220, sparks: 4, bloomRes: 1, aoRes: 1 },
};
export const MOTE_MAX = 440;
export const SPARK_MAX = 8;

/** A preset's concrete budget for a hardware level (counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const out = {
    preset,
    auto: !PRESETS.includes(s.preset),
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    dprCap: DPR_CAP[preset],
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears per-category overrides but keeps scale / adaptive / fps. */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

const DESCRIBE_EN = { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion', bloom: 'bloom', noAA: 'no anti-aliasing' };

/** Cost summary line; `words` lets the panel pass localized labels. */
export function describe(r, pixels, words) {
  const w = Object.assign({}, DESCRIBE_EN, words || {});
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoFull : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
