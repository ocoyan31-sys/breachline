// Rounds: the Breachline match machine — menu → buy (15 s, frozen) → live
// (100 s) → planted (40 s charge clock) → roundEnd (5 s) → buy… Halftime after
// round 8 swaps every side, resets credits to $800 and loadouts to pistol, and
// swaps the score. Match ends at 9 wins or after round 16 (level = draw).
// Owns plant/defuse channels, end-of-round income and all round bus events.
import { bus } from './state.js';
import * as CFG from './config.js';
import * as weapon from './weapon.js';

const T = CFG.TIMINGS || {};
const ECO = CFG.ECONOMY || {};
const BUY_TIME = T.buy ?? 15;
const ROUND_TIME = T.round ?? 100;
const CHARGE_TIME = T.charge ?? 40;
const PLANT_TIME = T.plant ?? 3.2;
const DEFUSE_KIT = T.defuseKit ?? 5;
const DEFUSE_SLOW = T.defuse ?? 10;
const END_TIME = T.roundEnd ?? 5;
const START_MONEY = ECO.startMoney ?? ECO.start ?? 800;
const MONEY_CAP = ECO.moneyCap ?? ECO.cap ?? 16000;
const WIN_ELIM = ECO.elimWin ?? ECO.eliminationWin ?? 3250;
const WIN_OBJECTIVE = ECO.objectiveWin ?? 3500;
const LOSS_BASE = ECO.lossBase ?? ECO.loss ?? 1400;
const LOSS_STEP = ECO.lossStep ?? ECO.lossBonusStep ?? 500;
const LOSS_MAX = ECO.lossMaxBonus ?? ECO.lossBonusMax ?? 1500;
const PLANT_BONUS = ECO.plantBonus ?? 300;
const DEFUSE_BONUS = ECO.defuseBonus ?? 300;
const BOOM_RADIUS = 6;
const DEFUSE_RANGE = 2.4;
const BOT_BUY_PREFS = ['rifle', 'heavy', 'smg', 'vestHelmet', 'vest', 'kit', 'smoke', 'frag', 'flash'];

// Accepts createRounds({ G, actors, world, audio, brains }) — or the positional
// createRounds(G, actors, world, deps) form — and returns the contract API.
export function createRounds(a, b, c, d) {
  const deps = (a && a.G) ? a : { G: a, actors: b, world: c, audio: d && d.audio, brains: d && d.brains };
  const G = deps.G;
  const actors = deps.actors || {};
  const world = deps.world || {};
  const audio = deps.audio || {};
  const brains = deps.brains || {};
  const snd = (fn, ...args) => { if (typeof audio[fn] === 'function') audio[fn](...args); };

  let lossStreak = { atk: 0, def: 0 };
  let matchDone = false;
  let matchWinner = null;
  let halfPending = false;
  let beepAcc = 0;
  let channelSite = null;

  const list = () => (G.actors && G.actors.length ? G.actors : actors.list || []);
  const aliveCount = (team) => list().reduce((n, x) => n + (x.alive && x.team === team ? 1 : 0), 0);
  const pay = (actor, amount) => { actor.money = Math.min(MONEY_CAP, Math.max(0, (actor.money || 0) + amount)); };

  function resetLoadout(actor) {
    if (typeof weapon.resetLoadout === 'function') weapon.resetLoadout(actor);
    else if (typeof weapon.createLoadout === 'function') actor.loadout = weapon.createLoadout();
    else if (actor.loadout && typeof actor.loadout.reset === 'function') actor.loadout.reset();
    actor.armor = 0; actor.helmet = false; actor.hasKit = false;
  }

  function damage(victim, amount, attacker) {
    if (typeof actors.damage === 'function') actors.damage(victim, amount, attacker);
    else if (victim.alive) {
      victim.health -= amount;
      if (victim.health <= 0) { victim.health = 0; victim.alive = false; bus.emit('kill', { attacker, victim }); }
    }
  }

  // Damage cancels an in-progress plant/defuse channel for the victim.
  bus.on('hit', (e) => {
    const v = e && (e.victim || e.target);
    if (!v) return;
    if (G.charge.planter === v && G.charge.state === 'carried') G.charge.plantProgress = 0;
    if (G.charge.defuser === v && G.charge.state === 'planted') G.charge.defuseProgress = 0;
  });

  function beginRound() {
    G.winner = null; G.winReason = '';
    const ch = G.charge;
    ch.state = 'carried'; ch.site = null; ch.pos = null; ch.timer = CHARGE_TIME;
    ch.plantProgress = 0; ch.defuseProgress = 0; ch.planter = null; ch.defuser = null;
    channelSite = null; beepAcc = 0;
    if (typeof actors.resetForRound === 'function') actors.resetForRound();
    if (typeof brains.resetRound === 'function') brains.resetRound();
    // Carrier: one random living Breacher (attack side) carries the charge.
    const atk = list().filter((x) => x.alive && x.team === 'atk');
    for (const x of list()) x.carrier = false;
    const carrier = atk[Math.floor(Math.random() * atk.length)] || null;
    if (carrier) carrier.carrier = true;
    ch.carrier = carrier;
    // Bots shop now; the player's shopping is driven by the HUD/buyFor.
    for (const x of list()) {
      if (x.isPlayer || !x.alive) continue;
      if (typeof brains.buyPhase === 'function') brains.buyPhase(x);
      else fallbackBuy(x);
    }
    G.phase = 'buy';
    G.phaseTime = BUY_TIME;
    bus.emit('roundStart', { round: G.round, score: { ...G.score } });
  }

  function fallbackBuy(x) { // used only if brains has no buyPhase of its own
    for (const id of BOT_BUY_PREFS) {
      if (id === 'kit' && x.team !== 'def') continue;
      buyFor(x, id);
    }
  }

  function doHalftime() {
    for (const x of list()) {
      x.team = x.team === 'atk' ? 'def' : 'atk';
      x.money = START_MONEY;
      resetLoadout(x);
    }
    const s = G.score.atk; G.score.atk = G.score.def; G.score.def = s;
    lossStreak = { atk: 0, def: 0 };
    bus.emit('half', { score: { ...G.score } });
  }

  function endRound(winner, reason) {
    G.winner = winner; G.winReason = reason;
    G.score[winner] += 1;
    const loser = winner === 'atk' ? 'def' : 'atk';
    const winPay = (reason === 'detonation' || reason === 'defuse') ? WIN_OBJECTIVE : WIN_ELIM;
    const lossPay = LOSS_BASE + Math.min(LOSS_MAX, lossStreak[loser] * LOSS_STEP);
    for (const x of list()) {
      if (x.team === winner) pay(x, winPay);
      else if (x.team === loser) pay(x, lossPay);
    }
    lossStreak[winner] = 0;
    lossStreak[loser] += 1;
    G.charge.plantProgress = 0; G.charge.defuseProgress = 0;
    matchDone = G.score.atk >= 9 || G.score.def >= 9 || G.round >= 16;
    if (matchDone) {
      matchWinner = G.score.atk === G.score.def ? 'draw' : (G.score.atk > G.score.def ? 'atk' : 'def');
      G.winner = matchWinner;
    }
    halfPending = !matchDone && G.round === 8;
    G.phase = 'roundEnd';
    G.phaseTime = END_TIME;
    bus.emit('roundEnd', { winner, reason, score: { ...G.score } });
  }

  function detonate() {
    const ch = G.charge;
    snd('boom');
    if (ch.pos) {
      for (const x of [...list()]) {
        if (!x.alive || !x.pos) continue;
        const dx = x.pos.x - ch.pos.x; const dz = x.pos.z - ch.pos.z;
        if (dx * dx + dz * dz <= BOOM_RADIUS * BOOM_RADIUS) damage(x, 1000, ch.planter);
      }
    }
    ch.state = 'detonated';
    endRound('atk', 'detonation');
  }

  function siteAt(pos) {
    const sites = world.sites || {};
    for (const key of ['A', 'B']) {
      const z = sites[key] && sites[key].zone;
      if (z && pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ) return key;
    }
    return null;
  }

  // Plant channel: carrier, attacking, alive, still, inside a site zone.
  function stepPlant(dt) {
    const ch = G.charge;
    let candidate = null; let site = null;
    for (const x of list()) {
      if (!x.alive || x.team !== 'atk' || x.intent !== 'plant') continue;
      if (!x.carrier && ch.carrier !== x) continue;
      if ((x.speedNow || 0) >= 1) continue;
      site = siteAt(x.pos);
      if (!site) continue;
      candidate = x; break;
    }
    if (!candidate) { ch.plantProgress = 0; ch.planter = null; channelSite = null; return; }
    ch.planter = candidate; channelSite = site;
    ch.plantProgress += dt;
    if (ch.plantProgress >= PLANT_TIME) {
      ch.state = 'planted';
      ch.site = site;
      ch.pos = candidate.pos.clone ? candidate.pos.clone() : { x: candidate.pos.x, y: candidate.pos.y || 0, z: candidate.pos.z };
      ch.timer = CHARGE_TIME;
      ch.plantProgress = 0;
      candidate.carrier = false; ch.carrier = null;
      pay(candidate, PLANT_BONUS); // planter bonus lands immediately on plant
      G.phase = 'planted'; G.phaseTime = CHARGE_TIME;
      snd('plant');
      bus.emit('planted', { site, planter: candidate, pos: ch.pos });
    }
  }

  // Defuse channel: defender, alive, still, within reach of the planted charge.
  function stepDefuse(dt) {
    const ch = G.charge;
    let candidate = null;
    if (ch.pos) {
      for (const x of list()) {
        if (!x.alive || x.team !== 'def' || x.intent !== 'defuse') continue;
        if ((x.speedNow || 0) >= 1) continue;
        const dx = x.pos.x - ch.pos.x; const dz = x.pos.z - ch.pos.z;
        if (dx * dx + dz * dz > DEFUSE_RANGE * DEFUSE_RANGE) continue;
        candidate = x; break;
      }
    }
    if (!candidate) { ch.defuseProgress = 0; ch.defuser = null; return; }
    ch.defuser = candidate;
    ch.defuseProgress += dt;
    const need = candidate.hasKit ? DEFUSE_KIT : DEFUSE_SLOW;
    if (ch.defuseProgress >= need) {
      ch.state = 'defused';
      ch.defuseProgress = 0;
      pay(candidate, DEFUSE_BONUS);
      snd('defuse');
      bus.emit('defused', { defuser: candidate, site: ch.site });
      endRound('def', 'defuse');
    }
  }

  function start() {
    G.round = 1;
    G.score.atk = 0; G.score.def = 0;
    lossStreak = { atk: 0, def: 0 };
    matchDone = false; matchWinner = null; halfPending = false;
    for (const x of list()) { x.money = START_MONEY; resetLoadout(x); }
    beginRound();
  }

  function step(dt) {
    if (dt <= 0) return;
    switch (G.phase) {
      case 'buy':
        G.phaseTime -= dt;
        if (G.phaseTime <= 0) { G.phase = 'live'; G.phaseTime = ROUND_TIME; }
        break;
      case 'live':
        G.phaseTime -= dt;
        stepPlant(dt);
        if (G.phase !== 'live') break; // plant completed this tick
        if (aliveCount('def') === 0) endRound('atk', 'elimination');
        else if (aliveCount('atk') === 0) endRound('def', 'elimination');
        else if (G.phaseTime <= 0) endRound('def', 'time');
        break;
      case 'planted': {
        // Elimination no longer ends the round: only detonation or defuse do.
        const ch = G.charge;
        ch.timer -= dt;
        G.phaseTime = Math.max(0, ch.timer);
        stepDefuse(dt);
        if (G.phase !== 'planted') break; // defused this tick
        beepAcc -= dt;
        if (beepAcc <= 0) {
          snd('beep', ch.timer > 10 ? 0.2 : ch.timer > 5 ? 0.6 : 1);
          beepAcc = ch.timer > 10 ? 1 : ch.timer > 5 ? 0.5 : 0.25;
        }
        if (ch.timer <= 0) detonate();
        break;
      }
      case 'roundEnd':
        G.phaseTime -= dt;
        if (G.phaseTime <= 0) {
          if (matchDone) {
            G.phase = 'matchEnd'; G.phaseTime = 0;
            bus.emit('matchEnd', { winner: matchWinner, reason: G.winReason, score: { ...G.score } });
          } else {
            if (halfPending) { doHalftime(); halfPending = false; }
            G.round += 1;
            beginRound();
          }
        }
        break;
      default: break; // menu / matchEnd: nothing ticks
    }
  }

  function buyFor(actor, itemId) {
    if (!actor) return { ok: false, reason: 'no-actor' };
    if (G.phase !== 'buy') {
      if (actor.isPlayer) snd('error');
      return { ok: false, reason: 'phase' };
    }
    let result = { ok: false, why: 'unknown' };
    if (typeof weapon.buyItem === 'function' && actor.loadout) {
      result = weapon.buyItem(actor.loadout, actor.money || 0, itemId, actor.team);
      if (result && result.ok) actor.money = Math.max(0, (actor.money || 0) - (result.cost || 0));
    }
    const ok = !!(result && result.ok);
    if (ok && typeof weapon.switchTo === 'function' && typeof weapon.slotFor === 'function'
      && weapon.slotFor(itemId) === 'primary') {
      weapon.switchTo(actor.loadout, 'primary'); // a fresh primary is equipped at once
    }
    if (actor.isPlayer) snd(ok ? 'buy' : 'error');
    bus.emit('buy', { actor, item: itemId, ok });
    return result && typeof result === 'object' ? result : { ok };
  }

  function setIntent(actor, kind) {
    if (actor) actor.intent = kind || null;
  }

  return {
    start, step, buyFor, setIntent,
    playerIntent(kind) { setIntent(G.player, kind); }, // DESIGN-name alias
  };
}
