// Hitscan + grenades. shoot() is the single source of truth for spread (base + bloom
// + movement + air, crouch discount, sniper scope rules); damage via actors.damage().

import * as THREE from 'three';
import { G, bus } from './state.js';
import {
  WEAPONS, MOVE, GRENADE_FX, FALLOFF_FLOOR,
  SNIPER_UNSCOPED_SPREAD, AIR_SPREAD, CROUCH_SPREAD_MULT, BLOOM_DECAY,
} from './config.js';
import { segBlocked, clamp, lerp } from './util.js';

const DEG = Math.PI / 180;
const _dir = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _to = new THREE.Vector3(), _eye = new THREE.Vector3();
const _mid = new THREE.Vector3(), _tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function lookDir(actor, out) {
  const cp = Math.cos(actor.pitch || 0);
  out.set(-cp * Math.sin(actor.yaw || 0), Math.sin(actor.pitch || 0), -cp * Math.cos(actor.yaw || 0));
  return out;
}
function eyeOf(actor, out) {
  out.set(actor.pos.x, actor.pos.y + (actor.crouch ? MOVE.crouchEye : MOVE.eye), actor.pos.z);
  return out;
}

export function createCombat({ scene, world, actors, audio }) {
  const raycaster = new THREE.Raycaster();
  const worldMeshes = world.shootMeshes || world.shootables || [];
  const colliders = world.colliders || [];
  const actorList = () => (actors && actors.list) || G.actors || [];

  function applyDamage(victim, amount, part, attacker) {
    if (actors && typeof actors.damage === 'function') return actors.damage(victim, amount, part, attacker);
    let dmg = amount; // fallback if actors.damage is absent
    if (victim.armor > 0) dmg *= 0.5;
    if (part === 'head' && victim.helmet) dmg *= 0.5;
    victim.health -= dmg;
    victim.lastHurtBy = attacker || null;
    const killed = victim.health <= 0 && victim.alive;
    if (killed) { victim.health = 0; victim.alive = false; }
    return { dealt: dmg, killed };
  }
  function reportHit(attacker, victim, part, res, weaponId) {
    bus.emit('hit', { attacker, victim, part, killed: !!res.killed });
    if (res.killed) bus.emit('kill', { attacker, victim, weaponId, headshot: part === 'head' });
  }

  // Effect pools: created once, recycled forever.
  function makePool(n, make) { const p = []; for (let i = 0; i < n; i++) p.push(make(i)); return p; }
  const tracers = makePool(40, () => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false }));
    line.visible = false; line.frustumCulled = false; scene.add(line);
    return { line, life: 0, max: 0.07 };
  });
  let tracerIdx = 0;
  const sparkGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb35c });
  const sparks = makePool(48, () => { const m = new THREE.Mesh(sparkGeo, sparkMat); m.visible = false; scene.add(m); return { m, vel: new THREE.Vector3(), life: 0 }; });
  let sparkIdx = 0;
  // A sprite without a map renders as a solid square — give puffs a soft
  // radial falloff so an impact reads as dust, not as a grey card.
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = 64; puffCanvas.height = 64;
  const pctx = puffCanvas.getContext('2d');
  const grad = pctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 64, 64);
  const puffTex = new THREE.CanvasTexture(puffCanvas);
  const puffs = makePool(20, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xb8bcc0, transparent: true, opacity: 0, depthWrite: false })); s.visible = false; scene.add(s); return { s, life: 0 }; });
  let puffIdx = 0;

  function tracer(from, to) {
    const t = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % tracers.length;
    const a = t.line.geometry.attributes.position.array;
    a[0] = from.x; a[1] = from.y; a[2] = from.z; a[3] = to.x; a[4] = to.y; a[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.life = t.max; t.line.visible = true;
  }
  function impact(point, n) {
    for (let i = 0; i < n; i++) {
      const s = sparks[sparkIdx]; sparkIdx = (sparkIdx + 1) % sparks.length;
      s.m.position.copy(point);
      s.vel.set((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4);
      s.life = 0.22 + Math.random() * 0.15; s.m.visible = true;
    }
    const p = puffs[puffIdx]; puffIdx = (puffIdx + 1) % puffs.length;
    p.s.position.copy(point); p.s.scale.setScalar(0.22); p.life = 0.4; p.s.visible = true;
  }

  function spreadDeg(actor, def) {
    const lo = actor.loadout;
    let base = def.id === 'sniper' ? (lo && lo.scoped ? def.spread : SNIPER_UNSCOPED_SPREAD) : def.spread;
    let total = base + (lo ? lo.bloom || 0 : 0) + def.moveSpread * ((actor.speedNow || 0) / MOVE.walk) + (actor.grounded === false ? AIR_SPREAD : 0);
    return actor.crouch ? total * CROUCH_SPREAD_MULT : total;
  }
  function falloff(def, dist) {
    const [near, far] = def.range;
    return dist <= near ? 1 : dist >= far ? FALLOFF_FLOOR : lerp(1, FALLOFF_FLOOR, (dist - near) / (far - near));
  }

  const _targets = [];
  function shoot(actor, origin, dir) {
    const lo = actor.loadout;
    const slot = lo && lo.slots[lo.current];
    const def = slot && WEAPONS[slot.id];
    if (!def || def.melee || !actor.alive) return false;
    const spread = spreadDeg(actor, def) * DEG;
    _targets.length = 0;
    for (const a of actorList()) {
      if (a === actor || !a.alive || a.team === actor.team) continue;
      if (a.headMesh) _targets.push(a.headMesh);
      if (a.bodyMesh) _targets.push(a.bodyMesh);
    }
    raycaster.far = 200;
    for (let p = 0; p < def.pellets; p++) {
      _dir.copy(dir);
      _r.crossVectors(_dir, UP);
      if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); else _r.normalize();
      _u.crossVectors(_r, _dir);
      _dir.addScaledVector(_r, (Math.random() + Math.random() - 1) * spread)
        .addScaledVector(_u, (Math.random() + Math.random() - 1) * spread).normalize();
      raycaster.set(origin, _dir);
      const aHit = _targets.length ? raycaster.intersectObjects(_targets, false)[0] : null;
      const wHit = worldMeshes.length ? raycaster.intersectObjects(worldMeshes, false)[0] : null;
      let end;
      if (aHit && (!wHit || aHit.distance < wHit.distance)) {
        end = aHit.point;
        const victim = aHit.object.userData.actor;
        const part = aHit.object.userData.part || 'body';
        if (victim && victim.alive) {
          const dmg = def.dmg * (part === 'head' ? def.headMult : 1) * falloff(def, aHit.distance);
          const res = applyDamage(victim, dmg, part, actor) || { dealt: 0, killed: false };
          if (actor.isPlayer) { G.stats.hits++; if (audio && audio.hit) audio.hit(part === 'head'); if (res.killed && audio && audio.kill) audio.kill(); }
          reportHit(actor, victim, part, res, def.id);
        }
        impact(end, 3);
      } else if (wHit) { end = wHit.point; impact(end, 4); }
      else end = _to.copy(origin).addScaledVector(_dir, 120);
      tracer(origin, end);
    }
    if (actor.isPlayer) G.stats.shots++;
    bus.emit('shot', { actor, pos: origin, weaponId: def.id });
    if (audio && audio.shot) audio.shot(def.id, actor.pos);
    return true;
  }

  function melee(actor) {
    if (!actor.alive) return false;
    eyeOf(actor, _eye);
    lookDir(actor, _dir);
    let best = null, bestD = WEAPONS.knife.range[0] + 0.35;
    for (const a of actorList()) {
      if (a === actor || !a.alive || a.team === actor.team) continue;
      _mid.set(a.pos.x, a.pos.y + 0.9, a.pos.z);
      const d = _mid.distanceTo(_eye);
      if (d > bestD) continue;
      _tmp.copy(_mid).sub(_eye).normalize();
      if (_tmp.dot(_dir) < 0.45 || !losClear(_eye, _mid)) continue;
      best = a; bestD = d;
    }
    if (!best) return false;
    const res = applyDamage(best, WEAPONS.knife.dmg, 'body', actor) || { dealt: 0, killed: false };
    reportHit(actor, best, 'body', res, 'knife');
    return true;
  }

  const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const nadeMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.3 });
  const nades = makePool(12, () => { const m = new THREE.Mesh(nadeGeo, nadeMat); m.visible = false; scene.add(m); return { m, active: false, kind: 'frag', owner: null, vel: new THREE.Vector3(), fuse: 0, bounces: 0, rest: false }; });
  const smokes = makePool(6, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(GRENADE_FX.smokeRadius, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9aa0a3, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; scene.add(m); return { m, active: false, centre: new THREE.Vector3(), left: 0 }; });

  function throwGrenade(actor, kind, origin, dir) {
    const n = nades.find((x) => !x.active);
    if (!n) return false;
    n.active = true; n.kind = kind; n.owner = actor; n.bounces = 0; n.rest = false;
    n.fuse = GRENADE_FX.fuse[kind] || 1.4;
    n.m.position.copy(origin);
    n.vel.copy(dir).multiplyScalar(GRENADE_FX.throwSpeed);
    n.vel.y += 2.2;
    n.m.visible = true;
    return true;
  }

  function detonate(n) {
    n.active = false; n.m.visible = false;
    const pos = n.m.position;
    if (n.kind === 'smoke') {
      const s = smokes.find((x) => !x.active) || smokes[0];
      s.active = true; s.left = GRENADE_FX.smokeTime;
      s.centre.copy(pos); s.centre.y = Math.max(pos.y, 1.2);
      s.m.position.copy(s.centre); s.m.material.opacity = 0.55; s.m.visible = true;
      return;
    }
    if (n.kind === 'flash') {
      for (const a of actorList()) {
        if (!a.alive) continue;
        eyeOf(a, _eye);
        const d = _eye.distanceTo(pos);
        if (d > GRENADE_FX.flashMaxDist || !losClear(pos, _eye)) continue;
        lookDir(a, _dir);
        _tmp.copy(pos).sub(_eye).normalize();
        const facing = _tmp.dot(_dir) * 0.5 + 0.5; // 1 = staring at it
        const distScale = clamp(1 - d / (GRENADE_FX.flashMaxDist + 8), 0.25, 1);
        a.blinded = Math.max(a.blinded || 0, Math.max(GRENADE_FX.flashMinTime, GRENADE_FX.flashMaxTime * (0.3 + 0.7 * facing) * distScale));
        if (a.isPlayer && audio && audio.flashRing) audio.flashRing();
      }
      impact(pos, 6);
      return;
    }
    impact(pos, 10); // frag
    if (audio && audio.boom) audio.boom(pos);
    for (const a of actorList()) {
      if (!a.alive) continue;
      _mid.set(a.pos.x, a.pos.y + 0.9, a.pos.z);
      const d = _mid.distanceTo(pos);
      if (d > GRENADE_FX.fragRadius || !losClear(pos, _mid)) continue;
      const dmg = lerp(GRENADE_FX.fragDmgNear, GRENADE_FX.fragDmgFar, d / GRENADE_FX.fragRadius);
      const res = applyDamage(a, dmg, 'body', n.owner) || { dealt: 0, killed: false };
      reportHit(n.owner, a, 'body', res, 'frag');
    }
  }

  function stepNade(n, dt) {
    n.fuse -= dt;
    if (!n.rest) {
      n.vel.y -= GRENADE_FX.gravity * dt;
      n.m.position.addScaledVector(n.vel, dt);
      const p = n.m.position;
      if (p.y < 0.09) {
        p.y = 0.09;
        if (Math.abs(n.vel.y) > 1.2 && n.bounces < 1) { n.vel.y *= -0.35; n.vel.x *= 0.7; n.vel.z *= 0.7; n.bounces++; }
        else { n.vel.set(0, 0, 0); n.rest = true; }
      }
      for (let i = 0; i < colliders.length; i++) { // wall bounce
        const c = colliders[i];
        if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) {
          if (n.bounces < 1) { n.vel.multiplyScalar(-0.35); n.bounces++; p.x += n.vel.x * dt * 2; p.z += n.vel.z * dt * 2; }
          else { n.vel.set(0, 0, 0); n.rest = true; }
          break;
        }
      }
    }
    if (n.fuse <= 0 || (n.kind === 'smoke' && n.rest)) detonate(n);
  }

  function losClear(a, b) {
    if (segBlocked(a, b, colliders)) return false;
    for (const s of smokes) {
      if (!s.active) continue;
      _tmp.copy(b).sub(a);
      const len2 = _tmp.lengthSq() || 1e-6;
      const t = clamp(_mid.copy(s.centre).sub(a).dot(_tmp) / len2, 0, 1);
      _mid.copy(a).addScaledVector(_tmp, t);
      if (_mid.distanceToSquared(s.centre) < GRENADE_FX.smokeRadius ** 2) return false;
    }
    return true;
  }
  function raycastWorld(origin, dir, maxDist) {
    if (!worldMeshes.length) return null;
    raycaster.set(origin, dir);
    raycaster.far = maxDist || 200;
    return raycaster.intersectObjects(worldMeshes, false)[0] || null;
  }

  function step(dt) {
    for (const t of tracers) { if (t.life <= 0) continue; t.life -= dt; t.line.material.opacity = Math.max(0, t.life / t.max) * 0.85; if (t.life <= 0) t.line.visible = false; }
    for (const s of sparks) { if (s.life <= 0) continue; s.life -= dt; s.m.position.addScaledVector(s.vel, dt); s.vel.y -= 9 * dt; if (s.life <= 0) s.m.visible = false; }
    for (const p of puffs) { if (p.life <= 0) continue; p.life -= dt; p.s.scale.multiplyScalar(1 + dt * 3); p.s.material.opacity = Math.max(0, p.life / 0.4) * 0.35; if (p.life <= 0) p.s.visible = false; }
    for (const n of nades) if (n.active) stepNade(n, dt);
    for (const s of smokes) { if (!s.active) continue; s.left -= dt; if (s.left < 1) s.m.material.opacity = Math.max(0, s.left) * 0.55; if (s.left <= 0) { s.active = false; s.m.visible = false; } }
    for (const a of actorList()) {
      // Blindness decay lives in actors.step; combat only decays bloom here.
      if (a.loadout && a.loadout.bloom > 0) a.loadout.bloom = Math.max(0, a.loadout.bloom - BLOOM_DECAY * dt);
    }
  }

  return { shoot, melee, throwGrenade, step, losClear, raycastWorld };
}
