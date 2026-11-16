// Breachline tuning: every weapon, price, timing and movement constant in one place.
// All other modules read numbers from here — nothing gameplay-shaped is hard-coded elsewhere.
// Spread values are degrees; range is [fullDamageUntil, halfDamageAt] in metres.

export const WEAPONS = {
  knife: {
    name: 'Blade', price: 0, dmg: 55, headMult: 1, head: 1, rpm: 100,
    mag: 0, reserve: 0, spread: 0, moveSpread: 0, range: [1.6, 1.6],
    auto: false, mode: 'melee', melee: true, pellets: 1, reload: 0,
    recoilPitch: 0, recoilYaw: 0, bloomAdd: 0, zoom: 1, zoomFov: null,
  },
  pistol: {
    name: 'Wasp P9', price: 0, dmg: 26, headMult: 4, head: 4, rpm: 320,
    mag: 12, reserve: 48, spread: 0.7, moveSpread: 2.2, range: [18, 55],
    auto: false, mode: 'semi', melee: false, pellets: 1, reload: 1.2,
    recoilPitch: 0.009, recoilYaw: 0.002, bloomAdd: 0.55, zoom: 1, zoomFov: null,
  },
  smg: {
    name: 'Ripper VK7', price: 1400, dmg: 19, headMult: 4, head: 4, rpm: 750,
    mag: 30, reserve: 90, spread: 1.1, moveSpread: 3.0, range: [12, 40],
    auto: true, mode: 'auto', melee: false, pellets: 1, reload: 1.8,
    recoilPitch: 0.007, recoilYaw: 0.002, bloomAdd: 0.7, zoom: 1, zoomFov: null,
  },
  shotgun: {
    name: 'Scatter DB2', price: 1100, dmg: 11, headMult: 4, head: 4, rpm: 70,
    mag: 6, reserve: 24, spread: 4.5, moveSpread: 5.0, range: [4, 14],
    auto: false, mode: 'semi', melee: false, pellets: 8, reload: 2.6,
    recoilPitch: 0.05, recoilYaw: 0.004, bloomAdd: 2.0, zoom: 1, zoomFov: null,
  },
  rifle: {
    name: 'Longbow AR4', price: 2700, dmg: 33, headMult: 4, head: 4, rpm: 600,
    mag: 30, reserve: 90, spread: 0.9, moveSpread: 3.4, range: [25, 90],
    auto: true, mode: 'auto', melee: false, pellets: 1, reload: 2.0,
    recoilPitch: 0.011, recoilYaw: 0.003, bloomAdd: 0.85, zoom: 1, zoomFov: null,
  },
  heavy: {
    name: 'Mauler MK8', price: 3100, dmg: 36, headMult: 4, head: 4, rpm: 520,
    mag: 25, reserve: 75, spread: 1.0, moveSpread: 3.6, range: [25, 95],
    auto: true, mode: 'auto', melee: false, pellets: 1, reload: 2.2,
    recoilPitch: 0.013, recoilYaw: 0.003, bloomAdd: 0.8, zoom: 1, zoomFov: null,
  },
  sniper: {
    name: 'Longshot S1', price: 4750, dmg: 97, headMult: 4, head: 4, rpm: 42,
    mag: 5, reserve: 25, spread: 0.05, moveSpread: 6.0, range: [40, 140],
    auto: false, mode: 'bolt', melee: false, pellets: 1, reload: 2.8,
    recoilPitch: 0.09, recoilYaw: 0.006, bloomAdd: 3.0, zoom: 2.5, zoomFov: 32,
  },
};

// Buy-menu order for primaries (slot 1) — pistol is the permanent secondary, knife slot 3.
export const WEAPON_ORDER = ['smg', 'shotgun', 'rifle', 'heavy', 'sniper'];
export const PRIMARY_IDS = new Set(WEAPON_ORDER);

// Sniper hip-fire is deliberately wild; the table spread only applies while scoped.
export const SNIPER_UNSCOPED_SPREAD = 4.0;
export const AIR_SPREAD = 4.0;        // extra degrees whenever the shooter is airborne
export const CROUCH_SPREAD_MULT = 0.7;
export const BLOOM_DECAY = 6;         // degrees per second
export const BLOOM_MAX = 3.5;

export const GRENADES = {
  flash: { name: 'Flash', price: 200, max: 2 },
  smoke: { name: 'Smoke', price: 300, max: 1 },
  frag: { name: 'Frag', price: 300, max: 1 },
};
export const GRENADE_ORDER = ['flash', 'smoke', 'frag'];

// Grenade behaviour (combat.js): physical-lite projectiles, one bounce, then effect.
export const GRENADE_FX = {
  throwSpeed: 17,
  gravity: 18,
  fuse: { flash: 1.3, smoke: 1.1, frag: 1.5 },
  fragRadius: 5.5, fragDmgNear: 90, fragDmgFar: 10,
  smokeRadius: 3.2, smokeTime: 8,
  flashMaxDist: 25, flashMaxTime: 2.5, flashMinTime: 0.5,
};

// Damage model: amount = dmg x headMult (head only) x falloff, then armour halves it
// inside actors.damage (a helmet halves head damage again). Falloff is 1.0 out to
// range[0], then linear down to FALLOFF_FLOOR at range[1].
export const FALLOFF_FLOOR = 0.5;
export const ARMOUR_MULT = 0.5;

export const ARMOUR = {
  vest: { name: 'Vest', price: 650 },
  vestHelmet: { name: 'Vest + Helmet', price: 1000 },
  helmetUpgrade: { name: 'Helmet', price: 350 }, // vest already owned
  kit: { name: 'Defuse Kit', price: 200, team: 'def' },
};

export const ECONOMY = {
  start: 800,
  cap: 16000,
  killReward: 300,
  winElimination: 3250,
  winObjective: 3500,
  lossBase: 1400,
  lossStep: 500,        // extra per consecutive loss
  lossBonusMax: 1500,
  plantBonus: 300,
  defuseBonus: 300,
};

export const TIMINGS = {
  buy: 15,
  round: 100,
  charge: 40,
  plant: 3.2,
  defuseKit: 5,
  defuse: 10,
  roundEnd: 5,
  winsNeeded: 9,
  swapAfter: 8,
  maxRounds: 16,
};

export const TEAMS = {
  atk: {
    name: 'Breachers', color: 0xe8862e, css: '#e8862e',
    names: ['Vex', 'Onyx', 'Rook', 'Sable', 'Flint'],
  },
  def: {
    name: 'Wardens', color: 0x2ea8a0, css: '#2ea8a0',
    names: ['Halo', 'Bastion', 'Prime', 'Sigil', 'Vault'],
  },
};

export const MOVE = {
  walk: 4.6,
  crouch: 2.3,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.25,
  eye: 1.62,
  crouchEye: 1.12,
  groundAccel: 42,
  airAccel: 6,
  friction: 9,
  gravity: 16,
  jump: 4.4,
  sens: 0.0022,
  pitchMax: 1.45,
  recoilRecover: 7,     // 1/s damp rate for the recoil offset
};
