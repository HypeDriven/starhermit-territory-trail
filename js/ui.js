'use strict';

// UI: DOM shell — screens, rails, settings, help, results, accessibility mirror.
import { STAGES, PRACTICE_DIFFICULTIES, CHALLENGES, LESSONS } from './content.js';
import { ACHIEVEMENTS } from './platform.js?v=d149b156';
import * as platform from './platform.js?v=d149b156';

const $ = (id) => document.getElementById(id);

const SCREENS = ['title', 'modes', 'setup', 'countdown', 'pause', 'results', 'settings', 'help', 'hosted'];

export const ui = {
  currentScreen: 'title',
  settings: null,
  lastFocus: null,
  onAction: null, // (action, payload) => controller

  init(settings, onAction) {
    this.settings = settings;
    this.onAction = onAction;

    $('btn-play').addEventListener('click', () => onAction('play'));
    $('btn-daily').addEventListener('click', () => onAction('mode', 'daily'));
    $('btn-learn').addEventListener('click', () => onAction('mode', 'learn'));
    $('btn-hosted').addEventListener('click', () => onAction('mode', 'hosted'));
    $('btn-modes-back').addEventListener('click', () => onAction('home'));
    document.querySelectorAll('#screen-modes [data-mode]').forEach((b) => {
      b.addEventListener('click', () => onAction('mode', b.dataset.mode));
    });
    $('btn-setup-start').addEventListener('click', () => onAction('setup-start'));
    $('btn-setup-back').addEventListener('click', () => onAction('home'));
    $('btn-pause').addEventListener('click', () => onAction('pause'));
    $('btn-resume').addEventListener('click', () => onAction('resume'));
    $('btn-restart').addEventListener('click', () => onAction('restart'));
    $('btn-leave').addEventListener('click', () => onAction('leave'));
    $('btn-pause-settings').addEventListener('click', () => this.openSettings());
    $('btn-pause-help').addEventListener('click', () => this.openHelp());
    $('btn-retry').addEventListener('click', () => onAction('retry'));
    $('btn-results-next').addEventListener('click', () => onAction('next'));
    $('btn-results-home').addEventListener('click', () => onAction('home'));
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-settings-close').addEventListener('click', () => this.closeOverlay());
    $('btn-help').addEventListener('click', () => this.openHelp());
    $('btn-help-close').addEventListener('click', () => this.closeOverlay());
    $('btn-undo').addEventListener('click', () => onAction('undo'));
    $('btn-camera').addEventListener('click', () => onAction('camera'));
    $('btn-hosted-join').addEventListener('click', () => onAction('hosted-join', $('hosted-room').value.trim() || 'lobby'));
    $('btn-hosted-back').addEventListener('click', () => onAction('home'));

    document.querySelectorAll('#touch-pad button[data-dir]').forEach((b) => {
      b.addEventListener('click', () => onAction('dir', b.dataset.dir));
    });

    // Drawer rails on compact screens.
    const backdrop = $('drawer-backdrop');
    const closeDrawers = () => {
      $('rail-left').classList.remove('open');
      $('rail-right').classList.remove('open');
      backdrop.classList.remove('visible');
    };
    $('rail-toggle-left').addEventListener('click', () => { $('rail-left').classList.add('open'); backdrop.classList.add('visible'); });
    $('rail-toggle-right').addEventListener('click', () => { $('rail-right').classList.add('open'); backdrop.classList.add('visible'); });
    backdrop.addEventListener('click', closeDrawers);

    // Touch pad appears on coarse pointers.
    if (window.matchMedia('(pointer: coarse)').matches) $('touch-pad').classList.add('visible');

    this.applyAccessibility();
  },

  show(name) {
    this.currentScreen = name;
    for (const s of SCREENS) $('screen-' + s).classList.toggle('visible', s === name);
    const hud = $('hud');
    hud.classList.toggle('visible', name === 'countdown' || name === 'none');
    const focusTarget = name === 'title' ? $('btn-play')
      : name === 'pause' ? $('btn-resume')
      : name === 'results' ? $('btn-retry')
      : name === 'modes' ? document.querySelector('#screen-modes [data-mode]')
      : null;
    if (focusTarget) focusTarget.focus();
  },

  showHudOnly() {
    for (const s of SCREENS) $('screen-' + s).classList.remove('visible');
    $('hud').classList.add('visible');
    this.currentScreen = 'none';
  },

  openSettings() {
    this.lastFocus = document.activeElement;
    this.buildSettingsForm();
    $('screen-settings').classList.add('visible');
    $('btn-settings-close').focus();
  },

  openHelp() {
    this.lastFocus = document.activeElement;
    this.buildHelp();
    $('screen-help').classList.add('visible');
    $('btn-help-close').focus();
  },

  closeOverlay() {
    $('screen-settings').classList.remove('visible');
    $('screen-help').classList.remove('visible');
    if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus();
    this.onAction('overlay-closed');
  },

  setStatus(mode, clockText) {
    $('status-mode').textContent = mode || '';
    $('status-clock').textContent = clockText || '';
  },

  setObjective(text) { $('objective').textContent = text; },

  setDanger(exposed) { $('danger-banner').classList.toggle('visible', !!exposed); },

  setUndoVisible(v) { $('btn-undo').style.display = v ? '' : 'none'; },

  announce(text) { $('sr-announcer').textContent = text; },

  mirrorBoard(text) { $('board-mirror').textContent = text; },

  // ------------------------------------------------------------- setup screen
  buildSetup(mode, data) {
    const body = $('setup-body');
    body.innerHTML = '';
    const add = (el) => body.appendChild(el);
    const para = (t) => { const p = document.createElement('p'); p.textContent = t; return p; };

    if (mode === 'journey') {
      add(para('Authored progression: 40 stages in five chapters. Mastery stage ends each chapter. Ranked: no.'));
      const list = document.createElement('div');
      list.className = 'grid-list';
      for (const s of STAGES) {
        const b = document.createElement('button');
        const done = data.progress.stagesCompleted[s.id];
        b.innerHTML = '<strong>' + s.index + '. ' + s.name + '</strong><br><span class="muted">' +
          s.goalText + (done ? ' ✓' : '') + (s.mastery ? ' — Mastery' : '') + '</span>';
        b.addEventListener('click', () => this.onAction('setup-pick', { mode: 'journey', stage: s }));
        list.appendChild(b);
      }
      add(list);
    } else if (mode === 'practice') {
      add(para('Unranked practice with undo. Pick a difficulty. No effect on rating.'));
      const list = document.createElement('div');
      list.className = 'grid-list';
      for (const d of PRACTICE_DIFFICULTIES) {
        const b = document.createElement('button');
        b.innerHTML = '<strong>' + d.name + '</strong><br><span class="muted">' + d.bots + ' rivals · ' + d.width + '×' + d.height + '</span>';
        b.addEventListener('click', () => this.onAction('setup-pick', { mode: 'practice', difficulty: d }));
        list.appendChild(b);
      }
      add(list);
    } else if (mode === 'challenge') {
      add(para('Constrained goals. Ranked: no.'));
      const list = document.createElement('div');
      list.className = 'grid-list';
      for (const c of CHALLENGES) {
        const b = document.createElement('button');
        b.innerHTML = '<strong>' + c.name + '</strong><br><span class="muted">' + c.goalText + '</span>';
        b.addEventListener('click', () => this.onAction('setup-pick', { mode: 'challenge', challenge: c }));
        list.appendChild(b);
      }
      add(list);
    } else if (mode === 'learn') {
      add(para('Interactive lessons — one rule at a time. You must perform each action to advance.'));
      const list = document.createElement('div');
      list.className = 'grid-list';
      for (const l of LESSONS) {
        const b = document.createElement('button');
        const done = data.progress.lessonsCompleted[l.id];
        b.innerHTML = '<strong>' + l.title + '</strong><br><span class="muted">' + l.text + (done ? ' ✓' : '') + '</span>';
        b.addEventListener('click', () => this.onAction('setup-pick', { mode: 'learn', lesson: l }));
        list.appendChild(b);
      }
      add(list);
    }
  },

  // ------------------------------------------------------------- settings
  buildSettingsForm() {
    const body = $('settings-body');
    body.innerHTML = '';
    const s = this.settings;
    const row = (label, input) => {
      const div = document.createElement('div');
      div.className = 'row';
      const lab = document.createElement('label');
      lab.textContent = label + ' ';
      lab.appendChild(input);
      div.appendChild(lab);
      body.appendChild(div);
    };
    const slider = (key) => {
      const i = document.createElement('input');
      i.type = 'range'; i.min = '0'; i.max = '1'; i.step = '0.05'; i.value = String(s[key]);
      i.addEventListener('input', () => { s[key] = parseFloat(i.value); this.save(); });
      return i;
    };
    const check = (key) => {
      const i = document.createElement('input');
      i.type = 'checkbox'; i.checked = !!s[key];
      i.addEventListener('change', () => { s[key] = i.checked; this.save(); });
      return i;
    };
    row('Music volume', slider('music'));
    row('Effects volume', slider('effects'));
    row('Ambience volume', slider('ambience'));
    const q = document.createElement('select');
    for (const v of ['auto', 'low', 'medium', 'high']) {
      const o = document.createElement('option'); o.value = v; o.textContent = v; q.appendChild(o);
    }
    q.value = s.quality;
    q.addEventListener('change', () => { s.quality = q.value; this.save(); });
    row('Graphics quality', q);
    const pal = document.createElement('select');
    for (const v of ['default', 'deuteranopia', 'protanopia', 'tritanopia']) {
      const o = document.createElement('option'); o.value = v; o.textContent = v; pal.appendChild(o);
    }
    pal.value = s.palette;
    pal.addEventListener('change', () => { s.palette = pal.value; this.save(); });
    row('Color palette', pal);
    row('Reduced motion', check('reducedMotion'));
    row('High contrast', check('highContrast'));
    row('Larger text', check('largeText'));
    row('Left-handed controls', check('leftHanded'));
    row('Haptics', check('haptics'));
    row('Tutorial hints', check('showTutorialHints'));
    row('Anonymous usage stats', check('consentTelemetry'));
  },

  save() {
    platform.saveSettings(this.settings);
    platform.track('settings-change');
    this.applyAccessibility();
    if (this.onAction) this.onAction('settings-changed');
  },

  applyAccessibility() {
    const s = this.settings;
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('large-text', !!s.largeText);
    document.body.classList.toggle('left-handed', !!s.leftHanded);
  },

  // ------------------------------------------------------------- help
  buildHelp() {
    const body = $('help-body');
    body.innerHTML = '';
    const cards = [
      ['Steer', 'Arrow keys, WASD, the on-screen pad, or a swipe changes direction. Your marker keeps moving.'],
      ['Claim', 'Leave your colored territory, draw a loop, and re-enter your own land. The enclosed cells become yours and add to your score.'],
      ['Danger', 'While outside, your trail is exposed. If a rival crosses it, you are eliminated. Your ring pulses white while exposed.'],
      ['Cut', 'Cross a rival\'s exposed trail to eliminate them: +50 score.'],
      ['Win', 'Reach the area goal, outlast every rival, or hold the most territory when time runs out. Ties break on fewer invalid moves.'],
      ['Undo', 'In Practice mode, Undo returns to the moment before your last claim.'],
      ['Camera', 'Press C or the Camera button to refit the board. Escape or P pauses.'],
    ];
    for (const [t, d] of cards) {
      const div = document.createElement('div');
      div.className = 'card';
      div.style.padding = '0.8em';
      const h = document.createElement('h3'); h.textContent = t;
      const p = document.createElement('p'); p.textContent = d; p.style.margin = '0.2em 0';
      div.appendChild(h); div.appendChild(p);
      body.appendChild(div);
    }
  },

  // ------------------------------------------------------------- results
  showResults(state, localId, extras) {
    const body = $('results-body');
    body.innerHTML = '';
    const h = $('results-h');
    const li = state.players.findIndex((p) => p.id === localId);
    const local = li >= 0 ? state.players[li] : null;
    const won = state.winner === localId;
    h.textContent = won ? 'Victory!' : (local && !local.alive ? 'Eliminated' : 'Round over');

    const reasonP = document.createElement('p');
    reasonP.className = 'muted';
    reasonP.textContent = 'Ended by: ' + state.reason + ' at tick ' + state.tick + ' of ' + state.maxTicks + '.';
    body.appendChild(reasonP);

    if (local) {
      const title = document.createElement('h3');
      title.textContent = 'Your score breakdown';
      body.appendChild(title);
      const lines = [
        ['Territory area', local.area + ' cells × 1', local.area],
        ['Eliminations', local.eliminations + ' × 50', local.eliminations * 50],
        ['Total', '', local.area + local.eliminations * 50],
      ];
      for (const [name, calc, val] of lines) {
        const div = document.createElement('div');
        div.className = 'score-line';
        div.innerHTML = '<span>' + name + '</span><span class="muted">' + calc + '</span><strong>' + val + '</strong>';
        body.appendChild(div);
      }
    }

    const board = document.createElement('h3');
    board.textContent = 'Standings';
    body.appendChild(board);
    for (const i of extras.rank) {
      const p = state.players[i];
      const div = document.createElement('div');
      div.className = 'score-line';
      div.innerHTML = '<span>' + (p.id === localId ? '▶ ' : '') + p.name + (p.alive ? '' : ' ✝') + '</span><strong>' + (p.area + p.eliminations * 50) + '</strong>';
      body.appendChild(div);
    }

    if (extras.unlocked && extras.unlocked.length) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Achievements unlocked';
      body.appendChild(h3);
      for (const key of extras.unlocked) {
        const a = ACHIEVEMENTS.find((x) => x.key === key);
        const p = document.createElement('p');
        p.textContent = '🏅 ' + (a ? a.name + ' — ' + a.desc : key);
        body.appendChild(p);
      }
    }
    if (extras.progressText) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = extras.progressText;
      body.appendChild(p);
    }
    this.announce(h.textContent + '. ' + reasonP.textContent);
    this.show('results');
  },

  updateRails(state, localId, progress) {
    // Right rail: per-player status.
    const rs = $('rail-status');
    rs.innerHTML = '';
    if (state) {
      for (const p of state.players) {
        const div = document.createElement('div');
        div.className = 'score-line';
        const you = p.id === localId ? ' (you)' : '';
        div.innerHTML = '<span>' + p.name + you + '</span><span>' + p.area + ' cells' + (p.alive ? '' : ' · out') + '</span>';
        rs.appendChild(div);
      }
      const t = document.createElement('p');
      t.className = 'muted';
      t.textContent = 'Tick ' + state.tick + ' / ' + state.maxTicks;
      rs.appendChild(t);
    }
    // Left rail: journey progress summary.
    const rj = $('rail-journey');
    rj.innerHTML = '';
    const done = Object.keys(progress.stagesCompleted).length;
    const p = document.createElement('p');
    p.textContent = 'Journey: ' + done + ' / ' + STAGES.length + ' stages complete.';
    rj.appendChild(p);
    const lessons = Object.keys(progress.lessonsCompleted).length;
    const p2 = document.createElement('p');
    p2.textContent = 'Lessons: ' + lessons + ' / ' + LESSONS.length + '.';
    rj.appendChild(p2);
    const p3 = document.createElement('p');
    p3.textContent = 'Achievements: ' + progress.achievements.length + ' / ' + ACHIEVEMENTS.length + '.';
    rj.appendChild(p3);
    const p4 = document.createElement('p');
    p4.className = 'muted';
    p4.textContent = 'Rating: ' + progress.rating;
    rj.appendChild(p4);
  },

  setHostedStatus(text, roster) {
    $('hosted-status').textContent = text;
    const r = $('hosted-roster');
    r.innerHTML = '';
    if (roster) {
      for (const name of roster) {
        const div = document.createElement('div');
        div.textContent = name;
        r.appendChild(div);
      }
    }
  },
};
