// Unit tests for the pure graphics quality model (js/gfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, presetTier, choosePreset, describe, PRESETS, CATEGORIES } from '../js/gfx.js';
import { GFX_STRINGS, pickLocale } from '../js/gfx-i18n.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset('Apple M2', true), 'balanced', 'mobile caps Auto at balanced');
});

test('resolve: auto uses detected, explicit preset wins, overrides apply', () => {
  const a = resolve({}, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.post, false, 'Low renders without a post chain');
  assert.equal(a.dprCap, 1);
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.shadows, 'medium');
  const o = resolve({ preset: 'high', bloom: 'off', shadows: 'bogus' }, 'low');
  assert.equal(o.bloom, 'off');
  assert.equal(o.shadows, 'medium', 'invalid override falls back to preset');
  for (const p of PRESETS) for (const c of Object.keys(CATEGORIES)) assert.ok(CATEGORIES[c].includes(presetTier(p, c)), p + '/' + c);
});

test('resolve clamps render scale and reads toggles', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).renderScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  const t = resolve({ adaptive: false, show_fps: true }, 'balanced');
  assert.equal(t.adaptive, false);
  assert.equal(t.showFps, true);
  assert.equal(resolve({}, 'balanced').adaptive, true);
});

test('choosing a preset clears overrides but keeps scale/toggles', () => {
  const s = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, show_fps: true }, 'low');
  assert.deepEqual(s, { preset: 'low', render_scale: 1.5, show_fps: true });
  assert.equal(choosePreset({}, 'nonsense').preset, 'auto');
});

test('describe summarises cost and pixels', () => {
  const d = describe(resolve({ preset: 'high' }), [800, 600]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /800×600 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics strings exist for every required locale', () => {
  const need = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
  const keys = Object.keys(GFX_STRINGS['en-US']);
  for (const l of need) {
    const t = GFX_STRINGS[l];
    assert.ok(t, l);
    for (const k of keys) assert.ok(t[k], l + '.' + k);
    for (const c of Object.keys(CATEGORIES)) assert.ok(t.cat[c], l + '.cat.' + c);
  }
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
