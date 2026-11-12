import { describe, expect, it } from 'vitest';
import { CollisionWorld, getMap, type Brush } from '../src/index.ts';

// A triangular ramp rising along X. A bounding box would seal its empty half.
const ramp: Brush = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 100, y: 100, z: 100 },
  planes: [[-1, 0, 0, 0], [1, 0, 0, 100], [0, -1, 0, 0], [0, 0, -1, 0], [0, 0, 1, 100], [-Math.SQRT1_2, Math.SQRT1_2, 0, 0]],
  faces: [],
  solid: true,
};
const world = new CollisionWorld({ ...getMap(0), boxes: [], brushes: [ramp] });

describe('convex brush collision', () => {
  it('keeps the space above a ramp clear', () => {
    expect(world.hullOverlaps(20, 60, 50, 72)).toBe(false);
    expect(world.hullOverlaps(80, 20, 50, 72)).toBe(true);
  });

  it('traces the sloped surface rather than its bounding box', () => {
    const hit = world.trace(25, 150, 50, 0, -1, 0, 200);
    expect(hit?.t).toBeCloseTo(125);
    expect(hit?.ny).toBeCloseTo(Math.SQRT1_2);
    expect(world.groundBelow(25, 150, 50, 0)).toBeCloseTo(25);
  });

  it('stops the player hull on the ramp and permits movement away', () => {
    expect(world.clipAxis(25, 150, 50, 72, 1, -200)).toBeCloseTo(-109, 0);
    expect(world.clipAxis(25, 150, 50, 72, 1, 20)).toBe(20);
  });
});
