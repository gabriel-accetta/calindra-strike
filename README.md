# Calindra Strike

> Tiro tático com alma de CS 1.6, direto no navegador. Salte do céu, pouse onde quiser e dispute o pódio.

An original browser FPS with Counter-Strike 1.6 style gameplay, made for the Calindra office:

- **Arena match**: 5 minute rounds with a live leaderboard at the top and a 3D **top-3 podium** at the end, alongside a scrollable full ranking with kills, deaths and headshots for every player from both teams. The rotation cycles through every enabled map + mode pair (`Forja`, `Escritório` × TDM, free-for-all by default), never repeating the same map or mode back to back. Pick which ones are in play with `GAME_MAPS` and `GAME_MODES`.
- **Team Deathmatch**: **Bulldogs** (lime) vs **Martelos** (blue), no friendly fire, first team to 50 kills (or most kills at the end of the timer) wins. Teams are shuffled and balanced every match, late joiners go to the smaller side, CS-style auto-balance on respawn, and you can switch to the smaller team from the Esc menu. Each side skydives over its own half; the podium shows the winning team's best three.
- **Bots** (off by default, enable with `BOT_FILL`): server-side bots fill empty slots (up to `BOT_FILL`) whenever someone is online and leave as people join. They navigate an auto-generated walkable grid (stairs, crate jumps, dropping off roofs), react with human-like delay and aim error, burst-fire and scope the AWP, hunt players and go for airdrops, and respect teams in TDM.
- **Map vote**: during the podium everyone votes for the next match (3 map + mode options, keys 1-3 or click); most votes wins, no votes keeps the rotation.
- **Rejoin**: a dropped connection or page refresh gets your score back if you return within 90 s.
- **Air drop**: you skydive into the arena on every (re)spawn and steer to land anywhere (`Ctrl` dives faster). Supply crates parachute in with legendary weapons and full armour: usually the **Mjölnir AWP** (about 2 in 3 crates), otherwise the `Ragnarök` LMG.
- **Mjölnir = CS 1.6 AWP**: right click zooms to FOV 40 then 10 (like CS) with the 1.6 scope overlay and `zoom_sensitivity_ratio 1.2`; 115 damage (one body shot), 10-round mag; 1.6 accuracy table (stand still and scope: 0.001; crouched: perfect; walking 0.10; running 0.25; airborne 0.85; no-scope +0.08, no crosshair); the scope drops while you work the bolt and comes back on its own (right click during the bolt cancels it).
- **Hammer**: equip slot `3` to run at 280 units/s (12% faster than a pistol), with an upright forge hammer held by its grip and a forward swing.
- **CS feel**: GoldSrc movement (ground friction/accel, air strafing, crouch-jump, 1.2x bunny hop cap), spray patterns, first-shot accuracy, run-and-gun penalty, 4x headshots, armour penetration, silent walking with `Shift`, dynamic crosshair.
- **Netcode**: authoritative server at 60 Hz, client-side prediction with reconciliation, 100 ms entity interpolation, lag-compensated hitscan (rewind up to 250 ms), shared deterministic simulation and spread seeds.
- **Calindra × Eitri** look: `#131312` charcoal, `#A5FA00` lime, Inter + Fragment Mono, glass tiles. All art, models and sounds are generated at runtime (no copyrighted assets).

Inspired by the LAN-party approach of [cs16-web](https://github.com/Elkhan-Isayev/cs16-web) (one server container, open a link, type a nickname, play), rebuilt from scratch as an original game so it can be hosted publicly without shipping Valve's game files.

## Architecture

The static browser client connects over WebSocket to an authoritative Node.js game server.

| Path | Purpose |
| --- | --- |
| `client/` | Vite + Three.js rendering, prediction and interface |
| `server/` | WebSocket server, match lifecycle, bots and lag compensation |
| `shared/` | Deterministic movement, collision, weapons, maps and protocol |
| `tools/` | Development bots and performance tools |

## Development

```bash
npm install
npm run dev:server
npm run dev:client
npm test
npm run typecheck
```

The local client uses `ws://127.0.0.1:7350/ws`. Set `VITE_GAME_SERVER` at build time to use a different backend. Outside localhost, the default is `/ws` on the same origin as the frontend.

## Builds and hosting

```bash
npm run build:client
npm run build:server
```

Serve `client/dist` as static files and run `server/dist/server.mjs` with Node.js 22 or newer, or use the included Dockerfile and Compose template. Configure the server environment using `.env.example`; `ALLOWED_ORIGINS` must contain the exact frontend origins. Use TLS for public connections. Hosting configuration and credentials belong to the operator's environment.

`vercel.json` is a generic static hosting template with a same-origin Content Security Policy. When using a backend on a different origin, configure both `VITE_GAME_SERVER` and the CSP `connect-src` for that origin in your deployment configuration. This repository does not select a production backend or contain production administration instructions.

## Server settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `GAME_MODES` | `tdm,ffa` | Rotation and vote modes: `tdm`, `ffa`, or `all` |
| `GAME_MAPS` | all | Map IDs: `forja`, `escritorio` |
| `TDM_SCORE_LIMIT` | `50` | Team kill target; `0` uses the timer only |
| `MATCH_SECONDS` / `PODIUM_SECONDS` | `300` / `15` | Match and podium duration |
| `WARMUP_MIN_PLAYERS` | `2` | Players needed to start a match |
| `MAX_PLAYERS` | `24` | Human player limit |
| `BOT_FILL` | `0` | Optional server bot population target |
| `BOT_SKILL` | `50` | Bot skill, 0–100 |
| `JOIN_CODE` | empty | Optional access code |

## Security

The game validates client messages, limits traffic and commands, sanitizes names and chat, checks exact origins, and supports an optional access code. The container runs as non-root with a read-only filesystem, dropped capabilities and resource limits. The Compose template publishes the game port on loopback for use behind a reverse proxy.

## Controls

`WASD` move · `Space` jump · `Ctrl`/`C` crouch (dive while skydiving) · `Shift` walk silently · `1 2 3` / wheel / `Q` weapons · `R` reload · `Mouse 2` scope · `Tab` scoreboard · `Y` chat · `Esc` menu
