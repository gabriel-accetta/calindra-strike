import { STAND_HEIGHT } from '../constants.ts';
import { vec3 } from '../math.ts';
import { CollisionWorld } from '../physics.ts';
import type { MapDef } from './types.ts';

export interface DefuseSpec {
  /** Centre of each team's spawn block on the ground, and the direction they face. */
  attackers: { x: number; z: number; yaw: number };
  defenders: { x: number; z: number; yaw: number };
  /** Bombsites as ground-level rectangles [x1, z1, x2, z2]. */
  sites: { id: string; rect: [number, number, number, number] }[];
}

const SLOTS_PER_TEAM = 20;

/**
 * Fills `map.defuse` from a compact spec: lays out a 6x5 block of candidate spawn
 * points per team (72 units apart) and keeps the ones where a player can stand.
 */
export function applyDefuse(map: MapDef, spec: DefuseSpec): MapDef {
  const world = new CollisionWorld(map);
  const block = (c: { x: number; z: number; yaw: number }) => {
    const out: { x: number; y: number; z: number; yaw: number }[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        const x = c.x + (col - 2.5) * 72;
        const z = c.z + (row - 2) * 72;
        const y = world.groundBelow(x, 400, z, 16) + 0.03125;
        if (y < 0 || y > 1 || world.hullOverlaps(x, y, z, STAND_HEIGHT)) continue;
        out.push({ x, y, z, yaw: c.yaw });
      }
    }
    // closest to the centre first, so small teams start together
    out.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    return out.slice(0, SLOTS_PER_TEAM);
  };
  map.defuse = {
    spawns: [block(spec.attackers), block(spec.defenders)],
    sites: spec.sites.map((s) => ({
      id: s.id,
      min: vec3(Math.min(s.rect[0], s.rect[2]), 0, Math.min(s.rect[1], s.rect[3])),
      max: vec3(Math.max(s.rect[0], s.rect[2]), 120, Math.max(s.rect[1], s.rect[3])),
    })),
  };
  return map;
}
