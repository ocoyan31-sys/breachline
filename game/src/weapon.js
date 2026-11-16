// Per-actor loadout state: slots, ammo, fire timing, reloads, grenades, armour, kit.
// Pure logic only — no three.js, no rendering. All numbers come from config.js.
// Money is NOT deducted here: buyItem validates and applies the purchase, returning
// { ok, cost, why } so rounds.js can debit actor.money (and emit the 'buy' event).

import { WEAPONS, GRENADES, ARMOUR, PRIMARY_IDS, BLOOM_MAX } from './config.js';

function freshSlot(id) {
  const def = WEAPONS[id];
  return { id, mag: def ? def.mag : 0, reserve: def ? def.reserve : 0 };
}

export function createLoadout() {
  return {
    slots: {
      primary: null,
      secondary: freshSlot('pistol'),
      knife: { id: 'knife', mag: 0, reserve: 0 },
    },
    current: 'secondary',   // 'primary' | 'secondary' | 'knife'
    grenades: { flash: 0, smoke: 0, frag: 0 },
    armor: 0,               // 0 = none, 100 = vest
    helmet: false,
    hasKit: false,
    nextFireAt: 0,          // seconds, on the caller's clock
    reloading: 0,           // seconds left, 0 = not reloading
    bloom: 0,               // degrees of accumulated spread; decayed by combat.step
    scoped: false,
  };
}

export function currentSlot(loadout) { return loadout.slots[loadout.current] || null; }
export function currentDef(loadout) {
  const s = currentSlot(loadout);
  return s ? WEAPONS[s.id] || null : null;
}
export function slotFor(id) {
  if (id === 'knife') return 'knife';
  if (id === 'pistol') return 'secondary';
  return PRIMARY_IDS.has(id) ? 'primary' : null;
}

// Give a weapon outright (staging, bot buys go through buyItem). Returns the slot.
export function giveWeapon(loadout, id) {
  const slot = slotFor(id);
  if (!slot) return null;
  loadout.slots[slot] = freshSlot(id);
  return loadout.slots[slot];
}

export function refill(loadout) {
  for (const key of ['primary', 'secondary']) {
    const s = loadout.slots[key];
    if (s && WEAPONS[s.id]) { s.mag = WEAPONS[s.id].mag; s.reserve = WEAPONS[s.id].reserve; }
  }
  loadout.reloading = 0;
}

const ITEM_ALIASES = {
  armor: 'vest', armour: 'vest', vest: 'vest',
  helmet: 'vestHelmet', vesthelmet: 'vestHelmet', 'vest+helmet': 'vestHelmet',
  kit: 'kit', defusekit: 'kit', defuse: 'kit',
};

// Buy one item. itemId: a weapon id, 'flash'|'smoke'|'frag', 'vest', 'vestHelmet',
// 'kit' (plus the aliases above). team is optional; the kit is Wardens-only when given.
export function buyItem(loadout, money, itemId, team) {
  const id = ITEM_ALIASES[String(itemId).toLowerCase()] || itemId;
  const fail = (why) => ({ ok: false, cost: 0, why });

  if (WEAPONS[id] && id !== 'knife') {
    const def = WEAPONS[id];
    const slot = slotFor(id);
    const owned = loadout.slots[slot];
    if (owned && owned.id === id) return fail('owned');
    if (money < def.price) return fail('funds');
    loadout.slots[slot] = freshSlot(id);
    if (loadout.current === slot) { loadout.reloading = 0; loadout.scoped = false; }
    return { ok: true, cost: def.price, why: '' };
  }
  if (GRENADES[id]) {
    const g = GRENADES[id];
    if (loadout.grenades[id] >= g.max) return fail('maxed');
    if (money < g.price) return fail('funds');
    loadout.grenades[id] += 1;
    return { ok: true, cost: g.price, why: '' };
  }
  if (id === 'vest') {
    if (loadout.armor >= 100) return fail('owned');
    if (money < ARMOUR.vest.price) return fail('funds');
    loadout.armor = 100;
    return { ok: true, cost: ARMOUR.vest.price, why: '' };
  }
  if (id === 'vestHelmet') {
    if (loadout.armor >= 100 && loadout.helmet) return fail('owned');
    const cost = loadout.armor >= 100 ? ARMOUR.helmetUpgrade.price : ARMOUR.vestHelmet.price;
    if (money < cost) return fail('funds');
    loadout.armor = 100; loadout.helmet = true;
    return { ok: true, cost, why: '' };
  }
  if (id === 'kit') {
    if (team && team !== 'def') return fail('team');
    if (loadout.hasKit) return fail('owned');
    if (money < ARMOUR.kit.price) return fail('funds');
    loadout.hasKit = true;
    return { ok: true, cost: ARMOUR.kit.price, why: '' };
  }
  return fail('unknown');
}

// Switch the held slot. Accepts 'primary'|'secondary'|'knife', 1|2|3, or a weapon id.
export function switchTo(loadout, slot) {
  let target = slot;
  if (slot === 1 || slot === '1') target = 'primary';
  else if (slot === 2 || slot === '2') target = 'secondary';
  else if (slot === 3 || slot === '3') target = 'knife';
  else if (WEAPONS[slot]) target = slotFor(slot);
  if (!target || !loadout.slots[target]) return false;
  if (loadout.current !== target) {
    loadout.current = target;
    loadout.reloading = 0;   // switching cancels a reload
    loadout.scoped = false;
  }
  return true;
}

// Attempt to fire the held weapon at time `now` (seconds). On success the round is
// spent, nextFireAt advances by the rpm interval and bloom grows. Melee always "fires".
export function tryFire(loadout, now) {
  const slot = currentSlot(loadout);
  if (!slot) return { ok: false, why: 'empty' };
  const def = WEAPONS[slot.id];
  if (!def) return { ok: false, why: 'empty' };
  if (loadout.reloading > 0) return { ok: false, why: 'reloading', id: slot.id };
  if (now < loadout.nextFireAt) return { ok: false, why: 'cooldown', id: slot.id };
  const interval = 60 / def.rpm;
  if (def.melee) {
    loadout.nextFireAt = now + interval;
    return { ok: true, id: slot.id, melee: true };
  }
  if (slot.mag <= 0) return { ok: false, why: 'empty', id: slot.id };
  slot.mag -= 1;
  loadout.nextFireAt = now + interval;
  loadout.bloom = Math.min(BLOOM_MAX, loadout.bloom + def.bloomAdd);
  if (slot.id === 'sniper') loadout.scoped = false; // bolt cycle drops the scope
  return { ok: true, id: slot.id, pellets: def.pellets, mag: slot.mag };
}

export function startReload(loadout) {
  const slot = currentSlot(loadout);
  if (!slot) return false;
  const def = WEAPONS[slot.id];
  if (!def || def.melee || loadout.reloading > 0) return false;
  if (slot.mag >= def.mag || slot.reserve <= 0) return false;
  loadout.reloading = def.reload;
  loadout.scoped = false;
  return true;
}

export function finishReload(loadout) {
  const slot = currentSlot(loadout);
  loadout.reloading = 0;
  if (!slot) return;
  const def = WEAPONS[slot.id];
  if (!def || def.melee) return;
  const take = Math.min(def.mag - slot.mag, slot.reserve);
  if (take > 0) { slot.mag += take; slot.reserve -= take; }
}

// Advance reload timing (bloom decay lives in combat.step, the spread authority).
// Returns true on the step where a reload completes.
export function tickLoadout(loadout, dt) {
  if (loadout.reloading > 0) {
    loadout.reloading -= dt;
    if (loadout.reloading <= 0) { finishReload(loadout); return true; }
  }
  return false;
}
export const updateLoadout = tickLoadout;

// Grenade bookkeeping: combat.js flies the projectile, this spends the inventory.
export function useGrenade(loadout, kind) {
  if (!GRENADES[kind]) return { ok: false, why: 'unknown' };
  if (loadout.grenades[kind] <= 0) return { ok: false, why: 'none' };
  loadout.grenades[kind] -= 1;
  return { ok: true, why: '' };
}
export const consumeGrenade = useGrenade;
