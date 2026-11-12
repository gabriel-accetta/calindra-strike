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
      expect(y).toBeLessThan(200);
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
