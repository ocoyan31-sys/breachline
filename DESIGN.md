# Breachline — build contract

A round-based tactical FPS in three.js (Counter-Strike-STYLE, fully original).
Two squads of five: **Breachers** (attack, amber) vs **Wardens** (defend, teal).
Breachers win a round by eliminating the Wardens or detonating the **pulse charge**
at site **A "Foundry"** or **B "Depot"** on the map **Kestrel Yard**. Wardens win by
eliminating the Breachers, running the clock down, or defusing the charge.
First to 9 rounds wins the match; sides swap after round 8. Money buys weapons,
armour and grenades between rounds.

Everything is procedural: no external assets, no network. ES modules, no build step.
Fixed-step simulation at 60 Hz, rendering decoupled. One shared state object.
Total game source must stay under ~150 KB (the judge reads at most 163,840 bytes).

## Files and ownership

| file | owner | job |
|---|---|---|
| game/index.html | H | shell, all CSS, HUD DOM, import map (`"three"` → `./vendor/three/three.module.min.js`), one module script `./src/main.js` |
| game/src/config.js | P | every tuning constant: weapons, economy, timings, names |
| game/src/state.js | P | the one mutable state object `G` + tiny event bus |
| game/src/util.js | P | seeded RNG, clamp/lerp, segment-vs-AABB helpers |
| game/src/palette.js | W | the colour palette (dusk industrial yard) |
| game/src/world.js | W | Kestrel Yard: geometry, materials, lights, colliders, sites, spawns, `MAP` data |
| game/src/nav.js | W | waypoint graph over the map + Dijkstra paths |
| game/src/input.js | P | keyboard/mouse state + pointer lock |
| game/src/player.js | P | human body: accel movement, crouch, collision, recoil |
| game/src/weapon.js | P | per-actor loadout state: buy/switch/fire timing/reload/ammo (pure logic) |
| game/src/combat.js | P | hitscan resolution, damage/armour/falloff, tracers, impacts, grenades |
| game/src/viewmodel.js | P | first-person weapon meshes, bob, muzzle flash, reload dip |
| game/src/actors.js | B | fighter meshes (body + head hitboxes), health/armour, death |
| game/src/bots.js | B | bot perception, roles, path following, aiming and firing |
| game/src/audio.js | H | WebAudio synth SFX, distance-attenuated |
| game/src/rounds.js | H | match flow: buy/live/planted/end phases, economy, halftime |
| game/src/hud.js | H | DOM HUD: vitals, ammo, timer, killfeed, buy menu, banners |
| game/src/shots.js | M | `?shot=` staging for screenshots (same protocol as the starter) |
| game/src/main.js | M | boot, wiring, the fixed-step loop |

Factories everywhere (the starter's pattern): `createX(deps)` returns an object.
No module imports another group's module except through `config.js`, `state.js`,
`util.js` (imported by anyone) and the deps main.js passes in. No cycles.

## Shared state (`state.js`)

```js
export const G = {
  phase: 'menu',        // menu | buy | live | planted | roundEnd | matchEnd
  phaseTime: 0,         // seconds left in the phase (round timer when live)
  round: 1,
  score: { atk: 0, def: 0 },
  actors: [],           // every fighter, player included
  player: null,         // the human's actor
  charge: { state: 'carried', carrier: null, site: null, pos: null,
            timer: 0, plantProgress: 0, defuseProgress: 0, planter: null, defuser: null },
  winner: null,         // 'atk' | 'def' once a round/match ends
  winReason: '',        // 'elimination' | 'detonation' | 'defuse' | 'time'
  stats: { shots: 0, hits: 0 },
};
export const bus = { on(type, fn), emit(type, data) };  // kill, shot, hit, plant, ...
```

## Actors (`actors.js`)

`createActors(scene, world)` returns `{ list, spawn(team, index, isPlayer), resetForRound(sides) }`.
An actor is a plain object; its three.js group is `actor.group`:

```js
{ id, team, name, isPlayer, alive: true, health: 100, armor: 0, helmet: false,
  money: 800, hasKit: false, carrier: false,
  pos: THREE.Vector3 (feet), vel: THREE.Vector3, yaw: 0, pitch: 0,
  crouch: false, grounded: true, speedNow: 0, radius: 0.35, height: 1.8,
  loadout: null (weapon.js), brain: null (bots.js), group, headMesh, bodyMesh,
  lastHurtBy: null, deadTime: 0 }
```

Eye height: standing 1.62, crouched 1.12. Hitboxes: `headMesh` (box 0.24³ at head)
and `bodyMesh` (box 0.56 × 1.05 × 0.3 at torso), both `userData = { actor, part }`.
Body mesh parts are coloured by team (amber #e8862e / teal #2ea8a0) with a dark
vest and a visible weapon prop. Death: fall over (rotate group), sink after 4 s.

Names — Breachers: `Vex, Onyx, Rook, Sable, Flint`; Wardens: `Halo, Bastion, Warden-Prime→"Prime", Sigil, Vault`.
The player's actor is a Breacher in the first half, a Warden after the swap.

## Weapons (`config.js` WEAPONS, keyed by id)

| id | name | price | dmg | head× | rpm | mag | reserve | spread° | moveSpread° | range | auto |
|---|---|---|---|---|---|---|---|---|---|---|
| knife | Blade | 0 | 55 | 1 | 100 | — | — | — | — | 1.6 m melee | — |
| pistol | Wasp P9 | 0 | 26 | 4 | 320 | 12 | 48 | 0.7 | 2.2 | 18–55 | semi |
| smg | Ripper VK7 | 1400 | 19 | 4 | 750 | 30 | 90 | 1.1 | 3.0 | 12–40 | auto |
| shotgun | Scatter DB2 | 1100 | 11×8 | 4 | 70 | 6 | 24 | 4.5 | 5.0 | 4–14 | semi |
| rifle | Longbow AR4 | 2700 | 33 | 4 | 600 | 30 | 90 | 0.9 | 3.4 | 25–90 | auto |
| heavy | Mauler MK8 | 3100 | 36 | 4 | 520 | 25 | 75 | 1.0 | 3.6 | 25–95 | auto |
| sniper | Longshot S1 | 4750 | 97 | 4 | 42 | 5 | 25 | 0.05* | 6.0 | 40–140 | bolt, scoped |

Damage falloff: full to `range[0]`, linear down to 50 % at `range[1]`.
Armour halves health damage (helmet also halves head damage). Kill reward $300.
Grenades: flash $200, smoke $300, frag $300 (max 1 each, flash 2). Vest $650,
vest+helmet $1000, defuse kit $200 (Wardens only). Start money $800, cap $16,000.
Round income: elimination win $3,250; objective win $3,500; loss $1,400 + $500 per
consecutive loss (max +$1,500); planter +$300, defuser +$300.

Timings: buy 15 s, round 100 s, charge 40 s, plant 3.2 s, defuse 5 s (kit) /
10 s, round-end pause 5 s, first to 9, swap after round 8, max 16 rounds.

Spread model (combat): total = base + bloom (per-shot, decays 6/s) +
movePenalty × (speedNow / walkSpeed) + air 4°; crouch × 0.7. Recoil: pitch kick
per shot by weapon, view recovers. Sniper: unscoped spread 4°, scoped (RMB, FOV 32)
spread as table; scope sway when moving.

## World (`world.js`) — Kestrel Yard, 68 × 68 m, ground y=0

Attacker spawn west (x −28), defender spawn east (x +28). Sites NE (A) and SE (B).
Lanes: north lane (z −14), mid (z 0, with a window wall and double doors gap),
south lane (z +14); connectors at x −8 and x +10. Cover crates everywhere.
`createWorld(scene)` returns:

```js
{ group, colliders: [{ min: V3, max: V3 }],        // solid AABBs incl. walls
  shootMeshes: [Mesh],                              // raycast targets for bullets
  sites: { A: { zone: {minX,maxX,minZ,maxZ}, point: V3, label }, B: {...} },
  spawns: { atk: [V3 ×5], def: [V3 ×5] },
  bounds: { minX: -33, maxX: 33, minZ: -33, maxZ: 33 } }
```

The map is data first: a `BOXES` table of `[x, z, w, d, h, kind]` (kind picks the
material: wall, crate, silo, metal, site pad…) from which meshes and colliders are
both built, so what you see is exactly what collides. Perimeter walls h=4.
Site pads are painted rings + a holo marker; spawn pads are marked too.
Lighting: hemisphere + one warm directional with shadows (2048, tight frustum),
two site point lights; fog for depth; skyline silhouettes outside the walls.

## Nav (`nav.js`)

`createNav(world)` → `{ nodes: [{pos, tags}], path(from, to) -> [V3], nearest(pos), nodeAt(tag) }`.
Nodes are hand-placed in world.js's exported `NAV_NODES` (positions + tags like
`atkSpawn, aLane, mid, aSite, bSite, defSpawn…`) and auto-connected when within
11 m with a clear segment (no collider AABB blocks at body height). Dijkstra.

## Combat (`combat.js`)

`createCombat({ scene, world, actors, audio })` →
`{ shoot(actor, origin, dir), melee(actor), throwGrenade(actor, kind, origin, dir),
   step(dt), losClear(a, b), raycastWorld(origin, dir, maxDist) }`.
shoot(): applies spread outside (caller passes final dir) — no: shoot computes the
spread itself from the actor's weapon state + speedNow (single source of truth),
raycasts actors' hit meshes first then world, applies damage via actors.damage(),
spawns tracer + impact, emits bus events (`shot`, `hit`, `kill`), plays audio.
Damage falloff + armour as specced. Grenades are physical-lite projectiles:
gravity, one bounce, then flash (blind by LOS + facing, 0.5–2.5 s), smoke
(8 s sphere, blocks `losClear`), frag (radius 5.5 m, 90→10 dmg by distance + LOS).
`losClear` is segment-vs-colliders (never three.js raycast in hot paths).

## Player (`player.js`)

`createPlayer(world)` → `{ body, step(dt, input, frozen), look(dx, dy), recoil(p, y), eyePos() }`.
body = `{ pos, vel, yaw, pitch, crouch, grounded, eye, speedNow }` — main.js copies
it onto the player actor each step. WASD accel/friction (ground accel 42, air 6,
friction 9), walk 4.6 m/s, crouch 2.3, jump 4.4 m/s (small hop), AABB collision
resolved per axis against world colliders + bounds. Mouse sens 0.0022, pitch clamp.

## Bots (`bots.js`)

`createBrains(G, world, nav, combat)` → `{ attach(actor), step(dt), resetRound() }`.
Decision tick 8 Hz staggered per bot; steering every step.
Perception: enemy visible if dist < 62, inside 105° FOV, `combat.losClear(eye, eye)`,
not smoked; reaction delay 0.22–0.45 s by bot skill; aim error starts 3.2° and
shrinks to 0.7° over 0.9 s of tracking; bursts of 3–5 with 0.12–0.3 s pauses;
bots stop moving to fire (speed < 0.8 while bursting). Hearing: `shot` events
within 20 m set a memory point for 4 s.
Roles: at round start attackers pick a site (60 % all-in one site, else 3–2 split);
the carrier goes to plant when at the site and no enemy seen for 1.5 s; escorts
hold the site's entry nodes. Defenders split 2 A / 1 mid / 2 B on hold nodes,
rotate on plant or heavy fire; when the charge is planted, defenders converge:
nearest defuses (kit first), others cover. Retake/plant/defuse use the same
progress mechanics as the player (rounds.js owns the timers; bots call
`rounds.tryPlant(actor)` / `rounds.tryDefuse(actor)` intents via G.charge fields —
rounds.js resolves them; bots only set `actor.intent = 'plant'|'defuse'|null`).
Movement: follow nav path, separation from nearby actors, arrive → hold and scan
(slow yaw sweep), strafe briefly when shot at from the side. Bots buy in the buy
phase from a preference table by money (rifle > heavy > smg; armour first; kit
for two Wardens; grenades when rich).

## Rounds (`rounds.js`)

`createRounds(G, actors, world, deps)` → `{ start(), step(dt), buyFor(actor, itemId), playerIntent(kind) }`.
Owns the phase machine and the clock: menu → buy (15 s, actors frozen) → live
(100 s) → planted (40 s charge clock) → roundEnd (5 s) → buy…; halftime swap after
round 8 (teams' sides and the player's team flip, money resets to $800, score
swaps); matchEnd at 9 wins or after round 16. Win checks every step: elimination,
detonation, defuse, time. Awards money, emits bus events the HUD/audio consume
(`roundStart`, `roundEnd`, `planted`, `defused`, `half`, `matchEnd`, `buy`).
Planting: an attacker with `intent='plant'` inside a site zone, alive, speed < 1,
channel 3.2 s (damage or moving cancels) → charge planted at his feet, site set.
Defusing mirrors it. Explosion: at timer 0, atk win + radius damage + big audio/fx.

## HUD (`hud.js`) + index.html

DOM only, driven from G each frame by main.js calling `hud.frame()`.
Elements: top-centre timer + round pips + alive dots; bottom-left health/armour
bars + money; bottom-right ammo (mag/reserve) + weapon name; killfeed (top-right,
5 s fade); centre crosshair (gap follows current spread) + hitmarker; damage
vignette; charge banner when planted + plant/defuse progress bar; buy menu
(overlay grid: weapons 1–6, armour 7, kit 8, grenades 9/0/-, prices greyed when
unaffordable, money shown, click or key); round banner ("ROUND WON — charge
detonated", score); menu overlay (title, Play, controls, credits line);
match-end overlay (final score, Play again); "you are down" spectate note.
Flash blindness = white overlay div with opacity by remaining blind time.
Palette: dusk slate + amber accent; fonts: system stack + ui-monospace readouts.

## Audio (`audio.js`)

`createAudio()` → `{ unlock(), shot(kind, pos), dry(), reload(), hit(head), kill(), hurt(), step(run), plant(), beep(rate), defuse(), boom(), stinger(win), buy(), error(), flashRing(), ui() }`.
All WebAudio-synthesised; `pos` sounds attenuate by distance to the camera and
lowpass with distance. Created lazily on first user gesture; safe no-ops before.

## Shots (`shots.js`)

`stageShot(name, ctx)` for `?shot=combat|buy|plant|end&seed=N`: builds a match,
forces staged positions/phases/HUD values, settles fixed steps, renders twice,
sets `window.__shotReady = true` and freezes (starter protocol).
- combat: mid corridor, player aiming down mid at a crossing Warden, one Breacher
  beside him, tracer in flight, hitmarker lit, timer 1:23, ammo 24/90.
- buy: buy phase at Breacher spawn, menu open, $4,250, squad visible.
- plant: site A, charge planted (0:32 left), planter crouched by it, a Warden
  pushing the site entrance, planted banner up.
- end: round-end banner "ROUND WON", score 6–4, squad celebrating (standing) at B.

## Rules for every builder

- Write your files with the file-writing tool in this session (authorship counts).
- No `console.log` spam in hot loops; no allocations in `step()` hot paths
  (module-level temp vectors).
- Every file: header comment of 2–4 lines saying its one job. Clean, commented
  where it matters, no dead code — the judge reads this code and scores it.
- Stay inside your byte budget (contract table ±20 %). Plain ES2022, three r160+
  API only (no OrbitControls etc.). NEVER touch game/vendor/.
- Syntax-check every file before reporting:
  `node --experimental-vm-modules -e "const vm=require('vm');const fs=require('fs');new vm.SourceTextModule(fs.readFileSync(process.argv[1],'utf8'));console.log('OK')" <file>`
- Do not edit DESIGN.md, main.ts, or another group's files. Report: files written,
  byte sizes, and any contract gap you had to guess at.
