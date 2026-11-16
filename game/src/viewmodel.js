// First-person weapon viewmodels: one low-poly box-built mesh per weapon class,
// cached and swapped by setWeapon(). Walk bob, reload dip-and-return and a muzzle
// flash plane + PointLight pulse live here. Scoped (sniper) hides the model.

import * as THREE from 'three';
import { damp } from './util.js';

function mat(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
const MATS = { body: mat(0x23262b, 0.55, 0.35), dark: mat(0x141519, 0.7, 0.2), metal: mat(0x3a3f47, 0.35, 0.6), accent: mat(0xe8862e, 0.5, 0.3) };

function box(parent, mat, w, h, d, x, y, z, rx) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  parent.add(m);
  return m;
}
function tube(parent, mat, r, len, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Each builder fills a group and returns the muzzle position (barrel tip).
const BUILDERS = {
  knife(g) {
    box(g, MATS.dark, 0.03, 0.09, 0.11, 0, -0.03, 0.02);
    box(g, MATS.metal, 0.012, 0.05, 0.3, 0, 0.03, -0.18);
    return new THREE.Vector3(0, 0.03, -0.34);
  },
  pistol(g) {
    box(g, MATS.body, 0.05, 0.08, 0.24, 0, 0, 0);
    tube(g, MATS.metal, 0.02, 0.1, 0, 0.03, -0.16);
    box(g, MATS.dark, 0.045, 0.12, 0.07, 0, -0.09, 0.07, 0.25);
    box(g, MATS.metal, 0.012, 0.03, 0.012, 0, 0.06, -0.1);
    return new THREE.Vector3(0, 0.03, -0.24);
  },
  smg(g) {
    box(g, MATS.body, 0.055, 0.09, 0.4, 0, 0, 0);
    tube(g, MATS.metal, 0.022, 0.16, 0, 0.02, -0.27);
    box(g, MATS.dark, 0.04, 0.15, 0.06, 0, -0.11, -0.02, 0.15);
    box(g, MATS.dark, 0.045, 0.07, 0.16, 0, -0.01, 0.26);
    box(g, MATS.accent, 0.058, 0.02, 0.1, 0, 0.045, -0.05);
    return new THREE.Vector3(0, 0.02, -0.37);
  },
  shotgun(g) {
    box(g, MATS.body, 0.06, 0.08, 0.44, 0, 0, 0);
    tube(g, MATS.metal, 0.026, 0.3, -0.018, 0.03, -0.3);
    tube(g, MATS.metal, 0.026, 0.3, 0.018, 0.03, -0.3);
    box(g, MATS.dark, 0.055, 0.05, 0.14, 0, -0.03, -0.22);
    box(g, MATS.dark, 0.05, 0.1, 0.08, 0, -0.07, 0.14, 0.2);
    return new THREE.Vector3(0, 0.03, -0.47);
  },
  rifle(g) {
    box(g, MATS.body, 0.055, 0.095, 0.46, 0, 0, 0);
    tube(g, MATS.metal, 0.02, 0.24, 0, 0.03, -0.33);
    box(g, MATS.dark, 0.04, 0.16, 0.06, 0, -0.12, 0.0, 0.18);
    box(g, MATS.dark, 0.045, 0.07, 0.18, 0, -0.02, 0.3);
    box(g, MATS.metal, 0.014, 0.045, 0.014, 0, 0.07, -0.08);
    box(g, MATS.accent, 0.057, 0.018, 0.12, 0, 0.05, 0.08);
    return new THREE.Vector3(0, 0.03, -0.47);
  },
  heavy(g) {
    box(g, MATS.body, 0.075, 0.12, 0.5, 0, 0, 0);
    tube(g, MATS.metal, 0.026, 0.26, 0, 0.03, -0.36);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), MATS.dark);
    drum.rotation.z = Math.PI / 2; // drum mag
    drum.position.set(0, -0.1, 0.02);
    g.add(drum);
    box(g, MATS.dark, 0.06, 0.08, 0.2, 0, -0.02, 0.32);
    box(g, MATS.metal, 0.016, 0.05, 0.016, 0, 0.085, -0.1);
    return new THREE.Vector3(0, 0.03, -0.5);
  },
  sniper(g) {
    box(g, MATS.body, 0.05, 0.08, 0.56, 0, 0, 0.02);
    tube(g, MATS.metal, 0.016, 0.4, 0, 0.02, -0.44);
    box(g, MATS.dark, 0.04, 0.13, 0.055, 0, -0.1, 0.05, 0.12);
    box(g, MATS.dark, 0.045, 0.07, 0.2, 0, -0.02, 0.34);
    tube(g, MATS.dark, 0.03, 0.2, 0, 0.085, -0.05); // scope
    tube(g, MATS.metal, 0.02, 0.03, 0, 0.085, -0.16); // objective bell
    box(g, MATS.metal, 0.01, 0.03, 0.01, 0, 0.05, -0.05);
    return new THREE.Vector3(0, 0.02, -0.66);
  },
};

export function createViewmodel(camera) {
  const group = new THREE.Group();
  const BASE = new THREE.Vector3(0.24, -0.22, -0.45);
  group.position.copy(BASE);
  camera.add(group);

  // Soft radial sprite texture: a bare plane reads as a yellow card, a falloff
  // disc with additive blending reads as a flash.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64; flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const fgrad = fctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  fgrad.addColorStop(0, 'rgba(255,255,255,1)');
  fgrad.addColorStop(0.35, 'rgba(255,220,150,0.75)');
  fgrad.addColorStop(1, 'rgba(255,180,80,0)');
  fctx.fillStyle = fgrad;
  fctx.fillRect(0, 0, 64, 64);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(flashCanvas), color: 0xffc46b, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  flash.visible = false;
  group.add(flash);
  const light = new THREE.PointLight(0xffb35c, 0, 6);
  group.add(light);

  const cache = new Map();
  let current = null, currentId = null;
  let bobPhase = 0, bobAmt = 0, dip = 0, flashT = 0, kick = 0;

  function setWeapon(id) {
    if (current) current.group.visible = false;
    currentId = id;
    if (!cache.has(id)) {
      const g = new THREE.Group();
      const build = BUILDERS[id] || BUILDERS.rifle;
      const muzzle = build(g);
      g.visible = false;
      group.add(g);
      cache.set(id, { group: g, muzzle });
    }
    current = cache.get(id);
    current.group.visible = true;
    flash.position.copy(current.muzzle);
    light.position.copy(current.muzzle).z -= 0.1;
    dip = 0; flashT = 0; flash.visible = false; light.intensity = 0;
  }

  function muzzleFlash() {
    flashT = 0.055;
    kick = 0.035;
    flash.visible = true;
    flash.rotation.z = Math.random() * Math.PI;
    flash.scale.setScalar(0.8 + Math.random() * 0.5);
    light.intensity = 2.4;
  }

  // opts: { moving, grounded, reloading (bool|seconds), scoped }
  function step(dt, opts) {
    const o = opts || {};
    const target = o.moving && o.grounded !== false ? 1 : 0;
    bobAmt = damp(bobAmt, target, 10, dt);
    bobPhase += dt * 8.5 * bobAmt;
    const reloading = o.reloading === true || (typeof o.reloading === 'number' && o.reloading > 0);
    dip = damp(dip, reloading ? 1 : 0, 12, dt);
    kick = damp(kick, 0, 16, dt);

    group.position.set(
      BASE.x + Math.sin(bobPhase) * 0.012 * bobAmt,
      BASE.y + Math.abs(Math.cos(bobPhase)) * 0.014 * bobAmt - dip * 0.24,
      BASE.z + kick,
    );
    group.rotation.set(dip * 0.55 + kick * 1.4, 0, Math.sin(bobPhase * 0.5) * 0.01 * bobAmt);
    group.visible = !o.scoped;

    if (flashT > 0) {
      flashT -= dt;
      light.intensity = Math.max(0, flashT / 0.055) * 2.4;
      if (flashT <= 0) { flash.visible = false; light.intensity = 0; }
    }
  }

  return { group, setWeapon, step, muzzleFlash };
}
