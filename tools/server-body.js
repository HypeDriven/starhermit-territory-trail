// BOARDS:BEGIN — JSON, read by tools/leaderboards.mjs to create the boards.
var BOARDS = {
  "high-score": { "name": "High score", "scoreType": "integer", "sortDirection": "desc", "minScore": 0, "maxScore": 100000 }
};
// BOARDS:END

/** The browser build's hosted board (js/net.js BOARD, ROOM_SEATS). */
var HOSTED = { seats: 4, width: 30, height: 30, maxTicks: 1000, areaGoal: 120 };
var TICK_MS = 125;          // 8 ticks a second (js/session.js TICK_RATE)
var MAX_STEPS = 4;          // late platform ticks catch up at most this many rules steps
var WAIT_MS = 15000;        // longest wait for every human's socket
var COUNTDOWN_MS = 2400;    // 3-2-1 at 800 ms
var OFFLINE_OUT_MS = 30000; // offline this long: out of the round
var DIR_LIST = ['up', 'down', 'left', 'right'];

function validScore(board, v) {
  if (typeof v !== 'number' || !isFinite(v)) return false;
  if (board.scoreType !== 'decimal' && Math.floor(v) !== v) return false;
  if (board.scoreType === 'time-ms' && v < 0) return false;
  if (board.minScore != null && v < board.minScore) return false;
  if (board.maxScore != null && v > board.maxScore) return false;
  return true;
}

// ---------------------------------------------------------------- hosted rounds

/** Seats in roster order (team, then slot); seats nobody holds are AI. */
function seatsFromRoom(ctx) {
  var roster = ((ctx.room && ctx.room.roster) || []).slice();
  roster.sort(function (a, b) { return ((a.team || 0) - (b.team || 0)) || ((a.slot || 0) - (b.slot || 0)); });
  var seats = [];
  var ai = 0;
  for (var i = 0; i < roster.length && seats.length < HOSTED.seats; i++) {
    var r = roster[i];
    var isAi = !!r.ai || !r.userId;
    if (isAi) ai++;
    seats.push({ userId: isAi ? null : String(r.userId), name: isAi ? 'Rival ' + ai : String(r.displayName || r.name || 'Player').slice(0, 24), ai: isAi });
  }
  while (seats.length < HOSTED.seats) { ai++; seats.push({ userId: null, name: 'Rival ' + ai, ai: true }); }
  return seats;
}

function newRound(ctx) {
  var seed = (Math.floor((ctx.random || 0) * 2147483646) + 1) >>> 0;
  var seats = seatsFromRoom(ctx);
  var players = seats.map(function (s, i) { return { id: 's' + i, name: s.name, isBot: s.ai }; });
  var state = Rules.createGame({ seed: seed, width: HOSTED.width, height: HOSTED.height, maxTicks: HOSTED.maxTicks, areaGoal: HOSTED.areaGoal, players: players });
  Rules.initHash(state);
  return {
    kind: 'round',
    seats: seats,
    state: state,
    phase: 'waiting',
    createdAt: ctx.now,
    startAt: 0,
    lastNow: ctx.now,
    offlineSince: seats.map(function () { return null; }),
    inputSeq: 0,
    over: null,
    summary: { status: 'active' }
  };
}

function seatOf(ss, userId) {
  if (!userId) return -1;
  for (var i = 0; i < ss.seats.length; i++) if (ss.seats[i].userId === userId) return i;
  return -1;
}

function tableMsg(ss) {
  var st = ss.state;
  return {
    type: 'table', width: st.width, height: st.height, maxTicks: st.maxTicks, areaGoal: st.areaGoal,
    seats: ss.seats.map(function (s, i) { return { id: 's' + i, name: s.name, ai: s.ai, userId: s.userId }; })
  };
}

function snapMsg(ss, now, events) {
  var st = ss.state;
  return {
    type: 'snap', k: st.tick, ph: ss.over ? 'ended' : ss.phase,
    cd: ss.phase === 'countdown' ? Math.max(0, ss.startAt - now) : 0,
    c: st.cells.join(''), t: st.trailOf.join(''),
    p: st.players.map(function (p) {
      return [p.x, p.y, p.dir ? DIR_LIST.indexOf(p.dir) : -1, p.alive ? 1 : 0, p.area, p.eliminations, p.trail.length, p.invalidActions];
    }),
    ev: events || []
  };
}

function overMsg(ss) {
  var o = { type: 'over' };
  for (var k in ss.over) o[k] = ss.over[k];
  return o;
}

/** A seat leaves the round (left the room, offline too long, Leave round): as the rules eliminate. */
function removeSeat(ss, i, reason, events) {
  var st = ss.state;
  var p = st.players[i];
  if (!p || !p.alive || st.phase !== Rules.PHASE.ACTIVE) return;
  p.alive = false;
  for (var c = 0; c < p.trail.length; c++) st.trailOf[p.trail[c]] = 0;
  p.trail = [];
  st.eliminatedOrder.push({ playerId: p.id, by: null, reason: reason, tick: st.tick });
  events.push({ k: 'out', i: i, by: -1 });
}

/** Ends a round no human is left in (rankPlayers decides the order, as a timed-out round). */
function abandon(st) {
  if (st.phase !== Rules.PHASE.ACTIVE) return;
  st.phase = Rules.PHASE.ENDED;
  st.reason = 'abandoned';
  var rank = Rules.rankPlayers(st);
  st.winner = rank.length ? st.players[rank[0]].id : null;
}

/** The end of the round: the `over` broadcast and the platform's result. */
function finish(ss, ret) {
  var st = ss.state;
  var rank = Rules.rankPlayers(st);
  ss.over = {
    reason: st.reason, winner: st.winner, rank: rank, tick: st.tick, maxTicks: st.maxTicks,
    players: st.players.map(function (p) { return { id: p.id, name: p.name, area: p.area, eliminations: p.eliminations, alive: p.alive }; }),
    finalHash: Rules.hashState(st)
  };
  ss.phase = 'ended';
  ss.summary = { status: 'finished' };
  ret.broadcast.push({ to: 'all', data: overMsg(ss) });
  var w = -1;
  for (var i = 0; i < st.players.length; i++) if (st.players[i].id === st.winner) w = i;
  ret.result = {
    kind: w < 0 ? 'draw' : 'win',
    reason: st.reason,
    winnerSeat: w,
    winnerUserId: w >= 0 ? ss.seats[w].userId : null,
    standings: rank.map(function (i) {
      var p = st.players[i];
      return { seat: i, userId: ss.seats[i].userId, name: p.name, score: p.area + p.eliminations * 50 };
    })
  };
}

/** Keeps the rules' command log to the validation window (its ids are unique per tick, so only the last ticks are kept). */
function trimCommands(st) {
  var keep = [];
  for (var i = 0; i < st.commands.length; i++) if (st.commands[i].tick >= st.tick - 2) keep.push(st.commands[i]);
  st.commands = keep;
}

function roundTick(ctx) {
  var ss = ctx.sessionState;
  if (!ss || ss.kind !== 'round' || ss.over) return { ok: true };
  var st = ss.state;
  var now = ctx.now;
  var presence = ctx.presence || {};
  var events = [];
  var ret = { ok: true, broadcast: [] };

  // Presence: a player who left the room is out; so is one offline 30 s.
  var humans = 0, gone = 0;
  for (var i = 0; i < ss.seats.length; i++) {
    var uid = ss.seats[i].userId;
    if (!uid) continue;
    humans++;
    var pr = presence[uid];
    if (pr && pr.left) { gone++; removeSeat(ss, i, 'left', events); continue; }
    if (pr && pr.online === false) {
      if (ss.offlineSince[i] == null) ss.offlineSince[i] = now;
      else if (ss.phase === 'active' && now - ss.offlineSince[i] > OFFLINE_OUT_MS) removeSeat(ss, i, 'offline', events);
    } else ss.offlineSince[i] = null;
  }
  if (humans > 0 && gone === humans) abandon(st);

  if (ss.phase === 'waiting') {
    var ready = true;
    for (var j = 0; j < ss.seats.length; j++) {
      var u = ss.seats[j].userId;
      if (u && !(presence[u] && presence[u].online)) ready = false;
    }
    if (ready || now - ss.createdAt > WAIT_MS) { ss.phase = 'countdown'; ss.startAt = now + COUNTDOWN_MS; }
  }
  if (ss.phase === 'countdown' && now >= ss.startAt) { ss.phase = 'active'; ss.lastNow = ss.startAt; }

  if (ss.phase === 'active' && st.phase === Rules.PHASE.ACTIVE) {
    // Each player's latest steering input (latest-wins, as the rules' pending direction), validated by the rules.
    var inputs = ctx.inputs || [];
    for (var n = 0; n < inputs.length; n++) {
      var seat = seatOf(ss, inputs[n].from);
      var d = inputs[n].data || {};
      if (seat < 0 || DIR_LIST.indexOf(d.dir) < 0 || !st.players[seat].alive) continue;
      ss.inputSeq++;
      Rules.applyCommand(st, { cmdId: 'i' + seat + '-' + ss.inputSeq, playerId: st.players[seat].id, type: 'dir', dir: d.dir, tick: st.tick });
    }
    var steps = Math.floor((now - ss.lastNow) / TICK_MS);
    if (steps > MAX_STEPS) { steps = MAX_STEPS; ss.lastNow = now - steps * TICK_MS; }
    for (var s = 0; s < steps && st.phase === Rules.PHASE.ACTIVE; s++) {
      var areas = [], alive = [];
      for (var a = 0; a < st.players.length; a++) { areas.push(st.players[a].area); alive.push(st.players[a].alive); }
      var elimBefore = st.eliminatedOrder.length;
      Rules.step(st);
      ss.lastNow += TICK_MS;
      for (var b = 0; b < st.players.length; b++) {
        if (st.players[b].alive && st.players[b].area > areas[b] && st.players[b].trail.length === 0) events.push({ k: 'claim', i: b });
      }
      for (var e = elimBefore; e < st.eliminatedOrder.length; e++) {
        var ev = st.eliminatedOrder[e], vi = -1, bi = -1;
        for (var q = 0; q < st.players.length; q++) { if (st.players[q].id === ev.playerId) vi = q; if (st.players[q].id === ev.by) bi = q; }
        events.push({ k: 'out', i: vi, by: bi });
      }
    }
    trimCommands(st);
  }

  if (events.length > 24) events = events.slice(events.length - 24);
  ret.broadcast.push({ to: 'all', data: snapMsg(ss, now, events) });
  if (st.phase === Rules.PHASE.ENDED) finish(ss, ret);
  ret.sessionState = ss;
  return ret;
}

function roundMessage(ctx) {
  var ss = ctx.sessionState;
  var data = (ctx.message && ctx.message.data) || {};
  var from = ctx.message && ctx.message.from;
  if (data.type === 'sync') {
    var out = [{ to: [from], data: tableMsg(ss) }, { to: [from], data: snapMsg(ss, ctx.now, []) }];
    if (ss.over) out.push({ to: [from], data: overMsg(ss) });
    return { ok: true, broadcast: out };
  }
  if (data.type === 'forfeit') {
    var seat = seatOf(ss, from);
    if (seat < 0) return { ok: false, error: 'Not seated' };
    if (ss.over) return { ok: true };
    var events = [];
    removeSeat(ss, seat, 'left', events);
    var ret = { ok: true, broadcast: [{ to: 'all', data: snapMsg(ss, ctx.now, events) }], sessionState: ss };
    var st = ss.state;
    var humansAlive = 0;
    for (var i = 0; i < ss.seats.length; i++) if (ss.seats[i].userId && st.players[i].alive) humansAlive++;
    if (humansAlive === 0 && ss.phase !== 'active') abandon(st);
    if (st.phase === Rules.PHASE.ENDED) finish(ss, ret);
    return ret;
  }
  return { ok: false, error: 'Unknown command' };
}

// ---------------------------------------------------------------- score posting

function scoreMessage(ctx) {
  var data = (ctx.message && ctx.message.data) || {};
  if (data.type !== 'result' || !data.scores || typeof data.scores !== 'object') {
    return { ok: false, error: 'Unknown command' };
  }
  var from = ctx.message.from;
  var scores = {}, accepted = [], n = 0;
  for (var key in BOARDS) {
    if (!Object.prototype.hasOwnProperty.call(BOARDS, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(data.scores, key) || n >= 16) continue;
    var v = data.scores[key];
    if (!validScore(BOARDS[key], v)) continue;
    scores[key] = {}; scores[key][from] = v; accepted.push(key); n++;
  }
  var state = ctx.sessionState || {};
  state.summary = { status: 'finished' };
  return {
    ok: true,
    sessionState: state,
    scores: scores,
    broadcast: [{ to: [from], data: { type: 'result-ack', accepted: accepted } }],
    result: { kind: 'finished', reason: 'result' }
  };
}

globalThis.game = {
  // The hosted round runs on the tick: the rules' 8 steps a second.
  tickRateHz: 8,

  createSession: function (ctx) {
    if (ctx.room) return { ok: true, sessionState: newRound(ctx) };
    return { ok: true, sessionState: { kind: 'score', startedAt: ctx.now, summary: { status: 'active' } } };
  },

  onPlayerMessage: function (ctx) {
    if (ctx.sessionState && ctx.sessionState.kind === 'round') return roundMessage(ctx);
    return scoreMessage(ctx);
  },

  onTick: function (ctx) {
    if (ctx.sessionState && ctx.sessionState.kind === 'round') return roundTick(ctx);
    return { ok: true };
  }
};
