# Pumpkin Panic

A tiny, self-contained 3D Halloween arcade game built with Three.js.

## Objective

Collect 12 pieces of candy before the 60-second moon timer runs out. You have three hearts. Candy adds 1.5 seconds and quick pickups build a score multiplier. Dash through enemies to banish them for bonus points, or save the dash for an escape.

## Controls

- **WASD / arrow keys:** move
- **Space:** start, dash, restart
- **Esc / P:** pause or resume
- **M:** mute or unmute
- **Touch:** drag on the left side to move; use the Dash button on the right

## Systems

- Two telegraphed enemy behaviors: chasing/charging pumpkins and circling/diving bats
- Offensive dash with invulnerability, cooldown, trails, and enemy banishing
- Timed candy combos, time bonuses, score, three-heart health, and escalating spawns
- Title, play, pause, victory, game-over, and clean restart states
- Synthesized Web Audio effects and music with persistent mute
- Browser-local best score (no account or cross-device sync)
- Fixed-step simulation, pooled enemies/candy/particles, seeded generation, and automatic quality reduction

## Run

```bash
npm install
npm run dev
```

Production build and smoke check:

```bash
npm run build
node scripts/verify-game.mjs
```

All visuals and audio are generated locally from code; no external assets or services are required.

## Verification

The production build was exercised in Chromium through title, play, pause/resume, a real 12-candy victory, dash-banish combat, game-over, restart, mute, best-score persistence, and emulated touch movement. The final pass reported no console errors or failed asset requests. The busy test scene contained 9 active enemies and rendered 116 draw calls / 22,116 triangles. Browser automation used SwiftShader software rendering, so it verifies correctness rather than real-GPU frame rate.
