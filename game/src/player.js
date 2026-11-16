// The human body: WASD acceleration/friction movement, crouch, a small jump, and
// per-axis AABB collision against world.colliders + world.bounds. main.js copies
// body onto the player actor each step and aims the camera from yaw/pitch + eyePos().
// Recoil is a recoverable offset: recoil() kicks it, step() damps it back to zero,
// and body.yaw/body.pitch always carry aim + offset so the camera just reads them.

import * as THREE from 'three';
import { MOVE } from './config.js';
import { clamp, damp } from './util.js';

export function createPlayer(world) {
  const colliders = world.colliders || [];
  const bounds = world.bounds || { minX: -33, maxX: 33, minZ: -33, maxZ: 33 };

  const body = {
    pos: new THREE.Vector3(0, 0, 0),   // feet
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,                  // effective aim (includes recoil offset)
    crouch: false, grounded: true,
    eye: MOVE.eye,                     // current eye height above feet
    speedNow: 0,                       // horizontal speed, m/s
    height: MOVE.height, radius: MOVE.radius,
  };
  let aimYaw = 0, aimPitch = 0;        // aim without recoil
  let recP = 0, recY = 0;              // recoil offset, recovered in step()
  const _eye = new THREE.Vector3();

  function syncAim() {
    body.yaw = aimYaw + recY;
    body.pitch = clamp(aimPitch + recP, -MOVE.pitchMax, MOVE.pitchMax);
  }

  function look(dx, dy) {
    aimYaw -= dx * MOVE.sens;
    aimPitch = clamp(aimPitch - dy * MOVE.sens, -MOVE.pitchMax, MOVE.pitchMax);
    syncAim();
  }

  function recoil(p, y) { recP += p; recY += y || 0; syncAim(); }

  function setAim(yaw, pitch) {
    aimYaw = yaw; aimPitch = clamp(pitch, -MOVE.pitchMax, MOVE.pitchMax);
    recP = 0; recY = 0; syncAim();
  }

  function spawn(pos, yaw) {
    body.pos.copy(pos);
    body.vel.set(0, 0, 0);
    body.crouch = false; body.grounded = true; body.speedNow = 0;
    setAim(yaw || 0, 0);
  }

  // Does the player AABB at (x,y,z) overlap any collider? Small vertical inset so
  // standing exactly on a box top is contact, not overlap.
  function overlaps(x, y, z) {
    const r = body.radius, y0 = y + 0.02, y1 = y + body.height - 0.02;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x + r > c.min.x && x - r < c.max.x &&
          y0 < c.max.y && y1 > c.min.y &&
          z + r > c.min.z && z - r < c.max.z) return c;
    }
    return null;
  }

  function step(dt, inputState, frozen) {
    const keys = inputState && inputState.keys ? inputState.keys : inputState;
    const has = (code) => !frozen && !!keys && typeof keys.has === 'function' && keys.has(code);

    // Crouch (headroom permitting when standing back up) + eye height easing.
    const wantCrouch = has('ControlLeft') || has('ControlRight') || has('KeyC');
    if (wantCrouch) body.crouch = true;
    else if (body.crouch) {
      const h = body.height;
      body.height = MOVE.height;
      if (!overlaps(body.pos.x, body.pos.y, body.pos.z)) body.crouch = false;
      else body.height = h;
    }
    const targetH = body.crouch ? MOVE.crouchHeight : MOVE.height;
    body.height = damp(body.height, targetH, 18, dt);
    body.eye = damp(body.eye, body.crouch ? MOVE.crouchEye : MOVE.eye, 18, dt);

    // Wish direction from keys, rotated by aim yaw (yaw 0 faces -Z).
    let wx = 0, wz = 0;
    if (has('KeyW') || has('ArrowUp')) wz -= 1;
    if (has('KeyS') || has('ArrowDown')) wz += 1;
    if (has('KeyA') || has('ArrowLeft')) wx -= 1;
    if (has('KeyD') || has('ArrowRight')) wx += 1;
    const sy = Math.sin(aimYaw), cy = Math.cos(aimYaw);
    let wishX = wx * cy + wz * sy;
    let wishZ = -wx * sy + wz * cy;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0) { wishX /= wl; wishZ /= wl; }

    const walking = has('ShiftLeft') || has('ShiftRight');
    const maxSpeed = body.crouch ? MOVE.crouch : walking ? 2.6 : MOVE.walk;
    const vel = body.vel;
    if (body.grounded) {
      const f = Math.max(0, 1 - MOVE.friction * dt);
      vel.x *= f; vel.z *= f;
      vel.x += wishX * MOVE.groundAccel * dt;
      vel.z += wishZ * MOVE.groundAccel * dt;
      const hs = Math.hypot(vel.x, vel.z);
      if (hs > maxSpeed) { vel.x *= maxSpeed / hs; vel.z *= maxSpeed / hs; }
      if (has('Space')) { vel.y = MOVE.jump; body.grounded = false; }
    } else {
      const before = Math.hypot(vel.x, vel.z);
      vel.x += wishX * MOVE.airAccel * dt;
      vel.z += wishZ * MOVE.airAccel * dt;
      const hs = Math.hypot(vel.x, vel.z), cap = Math.max(maxSpeed, before);
      if (hs > cap) { vel.x *= cap / hs; vel.z *= cap / hs; }
    }
    vel.y -= MOVE.gravity * dt;

    // Integrate and resolve one axis at a time so walls slide instead of sticking.
    const p = body.pos;
    p.x += vel.x * dt;
    let hit = overlaps(p.x, p.y, p.z);
    if (hit) { p.x = vel.x > 0 ? hit.min.x - body.radius : hit.max.x + body.radius; vel.x = 0; }
    p.z += vel.z * dt;
    hit = overlaps(p.x, p.y, p.z);
    if (hit) { p.z = vel.z > 0 ? hit.min.z - body.radius : hit.max.z + body.radius; vel.z = 0; }
    p.y += vel.y * dt;
    body.grounded = false;
    hit = overlaps(p.x, p.y, p.z);
    if (hit) {
      if (vel.y <= 0) { p.y = hit.max.y; body.grounded = true; }
      else p.y = hit.min.y - body.height;
      vel.y = 0;
    }
    if (p.y <= 0) { p.y = 0; body.grounded = true; if (vel.y < 0) vel.y = 0; }

    p.x = clamp(p.x, bounds.minX + body.radius, bounds.maxX - body.radius);
    p.z = clamp(p.z, bounds.minZ + body.radius, bounds.maxZ - body.radius);

    body.speedNow = Math.hypot(vel.x, vel.z);

    // Recoil recovery.
    if (recP !== 0 || recY !== 0) {
      recP = damp(recP, 0, MOVE.recoilRecover, dt);
      recY = damp(recY, 0, MOVE.recoilRecover, dt);
      if (Math.abs(recP) < 1e-4) recP = 0;
      if (Math.abs(recY) < 1e-4) recY = 0;
      syncAim();
    }
  }

  function eyePos() {
    _eye.set(body.pos.x, body.pos.y + body.eye, body.pos.z);
    return _eye;
  }

  return { body, step, look, recoil, eyePos, setAim, spawn };
}
