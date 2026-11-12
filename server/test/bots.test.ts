import { WEAPON } from '@calindra-strike/shared';
import { describe, expect, it } from 'vitest';
import { Game, type ServerPlayer } from '../src/game.ts';

function setup(opts: { botFill?: number; modes?: 'mixed' | 'ffa' | 'tdm'; matchMs?: number } = {}) {
  let r = 0.31;
  const game = new Game({
    maxPlayers: 16,
    matchMs: opts.matchMs ?? 120_000,
    podiumMs: 5_000,
    warmupMinPlayers: 2,
    modes: opts.modes ?? 'ffa',
    botFill: opts.botFill ?? 6,
    botSkill: 0.6,
    random: () => (r = ((r * 9301 + 49297) % 233280) / 233280),
  });
  const inbox = new Map<number, any[]>();
  const join = (name: string, token = '') => {
    const box: any[] = [];
    const p = game.join(name, 0, WEAPON.RIFLE, (d) => box.push(JSON.parse(d)), token) as ServerPlayer;
    inbox.set(p.id, box);
    return p;
  };
  const bots = () => [...game.players.values()].filter((p) => p.brain);
  return { game, join, inbox, bots };
}

describe('bots', () => {
  it('fill the server up to BOT_FILL while someone is online, and start the match', () => {
    const { game, join, bots } = setup();
    expect(bots()).toHaveLength(0);
    join('Gabi');
    expect(bots()).toHaveLength(5);
    expect(game.phase).toBe('live');
    expect(bots().every((b) => b.name.startsWith('BOT '))).toBe(true);
  });

  it('make room for real players and leave when the last human does', () => {
    const { game, join, bots } = setup();
    const a = join('A');
    join('B');
    join('C');
    expect(bots()).toHaveLength(3);
    expect(game.humanCount()).toBe(3);
    game.leave(a.id);
    expect(bots()).toHaveLength(4);
    for (const p of [...game.players.values()]) if (!p.brain) game.leave(p.id);
    expect(game.players.size).toBe(0);
    expect(game.phase).toBe('warmup');
  });

  it('never block a real player from joining', () => {
    const { game, join, bots } = setup({ botFill: 16 });
    for (let i = 0; i < 16; i++) expect(typeof join(`P${i}`)).toBe('object');
    expect(bots()).toHaveLength(0);
    expect(game.humanCount()).toBe(16);
  });

  it('roam the map and fight: someone gets shot within a minute', () => {
    const { game, join, bots } = setup();
    join('Gabi');
    const start = new Map(bots().map((b) => [b.id, { x: b.state.x, z: b.state.z }]));
    for (let i = 0; i < 60 * 60; i++) game.update();
    const moved = bots().filter((b) => Math.hypot(b.state.x - start.get(b.id)!.x, b.state.z - start.get(b.id)!.z) > 300);
    expect(moved.length).toBeGreaterThan(2);
    const kills = [...game.players.values()].reduce((n, p) => n + p.kills, 0);
    const hurt = [...game.players.values()].some((p) => p.deaths > 0 || p.state.health < 100);
    expect(kills > 0 || hurt).toBe(true);
  });

  it('only shoot the other team in TDM', () => {
    const { game, join } = setup({ modes: 'tdm', botFill: 8 });
    join('Gabi');
    expect(game.mode).toBe('tdm');
    for (let i = 0; i < 60 * 45; i++) game.update();
    // no friendly fire on the server means team scores equal total kills
    const total = [...game.players.values()].reduce((n, p) => n + p.kills, 0);
    expect(game.teamScores[0] + game.teamScores[1]).toBe(total);
    const sizes = [0, 1].map((t) => [...game.players.values()].filter((p) => p.team === t).length);
    expect(Math.abs(sizes[0] - sizes[1])).toBeLessThanOrEqual(1);
  });
});

describe('map vote', () => {
  it('offers 3 other map/mode combos and plays the most voted one', () => {
    const { game, join, inbox } = setup({ modes: 'mixed', botFill: 0, matchMs: 20_000 });
    const a = join('A');
    const b = join('B');
    (game as any).phaseEnds = game.now();
    game.update();
    expect(game.phase).toBe('podium');
    const match = inbox.get(a.id)!.filter((m) => m.t === 'match').pop().match;
    expect(match.vote.options).toHaveLength(3);
    expect(match.vote.options.some((o: any) => o.map === game.mapIndex && o.mode === game.mode)).toBe(false);
    const pick = match.vote.options[2];
    game.vote(a, 2);
    game.vote(b, 2);
    expect(inbox.get(a.id)!.filter((m) => m.t === 'votes').pop().counts).toEqual([0, 0, 2]);
    for (let i = 0; i < 5 * 60 + 2; i++) game.update();
    expect(game.phase).toBe('live');
    expect({ map: game.mapIndex, mode: game.mode }).toEqual(pick);
  });

  it('follows the normal rotation when nobody votes', () => {
    const { game, join } = setup({ modes: 'mixed', botFill: 0 });
    join('A');
    join('B');
    (game as any).phaseEnds = game.now();
    game.update();
    for (let i = 0; i < 5 * 60 + 2; i++) game.update();
    expect({ map: game.mapIndex, mode: game.mode }).toEqual({ map: 1, mode: 'ffa' });
  });

  it('ignores votes outside the podium and from bots', () => {
    const { game, join, bots } = setup({ botFill: 4 });
    const a = join('A');
    game.vote(a, 0);
    expect((game as any).votes.size).toBe(0);
    (game as any).phaseEnds = game.now();
    game.update();
    game.vote(bots()[0], 1);
    expect((game as any).votes.size).toBe(0);
  });
});

describe('rejoin', () => {
  it('gives your score back if you reconnect with your token during the same match', () => {
    const { game, join, inbox } = setup({ botFill: 0 });
    const a = join('Gabi');
    join('B');
    const token = inbox.get(a.id)!.find((m) => m.t === 'welcome').token;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    a.kills = 7;
    a.deaths = 2;
    game.leave(a.id);
    const again = join('someone else', token);
    expect(again.name).toBe('Gabi');
    expect(again.kills).toBe(7);
    expect(again.deaths).toBe(2);
    // the token is single use
    game.leave(again.id);
    const third = join('x', 'f'.repeat(32));
    expect(third.kills).toBe(0);
  });
});
