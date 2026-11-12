import { BTN, CollisionWorld, MapBuilder, WEAPON, getMaps } from '@calindra-strike/shared';
import { describe, expect, it } from 'vitest';
import { Game, type ServerPlayer } from '../src/game.ts';

function flatWorld(): CollisionWorld {
  const b = new MapBuilder();
  b.add(-4000, -32, -4000, 4000, 0, 4000, 'ground');
  return new CollisionWorld({ ...getMaps()[0], boxes: b.boxes });
}

function setup(n: number, opts: { tdmLimit?: number } = {}) {
  let r = 0.42;
  const game = new Game({
    maxPlayers: 16,
    matchMs: 120_000,
    podiumMs: 5_000,
    warmupMinPlayers: 2,
    modes: 'mixed',
    tdmLimit: opts.tdmLimit ?? 50,
    random: () => (r = ((r * 9301 + 49297) % 233280) / 233280),
  });
  const inbox = new Map<number, any[]>();
  const players: ServerPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const box: any[] = [];
    const p = game.join(`P${i}`, 0, WEAPON.RIFLE, (d) => box.push(JSON.parse(d))) as ServerPlayer;
    inbox.set(p.id, box);
    players.push(p);
  }
  return { game, players, inbox };
}

function place(p: ServerPlayer, x: number, z: number) {
  Object.assign(p.state, { x, y: 0.05, z, vx: 0, vy: 0, vz: 0, dropping: false, onGround: true, protect: 0, deploy: 0 });
}

function headshot(game: Game, shooter: ServerPlayer, victim: ServerPlayer) {
  game.world = flatWorld();
  place(shooter, 0, 500);
  place(victim, 0, 0);
  for (let i = 0; i < 3; i++) game.update();
  game.input(shooter, [{ seq: shooter.lastSeq + 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: game.now() }]);
  game.update();
}

describe('Team Deathmatch', () => {
  it('opens the rotation with TDM and splits players evenly', () => {
    const { game, players } = setup(5);
    expect(game.mode).toBe('tdm');
    expect(game.phase).toBe('live');
    const a = players.filter((p) => p.team === 0).length;
    const b = players.filter((p) => p.team === 1).length;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    expect(a + b).toBe(5);
  });

  it('has no friendly fire', () => {
    const { game, players } = setup(4);
    const [s, mate] = players.filter((p) => p.team === 0);
    headshot(game, s, mate);
    expect(mate.alive).toBe(true);
    expect(mate.state.health).toBe(100);
    expect(game.teamScores).toEqual([0, 0]);
  });

  it('scores enemy kills for the team and ends at the kill limit', () => {
    const { game, players, inbox } = setup(2, { tdmLimit: 1 });
    const [s, enemy] = players[0].team === 0 ? players : [players[1], players[0]];
    headshot(game, s, enemy);
    expect(enemy.alive).toBe(false);
    expect(game.teamScores[s.team]).toBe(1);
    game.update();
    expect(game.phase).toBe('podium');
    const match = inbox.get(s.id)!.filter((m) => m.t === 'match').pop().match;
    expect(match.mode).toBe('tdm');
    expect(match.winner).toBe(s.team);
    expect(match.results[0]).toMatchObject({ id: s.id, team: s.team, kills: 1 });
  });

  it('lets players move only to the smaller team', () => {
    const { game, players } = setup(3);
    const big = players.filter((p) => p.team === 0).length > 1 ? 0 : 1;
    const mover = players.find((p) => p.team === big)!;
    const loner = players.find((p) => p.team !== big)!;
    game.switchTeam(loner, big); // joining the bigger side (2) is blocked
    expect(loner.team).toBe(1 - big);
    game.switchTeam(mover, 1 - big); // joining the smaller side (1) is allowed, like CS
    expect(mover.team).toBe(1 - big);
    expect(mover.alive).toBe(false); // switching sides costs a respawn, not a death
    const stayer = players.find((p) => p.team === big)!;
    game.switchTeam(stayer, 1 - big); // now 1 vs 2: blocked
    expect(stayer.team).toBe(big);
    expect(mover.deaths).toBe(0);
  });

  it('drops each team over its own half of the map', () => {
    const { game, players } = setup(6);
    for (const p of players) {
      if (p.team === 0) expect(p.state.z).toBeLessThan(0);
      else expect(p.state.z).toBeGreaterThan(0);
      expect(p.state.y).toBe(game.map.dropHeight);
    }
  });

  it('auto-balances a player from a side that is 2 bigger when they respawn', () => {
    const { game, players } = setup(4);
    const team1 = players.filter((p) => p.team === 1);
    game.leave(team1[0].id);
    game.leave(team1[1].id); // 2 vs 0
    const victim = players.find((p) => p.team === 0)!;
    victim.alive = false;
    victim.respawnAt = game.tick + 1;
    game.update();
    game.update();
    expect(victim.alive).toBe(true);
    expect(victim.team).toBe(1);
  });

  it('rotates TDM Forja -> FFA Escritório -> FFA Forja -> TDM Escritório', () => {
    const { game } = setup(2);
    const seen: string[] = [];
    for (let m = 0; m < 4; m++) {
      seen.push(`${game.mode}@${game.mapIndex}`);
      (game as any).phaseEnds = game.now();
      game.update(); // -> podium
      for (let i = 0; i < 5 * 60 + 2; i++) game.update(); // -> next match
    }
    expect(seen).toEqual(['tdm@0', 'ffa@1', 'ffa@0', 'tdm@1']);
  });

  it('clears teams in free-for-all', () => {
    const { game, players } = setup(2);
    (game as any).phaseEnds = game.now();
    game.update();
    for (let i = 0; i < 5 * 60 + 2; i++) game.update();
    expect(game.mode).toBe('ffa');
    expect(players.every((p) => p.team === -1)).toBe(true);
  });
});

describe('Dust2 selection', () => {
  it('pins Dust2 in both modes across match transitions', () => {
    const game = new Game({ maxPlayers: 2, matchMs: 1000, podiumMs: 1000, warmupMinPlayers: 1, mapId: 'dust2' });
    game.join('Dust2 tester', 0, WEAPON.RIFLE, () => {});
    expect(game.map.id).toBe('dust2');
    expect(game.mode).toBe('tdm');
    for (let i = 0; i < 121; i++) game.update();
    expect(game.map.id).toBe('dust2');
    expect(game.mode).toBe('ffa');
  });

  it('rejects unknown map IDs', () => {
    expect(() => new Game({ maxPlayers: 2, matchMs: 1000, podiumMs: 1000, warmupMinPlayers: 1, mapId: 'missing' })).toThrow('Unknown GAME_MAP');
  });
});
