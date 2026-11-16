// Kestrel Yard: the whole map as data. A single BOXES table of [x, z, w, d, h, kind]
// drives both the meshes and the AABB colliders, so what you see is exactly what
// collides and what bullets hit. Also sites, spawns, lights, fog and NAV_NODES.
import * as THREE from 'three';
import {
  CANVAS, SURFACE, HAIRLINE, MUTED, ACCENT, ATK, DEF,
  SUN, SKY, GROUND, CONCRETE, WOOD, STEEL,
} from './palette.js';

// Hand-placed nav graph nodes (y = 0). nav.js auto-connects pairs within 11 m whose
// segment is clear at body height. Tags name the tactical spots bots ask for.
export const NAV_NODES = [
  { x: -28, z: 0, tag: 'atkSpawn' }, { x: -20, z: 0, tag: 'midW' },
  { x: -14, z: 0, tag: 'midC' }, { x: -8, z: 0, tag: 'mid' },
  { x: 2, z: 1.2, tag: 'midDoor' }, { x: 10, z: 0, tag: 'midE' },
  { x: 20, z: 0, tag: 'defMid' }, { x: 28, z: 0, tag: 'defSpawn' },
  { x: -8, z: -7, tag: 'connN1' }, { x: 10, z: -7, tag: 'connN2' },
  { x: -8, z: 7, tag: 'connS1' }, { x: 10, z: 7, tag: 'connS2' },
  { x: -28, z: -14, tag: 'northW' }, { x: -21, z: -14, tag: 'aLaneW' },
  { x: -14, z: -14, tag: 'aLane' }, { x: -5, z: -14, tag: 'aLaneC' },
  { x: 3, z: -14, tag: 'aLaneMid' }, { x: 12, z: -14, tag: 'aLaneE' },
  { x: 20, z: -14, tag: 'aEntry' }, { x: 23, z: -17, tag: 'aSite' },
  { x: 29, z: -17, tag: 'aBack' },
  { x: -28, z: 14, tag: 'southW' }, { x: -21, z: 14, tag: 'bLaneW' },
  { x: -14, z: 14, tag: 'bLane' }, { x: -5, z: 14, tag: 'bLaneC' },
  { x: 3, z: 14, tag: 'bLaneMid' }, { x: 12, z: 14, tag: 'bLaneE' },
  { x: 20, z: 14, tag: 'bEntry' }, { x: 23, z: 17, tag: 'bSite' },
  { x: 29, z: 17, tag: 'bBack' },
];

// [x, z, w, d, h, kind] — centre, footprint, height from the ground, material kind.
// Flat kinds (pads, stripes) are paint only: no collider, nothing for bullets to hit.
const BOXES = [
  // Perimeter walls, h = 4, inner faces at ±32.5.
  [-33, 0, 1, 66, 4, 'wall'], [33, 0, 1, 66, 4, 'wall'],
  [0, -33, 68, 1, 4, 'wall'], [0, 33, 68, 1, 4, 'wall'],
  // Lane dividers at z = ∓7, with connector gaps centred on x = -8 and x = +10.
  [-21, -7, 23, 0.6, 3.2, 'wall'], [1, -7, 15, 0.6, 3.2, 'wall'], [22, -7, 21, 0.6, 3.2, 'wall'],
  [-21, 7, 23, 0.6, 3.2, 'wall'], [1, 7, 15, 0.6, 3.2, 'wall'], [22, 7, 21, 0.6, 3.2, 'wall'],
  // Mid window wall at x = 2: solid runs, a low window sill (shoot over, can't cross),
  // and a 3.5 m double-door gap at z = -0.5..3.
  [2, -4.75, 0.6, 4.5, 3.2, 'wall'], [2, -1.5, 0.6, 2, 1.05, 'metal'], [2, 5, 0.6, 4, 3.2, 'wall'],
  // Site pads (paint) — A "Foundry" north-east, B "Depot" south-east.
  [23, -17, 14, 14, 0.04, 'sitePad'], [23, 17, 14, 14, 0.04, 'sitePad'],
  // Spawn pads (paint) — Breachers west, Wardens east.
  [-28, 0, 9, 11, 0.04, 'spawnAtk'], [28, 0, 9, 11, 0.04, 'spawnDef'],
  // Painted lane stripes down the three lanes (paint).
  [-24, 0, 3, 0.35, 0.03, 'stripe'], [-5, 0, 3, 0.35, 0.03, 'stripe'],
  [16, 0, 3, 0.35, 0.03, 'stripe'], [25, 0, 3, 0.35, 0.03, 'stripe'],
  [-24, -14, 3, 0.35, 0.03, 'stripe'], [16, 14, 3, 0.35, 0.03, 'stripe'],
  // Mid cover: crate pairs watching each spawn approach and the door wall.
  [-20, -3, 2, 2, 1.2, 'crate'], [-20, 3, 2, 2, 1.2, 'crate'],
  [20, -3, 2, 2, 1.2, 'crate'], [20, 3, 2, 2, 1.2, 'crate'],
  [14, -2, 2, 2, 1.2, 'crate'], [14, 2, 2, 2, 1.2, 'crate'],
  [-4, 4, 1.8, 1.8, 1.1, 'crate'], [8, -4, 1.8, 1.8, 1.1, 'crate'],
  [-5.5, -3.5, 1.6, 1.6, 1.1, 'crate'], [-5.5, 3.5, 1.6, 1.6, 1.1, 'crate'],
  // Connector-mouth cover just inside the north and south lanes.
  [-8, -11, 1.6, 1.6, 1.1, 'crate'], [10, -11, 1.6, 1.6, 1.1, 'crate'],
  [-8, 11, 1.6, 1.6, 1.1, 'crate'], [10, 11, 1.6, 1.6, 1.1, 'crate'],
  // North lane + north-west yard: crates, a low crouch crate, silo and container.
  [-18, -17, 2, 2, 1.2, 'crate'], [-11, -17, 2, 2, 1.1, 'crate'],
  [-2, -15.5, 2, 1.4, 0.55, 'crate'], [-22, -22, 3.5, 3.5, 5.5, 'silo'],
  [-25, -19, 6, 2, 2.6, 'metal'],
  // South lane + south-west yard, mirrored.
  [-18, 17, 2, 2, 1.2, 'crate'], [-11, 17, 2, 2, 1.1, 'crate'],
  [-2, 15.5, 2, 1.4, 0.55, 'crate'], [-22, 22, 3.5, 3.5, 5.5, 'silo'],
  [-25, 19, 6, 2, 2.6, 'metal'],
  // Site A cover: furnace silo, chimney, container wall on the west entry, crates.
  [19, -21, 3, 3, 5, 'silo'], [30, -22, 2.5, 2.5, 7, 'silo'],
  [17.5, -18, 1.8, 6, 2.6, 'metal'], [27, -13, 2, 2, 1.2, 'crate'],
  [20, -12.5, 1.6, 1.6, 0.9, 'crate'], [26, -20, 2.4, 2, 2.2, 'crate'],
  // Site B cover, mirrored: tank silo, container stack, crates.
  [19, 21, 3, 3, 5, 'silo'], [30, 22, 2.5, 5, 2.6, 'metal'],
  [17.5, 18, 1.8, 6, 2.6, 'metal'], [27, 13, 2, 2, 1.2, 'crate'],
  [20, 12.5, 1.6, 1.6, 0.9, 'crate'], [26, 20, 2.4, 2, 2.2, 'crate'],
];

const FLAT = new Set(['sitePad', 'spawnAtk', 'spawnDef', 'stripe']);
const BOUNDS = { minX: -33, maxX: 33, minZ: -33, maxZ: 33 };

function std(hex, roughness, metalness, extra) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex), roughness, metalness, ...extra,
  });
}

// One material per kind, shared by every box of that kind.
function makeMaterials() {
  return {
    wall: std(CONCRETE, 0.95, 0.02),
    crate: std(WOOD, 0.85, 0),
    silo: std(STEEL, 0.42, 0.65),
    metal: std(HAIRLINE, 0.55, 0.5),
    sitePad: std(SURFACE, 0.9, 0, { emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.1 }),
    spawnAtk: std(SURFACE, 0.9, 0, { emissive: new THREE.Color(ATK), emissiveIntensity: 0.14 }),
    spawnDef: std(SURFACE, 0.9, 0, { emissive: new THREE.Color(DEF), emissiveIntensity: 0.3 }),
    stripe: std(MUTED, 0.9, 0, { emissive: new THREE.Color(MUTED), emissiveIntensity: 0.15 }),
  };
}

// Geometries are cached by shape so repeated crates/silos share one buffer each.
function makeGeometryCache() {
  const cache = new Map();
  return (w, d, h, kind) => {
    const key = `${kind}|${w}|${d}|${h}`;
    let geo = cache.get(key);
    if (!geo) {
      geo = kind === 'silo'
        ? new THREE.CylinderGeometry(w / 2, w / 2, h, 20)
        : new THREE.BoxGeometry(w, h, d);
      cache.set(key, geo);
    }
    return geo;
  };
}

// Painted ring + holo pillar + floating shard marking a bomb site or spawn centre.
function addMarker(group, x, z, hex, radius) {
  const color = new THREE.Color(hex);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.45, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.07, z);
  group.add(ring);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 5.5, 10),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  pillar.position.set(x, 2.75, z);
  group.add(pillar);
  const shard = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5),
    new THREE.MeshBasicMaterial({ color, wireframe: true }),
  );
  shard.position.set(x, 3.6, z);
  group.add(shard);
}

// Distant yard silhouettes outside the walls — flat dark blocks, no colliders.
// A tiny LCG keeps the skyline identical on every load.
function addSkyline(group) {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(CANVAS).offsetHSL(0, 0, 0.03) });
  for (let i = 0; i < 28; i += 1) {
    const side = i % 4;
    const along = -58 + rand() * 116;
    const out = 44 + rand() * 16;
    const w = 8 + rand() * 10;
    const h = 8 + rand() * 20;
    const geo = new THREE.BoxGeometry(w, h, w);
    const block = new THREE.Mesh(geo, mat);
    if (side === 0) block.position.set(along, h / 2 - 0.1, -out);
    else if (side === 1) block.position.set(along, h / 2 - 0.1, out);
    else if (side === 2) block.position.set(-out, h / 2 - 0.1, along);
    else block.position.set(out, h / 2 - 0.1, along);
    group.add(block);
  }
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(SKY).multiplyScalar(0.55);
  scene.fog = new THREE.Fog(new THREE.Color(CANVAS), 55, 135);

  const materials = makeMaterials();
  const geometry = makeGeometryCache();
  const colliders = [];
  const shootMeshes = [];

  // Ground slab (bullets hit it, feet don't collide with it) + outer apron.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(68, 0.2, 68), std(GROUND, 1, 0));
  ground.position.set(0, -0.1, 0);
  ground.receiveShadow = true;
  group.add(ground);
  shootMeshes.push(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), std(CANVAS, 1, 0));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.06;
  group.add(apron);

  // The BOXES table: one mesh per row; solid rows also push their exact AABB.
  for (const [x, z, w, d, h, kind] of BOXES) {
    const mesh = new THREE.Mesh(geometry(w, d, h, kind), materials[kind]);
    mesh.position.set(x, h / 2, z);
    mesh.receiveShadow = true;
    if (!FLAT.has(kind)) {
      mesh.castShadow = h >= 1;
      colliders.push({
        min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
        max: new THREE.Vector3(x + w / 2, h, z + d / 2),
      });
      shootMeshes.push(mesh);
    }
    group.add(mesh);
  }

  // Site + spawn markers: rings and holo pillars in accent / team colours.
  addMarker(group, 23, -17, ACCENT, 3.1);
  addMarker(group, 23, 17, ACCENT, 3.1);
  addMarker(group, -28, 0, ATK, 1.7);
  addMarker(group, 28, 0, DEF, 1.7);
  addSkyline(group);

  // Lighting: dusk hemisphere wash, one warm shadow-casting sun, two site glows.
  scene.add(new THREE.HemisphereLight(new THREE.Color(SKY), new THREE.Color(GROUND), 0.85));
  const sun = new THREE.DirectionalLight(new THREE.Color(SUN), 2.4);
  sun.position.set(-30, 36, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const glowA = new THREE.PointLight(new THREE.Color(ACCENT), 90, 30, 2);
  glowA.position.set(23, 4.2, -17);
  scene.add(glowA);
  const glowB = new THREE.PointLight(new THREE.Color(SUN), 90, 30, 2);
  glowB.position.set(23, 4.2, 17);
  scene.add(glowB);

  const sites = {
    A: {
      zone: { minX: 16, maxX: 30, minZ: -24, maxZ: -10 },
      point: new THREE.Vector3(23, 0, -17),
      label: 'A — Foundry',
    },
    B: {
      zone: { minX: 16, maxX: 30, minZ: 10, maxZ: 24 },
      point: new THREE.Vector3(23, 0, 17),
      label: 'B — Depot',
    },
  };
  const spawns = {
    atk: [-4, -2, 0, 2, 4].map((z, i) => new THREE.Vector3(i % 2 ? -29 : -28, 0, z)),
    def: [-4, -2, 0, 2, 4].map((z, i) => new THREE.Vector3(i % 2 ? 29 : 28, 0, z)),
  };

  return { group, colliders, shootMeshes, sites, spawns, bounds: BOUNDS };
}
