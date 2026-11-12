import { BTN, CollisionWorld, type GameEvent, MapBuilder, WEAPON, getMaps } from '@calindra-strike/shared';
import { describe, expect, it } from 'vitest';
import { Game, type ServerPlayer } from '../src/game.ts';

function flatWorld(): CollisionWorld {
  const b = new MapBuilder();
  b.add(-4000, -32, -4000, 4000, 0, 4000, 'ground');
  return new CollisionWorld({ ...getMaps()[0], boxes: b.boxes });
}

function setup(opts: Partial<{ matchMs: number }> = {}) {
  let r = 0.37;
  const game = new Game({ maxPlayers: 8, matchMs: opts.matchMs ?? 60_000, podiumMs: 5_000, warmupMinPlayers: 2, random: () => (r = (r * 9301 + 49297) % 233280 / 233280) });
  const inbox = new Map<number, any[]>();
  const join = (name: string) => {
    const box: any[] = [];
    const p = game.join(name, 0, WEAPON.RIFLE, (d) => box.push(JSON.parse(d))) as ServerPlayer;
    inbox.set(p.id, box);
    return p;
  };
  return { game, join, inbox };
}

function place(p: ServerPlayer, x: number, z: number) {
  Object.assign(p.state, { x, y: 0.05, z, vx: 0, vy: 0, vz: 0, dropping: false, onGround: true, protect: 0, deploy: 0 });
}

const events = (box: any[]): GameEvent[] => box.filter((m) => m.t === 'ev').flatMap((m) => m.e);

describe('Game', () => {
  it('waits in warmup until two players, then starts a live match', () => {
    const { game, join } = setup();
    join('A');
    expect(game.phase).toBe('warmup');
    join('B');
    expect(game.phase).toBe('live');
  });

  it('dedupes names', () => {
    const { join } = setup();
    expect(join('Gabi').name).toBe('Gabi');
    expect(join('gabi').name).toBe('gabi#2');
  });

  it('kills with a rifle headshot and credits the shooter', () => {
    const { game, join, inbox } = setup();
    const a = join('Shooter');
    const b = join('Target');
    game.world = flatWorld();
    place(a, 0, 500);
    place(b, 0, 0);
    for (let i = 0; i < 5; i++) game.update();
    game.input(a, [{ seq: 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: game.now() }]);
    game.update();
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(a.headshots).toBe(1);
    const kill = events(inbox.get(b.id)!).find((e) => e.k === 'kill');
    expect(kill).toMatchObject({ by: a.id, to: b.id, hs: 1 });
    // shot event is broadcast to others, not echoed to the shooter
    expect(events(inbox.get(b.id)!).some((e) => e.k === 'shot')).toBe(true);
    expect(events(inbox.get(a.id)!).some((e) => e.k === 'shot')).toBe(false);
  });

  it('does not damage players with spawn protection or mid-skydive', () => {
    const { game, join } = setup();
    const a = join('A');
    const b = join('B');
    game.world = flatWorld();
    place(a, 0, 500);
    place(b, 0, 0);
    b.state.protect = 60;
    for (let i = 0; i < 3; i++) game.update();
    game.input(a, [{ seq: 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: game.now() }]);
    game.update();
    expect(b.alive).toBe(true);
    expect(b.state.health).toBe(100);
  });

  it('respawns the dead after 3 seconds, dropping from the sky', () => {
    const { game, join } = setup();
    const a = join('A');
    const b = join('B');
    game.world = flatWorld();
    place(a, 0, 500);
    place(b, 0, 0);
    for (let i = 0; i < 3; i++) game.update();
    game.input(a, [{ seq: 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: game.now() }]);
    game.update();
    expect(b.alive).toBe(false);
    for (let i = 0; i < 181; i++) game.update();
    expect(b.alive).toBe(true);
    expect(b.state.dropping).toBe(true);
    expect(b.state.y).toBe(game.map.dropHeight);
  });

  it('ends the match into a podium and rotates to the next map', () => {
    const { game, join, inbox } = setup({ matchMs: 20_000 });
    const a = join('A');
    const b = join('B');
    a.kills = 3;
    b.kills = 5;
    (game as any).phaseEnds = game.now();
    game.update();
    expect(game.phase).toBe('podium');
    const match = inbox.get(a.id)!.filter((m) => m.t === 'match').pop();
    expect(match.match.results.map((r: any) => r.name)).toEqual(['B', 'A']);
    for (let i = 0; i < 5 * 60 + 2; i++) game.update();
    expect(game.phase).toBe('live');
    expect(game.mapIndex).toBe(1);
    expect(a.kills).toBe(0);
  });

  it('drops a legendary airdrop that a player can claim', () => {
    const { game, join, inbox } = setup();
    const a = join('A');
    join('B');
    (game as any).nextAirdropAt = game.now();
    game.update();
    const drop = events(inbox.get(a.id)!).find((e) => e.k === 'drop') as Extract<GameEvent, { k: 'drop' }>;
    expect(drop).toBeTruthy();
    for (let i = 0; i < 60 * 20; i++) game.update();
    place(a, drop.x, drop.z + 30);
    a.state.y = (game as any).airdrops[0].landY + 0.05;
    game.update();
    expect([WEAPON.SNIPER, WEAPON.LMG]).toContain(a.state.weapon);
    expect(a.state.armor).toBe(100);
    expect(events(inbox.get(a.id)!).some((e) => e.k === 'loot')).toBe(true);
  });

  it('caps command throughput (no speedhack by flooding commands)', () => {
    const { game, join } = setup();
    const a = join('A');
    game.world = flatWorld();
    place(a, 0, 0);
    const before = a.state.tick;
    const flood = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, buttons: BTN.FWD, yaw: 0, pitch: 0, weapon: 0, interp: 0 }));
    for (let i = 0; i < 50; i++) game.input(a, flood.slice(i * 10, i * 10 + 10));
    for (let i = 0; i < 60; i++) game.update();
    // one second of server time can never run more than burst + 60 commands
    expect(a.state.tick - before).toBeLessThanOrEqual(24 + 60);
  });
});
