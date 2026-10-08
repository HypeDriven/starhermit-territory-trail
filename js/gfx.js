'use strict';

// Graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js) so the settings panel, the renderer and the
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

/** Best preset for this GPU, from the unmasked renderer string when the browser exposes it. */
export function detectPreset(gpu, mobile) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
  if (mobile && (p === 'high' || p === 'ultra')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
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
