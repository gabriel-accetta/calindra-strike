import { describe, expect, it } from 'vitest';
import { CollisionWorld, STAND_HEIGHT, getMaps } from '../src/index.ts';

describe.each(getMaps().map((m) => [m.id, m] as const))('map %s', (_id, map) => {
  const world = new CollisionWorld(map);

  it('has well formed boxes', () => {
    for (const b of map.boxes) {
      expect(b.max.x).toBeGreaterThan(b.min.x);
      expect(b.max.y).toBeGreaterThan(b.min.y);
      expect(b.max.z).toBeGreaterThan(b.min.z);
    }
  });

  it('drops airdrops onto open, reachable floor', () => {
    expect(map.airdropPoints.length).toBeGreaterThanOrEqual(5);
    for (const p of map.airdropPoints) {
      const y = world.groundBelow(p.x, map.dropHeight, p.z, 22);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(map.id === 'dust2' ? 800 : 200);
      expect(world.hullOverlaps(p.x, y + 0.1, p.z, STAND_HEIGHT)).toBe(false);
    }
  });

  it('keeps the skydive start altitude clear', () => {
    const a = map.dropArea;
    for (let x = a.minX; x <= a.maxX; x += 97) {
      for (let z = a.minZ; z <= a.maxZ; z += 97) {
        expect(world.hullOverlaps(x, map.dropHeight, z, STAND_HEIGHT)).toBe(false);
      }
    }
  });

  it('keeps the drop area inside the walls', () => {
    const a = map.dropArea;
    const b = map.bounds;
    expect(a.minX).toBeGreaterThan(b.minX);
    expect(a.maxX).toBeLessThan(b.maxX);
    expect(a.minZ).toBeGreaterThan(b.minZ);
    expect(a.maxZ).toBeLessThan(b.maxZ);
  });
});

describe('Dust2 parachute spawns', () => {
  it('lands every authored spawn point on the imported geometry', async () => {
    const { applyCmd, createPlayerState, spawnState, WEAPON } = await import('../src/index.ts');
    const map = getMaps().find((candidate) => candidate.id === 'dust2')!;
    const world = new CollisionWorld(map);
    expect(map.spawnPoints!.length).toBeGreaterThan(10);
    expect(map.spawnPoints!.some((point) => point.z < -150)).toBe(true);
    expect(map.spawnPoints!.some((point) => point.z > 150)).toBe(true);
    for (const point of map.spawnPoints!) {
      const state = createPlayerState();
      spawnState(state, point.x, map.dropHeight, point.z, 0, WEAPON.RIFLE);
      for (let seq = 0; seq < 600 && state.dropping; seq++) {
        applyCmd(world, state, { seq, buttons: 0, yaw: 0, pitch: 0, weapon: 0, interp: 0 }, 1);
      }
      expect(state.dropping).toBe(false);
      expect(state.y).toBeGreaterThanOrEqual(0);
      expect(world.hullOverlaps(state.x, state.y + 0.1, state.z, STAND_HEIGHT)).toBe(false);
    }
  });
});

describe('Dust2 fixed team spawns', () => {
  it('preserves all forty ground spawn slots without overlap with the map', () => {
    const map = getMaps().find((candidate) => candidate.id === 'dust2')!;
    const world = new CollisionWorld(map);
    expect(map.defuse!.sites.map((site) => site.id).sort()).toEqual(['A', 'B']);
    for (const team of map.defuse!.spawns) {
      expect(team).toHaveLength(20);
      expect(new Set(team.map((point) => `${point.x},${point.z}`)).size).toBe(20);
      for (const point of team) {
        expect(Number.isFinite(point.y)).toBe(true);
        expect(world.hullOverlaps(point.x, point.y, point.z, STAND_HEIGHT)).toBe(false);
        expect(point.y - world.groundBelow(point.x, point.y + 1, point.z, 16)).toBeLessThan(1);
      }
    }
  });
});
