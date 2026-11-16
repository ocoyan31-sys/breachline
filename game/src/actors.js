// actors.js — Breachline fighter bodies: low-poly box soldiers with head/body hit
// meshes, team colours, health/armour damage and death. Owns the actor objects.
// Convention: forward = (-sin yaw, 0, -cos yaw). Groups use rotation.order 'YXZ'
// with rotation.y = yaw; an inner aim group carries pitch for the gun prop.
import * as THREE from 'three';
import * as CFG from './config.js';
import { G, bus } from './state.js';

const TEAM_HEX = { atk: 0xe8862e, def: 0x2ea8a0 };
const FALLBACK_NAMES = {
  atk: ['Vex', 'Onyx', 'Rook', 'Sable', 'Flint'],
  def: ['Halo', 'Bastion', 'Prime', 'Sigil', 'Vault'],
};
const SKIN = [0xc9976f, 0xa9744f, 0xdbb08a, 0x8a5a3b, 0xbd8560];

function teamNames(team) {
  const src = CFG.NAMES || CFG.TEAM_NAMES;
  if (Array.isArray(src?.[team])) return src[team];
  if (Array.isArray(CFG.TEAMS?.[team]?.names)) return CFG.TEAMS[team].names;
  if (team === 'atk' && Array.isArray(CFG.ATK_NAMES)) return CFG.ATK_NAMES;
  if (team === 'def' && Array.isArray(CFG.DEF_NAMES)) return CFG.DEF_NAMES;
  return FALLBACK_NAMES[team] || FALLBACK_NAMES.atk;
}
function teamHex(team) {
  const c = CFG.TEAMS?.[team]?.color ?? CFG.TEAM_COLORS?.[team];
  if (typeof c === 'number') return c;
  if (typeof c === 'string') return new THREE.Color(c).getHex();
  return TEAM_HEX[team] ?? 0xcccccc;
}
const START_MONEY = CFG.ECONOMY?.start ?? CFG.START_MONEY ?? 800;

export function createActors(scene, world) {
  const list = [];
  const hitMeshes = [];
  const meta = []; // per actor id: { index, fall, rig, aim, helmetMesh }
  let nextId = 0;

  const mat = (hex, rough = 0.85) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.05 });
  const mats = {
    vest: mat(0x1d2026, 0.95), pants: mat(0x2b2f36, 0.95), gun: mat(0x14161a, 0.6),
    atk: mat(teamHex('atk')), def: mat(teamHex('def')),
    skin: SKIN.map((h) => mat(h, 0.7)),
  };
  const geo = {
    leg: new THREE.BoxGeometry(0.17, 0.82, 0.2), torso: new THREE.BoxGeometry(0.56, 1.05, 0.3),
    vest: new THREE.BoxGeometry(0.58, 0.66, 0.36), arm: new THREE.BoxGeometry(0.13, 0.68, 0.15),
    head: new THREE.BoxGeometry(0.24, 0.24, 0.24), helmet: new THREE.BoxGeometry(0.3, 0.13, 0.3),
    brim: new THREE.BoxGeometry(0.3, 0.04, 0.14), gun: new THREE.BoxGeometry(0.07, 0.1, 0.58),
    barrel: new THREE.BoxGeometry(0.04, 0.04, 0.3),
  };
  function part(geometry, material, x, y, z, parent) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  // A readable fighter from boxes: legs, team torso, dark vest, arms, skin head
  // with a team cap, and a gun prop on a pitch group at the shoulder.
  function buildMeshes(actor) {
    const teamMat = mats[actor.team] || mats.atk;
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    const rig = new THREE.Group(); // crouch squash lives here, feet stay planted
    group.add(rig);
    part(geo.leg, mats.pants, -0.11, 0.41, 0, rig);
    part(geo.leg, mats.pants, 0.11, 0.41, 0, rig);
    const bodyMesh = part(geo.torso, teamMat, 0, 1.06, 0, rig);
    part(geo.vest, mats.vest, 0, 1.08, 0, rig);
    part(geo.arm, teamMat, -0.36, 1.12, 0, rig);
    part(geo.arm, teamMat, 0.36, 1.12, -0.06, rig);
    const headMesh = part(geo.head, mats.skin[actor.id % mats.skin.length], 0, 1.68, 0, rig);
    const helmetMesh = part(geo.helmet, teamMat, 0, 1.82, 0, rig);
    part(geo.brim, teamMat, 0, 1.76, -0.2, rig);
    const aim = new THREE.Group();
    aim.position.set(0.16, 1.34, 0);
    rig.add(aim);
    part(geo.gun, mats.gun, 0, 0, -0.24, aim);
    part(geo.barrel, mats.gun, 0, 0.02, -0.62, aim);
    bodyMesh.userData = { actor, part: 'body' };
    headMesh.userData = { actor, part: 'head' };
    hitMeshes.push(bodyMesh, headMesh);
    scene.add(group);
    return { group, rig, aim, helmetMesh, headMesh, bodyMesh };
  }

  function faceYaw(from, to) { return Math.atan2(-(to.x - from.x), -(to.z - from.z)); }

  function spawnPosFor(actor) {
    const arr = world.spawns?.[actor.team] || [];
    const m = meta[actor.id];
    return arr.length ? arr[m.index % arr.length] : null;
  }

  function placeAtSpawn(actor) {
    const sp = spawnPosFor(actor);
    if (sp) actor.pos.copy(sp);
    const foes = world.spawns?.[actor.team === 'atk' ? 'def' : 'atk'];
    actor.yaw = foes?.length ? faceYaw(actor.pos, foes[0]) : (actor.team === 'atk' ? -Math.PI / 2 : Math.PI / 2);
    actor.pitch = 0;
    actor.group.visible = true;
    syncTransform(actor);
  }

  function syncTransform(actor) {
    const m = meta[actor.id];
    if (!m || !actor.group) return;
    actor.group.position.copy(actor.pos);
    if (!actor.alive) { // sink once the body has lain 4 s
      actor.group.position.y -= Math.min(0.9, Math.max(0, actor.deadTime - 4) * 0.3);
    }
    actor.group.rotation.set(0, actor.yaw, actor.alive ? 0 : m.fall * 1.42);
    m.aim.rotation.x = actor.pitch;
    m.rig.scale.y = actor.crouch ? 0.72 : 1;
    m.helmetMesh.visible = !!actor.helmet;
  }

  function spawn(team, index, isPlayer = false) {
    const actor = {
      id: nextId++, team, name: teamNames(team)[index % 5] || `Bot-${index}`,
      isPlayer: !!isPlayer, alive: true, health: 100, armor: 0, helmet: false,
      money: START_MONEY, hasKit: false, carrier: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
      crouch: false, grounded: true, speedNow: 0, radius: 0.35, height: 1.8,
      loadout: null, brain: null, group: null, headMesh: null, bodyMesh: null,
      lastHurtBy: null, deadTime: 0, blinded: 0, intent: null,
    };
    meta[actor.id] = { index, fall: index % 2 ? -1 : 1, rig: null, aim: null, helmetMesh: null };
    const built = buildMeshes(actor);
    actor.group = built.group;
    actor.headMesh = built.headMesh;
    actor.bodyMesh = built.bodyMesh;
    meta[actor.id].rig = built.rig;
    meta[actor.id].aim = built.aim;
    meta[actor.id].helmetMesh = built.helmetMesh;
    list.push(actor);
    placeAtSpawn(actor);
    return actor;
  }

  // Armour halves health damage; a helmet halves head damage again on top.
  function damage(actor, amount, part, attacker) {
    if (part && typeof part === 'object') { attacker = part; part = 'body'; } // (victim, dmg, attacker) callers
    if (!actor || !actor.alive || amount <= 0) return { dealt: 0, killed: false };
    let dealt = amount;
    if (actor.armor > 0) dealt *= 0.5;
    if (part === 'head' && actor.helmet) dealt *= 0.5;
    actor.health -= dealt;
    actor.lastHurtBy = attacker || null;
    let killed = false;
    if (actor.health <= 0) {
      actor.health = 0;
      actor.alive = false;
      actor.deadTime = 0;
      actor.intent = null;
      actor.crouch = false;
      killed = true;
      if (actor.carrier) { // charge drops where the carrier fell
        actor.carrier = false;
        if (G?.charge && G.charge.carrier === actor) {
          G.charge.carrier = null;
          G.charge.state = 'dropped';
          G.charge.pos = actor.pos.clone();
        }
      }
      syncTransform(actor); // tip over now, even if step() is never called
      bus?.emit?.('death', { actor, attacker: attacker || null, part });
    }
    return { dealt, killed };
  }

  function resetForRound() {
    for (const actor of list) {
      if (actor.loadout) { // armour persists across rounds and lives on the loadout
        actor.armor = actor.loadout.armor ?? actor.armor;
        actor.helmet = actor.loadout.helmet ?? actor.helmet;
        actor.loadout.armor = actor.armor;
        actor.loadout.helmet = actor.helmet;
      }
      actor.alive = true;
      actor.health = 100;
      actor.deadTime = 0;
      actor.blinded = 0;
      actor.intent = null;
      actor.crouch = false;
      actor.lastHurtBy = null;
      actor.vel.set(0, 0, 0);
      actor.speedNow = 0;
      placeAtSpawn(actor);
    }
  }

  // Sync meshes from actor state and age corpses. (Blinded decay is combat.step's.)
  function step(dt) {
    for (const actor of list) {
      if (!actor.alive) actor.deadTime += dt;
      syncTransform(actor);
    }
  }

  return { list, hitMeshes, spawn, resetForRound, damage, step };
}
