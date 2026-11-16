// Waypoint graph over Kestrel Yard: nodes come from world.js's NAV_NODES and are
// auto-connected when within 11 m with a clear body-height segment, then Dijkstra
// gives bots their routes. Self-contained — its own segment-vs-AABB test inline.
import * as THREE from 'three';
import { NAV_NODES } from './world.js';

const LINK_DIST = 11;      // max edge length, metres
const BODY_MIN = 0.8;      // a collider blocks a route only if it rises past this…
const BODY_MAX = 1.6;      // …and starts below this (a standing fighter's span)
const SHRINK = 0.03;       // graze tolerance so gap-edge nodes still link cleanly

// 2D slab test: does segment (x1,z1)->(x2,z2) cross the XZ rect? t clamped to [0,1].
function segmentHitsRect(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let ta = (minX - x1) / dx;
    let tb = (maxX - x1) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z1 < minZ || z1 > maxZ) return false;
  } else {
    let ta = (minZ - z1) / dz;
    let tb = (maxZ - z1) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// True when any body-blocking collider crosses the straight walk between a and b.
function segmentBlocked(colliders, a, b) {
  for (const c of colliders) {
    if (c.max.y <= BODY_MIN || c.min.y >= BODY_MAX) continue;
    if (segmentHitsRect(
      a.x, a.z, b.x, b.z,
      c.min.x + SHRINK, c.max.x - SHRINK, c.min.z + SHRINK, c.max.z - SHRINK,
    )) return true;
  }
  return false;
}

export function createNav(world) {
  const nodes = NAV_NODES.map((n) => ({
    pos: new THREE.Vector3(n.x, 0, n.z),
    tags: [n.tag],
  }));

  // Adjacency built once at boot: edges[i] = [{ to, dist }] both ways.
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dist = nodes[i].pos.distanceTo(nodes[j].pos);
      if (dist > LINK_DIST) continue;
      if (segmentBlocked(world.colliders, nodes[i].pos, nodes[j].pos)) continue;
      edges[i].push({ to: j, dist });
      edges[j].push({ to: i, dist });
    }
  }

  function nearest(pos) {
    let best = null;
    let bestSq = Infinity;
    for (const node of nodes) {
      const sq = node.pos.distanceToSquared(pos);
      if (sq < bestSq) { bestSq = sq; best = node; }
    }
    return best;
  }

  function nodeAt(tag) {
    for (const node of nodes) {
      if (node.tags.includes(tag)) return node.pos;
    }
    return null;
  }

  // Dijkstra from the node nearest `fromPos` to the node nearest `toPos`, then the
  // exact destination appended — bots steer node to node and finish on the target.
  function path(fromPos, toPos) {
    const start = nodes.indexOf(nearest(fromPos));
    const goal = nodes.indexOf(nearest(toPos));
    if (start === goal) return [toPos.clone()];

    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[start] = 0;
    for (let step = 0; step < nodes.length; step += 1) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nodes.length; i += 1) {
        if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      }
      if (u === -1 || u === goal) break;
      done[u] = true;
      for (const edge of edges[u]) {
        const next = dist[u] + edge.dist;
        if (next < dist[edge.to]) { dist[edge.to] = next; prev[edge.to] = u; }
      }
    }
    if (prev[goal] === -1 && goal !== start) return [toPos.clone()]; // unreachable: go direct

    const route = [];
    for (let at = goal; at !== -1; at = prev[at]) route.push(nodes[at].pos);
    route.reverse();
    if (route[route.length - 1].distanceToSquared(toPos) > 0.0001) route.push(toPos.clone());
    return route;
  }

  return { nodes, path, nearest, nodeAt };
}
