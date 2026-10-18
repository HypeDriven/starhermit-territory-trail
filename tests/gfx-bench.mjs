// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only, never shipped): picks a preset in Settings →
// Graphics, presses Play and keeps steering the local token with the real arrow keys in small square loops
// out of its own territory and back, so cells are claimed (flashes + sparks) while the AI rivals roam, trails
// grow and motes drift. A finished round (win or loss) goes again with Retry.
// Like tests/e2e.mjs it reads the live round state (window.__tt) only to decide when to turn.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title.visible', { state: 'visible', timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#screen-settings.visible', { state: 'visible' });
  await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('#btn-settings-close').scrollIntoViewIfNeeded();
  await page.click('#btn-settings-close');
  await page.waitForSelector('#screen-title.visible', { state: 'visible' });
}

const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const read = (page) => page.evaluate(() => {
  const a = window.__tt, s = a && a.session && a.session.state;
  if (!s) return { phase: a && a.phase };
  const p = s.players[a.session.localPlayerIndex()];
  return { phase: a.phase, x: p.x, y: p.y, alive: p.alive, w: s.width, h: s.height };
});

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__tt && window.__tt.phase === 'active', null, { timeout: 20000 });
  let open = true;
  page.once('close', () => { open = false; });
  let legs = [], from = null;
  (async () => {
    while (open) {
      try {
        const st = await read(page);
        if (st.phase === 'results' || (await page.locator('#screen-results.visible').count())) {
          legs = []; from = null;
          await page.click('#btn-retry', { timeout: 3000 });
          await page.waitForFunction(() => window.__tt && window.__tt.phase === 'active', null, { timeout: 10000 });
        } else if (st.phase === 'active' && st.alive) {
          if (!legs.length) {
            // A 3×3 square loop heading toward the board centre, closing back into home territory.
            const v = st.y > st.h / 2 ? 'up' : 'down', hz = st.x > st.w / 2 ? 'left' : 'right';
            const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
            legs = [v, hz, opp[v], opp[hz]];
            from = null;
          }
          const dir = legs[0];
          if (!from) { from = { x: st.x, y: st.y }; await page.keyboard.press(KEYS[dir]); }
          const [dx, dy] = DELTA[dir];
          if ((st.x - from.x) * dx + (st.y - from.y) * dy >= 3) { legs.shift(); from = null; }
        }
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(25).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
