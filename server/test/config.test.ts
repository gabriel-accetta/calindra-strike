import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, mapList, modeList } from '../src/config.ts';
import { Game } from '../src/game.ts';

afterEach(() => vi.unstubAllEnvs());

const base = { maxPlayers: 24, matchMs: 300_000, podiumMs: 5000, warmupMinPlayers: 2 };

describe('map and mode selection', () => {
  it('plays every map with every mode by default', () => {
    vi.stubEnv('GAME_MODES', '');
    vi.stubEnv('GAME_MODE', '');
    vi.stubEnv('GAME_MAPS', '');
    const cfg = loadConfig();
    expect(cfg.modes).toEqual(['tdm', 'ffa', 'defuse']);
    expect(cfg.maps).toEqual([]);
    expect(cfg.defuseRoundsToWin).toBe(8);
  });

  it('accepts any list of modes and maps', () => {
    expect(modeList('defuse, tdm', undefined)).toEqual(['defuse', 'tdm']);
    expect(modeList(undefined, 'mixed')).toEqual(['tdm', 'ffa']); // older single setting still works
    expect(modeList(undefined, 'defuse')).toEqual(['defuse']);
    expect(modeList('all', undefined)).toEqual(['tdm', 'ffa', 'defuse']);
    expect(mapList('escritorio')).toEqual(['escritorio']);
    expect(mapList('forja,escritorio,forja')).toEqual(['forja', 'escritorio']);
    expect(() => modeList('tdm,zombies', undefined)).toThrow('Invalid game mode: zombies');
    expect(() => mapList('dust2')).toThrow('Invalid map: dust2');
  });

  it('rotates through exactly the chosen combinations, changing map every match', () => {
    const game = new Game({ ...base, modes: ['tdm', 'ffa', 'defuse'], maps: ['forja', 'escritorio'] });
    expect(game.combos.map((c) => `${c.mode}@${c.map}`)).toEqual(['tdm@0', 'ffa@1', 'defuse@0', 'tdm@1', 'ffa@0', 'defuse@1']);
    const only = new Game({ ...base, modes: ['defuse'], maps: ['escritorio'] });
    expect(only.combos).toEqual([{ map: 1, mode: 'defuse' }]);
    expect(only.map.id).toBe('escritorio');
    expect(only.mode).toBe('defuse');
  });

  it('only offers configured combinations in the end-of-match vote', () => {
    const game = new Game({ ...base, modes: ['tdm', 'defuse'], maps: ['forja', 'escritorio'], random: () => 0.5 });
    game.join('A', 0, 2, () => {});
    game.join('B', 0, 2, () => {});
    (game as any).phaseEnds = game.now();
    game.update();
    const options = (game as any).voteOptions as { map: number; mode: string }[];
    expect(options.length).toBe(3);
    expect(options.every((o) => o.mode === 'tdm' || o.mode === 'defuse')).toBe(true);
  });

  it('rejects unknown maps and too many players for defuse spawns', () => {
    expect(() => new Game({ ...base, maps: ['dust2'] })).toThrow('Unknown map: dust2');
    expect(() => new Game({ ...base, modes: ['defuse'], maxPlayers: 41 })).toThrow('at most 40');
  });
});
