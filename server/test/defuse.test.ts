import { BTN, STAND_HEIGHT, WEAPON, type ServerMsg } from '@calindra-strike/shared';
import { describe, expect, it } from 'vitest';
import { Game, type ServerPlayer } from '../src/game.ts';

function setup(roundsToWin = 8) {
  const messages: ServerMsg[] = [];
  const game = new Game({
    maxPlayers: 24,
    matchMs: 300_000,
    podiumMs: 5000,
    warmupMinPlayers: 2,
    modes: 'defuse',
    defuseRoundsToWin: roundsToWin,
    random: () => 0.7,
  });
  const join = (name: string) => game.join(name, 0, WEAPON.RIFLE, (data) => messages.push(JSON.parse(data))) as ServerPlayer;
  const players = [join('A'), join('B')];
  const attacker = players.find((p) => p.team === 0)!;
  const defender = players.find((p) => p.team === 1)!;
  const step = (p: ServerPlayer, buttons: number, ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      game.input(p, [{ seq: p.lastSeq + 1, buttons, yaw: p.state.yaw, pitch: 0, weapon: 0, interp: game.now() }]);
      game.update();
    }
  };
  const wait = (ticks: number) => {
    for (let i = 0; i < ticks; i++) game.update();
  };
  const site = (p: ServerPlayer, id = 'B') => {
    const site = game.map.defuse!.sites.find((s) => s.id === id)!;
    for (let x = site.min.x + 32; x < site.max.x - 32; x += 48) {
      for (let z = site.min.z + 32; z < site.max.z - 32; z += 48) {
        const y = game.world.groundBelow(x, site.max.y, z, 16) + 0.03125;
        if (y < site.min.y || game.world.hullOverlaps(x, y, z, STAND_HEIGHT)) continue;
        Object.assign(p.state, { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true });
        return;
      }
    }
    throw new Error('No playable floor in bombsite');
  };
  const plant = (id = 'B') => {
    site(attacker, id);
    step(attacker, BTN.USE, 182);
    expect(game.bomb!.planted).toBe(true);
  };
  return { game, attacker, defender, step, wait, join, site, plant, messages };
}

describe('Dust2 bomb defusal', () => {
  it('pins Dust2, starts on original fixed ground spawns and retains teams between rounds', () => {
    const { game, attacker, defender, wait } = setup();
    expect(game.map.id).toBe('dust2');
    const before = [attacker, defender].map((p) => ({ x: p.state.x, y: p.state.y, z: p.state.z, team: p.team }));
    for (const p of [attacker, defender]) {
      expect(p.state.dropping).toBe(false);
      expect(p.state.onGround).toBe(true);
      expect(game.map.defuse!.spawns[p.team]).toContainEqual(expect.objectContaining({ x: p.state.x, y: p.state.y, z: p.state.z }));
    }
    game.phaseEnds = game.now();
    game.update();
    expect(game.teamScores).toEqual([0, 1]);
    wait(301);
    expect(game.bomb!.round).toBe(2);
    expect([attacker, defender].map((p) => ({ x: p.state.x, y: p.state.y, z: p.state.z, team: p.team }))).toEqual(before);
  });

  it.each(['A', 'B'])('plants only after holding E for three server seconds at %s', (id) => {
    const { game, attacker, step, site, plant } = setup();
    step(attacker, BTN.USE, 190);
    expect(game.bomb!.planted).toBe(false);
    site(attacker, id);
    step(attacker, BTN.USE, 90);
    expect(game.bomb!.planted).toBe(false);
    step(attacker, 0);
    expect(game.bomb!.action).toBeNull();
    plant(id);
    expect(game.bomb!.explodesAt - game.now()).toBeGreaterThan(39_000);
  });

  it('does not accelerate planting by flooding commands and cancels stale use input', () => {
    const { game, attacker, site, wait } = setup();
    site(attacker);
    game.input(attacker, Array.from({ length: 48 }, (_, seq) => ({ seq, buttons: BTN.USE, yaw: 0, pitch: 0, weapon: 0, interp: 0 })));
    game.update();
    expect(game.bomb!.planted).toBe(false);
    wait(200);
    expect(game.bomb!.planted).toBe(false);
    expect(game.bomb!.action).toBeNull();
  });

  it('allows only defenders close to the planted bomb to defuse for ten seconds', () => {
    const { game, attacker, defender, plant, step } = setup();
    plant();
    step(attacker, BTN.USE, 610);
    expect(game.bomb!.phase).toBe('playing');
    step(defender, BTN.USE, 610);
    expect(game.bomb!.phase).toBe('playing');
    Object.assign(defender.state, { x: attacker.state.x, y: attacker.state.y, z: attacker.state.z });
    step(defender, BTN.USE, 300);
    expect(game.bomb!.phase).toBe('playing');
    step(defender, BTN.USE, 302);
    expect(game.bomb!.reason).toBe('bomba desarmada');
    expect(game.teamScores).toEqual([0, 1]);
  });

  it('keeps a planted bomb running after the last attacker dies, without respawning them', () => {
    const { game, attacker, defender, plant, wait } = setup();
    plant();
    game['kill'](attacker, defender, WEAPON.RIFLE, false);
    wait(240);
    expect(attacker.alive).toBe(false);
    expect(game.bomb!.phase).toBe('playing');
    wait(2200);
    expect(game.bomb!.reason).toBe('bomba explodiu');
    expect(game.teamScores).toEqual([1, 0]);
  });

  it('drops the bomb on death and lets an attacker pick it up', () => {
    const { game, attacker, defender, join, wait } = setup();
    join('C');
    const teammate = join('D');
    expect(teammate.team).toBe(0);
    expect(teammate.alive).toBe(false); // joined during a round
    teammate.alive = true;
    Object.assign(teammate.state, attacker.state);
    game['kill'](attacker, defender, WEAPON.RIFLE, false);
    wait(1);
    expect(game.bomb!.carrier).toBe(teammate.id);
    expect(attacker.alive).toBe(false);
  });

  it('awards elimination wins and ends the match at the configured round score', () => {
    const { game, attacker, defender, messages } = setup(1);
    game['kill'](defender, attacker, WEAPON.RIFLE, false);
    game.update();
    expect(game.phase).toBe('podium');
    expect(game.teamScores).toEqual([1, 0]);
    expect(messages.filter((m) => m.t === 'match').at(-1)).toMatchObject({ match: { winner: 0, mode: 'defuse' } });
  });

  it('drops the bomb on disconnect and waits for teams before restarting', () => {
    const { game, attacker, wait } = setup();
    game.leave(attacker.id);
    expect(game.bomb!.carrier).toBeNull();
    expect(game.bomb!.position).not.toBeNull();
    wait(302);
    expect(game.phase).toBe('warmup');
    expect(game.bomb).toBeUndefined();
  });

  it('interrupts progress on movement and damage', () => {
    const { game, attacker, defender, site, step } = setup();
    site(attacker);
    step(attacker, BTN.USE, 90);
    expect(game.bomb!.action).not.toBeNull();
    step(attacker, BTN.USE | BTN.FWD);
    expect(game.bomb!.action).toBeNull();
    site(attacker);
    step(attacker, BTN.USE, 90);
    const oldDeadline = game.bomb!.action!.endsAt;
    game['damage'](attacker, defender, 1, false, 1, WEAPON.RIFLE);
    expect(game.bomb!.action).toBeNull();
    step(attacker, BTN.USE);
    expect(game.bomb!.action!.endsAt).toBeGreaterThan(oldDeadline);
  });

  it('awards the explosion when a defuse finishes at the exact fuse deadline', () => {
    const { game, defender, plant } = setup();
    plant();
    game.bomb!.explodesAt = game.now() + 17;
    game.bomb!.action = { id: defender.id, kind: 'defuse', startedAt: game.now() - 10_000, endsAt: game.now() + 17 };
    game.update();
    game.update();
    expect(game.bomb!.reason).toBe('bomba explodiu');
    expect(game.teamScores).toEqual([1, 0]);
  });

  it('sends bomb and spawn orientation with snapshots', () => {
    const { game, messages, wait } = setup();
    wait(3);
    const snapshot = messages.filter((message) => message.t === 'snap').at(-1);
    expect(snapshot).toMatchObject({ bomb: { round: 1, planted: false, carrier: game.bomb!.carrier }, look: expect.any(Array) });
  });

  it('does not permit switching teams mid-round', () => {
    const { game, attacker } = setup();
    game.switchTeam(attacker, 1);
    expect(attacker.team).toBe(0);
  });
});
