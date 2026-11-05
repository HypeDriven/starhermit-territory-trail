// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, events from sfx/manifest.json) per game event, in turn
// between each event's clips (the two footsteps), and the quiet ambience
// (white noise through a 240 Hz low-pass, a 2 s seamless loop on the old
// ambience bus from the first press on). The runtime has no ambience bus, so
// the ambience plays on the music bus at the old ambience-to-effects ratio
// (0.4 / 0.8 at the default volumes). The synthesized blips audio.js played
// while a sample loaded are not ported: a clip still loading is silent. The
// runtime's Options own the volumes, the mute and the voice limit. Everything
// loads in onStart; only starting the ambience waits for the mixer (in a
// browser, the first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, SoundBank, type AudioClip, type Sound } from "starhermit:audio";

/** sfx/manifest.json: event → clips. */
const SAMPLES: Record<Sfx, string[]> = {
  ui: ["ui-click"], input: ["input-tick"], invalid: ["invalid-buzz"], move: ["trail-step", "trail-step-alt"], claim: ["claim-burst"],
  cut: ["trail-cut"], eliminated: ["eliminated-thud"], warning: ["warning-ping"], win: ["win-fanfare"], lose: ["lose-fall"], countdown: ["countdown-beep"],
};
export type Sfx = "ui" | "input" | "invalid" | "move" | "claim" | "cut" | "eliminated" | "warning" | "win" | "lose" | "countdown";
const AMB_GAIN = 0.35 * (0.4 / 0.8);
const banks = new Map<Sfx, SoundBank>();

/** audio.js play(kind): the event's next clip on the effects bus. */
export function play(ev: Sfx): void {
  try { banks.get(ev)?.play(); } catch { /* the mixer is full this frame: skip it */ }
}

// ---- the rendered ambience ---------------------------------------------------------------------
const RATE = 22050;
const AMB_MAKEUP = 0.929; // make-up to the old loop's rms (.0322)
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
/** Filtered periodic noise is periodic once settled: no crossfade. */
async function renderAmbience(): Promise<AudioClip> {
  const settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + RATE * 2, RATE);
  const noise = off.createNoise({ seed: 0x7a11, seconds: 2 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
  const g = off.createGain(); g.gain.value = 0.3 * AMB_MAKEUP;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}

/** Loads every clip at once and renders the ambience (onStart). */
export function loadSfx(): void {
  for (const ev of Object.keys(SAMPLES) as Sfx[]) {
    const load = (name: string): Promise<AudioClip | null> => loadClip(`sfx/${name}.opus`).catch((e: unknown) => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    void Promise.all(SAMPLES[ev].map(load)).then((loaded) => {
      const clips = loaded.filter((c) => c !== null);
      if (clips.length) banks.set(ev, new SoundBank({ clips, order: "sequence", bus: "effects" }));
    });
  }
  renderAmbience().then((c) => { ambClip = c; }, (e: unknown) => { console.warn(`audio: ${String(e)}`); });
}

/** Each frame, once the mixer runs: the ambience voice. */
export function update(): void {
  if (context.state !== "running" || !ambClip || ambVoice) return;
  try { ambVoice = playClip(ambClip, { bus: "music", gain: AMB_GAIN, loop: true }); } catch { ambVoice = null; }
}
