/**
 * Territory Trail — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play (Journey stage 1 "First Steps", no bots) → a real
 *   keyboard-steered territory loop that claims enclosed land and wins
 *   the round → natural Results screen ("Victory!") → progress persisted.
 *   Extra features exercised: settings open/close, help open/close,
 *   pause (Esc) + resume, camera reset.
 *   A second pass runs the same core on a mobile viewport with touch.
 *
 * The game exposes a read-only handle on window.__tt = app (main.js) and
 * window.__tt.session.state, used ONLY for synchronization and for
 * choosing the next steering direction from the player's live position —
 * every action (keyboard press / touch tap) is a real input on visible
 * controls. No game code is modified; no move is performed via the API.
 *
 * Serving: a self-contained node:http static server (unknown paths 404).
 * Standalone (no launch token) the game must make zero same-origin /api or
 * /ws requests; every pass records any such request as an error.
 *
 * Run: node tests/e2e.mjs  (or npm run test:e2e)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => path.join(ROOT, 'test-results', `e2e-${stage}-${vp}.png`);

// benign GPU/swiftshader noise (mirrors siblings)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const filePath = pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, pathname);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const ok = (name) => console.log(`ok - ${name}`);

// ---------- in-page observation ----------
// Read-only view of the local player + round phase, straight from the
// exposed handle. Used to steer and to assert real progress.
const localPlayer = (page) => page.evaluate(() => {
  const a = window.__tt;
  if (!a) return null;
  const s = a.session && a.session.state;
  if (!s) return { phase: a.phase, mode: a.mode };
  const li = a.session.localPlayerIndex();
  const p = s.players[li];
  return {
    phase: a.phase, mode: a.mode, tick: s.tick, maxTicks: s.maxTicks,
    reason: s.reason, winner: s.winner, phase2: s.phase,
    x: p ? p.x : -1, y: p ? p.y : -1, area: p ? p.area : -1,
    alive: p ? p.alive : false, trail: p ? p.trail.length : -1,
  };
});

const waitPhase = async (page, phase, timeout = 15000) => {
  try {
    await page.waitForFunction(
      (ph) => window.__tt && window.__tt.phase === ph,
      phase, { timeout }
    );
    return true;
  } catch { return false; }
};

// Press one of ArrowUp/Down/Left/Right (real keyboard input) and poll the
// live player position until `stop` is satisfied (or timeout). Because the
// token keeps gliding in the last-set direction, we poll fast and rely on
// the caller's thresholds being ~1-2 cells inside the turn point.
const MOVE_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
async function glide(page, dir, stop, timeout = 6000) {
  await page.keyboard.press(MOVE_KEYS[dir]);
  const t0 = Date.now();
  for (;;) {
    const lp = await localPlayer(page);
    if (!lp) throw new Error('local player vanished mid-glide');
    if (stop(lp)) return lp;
    if (Date.now() - t0 > timeout) throw new Error(`glide(${dir}) timed out at ${JSON.stringify(lp)}`);
    await page.waitForTimeout(20);
  }
}

// Drive a big enclosing loop around the starting 3x3 territory and claim a
// large chunk of land. The token spawns not at center but spread toward the
// board edges (golden-angle), so the loop is drawn "up, left, down, right"
// — enclosing the up-left quadrant and closing back along the spawn row so
// the final right leg rejoins the 3x3 patch (which triggers the claim).
// Turn points stay >=4 cells from the walls and the closing row is the
// spawn row, so a ±1-cell gliding overshoot is harmless. Returns the local
// player after the claim (area grown).
async function claimBigLoop(page, startLp) {
  const sy = startLp.y;
  await glide(page, 'up', (p) => p.y <= 4);        // toward the top wall
  await glide(page, 'left', (p) => p.x <= 4);      // toward the left wall
  await glide(page, 'down', (p) => p.y >= sy); // descend to the spawn row (territory band) then turn
  const base = (await localPlayer(page)).area;
  // final right leg along the spawn row back into territory → claim → area-goal
  const fin = await glide(page, 'right', (p) => p.area > base, 8000);
  return fin;
}

async function startJourney(page) {
  await page.click('#btn-play');
  const started = await waitPhase(page, 'active', 15000);
  if (!started) throw new Error('round never reached active phase');
  // HUD objective reflects the round.
  const obj = await page.textContent('#objective');
  return { obj };
}

// Standalone must never call the game's own server routes (/api, /ws).
function watchOwnServer(page, errors) {
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === BASE_URL && /^\/(api|ws)(\/|$)/.test(u.pathname)) errors.push(`standalone own-server request: ${u.pathname}`);
  });
}

// ---------- one full desktop pass ----------
async function runDesktop(browser, name) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  watchOwnServer(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'load' });

  // title
  await page.waitForSelector('#screen-title.visible', { state: 'visible', timeout: 10000 });
  const progress = await page.textContent('#title-progress');
  if (!/Journey progress:/.test(progress) && !/New here/.test(progress)) throw new Error(`unexpected progress text "${progress}"`);
  await page.screenshot({ path: SHOT('title', name) });
  ok(`${name}: title screen visible ("${progress.trim()}")`);

  // settings open/close
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings.visible', { state: 'visible' });
  if (!(await page.locator('#settings-body .row').count())) throw new Error('settings form empty');
  ok(`${name}: settings open with controls`);
  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-settings.visible', { state: 'hidden' });
  ok(`${name}: settings close`);

  // help open/close
  await page.click('#btn-help');
  await page.waitForSelector('#screen-help.visible', { state: 'visible' });
  if (!(await page.locator('#help-body .card').count())) throw new Error('help empty');
  ok(`${name}: help opens`);
  await page.click('#btn-help-close');
  await page.waitForSelector('#screen-help.visible', { state: 'hidden' });
  ok(`${name}: help close`);

  // start a real Journey round via the dominant Play button
  const { obj } = await startJourney(page);
  if (!/Claim \d+ cells/.test(obj)) throw new Error(`objective unexpected "${obj}"`);
  ok(`${name}: journey stage 1 started ("${obj}")`);

  // wait until the sim is actually running (session.running, tick>0)
  await page.waitForFunction(() => window.__tt?.session?.running && window.__tt.session.state.tick > 0, null, { timeout: 6000 });
  const s0 = await localPlayer(page);
  if (s0.area !== 9) throw new Error(`expected start area 9, got ${s0.area}`);
  ok(`${name}: round live (tick ${s0.tick}, area ${s0.area}, player at ${s0.x},${s0.y})`);

  // pause/resume + camera (extra features, real controls)
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause.visible', { state: 'visible' });
  ok(`${name}: pause (Esc) overlay`);
  const tickPaused = (await localPlayer(page)).tick;
  await page.click('#btn-resume');
  await page.waitForSelector('#screen-pause.visible', { state: 'hidden' });
  ok(`${name}: resume`);
  await page.click('#btn-camera'); // camera reset (cosmetic, must not throw)
  ok(`${name}: camera reset works`);

  // Play the loop for real — steer an enclosing loop with live position
  // feedback, claiming a big region and winning the solo stage.
  const r0 = await localPlayer(page);
  if (r0.area < 9) throw new Error(`unexpected area ${r0.area} after resume`);
  const claimed = await claimBigLoop(page, r0);
  if (claimed.area <= 9) throw new Error(`claim didn't grow area (area=${claimed.area})`);
  ok(`${name}: territory claimed by real steering (area ${r0.area} → ${claimed.area})`);

  // The stage ends when the area goal is met → natural results screen.
  await page.waitForSelector('#screen-results.visible', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => window.__tt.phase === 'results', null, { timeout: 15000 });
  const head = await page.textContent('#results-h');
  const reason = await page.textContent('#results-body .muted');
  if (!/Victory/.test(head)) throw new Error(`unexpected results headline "${head}"`);
  ok(`${name}: round ended — results "${head.trim()}" (${reason.trim()})`);

  // progress persisted
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('territory-trail-progress-v1') || '{}'));
  const stages = Object.keys(saved.stagesCompleted || {}).length;
  if (stages < 1) throw new Error('journey stage not persisted after win');
  ok(`${name}: progress persisted (${stages} journey stage recorded)`);

  await page.screenshot({ path: SHOT('results', name) });

  // home via results Home
  await page.click('#btn-results-home');
  await page.waitForSelector('#screen-title.visible', { state: 'visible' });
  ok(`${name}: returned to title`);

  await context.close();
  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
}

// ---------- smaller mobile pass ----------
async function runMobile(browser, name) {
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  watchOwnServer(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForSelector('#screen-title.visible', { state: 'visible', timeout: 10000 });
  ok(`${name}: title screen visible`);

  // start a journey round via a real touch tap on Play
  await page.touchscreen.tap(...(await page.locator('#btn-play').boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
  const started = await waitPhase(page, 'active', 15000);
  if (!started) throw new Error('mobile round never active');
  await page.waitForFunction(() => window.__tt?.session?.running && window.__tt.session.state.tick > 0, null, { timeout: 6000 });
  ok(`${name}: round started via touch tap`);

  // Real moves via touchscreen taps on the board canvas (the game's arcade
  // tap-to-steer: tap left of the player to steer left). The on-screen
  // #touch-pad path is verified separately below.
  const before = await localPlayer(page);
  const box = await page.locator('#canvas-host canvas').boundingBox();
  for (const _ of [0, 1]) { // a couple of left-steering taps on the board
    await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.55);
    // wait until the tick advances so the gesture was recognized
    const t0 = (await localPlayer(page)).tick;
    await page.waitForFunction((n) => window.__tt.session.state.tick > n, t0, { timeout: 4000 });
  }
  const after = await localPlayer(page);
  if (!after.alive) throw new Error('local player eliminated unexpectedly on mobile');
  if (after.x >= before.x) throw new Error(`steer-left tap did not move player left (${before.x} → ${after.x})`);
  if (after.tick <= before.tick) throw new Error(`no ticks elapsed (tick ${after.tick})`);
  ok(`${name}: moved via real touch taps, area ${after.area}, tick ${after.tick} (started ${before.tick}), player ${after.x},${after.y}`);

  // On-screen #touch-pad must ALSO be interactive: a real tap on a pad button
  // (not the canvas) should steer the player. Verified after the CSS fix that
  // gives #touch-pad / its buttons pointer-events:auto.
  await page.waitForFunction(() => document.querySelector('#touch-pad')?.classList.contains('visible'), null, { timeout: 6000 });
  const padBefore = await localPlayer(page);
  const padBtn = page.locator('#touch-pad button[data-dir="left"]');
  const bb = await padBtn.boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const padT0 = (await localPlayer(page)).tick;
  await page.waitForFunction((n) => window.__tt.session.state.tick > n, padT0, { timeout: 4000 });
  const padAfter = await localPlayer(page);
  if (!padAfter.alive) throw new Error('local player eliminated unexpectedly during touch-pad steer');
  if (padAfter.x >= padBefore.x) throw new Error(`touch-pad steer-left did not move player left (${padBefore.x} → ${padAfter.x})`);
  ok(`${name}: touch-pad button tap steered left, player ${padAfter.x},${padAfter.y} (from ${padBefore.x},${padBefore.y}), tick ${padAfter.tick}`);

  // leave the round through the pause menu (Leave round) => title
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause.visible', { state: 'visible' });
  await page.click('#btn-leave');
  await page.waitForSelector('#screen-title.visible', { state: 'visible' });
  ok(`${name}: leave round back to title`);

  await page.screenshot({ path: SHOT('mobile', name) });
  await context.close();
  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
}

// ---------- graphics settings pass ----------
// Real UI: Settings → Graphics, switch presets (Low, Ultra, High), override one
// category, verify it is applied (body data-gfx-preset + summary line), that the
// panel fits the viewport, a round renders with the post chain, and the choice
// survives a reload.
async function runGraphics(browser, name, ctxOpts) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  watchOwnServer(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForSelector('#screen-title.visible', { state: 'visible', timeout: 10000 });
  const auto = await page.getAttribute('body', 'data-gfx-preset');
  ok(`${name}: auto preset resolved to "${auto}"`);

  const openSettings = async () => {
    await page.click('#btn-settings');
    await page.waitForSelector('#screen-settings.visible', { state: 'visible' });
    await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  };
  await openSettings();
  const vp = page.viewportSize();
  const card = await page.locator('#screen-settings .card').boundingBox();
  if (card.x < 0 || card.y < 0 || card.x + card.width > vp.width + 1 || card.y + card.height > vp.height + 1) {
    throw new Error(`settings card overflows viewport: ${JSON.stringify(card)}`);
  }
  const autoLabel = await page.locator('#gfx-preset option[value="auto"]').textContent();
  if (!/Auto \(detected: /.test(autoLabel)) throw new Error(`auto label "${autoLabel}"`);

  for (const preset of ['low', 'ultra', 'high']) {
    await page.selectOption('#gfx-preset', preset);
    try {
      await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset, { timeout: 15000 });
    } catch (e) {
      throw new Error(`preset ${preset} not applied (body=${await page.getAttribute('body', 'data-gfx-preset')}, select=${await page.inputValue('#gfx-preset')}); ${errors.join(' | ')}`);
    }
    await page.waitForTimeout(400); // a few frames through the post chain
  }
  await page.waitForFunction(() => /2048² shadows/.test(document.getElementById('gfx-summary').textContent), null, { timeout: 5000 });
  ok(`${name}: presets Low → Ultra → High applied ("${(await page.textContent('#gfx-summary')).slice(-60)}")`);

  await page.locator('#gfx-bloom').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-bloom', 'off');
  await page.waitForFunction(() => !/ · bloom · /.test(document.getElementById('gfx-summary').textContent), null, { timeout: 5000 });
  const fromLabel = await page.locator('#gfx-shadows option[value="preset"]').textContent();
  if (!/From preset \(Medium\)/.test(fromLabel)) throw new Error(`preset label "${fromLabel}"`);
  ok(`${name}: bloom override applied (summary drops bloom)`);

  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-settings.visible', { state: 'hidden' });

  // a round renders at High with the post chain
  await page.click('#btn-play');
  if (!(await waitPhase(page, 'active', 15000))) throw new Error('round never active at High');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause.visible', { state: 'visible' });
  await page.click('#btn-leave');
  await page.waitForSelector('#screen-title.visible', { state: 'visible' });
  ok(`${name}: round rendered at High`);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#screen-title.visible', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => document.body.dataset.gfxPreset === 'high', null, { timeout: 5000 });
  await openSettings();
  const persisted = [await page.inputValue('#gfx-preset'), await page.inputValue('#gfx-bloom')];
  if (persisted[0] !== 'high' || persisted[1] !== 'off') throw new Error(`graphics not persisted: ${persisted}`);
  ok(`${name}: graphics choice survives reload (${persisted.join(', ')})`);
  // choosing a preset clears overrides
  await page.selectOption('#gfx-preset', 'low');
  await page.waitForFunction(() => document.body.dataset.gfxPreset === 'low', null, { timeout: 5000 });
  if ((await page.inputValue('#gfx-bloom')) !== 'preset') throw new Error('preset did not clear overrides');
  ok(`${name}: choosing a preset clears overrides`);

  await context.close();
  if (errors.length) throw new Error(`${name} graphics pass had console output:\n  ${errors.join('\n  ')}`);
}

// ---------- main ----------
const BASE_URL = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
});

let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  await runDesktop(browser, 'desktop');
  await runMobile(browser, 'mobile');
  await runGraphics(browser, 'gfx-desktop', { viewport: { width: 1280, height: 800 } });
  await runGraphics(browser, 'gfx-mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  console.log('\nE2E PASS — territory-trail, desktop + mobile, no page errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
