// The look per graphics level: the engine's level settings (levelSettings():
// shadows and their map size, AO, bloom resolution, grade, anti-aliasing) plus
// the browser build's art (js/gfx.js TABLE / BUDGETS) keyed by the runtime's
// quality tier (frame().quality), with the motes and sparks scaled within the
// tier by the level's particle budget (at most 2×). The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout. The old panel's per-effect overrides are not offered (Options
// choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
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

type Art = Pick<Look, "detailed" | "particles" | "animated">;
/** gfx.js TABLE: the game-only columns. */
const ART: Record<QualityTier, Art> = {
  low: { detailed: false, particles: "low", animated: false },
  balanced: { detailed: true, particles: "high", animated: true },
  high: { detailed: true, particles: "high", animated: true },
  ultra: { detailed: true, particles: "high", animated: true },
};
/** gfx.js BUDGETS (Low's texture is never used: Low is plain). */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", bevel: 1, round: 12, texture: 128, motes: 60, sparks: 2 },
  balanced: { material: "standard", bevel: 1, round: 20, texture: 128, motes: 90, sparks: 3 },
  high: { material: "physical", bevel: 2, round: 32, texture: 128, motes: 140, sparks: 3 },
  ultra: { material: "physical", bevel: 3, round: 48, texture: 256, motes: 220, sparks: 4 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const MOTE_MAX = 440;
export const SPARK_MAX = 8;

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  return {
    preset, ...ART[preset], budget: b,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
  };
}
