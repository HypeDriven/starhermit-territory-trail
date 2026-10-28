// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the motes and sparks scaled within the tier by the level (frame().levelIndex,
// at most 2×), as the browser build scaled them by its hardware level. The
// runtime owns the rest of what the old Graphics panel did: Auto and the level
// choice, render scale (Ultra's 1.25) and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout. The old panel's per-effect
// overrides are not offered (Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Tiles, trails, island and pawns: Lambert (Low), Standard (Balanced), Physical with clear-coated tiles and pawns (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** RoundedBox segments of tiles, trails and the island (detailed). */
  bevel: number;
  /** Pawn cone / beacon / ring radial segments. */
  round: number;
  /** Grain texture size (detailed). */
  texture: 128 | 256;
  /** Drifting motes (animated). */
  motes: number;
  /** Sparks per claimed cell (particles high). */
  sparks: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Bevelled glossy tiles, rock island, image-based reflections, backdrop gradient. */
  detailed: boolean;
  /** Claim sparks and cell flashes (low: the ring pulse only). */
  particles: "low" | "high";
  /** Drifting motes and the slow title-board sway. */
  animated: boolean;
  budget: Budget;
}

/** gfx.js TABLE (and SHADOW_MAP). */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", detailed: false, particles: "low", animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", detailed: true, particles: "high", animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", detailed: true, particles: "high", animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", detailed: true, particles: "high", animated: true },
};
/** gfx.js BUDGETS (Low's texture is never used: Low is plain). */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", bevel: 1, round: 12, texture: 128, motes: 60, sparks: 2, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", bevel: 1, round: 20, texture: 128, motes: 90, sparks: 3, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", bevel: 2, round: 32, texture: 128, motes: 140, sparks: 3, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", bevel: 3, round: 48, texture: 256, motes: 220, sparks: 4, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const MOTE_MAX = 440;
export const SPARK_MAX = 8;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, Math.pow(1.5, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  return { preset, ...TABLE[preset], budget: b };
}
