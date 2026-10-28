// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, events from sfx/manifest.json) per game event, rotating
// between each event's clips (the two footsteps), and the quiet ambience
// (two seconds of noise through a 240 Hz low-pass at gain 0.35, looped on the
// old ambience bus from the first press on). The runtime has no ambience bus,
// so the ambience plays on the music bus at the old ambience-to-effects
// ratio (0.4 / 0.8 at the default volumes). The loop is rendered once into a
// clip in slices across frames (per-sample work is slow natively); the
// synthesized blips audio.js played while a sample loaded are not ported (a
// live synthesis graph makes clip loads fail on the web runtime): a clip
// still loading is silent. The runtime's Options own the volumes, the mute
// and the voice limit. Clips load once the mixer runs (natively at once, in a
// browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** sfx/manifest.json: event → clips. */
const SAMPLES: Record<Sfx, string[]> = {
  ui: ["ui-click"], input: ["input-tick"], invalid: ["invalid-buzz"], move: ["trail-step", "trail-step-alt"], claim: ["claim-burst"],
  cut: ["trail-cut"], eliminated: ["eliminated-thud"], warning: ["warning-ping"], win: ["win-fanfare"], lose: ["lose-fall"], countdown: ["countdown-beep"],
};
export type Sfx = "ui" | "input" | "invalid" | "move" | "claim" | "cut" | "eliminated" | "warning" | "win" | "lose" | "countdown";
const AMB_GAIN = 0.35 * (0.4 / 0.8);
const clips = new Map<string, AudioClip>();
const turn: Record<string, number> = {};
const queue: string[] = [];
let loading = false;
let wantClips = false;

export function loadSfx(): void { wantClips = true; }
/** audio.js play(kind): the event's next clip on the effects bus. */
export function play(ev: Sfx): void {
  const names = SAMPLES[ev];
  const i = (turn[ev] = ((turn[ev] ?? 0) + 1) % names.length);
  const name = names[i]!;
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// ---- the rendered ambience ---------------------------------------------------------------------
const RATE = 22050;
let ambData: Float32Array | null = null;
let ambPos = 0;
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let seed = 0x7a11;
const rand = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
// RBJ low-pass biquad at 240 Hz, Q 1 (Web Audio's default)
const w0 = (2 * Math.PI * 240) / RATE, al = Math.sin(w0) / 2, cw = Math.cos(w0);
const b0 = (1 - cw) / 2 / (1 + al), b1 = (1 - cw) / (1 + al), a1 = (-2 * cw) / (1 + al), a2 = (1 - al) / (1 + al);
let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
function renderAmbience(budget: number): void {
  if (ambClip) return;
  if (!ambData) {
    ambData = new Float32Array(RATE * 2);
    for (let i = 0; i < 2000; i++) { const x = rand() * 0.3; const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; } // settle
  }
  const end = Math.min(ambData.length, ambPos + budget);
  for (let i = ambPos; i < end; i++) {
    const x = rand() * 0.3;
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    ambData[i] = y;
  }
  ambPos = end;
  if (ambPos >= ambData.length) {
    // fade the loop's seam over 20 ms so the noise loops without a click
    const f = Math.round(RATE * 0.02);
    for (let i = 0; i < f; i++) { const k = i / f; ambData[ambData.length - f + i] = ambData[ambData.length - f + i]! * (1 - k) + ambData[i]! * k; }
    try { ambClip = createClip([ambData.subarray(f)], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambClip = null; ambData = null; ambPos = 0; }
  }
}

/** Each frame: the clips once the mixer runs (one at a time), the ambience slices, the ambience voice. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const list of Object.values(SAMPLES)) for (const n of list) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
  }
  renderAmbience(4000);
  if (ambClip && !ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB_GAIN, loop: true }); } catch { ambVoice = null; }
  }
}
