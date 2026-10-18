// Unit tests for the pure graphics quality model (js/gfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { detectPreset, detectLevel, presetForLevel, budgetFor, resolve, presetTier, choosePreset, describe, PRESETS, CATEGORIES,
  LEVELS, BUDGETS, MOTE_MAX, SPARK_MAX } = await import('../js/gfx.js');
const { GFX_STRINGS, pickLocale } = await import('../js/gfx-i18n.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = Object.keys(BUDGETS.low);
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('balanced', 20).motes <= 2 * BUDGETS.balanced.motes, '≤ 2×');
  assert.ok(budgetFor('ultra', 20).motes <= MOTE_MAX && budgetFor('ultra', 20).sparks <= SPARK_MAX);
  const head = resolve({}, 'low', 0);
  assert.equal(head.preset, 'low', 'headless SwiftShader: Low');
  assert.equal(head.level, 0);
});

test('every locale has the Level label', () => {
  for (const [tag, T] of Object.entries(GFX_STRINGS)) assert.match(T.level, /\{n\}/, tag);
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
