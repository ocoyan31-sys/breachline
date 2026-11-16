// HUD: all DOM readouts — vitals, ammo, timer, score, alive dots, killfeed,
// banners, charge progress, buy menu, menu/end overlays. Reads only G + bus;
// main.js calls frame() per render frame; frame() writes only changed values.
// Player spread arrives as G.player.spreadNow (degrees, maintained by main.js).
import { G, bus } from './state.js';
import * as CFG from './config.js';
import { currentSlot, currentDef } from './weapon.js';

const WEAPONS = CFG.WEAPONS || {};
const TIMINGS = CFG.TIMINGS || {};
const PLANT_TIME = TIMINGS.plant ?? 3.2;
const DEFUSE_KIT = TIMINGS.defuseKit ?? 5;
const DEFUSE_SLOW = TIMINGS.defuse ?? 10;
const PHASE_LABEL = { menu: 'MENU', buy: 'BUY PHASE', live: '', planted: 'CHARGE PLANTED', roundEnd: 'ROUND OVER', matchEnd: 'MATCH OVER' };
const REASON_TEXT = { elimination: 'squad eliminated', detonation: 'charge detonated', defuse: 'charge defused', time: 'time expired' };
const GRENADE_MAX = { flash: 2, smoke: 1, frag: 1 };

// Buy catalogue: config's own list if present, else weapon table + contract gear prices.
function buildCatalogue() {
  if (Array.isArray(CFG.BUY_ITEMS)) return CFG.BUY_ITEMS;
  if (CFG.ITEMS) return Object.entries(CFG.ITEMS).map(([id, v], i) => ({ id, name: v.name || id, price: v.price ?? 0, key: v.key || String((i + 1) % 10), kind: v.kind }));
  const g = CFG.GEAR || {};
  const items = ['smg', 'shotgun', 'rifle', 'heavy', 'sniper'].filter((id) => WEAPONS[id])
    .map((id, i) => ({ id, name: WEAPONS[id].name, price: WEAPONS[id].price, key: String(i + 1), kind: 'weapon' }));
  for (const [id, name, price, key, kind] of [
    ['vest', 'Kevlar Vest', 650, '6', 'gear'], ['vestHelmet', 'Vest + Helmet', 1000, '7', 'gear'],
    ['kit', 'Defuse Kit', 200, '8', 'gear'], ['flash', 'Flash Grenade', 200, '9', 'grenade'],
    ['smoke', 'Smoke Grenade', 300, '0', 'grenade'], ['frag', 'Frag Grenade', 300, '-', 'grenade'],
  ]) items.push({ id, name, price: g[id] ?? price, key, kind });
  return items;
}
const CATALOGUE = buildCatalogue();
const $ = (id) => document.getElementById(id);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, '');

export function createHud() {
  const el = {};
  for (const id of ['timer', 'round-label', 'score-atk', 'score-def', 'pips-atk', 'pips-def', 'alive-atk', 'alive-def',
    'charge-banner', 'charge-label', 'charge-time', 'banner', 'banner-title', 'banner-sub', 'killfeed', 'crosshair',
    'hitmarker', 'health-fill', 'health-value', 'armor-row', 'armor-fill', 'armor-value', 'money-value', 'ammo',
    'weapon-name', 'ammo-mag', 'ammo-reserve', 'items-line', 'progress', 'progress-label', 'progress-fill', 'hint',
    'down-note', 'buymenu', 'buy-money', 'buy-grid', 'menu-overlay', 'play-btn', 'end-overlay', 'end-title',
    'end-score', 'end-detail', 'flash-overlay', 'damage-vignette', 'scope-overlay']) el[id] = $(id);

  const pips = { atk: [], def: [] }; const dots = { atk: [], def: [] };
  for (let i = 0; i < 9; i += 1) {
    pips.atk.push(el['pips-atk'].appendChild(document.createElement('i')));
    pips.def.push(el['pips-def'].appendChild(document.createElement('i')));
    if (i < 5) { dots.atk.push(el['alive-atk'].appendChild(document.createElement('i'))); dots.def.push(el['alive-def'].appendChild(document.createElement('i'))); }
  }

  const last = Object.create(null); // last-written value per readout key
  const setText = (n, k, v) => { if (last[k] !== v) { last[k] = v; n.textContent = v; } };
  const setShown = (n, k, v) => { if (last[k] !== v) { last[k] = v; n.hidden = !v; } };
  const setClass = (n, k, c, v) => { if (last[k] !== v) { last[k] = v; n.classList.toggle(c, v); } };
  // Pool of dots/pips: first `count` get class `cls` (or lose it, when invert).
  const setPool = (pool, pre, count, cls, invert) => {
    for (let i = 0; i < pool.length; i += 1) {
      const on = invert ? i >= count : i < count;
      if (last[pre + i] !== on) { last[pre + i] = on; pool[i].classList.toggle(cls, on); }
    }
  };

  let buyOpenFlag = false; let buyCb = null; let playCb = null;
  let hitUntil = 0; let hurtUntil = 0; let bannerUntil = 0;
  const bannerQueue = [];
  const scoreLine = () => `BREACHERS ${G.score.atk} — ${G.score.def} WARDENS`;
  const isPlayer = (a) => !!a && (a === G.player || a.isPlayer === true);
  const flashHit = (ms, kill) => { hitUntil = performance.now() + ms; setClass(el.hitmarker, 'hk', 'kill', kill); el.hitmarker.classList.add('on'); last.hitOn = true; };

  bus.on('hit', (d) => {
    if (!d) return;
    if (isPlayer(d.attacker || d.by)) flashHit(130, !!d.killed);
    if (isPlayer(d.victim || d.target)) hurtUntil = performance.now() + 380;
  });
  bus.on('kill', (d) => {
    if (!d) return;
    const killer = d.attacker || d.killer || d.by; const victim = d.victim || d.target;
    if (victim) {
      const wid = d.weaponId || d.weapon || '';
      const entry = document.createElement('div');
      entry.className = 'kill-entry';
      entry.innerHTML = `<span class="${killer && killer.team === 'def' ? 'def' : 'atk'}">${esc(typeof killer === 'string' ? killer : (killer && killer.name) || '?')}</span>`
        + `<span class="wpn">${esc((WEAPONS[wid] && WEAPONS[wid].name) || wid || '✕')}</span>`
        + `<span class="${victim.team === 'def' ? 'def' : 'atk'}">${esc(typeof victim === 'string' ? victim : victim.name || '?')}</span>`
        + ((d.headshot || d.part === 'head') ? '<span class="hs">HEADSHOT</span>' : '');
      entry.dataset.expire = String(performance.now() + 5000);
      el.killfeed.prepend(entry);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    }
    if (isPlayer(killer)) flashHit(220, true);
  });
  bus.on('roundEnd', (d) => {
    const winner = (d && d.winner) || G.winner; const won = !!G.player && winner === G.player.team;
    bannerQueue.push({ title: winner === 'draw' ? 'ROUND DRAWN' : won ? 'ROUND WON' : 'ROUND LOST', sub: `${REASON_TEXT[(d && d.reason) || G.winReason] || ''} · ${scoreLine()}`, won });
  });
  bus.on('half', () => bannerQueue.push({ title: 'HALFTIME', sub: `Sides swap — credits and loadouts reset · ${scoreLine()}`, won: false }));
  bus.on('matchEnd', (d) => {
    const winner = (d && d.winner) || G.winner; const won = !!G.player && winner === G.player.team;
    const text = winner === 'draw' ? 'MATCH DRAWN' : won ? 'MATCH WON' : 'MATCH LOST';
    bannerQueue.push({ title: text, sub: scoreLine(), won });
    showEnd(text);
  });

  // ---- buy menu ----
  const grenadeCount = (p, id) => (p.loadout && p.loadout.grenades ? p.loadout.grenades[id] ?? 0 : 0);
  function ownsItem(p, item) {
    const lo = p.loadout;
    if (item.kind === 'weapon') {
      if (!lo || !lo.slots) return false;
      return (lo.slots.primary && lo.slots.primary.id === item.id)
        || (lo.slots.secondary && lo.slots.secondary.id === item.id);
    }
    if (item.id === 'vest') return (p.armor || 0) > 0;
    if (item.id === 'vestHelmet') return !!p.helmet;
    if (item.id === 'kit') return !!p.hasKit;
    if (item.kind === 'grenade') return grenadeCount(p, item.id) >= (GRENADE_MAX[item.id] || 1);
    return false;
  }
  function renderBuy() {
    const p = G.player; if (!p) return;
    setText(el['buy-money'], 'buyMoney', `$${(p.money || 0).toLocaleString('en-US')}`);
    el['buy-grid'].textContent = '';
    for (const item of CATALOGUE) {
      const owned = ownsItem(p, item);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.dataset.item = item.id;
      btn.className = 'buy-item' + (owned ? ' owned' : '');
      btn.innerHTML = `<span class="key">${esc(item.key || '')}</span><span class="name">${esc(item.name)}</span>`
        + `<span class="price">${owned ? 'OWNED' : '$' + item.price.toLocaleString('en-US')}</span>`;
      btn.disabled = owned || (p.money || 0) < item.price || (item.id === 'kit' && p.team !== 'def');
      if (!btn.disabled) btn.addEventListener('click', () => { if (buyCb) buyCb(item.id); });
      el['buy-grid'].append(btn);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (!buyOpenFlag || !buyCb || G.phase !== 'buy') return;
    const item = CATALOGUE.find((it) => it.key === e.key);
    if (item) buyCb(item.id);
  });

  function showEnd(winnerText) {
    el['end-title'].textContent = winnerText;
    el['end-score'].innerHTML = `<span class="atk">${G.score.atk}</span> — <span class="def">${G.score.def}</span>`;
    el['end-detail'].textContent = winnerText === 'MATCH DRAWN' ? 'Dead level on Kestrel Yard.' : `${winnerText} — final score on Kestrel Yard.`;
    el['end-overlay'].hidden = false;
  }

  function readAmmo(p) {
    const lo = p.loadout; if (!lo || !lo.slots) return null;
    const slot = currentSlot(lo); const def = currentDef(lo);
    if (!slot || !def) return null;
    return { name: def.name || slot.id, mag: def.melee ? null : slot.mag, reserve: def.melee ? null : slot.reserve, melee: !!def.melee, reloading: (lo.reloading || 0) > 0 };
  }

  function frame() {
    const now = performance.now(); const p = G.player; const planted = G.phase === 'planted';
    setText(el.timer, 'timer', fmtClock(planted && G.charge.timer ? G.charge.timer : G.phaseTime));
    setClass(el.timer, 'tLow', 'low', !planted && G.phase === 'live' && G.phaseTime <= 10);
    setClass(el.timer, 'tPl', 'planted', planted);
    setText(el['round-label'], 'rl', `ROUND ${G.round} OF 16${PHASE_LABEL[G.phase] ? ` · ${PHASE_LABEL[G.phase]}` : ''}`);
    setText(el['score-atk'], 'sa', String(G.score.atk));
    setText(el['score-def'], 'sd', String(G.score.def));
    setPool(pips.atk, 'pa', G.score.atk, 'won', false);
    setPool(pips.def, 'pd', G.score.def, 'won', false);
    let aliveAtk = 0; let aliveDef = 0;
    for (const a of G.actors) if (a.alive) { if (a.team === 'atk') aliveAtk += 1; else if (a.team === 'def') aliveDef += 1; }
    setPool(dots.atk, 'da', aliveAtk, 'dead', true);
    setPool(dots.def, 'dd', aliveDef, 'dead', true);

    if (p) {
      const hp = Math.max(0, Math.ceil(p.health || 0));
      setText(el['health-value'], 'hp', String(hp));
      if (last.hpW !== hp) { last.hpW = hp; el['health-fill'].style.width = `${hp}%`; }
      setClass(el['health-fill'], 'hpLow', 'low', hp <= 30 && hp > 0);
      const armor = Math.max(0, Math.round(p.armor || 0));
      setText(el['armor-value'], 'ar', String(armor));
      if (last.arW !== armor) { last.arW = armor; el['armor-fill'].style.width = `${armor}%`; }
      setClass(el['armor-row'], 'helm', 'helmet', !!p.helmet);
      setText(el['money-value'], 'money', (p.money || 0).toLocaleString('en-US'));

      const ammo = readAmmo(p);
      if (ammo) {
        setText(el['weapon-name'], 'wn', ammo.name);
        setText(el['ammo-mag'], 'mag', ammo.melee || ammo.mag == null ? '—' : String(ammo.mag));
        setText(el['ammo-reserve'], 'res', ammo.melee || ammo.reserve == null ? '' : `/ ${ammo.reserve}`);
        setClass(el.ammo, 'aE', 'empty', !ammo.melee && ammo.mag === 0);
        setClass(el.ammo, 'aR', 'reloading', ammo.reloading);
        const items = [];
        for (const gid of ['flash', 'smoke', 'frag']) { const n = grenadeCount(p, gid); if (n > 0) items.push(`${gid.toUpperCase()} ×${n}`); }
        if (p.hasKit) items.push('KIT');
        if (p.carrier) items.push('◆ CHARGE');
        setText(el['items-line'], 'items', items.join('  ·  '));
      }

      const scoped = !!p.scoped;
      setShown(el['scope-overlay'], 'scope', scoped);
      const inGame = p.alive && !scoped && G.phase !== 'menu' && G.phase !== 'matchEnd';
      setShown(el.crosshair, 'cross', inGame);
      if (inGame) {
        const gap = Math.round(4 + Math.min(6, Math.max(0, p.spreadNow || 0)) * 4.5);
        if (last.gap !== gap) { last.gap = gap; el.crosshair.style.setProperty('--gap', `${gap}px`); }
      }
      setShown(el['down-note'], 'down', !p.alive && (G.phase === 'live' || planted));
      const flashO = Math.round(clamp01(p.blinded || 0) * 50) / 50;
      if (last.flashO !== flashO) { last.flashO = flashO; el['flash-overlay'].style.opacity = String(flashO); }
      const vig = Math.round(Math.max((now < hurtUntil ? (hurtUntil - now) / 380 : 0) * 0.9, p.alive && hp <= 30 ? 0.35 : 0) * 50) / 50;
      if (last.vig !== vig) { last.vig = vig; el['damage-vignette'].style.opacity = String(vig); }
    }

    const hitOn = now < hitUntil;
    if (last.hitOn !== hitOn) { last.hitOn = hitOn; el.hitmarker.classList.toggle('on', hitOn); }
    const feed = el.killfeed;
    for (let i = feed.children.length - 1; i >= 0; i -= 1) {
      const left = Number(feed.children[i].dataset.expire) - now;
      if (left <= 0) feed.children[i].remove(); else if (left < 500) feed.children[i].classList.add('fading');
    }

    const charge = G.charge;
    setShown(el['charge-banner'], 'cb', charge.state === 'planted');
    if (charge.state === 'planted') {
      setText(el['charge-label'], 'cl', `CHARGE PLANTED — SITE ${charge.site || ''}`);
      setText(el['charge-time'], 'ct', fmtClock(charge.timer));
    }
    const planting = charge.plantProgress > 0.001 && charge.state !== 'planted';
    const defusing = charge.defuseProgress > 0.001;
    setShown(el.progress, 'prog', planting || defusing);
    if (planting || defusing) {
      const isDef = defusing && !planting;
      setClass(el.progress, 'pDef', 'defusing', isDef);
      setText(el['progress-label'], 'pl', isDef ? 'DEFUSING THE CHARGE' : 'PLANTING THE CHARGE');
      const denom = isDef ? ((charge.defuser && charge.defuser.hasKit) ? DEFUSE_KIT : DEFUSE_SLOW) : PLANT_TIME;
      const pct = Math.round(clamp01((isDef ? charge.defuseProgress : charge.plantProgress) / denom) * 100);
      if (last.pct !== pct) { last.pct = pct; el['progress-fill'].style.width = `${pct}%`; }
    }

    let hint = '';
    if (G.phase === 'buy' && !buyOpenFlag) hint = 'B — BUY MENU';
    else if (G.phase === 'live' && p && p.carrier && p.alive) hint = 'YOU HAVE THE CHARGE — HOLD E AT SITE A OR B';
    setText(el.hint, 'hint', hint);

    if (last.bannerOn && now > bannerUntil) { last.bannerOn = false; el.banner.classList.remove('on'); }
    if (!last.bannerOn && bannerQueue.length > 0) {
      const b = bannerQueue.shift();
      el['banner-title'].textContent = b.title; el['banner-sub'].textContent = b.sub;
      el.banner.classList.toggle('won', b.won); el.banner.classList.add('on');
      last.bannerOn = true; bannerUntil = now + 2600;
    }

    if (buyOpenFlag && p) { // re-render grid only when a purchase could have changed it
      const lo = p.loadout || {};
      const sig = [p.money, p.armor, p.helmet ? 1 : 0, p.hasKit ? 1 : 0,
        lo.grenades ? (lo.grenades.flash || 0) + (lo.grenades.smoke || 0) * 3 + (lo.grenades.frag || 0) * 5 : 0,
        lo.slots ? `${lo.slots.primary ? lo.slots.primary.id : ''}/${lo.slots.secondary ? lo.slots.secondary.id : ''}` : ''].join('|');
      if (last.buySig !== sig) { last.buySig = sig; renderBuy(); }
    }
  }

  return {
    frame, showEnd,
    showMenu() { el['menu-overlay'].hidden = false; },
    hideMenu() { el['menu-overlay'].hidden = true; },
    onPlay(fn) {
      playCb = fn;
      el['play-btn'].onclick = () => { if (playCb) playCb(); };
      $('play-again-btn').onclick = () => { el['end-overlay'].hidden = true; if (playCb) playCb(); };
    },
    onBuy(fn) { buyCb = fn; },
    setBuyOpen(open) { buyOpenFlag = !!open; el.buymenu.hidden = !buyOpenFlag; if (buyOpenFlag) { last.buySig = null; renderBuy(); } },
    get buyOpen() { return buyOpenFlag; },
  };
}
