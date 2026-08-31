'use strict';

// Audio: procedural WebAudio. Buses for music/effects/ambience, original
// short transients per logical event, quiet adaptive ambience, mute when hidden.

let ctx = null;
let buses = {};
let settings = null;
let ambienceNodes = null;
let started = false;

// Authored sample SFX (sfx/*.opus): lazily fetched/decoded per event after
// the user-gesture unlock. Synthesis below stays as fallback while a clip is
// still loading or unavailable.
let sfxMap = null; // event -> [clip basenames]
let sfxRequested = false;
const sfxCache = new Map(); // basename -> AudioBuffer | 'loading' | 'error'

function loadManifest() {
  if (sfxRequested || typeof fetch !== 'function') return;
  sfxRequested = true;
  fetch('./sfx/manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      if (!Array.isArray(list)) return;
      sfxMap = {};
      for (const item of list) {
        if (!item || typeof item.name !== 'string' || typeof item.event !== 'string') continue;
        (sfxMap[item.event] = sfxMap[item.event] || []).push(item.name);
      }
    })
    .catch(() => {});
}

function loadClip(name) {
  if (sfxCache.has(name)) return;
  sfxCache.set(name, 'loading');
  fetch('./sfx/' + name + '.opus')
    .then((r) => {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.arrayBuffer();
    })
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => sfxCache.set(name, buf))
    .catch(() => sfxCache.set(name, 'error'));
}

// Returns true when a ready sample handled the event.
function playSample(kind) {
  if (!sfxMap || !sfxMap[kind]) return false;
  const names = sfxMap[kind];
  // Rotate across variants so repeated events don't reuse the same clip.
  const name = names[(playSample.rot[kind] = ((playSample.rot[kind] || 0) + 1) % names.length)];
  const entry = sfxCache.get(name);
  if (entry instanceof AudioBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = entry;
    src.connect(buses.effects);
    src.start();
    return true;
  }
  if (!entry) loadClip(name);
  return false;
}
playSample.rot = {};

export function init(s) {
  settings = s;
  if (typeof window === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { ctx.suspend().catch(() => {}); }
    else if (started) { ctx.resume().catch(() => {}); }
  });
}

function ensureCtx() {
  if (ctx || typeof window === 'undefined') return !!ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  buses.master = master;
  for (const name of ['music', 'effects', 'ambience']) {
    const g = ctx.createGain();
    g.connect(master);
    buses[name] = g;
  }
  applyVolumes();
  return true;
}

export function applyVolumes() {
  if (!ctx || !settings) return;
  buses.music.gain.value = settings.music;
  buses.effects.gain.value = settings.effects;
  buses.ambience.gain.value = settings.ambience;
}

export function unlock() {
  if (!ensureCtx()) return;
  started = true;
  ctx.resume().catch(() => {});
  startAmbience();
  loadManifest();
}

// Short transient blip: deterministic waveform per event kind.
function blip(bus, freq, dur, type, gainEnv) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gainEnv || 0.25, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(buses[bus]);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noiseBurst(bus, dur, cutoff, gain) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(buses[bus]);
  src.start(t);
}

// Event hierarchy: input < legal move < claim < round end.
export function play(kind) {
  if (!ctx || !started) return;
  if (playSample(kind)) return;
  switch (kind) {
    case 'input': blip('effects', 660, 0.06, 'triangle', 0.12); break;
    case 'invalid': blip('effects', 180, 0.12, 'square', 0.1); break;
    case 'move': blip('effects', 440, 0.04, 'sine', 0.06); break;
    case 'claim': blip('effects', 523, 0.1, 'triangle', 0.2); blip('effects', 784, 0.16, 'triangle', 0.16); noiseBurst('effects', 0.12, 3000, 0.05); break;
    case 'cut': blip('effects', 880, 0.08, 'sawtooth', 0.14); noiseBurst('effects', 0.1, 4000, 0.08); break;
    case 'eliminated': blip('effects', 220, 0.3, 'sawtooth', 0.2); blip('effects', 110, 0.4, 'sine', 0.2); break;
    case 'warning': blip('effects', 330, 0.09, 'square', 0.08); break;
    case 'win': blip('music', 523, 0.15, 'triangle', 0.2); blip('music', 659, 0.15, 'triangle', 0.2); blip('music', 784, 0.3, 'triangle', 0.22); break;
    case 'lose': blip('music', 392, 0.2, 'sine', 0.18); blip('music', 262, 0.4, 'sine', 0.18); break;
    case 'countdown': blip('effects', 520, 0.09, 'sine', 0.15); break;
    case 'ui': blip('effects', 500, 0.05, 'triangle', 0.08); break;
  }
}

function startAmbience() {
  if (ambienceNodes || !ctx) return;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 240;
  const g = ctx.createGain(); g.gain.value = 0.35;
  src.connect(f); f.connect(g); g.connect(buses.ambience);
  src.start();
  ambienceNodes = { src, g };
}

export function updateSettings(s) {
  settings = s;
  applyVolumes();
}
