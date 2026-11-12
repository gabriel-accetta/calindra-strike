/**
 * Dev-only: how much of the 16.7 ms tick budget does the server use with bots?
 *   npx tsx tools/bench.ts [bots=15]
 */
import { WEAPON } from '@calindra-strike/shared';
import { Game } from '../server/src/game.ts';

const bots = Number(process.argv[2] ?? 15);
const t0 = performance.now();
const game = new Game({ maxPlayers: 24, matchMs: 300_000, podiumMs: 15_000, warmupMinPlayers: 2, modes: 'mixed', botFill: bots + 1, botSkill: 0.5 });
game.join('Gabi', 0, WEAPON.RIFLE, () => {});
const tJoin = performance.now();
const ticks = 60 * 60;
let worst = 0;
const t1 = performance.now();
for (let i = 0; i < ticks; i++) {
  const a = performance.now();
  game.update();
  worst = Math.max(worst, performance.now() - a);
}
const t2 = performance.now();
const kills = [...game.players.values()].reduce((n, p) => n + p.kills, 0);
console.log(
  `setup ${(tJoin - t0).toFixed(0)} ms | avg tick ${((t2 - t1) / ticks).toFixed(3)} ms | worst ${worst.toFixed(1)} ms (budget 16.7) | players ${game.players.size} | kills in 1 min: ${kills}`,
);
