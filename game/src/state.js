// The one shared mutable state object G plus a tiny event bus. Every module reads G;
// only rounds.js drives the phase fields, actors.js owns the actor objects inside it,
// and combat.js owns stats. Nothing else is global — factories pass the rest by deps.
//
// Bus events (payloads):
//   shot       { actor, pos, weaponId }            a weapon discharged
//   hit        { attacker, victim, part, killed }  a bullet/melee/frag connected
//   kill       { attacker, victim, weaponId, headshot }
//   plant      { actor }                           plant channel started
//   planted    { actor, site }                     charge is live, 40 s on the clock
//   defused    { actor, site }
//   roundStart { round }   roundEnd { winner, reason }
//   half       { score }   matchEnd { winner, score }
//   buy        { actor, itemId, cost }

export const G = {
  phase: 'menu',        // menu | buy | live | planted | roundEnd | matchEnd
  phaseTime: 0,         // seconds left in the phase (round timer when live)
  round: 1,
  score: { atk: 0, def: 0 },
  actors: [],           // every fighter, player included
  player: null,         // the human's actor
  charge: {
    state: 'carried',   // carried | dropped | planted | detonated | defused
    carrier: null, site: null, pos: null, timer: 0,
    plantProgress: 0, defuseProgress: 0, planter: null, defuser: null,
  },
  winner: null,         // 'atk' | 'def' once a round/match ends
  winReason: '',        // 'elimination' | 'detonation' | 'defuse' | 'time'
  stats: { shots: 0, hits: 0 },
};

// Minimal pub/sub: Map of Sets. emit() iterates a copy so a listener may safely
// unsubscribe (or subscribe) while an event is being delivered.
const listeners = new Map();

export const bus = {
  on(type, fn) {
    let set = listeners.get(type);
    if (!set) { set = new Set(); listeners.set(type, set); }
    set.add(fn);
    return () => set.delete(fn);
  },
  off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  },
  emit(type, data) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) fn(data);
  },
  clear() { listeners.clear(); },
};
