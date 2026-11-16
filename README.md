# breachline

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/ocoyan31-sys/breachline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/ocoyan31-sys/breachline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**Breachline** is a round-based tactical FPS for the browser, built on three.js: two five-player squads, short rounds won by eliminating the other squad or by planting and defending a pulse charge, a buy economy between rounds, and gunplay where stopping to aim beats spraying on the move. You lead one squad against bot opponents; every teammate and enemy is a bot with waypoint navigation, human-like aim error and team roles. It runs entirely from static files — no build step, no network, no assets: geometry, models and sound are all procedural.

## Run it

```sh
node serve.ts          # serves game/ at http://localhost:8080
# then open http://localhost:8080 in desktop Chrome and click to play
```

Any static file server pointed at `game/` works just as well. `node main.ts` (with `MAKEFUN_OUTPUT_DIR` set) writes the entry's `/output` — the game, the screenshots and `dossier.json` — exactly as the grader runs it.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5h2hvham&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
