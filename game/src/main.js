// Breachline boot and wiring: builds every service, spawns the two squads, and
// runs the one loop — a fixed 60 Hz simulation (player body, bot brains, round
// machine, combat effects, actor sync) feeding a render at the display's rate.
// It also owns the glue no single module owns: kill rewards, charge pickups,
// the player's fire/reload/switch/grenade inputs, scope + spread readouts for
// the HUD, spectating after death, and the ?demo / ?shot entry modes.
import * as THREE from 'three';
import { G, bus } from './state.js';
import {
  ECONOMY, MOVE, SNIPER_UNSCOPED_SPREAD, AIR_SPREAD, CROUCH_SPREAD_MULT,
} from './config.js';
import { createWorld } from './world.js';
import { createNav } from './nav.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createActors } from './actors.js';
import {
  createLoadout, currentSlot, currentDef, switchTo, startReload, tickLoadout,
  tryFire, useGrenade, giveWeapon,
} from './weapon.js';
import { createCombat } from './combat.js';
import { createViewmodel } from './viewmodel.js';
import { createBrains } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';
import { damp } from './util.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const demo = params.get('demo') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createWorld(scene);
const nav = createNav(world);
const audio = createAudio();

const actorsSvc = createActors(scene, world);
let playerActor = null;
for (const team of ['atk', 'def']) {
  for (let i = 0; i < 5; i += 1) {
    const isPlayer = team === 'atk' && i === 2;
    const a = actorsSvc.spawn(team, i, isPlayer);
    a.loadout = createLoadout();
    if (isPlayer) playerActor = a;
  }
}
G.actors = actorsSvc.list;
G.player = playerActor;
playerActor.group.visible = false; // first person: the viewmodel is the body

const player = createPlayer(world);
player.spawn(playerActor.pos, playerActor.yaw);

const combat = createCombat({ scene, world, actors: actorsSvc, audio });
const brains = createBrains({ G, world, nav, combat });
for (const a of G.actors) if (a !== playerActor) brains.attach(a);
if (demo) { // the demo player is driven by a brain like any bot, then flagged back
  playerActor.isPlayer = false;
  brains.attach(playerActor);
  playerActor.isPlayer = true;
}
const rounds = createRounds({ G, actors: actorsSvc, world, audio, brains });
const hud = createHud();
const viewmodel = createViewmodel(camera);

// ---- cross-module glue -------------------------------------------------
bus.on('kill', (e) => { // kill reward lives here: neither combat nor rounds owns money
  const a = e && e.attacker;
  if (a && typeof a.money === 'number') a.money = Math.min(ECONOMY.cap, a.money + ECONOMY.killReward);
});
bus.on('hit', (e) => { if (e && e.victim === playerActor) audio.hurt(); });
bus.on('roundEnd', (e) => { audio.stinger(!!e && e.winner === playerActor.team); });
bus.on('roundStart', () => {
  player.spawn(playerActor.pos, playerActor.yaw);
  hud.setBuyOpen(false);
});

let started = false;
const input = createInput(renderer.domElement, (locked) => {
  if (shotMode) return;
  if (locked) hud.hideMenu();
  else if (started && !demo && G.phase !== 'menu' && G.phase !== 'matchEnd') hud.showMenu();
});
hud.onPlay(() => {
  audio.unlock();
  audio.ui();
  hud.hideMenu();
  if (G.phase === 'menu' || G.phase === 'matchEnd') { started = true; rounds.start(); }
  if (!demo) input.requestLock();
});
hud.onBuy((itemId) => { rounds.buyFor(playerActor, itemId); });
hud.showMenu();
if (demo) { started = true; hud.hideMenu(); rounds.start(); }

window.addEventListener('keydown', (e) => {
  if (demo || shotMode) return;
  if (e.code === 'KeyB' && G.phase === 'buy') hud.setBuyOpen(!hud.buyOpen);
  if (e.code === 'Escape') hud.setBuyOpen(false);
  if (e.code === 'KeyF') throwKind('flash');
  if (e.code === 'KeyQ') {
    const g = playerActor.loadout.grenades;
    throwKind(g.frag > 0 ? 'frag' : g.smoke > 0 ? 'smoke' : 'flash');
  }
  if (G.phase === 'buy') return; // digits belong to the buy menu during buy phase
  const slot = { Digit1: 'primary', Digit2: 'secondary', Digit3: 'knife' }[e.code];
  if (slot && switchTo(playerActor.loadout, slot)) audio.ui();
});

// ---- player actions ------------------------------------------------------
const _dir = new THREE.Vector3();
const _org = new THREE.Vector3();
let simNow = 0; // the player's weapon clock (tryFire/loadout timestamps)
let prevFiring = false;

function aimDir(out) {
  const cp = Math.cos(player.body.pitch);
  out.set(-cp * Math.sin(player.body.yaw), Math.sin(player.body.pitch), -cp * Math.cos(player.body.yaw));
  return out;
}

function playerFire(def) {
  const lo = playerActor.loadout;
  if (def.melee) {
    if (tryFire(lo, simNow).ok) combat.melee(playerActor);
    return;
  }
  const r = tryFire(lo, simNow);
  if (!r.ok) { if (r.why === 'empty') audio.dry(); return; }
  aimDir(_dir);
  combat.shoot(playerActor, player.eyePos(), _dir);
  viewmodel.muzzleFlash();
  player.recoil(def.recoilPitch, (Math.random() * 2 - 1) * def.recoilYaw);
}

function throwKind(kind) {
  if (G.phase !== 'live' && G.phase !== 'planted') return;
  if (!playerActor.alive || demo) return;
  if (!useGrenade(playerActor.loadout, kind).ok) return;
  aimDir(_dir);
  _org.copy(player.eyePos()).addScaledVector(_dir, 0.4);
  combat.throwGrenade(playerActor, kind, _org, _dir);
}

function playerActions() {
  const p = playerActor;
  const inRound = G.phase === 'live' || G.phase === 'planted';
  if (!p.alive || !inRound) { p.intent = null; prevFiring = input.state.firing; return; }
  const keys = input.state.keys;
  p.intent = null;
  if (keys.has('KeyE')) {
    if (p.team === 'atk' && p.carrier) p.intent = 'plant';
    else if (p.team === 'def' && G.charge.state === 'planted') p.intent = 'defuse';
  }
  if (keys.has('KeyR') && startReload(p.loadout)) audio.reload();
  const def = currentDef(p.loadout);
  if (input.state.firing && def && (def.auto || !prevFiring)) playerFire(def);
  prevFiring = input.state.firing;
}

// A dropped charge is picked up by the first living Breacher who reaches it.
function chargePickup() {
  const ch = G.charge;
  if (ch.state !== 'dropped' || !ch.pos) return;
  for (const a of G.actors) {
    if (!a.alive || a.team !== 'atk') continue;
    const dx = a.pos.x - ch.pos.x, dz = a.pos.z - ch.pos.z;
    if (dx * dx + dz * dz < 1.7) {
      a.carrier = true; ch.carrier = a; ch.state = 'carried'; ch.pos = null;
      return;
    }
  }
}

// ---- the fixed-step simulation -------------------------------------------
let brainsOn = true;
let stepAcc = 0;

function step(dt) {
  simNow += dt;
  const inRound = G.phase === 'live' || G.phase === 'planted';
  if (!demo) {
    player.step(dt, input.state, !inRound || !playerActor.alive);
    const b = player.body, p = playerActor;
    p.pos.copy(b.pos); p.vel.copy(b.vel);
    p.yaw = b.yaw; p.pitch = b.pitch;
    p.grounded = b.grounded; p.speedNow = b.speedNow;
    playerActions();
    p.crouch = b.crouch || !!p.intent; // channelling reads as a crouch
    if (p.alive && b.grounded && b.speedNow > 1 && inRound) {
      stepAcc += b.speedNow * dt;
      if (stepAcc > 2.8) { stepAcc = 0; audio.step(b.speedNow > 4); }
    }
  }
  for (const a of G.actors) { // loadout timers + armour/kit mirrored onto the actor
    if (!a.loadout) continue;
    tickLoadout(a.loadout, dt);
    a.armor = a.loadout.armor;
    a.helmet = a.loadout.helmet;
    a.hasKit = a.loadout.hasKit;
  }
  if (brainsOn) brains.step(dt);
  rounds.step(dt);
  combat.step(dt);
  actorsSvc.step(dt);
  chargePickup();
}

// ---- rendering -------------------------------------------------------------
let fov = 74;
let vmId = null;

function displaySpreadDeg(p, def) {
  if (!def || def.melee) return 0;
  const lo = p.loadout;
  const base = def.id === 'sniper' ? (lo.scoped ? def.spread : SNIPER_UNSCOPED_SPREAD) : def.spread;
  let total = base + (lo.bloom || 0) + def.moveSpread * (p.speedNow / MOVE.walk)
    + (p.grounded === false ? AIR_SPREAD : 0);
  if (p.crouch) total *= CROUCH_SPREAD_MULT;
  return total;
}

function syncCamera(dtR) {
  const p = playerActor;
  if (!demo && p.alive) {
    camera.position.copy(player.eyePos());
    camera.rotation.set(player.body.pitch, player.body.yaw, 0);
  } else {
    const a = p.alive ? p
      : G.actors.find((x) => x.alive && x.team === p.team) || G.actors.find((x) => x.alive);
    if (a) {
      camera.position.set(a.pos.x, a.pos.y + (a.crouch ? MOVE.crouchEye : MOVE.eye), a.pos.z);
      camera.rotation.set(a.pitch || 0, a.yaw || 0, 0);
    }
  }
  const target = !demo && p.scoped ? 32 : 74;
  const next = damp(fov, target, 16, dtR || 0.016);
  if (Math.abs(next - fov) > 0.01) { fov = next; camera.fov = fov; camera.updateProjectionMatrix(); }
}

function renderFrame(dtR) {
  const p = playerActor, lo = p.loadout, def = currentDef(lo);
  p.group.visible = false; // resetForRound revives every group; the camera lives inside this one
  const scoped = !demo && p.alive && input.state.scoping && !!def && def.id === 'sniper'
    && (G.phase === 'live' || G.phase === 'planted');
  lo.scoped = scoped;
  p.scoped = scoped;
  p.spreadNow = displaySpreadDeg(p, def);
  syncCamera(dtR);
  const slot = currentSlot(lo);
  const wid = slot ? slot.id : 'pistol';
  if (wid !== vmId) { vmId = wid; viewmodel.setWeapon(wid); }
  viewmodel.group.visible = !demo && p.alive && G.phase !== 'menu';
  viewmodel.step(Math.min(dtR || 0.016, 0.05), {
    moving: p.speedNow > 0.4, grounded: p.grounded,
    reloading: lo.reloading > 0, scoped,
  });
  audio.setListener(camera.position);
  hud.frame();
  renderer.render(scene, camera);
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtR = Math.min((now - last) / 1000, 0.1);
  last = now;
  const look = input.takeLook();
  if (!demo && playerActor.alive && (G.phase === 'live' || G.phase === 'planted')) {
    player.look(look.x, look.y);
  }
  acc += dtR;
  let n = 0;
  while (acc >= FIXED && n < 5) { step(FIXED); acc -= FIXED; n += 1; }
  if (acc > FIXED * 5) acc = 0;
  renderFrame(dtR);
}

window.__game = G;
window.__scene = scene; // debug handles: handy in devtools, used by the shot tooling
window.__camera = camera;
window.__renderer = renderer;
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shotMode) {
  stageShot(shotMode, {
    G, bus, scene, camera, renderer, world, player, playerActor,
    hud, rounds, combat, viewmodel,
    stepSim: step,
    renderFrame: () => renderFrame(0.016),
    setBrains: (on) => { brainsOn = on; },
    fireOnce: () => { const def = currentDef(playerActor.loadout); if (def) playerFire(def); },
    giveWeapon, switchTo,
  });
} else {
  requestAnimationFrame(frame);
}
