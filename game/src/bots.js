// bots.js — Breachline bot brains: 8 Hz staggered decisions, steering every step.
// Perception (losClear + 105° FOV + 62 m), skill reactions, tracked aim error, burst
// fire via weapon.tryFire + combat.shoot; roles: hits, plants, holds, retakes.
import * as THREE from 'three';
import * as CFG from './config.js';
import { bus } from './state.js';
import * as weapon from './weapon.js';

const DEG = Math.PI / 180;
const WALK = CFG.MOVE?.walk ?? CFG.WALK_SPEED ?? 4.6;
const WEAPONS = CFG.WEAPONS || {};
const W = (price, rpm, mag, auto) => ({ price, rpm, mag, auto });
const FALLBACK_W = { pistol: W(0, 320, 12, false), smg: W(1400, 750, 30, true), shotgun: W(1100, 70, 6, false), rifle: W(2700, 600, 30, true), heavy: W(3100, 520, 25, true), sniper: W(4750, 42, 5, false) };
const PRIMARY_ORDER = ['rifle', 'heavy', 'smg', 'shotgun'];
const FROZEN = { buy: 1, roundEnd: 1, matchEnd: 1, menu: 1 };
const DEF_SLOTS = ['A', 'A', 'mid', 'B', 'B'];
const TIMERS = ['memT', 'reactT', 'pause', 'shotCd', 'reloadT', 'strafeT'];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist2d = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
function turnToward(cur, target, step) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + clamp(d, -step, step);
}
const wDef = (id) => WEAPONS[id] || FALLBACK_W[id] || FALLBACK_W.rifle;
const priceOf = (id) => WEAPONS[id]?.price ?? CFG.ARMOUR?.[id]?.price ?? CFG.GRENADES?.[id]?.price ?? FALLBACK_W[id]?.price ?? 0;
function currentId(a) { // loadout.slots[loadout.current] is the held slot object
  const lo = a.loadout;
  return lo?.slots?.[lo.current]?.id || lo?.current || 'pistol';
}
function magOf(a) { const s = a.loadout?.slots?.[a.loadout?.current]; return typeof s?.mag === 'number' ? s.mag : 99; }
function ownedPrimaryOf(a) { const id = a.loadout?.slots?.primary?.id; return PRIMARY_ORDER.includes(id) ? id : null; }
// Module-level temps: step()/decide() allocate nothing per frame.
const _eye = new THREE.Vector3(), _eEye = new THREE.Vector3(), _to = new THREE.Vector3();
const _dir = new THREE.Vector3(), _want = new THREE.Vector3();
const _aimP = new THREE.Vector3(), _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3();

export function createBrains(deps) {
  const { G, world, nav, combat } = deps;
  const brains = [];
  let now = 0; // bot clock for weapon.tryFire(loadout, now)
  const eyeOf = (a, out) => out.set(a.pos.x, a.pos.y + (a.crouch ? 1.12 : 1.62), a.pos.z);
  function sitePoint(site, out) { const s = world.sites?.[site]; return s?.point ? out.copy(s.point) : out.set(24, 0, site === 'A' ? -18 : 18); }
  function ringGoal(out, centre, idx, r) {
    const cx = centre.x, cz = centre.z, a = idx * 2.4 + 0.6;
    return out.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
  }
  function nodePos(tag, out) {
    const p = nav?.nodeAt ? nav.nodeAt(tag) : null;
    const v = p ? (p.pos || p) : null;
    if (v && typeof v.x === 'number') { out.copy(v); return true; }
    return false;
  }
  function syncGroup(a) { if (a.group) { a.group.position.copy(a.pos); a.group.rotation.y = a.yaw; } }

  function repath(b) {
    b.pathN = 0; b.pathI = 0;
    const pts = nav?.path ? nav.path(b.actor.pos, b.goal) : null;
    if (pts) for (let i = 0; i < pts.length && b.pathN < 32; i++) {
      const p = pts[i]?.pos || pts[i];
      if (!p || typeof p.x !== 'number') continue;
      if (b.pathN === 0 && dist2d(b.actor.pos, p) < 1) continue;
      b.path[b.pathN++].copy(p);
    }
    if (!b.pathN) { b.path[0].copy(b.goal); b.pathN = 1; }
  }
  function setGoal(b, v) {
    if (!b.goalSet || b.goal.distanceToSquared(v) > 2.25) { b.goal.copy(v); b.goalSet = true; repath(b); }
  }

  // Per-axis AABB movement vs world.colliders (local, not player.js).
  function collides(a, x, z) {
    const r = a.radius || 0.35, top = a.pos.y + (a.height || 1.8) - 0.15, low = a.pos.y + 0.25;
    const cols = world.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.max.y <= low || c.min.y >= top) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
    }
    return false;
  }
  function moveAxis(a, axis, delta) {
    if (!delta) return;
    const nx = axis === 'x' ? a.pos.x + delta : a.pos.x;
    const nz = axis === 'z' ? a.pos.z + delta : a.pos.z;
    if (!collides(a, nx, nz)) a.pos[axis] += delta; else a.vel[axis] = 0;
    const bd = world.bounds || { minX: -33, maxX: 33, minZ: -33, maxZ: 33 };
    a.pos.x = clamp(a.pos.x, bd.minX + 0.4, bd.maxX - 0.4);
    a.pos.z = clamp(a.pos.z, bd.minZ + 0.4, bd.maxZ - 0.4);
  }

  function perceive(b) {
    const a = b.actor;
    b.vis = null; b.canSee = false;
    if (a.blinded > 0.2) return;
    eyeOf(a, _eye);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    let bestD = 62;
    for (const e of G.actors) {
      if (!e.alive || e.team === a.team) continue;
      eyeOf(e, _eEye);
      _to.subVectors(_eEye, _eye);
      const d = _to.length();
      if (d > 62 || d >= bestD) continue;
      if (d > 3.5) { // 105° FOV (point-blank sense inside 3.5 m)
        const l2 = Math.hypot(_to.x, _to.z) || 1;
        if ((_to.x * fx + _to.z * fz) / l2 < 0.608) continue;
      }
      if (combat?.losClear && !combat.losClear(_eye, _eEye)) continue;
      b.vis = e; bestD = d;
    }
    b.canSee = !!b.vis;
  }
  function pickDefuser(cp) { // nearest Warden, kit first
    let best = null, bestScore = Infinity;
    for (const b of brains) {
      const a = b.actor;
      if (!a.alive || a.team !== 'def') continue;
      const s = ((a.hasKit || a.loadout?.hasKit) ? 0 : 100) + dist2d(a.pos, cp);
      if (s < bestScore) { bestScore = s; best = a; }
    }
    return best;
  }
  function doReload(b) {
    if (b.reloadT > 0 || !b.actor.loadout) return;
    if (weapon.startReload && weapon.startReload(b.actor.loadout)) {
      b.reloadT = b.actor.loadout.reloading || 2.0;
      b.burst = 0;
    } else b.reloadT = 0.4;
  }

  function decide(b) { // 8 Hz: perception, role goals, reload checks
    const a = b.actor;
    const lo = a.loadout;
    if (lo?.slots?.primary && lo.current === 'secondary' && !(lo.reloading > 0)) {
      if (weapon.switchTo) weapon.switchTo(lo, 'primary');
    }
    perceive(b);
    if (b.vis) {
      if (b.target !== b.vis) { b.target = b.vis; b.reactT = b.reactDelay; b.aimT = 0; }
      b.seenT = 0; b.sinceSeen = 0;
    }
    a.intent = null;
    const planted = G.charge?.state === 'planted';
    if (a.team === 'atk') {
      if (planted) {
        sitePoint(G.charge.site || b.site, _g1);
        if (dist2d(a.pos, _g1) < 7) ringGoal(_g1, _g1, b.teamIndex, 4.5);
        setGoal(b, _g1);
      } else if (a.carrier) {
        sitePoint(b.site, _g1);
        const z = world.sites?.[b.site]?.zone;
        const at = z ? (a.pos.x >= z.minX && a.pos.x <= z.maxX && a.pos.z >= z.minZ && a.pos.z <= z.maxZ)
          : dist2d(a.pos, _g1) < 4;
        if (at && b.sinceSeen > 1.5 && !b.vis) a.intent = 'plant';
        setGoal(b, _g1);
      } else {
        sitePoint(b.site, _g1);
        const dSite = dist2d(a.pos, _g1);
        if (b.memT > 0 && !b.vis && dSite > 7 && dist2d(a.pos, b.mem) < 16) setGoal(b, b.mem);
        else setGoal(b, dSite < 6.5 ? b.holdPos : _g1);
      }
    } else if (planted) { // retake: defuser channels, the rest cover
      const cp = G.charge.pos || sitePoint(G.charge.site || 'A', _g2);
      if (pickDefuser(cp) === a) {
        setGoal(b, cp);
        if (dist2d(a.pos, cp) < 1.8 && b.sinceSeen > 0.4 && !b.vis) a.intent = 'defuse';
      } else { ringGoal(_g1, cp, b.teamIndex, 5); setGoal(b, _g1); }
    } else if (b.memT > 0 && (b.role === 'mid' || dist2d(b.mem, b.holdPos) > 20)) {
      sitePoint('A', _g1); const dA = dist2d(b.mem, _g1);
      sitePoint('B', _g2); const dB = dist2d(b.mem, _g2);
      ringGoal(_g1, dA <= dB ? _g1 : _g2, b.teamIndex, 3);
      setGoal(b, _g1);
    } else setGoal(b, b.holdPos);

    const mag = magOf(a), size = wDef(currentId(a)).mag || 0;
    if (b.reloadT <= 0 && (mag === 0 || (size > 0 && mag < size * 0.25 && !b.vis && b.seenT > 1))) doReload(b);
    if (b.pathI >= b.pathN && b.goalSet && dist2d(a.pos, b.goal) > 1.3) repath(b);
  }

  function steer(b, dt) { // every step: timers, firing, movement, facing
    const a = b.actor;
    for (const k of TIMERS) if (b[k] > 0) b[k] -= dt;
    b.sinceSeen += dt; b.seenT += dt;
    if (a.health < b.lastHp - 0.01) { b.strafeT = 0.35; b.strafeDir = Math.random() < 0.5 ? -1 : 1; }
    b.lastHp = a.health;
    const tgt = b.target && b.target.alive && b.seenT < 0.6 ? b.target : null;
    if (tgt && b.canSee) b.aimT += dt; else if (!tgt) b.aimT = 0;
    // Engage inside the weapon's useful range, else keep advancing (56 m spawn
    // sightlines would stall rounds); attackers en route halt only up close.
    const wRange = wDef(currentId(a)).range;
    let fRange = Math.min(90, Math.max(30, (wRange ? wRange[1] : 55) * 0.6));
    if (a.team === 'atk' && b.goalSet && dist2d(a.pos, b.goal) > 8) fRange = Math.min(fRange, 16);
    const engaging = !!tgt && b.canSee && b.seenT < 0.25 && a.blinded <= 0.2
      && dist2d(a.pos, tgt.pos) <= fRange;

    if (engaging && b.reactT <= 0 && b.reloadT <= 0 && b.pause <= 0 && !(a.loadout?.reloading > 0)) {
      if (b.burst <= 0) { // burst size by weapon class: auto 3–5, slow guns 1, semi 2–3
        const def = wDef(currentId(a));
        b.burst = def.auto ? 3 + (Math.random() * 3 | 0) : (def.rpm || 300) < 120 ? 1 : 2 + (Math.random() * 2 | 0);
      }
      if (b.shotCd <= 0 && a.speedNow < 1.6) {
        eyeOf(a, _eye);
        _aimP.set(tgt.pos.x, tgt.pos.y + 1.32, tgt.pos.z);
        _dir.subVectors(_aimP, _eye).divideScalar(_dir.length() || 1);
        const err = Math.tan((3.2 - 2.5 * Math.min(1, b.aimT / 0.9)) * DEG); // 3.2° → 0.7°
        _dir.x += (Math.random() * 2 - 1) * err;
        _dir.y += (Math.random() * 2 - 1) * err * 0.7;
        _dir.z += (Math.random() * 2 - 1) * err;
        _dir.normalize();
        const r = (weapon.tryFire && a.loadout) ? weapon.tryFire(a.loadout, now) : { ok: true };
        if (r && r.ok) {
          if (r.melee) combat?.melee?.(a); else combat?.shoot?.(a, _eye, _dir);
          b.burst--;
          b.shotCd = 60 / (wDef(currentId(a)).rpm || 600);
          if (magOf(a) === 0) { b.burst = 0; doReload(b); }
          if (b.burst <= 0) b.pause = 0.12 + Math.random() * 0.18;
        } else { b.shotCd = 0.05; if (r?.why === 'empty') doReload(b); }
      }
    }
    if (tgt && b.seenT < 1.2) {
      a.yaw = turnToward(a.yaw, Math.atan2(-(tgt.pos.x - a.pos.x), -(tgt.pos.z - a.pos.z)), dt * 11);
      const dy = (tgt.pos.y + 1.32) - (a.pos.y + (a.crouch ? 1.12 : 1.62));
      a.pitch = clamp(Math.atan2(dy, dist2d(a.pos, tgt.pos) || 1), -1.2, 1.2);
    }

    _want.set(0, 0, 0);
    const channel = !!a.intent;
    a.crouch = channel;
    let moving = false;
    if (!channel && !engaging) {
      while (b.pathI < b.pathN && dist2d(a.pos, b.path[b.pathI]) < 0.7) b.pathI++;
      const wp = b.pathI < b.pathN ? b.path[b.pathI]
        : (b.goalSet && dist2d(a.pos, b.goal) > 1.0 ? b.goal : null);
      if (wp) {
        _dir.set(wp.x - a.pos.x, 0, wp.z - a.pos.z).divideScalar(_dir.length() || 1);
        _want.copy(_dir).multiplyScalar(WALK);
        moving = true;
      }
    }
    for (const o of G.actors) {
      if (o === a || !o.alive) continue;
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.72 && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (0.85 - d) * 3.2;
        _want.x += dx / d * push; _want.z += dz / d * push;
      }
    }
    if (b.strafeT > 0) {
      _want.x += Math.cos(a.yaw) * b.strafeDir * 2.3;
      _want.z += -Math.sin(a.yaw) * b.strafeDir * 2.3;
    }
    const blend = Math.min(1, dt * 9);
    a.vel.x += (_want.x - a.vel.x) * blend;
    a.vel.z += (_want.z - a.vel.z) * blend;
    a.vel.y = 0;
    moveAxis(a, 'x', a.vel.x * dt);
    moveAxis(a, 'z', a.vel.z * dt);
    a.pos.y = 0; a.grounded = true;
    a.speedNow = Math.hypot(a.vel.x, a.vel.z);

    if (!(tgt && b.seenT < 1.2)) {
      if (a.speedNow > 0.5) a.yaw = turnToward(a.yaw, Math.atan2(-a.vel.x, -a.vel.z), dt * 7);
      else if (!channel) { b.scan += dt * 0.55; a.yaw = b.holdYaw + Math.sin(b.scan) * 0.55; }
      a.pitch += (0 - a.pitch) * Math.min(1, dt * 6);
    }
    if (moving && a.speedNow < 0.4) {
      b.stuckT += dt;
      if (b.stuckT > 1.1) { b.stuckT = 0; b.strafeT = 0.3; b.strafeDir *= -1; if (b.goalSet) repath(b); }
    } else b.stuckT = 0;
    syncGroup(a);
  }

  // Hearing: enemy shots within 20 m set a memory point for 4 s.
  if (bus?.on) bus.on('shot', (d) => {
    const shooter = d?.actor || d?.shooter || null;
    const p = d?.pos || d?.origin || shooter?.pos;
    if (!p || typeof p.x !== 'number') return;
    for (const b of brains) {
      const a = b.actor;
      if (!a.alive || (shooter && shooter.team === a.team)) continue;
      const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
      if (dx * dx + dz * dz < 400) { b.mem.set(p.x, 0, p.z); b.memT = 4; }
    }
  });

  function attach(actor) {
    if (!actor || actor.isPlayer) return null;
    const skill = 0.8 + Math.random() * 0.45;
    const path = [];
    for (let i = 0; i < 32; i++) path.push(new THREE.Vector3());
    const b = {
      actor, skill, reactDelay: 0.45 - ((skill - 0.8) / 0.45) * 0.23, // skill 0.8→0.45 s, 1.25→0.22 s
      teamIndex: 0, role: 'hold', site: 'A', tick: Math.random() * 0.125,
      path, pathN: 0, pathI: 0, goal: new THREE.Vector3(), goalSet: false,
      holdPos: new THREE.Vector3(), holdYaw: 0, mem: new THREE.Vector3(), memT: 0,
      target: null, vis: null, canSee: false,
      seenT: 99, sinceSeen: 99, aimT: 0, reactT: 0, burst: 0, pause: 0, shotCd: 0,
      reloadT: 0, strafeT: 0, strafeDir: 1, lastHp: 100, stuckT: 0,
      scan: Math.random() * 6.28, ownedPrimary: null, sawDeath: false,
    };
    actor.brain = b;
    brains.push(b);
    return b;
  }

  function resetRound() {
    const byTeam = { atk: [], def: [] };
    for (const b of brains) (byTeam[b.actor.team] || (byTeam[b.actor.team] = [])).push(b);
    for (const t of ['atk', 'def']) (byTeam[t] || []).sort((x, y) => x.actor.id - y.actor.id)
      .forEach((b, i) => { b.teamIndex = i; });
    const main = Math.random() < 0.5 ? 'A' : 'B', other = main === 'A' ? 'B' : 'A';
    const allIn = Math.random() < 0.6; // 60% all-in, else 3–2 split
    for (const b of byTeam.atk || []) {
      b.site = allIn ? main : (b.teamIndex < 3 ? main : other);
      b.role = b.actor.carrier ? 'carrier' : 'escort';
      sitePoint(b.site, _g1);
      ringGoal(b.holdPos, _g1, b.teamIndex, 4.5);
      if (b.actor.carrier) b.holdPos.copy(_g1);
      b.holdYaw = Math.atan2(b.holdPos.x, b.holdPos.z);
      b.goal.copy(_g1); b.goalSet = true; repath(b);
    }
    for (const b of byTeam.def || []) { // 2 A / 1 mid / 2 B
      const slot = DEF_SLOTS[b.teamIndex % 5];
      if (slot === 'mid') {
        b.role = 'mid'; b.site = 'A';
        if (!nodePos('mid', b.holdPos)) b.holdPos.set(0, 0, 0);
      } else {
        b.role = 'hold'; b.site = slot;
        sitePoint(slot, _g1);
        ringGoal(b.holdPos, _g1, b.teamIndex, 2.5);
      }
      b.holdYaw = Math.atan2(b.holdPos.x, b.holdPos.z);
      b.goal.copy(b.holdPos); b.goalSet = true; repath(b);
    }
    for (const b of brains) {
      b.target = null; b.vis = null; b.canSee = false;
      b.seenT = 99; b.sinceSeen = 99; b.aimT = 0; b.memT = 0;
      b.burst = 0; b.pause = 0; b.reloadT = 0; b.strafeT = 0; b.stuckT = 0;
      b.lastHp = b.actor.health;
      b.actor.intent = null;
      if (b.sawDeath) { b.ownedPrimary = null; b.sawDeath = false; }
    }
  }

  function step(dt) {
    now += dt;
    const frozen = FROZEN[G.phase] === 1; // buy / roundEnd / matchEnd / menu
    for (const b of brains) {
      const a = b.actor;
      if (a.loadout && weapon.tickLoadout) weapon.tickLoadout(a.loadout, dt);
      if (!a.alive) { b.sawDeath = true; a.intent = null; continue; }
      if (frozen) { a.vel.set(0, 0, 0); a.speedNow = 0; a.intent = null; syncGroup(a); continue; }
      b.tick -= dt;
      if (b.tick <= 0) { b.tick += 0.125; decide(b); }
      steer(b, dt);
    }
  }

  // Buys via weapon.buyItem(loadout, money, id, team); buyPhase debits the cost.
  // Order: weapon (rifle > heavy > smg > shotgun), armour (vest+helmet when
  // post-weapon money >= $1000, else vest), kit (first two Wardens), grenades > $4500.
  function buyPhase(actor) {
    if (!actor || actor.isPlayer || !actor.alive || !weapon.buyItem) return;
    const lo = actor.loadout || (weapon.createLoadout ? (actor.loadout = weapon.createLoadout()) : null);
    if (!lo) return;
    const b = actor.brain || null;
    const buy = (id) => {
      const r = weapon.buyItem(lo, actor.money, id, actor.team);
      if (r && r.ok) { actor.money -= r.cost; bus?.emit?.('buy', { actor, itemId: id, cost: r.cost }); return true; }
      return false;
    };
    let owned = b?.ownedPrimary || ownedPrimaryOf(actor);
    if (!owned) {
      for (const id of PRIMARY_ORDER) {
        if (actor.money >= priceOf(id) && buy(id)) { owned = id; if (b) b.ownedPrimary = id; break; }
      }
      if (owned && weapon.switchTo) weapon.switchTo(lo, 'primary');
    }
    if (lo.armor <= 0) {
      if (actor.money >= 1000) buy('vestHelmet');
      else buy('vest');
    } else if (!lo.helmet && actor.money >= 1000) buy('vestHelmet');
    actor.armor = lo.armor; actor.helmet = lo.helmet;
    if (actor.team === 'def' && b && b.teamIndex < 2 && !lo.hasKit && actor.money >= priceOf('kit')) {
      if (buy('kit')) actor.hasKit = true;
    }
    if (actor.money > 4500) { buy('frag'); buy('smoke'); buy('flash'); }
  }

  return { attach, step, resetRound, buyPhase };
}
