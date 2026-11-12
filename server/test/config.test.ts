import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { Game } from '../src/game.ts';

afterEach(() => vi.unstubAllEnvs());

describe('optional defuse configuration', () => {
  it('keeps the original mixed mode as default', () => {
    vi.stubEnv('GAME_MAP', '');
    vi.stubEnv('GAME_MODE', undefined);
    const cfg = loadConfig();
    expect(cfg.modes).toBe('mixed');
    expect(cfg.mapId).toBeUndefined();
    const game = new Game({ maxPlayers: 24, matchMs: 300_000, podiumMs: 5000, warmupMinPlayers: 2 });
    expect(game.map.id).toBe('forja');
  });

  it('loads the defuse mode and round win limit', () => {
    vi.stubEnv('GAME_MODE', 'defuse');
    vi.stubEnv('DEFUSE_ROUNDS_TO_WIN', '5');
    expect(loadConfig()).toMatchObject({ modes: 'defuse', defuseRoundsToWin: 5 });
    vi.stubEnv('DEFUSE_ROUNDS_TO_WIN', '0');
    expect(() => loadConfig()).toThrow('Invalid DEFUSE_ROUNDS_TO_WIN');
  });

  it('rejects a different map or more players than fixed spawn slots', () => {
    const options = { maxPlayers: 24, matchMs: 300_000, podiumMs: 5000, warmupMinPlayers: 2, modes: 'defuse' as const };
    expect(() => new Game({ ...options, mapId: 'forja' })).toThrow('Defuse requires GAME_MAP=dust2');
    expect(() => new Game({ ...options, maxPlayers: 41 })).toThrow('at most 40');
  });
});
