// Screenshot staging: ?shot=combat|buy|plant|end&seed=N builds a real match,
// poses it at a truthful moment (the same phases, HUD and actors a player sees),
// settles a few fixed steps, renders twice, then freezes and sets
// window.__shotReady. Nothing here draws or fakes anything — it only moves
// actors and match state, exactly as the starter's shot protocol did.
import * as THREE from 'three';

const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
const byTeam = (G, t) => G.actors.filter((a) => a.team === t);

function place(actor, x, z, yaw, pitch = 0) {
  actor.pos.set(x, 0, z);
  actor.yaw = yaw;
  actor.pitch = pitch;
  actor.vel.set(0, 0, 0);
}

function settle(ctx, steps) {
  for (let i = 0; i < steps; i += 1) ctx.stepSim(1 / 60);
}

function finish(ctx) {
  ctx.renderFrame();
  ctx.renderFrame();
  window.__shotReady = true;
}

function giveRifle(ctx, actor, mag) {
  const lo = actor.loadout;
  ctx.giveWeapon(lo, 'rifle');
  ctx.switchTo(lo, 'primary');
  if (lo.slots.primary) lo.slots.primary.mag = mag;
}

function shotBuy(ctx) {
  const { G, hud, rounds, playerActor } = ctx;
  playerActor.money = 6950; // rifle ($2,700) bought below leaves the $4,250 shown
  rounds.buyFor(playerActor, 'rifle');
  hud.setBuyOpen(true);
  settle(ctx, 10);
  finish(ctx);
}

function shotCombat(ctx) {
  const { G, player, playerActor } = ctx;
  G.phase = 'live';
  G.phaseTime = 83; // 1:23 on the round clock
  giveRifle(ctx, playerActor, 27);
  const px = -2, pz = 1.2, ex = 7, ez = -0.5;
  player.spawn(new THREE.Vector3(px, 0, pz), yawTo(px, pz, ex, ez));
  player.setAim(yawTo(px, pz, ex, ez), -0.033); // chest height at ~9 m
  const defs = byTeam(G, 'def'), atks = byTeam(G, 'atk').filter((a) => a !== playerActor);
  place(defs[1], ex, ez, yawTo(ex, ez, px, pz)); // the Warden crossing mid
  place(defs[0], 15, -5, yawTo(15, -5, px, pz));
  place(defs[2], 18, 7, yawTo(18, 7, px, pz));
  place(atks[0], -5.5, 4.5, yawTo(-5.5, 4.5, 12, 0)); // a Breacher covering beside you
  ctx.renderFrame(); // flush matrixWorld: raycasts read it, and no render has run yet
  settle(ctx, 6);
  ctx.fireOnce();
  settle(ctx, 7); // the rifle's 600 rpm gate is 6 steps — space the burst honestly
  ctx.fireOnce();
  settle(ctx, 7);
  ctx.fireOnce(); // third round: tracer in flight, hitmarker lit, 24/90 on the counter
  settle(ctx, 1);
  finish(ctx);
}

function shotPlant(ctx) {
  const { G, player, playerActor } = ctx;
  const site = { x: 23, z: -17 }; // Foundry (site A)
  const planter = byTeam(G, 'atk').find((a) => a !== playerActor);
  place(planter, site.x + 0.9, site.z + 0.6, yawTo(site.x + 0.9, site.z + 0.6, site.x, site.z));
  planter.crouch = true;
  const ch = G.charge;
  ch.state = 'planted';
  ch.site = 'A';
  ch.pos = new THREE.Vector3(site.x, 0, site.z);
  ch.timer = 32;
  G.phase = 'planted';
  G.phaseTime = 32;
  giveRifle(ctx, playerActor, 27);
  playerActor.health = 76;
  const px = 13, pz = -8;
  player.spawn(new THREE.Vector3(px, 0, pz), yawTo(px, pz, site.x, site.z));
  player.setAim(yawTo(px, pz, site.x, site.z), -0.046);
  const defs = byTeam(G, 'def');
  place(defs[0], 20, -12.5, yawTo(20, -12.5, site.x, site.z)); // retaking Warden
  place(defs[1], 27, -21, yawTo(27, -21, px, pz));
  settle(ctx, 8);
  finish(ctx);
}

function shotEnd(ctx) {
  const { G, bus, player, playerActor } = ctx;
  G.score.atk = 6;
  G.score.def = 4;
  G.winner = 'atk';
  G.winReason = 'elimination';
  const defs = byTeam(G, 'def');
  const corpses = [[24, 18], [21, 15], [27, 20]];
  defs.slice(0, 3).forEach((a, i) => {
    a.alive = false;
    a.health = 0;
    place(a, corpses[i][0], corpses[i][1], i * 1.7);
  });
  giveRifle(ctx, playerActor, 18);
  const px = 20, pz = 13;
  player.spawn(new THREE.Vector3(px, 0, pz), yawTo(px, pz, 23.5, 17.5));
  player.setAim(yawTo(px, pz, 23.5, 17.5), -0.02);
  const atks = byTeam(G, 'atk').filter((a) => a !== playerActor);
  place(atks[0], 17.5, 16, yawTo(17.5, 16, 0, 16));
  place(atks[1], 25, 11.5, yawTo(25, 11.5, 33, 11.5));
  G.phase = 'roundEnd';
  G.phaseTime = 4.5;
  bus.emit('roundEnd', { winner: 'atk', reason: 'elimination', score: { atk: 6, def: 4 } });
  settle(ctx, 6);
  finish(ctx);
}

export function stageShot(name, ctx) {
  ctx.hud.hideMenu();
  ctx.setBrains(false); // poses are staged; brains would wander off-frame
  ctx.rounds.start(); // a real match: round 1, buy phase, squads at their spawns
  if (name === 'buy') shotBuy(ctx);
  else if (name === 'plant') shotPlant(ctx);
  else if (name === 'end') shotEnd(ctx);
  else shotCombat(ctx);
}
